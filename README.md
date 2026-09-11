# Family Board

A touch-first digital family board for a wall-mounted TV with an IR touch frame,
running on a Raspberry Pi 5 that is both the server and the display.

Five sections at a glance, like the whiteboard it replaces: **calendar,
to-dos, groceries, meals we can make, notes**. Tap any section title to blow it
up full screen. Everything is stored locally in SQLite, so the board keeps
working when the internet doesn't — only the sync features degrade.

**Phase 1 (this):** the whole board, local lists, on-screen keyboard, read-only
Google Calendar, kiosk install.
**Phase 2:** Google Calendar write-back, to-do app sync, phone layout polish.
**Phase 3:** Alexa grocery bridge, idle/photo mode, drawing polish.

---

## Quick start on a laptop (no Pi needed)

```bash
npm install
cp .env.example .env
cp config.example.json config.json
npm run dev
```

Open <http://localhost:8080>. The calendar panel will say it has nothing until
you link a Google account; everything else works immediately.

Force the on-screen keyboard on or off with `?osk=1` / `?osk=0` — handy for
seeing what the board will feel like from a desktop browser.

---

## Install on the Pi

Raspberry Pi OS Bookworm 64-bit, desktop image, auto-login to the desktop
session enabled (`raspi-config` → System Options → Boot / Auto Login → Desktop
Autologin).

```bash
git clone <your-repo-url> ~/family-board
cd ~/family-board
./scripts/install.sh
```

The installer is idempotent — re-run it after any `git pull`. It:

- installs Node 24, build tools and Chromium
- `npm ci` and creates `.env` / `config.json` from the examples if missing
- installs and starts the systemd units (server, nightly backup, watchdog)
- registers `scripts/kiosk.sh` in the labwc (or wayfire) session autostart
- appends `consoleblank=0` to the kernel cmdline

Then:

1. Edit `config.json` — family members, colours, calendar ids.
2. Put your Google OAuth client id/secret in `.env`.
3. `npm run google-auth` (see below).
4. `sudo reboot` — the Pi comes up straight into the board.

### Updating

```bash
cd ~/family-board && git pull && npm ci --omit=dev && sudo systemctl restart familyboard
```

The browser picks up the new frontend on its next reload; `sudo systemctl restart
familyboard` plus a tap on the board is enough, or just reboot.

---

## Alternative display: a BrightSign-based panel

The reference build drives a TV from the Pi's HDMI port. If the display is a
commercial panel with a **built-in BrightSign player** (e.g. a Bluefin
"BrightSign Built-In" with an XT1144-PP), its touch glass is wired to the
BrightSign, not to any external port — so the BrightSign has to be the browser.
The Pi still runs everything; the panel just loads it over the LAN.

- Give the Pi a **DHCP reservation**. The panel's presentation hard-codes the URL.
- In BrightAuthor:connected, make a presentation with one full-screen **HTML5**
  item pointing at `http://<pi-ip>:8080/?kiosk=1`, with mouse/touch events
  enabled. Publish it to the player (BSN.cloud trial or Local Network mode).
- Series 4 players (XT1144) run **Chromium 87**; the frontend is written to
  stay within that.
- Once published, the panel never needs republishing: every update comes from
  the Pi. A lapsed cloud subscription only removes the ability to push a *new*
  presentation; the existing one keeps playing from the SD card.
- The Pi's own kiosk session is then unused. It's harmless, but can be turned
  off by removing the `family-board kiosk` lines from
  `~/.config/labwc/autostart` on the Pi.

## Google Calendar setup

You need an OAuth client. Twenty minutes of clicking, once.

1. <https://console.cloud.google.com> → create a project (e.g. "Family Board").
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **Google Auth Platform** (older consoles call it *OAuth consent screen*) →
   configure: External, an app name, your email. Add the Calendar scope if it
   asks.
4. **Publish the app to "In production".** Do not leave it in Testing: Google
   expires refresh tokens after 7 days in Testing, and the board would silently
   lose its calendar every week. Production without verification just means
   Google shows an "unverified app" warning during the one-time link, which you
   click through (*Advanced → Go to Family Board*).
5. **Clients → Create client → Desktop app**.
6. Copy the client id and secret into `.env`.

Then link the account:

```bash
npm run google-auth
```

It prints a URL. On the Pi with no browser, forward the port from your laptop
first and run the command inside that SSH session:

```bash
ssh -L 5858:localhost:5858 pi@familyboard.local
```

After you approve, the script prints every calendar the account can see, with
its id — paste the ones you want into `config.json`:

```json
"calendars": [
  { "id": "family12345@group.calendar.google.com", "label": "Family", "member": "family", "enabled": true },
  { "id": "eric@example.com", "label": "Eric", "member": "dad", "enabled": true }
]
```

The `member` field is what gives each calendar its colour — it points at an `id`
in the `members` array.

### Use a dedicated Google account for the board

