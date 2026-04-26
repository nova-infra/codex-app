#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_HOME="/root/develop/my/codex-app"
RELEASES_DIR="$APP_HOME/releases"
CURRENT_LINK="$APP_HOME/current"
PKG_JSON="$ROOT_DIR/package.json"

VERSION="$(python3 - <<'PY'
import json, pathlib
p = pathlib.Path("/root/develop/my/codex-app/codex-app-main/packages/server/package.json")
print(json.loads(p.read_text())["version"])
PY
)"
STAMP="$(date +%Y%m%d-%H%M%S)"
RELEASE_NAME="${VERSION}-${STAMP}"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_NAME"

mkdir -p "$RELEASE_DIR"

"$HOME/.bun/bin/bun" build "$ROOT_DIR/packages/server/src/index.ts" \
  --compile \
  --outfile "$RELEASE_DIR/codex-app-server" >&2

chmod +x "$RELEASE_DIR/codex-app-server"

cat > "$RELEASE_DIR/release.json" <<EOF
{
  "version": "$VERSION",
  "release": "$RELEASE_NAME",
  "builtAt": "$(date -Iseconds)",
  "source": "$ROOT_DIR"
}
EOF

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

# Keep the latest 5 releases to avoid unbounded growth.
mapfile -t old_releases < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r)
for old in "${old_releases[@]:5}"; do
  rm -rf "$old"
done

echo "$RELEASE_NAME"
