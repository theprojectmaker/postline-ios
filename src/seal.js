// End-to-end encryption for everything Postline puts in CloudKit's public database (mail is private; the database is not).
// Format: base64( 0x01 | nonce(16) | tag(32) | ciphertext ). Keystream = HMAC-SHA256(kEnc, nonce | counter) in counter mode,
// tag = HMAC-SHA256(kMac, nonce | ciphertext) (encrypt-then-MAC). kEnc/kMac are derived from the 32-byte shared key `k` (hex).
// Same construction as bridge/seal.mjs (Node crypto) — scripts/e2e-test.mjs checks the two agree. No React Native imports.
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { base64ToBytes, bytesToBase64 } from './cksign.js';

const hexToBytes = (h) => { const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; };
const keys = (k) => { const root = hexToBytes(k); return { enc: hmac(sha256, root, strToU8('postline-enc')), mac: hmac(sha256, root, strToU8('postline-mac')) }; };

function stream(kEnc, nonce, data) {
  const out = new Uint8Array(data.length);
  const blk = new Uint8Array(nonce.length + 4);
  blk.set(nonce);
  for (let i = 0, c = 0; i < data.length; i += 32, c++) {
    blk[nonce.length] = (c >>> 24) & 255; blk[nonce.length + 1] = (c >>> 16) & 255; blk[nonce.length + 2] = (c >>> 8) & 255; blk[nonce.length + 3] = c & 255;
    const ks = hmac(sha256, kEnc, blk);
    for (let j = 0; j < 32 && i + j < data.length; j++) out[i + j] = data[i + j] ^ ks[j];
  }
  return out;
}
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };

export function seal(k, obj, nonce) {
  if (!k || k.length !== 64) throw Object.assign(new Error('This build has no encryption key'), { code: 'NO_KEY' });
  const { enc, mac } = keys(k);
  const n = nonce || (globalThis.crypto && globalThis.crypto.getRandomValues ? globalThis.crypto.getRandomValues(new Uint8Array(16)) : Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)));
  const ct = stream(enc, n, gzipSync(strToU8(JSON.stringify(obj))));
  const nc = new Uint8Array(n.length + ct.length); nc.set(n); nc.set(ct, n.length);
  const tag = hmac(sha256, mac, nc);
  const out = new Uint8Array(1 + 16 + 32 + ct.length);
  out[0] = 1; out.set(n, 1); out.set(tag, 17); out.set(ct, 49);
  return bytesToBase64(out);
}

export function unseal(k, b64) {
  if (!k || k.length !== 64) throw Object.assign(new Error('This build has no encryption key'), { code: 'NO_KEY' });
  const b = base64ToBytes(b64);
  if (b[0] !== 1 || b.length < 49) throw new Error('Unreadable mailbox data');
  const { enc, mac } = keys(k);
  const nonce = b.subarray(1, 17), tag = b.subarray(17, 49), ct = b.subarray(49);
  const nc = new Uint8Array(16 + ct.length); nc.set(nonce); nc.set(ct, 16);
  if (!same(hmac(sha256, mac, nc), tag)) throw Object.assign(new Error('Mailbox data failed its integrity check'), { code: 'BAD_TAG' });
  return JSON.parse(strFromU8(gunzipSync(stream(enc, nonce, ct))));
}
