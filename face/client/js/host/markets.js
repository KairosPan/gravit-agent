// face/client/js/host/markets.js — the Markets screen's impure half (spec 2026-10-22 §6.1): the Account's markets through the
// face's proxy into the store — explore for the tab on screen at once and every 20 s, the quotes of the rows in view (on a
// market's page, its own market's) every 5 s (twelve a call), a market page's candles for its range and its base's compare
// rows, and the page's market followed on the Account's stream; the stars in this browser's two stores (the Account's keys
// under their own key, the A shares under the face's) and, on a page that signs, an Account market's star as the Account's own
// signed setWatch (plan 2 Task 12); each old us:/crypto: star asked of the Account once; and the face's own
// wire (spec 2026-10-19 §7 Stage 2) for the A shares alone — the live quotes of the cn list and a cn page, the cn search and its
// hits' one quote read. The views over what lands are market-view.js's. Nothing here touches the DOM.
import {
  readWatchlist, saveWatchlist, STORAGE_KEY, readAccountWatch, saveAccountWatch, ACCOUNT_WATCH_KEY, normalizeAsset,
} from '../wire/market-model.js';
import { parsePayload } from '../wire/market-quotes.js';
import { ACCOUNT_TABS, CHINA_TAB, canonicalId, isAccountKey, rowsOf, matchKey, pairsOf, pageOf, followOf, watchedOf, setWatchOf } from './market-view.js';
import { refusedAt, refusalOf } from './owner-view.js';

export const EXPLORE_MS = 20_000, QUOTES_MS = 5_000, QUOTE_PAIRS = 12;
export const WATCH_LIMIT = 100;   // either list's: the quote wire's own subscription limit, the Account keys' cap
export const HIT_QUOTES = 30;     // the cn hits one search reads a quote for
// the China tab's ranking and an A share's history (spec 2026-10-31): the face's own routes over Tencent
export const RANK_PATH = '/data/cn/rank';
export const CN_CANDLES_PATH = '/data/cn/candles';

const EXPLORE = '/data/account/explore';
const ROWS = 200;                 // the explore rows a tab's read and a search ask for
const ASKED_ROWS = 12;            // the rows an old star's ask reads
const KINDS = new Set(ACCOUNT_TABS.map(([id]) => id).filter(id => id !== 'all'));
// the kinds the Account compares across venues: not an event, not an RWA
const COMPARED = new Set(['coin', 'perp', 'stock']);

const named = v => typeof v === 'string' && v !== '';
const blank = q => typeof q !== 'string' || !q.trim();
// the Account's sentence when it refuses (`refusal.message`), else its error words — only when they are text
const words = v => (typeof v === 'string' && v.trim() !== '' ? v : null);
const messageOf = body => words(body?.refusal?.message) ?? words(body?.error);
// an answer (`ok: true`) carrying the list the views read: a body of any other shape is never data
const answered = (body, list) => body?.ok === true && Array.isArray(body[list]);

// the explore read the tab on screen takes: All, Watching, and All results with no query read All's; a kind's tab its own; All
// results while searching is the search's read, not this
function exploreOf(m) {
  if (KINDS.has(m.tab)) return { tab: m.tab, path: `${EXPLORE}?tab=${m.tab}&limit=${ROWS}` };
  if (m.tab === 'all' || m.tab === 'watching' || (m.tab === 'results' && blank(m.q))) return { tab: 'all', path: `${EXPLORE}?limit=${ROWS}` };
  return null;
}

