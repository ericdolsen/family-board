# Family Board — Project Brief for Claude Code

<!-- How to use: make a new project folder, save this file in it (as-is, or as CLAUDE.md),
     run `claude` in that folder, and start with:
     "Read family-board-brief.md and let's start with Phase 1. Ask me anything that's unclear before scaffolding." -->

## What this is

A touch-friendly digital family board that replaces the kitchen whiteboard. It hangs on the wall (a TV with an infrared touch frame over it), runs 24/7, and shows: a family calendar, a to-do list, a grocery list, a "meals we have food to make" list, and a general notes area. Family members interact with it by touch; some sections sync with outside apps so items added by phone or voice show up on the board.

## Hardware & deployment target (already decided — design for this)

- **Raspberry Pi 5** running Raspberry Pi OS (Bookworm, 64-bit), mounted behind a wall-mounted TV. HDMI out to the TV.
- **IR touch frame** over the TV, connected to the Pi by USB. It presents as a standard multitouch HID device — from the app's perspective it's just normal browser touch events. Do not assume hover states exist.
- **The Pi is both server and display.** It serves the app (bound to LAN) and shows it in Chromium kiosk mode pointed at localhost. No cloud hosting; the board must keep working when the internet is down (sync features degrade gracefully, local features keep working).
- Landscape orientation, 1080p or 4K TV. Must be legible from across a kitchen and operable by kids.
- Phones/tablets on the home LAN should be able to open the same app in a responsive layout (grocery list on a phone at the store is handled by the synced apps below, not by exposing the board to the internet — keep it LAN-only).

## Stack preferences

- Keep it boring and durable: a single small backend (Node/Express or Python/FastAPI — your call) + **SQLite** for local state, and a lightweight frontend. Avoid heavy build tooling unless it earns its keep.
- Everything runs under **systemd** services and survives power loss: Pi boots straight into the dashboard with no keyboard/mouse attached.
- Config and secrets in a `.env`/config file, never hardcoded.

## Features

### 1. Calendar (the anchor of the board)
- Month view primary; week/agenda view a tap away. Color-coded per family member.
- **Google Calendar two-way sync** (multiple calendars — one per family member plus a shared one). Events added on the board appear in Google Calendar and on phones; phone-added events appear on the board within a minute or two.
- Touch-based event creation/editing: tap a day, big form, minimal typing.

### 2. To-do list
- Syncs two-way with **Todoist or Google Tasks** — evaluate both (API quality, free-tier limits, ease of OAuth vs token) and recommend one before building; I haven't committed to either.
- Board shows a shared family list; check off items by touch; done items clear on a schedule.

### 3. Grocery list
- The family adds items by voice ("Alexa, add milk to the shopping list") on Echo devices, by touch on the board, or by phone. One merged list.
- **Important — research before building:** Amazon shut down the official Alexa list-sync API for third parties in 2024, so current approaches are unofficial (cookie-based bridges, community libraries) and fragile. Investigate the current state, propose the most maintainable option, and design the board's own grocery list as the source of truth with the Alexa bridge as an optional add-on that can fail without breaking anything. If Alexa sync proves too brittle, a fallback worth proposing: move the family's voice list to a service with a real API and an Alexa skill, and sync with that.
- Checked-off items move to a "recently bought" section for easy re-adding.

### 4. Meals we have food to make
- Simple manual list, like the whiteboard: add/remove meal names by touch, mark one as "tonight," check off when cooked. No recipe or inventory integration for now — but structure the data so a recipe app could be attached later.

### 5. Notes
- Freeform section: sticky-note style typed notes, plus a finger-drawing canvas (it's replacing a whiteboard — being able to scrawl matters). Notes persist until deleted.

## Touch-kiosk UI requirements (these matter as much as features)

- Touch targets ≥ 48px; no interactions that depend on hover, right-click, or precise drag.
- **Build an on-screen keyboard into the app** (or integrate a Wayland OSK like squeekboard/wvkbd — your call after testing). Chromium on the Pi will NOT pop a keyboard on input focus by itself; typing must work with no physical keyboard, ever.
- Full-screen layout that shows all five sections at a glance (like the whiteboard) with tap-to-expand for any section.
- Day/night handling: bright during the day, dimmed at night on a schedule; optional idle mode (clock/photo screen) that any tap dismisses.
- Kid-proof: no way to end up outside the app; destructive actions (delete list, clear notes) need a confirm.
- Dark and light themes.

## Ops & install (deliverables, not afterthoughts)

- An install script + README for the Pi: dependencies, systemd units for the server, Chromium kiosk autostart (Wayland/labwc on Bookworm), disable screen blanking, hide cursor, and a watchdog that restarts/reloads the browser and server if either hangs.
- Walk me through the external setup interactively when we get there: Google Cloud project + OAuth credentials for the Calendar (and Tasks, if chosen) API, Todoist token if chosen, whatever the Alexa bridge needs.
- Nightly SQLite backup to a second location; update path = `git pull` + service restart.

## Build in phases — get it on the wall fast

1. **Phase 1 — board on the wall:** scaffold, layout with all five sections, local-only lists/meals/notes with touch + on-screen keyboard, read-only Google Calendar display, kiosk install script. (Fully usable whiteboard replacement.)
2. **Phase 2 — two-way sync:** Google Calendar write-back, to-do app sync, phone-responsive layout.
3. **Phase 3 — the fiddly bits:** Alexa grocery bridge (after researching current viability), night dimming, idle/photo mode, drawing canvas polish.

Ask clarifying questions before scaffolding, propose the stack and the to-do-app choice first, and treat Phase 1 as something I can physically mount within a weekend.
