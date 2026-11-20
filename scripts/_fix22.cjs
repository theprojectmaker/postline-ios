const fs=require('fs');
let b=fs.readFileSync('bridge/bridge.mjs','utf8');
const a="if (!ONCE) crawlLoop();"; if(!b.includes(a)) throw new Error('x');
b=b.replace(a,"if (!ONCE) setInterval(() => { publishState().catch((e) => log('heartbeat', e.message)); }, 30000); // alive signal independent of slow syncs\nif (!ONCE) crawlLoop();");
fs.writeFileSync('bridge/bridge.mjs',b);
