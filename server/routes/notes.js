import { Router } from 'express';
import { db, now, nextPosition } from '../db.js';
import { broadcast } from '../events.js';

export const notesRouter = Router();

const byId = (id) => db.prepare('SELECT * FROM notes WHERE id = ?').get(id);

/**
 * The list deliberately leaves out full-size drawings. The board tile only
 * needs the thumbnail, and sending every drawing at full resolution on every
 * repaint is exactly the memory growth we are avoiding. GET /:id has the rest.
 */
notesRouter.get('/', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT id, kind, color, member, position, created_at, updated_at, thumb,
                CASE WHEN kind = 'drawing' THEN NULL ELSE body END AS body
         FROM notes ORDER BY position ASC`
      )
      .all()
  );
});

notesRouter.get('/:id', (req, res) => {
  const row = byId(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

notesRouter.post('/', (req, res) => {
  const kind = req.body.kind === 'drawing' ? 'drawing' : 'text';
  const body = String(req.body.body || '');
  const thumb = kind === 'drawing' && req.body.thumb ? String(req.body.thumb) : null;
  const color = String(req.body.color || 'yellow');
  const member = req.body.member ? String(req.body.member) : null;
  const t = now();
  const info = db
    .prepare(
      `INSERT INTO notes (kind, body, thumb, color, member, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(kind, body, thumb, color, member, nextPosition('notes'), t, t);
  broadcast('notes', 'created');
  res.status(201).json(byId(info.lastInsertRowid));
});

notesRouter.patch('/:id', (req, res) => {
  const row = byId(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const body = req.body.body !== undefined ? String(req.body.body) : row.body;
  const thumb = req.body.thumb !== undefined ? String(req.body.thumb) : row.thumb;
  const color = req.body.color !== undefined ? String(req.body.color) : row.color;
  db.prepare('UPDATE notes SET body = ?, thumb = ?, color = ?, updated_at = ? WHERE id = ?')
    .run(body, thumb, color, now(), row.id);
  broadcast('notes', 'updated');
  res.json(byId(row.id));
});

notesRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  broadcast('notes', 'deleted');
  res.status(204).end();
});
