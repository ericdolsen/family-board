import path from 'node:path';
import express from 'express';
import { env, ROOT, loadConfig } from './config.js';
import { db } from './db.js';
import { todosRouter } from './routes/todos.js';
import { groceryRouter } from './routes/grocery.js';
import { mealsRouter } from './routes/meals.js';
import { notesRouter } from './routes/notes.js';
import { calendarRouter } from './routes/calendar.js';
import { doodleRouter } from './routes/doodle.js';
import { systemRouter } from './routes/system.js';
import { startScheduler } from './sync/scheduler.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' })); // drawings arrive as PNG data URLs

// LAN-only by design: no auth, no TLS, never expose this to the internet.
// See README "Security model".
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use('/api/todos', todosRouter);
app.use('/api/grocery', groceryRouter);
app.use('/api/meals', mealsRouter);
app.use('/api/notes', notesRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/doodle', doodleRouter);
app.use('/api', systemRouter);

app.use(express.static(path.join(ROOT, 'public'), { maxAge: 0 }));

app.use((err, req, res, next) => {
  console.error('[http]', err);
  res.status(500).json({ error: err.message });
});

const cfg = loadConfig();
const server = app.listen(env.port, env.host, () => {
  console.log(`[board] "${cfg.boardName}" listening on http://${env.host}:${env.port}`);
  startScheduler();
});

function shutdown(signal) {
  console.log(`[board] ${signal} received, closing`);
  server.close(() => {
    try { db.close(); } catch {}
    process.exit(0);
  });
  // systemd will SIGKILL eventually; don't hang on a stuck SSE client.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
