import { api } from '../api.js';
import { openSheet, confirmAction, toast, escapeHtml } from '../ui.js';

const DAY_MS = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const utcKey = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const fromKey = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
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

/** 'HH:MM' -> '2:30 PM' in the board's locale. */
function clockLabel(hhmm, locale) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

function shiftTime(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function dateLabel(key, locale) {
  return fromKey(key).toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** A sensible default start for a new event: the next half hour, or 9:00 for other days. */
function defaultStart(dateKey) {
  if (dateKey !== localKey(new Date())) return '09:00';
  const now = new Date();
  const mins = Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30;
  return shiftTime('00:00', Math.min(mins, 23 * 60 + 30));
}

// ---------------------------------------------------------------- event form

/**
 * The big-button event editor. Everything is a tap: no pickers, no typing
 * except the title. Resolves to { action: 'save', payload } | { action: 'delete' } | null.
 */
function eventForm({ ctx, title, initial, canDelete }) {
  const locale = ctx.config.locale;
  const calendars = ctx.config.calendars.filter((c) => !c.readonly);
  const state = {
    calendar_id: initial.calendar_id || calendars[0]?.id,
    summary: initial.summary || '',
    location: initial.location || '',
    all_day: Boolean(initial.all_day),
    date: initial.date,
    start_time: initial.start_time || defaultStart(initial.date),
    end_time: initial.end_time || shiftTime(initial.start_time || defaultStart(initial.date), 60),
  };

  return new Promise((resolve) => {
    const form = document.createElement('form');
    form.className = 'big-form event-form';

    const render = () => {
      form.innerHTML = `
        <input class="big-input" name="summary" type="text" autocomplete="off" spellcheck="false"
               placeholder="What's happening?" value="${escapeHtml(state.summary)}">

        ${calendars.length > 1 ? `
          <p class="field-label">Calendar</p>
          <div class="chip-row">
            ${calendars.map((c) => `<button type="button" class="chip ${c.id === state.calendar_id ? 'is-on' : ''}"
                data-cal="${escapeHtml(c.id)}" style="--chip:${ctx.calendarColor(c.id)}">${escapeHtml(c.label)}</button>`).join('')}
          </div>` : ''}

        <p class="field-label">When</p>
        <div class="stepper">
          <button type="button" class="btn" data-day="-1" aria-label="Previous day">‹</button>
          <span class="stepper-value">${escapeHtml(dateLabel(state.date, locale))}</span>
          <button type="button" class="btn" data-day="1" aria-label="Next day">›</button>
          <button type="button" class="btn ${state.all_day ? 'is-on' : ''}" data-allday>All day</button>
        </div>

        <div class="time-rows" ${state.all_day ? 'hidden' : ''}>
          <div class="stepper">
            <span class="stepper-label">Start</span>
            <button type="button" class="btn" data-start="-15">−15</button>
            <span class="stepper-value">${escapeHtml(clockLabel(state.start_time, locale))}</span>
            <button type="button" class="btn" data-start="15">+15</button>
          </div>
          <div class="stepper">
            <span class="stepper-label">End</span>
            <button type="button" class="btn" data-end="-15">−15</button>
            <span class="stepper-value">${escapeHtml(clockLabel(state.end_time, locale))}</span>
            <button type="button" class="btn" data-end="15">+15</button>
          </div>
        </div>

        <p class="field-label">Where (optional)</p>
        <input class="big-input big-input--sm" name="location" type="text" autocomplete="off" spellcheck="false"
               placeholder="Location" value="${escapeHtml(state.location)}">`;
    };

    // Re-rendering the whole form would blow away the focused title input and
    // the keyboard with it, so buttons update state and patch labels in place.
    const patch = () => {
      form.querySelector('.stepper-value').textContent = dateLabel(state.date, locale);
      form.querySelector('[data-allday]').classList.toggle('is-on', state.all_day);
      form.querySelector('.time-rows').hidden = state.all_day;
      const values = form.querySelectorAll('.time-rows .stepper-value');
      values[0].textContent = clockLabel(state.start_time, locale);
      values[1].textContent = clockLabel(state.end_time, locale);
      form.querySelectorAll('[data-cal]').forEach((b) => b.classList.toggle('is-on', b.dataset.cal === state.calendar_id));
    };

    render();

    form.addEventListener('input', (ev) => {
      if (ev.target.name === 'summary') state.summary = ev.target.value;
      if (ev.target.name === 'location') state.location = ev.target.value;
    });

    form.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.cal) state.calendar_id = b.dataset.cal;
      else if (b.dataset.day) state.date = localKey(new Date(fromKey(state.date).getTime() + Number(b.dataset.day) * DAY_MS + 3600000 * 6));
      else if (b.hasAttribute('data-allday')) state.all_day = !state.all_day;
      else if (b.dataset.start) {
        const wasGap = (parseInt(state.end_time) * 60 + parseInt(state.end_time.slice(3))) - (parseInt(state.start_time) * 60 + parseInt(state.start_time.slice(3)));
        state.start_time = shiftTime(state.start_time, Number(b.dataset.start));
        // Keep the duration when the start moves, like every calendar app.
        state.end_time = shiftTime(state.start_time, wasGap > 0 ? wasGap : 60);
      } else if (b.dataset.end) state.end_time = shiftTime(state.end_time, Number(b.dataset.end));
      else return;
      patch();
    });

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      close();
      resolve(value);
    };

    const submit = () => {
      if (!state.summary.trim()) {
        toast('Give it a title first');
        form.querySelector('[name="summary"]').focus();
        return;
      }
      finish({ action: 'save', payload: { ...state, summary: state.summary.trim(), location: state.location.trim() } });
    };

    form.addEventListener('submit', (ev) => { ev.preventDefault(); submit(); });
    form.addEventListener('osk-done', (ev) => {
      // "Done" on the keyboard from the title field just moves on; the Save
      // button commits. Prevents a half-filled event from being saved by reflex.
      ev.target.blur();
    });

    const actions = [{ label: 'Cancel', className: 'btn-quiet', onClick: () => finish(null) }];
    if (canDelete) actions.push({ label: 'Delete', className: 'btn-danger', onClick: () => finish({ action: 'delete' }) });
    actions.push({ label: 'Save', className: 'btn-primary', onClick: submit });

    const { close } = openSheet({ title, body: form, actions, onClose: () => finish(null) });
    form.querySelector('[name="summary"]').focus();
  });
}

