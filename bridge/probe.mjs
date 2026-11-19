// Calibration helper: opens Gmail with the bridge profile and reports what it can see (rows, names, selectors).
//   node bridge/probe.mjs
import { loadConfig } from './config.mjs';
import { makeWebBackend } from './web-backend.mjs';
const cfg = { ...loadConfig(), headless: !process.argv.includes('--show') };
const b = await makeWebBackend(cfg);
const ids = await b.listIds();
console.log('account:', b.account, '| thread ids found:', ids.size);
const first = [...ids.keys()][0];
if (first) { const t = await b.fetchThread(first); console.log('first thread:', t.summary.subject, '| messages:', t.detail.msgs.length, '| last text:', JSON.stringify(t.detail.msgs.at(-1).text.slice(0, 120))); }
await b._shot('probe');
await b.close();
