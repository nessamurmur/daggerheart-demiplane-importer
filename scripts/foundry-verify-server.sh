#!/usr/bin/env bash
# Boot and tear down the throwaway Foundry used by .claude/skills/verify-foundry-importer.
#
#   scripts/foundry-verify-server.sh up
#   scripts/foundry-verify-server.sh down [RUN]
#   scripts/foundry-verify-server.sh status
#
# `up` prints RUN, URL, and EVIDENCE. EVIDENCE is the directory render-evidence.mjs
# reads: run.json is written there, and the suite adds one folder per journey.
# `down` stops that server, and any licence-signing server this script started, and keeps EVIDENCE.
#
# Foundry's licence allows one active server. Do not run `up` while another
# machine is hosting with the same licence. This script also holds a lock so
# two ups in this VM cannot both sign or launch.
#
# The only Foundry secret is FOUNDRY_LICENSE_KEY. The server zip is a cache file,
# FoundryVTT-Node-14.370.zip, filled by scripts/foundry-cache-fetch.sh.
# Optional: DEMIPLANE_SAMPLES_URL        https zip of the private sample PDFs
set +x
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${FOUNDRY_VERIFY_ROOT:-$HOME/foundry-verify}"
APP="${FOUNDRY_APP:-$ROOT/app-14.370}"
BASE="$ROOT/base"
FOUNDRY_VERSION=14.370
FOUNDRY_ARCHIVE_NAME=FoundryVTT-Node-14.370.zip
FOUNDRYBORNE_VERSION=2.10.2
FVTT="$REPO/.claude/skills/verify-foundry-importer/scripts/fvtt.sh"
DOWNLOAD="$REPO/scripts/foundry-download.py"
META="$REPO/scripts/foundry-run-meta.mjs"
SAMPLE_PDFS=(druid.pdf ex_ampleton.pdf luph.pdf raelyn.pdf)

