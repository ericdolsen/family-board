import { db, now, setSyncState, getSyncState } from '../db.js';
import { loadConfig } from '../config.js';
import { getAuthorizedClient, hasCredentials, hasToken } from './auth.js';
import { broadcast } from '../events.js';
import { wallToEpoch, epochToWall, addDays } from '../time.js';

const API = 'https://www.googleapis.com/calendar/v3';

// How much of the calendar the board keeps warm locally. Wide enough that
// paging back a few months or forward a year works with the network down.
const WINDOW_BACK_DAYS = 90;
const WINDOW_FORWARD_DAYS = 400;

let lastError = null;
let lastSyncAt = null;

const enc = encodeURIComponent;

/**
 * All-day events arrive as a bare date ("2026-08-31") with an exclusive end.
 * Storing them as UTC midnight keeps them on the right calendar square no
 * matter what timezone the Pi is set to; the frontend reads them back in UTC.
 */
function parseAllDay(dateStr) {
  return Date.parse(`${dateStr}T00:00:00Z`);
}

function toRow(calendarId, ev) {
  const allDay = Boolean(ev.start?.date);
  const start = allDay ? parseAllDay(ev.start.date) : Date.parse(ev.start.dateTime);
  const end = allDay ? parseAllDay(ev.end.date) : Date.parse(ev.end.dateTime);
  return {
    id: ev.id,
    calendar_id: calendarId,
    summary: ev.summary || '(no title)',
    location: ev.location || null,
    description: ev.description || null,
    start_at: start,
    end_at: end,
    all_day: allDay ? 1 : 0,
    status: ev.status || 'confirmed',
    updated_at: now(),
  };
}

// ---------------------------------------------------------------- read side

async function fetchCalendar(client, calendarId, timeMin, timeMax) {
  const events = [];
  let pageToken;

  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
      showDeleted: 'false',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const url = `${API}/calendars/${enc(calendarId)}/events?${params}`;
    const { data } = await client.request({ url });
    events.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return events;
}

/**
 * Wholesale refresh of one calendar's cache — except rows with a pending
 * local change, which keep their local version until the queue has pushed it.
 */
const replaceCalendar = db.transaction((calendarId, rows) => {
  db.prepare('DELETE FROM calendar_events WHERE calendar_id = ? AND pending IS NULL').run(calendarId);
  const insert = db.prepare(
    `INSERT INTO calendar_events
       (id, calendar_id, summary, location, description, start_at, end_at, all_day, status, updated_at, pending)
     VALUES
       (@id, @calendar_id, @summary, @location, @description, @start_at, @end_at, @all_day, @status, @updated_at, NULL)
     ON CONFLICT(calendar_id, id) DO NOTHING`
  );
  for (const row of rows) insert.run(row);
});

export async function syncCalendars() {
  const cfg = loadConfig();
  const calendars = (cfg.calendars || []).filter((c) => c.enabled !== false && c.id && !c.id.startsWith('REPLACE'));
  if (!calendars.length) return { skipped: 'no calendars configured' };

  const client = getAuthorizedClient();
  if (!client) return { skipped: 'not authorised' };

  // Push before pull, so a just-tapped event is on Google before we re-read.
  await processQueue().catch((err) => console.error('[calendar] queue:', err.message));

  const timeMin = new Date(Date.now() - WINDOW_BACK_DAYS * 86400000).toISOString();
  const timeMax = new Date(Date.now() + WINDOW_FORWARD_DAYS * 86400000).toISOString();

  let changed = false;
  for (const cal of calendars) {
    try {
      const items = await fetchCalendar(client, cal.id, timeMin, timeMax);
      const rows = items
        .filter((ev) => ev.start && ev.end && ev.status !== 'cancelled')
        .map((ev) => toRow(cal.id, ev));
      replaceCalendar(cal.id, rows);
      changed = true;
      lastError = null;
    } catch (err) {
      // One bad calendar (wrong id, revoked share) must not stop the others.
      lastError = `${cal.label || cal.id}: ${err.message}`;
      console.error('[calendar] sync failed for', cal.id, '-', err.message);
    }
  }

  lastSyncAt = now();
  setSyncState('calendar:last_sync', lastSyncAt);
  if (lastError) setSyncState('calendar:last_error', lastError);
  if (changed) broadcast('calendar', 'synced');
  return { lastSyncAt, lastError };
}

// ---------------------------------------------------------------- write side

/**
 * The board's own shape for an editable event. Times are wall-clock strings
 * in the family's timezone; the server does every conversion.
 *   { calendar_id, summary, location, all_day, date, end_date?, start_time?, end_time? }
 */
export function rowToPayload(row, tz) {
  if (row.all_day) {
    const start = epochToWall(row.start_at, 'UTC').date;
    const endExclusive = epochToWall(row.end_at, 'UTC').date;
    return {
      calendar_id: row.calendar_id,
      summary: row.summary,
      location: row.location || '',
      all_day: true,
      date: start,
      end_date: addDays(endExclusive, -1),
    };
  }
  const s = epochToWall(row.start_at, tz);
  const e = epochToWall(row.end_at, tz);
  return {
    calendar_id: row.calendar_id,
    summary: row.summary,
    location: row.location || '',
    all_day: false,
    date: s.date,
    end_date: e.date,
    start_time: s.time,
    end_time: e.time,
  };
}

/** Timed events whose end is not after their start roll the end to the next day. */
function timedEnd(p) {
  const endDate = p.end_date || p.date;
  if (endDate > p.date) return { date: endDate, time: p.end_time };
  if (p.end_time > p.start_time) return { date: p.date, time: p.end_time };
  return { date: addDays(p.date, 1), time: p.end_time };
}

