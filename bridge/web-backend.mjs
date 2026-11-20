// Backend B (default): drives the Gmail WEBSITE in a signed-in Chrome profile, the same way the Classroom checker drives Google
// Classroom. Needs no Google API approval. Sign in once with bridge/login-gmail.cmd; the session lives in bridge/profile (gitignored).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { here } from './config.mjs';

const BASE = 'https://mail.google.com/mail/u/0/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function loadPlaywright() {
  try { return await import('playwright-core'); } catch { /* fall back to the Classroom checker's copy */ }
  const p = path.resolve(here, '..', '..', 'classroom-checker', 'node_modules', 'playwright-core', 'index.mjs');
  return import(pathToFileURL(p).href);
}
const isLogin = (u) => /accounts\.google\.com|\/signin|ServiceLogin/i.test(u);

export async function makeWebBackend(cfg, log = console.log) {
  const { chromium } = await loadPlaywright();
  const ctx = await chromium.launchPersistentContext(cfg.profile, {
    channel: 'chrome', headless: cfg.headless !== false, viewport: { width: 1400, height: 1000 }, args: ['--disable-background-mode'],
    ...(cfg.chromePath ? { executablePath: cfg.chromePath, channel: undefined } : {}),
  });
  let page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(20000);
  let queue = Promise.resolve();
  async function fresh() { try { await page.close(); } catch { /* gone */ } page = await ctx.newPage(); page.setDefaultTimeout(20000); }
  const crashed = (e) => /crash|closed|Target page|Navigation failed/i.test(String(e && e.message));
  // one thing at a time on the one page; a crashed tab is replaced and the step retried once
  const run = (fn) => { const step = async () => { try { return await fn(); } catch (e) { if (!crashed(e)) throw e; log('page crashed, opening a fresh tab'); await fresh(); return fn(); } }; const p = queue.then(step, step); queue = p.catch(() => {}); return p; };
  const shot = async (n) => { try { await page.screenshot({ path: path.join(here, `last-${n}.png`) }); } catch { /* ignore */ } };

  let where = 'idle', lastProgress = Date.now();
  const at = (x) => { lastProgress = Date.now(); where = x + ' @ ' + new Date().toISOString().slice(11, 19); };
  async function go(hash, waitFor = 'tr.zA, div.nH.h7, .a3s, div[role="main"]') {
    at('goto ' + hash.slice(0, 30));
    await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
    if (isLogin(page.url())) throw Object.assign(new Error('Not signed in to Gmail — run bridge\\login-gmail.cmd, sign in, close the window'), { fatal: true });
    await page.waitForSelector(waitFor.split(', ').map((x) => x + ':visible').join(', '), { timeout: 15000 }).catch(() => {});
    if (isLogin(page.url())) throw Object.assign(new Error('Not signed in to Gmail — run bridge\\login-gmail.cmd'), { fatal: true });
    await sleep(600);
  }

  // the list DOM is reused between views: wait until the tab title says which view is showing, then let the rows settle
  const HASH = { inbox: '#search/in%3Ainbox', sent: '#sent', starred: '#starred' };
  const TITLES = { inbox: /^(Search results|Inbox)/i, sent: /^Sent/i, starred: /^Starred/i };
  async function waitView(slug) {
    if (slug !== 'inbox') for (let i = 0; i < 16; i++) { if (TITLES[slug] ? TITLES[slug].test(await page.title()) : i > 6) break; await sleep(250); }
    // the list DOM fills in gradually (slowly while other tabs are busy): wait until the number of visible rows stops changing
    let prev = -1;
    for (let i = 0; i < 24; i++) {
      await sleep(400);
      const n = await page.evaluate(() => [...document.querySelectorAll('tr.zA')].filter((t) => t.offsetParent !== null).length).catch(() => 0);
      if (n > 0 && n === prev && i >= 2) break;
      prev = n;
    }
    await sleep(300);
  }

  // ---- list rows -> summaries (also the change signature)
  const rows = new Map(); // id -> summary from the latest list view
  async function readRowsOn(p, max) {
    const raw = await p.evaluate(() => [...document.querySelectorAll('tr.zA')].filter((tr) => tr.offsetParent !== null).map((tr) => {
      const idEl = tr.querySelector('[data-legacy-thread-id]');
      const nameEl = tr.querySelector('.yW span[email], .yP, .zF');
      const dateEl = tr.querySelector('td.xW span[title], td.xW span');
      const subj = tr.querySelector('.bog');
      return {
        id: idEl ? idEl.getAttribute('data-legacy-thread-id') : '',
        subject: subj ? subj.innerText : '',
        fromName: nameEl ? (nameEl.getAttribute('name') || nameEl.innerText) : '',
        fromEmail: nameEl ? (nameEl.getAttribute('email') || '') : '',
        snippet: (tr.querySelector('.y2') || {}).innerText || '',
        date: dateEl ? (dateEl.getAttribute('title') || dateEl.innerText) : '',
        unread: tr.classList.contains('zE'),
        star: !!tr.querySelector('.T-KT-Jp, [aria-label="Starred"]'),
        att: !!tr.querySelector('.brd, [aria-label*="ttachment"]'),
        count: ((tr.querySelector('.bx0, .bqe') || {}).innerText || '').replace(/[^\d]/g, ''),
      };
    }));
    return raw.filter((r) => r.id).slice(0, max);
  }
  const readRows = (max) => { at('readRows'); return readRowsOn(page, max); };
  const rowToSummary = (r, flag) => {
    const date = Date.parse(r.date.replace(/ | /g, ' ')) || Date.now();
    const sig = [r.snippet, r.unread, r.star, r.date, r.count].join('|');
    return { id: r.id, h: sig, subject: (r.subject || '(no subject)').trim(), from: r.fromEmail ? `${r.fromName} <${r.fromEmail}>` : r.fromName, snippet: r.snippet.replace(/^\s*-\s*/, '').trim(), date,
      unread: r.unread, n: Number(r.count) || 1, flags: [flag, ...(r.star ? ['star'] : [])], att: r.att };
  };
  const BOXES = [['inbox', 'inbox', 'inbox'], ['sent', 'sent', 'sent'], ['starred', 'starred', 'star']];
  let unreadCount = 0, lastInbox = 0;

  // Opens a conversation by clicking its row in whichever list shows it (a direct URL does not open multi-message threads).
  const DBG = !!process.env.PL_DEBUG; let L0 = Date.now(); const lap = (l) => { if (DBG) console.log('    +' + String(Date.now() - L0).padStart(6) + 'ms', l); };
  async function openThread(id) {
    at('openThread'); L0 = Date.now();
    for (const slug of ['inbox', 'sent', 'starred']) {
      if ((await page.evaluate(() => location.hash).catch(() => '')) !== HASH[slug]) { await go(HASH[slug]); await waitView(slug); }
      const row = page.locator(`tr.zA:visible:has([data-legacy-thread-id="${id}"])`).first();
      lap('list ' + slug + ' ready');
      if (await row.count()) {
        lap('row found');
        await row.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});
        lap('scrolled');
        await row.click({ position: { x: 300, y: 12 }, timeout: 8000 });
        lap('clicked');
        return true;
      }
    }
    await go('#search/' + encodeURIComponent('rfc822msgid:' + id)).catch(() => {});
    return false;
  }

  // ---- one conversation
  async function readThread(id) {
    at('readThread');
    const sigOf = () => page.evaluate(() => { const v = (e) => e.offsetParent !== null; const h = [...document.querySelectorAll('h2.hP')].find(v); const b = [...document.querySelectorAll('.a3s')].find(v); return (h ? h.innerText : '') + '|' + (b ? b.innerText.slice(0, 60) : '') + '|' + document.querySelectorAll('div.adn').length; });
    const before = await sigOf().catch(() => '');
    if (!(await openThread(id))) throw new Error('Thread not found');
    for (let i = 0; i < 24; i++) { const now = await sigOf().catch(() => ''); if (now !== before && /|/.test(now) && now.split('|')[0]) break; await sleep(250); } // wait for THIS thread to replace the previous one
    lap('thread view replaced previous');
    await sleep(400);
    // open every collapsed message
    for (let i = 0; i < 3; i++) {
      const btn = page.locator('[aria-label="Expand all"]:visible, span.aJ6:visible, div.kQ:visible, div.kv:visible').first();
      if (await btn.count() === 0) break;
      await btn.click({ timeout: 1500 }).catch(() => {}); await sleep(250);
    }
    lap('expanded');
    const me = await accountEmail();
    lap('account');
    const data = await page.evaluate(() => {
      const v = (e) => e.offsetParent !== null;
      const subject = ([...document.querySelectorAll('h2.hP')].find(v) || {}).innerText || '';
      const msgs = [...document.querySelectorAll('div.adn[data-message-id]')].filter((e) => v(e) && e.querySelector('.a3s')).map((e) => {
        const body = e.querySelector('.a3s.aiL, .a3s');
        const from = e.querySelector('.gD');
        const to = [...e.querySelectorAll('.g2[email], .hb span[email]')].map((x) => x.getAttribute('email'));
        const dt = e.querySelector('.g3');
        return { id: (e.closest('[data-legacy-message-id]') || e).getAttribute('data-legacy-message-id') || (e.getAttribute('data-message-id') || ''), name: from ? (from.getAttribute('name') || from.innerText) : '', email: from ? from.getAttribute('email') : '',
          to, date: dt ? (dt.getAttribute('title') || dt.innerText) : '', text: body ? body.innerText : '', html: body ? body.innerHTML : '' };
      });
      return { subject, msgs };
    });
    lap('evaluated');
    return { subject: data.subject, msgs: data.msgs, me };
  }
  async function accountEmail() {
    if (accountEmail.v) return accountEmail.v;
    const label = await page.locator('a[aria-label*="Google Account"], [aria-label*="Google Account:"]').first().getAttribute('aria-label').catch(() => '');
    const m = String(label || '').match(/[\w.+-]+@[\w.-]+/);
    if (m) accountEmail.v = m[0].toLowerCase();
    return accountEmail.v || '';
  }

  // initial navigation (also detects "not signed in" immediately)
  await go('#inbox');
  const account = await accountEmail();
  log(`web backend ready (${account || 'account unknown'})`);

  // Finds the row for a thread in whichever list shows it (the toolbar in an opened conversation is not usable headless;
  // the list toolbar, which appears once a row is ticked, is).
  async function rowFor(id) {
    for (const slug of ['inbox', 'sent', 'starred']) {
      if ((await page.evaluate(() => location.hash).catch(() => '')) !== HASH[slug]) { await go(HASH[slug]); await waitView(slug); }
      const row = page.locator(`tr.zA:visible:has([data-legacy-thread-id="${id}"])`).first();
      if (await row.count()) { await row.scrollIntoViewIfNeeded().catch(() => {}); return row; }
    }
    throw new Error('Thread not found');
  }
  async function listAction(id, label) {
    at('listAction ' + label);
    const row = await rowFor(id);
    await row.locator('div[role="checkbox"]').first().click({ timeout: 8000 });
    await sleep(500);
    const btn = page.locator(`div[role="button"][aria-label="${label}"]:visible`).first();
    if (label === 'Archive' && !(await btn.count())) { await row.locator('div[role="checkbox"]').first().click().catch(() => {}); return; } // not in the inbox: already archived
    await btn.click({ timeout: 8000 });
    await sleep(900);
  }
  const toolbar = async (label, { confirm } = {}) => {
    const b = page.locator(`div[role="button"][aria-label="${label}"], div[role="button"][data-tooltip="${label}"]`).first();
    await b.click({ timeout: 8000 });
    await sleep(500);
    if (confirm) await page.locator(`button:has-text("${confirm}")`).first().click({ timeout: 2000 }).catch(() => {});
  };

  async function compose({ to, cc, bcc, subject, body }) {
    await go('#inbox');
    await page.locator('div[gh="cb"] div[role="button"], div.T-I.T-I-KE.L3').first().click();
    const dlg = page.locator('div[role="dialog"]').last();
    await dlg.waitFor();
    const toBox = dlg.locator('input[aria-label="To recipients"], textarea[name="to"], input[peoplekit-id]').first();
    if (to) { await toBox.fill(to); await page.keyboard.press('Enter'); }
    if (cc) { await dlg.locator('span[aria-label^="Add Cc"]').first().click().catch(() => {}); await dlg.locator('input[aria-label="Cc recipients" i], textarea[name="cc"]').first().fill(cc); await page.keyboard.press('Enter'); }
    if (bcc) {
      await dlg.locator('span[aria-label^="Add Bcc"]').first().click().catch(() => {});
      await dlg.locator('input[aria-label="Bcc recipients" i], textarea[name="bcc"]').first().fill(bcc);
      await page.keyboard.press('Enter');
    }
    await dlg.locator('input[name="subjectbox"]').fill(subject || '');
    await dlg.locator('div[aria-label="Message Body"], div[role="textbox"][g_editable="true"]').first().fill(body || '');
    return dlg;
  }
  // Presses Send, then WAITS for Gmail to confirm: its "Message sent" toast, or the composer closing. No confirmation = not sent:
  // the half-written message is left as a draft and the request is retried (never reported as sent).
  async function pressSendAndConfirm(sendBtn) {
    at('send');
    await sendBtn.click({ timeout: 10000 });
    for (let i = 0; i < 44; i++) { // up to ~22 s
      await sleep(500);
      if (await page.locator('div[role="alert"]:has-text("Message sent"), span.bAq:has-text("Message sent")').count()) { await sleep(400); return; }
      const open = await page.locator('div[aria-label="Message Body"]:visible, div[role="textbox"][g_editable="true"]:visible').count();
      if (!open && i >= 2) { await sleep(600); return; }
      const err = await page.locator('div[role="alertdialog"], div.Kj-JD:has-text("couldn")').first().innerText().catch(() => '');
      if (/couldn|not found|invalid|can.?t send|error/i.test(err)) { await page.keyboard.press('Escape').catch(() => {}); throw new Error('Gmail refused to send: ' + err.split('\n')[0].slice(0, 100)); }
    }
    await page.keyboard.press('Escape').catch(() => {});
    throw new Error('Timeout: Gmail did not confirm the send');
  }
  async function pressSend(dlg) { await pressSendAndConfirm(dlg.locator('div[role="button"][aria-label^="Send"]').first()); }
  // ---- people search: Gmail's own recipient suggestions (includes the school directory), on a second tab so mail work is never blocked
  // three tabs share the work (each handles one query at a time), so the whole school directory can be crawled quickly
  const dirs = Array.from({ length: cfg.dirTabs || 3 }, () => ({ page: null, queue: Promise.resolve(), busy: 0 }));
  const dirRun = (fn) => { const d = dirs.reduce((a, b) => (b.busy < a.busy ? b : a)); d.busy++; const p = d.queue.then(() => fn(d), () => fn(d)); d.queue = p.catch(() => {}).then(() => { d.busy--; }); return p; };
  async function ensureDir(d) {
    if (d.page && !d.page.isClosed()) return d.page;
    d.page = await ctx.newPage(); d.page.setDefaultTimeout(15000);
    await d.page.goto(BASE + '?view=cm&fs=1', { waitUntil: 'domcontentloaded' });
    if (isLogin(d.page.url())) throw Object.assign(new Error('Not signed in to Gmail'), { fatal: true });
    await d.page.waitForSelector('input[peoplekit-id], textarea[name="to"], input[aria-label="To recipients"]', { timeout: 30000 });
    return d.page;
  }
  async function suggestOn(d, q) {
    const p = await ensureDir(d);
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
  // ---- live watcher: its own tab parked on the whole inbox; Gmail's Refresh button is pressed every couple of seconds and the rows read
  // straight away, so a new message is noticed in about 2-4 seconds without touching the busy main tab
  let watchPage = null;
  async function ensureWatch() {
    if (watchPage && !watchPage.isClosed()) return watchPage;
    watchPage = await ctx.newPage(); watchPage.setDefaultTimeout(15000);
    await watchPage.goto(BASE + HASH.inbox, { waitUntil: 'domcontentloaded' });
    if (isLogin(watchPage.url())) throw Object.assign(new Error('Not signed in to Gmail'), { fatal: true });
    await watchPage.waitForSelector('tr.zA', { timeout: 30000 }).catch(() => {});
    return watchPage;
  }
  let watchQ = Promise.resolve();
  const watchRun = (fn) => { const p = watchQ.then(fn, fn); watchQ = p.catch(() => {}); return p; };
  // quick read of another box (Sent) on the watcher tab, then back to the inbox: lets a just-sent message show up in seconds
  async function quickBoxOnce(slug) {
    const p = await ensureWatch();
    await p.goto(BASE + HASH[slug], { waitUntil: 'domcontentloaded' });
    for (let i = 0; i < 20; i++) { await sleep(300); if (TITLES[slug] && TITLES[slug].test(await p.title().catch(() => ''))) break; }
    let prev = -1;
    for (let i = 0; i < 16; i++) { await sleep(350); const n = await p.evaluate(() => [...document.querySelectorAll('tr.zA')].filter((t) => t.offsetParent !== null).length).catch(() => 0); if (n > 0 && n === prev) break; prev = n; }
    const rows = await readRowsOn(p, 30);
    await p.goto(BASE + HASH.inbox, { waitUntil: 'domcontentloaded' }).catch(() => {});
    return rows.map((r) => rowToSummary(r, slug === 'sent' ? 'sent' : slug));
  }
  async function watchOnce() {
    const p = await ensureWatch();
    if (!/search\/in%3Ainbox$/.test(await p.evaluate(() => location.hash).catch(() => ''))) { await p.goto(BASE + HASH.inbox, { waitUntil: 'domcontentloaded' }); await sleep(2500); }
    await p.locator('div[role="button"][aria-label="Refresh"]:visible, div[role="button"][data-tooltip="Refresh"]:visible').first().click({ timeout: 4000 }).catch(() => {});
    await sleep(1100);
    return (await readRowsOn(p, Math.min(50, cfg.inboxMax))).map((r) => rowToSummary(r, 'inbox'));
  }
  const ownPart = (b) => String(b || '').split(/\n\nOn .{5,120} wrote:\n/)[0].trimEnd(); // Gmail adds its own quote when replying

  return {
    name: 'web', account,
    listIds: () => run(async () => {
      const ids = new Map();
      for (const [slug, , flag] of BOXES) {
        await go(HASH[slug]);
        await waitView(slug);
        let attempt = 0;
        const max = Math.min(50, slug === 'inbox' ? cfg.inboxMax : slug === 'sent' ? cfg.sentMax : cfg.starMax);
        let rs = await readRows(max);
        // a half-loaded inbox must never be published (it would make real mail vanish): look again, and give up for this cycle if still short
        while (slug === 'inbox' && rs.length < 5 && (lastInbox >= 20) && attempt < 3) { attempt++; await sleep(3000); await go(HASH[slug]); await waitView(slug); rs = await readRows(max); }
        if (slug === 'inbox' && rs.length < 5 && lastInbox >= 20) throw new Error('The inbox did not load completely - trying again next cycle');
        if (slug === 'inbox') lastInbox = rs.length;
        if (slug === 'inbox') unreadCount = rs.filter((r) => r.unread).length;
        for (const r of rs) { const s = rowToSummary(r, flag); const prev = rows.get(r.id); if (prev && !s.flags.includes(prev.flags[0])) s.flags.push(prev.flags[0]); s.flags = [...new Set(s.flags)]; rows.set(r.id, s); if (!ids.has(r.id)) ids.set(r.id, s.h); }
      }
      return ids;
    }),
    fetchThread: (id) => run(async () => {
      const t = await readThread(id);
      if (!t.msgs.length) throw new Error('Thread not found');
      const base = rows.get(id) || {};
      const msgs = t.msgs.map((m, i) => ({
        id: m.id || `${id}-${i}`, from: m.email ? `${m.name} <${m.email}>` : m.name, to: (m.to || []).join(', '), cc: '', subject: t.subject, date: Date.parse((m.date || '').replace(/ | /g, ' ')) || base.date || 0,
        msgid: '', refs: '', unread: false, labels: (t.me && m.email && m.email.toLowerCase() === t.me) ? ['SENT'] : ['INBOX'], text: (m.text || '').slice(0, 60000), html: '', atts: [], snippet: (m.text || '').replace(/\s+/g, ' ').slice(0, 100),
      }));
      const last = msgs[msgs.length - 1];
      const summary = { ...base, id, h: base.h || String(last.date), subject: t.subject || base.subject || '(no subject)', n: msgs.length, date: last.date || base.date || Date.now(), snippet: base.snippet || last.snippet, from: base.from || last.from, unread: !!base.unread, flags: base.flags || ['inbox'], att: !!base.att };
      return { summary, detail: { id, h: summary.h, subject: summary.subject, msgs, flags: summary.flags } };
    }),
    unread: async () => unreadCount,
    summaryOf: (id) => rows.get(id),
    mark: (id, read) => run(async () => { if (read) return; await listAction(id, 'Mark as unread'); }),
    archive: (id) => run(() => listAction(id, 'Archive')),
    trash: (id) => run(() => listAction(id, 'Delete')),
    star: (id, on) => run(async () => {
      const row = await rowFor(id);
      const star = row.locator('span.aXw').first();
      const isOn = (await star.getAttribute('aria-label').catch(() => '')) === 'Starred';
      if (isOn !== !!on) { await star.click({ timeout: 8000 }); await sleep(800); }
    }),
    send: (op) => run(async () => {
      if (op.threadId) {
        await openThread(op.threadId); await page.waitForSelector('h2.hP', { timeout: 15000 });
        const all = !!(op.cc && String(op.cc).trim());
        await page.locator(all ? 'span[role="link"][aria-label*="Reply all"], div[aria-label="Reply all"], [data-tooltip="Reply all"]' : 'span[role="link"]:has-text("Reply"), div[aria-label="Reply"], [data-tooltip="Reply"]').last().click({ timeout: 10000 });
        const box = page.locator('div[aria-label="Message Body"], div[role="textbox"][g_editable="true"]').last();
        await box.waitFor();
        await box.click();
        await box.fill(ownPart(op.body));
        await pressSendAndConfirm(page.locator('div[role="button"][aria-label^="Send"]:visible').last());
        return { via: 'reply' };
      }
      const dlg = await compose(op);
      await pressSend(dlg);
      return { via: 'compose' };
    }),
    search: (q) => run(async () => {
      await go('#search/' + encodeURIComponent(q));
      for (let i = 0; i < 40 && !/search/i.test(await page.title()); i++) await sleep(250);
      await sleep(1500);
      return (await readRows(25)).map((r) => rowToSummary(r, 'all'));
    }),
    suggest: (q) => dirRun(async (d) => { try { return await suggestOn(d, q); } catch (e) { if (crashed(e)) { d.page = null; return suggestOn(d, q); } throw e; } }),
    watch: () => watchRun(async () => { try { return await watchOnce(); } catch (e) { if (crashed(e)) watchPage = null; throw e; } }),
    quick: (slug) => watchRun(async () => { try { return await quickBoxOnce(slug); } catch (e) { if (crashed(e)) watchPage = null; throw e; } }),
    _progress: () => lastProgress,
    _where: () => `${where}; url=${(() => { try { return page.url().replace(/\/mail\/u\/0\/?/, '/').slice(0, 70); } catch { return '?'; } })()}`,
    close: () => ctx.close(),
    _page: page, _shot: shot,
  };
}
