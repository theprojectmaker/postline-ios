// Mail screens: mailbox sidebar, thread list, conversation, compose sheet, status banner.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { T, hair, avatarColor } from './theme';
import { fullDate, fwdPrefix, initial, lastToken, listDate, looksEmail, matchContacts, parseAddr, quoteFor, replaceLastToken, rePrefix, senderName, validEmails } from './util';
import { useMail } from './store';

export const BOXES = [
  { key: 'inbox', name: 'Inbox', icon: 'mail-outline', test: (t) => (t.flags || []).includes('inbox') },
  { key: 'unread', name: 'Unread', icon: 'mail-unread-outline', test: (t) => t.unread },
  { key: 'star', name: 'Starred', icon: 'star-outline', test: (t) => (t.flags || []).includes('star') },
  { key: 'sent', name: 'Sent', icon: 'paper-plane-outline', test: (t) => (t.flags || []).includes('sent') },
  { key: 'all', name: 'All Recent', icon: 'albums-outline', test: () => true },
];
const press = (fn) => () => { Haptics.selectionAsync().catch(() => {}); fn(); };

function IconBtn({ name, onPress, color = T.tint, disabled, size = 24, label }) {
  return (
    <Pressable onPress={press(onPress)} disabled={disabled} hitSlop={8} accessibilityLabel={label} style={({ pressed }) => [{ padding: 8, opacity: disabled ? 0.3 : pressed ? 0.5 : 1 }]}>
      <Ionicons name={name} size={size} color={color} />
    </Pressable>
  );
}

// ---------- status banner
export function Banner() {
  const { net, online, pending, failed, status, dismissFailed, retryFailed, cfg } = useMail();
  const ins = useSafeAreaInsets();
  const rows = [];
  if (!cfg) rows.push({ k: 'nokey', c: T.red, t: 'This build has no iCloud key. Install the latest TestFlight build.' });
  else if (!net.ok && net.at) rows.push({ k: 'net', c: T.amber, t: 'Can’t reach iCloud right now. Showing saved mail.' });
  else if (status && !online) rows.push({ k: 'pc', c: T.amber, t: 'Your computer’s Postline bridge is offline. New mail is paused; anything you send will go out when it’s back.' });
  else if (!status && net.at && net.ok) rows.push({ k: 'wait', c: T.amber, t: 'Waiting for the Postline bridge on your computer to publish your mail.' });
  failed.filter((f) => Date.now() - (f.op.ts || 0) < 1800000).forEach((f) => rows.push({ k: f.op.id, c: T.red, t: `${f.op.t === 'send' ? 'Message to ' + (f.op.to || '').slice(0, 30) : 'A change'} failed: ${f.err}`, f }));
  if (!rows.length) return null;
  return (
    <View style={{ paddingTop: ins.top }}>
      {rows.map((r) => (
        <View key={r.k} style={[st.banner, { backgroundColor: r.c + '22' }]}>
          <Ionicons name={r.f ? 'alert-circle' : 'information-circle'} size={18} color={r.c} />
          <Text style={[st.bannerText, { color: T.text }]}>{r.t}</Text>
          {r.f && (<>
            <Pressable onPress={() => retryFailed(r.f)} hitSlop={8}><Text style={st.bannerBtn}>Retry</Text></Pressable>
            <Pressable onPress={() => dismissFailed(r.f.op.id)} hitSlop={8}><Ionicons name="close" size={18} color={T.sub} /></Pressable>
          </>)}
        </View>
      ))}
    </View>
  );
}

