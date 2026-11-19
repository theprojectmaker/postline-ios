// One-time Google consent (OAuth 2.0 desktop / loopback flow with PKCE). Run:  node bridge/auth.mjs
// Needs bridge/config.json: { "google": { "clientId": "...", "clientSecret": "..." } }  (a Desktop-app OAuth client).
// Saves the offline refresh token to bridge/.secrets/gmail.json (gitignored).
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import { loadConfig, SECRETS, GMAIL_TOKEN } from './config.mjs';

const { google } = loadConfig();
if (!google.clientId || !google.clientSecret) { console.error('Put your Google OAuth client in bridge/config.json first — see bridge/README.md step 1.'); process.exit(1); }

const verifier = crypto.randomBytes(48).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const state = crypto.randomBytes(16).toString('hex');

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname !== '/') { res.writeHead(404).end(); return; }
  if (u.searchParams.get('state') !== state) { res.writeHead(400).end('state mismatch'); return; }
  const code = u.searchParams.get('code');
  if (!code) { res.writeHead(400).end('Google said: ' + (u.searchParams.get('error') || 'no code')); console.error('denied'); process.exit(1); }
  const port = server.address().port;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: google.clientId, client_secret: google.clientSecret, redirect_uri: `http://127.0.0.1:${port}`, grant_type: 'authorization_code', code_verifier: verifier }),
  });
  const j = await r.json();
  if (!j.refresh_token) { res.writeHead(500).end('No refresh token came back: ' + JSON.stringify(j)); console.error(j); process.exit(1); }
  const me = await (await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: 'Bearer ' + j.access_token } })).json();
  fs.mkdirSync(SECRETS, { recursive: true });
  fs.writeFileSync(GMAIL_TOKEN, JSON.stringify({ refresh_token: j.refresh_token, scope: j.scope, account: me.emailAddress, saved: new Date().toISOString() }, null, 2));
  res.writeHead(200, { 'Content-Type': 'text/html' }).end('<h2 style="font-family:system-ui">Postline is connected. You can close this tab.</h2>');
  console.log(`Connected ${me.emailAddress}. Token saved to bridge/.secrets/gmail.json`);
  setTimeout(() => process.exit(0), 300);
});
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: google.clientId, redirect_uri: `http://127.0.0.1:${port}`, response_type: 'code', access_type: 'offline', prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/gmail.modify', state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  console.log('Opening Google sign-in. If nothing opens, paste this into a browser:\n' + url + '\n');
  exec(`start "" "${url}"`);
});
