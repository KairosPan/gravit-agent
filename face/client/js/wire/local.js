// The market's local answers — China A, Hong Kong, Korea, Taiwan and the world's cash indices (spec 2026-11-20 §5.6) — as the shapes
// the Markets store draws: a key's venue and symbol, the ranking's rows (host/market-view.js localRowsOf), a quote (LiveQuote), a
// search's hits and each venue's provider state. China's own exports (wire/china.js) are this module's China cases. Pure: no DOM, no
// fetch; the face holds no key and asks no upstream.
import { number } from './market-model.js';
import { isLine } from '../i18n/words.js';

/** The venues a local read is at, in the order their providers are listed. */
export const LOCAL_VENUES = ['china', 'hk', 'kr', 'tw', 'ix'];
// the regions a cash index is keyed under (`ix:<region>:<id>`)
const IX_REGIONS = ['us', 'cn', 'hk', 'jp', 'kr', 'tw', 'in', 'eu'];
// each venue's key prefix and its code as the market writes it: an A share six digits, a Hong Kong share five (padded), a Korean
// share six digits or capitals, a Taiwanese share four to six; an index's id lower-case letters and digits under its region
const KEYS = [
  { venue: 'china', prefix: 'cn', code: /^\d{6}$/ },
  { venue: 'hk', prefix: 'hk', code: /^\d{5}$/ },
  { venue: 'kr', prefix: 'kr', code: /^[0-9A-Z]{6}$/ },
  { venue: 'tw', prefix: 'tw', code: /^[0-9A-Z]{4,6}$/ },
  { venue: 'ix', prefix: 'ix', code: /^([a-z]{2}):([a-z0-9]{1,20})$/ },
];
const BY_VENUE = Object.fromEntries(KEYS.map(k => [k.venue, k]));
/** Each venue's market, as the providers and quotes name it (China's is `cn`, as it always was). */
const MARKET_OF = { china: 'cn', hk: 'hk', kr: 'kr', tw: 'tw', ix: 'ix' };
/** Each venue's provider id, and the name its quote is from when the market names none. */
const PROVIDER_ID = { china: 'tencent', hk: 'tencent', kr: 'naver', tw: 'twse', ix: 'indices' };
const NAMES = { china: 'Tencent', hk: 'Tencent', kr: 'Naver', tw: 'TWSE', ix: 'Indices' }; // en-kept: the providers' names
const SHARE_VENUES = { cn: 'china', hk: 'hk', kr: 'kr', tw: 'tw' };

const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');
const PHASE = { trading: 'open', midday: 'midday', closed: 'closed' };
const PROVIDER_STATUS = { live: 'connected', stale: 'limited', unavailable: 'error' };

/** A local key's venue and symbol (`cn:600519` → china 600519, `hk:00700`, `kr:005930`, `tw:2330`, `ix:jp:n225` → ix `jp:n225`), else
 *  null (`hk:700`, `ix:n225`, an Account key). @param {unknown} id */
export function localKeyOf(id) {
  if (typeof id !== 'string') return null;
  const head = id.indexOf(':');
  if (head < 0) return null;
  const prefix = id.slice(0, head), symbol = id.slice(head + 1);
  const k = KEYS.find(x => x.prefix === prefix);
  if (!k || !k.code.test(symbol)) return null;
  if (k.venue === 'ix' && !IX_REGIONS.includes(symbol.slice(0, symbol.indexOf(':')))) return null;
  return { venue: k.venue, symbol };
}
/** @param {unknown} id */
export const isLocalKey = id => localKeyOf(id) !== null;
/** The market's quote pair for a local key (`hk|00700`, `ix|jp:n225`), else null. @param {unknown} id */
export function localPairOf(id) {
  const k = localKeyOf(id);
  return k ? `${k.venue}|${k.symbol}` : null;
}
/** The key a venue's symbol is drawn under (`hk`, `00700` → `hk:00700`), else null. */
export function localIdOf(venue, symbol) {
  const k = BY_VENUE[venue];
  const id = k ? `${k.prefix}:${str(symbol)}` : '';
  return localKeyOf(id)?.venue === venue ? id : null;
}

// the venue and sort a ranking query asks for (market-view.js rankQueryOf's): Indices `ix`, Stocks its region's share venue
function askedOf(query) {
  const p = new URLSearchParams(typeof query === 'string' ? query : '');
  const venue = p.get('asset') === 'indices' ? 'ix' : SHARE_VENUES[p.get('region') ?? ''];
  const sort = p.get('sort');
  return venue && (sort === 'volume' || sort === 'movers') ? { venue, region: p.get('region') ?? '', sort } : null;
}

// a ranking row as the store keeps it: an A share's as China's always was; a share's with its local name, currency and turnover;
// an index's with its level, change and change %, no currency
function rowOf(i, venue) {
  const k = localKeyOf(i.key);
  const symbol = str(i.base) || (venue === 'ix' ? k.symbol.slice(k.symbol.indexOf(':') + 1) : k.symbol);
  const base = { id: i.key, symbol, name: str(i.name) || symbol, price: number(i.price), change_pct: number(i.changePct24h) };
  if (venue === 'china') return { ...base, turnover: number(i.turnoverCny) };
  if (venue === 'ix') return { ...base, kind: 'index', change: number(i.change24h), quote_from: str(i.quoteFrom) };
  return {
    ...base, kind: 'share', turnover: number(i.turnoverLocal), currency: str(i.currency) || null,
    ...(str(i.nameLocal) ? { name_local: i.nameLocal } : {}), quote_from: str(i.quoteFrom),
  };
}

