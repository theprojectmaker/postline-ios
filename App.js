// Postline — your Gmail, through the locked network. Layout: iPad = sidebar + list + conversation; iPhone = stacked screens.
import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, StatusBar, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';
import { MailProvider } from './src/store';
import { Banner, BOXES, Compose, Conversation, Mailboxes, SendPopup, ThreadList } from './src/views';
import { T, WIDE, SIDEBAR, LISTW, hair } from './src/theme';

function Shell() {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const [box, setBox] = useState('inbox');
  const [screen, setScreen] = useState('list'); // narrow only: 'boxes' | 'list'
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState(null);
  const compose = useCallback((d) => setDraft(d || {}), []);
  // tapping a new-mail notification opens that conversation
  useEffect(() => {
    const open = (r) => { const d = r && r.notification && r.notification.request.content.data; if (d && d.kind === 'mail' && d.id) { setBox('inbox'); setScreen('list'); setOpenId(d.id); } };
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
  const pickBox = (k) => { setBox(k); setOpenId(null); setScreen('list'); };

  useEffect(() => { // Android back (harmless on iOS)
    const h = BackHandler.addEventListener('hardwareBackPress', () => { if (openId) { setOpenId(null); return true; } if (screen === 'list' && !wide) { setScreen('boxes'); return true; } return false; });
    return () => h.remove();
  }, [openId, screen, wide]);

  const list = <ThreadList box={box} openId={openId} onOpen={setOpenId} onBack={() => setScreen('boxes')} onCompose={compose} wide={wide} />;
  const conv = openId ? <Conversation key={openId} id={openId} wide={wide} onBack={() => setOpenId(null)} onGone={() => { if (!wide) setOpenId(null); else setOpenId(null); }} onCompose={compose} />
    : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.group }}><Text style={{ color: T.faint, fontSize: 20 }}>No Message Selected</Text></View>;

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <StatusBar hidden />
      <Banner />
      {wide ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={{ width: SIDEBAR, borderRightWidth: hair, borderRightColor: T.line }}><Mailboxes box={box} setBox={pickBox} wide /></View>
          <View style={{ width: LISTW, borderRightWidth: hair, borderRightColor: T.line }}>{list}</View>
          <View style={{ flex: 1 }}>{conv}</View>
        </View>
      ) : openId ? conv : screen === 'boxes' ? <Mailboxes box={box} setBox={pickBox} wide={false} /> : list}
      <SendPopup />
      {draft && <Compose key={JSON.stringify(draft).length + (draft.threadId || '')} draft={draft} onClose={() => setDraft(null)} />}
    </View>
  );
}

export default function App() {
  // Over-the-air updates: check on launch and every time the app comes back to the front (a resident iOS app never "launches" again).
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    const check = async () => { try { const r = await Updates.checkForUpdateAsync(); if (r.isAvailable) await Updates.fetchUpdateAsync(); } catch { /* offline */ } };
    check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => sub.remove();
  }, []);
  return (
    <SafeAreaProvider>
      <MailProvider><Shell /></MailProvider>
    </SafeAreaProvider>
  );
}
