// Bcc-only send with two recipients, both aliases of the bridge's own account (nothing leaves your mailbox).
import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadConfig } from '../bridge/config.mjs';
import * as app from '../src/cloudcore.js';
const { ck } = loadConfig();
const d = Buffer.from(crypto.createPrivateKey(fs.readFileSync(ck.pemPath)).export({ format: 'jwk' }).d, 'base64url').toString('hex');
const cfg = { container: ck.container, environment: ck.environment, keyId: ck.keyId, d, k: ck.dataKey };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st0 = await app.readState(cfg); const [u, dom] = st0.account.split('@');
const stamp = new Date().toISOString().slice(11, 19), subject = `Postline bcc test ${stamp}`, id = 'bcc-' + Date.now().toString(36);
await app.appendOps(cfg, [{ id, t: 'send', ts: Date.now(), to: `${u}+c@${dom}`, cc: `${u}+d@${dom}`, bcc: `${u}+a@${dom}, ${u}+b@${dom}`, subject, body: 'Bcc-only test with two recipients.' }]);
let done = null;
for (let i = 0; i < 40 && !done; i++) { await sleep(4000); const st = await app.readState(cfg); if (st.handled[id]) done = st.handled[id]; }
console.log('result:', JSON.stringify(done));
for (let i = 0; i < 40; i++) {
  await sleep(5000);
  const st = await app.readState(cfg); const { items } = await app.readList(cfg, 'pl-list', st.parts);
  const t = items.find((x) => x.subject === subject);
  if (t) { const th = await app.readThread(cfg, t.id); console.log('arrived in the inbox:', t.flags, '| messages in thread:', th ? th.msgs.length : '?'); await app.appendOps(cfg, [{ id: id + 't', t: 'trash', th: t.id, ts: Date.now() }]); console.log('queued trash'); break; }
  if (i === 39) console.log('did not arrive in 3 minutes');
}
