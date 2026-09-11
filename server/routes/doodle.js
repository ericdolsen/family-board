import { Router } from 'express';
import { db, now } from '../db.js';
import { broadcast } from '../events.js';

export const doodleRouter = Router();

const EMPTY = { id: 1, png: '', thumb: null, updated_at: 0 };
const current = () => db.prepare('SELECT * FROM doodles WHERE id = 1').get() || EMPTY;

/** Origin lets the client that made a change ignore its own echo. */
const origin = (req) => req.get('x-client-id') || null;

doodleRouter.get('/', (req, res) => res.json(current()));

/** The toolbar only needs the thumbnail; don't ship the full PNG for it. */
doodleRouter.get('/thumb', (req, res) => {
  const row = current();
  res.json({ thumb: row.thumb, updated_at: row.updated_at });
});

doodleRouter.put('/', (req, res) => {
  const png = String(req.body.png || '');
  const thumb = req.body.thumb ? String(req.body.thumb) : null;
  db.prepare(
    `INSERT INTO doodles (id, png, thumb, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET png = excluded.png, thumb = excluded.thumb, updated_at = excluded.updated_at`
  ).run(png, thumb, now());
  broadcast('doodle', 'updated', { origin: origin(req) });
  res.json({ ok: true, updated_at: current().updated_at });
});

doodleRouter.delete('/', (req, res) => {
  db.prepare(
    `INSERT INTO doodles (id, png, thumb, updated_at) VALUES (1, '', NULL, ?)
     ON CONFLICT(id) DO UPDATE SET png = '', thumb = NULL, updated_at = excluded.updated_at`
  ).run(now());
  broadcast('doodle', 'cleared', { origin: origin(req) });
  res.status(204).end();
});
