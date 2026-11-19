// Loads bridge/config.json (gitignored). Missing CloudKit values default to the Classroom Feed container + key on this PC:
// Postline shares that container (its records are all named "pl-*"), so no new Apple portal setup is needed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const SECRETS = path.join(here, '.secrets');
export const GMAIL_TOKEN = path.join(SECRETS, 'gmail.json');
export const STATE_FILE = path.join(here, 'state.json');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

export function loadConfig() {
  const c = readJson(path.join(here, 'config.json'), {});
  const classroomKeys = path.join(here, '..', '..', 'classroom-bot', '.ck');
  const ck = {
    container: 'iCloud.com.solyapps.classroomfeed', environment: 'development',
    keyId: '18af87bfcd903e8c98e33916a5251c5cf6e9534a02d2b3d48c8c22a141eddff7',
    pemPath: path.join(classroomKeys, 'private.pem'), ...(c.ck || {}),
  };
  if (!path.isAbsolute(ck.pemPath)) ck.pemPath = path.resolve(here, ck.pemPath);
  const google = c.google || {};
  return { ck, google, backend: c.backend || 'web', profile: path.resolve(here, c.profile || 'profile'), chromePath: c.chromePath || '', inboxMax: c.inboxMax || 60, sentMax: c.sentMax || 25, starMax: c.starMax || 15, prewarm: c.prewarm || 40 };
}