export function startMarkets({
  store, getJson, createLiveQuotes, createSymbolSearch, storage, win, stream, schedule, cancelTimer, now = Date.now,
  owner = null, afterAction = () => {},
}) {
  let closed = false;
  let shown = false;
  let exploreTimer = null;
  let quotesTimer = null;
  let readTab = null;        // the tab the explore poll reads for while shown
  let readSort = null;       // the sort the China ranking was last asked for while shown
  let inView = null;         // the row ids rowsInView last named; null: every row
  let waiting = null;        // a page asked for whose market no read lists yet: its reads wait for the read that does
  let followed = false;      // the stream follows a page's market
  let subscribed = null;     // the ids last handed to the live quotes, in order
  let hitSeq = 0;            // a hit read that answers after a newer search is dropped
  const kinds = new Map();   // a kind of read → { flight, path, seq }
  const signing = new Set(); // the Account keys whose setWatch is in the air

  const quotes = createLiveQuotes(state => { if (!closed) store.dispatch('quotesUpdated', state); });
  const searcher = createSymbolSearch(state => {
    if (closed) return;
    hitSeq++;
    store.dispatch('searchUpdated', state);
    if (state.status === 'success' && state.assets.length) void readHits(state.assets, hitSeq);
  });
  // paused until Markets is on screen: a subscription made meanwhile costs no connection
  quotes.setVisible(false);

  // One flight per kind of read: an ask for the path in the air joins it; another path starts a read whose answer alone lands —
  // the one it overtook is dropped — and nothing lands after close(). `land(body, refused)` takes the answer, or for a rejection
  // the body the app's getJson carries on it (`error.body`, when it does).
  function fly(kind, path, land, loading = null) {
    if (closed) return;
    let k = kinds.get(kind);
    if (!k) { k = { flight: null, path: null, seq: 0 }; kinds.set(kind, k); }
    if (k.flight !== null && k.path === path) return;
    const mine = ++k.seq;
    let asked;
    try { asked = Promise.resolve(getJson(path)); } catch (error) { asked = Promise.reject(error); }
    const flight = asked
      .then(body => { if (!closed && mine === k.seq) land(body, false); }, error => { if (!closed && mine === k.seq) land(error?.body, true); })
      .finally(() => { if (k.flight === flight) { k.flight = null; k.path = null; } });
    k.flight = flight;
    k.path = path;
    if (loading) store.dispatch(...loading);
  }
  const inAir = kind => (kinds.get(kind)?.flight ?? null) !== null;
  // a kind's flight dropped: its answer, when it comes, lands nowhere, and the next ask reads again
  function drop(kind) { const k = kinds.get(kind); if (k) { k.seq += 1; k.flight = null; k.path = null; } }

  // the explore read for the tab on screen
  function readExplore() {
    const read = exploreOf(store.get().markets);
    if (!read) return;
    const { tab, path } = read;
    fly(`explore:${tab}`, path, (body, refused) => {
      if (!refused && answered(body, 'items')) store.dispatch('exploreLoaded', { tab, data: body, at: now() });
      else store.dispatch('exploreFailed', { tab, at: now(), message: messageOf(body) });
    }, ['exploreLoading', { tab }]);
  }

  // China's ranking for the sort in effect: the answer for a sort the screen has left lands nowhere (one flight, the newer path's)
  function readRank() {
    const sort = store.get().markets.sort === 'movers' ? 'movers' : 'volume';
    readSort = sort;
    fly('rank', `${RANK_PATH}?sort=${sort}`, (body, refused) => {
      if (!refused && answered(body, 'items')) store.dispatch('rankLoaded', { sort, data: body, at: now() });
      else store.dispatch('rankFailed', { sort, at: now(), message: messageOf(body) });
    }, ['rankLoading', { sort }]);
  }
  // the read for the tab on screen: China's ranking there, else the Account's explore
  function readShown() {
    if (store.get().markets.tab === CHINA_TAB) readRank(); else readExplore();
  }

  // the quotes of the rows in view — the table's rows, those rowsInView last named — at their most traded connected lines,
  // twelve a call; none while one is out, so a slow Account is never asked again before it answers. A market's page names its
  // own key: when its market is no row of the tab on screen (a deep link to a market only a list beside the items carries, a
  // page reached by Back onto another tab, a market un-starred from its own page on Watching), its pair, when it has one, comes
  // from its page's own view — its most traded connected line, the line the page follows
  function readQuotes() {
    if (inAir('quotes')) return;
    const s = store.get();
    const rows = rowsOf(s.markets, now(), s.account?.data);
    const drawn = pairsOf(rows.filter(r => inView === null || inView.has(r.id)), QUOTE_PAIRS);
    const pages = inView === null ? [] : [...inView]
      .filter(id => isAccountKey(id) && !rows.some(r => r.id === id))
      .flatMap(id => { const view = pageOf(s.markets, s.account, id, now()); return view ? pairsOf([{ legs: view.legs }], 1) : []; });
    const pairs = [...new Set([...drawn, ...pages])].slice(0, QUOTE_PAIRS);
    if (!pairs.length) return;
    fly('quotes', `/data/account/quotes?pairs=${encodeURIComponent(pairs.join(','))}`, (body, refused) => {
      if (!refused && answered(body, 'quotes')) store.dispatch('accountQuotesLoaded', { quotes: body.quotes });
    });
  }

  // while Markets is on screen: explore every EXPLORE_MS for the tab on screen, the quotes every QUOTES_MS
  function armExplore() {
    exploreTimer = schedule(() => { exploreTimer = null; if (closed || !shown) return; armExplore(); readShown(); }, EXPLORE_MS);
  }
  function armQuotes() {
    quotesTimer = schedule(() => { quotesTimer = null; if (closed || !shown) return; armQuotes(); readQuotes(); }, QUOTES_MS);
  }
  function stopPolls() {
    if (exploreTimer !== null) { cancelTimer(exploreTimer); exploreTimer = null; }
    if (quotesTimer !== null) { cancelTimer(quotesTimer); quotesTimer = null; }
  }
  // the tab on screen changed while shown: its read at once, and its poll over from now
  function retab() {
    readTab = store.get().markets.tab;
    if (exploreTimer !== null) { cancelTimer(exploreTimer); exploreTimer = null; }
    armExplore();
    readShown();
  }

  // the range a page's chart is drawn at: the one kept for it, 1D until one is chosen
  function rangeOf(id) {
    const candles = store.get().markets.candles;
    const range = Object.hasOwn(candles, id) ? candles[id]?.range : undefined;
    return named(range) ? range : '1D';
  }
  // a page's candles at its line for the range — a refusal lands with the Account's sentence; an answer for a range the page has
  // left since lands nowhere
  function readCandles(id, leg, range) {
    const path = `/data/account/candles?venue=${encodeURIComponent(leg.venue)}&symbol=${encodeURIComponent(leg.symbol)}&range=${encodeURIComponent(range)}`;
    fly(`candles:${id}`, path, (body, refused) => {
      if (rangeOf(id) !== range) return;
      if (!refused && answered(body, 'candles')) store.dispatch('candlesLoaded', { id, range, data: body, at: now() });
      else store.dispatch('candlesFailed', { id, range, at: now(), message: messageOf(body) });
    }, ['candlesLoading', { id, range }]);
  }
  // an A share's history at the range, from the face's own route; an answer for a range the page has left lands nowhere
  function readCnCandles(id, range) {
    fly(`candles:${id}`, `${CN_CANDLES_PATH}?id=${encodeURIComponent(id)}&range=${encodeURIComponent(range)}`, (body, refused) => {
      if (rangeOf(id) !== range) return;
      if (!refused && body?.ok === true) store.dispatch('candlesLoaded', { id, range, data: body, at: now() });
      else store.dispatch('candlesFailed', { id, range, at: now(), message: messageOf(body) });
    }, ['candlesLoading', { id, range }]);
  }
  function readCompare(base) {
    fly(`compare:${base}`, `/data/account/compare?base=${encodeURIComponent(base)}&side=buy`, (body, refused) => {
      if (!refused && answered(body, 'rows')) store.dispatch('compareLoaded', { base, data: body, at: now() });
      else store.dispatch('compareFailed', { base, at: now() });
    }, ['compareLoading', { base }]);
  }
  function unfollow() {
    followed = false;
    stream.follow([]);
  }
  // A market's page: the candles at its line — its first connected line, else its first public listing — for its kept range, the
  // compare rows for its base (a coin, a perpetual, a stock) and that line followed on the Account's stream. A page whose market
  // no read lists yet (a deep link before explore answers) waits for the read that lists it; meanwhile it follows nothing.
  function open(id) {
    const s = store.get();
    const view = pageOf(s.markets, s.account, id, now());
    if (!view) {
      waiting = id;
      if (followed) unfollow();
      return;
    }
    waiting = null;
    const leg = followOf(view.item);
    if (leg) readCandles(id, leg, rangeOf(id));
    if (COMPARED.has(view.item.kind) && named(view.item.base)) readCompare(view.item.base);
    if (leg) { followed = true; stream.follow([`${leg.venue}:${leg.symbol}`]); } else if (followed) unfollow();
  }

  // the face's wire takes the A shares alone: a cn page's own first (the wire keeps the first hundred), then the cn list's — an
  // old us:/crypto: star on the list is the Account's to quote, or no one's
  function wanted() {
    const s = store.get();
    const page = s.route?.screen === 'markets' ? canonicalId(s.route.id) : null;
    const seen = new Set();
    const out = [];
    for (const entry of [page ? { id: page } : null, ...s.markets.watchlist]) {
      const asset = normalizeAsset(entry);
      if (asset?.market === 'cn' && !seen.has(asset.id)) { seen.add(asset.id); out.push(asset); }
    }
    return out;
  }
  function sync() {
    const assets = wanted();
    const key = assets.map(a => a.id).join(',');
    if (key === subscribed) return;
    subscribed = key;   // before the call: the wire answers synchronously, and that answer lands here again
    quotes.setAssets(assets);
  }

  // the two stores as this browser keeps them; either one unreadable is said, as `read`
  function load() {
    const cn = readWatchlist(storage);
    const keys = readAccountWatch(storage);
    store.dispatch('watchlistLoaded', { items: cn.items, error: cn.error ? 'read' : null });
    store.dispatch('accountWatchLoaded', { items: keys.items, error: keys.error || cn.error ? 'read' : null });
  }
  function saveList(items) {
    const error = saveWatchlist(storage, items);
    store.dispatch('watchlistLoaded', { items, error: error ? 'unsaved' : null });
  }
  // the Account keys starred, stored; the storage's error, or null
  function saveKeys(items) {
    const error = saveAccountWatch(storage, items);
    store.dispatch('accountWatchLoaded', { items, error: error ? 'unsaved' : null });
    return error;
  }

  // The Account's own watch list, while this page signs for it: one click, the Account's setWatch through the owner device —
  // never in this browser's store — one in the air per market. Taken, the reads after an action are told (the page is read
  // again, and the star follows it); refused, the Account's sentence is the watchlist's words and neither list changes.
  const signs = () => owner !== null && store.get().owner?.role === 'signs';
  async function setWatch(key, { venue, symbol }, on) {
    if (signing.has(key)) return;
    signing.add(key);
    let r;
    try { r = await owner.act({ type: 'setWatch', venue, symbol, on }); } catch { r = null; } finally { signing.delete(key); }
    const refused = refusedAt(r);
    if (!closed) store.dispatch('accountWatchLoaded', { items: store.get().markets.watch, error: refused ? refusalOf(r).message : null });
    if (!refused) afterAction('setWatch', r.body);
  }

  // Each old us:/crypto: star asked of the Account once, one at a time (explore?q=<its symbol, a coin's base>&limit=12): a row of
  // its kind whose base is that, in any case, is the star found — it moves to the Account's key (where the Account's list has
  // room and its write holds; else it stays on the cn list, starred as that key, for a reload to find); none is a star the
  // Account does not list, which stays, said so. A read that fails asks nothing, for the next boot to ask again; a star taken off
  // while it is asked is left as it is.
  async function askOld() {
    for (const entry of store.get().markets.watchlist) {   // the cn list as it booted
      if (closed) return;
      const match = matchKey(entry?.id);
      if (!match || Object.hasOwn(store.get().markets.asked, entry.id)) continue;
      let body;
      try {
        body = await getJson(`${EXPLORE}?q=${encodeURIComponent(match.q)}&limit=${ASKED_ROWS}`);
      } catch {
        continue;
      }
      if (closed) return;
      if (!answered(body, 'items') || !store.get().markets.watchlist.some(a => a.id === entry.id)) continue;
      const base = match.q.toUpperCase();
      const hit = body.items.find(i => i?.kind === match.kind && typeof i.base === 'string' && i.base.toUpperCase() === base && isAccountKey(i.key));
      store.dispatch('askedOfAccount', { faceId: entry.id, key: hit ? hit.key : null });
      if (!hit) continue;
      const keys = store.get().markets.watch;
      if (!keys.includes(hit.key)) {
        if (keys.length >= WATCH_LIMIT) continue;
        if (saveKeys([...keys, hit.key])) continue;   // unsaved: the cn list keeps it, and the error stands
      }
      saveList(store.get().markets.watchlist.filter(a => a.id !== entry.id));
    }
  }

  async function readHits(assets, seq) {
    const ids = assets.slice(0, HIT_QUOTES).map(a => a.id);
    try {
      const payload = parsePayload(await getJson(`/data/quotes?ids=${encodeURIComponent(ids.join(','))}`));
      if (seq === hitSeq && !closed) store.dispatch('hitQuotesLoaded', { quotes: payload.quotes });
    } catch { /* the hits stay without a quote: No quote */ }
  }

  function onStore() {
    if (closed) return;
    sync();
    if (shown && store.get().markets.tab !== readTab) retab();
    else if (shown && store.get().markets.tab === CHINA_TAB && (store.get().markets.sort === 'movers' ? 'movers' : 'volume') !== readSort) readRank();
    if (waiting !== null) open(waiting);
  }
  const onStorage = event => { if (!closed && (event?.key === STORAGE_KEY || event?.key === ACCOUNT_WATCH_KEY || event?.key === null)) load(); };
  const unsubscribe = store.subscribe(onStore);
  win?.addEventListener?.('storage', onStorage);
  load();
  sync();
  void askOld();

  return {
    /** Markets on screen in a visible tab, or not: the reads and the face's wire run only while it is. */
    show(on) {
      if (closed) return;
      const next = Boolean(on);
      quotes.setVisible(next);
      if (next === shown) return;
      shown = next;
      if (!shown) { stopPolls(); return; }
      readTab = store.get().markets.tab;
      armExplore();
      armQuotes();
      readShown();
    },
    /** The query typed: the Account's search (explore?q=, the latest one lands) into results, and the face's for the A shares. */
    search(raw) {
      if (closed) return;
      const q = typeof raw === 'string' ? raw : '';
      store.dispatch('setMarketsQuery', q);
      if (blank(q)) {
        drop('results');
        searcher.cancel();
        return;
      }
      fly('results', `${EXPLORE}?q=${encodeURIComponent(q.trim())}&limit=${ROWS}`, (body, refused) => {
        if (!refused && answered(body, 'items')) store.dispatch('resultsLoaded', { data: body, at: now() });
        else store.dispatch('resultsFailed', { at: now(), message: messageOf(body) });
      }, ['resultsLoading']);
      searcher.search(q, 'cn');
    },
    /** A star: an Account key, on a page that signs, to the Account's own list (setWatch at the line setWatchOf names; one
     *  starred on either list already is starred) — else, or where no line names it, to this browser's Account store as before;
     *  a cn id to the cn list; anything else is no one's to star. */
    watch(raw) {
      if (closed) return;
      if (isAccountKey(raw)) {
        const s = store.get();
        if (signs()) {
          if (watchedOf(s.markets, raw, s.account?.data)) return;
          const { on } = setWatchOf(s.markets, s.account?.data, raw);
          if (on) { void setWatch(raw, on, 'true'); return; }
        }
        const keys = s.markets.watch;
        if (keys.includes(raw)) return;
        if (keys.length >= WATCH_LIMIT) { store.dispatch('accountWatchLoaded', { items: keys, error: 'full' }); return; }
        saveKeys([...keys, raw]);
        return;
      }
      const id = canonicalId(raw);
      if (!id?.startsWith('cn:')) return;
      const m = store.get().markets;
      if (m.watchlist.some(a => a.id === id)) return;
      if (m.watchlist.length >= WATCH_LIMIT) { store.dispatch('watchlistLoaded', { items: m.watchlist, error: 'full' }); return; }
      // a share from the search, else from the China ranking (its name kept), else its id alone
      const ranked = (m.rank?.data?.items ?? []).find(i => i?.id === id);
      saveList([...m.watchlist, m.search.assets.find(a => a?.id === id)
        ?? (ranked ? normalizeAsset({ id, market: 'cn', symbol: ranked.symbol, name: ranked.name, currency: 'CNY' }) : null) ?? normalizeAsset({ id })]);
    },
    /** A star taken off: an Account key off the Account's own list (setWatch off for the page's entry, on a page that signs)
     *  and off this browser's Account store, with any old star still listed as it — each where it is; a face id from the cn
     *  list, an old us:/crypto: one forgotten as asked. */
    unwatch(raw) {
      if (closed) return;
      const s = store.get();
      const m = s.markets;
      if (isAccountKey(raw)) {
        const { off } = signs() ? setWatchOf(m, s.account?.data, raw) : { off: null };
        if (off) void setWatch(raw, off, '');
        if (m.watch.includes(raw)) saveKeys(m.watch.filter(k => k !== raw));
        const old = new Set(m.watchlist.filter(a => Object.hasOwn(m.asked, a.id) && m.asked[a.id] === raw).map(a => a.id));
        if (old.size) {
          saveList(store.get().markets.watchlist.filter(a => !old.has(a.id)));
          for (const id of old) store.dispatch('forgetAsked', id);
        }
        return;
      }
      const id = canonicalId(raw);
      if (!id || !m.watchlist.some(a => a.id === id)) return;
      saveList(m.watchlist.filter(a => a.id !== id));
      if (!id.startsWith('cn:')) store.dispatch('forgetAsked', id);
    },
    /** The market page on screen (an Account key: its reads and its follow; a cn id: the face's wire's), or null on leaving. */
    page(id) {
      if (closed) return;
      waiting = null;
      if (isAccountKey(id)) { open(id); return; }
      if (id == null || followed) unfollow();
      const cn = canonicalId(id);
      if (cn?.startsWith('cn:')) readCnCandles(cn, rangeOf(cn));
    },
    /** A page's chart range, one of the Account's: kept for the page, and its candles read again for it. */
    range(id, value) {
      if (closed) return;
      const cn = canonicalId(id);
      if (cn?.startsWith('cn:')) {
        store.dispatch('setRange', { id: cn, range: value });
        if (rangeOf(cn) === value) readCnCandles(cn, value);
        return;
      }
      if (!isAccountKey(id)) return;
      store.dispatch('setRange', { id, range: value });
      if (rangeOf(id) !== value) return;
      const s = store.get();
      const view = pageOf(s.markets, s.account, id, now());
      const leg = view ? followOf(view.item) : null;
      if (leg) readCandles(id, leg, value);
    },
    /** The table's rows on screen, by id: the quotes poll asks for theirs alone. */
    rowsInView(ids) {
      inView = Array.isArray(ids) ? new Set(ids) : null;
    },
    close() {
      if (closed) return;
      closed = true;
      stopPolls();
      unsubscribe();
      win?.removeEventListener?.('storage', onStorage);
      quotes.close();
      searcher.cancel();
      unfollow();
    },
  };
}
