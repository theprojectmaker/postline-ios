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

// single instance: a second copy would fight over the same Chrome profile
import('node:net').then(({ default: net }) => net.createServer().on('error', () => { console.error('Another Postline bridge is already running.'); process.exit(3); }).listen(8793, '127.0.0.1')).catch(() => {});
const ck = makeCk(cfg.ck);
let mail, account = '';
async function startBackend() {
  if (cfg.backend === 'api') mail = await (await import('./api-backend.mjs')).makeApiBackend(cfg);
  else mail = await (await import('./web-backend.mjs')).makeWebBackend(cfg, log);
  account = (mail.account || '').toLowerCase();
}

// ---- people directory: addresses seen in mail + the school directory crawled through Gmail's suggestions
const addrRe = /"?([^",<>;]*?)"?s*<([^<>s]+@[^<>s]+)>|([w.+-]+@[w-]+(?:.[w-]+)+)/g;
function harvest(text) {
  let n = 0; if (!text) return n;
  for (const m of String(text).matchAll(addrRe)) {
    const email = (m[2] || m[3] || '').toLowerCase().replace(/[.,;]+$/, ''); if (!email || /noreply|no-reply|donotreply|mailer-daemon/.test(email)) continue;
    const name = (m[1] || '').trim(); const c = S.contacts[email] || (S.contacts[email] = { n: '', c: 0 });
    if (name && name.toLowerCase() !== email && (!c.n || name.length > c.n.length || /^[a-z]/.test(c.n))) c.n = name;
    c.c++; n++; S.cdirty = 1;
  }
  return n;
}
const S = (() => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } })();
S.push ||= {}; S.notified ||= {}; S.pushSince ||= Date.now();
S.contacts ||= {}; S.crawl ||= { q: 'abcdefghijklmnopqrstuvwxyz'.split(''), done: 0 }; S.cver ||= 0; S.cparts ||= 0;
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
    if (o.maxText === undefined) detail.msgs.forEach((m) => harvest([m.from, m.to, m.cc].filter(Boolean).join(', ')));
    const json = ck.pack(detail);
    if (json.length < 900000 || o.maxText === 500) return { summary, item: { name: `pl-t-${id}`, json, ver: Date.now() } };
  }
}

let lastTickDone = Date.now();
let publishing = false, pendingForce = false, lastPublish = 0, info = { unread: 0 };
async function publishState(extra = {}) {
  const handled = Object.fromEntries(Object.entries(S.done).sort((a, b) => b[1].ts - a[1].ts).slice(0, 100).map(([k, v]) => [k, { ok: v.ok, err: v.err, ts: v.ts, ...(v.res || {}) }]));
  const body = { ts: Date.now(), online: true, account, ver: S.ver, parts: S.parts, cver: S.cver, cparts: S.cparts, ccount: Object.keys(S.contacts).length, crawlLeft: S.crawl.q.length, unread: info.unread, handled, ...extra };
  await ck.save([{ name: 'pl-state', json: ck.pack(body), ver: Date.now() }]);
  lastPublish = Date.now();
}

