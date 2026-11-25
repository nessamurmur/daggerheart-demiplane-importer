#!/usr/bin/env bash
# Launch, check, and tear down isolated Foundry VTT instances for verifying this module.
# Usage:
#   fvtt.sh launch            -> prints RUN=<dir> URL=<url>; each run is a fresh copy of the base data dir
#   fvtt.sh doctor <RUN>      -> read-only health check
#   fvtt.sh stop <RUN>        -> kills only the server this run started, deletes the run dir, keeps evidence
#   fvtt.sh list              -> shows runs and whether their server is alive
set -euo pipefail

ROOT="${FOUNDRY_VERIFY_ROOT:-$HOME/foundry-verify}"   # must not contain a dot-directory (see Gotchas)
APP="${FOUNDRY_APP:-$ROOT/app-14.370}"
BASE="$ROOT/base"
RUNS="$ROOT/runs"
EVIDENCE="$ROOT/evidence"
REPO="${IMPORTER_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}"   # set IMPORTER_REPO to verify a worktree
MODULE_ID="daggerheart-demiplane-importer"
WORLD_ID="dpi-verify"

load_node() {
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  command -v node >/dev/null || { echo "node not found (nvm not loaded)" >&2; exit 1; }
}

free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()'; }

case "${1:-}" in
launch)
  load_node
  case "$ROOT$APP" in */.*) echo "ROOT/APP path contains a dot-directory; Foundry will 404 its own files" >&2; exit 1;; esac
  [ -f "$BASE/Config/license.json" ] || { echo "No license in $BASE/Config; a human must enter it once (see SKILL.md Setup)" >&2; exit 1; }
  [ -f "$BASE/Data/systems/daggerheart/system.json" ] || { echo "Foundryborne missing from $BASE/Data/systems" >&2; exit 1; }
  [ -f "$REPO/dist/$MODULE_ID/module.json" ] || { echo "Module not built: run 'pnpm build' in $REPO" >&2; exit 1; }
  id="$(date +%Y%m%d-%H%M%S)-$$"
  run="$RUNS/$id"; port="$(free_port)"
  mkdir -p "$run" "$EVIDENCE/$id"
  cp -a "$BASE/Config" "$BASE/Data" "$run/"
  rm -rf "$run/Config/options.json.lock"
  ln -sfn "$REPO/dist/$MODULE_ID" "$run/Data/modules/$MODULE_ID"
  sha="$(git -C "$REPO" rev-parse HEAD)"
  # run.json fields match runMeta() in evidence.mjs. No paths: the renderer copies this into the PR block.
  python3 - "$run" "$port" "$WORLD_ID" "$APP" "$EVIDENCE/$id" "$REPO" "$id" "$sha" <<'PY'
import json, sys, os
run, port, world, app, evidence, repo, run_id, sha = sys.argv[1:]
p = f"{run}/Config/options.json"; o = json.load(open(p))
o.update(dataPath=run, port=int(port), upnp=False, localHostname="localhost", noUpdate=True)
json.dump(o, open(p, "w"), indent=2)
sysj = json.load(open(f"{run}/Data/systems/daggerheart/system.json"))
core = json.load(open(f"{app}/resources/app/package.json"))["release"]
mod = json.load(open(os.path.join(repo, "module.json")))
os.makedirs(evidence, exist_ok=True)
json.dump({"runId": run_id, "foundry": f'{core["generation"]}.{core["build"]}',
           "foundryborne": sysj["version"], "moduleVersion": mod["version"], "headSha": sha},
          open(os.path.join(evidence, "run.json"), "w"), indent=2)
os.makedirs(f"{run}/Data/worlds/{world}", exist_ok=True)
json.dump({"id": world, "title": "DPI Verify", "system": "daggerheart", "systemVersion": sysj["version"],
           "coreVersion": f'{core["generation"]}.{core["build"]}', "description": "Throwaway world for importer verification"},
          open(f"{run}/Data/worlds/{world}/world.json", "w"), indent=2)
