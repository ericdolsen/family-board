import crypto from 'node:crypto';
import { Router } from 'express';
import { db, now } from '../db.js';
import { loadConfig } from '../config.js';
import { broadcast } from '../events.js';
import { isDate, isTime } from '../time.js';
import {
  syncCalendars,
  calendarStatus,
  kickQueue,
  payloadToRow,
  rowToPayload,
} from '../google/calendar.js';

export const calendarRouter = Router();

/**
 * Events overlapping [from, to] (epoch ms). Reads only from the local cache,
 * so this stays instant and works with the internet down. Rows waiting to be
 * deleted on Google are already hidden here.
 */
calendarRouter.get('/events', (req, res) => {
  const from = Number(req.query.from) || Date.now() - 30 * 86400000;
  const to = Number(req.query.to) || Date.now() + 60 * 86400000;
  const rows = db
    .prepare(
      `SELECT id, calendar_id, summary, location, start_at, end_at, all_day, pending
       FROM calendar_events
       WHERE end_at >= ? AND start_at <= ? AND (pending IS NULL OR pending != 'delete')
       ORDER BY all_day DESC, start_at ASC`
    )
    .all(from, to);
  res.json(rows);
});

/** One event in the board's editable shape (wall-clock times, family timezone). */
calendarRouter.get('/events/:calendarId/:id', (req, res) => {
  const row = findRow(req.params.calendarId, req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ id: row.id, pending: row.pending, ...rowToPayload(row, loadConfig().timezone) });
});

calendarRouter.get('/status', (req, res) => res.json(calendarStatus()));

/** Manual "sync now", used by the refresh button on the expanded calendar. */
calendarRouter.post('/sync', async (req, res) => {
  const result = await syncCalendars();
  res.json(result);
});

// ---------------------------------------------------------------- writes

const findRow = (calendarId, id) =>
  db.prepare('SELECT * FROM calendar_events WHERE calendar_id = ? AND id = ?').get(calendarId, id);

function writableCalendar(id) {
  const cfg = loadConfig();
  const cal = (cfg.calendars || []).find((c) => c.id === id && c.enabled !== false);
  if (!cal) return { error: 'unknown calendar' };
  if (cal.readonly) return { error: `${cal.label || 'that calendar'} is read-only` };
  return { cal };
}

/** Validate and normalise the editable shape. Returns { payload } or { error }. */
function cleanPayload(input, existing = null) {
  const p = { ...(existing || {}), ...input };
  p.summary = String(p.summary || '').trim();
  p.location = String(p.location || '').trim();
  p.all_day = Boolean(p.all_day);
  if (!p.summary) return { error: 'title required' };
  if (!isDate(p.date)) return { error: 'date must be YYYY-MM-DD' };
  if (p.end_date != null && p.end_date !== '' && !isDate(p.end_date)) return { error: 'end_date must be YYYY-MM-DD' };
  if (!p.end_date) p.end_date = p.date;
  if (!p.all_day) {
    if (!isTime(p.start_time) || !isTime(p.end_time)) return { error: 'start_time and end_time must be HH:MM' };
  }
  const { error } = writableCalendar(p.calendar_id);
  if (error) return { error };
  return {
    payload: {
      calendar_id: p.calendar_id,
      summary: p.summary,
      location: p.location,
      all_day: p.all_day,
      date: p.date,
      end_date: p.end_date,
      start_time: p.all_day ? undefined : p.start_time,
      end_time: p.all_day ? undefined : p.end_time,
    },
  };
}

const insertRow = db.prepare(
  `INSERT INTO calendar_events
     (id, calendar_id, summary, location, description, start_at, end_at, all_day, status, updated_at, pending)
   VALUES
     (@id, @calendar_id, @summary, @location, @description, @start_at, @end_at, @all_day, @status, @updated_at, @pending)`
);

const updateRow = db.prepare(
  `UPDATE calendar_events
   SET summary = @summary, location = @location, start_at = @start_at, end_at = @end_at,
       all_day = @all_day, updated_at = @updated_at, pending = @pending
   WHERE calendar_id = @calendar_id AND id = @id`
);

