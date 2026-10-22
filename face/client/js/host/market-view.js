// face/client/js/host/market-view.js — the Markets screen's pure view. The Account's markets (spec 2026-10-22 §6.1): its explore
// reads — All's, and a tab's own — as the table's rows: the tabs, the prices by kind (an event in cents, Kalshi's volume in
// contracts, a pre-IPO perpetual's implied valuation), where each price is from in the Account's own words with its age, the
// lines across venues with the best marked — beside the face's own A-share (cn:) rows, and a market's page with what is held,
// working and stated for it. No image URL the Account names (`icon`) is in anything returned here: the face's page never loads
// a third party's image. And the face's own ids, rows, tabs and sorts (spec 2026-10-19 §7 Stage 2), every word in English from
// the wire's enums. The wire's own text (a quote's message, a provider's message, a search note, a source name) is Chinese and
// never reaches a word here. The face's list views over its own us:/crypto: quotes stay until their callers go. No DOM.
import { normalizeAsset, number } from '../wire/market-model.js';
import { MIN, HOUR, DAY } from '../time.js';
import { assetsOf, positionsOf, openOrdersOf, statementLinesOf, worthOf } from './account-view.js';

export const MARKET_TABS = [{ id: 'all', label: 'All' }, { id: 'crypto', label: 'Crypto' }, { id: 'stocks', label: 'Stocks' }];
export const MARKET_SORTS = [{ id: 'volume', label: 'Most traded' }, { id: 'movers', label: 'Biggest moves' }];

// the Account's tabs, in the order the table draws them, and the sorts its rows take
export const ACCOUNT_TABS = [['all', 'All'], ['crypto', 'Crypto'], ['stocks', 'Stocks'], ['rwas', 'RWAs'], ['perps', 'Perps'], ['preipo', 'Pre-IPO'], ['predictions', 'Predictions']];
export const ACCOUNT_SORTS = [{ id: 'volume', label: 'Most traded' }, { id: 'movers', label: 'Biggest moves' }, { id: 'closing', label: 'Closing soonest' }];

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

// Most traded ranks by dollar volume (price × volume), so a coin's units and a stock's shares compare; Biggest moves by
// the size of the move
function sortKey(sort, quote) {
  if (sort === 'movers') { const c = number(quote?.change_pct); return c === null ? null : Math.abs(c); }
  const price = number(quote?.price);
  const volume = number(quote?.volume);
  return price === null || volume === null ? null : price * volume;
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

/** The quote's state in a word or two: Live, Delayed, Stale or No quote, and Closed when the market is; with no price
 * from a market whose provider is not configured (no Alpaca keys, no iFinD token), Not configured. */
export function quoteWord(quote, providers = [], market = quote?.market) {
  if (!quote || number(quote.price) === null || !QUOTE_STATUS[quote.quote_status]) {
    const provider = (Array.isArray(providers) ? providers : []).find(p => p?.market === market);
    return provider?.status === 'unconfigured' ? 'Not configured' : 'No quote';
  }
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

// ── The Account's markets (spec 2026-10-22 §6.1): its explore reads as the table's rows, and a market's page ──

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
// a list as the Account or the store sends it, an entry that is not an object left out
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = v => (typeof v === 'string' ? v : '');
// a record's own entry, never one it inherits
const own = (o, k) => (isRecord(o) && typeof k === 'string' && Object.hasOwn(o, k) ? o[k] : undefined);
// an explore answer's items: only an answer (`ok: true`) carries any
const readable = body => body?.ok === true && Array.isArray(body.items);
const itemsOf = body => (readable(body) ? records(body.items) : []);
// every row an answer carries — its items, then the lists beside them (movers, closing, most traded) — to find a market by key
const everyRow = body => (body?.ok === true ? [body.items, body.movers, body.closing, body.mostTraded].flatMap(records) : []);
// a tab's explore read as the store keeps it: the slice's `explore` is its reads by tab (`all`, and a kind's own)
const bodyOf = (reads, tab) => own(own(reads, tab), 'data');

// an image URL the Account names (`icon`) anywhere under a value
function hasIcon(v) {
  if (Array.isArray(v)) return v.some(hasIcon);
  if (!isRecord(v)) return false;
  for (const k of Object.keys(v)) if (k === 'icon' || hasIcon(v[k])) return true;
  return false;
}
// the value without them: itself where it names none (nothing is copied), else a copy — the store's own value keeps them
const noIcon = v => (!hasIcon(v) ? v : Array.isArray(v) ? v.map(noIcon)
  : Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'icon').map(([k, x]) => [k, noIcon(x)])));

