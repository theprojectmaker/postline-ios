const fs=require('fs');
function patch(file, pairs){ let s=fs.readFileSync(file,'utf8'); for(const [a,b] of pairs){ if(!s.includes(a)) throw new Error(file+' missing: '+a.slice(0,60)); s=s.replace(a,b);} fs.writeFileSync(file,s); }
patch('bridge/web-backend.mjs',[
["  const ownPart = (b)",`  // ---- people search: Gmail's own recipient suggestions (includes the school directory), on a second tab so mail work is never blocked
  let dirPage = null, dirQueue = Promise.resolve();
  const dirRun = (fn) => { const p = dirQueue.then(fn, fn); dirQueue = p.catch(() => {}); return p; };
  async function ensureDir() {
    if (dirPage && !dirPage.isClosed()) return dirPage;
    dirPage = await ctx.newPage(); dirPage.setDefaultTimeout(15000);
    await dirPage.goto(BASE + '?view=cm&fs=1', { waitUntil: 'domcontentloaded' });
    if (isLogin(dirPage.url())) throw Object.assign(new Error('Not signed in to Gmail'), { fatal: true });
    await dirPage.waitForSelector('input[peoplekit-id], textarea[name="to"], input[aria-label="To recipients"]', { timeout: 30000 });
    return dirPage;
  }
  async function suggestOn(q) {
    const p = await ensureDir();
    const to = p.locator('input[peoplekit-id], textarea[name="to"], input[aria-label="To recipients"]').first();
    await to.fill(''); await to.pressSequentially(q, { delay: 35 });
    let last = -1, rows = [];
    for (let i = 0; i < 14; i++) {
      await sleep(250);
      rows = await p.evaluate(() => [...document.querySelectorAll('div.agJ[role="option"] .agH[data-hovercard-id]')].filter((e) => e.offsetParent !== null).map((e) => ({ e: e.getAttribute('data-hovercard-id'), n: e.getAttribute('data-name') || '' })));
      if (i >= 3 && rows.length === last) break;
      last = rows.length;
    }
    await to.fill('');
    return rows.filter((r) => r.e && r.e.includes('@'));
  }
  const ownPart = (b)`],
["    close: () => ctx.close(),","    suggest: (q) => dirRun(async () => { try { return await suggestOn(q); } catch (e) { if (crashed(e)) { dirPage = null; return suggestOn(q); } throw e; } }),\n    close: () => ctx.close(),"],
]);
patch('bridge/bridge.mjs',[
["const S = (() =>","// ---- people directory: addresses seen in mail + the school directory crawled through Gmail's suggestions\nconst addrRe = /\"?([^\",<>;]*?)\"?\s*<([^<>\s]+@[^<>\s]+)>|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;\nfunction harvest(text) {\n  let n = 0; if (!text) return n;\n  for (const m of String(text).matchAll(addrRe)) {\n    const email = (m[2] || m[3] || '').toLowerCase().replace(/[.,;]+$/, ''); if (!email || /noreply|no-reply|donotreply|mailer-daemon/.test(email)) continue;\n    const name = (m[1] || '').trim(); const c = S.contacts[email] || (S.contacts[email] = { n: '', c: 0 });\n    if (name && name.toLowerCase() !== email && (!c.n || name.length > c.n.length || /^[a-z]/.test(c.n))) c.n = name;\n    c.c++; n++; S.cdirty = 1;\n  }\n  return n;\n}\nconst S = (() =>"],
["S.threads ||= {};","S.contacts ||= {}; S.crawl ||= { q: 'abcdefghijklmnopqrstuvwxyz'.split(''), done: 0 }; S.cver ||= 0; S.cparts ||= 0;\nS.threads ||= {};"],
["  const body = { ts: Date.now(), online: true, account, ver: S.ver, parts: S.parts,","  const body = { ts: Date.now(), online: true, account, ver: S.ver, parts: S.parts, cver: S.cver, cparts: S.cparts, ccount: Object.keys(S.contacts).length, crawlLeft: S.crawl.q.length,"],
]);