/** Local cache row for a payload, mirroring exactly what Google will hand back. */
export function payloadToRow(p, id, tz, pending) {
  const endInclusive = p.end_date && p.end_date >= p.date ? p.end_date : p.date;
  let start_at;
  let end_at;
  if (p.all_day) {
    start_at = parseAllDay(p.date);
    end_at = parseAllDay(addDays(endInclusive, 1));
  } else {
    const end = timedEnd(p);
    start_at = wallToEpoch(p.date, p.start_time, tz);
    end_at = wallToEpoch(end.date, end.time, tz);
  }
  return {
    id,
    calendar_id: p.calendar_id,
    summary: p.summary,
    location: p.location || null,
    description: null,
    start_at,
    end_at,
    all_day: p.all_day ? 1 : 0,
    status: 'confirmed',
    updated_at: now(),
    pending,
  };
}

function googleBody(p, tz) {
  const body = { summary: p.summary, location: p.location || '' };
  if (p.all_day) {
    const endInclusive = p.end_date && p.end_date >= p.date ? p.end_date : p.date;
    body.start = { date: p.date };
    body.end = { date: addDays(endInclusive, 1) };
  } else {
    const end = timedEnd(p);
    body.start = { dateTime: `${p.date}T${p.start_time}:00`, timeZone: tz };
    body.end = { dateTime: `${end.date}T${end.time}:00`, timeZone: tz };
  }
  return body;
}

let draining = false;
let kickTimer = null;

/** Run the queue soon, coalescing bursts of taps into one pass. */
export function kickQueue() {
  clearTimeout(kickTimer);
  kickTimer = setTimeout(() => processQueue().catch((err) => console.error('[calendar] queue:', err.message)), 400);
  kickTimer.unref?.();
}

const finishCreate = db.transaction((job, payload, googleId) => {
  db.prepare(
    'UPDATE calendar_events SET id = ?, pending = NULL, updated_at = ? WHERE calendar_id = ? AND id = ?'
  ).run(googleId, now(), payload.calendar_id, job.entity_id);
  db.prepare('DELETE FROM sync_queue WHERE id = ?').run(job.id);
});

const finishUpdate = db.transaction((job, payload) => {
  db.prepare('UPDATE calendar_events SET pending = NULL, updated_at = ? WHERE calendar_id = ? AND id = ?')
    .run(now(), payload.calendar_id, job.entity_id);
  db.prepare('DELETE FROM sync_queue WHERE id = ?').run(job.id);
});

const finishDelete = db.transaction((job, payload) => {
  db.prepare('DELETE FROM calendar_events WHERE calendar_id = ? AND id = ?').run(payload.calendar_id, job.entity_id);
  db.prepare('DELETE FROM sync_queue WHERE id = ?').run(job.id);
});

/**
 * Push local changes to Google, oldest first. Stops at the first failure and
 * retries next cycle — never drops a change. The status endpoint shows what
 * is stuck and why, which is the honest behaviour for a board that must keep
 * working when the link (or the token's scope) is wrong.
 */
export async function processQueue() {
  if (draining) return;
  const client = getAuthorizedClient();
  if (!client) return;
  draining = true;

  try {
    const tz = loadConfig().timezone;
    const jobs = db.prepare("SELECT * FROM sync_queue WHERE target = 'google-calendar' ORDER BY id").all();

    for (const job of jobs) {
      const payload = JSON.parse(job.payload);
      const base = `${API}/calendars/${enc(payload.calendar_id)}/events`;

      try {
        if (job.op === 'create') {
          const { data } = await client.request({ method: 'POST', url: base, data: googleBody(payload, tz) });
          finishCreate(job, payload, data.id);
        } else if (job.op === 'update') {
          await client.request({ method: 'PATCH', url: `${base}/${enc(job.entity_id)}`, data: googleBody(payload, tz) });
          finishUpdate(job, payload);
        } else if (job.op === 'delete') {
          await client.request({ method: 'DELETE', url: `${base}/${enc(job.entity_id)}` });
          finishDelete(job, payload);
        } else {
          db.prepare('DELETE FROM sync_queue WHERE id = ?').run(job.id);
        }
        lastError = null;
        broadcast('calendar', 'synced');
      } catch (err) {
        const status = err.response?.status;
        // Already gone on Google's side: that's the outcome we wanted.
        if ((status === 404 || status === 410) && job.op !== 'create') {
          finishDelete(job, payload);
          continue;
        }
        const message = err.response?.data?.error?.message || err.message;
        db.prepare('UPDATE sync_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?')
          .run(String(message).slice(0, 300), job.id);
        lastError = `${job.op} failed: ${message}`;
        console.error(`[calendar] ${job.op} ${job.entity_id} failed (${status || 'network'}):`, message);
        break;
      }
    }
  } finally {
    draining = false;
  }
}

export function calendarStatus() {
  const cfg = loadConfig();
  const queue = db
    .prepare("SELECT COUNT(*) AS n, MAX(attempts) AS attempts, MAX(last_error) AS error FROM sync_queue WHERE target = 'google-calendar'")
    .get();
  return {
    configured: hasCredentials(),
    linked: hasToken(),
    calendars: (cfg.calendars || []).filter((c) => c.enabled !== false).length,
    lastSyncAt: lastSyncAt || Number(getSyncState('calendar:last_sync')) || null,
    lastError,
    events: db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get().n,
    queued: queue.n,
    queueError: queue.n ? queue.error : null,
  };
}
