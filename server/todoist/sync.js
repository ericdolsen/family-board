/**
 * Two-way sync between the board's to-do list and one shared Todoist project.
 *
 * The board's SQLite table is the source of truth for what the wall shows;
 * Todoist is how phones and other people reach the same list. Each cycle:
 *
 *   1. push  — rows with dirty=1 become item_add / item_update /
 *              item_complete / item_uncomplete commands; queued deletes become
 *              item_delete. All in one request, with temp ids for new rows.
 *   2. pull  — incremental sync since the last sync_token; upsert items that
 *              belong to our project, drop ones that were deleted or moved.
 *
 * Nothing is ever dropped on failure: dirty rows stay dirty, queued deletes
 * stay queued, and the status endpoint says what went wrong.
 */
import { db, now, nextPosition, getSyncState, setSyncState } from '../db.js';
import { env, loadConfig } from '../config.js';
import { broadcast } from '../events.js';
import { makeClient, command, TodoistError } from './client.js';

let client = null;
let lastError = null;
let lastSyncAt = null;
let running = false;
let kickTimer = null;

export const todoistEnabled = () => Boolean(env.todoist.token);

function getClient() {
  if (!todoistEnabled()) return null;
  if (!client) client = makeClient(env.todoist.token);
  return client;
}

/** Run a cycle soon, coalescing a burst of taps into one request. */
export function kickTodoist() {
  if (!todoistEnabled()) return;
  clearTimeout(kickTimer);
  kickTimer = setTimeout(() => syncTodos().catch((err) => console.error('[todoist]', err.message)), 700);
  kickTimer.unref?.();
}

// ---------------------------------------------------------------- project

async function ensureProject(api) {
  const wanted = loadConfig().todo.todoistProject;
  const cached = getSyncState('todoist:project_id');
  const cachedName = getSyncState('todoist:project_name');
  if (cached && cachedName === wanted) return cached;

  const projects = await api.listProjects();
  let project = projects.find((p) => p.name.toLowerCase() === wanted.toLowerCase());

  if (!project) {
    // First run on a fresh account: make the project so the family has
    // something to share. Everything else about the account is left alone.
    const tempId = `proj-${Date.now()}`;
    const res = await api.sync({ syncToken: '*', resourceTypes: ['projects'], commands: [command('project_add', { name: wanted }, tempId)] });
    const id = res.temp_id_mapping?.[tempId];
    if (!id) throw new Error(`could not create Todoist project "${wanted}"`);
    project = { id, name: wanted };
    console.log(`[todoist] created project "${wanted}"`);
  }

  setSyncState('todoist:project_id', project.id);
  setSyncState('todoist:project_name', wanted);
  // A new project means our old sync token is meaningless.
  setSyncState('todoist:sync_token', null);
  return project.id;
}

// ---------------------------------------------------------------- push

/** Board rows that existed before Todoist was switched on get sent up once. */
function adoptLocalRows() {
  if (getSyncState('todoist:adopted')) return;
  db.prepare("UPDATE todos SET dirty = 1 WHERE ext_id IS NULL AND done = 0").run();
  setSyncState('todoist:adopted', '1');
}

async function push(api, projectId) {
  const dirty = db.prepare('SELECT * FROM todos WHERE dirty = 1').all();
  const deletes = db.prepare("SELECT * FROM sync_queue WHERE target = 'todoist' AND op = 'delete'").all();
  if (!dirty.length && !deletes.length) return false;

  const commands = [];
  const byUuid = new Map(); // uuid -> { kind, row | job, tempId }

  for (const row of dirty) {
    if (!row.ext_id) {
      if (row.done) {
        // Done before it ever reached Todoist: nothing worth creating.
        db.prepare('UPDATE todos SET dirty = 0 WHERE id = ?').run(row.id);
        continue;
      }
      const tempId = `todo-${row.id}-${Date.now()}`;
      const cmd = command('item_add', { content: row.text, project_id: projectId }, tempId);
      commands.push(cmd);
      byUuid.set(cmd.uuid, { kind: 'add', row, tempId });
    } else {
      const upd = command('item_update', { id: row.ext_id, content: row.text });
      const state = command(row.done ? 'item_complete' : 'item_uncomplete', { id: row.ext_id });
      commands.push(upd, state);
      byUuid.set(upd.uuid, { kind: 'update', row });
      byUuid.set(state.uuid, { kind: 'state', row });
    }
  }

  for (const job of deletes) {
    const cmd = command('item_delete', { id: job.entity_id });
    commands.push(cmd);
    byUuid.set(cmd.uuid, { kind: 'delete', job });
  }

  if (!commands.length) return false;

  const res = await api.sync({ syncToken: getSyncState('todoist:sync_token') || '*', resourceTypes: ['items'], commands });
  const status = res.sync_status || {};
  const mapping = res.temp_id_mapping || {};
  const failed = [];

  db.transaction(() => {
    for (const [uuid, meta] of byUuid) {
      const result = status[uuid];
      const ok = result === 'ok';
      if (!ok) {
        const message = result?.error || JSON.stringify(result);
        // Editing something Todoist no longer has: Todoist is the shared
        // truth, so the local copy goes too.
        if (/not found|does not exist|invalid.*id/i.test(message) && meta.row?.ext_id) {
          db.prepare('DELETE FROM todos WHERE id = ?').run(meta.row.id);
          console.warn(`[todoist] "${meta.row.text}" no longer exists on Todoist; removed locally`);
          continue;
        }
        if (meta.kind === 'delete' && /not found|does not exist/i.test(message)) {
          db.prepare('DELETE FROM sync_queue WHERE id = ?').run(meta.job.id);
          continue;
        }
        failed.push(`${meta.kind}: ${message}`);
        continue;
      }
      switch (meta.kind) {
        case 'add': {
          const id = mapping[meta.tempId];
          if (id) {
            db.prepare("UPDATE todos SET ext_id = ?, source = 'todoist', dirty = 0, updated_at = ? WHERE id = ?")
              .run(id, now(), meta.row.id);
          }
          break;
        }
        case 'update':
        case 'state':
          db.prepare('UPDATE todos SET dirty = 0 WHERE id = ?').run(meta.row.id);
          break;
        case 'delete':
          db.prepare('DELETE FROM sync_queue WHERE id = ?').run(meta.job.id);
          break;
      }
    }
  })();

  // The push response is itself an incremental sync; apply it and keep the token.
  applyItems(res, projectId);

  if (failed.length) throw new Error(failed.join('; '));
  return true;
}

