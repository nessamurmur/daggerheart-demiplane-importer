#!/usr/bin/env bash
# Idempotent cloud-agent install: Node 24, pnpm, repo deps, Chrome, and the
# public Foundryborne 2.10.2 zip. Does not download Foundry VTT and does not
# start a server. The verify skill is optional: this script is valid on main,
# where that skill is not present yet.
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
# Playwright for the verify skill. That skill is not on main until its PR merges.
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

echo "cloud-agent install ok (node $(/usr/local/bin/node -v), pnpm $(pnpm -v), Foundryborne ${FOUNDRYBORNE_VERSION} cached)"
