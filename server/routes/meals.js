import { Router } from 'express';
import { db, now, nextPosition } from '../db.js';
import { broadcast } from '../events.js';

export const mealsRouter = Router();

mealsRouter.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM meals ORDER BY tonight DESC, position ASC').all());
});

mealsRouter.post('/', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const t = now();
  const info = db
    .prepare('INSERT INTO meals (name, position, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(name, nextPosition('meals'), t, t);
  broadcast('meals', 'created');
  res.status(201).json(db.prepare('SELECT * FROM meals WHERE id = ?').get(info.lastInsertRowid));
});

mealsRouter.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });

  const name = req.body.name !== undefined ? String(req.body.name).trim() : row.name;

  // Only one meal can be "tonight"; setting it clears the others in the same txn.
  if (req.body.tonight !== undefined) {
    const tonight = req.body.tonight ? 1 : 0;
    db.transaction(() => {
      if (tonight) db.prepare('UPDATE meals SET tonight = 0, updated_at = ? WHERE tonight = 1').run(now());
      db.prepare('UPDATE meals SET tonight = ?, updated_at = ? WHERE id = ?').run(tonight, now(), row.id);
    })();
  }

  db.prepare('UPDATE meals SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), row.id);
  broadcast('meals', 'updated');
  res.json(db.prepare('SELECT * FROM meals WHERE id = ?').get(row.id));
});

/** Cooked it: clears "tonight" and removes it from the have-food-to-make list. */
mealsRouter.post('/:id/cooked', (req, res) => {
  const row = db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM meals WHERE id = ?').run(row.id);
  broadcast('meals', 'cooked');
  res.json({ ok: true });
});

mealsRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM meals WHERE id = ?').run(req.params.id);
  broadcast('meals', 'deleted');
  res.status(204).end();
});