// ---------------------------------------------------------------- panel

export const calendarPanel = {
  id: 'calendar',
  title: 'Calendar',
  channel: 'calendar',
  addLabel: 'Add event',

  // Phones open on the agenda: a month grid at 375px wide is dots, not words.
  state: { view: window.innerWidth < 900 ? 'agenda' : 'month', anchor: new Date() },

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
    const pending = ev.pending ? ' is-pending' : '';
    return `<span class="cal-chip${pending}" style="--chip:${color}">${time}${escapeHtml(ev.summary)}</span>`;
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

  /** The + button on the tile: a new event, today. */
  async add(ctx, dateKey = localKey(new Date())) {
    if (!ctx.config.calendars.some((c) => !c.readonly)) {
      toast('No calendar the board can write to');
      return;
    }
    const result = await eventForm({ ctx, title: 'Add event', initial: { date: dateKey }, canDelete: false });
    if (result?.action === 'save') {
      await api.calendar.create(result.payload).catch((err) => toast(`Couldn't add: ${err.message}`));
    }
  },

  async edit(ev, ctx) {
    const cal = ctx.config.calendars.find((c) => c.id === ev.calendar_id);
    if (!cal || cal.readonly) {
      toast(`${cal?.label || 'That calendar'} can't be edited from the board`);
      return;
    }
    const current = await api.calendar.get(ev.calendar_id, ev.id).catch(() => null);
    if (!current) return toast('That event just changed — try again');

    const result = await eventForm({ ctx, title: 'Edit event', initial: current, canDelete: true });
    if (!result) return;

    if (result.action === 'delete') {
      const ok = await confirmAction({
        title: 'Delete this event?',
        message: `"${current.summary}" will be removed from Google Calendar too.`,
      });
      if (ok) await api.calendar.remove(ev.calendar_id, ev.id).catch((err) => toast(`Couldn't delete: ${err.message}`));
      return;
    }
    const { calendar_id, ...fields } = result.payload;
    await api.calendar.update(ev.calendar_id, ev.id, fields).catch((err) => toast(`Couldn't save: ${err.message}`));
  },

  daySheet(key, ctx) {
    const items = (this._byDay?.get(key) || []).slice().sort((a, b) => a.start_at - b.start_at);
    const date = fromKey(key);

    const rows = items
      .map((ev, i) => {
        const loc = ev.location ? `<span class="day-loc">${escapeHtml(ev.location)}</span>` : '';
        const pending = ev.pending ? '<span class="tag">syncing…</span>' : '';
        return `<li style="--chip:${ctx.calendarColor(ev.calendar_id)}">
          <button type="button" class="day-event" data-index="${i}">
            <span class="day-time">${escapeHtml(timeLabel(ev, ctx.config.locale))}</span>
            <span class="day-summary">${escapeHtml(ev.summary)} ${pending}</span>
            ${loc}
          </button>
        </li>`;
      })
      .join('');

    const body = document.createElement('div');
    body.innerHTML = items.length ? `<ul class="day-list">${rows}</ul>` : '<p class="empty">Nothing scheduled.</p>';

    const { close } = openSheet({
      title: date.toLocaleDateString(ctx.config.locale, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
      wide: true,
      body,
      actions: [
        { label: 'Close', className: 'btn-quiet', onClick: (c) => c() },
        { label: 'Add event', className: 'btn-primary', onClick: (c) => { c(); this.add(ctx, key); } },
      ],
    });

    body.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-index]');
      if (!btn) return;
      close();
      this.edit(items[Number(btn.dataset.index)], ctx);
    });
  },
};