// ---------- sidebar / mailbox picker
export function Mailboxes({ box, setBox, wide }) {
  const { list, status, online, cfg } = useMail();
  const ins = useSafeAreaInsets();
  const count = (b) => (b.key === 'inbox' ? (status ? status.unread : list.filter((t) => b.test(t) && t.unread).length) : b.key === 'unread' ? list.filter((t) => t.unread).length : 0);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.group }} contentContainerStyle={{ paddingTop: ins.top + 12, paddingBottom: 30 }}>
      <View style={{ paddingHorizontal: 20, marginBottom: 8 }}>
        <Text style={st.bigTitle}>Mailboxes</Text>
        <Text style={st.acct}>{(status && status.account) || 'Postline'}</Text>
      </View>
      <View style={st.group}>
        {BOXES.map((b, i) => {
          const sel = wide && box === b.key, n = count(b);
          return (
            <Pressable key={b.key} onPress={press(() => setBox(b.key))} style={({ pressed }) => [st.boxRow, sel && { backgroundColor: T.tintSoft }, pressed && { opacity: 0.6 }, i && { borderTopWidth: hair, borderTopColor: T.line }]}>
              <Ionicons name={b.icon} size={22} color={T.tint} style={{ width: 30 }} />
              <Text style={[st.boxName, sel && { fontWeight: '600' }]}>{b.name}</Text>
              {n > 0 && <Text style={st.boxCount}>{n}</Text>}
              {!wide && <Ionicons name="chevron-forward" size={16} color={T.line} style={{ marginLeft: 8 }} />}
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, marginTop: 18 }}>
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: !cfg ? T.red : online ? T.green : T.amber }} />
        <Text style={{ color: T.sub, fontSize: 13, flex: 1 }}>{!cfg ? 'No iCloud key in this build' : online ? 'Connected through iCloud' : status ? 'Bridge offline' : 'Waiting for bridge'}</Text>
      </View>
    </ScrollView>
  );
}

// ---------- thread list
function Row({ t, selected, onOpen }) {
  const star = (t.flags || []).includes('star');
  const sentBox = (t.flags || []).includes('sent') && !(t.flags || []).includes('inbox');
  return (
    <Pressable onPress={press(() => onOpen(t.id))} style={({ pressed }) => [st.row, selected && { backgroundColor: T.tint }, pressed && !selected && { backgroundColor: '#F2F2F7' }]}>
      <View style={st.dotCol}>{t.unread && <View style={[st.dot, selected && { backgroundColor: '#fff' }]} />}</View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Text numberOfLines={1} style={[st.from, selected && { color: '#fff' }]}>{sentBox ? 'To: ' : ''}{senderName(t.from)}</Text>
          {t.n > 1 && <Text style={[st.cnt, selected && { color: '#fffc' }]}> {t.n}</Text>}
          <View style={{ flex: 1 }} />
          {star && <Ionicons name="star" size={12} color={selected ? '#fff' : T.amber} style={{ marginRight: 4 }} />}
          {t.att && <Ionicons name="attach" size={14} color={selected ? '#fff' : T.faint} style={{ marginRight: 3 }} />}
          <Text style={[st.when, selected && { color: '#fffc' }]}>{listDate(t.date)}</Text>
        </View>
        <Text numberOfLines={1} style={[st.subj, selected && { color: '#fff' }]}>{t.subject}</Text>
        <Text numberOfLines={2} style={[st.snip, selected && { color: '#fffd' }]}>{t.snippet}</Text>
      </View>
    </Pressable>
  );
}