/** True for the Account's own row keys — `coin:BTC`, `stock:AAPL`, `perp:ETH`, `rwa:NVDA`, `kalshi:…`, `pm:…`, `pmus:…`, an
 *  event at any other venue (`event:<venue>:<market>`) and a pre-IPO perpetual (`preipo:<company>`) — never a face id (`cn:`,
 *  `us:`, `crypto:`). */
export function isAccountKey(id) {
  return typeof id === 'string' && /^(coin|stock|perp|rwa|event|preipo|kalshi|pm|pmus):/.test(id);
}

/** The table's tabs from All's explore answer: All first, with the Account's count and the cn rows', then the Account's tabs that
 *  have something in them, in ACCOUNT_TABS's order and words; Stocks counts the cn rows too, and is drawn for them alone. An
 *  answer not read, or one that is not an answer, is All, and Stocks for the cn rows. As the Account's page orders them, All
 *  results leads while `searching` and Watching closes the row while `watching` (anything is starred), neither with a count. */
export function tabsOf(explore, cnCount, opts) {
  const cn = Math.max(0, number(cnCount) ?? 0);
  const counts = new Map();
  if (explore?.ok === true && Array.isArray(explore.tabs)) {
    for (const t of records(explore.tabs)) if (typeof t.id === 'string' && !counts.has(t.id)) counts.set(t.id, Math.max(0, number(t.count) ?? 0));
  }
  const out = [];
  for (const [id, label] of ACCOUNT_TABS) {
    const count = (counts.get(id) ?? 0) + (id === 'all' || id === 'stocks' ? cn : 0);
    if (id === 'all' || count > 0) out.push({ id, label, count });
  }
  return [
    ...(opts?.searching ? [{ id: 'results', label: 'All results', count: null }] : []),
    ...out,
    ...(opts?.watching ? [{ id: 'watching', label: 'Watching', count: null }] : []),
  ];
}

// dollars per contract as cents, without the float's noise (0.14 × 100 is 14, not 14.000000000000002)
const cents = v => { const n = number(v); return n === null ? null : Number((n * 100).toPrecision(12)); };

/** A row's figures by kind, as the Account's page draws them: an event's price and 24h change are dollars per contract, in
 *  cents here, with no percent; Kalshi counts its volume in contracts (`contracts24h`), never dollars; anything else is in
 *  dollars, with its 24h percent (the Account's: 2.3 is 2.3 %); a pre-IPO perpetual carries the venue's implied valuation
 *  (`implied.usd`) beside the contract's price. A figure the Account does not give, or one that does not parse, is null. */
export function priceOf(item) {
  const it = isRecord(item) ? item : {};
  const event = it.kind === 'event';
  const contracts = str(it.key).startsWith('kalshi:');
  return {
    price: event ? cents(it.price) : number(it.price),
    unit: event ? 'cents' : 'usd',
    changePct: event ? null : number(it.changePct24h),
    change24h: event ? cents(it.change24h) : number(it.change24h),
    volume: contracts ? number(it.contracts24h) : number(it.volumeUsd24h),
    volumeUnit: contracts ? 'contracts' : 'usd',
    implied: isRecord(it.implied) ? number(it.implied.usd) : null,
  };
}

const FRESH_MS = 5_000;   // the Account's own: a price a few seconds old is said as now

