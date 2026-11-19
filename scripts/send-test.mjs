// Queues a send request exactly as the iPad does (app code -> CloudKit), to YOUR OWN address. Then run the bridge once.
//   node scripts/send-test.mjs            (recipient = the bridge's account)
import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadConfig } from '../bridge/config.mjs';
import * as app from '../src/cloudcore.js';
const { ck } = loadConfig();
const d = Buffer.from(crypto.createPrivateKey(fs.readFileSync(ck.pemPath)).export({ format: 'jwk' }).d, 'base64url').toString('hex');
const cfg = { container: ck.container, environment: ck.environment, keyId: ck.keyId, d, k: ck.dataKey };
const st = await app.readState(cfg);
const id = 'test-' + Date.now().toString(36);
const stamp = new Date().toISOString().slice(11, 19);
await app.appendOps(cfg, [{ id, t: 'send', ts: Date.now(), to: st.account, subject: `Postline test ${stamp}`, body: `Sent from the iPad code path through CloudKit at ${stamp}.\nÜnïcode ✓` }]);
console.log('queued', id, 'to', st.account);
fs.writeFileSync(new URL('./.last-send-id', import.meta.url), id);
