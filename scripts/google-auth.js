/**
 * One-time Google account link for the board.
 *
 *   npm run google-auth
 *
 * Opens a loopback OAuth flow on http://localhost:5858. On the Pi (no browser),
 * forward the port from your laptop first:
 *
 *   ssh -L 5858:localhost:5858 pi@familyboard.local
 *
 * ...then run the command over that SSH session and open the printed URL in the
 * laptop's browser. The refresh token is written to data/google-token.json with
 * 0600 permissions and never leaves the Pi.
 */
import http from 'node:http';
import { env } from '../server/config.js';
import { newClient, saveToken, REDIRECT_URI } from '../server/google/auth.js';

const PORT = 5858;
const client = newClient();

const authUrl = client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // force a refresh token even on a re-link
  scope: env.google.scopes,
});

console.log('\nScopes requested:');
for (const scope of env.google.scopes) console.log('  -', scope);
console.log('\nOpen this URL in a browser and approve the board:\n');
console.log(authUrl, '\n');

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) {
    res.writeHead(404).end('not found');
    return;
  }

  const url = new URL(req.url, REDIRECT_URI);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');

  if (error || !code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<h1>Authorisation failed</h1><p>${error || 'no code returned'}</p>`);
    server.close();
    process.exit(1);
  }

  try {
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      console.warn('\n! Google did not return a refresh token. Remove the board from');
      console.warn('  https://myaccount.google.com/permissions and run this again.\n');
    }
    saveToken(tokens);
    client.setCredentials(tokens);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Board linked.</h1><p>You can close this tab and go back to the terminal.</p>');
    console.log(`\nToken saved to ${env.google.tokenPath}\n`);

    // Print calendar ids so config.json can be filled in without hunting
    // through the Google Calendar settings UI.
    const { data } = await client.request({
      url: 'https://www.googleapis.com/calendar/v3/users/me/calendarList',
    });
    console.log('Calendars this account can see — copy the id into config.json:\n');
    for (const cal of data.items || []) {
      console.log(`  ${cal.summary}${cal.primary ? ' (primary)' : ''}`);
      console.log(`    id: ${cal.id}`);
      console.log(`    access: ${cal.accessRole}\n`);
    }
  } catch (err) {
    console.error('Token exchange failed:', err.message);
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 250);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Waiting for the redirect on ${REDIRECT_URI} ...`);
});
