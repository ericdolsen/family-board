import { db, now, setSyncState, getSyncState } from '../db.js';
import { loadConfig } from '../config.js';
import { getAuthorizedClient, hasCredentials, hasToken } from './auth.js';
import { broadcast } from '../events.js';

const API = 'https://www.googleapis.com/calendar/v3';

// How much of the calendar the board keeps warm locally. Wide enough that
// paging back a few months or forward a year works with the network down.
const WINDOW_BACK_DAYS = 90;
const WINDOW_FORWARD_DAYS = 400;

let lastError = null;
let lastSyncAt = null;

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

    const url = `${API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
    const { data } = await client.request({ url });
    events.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return events;
}

const replaceCalendar = db.transaction((calendarId, rows) => {
  db.prepare('DELETE FROM calendar_events WHERE calendar_id = ?').run(calendarId);
  const insert = db.prepare(
    `INSERT INTO calendar_events
       (id, calendar_id, summary, location, description, start_at, end_at, all_day, status, updated_at)
     VALUES
       (@id, @calendar_id, @summary, @location, @description, @start_at, @end_at, @all_day, @status, @updated_at)`
  );
  for (const row of rows) insert.run(row);
});

export async function syncCalendars() {
  const cfg = loadConfig();
  const calendars = (cfg.calendars || []).filter((c) => c.enabled !== false && c.id && !c.id.startsWith('REPLACE'));
  if (!calendars.length) return { skipped: 'no calendars configured' };

  const client = getAuthorizedClient();
  if (!client) return { skipped: 'not authorised' };

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

export function calendarStatus() {
  const cfg = loadConfig();
  return {
    configured: hasCredentials(),
    linked: hasToken(),
    calendars: (cfg.calendars || []).filter((c) => c.enabled !== false).length,
    lastSyncAt: lastSyncAt || Number(getSyncState('calendar:last_sync')) || null,
    lastError,
    events: db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get().n,
  };
}
