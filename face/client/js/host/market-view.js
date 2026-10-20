// face/client/js/host/market-view.js — the Markets screen's pure view (spec 2026-10-19 §7 Stage 2): face ids, the rows,
// tabs and sorts, and every word in English from the wire's enums. The wire's own text (a quote's message, a provider's
// message, a search note, a source name) is Chinese and never reaches a word here. No DOM.
import { normalizeAsset, number } from '../wire/market-model.js';

export const MARKET_TABS = [{ id: 'all', label: 'All' }, { id: 'crypto', label: 'Crypto' }, { id: 'stocks', label: 'Stocks' }];
export const MARKET_SORTS = [{ id: 'volume', label: 'Most traded' }, { id: 'movers', label: 'Biggest moves' }];

const TAB_MARKETS = { all: null, crypto: ['crypto'], stocks: ['us', 'cn'] };
const PROVIDERS = { alpaca: 'Alpaca', coinbase: 'Coinbase', ifind: 'iFinD' };
const MARKET_PROVIDER = { us: 'Alpaca', crypto: 'Coinbase', cn: 'iFinD' };
const PROVIDER_STATUS = { connecting: 'Connecting', connected: 'Connected', unconfigured: 'Not configured', error: 'Error', limited: 'Limited' };
const FEEDS = { iex: 'IEX', sip: 'SIP', delayed_sip: 'SIP, delayed' };
const QUOTE_STATUS = { live: 'Live', delayed: 'Delayed', stale: 'Stale' };
const CONNECTION = { connecting: 'Connecting…', polling: 'Updating every 15 s', paused: 'Paused', error: 'Quotes unavailable' };
const WATCH = { read: "Couldn't read the saved watchlist", unsaved: "Couldn't save the watchlist", full: 'The watchlist is full' };

/** A face instrument id in canonical form (`us:aapl` → `us:AAPL`, `crypto:btc-usd` → `crypto:BTC/USD`), or null. */
export function canonicalId(raw) {
  return normalizeAsset({ id: typeof raw === 'string' ? raw : '' })?.id ?? null;
}

const CRYPTO_POSITION = /^([A-Z0-9]{1,15})\/?USD$/;

/** A position's face id: a stock by its symbol, a coin (BTCUSD or BTC/USD) as its USD pair, anything else null. */
export function positionId(position) {
  const symbol = typeof position?.symbol === 'string' ? position.symbol.trim().toUpperCase() : '';
  if (position?.asset_class === 'us_equity') return canonicalId(`us:${symbol}`);
  if (position?.asset_class === 'crypto') {
    const base = CRYPTO_POSITION.exec(symbol)?.[1];
    return base ? canonicalId(`crypto:${base}/USD`) : null;
  }
  return null;
}

/** The account's positions as face assets: stocks by symbol, coins as their USD pair; anything else is dropped. */
export function holdingAssets(accountData) {
  const positions = accountData?.available && Array.isArray(accountData.positions) ? accountData.positions : [];
  const seen = new Set();
  const out = [];
  for (const position of positions) {
    const id = positionId(position);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const asset = normalizeAsset({ id, exchange: position.asset_class === 'us_equity' ? position.exchange : '' });
    if (asset) out.push(asset);
  }
  return out;
}

const blank = q => typeof q !== 'string' || !q.trim();

/** The list the screen shows: the watchlist then the holdings not on it, or, while there is a query, the search's hits. */
export function listAssets(markets, accountData) {
  if (!blank(markets?.q)) return Array.isArray(markets?.search?.assets) ? markets.search.assets : [];
  const watchlist = Array.isArray(markets?.watchlist) ? markets.watchlist : [];
  const ids = new Set(watchlist.map(a => a.id));
  return [...watchlist, ...holdingAssets(accountData).filter(a => !ids.has(a.id))];
}

function sortKey(sort, quote) {
  if (sort === 'movers') { const c = number(quote?.change_pct); return c === null ? null : Math.abs(c); }
  return number(quote?.volume);
}

