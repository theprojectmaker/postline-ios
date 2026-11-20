const fs=require('fs');
let s=fs.readFileSync('bridge/bridge.mjs','utf8');
const a="\n    try { const d = JSON.parse(JSON.stringify(item ? {} : {})); void d; } catch { /* none */ }"; if(!s.includes(a)) throw new Error('x'); s=s.replace(a,'');
const b="    const { summary, detail } = await mail.fetchThread(id, o);\n"; if(!s.includes(b)) throw new Error('y');
s=s.replace(b,b+"    if (o.maxText === undefined) detail.msgs.forEach((m) => harvest([m.from, m.to, m.cc].filter(Boolean).join(', ')));\n");
fs.writeFileSync('bridge/bridge.mjs',s);