export function ThreadList({ box, openId, onOpen, onBack, onCompose, wide }) {
  const { list, refresh, net, search, cfg } = useMail();
  const ins = useSafeAreaInsets();
  const def = BOXES.find((b) => b.key === box) || BOXES[0];
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState(null); // {q, items|null(loading)|err}
  const abort = useRef(null);
  const items = useMemo(() => {
    const base = list.filter(def.test);
    const needle = q.trim().toLowerCase();
    if (!needle) return base;
    return base.filter((t) => `${t.subject} ${t.from} ${t.snippet}`.toLowerCase().includes(needle));
  }, [list, def, q]);
  const runRemote = async () => {
    const s = q.trim(); if (!s) return;
    abort.current && (abort.current.aborted = true);
    const sig = { aborted: false }; abort.current = sig;
    setRemote({ q: s, items: null });
    try { const r = await search(s, sig); if (!sig.aborted) setRemote({ q: s, items: r || [], timeout: !r }); }
    catch (e) { if (!sig.aborted) setRemote({ q: s, items: [], err: e.message }); }
  };
  useEffect(() => { if (!q.trim()) { abort.current && (abort.current.aborted = true); setRemote(null); } }, [q]);
  const [refreshing, setRefreshing] = useState(false);
  const data = remote && remote.q === q.trim() && remote.items ? remote.items : items;
  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <View style={{ paddingTop: ins.top + 4, paddingHorizontal: 8, paddingBottom: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
          {!wide ? (
            <Pressable onPress={onBack} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', width: 110 }}>
              <Ionicons name="chevron-back" size={26} color={T.tint} /><Text style={{ color: T.tint, fontSize: 17 }}>Mailboxes</Text>
            </Pressable>
          ) : <View style={{ width: 8 }} />}
          <View style={{ flex: 1 }} />
          <IconBtn name="create-outline" onPress={() => onCompose()} label="Compose" />
        </View>
        <Text style={st.bigTitle2}>{def.name}</Text>
        <View style={st.search}>
          <Ionicons name="search" size={16} color={T.faint} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={T.faint} returnKeyType="search" onSubmitEditing={runRemote} style={st.searchInput} autoCorrect={false} autoCapitalize="none" />
          {!!q && <Pressable onPress={() => setQ('')} hitSlop={8}><Ionicons name="close-circle" size={17} color={T.faint} /></Pressable>}
        </View>
        {!!q.trim() && (
          <Pressable onPress={runRemote} style={{ paddingVertical: 8, paddingHorizontal: 6 }}>
            <Text style={{ color: T.tint, fontSize: 15 }}>
              {remote && remote.q === q.trim() ? (remote.items === null ? 'Searching all of Gmail…' : remote.err ? `Search failed: ${remote.err}` : remote.timeout ? 'No answer from your computer — tap to retry' : `Gmail search: ${remote.items.length} result${remote.items.length === 1 ? '' : 's'}`) : 'Search all of Gmail for “' + q.trim() + '”'}
            </Text>
          </Pressable>
        )}
      </View>
      <FlatList
        data={data} keyExtractor={(t) => t.id} keyboardDismissMode="on-drag"
        renderItem={({ item }) => <Row t={item} selected={wide && openId === item.id} onOpen={onOpen} />}
        ItemSeparatorComponent={() => <View style={{ height: hair, backgroundColor: T.line, marginLeft: 34 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }} />}
        ListEmptyComponent={<View style={{ padding: 40, alignItems: 'center' }}>
          {!cfg ? <Text style={st.empty}>This build has no iCloud key.</Text>
            : net.busy && !list.length ? <ActivityIndicator /> : <Text style={st.empty}>{q ? 'No matches' : list.length ? `No messages in ${def.name}` : 'Your mail will appear here once your computer’s bridge has synced.'}</Text>}
        </View>}
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </View>
  );
}

// ---------- conversation
function MessageHtml({ html }) {
  const [h, setH] = useState(300);
  const doc = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px -apple-system,Helvetica,sans-serif;color:#1c1c1e;margin:0;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}a{color:#0a84ff}blockquote{margin:0 0 0 8px;padding-left:10px;border-left:3px solid #d1d1d6;color:#6c6c70}</style></head><body>${html}<script>function s(){window.ReactNativeWebView.postMessage(String(document.documentElement.scrollHeight))}window.onload=s;setTimeout(s,400);setTimeout(s,1500)</script></body></html>`;
  return <WebView originWhitelist={['*']} source={{ html: doc }} scrollEnabled={false} style={{ height: h, backgroundColor: 'transparent' }} onMessage={(e) => { const n = Number(e.nativeEvent.data); if (n > 0) setH(Math.min(n + 4, 6000)); }}
    onShouldStartLoadWithRequest={(r) => r.url === 'about:blank' || r.url.startsWith('data:') || r.url.startsWith('about:')} javaScriptEnabled />;
}

function Message({ m, open, toggle }) {
  const [fmt, setFmt] = useState(false);
  const me = (m.labels || []).includes('SENT');
  const col = avatarColor(parseAddr(m.from).email);
  return (
    <View style={st.msg}>
      <Pressable onPress={toggle} style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={[st.avatar, { backgroundColor: col }]}><Text style={st.avatarT}>{initial(m.from)}</Text></View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={st.msgFrom} numberOfLines={1}>{me ? 'Me' : senderName(m.from)}</Text>
          <Text style={st.msgTo} numberOfLines={1}>{open ? `To: ${m.to || 'me'}` : m.snippet}</Text>
        </View>
        <Text style={st.msgDate}>{open ? fullDate(m.date) : listDate(m.date)}</Text>
      </Pressable>
      {open && (
        <View style={{ marginTop: 12 }}>
          {!!m.cc && <Text style={[st.msgTo, { marginBottom: 6 }]}>Cc: {m.cc}</Text>}
          {fmt && m.html ? <MessageHtml html={m.html} /> : <Text selectable style={st.body}>{m.text || '(no text)'}</Text>}
          {!!m.html && (
            <Pressable onPress={() => setFmt(!fmt)} style={{ marginTop: 10 }}><Text style={{ color: T.tint, fontSize: 14 }}>{fmt ? 'Show plain text' : 'Show formatted message'}</Text></Pressable>
          )}
          {(m.atts || []).map((a, i) => (
            <View key={i} style={st.att}><Ionicons name="document-attach-outline" size={18} color={T.sub} /><Text style={{ flex: 1, color: T.text }} numberOfLines={1}>{a.name}</Text><Text style={{ color: T.faint, fontSize: 12 }}>{Math.max(1, Math.round(a.size / 1024))} KB</Text></View>
          ))}
          {(m.atts || []).length > 0 && <Text style={{ color: T.faint, fontSize: 12, marginTop: 4 }}>Attachments can be downloaded from Gmail on a normal network.</Text>}
        </View>
      )}
    </View>
  );
}

export function Conversation({ id, onBack, onCompose, wide, onGone }) {
  const { list, loadThread, act, status } = useMail();
  const ins = useSafeAreaInsets();
  const sum = list.find((t) => t.id === id);
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openIds, setOpenIds] = useState({});
  const sig = useRef(null);
  useEffect(() => {
    setD(null); setLoading(true); setOpenIds({});
    sig.current && (sig.current.aborted = true);
    const s = { aborted: false }; sig.current = s;
    loadThread(id, { signal: s }).then((t) => { if (s.aborted) return; setD(t); setLoading(false); if (t && t.msgs) { const last = t.msgs[t.msgs.length - 1]; setOpenIds({ [last.id]: true }); } });
    if (sum && sum.unread) act.markRead(id, true);
    return () => { s.aborted = true; };
  }, [id, sum && sum.h]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sum && !d) return <View style={{ flex: 1, backgroundColor: T.bg }} />;
  const msgs = (d && d.msgs) || [];
  const me = ((status && status.account) || '').toLowerCase();
  const star = sum && (sum.flags || []).includes('star');
  const replyTo = (all) => {
    const last = [...msgs].reverse().find((m) => !(m.labels || []).includes('SENT')) || msgs[msgs.length - 1];
    if (!last) return;
    const lastAny = msgs[msgs.length - 1];
    const to = [last.from];
    const cc = [];
    if (all) [...validEmails(last.to), ...validEmails(last.cc)].forEach((a) => { if (parseAddr(a).email.toLowerCase() !== me && !to.some((x) => parseAddr(x).email === parseAddr(a).email)) cc.push(a); });
    onCompose({ to: to.join(', '), cc: cc.join(', '), subject: rePrefix(d.subject), body: quoteFor(lastAny), threadId: id, inReplyTo: lastAny.msgid, references: lastAny.refs });
  };
  const fwd = () => { const m = msgs[msgs.length - 1]; if (m) onCompose({ subject: fwdPrefix(d.subject), body: `\n\n---------- Forwarded message ----------\nFrom: ${m.from}\nDate: ${fullDate(m.date)}\nSubject: ${m.subject}\nTo: ${m.to}\n\n${m.text}` }); };
  const confirmTrash = () => Alert.alert('Move to Trash?', 'This conversation will be moved to Trash in Gmail.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Move to Trash', style: 'destructive', onPress: () => { act.trash(id); onGone(); } }]);
  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <View style={[st.convBar, { paddingTop: ins.top + 4 }]}>
        {!wide ? (
          <Pressable onPress={onBack} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', width: 80 }}><Ionicons name="chevron-back" size={26} color={T.tint} /><Text style={{ color: T.tint, fontSize: 17 }}>Back</Text></Pressable>
        ) : null}
        <View style={{ flex: 1 }} />
        <IconBtn name={star ? 'star' : 'star-outline'} color={star ? T.amber : T.tint} onPress={() => act.star(id, !star)} label="Star" />
        <IconBtn name="mail-unread-outline" onPress={() => { act.markRead(id, false); onGone(); }} label="Mark unread" />
        <IconBtn name="archive-outline" onPress={() => { act.archive(id); onGone(); }} label="Archive" />
        <IconBtn name="trash-outline" onPress={confirmTrash} label="Trash" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 120 }}>
        <Text style={st.convTitle}>{(d && d.subject) || (sum && sum.subject)}</Text>
        {loading && !msgs.length && <View style={{ padding: 30, alignItems: 'center' }}><ActivityIndicator /><Text style={{ color: T.sub, marginTop: 10 }}>Fetching from your computer…</Text></View>}
        {!loading && !msgs.length && <Text style={st.empty}>This conversation isn’t available yet. Check that your computer’s bridge is running.</Text>}
        {msgs.map((m, i) => <Message key={m.id} m={m} open={!!openIds[m.id]} toggle={() => setOpenIds((o) => ({ ...o, [m.id]: !o[m.id] }))} />)}
      </ScrollView>
      <View style={[st.actions, { paddingBottom: ins.bottom + 8 }]}>
        <IconBtn name="arrow-undo-outline" onPress={() => replyTo(false)} disabled={!msgs.length} label="Reply" />
        <IconBtn name="arrow-undo-circle-outline" onPress={() => replyTo(true)} disabled={!msgs.length} label="Reply all" />
        <IconBtn name="arrow-redo-outline" onPress={fwd} disabled={!msgs.length} label="Forward" />
      </View>
    </View>
  );
}

