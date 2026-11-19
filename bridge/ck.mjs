// Signed CloudKit Web Services client for the PC bridge (server-to-server key, public database). Same signing as the
// Classroom checker's cloud.mjs; the key file and container come from bridge/config.json (never committed).
import crypto from 'node:crypto';
import fs from 'node:fs';
import { seal, unseal } from './seal.mjs';

const HOST = 'https://api.apple-cloudkit.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = /TRY_AGAIN_LATER|THROTTLED|ZONE_BUSY|INTERNAL_ERROR|SERVICE_UNAVAILABLE/;
export const TYPE = 'LibraryMeta';
export const PART = 600000; // characters of base64 per list record (a CloudKit record is capped near 1 MB)

export function makeCk(cfg) {
  const pem = fs.readFileSync(cfg.pemPath, 'utf8');
  async function call(op, payload) {
    const body = JSON.stringify(payload);
    const date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const hash = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
    const sub = `/database/1/${cfg.container}/${cfg.environment}/public/${op}`;
    const sig = crypto.sign('sha256', Buffer.from(`${date}:${hash}:${sub}`, 'utf8'), pem).toString('base64');
    const res = await fetch(HOST + sub, {
      method: 'POST', body, signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'text/plain', 'X-Apple-CloudKit-Request-KeyID': cfg.keyId, 'X-Apple-CloudKit-Request-ISO8601Date': date, 'X-Apple-CloudKit-Request-SignatureV1': sig },
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
    if (!res.ok || data.serverErrorCode) {
      throw Object.assign(new Error(`CloudKit ${op} -> ${res.status} ${data.serverErrorCode || ''} ${data.reason || data.raw || ''}`.trim()),
        { code: data.serverErrorCode || '', status: res.status, retryAfter: Number(data.retryAfter) || 0 });
    }
    return data;
  }
  async function retry(op, payload, tries = 5) {
    let last;
    for (let a = 0; a < tries; a++) {
      try {
        const out = await call(op, payload);
        const bad = (out.records || []).find((r) => r.serverErrorCode && RETRYABLE.test(r.serverErrorCode));
        if (!bad) return out;
        last = Object.assign(new Error(`CloudKit ${op}: ${bad.serverErrorCode}`), { code: bad.serverErrorCode, retryAfter: Number(bad.retryAfter) || 0 });
      } catch (e) {
        last = e;
        if (e.code && !RETRYABLE.test(e.code) && e.status !== 503 && e.status !== 429) throw e;
      }
      await sleep(Math.min(20000, Math.max((last.retryAfter || 0) * 1000, 700 * 2 ** a)));
    }
    throw last;
  }
  const lookup = async (names) => (await retry('records/lookup', { records: names.map((recordName) => ({ recordName })) })).records || [];
  const rec = (name, json, ver) => ({ operationType: 'forceReplace', record: { recordType: TYPE, recordName: name, fields: { json: { value: json }, updatedAt: { value: ver, type: 'INT64' } } } });
  async function save(items) { // items: [{name, json, ver}]
    for (let i = 0; i < items.length; i += 4) {
      const out = await retry('records/modify', { operations: items.slice(i, i + 4).map((x) => rec(x.name, x.json, x.ver)) });
      const bad = (out.records || []).find((x) => x.serverErrorCode);
      if (bad) throw Object.assign(new Error(`CloudKit save failed: ${bad.serverErrorCode} ${bad.reason || ''}`), { code: bad.serverErrorCode });
    }
  }
  const jsonOf = (r) => { try { return r && r.fields && r.fields.json ? unseal(cfg.dataKey, r.fields.json.value) : null; } catch { return null; } };
  const pack = (obj) => seal(cfg.dataKey, obj); // everything written to CloudKit is end-to-end encrypted
  return { call, lookup, save, jsonOf, pack };
}
