import { Router } from 'express';
import { db, now, nextPosition } from '../db.js';
import { broadcast } from '../events.js';

export const notesRouter = Router();

notesRouter.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM notes ORDER BY position ASC').all());
});

notesRouter.post('/', (req, res) => {
  const kind = req.body.kind === 'drawing' ? 'drawing' : 'text';
  const body = String(req.body.body || '');
  const color = String(req.body.color || 'yellow');
  const member = req.body.member ? String(req.body.member) : null;
  const t = now();
  const info = db
    .prepare(
      `INSERT INTO notes (kind, body, color, member, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(kind, body, color, member, nextPosition('notes'), t, t);
  broadcast('notes', 'created');
  res.status(201).json(db.prepare('SELECT * FROM notes WHERE id = ?').get(info.lastInsertRowid));
});

notesRouter.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const body = req.body.body !== undefined ? String(req.body.body) : row.body;
  const color = req.body.color !== undefined ? String(req.body.color) : row.color;
  db.prepare('UPDATE notes SET body = ?, color = ?, updated_at = ? WHERE id = ?')
    .run(body, color, now(), row.id);
  broadcast('notes', 'updated');
  res.json(db.prepare('SELECT * FROM notes WHERE id = ?').get(row.id));
});

notesRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  broadcast('notes', 'deleted');
  res.status(204).end();
});
