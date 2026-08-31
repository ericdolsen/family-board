/**
 * Nightly SQLite backup. Uses the online backup API, so it is safe to run while
 * the board is being used — no need to stop the service.
 *
 * Run by familyboard-backup.timer. Keeps 14 days locally, and copies the newest
 * file to BACKUP_MIRROR if that is set (a USB stick, an SMB mount, wherever).
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../server/config.js';

const KEEP_DAYS = 14;
const stamp = new Date().toISOString().slice(0, 10);

fs.mkdirSync(env.backupDir, { recursive: true });
const target = path.join(env.backupDir, `board-${stamp}.db`);

const db = new Database(env.dbPath, { readonly: true });

try {
  await db.backup(target);
  console.log(`[backup] wrote ${target}`);
} finally {
  db.close();
}

// Prune old copies.
const cutoff = Date.now() - KEEP_DAYS * 86400000;
for (const name of fs.readdirSync(env.backupDir)) {
  if (!name.startsWith('board-') || !name.endsWith('.db')) continue;
  const file = path.join(env.backupDir, name);
  if (fs.statSync(file).mtimeMs < cutoff) {
    fs.unlinkSync(file);
    console.log(`[backup] pruned ${name}`);
  }
}

// Second location. Missing or unmounted mirror is a warning, never a failure —
// a board that won't boot because a USB stick fell out is worse than no mirror.
const mirror = process.env.BACKUP_MIRROR;
if (mirror) {
  try {
    fs.mkdirSync(mirror, { recursive: true });
    fs.copyFileSync(target, path.join(mirror, path.basename(target)));
    console.log(`[backup] mirrored to ${mirror}`);
  } catch (err) {
    console.warn(`[backup] mirror to ${mirror} failed: ${err.message}`);
  }
}
