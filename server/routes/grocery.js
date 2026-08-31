import { Router } from 'express';
import { db, now, nextPosition } from '../db.js';
import { broadcast } from '../events.js';

export const groceryRouter = Router();

/**
 * The board's own list is the source of truth. Checked items are not deleted —
 * they fall into a "recently bought" section so re-adding a staple is one tap.
 */
groceryRouter.get('/', (req, res) => {
  res.json({
    active: db.prepare('SELECT * FROM grocery_items WHERE checked = 0 ORDER BY position ASC').all(),
    recent: db
      .prepare('SELECT * FROM grocery_items WHERE checked = 1 ORDER BY checked_at DESC LIMIT 40')
      .all(),
  });
});

groceryRouter.post('/', (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });

  // Adding something already on the list just bumps it rather than duplicating —
  // two people adding "milk" from two rooms is the normal case, not an error.
  const existing = db
    .prepare('SELECT * FROM grocery_items WHERE checked = 0 AND lower(text) = lower(?)')
    .get(text);
  if (existing) {
    db.prepare('UPDATE grocery_items SET updated_at = ? WHERE id = ?').run(now(), existing.id);
    broadcast('grocery', 'touched');
    return res.status(200).json(existing);
  }

  const t = now();
  const info = db
    .prepare(
      `INSERT INTO grocery_items (text, source, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(text, String(req.body.source || 'local'), nextPosition('grocery_items'), t, t);
  broadcast('grocery', 'created');
  res.status(201).json(db.prepare('SELECT * FROM grocery_items WHERE id = ?').get(info.lastInsertRowid));
});

groceryRouter.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM grocery_items WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });

  const text = req.body.text !== undefined ? String(req.body.text).trim() : row.text;
  const checked = req.body.checked !== undefined ? (req.body.checked ? 1 : 0) : row.checked;
  const checkedAt = checked ? now() : null;
  // Re-adding from "recently bought" sends it back to the end of the active list.
  const position = !checked && row.checked ? nextPosition('grocery_items') : row.position;

  db.prepare(
    `UPDATE grocery_items SET text = ?, checked = ?, checked_at = ?, position = ?, dirty = 1, updated_at = ?
     WHERE id = ?`
  ).run(text, checked, checkedAt, position, now(), row.id);

  broadcast('grocery', 'updated');
  res.json(db.prepare('SELECT * FROM grocery_items WHERE id = ?').get(row.id));
});

groceryRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM grocery_items WHERE id = ?').run(req.params.id);
  broadcast('grocery', 'deleted');
  res.status(204).end();
});

/** Empty the "recently bought" shelf. */
groceryRouter.post('/clear-recent', (req, res) => {
  const info = db.prepare('DELETE FROM grocery_items WHERE checked = 1').run();
  broadcast('grocery', 'cleared');
  res.json({ removed: info.changes });
});
