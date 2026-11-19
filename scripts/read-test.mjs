// Reads the live mailbox the way the iPad does (needs the bridge to have synced): node scripts/read-test.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadConfig } from '../bridge/config.mjs';



const app = await import('../src/cloudcore.js');
const { ck } = loadConfig();
const d = Buffer.from(crypto.createPrivateKey(fs.readFileSync(ck.pemPath)).export({ format: 'jwk' }).d, 'base64url').toString('hex');
const cfg = { container: ck.container, environment: ck.environment, keyId: ck.keyId, d, k: ck.dataKey };
const st = await app.readState(cfg);
console.log('state age s:', Math.round((Date.now() - st.ts) / 1000), '| account:', st.account, '| ver', st.ver, 'parts', st.parts, '| unread', st.unread, '| handled', Object.keys(st.handled || {}).length);
const { items } = await app.readList(cfg, 'pl-list', st.parts);
const by = (f) => items.filter((t) => (t.flags || []).includes(f)).length;
console.log('threads', items.length, '| inbox', by('inbox'), 'sent', by('sent'), 'star', by('star'), 'unread', items.filter((t) => t.unread).length);
for (const t of items.slice(0, 4)) console.log(' -', new Date(t.date).toISOString().slice(0, 16), t.unread ? '●' : ' ', t.flags.join(','), '|', t.from.slice(0, 30), '|', t.subject.slice(0, 40), '| n=' + t.n);
const th = await app.readThread(cfg, items[0].id);
console.log('thread', items[0].id, th ? `msgs ${th.msgs.length} first text: ${JSON.stringify(th.msgs[0].text.slice(0, 80))}` : 'NOT WRITTEN');
