// Minimal Gmail REST client (OAuth refresh token, no googleapis dependency) + message parsing/building.
import fs from 'node:fs';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
let access = { token: '', exp: 0 };

export function makeGmail(secretsFile, google) {
  async function token() {
    if (access.token && Date.now() < access.exp - 60000) return access.token;
    const t = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: google.clientId, client_secret: google.clientSecret, refresh_token: t.refresh_token, grant_type: 'refresh_token' }),
    });
    const j = await res.json();
    if (!res.ok) throw Object.assign(new Error(`Google token refresh failed: ${j.error} ${j.error_description || ''} (run: node bridge/auth.mjs)`), { fatal: j.error === 'invalid_grant' });
    access = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return access.token;
  }
  async function g(method, path, body, tries = 4) {
    let last;
    for (let a = 0; a < tries; a++) {
      const res = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
      if (res.status === 401) { access = { token: '', exp: 0 }; last = new Error('Gmail 401'); continue; }
      if (res.status === 429 || res.status >= 500) { last = new Error(`Gmail ${res.status}`); await new Promise((r) => setTimeout(r, 1500 * 2 ** a)); continue; }
      const text = await res.text();
      const j = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(`Gmail ${method} ${path} -> ${res.status} ${(j.error && j.error.message) || text.slice(0, 120)}`);
      return j;
    }
    throw last;
  }
  return { g };
}

const b64u = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const hdr = (m, n) => { const h = ((m.payload && m.payload.headers) || []).find((x) => x.name.toLowerCase() === n.toLowerCase()); return h ? h.value : ''; };
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', zwnj: '', zwj: '' };
export function htmlToText(h) {
  return h.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d|table|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') { const c = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(c); } catch { return ''; } }
      const v = ENT[e.toLowerCase()]; return v === undefined ? m : v;
    })
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A Gmail message resource (format=full) -> the compact form the app stores. */
export function parseMessage(m, maxText = 60000, maxHtml = 120000) {
  let text = '', html = ''; const atts = [];
  (function walk(p) {
    if (!p) return;
    if (p.filename && p.body && p.body.attachmentId) atts.push({ name: p.filename, size: p.body.size || 0, type: p.mimeType });
    else if (p.mimeType === 'text/plain' && p.body && p.body.data && !text) text = b64u(p.body.data);
    else if (p.mimeType === 'text/html' && p.body && p.body.data && !html) html = b64u(p.body.data);
    (p.parts || []).forEach(walk);
  })(m.payload);
  if (!text && html) text = htmlToText(html);
  const labels = m.labelIds || [];
  return {
    id: m.id, from: hdr(m, 'From'), to: hdr(m, 'To'), cc: hdr(m, 'Cc'), subject: hdr(m, 'Subject'), date: Number(m.internalDate) || 0,
    msgid: hdr(m, 'Message-ID') || hdr(m, 'Message-Id'), refs: hdr(m, 'References'), unread: labels.includes('UNREAD'), labels,
    text: text.length > maxText ? text.slice(0, maxText) + '\n…(trimmed)' : text,
    html: html && html.length <= maxHtml && /<(table|img|a |b>|strong|font|span|div)/i.test(html) ? html : '',
    atts, snippet: m.snippet || '',
  };
}

const LABEL_FLAGS = { INBOX: 'inbox', SENT: 'sent', STARRED: 'star', IMPORTANT: 'imp', DRAFT: 'draft', SPAM: 'spam', TRASH: 'trash' };
/** Thread resource -> {summary, detail}. */
export function parseThread(t, opts = {}) {
  const msgs = (t.messages || []).map((m) => parseMessage(m, opts.maxText, opts.maxHtml));
  const last = msgs[msgs.length - 1] || {};
  const first = msgs[0] || {};
  const labels = [...new Set(msgs.flatMap((m) => m.labels))];
  const flags = labels.map((l) => LABEL_FLAGS[l]).filter(Boolean);
  // the list line shows the latest message that is not from me when there is one (like Mail), else the latest
  const other = [...msgs].reverse().find((m) => !m.labels.includes('SENT')) || last;
  const summary = {
    id: t.id, h: t.historyId, subject: first.subject || '(no subject)', from: other.from || last.from, snippet: last.snippet || '', date: last.date || 0,
    unread: msgs.some((m) => m.unread), n: msgs.length, flags, att: msgs.some((m) => m.atts.length > 0),
  };
  return { summary, detail: { id: t.id, h: t.historyId, subject: first.subject || '(no subject)', msgs, flags } };
}

const enc2047 = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const clean = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();
/** Builds the raw RFC 2822 message for messages.send (base64url). */
export function buildRaw(op) {
  const lines = [`To: ${clean(op.to)}`];
  if (clean(op.cc)) lines.push(`Cc: ${clean(op.cc)}`);
  if (clean(op.bcc)) lines.push(`Bcc: ${clean(op.bcc)}`);
  lines.push(`Subject: ${enc2047(clean(op.subject))}`);
  if (op.inReplyTo) lines.push(`In-Reply-To: ${clean(op.inReplyTo)}`, `References: ${clean([op.references, op.inReplyTo].filter(Boolean).join(' '))}`);
  lines.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '');
  const body = Buffer.from(String(op.body || ''), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return Buffer.from(lines.join('\r\n') + '\r\n' + body, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
