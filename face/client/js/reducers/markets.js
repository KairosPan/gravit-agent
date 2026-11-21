// face/client/js/reducers/markets.js — Markets on the face: what the host layer (host/markets.js) brings in — the Account's
// explore reads by tab and the search's, the quotes of the rows in view and of the market a page follows, a page's candles and
// its base's compare rows, the Account keys starred and what each old us:/crypto: star was found as; the A shares' quotes, their
// search hits' prices and China's state, the Account's too — and the screen's own view of it: the tab, its Region, Form and
// Source and the popover open, the sort, the query, a page's range
import { ACCOUNT_SORT_IDS, CANDLE_RANGES, MARKET_TABS, REGIONS, onLocal, isAccountKey, formsInView, formsOfSource, mainFormsOf, isSourceOf } from '../host/market-view.js';
import { number } from '../wire/market-model.js';
import { isCnKey } from '../wire/china.js';
import { LOCAL_VENUES, localProviderOf, venueOfMarket } from '../wire/local.js';

const mk = (s, patch) => ({ ...s, markets: { ...s.markets, ...patch } });
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => (isRecord(o) && Object.hasOwn(o, k) ? o[k] : undefined);
const IDLE = { status: 'idle', data: null, at: null };
// one of the Account's reads kept by key ({ [key]: { status, data, at } }): a failed read keeps its last data, as the Account
// slice's do
const keyed = (s, field, key, patch) => mk(s, { [field]: { ...s.markets[field], [key]: { ...IDLE, ...own(s.markets[field], key), ...patch } } });
const read = (s, patch) => mk(s, { results: { ...s.markets.results, ...patch } });
// the explore reads, one a tab (the Watchlist's the unscoped read), each kept with the query it was asked with
const EXPLORED = new Set(MARKET_TABS);
// a market's history: an A share's (cn: and its six digits, never another cn: id) or another Account key's, at one of the
// candle ranges
const charted = (id, range) => (isCnKey(id) || (isAccountKey(id) && !String(id).startsWith('cn:'))) && CANDLE_RANGES.includes(range);
// a local ranking's two sorts
const RANKED = new Set(['volume', 'movers']);
const rank = (s, patch) => mk(s, { rank: { ...s.markets.rank, ...patch } });
// a ranking's answer for a query other than the one last asked (a region left behind, landing late: Review Focus 5) lands nowhere;
// one that names no query lands as China A's always did
const overtaken = (s, query) => typeof query === 'string' && typeof s.markets.rank?.query === 'string' && s.markets.rank.query !== query;
const asked = query => (typeof query === 'string' ? { query } : {});
// a venue's state, its provider the only one of that venue: the others kept, in LOCAL_VENUES's order
function provided(s, venue, status) {
  const others = (Array.isArray(s.markets.providers) ? s.markets.providers : []).filter(p => venueOfMarket(p?.market) !== venue);
  const order = p => LOCAL_VENUES.indexOf(venueOfMarket(p?.market) ?? '');
  return mk(s, { providers: [...others, ...localProviderOf(venue, status)].sort((a, b) => order(a) - order(b)) });
}
const named = v => typeof v === 'string' && v !== '';
// what the market says of its leverage — the most it takes and the margin modes it sets — kept only where it says them (the Leverage
// sheet bounds its field by them)
const limitsOf = m => ({
  ...(number(m?.maxLeverage) !== null && number(m.maxLeverage) > 0 ? { maxLeverage: number(m.maxLeverage) } : {}),
  ...(Array.isArray(m?.marginModes) ? { marginModes: m.marginModes.filter(x => typeof x === 'string') } : {}),
});
const text = v => (typeof v === 'string' ? v : null);
// a price's stamp as a time, or null when it has none that parses
const timeOf = v => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
const blank = q => !String(q ?? '').trim();
// a market page's four reads beside its price: an Account key's (never an A share's), each part kept as keyed keeps a read
const DEPTH_PARTS = new Set(['here', 'book', 'trades', 'funding']);
const depthed = (id, part) => isAccountKey(id) && !String(id).startsWith('cn:') && DEPTH_PARTS.has(part);
const DEPTH_IDLE = { status: 'idle', data: null, at: null, message: null, freshAt: null };
const depth = (s, id, part, patch) => {
  const page = own(s.markets.depth, id);
  return mk(s, { depth: { ...s.markets.depth, [id]: { ...(isRecord(page) ? page : {}), [part]: { ...DEPTH_IDLE, ...own(page, part), ...patch } } } });
};
// a tab starts from Most traded, as Linqi's does
const onTab = tab => ({ tab, sort: 'volume' });

