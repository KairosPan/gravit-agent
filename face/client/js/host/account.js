// face/client/js/host/account.js — the Account screen's impure half (spec 2026-10-19 §7 Stage 2): /data/account.json in
// one flight at a time, and the Venues tab's three reads — where the keys come from (credentials/describe), which order
// tools the registry holds (/data/plugins.json) and the quote providers' state (/data/quotes) — each standing alone.
import { parsePayload } from '../wire/market-quotes.js';

export const KEY_REFS = ['APCA_API_KEY_ID', 'APCA_API_SECRET_KEY'];
// one instrument per provider, so the probe's answer names all three
export const PROBE_IDS = ['us:SPY', 'crypto:BTC/USD', 'cn:600519'];

function toolNamesOf(listing) {
  if (!Array.isArray(listing?.mcp)) return null;
  return listing.mcp.flatMap(server => (Array.isArray(server?.tools) ? server.tools : [])
    .map(tool => tool?.name).filter(name => typeof name === 'string'));
}

export function startAccount({ store, getJson, call, now = Date.now }) {
  let flight = null;
  let flightFresh = false;
  let seq = 0;   // only the latest-started read lands: a fresh one must not be overwritten by an older plain one

  // fresh: past the face's 60 s cache (`?fresh=1`) — Refresh and the read right after a fill; a plain read joins any
  // flight, a fresh one joins only a fresh one
  function load({ fresh = false } = {}) {
    if (flight && (flightFresh || !fresh)) return flight;
    const mine = ++seq;
    store.dispatch('accountLoading');
    // the read starts on the next microtask, so `flight` is set before anything can settle it
    const current = Promise.resolve()
      .then(() => getJson(fresh ? '/data/account.json?fresh=1' : '/data/account.json'))
      .then(data => {
        if (mine !== seq) return;
        if (data && data.ok === true) store.dispatch('accountLoaded', { data, at: now() });
        else store.dispatch('accountFailed', { at: now() });
      }, () => { if (mine === seq) store.dispatch('accountFailed', { at: now() }); })
      .finally(() => { if (flight === current) { flight = null; flightFresh = false; } });
    flight = current;
    flightFresh = fresh;
    return current;
  }

  async function describe() {
    await Promise.all([
      Promise.resolve().then(() => call('credentials/describe', { refs: KEY_REFS }))
        .then(creds => { if (creds && typeof creds === 'object') store.dispatch('credentialsLoaded', creds); }, () => {}),
      Promise.resolve().then(() => getJson('/data/plugins.json'))
        .then(listing => { const names = toolNamesOf(listing); if (names) store.dispatch('toolsLoaded', names); }, () => {}),
      Promise.resolve().then(() => getJson(`/data/quotes?ids=${encodeURIComponent(PROBE_IDS.join(','))}`))
        .then(payload => { store.dispatch('probeLoaded', parsePayload(payload).providers); })
        .catch(() => {}),
    ]);
  }

  return { load, describe };
}
