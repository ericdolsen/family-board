import { Router } from 'express';
import { db } from '../db.js';
import { loadConfig } from '../config.js';
import { addClient, clientCount } from '../events.js';
import { calendarStatus } from '../google/calendar.js';

export const systemRouter = Router();

/** Everything the frontend needs to render itself. No secrets in here. */
systemRouter.get('/config', (req, res) => {
  const cfg = loadConfig();
  res.json({
    boardName: cfg.boardName,
    timezone: cfg.timezone,
    locale: cfg.locale,
    weekStartsOn: cfg.weekStartsOn,
    members: cfg.members,
    calendars: cfg.calendars.filter((c) => c.enabled !== false).map(({ id, label, member }) => ({ id, label, member })),
    display: cfg.display,
    behavior: cfg.behavior,
  });
});

/** The watchdog polls this. It must touch the DB so a wedged SQLite shows up. */
systemRouter.get('/healthz', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({
      ok: true,
      uptime: Math.round(process.uptime()),
      clients: clientCount(),
      calendar: calendarStatus(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

systemRouter.get('/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');
  addClient(res);

  // Comment frames keep proxies and sleepy Wi-Fi from closing an idle stream.
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => clearInterval(ping));
});
