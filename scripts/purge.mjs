// Deletes Postline's records (pl-*) from CloudKit. CloudKit can't list them (the type isn't queryable), so it deletes the
// fixed names plus a conversation record for every thread id the bridge has ever tracked (bridge/state.json).
import fs from 'node:fs';
import { loadConfig, STATE_FILE } from '../bridge/config.mjs';
import { makeCk } from '../bridge/ck.mjs';
const { ck: cc } = loadConfig();
const ck = makeCk(cc);
let S = {}; try { S = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { /* none */ }
const ids = new Set([...Object.keys(S.threads || {}), ...Object.keys(S.sums || {}), ...Object.keys(S.written || {}), ...(process.argv.slice(2))]);
const names = ['pl-state', 'pl-inbox', ...Array.from({ length: 6 }, (_, i) => `pl-list-${i}`), ...[...ids].map((i) => `pl-t-${i}`), ...Object.keys(S.done || {}).map((o) => `pl-s-${o}`)];
for (let i = 0; i < names.length; i += 100) await ck.call('records/modify', { operations: names.slice(i, i + 100).map((recordName) => ({ operationType: 'forceDelete', record: { recordName } })) });
console.log('deleted up to', names.length, 'records (missing ones are ignored)');
