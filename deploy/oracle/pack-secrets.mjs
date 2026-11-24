// Run on the PC:  node deploy/oracle/pack-secrets.mjs
// Makes ~/Desktop/postline-secrets.tar.gz for the Oracle VM: a cloud-role config.json + the CloudKit key. Never commit or share this file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../../bridge/config.mjs';

const cfg = loadConfig();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plsec-'));
fs.copyFileSync(cfg.ck.pemPath, path.join(tmp, 'ck-private.pem'));
fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({
  role: 'cloud', chromium: true,
  ck: { container: cfg.ck.container, environment: cfg.ck.environment, keyId: cfg.ck.keyId, pemPath: 'ck-private.pem', dataKey: cfg.ck.dataKey },
}, null, 2));
const out = path.join(os.homedir(), 'Desktop', 'postline-secrets.tar.gz');
const winTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'); // Windows' own tar (Git's tar cannot read C: paths)
try { execFileSync(fs.existsSync(winTar) ? winTar : 'tar', ['-czf', out, '-C', tmp, 'config.json', 'ck-private.pem']); }
finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('Wrote ' + out + ' (' + fs.statSync(out).size + ' bytes). Copy it to the VM, then delete it from the Desktop.');