// ---------- "Sending…" pop-up: spins while the message travels, flips to a check when Gmail has sent it
export function SendPopup() {
  const { sends, clearSend, online } = useMail();
  const cur = sends[sends.length - 1];
  const pop = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const status = cur && cur.status;
  const curId = cur && cur.id;
  useEffect(() => {
    if (!curId) { pop.setValue(0); return; }
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 7, tension: 90 }).start();
  }, [curId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (status !== 'sending' && status !== 'queued') return undefined;
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!curId || status === 'sending' || status === 'queued') return undefined;
    if (status === 'sent') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const t = setTimeout(() => Animated.timing(pop, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => clearSend(curId)), status === 'failed' ? 4000 : 1600);
    return () => clearTimeout(t);
  }, [status, curId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cur) return null;
  const rot = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const who = (cur.to || '').split(',')[0].replace(/<.*>/, '').trim();
  return (
    <Modal transparent visible animationType="none" statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
    <View pointerEvents="none" style={st.popWrap}>
      <Animated.View style={[st.pop, { opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }]}>
        {status === 'sending' || status === 'queued' ? <Animated.View style={{ transform: [{ rotate: rot }] }}><Ionicons name="sync" size={34} color={T.tint} /></Animated.View>
          : status === 'sent' ? <Ionicons name="checkmark-circle" size={40} color={T.green} /> : <Ionicons name="close-circle" size={40} color={T.red} />}
        <Text style={st.popTitle}>{status === 'sending' || status === 'queued' ? 'Sending…' : status === 'sent' ? 'Sent' : 'Couldn’t send'}</Text>
        <Text style={st.popSub} numberOfLines={2}>{status === 'failed' ? (cur.err || 'Tap Retry in the banner.') : status === 'queued' && !online ? 'Waiting for your PC…' : who ? 'To ' + who : ''}</Text>
      </Animated.View>
    </View>
    </Modal>
  );
}

