// Mail state: talks to iCloud, keeps a local cache (so the app opens instantly and works offline), queues requests.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { SEED } from './seed';
import { appendOps, readList, readState, readThread, readSearch, readGlobal, canUse } from './cloudcore';
import { uid } from './util';
import * as demo from './demo';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }) });
}
/** What the notification library would send to Expo's server to register this device, captured instead of sent: on a Wi-Fi that only
 *  allows Apple that server is unreachable, so the PC (which can reach it) makes the registration on the device's behalf. */
async function captureExpoRegistration() {
  const real = global.fetch;
  let body = null;
  global.fetch = (url, init) => {
    if (String((url && url.url) || url).includes('push/getExpoPushToken')) { body = init && init.body ? String(init.body) : null; return Promise.reject(new Error('kept for the PC')); }
    return real(url, init);
  };
  try { await Promise.race([Notifications.getExpoPushTokenAsync(), sleep(15000)]); } catch { /* expected: the request was kept */ } finally { global.fetch = real; }
  try { const j = JSON.parse(body); return j && j.deviceToken && j.deviceId ? j : null; } catch { return null; }
}

const Ctx = createContext(null);
export const useMail = () => useContext(Ctx);

export const cfgFromSeed = () => { try { const s = SEED ? JSON.parse(SEED) : null; return s && s.container ? s : null; } catch { return null; } };
const K = { contacts: 'pl.contacts', list: 'pl.list', ver: 'pl.ver', pend: 'pl.pending', failed: 'pl.failed', status: 'pl.status', th: 'pl.th.' , ths: 'pl.thidx' };
const jget = async (k, d) => { try { const v = await AsyncStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const jset = (k, v) => AsyncStorage.setItem(k, JSON.stringify(v)).catch(() => {});
const ago = (ms) => Date.now() - (ms || 0);

export function MailProvider({ children }) {
  const cfg = useMemo(cfgFromSeed, []);
  const [list, setList] = useState([]);
  const [status, setStatus] = useState(null);       // last pl-state
  const [net, setNet] = useState({ ok: true, err: '', at: 0, busy: false }); // can this device reach iCloud?
  const [pending, setPending] = useState([]);       // requests not yet acknowledged by the bridge [{op, sent}]
  const [failed, setFailed] = useState([]);         // requests the bridge refused [{op, err}]
  const [contacts, setContacts] = useState([]);   // people directory [{e,n,c}] for recipient suggestions
  const [sends, setSends] = useState([]);          // messages being sent [{id,to,status:'sending'|'sent'|'failed',err}]
  const [over, setOver] = useState({});             // optimistic overrides {threadId: {unread?,flags?,gone?}}
  const R = useRef({ cver: 0, ver: 0, pending: [], failed: [], busy: false, cfg, handled: {} });
  R.current.pending = pending; R.current.failed = failed;
  const threads = useRef({});                        // conversation cache {id: detail}
  const [, bump] = useState(0);

  // ---- load cache
  useEffect(() => { if (demo.isDemo()) { setList(demo.list); setStatus(demo.status); setContacts(demo.contacts); return; } (async () => {
    const [l, v, p, f, s, ct] = await Promise.all([jget(K.list, []), jget(K.ver, 0), jget(K.pend, []), jget(K.failed, []), jget(K.status, null), jget(K.contacts, { ver: 0, items: [] })]);
    R.current.ver = v; R.current.cver = ct.ver || 0; setContacts(ct.items || []); setFailed((f0) => f0.filter((x) => Date.now() - (x.op.ts || 0) < 1800000)); setList(l); setPending(p); setFailed(f); setStatus(s);
  })(); }, []);
  useEffect(() => { jset(K.pend, pending); }, [pending]);
  useEffect(() => { jset(K.failed, failed); }, [failed]);

  const stash = (id, d) => { threads.current[id] = d; AsyncStorage.setItem(K.th + id, JSON.stringify(d)).catch(() => {});
    jget(K.ths, []).then((ix) => { const n = [id, ...ix.filter((x) => x !== id)]; n.slice(40).forEach((x) => AsyncStorage.removeItem(K.th + x).catch(() => {})); jset(K.ths, n.slice(0, 40)); }); };

  // ---- the refresh cycle: state -> list when its version changed -> flush queued requests
  const flush = useCallback(async () => {
    const todo = R.current.pending.filter((p) => !p.sent);
    if (!todo.length || !canUse(R.current.cfg)) return;
    await appendOps(R.current.cfg, todo.map((p) => p.op), Object.keys(R.current.handled));
    const ids = new Set(todo.map((p) => p.op.id));
    setPending((cur) => cur.map((p) => (ids.has(p.op.id) ? { ...p, sent: true } : p)));
    setSends((cur) => cur.map((s) => (ids.has(s.id) && s.status === 'sending' ? { ...s, status: 'queued' } : s)));
  }, []);

  const refresh = useCallback(async () => {
    const c = R.current;
    if (demo.isDemo()) return;
    if (!canUse(c.cfg) || c.busy) return;
    c.busy = true; setNet((n) => ({ ...n, busy: true }));
    try {
      const st = await readState(c.cfg);
      if (st) {
        c.handled = st.handled || {};
        setStatus(st); jset(K.status, st);
        if (st.ver && st.ver !== c.ver) {
          const { items, ver } = await readList(c.cfg, 'pl-list', st.parts);
          c.ver = ver; setList(items); jset(K.list, items); jset(K.ver, ver); setOver({});
        }
        if (st.cver && st.cver !== c.cver) { // the people directory changed
          try { const { items, ver } = await readList(c.cfg, 'pl-contacts', st.cparts); c.cver = ver; setContacts(items); jset(K.contacts, { ver, items }); } catch { /* try next round */ }
        }
        // requests the bridge has answered
        const h = st.handled || {};
        setSends((cur) => cur.map((s) => ((s.status === 'sending' || s.status === 'queued') && h[s.id] ? { ...s, status: h[s.id].ok ? 'sent' : 'failed', err: h[s.id].err } : s)));
        const done = R.current.pending.filter((p) => h[p.op.id]);
        if (done.length) {
          setPending((cur) => cur.filter((p) => !h[p.op.id]));
          const bad = done.filter((p) => !h[p.op.id].ok).map((p) => ({ op: p.op, err: h[p.op.id].err || 'Failed' }));
          if (bad.length) { setFailed((cur) => [...cur, ...bad]); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}); }
        }
        // a request whose answer fell out of the bridge's record (older than its list) is certainly old: drop it
        setPending((cur) => cur.filter((p) => !(p.sent && ago(p.op.ts) > 2 * 86400000)));
      }
      await flush();
      setNet({ ok: true, err: '', at: Date.now(), busy: false });
    } catch (e) {
      setNet({ ok: false, err: String(e.message || e).slice(0, 120), at: Date.now(), busy: false });
    } finally { c.busy = false; }
  }, [flush]);

  useEffect(() => {
    refresh();
    const t = setInterval(() => { if (AppState.currentState === 'active') refresh(); }, 3500);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [refresh]);

  // ---- requests
  const enqueue = useCallback((op, optimistic) => {
    const full = { id: uid(), ts: Date.now(), ...op };
    setPending((cur) => [...cur, { op: full, sent: false }]);
    if (optimistic) setOver((o) => ({ ...o, [optimistic.id]: { ...(o[optimistic.id] || {}), ...optimistic.patch } }));
    setTimeout(refresh, 50); // the refresh cycle flushes the queue
    return full.id;
  }, [refresh]);

  const act = useMemo(() => ({
    markRead: (id, read) => enqueue({ t: 'mark', th: id, read }, { id, patch: { unread: !read } }),
    archive: (id) => enqueue({ t: 'archive', th: id }, { id, patch: { gone: 'archive' } }),
    trash: (id) => enqueue({ t: 'trash', th: id }, { id, patch: { gone: 'trash' } }),
    star: (id, on) => enqueue({ t: 'star', th: id, on }, { id, patch: { star: on } }),
    send: (m) => { const id = enqueue({ t: 'send', ...m }); setSends((c) => [...c, { id, to: m.to, status: 'sending' }]); return id; },
    syncNow: () => enqueue({ t: 'refresh' }),
  }), [enqueue]);

  // ---- conversations: cache first, then iCloud; when the bridge has not written it yet, ask for it and wait
  const loadThread = useCallback(async (id, { signal } = {}) => {
    if (demo.isDemo()) return demo.thread(id);
    const cached = threads.current[id] || await jget(K.th + id, null);
    if (cached) threads.current[id] = cached;
    const want = (list.find((x) => x.id === id) || {}).h;
    if (cached && (!want || cached.h === want)) return cached;
    let asked = false, best = cached;
    for (let i = 0; i < 25; i++) {
      if (signal && signal.aborted) return best;
      try {
        const t = await readThread(R.current.cfg, id);
        if (t) { best = t; if (!want || t.h === want) { stash(id, t); return t; } }
      } catch (e) { if (best) return best; }
      if (i === 0 && best && best !== cached) { /* stale copy is on screen already */ }
      if (!asked) { asked = true; enqueue({ t: 'open', th: id }); }
      if (best && i >= 6) { stash(id, best); return best; }
      await new Promise((r) => setTimeout(r, 2500));
    }
    return best;
  }, [list, enqueue]);

  const search = useCallback(async (q, signal) => {
    const id = enqueue({ t: 'search', q });
    for (let i = 0; i < 30; i++) {
      if (signal && signal.aborted) return null;
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const r = await readSearch(R.current.cfg, id);
        if (r) return r;
        const h = R.current.handled[id];
        if (h && !h.ok) throw new Error(h.err || 'Search failed');
      } catch (e) { if (/Search failed|Failed/.test(String(e.message))) throw e; }
    }
    return null;
  }, [enqueue]);

  // ---- notifications: ask permission, get this device's push address (through the PC when Expo is unreachable), tell the PC
  useEffect(() => {
    if (Platform.OS === 'web' || !cfg || demo.isDemo()) return;
    (async () => {
      try {
        const p = await Notifications.requestPermissionsAsync();
        if (!p.granted) return;
        let token = await jget('pl.pushToken', '');
        try { token = (await Promise.race([Notifications.getExpoPushTokenAsync(), sleep(8000).then(() => { throw new Error('no answer'); })])).data || token; jset('pl.pushToken', token); } catch { /* that server is blocked here */ }
        const last = await jget('pl.pushAt', 0);
        if (token) { if ((await jget('pl.pushReg', '')) !== token || Date.now() - last > 6 * 3600000) { enqueue({ t: 'push', token }); jset('pl.pushReg', token); jset('pl.pushAt', Date.now()); } return; }
        const reg = await captureExpoRegistration();
        if (reg && (reg.deviceToken !== (await jget('pl.pushRelay', '')) || Date.now() - last > 6 * 3600000)) { enqueue({ t: 'pushreg', body: reg }); jset('pl.pushRelay', reg.deviceToken); jset('pl.pushAt', Date.now()); }
      } catch { /* notifications stay off */ }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- people: instant local matches; "search the directory" asks the PC for fresh suggestions and merges them in
  const suggestRemote = useCallback(async (q) => {
    const id = enqueue({ t: 'suggest', q });
    for (let i = 0; i < 14; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const rows = await readGlobal(R.current.cfg, id);
        if (rows) { setContacts((cur) => { const m = new Map(cur.map((x) => [x.e, x])); rows.forEach((r) => m.set(r.e, { ...(m.get(r.e) || { c: 0 }), ...r })); const out = [...m.values()]; jset(K.contacts, { ver: R.current.cver, items: out }); return out; }); return rows; }
      } catch { /* retry */ }
    }
    return null;
  }, [enqueue]);

  // ---- derived view of the list (optimistic overrides applied)
  const visible = useMemo(() => list.map((t) => {
    const o = over[t.id]; if (!o) return t;
    const flags = o.star === undefined ? t.flags : (o.star ? [...new Set([...(t.flags || []), 'star'])] : (t.flags || []).filter((f) => f !== 'star'));
    const fl = o.gone === 'archive' ? flags.filter((f) => f !== 'inbox') : flags;
    return { ...t, unread: o.unread === undefined ? t.unread : o.unread, flags: fl, trashed: o.gone === 'trash' };
  }).filter((t) => !t.trashed), [list, over]);

  const online = demo.isDemo() || !!(status && ago(status.ts) < 150000);
  const value = { contacts, suggestRemote, sends, clearSend: (id) => setSends((c) => c.filter((s) => s.id !== id)), cfg: cfg || (demo.isDemo() ? { demo: 1 } : null), list: visible, status, net, online, pending, failed, dismissFailed: (id) => setFailed((c) => c.filter((f) => f.op.id !== id)),
    retryFailed: (f) => { setFailed((c) => c.filter((x) => x.op.id !== f.op.id)); { const { id, ts, ...rest } = f.op; enqueue(rest); }; },
    refresh, act, loadThread, search, bump: () => bump((x) => x + 1) };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