Strongly recommended. Make a new Google account, add it to the family group,
share the family calendar with it, and link *that* account. The Pi then only
ever holds a throwaway account's credentials, which matters for a machine
mounted on a kitchen wall. It also means Phase 2's write-back and any future
list bridges have a single, revocable identity.

Phase 1 asks only for `calendar.readonly`. Phase 2 switches `GOOGLE_SCOPES` in
`.env` to `https://www.googleapis.com/auth/calendar.events` and re-runs
`npm run google-auth`.

---

## Configuration

`.env` holds secrets and machine settings (port, paths, OAuth credentials).
`config.json` holds everything the family might want to change — it is re-read
whenever it changes, so editing it does **not** need a restart.

| Key | What it does |
| --- | --- |
| `members` | Names and colours. Calendars and to-dos reference these by `id`. |
| `calendars` | Google calendar ids to display, each mapped to a member colour. |
| `display.autoTheme` | Switch light/dark on the day/night schedule. |
| `display.nightDimPercent` | How far to dim after `nightStartsAt` (a black overlay — works on any TV over HDMI, where backlight control usually doesn't). |
| `display.nightlyReloadAt` | When the kiosk tab reloads itself each night (`"04:00"`). Empty string disables it. Phones are never reloaded. |
| `behavior.clearDoneTodosAfterHours` | How long checked-off to-dos linger before housekeeping removes them. |
| `behavior.clearBoughtGroceriesAfterHours` | Same for the "recently bought" shelf. |
| `behavior.onScreenKeyboardMinWidth` | Below this width the native keyboard is used instead (phones and tablets). |

---

## How it fits together

```
Chromium kiosk ──HTTP+SSE──> Express (systemd: familyboard)
   (localhost)                   │
                                 ├── SQLite (WAL) ── data/board.db
                                 └── job loop ── Google Calendar API (poll, 60s)

phones on the LAN ──────────────┘   (same app, responsive layout)
```

- **No build step.** The frontend is plain ES modules; `git pull` and restart is
  the whole update path. Nothing to compile on a Pi at 11pm.
- **SSE, not WebSockets.** One-way server→client updates are all a board needs,
  and `EventSource` reconnects by itself.
- **Writes land locally first.** Every mutation hits SQLite and returns before
  any external service is contacted, so the board is never blocked on the
  network. `sync_queue` exists in the schema now so Phase 2's write-back is a
  drop-in, not a migration.
- **The calendar is a cache.** `calendar_events` can be deleted at any time; it
  refills on the next poll. Reads never touch the network.

### Watchdogs

| What can hang | What catches it |
| --- | --- |
| Server process | `familyboard.service` `Restart=always` |
| Server alive but wedged | `familyboard-watchdog.timer` → three failed `/api/healthz` probes → restart |
| Chromium exits | the relaunch loop in `scripts/kiosk.sh` |
| Page wedged / stale | the page reloads itself after 5 minutes with no event stream |
| Slow leaks in a months-old tab | the kiosk reloads itself nightly at `display.nightlyReloadAt` |
| Power loss | SQLite WAL + `Persistent=true` on the backup timer |

### Backups

`familyboard-backup.timer` runs nightly at 03:15 and uses SQLite's online backup
API, so it never interrupts the board. Fourteen days are kept in `backups/`.
For the second location, uncomment `BACKUP_MIRROR` in
`systemd/familyboard-backup.service` (a USB stick, an SMB mount, anything) and
re-run the installer. A missing mirror logs a warning and never fails the job.

To restore: stop the service, copy a `board-YYYY-MM-DD.db` over `data/board.db`,
delete any `-wal`/`-shm` files beside it, start the service.

---

## Security model

**The board has no authentication and no TLS. It must stay on the LAN.**

Anyone who can reach the port can read and change the lists — which is the
point, for a household. Do not port-forward it, do not put it on a public
hostname, and if you want it reachable from outside the house, use a VPN into
the LAN rather than exposing the app. `HOST=127.0.0.1` in `.env` restricts it to
the Pi itself if you decide phones shouldn't have it.

The Google refresh token lives in `data/google-token.json` with `0600`
permissions and never leaves the Pi. Use a dedicated Google account for the
board (see above).

---

## Not done yet / known rough edges

- **The kiosk and Wayland bits are untested on real hardware.** The install
  script covers both labwc and wayfire because Bookworm images ship either one;
  which path fires, and whether screen blanking is fully suppressed on your
  image, needs one pass on the actual Pi.
- Calendar is **read-only**. Tapping a day shows what's on it; creating events
  is Phase 2.
- To-do and grocery sync are not wired to anything yet — the board's own lists
  are the source of truth, which is deliberate: every external bridge is an
  optional add-on that must be able to fail without breaking the board.
- No drag-to-reorder anywhere (the `position` column is there for it). Dragging
  on an IR frame is unreliable, so reordering will need a different gesture.
- The drawing canvas is basic: one pen width, one colour, an eraser.