// ---------- compose
export function Compose({ draft, onClose }) {
  const { act, contacts, suggestRemote } = useMail();
  const ins = useSafeAreaInsets();
  const [focus, setFocus] = useState('to');
  const [dirBusy, setDirBusy] = useState('');
  const [to, setTo] = useState(draft.to || '');
  const [cc, setCc] = useState(draft.cc || '');
  const [subject, setSubject] = useState(draft.subject || '');
  const [body, setBody] = useState(draft.body || '');
  const [showCc, setShowCc] = useState(!!draft.cc);
  const [bcc, setBcc] = useState('');
  const [showBcc, setShowBcc] = useState(false);
  const bodyRef = useRef(null);
  const field = focus === 'bcc' ? bcc : focus === 'cc' ? cc : to;
  const token = lastToken(field);
  const taken = [...validEmails(to), ...validEmails(cc), ...validEmails(bcc)];
  const all = useMemo(() => matchContacts(contacts, token, 5000, taken), [contacts, token, to, cc, bcc]); // eslint-disable-line react-hooks/exhaustive-deps
  const picks = all.slice(0, 6);
  const choose = (c) => {
    const entry = c.n ? `${c.n.replace(/[<>,"]/g, '')} <${c.e}>` : c.e;
    Haptics.selectionAsync().catch(() => {});
    (focus === 'bcc' ? setBcc : focus === 'cc' ? setCc : setTo)((v) => replaceLastToken(v, entry));
  };
  // everyone who matches what is typed, into Bcc (so replies are not sent to the whole list), at most 100 per message
  const addAll = () => {
    const group = all.slice(0, 100);
    setShowBcc(true); setFocus('bcc');
    setBcc((v) => { const base = v.replace(/[,\s]+$/, ''); return (base ? base + ', ' : '') + group.map((c) => c.e).join(', ') + ', '; });
    setTo((v) => (lastToken(v) && focus === 'to' ? v.slice(0, v.lastIndexOf(',') + 1) : v));
    setCc((v) => (lastToken(v) && focus === 'cc' ? v.slice(0, v.lastIndexOf(',') + 1) : v));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };
  const askDirectory = async () => { const q = token; setDirBusy(q); try { await suggestRemote(q); } finally { setDirBusy(''); } };
  const send = () => {
    const tos = validEmails(to), ccs = validEmails(cc), bccs = validEmails(bcc);
    if (!tos.length && !bccs.length) return Alert.alert('Add a recipient', 'Type an email address in To.');
    if (tos.length + ccs.length + bccs.length > 100) return Alert.alert('Too many recipients', 'Send to at most 100 people per message (Gmail limits bulk mail).');
    const bad = [...tos, ...ccs, ...bccs].find((x) => !looksEmail(x));
    if (bad) return Alert.alert('Check the address', `“${bad}” doesn’t look like an email address.`);
    const go = () => { act.send({ to: tos.join(', '), cc: ccs.join(', '), bcc: bccs.join(', '), subject, body, threadId: draft.threadId, inReplyTo: draft.inReplyTo, references: draft.references }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); onClose(); };
    if (!subject.trim() && !draft.threadId) Alert.alert('Send without a subject?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Send', onPress: go }]); else go();
  };
  const cancel = () => { if (!body.trim() && !to.trim() && !subject.trim()) return onClose(); Alert.alert('Discard this message?', undefined, [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: onClose }]); };
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={cancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: T.bg }}>
        <View style={st.compBar}>
          <Pressable onPress={cancel} hitSlop={8}><Text style={{ color: T.tint, fontSize: 17 }}>Cancel</Text></Pressable>
          <Text style={{ fontSize: 17, fontWeight: '600', color: T.text }}>{draft.threadId ? 'Reply' : 'New Message'}</Text>
          <Pressable onPress={send} hitSlop={8} style={st.sendBtn}><Ionicons name="arrow-up" size={20} color="#fff" /></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: ins.bottom + 40 }}>
          <Field label="To"><TextInput value={to} onChangeText={setTo} onFocus={() => setFocus('to')} autoFocus={!draft.to} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={st.input} placeholder="name@example.com" placeholderTextColor={T.faint} /></Field>
          {showCc ? <Field label="Cc"><TextInput value={cc} onChangeText={setCc} onFocus={() => setFocus('cc')} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={st.input} /></Field>
            : <Pressable onPress={() => setShowCc(true)} style={st.field}><Text style={st.fieldL}>Cc</Text><Text style={{ color: T.faint, fontSize: 16 }}>Add Cc</Text></Pressable>}
          {showBcc
            ? <Field label="Bcc"><TextInput value={bcc} onChangeText={setBcc} onFocus={() => setFocus('bcc')} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={st.input} /></Field>
            : <Pressable onPress={() => { setShowBcc(true); setFocus('bcc'); }} style={st.field}><Text style={st.fieldL}>Bcc</Text><Text style={{ color: T.faint, fontSize: 16 }}>Add Bcc</Text></Pressable>}
          {token.length >= 1 && (
            <View style={st.picks}>
              {picks.map((c) => (
                <Pressable key={c.e} onPress={() => choose(c)} style={({ pressed }) => [st.pick, pressed && { backgroundColor: T.group }]}>
                  <View style={[st.pickAv, { backgroundColor: avatarColor(c.e) }]}><Text style={st.avatarT}>{initial(c.n || c.e)}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.pickName} numberOfLines={1}>{c.n || c.e.split('@')[0]}</Text>
                    <Text style={st.pickMail} numberOfLines={1}>{c.e}</Text>
                  </View>
                </Pressable>
              ))}
              {token.length >= 2 && all.length >= 2 && (
                <Pressable onPress={addAll} style={st.pick}>
                  <Ionicons name="people" size={20} color={T.tint} style={{ width: 32, textAlign: 'center' }} />
                  <Text style={{ color: T.tint, fontSize: 15, flex: 1 }}>Add all {Math.min(all.length, 100)} matching “{token}” to Bcc{all.length > 100 ? ` (first 100 of ${all.length})` : ''}</Text>
                </Pressable>
              )}
              {token.length >= 2 && (
                <Pressable onPress={askDirectory} disabled={!!dirBusy} style={st.pick}>
                  {dirBusy === token ? <ActivityIndicator style={{ width: 32 }} /> : <Ionicons name="search" size={20} color={T.tint} style={{ width: 32, textAlign: 'center' }} />}
                  <Text style={{ color: T.tint, fontSize: 15, flex: 1 }}>
                    {dirBusy === token ? 'Searching the school directory…' : `${picks.length ? 'Search' : 'No match yet. Search'} the school directory for “${token}”`}
                  </Text>
                </Pressable>
              )}
            </View>
          )}
          <Field label="Subject"><TextInput value={subject} onChangeText={setSubject} style={st.input} /></Field>
          <TextInput ref={bodyRef} value={body} onChangeText={setBody} multiline autoFocus={!!draft.to} textAlignVertical="top" style={st.compBody} placeholder="Message" placeholderTextColor={T.faint} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const Field = ({ label, children }) => <View style={st.field}><Text style={st.fieldL}>{label}</Text><View style={{ flex: 1 }}>{children}</View></View>;