/** Gmail -> CloudKit. Fetches only threads whose historyId changed. */
async function sync(wanted = []) {
  const T0 = Date.now();
  const ids = await mail.listIds();
  const tList = Date.now() - T0;
  for (const w of wanted) if (!ids.has(w)) ids.set(w, '');
  const changed = [...ids.entries()].filter(([id, h]) => wanted.includes(id) || !S.threads[id] || S.threads[id] !== h);
  const removed = Object.keys(S.sums).filter((id) => !ids.has(id));
  const writes = [];
  let fetchedNow = 0;
  let touched = removed.length > 0;
  const rankOf = (id) => [...ids.keys()].indexOf(id);
  await pool(changed, 4, async ([id, h]) => {
    const must = wanted.includes(id), nice = S.written[id] || rankOf(id) < cfg.prewarm;
    if (mail.summaryOf && !must && (!nice || fetchedNow >= 4) && mail.summaryOf(id)) { S.sums[id] = mail.summaryOf(id); S.threads[id] = h; touched = true; return; } // list line is enough until it is opened
    fetchedNow++;
    let r;
    try { r = await detailRecord(id); }
    catch (e) {
      if (/404|not found/i.test(e.message)) { delete S.sums[id]; touched = true; return; }
      if (/browser has been closed|context or browser|Target page, context/i.test(e.message)) throw e;
      log('skipping one conversation:', String(e.message).split('\n')[0].slice(0, 90));
      if (mail.summaryOf && mail.summaryOf(id)) { S.sums[id] = mail.summaryOf(id); touched = true; } // still show it from its list line
      return;
    }
    const { summary, item } = r;
    harvest(summary.from);
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
  await notifyNew();
  save(); await publishState();
  log(`timing: lists ${Math.round(tList / 1000)}s, conversations ${fetchedNow} in ${Math.round((Date.now() - T0 - tList) / 1000)}s`);
  log(`sync: ${changed.length} changed, ${removed.length} removed, ${writes.length} conversations written, ${list.length} in list`);
  return changed.length;
}

// ---- notifications: Expo's push service (reachable from this PC) -> Apple's push service -> the iPad (works on an Apple-only Wi-Fi)
const EXPO_PROJECT = '21d149c3-60cd-45cc-8ee1-1275ff65ff35', APP_ID = 'com.solyapps.postline';
const expoPost = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
async function sendPush(msgs) {
  const tokens = Object.keys(S.push);
  if (!msgs.length || !tokens.length) return;
  const res = await expoPost('https://exp.host/--/api/v2/push/send', msgs.flatMap((m) => tokens.map((to) => ({ to, sound: 'default', priority: 'high', ...m }))));
  const j = await res.json().catch(() => ({}));
  (j.data || []).forEach((t, i) => { if (t && t.status === 'error' && /DeviceNotRegistered/.test((t.details || {}).error || '')) delete S.push[tokens[i % tokens.length]]; });
  log(`push: sent ${msgs.length} to ${tokens.length} device(s) -> ${res.status}`);
  (j.data || []).forEach((t) => { if (t && t.status === 'error') log('push ticket error:', String(t.message || '').slice(0, 160), '|', JSON.stringify(t.details || {}).slice(0, 120)); else if (t) log('push ticket ok'); });
}
const nameOf = (s = '') => { const m = String(s).match(/^\s*"?([^"<]*?)"?\s*</); return (m && m[1].trim()) || String(s).split('@')[0] || 'New mail'; };
async function notifyNew() {
  if (!Object.keys(S.push).length) return;
  const out = [];
  for (const t of Object.values(S.sums)) {
    if (!t.unread || !(t.flags || []).includes('inbox') || t.date <= S.pushSince) continue;
    const key = t.id + ':' + t.n; if (S.notified[key]) continue;
    S.notified[key] = Date.now();
    if (account && String(t.from || '').toLowerCase().includes(account)) continue; // my own message
    out.push({ title: nameOf(t.from), body: (t.subject || '(no subject)') + (t.snippet ? ' — ' + t.snippet.slice(0, 90) : ''), data: { kind: 'mail', id: t.id } });
  }
  const keys = Object.keys(S.notified); if (keys.length > 400) keys.sort((a, b) => S.notified[a] - S.notified[b]).slice(0, keys.length - 300).forEach((k) => delete S.notified[k]);
  if (out.length) await sendPush(out.slice(0, 6)).catch((e) => log('push failed', e.message));
}

async function execute(op) {
  switch (op.t) {
    case 'pushreg': { // the iPad cannot reach Expo itself on the school Wi-Fi: make the registration here on its behalf
      const b = (op.body && typeof op.body === 'object') ? op.body : {};
      const reg = { type: 'apns', deviceId: String(b.deviceId || '').toLowerCase().slice(0, 80), development: !!b.development, appId: APP_ID, deviceToken: String(b.deviceToken || ''), projectId: EXPO_PROJECT };
      if (!/^[0-9a-f]{32,200}$/i.test(reg.deviceToken) || !/^[\w-]{8,80}$/.test(reg.deviceId)) return { res: { dropped: 1 } };
      const res = await expoPost('https://exp.host/--/api/v2/push/getExpoPushToken', reg);
      const j = await res.json().catch(() => ({}));
      const tok = String(((j || {}).data || {}).expoPushToken || '');
      if (!/^ExponentPushToken\[[\w-]+\]$/.test(tok)) throw new Error('Expo refused the registration (' + res.status + ')');
      S.push[tok] = { at: Date.now() }; S.pushSince = Date.now();
      await sendPush([{ title: 'Postline', body: 'Notifications are on. New mail will pop up here.', data: { kind: 'test' } }]);
      return { res: { registered: 1 } };
    }
    case 'push': { // a device that could reach Expo itself sent its token
      const tok = String(op.token || '');
      if (!/^ExponentPushToken\[[\w-]+\]$/.test(tok)) return { res: { dropped: 1 } };
      if (!S.push[tok]) { S.push[tok] = { at: Date.now() }; S.pushSince = Date.now(); await sendPush([{ title: 'Postline', body: 'Notifications are on. New mail will pop up here.', data: { kind: 'test' } }]); }
      return { res: { registered: 1 } };
    }
    case 'pushtest': await sendPush([{ title: 'Postline', body: 'Notifications are working ✓', data: { kind: 'test' } }]); return { res: { sent: Object.keys(S.push).length } };
    case 'suggest': {
      if (!mail.suggest) throw new Error('This backend has no directory search');
      const rows = await mail.suggest(String(op.q || '').slice(0, 40));
      rows.forEach((r) => { const c = S.contacts[r.e.toLowerCase()] || (S.contacts[r.e.toLowerCase()] = { n: '', c: 0 }); if (r.n) c.n = r.n; c.c++; S.cdirty = 1; });
      await ck.save([{ name: `pl-g-${op.id}`, json: ck.pack(rows.map((r) => ({ e: r.e.toLowerCase(), n: r.n }))), ver: Date.now() }]);
      return { res: { n: rows.length } };
    }
    case 'send': {
      if (!String(op.to || '').trim() && !String(op.bcc || '').trim()) throw new Error('No recipient');
      return { res: await mail.send(op), mail: true };
    }
    case 'mark': await mail.mark(op.th, !!op.read); return { mail: true };
    case 'archive': await mail.archive(op.th); return { mail: true };
    case 'trash': await mail.trash(op.th); return { mail: true };
    case 'star': await mail.star(op.th, !!op.on); return { mail: true };
    case 'open': return { want: [op.th] };
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
  if (!ops.length) return { mail: false, want: [], sent: false };
  let mail = false, sent = false; const want = [];
  for (const op of ops) {
    let rec2;
    try { const r = await execute(op); rec2 = { ok: true, ts: Date.now(), res: r.res }; if (r.mail) mail = true; if (op.t === 'send') sent = true; if (r.want) want.push(...r.want); log('op ok', op.t, op.id); }
    catch (e) {
      const transient = /browser has been closed|context or browser|Target page, context|Timeout|Navigation|net::|crash/i.test(e.message);
      S.tries = S.tries || {}; S.tries[op.id] = (S.tries[op.id] || 0) + 1;
      if (transient && S.tries[op.id] < 4) { log('op will retry', op.t, op.id, '(' + S.tries[op.id] + ')', String(e.message).split('\n')[0].slice(0, 80)); save(); await sleep(3000); continue; }
      rec2 = { ok: false, err: String(e.message).split('\n')[0].slice(0, 160), ts: Date.now() }; log('op FAILED', op.t, op.id, String(e.message).split('\n')[0]);
    }
    S.done[op.id] = rec2; save();
    await publishState().catch(() => {}); // the app's spinner ends as soon as THIS request is done
  }
  const cutoff = Date.now() - 3 * 86400000;
  for (const k of Object.keys(S.done)) if (S.done[k].ts < cutoff) delete S.done[k];
  save();
  return { mail, want, sent };
}

// Writes the contact list when it changed (parts like the mailbox list). Sorted so frequent contacts come first.
async function publishContacts() {
  if (!S.cdirty) return; S.cdirty = 0;
  const list = Object.entries(S.contacts).map(([e, v]) => ({ e, n: v.n || '', c: v.c })).sort((a, b) => b.c - a.c);
  const json = ck.pack(list), ver = Date.now(), parts = Math.max(1, Math.ceil(json.length / PART));
  await ck.save(Array.from({ length: parts }, (_, i) => ({ name: `pl-contacts-${i}`, json: json.slice(i * PART, (i + 1) * PART), ver })));
  S.cver = ver; S.cparts = parts; save(); await publishState();
  log(`contacts: ${list.length} published`);
}

// Background crawl of the school directory: every 2-letter-and-longer prefix that fills Gmail's suggestion list is split further.
async function crawlLoop() {
  if (!mail.suggest) return;
  let lastPub = 0, finished = false;
  const worker = async () => {
    for (;;) {
      await sleep(250);
      if (publishing) { await sleep(1500); continue; } // mail work always goes first
      if (fs.existsSync(path.join(here, 'PAUSE'))) { await sleep(5000); continue; }
      const q = S.crawl.q.shift();
      if (!q) {
        if (!finished && S.crawl.done) { finished = true; log(`directory crawl finished: ${Object.keys(S.contacts).length} people`); }
        await sleep(30000); if (S.cdirty && Date.now() - lastPub > 60000) { lastPub = Date.now(); await publishContacts().catch(() => {}); }
        continue;
      }
      finished = false;
      try {
        const rows = await mail.suggest(q);
        for (const r of rows) { const e = r.e.toLowerCase(); const c = S.contacts[e] || (S.contacts[e] = { n: '', c: 0 }); if (r.n) c.n = r.n; S.cdirty = 1; }
        // a full suggestion list means more people share this prefix: split it by the next letter (down to 5 letters)
        if (rows.length >= 8 && q.length < 5) for (const ch of 'abcdefghijklmnopqrstuvwxyz') S.crawl.q.push(q + ch);
        S.crawl.done++;
        if (S.crawl.done % 25 === 0) save();
        if (S.cdirty && Date.now() - lastPub > 60000) { lastPub = Date.now(); await publishContacts(); }
      } catch (e) { S.crawl.q.unshift(q); log('crawl error', e.message); if (/browser has been closed|context or browser|Target page, context/i.test(e.message)) process.exit(4); await sleep(20000); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

// ---- live inbox: notice new mail within seconds, publish the list line at once and push-notify (full conversations follow on the next sync)
let listChain = Promise.resolve();
async function publishListNow() {
  const run = listChain.then(async () => {
    const list = Object.values(S.sums).sort((a, b) => b.date - a.date);
    const json = ck.pack(list), ver = Date.now(), parts = Math.max(1, Math.ceil(json.length / PART));
    await ck.save(Array.from({ length: parts }, (_, i) => ({ name: `pl-list-${i}`, json: json.slice(i * PART, (i + 1) * PART), ver })));
    S.ver = ver; S.parts = parts; save(); await publishState();
  });
  listChain = run.catch(() => {});
  return run;
}
async function watchLoop() {
  if (!mail.watch) return;
  let last = null;
  for (;;) {
    await sleep(1200);
    if (fs.existsSync(path.join(here, 'PAUSE'))) { await sleep(5000); continue; }
    try {
      const rows = await mail.watch();
      if (!rows.length) continue;
      const sig = rows.map((r) => r.id + ':' + r.h).join('|');
      if (last !== null && sig !== last) {
        let changed = 0;
        for (const r of rows) {
          const prev = S.sums[r.id];
          if (prev && prev.h === r.h) continue;
          S.sums[r.id] = { ...(prev || {}), ...r, flags: [...new Set([...(r.flags || []), ...((prev && prev.flags) || [])])], n: Math.max(r.n || 1, (prev && prev.n) || 1) };
          harvest(r.from); changed++;
        }
        if (changed) { info.unread = rows.filter((r) => r.unread).length; await notifyNew(); await publishListNow(); log(`live: ${changed} inbox change(s) published`); }
      }
      last = sig;
    } catch (e) {
      if (/browser has been closed|context or browser|Target page, context/i.test(e.message)) { log('Chrome is gone - exiting'); process.exit(4); }
      log('watch', String(e.message).split('\n')[0].slice(0, 100)); await sleep(8000);
    }
  }
}

// ---- requests from the app are handled in their own loop, so a send never waits for a mailbox sync
let syncNeeded = false, wantQueue = [], opsBusy = false;
const mergeRows = (rows) => {
  let changed = 0;
  for (const r of rows) {
    const prev = S.sums[r.id];
    if (prev && prev.h === r.h && (r.flags || []).every((f) => (prev.flags || []).includes(f))) continue;
    S.sums[r.id] = { ...(prev || {}), ...r, flags: [...new Set([...(r.flags || []), ...((prev && prev.flags) || [])])], n: Math.max(r.n || 1, (prev && prev.n) || 1) };
    harvest(r.from); changed++;
  }
  return changed;
};
async function opsLoop() {
  for (;;) {
    await sleep(1500);
    if (opsBusy || fs.existsSync(path.join(here, 'PAUSE'))) continue;
    opsBusy = true;
    try {
      const r = await processOps();
      if (r.mail) syncNeeded = true;
      if (r.want && r.want.length) wantQueue.push(...r.want);
      if (r.sent && mail.quick) {
        for (let a = 0; a < 4; a++) { // Gmail's Sent list updates a moment after the send: look again until the new message is in it
          const n = mergeRows(await mail.quick('sent'));
          if (n) { await publishListNow(); log('live: sent folder refreshed'); break; }
          await sleep(2500);
        }
      }
    } catch (e) {
      log('ops loop', String(e.message).split('\n')[0].slice(0, 100));
      if (/browser has been closed|context or browser|Target page, context/i.test(e.message)) process.exit(4);
    } finally { opsBusy = false; lastTickDone = Date.now(); }
  }
}

async function tick(force) {
  if (fs.existsSync(path.join(here, 'PAUSE'))) return; // kill switch: create a file named PAUSE in bridge/
  if (publishing) { pendingForce ||= force; return; }
  publishing = true;
  try {
    const want = wantQueue.splice(0), mail = syncNeeded; syncNeeded = false;
    if (force || mail || want.length || Date.now() - (S.lastSync || 0) > 12000) { await sync(want); S.lastSync = Date.now(); save(); }
    if (Date.now() - lastPublish > 40000) await publishState(); // heartbeat so the app can tell the PC is alive
  } catch (e) {
    log('ERROR', e.message);
    if (/browser has been closed|context or browser|Target page, context|Browser closed|crashed/i.test(e.message)) { log('Chrome is gone - exiting so the watchdog restarts the bridge'); process.exit(4); }
    if (e.fatal) { log('Google refused the saved login — run: node bridge/auth.mjs'); process.exit(2); }
  } finally { publishing = false; lastTickDone = Date.now(); }
}

await startBackend();
// hang guard: if no work cycle has finished for 4 minutes the browser is stuck - say where, then exit so the loop starts a fresh one
if (!ONCE) setInterval(async () => {
  const idle = Date.now() - Math.max(lastTickDone, (mail._progress && mail._progress()) || 0); // no finished cycle AND no browser activity
  if (idle <= 4 * 60000) return;
  let where = ''; try { where = mail._where ? mail._where() : ''; } catch { /* ignore */ }
  log('stuck for 4 minutes (' + where + ') - restarting'); process.exit(4);
}, 20000);
if (!ONCE) setInterval(() => { publishState().catch((e) => log('heartbeat', e.message)); }, 30000); // alive signal independent of slow syncs
log(`Postline bridge (${mail.name}) starting for ${account} -> ${cfg.ck.container} (${cfg.ck.environment})`);
await tick(true);
if (!ONCE && cfg.crawl) crawlLoop(); // the directory crawl is heavy: off unless config.json says "crawl": true
if (!ONCE) watchLoop();
if (!ONCE) opsLoop();
if (!ONCE) { for (;;) { await sleep(5000); await tick(pendingForce); pendingForce = false; } }
