#!/usr/bin/env bash
# Download one Foundry timed release URL into the verify cache and check its sha256.
# Usage: scripts/foundry-cache-fetch.sh <timed-url>
# The URL is valid for about five minutes. This script never prints its query string.
set +x
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${FOUNDRY_VERIFY_ROOT:-$HOME/foundry-verify}"
DEST="$ROOT/cache/FoundryVTT-Node-14.370.zip"
url="${1:-}"

if [ -z "$url" ] || [ "$url" = "-h" ] || [ "$url" = "--help" ]; then
  echo "usage: scripts/foundry-cache-fetch.sh <https timed url>" >&2
  exit 1
fi
case "$url" in
  https://*) ;;
  *) echo "timed URL must be https. The URL was not printed." >&2; exit 1 ;;
esac

mkdir -p "$ROOT/cache"
partial="$(mktemp "$ROOT/cache/foundry-download.XXXXXX")"
err="$(mktemp)"
cleanup() { rm -f "$partial" "$err"; }
trap cleanup EXIT

if ! curl --fail --location --silent --show-error --max-time 300 --output "$partial" -- "$url" 2>"$err"; then
  echo "Foundry archive download failed. The URL was not printed." >&2
  exit 1
fi

python3 "$REPO/scripts/foundry-download.py" cache-ok "$partial"
mv "$partial" "$DEST"
chmod 600 "$DEST"
echo "cached FoundryVTT-Node-14.370.zip"