/** The rows: the list on the current tab, each with its quote, sorted with nulls last and list order on ties. */
export function marketRows(markets, accountData) {
  const searching = !blank(markets?.q);
  const quotes = markets?.quotes ?? {};
  const hits = markets?.hitQuotes ?? {};
  const watched = new Set((markets?.watchlist ?? []).map(a => a.id));
  const held = new Set(holdingAssets(accountData).map(a => a.id));
  const only = TAB_MARKETS[markets?.tab] ?? null;
  const rows = listAssets(markets, accountData)
    .filter(asset => !only || only.includes(asset.market))
    .map(asset => ({
      asset,
      // A watched hit already streams; any other hit has the one REST read the search made.
      quote: quotes[asset.id] ?? (searching ? hits[asset.id] : undefined),
      watched: watched.has(asset.id),
      held: held.has(asset.id),
    }));
  const keyed = rows.map((row, index) => ({ row, index, key: sortKey(markets?.sort, row.quote) }));
  keyed.sort((a, b) => (a.key === null) - (b.key === null) || (b.key ?? 0) - (a.key ?? 0) || a.index - b.index);
  return keyed.map(k => k.row);
}

/** The asset for a page: the one the screen already knows (watchlist, holdings, hits), else one built from the id. */
export function assetFor(markets, accountData, id) {
  const canonical = canonicalId(id);
  if (!canonical) return null;
  const known = [...(markets?.watchlist ?? []), ...holdingAssets(accountData), ...(markets?.search?.assets ?? [])]
    .find(a => a?.id === canonical);
  return known ?? normalizeAsset({ id: canonical });
}

/** The quote's state in a word or two: Live, Delayed, Stale or No quote, and Closed when the market is. */
export function quoteWord(quote) {
  if (!quote || number(quote.price) === null || !QUOTE_STATUS[quote.quote_status]) return 'No quote';
  return QUOTE_STATUS[quote.quote_status] + (quote.market_status === 'closed' ? ' · Closed' : '');
}

/** The live quotes' connection, only when it is not simply streaming. */
export function connectionWord(status) {
  return CONNECTION[status] ?? '';
}

export function providerWord(provider) {
  const status = PROVIDER_STATUS[provider?.status];
  return `${PROVIDERS[provider?.id] ?? 'Quotes'}${status ? ` · ${status}` : ''}`;
}

export function basisWord(quote) {
  return quote?.basis === '24h' ? '24h' : 'vs previous close';
}

/** Where a quote comes from, named by its market's provider (the wire's source name is not English for every market). */
export function sourceWord(quote) {
  const provider = MARKET_PROVIDER[quote?.market] ?? 'Quotes';
  const feed = FEEDS[quote?.feed];
  return feed ? `${provider} · ${feed}` : provider;
}

const UNITS = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']];

function compact(value) {
  const abs = Math.abs(value);
  // 0.99995 of a unit already rounds to 1.0 of it: 999,960 reads 1M, not 1000k.
  for (const [size, unit] of UNITS) if (abs >= size * 0.99995) return `${Number((value / size).toFixed(1))}${unit}`;
  return String(Number(value.toPrecision(3)));
}

/** Volume in a compact number and its unit: shares for a stock, the base for a coin, — when the wire has none. */
export function volumeWord(asset, quote) {
  const volume = number(quote?.volume);
  if (volume === null) return '—';
  const unit = asset?.market === 'crypto' ? String(asset.symbol).split('/')[0] : 'shares';
  return `${compact(volume)} ${unit}`;
}

export function searchWord(search) {
  if (!search || blank(search.query)) return '';
  if (search.status === 'loading') return 'Searching…';
  if (search.status === 'error') return 'Search is unavailable';
  if (search.status !== 'success') return '';
  if (!search.assets?.length) return `Nothing matches “${search.query.trim()}”`;
  return search.partial ? 'Some results may be missing' : '';
}

export function watchWord(error) {
  return WATCH[error] ?? '';
}

/** The chart's source line: live Alpaca bars by feed, or the PIT bed with its as-of day; stale when served from cache after a failure. */
export function barsWord(payload) {
  if (!payload || typeof payload !== 'object') return '';
  let word;
  if (payload.source === 'alpaca') word = `Daily · Alpaca${FEEDS[payload.feed] ? ` ${FEEDS[payload.feed]}` : ''}`;
  else if (payload.source === 'bed') word = `Daily · PIT bed${typeof payload.as_of === 'string' ? ` · as of ${payload.as_of}` : ''}`;
  else return '';
  return payload.stale ? `${word} · stale` : word;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Conversations whose title names the asset (a coin by its base) as a whole word, case-sensitive, in list order. */
export function mentionsOf(conversations, asset) {
  if (!Array.isArray(conversations) || !asset?.symbol) return [];
  const token = asset.market === 'crypto' ? String(asset.symbol).split('/')[0] : String(asset.symbol);
  const word = new RegExp(`(?<![A-Za-z0-9])${escapeRe(token)}(?![A-Za-z0-9])`);
  return conversations.filter(c => typeof c?.title === 'string' && word.test(c.title));
}
