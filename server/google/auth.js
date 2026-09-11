import fs from 'node:fs';
import path from 'node:path';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config.js';

// Loopback redirect for an "installed / desktop app" OAuth client. The auth
// script runs this same URI; on a headless Pi you forward the port over SSH.
export const REDIRECT_URI = 'http://localhost:5858/oauth2callback';

export function hasCredentials() {
  return Boolean(env.google.clientId && env.google.clientSecret);
}

export function hasToken() {
  return fs.existsSync(env.google.tokenPath);
}

export function saveToken(tokens) {
  fs.mkdirSync(path.dirname(env.google.tokenPath), { recursive: true });
  fs.writeFileSync(env.google.tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function newClient() {
  if (!hasCredentials()) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in .env');
  }
  return new OAuth2Client(env.google.clientId, env.google.clientSecret, REDIRECT_URI);
}

let cachedClient = null;
let cachedMtime = 0;

function tokenMtime() {
  try {
    return fs.statSync(env.google.tokenPath).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Returns an authorised client, or null when the board hasn't been linked yet.
 * Never throws on a missing token — a board with no calendar must still boot.
 *
 * The client is rebuilt whenever the token file changes on disk, so re-running
 * `npm run google-auth` (a new scope, a new account) takes effect without a
 * service restart.
 */
export function getAuthorizedClient() {
  const mtime = tokenMtime();
  if (cachedClient && mtime === cachedMtime) return cachedClient;
  if (!hasCredentials() || !mtime) return null;

  const client = newClient();
  client.setCredentials(JSON.parse(fs.readFileSync(env.google.tokenPath, 'utf8')));

  // Google issues the refresh token once; persist every refresh so a restart
  // never loses it.
  client.on('tokens', (tokens) => {
    const current = JSON.parse(fs.readFileSync(env.google.tokenPath, 'utf8'));
    saveToken({ ...current, ...tokens });
    cachedMtime = tokenMtime();
  });

  cachedClient = client;
  cachedMtime = mtime;
  return client;
}
