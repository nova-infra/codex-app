#!/usr/bin/env bash
set -euo pipefail

GRAPHIFY_HOME="${GRAPHIFY_HOME:-$HOME/.local/share/codex-app/graphify}"
GRAPHIFY_PYTHON="$GRAPHIFY_HOME/bin/python"
GRAPHIFY_BIN="$GRAPHIFY_HOME/bin/graphify"

if [ ! -x "$GRAPHIFY_BIN" ]; then
  python3 -m venv "$GRAPHIFY_HOME"
  "$GRAPHIFY_PYTHON" -m pip install --upgrade pip
  "$GRAPHIFY_PYTHON" -m pip install graphifyy
fi

exec "$GRAPHIFY_BIN" "$@"
