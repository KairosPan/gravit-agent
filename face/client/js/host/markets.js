// face/client/js/host/markets.js — the Markets screen's impure half (spec 2026-10-22 §6.1): the markets through the face's
// proxy into the store — explore for the tab on screen by its filters at once and every 20 s (Stocks › China A's: its ranking by
// the sort in effect), the quotes of the rows in view (on a market's page, its own market's) every 5 s (twelve a call) and beside them the
// A shares' (the cn page's first, then the cn rows in view), a market page's candles for its range (a local market's at its
// venue: an A share's at china, a Hong Kong, Korean or Taiwanese share's at hk, kr or tw, a cash index's at ix) and its base's compare rows, and the page's market followed on its stream; one explore?q read for a search,
// its A shares the hits; the stars in this browser's two stores (the Account's keys under their own key, the A shares under the
// face's) and, on a page that signs, an Account market's star as the Account's own signed setWatch (plan 2 Task 12); each old
// us:/crypto: star asked of the Account once; and beside a market page's candles (an Account key's, never an A share's) its
// four reads (plan 4a Task 4): the asset sheet once on entering and after every owner action taken, its order book and latest
// trades at once and every 5 s while the page is on screen, a perpetual's funding once (every venue that lists it, one read).
// Two upstreams (plan A2 Task 6): the market's public reads under /data/market/… and the account's connected reads under
// /data/account/connected/…. Each explore read (a tab's, a search's, an old star's ask) asks both with the same query and lands
// their join (host/explore-join.js) over the page's venues and the venues read, asked once when Markets is first shown; China's
// ranking, its search hits, its quotes and its history are the market's alone. The quotes split by line: a pair at a venue the
// page names to the account's connected quotes, every other to the market's. A page's candles, book and trades at a connected
// line are the account's connected reads first — the account not answering, once more at the row's public line of the same
// connection (never another's), none being "The Account is not answering" — a public line's the market's; a connected line is
// followed on the account's stream, a public one on the market's (marketStream), the other told to follow nothing. The asset
// sheet, compare and funding stay the account's. The face's own quote wire is read by nothing here. The views over what lands
// are market-view.js's and market-depth-view.js's. Nothing here touches the DOM.
import {
  readWatchlist, saveWatchlist, STORAGE_KEY, readAccountWatch, saveAccountWatch, ACCOUNT_WATCH_KEY,
} from '../wire/market-model.js';
import { CHINA_VENUE, isCnKey } from '../wire/china.js';
import { localKeyOf, isLocalKey, localPairOf, localRankOf, localQuoteOf, localHitsOf, venueOfMarket } from '../wire/local.js';
import { optionKeyOf, optionChainOf } from '../wire/options.js';
import { canonicalId, isAccountKey, rowsOf, matchKey, pairsOf, pageOf, followOf, legsOf, watchedOf, setWatchOf, exploreQueryOf, connectedQueryOf, chinaRankQueryOf, rankQueryOf, onLocal, onChinaA, localRangeOf, localRangesOf, chainQueryOf } from './market-view.js';
import { refusedAt, refusalOf } from './owner-view.js';
import { assetKeyOf } from './market-depth-view.js';
import { venuesOf } from './account-view.js';
import { joinExplore } from './explore-join.js';
import { exploreHalves, joinOptsOf, orderOf, MARKET_EXPLORE as EXPLORE, CONNECTED_EXPLORE } from './explore-halves.js';
import { said, isSaid } from '../i18n/words.js';
import { windowAsk, windowPath, EVENT_RANGE } from './event-window.js';
import { toHash } from '../router.js';

// a venue's state while the proxy re-serves the market's last read: the market is not answering — flagged, so recheckChina knows
// it by the flag, never by the table's words for it (China's words name China, the other venues' the read alone)
const notAnswering = (venue = CHINA_VENUE) => ({ state: 'unavailable', said: venue === CHINA_VENUE ? said('markets.cn.notAnswering') : said('markets.local.notAnswering'), notAnswering: true });

export const EXPLORE_MS = 20_000, QUOTES_MS = 5_000, QUOTE_PAIRS = 12;
// an option chain's page reads its chain again on the face's keep of it (the proxy's 15 s), while the page is on screen
export const CHAIN_MS = 15_000;
// the option rows a search asks the market for (explore?q=…&form=option): one row an underlying
export const OPTION_HITS = 20;
const OPTION_HIT_ASKS = [['crypto', 'asset=crypto'], ['stocks', 'asset=stocks&region=us']];
// Longer than the explore proxies' 10 s bound, but shorter than the next poll. A browser request can otherwise stay
// pending before reaching the proxy and hold the host's same-path deduplication lock forever.
export const EXPLORE_TIMEOUT_MS = 15_000;
// an option chain's read: longer than the options proxy's 25 s bound (the market pages a Nasdaq expiry for up to 20 s of it)
export const CHAIN_TIMEOUT_MS = 30_000;
export const WATCH_LIMIT = 100;   // either list's: the cn list's, the Account keys' cap
// a region's own rows one ranking read asks for (market-view.js rankQueryOf's limit)
export const RANK_ROWS = 20;
// a market page's book, the levels a side; its latest trades; a perpetual's funding lines
export const BOOK_DEPTH = 10, TRADES_LIMIT = 20, FUNDING_LIMIT = 100;
// the four reads' kinds of flight
const DEPTH_KINDS = ['asset', 'book', 'trades', 'funding'];

