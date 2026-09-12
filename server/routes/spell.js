import { Router } from 'express';
import { db } from '../db.js';
import { loadConfig } from '../config.js';

export const spellRouter = Router();

const SOURCES = [
  'SELECT text AS t FROM todos',
  'SELECT text AS t FROM grocery_items',
  'SELECT name AS t FROM meals',
  "SELECT body AS t FROM notes WHERE kind = 'text'",
  'SELECT summary AS t FROM calendar_events',
  'SELECT location AS t FROM calendar_events WHERE location IS NOT NULL',
];

/**
 * Words the family already uses — every list item, event and note on the
 * board, plus everyone's name. Merged into the keyboard's dictionary ahead of
 * the base list so the board's own vocabulary always wins.
 */
spellRouter.get('/learned', (req, res) => {
  const counts = new Map(); // lowercase -> { form, n }
  const add = (text) => {
    for (const w of String(text || '').match(/[A-Za-z][A-Za-z']{1,}/g) || []) {
      const key = w.toLowerCase();
      const cur = counts.get(key);
      if (cur) cur.n += 1;
      else counts.set(key, { form: w, n: 1 });
    }
  };

  for (const sql of SOURCES) for (const row of db.prepare(sql).all()) add(row.t);
  for (const m of loadConfig().members || []) add(m.name);

  res.json(
    [...counts.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, 3000)
      .map((e) => e.form)
  );
});
