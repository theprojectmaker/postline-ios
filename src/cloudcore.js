// Postline's CloudKit PUBLIC-database layer — the one route that works on a Wi-Fi that only allows Apple. No React Native
// imports: this file also runs under Node (scripts/e2e-test.mjs). It reads AND writes with a signed server-to-server key
// that the TestFlight build carries (src/seed.js), so there is no Apple sign-in.
//
// Records (record type LibraryMeta {json STRING, updatedAt INT64}; names are all prefixed "pl-" so they never touch
// Classroom Feed's records in the same container):
//   pl-state        what the PC bridge keeps current: {ts, online, account, ver (list version), parts, handled:{opId:{ok,err}}}
//   pl-list-<i>     the thread list for ver, gzip+base64 in parts of CHUNK chars
//   pl-t-<threadId> one conversation with message bodies, gzip+base64 (single record, bodies trimmed to fit)
//   pl-s-<opId>     a search result (same shape as the list)
//   pl-inbox        the app's requests {ops:[{id,t,ts,...}]} written with compare-and-swap
import { signedHeaders } from './cksign.js';
import { seal, unseal } from './seal.js';

const HOST = 'https://api.apple-cloudkit.com';
export const TYPE = 'LibraryMeta';
let skewMs = 0;

export const canUse = (cfg) => !!(cfg && cfg.container && cfg.keyId && cfg.d && cfg.k);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(cfg, op, payload, ms = 25000) {
  if (!canUse(cfg)) { const e = new Error('Postline has no iCloud key in this build'); e.code = 'NO_KEY'; throw e; }
  const sub = `/database/1/${cfg.container}/${cfg.environment || 'development'}/public/${op}`;
  const body = JSON.stringify(payload);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  let res, text;
  try {
    res = await fetch(HOST + sub, { method: 'POST', body, signal: ctl.signal, headers: signedHeaders(cfg, sub, body, skewMs) });
    text = await res.text();
  } finally { clearTimeout(timer); }
  try { // learn the clock difference from Apple's Date header when it is exposed
    const d = res.headers && res.headers.get && res.headers.get('date');
    const t = d ? Date.parse(d) : NaN;
    if (!isNaN(t)) { const diff = t - Date.now(); skewMs = Math.abs(diff) > 20000 ? diff : 0; }
  } catch { /* ignore */ }
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: String(text).slice(0, 160) }; }
  if (!res.ok || data.serverErrorCode) {
    const e = new Error(data.reason || data.serverErrorCode || data.raw || `HTTP ${res.status}`);
    e.code = data.serverErrorCode || ''; e.status = res.status; e.retryAfter = Number(data.retryAfter) || 0;
    throw e;
  }
  return data;
}

const BUSY = /TRY_AGAIN_LATER|THROTTLED|ZONE_BUSY|INTERNAL_ERROR|SERVICE_UNAVAILABLE/;
async function callRetry(cfg, op, payload, ms, tries = 4) {
  let last;
  for (let a = 0; a < tries; a++) {
    try { return await call(cfg, op, payload, ms); }
    catch (e) { last = e; if (!(BUSY.test(e.code || '') || e.status === 503 || e.status === 429)) throw e; }
    await sleep(Math.min(8000, Math.max((last.retryAfter || 0) * 1000, 600 * 2 ** a)));
  }
  throw last;
}

export async function lookup(cfg, names, ms = 25000) {
  return (await callRetry(cfg, 'records/lookup', { records: names.map((recordName) => ({ recordName })) }, ms)).records || [];
}
const modify = async (cfg, operations, ms = 30000) => (await callRetry(cfg, 'records/modify', { operations }, ms)).records || [];
const jsonOf = (cfg, rec) => { try { return rec && rec.fields && rec.fields.json ? unseal(cfg.k, rec.fields.json.value) : null; } catch { return null; } };

/** The bridge's status record. null = not published yet. Throws when iCloud cannot be reached. */
export async function readState(cfg, ms = 12000) {
  const [rec] = await lookup(cfg, ['pl-state'], ms);
  return jsonOf(cfg, rec);
}