const QUOTES = '/data/market/quotes';
const OPTIONS = '/data/market/options';
const CONNECTED_QUOTES = '/data/account/connected/quotes';
const VENUES = '/data/account/venues';
const SOURCES = '/data/market/sources';
// a connected line's part, the account not answering and no public line of the same connection to read instead
export const accountDownWord = () => said('markets.accountDown');
const ROWS = 200;                 // the explore rows a search asks for (a tab's: market-view.js exploreQueryOf)
const ASKED_ROWS = 12;            // the rows an old star's ask reads
// the kinds the Account compares across venues: not an event, not an RWA
const COMPARED = new Set(['coin', 'perp', 'stock']);

const named = v => typeof v === 'string' && v !== '';
const blank = q => typeof q !== 'string' || !q.trim();
// the Account's sentence when it refuses (`refusal.message`), else its error words — only when they are text
const words = v => (typeof v === 'string' && v.trim() !== '' ? v : null);
const messageOf = body => words(body?.refusal?.message) ?? (isSaid(body?.error) ? body.error : words(body?.error));
// an answer (`ok: true`) carrying the list the views read: a body of any other shape is never data
const answered = (body, list) => body?.ok === true && Array.isArray(body[list]);
// the explore read the tab on screen takes, by its filters (market-view.js exploreQueryOf: the Watchlist's the unscoped read),
// asked of both halves; none on a region's own view (onLocal's), whose read is its ranking (rankQueryOf). A search is its own read
// beside it.
function exploreOf(m) {
  const query = exploreQueryOf(m);
  return query === null ? null : { tab: m.tab, query };
}
// what the screen reads now: the tab's explore query, or a region's own ranking (China A, Hong Kong, Korea, Taiwan, the cash
// indices); a change of it — a region switched — reads again at once
const shownOf = m => (onLocal(m) ? `rank:${rankQueryOf(m)}` : `explore:${m.tab}:${exploreQueryOf(m)}`);
// a rejection the proxy answered for an upstream not answering: its 503 `{unreachable}`, or no body at all — never a refusal
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const unreachable = body => body === undefined || body === null || (isRecord(body) && typeof body.unreachable === 'string');
const venueOf = pair => pair.slice(0, pair.indexOf('|'));

