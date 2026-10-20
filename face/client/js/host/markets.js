// face/client/js/host/markets.js — the Markets screen's impure half (spec 2026-10-19 §7 Stage 2): the face's live quotes
// (wire/market-quotes.js over /data/quotes/stream, its polling fallback included), symbol search, the watchlist in this
// browser's storage under the face's key, and each page's daily bars, all into the store. Nothing here touches the DOM.
import { readWatchlist, saveWatchlist, STORAGE_KEY } from '../wire/market-model.js';
import { parsePayload } from '../wire/market-quotes.js';
import { canonicalId, holdingAssets, assetFor } from './market-view.js';

export const WATCH_LIMIT = 100;   // the quote wire's own subscription limit
export const HIT_QUOTES = 30;     // the hits one search reads a quote for
export const BARS_DAYS = 120;     // calendar days of daily bars a page charts

export function startMarkets({ store, createLiveQuotes, createSymbolSearch, storage, getJson, win }) {
  let closed = false;
  let subscribed = null;   // the ids last handed to the live quotes, in order
  let hitSeq = 0;          // a hit read that answers after a newer search is dropped
  const barsSeq = new Map();

  const quotes = createLiveQuotes(state => { if (!closed) store.dispatch('quotesUpdated', state); });
  const searcher = createSymbolSearch(state => {
    if (closed) return;
    hitSeq++;
    store.dispatch('searchUpdated', state);
    if (state.status === 'success' && state.assets.length) void readHits(state.assets, hitSeq);
  });
  // paused until Markets is on screen: a subscription made meanwhile costs no connection
  quotes.setVisible(false);

  // the page's own asset first (the wire keeps the first hundred), then the watchlist, then the holdings
  function wanted() {
    const s = store.get();
    const data = s.account?.data;
    const page = s.route?.screen === 'markets' ? canonicalId(s.route.id) : null;
    const seen = new Set();
    const out = [];
    for (const asset of [page ? assetFor(s.markets, data, page) : null, ...s.markets.watchlist, ...holdingAssets(data)]) {
      if (asset && !seen.has(asset.id)) { seen.add(asset.id); out.push(asset); }
    }
    return out;
  }
  function sync() {
    if (closed) return;
    const assets = wanted();
    const key = assets.map(a => a.id).join(',');
    if (key === subscribed) return;
    subscribed = key;   // before the call: the wire answers synchronously, and that answer lands here again
    quotes.setAssets(assets);
  }

  function load() {
    const { items, error } = readWatchlist(storage);
    store.dispatch('watchlistLoaded', { items, error: error ? 'read' : null });
  }
  function save(items) {
    const error = saveWatchlist(storage, items);
    store.dispatch('watchlistLoaded', { items, error: error ? 'unsaved' : null });
  }

  async function readHits(assets, seq) {
    const ids = assets.slice(0, HIT_QUOTES).map(a => a.id);
    try {
      const payload = parsePayload(await getJson(`/data/quotes?ids=${encodeURIComponent(ids.join(','))}`));
      if (seq === hitSeq && !closed) store.dispatch('hitQuotesLoaded', { quotes: payload.quotes });
    } catch { /* the hits stay without a quote: No quote */ }
  }

  const onStorage = event => { if (!closed && (event?.key === STORAGE_KEY || event?.key === null)) load(); };
  const unsubscribe = store.subscribe(() => sync());
  win?.addEventListener?.('storage', onStorage);
  load();
  sync();

  return {
    show(on) { if (!closed) quotes.setVisible(Boolean(on)); },
    search(q) { if (!closed) searcher.search(typeof q === 'string' ? q : '', 'all'); },
    watch(raw) {
      const s = store.get();
      const id = canonicalId(raw);
      if (closed || !id || s.markets.watchlist.some(a => a.id === id)) return;
      if (s.markets.watchlist.length >= WATCH_LIMIT) { store.dispatch('watchlistLoaded', { items: s.markets.watchlist, error: 'full' }); return; }
      save([...s.markets.watchlist, assetFor(s.markets, s.account?.data, id)]);
    },
    unwatch(raw) {
      const id = canonicalId(raw);
      const list = store.get().markets.watchlist;
      if (closed || !id || !list.some(a => a.id === id)) return;
      save(list.filter(a => a.id !== id));
    },
    async bars(raw) {
      const id = canonicalId(raw);
      if (closed || !id?.startsWith('us:')) return;   // crypto and cn have no bar source yet: their pages draw no chart
      const seq = (barsSeq.get(id) ?? 0) + 1;
      barsSeq.set(id, seq);
      store.dispatch('barsLoading', { id });
      let payload = null;
      try { payload = await getJson(`/data/bars?id=${encodeURIComponent(id)}&days=${BARS_DAYS}`); } catch { payload = null; }
      if (closed || barsSeq.get(id) !== seq) return;
      if (payload?.ok === true && Array.isArray(payload.rows)) store.dispatch('barsLoaded', { id, payload });
      else store.dispatch('barsFailed', { id });
    },
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      win?.removeEventListener?.('storage', onStorage);
      quotes.close();
      searcher.cancel();
    },
  };
}