/** An explore answer of a local ranking as the ranking the store keeps, for the query it was read for (kept as `query`): its read
 *  (`local`, or for China its `china`) at the query's venue and sort, its rows that venue's keys; null for any other body.
 *  @param {unknown} body @param {string} query */
export function localRankOf(body, query) {
  const asked = askedOf(query);
  if (!asked || !isRecord(body) || body.ok !== true || !Array.isArray(body.items)) return null;
  const read = isRecord(body.local) ? body.local : asked.venue === 'china' && isRecord(body.china) ? body.china : null;
  if (!read || read.sort !== asked.sort) return null;
  if (typeof read.venue === 'string' && read.venue !== asked.venue) return null;
  const items = body.items.filter(i => isRecord(i) && localKeyOf(i.key)?.venue === asked.venue).map(i => rowOf(i, asked.venue));
  const status = isRecord(read.status) ? read.status : { state: 'unavailable', said: '' };
  return {
    ok: true, venue: asked.venue, region: asked.region, query, sort: asked.sort, total: number(read.total) ?? items.length,
    asOf: str(read.asOf) || str(body.asOf), session: isRecord(read.session) ? read.session : { phase: 'closed', lastSession: null }, status,
    stale: body.stale === true || status.state === 'stale', items,
  };
}

/** A quotes row ({ venue, symbol, market } or a refusal) as the LiveQuote the views read, keyed by its local key; null for a refused
 *  row or one at no local venue. An A share's carries the facts it always did; any other's its currency and its source's words.
 *  @param {unknown} row @param {number | Date} [now] */
export function localQuoteOf(row, now = Date.now()) {
  if (!isRecord(row) || !isRecord(row.market) || row.refusal !== undefined) return null;
  const venue = str(row.venue);
  const m = row.market;
  const china = venue === 'china';
  const facts = china ? (isRecord(m.cn) ? m.cn : isRecord(m.local) ? m.local : {}) : isRecord(m.local) ? m.local : {};
  const symbol = china ? str(m.symbol) || str(row.symbol) : str(row.symbol) || str(m.symbol);
  const id = localIdOf(venue, symbol);
  if (!id) return null;
  const asOf = str(m.quoteAt) || null;
  const quote = {
    id, market: MARKET_OF[venue], symbol, name: str(m.name) || symbol,
    price: number(m.price), prev_close: number(facts.prevClose), change: number(m.change24h), change_pct: number(m.changePct24h),
    volume: number(facts.volume), as_of: asOf, received_at: new Date(now).toISOString(), volume_as_of: asOf,
    source: str(m.quoteFrom) || NAMES[venue], feed: '', basis: 'previous_close',
    quote_status: facts.quoteStatus === 'delayed' ? 'delayed' : china || facts.quoteStatus === 'live' ? 'live' : 'unsaid',
    market_status: PHASE[facts.phase] ?? 'unknown', message: '', last_session: str(facts.lastSession) || null,
    open: number(facts.open), high: number(facts.high), low: number(facts.low), turnover: number(facts.turnover),
  };
  if (!china) return { ...quote, currency: str(m.currency) || null };
  return {
    ...quote, turnover_rate: number(facts.turnoverRate), market_cap: number(facts.marketCap), pe_ttm: number(facts.peTtm),
    limit_up: number(facts.limitUp), limit_down: number(facts.limitDown), amplitude: number(facts.amplitude),
  };
}

/** An explore?q= answer's local hits (every local key's) as hits and their prices, by key; other items are not local.
 *  @param {unknown} body */
export function localHitsOf(body) {
  const hits = [], quotes = {};
  if (!isRecord(body) || !Array.isArray(body.items)) return { hits, quotes };
  for (const i of body.items) {
    const k = isRecord(i) ? localKeyOf(i.key) : null;
    if (!k) continue;
    hits.push({
      id: i.key, venue: k.venue, symbol: str(i.base) || k.symbol, name: str(i.name), kind: str(i.kind),
      currency: str(i.currency) || null, ...(str(i.nameLocal) ? { nameLocal: i.nameLocal } : {}),
    });
    quotes[i.key] = { price: number(i.price), change_pct: number(i.changePct24h) };
  }
  return { hits, quotes };
}

/** A venue's status (a ranking's, or one the face set itself) as the provider list the screens read: one provider, `market` the
 *  venue's (China's `cn`); [] for none. A status the face set for the market not answering (`notAnswering: true`) keeps that flag, so
 *  the host knows it by its code, never by its words. @param {string} venue @param {unknown} status */
export function localProviderOf(venue, status) {
  if (!Object.hasOwn(MARKET_OF, venue) || !isRecord(status) || !(str(status.state) in PROVIDER_STATUS)) return [];
  const provider = { id: PROVIDER_ID[venue], market: MARKET_OF[venue], status: PROVIDER_STATUS[status.state], said: isLine(status.said, { empty: true }) ? status.said : '' };
  return [status.notAnswering === true ? { ...provider, notAnswering: true } : provider];
}
/** The venue a provider's market is (`cn` → china), else null. */
export const venueOfMarket = market => Object.keys(MARKET_OF).find(v => MARKET_OF[v] === market) ?? null;