// ---------------------------------------------------------------- pull

const findByExt = db.prepare("SELECT * FROM todos WHERE ext_id = ? AND source = 'todoist'");

/** Apply a sync response's items to the local table. Returns true if anything changed. */
function applyItems(res, projectId) {
  const items = res.items || [];
  let changed = false;

  db.transaction(() => {
    const seen = new Set();
    for (const item of items) {
      const local = findByExt.get(item.id);
      const inProject = item.project_id === projectId;

      if (item.is_deleted || !inProject) {
        if (local) {
          db.prepare('DELETE FROM todos WHERE id = ?').run(local.id);
          changed = true;
        }
        continue;
      }
      seen.add(item.id);

      const done = item.checked ? 1 : 0;
      const doneAt = done ? (Date.parse(item.completed_at || '') || local?.done_at || now()) : null;

      if (!local) {
        if (done) continue; // completed before we ever saw it
        db.prepare(
          `INSERT INTO todos (text, done, done_at, member, position, source, ext_id, dirty, created_at, updated_at)
           VALUES (?, 0, NULL, NULL, ?, 'todoist', ?, 0, ?, ?)`
        ).run(item.content, nextPosition('todos'), item.id, Date.parse(item.added_at || '') || now(), now());
        changed = true;
      } else if (!local.dirty) {
        // Only overwrite rows with no unsent local change; those win next push.
        if (local.text !== item.content || local.done !== done) {
          db.prepare('UPDATE todos SET text = ?, done = ?, done_at = ?, updated_at = ? WHERE id = ?')
            .run(item.content, done, doneAt, now(), local.id);
          changed = true;
        }
      }
    }

    // A full sync lists every live item; anything of ours it doesn't mention
    // was deleted while we weren't looking.
    if (res.full_sync) {
      const stale = db.prepare("SELECT id, ext_id FROM todos WHERE source = 'todoist' AND ext_id IS NOT NULL AND dirty = 0").all();
      for (const row of stale) {
        if (!seen.has(row.ext_id)) {
          db.prepare('DELETE FROM todos WHERE id = ?').run(row.id);
          changed = true;
        }
      }
    }
  })();

  if (res.sync_token) setSyncState('todoist:sync_token', res.sync_token);
  return changed;
}

async function pull(api, projectId) {
  const res = await api.sync({ syncToken: getSyncState('todoist:sync_token') || '*', resourceTypes: ['items'] });
  return applyItems(res, projectId);
}

// ---------------------------------------------------------------- cycle

export async function syncTodos() {
  const api = getClient();
  if (!api || running) return { skipped: api ? 'busy' : 'disabled' };
  running = true;
  let changed = false;

  try {
    const projectId = await ensureProject(api);
    adoptLocalRows();
    changed = (await push(api, projectId)) || changed;
    changed = (await pull(api, projectId)) || changed;
    lastError = null;
  } catch (err) {
    lastError = err.message;
    if (err instanceof TodoistError && (err.status === 401 || err.status === 403)) {
      lastError = `Todoist rejected the token (${err.status}). Check TODOIST_TOKEN in .env.`;
    }
    console.error('[todoist]', lastError);
  } finally {
    running = false;
    lastSyncAt = now();
    setSyncState('todoist:last_sync', lastSyncAt);
  }

  if (changed) broadcast('todos', 'synced');
  return { changed, lastError };
}

export function todoistStatus() {
  const pending = db.prepare('SELECT COUNT(*) AS n FROM todos WHERE dirty = 1').get().n;
  const deletes = db.prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE target = 'todoist'").get().n;
  return {
    enabled: todoistEnabled(),
    project: getSyncState('todoist:project_name'),
    projectId: getSyncState('todoist:project_id'),
    lastSyncAt: lastSyncAt || Number(getSyncState('todoist:last_sync')) || null,
    lastError,
    pendingPush: pending + deletes,
  };
}