/** The thread list for a version: [{id,subject,from,snippet,date,unread,n,labels,...}]. */
export async function readList(cfg, prefix, parts) {
  const names = Array.from({ length: Math.max(1, parts || 1) }, (_, i) => `${prefix}-${i}`);
  const pieces = [];
  let ver = 0;
  for (let i = 0; i < names.length; i += 2) {
    const slice = names.slice(i, i + 2);
    const recs = await lookup(cfg, slice, 45000);
    for (const n of slice) {
      const r = recs.find((x) => x.recordName === n);
      if (!r || !r.fields || !r.fields.json) throw Object.assign(new Error('The mailbox is not in iCloud yet'), { code: 'NOT_READY' });
      const v = Number(r.fields.updatedAt && r.fields.updatedAt.value) || 0;
      if (ver && v !== ver) throw Object.assign(new Error('The mailbox is being rewritten'), { code: 'TORN' });
      ver = v; pieces.push(r.fields.json.value);
    }
  }
  return { items: unseal(cfg.k, pieces.join('')), ver };
}

/** One conversation (or null when the bridge has not written it yet). */
export async function readThread(cfg, id) {
  const [rec] = await lookup(cfg, [`pl-t-${id}`], 30000);
  if (!rec || !rec.fields || !rec.fields.json) return null;
  return { ...unseal(cfg.k, rec.fields.json.value), _ver: Number(rec.fields.updatedAt && rec.fields.updatedAt.value) || 0 };
}

/** A directory-suggestion answer the bridge wrote for request `id` (null until it exists). */
export async function readGlobal(cfg, id) {
  const [rec] = await lookup(cfg, [`pl-g-${id}`], 30000);
  return rec && rec.fields && rec.fields.json ? unseal(cfg.k, rec.fields.json.value) : null;
}

/** A Gmail search result the bridge wrote for request `id` (null until it exists). */
export async function readSearch(cfg, id) {
  const [rec] = await lookup(cfg, [`pl-s-${id}`], 30000);
  return rec && rec.fields && rec.fields.json ? unseal(cfg.k, rec.fields.json.value) : null;
}

/**
 * Adds requests to the app's request record. Compare-and-swap on the record change tag so two devices (iPad + iPhone)
 * never overwrite each other. `handled` = ids the bridge already answered; they are dropped from the record.
 */
export async function appendOps(cfg, ops, handled = []) {
  if (!ops.length) return true;
  const gone = new Set(handled);
  for (let attempt = 0; attempt < 6; attempt++) {
    const [rec] = await lookup(cfg, ['pl-inbox']);
    const exists = !!(rec && rec.fields && rec.fields.json);
    const cur = exists ? ((jsonOf(cfg, rec) || {}).ops || []) : [];
    const now = Date.now();
    const keep = cur.filter((o) => o && o.id && !gone.has(o.id) && now - (o.ts || 0) < 3 * 86400000);
    const have = new Set(keep.map((o) => o.id));
    const next = [...keep, ...ops.filter((o) => !have.has(o.id))].slice(-60);
    const record = { recordType: TYPE, recordName: 'pl-inbox', fields: { json: { value: seal(cfg.k, { ops: next }) }, updatedAt: { value: now, type: 'INT64' } } };
    if (exists) record.recordChangeTag = rec.recordChangeTag;
    const out = await modify(cfg, [{ operationType: exists ? 'update' : 'create', record }]);
    const r = out[0] || {};
    if (!r.serverErrorCode) return true;
    if (!/CONFLICT|EXISTS|ATOMIC|CHANGED|TRY_AGAIN_LATER|ZONE_BUSY/i.test(r.serverErrorCode)) { const e = new Error(r.reason || r.serverErrorCode); e.code = r.serverErrorCode; throw e; }
    await sleep(300 + Math.random() * 700 * (attempt + 1));
  }
  throw new Error('iCloud is busy — it will be sent again shortly');
}
