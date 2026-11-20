// Live: send a message to yourself, reply to it (inline reply path), confirm both landed in one conversation, then trash it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadConfig } from '../bridge/config.mjs';
import * as app from '../src/cloudcore.js';
const { ck } = loadConfig();
const d = Buffer.from(crypto.createPrivateKey(fs.readFileSync(ck.pemPath)).export({ format: 'jwk' }).d, 'base64url').toString('hex');
const cfg = { container: ck.container, environment: ck.environment, keyId: ck.keyId, d, k: ck.dataKey };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st0 = await app.readState(cfg);
const stamp = new Date().toISOString().slice(11, 19), subject = `Postline reply test ${stamp}`, id = 'rt-' + Date.now().toString(36);
const waitHandled = async (op) => { for (let i = 0; i < 60; i++) { await sleep(3000); const st = await app.readState(cfg); if (st.handled[op]) return st.handled[op]; } return null; };
const findThread = async () => { for (let i = 0; i < 60; i++) { await sleep(4000); const st = await app.readState(cfg); const { items } = await app.readList(cfg, 'pl-list', st.parts); const t = items.find((x) => x.subject === subject); if (t) return t; } return null; };
await app.appendOps(cfg, [{ id, t: 'send', ts: Date.now(), to: st0.account, subject, body: 'first message' }]);
console.log('send:', JSON.stringify(await waitHandled(id)));
let t = await findThread(); console.log('thread visible:', !!t, t && 'n=' + t.n);
if (!t) process.exit(1);
await app.appendOps(cfg, [{ id: id + 'r', t: 'send', ts: Date.now(), to: st0.account, subject: 'Re: ' + subject, body: 'the reply', threadId: t.id }]);
console.log('reply:', JSON.stringify(await waitHandled(id + 'r')));
for (let i = 0; i < 40; i++) { await sleep(4000); const st = await app.readState(cfg); const { items } = await app.readList(cfg, 'pl-list', st.parts); const x = items.find((y) => y.id === t.id); if (x && x.n >= 2) { console.log('conversation now has', x.n, 'messages'); break; } if (i === 39) console.log('reply NOT seen in the thread'); }
await app.appendOps(cfg, [{ id: id + 't', t: 'trash', th: t.id, ts: Date.now() }]); console.log('queued trash');
