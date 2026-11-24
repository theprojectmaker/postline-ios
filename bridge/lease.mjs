// Who is in charge: the home PC or the cloud standby. One small encrypted CloudKit record (pl-lease) says which, and is refreshed
// every 15 s by whoever holds it. The PC always wins; the cloud copy only works while the PC has been silent for 90 s.
import { unseal } from './seal.mjs';

const NAME = 'pl-lease', STALE = 90000, sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeLease(ck, role, log) {
  const read = async () => { try { const [r] = await ck.lookup([NAME]); return ck.jsonOf(r) || null; } catch { return null; } };
  const write = () => ck.save([{ name: NAME, json: ck.pack({ owner: role, ts: Date.now() }), ver: Date.now() }]);
  const fresh = (l, ms = STALE) => !!l && Date.now() - l.ts < ms;

  /** Resolves when this copy may start working. Returns true when it just took over from the other copy. */
  async function acquire() {
    if (role === 'pc') {
      const l = await read(); const fromCloud = !!l && l.owner === 'cloud' && fresh(l);
      await write().catch((e) => log('lease', e.message));
      if (fromCloud) { log('the cloud standby is active - asking it to hand over'); await sleep(30000); }
      return fromCloud;
    }
    let waited = 0;
    for (;;) { // cloud standby: wait here (no Chrome running) while the PC is alive
      const l = await read();
      if (!(l && l.owner === 'pc' && fresh(l))) break;
      if (!waited++) log('standby: the PC is alive, staying idle');
      await sleep(20000);
    }
    await write().catch((e) => log('lease', e.message));
    log('the PC has been silent - the cloud copy takes over');
    return true;
  }

  /** Keeps the claim fresh; the cloud copy exits (back to standby) the moment the PC is alive again. */
  function keep() {
    setInterval(async () => {
      try {
        if (role === 'cloud') { const l = await read(); if (l && l.owner === 'pc' && fresh(l, 60000)) { log('the PC is back - cloud copy standing down'); process.exit(5); } }
        await write();
      } catch (e) { log('lease', String(e.message).slice(0, 80)); }
    }, 15000);
  }
  return { acquire, keep };
}

/** Joins sealed list records written in parts (same format the app reads). */
export function joinParts(ck, dataKey, recs) {
  return unseal(dataKey, recs.map((r) => (r && r.fields && r.fields.json ? r.fields.json.value : '')).join(''));
}
