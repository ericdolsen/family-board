import { api } from './api.js';
import { startStream, onChannel } from './sse.js';
import { initKeyboard } from './keyboard.js';
import { openSheet, toast, escapeHtml } from './ui.js';
import { calendarPanel } from './panels/calendar.js';
import { todosPanel } from './panels/todos.js';
import { groceryPanel } from './panels/grocery.js';
import { mealsPanel } from './panels/meals.js';
import { notesPanel } from './panels/notes.js';

const PANELS = [calendarPanel, todosPanel, groceryPanel, mealsPanel, notesPanel];

// Every place a panel is currently rendered: its board tile, and its expanded
// sheet if one is open. SSE updates repaint all of them.
const mounted = new Map(); // panelId -> Set<HTMLElement>

let config = null;
let manualTheme = null;

const ctx = {
  get config() {
    return config;
  },
  memberById(id) {
    return config.members.find((m) => m.id === id) || null;
  },
  // A calendar is coloured by its member, or by its own `color` when it
  // belongs to nobody (holidays, school, the trash schedule).
  calendarColor(calendarId) {
    const cal = config.calendars.find((c) => c.id === calendarId);
    if (cal?.color) return cal.color;
    const member = cal && config.members.find((m) => m.id === cal.member);
    return member?.color || 'var(--accent)';
  },
  refreshPanel,
};

async function refreshPanel(id) {
  const panel = PANELS.find((p) => p.id === id);
  const targets = mounted.get(id);
  if (!panel || !targets?.size) return;
  for (const el of targets) {
    try {
      await panel.refresh(el, ctx);
    } catch (err) {
      el.innerHTML = `<p class="empty">Couldn't load. ${escapeHtml(err.message)}</p>`;
    }
  }
}

function track(id, el) {
  if (!mounted.has(id)) mounted.set(id, new Set());
  mounted.get(id).add(el);
}

function untrack(id, el) {
  mounted.get(id)?.delete(el);
}

function buildTile(panel) {
  const section = document.createElement('section');
  section.className = 'panel';
  section.dataset.area = panel.id;
  section.innerHTML = `
    <header class="panel-head">
      <button type="button" class="panel-title" data-expand>${escapeHtml(panel.title)}</button>
      <div class="panel-tools">
        ${panel.addLabel ? '<button type="button" class="btn btn-add" data-add aria-label="Add">＋</button>' : ''}
        <button type="button" class="btn btn-icon" data-expand aria-label="Expand">⤢</button>
      </div>
    </header>
    <div class="panel-body"></div>`;

  const body = section.querySelector('.panel-body');
  track(panel.id, body);
  panel.bind?.(body, ctx);

  section.querySelector('[data-add]')?.addEventListener('click', () => panel.add?.(ctx));
  section.querySelectorAll('[data-expand]').forEach((btn) =>
    btn.addEventListener('click', () => expand(panel))
  );

  return { section, body };
}

/** Tap-to-expand: same panel, full screen, plus its destructive menu actions. */
function expand(panel) {
  const body = document.createElement('div');
  body.className = 'panel-body panel-body--big';

  const actions = [
    ...(panel.menu || []).map((item) => ({
      label: item.label,
      className: item.className || 'btn-quiet',
      onClick: async () => {
        await item.onClick(ctx);
      },
    })),
    ...(panel.addLabel
      ? [{ label: panel.addLabel, className: 'btn-primary', onClick: () => panel.add(ctx) }]
      : []),
    { label: 'Done', className: 'btn-quiet', onClick: (close) => close() },
  ];

  const { close } = openSheet({
    title: panel.title,
    body,
    wide: true,
    actions,
    onClose: () => untrack(panel.id, body),
  });

  track(panel.id, body);
  panel.bind?.(body, ctx);
  panel.refresh(body, ctx);
  return close;
}