refuse_root() {
  case "$ROOT" in
    */.*) echo "FOUNDRY_VERIFY_ROOT contains a dot-directory; Foundry will 404 its own files" >&2; exit 1 ;;
    "$REPO"|"$REPO"/*) echo "FOUNDRY_VERIFY_ROOT must stay outside the git checkout" >&2; exit 1 ;;
  esac
}

scrub() {
  [ -f "${1:-}" ] || return 0
  python3 "$DOWNLOAD" redact-file "$1"
}

# Exit 0 when at least one process was signalled. Matches a full --dataPath=$BASE argument,
# which is how the licence-signing server is started. The verify world uses a run directory.
reap_sign_servers() {
  [ -d "$ROOT" ] || return 1
  local status=1
  if python3 - "$BASE" <<'PY'
import os, signal, sys, time
base = sys.argv[1].encode()
marker = b"--dataPath=" + base
victims = []
for name in os.listdir("/proc"):
    if not name.isdigit():
        continue
    pid = int(name)
    if pid == os.getpid():
        continue
    try:
        raw = open(f"/proc/{pid}/cmdline", "rb").read()
    except OSError:
        continue
    if marker in raw.split(b"\0"):
        victims.append(pid)

def alive(pid):
    try:
        stat = open(f"/proc/{pid}/stat").read()
    except OSError:
        return False
    state = stat.rsplit(")", 1)[-1].split()[0]
    return state != "Z"

if not victims:
    sys.exit(1)
for pid in victims:
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        pass
deadline = time.time() + 5
while time.time() < deadline and any(alive(pid) for pid in victims):
    time.sleep(0.1)
for pid in victims:
    if alive(pid):
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
sys.exit(0)
PY
  then
    status=0
  fi
  scrub "$ROOT/sign.log" || true
  rm -f "$ROOT/sign.pid"
  return "$status"
}

stop_verify_runs() {
  local run stopped=1
  [ -d "$ROOT/runs" ] || return 1
  export FOUNDRY_VERIFY_ROOT="$ROOT"
  for run in "$ROOT/runs"/*; do
    [ -d "$run" ] || continue
    stopped=0
    scrub "$run/server.log" || true
    "$FVTT" stop "$run" || true
    scrub "$ROOT/evidence/$(basename "$run")/server.log" || true
  done
  rm -f "$ROOT/current.env"
  return "$stopped"
}

on_up_exit() {
  reap_sign_servers || true
}

read_current() {
  RUN=""; URL=""; EVIDENCE=""
  [ -f "$ROOT/current.env" ] || return 1
  RUN="$(sed -n 's/^RUN=//p' "$ROOT/current.env" | head -1)"
  URL="$(sed -n 's/^URL=//p' "$ROOT/current.env" | head -1)"
  EVIDENCE="$(sed -n 's/^EVIDENCE=//p' "$ROOT/current.env" | head -1)"
  [ -n "$RUN" ] && [ -n "$URL" ] && [ -n "$EVIDENCE" ]
}

healthy() {
  read_current || return 1
  local pid
  pid="$(cat "$RUN/server.pid" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  curl -sf --max-time 3 "$URL/api/status" | grep -q '"active":true'
}

print_current() {
  printf 'RUN=%s\nURL=%s\nEVIDENCE=%s\n' "$RUN" "$URL" "$EVIDENCE"
}

missing_secrets() {
  local missing=0
  if ! python3 "$DOWNLOAD" release-ok "$APP" "$FOUNDRY_VERSION"; then
    if ! python3 "$DOWNLOAD" cache-ok "$ROOT/cache/$FOUNDRY_ARCHIVE_NAME"; then
      echo "Run scripts/foundry-cache-fetch.sh with a timed URL. No foundryvtt.com account secret is used." >&2
      missing=1
    fi
  fi
  if ! node "$META" signed "$BASE/Config/license.json"; then
    [ -n "${FOUNDRY_LICENSE_KEY:-}" ] || { echo "Missing Runtime Secret FOUNDRY_LICENSE_KEY." >&2; missing=1; }
  fi
  if [ "$missing" -eq 1 ]; then
    echo "FOUNDRY_LICENSE_KEY is the only Foundry secret. See docs/review/cloud-foundry.md." >&2
    return 1
  fi
  return 0
}

acquire_lock() {
  mkdir -p "$ROOT"
  exec 9>"$ROOT/session.lock"
  if ! flock -w 600 9; then
    echo "Timed out waiting for the other foundry-verify-server.sh in this VM. One Foundry licence allows one server session. Run scripts/foundry-verify-server.sh down if that session is stuck." >&2
    exit 1
  fi
}

load_node() {
  # fvtt.sh sources nvm. If an nvm directory is already on PATH, nvm keeps that
  # slot instead of putting Node 24 first, and /exec-daemon/node (22) wins.
  # Strip nvm, then put the installed Node 24 at the front. nvm will prepend
  # its default (also 24.22.3) when fvtt.sh loads it.
  local cleaned="" part
  while IFS= read -r part; do
    case "$part" in
      "$HOME/.nvm"|"$HOME/.nvm"/*|"") continue ;;
    esac
    cleaned="${cleaned:+$cleaned:}$part"
  done < <(printf '%s' "$PATH" | tr ':' '\n')
  export PATH="/usr/local/bin:${cleaned}"
  hash -r
  /usr/local/bin/node -v | grep -qx "v24.22.3" || {
    echo "Node v24.22.3 is not installed at /usr/local/bin/node. Run scripts/cloud-agent-install.sh." >&2
    return 1
  }
}

stop_sign_server() {
  reap_sign_servers || true
}

start_hold_server() {
  # Test-only sleeper. Same pid file and --dataPath argument as the licence server,
  # so a killed `up` leaves a process `down` must reap. Not Foundry.
  python3 - "$BASE" "$ROOT/sign.pid" <<'PY'
import subprocess, sys
base, pidfile = sys.argv[1:]
proc = subprocess.Popen(
    [sys.executable, "-c", "import time; time.sleep(60)", f"--dataPath={base}"],
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    start_new_session=True,
)
with open(pidfile, "w") as handle:
    handle.write(str(proc.pid))
PY
}

sign_license() {
  if node "$META" signed "$BASE/Config/license.json"; then
    return 0
  fi
  local port
  port="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
  : > "$ROOT/sign.log"
  python3 - "$APP" "$BASE" "$port" "$ROOT/sign.log" "$ROOT/sign.pid" <<'PY'
import subprocess, sys
app, data, port, log, pidfile = sys.argv[1:]
with open(log, "w") as handle:
    proc = subprocess.Popen(
        ["node", "resources/app/main.js", f"--dataPath={data}", f"--port={port}", "--noupdate"],
        cwd=app,
        stdin=subprocess.DEVNULL,
        stdout=handle,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
with open(pidfile, "w") as handle:
    handle.write(str(proc.pid))
PY
  local ready=0
  for _ in $(seq 1 90); do
    if curl -sf -o /dev/null --max-time 3 "http://127.0.0.1:$port/"; then
      ready=1
      break
    fi
    kill -0 "$(cat "$ROOT/sign.pid")" 2>/dev/null || break
    sleep 1
  done
  if [ "$ready" -ne 1 ]; then
    scrub "$ROOT/sign.log"
    echo "Foundry did not open its licence page. See ${ROOT}/sign.log (secrets scrubbed)." >&2
    stop_sign_server
    return 1
  fi
  export CHROME_PATH="${CHROME_PATH:-/usr/bin/google-chrome}"
  if ! node "$REPO/scripts/foundry-sign-license.mjs" "http://127.0.0.1:$port/" "$BASE/Config/license.json" "$ROOT/admin-password"; then
    scrub "$ROOT/sign.log"
    stop_sign_server
    return 1
  fi
  stop_sign_server
  node "$META" signed "$BASE/Config/license.json"
}

ensure_samples() {
  local dir="${HOME}/Downloads" pdf missing=()
  mkdir -p "$dir"
  for pdf in "${SAMPLE_PDFS[@]}"; do
    [ -f "$dir/$pdf" ] || missing+=("$pdf")
  done
  if [ "${#missing[@]}" -gt 0 ] && [ -n "${DEMIPLANE_SAMPLES_URL:-}" ]; then
    if ! python3 "$DOWNLOAD" fetch-samples "$dir"; then
      echo "DEMIPLANE_SAMPLES_URL download failed. The URL was not printed." >&2
    fi
    missing=()
    for pdf in "${SAMPLE_PDFS[@]}"; do
      [ -f "$dir/$pdf" ] || missing+=("$pdf")
    done
  fi
  if [ "${#missing[@]}" -eq 0 ]; then
    echo "SAMPLES=ok"
  else
    echo "SAMPLES_MISSING=${missing[*]}"
  fi
}

launch_server() {
  local out code newest label
  set +e
  out="$("$FVTT" launch 2>"$ROOT/launch.err")"
  code=$?
  set -e
  scrub "$ROOT/launch.err"
  if [ -d "$ROOT/runs" ]; then
    while IFS= read -r log; do
      scrub "$log"
    done < <(find "$ROOT/runs" -name server.log -type f 2>/dev/null || true)
  fi
  if [ "$code" -ne 0 ]; then
    newest="$(find "$ROOT/runs" -name server.log -type f -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2- || true)"
    if [ -n "$newest" ] && label="$(node "$META" conflict < "$newest")"; then
      echo "Foundry did not stay active (${label}). One Foundry licence allows one server session at a time. Stop Foundry on any other machine using this licence, including NJ's computer and any other cloud agent, then run scripts/foundry-verify-server.sh up again." >&2
    else
      echo "Foundry did not become active." >&2
      cat "$ROOT/launch.err" >&2 || true
    fi
    return 1
  fi
  RUN="$(printf '%s\n' "$out" | sed -n 's/^RUN=//p' | head -1)"
  URL="$(printf '%s\n' "$out" | sed -n 's/^URL=//p' | head -1)"
  EVIDENCE="$(printf '%s\n' "$out" | sed -n 's/^EVIDENCE=//p' | head -1)"
  [ -n "$RUN" ] && [ -n "$URL" ] && [ -n "$EVIDENCE" ]
}

write_run_json() {
  if [ -f "$EVIDENCE/run.json" ]; then
    node "$META" write "$EVIDENCE" unused unused unused unused unused
    return
  fi
  local foundry system module sha id
  foundry="$(node "$META" release "$APP/resources/app/package.json")"
  system="$(node "$META" system "$BASE/Data/systems/daggerheart/system.json")"
  module="$(node "$META" module "$REPO/module.json")"
  sha="$(git -C "$REPO" rev-parse HEAD)"
  id="$(basename "$EVIDENCE")"
  node "$META" write "$EVIDENCE" "$id" "$foundry" "$system" "$module" "$sha"
}

cmd_up() {
  refuse_root
  if [ "${FOUNDRY_VERIFY_TEST_HOLD:-}" = 1 ]; then
    acquire_lock
    trap on_up_exit EXIT INT TERM
    start_hold_server
    while kill -0 "$(cat "$ROOT/sign.pid")" 2>/dev/null; do sleep 0.2; done
    exit 0
  fi
  # A stale licence server can exist only after a previous up created ROOT.
  # Checking secrets first when ROOT is absent keeps a missing-secret failure from creating it.
  if [ -d "$ROOT" ]; then
    acquire_lock
    trap on_up_exit EXIT INT TERM
    if reap_sign_servers; then
      echo "stopped a stale licence server" >&2
    fi
    if healthy; then
      print_current
      ensure_samples
      exit 0
    fi
    stop_verify_runs || true
  fi
  missing_secrets
  if [ ! -d "$ROOT" ]; then
    acquire_lock
    trap on_up_exit EXIT INT TERM
  fi
  export FOUNDRY_VERIFY_ROOT="$ROOT"
  export IMPORTER_REPO="$REPO"
  bash "$REPO/scripts/cloud-agent-install.sh"
  load_node
  umask 077
  mkdir -p "$ROOT/cache" "$BASE"
  if ! python3 "$DOWNLOAD" release-ok "$APP" "$FOUNDRY_VERSION"; then
    local zip="$ROOT/cache/$FOUNDRY_ARCHIVE_NAME"
    python3 "$DOWNLOAD" cache-ok "$zip"
    python3 "$DOWNLOAD" extract-foundry "$zip" "$APP" "$FOUNDRY_VERSION"
  fi
  python3 "$DOWNLOAD" extract-system "$ROOT/cache/foundryborne-${FOUNDRYBORNE_VERSION}.zip" \
    "$BASE/Data/systems/daggerheart" "$FOUNDRYBORNE_VERSION"
  sign_license
  (cd "$REPO" && pnpm build)
  launch_server
  write_run_json
  printf 'RUN=%s\nURL=%s\nEVIDENCE=%s\n' "$RUN" "$URL" "$EVIDENCE" > "$ROOT/current.env"
  print_current
  ensure_samples
}

cmd_down() {
  refuse_root
  local run="${1:-}" reaped=0
  if [ ! -d "$ROOT" ]; then
    echo "no verification server to stop"
    exit 0
  fi
  acquire_lock
  if reap_sign_servers; then
    reaped=1
  fi
  if [ -n "$run" ] && [ -d "$run" ]; then
    scrub "$run/server.log" || true
    export FOUNDRY_VERIFY_ROOT="$ROOT"
    "$FVTT" stop "$run" || true
    scrub "$ROOT/evidence/$(basename "$run")/server.log" || true
    if [ ! -f "$ROOT/current.env" ] || [ "$(sed -n 's/^RUN=//p' "$ROOT/current.env" | head -1)" = "$run" ]; then
      rm -f "$ROOT/current.env"
    fi
    echo "stopped"
    exit 0
  fi
  local stopped_world=1
  if [ -z "$run" ] && stop_verify_runs; then
    stopped_world=0
  fi
  if [ "$reaped" -eq 1 ]; then
    echo "stopped the licence server"
  elif [ "$stopped_world" -eq 0 ]; then
    echo "stopped"
  else
    rm -f "$ROOT/current.env"
    echo "no verification server to stop"
  fi
}

cmd_status() {
  refuse_root
  if healthy; then
    print_current
  else
    echo "stopped"
  fi
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down "${2:-}" ;;
  status) cmd_status ;;
  *)
    echo "usage: scripts/foundry-verify-server.sh up|down [RUN]|status" >&2
    exit 1
    ;;
esac
