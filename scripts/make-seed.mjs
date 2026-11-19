// Builds the iCloud details the TestFlight build carries (the CF_SEED secret) from the PC's CloudKit key.
//   node scripts/make-seed.mjs            prints a redacted summary only
//   node scripts/make-seed.mjs --store    also stores CF_SEED (+ ARTIFACT_KEY if missing) as GitHub secrets on the repo
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../bridge/config.mjs';

const { ck } = loadConfig();
const d = Buffer.from(crypto.createPrivateKey(fs.readFileSync(ck.pemPath)).export({ format: 'jwk' }).d, 'base64url').toString('hex');
const seed = JSON.stringify({ container: ck.container, environment: ck.environment, keyId: ck.keyId, d, k: ck.dataKey });
console.log(`seed: container ${ck.container} (${ck.environment}), key ${ck.keyId.slice(0, 8)}…, d ${d.length} hex chars`);
if (process.argv.includes('--store')) {
  const repo = process.argv[process.argv.indexOf('--store') + 1] || 'theprojectmaker/postline-ios';
  const gh = (args, input) => execFileSync('gh', args, { input, stdio: ['pipe', 'inherit', 'inherit'] });
  gh(['secret', 'set', 'CF_SEED', '--repo', repo], seed);
  console.log('CF_SEED stored on ' + repo);
}
