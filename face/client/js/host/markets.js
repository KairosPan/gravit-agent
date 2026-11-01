// face/client/js/host/markets.js — the Markets screen's impure half (spec 2026-10-22 §6.1): the Account's markets through the
// face's proxy into the store — explore for the tab on screen at once and every 20 s (China's: its ranking by the sort in
// effect), the quotes of the rows in view (on a market's page, its own market's) every 5 s (twelve a call) and beside them the
// A shares' (the cn page's first, then the cn rows in view), a market page's candles for its range (an A share's at venue
// china) and its base's compare rows, and the page's market followed on the Account's stream; one explore?q read for a search,
// its A shares the hits; the stars in this browser's two stores (the Account's keys under their own key, the A shares under the
// face's) and, on a page that signs, an Account market's star as the Account's own signed setWatch (plan 2 Task 12); each old
// us:/crypto: star asked of the Account once; and beside a market page's candles (an Account key's, never an A share's) its
// four reads (plan 4a Task 4): the asset sheet once on entering and after every owner action taken, its order book and latest
// trades at once and every 5 s while the page is on screen, a perpetual's funding once (every venue that lists it, one read).
// Every market read is the Account's: the face's own quote wire is read by nothing here. The views over what lands are
// market-view.js's and market-depth-view.js's. Nothing here touches the DOM.
import {
  readWatchlist, saveWatchlist, STORAGE_KEY, readAccountWatch, saveAccountWatch, ACCOUNT_WATCH_KEY,
} from '../wire/market-model.js';
import { CHINA_VENUE, isCnKey, chinaPairOf, rankOf, cnQuoteOf, cnHitsOf } from '../wire/china.js';
import { ACCOUNT_TABS, CHINA_TAB, NOT_ANSWERING_WORD, canonicalId, isAccountKey, rowsOf, matchKey, pairsOf, pageOf, followOf, watchedOf, setWatchOf } from './market-view.js';
import { refusedAt, refusalOf } from './owner-view.js';
import { assetKeyOf } from './market-depth-view.js';

// China's state while the proxy re-serves the Account's last read: the Account is not answering
const NOT_ANSWERING = { state: 'unavailable', said: NOT_ANSWERING_WORD };

export const EXPLORE_MS = 20_000, QUOTES_MS = 5_000, QUOTE_PAIRS = 12;
export const WATCH_LIMIT = 100;   // either list's: the cn list's, the Account keys' cap
// the China tab's rows one ranking read asks for
export const RANK_ROWS = 20;
// a market page's book, the levels a side; its latest trades; a perpetual's funding lines
export const BOOK_DEPTH = 10, TRADES_LIMIT = 20, FUNDING_LIMIT = 100;
// the four reads' kinds of flight
const DEPTH_KINDS = ['asset', 'book', 'trades', 'funding'];

