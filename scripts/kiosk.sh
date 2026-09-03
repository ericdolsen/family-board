#!/usr/bin/env bash
# Launches Chromium in kiosk mode and keeps it alive.
#
# Started from the Wayland session autostart (labwc/wayfire), not from systemd:
# the browser needs the session's WAYLAND_DISPLAY and XDG_RUNTIME_DIR, which a
# system service does not have.

set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="$(grep -E '^PORT=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2 || true)"
PORT="${PORT:-8080}"
URL="http://localhost:${PORT}/?kiosk=1"
PROFILE="$HOME/.config/family-board-kiosk"

BROWSER="$(command -v chromium-browser || command -v chromium || true)"
if [[ -z "$BROWSER" ]]; then
  echo "kiosk: chromium not found" >&2
  exit 1
fi

# Wait for the server to answer before opening the browser, so a cold boot
# doesn't land on an error page.
for _ in $(seq 1 60); do
  curl -fsS "http://localhost:${PORT}/api/healthz" >/dev/null 2>&1 && break
  sleep 1
done

while true; do
  # Chromium nags about an unclean exit after a power cut; clear the flags so it
  # comes straight back to the board.
  if [[ -f "$PROFILE/Default/Preferences" ]]; then
    sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' \
      "$PROFILE/Default/Preferences" 2>/dev/null || true
  fi

  "$BROWSER" \
    --kiosk \
    --app="$URL" \
    --user-data-dir="$PROFILE" \
    --ozone-platform=wayland \
    --enable-features=OverlayScrollbar,TouchpadOverscrollHistoryNavigation \
    --disable-features=Translate,TranslateUI,MediaRouter \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    --no-first-run \
    --fast \
    --fast-start \
    --password-store=basic \
    --check-for-update-interval=31536000 \
    --autoplay-policy=no-user-gesture-required

  echo "kiosk: chromium exited, restarting in 3s" >&2
  sleep 3
done