export const reducers = {
  marketSourcesLoading: s => mk(s, { sources: { ...IDLE, ...s.markets.sources, status: 'loading', message: null } }),
  marketSourcesLoaded: (s, { data, at } = {}) => mk(s, { sources: { status: 'ready', data, at, message: null } }),
  marketSourcesFailed: (s, { at, message = null } = {}) => mk(s, { sources: { ...IDLE, ...s.markets.sources, status: 'error', at, message } }),
  // the A shares: the cn watchlist as stored; their quotes by cn id (the Account's, host/markets.js merges them) and the state of
  // that read; China's state as the Account says it (its ranking's status, or a refused quote's), the only setter of the
  // providers; the prices a search's A-share hits carry, by cn id
  watchlistLoaded: (s, { items, error }) => mk(s, { watchlist: items, watchError: error }),
  quotesUpdated: (s, { quotes, connection }) => mk(s, { quotes, connection }),
  chinaStatusUpdated: (s, { status } = {}) => provided(s, 'china', status),
  // a local venue's state (Hong Kong, Korea, Taiwan, the indices; China's too), from its ranking or a refused quote
  localStatusUpdated: (s, { venue, status } = {}) => (LOCAL_VENUES.includes(venue) ? provided(s, venue, status) : s),
  hitQuotesLoaded: (s, { quotes } = {}) => mk(s, { hitQuotes: isRecord(quotes) ? quotes : {} }),

  // the explore reads by tab (market-view.js exploreQueryOf's, kept with the query asked), and the search's (explore?q=): a
  // failed read keeps its rows, with the Account's sentence when it refused (`message`, else null)
  exploreLoading: (s, { tab } = {}) => (EXPLORED.has(tab) ? keyed(s, 'explore', tab, { status: 'loading' }) : s),
  exploreLoaded: (s, { tab, data, at, query = null } = {}) => (EXPLORED.has(tab) ? keyed(s, 'explore', tab, { status: 'ready', data, at, message: null, query }) : s),
  // a failed read for the query kept keeps its rows; one for another query drops them, so no rows of other filters are drawn
  exploreFailed(s, { tab, at, message = null, query } = {}) {
    if (!EXPLORED.has(tab)) return s;
    const kept = own(s.markets.explore, tab);
    const other = typeof query === 'string' && own(kept, 'query') !== query;
    return keyed(s, 'explore', tab, { status: 'error', at, message, ...(other ? { data: null, query } : {}) });
  },
  // a region's own ranking — Stocks › China A, Hong Kong, Korea, Taiwan, Indices on Spot (explore?asset=…&form=spot&region=…, as
  // wire/local.js localRankOf keeps it) — by the sort and the query it was read for: a failed read keeps its rows; an answer for a
  // query other than the one last asked is dropped
  rankLoading: (s, { sort, query } = {}) => (RANKED.has(sort) ? rank(s, { status: 'loading', sort, ...asked(query) }) : s),
  rankLoaded: (s, { sort, data, at, query } = {}) => (RANKED.has(sort) && !overtaken(s, query) ? rank(s, { status: 'ready', sort, data, at, message: null }) : s),
  rankFailed: (s, { sort, at, message = null, query } = {}) => (RANKED.has(sort) && !overtaken(s, query) ? rank(s, { status: 'error', sort, at, message }) : s),
  resultsLoading: s => read(s, { status: 'loading' }),
  resultsLoaded: (s, { data, at } = {}) => read(s, { status: 'ready', data, at, message: null }),
  resultsFailed: (s, { at, message = null } = {}) => read(s, { status: 'error', at, message }),
  // A market fetched by exact key for a page or a star stays available when the browsing source changes.
  marketLocated: (s, { id, data, at = null } = {}) => (isAccountKey(id) ? keyed(s, 'located', id, { status: 'ready', data, at, message: null }) : s),

  // the quotes?pairs= answer's rows, by 'venue|symbol': a row with its market sets the pair's figures; a refused one leaves the
  // pair as it was, and so does one whose price is stamped before the price kept (the stream's fresher frame stays)
  accountQuotesLoaded(s, { quotes } = {}) {
    if (!Array.isArray(quotes)) return s;
    let next = null;
    for (const q of quotes) {
      if (!isRecord(q) || !named(q.venue) || !named(q.symbol) || q.refusal !== undefined || !isRecord(q.market)) continue;
      const m = q.market;
      const key = `${q.venue}|${q.symbol}`;
      const stamped = timeOf(m.quoteAt);
      const kept = timeOf(own(next ?? s.markets.accountQuotes, key)?.quoteAt);
      if (stamped !== null && kept !== null && stamped < kept) continue;
      next ??= { ...s.markets.accountQuotes };
      next[key] = {
        price: number(m.price), bid: number(m.bid), ask: number(m.ask), quoteAt: text(m.quoteAt), quoteFrom: text(m.quoteFrom),
        changePct24h: number(m.changePct24h), volumeUsd24h: number(m.volumeUsd24h), ...limitsOf(m),
      };
    }
    return next ? mk(s, { accountQuotes: next }) : s;
  },
  // a quote event on the Account's stream ({ data } as the stream hands it, for a market a page follows): its last trade, else
  // the middle of its bid and ask, stamped when that price was (`priceAt`, else the event's `at`), in its source's words, and
  // marked the stream's (`streamed`); the 24h figures stay the quotes poll's. A frame that says the hub has no quote yet leaves
  // the pair as it was.
  streamQuote(s, { data } = {}) {
    if (!isRecord(data) || !named(data.venue) || !named(data.symbol)) return s;
    const last = number(data.last), bid = number(data.bid), ask = number(data.ask);
    if (data.live === false && last === null && bid === null && ask === null) return s;
    const key = `${data.venue}|${data.symbol}`;
    const was = own(s.markets.accountQuotes, key);
    return mk(s, {
      accountQuotes: {
        ...s.markets.accountQuotes,
        [key]: {
          // its last trade, else the middle: the retired page's order (its ui/stream.js stPrice), but for a perpetual, middle first there
          price: last ?? (bid !== null && ask !== null ? (bid + ask) / 2 : null), bid, ask,
          quoteAt: text(data.priceAt) ?? text(data.at), quoteFrom: text(data.from),
          changePct24h: was?.changePct24h ?? null, volumeUsd24h: was?.volumeUsd24h ?? null, streamed: true, ...limitsOf(was),
        },
      },
    });
  },
  // the Account's snapshot on the stream (a reconnect past its ring, another run): market events are never resumed, so a price
  // the stream kept may be dead — the pairs it priced go, the quotes poll's stay, until the next poll or frame prices them again
  streamSnapshot(s) {
    const quotes = s.markets.accountQuotes;
    const kept = Object.entries(quotes).filter(([, q]) => q?.streamed !== true);
    return kept.length === Object.keys(quotes).length ? s : mk(s, { accountQuotes: Object.fromEntries(kept) });
  },

  // a market page's candles, by its key, each under the range it was read for — a failed read keeps the last candles, with the
  // Account's sentence when it refused (`message`, else null), until a read answers; and the compare rows, by base
  candlesLoading: (s, { id, range } = {}) => (charted(id, range) ? keyed(s, 'candles', id, { status: 'loading', range }) : s),
  candlesLoaded: (s, { id, range, data, at } = {}) => (charted(id, range) ? keyed(s, 'candles', id, { status: 'ready', data, at, range, message: null }) : s),
  candlesFailed: (s, { id, range, at, message = null } = {}) => (charted(id, range) ? keyed(s, 'candles', id, { status: 'error', at, range, message }) : s),
  // the range a page's chart is drawn at, one of the Account's: kept by the page's key, 1D until one is chosen
  // a stock page's event window (host/event-window.js), by `<id>@<at>`, read once: the market's answer as it came, or its words
  eventBarsLoading: (s, { key } = {}) => (named(key) ? keyed(s, 'event', key, { status: 'loading', message: null }) : s),
  eventBarsLoaded: (s, { key, data, at } = {}) => (named(key) ? keyed(s, 'event', key, { status: 'ready', data, at, message: null }) : s),
  eventBarsFailed: (s, { key, at, message = null } = {}) => (named(key) ? keyed(s, 'event', key, { status: 'error', at, message }) : s),
  setRange: (s, { id, range } = {}) => (charted(id, range) && own(s.markets.candles, id)?.range !== range ? keyed(s, 'candles', id, { range }) : s),
  compareLoading: (s, { base } = {}) => (named(base) ? keyed(s, 'compare', base, { status: 'loading' }) : s),
  compareLoaded: (s, { base, data, at } = {}) => (named(base) ? keyed(s, 'compare', base, { status: 'ready', data, at }) : s),
  compareFailed: (s, { base, at } = {}) => (named(base) ? keyed(s, 'compare', base, { status: 'error', at }) : s),

  // a market page's four reads beside its price (plan 4a Task 4), by its key, each part { status, data, at, message, freshAt }:
  // `here` the asset sheet, `book`, `trades`, and `funding` — a perpetual's, one read at every venue that lists it. A failed read keeps its last data, with the Account's sentence when it refused; an answer the proxy re-served stale keeps
  // the time of the last fresh one (`freshAt`, null when none landed); leaving the page drops them all
  depthLoading: (s, { id, part } = {}) => (depthed(id, part) ? depth(s, id, part, { status: 'loading' }) : s),
  depthLoaded(s, { id, part, data, at = null } = {}) {
    if (!depthed(id, part)) return s;
    const was = own(own(s.markets.depth, id), part);
    const freshAt = isRecord(data) && data.stale === true ? (was?.freshAt ?? null) : at;
    return depth(s, id, part, { status: 'ready', data, at, message: null, freshAt });
  },
  depthFailed: (s, { id, part, at = null, message = null } = {}) => (depthed(id, part) ? depth(s, id, part, { status: 'error', at, message }) : s),
  depthDropped(s, { id } = {}) {
    if (!Object.hasOwn(s.markets.depth, id)) return s;
    const { [id]: _gone, ...rest } = s.markets.depth;
    return mk(s, { depth: rest });
  },

  // the Account keys starred, as stored under their own key; and what each old us:/crypto: star was asked as and found — the
  // Account's key, or null for none — until it is taken off
  accountWatchLoaded: (s, { items, error = null } = {}) => mk(s, { watch: Array.isArray(items) ? items : [], watchError: error }),
  askedOfAccount: (s, { faceId, key } = {}) => (named(faceId) && (key === null || isAccountKey(key)) ? mk(s, { asked: { ...s.markets.asked, [faceId]: key } }) : s),
  forgetAsked(s, faceId) {
    if (!named(faceId) || !Object.hasOwn(s.markets.asked, faceId)) return s;
    const { [faceId]: _gone, ...asked } = s.markets.asked;
    return mk(s, { asked });
  },

  // Markets by underlying (spec 2026-11-19 G1–G6): a tab starts from Most traded, US, every Form, its main sources, no popover
  // open, and ends a search; a region pick goes back to the main sources (on China A to Spot alone); a Form the main sources
  // do not carry switches Source to All sources (G4); a Source whose sources do not carry the Form set clears it
  setMarketsTab(s, tab) {
    // the tab already open, no search: as it is, its filters kept
    if (!MARKET_TABS.includes(tab) || (tab === s.markets.tab && blank(s.markets.q))) return s;
    return mk(s, { ...onTab(tab), region: 'us', form: '', source: 'main', open: null, q: '', results: { ...IDLE } });
  },
  setMarketsRegion(s, id) {
    const m = s.markets;
    if (!['stocks', 'indices'].includes(m.tab) || !REGIONS[m.tab].includes(id)) return s;
    const next = { ...m, region: id, source: 'main', open: null };
    return mk(s, { region: id, source: 'main', open: null, form: formsInView(next).includes(m.form) ? m.form : '' });
  },
  setMarketsForm(s, id) {
    const m = s.markets;
    if (m.tab === 'watchlist' || (id !== '' && !formsInView(m).includes(id))) return s;
    let source = id !== '' && m.source === 'main' && !mainFormsOf(m).includes(id) ? 'all' : m.source;
    // a view on a region's own read has one fixed source: a family picked before does not wait to reappear
    if (onLocal({ ...m, form: id })) source = 'main';
    return mk(s, { form: id, source, open: null });
  },
  setMarketsSource(s, v) {
    const m = s.markets;
    if (m.tab === 'watchlist' || !isSourceOf(m, v)) return s;
    const form = m.form && !formsOfSource({ ...m, source: v }).includes(m.form) ? '' : m.form;
    return mk(s, { source: v, form, open: null });
  },
  // a filter's popover opened by its name, a second press (or null) closing it
  openMarketsFilter(s, name) {
    const open = ['region', 'form', 'source'].includes(name) && s.markets.open !== name ? name : null;
    return open === s.markets.open ? s : mk(s, { open });
  },
  // a chip removed: the Form back to all, the Source back to Main (with a Form the main sources do not carry)
  clearMarketsChip(s, kind) {
    if (kind === 'form') return s.markets.form ? mk(s, { form: '' }) : s;
    if (kind === 'source') return s.markets.source !== 'main' ? reducers.setMarketsSource(s, 'main') : s;
    return s;
  },
  // the empty table's button (§5.3): the main sources and every Form, the region kept (G2)
  marketsBackToMain: s => mk(s, { source: 'main', form: '', open: null }),
  // a sort by its id (the seg's data-value); its word is the renderer's
  setMarketsSort(s, v) {
    return ACCOUNT_SORT_IDS.includes(v) && v !== s.markets.sort ? mk(s, { sort: v }) : s;
  },
  // the query typed (G5): the tab and its filters stay as they are, for Back to <tab>; cleared, the search's read goes
  setMarketsQuery(s, q) {
    const v = String(q ?? '');
    const m = s.markets;
    if (v === m.q) return s;
    // a search closes a filter's popover (the filters are not drawn while it shows), so Back to <tab> finds it closed
    return blank(v) && !blank(m.q) ? mk(s, { q: v, results: { ...IDLE } }) : mk(s, blank(v) ? { q: v } : { q: v, open: null });
  },
};
