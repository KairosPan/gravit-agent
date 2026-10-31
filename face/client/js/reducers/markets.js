// face/client/js/reducers/markets.js — Markets on the face: what the host layer (host/markets.js) brings in — the Account's
// explore reads by tab and the search's, the quotes of the rows in view and of the market a page follows, a page's candles and
// its base's compare rows, the Account keys starred and what each old us:/crypto: star was found as; the face's own A-share wire
// as today — and the screen's own view of it: the tab, the sort, the query, a page's range
import { ACCOUNT_TABS, ACCOUNT_SORTS, CANDLE_RANGES, isAccountKey } from '../host/market-view.js';
import { number } from '../wire/market-model.js';

const mk = (s, patch) => ({ ...s, markets: { ...s.markets, ...patch } });
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => (isRecord(o) && Object.hasOwn(o, k) ? o[k] : undefined);
const IDLE = { status: 'idle', data: null, at: null };
// one of the Account's reads kept by key ({ [key]: { status, data, at } }): a failed read keeps its last data, as the Account
// slice's do
const keyed = (s, field, key, patch) => mk(s, { [field]: { ...s.markets[field], [key]: { ...IDLE, ...own(s.markets[field], key), ...patch } } });
const read = (s, patch) => mk(s, { results: { ...s.markets.results, ...patch } });
// the explore reads: All's and each kind's own; the tabs: those, Watching and All results
const EXPLORED = new Set(ACCOUNT_TABS.map(([id]) => id));
const TABS = new Set([...EXPLORED, 'china', 'watching', 'results']);
// a market's history: an Account key's or an A share's (cn:<code>), at one of the candle ranges
const charted = (id, range) => (isAccountKey(id) || /^cn:\d{6}$/.test(String(id))) && CANDLE_RANGES.includes(range);
// the China ranking's two sorts
const RANKED = new Set(['volume', 'movers']);
const rank = (s, patch) => mk(s, { rank: { ...s.markets.rank, ...patch } });
const named = v => typeof v === 'string' && v !== '';
const text = v => (typeof v === 'string' ? v : null);
// a price's stamp as a time, or null when it has none that parses
const timeOf = v => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
const blank = q => !String(q ?? '').trim();
// a tab starts from Most traded, as Linqi's does
const onTab = tab => ({ tab, sort: 'volume' });

export const reducers = {
  // the face's own wire, for the A shares: the cn watchlist as stored, the live quotes and the search without their notes (the
  // wire's Chinese prose never reaches the store), the hits' one REST read
  watchlistLoaded: (s, { items, error }) => mk(s, { watchlist: items, watchError: error }),
  quotesUpdated: (s, q) => mk(s, { quotes: q.quotes, providers: q.providers, connection: q.status }),
  searchUpdated: (s, r) => mk(s, { search: { query: r.query, status: r.status, assets: r.assets, partial: r.partial === true } }),
  hitQuotesLoaded: (s, { quotes }) => mk(s, { hitQuotes: Object.fromEntries((quotes ?? []).map(q => [q.id, q])) }),

  // the Account's explore reads by tab (`all` is explore?limit=200, a kind's its own explore?tab=<kind>&limit=200), and the
  // search's (explore?q=): a failed read keeps its rows, with the Account's sentence when it refused (`message`, else null)
  exploreLoading: (s, { tab } = {}) => (EXPLORED.has(tab) ? keyed(s, 'explore', tab, { status: 'loading' }) : s),
  exploreLoaded: (s, { tab, data, at } = {}) => (EXPLORED.has(tab) ? keyed(s, 'explore', tab, { status: 'ready', data, at, message: null }) : s),
  exploreFailed: (s, { tab, at, message = null } = {}) => (EXPLORED.has(tab) ? keyed(s, 'explore', tab, { status: 'error', at, message }) : s),
  // the China tab's ranking (/data/cn/rank), by the sort it was read for: a failed read keeps its rows
  rankLoading: (s, { sort } = {}) => (RANKED.has(sort) ? rank(s, { status: 'loading', sort }) : s),
  rankLoaded: (s, { sort, data, at } = {}) => (RANKED.has(sort) ? rank(s, { status: 'ready', sort, data, at, message: null }) : s),
  rankFailed: (s, { sort, at, message = null } = {}) => (RANKED.has(sort) ? rank(s, { status: 'error', sort, at, message }) : s),
  resultsLoading: s => read(s, { status: 'loading' }),
  resultsLoaded: (s, { data, at } = {}) => read(s, { status: 'ready', data, at, message: null }),
  resultsFailed: (s, { at, message = null } = {}) => read(s, { status: 'error', at, message }),

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
        changePct24h: number(m.changePct24h), volumeUsd24h: number(m.volumeUsd24h),
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
          // its last trade, else the middle: the Account's page's own order (its ui/stream.js stPrice), but for a perpetual, middle first there
          price: last ?? (bid !== null && ask !== null ? (bid + ask) / 2 : null), bid, ask,
          quoteAt: text(data.priceAt) ?? text(data.at), quoteFrom: text(data.from),
          changePct24h: was?.changePct24h ?? null, volumeUsd24h: was?.volumeUsd24h ?? null, streamed: true,
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
  setRange: (s, { id, range } = {}) => (charted(id, range) && own(s.markets.candles, id)?.range !== range ? keyed(s, 'candles', id, { range }) : s),
  compareLoading: (s, { base } = {}) => (named(base) ? keyed(s, 'compare', base, { status: 'loading' }) : s),
  compareLoaded: (s, { base, data, at } = {}) => (named(base) ? keyed(s, 'compare', base, { status: 'ready', data, at }) : s),
  compareFailed: (s, { base, at } = {}) => (named(base) ? keyed(s, 'compare', base, { status: 'error', at }) : s),

  // the Account keys starred, as stored under their own key; and what each old us:/crypto: star was asked as and found — the
  // Account's key, or null for none — until it is taken off
  accountWatchLoaded: (s, { items, error = null } = {}) => mk(s, { watch: Array.isArray(items) ? items : [], watchError: error }),
  askedOfAccount: (s, { faceId, key } = {}) => (named(faceId) && (key === null || isAccountKey(key)) ? mk(s, { asked: { ...s.markets.asked, [faceId]: key } }) : s),
  forgetAsked(s, faceId) {
    if (!named(faceId) || !Object.hasOwn(s.markets.asked, faceId)) return s;
    const { [faceId]: _gone, ...asked } = s.markets.asked;
    return mk(s, { asked });
  },

  // the Account's tabs, Watching and All results; a tab starts from Most traded
  setMarketsTab: (s, tab) => (TABS.has(tab) && tab !== s.markets.tab ? mk(s, onTab(tab)) : s),
  // the seg hands its label, a test or a link the id
  setMarketsSort(s, v) {
    const hit = ACCOUNT_SORTS.find(x => x.id === v || x.label === v);
    return hit && hit.id !== s.markets.sort ? mk(s, { sort: hit.id }) : s;
  },
  // a query typed from nothing opens All results; cleared there, it goes back to All; cleared anywhere, the search's read goes
  setMarketsQuery(s, q) {
    const v = String(q ?? '');
    const m = s.markets;
    if (v === m.q) return s;
    const was = !blank(m.q);
    const is = !blank(v);
    if (is && !was) return mk(s, { q: v, ...(m.tab === 'results' ? {} : onTab('results')) });
    if (was && !is) return mk(s, { q: v, results: { ...IDLE }, ...(m.tab === 'results' ? onTab('all') : {}) });
    return mk(s, { q: v });
  },
};
