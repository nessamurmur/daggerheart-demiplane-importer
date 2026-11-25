#!/usr/bin/env bash
# Idempotent cloud-agent install: Node 24, pnpm, repo deps, Chrome, the
# public Foundryborne 2.10.2 zip, and, when FOUNDRY_R2_TOKEN is set, the
# Foundry Node zip. Does not start a server. The verify skill is on main;
# the harness install below runs when its package-lock is in this checkout.
# `bash scripts/cloud-agent-install.sh --foundry-cache` runs only the Node zip step.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

NODE_VERSION=24.22.3
NODE_HOME=""
NODE_SHA256=4f2b175a6d53a5c617a80dba2676238a0688cef28c6da4eba35c7d844e66fcfb
PNPM_VERSION=11.19.0
FOUNDRYBORNE_VERSION=2.10.2
FOUNDRYBORNE_URL="https://github.com/Foundryborne/daggerheart/releases/download/${FOUNDRYBORNE_VERSION}/system.zip"
ROOT="${FOUNDRY_VERIFY_ROOT:-$HOME/foundry-verify}"
case "$ROOT" in
  */.*) echo "FOUNDRY_VERIFY_ROOT contains a dot-directory; Foundry will 404 its own files" >&2; exit 1 ;;
  "$REPO"|"$REPO"/*) echo "FOUNDRY_VERIFY_ROOT must stay outside the git checkout" >&2; exit 1 ;;
esac

# Same object #21's timed URL stores at $ROOT/cache/FoundryVTT-Node-14.370.zip.
FOUNDRY_R2_ACCOUNT_ID="${FOUNDRY_R2_ACCOUNT_ID:-fc29815e85508db8c14ed124b0511b81}"
FOUNDRY_R2_BUCKET="${FOUNDRY_R2_BUCKET:-foundry-cache}"
# Region is auto, via curl --aws-sigv4 "aws:amz:auto:s3".
FOUNDRY_R2_ENDPOINT="${FOUNDRY_R2_ENDPOINT:-https://${FOUNDRY_R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"
FOUNDRY_R2_KEY="${FOUNDRY_R2_KEY:-FoundryVTT-Node-14.370.zip}"
FOUNDRY_NODE_ARCHIVE_BYTES="${FOUNDRY_NODE_ARCHIVE_BYTES:-150182237}"
FOUNDRY_NODE_ARCHIVE_SHA256="${FOUNDRY_NODE_ARCHIVE_SHA256:-e891a46b2878745b38dd8c28e843d763f83e69aa14bdbd3156edd8dafaabe846}"

archive_matches() {
  python3 - "$1" "$FOUNDRY_NODE_ARCHIVE_BYTES" "$FOUNDRY_NODE_ARCHIVE_SHA256" <<'PY'
import hashlib, os, sys
path, expected_size, expected_sha = sys.argv[1:]
if not os.path.isfile(path) or os.path.getsize(path) != int(expected_size):
    sys.exit(1)
digest = hashlib.sha256()
with open(path, "rb") as handle:
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        digest.update(chunk)
sys.exit(0 if digest.hexdigest() == expected_sha else 1)
PY
}

# curl -fsS --retry 3 --aws-sigv4 "aws:amz:auto:s3" --user "$FOUNDRY_R2_TOKEN"
# The token stays in the environment and a mode-600 config file, not on argv.
cache_foundry_node_zip() {
  mkdir -p "$ROOT/cache"
  local dest="$ROOT/cache/$(basename "$FOUNDRY_R2_KEY")"
  if archive_matches "$dest"; then
    echo "Foundry archive already cached ($(basename "$dest"))"
    return 0
  fi
  # Do not expand the token in the shell: bash -x would print it.
  if ! python3 -c 'import os,sys; sys.exit(0 if os.environ.get("FOUNDRY_R2_TOKEN") else 1)'; then
    echo "FOUNDRY_R2_TOKEN is not set; skipping Foundry archive download"
    return 0
  fi
  local partial cfg url status tracing=0
  partial="$(mktemp "$ROOT/cache/foundry-r2.XXXXXX")"
  cfg="$(mktemp)"
  chmod 600 "$partial" "$cfg"
  url="${FOUNDRY_R2_ENDPOINT%/}/${FOUNDRY_R2_BUCKET}/${FOUNDRY_R2_KEY}"
  case $- in *x*) tracing=1 ;; esac
  set +x
  python3 - "$cfg" "$url" "$partial" <<'PY'
import os, sys
cfg, url, dest = sys.argv[1:]
token = os.environ.get("FOUNDRY_R2_TOKEN", "")
if not token or "\n" in token or "\r" in token:
    sys.stderr.write("FOUNDRY_R2_TOKEN is missing or not a single line.\n")
    sys.exit(1)
def quote(value):
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
with open(cfg, "w", encoding="utf-8") as handle:
    handle.write("\n".join([
        "fail",
        "silent",
        "show-error",
        "retry = 3",
        'aws-sigv4 = "aws:amz:auto:s3"',
        f"user = {quote(token)}",
        f"url = {quote(url)}",
        f"output = {quote(dest)}",
        "",
    ]))
PY
  if [ "$tracing" -eq 1 ]; then set -x; fi
  status=0
  curl --config "$cfg" || status=$?
  rm -f "$cfg"
  if [ "$status" -ne 0 ]; then
    rm -f "$partial"
    echo "Foundry archive download failed." >&2
    return 1
  fi
  if ! archive_matches "$partial"; then
    rm -f "$partial"
    echo "Foundry archive hash does not match; deleted the download." >&2
    return 1
  fi
  mv "$partial" "$dest"
  chmod 600 "$dest"
  echo "cached $(basename "$dest")"
}

if [ "${1:-}" = "--foundry-cache" ]; then
  cache_foundry_node_zip
  exit 0
fi

fetch_node_tarball() {
  local tar="/tmp/node-v${NODE_VERSION}-linux-x64.tar.xz"
  if [ ! -f "$tar" ] || ! echo "${NODE_SHA256}  ${tar}" | sha256sum -c - >/dev/null 2>&1; then
    echo "downloading Node ${NODE_VERSION}" >&2
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o "$tar"
  fi
  echo "${NODE_SHA256}  ${tar}" | sha256sum -c - >&2
  printf '%s\n' "$tar"
}

install_node() {
  local bin tar
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # fvtt.sh sources nvm and would otherwise keep whatever default it already has.
    # Install the tarball from nodejs.org. nvm's own installer also queries iojs.org, which can hang.
    NODE_HOME="$HOME/.nvm/versions/node/v${NODE_VERSION}"
    bin="$NODE_HOME/bin"
    if [ ! -x "$bin/node" ]; then
      tar="$(fetch_node_tarball)"
      mkdir -p "$HOME/.nvm/versions/node"
      rm -rf "/tmp/node-v${NODE_VERSION}-linux-x64" "$HOME/.nvm/versions/node/v${NODE_VERSION}"
      tar -xJf "$tar" -C /tmp
      mv "/tmp/node-v${NODE_VERSION}-linux-x64" "$HOME/.nvm/versions/node/v${NODE_VERSION}"
    fi
    mkdir -p "$HOME/.nvm/alias"
    printf '%s\n' "$NODE_VERSION" > "$HOME/.nvm/alias/default"
  elif /usr/local/bin/node -v 2>/dev/null | grep -qx "v${NODE_VERSION}"; then
    return 0
  else
    tar="$(fetch_node_tarball)"
    sudo tar -xJf "$tar" -C /usr/local --strip-components=1 --no-same-owner
    return 0
  fi
  sudo -n ln -sfn "$bin/node" /usr/local/bin/node
  sudo -n ln -sfn "$bin/npm" /usr/local/bin/npm
  sudo -n ln -sfn "$bin/npx" /usr/local/bin/npx
  if [ -e "$bin/corepack" ]; then
    sudo -n ln -sfn "$bin/corepack" /usr/local/bin/corepack
  fi
}

install_node
export PATH="/usr/local/bin:$PATH"
hash -r

PNPM_PREFIX="${NODE_HOME:-/usr/local}"
if [ ! -x "$PNPM_PREFIX/bin/pnpm" ] || [ "$("$PNPM_PREFIX/bin/pnpm" -v 2>/dev/null || true)" != "$PNPM_VERSION" ]; then
  # CI installs this exact version with npm. corepack's shim can stay on an older pnpm.
  sudo -n "$PNPM_PREFIX/bin/npm" install --global "pnpm@${PNPM_VERSION}"
fi
if [ "$(readlink -f /usr/local/bin/pnpm 2>/dev/null || true)" != "$(readlink -f "$PNPM_PREFIX/bin/pnpm")" ]; then
  sudo -n ln -sfn "$PNPM_PREFIX/bin/pnpm" /usr/local/bin/pnpm
fi
hash -r

# pnpm 11 refuses to replace a modules directory installed by an older pnpm unless this is set.
CI=true pnpm install --frozen-lockfile
# Playwright for the verify skill, when this checkout contains it.
harness=".claude/skills/verify-foundry-importer/scripts"
if [ -f "$harness/package-lock.json" ]; then
  npm ci --prefix "$harness"
else
  echo "verify skill not in this checkout; skipping harness install"
fi

if [ ! -x /usr/bin/google-chrome ]; then
  curl -fsSL -o /tmp/google-chrome-stable.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  sudo apt-get update
  sudo apt-get install -y /tmp/google-chrome-stable.deb
  rm -f /tmp/google-chrome-stable.deb
fi

mkdir -p "$ROOT/cache"
zip="$ROOT/cache/foundryborne-${FOUNDRYBORNE_VERSION}.zip"
# Inlined so this checkout does not depend on a later pull request.
system_ok() {
  python3 - "$1" "$2" <<'PY'
import json, sys, zipfile
path, version = sys.argv[1:]
try:
    archive = zipfile.ZipFile(path)
    name = next(
        info.filename
        for info in archive.infolist()
        if info.filename.replace("\\", "/").rstrip("/").endswith("system.json")
        and ".." not in info.filename.replace("\\", "/").split("/")
    )
    meta = json.loads(archive.read(name))
except Exception:
    sys.exit(1)
sys.exit(0 if meta.get("id") == "daggerheart" and meta.get("version") == version else 1)
PY
}
if ! system_ok "$zip" "$FOUNDRYBORNE_VERSION"; then
  echo "downloading Foundryborne ${FOUNDRYBORNE_VERSION}"
  curl -fsSL -o "${zip}.partial" "$FOUNDRYBORNE_URL"
  mv "${zip}.partial" "$zip"
  system_ok "$zip" "$FOUNDRYBORNE_VERSION" \
    || { echo "Foundryborne zip is not daggerheart ${FOUNDRYBORNE_VERSION}" >&2; exit 1; }
fi

cache_foundry_node_zip

echo "cloud-agent install ok (node $(/usr/local/bin/node -v), pnpm $(pnpm -v), Foundryborne ${FOUNDRYBORNE_VERSION} cached)"