function startClock() {
  const el = document.getElementById('clock');
  const paint = () => {
    const now = new Date();
    el.innerHTML = `
      <span class="clock-time">${now.toLocaleTimeString(config.locale, { hour: 'numeric', minute: '2-digit' })}</span>
      <span class="clock-date">${now.toLocaleDateString(config.locale, { weekday: 'long', month: 'long', day: 'numeric' })}</span>`;
  };
  paint();
  setInterval(paint, 15000);
}

function minutesOf(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

function isNight() {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const dayStart = minutesOf(config.display.dayStartsAt);
  const nightStart = minutesOf(config.display.nightStartsAt);
  return nightStart > dayStart ? mins >= nightStart || mins < dayStart : mins >= nightStart && mins < dayStart;
}

function applyTheme() {
  const night = isNight();
  const theme = manualTheme || (config.display.autoTheme ? (night ? 'dark' : 'light') : config.display.theme);
  document.documentElement.dataset.theme = theme;

  // Dimming is a black overlay rather than backlight control: it works on any
  // TV over HDMI, where brightness control usually doesn't.
  const dim = config.display.autoTheme && night ? (config.display.nightDimPercent || 0) / 100 : 0;
  document.getElementById('dim').style.opacity = String(dim);
}

/**
 * The kiosk tab otherwise runs for months. A reload in the small hours resets
 * whatever Chromium — or this code — has slowly accumulated, at a time nobody
 * is mid-edit. Kiosk only: phones don't need it and shouldn't get it.
 */
function scheduleNightlyReload() {
  const at = config.display.nightlyReloadAt;
  if (!at || !document.documentElement.classList.contains('kiosk')) return;

  const [h, m] = String(at).split(':').map(Number);
  const next = new Date();
  next.setHours(h, m || 0, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);

  setTimeout(() => location.reload(), next - Date.now());
}

function setupTheme() {
  const btn = document.getElementById('theme-toggle');
  btn.addEventListener('click', () => {
    manualTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    toast(`${manualTheme === 'dark' ? 'Dark' : 'Light'} theme`);
  });
  applyTheme();
  setInterval(applyTheme, 60000);
}

async function main() {
  config = await api.config();
  document.getElementById('board-name').textContent = config.boardName;
  document.title = config.boardName;

  initKeyboard({ minWidth: config.behavior.onScreenKeyboardMinWidth });

  const board = document.getElementById('board');
  for (const panel of PANELS) {
    const { section } = buildTile(panel);
    board.appendChild(section);
  }

  await Promise.all(PANELS.map((p) => refreshPanel(p.id)));

  for (const panel of PANELS) onChannel(panel.channel, () => refreshPanel(panel.id));

  // ?kiosk=1 (set by scripts/kiosk.sh) hides the mouse cursor the IR frame
  // leaves parked on screen.
  if (new URLSearchParams(location.search).get('kiosk') === '1') {
    document.documentElement.classList.add('kiosk');
  }

  const status = document.getElementById('link-status');
  let offlineSince = null;
  startStream((online) => {
    status.classList.toggle('is-off', !online);
    if (online) {
      offlineSince = null;
      // Catch up on anything missed while the stream was down.
      for (const panel of PANELS) refreshPanel(panel.id);
      return;
    }
    offlineSince ??= Date.now();
  });

  // Browser-side watchdog: a page cut off from the stream for minutes is more
  // likely wedged than the server is down, and a reload costs nothing.
  setInterval(() => {
    if (offlineSince && Date.now() - offlineSince > 5 * 60 * 1000) location.reload();
  }, 30000);

  startClock();
  setupTheme();
  scheduleNightlyReload();

  // Kid-proofing: a wall board should never end up somewhere it can't come back
  // from. Chromium kiosk already blocks most of this; belt and braces.
  document.addEventListener('contextmenu', (ev) => ev.preventDefault());
  document.addEventListener('dragstart', (ev) => ev.preventDefault());
}

main().catch((err) => {
  document.body.innerHTML = `<pre class="fatal">Board failed to start:\n${escapeHtml(err.stack || err.message)}</pre>`;
});
