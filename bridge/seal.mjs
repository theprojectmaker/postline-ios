// Node side of Postline's end-to-end encryption (same format as src/seal.js; see there). Plaintext never reaches CloudKit.
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const hmac = (key, ...parts) => { const h = crypto.createHmac('sha256', key); parts.forEach((p) => h.update(p)); return h.digest(); };
const keys = (k) => { const root = Buffer.from(k, 'hex'); return { enc: hmac(root, 'postline-enc'), mac: hmac(root, 'postline-mac') }; };
function stream(kEnc, nonce, data) {
  const out = Buffer.alloc(data.length);
  for (let i = 0, c = 0; i < data.length; i += 32, c++) {
    const ctr = Buffer.alloc(4); ctr.writeUInt32BE(c);
    const ks = hmac(kEnc, nonce, ctr);
    for (let j = 0; j < 32 && i + j < data.length; j++) out[i + j] = data[i + j] ^ ks[j];
  }
  return out;
}
export function seal(k, obj) {
  const { enc, mac } = keys(k);
  const nonce = crypto.randomBytes(16);
  const ct = stream(enc, nonce, zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8')));
  const tag = hmac(mac, nonce, ct);
  return Buffer.concat([Buffer.from([1]), nonce, tag, ct]).toString('base64');
}
export function unseal(k, b64) {
  const b = Buffer.from(b64, 'base64');
  if (b[0] !== 1 || b.length < 49) throw new Error('Unreadable sealed data');
  const { enc, mac } = keys(k);
  const nonce = b.subarray(1, 17), tag = b.subarray(17, 49), ct = b.subarray(49);
  if (!crypto.timingSafeEqual(hmac(mac, nonce, ct), tag)) throw new Error('Sealed data failed its integrity check');
  return JSON.parse(zlib.gunzipSync(stream(enc, nonce, ct)).toString('utf8'));
}
