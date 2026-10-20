// face/client/js/reducers/markets.js — Markets on the face: what the host layer (host/markets.js) brings in, and the
// screen's own view of it — the tab, the sort, the query
import { MARKET_TABS, MARKET_SORTS } from '../host/market-view.js';

const mk = (s, patch) => ({ ...s, markets: { ...s.markets, ...patch } });

export const reducers = {
  // the host's markets: the watchlist as stored, the live quotes and the search without their notes (the wire's Chinese
  // prose never reaches the store), the hits' one REST read, each page's bars
  watchlistLoaded: (s, { items, error }) => mk(s, { watchlist: items, watchError: error }),
  quotesUpdated: (s, q) => mk(s, { quotes: q.quotes, providers: q.providers, connection: q.status }),
  searchUpdated: (s, r) => mk(s, { search: { query: r.query, status: r.status, assets: r.assets, partial: r.partial === true } }),
  hitQuotesLoaded: (s, { quotes }) => mk(s, { hitQuotes: Object.fromEntries((quotes ?? []).map(q => [q.id, q])) }),
  // a reload keeps the chart it had until the new rows land
  barsLoading: (s, { id }) => mk(s, { bars: { ...s.markets.bars, [id]: { status: 'loading', ...(s.markets.bars[id]?.payload ? { payload: s.markets.bars[id].payload } : {}) } } }),
  barsLoaded: (s, { id, payload }) => mk(s, { bars: { ...s.markets.bars, [id]: { status: 'ready', payload } } }),
  barsFailed: (s, { id }) => mk(s, { bars: { ...s.markets.bars, [id]: { status: 'failed' } } }),

  // a tab starts from Most traded, as Linqi's does
  setMarketsTab: (s, tab) => (MARKET_TABS.some(t => t.id === tab) && tab !== s.markets.tab ? mk(s, { tab, sort: 'volume' }) : s),
  // the seg hands its label, a test or a link the id
  setMarketsSort(s, v) {
    const hit = MARKET_SORTS.find(x => x.id === v || x.label === v);
    return hit && hit.id !== s.markets.sort ? mk(s, { sort: hit.id }) : s;
  },
  setMarketsQuery(s, q) {
    const v = String(q ?? '');
    return v === s.markets.q ? s : mk(s, { q: v });
  },
};
