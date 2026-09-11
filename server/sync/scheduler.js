import { db, now } from '../db.js';
import { env, loadConfig } from '../config.js';
import { syncCalendars, processQueue } from '../google/calendar.js';
import { syncTodos, todoistEnabled } from '../todoist/sync.js';
import { broadcast } from '../events.js';

/**
 * One in-process job loop. Two services would be tidier on paper and one more
 * thing to fail at 2am on a Pi; keep it here until it earns its own process.
 */
export function startScheduler() {
  const pollMs = Math.max(15, env.google.pollSeconds) * 1000;

  const runCalendar = async () => {
    try {
      await syncCalendars();
    } catch (err) {
      console.error('[scheduler] calendar sync error:', err.message);
    }
  };

  runCalendar();
  setInterval(runCalendar, pollMs).unref();

  // Outbound writes retry on their own cadence so a flaky link doesn't make
  // a tapped-in event wait a whole poll interval.
  const drain = async () => {
    const waiting = db.prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE target = 'google-calendar'").get().n;
    if (!waiting) return;
    try {
      await processQueue();
    } catch (err) {
      console.error('[scheduler] queue error:', err.message);
    }
  };
  setInterval(drain, 20 * 1000).unref();

  // Todoist: one request per cycle carries both directions. Silent no-op
  // until TODOIST_TOKEN is set.
  if (todoistEnabled()) {
    const runTodoist = () => syncTodos().catch((err) => console.error('[scheduler] todoist:', err.message));
    runTodoist();
    setInterval(runTodoist, Math.max(15, loadConfig().todo.pollSeconds) * 1000).unref();
  } else {
    console.log('[scheduler] Todoist sync off (no TODOIST_TOKEN)');
  }

  // Housekeeping every 10 minutes: age out completed items so the board looks
  // like a fresh whiteboard each morning.
  const housekeeping = () => {
    const cfg = loadConfig();
    const t = now();
    let touched = false;

    const todoCutoff = t - (cfg.behavior.clearDoneTodosAfterHours || 24) * 3600000;
    const todos = db.prepare('DELETE FROM todos WHERE done = 1 AND done_at IS NOT NULL AND done_at < ?').run(todoCutoff);
    if (todos.changes) { broadcast('todos', 'cleared'); touched = true; }

    const groceryCutoff = t - (cfg.behavior.clearBoughtGroceriesAfterHours || 72) * 3600000;
    const grocery = db
      .prepare('DELETE FROM grocery_items WHERE checked = 1 AND checked_at IS NOT NULL AND checked_at < ?')
      .run(groceryCutoff);
    if (grocery.changes) { broadcast('grocery', 'cleared'); touched = true; }

    if (touched) console.log('[scheduler] housekeeping removed aged items');
  };

  housekeeping();
  setInterval(housekeeping, 10 * 60 * 1000).unref();
}