export function startMarkets({
  store, getJson, storage, win, stream, marketStream = { follow() {} }, schedule, cancelTimer, now = Date.now,
  owner = null, afterAction = () => {},
}) {
  let closed = false;
  let shown = false;
  let exploreTimer = null;
  let quotesTimer = null;
  let readShownOf = null;    // what the explore poll reads for while shown (shownOf's)
  let wasSearching = false;  // a query was typed when the store last changed
  let inView = null;         // the row ids rowsInView last named; null: every row
  let waiting = null;        // a page asked for whose market no read lists yet: its reads wait for the read that does
  let followed = false;      // a stream follows a page's market
  let venuesAsked = false;   // the venues read asked, once, when Markets is first shown
  let sourcesAskedAt = null; // an unsuccessful catalog retries no faster than the visible explore beat
  let depthId = null;        // the Account market page whose four reads are read, from entering it to leaving it
  let localPage = null;      // a local market's page (Hong Kong, Korea, Taiwan, an index) on screen: its quote asked first
  let chainPage = null;      // an option chain's page on screen (`opt:<U>`): its chain read, and read again every CHAIN_MS
  let chainAsked = null;     // the options read that page last asked (chainQueryOf's): a pick that changes it reads at once
  let chainTimer = null;
  const kinds = new Map();   // a kind of read → { flight, path, seq, cancel }
  const signing = new Set(); // the Account keys whose setWatch is in the air
  const located = new Map(); // last exact-key lookup, independently of the selected scope; failures retry on a later poll

  // One flight per kind of read: an ask for the path in the air joins it; another path starts a read whose answer alone lands —
  // the one it overtook is dropped — and nothing lands after close(). `land(body, refused)` takes the answer, or for a rejection
  // the body the app's getJson carries on it (`error.body`, when it does).
  function fly(kind, path, land, loading = null) {
    if (closed) return;
    let k = kinds.get(kind);
    if (!k) { k = { flight: null, path: null, seq: 0, cancel: null }; kinds.set(kind, k); }
    if (k.flight !== null && k.path === path) return;
    k.cancel?.();
    const mine = ++k.seq;
    const bounded = path === SOURCES || path.startsWith(`${EXPLORE}?`) || path.startsWith(`${CONNECTED_EXPLORE}?`) || path.startsWith(`${OPTIONS}?`);
    const controller = bounded && typeof AbortController === 'function' ? new AbortController() : null;
    let deadline = null, settled = false;
    const clear = () => { if (deadline !== null) { cancelTimer(deadline); deadline = null; } };
    const finish = (body, refused) => {
      if (settled) return;
      settled = true;
      clear();
      if (k.flight === flight) { k.flight = null; k.path = null; k.cancel = null; }
      if (!closed && mine === k.seq) land(body, refused);
    };
    let asked;
    try { asked = Promise.resolve(getJson(path, controller ? { signal: controller.signal } : undefined)); } catch (error) { asked = Promise.reject(error); }
    const flight = asked.then(body => finish(body, false), error => finish(error?.body, true));
    k.flight = flight;
    k.path = path;
    k.cancel = () => { settled = true; clear(); controller?.abort(); };
    if (bounded) deadline = schedule(() => {
      finish({ unreachable: 'timeout', error: said('markets.loadTimedOut') }, true);
      controller?.abort();
    }, path.startsWith(`${OPTIONS}?`) ? CHAIN_TIMEOUT_MS : EXPLORE_TIMEOUT_MS);
    if (loading) store.dispatch(...loading);
  }
  const inAir = kind => (kinds.get(kind)?.flight ?? null) !== null;
  // a kind's flight dropped: its answer, when it comes, lands nowhere, and the next ask reads again
  function drop(kind) { const k = kinds.get(kind); if (k) { k.seq += 1; k.cancel?.(); k.cancel = null; k.flight = null; k.path = null; } }

  // the explore reads' two halves (host/explore-halves.js); a market half answered afresh rechecks China's state
  const halves = exploreHalves({ store, fly, drop, kinds, now, onMarket: body => { if (body.stale !== true) recheckChina(); } });
  // the explore read for the tab on screen
  function readExplore() {
    const read = exploreOf(store.get().markets);
    if (!read) return;
    const { tab, query } = read;
    // All sources: the connected half by class alone, every connected line of it kept (spec §5.2)
    const connectedQuery = connectedQueryOf(store.get().markets);
    halves.read(`explore:${tab}`, query, {
      connectedQuery, join: connectedQuery !== null && connectedQuery !== query ? { allSources: true } : {},
      land: data => { store.dispatch('exploreLoaded', { tab, data, at: now(), query }); if (tab === 'watchlist') locateMissing(); },
      failed: message => store.dispatch('exploreFailed', { tab, at: now(), message, query }),
      loading: ['exploreLoading', { tab }],
    });
  }
  // the tab on screen changed: the explore halves in the air for any other tab land nowhere (what each kept stays, for a
  // return to that tab to join with)
  function leaveExplores() {
    const read = exploreOf(store.get().markets);
    for (const kind of kinds.keys()) {
      const m = /^explore:([^:]+):(market|account)$/.exec(kind);
      if (m && m[1] !== read?.tab) drop(kind);
    }
  }
  // the venues read landed: every explore kept is joined again over its verdicts
  function rejoin() {
    for (const [kind, data, query] of halves.rejoin()) {
      const m = /^explore:(.+)$/.exec(kind);
      if (m && data) store.dispatch('exploreLoaded', { tab: m[1], data, at: now(), query });
    }
  }
  // the venues read — where each connection serves — asked once when Markets is first shown
  function readVenues() {
    if (venuesAsked) return;
    venuesAsked = true;
    fly('venuesHere', VENUES, (body, refused) => {
      if (!refused && body?.ok === true && Array.isArray(body.venues)) {
        store.dispatch('venuesHereLoaded', { data: body, at: now() });
        rejoin();
      } else store.dispatch('venuesHereFailed', { at: now(), message: messageOf(body) });
    });
  }

  // The registry names the Source dropdown's families; the tabs read their main sources without it. Asked on the first tab
  // other than the Watchlist (a visit to Markets costs the Watchlist's read alone); one successful catalog kept for this
  // page; a failure retries on a later visible beat or explicit one-shot entry.
  function readSources() {
    const m = store.get().markets;
    if (m.tab === 'watchlist' || m.sources?.status === 'ready' || inAir('sources')) return;
    if (sourcesAskedAt !== null && now() - sourcesAskedAt < EXPLORE_MS) return;
    sourcesAskedAt = now();
    fly('sources', SOURCES, (body, refused) => {
      if (!refused && answered(body, 'value')) store.dispatch('marketSourcesLoaded', { data: body, at: now() });
      else store.dispatch('marketSourcesFailed', { at: now(), message: messageOf(body) });
    }, ['marketSourcesLoading']);
  }

  // A region's own ranking for the sort in effect (onLocal's view, rankQueryOf's: never Closing soonest) — off any such view, China
  // A's (recheckChina's) — with the venue's state it carries: the answer for a sort or a region the screen has left lands nowhere
  // (one flight, the newer path's; and the store drops a query not last asked); an answer kept and re-served stale by the proxy
  // lands as the ranking it was, marked stale (localRankOf)
  function readRank() {
    const m = store.get().markets;
    const sort = m.sort === 'movers' ? 'movers' : 'volume';
    const query = rankQueryOf(m) ?? chinaRankQueryOf(m);
    const venue = onLocal(m)?.venue ?? CHINA_VENUE;
    fly('rank', `${EXPLORE}?${query}`, (body, refused) => {
      const data = refused ? null : localRankOf(body, query);
      if (!data) { store.dispatch('rankFailed', { sort, query, at: now(), message: messageOf(body) }); return; }
      store.dispatch('rankLoaded', { sort, query, data, at: now() });
      // a ranking the proxy re-served stale is the market not answering: its last sentence is no state of now
      store.dispatch('localStatusUpdated', { venue, status: body.stale === true ? notAnswering(venue) : rawStatus(body) });
    }, ['rankLoading', { sort, query }]);
  }
  // the state a ranking's read says, as it came: its `local` read's, else (China's) its `china` read's
  const rawStatus = body => (isRecord(body.local) ? body.local.status : body.china?.status);
  // China's state alone, off China A's ranking, while another region's own view is on screen (its ranking is that view's, never
  // overtaken by China's): the ranking itself lands nowhere
  function readChinaState() {
    const query = chinaRankQueryOf(store.get().markets);
    fly('chinaState', `${EXPLORE}?${query}`, (body, refused) => {
      if (refused || !localRankOf(body, query)) return;
      store.dispatch('chinaStatusUpdated', { status: body.stale === true ? notAnswering() : rawStatus(body) });
    });
  }
  // China's state last said as the market not answering, and the market answering afresh: its state read again, off the China
  // ranking that carries it — else that sentence would stay on Venues and Markets until a reload
  function recheckChina() {
    const providers = store.get().markets.providers;
    if (!Array.isArray(providers) || !providers.some(p => p?.market === 'cn' && p.notAnswering === true)) return;
    const m = store.get().markets;
    if (onLocal(m) && !onChinaA(m)) { if (!inAir('chinaState')) readChinaState(); return; }
    if (!inAir('rank')) readRank();
  }
  // the read for the tab on screen: a region's own ranking there, else the explore; on the Watchlist the stars its read lacks
  function readShown() {
    if (onLocal(store.get().markets)) readRank(); else readExplore();
    if (store.get().markets.tab === 'watchlist') locateMissing();
  }
  // the Watchlist's stars (Account keys, not A shares) its unscoped read does not list, each found by its exact key (locate)
  // once that read has answered — until found: a found one's price is the quotes poll's from then on
  function locateMissing() {
    const m = store.get().markets;
    const data = m.explore?.watchlist?.data;
    if (m.tab !== 'watchlist' || data?.ok !== true) return;
    const listed = new Set(['items', 'movers', 'closing', 'mostTraded'].flatMap(list => (Array.isArray(data[list]) ? data[list] : [])).map(i => i?.key));
    const found = id => m.located?.[id]?.status === 'ready';
    for (const id of m.watch ?? []) if (!isCnKey(id) && isAccountKey(id) && !listed.has(id) && !found(id)) locate(id);
  }

  // Loading a requested screen is independent of periodic visibility-based polling. Embedded browsers can start hidden,
  // or keep reporting hidden during a user interaction; they still need one answer without starting background polls.
  function readOnce() {
    if (closed) return;
    readShownOf = shownOf(store.get().markets);
    leaveExplores();
    readVenues();
    readShown();
    readSources();
  }

  // the quotes of the rows in view — the table's rows, those rowsInView last named — at their most traded connected lines,
  // twelve a call; none while one is out, so a slow Account is never asked again before it answers. A market's page names its
  // own key: when its market is no row of the tab on screen (a deep link to a market only a list beside the items carries, a
  // page reached by Back onto another tab, a market un-starred from its own page on Watching), its pair, when it has one, comes
  // from its page's own view — its most traded connected line, the line the page follows
  function readQuotes() {
    const s = store.get();
    const rows = rowsOf(s.markets, now(), s.account?.data);
    const drawn = pairsOf(rows.filter(r => inView === null || inView.has(r.id)), QUOTE_PAIRS);
    const pages = inView === null ? [] : [...inView]
      .filter(id => !isCnKey(id) && isAccountKey(id) && !rows.some(r => r.id === id))
      .flatMap(id => { const view = pageOf(s.markets, s.account, id, now()); return view ? pairsOf([{ legs: view.legs }], 1) : []; });
    const pairs = [...new Set([...drawn, ...pages])].slice(0, QUOTE_PAIRS);
    // split by line: a pair at a venue the page names is the account's connected quote, every other the market's
    const connected = new Set(venuesOf(s.account?.data).map(v => v.id).filter(Boolean));
    const lands = (body, refused) => { if (!refused && answered(body, 'quotes')) store.dispatch('accountQuotesLoaded', { quotes: body.quotes }); };
    const ask = (kind, path, list) => {
      if (!list.length || inAir(kind)) return;
      fly(kind, `${path}?pairs=${encodeURIComponent(list.join(','))}`, lands);
    };
    ask('quotes:account', CONNECTED_QUOTES, pairs.filter(p => connected.has(venueOf(p))));
    ask('quotes:market', QUOTES, pairs.filter(p => !connected.has(venueOf(p))));
  }

  // The local markets' prices, the market's (venues china, hk, kr, tw, ix), on the tick and at once for a page reached (its own id
  // first): the local page's own first, then the A-share rows in view — twelve pairs a call, none while one is out — each into the
  // quotes kept by its row's key (the A shares' store). A Hong Kong, Korean or Taiwanese row, or an index's, is priced from its
  // region's ranking (localRowsOf), so only its page is asked. Each priced row lands over the quotes kept; one the market refused
  // keeps its kept price, marked stale, with the market's sentence as its venue's state; an answer the proxy re-serves stale (the
  // market not answering) lands every price stale, the connection 'stale' and each venue's state the market not answering, and the
  // next fresh priced answer for a venue so flagged says it answering again (China's state is read again, recheckChina); a read that
  // fails keeps every price and says the connection failed
  function readLocalQuotes(pageId = null) {
    if (inAir('cnQuotes')) return;
    const s = store.get();
    const routed = s.route?.screen === 'markets' && isLocalKey(s.route.id) ? s.route.id : null;
    const page = isLocalKey(pageId) ? pageId : routed ?? localPage;
    const rows = rowsOf(s.markets, now(), s.account?.data).filter(r => isCnKey(r.id) && (inView === null || inView.has(r.id))).map(r => r.id);
    const ids = [...new Set([page, ...rows].filter(Boolean))].slice(0, QUOTE_PAIRS);
    if (!ids.length) return;
    fly('cnQuotes', `${QUOTES}?pairs=${encodeURIComponent(ids.map(localPairOf).join(','))}`, (body, refused) => {
      const kept = store.get().markets.quotes;
      if (refused || !answered(body, 'quotes')) { store.dispatch('quotesUpdated', { quotes: kept, connection: 'error' }); return; }
      const next = { ...kept };
      const refusals = new Map();
      const priced = new Map();
      for (const row of body.quotes) {
        const quote = localQuoteOf(row, now());
        if (quote) {
          next[quote.id] = body.stale === true ? { ...quote, quote_status: 'stale' } : quote;
          const venue = localKeyOf(quote.id).venue;
          if (quote.price !== null && !priced.has(venue)) priced.set(venue, quote.source);
          continue;
        }
        const id = ids.find(x => localPairOf(x) === `${row?.venue}|${row?.symbol}`);
        if (!id || row.refusal === undefined) continue;
        if (Object.hasOwn(kept, id)) next[id] = { ...kept[id], quote_status: 'stale' };
        const venue = localKeyOf(id).venue;
        if (!refusals.has(venue)) refusals.set(venue, row.refusal);
      }
      const venues = [...new Set(ids.map(id => localKeyOf(id).venue))];
      if (body.stale === true) {
        store.dispatch('quotesUpdated', { quotes: next, connection: 'stale' });
        for (const venue of venues) store.dispatch('localStatusUpdated', { venue, status: notAnswering(venue) });
        return;
      }
      store.dispatch('quotesUpdated', { quotes: next, connection: 'polling' });
      for (const [venue, refusal] of refusals) store.dispatch('localStatusUpdated', { venue, status: { state: 'unavailable', said: words(refusal?.message) ?? '' } });
      // a venue last said not answering, priced afresh: answering again, in its quote's source words (China's state is read again)
      const flagged = store.get().markets.providers;
      for (const [venue, source] of priced) {
        if (venue === CHINA_VENUE || refusals.has(venue)) continue;
        if (Array.isArray(flagged) && flagged.some(p => p?.notAnswering === true && venueOfMarket(p.market) === venue)) {
          store.dispatch('localStatusUpdated', { venue, status: { state: 'live', said: source } });
        }
      }
      if (!refusals.has(CHINA_VENUE)) recheckChina();
    });
  }

  // while Markets is on screen: explore every EXPLORE_MS for the tab on screen, the quotes every QUOTES_MS
  function armExplore() {
    exploreTimer = schedule(() => { exploreTimer = null; if (closed || !shown) return; armExplore(); readShown(); readSources(); }, EXPLORE_MS);
  }
  function armQuotes() {
    quotesTimer = schedule(() => { quotesTimer = null; if (closed || !shown) return; armQuotes(); readQuotes(); readLocalQuotes(); beatDepth(); }, QUOTES_MS);
  }
  function stopPolls() {
    if (exploreTimer !== null) { cancelTimer(exploreTimer); exploreTimer = null; }
    if (quotesTimer !== null) { cancelTimer(quotesTimer); quotesTimer = null; }
    stopChain();
  }

  // ---- an option chain's page (spec 2026-11-22 §5.4): its chain at the venue and expiry picked (chainQueryOf's), at once on entering
  // and on every pick, and again every CHAIN_MS while the page is on screen. One flight: a read for a pick left behind lands nowhere,
  // and the store drops an answer for a query not last asked (Review Focus 5); a refusal lands with the market's sentence
  function readChain() {
    if (chainPage === null) return;
    const query = chainQueryOf(store.get().markets, chainPage);
    if (query === null) return;
    chainAsked = query;
    fly('chain', `${OPTIONS}?${query}`, (body, refused) => {
      const data = refused ? null : optionChainOf(body);
      if (data) store.dispatch('chainLoaded', { query, data, at: now() });
      else store.dispatch('chainFailed', { query, at: now(), message: messageOf(body) });
    }, ['chainLoading', { query }]);
  }
  function armChain() {
    if (chainTimer !== null || closed || !shown || chainPage === null) return;
    chainTimer = schedule(() => { chainTimer = null; if (closed || !shown || chainPage === null) return; armChain(); readChain(); }, CHAIN_MS);
  }
  function stopChain() {
    if (chainTimer !== null) { cancelTimer(chainTimer); chainTimer = null; }
  }
  // the chain's page left: its read in the air lands nowhere, and what it read goes, with the picks made on it
  function leaveChain() {
    if (chainPage === null) return;
    chainPage = null;
    chainAsked = null;
    stopChain();
    drop('chain');
    store.dispatch('chainDropped');
  }
  // the tab or its filters changed while shown: its read at once, and its poll over from now
  function retab() {
    readShownOf = shownOf(store.get().markets);
    leaveExplores();
    if (exploreTimer !== null) { cancelTimer(exploreTimer); exploreTimer = null; }
    armExplore();
    readShown();
    readSources();
  }

  // the range a page's chart is drawn at: the one kept for it, 1D until one is chosen — a Hong Kong, Korean or Taiwanese share's or
  // an index's, one its market reads, its market's first until one is chosen (localRangeOf)
  function rangeOf(id) {
    const candles = store.get().markets.candles;
    const range = Object.hasOwn(candles, id) ? candles[id]?.range : undefined;
    if (isLocalKey(id) && !isCnKey(id)) return localRangeOf(id, range);
    return named(range) ? range : '1D';
  }
  // Keyed first: read `r` (candles, book, trades) at a page's line. A connected line asks the account's connected route; the
  // account not answering (the proxy's `{unreachable}`, or no body), the market is asked once at the row's public line of the
  // same connection — the line's own connector, else its venue's on the page — and with none the part fails in the account's
  // absence. A refusal is the answer, never a reason to fall back. A public line asks the market. `queryAt(line)` is the
  // read's query at a line; `land(body, refused)` as fly's.
  function readKeyed(kind, r, item, leg, queryAt, land, loading) {
    if (!leg.connected) { fly(kind, `/data/market/${r}?${queryAt(leg)}`, land, loading); return; }
    fly(kind, `/data/account/connected/${r}?${queryAt(leg)}`, (body, refused) => {
      if (!refused || !unreachable(body)) { land(body, refused); return; }
      const connector = leg.connector || venuesOf(store.get().account?.data).find(v => v.id === leg.venue)?.connector || '';
      const twin = connector ? publicLinesOf(item).find(l => l.public && l.connector === connector && l.venue && l.symbol) : undefined;
      if (twin) fly(kind, `/data/market/${r}?${queryAt(twin)}`, land);
      else land({ ok: false, error: accountDownWord() }, true);
    }, loading);
  }
  const at = l => `venue=${encodeURIComponent(l.venue)}&symbol=${encodeURIComponent(l.symbol)}`;
  // a row's lines, and the lines of the market's own row of that key as the explore halves kept it: the join leaves out a public
  // line a connected venue speaks for, and that line is the one to read while the account is not answering
  function publicLinesOf(item) {
    const own = [];
    for (const market of halves.markets()) {
      for (const list of ['items', 'movers', 'closing', 'mostTraded']) {
        const row = Array.isArray(market[list]) ? market[list].find(r => isRecord(r) && r.key === item.key) : undefined;
        if (row) own.push(...legsOf(row));
      }
    }
    return [...legsOf(item), ...own];
  }
  // a page's candles at its line for the range — a refusal lands with the sentence it carries; an answer for a range the page
  // has left since lands nowhere
  function readCandles(id, item, leg, range) {
    readKeyed(`candles:${id}`, 'candles', item, leg, l => `${at(l)}&range=${encodeURIComponent(range)}`, (body, refused) => {
      if (rangeOf(id) !== range) return;
      if (!refused && answered(body, 'candles')) store.dispatch('candlesLoaded', { id, range, data: body, at: now() });
      else store.dispatch('candlesFailed', { id, range, at: now(), message: messageOf(body) });
    }, ['candlesLoading', { id, range }]);
  }
  // a local market's history at the range — an A share's at venue china, a Hong Kong, Korean or Taiwanese share's at its venue, a
  // cash index's at venue ix (1D and 5D are sessions, the longer ranges candles) — a refusal landing with its sentence; an answer for
  // a range the page has left lands nowhere
  function readLocalCandles(id, range) {
    const k = localKeyOf(id);
    if (!k) return;
    const path = `/data/market/candles?venue=${k.venue}&symbol=${encodeURIComponent(k.symbol)}&range=${encodeURIComponent(range)}`;
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
    marketStream.follow([]);
  }
  // a line followed: a connected one on the account's stream, a public one on the market's — the other told to follow nothing
  function followAt(leg) {
    followed = true;
    const key = `${leg.venue}:${leg.symbol}`;
    if (leg.connected) { marketStream.follow([]); stream.follow([key]); } else { stream.follow([]); marketStream.follow([key]); }
  }
  // A saved link or star can belong to another entry, or lie below its busiest rows. Resolve its exact key without
  // replacing the selected entry's list. Qualified xyz coins ask that source alone, even on a fresh Hyperliquid screen.
  function locate(id) {
    if (located.has(id) && now() - located.get(id) < EXPLORE_MS) return;
    located.set(id, now());
    const q = id.slice(id.indexOf(':') + 1).slice(0, 60);
    const scope = id.startsWith('perp:xyz:') ? '&scope=xyz' : '';
    halves.read(`locate:${id}`, `q=${encodeURIComponent(q)}&key=${encodeURIComponent(id)}&limit=${ASKED_ROWS}${scope}`, {
      land: data => store.dispatch('marketLocated', { id, data, at: now() }),
      failed: () => {},
    });
  }
  // A market's page: the candles at its line — its first connected line, else its first public listing — for its kept range, the
  // compare rows for its base (a coin, a perpetual, a stock) and that line followed on its stream. A page whose market no read
  // lists yet (a deep link before explore answers) waits for the read that lists it; meanwhile it follows nothing.
  function open(id) {
    const s = store.get();
    const view = pageOf(s.markets, s.account, id, now());
    if (!view) {
      waiting = id;
      if (followed) unfollow();
      locate(id);
      return;
    }
    waiting = null;
    const leg = followOf(view.item);
    if (leg) readCandles(id, view.item, leg, rangeOf(id));
    if (COMPARED.has(view.item.kind) && named(view.item.base)) readCompare(view.item.base);
    if (leg) followAt(leg); else if (followed) unfollow();
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
  // the book and the latest trades at the line the page follows, keyed first; the trades no more once the source said it
  // publishes none
  function readMarketDepth(id, item) {
    const leg = followOf(item);
    if (!leg) return;
    readKeyed('book', 'book', item, leg, l => `${at(l)}&depth=${BOOK_DEPTH}`, landDepth(id, 'book', b => b.book !== null && typeof b.book === 'object'),
      ['depthLoading', { id, part: 'book' }]);
    const kept = store.get().markets.depth?.[id]?.trades;
    if (kept?.status === 'ready' && typeof kept.data?.none === 'string' && kept.data.none.trim() !== '') return;
    readKeyed('trades', 'trades', item, leg, l => `${at(l)}&limit=${TRADES_LIMIT}`, landDepth(id, 'trades', b => Array.isArray(b.trades)),
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
      const query = `q=${encodeURIComponent(match.q)}&limit=${ASKED_ROWS}`;
      const half = async path => { try { return await getJson(path); } catch { return null; } };
      const [mb, cb] = await Promise.all([half(`${EXPLORE}?${query}`), half(`${CONNECTED_EXPLORE}?${query}`)]);
      if (closed) return;
      const body = joinExplore(mb, cb, { ...joinOptsOf(store.get()), ...orderOf(query), now: now() });
      if (body === null) continue;
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

  // A stock page at an event (spec 2026-11-12 §4.3): its window's daily bars read once per `<id>@<at>` from the US stocks line,
  // beside the page's own reads, whatever line the page follows; the answer kept as it came (its `more` is never paged from). A
  // read that failed is read once more each time the page at that event is entered again (Task 9, ruling 6)
  let eventEntered = null;
  function readEvent() {
    const s = store.get();
    const { screen, id, event } = s.route ?? {};
    if (screen !== 'markets' || typeof id !== 'string' || !id.startsWith('stock:') || typeof event?.at !== 'string') { eventEntered = null; return; }
    const key = `${id}@${event.at}`;
    const entering = eventEntered !== key;
    eventEntered = key;
    const kept = Object.hasOwn(s.markets.event ?? {}, key) ? s.markets.event[key] : undefined;
    if (kept !== undefined && !(entering && kept?.status === 'error')) return;
    fly(`event:${key}`, windowPath(id.slice('stock:'.length), windowAsk(event.at, now())), (body, refused) => {
      if (!refused && answered(body, 'candles')) store.dispatch('eventBarsLoaded', { key, data: body, at: now() });
      else store.dispatch('eventBarsFailed', { key, at: now(), message: messageOf(body) });
    }, ['eventBarsLoading', { key }]);
  }

  function onStore() {
    if (closed) return;
    readEvent();
    // the tab, a filter or the sort changed what the screen reads: read it at once (a read asked for other filters lands under
    // its own query, never drawn under these: market-view.js tableOf)
    if (shown && shownOf(store.get().markets) !== readShownOf) retab();
    // the search ended (Back to <tab>, another tab pressed): its read in the air lands nowhere
    const searching = !blank(store.get().markets.q);
    if (wasSearching && !searching) { halves.forget('results'); drop('optionHits:crypto'); drop('optionHits:stocks'); }
    wasSearching = searching;
    if (waiting !== null) open(waiting);
    // a venue or an expiry picked on a chain's page (or a row that names its venues landing): its chain read at once, its poll over
    if (chainPage !== null && chainQueryOf(store.get().markets, chainPage) !== chainAsked) {
      stopChain();
      readChain();
      armChain();
    }
  }
  const onStorage = event => { if (!closed && (event?.key === STORAGE_KEY || event?.key === ACCOUNT_WATCH_KEY || event?.key === null)) load(); };
  const unsubscribe = store.subscribe(onStore);
  win?.addEventListener?.('storage', onStorage);
  load();
  moveCnStars();
  void askOld();

  return {
    readOnce,
    /** The Account's read answered afresh (not one the proxy re-served stale): China's state, when last said as the Account
     *  not answering, is read again, on any screen. */
    accountAnswered(body) {
      if (closed || body?.stale === true) return;
      recheckChina();
    },
    /** Visible Markets polls; hiding pauses polls but lets a bounded one-shot read finish. */
    show(on) {
      if (closed) return;
      const next = Boolean(on);
      if (next === shown) return;
      shown = next;
      if (!shown) { stopPolls(); return; }
      armExplore();
      armQuotes();
      armChain();
      readOnce();
      // back from a hidden spell: the chain on screen read at once, as the other reads are
      if (chainPage !== null) readChain();
    },
    /** The query typed: the Account's search (explore?q=, the latest one lands) into results — its A shares the hits, with the
     *  prices the search carries. */
    search(raw) {
      if (closed) return;
      const q = typeof raw === 'string' ? raw : '';
      store.dispatch('setMarketsQuery', q);
      if (blank(q)) {
        halves.forget('results');
        drop('optionHits:crypto');
        drop('optionHits:stocks');
        return;
      }
      // the market's option rows for it, one row an underlying (no chain is read for a search): what the options views list, one
      // read an asset (Ruling R7: never form=option without an asset, whose sort would compare dollars with contracts)
      const hitsQ = q.trim();
      for (const [asset, scope] of OPTION_HIT_ASKS) {
        fly(`optionHits:${asset}`, `${EXPLORE}?${scope}&form=option&q=${encodeURIComponent(hitsQ)}&limit=${OPTION_HITS}`, (body, refused) => {
          store.dispatch('optionHitsLoaded', { q: hitsQ, asset, data: !refused && answered(body, 'items') ? body : null });
        });
      }
      // a new query forgets what the last one kept (explore-halves.js)
      // every market, whatever the tab and its filters (G5)
      halves.read('results', `q=${encodeURIComponent(q.trim())}&limit=${ROWS}`, {
        land: (data, kept) => {
          store.dispatch('resultsLoaded', { data, at: now() });
          // the local hits (the A shares, and Hong Kong's, Korea's, Taiwan's, the indices'), the market's alone
          if (kept.market) store.dispatch('hitQuotesLoaded', { quotes: localHitsOf(kept.market).quotes });
        },
        failed: message => store.dispatch('resultsFailed', { at: now(), message }),
        loading: ['resultsLoading'],
      });
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
    /** The market page on screen (an A share: its history at venue china, reached cold or not; another local market — Hong Kong,
     *  Korea, Taiwan, an index — its quote at once; another Account key: its reads and its follow), or null on leaving. */
    page(id) {
      if (closed) return;
      waiting = null;
      if (id !== depthId) leaveDepth();
      if (id !== chainPage) leaveChain();
      localPage = isLocalKey(id) && !isCnKey(id) ? id : null;
      // an option chain's page: its chain read now and on its beat; nothing followed
      if (optionKeyOf(id)) {
        if (followed) unfollow();
        if (chainPage === id) return;
        chainPage = id;
        readChain();
        armChain();
        return;
      }
      if (isCnKey(id)) {
        if (followed) unfollow();
        readLocalCandles(id, rangeOf(id));
        readLocalQuotes(id);
        return;
      }
      // a Hong Kong, Korean or Taiwanese share's page, or an index's: its history at its venue and its price at once (its page is
      // the A share's kind of page)
      if (localPage) {
        if (followed) unfollow();
        readLocalCandles(id, rangeOf(id));
        readLocalQuotes(id);
        return;
      }
      if (isAccountKey(id)) { open(id); return; }
      if (id == null || followed) unfollow();
    },
    /** A page's chart range, one of the Account's: kept for the page, and its candles read again for it; chosen at an event,
     *  the page leaves the event first (its hash the plain page's). */
    range(id, value) {
      if (closed) return;
      // Around the event is drawn, never read; any other range on a stock's page at an event leaves the event for the plain page
      if (value === EVENT_RANGE) return;
      const route = store.get().route;
      if (route?.screen === 'markets' && route.id === id && route.event) {
        const plain = { screen: 'markets', id };
        store.dispatch('nav', plain);
        if (win?.location) win.location.hash = toHash(plain);
      }
      if (isLocalKey(id)) {
        // a range the market refuses for this market (an index's 1D, Taiwan's 5Y…) is never asked
        if (!localRangesOf(id).includes(value)) return;
        store.dispatch('setRange', { id, range: value });
        if (rangeOf(id) === value) readLocalCandles(id, value);
        return;
      }
      if (!isAccountKey(id)) return;
      store.dispatch('setRange', { id, range: value });
      if (rangeOf(id) !== value) return;
      const s = store.get();
      const view = pageOf(s.markets, s.account, id, now());
      const leg = view ? followOf(view.item) : null;
      if (leg) readCandles(id, view.item, leg, value);
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
      for (const kind of kinds.keys()) drop(kind);
    },
  };
}
