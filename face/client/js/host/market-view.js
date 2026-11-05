// face/client/js/host/market-view.js — the Markets screen's pure view. The Account's markets (spec 2026-10-22 §6.1): its explore
// reads — All's, and a tab's own — as the table: its tabs, its sorts and the one in effect, the read its rows are from, and the
// rows, each with its figures by kind (an event in cents, Kalshi's volume in contracts, a pre-IPO perpetual's implied valuation),
// the price it shows, where that price is from in the Account's own words with its age, its lines across venues with the best
// marked — beside the face's own A-share (cn:) rows; a market's page with its words, its history's state, what is held, working
// and stated for it, and the read each of those stands on; one compact word for a volume; what Hand to Gravit says of a market.
// No image URL the Account names (`icon`) is in anything returned here: the face's page never loads a third party's image. And
// the face's own ids and words for the A shares (spec 2026-10-19 §7 Stage 2), every word in English from the wire's enums. The
// wire's own text (a quote's message, a provider's message, a search note, a source name) is Chinese and never reaches a word
// here. No DOM.
import { normalizeAsset, number } from '../wire/market-model.js';
import { CHINA_VENUE, isCnKey, isChiNext, cnHitsOf } from '../wire/china.js';
import { MIN, HOUR, DAY } from '../time.js';
import { DESK_TAB } from './desk-view.js';
import { pageOk, assetsOf, positionsOf, openOrdersOf, statementLinesOf, worthOf } from './account-view.js';
import { t } from '../i18n/words.js';

// the Account's tabs, in the order the table draws them, the sorts its rows take, and the ranges a market's history is read for;
// the tabs' and the sorts' words are read from the table at each call (accountTabs, accountSorts)
export const ACCOUNT_TAB_IDS = ['all', 'crypto', 'stocks', 'rwas', 'perps', 'preipo', 'predictions'];
export const ACCOUNT_SORT_IDS = ['volume', 'movers', 'closing'];
export const CANDLE_RANGES = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'MAX'];

const tabWords = () => ({
  all: t('markets.tab.all'), crypto: t('markets.tab.crypto'), stocks: t('markets.tab.stocks'), rwas: t('markets.tab.rwas'),
  perps: t('markets.tab.perps'), preipo: t('markets.tab.preipo'), predictions: t('markets.tab.predictions'),
});
const sortWords = () => ({ volume: t('markets.sort.volume'), movers: t('markets.sort.movers'), closing: t('markets.sort.closing') });
/** The Account's tabs as `[id, label]`, in ACCOUNT_TAB_IDS's order. */
export const accountTabs = () => { const w = tabWords(); return ACCOUNT_TAB_IDS.map(id => [id, w[id]]); };
/** The sorts as `{ id, label }`, in ACCOUNT_SORT_IDS's order. */
export const accountSorts = () => { const w = sortWords(); return ACCOUNT_SORT_IDS.map(id => ({ id, label: w[id] })); };
const rangeWords = () => ({
  '1D': t('markets.range.d1'), '5D': t('markets.range.d5'), '1M': t('markets.range.m1'), '3M': t('markets.range.m3'), '6M': t('markets.range.m6'),
  YTD: t('markets.range.ytd'), '1Y': t('markets.range.y1'), '5Y': t('markets.range.y5'), MAX: t('markets.range.max'),
});
/** A market's history ranges as `[label, id]` (a seg's items), in CANDLE_RANGES's order: the id is the Account's range. */
export const candleRanges = () => { const w = rangeWords(); return CANDLE_RANGES.map(id => [w[id], id]); };

const TENCENT = 'Tencent'; // en-kept: the provider's name
const PROVIDERS = { tencent: TENCENT };
const MARKET_PROVIDER = { cn: TENCENT };
const providerStatus = () => ({
  connecting: t('markets.provider.connecting'), connected: t('markets.provider.connected'), unconfigured: t('markets.provider.unconfigured'),
  error: t('markets.provider.error'), limited: t('markets.provider.limited'),
});
const quoteStatus = () => ({ live: t('markets.quote.live'), delayed: t('markets.quote.delayed'), stale: t('markets.quote.stale') });
// `polling` is the A shares' quotes read from the Account every 5 s as they always are now: like streaming, nothing to say
/** China's words when the proxy re-serves the market's last read (the market not answering): the China tab's, the Venues line's,
 *  Watching's under its A shares. */
export const notAnsweringWord = () => t('markets.cn.notAnswering');
const connectionWords = () => ({ connecting: t('markets.connection.connecting'), paused: t('markets.connection.paused'), error: t('markets.quotesUnavailable'), stale: notAnsweringWord() });
const watchWords = () => ({ read: t('markets.watch.read'), unsaved: t('markets.watch.unsaved'), full: t('markets.watch.full') });

/** A face instrument id in canonical form (`us:aapl` → `us:AAPL`, `crypto:btc-usd` → `crypto:BTC/USD`), or null. */
export function canonicalId(raw) {
  return normalizeAsset({ id: typeof raw === 'string' ? raw : '' })?.id ?? null;
}

const blank = q => typeof q !== 'string' || !q.trim();

/** The quote's state in a word or two: Live, Delayed, Stale or No quote, and Closed when the market is; with no price
 * from a market whose provider says it is not configured, Not configured. */
export function quoteWord(quote, providers = [], market = quote?.market) {
  const statuses = quoteStatus();
  if (!quote || number(quote.price) === null || !Object.hasOwn(statuses, quote.quote_status)) {
    const provider = (Array.isArray(providers) ? providers : []).find(p => p?.market === market);
    return provider?.status === 'unconfigured' ? t('markets.provider.unconfigured') : t('markets.quote.none');
  }
  const status = statuses[quote.quote_status];
  return quote.market_status === 'closed' ? t('markets.quote.closed', { status }) : status;
}

