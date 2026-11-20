// Asks the bridge to send a test notification to every registered device.
import crypto from 'node:crypto'; import fs from 'node:fs';
import { loadConfig } from '../bridge/config.mjs';
import * as app from '../src/cloudcore.js';
const { ck } = loadConfig();
const d = Buffer.from(crypto.createPrivateKey(fs.readFileSync(ck.pemPath)).export({ format: 'jwk' }).d, 'base64url').toString('hex');
const cfg = { container: ck.container, environment: ck.environment, keyId: ck.keyId, d, k: ck.dataKey };
await app.appendOps(cfg, [{ id: 'pt-' + Date.now().toString(36), t: 'pushtest', ts: Date.now() }]);
console.log('test push requested');