const EXPLORE = '/data/account/explore';
const QUOTES = '/data/account/quotes';
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
  store, getJson, storage, win, stream, schedule, cancelTimer, now = Date.now,
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
  let depthId = null;        // the Account market page whose four reads are read, from entering it to leaving it
  const kinds = new Map();   // a kind of read → { flight, path, seq }
  const signing = new Set(); // the Account keys whose setWatch is in the air

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

  // China's ranking for the sort in effect, the Account's china tab: the answer for a sort the screen has left lands nowhere (one
  // flight, the newer path's); an answer kept and re-served stale by the proxy lands as the ranking it was, marked stale (rankOf)
  function readRank() {
    const sort = store.get().markets.sort === 'movers' ? 'movers' : 'volume';
    readSort = sort;
    fly('rank', `${EXPLORE}?tab=${CHINA_TAB}&sort=${sort}&limit=${RANK_ROWS}`, (body, refused) => {
      const data = refused ? null : rankOf(body, sort);
      if (!data) { store.dispatch('rankFailed', { sort, at: now(), message: messageOf(body) }); return; }
      store.dispatch('rankLoaded', { sort, data, at: now() });
      // a ranking the proxy re-served stale is the Account not answering: its last sentence is no state of now
      store.dispatch('chinaStatusUpdated', { status: body.stale === true ? NOT_ANSWERING : body.china.status });
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
      .filter(id => !isCnKey(id) && isAccountKey(id) && !rows.some(r => r.id === id))
      .flatMap(id => { const view = pageOf(s.markets, s.account, id, now()); return view ? pairsOf([{ legs: view.legs }], 1) : []; });
    const pairs = [...new Set([...drawn, ...pages])].slice(0, QUOTE_PAIRS);
    if (!pairs.length) return;
    fly('quotes', `/data/account/quotes?pairs=${encodeURIComponent(pairs.join(','))}`, (body, refused) => {
      if (!refused && answered(body, 'quotes')) store.dispatch('accountQuotesLoaded', { quotes: body.quotes });
    });
  }

  // the A shares' prices, the Account's (venue china), on the tick and at once for a page reached (its own id first): the cn page's own first, then the cn rows in view — twelve a call, none while
  // one is out. Each priced row lands over the quotes kept; one the Account refused keeps its kept price, marked stale, with the
  // Account's sentence as China's state; an answer the proxy re-serves stale (the Account not answering) lands every price stale, the connection
  // 'stale' and China's state the Account not answering;
  // a read that fails keeps every price and says the connection failed
  function readCnQuotes(pageId = null) {
    if (inAir('cnQuotes')) return;
    const s = store.get();
    const page = isCnKey(pageId) ? pageId : s.route?.screen === 'markets' && isCnKey(s.route.id) ? s.route.id : null;
    const rows = rowsOf(s.markets, now(), s.account?.data).filter(r => isCnKey(r.id) && (inView === null || inView.has(r.id))).map(r => r.id);
    const ids = [...new Set([page, ...rows].filter(Boolean))].slice(0, QUOTE_PAIRS);
    if (!ids.length) return;
    fly('cnQuotes', `${QUOTES}?pairs=${encodeURIComponent(ids.map(chinaPairOf).join(','))}`, (body, refused) => {
      const kept = store.get().markets.quotes;
      if (refused || !answered(body, 'quotes')) { store.dispatch('quotesUpdated', { quotes: kept, connection: 'error' }); return; }
      const next = { ...kept };
      let refusal = null;
      for (const row of body.quotes) {
        if (row?.venue !== CHINA_VENUE) continue;
        const quote = cnQuoteOf(row, now());
        if (quote) { next[quote.id] = body.stale === true ? { ...quote, quote_status: 'stale' } : quote; continue; }
        const id = `cn:${row.symbol}`;
        if (!isCnKey(id) || row.refusal === undefined) continue;
        if (Object.hasOwn(kept, id)) next[id] = { ...kept[id], quote_status: 'stale' };
        refusal ??= row.refusal;
      }
      if (body.stale === true) {
        store.dispatch('quotesUpdated', { quotes: next, connection: 'stale' });
        store.dispatch('chinaStatusUpdated', { status: NOT_ANSWERING });
        return;
      }
      store.dispatch('quotesUpdated', { quotes: next, connection: 'polling' });
      if (refusal) store.dispatch('chinaStatusUpdated', { status: { state: 'unavailable', said: words(refusal?.message) ?? '' } });
    });
  }

  // while Markets is on screen: explore every EXPLORE_MS for the tab on screen, the quotes every QUOTES_MS
  function armExplore() {
    exploreTimer = schedule(() => { exploreTimer = null; if (closed || !shown) return; armExplore(); readShown(); }, EXPLORE_MS);
  }
  function armQuotes() {
    quotesTimer = schedule(() => { quotesTimer = null; if (closed || !shown) return; armQuotes(); readQuotes(); readCnQuotes(); beatDepth(); }, QUOTES_MS);
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
  // an A share's history at the range, the Account's at venue china (its 1D and 5D are sessions, the longer ranges candles); an
  // answer for a range the page has left lands nowhere
  function readCnCandles(id, range) {
    const path = `/data/account/candles?venue=${CHINA_VENUE}&symbol=${encodeURIComponent(id.slice(3))}&range=${encodeURIComponent(range)}`;
    fly(`candles:${id}`, path, (body, refused) => {
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
    if (depthId !== id) {
      leaveDepth();
      depthId = id;
      readHere(id, view.item);
      readFunding(id, view);
    }
    readMarketDepth(id, view.item);
  }

  // ---- a market page's four reads beside its price (plan 4a Task 4): each a flight of its own kind, the latest alone landing,
  // nothing after leaving the page or close(). A body of another shape than the read's is a failure, said in the Account's
  // sentence when it carries one (an HTML 404 page, a 503 unreachable carry none)
  function landDepth(id, part, ok) {
    return (body, refused) => {
      if (closed || depthId !== id) return;
      if (!refused && body?.ok === true && ok(body)) store.dispatch('depthLoaded', { id, part, data: body, at: now() });
      else store.dispatch('depthFailed', { id, part, at: now(), message: messageOf(body) });
    };
  }
  // the asset sheet: what is held of it, its orders, its lines and its cost — the asset the retired page reads it as;
  // `fresh` past the face's cache (after an owner action)
  function readHere(id, item, fresh = false) {
    const key = assetKeyOf(item);
    if (!key) return;
    fly('asset', `/data/account/asset?key=${encodeURIComponent(key)}${fresh ? '&fresh=1' : ''}`,
      landDepth(id, 'here', b => Array.isArray(b.positions) && Array.isArray(b.orders)), ['depthLoading', { id, part: 'here' }]);
  }
  // the book and the latest trades at the line the page follows; the trades no more once the source said it publishes none
  function readMarketDepth(id, item) {
    const leg = followOf(item);
    if (!leg) return;
    const at = `venue=${encodeURIComponent(leg.venue)}&symbol=${encodeURIComponent(leg.symbol)}`;
    fly('book', `/data/account/book?${at}&depth=${BOOK_DEPTH}`, landDepth(id, 'book', b => b.book !== null && typeof b.book === 'object'),
      ['depthLoading', { id, part: 'book' }]);
    const kept = store.get().markets.depth?.[id]?.trades;
    if (kept?.status === 'ready' && typeof kept.data?.none === 'string' && kept.data.none.trim() !== '') return;
    fly('trades', `/data/account/trades?${at}&limit=${TRADES_LIMIT}`, landDepth(id, 'trades', b => Array.isArray(b.trades)),
      ['depthLoading', { id, part: 'trades' }]);
  }
  // a perpetual's funding: one read at every venue that lists it, as the retired page reads it (ui/terminal.js ttFunding);
  // a venue it could not read is in the answer's `missing`, never a failure of the read
  function readFunding(id, view) {
    if (view.item.kind !== 'perp') return;
    fly('funding', `/data/account/funding?limit=${FUNDING_LIMIT}`, landDepth(id, 'funding', b => Array.isArray(b.lines)),
      ['depthLoading', { id, part: 'funding' }]);
  }
  // the page left: its reads in the air land nowhere, and what they read goes
  function leaveDepth() {
    if (depthId === null) return;
    for (const kind of DEPTH_KINDS) drop(kind);
    store.dispatch('depthDropped', { id: depthId });
    depthId = null;
  }
  // the 5 s beat, while the page is on screen: its book and its trades again
  function beatDepth() {
    if (depthId === null || waiting !== null) return;
    const s = store.get();
    const view = pageOf(s.markets, s.account, depthId, now());
    if (view) readMarketDepth(depthId, view.item);
  }

  // the key a star names at the Account: an A share's cn key (`cn:sh600519` canonicalised), another Account key as it is; else null
  const accountKeyOf = raw => {
    const cn = typeof raw === 'string' && raw.startsWith('cn:') ? canonicalId(raw) : null;
    return isCnKey(cn) ? cn : isAccountKey(raw) && !String(raw).startsWith('cn:') ? raw : null;
  };

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

  // The old cn list's A shares moved once into this browser's Account-key store, as the old us:/crypto: stars were: each cn star
  // appended (once each) while the store has room under WATCH_LIMIT, then the cn list saved without those that moved — what did
  // not fit stays on the cn list, still starred, and the store's error reads full. Nothing is signed: on a page that signs too,
  // the stars move into this browser's store, for the operator to put on the Account's list. Either store unreadable (load's
  // `read`) moves nothing, so neither stored value is written over; a failed write of the keys moves nothing either.
  function moveCnStars() {
    const m = store.get().markets;
    if (m.watchError) return;
    const cn = m.watchlist.filter(a => isCnKey(a?.id));
    if (!cn.length) return;
    let keys = m.watch;
    const moved = new Set();
    let full = false;
    for (const { id } of cn) {
      if (keys.includes(id)) { moved.add(id); continue; }
      if (keys.length >= WATCH_LIMIT) { full = true; continue; }
      keys = [...keys, id];
      moved.add(id);
    }
    if (keys !== m.watch && saveKeys(keys)) return;   // unsaved: the cn list keeps them all, and the error stands
    if (moved.size) saveList(store.get().markets.watchlist.filter(a => !moved.has(a.id)));
    if (full) store.dispatch('accountWatchLoaded', { items: store.get().markets.watch, error: 'full' });
  }

  function onStore() {
    if (closed) return;
    if (shown && store.get().markets.tab !== readTab) retab();
    else if (shown && store.get().markets.tab === CHINA_TAB && (store.get().markets.sort === 'movers' ? 'movers' : 'volume') !== readSort) readRank();
    if (waiting !== null) open(waiting);
  }
  const onStorage = event => { if (!closed && (event?.key === STORAGE_KEY || event?.key === ACCOUNT_WATCH_KEY || event?.key === null)) load(); };
  const unsubscribe = store.subscribe(onStore);
  win?.addEventListener?.('storage', onStorage);
  load();
  moveCnStars();
  void askOld();

  return {
    /** Markets on screen in a visible tab, or not: the reads run only while it is. */
    show(on) {
      if (closed) return;
      const next = Boolean(on);
      if (next === shown) return;
      shown = next;
      if (!shown) { stopPolls(); return; }
      readTab = store.get().markets.tab;
      armExplore();
      armQuotes();
      readShown();
    },
    /** The query typed: the Account's search (explore?q=, the latest one lands) into results — its A shares the hits, with the
     *  prices the search carries. */
    search(raw) {
      if (closed) return;
      const q = typeof raw === 'string' ? raw : '';
      store.dispatch('setMarketsQuery', q);
      if (blank(q)) {
        drop('results');
        return;
      }
      fly('results', `${EXPLORE}?q=${encodeURIComponent(q.trim())}&limit=${ROWS}`, (body, refused) => {
        if (!refused && answered(body, 'items')) {
          store.dispatch('resultsLoaded', { data: body, at: now() });
          store.dispatch('hitQuotesLoaded', { quotes: cnHitsOf(body).quotes });
        } else store.dispatch('resultsFailed', { at: now(), message: messageOf(body) });
      }, ['resultsLoading']);
    },
    /** A star: an Account key — an A share's `cn:<code>` (`cn:sh600519` canonicalised) among them — on a page that signs, to the
     *  Account's own list (setWatch at the line setWatchOf names, an A share's `china|<code>`; one starred on either list already
     *  is starred) — else, or where no line names it, to this browser's Account store; anything else is no one's to star. */
    watch(raw) {
      if (closed) return;
      const key = accountKeyOf(raw);
      if (key === null) return;
      const s = store.get();
      if (signs()) {
        if (watchedOf(s.markets, key, s.account?.data)) return;
        const { on } = setWatchOf(s.markets, s.account?.data, key);
        if (on) { void setWatch(key, on, 'true'); return; }
      }
      const keys = s.markets.watch;
      if (keys.includes(key) || (isCnKey(key) && s.markets.watchlist.some(a => a.id === key))) return;
      if (keys.length >= WATCH_LIMIT) { store.dispatch('accountWatchLoaded', { items: keys, error: 'full' }); return; }
      saveKeys([...keys, key]);
    },
    /** A star taken off: an Account key (an A share's among them) off the Account's own list (setWatch off for the page's
     *  entry, on a page that signs) and off this browser's Account store, with any old star still listed as it — each where it
     *  is; a face id from the cn list, an old us:/crypto: one forgotten as asked. */
    unwatch(raw) {
      if (closed) return;
      const s = store.get();
      const m = s.markets;
      const key = accountKeyOf(raw);
      if (key !== null) {
        const { off } = signs() ? setWatchOf(m, s.account?.data, key) : { off: null };
        if (off) void setWatch(key, off, '');
        if (m.watch.includes(key)) saveKeys(m.watch.filter(k => k !== key));
        // an old star still listed as it: an us:/crypto: one found as this key, or the A share itself left on the cn list
        const old = new Set(m.watchlist.filter(a => a.id === key || (Object.hasOwn(m.asked, a.id) && m.asked[a.id] === key)).map(a => a.id));
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
    /** The market page on screen (an A share: its history at venue china, reached cold or not; another Account key: its reads
     *  and its follow), or null on leaving. */
    page(id) {
      if (closed) return;
      waiting = null;
      if (id !== depthId) leaveDepth();
      if (isCnKey(id)) {
        if (followed) unfollow();
        readCnCandles(id, rangeOf(id));
        readCnQuotes(id);
        return;
      }
      if (isAccountKey(id)) { open(id); return; }
      if (id == null || followed) unfollow();
    },
    /** A page's chart range, one of the Account's: kept for the page, and its candles read again for it. */
    range(id, value) {
      if (closed) return;
      if (isCnKey(id)) {
        store.dispatch('setRange', { id, range: value });
        if (rangeOf(id) === value) readCnCandles(id, value);
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
    /** An owner action taken: the asset sheet of the market page on screen read again, past the face's cache. */
    afterAction() {
      if (closed || depthId === null) return;
      const s = store.get();
      const view = pageOf(s.markets, s.account, depthId, now());
      if (!view) return;
      drop('asset');
      readHere(depthId, view.item, true);
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
      unfollow();
      for (const kind of DEPTH_KINDS) drop(kind);
    },
  };
}
