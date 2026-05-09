#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_HOME="${CODEX_APP_HOME:-/root/develop/my/codex-app}"
RELEASES_DIR="$APP_HOME/releases"
CURRENT_LINK="$APP_HOME/current"
VERSION="$(tr -d '[:space:]' < "$ROOT_DIR/VERSION")"
STAMP="$(date +%Y%m%d-%H%M%S)"
RELEASE_NAME="${VERSION}-${STAMP}"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_NAME"
GIT_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true)"

mkdir -p "$RELEASE_DIR"

go build \
  -ldflags "-X github.com/nova-infra/codex-app/internal/build.Version=$VERSION -X github.com/nova-infra/codex-app/internal/build.GitSHA=$GIT_SHA" \
  -o "$RELEASE_DIR/codex-app-server" \
  "$ROOT_DIR/cmd/codex-app"

chmod +x "$RELEASE_DIR/codex-app-server"

cat > "$RELEASE_DIR/release.json" <<JSON
{
  "version": "$VERSION",
  "gitSha": "$GIT_SHA",
  "release": "$RELEASE_NAME",
  "builtAt": "$(date -Iseconds)",
  "source": "$ROOT_DIR"
}
JSON

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

mapfile -t old_releases < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r)
for old in "${old_releases[@]:5}"; do
  rm -rf "$old"
done

echo "$RELEASE_NAME"
