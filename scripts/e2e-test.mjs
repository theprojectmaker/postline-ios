// CloudKit round-trip test, no Gmail needed: the bridge side publishes a fake mailbox, the APP's own code (src/cloudcore.js +
// src/cksign.js, the exact files the iPad runs) reads it and writes requests back. Run:
//   node --experimental-default-type=module scripts/e2e-test.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadConfig } from '../bridge/config.mjs';
import { makeCk } from '../bridge/ck.mjs';
import * as app from '../src/cloudcore.js';

const { ck: cc } = loadConfig();
const d = Buffer.from(crypto.createPrivateKey(fs.readFileSync(cc.pemPath)).export({ format: 'jwk' }).d, 'base64url').toString('hex');
const cfg = { container: cc.container, environment: cc.environment, keyId: cc.keyId, d };
const bridge = makeCk(cc);
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

const sums = [{ id: 'T1', subject: 'Hello ✉️', from: 'A <a@x.com>', snippet: 'hi', date: Date.now(), unread: true, n: 1, flags: ['inbox'] }];
const ver = Date.now();
await bridge.save([
  { name: 'pl-list-9', json: bridge.pack(sums), ver },
  { name: 'pl-t-TEST', json: bridge.pack({ id: 'TEST', subject: 'Hello ✉️', msgs: [{ id: 'm1', text: 'body ünïcode' }] }), ver },
  { name: 'pl-state-test', json: JSON.stringify({ ts: Date.now(), ver, parts: 1 }), ver },
]);
let t0 = Date.now();
const [st] = await app.lookup(cfg, ['pl-state-test']);
ok(st && st.fields.json, `app reads a record the bridge wrote (${Date.now() - t0} ms)`);
t0 = Date.now();
const list = await app.readList(cfg, 'pl-list', 1).catch(() => null); // reads pl-list-0 (may not exist yet) — just must not crash
const l9 = (await app.lookup(cfg, ['pl-list-9']))[0];
ok(l9 && l9.fields.json, 'app reads a list part');
const th = await app.readThread(cfg, 'TEST');
ok(th && th.msgs[0].text === 'body ünïcode', 'app decodes a conversation record (gzip+utf8 round trip)');

// two devices write requests at once -> compare-and-swap must keep both
await Promise.all([
  app.appendOps(cfg, [{ id: 'test-a', t: 'refresh', ts: Date.now() }]),
  app.appendOps(cfg, [{ id: 'test-b', t: 'refresh', ts: Date.now() }]),
]);
const inbox = bridge.jsonOf((await bridge.lookup(['pl-inbox']))[0]);
const ids = ((inbox && inbox.ops) || []).map((o) => o.id);
ok(ids.includes('test-a') && ids.includes('test-b'), `both simultaneous requests landed (${ids.join(',')})`);
await app.appendOps(cfg, [], []);
await app.appendOps(cfg, [{ id: 'test-c', t: 'refresh', ts: Date.now() }], ['test-a', 'test-b']);
const inbox2 = bridge.jsonOf((await bridge.lookup(['pl-inbox']))[0]);
ok(!inbox2.ops.some((o) => o.id === 'test-a'), 'handled requests are dropped from the record');

// clean up everything this test created
await bridge.call('records/modify', { operations: ['pl-list-9', 'pl-t-TEST', 'pl-state-test', 'pl-inbox'].map((recordName) => ({ operationType: 'forceDelete', record: { recordName } })) });
console.log('cleaned up');
