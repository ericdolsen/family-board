import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { env, loadConfig } from '../config.js';

export const debugRouter = Router();

const LOG = path.join(path.dirname(env.dbPath), 'touch-debug.log');
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Touch diagnostics. Off unless config.json has display.debugTouch: true.
 * The doodle posts a compact record of every pointer event it sees; this
 * appends them to data/touch-debug.log so they can be read back from any
 * browser on the LAN at /api/debug/touch. Meant for chasing a misbehaving
 * touch panel, then switched off again.
 */
debugRouter.post('/touch', (req, res) => {
  if (!loadConfig().display.debugTouch) return res.status(404).end();
  const lines = Array.isArray(req.body?.events) ? req.body.events : [];
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > MAX_BYTES) fs.truncateSync(LOG, 0);
    fs.appendFileSync(LOG, lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
  } catch (err) {
    console.error('[debug] touch log:', err.message);
  }
  res.status(204).end();
});

debugRouter.get('/touch', (req, res) => {
  const n = Math.min(Number(req.query.n) || 400, 5000);
  let text = '';
  try {
    const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n');
    text = lines.slice(-n).join('\n');
  } catch {
    text = '(no touch log yet — set display.debugTouch: true in config.json and draw something)';
  }
  res.type('text/plain').send(text);
});

debugRouter.delete('/touch', (req, res) => {
  try { fs.unlinkSync(LOG); } catch {}
  res.status(204).end();
});