PY
  cd "$APP"
  # Background node directly (not a subshell) so $! is the server pid and no wrapper holds our stdout open.
  setsid node resources/app/main.mjs --dataPath="$run" --port="$port" --world="$WORLD_ID" --noupdate \
      > "$run/server.log" 2>&1 < /dev/null &
  echo $! > "$run/server.pid"
  cd - >/dev/null
  echo "$port" > "$run/port"; echo "$id" > "$run/id"
  for _ in $(seq 1 90); do
    if curl -sf --max-time 3 "http://localhost:$port/api/status" | grep -q '"active":true'; then
      echo "RUN=$run"; echo "URL=http://localhost:$port"; echo "EVIDENCE=$EVIDENCE/$id"; exit 0
    fi
    kill -0 "$(cat "$run/server.pid")" 2>/dev/null || { echo "server exited; see $run/server.log" >&2; tail -20 "$run/server.log" >&2; exit 1; }
    sleep 1
  done
  echo "timed out waiting for world; see $run/server.log" >&2; exit 1 ;;

doctor)
  run="${2:?usage: fvtt.sh doctor <RUN>}"; ok=1
  pid="$(cat "$run/server.pid" 2>/dev/null || true)"; port="$(cat "$run/port" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q -- "--dataPath=$run "; then echo "ok   server pid $pid belongs to this run"; else echo "FAIL server not running for $run"; ok=0; fi
  owner="$(ss -ltnpH "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
  [ "$owner" = "$pid" ] && echo "ok   port $port owned by our pid" || { echo "FAIL port $port owner is '${owner:-nobody}'"; ok=0; }
  status="$(curl -sf --max-time 3 "http://localhost:$port/api/status" || true)"
  echo "$status" | grep -q '"active":true' && echo "ok   world active: $status" || { echo "FAIL /api/status: ${status:-no response}"; ok=0; }
  link="$(readlink "$run/Data/modules/$MODULE_ID" || true)"
  [ "$link" = "$REPO/dist/$MODULE_ID" ] && echo "ok   module linked to $link" || { echo "FAIL module link is '$link'"; ok=0; }
  dv="$(python3 -c "import json;print(json.load(open('$REPO/dist/$MODULE_ID/module.json'))['version'])" 2>/dev/null || true)"
  sv="$(python3 -c "import json;print(json.load(open('$REPO/module.json'))['version'])")"
  [ "$dv" = "$sv" ] && echo "ok   built module version $dv matches source" || { echo "FAIL dist version '$dv' != source '$sv' (run pnpm build)"; ok=0; }
  newer="$(find "$REPO/src" "$REPO/styles" -newer "$REPO/dist/$MODULE_ID/scripts/module.js" -type f | head -3)"
  [ -z "$newer" ] && echo "ok   dist is newer than src" || { echo "WARN src changed after last build: $newer (run pnpm build, then reload the page)"; }
  [ $ok = 1 ] ;;

stop)
  run="${2:?usage: fvtt.sh stop <RUN>}"
  case "$run" in "$RUNS"/*) ;; *) echo "refusing: $run is not under $RUNS" >&2; exit 1;; esac
  pid="$(cat "$run/server.pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q -- "--dataPath=$run "; then
    kill "$pid"; for _ in $(seq 1 15); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
  fi
  id="$(cat "$run/id" 2>/dev/null || basename "$run")"
  mkdir -p "$EVIDENCE/$id"; cp "$run/server.log" "$EVIDENCE/$id/server.log" 2>/dev/null || true
  rm -rf "$run"; echo "stopped; evidence kept in $EVIDENCE/$id" ;;

list)
  for run in "$RUNS"/*/; do [ -d "$run" ] || continue; run="${run%/}"; pid="$(cat "$run/server.pid" 2>/dev/null || echo -)"
    if kill -0 "$pid" 2>/dev/null; then s=alive; else s=dead; fi; echo "$run pid=$pid port=$(cat "$run/port" 2>/dev/null) $s"; done ;;
*) sed -n '2,8p' "$0"; exit 1 ;;
esac
