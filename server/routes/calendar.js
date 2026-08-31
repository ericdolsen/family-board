import { Router } from 'express';
import { db } from '../db.js';
import { syncCalendars, calendarStatus } from '../google/calendar.js';

export const calendarRouter = Router();

/**
 * Events overlapping [from, to] (epoch ms). Reads only from the local cache, so
 * this stays instant and works with the internet down.
 */
calendarRouter.get('/events', (req, res) => {
  const from = Number(req.query.from) || Date.now() - 30 * 86400000;
  const to = Number(req.query.to) || Date.now() + 60 * 86400000;
  const rows = db
    .prepare(
      `SELECT id, calendar_id, summary, location, start_at, end_at, all_day
       FROM calendar_events
       WHERE end_at >= ? AND start_at <= ?
       ORDER BY all_day DESC, start_at ASC`
    )
    .all(from, to);
  res.json(rows);
});

calendarRouter.get('/status', (req, res) => res.json(calendarStatus()));

/** Manual "sync now", used by the refresh button on the expanded calendar. */
calendarRouter.post('/sync', async (req, res) => {
  const result = await syncCalendars();
  res.json(result);
});
