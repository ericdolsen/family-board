import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(url.fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

dotenv.config({ path: path.join(ROOT, '.env') });

const resolve = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

export const env = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  dbPath: resolve(process.env.DB_PATH || './data/board.db'),
  configPath: resolve(process.env.CONFIG_PATH || './config.json'),
  backupDir: resolve(process.env.BACKUP_DIR || './backups'),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    tokenPath: resolve(process.env.GOOGLE_TOKEN_PATH || './data/google-token.json'),
    scopes: (process.env.GOOGLE_SCOPES || 'https://www.googleapis.com/auth/calendar.readonly')
      .split(/[\s,]+/)
      .filter(Boolean),
    pollSeconds: Number(process.env.CALENDAR_POLL_SECONDS || 60),
  },
};

const DEFAULTS = {
  boardName: 'Family Board',
  timezone: 'America/Denver',
  locale: 'en-US',
  weekStartsOn: 0,
  members: [],
  calendars: [],
  display: {
    theme: 'dark',
    autoTheme: true,
    dayStartsAt: '06:30',
    nightStartsAt: '21:00',
    nightDimPercent: 45,
    idleAfterMinutes: 0,
    nightlyReloadAt: '04:00',
  },
  behavior: {
    clearDoneTodosAfterHours: 24,
    clearBoughtGroceriesAfterHours: 72,
    onScreenKeyboardMinWidth: 1100,
  },
};

let cached = null;

/**
 * config.json is read fresh whenever its mtime changes, so editing family
 * members or calendars on the Pi doesn't need a service restart.
 */
export function loadConfig() {
  let stat = null;
  try {
    stat = fs.statSync(env.configPath);
  } catch {
    if (!cached) {
      console.warn(`[config] ${env.configPath} not found — using defaults. Copy config.example.json.`);
      cached = { mtime: 0, value: structuredClone(DEFAULTS) };
    }
    return cached.value;
  }

  if (cached && cached.mtime === stat.mtimeMs) return cached.value;

  try {
    const raw = JSON.parse(fs.readFileSync(env.configPath, 'utf8'));
    const value = {
      ...DEFAULTS,
      ...raw,
      display: { ...DEFAULTS.display, ...(raw.display || {}) },
      behavior: { ...DEFAULTS.behavior, ...(raw.behavior || {}) },
    };
    cached = { mtime: stat.mtimeMs, value };
  } catch (err) {
    console.error('[config] failed to parse config.json, keeping previous:', err.message);
    if (!cached) cached = { mtime: 0, value: structuredClone(DEFAULTS) };
  }
  return cached.value;
}
