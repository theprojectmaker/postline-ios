const fs=require('fs');
let b=fs.readFileSync('bridge/bridge.mjs','utf8');
const a="    log('ERROR', e.message);\n"; if(!b.includes(a)) throw new Error('x');
b=b.replace(a,a+"    if (/browser has been closed|context or browser|Target page, context|Browser closed|crashed/i.test(e.message)) { log('Chrome is gone - exiting so the watchdog restarts the bridge'); process.exit(4); }\n");
// same in the crawl loop
b=b.replace("} catch (e) { S.crawl.q.unshift(q); log('crawl error', e.message);","} catch (e) { S.crawl.q.unshift(q); log('crawl error', e.message); if (/browser has been closed|context or browser|Target page, context/i.test(e.message)) process.exit(4);");
fs.writeFileSync('bridge/bridge.mjs',b);
