// Exercises star / mark unread / reply / archive / trash on the self-sent "Postline test" thread ONLY (never touches other mail).
//   node scripts/ops-test.mjs   then   node bridge/bridge.mjs --once   then   node scripts/ops-test.mjs --check
import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadConfig } from '../bridge/config.mjs';
import * as app from '../src/cloudcore.js';
const { ck } = loadConfig();
const d = Buffer.from(crypto.createPrivateKey(fs.readFileSync(ck.pemPath)).export({ format: 'jwk' }).d, 'base64url').toString('hex');
const cfg = { container: ck.container, environment: ck.environment, keyId: ck.keyId, d, k: ck.dataKey };
const st = await app.readState(cfg);
const { items } = await app.readList(cfg, 'pl-list', st.parts);
const t = items.find((x) => /^Postline test/.test(x.subject));
if (!t) throw new Error('no self-sent test thread found');
const f = new URL('./.ops-ids', import.meta.url);
if (process.argv.includes('--check')) {
  const ids = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const [name, id] of Object.entries(ids)) console.log(name.padEnd(8), JSON.stringify(st.handled[id]));
  console.log('thread now:', t ? `flags=${t.flags} unread=${t.unread} n=${t.n}` : 'gone from lists');
  process.exit(0);
}
const now = Date.now(), p = 'o' + now.toString(36);
const ids = { star: p + 's', unread: p + 'u', reply: p + 'r', archive: p + 'a' };
await app.appendOps(cfg, [
  { id: ids.star, t: 'star', th: t.id, on: true, ts: now },
  { id: ids.unread, t: 'mark', th: t.id, read: false, ts: now + 1 },
  { id: ids.reply, t: 'send', to: st.account, subject: 'Re: ' + t.subject, body: 'reply body from test\n\nOn Thu, Nov 19, 2026 at 5:34 PM x <x@y.com> wrote:\n> quoted text', threadId: t.id, ts: now + 2 },
  { id: ids.archive, t: 'archive', th: t.id, ts: now + 3 },
]);
fs.writeFileSync(f, JSON.stringify(ids));
console.log('queued', Object.keys(ids).join(', '));
