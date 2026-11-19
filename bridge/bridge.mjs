// Postline PC bridge: Gmail <-> CloudKit. Runs on the open home network.
//   Gmail -> CloudKit: thread list + conversations are written to the public DB (records pl-state, pl-list-N, pl-t-<id>)
//   CloudKit -> Gmail: the app's requests in record pl-inbox (send, reply, read, archive, trash, star, open, search) are executed
// Usage: node bridge/bridge.mjs [--once]      (--once: one sync + one request pass, then exit)
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, GMAIL_TOKEN, STATE_FILE, here } from './config.mjs';
import { makeCk, PART } from './ck.mjs';
import { makeGmail, parseThread, buildRaw } from './gmail.mjs';

const cfg = loadConfig();
const ONCE = process.argv.includes('--once');
const log = (...a) => { const l = `${new Date().toISOString()} ${a.join(' ')}`; console.log(l); try { fs.appendFileSync(path.join(here, 'bridge.log'), l + '\n'); } catch { /* ignore */ } };
if (!fs.existsSync(GMAIL_TOKEN)) { console.error('Gmail is not connected yet. Run: node bridge/auth.mjs'); process.exit(1); }
if (!fs.existsSync(cfg.ck.pemPath)) { console.error('CloudKit key not found at ' + cfg.ck.pemPath + ' (set ck.pemPath in bridge/config.json)'); process.exit(1); }

const ck = makeCk(cfg.ck);
const { g } = makeGmail(GMAIL_TOKEN, cfg.google);
const account = JSON.parse(fs.readFileSync(GMAIL_TOKEN, 'utf8')).account || '';

const S = (() => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } })();
S.threads ||= {}; S.sums ||= {}; S.done ||= {}; S.ver ||= 0; S.parts ||= 0; S.written ||= {};
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(S));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

const getThread = (id) => g('GET', `/threads/${id}?format=full`);
function detailRecord(t) {
  for (const o of [{}, { maxText: 15000, maxHtml: 0 }, { maxText: 4000, maxHtml: 0 }]) {
    const { summary, detail } = parseThread(t, o);
    const json = ck.pack(detail);
    if (json.length < 900000) return { summary, item: { name: `pl-t-${t.id}`, json, ver: Date.now() } };
  }
  const { summary, detail } = parseThread(t, { maxText: 500, maxHtml: 0 });
  return { summary, item: { name: `pl-t-${t.id}`, json: ck.pack(detail), ver: Date.now() } };
}

let publishing = false, pendingForce = false, lastPublish = 0, info = { unread: 0 };
async function publishState(extra = {}) {
  const handled = Object.fromEntries(Object.entries(S.done).sort((a, b) => b[1].ts - a[1].ts).slice(0, 100).map(([k, v]) => [k, { ok: v.ok, err: v.err, ts: v.ts, ...(v.res || {}) }]));
  const body = { ts: Date.now(), online: true, account, ver: S.ver, parts: S.parts, unread: info.unread, handled, ...extra };
  await ck.save([{ name: 'pl-state', json: JSON.stringify(body), ver: Date.now() }]);
  lastPublish = Date.now();
}

/** Gmail -> CloudKit. Fetches only threads whose historyId changed. */
async function sync(wanted = []) {
  const ids = new Map();
  const add = async (label, max) => {
    const r = await g('GET', `/threads?labelIds=${label}&maxResults=${max}`);
    for (const t of r.threads || []) if (!ids.has(t.id)) ids.set(t.id, t.historyId);
  };
  await add('INBOX', cfg.inboxMax); await add('SENT', cfg.sentMax); await add('STARRED', cfg.starMax);
  for (const w of wanted) if (!ids.has(w)) ids.set(w, '');
  const changed = [...ids.entries()].filter(([id, h]) => wanted.includes(id) || !S.threads[id] || S.threads[id] !== h);
  const removed = Object.keys(S.sums).filter((id) => !ids.has(id));
  const writes = [];
  let touched = removed.length > 0;
  const rankOf = (id) => [...ids.keys()].indexOf(id);
  await pool(changed, 4, async ([id]) => {
    let t; try { t = await getThread(id); } catch (e) { if (/404/.test(e.message)) { delete S.sums[id]; touched = true; return; } throw e; }
    const { summary, item } = detailRecord(t);
    S.sums[id] = summary; S.threads[id] = summary.h; touched = true;
    if (wanted.includes(id) || S.written[id] || rankOf(id) < cfg.prewarm) { writes.push(item); S.written[id] = 1; }
  });
  for (const id of removed) { delete S.sums[id]; delete S.threads[id]; }
  if (!touched && S.ver) return 0;
  if (writes.length) await ck.save(writes);
  const list = Object.values(S.sums).sort((a, b) => b.date - a.date);
  const json = ck.pack(list);
  const ver = Date.now(), parts = Math.max(1, Math.ceil(json.length / PART));
  await ck.save(Array.from({ length: parts }, (_, i) => ({ name: `pl-list-${i}`, json: json.slice(i * PART, (i + 1) * PART), ver })));
  S.ver = ver; S.parts = parts;
  try { const l = await g('GET', '/labels/INBOX'); info.unread = l.threadsUnread || 0; } catch { /* ignore */ }
  save(); await publishState();
  log(`sync: ${changed.length} changed, ${removed.length} removed, ${writes.length} conversations written, ${list.length} in list`);
  return changed.length;
}

