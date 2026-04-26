#!/usr/bin/env bash
set -euo pipefail

APP_HOME="/root/develop/my/codex-app"
SERVICE="codex-app.service"

release_name="$("$APP_HOME/codex-app-main/scripts/release.sh")"

systemctl daemon-reload
systemctl restart "$SERVICE"
sleep 2
systemctl --no-pager --full status "$SERVICE" | sed -n '1,120p'
echo
echo "deployed: $release_name"
