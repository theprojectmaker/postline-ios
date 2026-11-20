// Live end-to-end on the real bridge + Gmail: send a message to yourself the way the iPad does, time how long until it is
// sent and visible in the synced inbox, then move that test message to Trash. (Needs the bridge running.)
import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadConfig } from '../bridge/config.mjs';
import * as app from '../src/cloudcore.js';
const { ck } = loadConfig();
const d = Buffer.from(crypto.createPrivateKey(fs.readFileSync(ck.pemPath)).export({ format: 'jwk' }).d, 'base64url').toString('hex');
const cfg = { container: ck.container, environment: ck.environment, keyId: ck.keyId, d, k: ck.dataKey };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st0 = await app.readState(cfg);
const stamp = new Date().toISOString().slice(11, 19), subject = `Postline live test ${stamp}`, id = 'live-' + Date.now().toString(36), t0 = Date.now();
await app.appendOps(cfg, [{ id, t: 'send', ts: Date.now(), to: st0.account, subject, body: `Live test ${stamp} (sent from the app code path, received through the bridge).` }]);
let sentAt = 0, seenAt = 0, thread = null;
for (let i = 0; i < 300 && !seenAt; i++) {
  await sleep(1500);
  const st = await app.readState(cfg);
  if (!sentAt && st.handled[id]) { sentAt = Date.now() - t0; console.log(`sent by Gmail after ${Math.round(sentAt / 1000)}s ->`, JSON.stringify(st.handled[id])); if (!st.handled[id].ok) process.exit(1); }
  const { items } = await app.readList(cfg, 'pl-list', st.parts);
  thread = items.find((x) => x.subject === subject);
  if (thread) seenAt = Date.now() - t0;
}
console.log(thread ? `visible in the synced inbox after ${Math.round(seenAt / 1000)}s: flags=${thread.flags} unread=${thread.unread}` : 'NOT seen in the list within 7.5 minutes');
if (thread) { await app.appendOps(cfg, [{ id: id + 't', t: 'trash', th: thread.id, ts: Date.now() }]); console.log('queued trash for the test message'); }