/** The live quotes' connection, only when it is not simply streaming. */
export function connectionWord(status) {
  const words = connectionWords();
  return Object.hasOwn(words, status) ? words[status] : '';
}

export function providerWord(provider) {
  const statuses = providerStatus();
  const status = Object.hasOwn(statuses, provider?.status) ? statuses[provider.status] : '';
  const name = PROVIDERS[provider?.id] ?? t('markets.quotes');
  return status ? `${name} · ${status}` : name;
}

export function basisWord(quote) {
  return quote?.basis === '24h' ? '24h' : t('markets.basis.previousClose');
}

/** Where a quote comes from, named by its market's provider (the wire's source name is not English); an old us:/crypto:
 *  star, which no provider of the face quotes, by none. */
export function sourceWord(quote) {
  return MARKET_PROVIDER[quote?.market] ?? t('markets.quotes');
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
  if (asset?.market !== 'crypto') return t('markets.volume.shares', { n: compact(volume) });
  return `${compact(volume)} ${String(asset.symbol).split('/')[0]}`;
}

/** A row's or a page's day volume (its `priced`) in the same compact word, in its unit: dollars ($1.9B), contracts (412k
 *  contracts), an A share's shares (2M shares); none given is —. */
export function volumeWordOf(priced) {
  const volume = number(priced?.volume);
  if (volume === null) return '—';
  if (priced.volumeUnit === 'contracts') return t('markets.volume.contracts', { n: compact(volume) });
  if (priced.volumeUnit === 'shares') return t('markets.volume.shares', { n: compact(volume) });
  return `$${compact(volume)}`;
}

/** The watchlist's words: this browser's store's (`read`, `unsaved`, `full`), else the Account's own sentence when it refused
 *  a setWatch (host/markets.js keeps it as the error); nothing else. */