const enqueue = db.prepare(
  `INSERT INTO sync_queue (target, op, entity, entity_id, payload, created_at)
   VALUES ('google-calendar', ?, 'event', ?, ?, ?)`
);

const jobFor = (op, id) =>
  db.prepare("SELECT * FROM sync_queue WHERE target = 'google-calendar' AND op = ? AND entity_id = ?").get(op, id);

const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k]]));
const UPDATE_KEYS = ['summary', 'location', 'start_at', 'end_at', 'all_day', 'updated_at', 'pending', 'calendar_id', 'id'];

/** Create: lands in the local cache instantly, reaches Google when the queue drains. */
calendarRouter.post('/events', (req, res) => {
  const { payload, error } = cleanPayload(req.body);
  if (error) return res.status(400).json({ error });

  const tz = loadConfig().timezone;
  const id = `local-${crypto.randomUUID()}`;
  db.transaction(() => {
    insertRow.run(payloadToRow(payload, id, tz, 'create'));
    enqueue.run('create', id, JSON.stringify(payload), now());
  })();

  broadcast('calendar', 'created');
  kickQueue();
  res.status(201).json({ id, pending: 'create', ...payload });
});

calendarRouter.patch('/events/:calendarId/:id', (req, res) => {
  const row = findRow(req.params.calendarId, req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.pending === 'delete') return res.status(409).json({ error: 'event is being deleted' });

  const tz = loadConfig().timezone;
  const current = rowToPayload(row, tz);
  // The calendar an event lives in can't change on Google via PATCH; keep it.
  const { payload, error } = cleanPayload({ ...req.body, calendar_id: row.calendar_id }, current);
  if (error) return res.status(400).json({ error });

  db.transaction(() => {
    if (row.pending === 'create') {
      // Not on Google yet: fold the edit into the pending create.
      const job = jobFor('create', row.id);
      if (job) db.prepare('UPDATE sync_queue SET payload = ? WHERE id = ?').run(JSON.stringify(payload), job.id);
      updateRow.run(pick(payloadToRow(payload, row.id, tz, 'create'), UPDATE_KEYS));
    } else {
      const job = jobFor('update', row.id);
      if (job) db.prepare('UPDATE sync_queue SET payload = ? WHERE id = ?').run(JSON.stringify(payload), job.id);
      else enqueue.run('update', row.id, JSON.stringify(payload), now());
      updateRow.run(pick(payloadToRow(payload, row.id, tz, 'update'), UPDATE_KEYS));
    }
  })();

  broadcast('calendar', 'updated');
  kickQueue();
  res.json({ id: row.id, pending: row.pending === 'create' ? 'create' : 'update', ...payload });
});

calendarRouter.delete('/events/:calendarId/:id', (req, res) => {
  const row = findRow(req.params.calendarId, req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const { error } = writableCalendar(row.calendar_id);
  if (error) return res.status(403).json({ error });

  db.transaction(() => {
    if (row.pending === 'create') {
      // Never reached Google: just forget it.
      db.prepare("DELETE FROM sync_queue WHERE target = 'google-calendar' AND entity_id = ?").run(row.id);
      db.prepare('DELETE FROM calendar_events WHERE calendar_id = ? AND id = ?').run(row.calendar_id, row.id);
    } else {
      db.prepare("DELETE FROM sync_queue WHERE target = 'google-calendar' AND op = 'update' AND entity_id = ?").run(row.id);
      if (!jobFor('delete', row.id)) {
        enqueue.run('delete', row.id, JSON.stringify({ calendar_id: row.calendar_id }), now());
      }
      db.prepare('UPDATE calendar_events SET pending = ?, updated_at = ? WHERE calendar_id = ? AND id = ?')
        .run('delete', now(), row.calendar_id, row.id);
    }
  })();

  broadcast('calendar', 'deleted');
  kickQueue();
  res.status(204).end();
});
