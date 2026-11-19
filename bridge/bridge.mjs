// Postline PC bridge: Gmail <-> CloudKit. Runs on the open home network.
//   Gmail -> CloudKit: thread list + conversations are written to the public DB (records pl-state, pl-list-N, pl-t-<id>)
//   CloudKit -> Gmail: the app's requests in record pl-inbox (send, reply, read, archive, trash, star, open, search) are executed
// Usage: node bridge/bridge.mjs [--once]      (--once: one sync + one request pass, then exit)
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, STATE_FILE, here } from './config.mjs';
import { makeCk, PART } from './ck.mjs';

const cfg = loadConfig();
const ONCE = process.argv.includes('--once');
const log = (...a) => { const l = `${new Date().toISOString()} ${a.join(' ')}`; console.log(l); try { fs.appendFileSync(path.join(here, 'bridge.log'), l + '\n'); } catch { /* ignore */ } };
if (!fs.existsSync(cfg.ck.pemPath)) { console.error('CloudKit key not found at ' + cfg.ck.pemPath + ' (set ck.pemPath in bridge/config.json)'); process.exit(1); }

const ck = makeCk(cfg.ck);
let mail, account = '';
async function startBackend() {
  if (cfg.backend === 'api') mail = await (await import('./api-backend.mjs')).makeApiBackend(cfg);
  else mail = await (await import('./web-backend.mjs')).makeWebBackend(cfg, log);
  account = (mail.account || '').toLowerCase();
}

const S = (() => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } })();
S.threads ||= {}; S.sums ||= {}; S.done ||= {}; S.ver ||= 0; S.parts ||= 0; S.written ||= {};
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(S));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

async function detailRecord(id) {
  for (const o of [{}, { maxText: 15000, maxHtml: 0 }, { maxText: 4000, maxHtml: 0 }, { maxText: 500, maxHtml: 0 }]) {
    const { summary, detail } = await mail.fetchThread(id, o);
    const json = ck.pack(detail);
    if (json.length < 900000 || o.maxText === 500) return { summary, item: { name: `pl-t-${id}`, json, ver: Date.now() } };
  }
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
  const ids = await mail.listIds();
  for (const w of wanted) if (!ids.has(w)) ids.set(w, '');
  const changed = [...ids.entries()].filter(([id, h]) => wanted.includes(id) || !S.threads[id] || S.threads[id] !== h);
  const removed = Object.keys(S.sums).filter((id) => !ids.has(id));
  const writes = [];
  let touched = removed.length > 0;
  const rankOf = (id) => [...ids.keys()].indexOf(id);
  await pool(changed, 4, async ([id]) => {
    let r; try { r = await detailRecord(id); } catch (e) { if (/404|not found/i.test(e.message)) { delete S.sums[id]; touched = true; return; } throw e; }
    const { summary, item } = r;
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
  info.unread = await mail.unread();
  save(); await publishState();
  log(`sync: ${changed.length} changed, ${removed.length} removed, ${writes.length} conversations written, ${list.length} in list`);
  return changed.length;
}

async function execute(op) {
  switch (op.t) {
    case 'send': {
      if (!String(op.to || '').trim()) throw new Error('No recipient');
      return { res: await mail.send(op), mail: true };
    }
    case 'mark': await mail.mark(op.id, !!op.read); return { mail: true };
    case 'archive': await mail.archive(op.id); return { mail: true };
    case 'trash': await mail.trash(op.id); return { mail: true };
    case 'star': await mail.star(op.id, !!op.on); return { mail: true };
    case 'open': return { want: [op.id] };
    case 'refresh': return { mail: true };
    case 'search': {
      const sums = (await mail.search(String(op.q || ''))).sort((a, b) => b.date - a.date);
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

await startBackend();
log(`Postline bridge (${mail.name}) starting for ${account} -> ${cfg.ck.container} (${cfg.ck.environment})`);
await tick(true);
if (!ONCE) { for (;;) { await sleep(5000); await tick(pendingForce); pendingForce = false; } }