export function watchWord(error) {
  if (typeof error !== 'string') return '';
  const words = watchWords();
  return Object.hasOwn(words, error) ? words[error] : error.trim();
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Conversations whose title names the market as a whole word, case-sensitive, in list order: by its symbol (a coin by its
 *  base), or — a market with none, an event — by its name. */
export function mentionsOf(conversations, asset) {
  const symbol = typeof asset?.symbol === 'string' || typeof asset?.symbol === 'number' ? String(asset.symbol) : '';
  const token = symbol ? (asset.market === 'crypto' ? symbol.split('/')[0] : symbol) : typeof asset?.name === 'string' ? asset.name.trim() : '';
  if (!Array.isArray(conversations) || !token) return [];
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
 *  event at any other venue (`event:<venue>:<market>`), a pre-IPO perpetual (`preipo:<company>`) and an A share (`cn:600519`,
 *  the Account's china venue) — never an old face id (`us:`, `crypto:`). An A share's path differs from the others' wherever
 *  its page, its reads or its star are concerned: a caller tests isCnKey first. */
export function isAccountKey(id) {
  return typeof id === 'string' && /^(coin|stock|perp|rwa|event|preipo|kalshi|pm|pmus|cn):/.test(id);
}

// ── the China tab (spec 2026-10-31): the Account's ranking of the A shares, and the A-share words ──

/** The China tab's id: the Account's china tab (explore?tab=china, its ranking by a sort), drawn after its other tabs. */
export const CHINA_TAB = 'china';

/** An A share's board from its code: STAR (688, 689), ChiNext (300–302), SH, SZ or BJ, in the table's words (STAR's and
 *  ChiNext's shared with a run's, host/lunhui.js boardOf); '' for none. */
export function cnBoardOf(symbol) {
  const s = String(symbol ?? '');
  if (/^68[89]/.test(s)) return t('markets.board.star');
  if (isChiNext(s)) return t('markets.board.chinext');
  if (/^6/.test(s)) return t('markets.board.sh');
  if (/^[03]/.test(s)) return t('markets.board.sz');
  if (/^[489]/.test(s)) return t('markets.board.bj');
  return '';
}

/** An A share's tile: its name's first character, else (no name, or the name is the code) its code. */
export function cnTileOf(name, symbol) {
  const n = typeof name === 'string' ? name.trim() : '';
  return n && n !== symbol ? Array.from(n)[0] : String(symbol ?? '');
}

const beijing = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
// an instant's Beijing date and time, `MM-DD` and `HH:MM`; null for one that does not parse
function beijingOf(iso) {
  const ms = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return null;
  const p = Object.fromEntries(beijing.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { date: `${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** The line above the China table, from the ranking's session: closed, the last session's close; the midday break; else nothing. */
export function chinaWord(session) {
  if (session?.phase === 'closed' && typeof session.lastSession === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(session.lastSession)) {
    return t('markets.cn.closedOn', { day: session.lastSession.slice(5) });
  }
  if (session?.phase === 'closed') return t('markets.cn.closed');
  if (session?.phase === 'midday') return t('markets.cn.midday');
  return '';
}

/** An A-share page's state line (spec 2026-10-31 §5): the wire down, the market not answering (the proxy's last read, as of its time), the midday break, closed (the quote's session's close),
 *  live, delayed (the last trade's time), all in Beijing time; nothing before a priced quote. No Halted: no mark was found. */
export function cnStateWord(quote, connection, providers = []) {
  if (connection === 'error') return t('markets.quotesUnavailable');
  // the proxy re-serving the market's last read: the price is as of its own time, never Delayed or Closed
  if (connection === 'stale') {
    const at = beijingOf(quote?.as_of);
    return at ? t('markets.cn.notAnsweringAsOf', { date: at.date, time: at.time }) : notAnsweringWord();
  }
  // the Account answering but Tencent itself failing (China's state not live): a stale price is no delay, it is an outage
  const tencent = (Array.isArray(providers) ? providers : []).find(p => p?.market === 'cn');
  if (quote?.quote_status === 'stale' && tencent && tencent.status !== 'connected' && tencent.status !== 'limited') return t('markets.quotesUnavailable');
  if (!quote || number(quote.price) === null) return '';
  const at = beijingOf(quote.as_of);
  if (quote.market_status === 'midday') return t('markets.cn.sourceMidday', { source: TENCENT });
  // the session's last trading day, else the quote's own (a halted share's last trade is not the market's)
  const day = typeof quote.last_session === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(quote.last_session) ? quote.last_session.slice(5) : at?.date;
  if (quote.market_status === 'closed') return day ? t('markets.cn.sourceClosedOn', { source: TENCENT, day }) : t('markets.cn.sourceClosed', { source: TENCENT });
  if (quote.market_status === 'open') {
    if (quote.quote_status === 'live') return t('markets.cn.sourceLive', { source: TENCENT });
    return at ? t('markets.cn.sourceDelayedAt', { source: TENCENT, time: at.time }) : t('markets.cn.sourceDelayed', { source: TENCENT });
  }
  return TENCENT;
}

// the ranking's answer as the store keeps it, when it is one
const rankOf = m => (m?.rank?.data?.ok === true && Array.isArray(m.rank.data.items) ? m.rank.data : null);

/** China's rows: the ranking's items in its order, when the read is for the sort in effect (no rows in another sort's order); a
 *  row starred (cnStarsOf's: the Account keys starred, the page's china entries `atPage` names, an old cn star not yet moved)
 *  reads watched. */
export function chinaRowsOf(markets, atPage = []) {
  const m = isRecord(markets) ? markets : {};
  const data = rankOf(m);
  const sort = m.sort === 'movers' ? 'movers' : 'volume';
  if (!data || data.sort !== sort) return [];
  const starred = new Set(cnStarsOf(m, atPage));
  return records(data.items).filter(i => /^cn:\d{6}$/.test(str(i.id))).map(i => {
    const symbol = str(i.symbol) || i.id.slice(3);
    const priced = { price: number(i.price), unit: 'cny', changePct: number(i.change_pct), change24h: null, volume: number(i.turnover), volumeUnit: 'yuan', implied: null };
    return {
      id: i.id, source: 'china', kind: 'stock', name: str(i.name) || symbol, tile: cnTileOf(str(i.name), symbol), sub: `${symbol} · ${cnBoardOf(symbol)}`,
      priced, price: priced.price, live: null, sourceWord: TENCENT, closeTime: null, pastEnd: false, paper: false,
      watched: starred.has(i.id), atAccount: false, legs: [], tabs: [CHINA_TAB],
    };
  });
}

/** The table's tabs from All's explore answer: All first, with the Account's count and the cn rows', then the Account's tabs that
 *  have something in them, in accountTabs's order and words (Stocks is the Account's alone: the A shares' home is China). An
 *  answer not read, or one that is not an answer, is All alone. China (`opts.china`, `{ count }`) follows the Account's tabs
 *  (spec 2026-10-31 §4). As the retired page orders them, All results leads while `searching` and Watching follows China
 *  while `watching` (anything is starred), neither with a count; the Desk (`opts.desk`, plan 2026-11-01-desk-p3-watch Task 11)
 *  closes the row, with no count. */
export function tabsOf(explore, cnCount, opts) {
  const cn = Math.max(0, number(cnCount) ?? 0);
  const counts = new Map();
  if (explore?.ok === true && Array.isArray(explore.tabs)) {
    for (const tab of records(explore.tabs)) if (typeof tab.id === 'string' && !counts.has(tab.id)) counts.set(tab.id, Math.max(0, number(tab.count) ?? 0));
  }
  const out = [];
  for (const [id, label] of accountTabs()) {
    const count = (counts.get(id) ?? 0) + (id === 'all' ? cn : 0);
    if (id === 'all' || count > 0) out.push({ id, label, count });
  }
  return [
    ...(opts?.searching ? [{ id: 'results', label: t('markets.tab.results'), count: null }] : []),
    ...out,
    ...(opts?.china ? [{ id: CHINA_TAB, label: t('markets.tab.china'), count: opts.china.count ?? null }] : []),
    ...(opts?.watching ? [{ id: 'watching', label: t('markets.tab.watching'), count: null }] : []),
    ...(opts?.desk ? [{ id: DESK_TAB, label: t('markets.tab.desk'), count: null }] : []),
  ];
}

// dollars per contract as cents, without the float's noise (0.14 × 100 is 14, not 14.000000000000002)
const cents = v => { const n = number(v); return n === null ? null : Number((n * 100).toPrecision(12)); };

/** A row's figures by kind, as the retired page draws them: an event's price and 24h change are dollars per contract, in
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
  const stamp = typeof at === 'string' ? Date.parse(at) : NaN;
  const ms = Number.isFinite(stamp) && Number.isFinite(now) ? now - stamp : NaN;
  if (!(ms > FRESH_MS)) return '';
  if (ms < MIN) return t('markets.age.seconds', { n: Math.floor(ms / 1000) });
  if (ms < HOUR) return t('markets.age.minutes', { n: Math.floor(ms / MIN) });
  if (ms < DAY) return t('markets.age.hours', { n: Math.floor(ms / HOUR) });
  return ms < 2 * DAY ? t('markets.age.yesterday') : t('markets.age.days', { n: Math.floor(ms / DAY) });
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
const KIND_TABS = new Set(ACCOUNT_TAB_IDS.filter(id => id !== 'all'));
// a contract on a venue's estimate of a private company's valuation: its implied valuation, or its tab, says so
const isPreipo = item => isRecord(item.implied) || (Array.isArray(item.tabs) && item.tabs.includes('preipo'));
// what a market is, in a word, as the retired page says it
const kindWords = () => ({
  coin: t('markets.kind.coin'), stock: t('markets.kind.stock'), perp: t('markets.kind.perp'), rwa: t('markets.kind.rwa'), event: t('markets.kind.event'),
});
// an outcome as a person says it: YES → Yes, UP → Up; a named outcome as its venue writes it
export const outcomeWords = () => ({ YES: t('markets.outcome.yes'), NO: t('markets.outcome.no'), UP: t('markets.outcome.up'), DOWN: t('markets.outcome.down') });
const outcomeWord = label => { const s = str(label); const words = outcomeWords(); return Object.hasOwn(words, s) ? words[s] : s; };
// a price the Account gives in dollars — a quote's, a line's, an outcome's — in the market's unit: an event's in cents
const inUnit = (v, unit) => (unit === 'cents' ? cents(v) : number(v));
// the price a row or a page shows: the latest quote at its line where that says one, else the explore read's
const shownPrice = (live, priced) => inUnit(live?.price, priced.unit) ?? priced.price;
// the word a market's tile takes its letters from, as the retired page draws it: an event's category, else its base or name
const tileOf = item => (item.kind === 'event' ? str(item.category) || t('markets.tile.event') : str(item.base) || str(item.name));
// the Account's keys starred: the operator's own, then each an old us:/crypto: star was found as
function starredOf(m) {
  const old = records(m.watchlist).map(a => normalizeAsset(a)).filter(a => a && a.market !== 'cn');
  return [...new Set([...(Array.isArray(m.watch) ? m.watch : []), ...old.map(a => own(m.asked, a.id))].filter(k => typeof k === 'string' && k !== ''))];
}
// the A shares starred, as their cn keys, once each: the operator's own (the Account keys), then those the page's own watch list
// names (`atPage`, watchKeysOf's), then an old cn star the move left on the cn list (the Account store full)
function cnStarsOf(m, atPage = []) {
  const old = records(m.watchlist).map(a => normalizeAsset(a)?.id);
  return [...new Set([...starredOf(m), ...(Array.isArray(atPage) ? atPage : []), ...old].filter(isCnKey))];
}
// a starred A share as the asset its row draws: the cn list's own, else the search's hit, the ranking's row or its quote (their
// names kept), else its code alone
function cnAssetOf(m, key) {
  const listed = records(m.watchlist).map(a => normalizeAsset(a)).find(a => a?.id === key);
  if (listed) return listed;
  const hit = cnHitsOf(m.results?.data).assets.find(a => a.id === key);
  if (hit) return hit;
  const named = [...records(m.rank?.data?.items).filter(i => i.id === key), own(m.quotes, key)].find(i => isRecord(i) && str(i.name));
  return normalizeAsset({ id: key, market: 'cn', symbol: key.slice(3), name: named ? str(named.name) : '', currency: 'CNY' });
}

// ── the Account's own watch list (`page.watch`, `{ venue, symbol, at }`, set by the signed setWatch): the face's stars beside it ──

// every row the slice's reads carry — each explore read's (All's, each kind's) and the search's, every list in each — to find a
// market the page watches by its lines
const exploreRowsOf = m => [...Object.values(isRecord(m.explore) ? m.explore : {}).map(r => own(r, 'data')), m.results?.data].flatMap(everyRow);
// the page's watch entries that name a market: a venue and a symbol, as the page keeps them
const watchEntries = page => (pageOk(page) ? records(page.watch).filter(named).map(w => ({ venue: w.venue, symbol: w.symbol })) : []);
// an entry is one of a row's markets, as the retired page reads it: a line of the row's own or of an outcome's at the entry's
// symbol, at the entry's venue by its own id or — a public listing — by the venue it connects to
function watches(item, w) {
  const legs = legsOf(item);
  const venueOf = v => { const l = legs.find(x => x.venue === v); return l?.public && l.connectTo ? l.connectTo : v; };
  return [...legs, ...records(item.outcomes).flatMap(o => records(o.at))].filter(named)
    .some(l => l.symbol === w.symbol && (l.venue === w.venue || venueOf(l.venue) === w.venue));
}

/** The page's own watch list as Account keys: each entry (`{ venue, symbol }`) as the key of every row of `rows` (explore items)
 *  whose lines name it (legsOf's, an outcome's), in the page's order, once each; an entry no row lists is left out, and a page
 *  the face does not recognise watches nothing. An entry at the china venue is its A share's cn key (`cn:<symbol>`) with no row
 *  needed — one whose symbol is not six digits is left out. */
export function watchKeysOf(page, rows) {
  const items = records(rows).filter(i => isAccountKey(i.key) && !isCnKey(i.key));
  const keys = watchEntries(page).flatMap(w => (w.venue === CHINA_VENUE
    ? [`cn:${w.symbol}`].filter(isCnKey)
    : items.filter(i => watches(i, w)).map(i => i.key)));
  return [...new Set(keys)];
}

/** What a star on an Account key signs at the Account (setWatch), the market found in any read of the slice (an A share's
 *  `cn:<code>` needs none: `{ venue: 'china', symbol: <code> }`): `on`, the line it
 *  would watch — the line the page follows (followOf) when that is connected, else a public listing by the venue it connects
 *  to (none connecting: null); `off`, the page's own entry for the market as it keeps it, or null. Each `{ venue, symbol }`. */
export function setWatchOf(markets, page, id) {
  // an A share: its own line at the china venue, read from its key alone; off, the page's china entry at its code
  if (isCnKey(id)) {
    const symbol = id.slice(3);
    return { on: { venue: CHINA_VENUE, symbol }, off: watchEntries(page).find(w => w.venue === CHINA_VENUE && w.symbol === symbol) ?? null };
  }
  const m = isRecord(markets) ? markets : {};
  const item = isAccountKey(id) ? exploreRowsOf(m).find(i => i.key === id) : undefined;
  if (!item) return { on: null, off: null };
  const leg = followOf(item);
  const pub = legsOf(item).find(l => l.public && l.connectTo && l.symbol);
  const on = leg?.connected ? { venue: leg.venue, symbol: leg.symbol } : pub ? { venue: pub.connectTo, symbol: pub.symbol } : null;
  return { on, off: watchEntries(page).find(w => watches(item, w)) ?? null };
}

/** Whether a market is starred, as its star is drawn — what a press on it takes off or puts on: an Account key the operator's
 *  own, an old us:/crypto: star's find while that star is listed, or one the page (`page`, the Account's) watches at any line
 *  a read lists; an A share (`cn:sh600519` canonicalised) as one of cnStarsOf's; an old face id, canonicalised, on the cn list. */
export function watchedOf(markets, id, page = null) {
  const m = isRecord(markets) ? markets : {};
  const cn = typeof id === 'string' && id.startsWith('cn:') ? canonicalId(id) : null;
  if (isCnKey(cn)) return cnStarsOf(m, watchKeysOf(page, [])).includes(cn);
  if (isAccountKey(id)) return starredOf(m).includes(id) || watchKeysOf(page, exploreRowsOf(m)).includes(id);
  const canonical = canonicalId(id);
  return canonical !== null && records(m.watchlist).some(a => a.id === canonical);
}

// a row's second line: a pre-IPO perpetual's kind, another perpetual's base, an event's category, a coin's base, a stock's or an
// RWA's venue — the first the owner connected, else the first public listing
function subOf(item, legs) {
  const base = str(item.base);
  switch (item.kind) {
    case 'perp': return isPreipo(item) ? t('markets.sub.preipoPerp') : base ? t('markets.sub.basePerp', { base }) : t('markets.kind.perp');
    case 'event': return str(item.category);
    case 'coin': return base;
    case 'stock': case 'rwa': return (legs.find(l => l.connected) ?? legs.find(l => l.public))?.venueName ?? '';
    default: return '';
  }
}

// where a row's price is from: the live quote's own source and stamp where it names one, else the item's
const wordOf = (item, live, now) => { const from = str(live?.quoteFrom).trim(); return from ? said(from, live.quoteAt, now) : sourceWordOf(item, now); };

// `atAccount`: starred on the Account's own list alone, never the face's
function accountRow(item, quotes, watched, now, atAccount = false) {
  const legs = legsOf(item);
  const pair = pairOf(legs);
  const quote = pair ? own(quotes, pair) : undefined;
  const live = isRecord(quote) ? noIcon(quote) : null;
  const priced = priceOf(item);
  return {
    id: str(item.key), source: 'account', kind: str(item.kind), name: str(item.name), tile: tileOf(item), sub: subOf(item, legs),
    priced, price: shownPrice(live, priced), live, sourceWord: wordOf(item, live, now),
    closeTime: str(item.closeTime) || null, pastEnd: item.pastEnd === true, paper: legs.find(l => l.connected)?.paper === true, watched, atAccount, legs,
    tabs: Array.isArray(item.tabs) ? item.tabs.filter(tab => typeof tab === 'string') : [],
  };
}

// a starred market no read lists (a quiet one, or one its venue no longer lists): enough of a row to see its star and take it off
function placeholderRow(key) {
  const head = key.indexOf(':');
  const name = key.slice(key.lastIndexOf(':') + 1);
  return {
    id: key, source: 'account', placeholder: true, kind: head > 0 ? key.slice(0, head) : '', name, tile: name,
    sub: t('markets.notInRead'), priced: unpriced(), price: null, live: null, sourceWord: '', closeTime: null, pastEnd: false, paper: false,
    watched: true, atAccount: false, legs: [], tabs: ['all', 'watching'],
  };
}

// a cn row, quoted by the Account (venue china, Tencent's): its quotes poll's quote, else the price its search hit carried; its
// price in its currency, its volume in shares; its tile its code
function cnRow(asset, markets, watched, atAccount = false) {
  const quote = own(markets.quotes, asset.id) ?? own(markets.hitQuotes, asset.id) ?? null;
  const priced = {
    price: number(quote?.price), unit: asset.currency === 'CNY' ? 'cny' : 'usd', changePct: number(quote?.change_pct), change24h: null,
    volume: number(quote?.volume), volumeUnit: 'shares', implied: null,
  };
  return {
    id: asset.id, source: 'face', asset, quote, kind: 'stock', name: asset.name || asset.symbol, tile: cnTileOf(asset.name, asset.symbol),
    sub: `${asset.symbol} · ${cnBoardOf(asset.symbol)}`,
    priced, price: priced.price, live: null, sourceWord: sourceWord(quote ?? { market: 'cn' }), closeTime: null, pastEnd: false, paper: false,
    watched, atAccount, legs: [], tabs: ['all'],
  };
}

// an old us:/crypto: star the Account could not find: listed once, under its own muted line
function notListedRow(asset) {
  const coin = asset.market === 'crypto';
  const name = asset.name || asset.symbol;
  return {
    id: asset.id, source: 'face', notListed: true, kind: coin ? 'coin' : 'stock', name, tile: name,
    sub: t('markets.notListed'), priced: unpriced(), price: null, live: null, sourceWord: '', closeTime: null, pastEnd: false,
    paper: false, watched: true, atAccount: false, legs: [], tabs: ['all', coin ? 'crypto' : 'stocks'],
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
  closing: { dir: 1, side: () => 0, key: r => { const ms = r.closeTime ? Date.parse(r.closeTime) : NaN; return Number.isFinite(ms) ? ms : null; } },
};

function sorted(rows, sort) {
  const { dir, side, key } = typeof sort === 'string' && Object.hasOwn(SORTS, sort) ? SORTS[sort] : SORTS.volume;
  return rows.map((row, index) => ({ row, index, s: side(row), k: key(row) }))
    .sort((a, b) => a.s - b.s || (a.k === null) - (b.k === null) || (a.k === null ? 0 : dir * (a.k - b.k)) || a.index - b.index)
    .map(x => x.row);
}

/** The sorts the table offers for its rows — Closing soonest only where a row closes — and the one in effect: the kept sort
 *  when it is offered, else the first offered, Most traded. */
export function sortsOf(rows, kept) {
  const sorts = accountSorts().filter(s => s.id !== 'closing' || records(rows).some(r => r.closeTime));
  return { sorts, sort: sorts.some(s => s.id === kept) ? kept : sorts[0].id };
}

/** The table for the slice's tab, query and kept sort, on the renderer's clock (`now`, for the ages beside the source words):
 *  its rows, sorted by the sort in effect (sortsOf's); the sorts offered and that one; its tabs — tabsOf's over All's read, the
 *  A shares counted under All and Stocks, each count the Account's only once All's read has answered (none before), Watching
 *  once anything is starred, All results while searching, the Desk last; and the read the rows are from, `{ status, answered, message }` —
 *  while searching the search's, else the tab's own read once it has answered, else All's — `message` the Account's sentence
 *  when that read refused. The rows: the Account's are `source: 'account'`, each with the word its tile is lettered from, its
 *  figures by kind, the price it shows (`price`: the latest quote at its most traded connected venue, `live`, where that says
 *  one, in the row's unit — an event's in cents — else the explore read's), where its price is from and its lines: a tab's rows
 *  are its own explore read's (`explore[tab]`) once that has answered, else All's (`explore.all`), of the tab's kind; while
 *  there is a query, the search's (`results`) once it has answered. Beside them the A-share rows: the A shares starred (cnStarsOf's —
 *  the Account keys, the page's china entries, an old cn star the move left), or while searching the cn hits alone; and an old us:/crypto: star — one not asked of the Account yet draws nothing,
 *  one it found stars the Account's row, one it could not find is listed once, Not listed at the Account. All is every row, a
 *  kind's tab the rows whose tabs name it, All results (`results`) the search's own. Watching is every star, found in any list
 *  of its tab's read or All's (items, movers, closing, most traded), else a placeholder that can still be un-starred; a query
 *  typed on Watching searches every market, as the retired page does. The stars are the face's and the page's (`page`, the
 *  Account's own watch list: watchKeysOf over every read), one list: a row starred on the page's alone is `atAccount`; on
 *  Watching the page's follow the face's, each found in whichever read lists it. */
export function tableOf(markets, now = Date.now(), page = null) {
  const m = isRecord(markets) ? markets : {};
  const searching = !blank(m.q);
  const reads = isRecord(m.explore) ? m.explore : {};
  const atPage = watchKeysOf(page, exploreRowsOf(m));
  // China (spec 2026-10-31 §4): the ranking's rows in its order, its two sorts, its read and its session
  const onChina = m.tab === CHINA_TAB && !searching;
  const rows = onChina ? chinaRowsOf(m, atPage) : unsortedRowsOf(m, searching, reads, now, atPage);
  const { sorts, sort } = onChina
    ? { sorts: accountSorts().filter(s => s.id !== 'closing'), sort: m.sort === 'movers' ? 'movers' : 'volume' }
    : sortsOf(rows, m.sort);
  const watchlist = records(m.watchlist).map(a => normalizeAsset(a)).filter(Boolean);
  const all = bodyOf(reads, 'all');
  const counted = all !== undefined && all !== null;
  const watching = starredOf(m).length > 0 || watchlist.length > 0 || atPage.length > 0;
  const chinaCount = rankOf(m) ? Math.max(0, number(rankOf(m).total) ?? 0) : null;
  const tabs = tabsOf(all, cnStarsOf(m, atPage).length, { watching, searching, china: { count: chinaCount }, desk: true })
    .map(tab => (counted || tab.id === CHINA_TAB || tab.id === DESK_TAB ? tab : { ...tab, count: null }));
  const mine = own(reads, KIND_TABS.has(m.tab) ? m.tab : 'all');
  const source = onChina ? m.rank : searching ? m.results : mine?.data ? mine : own(reads, 'all');
  const read = { status: str(source?.status) || 'idle', answered: isRecord(source) && source.data != null, message: str(source?.message) || null };
  return { rows: onChina ? rows : sorted(rows, sort), sorts, sort, tabs, read, china: onChina, session: onChina ? rankOf(m)?.session ?? null : null };
}

/** The table's rows (tableOf's, `page` the Account's), sorted by the sort in effect. */
export function rowsOf(markets, now = Date.now(), page = null) {
  return tableOf(markets, now, page).rows;
}

function unsortedRowsOf(m, searching, reads, now, atPage) {
  const tab = searching && m.tab === 'watching' ? 'results' : m.tab;
  const all = bodyOf(reads, 'all');
  const watchlist = records(m.watchlist).map(a => normalizeAsset(a)).filter(Boolean);
  const old = watchlist.filter(a => a.market !== 'cn');
  // the A shares starred (the Account keys', the page's china entries, an old cn star not moved): drawn as their A-share rows
  const cnStars = cnStarsOf(m, atPage);
  const cnPageOnly = new Set(atPage.filter(isCnKey).filter(key => !starredOf(m).includes(key) && !watchlist.some(a => a.id === key)));
  const cn = cnStars.map(key => cnAssetOf(m, key)).filter(Boolean);
  const starred = starredOf(m).filter(key => !isCnKey(key));
  const isStarred = new Set(starred);
  const pageOnly = atPage.filter(key => !isCnKey(key) && !isStarred.has(key));
  const atAccount = new Set(pageOnly);
  const quotes = isRecord(m.accountQuotes) ? m.accountQuotes : {};
  const row = item => { const key = str(item.key); return accountRow(item, quotes, isStarred.has(key) || atAccount.has(key), now, atAccount.has(key)); };
  const face = () => [...cn.map(a => cnRow(a, m, true, cnPageOnly.has(a.id))), ...old.filter(a => own(m.asked, a.id) === null).map(notListedRow)];
  const fromResults = searching && readable(m.results?.data);
  const listed = new Set(cn.map(a => a.id));
  // the search's A shares: its cn items, drawn as the cn rows they are (their prices the hits' own), never as the Account's rows
  const hits = searching ? cnHitsOf(m.results?.data).assets.map(a => cnRow(a, m, listed.has(a.id))) : [];
  const dollars = body => itemsOf(body).filter(i => !isCnKey(i.key));
  let rows;
  if (tab === 'watching') {
    const lists = [...everyRow(bodyOf(reads, 'watching')), ...everyRow(all)];
    const everywhere = exploreRowsOf(m);
    rows = [
      ...starred.map(key => { const item = lists.find(i => i.key === key); return item ? row(item) : placeholderRow(key); }),
      ...pageOnly.map(key => row(everywhere.find(i => i.key === key))),
      ...face(),
    ];
  } else if (tab === 'results') {
    rows = searching ? [...(fromResults ? dollars(m.results.data).map(row) : []), ...hits] : [];
  } else {
    const tabBody = bodyOf(reads, tab);
    const body = fromResults ? m.results.data : readable(tabBody) ? tabBody : all;
    rows = [...dollars(body).map(row), ...(searching ? hits : face())];
    if (KIND_TABS.has(tab)) rows = rows.filter(r => r.tabs.includes(tab));
  }
  return rows;
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

// what a part of the page stands on, from a read as the store keeps it: whether it has answered, whether its last try failed,
// and the Account's sentence when that try refused
const partRead = (answered, failed, message) => ({ answered, failed, message: failed ? str(message) || null : null });
// a read's sentence while its last try is a refusal — never one it kept from an earlier refusal while it is read again
const saidBy = read => (read?.status === 'error' ? str(read.message) || null : null);

/** A market's page from the Account's reads, on the renderer's clock, or null for an id none lists. The item, without its icons,
 *  is looked for in every list (items, movers, closing, most traded) of the current tab's read, All's and the search's.
 *  - Its figures by kind, and the price it shows (`price`: the latest quote at the line the page follows — host/markets.js: its
 *    first connected line, else its first public listing — where that says one, in the market's unit, else the explore read's);
 *    where its price is from (`sourceWord`); its lines (`legs`) with their prices in the market's unit, an event's in cents.
 *  - Its words: its name; the one its tile is lettered from; its sub's parts (`sub`: what it is and the symbol at the line it
 *    follows, or an event's category) and an event's close (`closesAt`, the Account's time); its outcomes (`outcomes`: each
 *    label as a person says it, its price in cents); whether it is a pre-IPO perpetual (`preipo`) and whether it is starred
 *    (`watched`, rowsOf's rule); what Gravit's conversations on it are found by (`about`, for mentionsOf: its base, or — an
 *    event, which has none — its name).
 *  - Its history: the candles for the range kept (1D until one is chosen) once a read answered, and that read's state
 *    (`history`: its status, the Account's sentence when it refused, and whether the candles kept are the range's own).
 *  - The compare rows for its base.
 *  - What is held of it — the leading lens's assets of its base (the paper lens's when paper leads the Portfolio, else the real)
 *    and the positions, real and paper, at any of its lines (an event's: every outcome's) — its open orders there, and the
 *    statement's lines that name its base or one of those lines' symbols; with what each stands on (`reads`): what is held, the
 *    holdings read and, while the page names a paper venue, its paper lens's, and the page that says which lens leads; the
 *    orders, the Account's read — both `unreadable` when the page that landed is one the face does not recognise; the lines,
 *    the statement read. */
export function pageOf(markets, account, id, now = Date.now()) {
  const m = isRecord(markets) ? markets : {};
  if (typeof id !== 'string' || id === '') return null;
  const reads = isRecord(m.explore) ? m.explore : {};
  const found = [bodyOf(reads, m.tab), bodyOf(reads, 'all'), m.results?.data].flatMap(everyRow).find(i => i.key === id);
  if (!found) return null;
  const item = noIcon(found);
  const legs = legsOf(item);
  const follow = followOf(item);
  const pair = pairAt(follow);
  const quote = pair ? own(m.accountQuotes, pair) : undefined;
  const live = isRecord(quote) ? noIcon(quote) : null;
  const priced = priceOf(item);
  const event = item.kind === 'event';
  const preipo = isPreipo(item);
  const chart = own(m.candles, id);
  const candles = isRecord(chart) && chart.data?.ok === true ? noIcon(chart.data) : null;
  const range = isRecord(chart) && typeof chart.range === 'string' && chart.range ? chart.range : '1D';
  const base = str(item.base);
  const compare = base ? own(own(m.compare, base), 'data') : undefined;
  const a = isRecord(account) ? account : {};
  const lens = worthOf(a.data, a.holdings?.data, a.paper?.data).paperLeads ? a.paper?.data : a.holdings?.data;
  const paperNamed = pageOk(a.data) && a.data.venues.some(v => v?.paper === true);
  // the Account's read landed as one the face does not recognise: its orders, and what is held, are unreadable, never loading
  const unreadable = a.data != null && !pageOk(a.data);
  // every line the market trades at: its own, and an event's every outcome's (its YES and its NO)
  const places = [...legs, ...records(item.outcomes).flatMap(o => records(o.at))].filter(named);
  const atPlace = x => places.some(p => p.venue === x.venue && p.symbol === x.symbol);
  const symbols = [...new Set(places.map(p => str(p.symbol)))];
  const closesAt = event && typeof item.closeTime === 'string' && !Number.isNaN(Date.parse(item.closeTime)) ? item.closeTime : null;
  const name = str(item.name);
  return {
    item, priced, price: shownPrice(live, priced), live, sourceWord: wordOf(item, live, now),
    legs: legs.map(l => ({ ...l, price: inUnit(l.price, priced.unit), bid: inUnit(l.bid, priced.unit), ask: inUnit(l.ask, priced.unit) })),
    name, tile: tileOf(item), preipo, watched: watchedOf(m, id, a.data), about: base ? { symbol: base, name } : { name },
    sub: (event ? [str(item.category)] : [preipo ? t('markets.tab.preipo') : own(kindWords(), item.kind) ?? '', str(follow?.symbol)]).filter(Boolean),
    closesAt,
    outcomes: event ? records(item.outcomes).map(o => ({ label: outcomeWord(o.label), cents: cents(o.price) })) : [],
    candles, range,
    history: {
      status: str(chart?.status) || 'idle', message: chart?.status === 'error' ? str(chart.message) || null : null,
      current: candles !== null && (typeof candles.range !== 'string' || candles.range === range),
    },
    compare: compare?.ok === true ? noIcon(records(compare.rows)) : [],
    held: {
      assets: base ? assetsOf(lens).filter(r => r.asset === base) : [],
      positions: [...positionsOf(a.holdings?.data), ...positionsOf(a.paper?.data)].filter(atPlace),
    },
    orders: openOrdersOf(a.data).filter(atPlace),
    lines: statementLinesOf(a.statement?.data).filter(l => names(l.description, base) || symbols.some(s => names(l.description, s))),
    reads: {
      // which lens leads is the page's to say: under a page the face does not recognise what is held is unreadable too
      held: {
        ...partRead(!unreadable && a.holdings?.data != null && (!paperNamed || a.paper?.data != null),
          unreadable || a.holdings?.status === 'error' || (paperNamed && a.paper?.status === 'error'), saidBy(a.holdings) || (paperNamed ? saidBy(a.paper) : null)),
        unreadable,
      },
      orders: { ...partRead(pageOk(a.data), a.status === 'error' || unreadable, a.message), unreadable },
      lines: partRead(a.statement?.data != null, a.statement?.status === 'error', a.statement?.message),
    },
  };
}

/** The asset a face id names (`cn:600519`, an old `us:`/`crypto:` star), canonicalised: the one the watchlist or the search
 *  carries — its name and exchange with it — else the id's own; null for anything that is not a face id. */
export function faceAssetOf(markets, id) {
  const canonical = canonicalId(id);
  if (!canonical) return null;
  const m = isRecord(markets) ? markets : {};
  const listed = [...records(m.watchlist), ...cnHitsOf(m.results?.data).assets].map(a => normalizeAsset(a)).find(a => a?.id === canonical);
  if (listed) return listed;
  // a share the China ranking lists, else one whose quote has landed with its name (a deep link)
  const ranked = records(rankOf(m)?.items).find(i => i.id === canonical);
  const quoted = own(m.quotes, canonical);
  const name = str(ranked?.name) || (isRecord(quoted) ? str(quoted.name) : '');
  return normalizeAsset(name ? { id: canonical, name } : { id: canonical });
}

// the A-share page's facts, in the order the page draws them (spec 2026-10-31 §5), each a quote field and its unit
const cnFacts = () => [
  [t('markets.cnFact.prevClose'), 'prev_close', 'cny'], [t('markets.cnFact.open'), 'open', 'cny'], [t('markets.cnFact.high'), 'high', 'cny'], [t('markets.cnFact.low'), 'low', 'cny'],
  [t('markets.cnFact.turnover'), 'turnover', 'yuan'], [t('markets.cnFact.turnoverRate'), 'turnover_rate', 'pct'], [t('markets.cnFact.marketCap'), 'market_cap', 'yuan'], [t('markets.cnFact.pe'), 'pe_ttm', 'ratio'],
  [t('markets.cnFact.limitUp'), 'limit_up', 'cny'], [t('markets.cnFact.limitDown'), 'limit_down', 'cny'], [t('markets.cnFact.volume'), 'volume', 'shares'], [t('markets.cnFact.amplitude'), 'amplitude', 'pct'],
];

/** An A share's page (spec 2026-10-31 §5), or null for an id that is not one: its asset, its quote (the live wire's, else its
 *  search hit's), the twelve facts `{ label, value, unit }`, the range kept (1D until one is chosen) and its history read —
 *  `sessions` (1D, 5D) or `candles` (longer), `current` once a read for the range has answered. */
export function cnPageOf(markets, id) {
  const asset = faceAssetOf(markets, id);
  if (!asset || asset.market !== 'cn') return null;
  const m = isRecord(markets) ? markets : {};
  const quote = own(m.quotes, asset.id) ?? own(m.hitQuotes, asset.id) ?? null;
  const chart = own(m.candles, asset.id);
  const range = isRecord(chart) && CANDLE_RANGES.includes(chart.range) ? chart.range : '1D';
  const data = isRecord(chart) && chart.data?.ok === true ? chart.data : null;
  const current = data !== null && data.range === range;
  return {
    asset, quote, range,
    facts: cnFacts().map(([label, key, unit]) => ({ label, value: number(quote?.[key]), unit })),
    history: {
      status: str(chart?.status) || 'idle', message: chart?.status === 'error' ? str(chart.message) || null : null, current,
      sessions: current && Array.isArray(data.sessions) ? data.sessions : null, candles: current && Array.isArray(data.candles) ? data.candles : null,
    },
  };
}

/** What Hand to Gravit names a market by, `{ symbol, name }`: an Account key by its page's item — its base, else its name, and its
 *  name — a face id by its asset's symbol and name; null for a key no read lists, or an id that is neither. */
export function handWordsOf(markets, account, id, now = Date.now()) {
  if (!isCnKey(id) && isAccountKey(id)) {
    const item = pageOf(markets, account, id, now)?.item;
    const name = str(item?.name);
    const symbol = str(item?.base) || name;
    return symbol ? { symbol, name } : null;
  }
  const asset = faceAssetOf(markets, id);
  return asset ? { symbol: asset.symbol, name: asset.name } : null;
}
