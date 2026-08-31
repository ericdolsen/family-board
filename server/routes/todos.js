import { Router } from 'express';
import { db, now, nextPosition } from '../db.js';
import { broadcast } from '../events.js';

export const todosRouter = Router();

const list = () =>
  db.prepare('SELECT * FROM todos ORDER BY done ASC, position ASC').all();

todosRouter.get('/', (req, res) => res.json(list()));

todosRouter.post('/', (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  const member = req.body.member ? String(req.body.member) : null;
  const t = now();
  const info = db
    .prepare(
      `INSERT INTO todos (text, member, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(text, member, nextPosition('todos'), t, t);
  broadcast('todos', 'created');
  res.status(201).json(db.prepare('SELECT * FROM todos WHERE id = ?').get(info.lastInsertRowid));
});

todosRouter.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });

  const text = req.body.text !== undefined ? String(req.body.text).trim() : row.text;
  const member = req.body.member !== undefined ? req.body.member : row.member;
  const done = req.body.done !== undefined ? (req.body.done ? 1 : 0) : row.done;
  const doneAt = done ? (row.done ? row.done_at : now()) : null;

  db.prepare(
    `UPDATE todos SET text = ?, member = ?, done = ?, done_at = ?, dirty = 1, updated_at = ?
     WHERE id = ?`
  ).run(text, member, done, doneAt, now(), row.id);

  broadcast('todos', 'updated');
  res.json(db.prepare('SELECT * FROM todos WHERE id = ?').get(row.id));
});

todosRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM todos WHERE id = ?').run(req.params.id);
  broadcast('todos', 'deleted');
  res.status(204).end();
});

/** Clear completed items now (the "clear done" button). */
todosRouter.post('/clear-done', (req, res) => {
  const info = db.prepare('DELETE FROM todos WHERE done = 1').run();
  broadcast('todos', 'cleared');
  res.json({ removed: info.changes });
});
