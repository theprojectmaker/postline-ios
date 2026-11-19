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
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(20000);
  let queue = Promise.resolve();
  const run = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; }; // one thing at a time on the one page
  const shot = async (n) => { try { await page.screenshot({ path: path.join(here, `last-${n}.png`) }); } catch { /* ignore */ } };

  async function go(hash, waitFor = 'tr.zA, div.nH.h7, .a3s, div[role="main"]') {
    await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
    if (isLogin(page.url())) throw Object.assign(new Error('Not signed in to Gmail — run bridge\\login-gmail.cmd, sign in, close the window'), { fatal: true });
    await page.waitForSelector(waitFor, { timeout: 30000 }).catch(() => {});
    if (isLogin(page.url())) throw Object.assign(new Error('Not signed in to Gmail — run bridge\\login-gmail.cmd'), { fatal: true });
    await sleep(600);
  }

  // ---- list rows -> summaries (also the change signature)
  const rows = new Map(); // id -> summary from the latest list view
  async function readRows(max) {
    const raw = await page.evaluate(() => [...document.querySelectorAll('tr.zA')].map((tr) => {
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
  const rowToSummary = (r, flag) => {
    const date = Date.parse(r.date.replace(/ | /g, ' ')) || Date.now();
    const sig = [r.snippet, r.unread, r.star, r.date, r.count].join('|');
    return { id: r.id, h: sig, subject: (r.subject || '(no subject)').trim(), from: r.fromEmail ? `${r.fromName} <${r.fromEmail}>` : r.fromName, snippet: r.snippet.replace(/^\s*-\s*/, '').trim(), date,
      unread: r.unread, n: Number(r.count) || 1, flags: [flag, ...(r.star ? ['star'] : [])], att: r.att };
  };
  const BOXES = [['inbox', 'inbox', 'inbox'], ['sent', 'sent', 'sent'], ['starred', 'starred', 'star']];
  let unreadCount = 0;

  // ---- one conversation
  async function readThread(id) {
    await go(`#all/${id}`, 'h2.hP, .a3s');
    // open every collapsed message
    for (let i = 0; i < 3; i++) {
      const btn = page.locator('[aria-label="Expand all"], span.aJ6, div.kQ, div.kv').first();
      if (await btn.count() === 0) break;
      await btn.click({ timeout: 2000 }).catch(() => {}); await sleep(300);
    }
    const me = await accountEmail();
    const data = await page.evaluate(() => {
      const subject = (document.querySelector('h2.hP') || {}).innerText || '';
      const msgs = [...document.querySelectorAll('div.adn[data-message-id], div.gs')].filter((e) => e.querySelector('.a3s')).map((e) => {
        const body = e.querySelector('.a3s.aiL, .a3s');
        const from = e.querySelector('.gD');
        const to = [...e.querySelectorAll('.g2[email], .hb span[email]')].map((x) => x.getAttribute('email'));
        const dt = e.querySelector('.g3');
        return { id: (e.closest('[data-legacy-message-id]') || e).getAttribute('data-legacy-message-id') || (e.getAttribute('data-message-id') || ''), name: from ? (from.getAttribute('name') || from.innerText) : '', email: from ? from.getAttribute('email') : '',
          to, date: dt ? (dt.getAttribute('title') || dt.innerText) : '', text: body ? body.innerText : '', html: body ? body.innerHTML : '' };
      });
      return { subject, msgs };
    });
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

  const toolbar = async (label, { confirm } = {}) => {
    const b = page.locator(`div[role="button"][aria-label="${label}"], div[role="button"][data-tooltip="${label}"]`).first();
    await b.click({ timeout: 8000 });
    await sleep(500);
    if (confirm) await page.locator(`button:has-text("${confirm}")`).first().click({ timeout: 2000 }).catch(() => {});
  };

  async function compose({ to, cc, subject, body }) {
    await go('#inbox');
    await page.locator('div[gh="cb"] div[role="button"], div.T-I.T-I-KE.L3').first().click();
    const dlg = page.locator('div[role="dialog"]').last();
    await dlg.waitFor();
    const toBox = dlg.locator('input[aria-label="To recipients"], textarea[name="to"], input[peoplekit-id]').first();
    await toBox.fill(to); await page.keyboard.press('Enter');
    if (cc) { await dlg.locator('span[aria-label*="Cc"], .aB.gQ.pE').first().click().catch(() => {}); await dlg.locator('input[aria-label="Cc recipients"], textarea[name="cc"]').first().fill(cc); await page.keyboard.press('Enter'); }
    await dlg.locator('input[name="subjectbox"]').fill(subject || '');
    await dlg.locator('div[aria-label="Message Body"], div[role="textbox"][g_editable="true"]').first().fill(body || '');
    return dlg;
  }
  async function pressSend(dlg) {
    await dlg.locator('div[role="button"][aria-label^="Send"]').first().click();
    await page.waitForSelector('div[role="dialog"]', { state: 'detached', timeout: 20000 }).catch(() => {});
    await sleep(1500);
  }
  const ownPart = (b) => String(b || '').split(/\n\nOn .{5,120} wrote:\n/)[0].trimEnd(); // Gmail adds its own quote when replying

  return {
    name: 'web', account,
    listIds: () => run(async () => {
      const ids = new Map();
      for (const [slug, , flag] of BOXES) {
        await go('#' + slug);
        const max = Math.min(50, slug === 'inbox' ? cfg.inboxMax : slug === 'sent' ? cfg.sentMax : cfg.starMax);
        const rs = await readRows(max);
        if (slug === 'inbox') unreadCount = rs.filter((r) => r.unread).length;
        for (const r of rs) { const s = rowToSummary(r, flag); const prev = rows.get(r.id); if (prev && !s.flags.includes(prev.flags[0])) s.flags.push(prev.flags[0]); rows.set(r.id, s); if (!ids.has(r.id)) ids.set(r.id, s.h); }
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
    mark: (id, read) => run(async () => { await go(`#all/${id}`, 'h2.hP'); if (!read) { await toolbar('Mark as unread'); } }),
    archive: (id) => run(async () => { await go(`#all/${id}`, 'h2.hP'); await toolbar('Archive'); }),
    trash: (id) => run(async () => { await go(`#all/${id}`, 'h2.hP'); await toolbar('Delete'); }),
    star: (id, on) => run(async () => {
      await go(`#all/${id}`, 'h2.hP');
      const star = page.locator(on ? '[aria-label="Not starred"]' : '[aria-label="Starred"]').first();
      await star.click({ timeout: 8000 }).catch(() => {});
    }),
    send: (op) => run(async () => {
      if (op.threadId) {
        await go(`#all/${op.threadId}`, 'h2.hP');
        const all = !!(op.cc && String(op.cc).trim());
        await page.locator(all ? 'span[role="link"][aria-label*="Reply all"], div[aria-label="Reply all"], [data-tooltip="Reply all"]' : 'span[role="link"]:has-text("Reply"), div[aria-label="Reply"], [data-tooltip="Reply"]').last().click({ timeout: 10000 });
        const box = page.locator('div[aria-label="Message Body"], div[role="textbox"][g_editable="true"]').last();
        await box.waitFor();
        await box.click();
        await box.fill(ownPart(op.body));
        const dlg = page.locator('form, div[role="dialog"]').last();
        await page.locator('div[role="button"][aria-label^="Send"]').last().click();
        void dlg; await sleep(2500);
        return { via: 'reply' };
      }
      const dlg = await compose(op);
      await pressSend(dlg);
      return { via: 'compose' };
    }),
    search: (q) => run(async () => {
      await go('#search/' + encodeURIComponent(q));
      return (await readRows(25)).map((r) => rowToSummary(r, 'all'));
    }),
    close: () => ctx.close(),
    _page: page, _shot: shot,
  };
}
