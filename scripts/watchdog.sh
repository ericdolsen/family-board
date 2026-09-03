#!/usr/bin/env bash
# Runs every minute from familyboard-watchdog.timer.
#
# Only restarts the server when the health endpoint is genuinely unreachable —
# a single dropped request on a busy Pi is not a reason to bounce the service,
# so it retries before acting. The browser side heals itself: the page reloads
# when it has been disconnected from the event stream for too long (see
# public/js/app.js), and scripts/kiosk.sh relaunches Chromium if it exits.

set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="$(grep -E '^PORT=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2 || true)"
PORT="${PORT:-8080}"
HEALTH="http://localhost:${PORT}/api/healthz"

for attempt in 1 2 3; do
  if curl -fsS --max-time 5 "$HEALTH" >/dev/null 2>&1; then
    exit 0
  fi
  echo "watchdog: health check failed (attempt ${attempt}/3)"
  sleep 5
done

echo "watchdog: server unhealthy, restarting familyboard.service"
systemctl restart familyboard.service
