import { api } from '../api.js';
import { openSheet, escapeHtml } from '../ui.js';

const DAY_MS = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const utcKey = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/**
 * Which day squares an event belongs on. All-day events were stored at UTC
 * midnight (see server/google/calendar.js) so they are read back in UTC and
 * never drift a square; timed events are walked in local time so DST is safe.
 */
function eventDayKeys(ev) {
  const keys = [];
  if (ev.all_day) {
    for (let t = ev.start_at; t < ev.end_at; t += DAY_MS) keys.push(utcKey(t));
    if (!keys.length) keys.push(utcKey(ev.start_at));
    return keys;
  }
  const cursor = new Date(ev.start_at);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() < ev.end_at) {
    keys.push(localKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
    if (keys.length > 60) break;
  }
  return keys.length ? keys : [localKey(new Date(ev.start_at))];
}

function timeLabel(ev, locale) {
  if (ev.all_day) return 'All day';
  return new Date(ev.start_at).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

export const calendarPanel = {
  id: 'calendar',
  title: 'Calendar',
  channel: 'calendar',
  addLabel: null, // Phase 2: creating events writes back to Google.

  state: { view: 'month', anchor: new Date() },

  async refresh(body, ctx) {
    const { view, anchor } = this.state;
    const range = this.rangeFor(view, anchor, ctx);
    const events = await api.calendar.events(range.from.getTime(), range.to.getTime());

    const byDay = new Map();
    for (const ev of events) {
      for (const key of eventDayKeys(ev)) {
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(ev);
      }
    }
    this._byDay = byDay;

    body.innerHTML = `
      <div class="cal-bar">
        <button type="button" class="btn btn-icon" data-nav="-1" aria-label="Previous">&lsaquo;</button>
        <button type="button" class="cal-title" data-nav="0">${escapeHtml(this.titleFor(view, anchor, ctx))}</button>
        <button type="button" class="btn btn-icon" data-nav="1" aria-label="Next">&rsaquo;</button>
        <div class="cal-views">
          ${['month', 'week', 'agenda']
            .map(
              (v) => `<button type="button" class="btn btn-small ${v === view ? 'is-on' : ''}" data-view="${v}">
                ${v[0].toUpperCase() + v.slice(1)}</button>`
            )
            .join('')}
        </div>
      </div>
      ${view === 'month' ? this.monthHtml(anchor, byDay, ctx) : ''}
      ${view === 'week' ? this.weekHtml(range.from, byDay, ctx) : ''}
      ${view === 'agenda' ? this.agendaHtml(range.from, byDay, ctx) : ''}`;
  },

  rangeFor(view, anchor, ctx) {
    if (view === 'month') {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const from = new Date(first);
      from.setDate(from.getDate() - ((first.getDay() - ctx.config.weekStartsOn + 7) % 7));
      const to = new Date(from);
      to.setDate(to.getDate() + 42);
      return { from, to };
    }
    if (view === 'week') {
      const from = new Date(anchor);
      from.setHours(0, 0, 0, 0);
      from.setDate(from.getDate() - ((from.getDay() - ctx.config.weekStartsOn + 7) % 7));
      const to = new Date(from);
      to.setDate(to.getDate() + 7);
      return { from, to };
    }
    const from = new Date(anchor);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 30);
    return { from, to };
  },

  titleFor(view, anchor, ctx) {
    const l = ctx.config.locale;
    if (view === 'month') return anchor.toLocaleDateString(l, { month: 'long', year: 'numeric' });
    if (view === 'week') {
      const { from } = this.rangeFor('week', anchor, ctx);
      const end = new Date(from);
      end.setDate(end.getDate() + 6);
      const a = from.toLocaleDateString(l, { month: 'short', day: 'numeric' });
      const b = end.toLocaleDateString(l, { month: 'short', day: 'numeric' });
      return `${a} - ${b}`;
    }
    return 'Next 30 days';
  },

  chip(ev, ctx) {
    const color = ctx.calendarColor(ev.calendar_id);
    const time = ev.all_day ? '' : `<b>${escapeHtml(timeLabel(ev, ctx.config.locale))}</b> `;
    return `<span class="cal-chip" style="--chip:${color}">${time}${escapeHtml(ev.summary)}</span>`;
  },

  monthHtml(anchor, byDay, ctx) {
    const { from } = this.rangeFor('month', anchor, ctx);
    const todayKey = localKey(new Date());
    const names = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      names.push(d.toLocaleDateString(ctx.config.locale, { weekday: 'short' }));
    }

    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      const key = localKey(d);
      const items = byDay.get(key) || [];
      const outside = d.getMonth() !== anchor.getMonth() ? 'is-outside' : '';
      const today = key === todayKey ? 'is-today' : '';
      const more = items.length > 3 ? `<span class="cal-more">+${items.length - 3} more</span>` : '';
      cells += `<button type="button" class="cal-cell ${outside} ${today}" data-day="${key}">
        <span class="cal-day">${d.getDate()}</span>
        <span class="cal-events">${items.slice(0, 3).map((ev) => this.chip(ev, ctx)).join('')}${more}</span>
      </button>`;
    }

    return `<div class="cal-grid">
      ${names.map((n) => `<div class="cal-weekday">${escapeHtml(n)}</div>`).join('')}
      ${cells}
    </div>`;
  },

  weekHtml(from, byDay, ctx) {
    const todayKey = localKey(new Date());
    let cols = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      const key = localKey(d);
      const items = byDay.get(key) || [];
      const body = items.map((ev) => this.chip(ev, ctx)).join('') || '<span class="cal-more">&mdash;</span>';
      cols += `<button type="button" class="cal-col ${key === todayKey ? 'is-today' : ''}" data-day="${key}">
        <span class="cal-col-head">
          ${d.toLocaleDateString(ctx.config.locale, { weekday: 'short' })}
          <b>${d.getDate()}</b>
        </span>
        <span class="cal-events">${body}</span>
      </button>`;
    }
    return `<div class="cal-week">${cols}</div>`;
  },

  agendaHtml(from, byDay, ctx) {
    let out = '';
    for (let i = 0; i < 30; i++) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      const key = localKey(d);
      const items = byDay.get(key) || [];
      if (!items.length) continue;
      const heading = d.toLocaleDateString(ctx.config.locale, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      });
      out += `<div class="agenda-day">
        <h3>${escapeHtml(heading)}</h3>
        ${items.map((ev) => this.chip(ev, ctx)).join('')}
      </div>`;
    }
    return `<div class="cal-agenda">${out || '<p class="empty">Nothing scheduled.</p>'}</div>`;
  },

  bind(body, ctx) {
    body.addEventListener('click', (ev) => {
      const nav = ev.target.closest('[data-nav]');
      if (nav) {
        const step = Number(nav.dataset.nav);
        const a = new Date(this.state.anchor);
        if (step === 0) {
          this.state.anchor = new Date();
        } else if (this.state.view === 'month') {
          this.state.anchor = new Date(a.getFullYear(), a.getMonth() + step, 1);
        } else {
          a.setDate(a.getDate() + step * (this.state.view === 'week' ? 7 : 30));
          this.state.anchor = a;
        }
        return ctx.refreshPanel('calendar');
      }

      const view = ev.target.closest('[data-view]');
      if (view) {
        this.state.view = view.dataset.view;
        return ctx.refreshPanel('calendar');
      }

      const cell = ev.target.closest('[data-day]');
      if (cell) this.daySheet(cell.dataset.day, ctx);
    });
  },

  daySheet(key, ctx) {
    const items = (this._byDay?.get(key) || []).slice().sort((a, b) => a.start_at - b.start_at);
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);

    const rows = items
      .map((ev) => {
        const loc = ev.location ? `<span class="day-loc">${escapeHtml(ev.location)}</span>` : '';
        return `<li style="--chip:${ctx.calendarColor(ev.calendar_id)}">
          <span class="day-time">${escapeHtml(timeLabel(ev, ctx.config.locale))}</span>
          <span class="day-summary">${escapeHtml(ev.summary)}</span>
          ${loc}
        </li>`;
      })
      .join('');

    openSheet({
      title: date.toLocaleDateString(ctx.config.locale, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
      wide: true,
      body: items.length ? `<ul class="day-list">${rows}</ul>` : '<p class="empty">Nothing scheduled.</p>',
      actions: [{ label: 'Close', className: 'btn-quiet', onClick: (close) => close() }],
    });
  },
};