const st = StyleSheet.create({
  popWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  pop: { minWidth: 190, maxWidth: 300, paddingVertical: 22, paddingHorizontal: 26, borderRadius: 22, backgroundColor: '#FFFFFFF2', alignItems: 'center', gap: 6, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 12, borderWidth: hair, borderColor: T.line },
  popTitle: { fontSize: 20, fontWeight: '700', color: T.ink, marginTop: 4 },
  popSub: { fontSize: 14, color: T.sub, textAlign: 'center' },
  picks: { borderBottomWidth: hair, borderBottomColor: T.line, backgroundColor: '#FAFAFC' },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  pickAv: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pickName: { fontSize: 16, color: T.ink, fontWeight: '500' },
  pickMail: { fontSize: 13, color: T.sub },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 9 },
  bannerText: { flex: 1, fontSize: 13 }, bannerBtn: { color: T.tint, fontWeight: '600', fontSize: 14, marginRight: 8 },
  bigTitle: { fontSize: 34, fontWeight: '700', color: T.ink }, acct: { color: T.sub, fontSize: 14, marginTop: 2 },
  group: { marginHorizontal: 16, backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', marginTop: 8 },
  boxRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  boxName: { flex: 1, fontSize: 17, color: T.text }, boxCount: { color: T.sub, fontSize: 17 },
  bigTitle2: { fontSize: 32, fontWeight: '700', color: T.ink, paddingHorizontal: 10, marginBottom: 6 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: T.fill, borderRadius: 10, marginHorizontal: 6, paddingHorizontal: 9, height: 36 },
  searchInput: { flex: 1, fontSize: 17, color: T.text, paddingVertical: 0 },
  row: { flexDirection: 'row', paddingVertical: 10, paddingRight: 14 },
  dotCol: { width: 34, alignItems: 'center', paddingTop: 5 }, dot: { width: 11, height: 11, borderRadius: 6, backgroundColor: T.tint },
  from: { fontSize: 17, fontWeight: '600', color: T.ink, flexShrink: 1 }, cnt: { fontSize: 14, color: T.faint },
  when: { fontSize: 15, color: T.faint }, subj: { fontSize: 15, color: T.text, marginTop: 1 }, snip: { fontSize: 15, color: T.sub, marginTop: 1, lineHeight: 20 },
  empty: { color: T.sub, textAlign: 'center', fontSize: 15, lineHeight: 21 },
  convBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: hair, borderBottomColor: T.line, minHeight: 52 },
  convTitle: { fontSize: 22, fontWeight: '700', color: T.ink, marginBottom: 14 },
  msg: { paddingVertical: 14, borderTopWidth: hair, borderTopColor: T.line },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }, avatarT: { color: '#fff', fontWeight: '600', fontSize: 17 },
  msgFrom: { fontSize: 16, fontWeight: '600', color: T.ink }, msgTo: { fontSize: 14, color: T.sub, marginTop: 1 }, msgDate: { fontSize: 13, color: T.faint, marginLeft: 8 },
  body: { fontSize: 16, lineHeight: 23, color: T.text },
  att: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: T.group, borderRadius: 10, padding: 10, marginTop: 8 },
  actions: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 6, borderTopWidth: hair, borderTopColor: T.line, backgroundColor: T.bg },
  compBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: hair, borderBottomColor: T.line },
  sendBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: T.tint, alignItems: 'center', justifyContent: 'center' },
  field: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 46, borderBottomWidth: hair, borderBottomColor: T.line },
  fieldL: { width: 64, color: T.sub, fontSize: 16 }, input: { fontSize: 16, color: T.text, paddingVertical: 10 },
  compBody: { fontSize: 17, color: T.text, minHeight: 300, padding: 16, lineHeight: 24 },
});
