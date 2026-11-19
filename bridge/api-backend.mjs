// Backend A: the Gmail API with an OAuth refresh token (only usable when the account allows third-party OAuth apps).
import fs from 'node:fs';
import { GMAIL_TOKEN } from './config.mjs';
import { makeGmail, parseThread, buildRaw } from './gmail.mjs';

export async function makeApiBackend(cfg) {
  if (!fs.existsSync(GMAIL_TOKEN)) throw new Error('Gmail API is not connected. Run: node bridge/auth.mjs');
  const { g } = makeGmail(GMAIL_TOKEN, cfg.google);
  const account = JSON.parse(fs.readFileSync(GMAIL_TOKEN, 'utf8')).account || '';
  const pool = async (items, n, fn) => { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; };
  const modify = (id, add, remove) => g('POST', `/threads/${id}/modify`, { addLabelIds: add, removeLabelIds: remove });
  return {
    name: 'api', account,
    async listIds() {
      const ids = new Map();
      for (const [label, max] of [['INBOX', cfg.inboxMax], ['SENT', cfg.sentMax], ['STARRED', cfg.starMax]]) {
        const r = await g('GET', `/threads?labelIds=${label}&maxResults=${max}`);
        for (const t of r.threads || []) if (!ids.has(t.id)) ids.set(t.id, t.historyId);
      }
      return ids;
    },
    async fetchThread(id, opts) { const t = await g('GET', `/threads/${id}?format=full`); return parseThread(t, opts); },
    async unread() { try { return (await g('GET', '/labels/INBOX')).threadsUnread || 0; } catch { return 0; } },
    async mark(id, read) { await modify(id, read ? [] : ['UNREAD'], read ? ['UNREAD'] : []); },
    async archive(id) { await modify(id, [], ['INBOX']); },
    async trash(id) { await g('POST', `/threads/${id}/trash`); },
    async star(id, on) { await modify(id, on ? ['STARRED'] : [], on ? [] : ['STARRED']); },
    async send(op) { const r = await g('POST', '/messages/send', { raw: buildRaw(op), ...(op.threadId ? { threadId: op.threadId } : {}) }); return { msg: r.id }; },
    async search(q) {
      const r = await g('GET', `/threads?q=${encodeURIComponent(String(q || '').slice(0, 200))}&maxResults=25`);
      return pool(r.threads || [], 4, async (t) => parseThread(await g('GET', `/threads/${t.id}?format=full`)).summary);
    },
    async close() {},
  };
}
