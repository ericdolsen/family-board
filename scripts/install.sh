#!/usr/bin/env bash
# Family Board installer for Raspberry Pi OS Bookworm (64-bit).
#
#   git clone <your repo> ~/family-board
#   cd ~/family-board && ./scripts/install.sh
#
# Idempotent: safe to re-run after a git pull.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${SUDO_USER:-$USER}"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run this as your normal user (it will call sudo when it needs to)." >&2
  exit 1
fi

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------- dependencies

say "Installing system packages"
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  ca-certificates curl git build-essential python3 sqlite3 chromium-browser

if ! command -v node >/dev/null || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]]; then
  say "Installing Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

say "Node $(node -v), npm $(npm -v)"

# ---------------------------------------------------------------- application

say "Installing app dependencies"
cd "$APP_DIR"
if [[ -f package-lock.json ]]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

mkdir -p "$APP_DIR/data" "$APP_DIR/backups"

if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo "Created .env — fill in your Google OAuth client id/secret before linking the calendar."
fi

if [[ ! -f "$APP_DIR/config.json" ]]; then
  cp "$APP_DIR/config.example.json" "$APP_DIR/config.json"
  echo "Created config.json — edit family members, colours and calendar ids."
fi

# ---------------------------------------------------------------- systemd

say "Installing systemd units"
render() {
  sed -e "s|@APP_DIR@|$APP_DIR|g" \
      -e "s|@APP_USER@|$APP_USER|g" \
      "$APP_DIR/systemd/$1" | sudo tee "/etc/systemd/system/$1" >/dev/null
}

render familyboard.service
render familyboard-backup.service
render familyboard-backup.timer
render familyboard-watchdog.service
render familyboard-watchdog.timer

sudo systemctl daemon-reload
sudo systemctl enable --now familyboard.service
sudo systemctl enable --now familyboard-backup.timer
sudo systemctl enable --now familyboard-watchdog.timer

# ---------------------------------------------------------------- kiosk

say "Configuring the kiosk session"
chmod +x "$APP_DIR/scripts/kiosk.sh" "$APP_DIR/scripts/watchdog.sh"

# Pi OS Bookworm runs labwc (newer images) or wayfire (older ones) as the
# Wayland session. Register the kiosk in whichever is present.
if [[ -d "$APP_HOME/.config/labwc" ]] || command -v labwc >/dev/null; then
  mkdir -p "$APP_HOME/.config/labwc"
  AUTOSTART="$APP_HOME/.config/labwc/autostart"
  touch "$AUTOSTART"
  if ! grep -q 'family-board kiosk' "$AUTOSTART"; then
    {
      echo "# family-board kiosk"
      echo "$APP_DIR/scripts/kiosk.sh &"
    } >> "$AUTOSTART"
  fi
  echo "labwc autostart updated: $AUTOSTART"
elif [[ -f "$APP_HOME/.config/wayfire.ini" ]]; then
  if ! grep -q 'family-board' "$APP_HOME/.config/wayfire.ini"; then
    printf '\n[autostart]\nfamilyboard = %s/scripts/kiosk.sh\nscreensaver = false\ndpms = false\n' \
      "$APP_DIR" >> "$APP_HOME/.config/wayfire.ini"
  fi
  echo "wayfire.ini updated"
else
  echo "! No labwc or wayfire config found. Add scripts/kiosk.sh to your session autostart by hand."
fi

# Stop the text console blanking behind the browser.
if ! grep -q 'consoleblank=0' /boot/firmware/cmdline.txt 2>/dev/null; then
  sudo sed -i '1 s|$| consoleblank=0|' /boot/firmware/cmdline.txt || \
    echo "! Could not edit /boot/firmware/cmdline.txt — add consoleblank=0 yourself."
fi

# ---------------------------------------------------------------- done

IP="$(hostname -I | awk '{print $1}')"
PORT="$(grep -E '^PORT=' "$APP_DIR/.env" | cut -d= -f2 || echo 8080)"

say "Installed"
cat <<EOF

  Board:      http://localhost:${PORT}
  On phones:  http://${IP}:${PORT}

  Next:
    1. Edit ${APP_DIR}/config.json  (family members, colours, calendar ids)
    2. Put your Google OAuth client id/secret in ${APP_DIR}/.env
    3. Link the calendar:  cd ${APP_DIR} && npm run google-auth
    4. Reboot to start the kiosk:  sudo reboot

  Logs:
    journalctl -u familyboard -f
    journalctl -u familyboard-watchdog -f

EOF