// how old a price is once it is past FRESH_MS: `12 s ago`, `3 min ago`, `2 h ago`, `yesterday`, `3 days ago`; nothing while it
// is fresh, for a stamp that does not parse, or for one ahead of the clock
function ageWords(at, now) {
  const t = typeof at === 'string' ? Date.parse(at) : NaN;
  const ms = Number.isFinite(t) && Number.isFinite(now) ? now - t : NaN;
  if (!(ms > FRESH_MS)) return '';
  if (ms < MIN) return `${Math.floor(ms / 1000)} s ago`;
  if (ms < HOUR) return `${Math.floor(ms / MIN)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  return ms < 2 * DAY ? 'yesterday' : `${Math.floor(ms / DAY)} days ago`;
}

// a source's words, with the price's age once it is past FRESH_MS
const said = (from, at, now) => { const age = ageWords(at, now); return age ? `${from} · ${age}` : from; };

/** Where a row's price is from, in the Account's own words: the row's `quoteFrom` (`Robinhood · real time`, `Cboe · 15 min
 *  delayed`), else the venue its 24h change is from (`changeFrom`); else the first venue the owner connected that lists it —
 *  that line's `quoteFrom`, else its name; else nothing — never a public listing's line for itself. With the price's age
 *  (`· 2 min ago`) once its `quoteAt` — the row's, else that line's — is more than five seconds old. */
export function sourceWordOf(item, now = Date.now()) {
  const it = isRecord(item) ? item : {};
  const stamp = typeof it.quoteAt === 'string' ? it.quoteAt : undefined;
  const rowWord = str(it.quoteFrom).trim() || (isRecord(it.changeFrom) ? str(it.changeFrom.venueName).trim() : '');
  if (rowWord) return said(rowWord, stamp, now);
  const line = records(it.at).find(l => l.connected === true);
  const lineWord = line ? str(line.quoteFrom).trim() || str(line.venueName).trim() : '';
  return lineWord ? said(lineWord, stamp ?? line.quoteAt, now) : '';
}

/** A row's lines across venues: the ones the owner connected first, then the public listings, each in the Account's order (the
 *  most traded first) — with its price, bid and ask, the paper flag, whether it can trade (`'unknown'` where the Account says
 *  so), and for a public line the venue to connect (`connectTo`) and the connector that does. An event's are its lead
 *  outcome's (the others are in its `outcomes`). `best` marks, among the lines that take an order now — connected, a key that
 *  trades (`canTrade: true`), a market not closed — the one with the lowest ask, or the lowest price where none says an ask:
 *  one line at most, the first on a tie, and none when no line takes an order. */
export function legsOf(item) {
  const at = records(isRecord(item) ? item.at : null);
  const ordered = [...at.filter(l => l.connected === true), ...at.filter(l => l.connected !== true)];
  const legs = ordered.map(l => ({
    venue: str(l.venue), venueName: str(l.venueName), symbol: str(l.symbol),
    connected: l.connected === true, paper: l.paper === true,
    canTrade: l.canTrade === true ? true : l.canTrade === 'unknown' ? 'unknown' : false,
    public: l.public === true, connectTo: str(l.connectTo), connector: str(l.connector),
    price: number(l.price), bid: number(l.bid), ask: number(l.ask), best: false,
  }));
  const takes = legs.filter((l, i) => l.connected && l.canTrade === true && ordered[i].open !== false);
  const by = takes.some(l => l.ask !== null) ? 'ask' : 'price';
  let best = null;
  for (const l of takes) if (l[by] !== null && (best === null || l[by] < best[by])) best = l;
  if (best) best.best = true;
  return legs;
}

// a line that names its market: a venue and a symbol
const named = l => str(l.venue) !== '' && str(l.symbol) !== '';
const pairAt = l => (l ? `${l.venue}|${l.symbol}` : null);
// the market /quotes names a row by: its most traded connected line (the first), `venue|symbol`; null with none
const pairOf = legs => pairAt(legs.find(l => l.connected && named(l)));
/** The line a market's page follows on the Account's stream (host/markets.js): its first connected line, else its first public
 *  listing — a legsOf line, or null. */
export const followOf = item => { const legs = legsOf(item); return legs.find(l => l.connected && named(l)) ?? legs.find(l => l.public && named(l)) ?? null; };
const unpriced = () => ({ price: null, unit: 'usd', changePct: null, change24h: null, volume: null, volumeUnit: 'usd', implied: null });
const KIND_TABS = new Set(ACCOUNT_TABS.map(([id]) => id).filter(id => id !== 'all'));
// a contract on a venue's estimate of a private company's valuation: its implied valuation, or its tab, says so
const isPreipo = item => isRecord(item.implied) || (Array.isArray(item.tabs) && item.tabs.includes('preipo'));

// a row's second line: a pre-IPO perpetual's kind, another perpetual's base, an event's category, a coin's base, a stock's or an
// RWA's venue — the first the owner connected, else the first public listing
function subOf(item, legs) {
  const base = str(item.base);
  switch (item.kind) {
    case 'perp': return isPreipo(item) ? 'Pre-IPO · Perpetual' : base ? `${base} · Perpetual` : 'Perpetual';
    case 'event': return str(item.category);
    case 'coin': return base;
    case 'stock': case 'rwa': return (legs.find(l => l.connected) ?? legs.find(l => l.public))?.venueName ?? '';
    default: return '';
  }
}

// where a row's price is from: the live quote's own source and stamp where it names one, else the item's
const wordOf = (item, live, now) => { const from = str(live?.quoteFrom).trim(); return from ? said(from, live.quoteAt, now) : sourceWordOf(item, now); };

function accountRow(item, quotes, watched, now) {
  const legs = legsOf(item);
  const pair = pairOf(legs);
  const quote = pair ? own(quotes, pair) : undefined;
  const live = isRecord(quote) ? noIcon(quote) : null;
  return {
    id: str(item.key), source: 'account', kind: str(item.kind), name: str(item.name), sub: subOf(item, legs),
    priced: priceOf(item), live, sourceWord: wordOf(item, live, now),
    closeTime: str(item.closeTime) || null, pastEnd: item.pastEnd === true, watched, legs,
    tabs: Array.isArray(item.tabs) ? item.tabs.filter(t => typeof t === 'string') : [],
  };
}

// a starred market no read lists (a quiet one, or one its venue no longer lists): enough of a row to see its star and take it off
function placeholderRow(key) {
  const head = key.indexOf(':');
  return {
    id: key, source: 'account', placeholder: true, kind: head > 0 ? key.slice(0, head) : '', name: key.slice(key.lastIndexOf(':') + 1),
    sub: 'Not in this read', priced: unpriced(), live: null, sourceWord: '', closeTime: null, pastEnd: false, watched: true, legs: [],
    tabs: ['all', 'watching'],
  };
}

// a cn row, quoted by the face's own wire (the iFinD provider): its stream's quote, else the one its search read; its price in its
// currency, its volume in shares
function cnRow(asset, markets, watched) {
  const quote = own(markets.quotes, asset.id) ?? own(markets.hitQuotes, asset.id) ?? null;
  return {
    id: asset.id, source: 'face', asset, quote, kind: 'stock', name: asset.name || asset.symbol, sub: asset.exchange || '',
    priced: {
      price: number(quote?.price), unit: asset.currency === 'CNY' ? 'cny' : 'usd', changePct: number(quote?.change_pct), change24h: null,
      volume: number(quote?.volume), volumeUnit: 'shares', implied: null,
    },
    live: null, sourceWord: sourceWord(quote ?? { market: 'cn' }), closeTime: null, pastEnd: false, watched, legs: [], tabs: ['all', 'stocks'],
  };
}

// an old us:/crypto: star the Account could not find: listed once, under its own muted line
function notListedRow(asset) {
  const coin = asset.market === 'crypto';
  return {
    id: asset.id, source: 'face', notListed: true, kind: coin ? 'coin' : 'stock', name: asset.name || asset.symbol,
    sub: 'Not listed at the Account', priced: unpriced(), live: null, sourceWord: '', closeTime: null, pastEnd: false,
    watched: true, legs: [], tabs: ['all', coin ? 'crypto' : 'stocks'],
  };
}

// what a face row's price and volume traded: price × volume (a cn stock's yuan)
const turnover = p => (p.price !== null && p.volume !== null ? p.price * p.volume : null);
// Most traded: the Account's rows by their volume as its unit counts it (a Kalshi row's contracts as their number), then the
// face's — a different unit, a cn stock's shares — by turnover; Biggest moves by the size of the 24h move (an event's in cents,
// anything else's percent), the largest first; Closing soonest by the close, the soonest first. A row without the figure is last
// (under Most traded, last of its side), and a tie keeps the list's order.
const SORTS = {
  volume: { dir: -1, side: r => (r.source === 'account' ? 0 : 1), key: r => (r.source === 'account' ? r.priced.volume : turnover(r.priced)) },
  movers: { dir: -1, side: () => 0, key: r => { const v = r.kind === 'event' ? r.priced.change24h : r.priced.changePct; return v === null ? null : Math.abs(v); } },
  closing: { dir: 1, side: () => 0, key: r => { const t = r.closeTime ? Date.parse(r.closeTime) : NaN; return Number.isFinite(t) ? t : null; } },
};

function sorted(rows, sort) {
  const { dir, side, key } = typeof sort === 'string' && Object.hasOwn(SORTS, sort) ? SORTS[sort] : SORTS.volume;
  return rows.map((row, index) => ({ row, index, s: side(row), k: key(row) }))
    .sort((a, b) => a.s - b.s || (a.k === null) - (b.k === null) || (a.k === null ? 0 : dir * (a.k - b.k)) || a.index - b.index)
    .map(x => x.row);
}

/** The table's rows for the slice's tab, query and sort, on the renderer's clock (`now`, for the ages beside the source words).
 *  The Account's rows are `source: 'account'`, each with its figures by kind, the latest quote at its most traded connected
 *  venue (`live`, which leads the item's price where there is one), where its price is from and its lines: a tab's rows are its
 *  own explore read's (`explore[tab]`) once that has answered, else All's (`explore.all`), of the tab's kind; while there is a
 *  query, the search's (`results`) once it has answered. Beside them the face's: the cn watchlist (starred by being on it), or
 *  while searching the cn hits alone; and an old us:/crypto: star — one not asked of the Account yet draws nothing, one it found
 *  stars the Account's row, one it could not find is listed once, Not listed at the Account. All is every row, a kind's tab the
 *  rows whose tabs name it, All results (`results`) the search's own. Watching is every star, found in any list of its tab's
 *  read or All's (items, movers, closing, most traded), else a placeholder that can still be un-starred; a query typed on
 *  Watching searches every market, as the Account's page does. Sorted Most traded, Biggest moves or Closing soonest. */
export function rowsOf(markets, now = Date.now()) {
  const m = isRecord(markets) ? markets : {};
  const searching = !blank(m.q);
  const tab = searching && m.tab === 'watching' ? 'results' : m.tab;
  const reads = isRecord(m.explore) ? m.explore : {};
  const all = bodyOf(reads, 'all');
  const watchlist = records(m.watchlist).map(a => normalizeAsset(a)).filter(Boolean);
  const cn = watchlist.filter(a => a.market === 'cn');
  const old = watchlist.filter(a => a.market !== 'cn');
  // the Account's keys starred: the operator's own, then each an old star was found as
  const starred = [...new Set([...(Array.isArray(m.watch) ? m.watch : []), ...old.map(a => own(m.asked, a.id))].filter(k => typeof k === 'string' && k !== ''))];
  const isStarred = new Set(starred);
  const quotes = isRecord(m.accountQuotes) ? m.accountQuotes : {};
  const row = item => accountRow(item, quotes, isStarred.has(str(item.key)), now);
  const face = () => [...cn.map(a => cnRow(a, m, true)), ...old.filter(a => own(m.asked, a.id) === null).map(notListedRow)];
  const fromResults = searching && readable(m.results?.data);
  const listed = new Set(cn.map(a => a.id));
  const hits = searching ? records(m.search?.assets).map(a => normalizeAsset(a)).filter(a => a?.market === 'cn').map(a => cnRow(a, m, listed.has(a.id))) : [];
  let rows;
  if (tab === 'watching') {
    const lists = [...everyRow(bodyOf(reads, 'watching')), ...everyRow(all)];
    rows = [...starred.map(key => { const item = lists.find(i => i.key === key); return item ? row(item) : placeholderRow(key); }), ...face()];
  } else if (tab === 'results') {
    rows = searching ? [...(fromResults ? itemsOf(m.results.data).map(row) : []), ...hits] : [];
  } else {
    const tabBody = bodyOf(reads, tab);
    const body = fromResults ? m.results.data : readable(tabBody) ? tabBody : all;
    rows = [...itemsOf(body).map(row), ...(searching ? hits : face())];
    if (KIND_TABS.has(tab)) rows = rows.filter(r => r.tabs.includes(tab));
  }
  return sorted(rows, m.sort);
}

/** What an old face star asks the Account (`explore?q=<q>`), and the kind a hit must be: `us:AAPL` a stock by its symbol,
 *  `crypto:BTC/USD` a coin by its base; a cn id, or anything that is not a face id, asks nothing. */
export function matchKey(faceId) {
  const asset = normalizeAsset({ id: typeof faceId === 'string' ? faceId : '' });
  if (asset?.market === 'us') return { q: asset.symbol, kind: 'stock' };
  if (asset?.market === 'crypto') return { q: asset.symbol.split('/')[0], kind: 'coin' };
  return null;
}

/** The markets /quotes is asked for: the first `limit` rows' most traded connected line, `venue|symbol`; a row with none (a cn
 *  row, a public listing alone) is skipped. */
export function pairsOf(rows, limit = 12) {
  const n = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 12;
  return records(rows).slice(0, n).map(r => pairOf(records(r.legs))).filter(Boolean);
}

// a statement line names a market when its description carries the token as a word, case-sensitive (`BTC` in `Buy 0.001 BTC`,
// not in `cbBTC`; `SI-FEDCUT-DEC:YES` whole)
const names = (text, token) => token !== '' && new RegExp(`(?<![A-Za-z0-9])${escapeRe(token)}(?![A-Za-z0-9])`).test(text);

/** A market's page from the Account's reads, on the renderer's clock, or null for an id none lists. The item, without its icons,
 *  is looked for in every list (items, movers, closing, most traded) of the current tab's read, All's and the search's. Its
 *  lines and its figures by kind; the latest quote at the line the page follows (host/markets.js: its first connected line,
 *  else its first public listing) and where its price is from; the chart's candles for the range chosen (1D until one is),
 *  once the read answered; the compare rows for its base. What is held of it — the leading lens's assets of its base (the paper
 *  lens's when paper leads the Portfolio, else the real) and the positions, real and paper, at any of its lines (an event's:
 *  every outcome's) — its open orders there, and the statement's lines that name its base or one of those lines' symbols.
 *  Gravit's conversations on it are mentionsOf's, asked with the item's base and name. */
export function pageOf(markets, account, id, now = Date.now()) {
  const m = isRecord(markets) ? markets : {};
  if (typeof id !== 'string' || id === '') return null;
  const reads = isRecord(m.explore) ? m.explore : {};
  const found = [bodyOf(reads, m.tab), bodyOf(reads, 'all'), m.results?.data].flatMap(everyRow).find(i => i.key === id);
  if (!found) return null;
  const item = noIcon(found);
  const legs = legsOf(item);
  const pair = pairAt(followOf(item));
  const quote = pair ? own(m.accountQuotes, pair) : undefined;
  const live = isRecord(quote) ? noIcon(quote) : null;
  const chart = own(m.candles, id);
  const base = str(item.base);
  const compare = base ? own(own(m.compare, base), 'data') : undefined;
  const a = isRecord(account) ? account : {};
  const lens = worthOf(a.data, a.holdings?.data, a.paper?.data).paperLeads ? a.paper?.data : a.holdings?.data;
  // every line the market trades at: its own, and an event's every outcome's (its YES and its NO)
  const places = [...legs, ...records(item.outcomes).flatMap(o => records(o.at))].filter(named);
  const atPlace = x => places.some(p => p.venue === x.venue && p.symbol === x.symbol);
  const symbols = [...new Set(places.map(p => str(p.symbol)))];
  return {
    item, legs, priced: priceOf(item), live, sourceWord: wordOf(item, live, now),
    candles: isRecord(chart) && chart.data?.ok === true ? noIcon(chart.data) : null,
    range: isRecord(chart) && typeof chart.range === 'string' && chart.range ? chart.range : '1D',
    compare: compare?.ok === true ? noIcon(records(compare.rows)) : [],
    held: {
      assets: base ? assetsOf(lens).filter(r => r.asset === base) : [],
      positions: [...positionsOf(a.holdings?.data), ...positionsOf(a.paper?.data)].filter(atPlace),
    },
    orders: openOrdersOf(a.data).filter(atPlace),
    lines: statementLinesOf(a.statement?.data).filter(l => names(l.description, base) || symbols.some(s => names(l.description, s))),
  };
}