const modify = (id, add, remove) => g('POST', `/threads/${id}/modify`, { addLabelIds: add, removeLabelIds: remove });
async function execute(op) {
  switch (op.t) {
    case 'send': {
      if (!String(op.to || '').trim()) throw new Error('No recipient');
      const r = await g('POST', '/messages/send', { raw: buildRaw(op), ...(op.threadId ? { threadId: op.threadId } : {}) });
      return { res: { msg: r.id }, mail: true };
    }
    case 'mark': await modify(op.id, op.read ? [] : ['UNREAD'], op.read ? ['UNREAD'] : []); return { mail: true };
    case 'archive': await modify(op.id, [], ['INBOX']); return { mail: true };
    case 'trash': await g('POST', `/threads/${op.id}/trash`); return { mail: true };
    case 'star': await modify(op.id, op.on ? ['STARRED'] : [], op.on ? [] : ['STARRED']); return { mail: true };
    case 'open': return { want: [op.id] };
    case 'refresh': return { mail: true };
    case 'search': {
      const r = await g('GET', `/threads?q=${encodeURIComponent(String(op.q || '').slice(0, 200))}&maxResults=25`);
      const sums = (await pool(r.threads || [], 4, async (t) => parseThread(await getThread(t.id)).summary)).sort((a, b) => b.date - a.date);
      await ck.save([{ name: `pl-s-${op.id}`, json: ck.pack(sums), ver: Date.now() }]);
      return { res: { n: sums.length } };
    }
    default: throw new Error('Unknown request ' + op.t);
  }
}

/** CloudKit -> Gmail. Each request id runs once, even across restarts. */
async function processOps() {
  const [rec] = await ck.lookup(['pl-inbox']);
  const ops = ((ck.jsonOf(rec) || {}).ops || []).filter((o) => o && o.id && !S.done[o.id]).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (!ops.length) return { mail: false, want: [] };
  let mail = false; const want = [];
  for (const op of ops) {
    let rec2;
    try { const r = await execute(op); rec2 = { ok: true, ts: Date.now(), res: r.res }; if (r.mail) mail = true; if (r.want) want.push(...r.want); log('op ok', op.t, op.id); }
    catch (e) { rec2 = { ok: false, err: String(e.message).slice(0, 160), ts: Date.now() }; log('op FAILED', op.t, op.id, e.message); }
    S.done[op.id] = rec2; save();
  }
  const cutoff = Date.now() - 3 * 86400000;
  for (const k of Object.keys(S.done)) if (S.done[k].ts < cutoff) delete S.done[k];
  save(); await publishState();
  return { mail, want };
}

async function tick(force) {
  if (publishing) { pendingForce ||= force; return; }
  publishing = true;
  try {
    const { mail, want } = await processOps();
    if (force || mail || want.length || Date.now() - (S.lastSync || 0) > 25000) { await sync(want); S.lastSync = Date.now(); save(); }
    if (Date.now() - lastPublish > 40000) await publishState(); // heartbeat so the app can tell the PC is alive
  } catch (e) {
    log('ERROR', e.message);
    if (e.fatal) { log('Google refused the saved login — run: node bridge/auth.mjs'); process.exit(2); }
  } finally { publishing = false; }
}

log(`Postline bridge starting for ${account} -> ${cfg.ck.container} (${cfg.ck.environment})`);
await tick(true);
if (!ONCE) { for (;;) { await sleep(5000); await tick(pendingForce); pendingForce = false; } }
