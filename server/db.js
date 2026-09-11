import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env, ROOT } from './config.js';

fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });

export const db = new Database(env.dbPath);

// WAL keeps readers (the board, phones) from blocking the sync writer, and
// survives power loss far better than the default rollback journal.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8'));

// Additive migrations for databases created before a column existed. schema.sql
// only ever CREATEs IF NOT EXISTS, so new columns have to be bolted on here.
function ensureColumn(table, column, definition) {
  const has = db.pragma(`table_info(${table})`).some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn('notes', 'thumb', 'TEXT');
// NULL = in sync with Google; 'create' | 'update' | 'delete' = waiting to go out.
ensureColumn('calendar_events', 'pending', 'TEXT');

export const now = () => Date.now();

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, String(value), now());
}

export function getSyncState(key, fallback = null) {
  const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSyncState(key, value) {
  db.prepare(
    `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value == null ? null : String(value), now());
}

/** Next sort position for an append-to-end insert. */
export function nextPosition(table) {
  const row = db.prepare(`SELECT COALESCE(MAX(position), 0) AS max FROM ${table}`).get();
  return row.max + 1000;
}
