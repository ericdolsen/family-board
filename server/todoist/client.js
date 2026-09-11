/**
 * Minimal Todoist API v1 client. One endpoint does everything we need:
 * POST /api/v1/sync carries an incremental sync_token *and* a batch of write
 * commands in the same request, so a cycle is a single round trip.
 *
 * Auth is a personal API token (Todoist > Settings > Integrations > Developer).
 */
import crypto from 'node:crypto';

// Overridable so the adapter can be tested against a local stand-in.
const BASE = (process.env.TODOIST_API_BASE || 'https://api.todoist.com/api/v1').replace(/\/$/, '');

export class TodoistError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function makeClient(token) {
  const headers = { Authorization: `Bearer ${token}` };

  async function call(path, init = {}) {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const detail = body && typeof body === 'object' ? body.error || body.message || JSON.stringify(body) : String(body).slice(0, 200);
      throw new TodoistError(`Todoist ${res.status}: ${detail}`, res.status, body);
    }
    return body;
  }

  return {
    /**
     * @param {object} opts
     * @param {string} opts.syncToken  '*' for a full sync
     * @param {string[]} opts.resourceTypes
     * @param {object[]} [opts.commands]
     */
    sync({ syncToken = '*', resourceTypes = ['items'], commands = [] }) {
      const form = new URLSearchParams();
      form.set('sync_token', syncToken);
      form.set('resource_types', JSON.stringify(resourceTypes));
      if (commands.length) form.set('commands', JSON.stringify(commands));
      return call('/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
    },

    async listProjects() {
      const out = [];
      let cursor = null;
      do {
        const q = new URLSearchParams({ limit: '200' });
        if (cursor) q.set('cursor', cursor);
        const page = await call(`/projects?${q}`);
        out.push(...(page.results || []));
        cursor = page.next_cursor || null;
      } while (cursor);
      return out;
    },
  };
}

/** A write command in the shape the sync endpoint wants. */
export function command(type, args, tempId = null) {
  const cmd = { type, uuid: crypto.randomUUID(), args };
  if (tempId) cmd.temp_id = tempId;
  return cmd;
}
