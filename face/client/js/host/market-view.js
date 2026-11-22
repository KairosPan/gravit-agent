// face/client/js/host/market-view.js — the Markets screen's pure view. The Account's markets (spec 2026-10-22 §6.1): its explore
// reads — All's, and a tab's own — as the table: its tabs, its sorts and the one in effect, the read its rows are from, and the
// rows, each with its figures by kind (an event in cents, Kalshi's volume in contracts, a pre-IPO perpetual's implied valuation),
// the price it shows, where that price is from in the Account's own words with its age, its lines across venues with the best
// marked — beside the face's own A-share (cn:) rows; a market's page with its words, its history's state, what is held, working
// and stated for it, and the read each of those stands on; one compact word for a volume; what Hand to gravit says of a market.
// No image URL the Account names (`icon`) is in anything returned here: the face's page never loads a third party's image. And
// the face's own ids and words for the A shares (spec 2026-10-19 §7 Stage 2), every word in English from the wire's enums. The
// wire's own text (a quote's message, a provider's message, a search note, a source name) is Chinese and never reaches a word
// here. No DOM.
import { normalizeAsset, number } from '../wire/market-model.js';
import { CHINA_VENUE, isCnKey, isChiNext, cnHitsOf } from '../wire/china.js';
import { localKeyOf, isLocalKey, localHitsOf, LOCAL_NAMES, SHARE_VENUES } from '../wire/local.js';
import { optionKeyOf, OPTION_COINS } from '../wire/options.js';
import { computeKeyOf, isComputeKey, computeRangeOf, COMPUTE_RANGES, ORNN } from '../wire/compute.js';
import { localAmount } from '../market-fmt.js';
import { MIN, HOUR, DAY, fmtDate } from '../time.js';
import { pageOk, assetsOf, positionsOf, openOrdersOf, statementLinesOf, worthOf } from './account-view.js';
import { t, isSaid, sayOf } from '../i18n/words.js';

// the Account's tabs, in the order Trade draws them, the sorts its rows take, and the ranges a market's history is read for;
// the tabs' and the sorts' words are read from the table at each call (accountTabs, accountSorts)
export const ACCOUNT_TAB_IDS = ['all', 'crypto', 'stocks', 'indices', 'commodities', 'fx', 'rwas', 'perps', 'preipo', 'predictions'];
export const ACCOUNT_SORT_IDS = ['volume', 'movers', 'closing'];
export const CANDLE_RANGES = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'MAX'];

// ── Markets by underlying (spec 2026-11-19 G1–G8, §5.3): the tabs, Region, Form and Source, and the main sources ──

/** The Markets screen's tabs, fixed (G1): the Watchlist, then one tab an underlying; a non-Watchlist tab's id is its asset. */
export const MARKET_TABS = ['watchlist', 'crypto', 'stocks', 'indices', 'commodities', 'compute', 'fx', 'preipo', 'macro'];
/** The regions (G2): those read now, then those piece 2 brings (greyed). Only Stocks and Indices take a region. */
export const REGIONS = {
  stocks: ['us', 'cn', 'hk', 'jp', 'kr', 'tw', 'in'],
  indices: ['us', 'cn', 'hk', 'jp', 'kr', 'tw', 'in', 'eu'],
  later: { stocks: ['eu'] },
};
/** The forms (G3), all read now; Options (spec 2026-11-22 §5.4) is the market's own read of option chains, not a source's form. */
export const FORMS = { live: ['spot', 'perp', 'token', 'event', 'option'], later: [] };
const REGIONED = new Set(['stocks', 'indices']);
/** Each tab's main sources and the further ones "All sources" adds (spec §2's table), by tab, Stocks by region. */
export const TAB_SOURCES = {
  crypto: { main: ['hyperliquid'], also: ['coinbase', 'kraken', 'okx', 'binance', 'bybit', 'kalshi', 'polymarket'] },
  'stocks:us': { main: ['cboe'], also: ['trade-xyz', 'robinhood-stock-tokens', 'xstocks', 'ondo-stocks'] },
  'stocks:cn': { main: ['china'], also: [] },
  indices: { main: ['trade-xyz'], also: ['kalshi'] },
  commodities: { main: ['trade-xyz'], also: [] },
  // Compute's events (its Event form): the event sources, as Macro's; its Spot is Ornn's indices, the market's own read (no source)
  compute: { main: ['kalshi', 'polymarket'], also: ['polymarket-us'] },
  fx: { main: ['trade-xyz'], also: [] },
  preipo: {
    main: ['hyperliquid-preipo', 'trade-xyz'],
    also: ['okx-preipo', 'gate-preipo', 'krakenfutures-preipo', 'deribit-preipo', 'kucoinfutures-preipo', 'mexc-preipo', 'binance-preipo', 'bybit-preipo', 'kalshi', 'polymarket'],
  },
  macro: { main: ['kalshi', 'polymarket'], also: ['polymarket-us'] },
};
const PERP = ['perp'], SPOT = ['spot'], TOKEN = ['token'], EVENT = ['event'];
/** What each source carries, by form: the face reads it here, never from the rows (G3: a second, formless read otherwise). */
export const SOURCE_FORMS = {
  hyperliquid: PERP, 'trade-xyz': PERP,
  'hyperliquid-preipo': PERP, 'okx-preipo': PERP, 'gate-preipo': PERP, 'krakenfutures-preipo': PERP, 'deribit-preipo': PERP,
  'kucoinfutures-preipo': PERP, 'mexc-preipo': PERP, 'binance-preipo': PERP, 'bybit-preipo': PERP,
  cboe: SPOT, china: SPOT, coinbase: SPOT, kraken: SPOT, okx: SPOT, binance: SPOT, bybit: SPOT,
  'robinhood-stock-tokens': TOKEN, xstocks: TOKEN, 'ondo-stocks': TOKEN,
  kalshi: EVENT, polymarket: EVENT, 'polymarket-us': EVENT,
};
// a tab whose main sources are one venue under one name (Pre-IPO: trade.xyz is a Hyperliquid deployer, spec §2)
const MAIN_FAMILY = { preipo: 'hyperliquid' };
const MARKET_ROWS = 200;           // the explore rows a tab's read asks for
const RANK_LIMIT = 20;             // China A's ranking rows (host/markets.js RANK_ROWS)

const tabOf = m => (MARKET_TABS.includes(m?.tab) ? m.tab : 'watchlist');
const regionOf = m => (REGIONED.has(tabOf(m)) && REGIONS[tabOf(m)].includes(m?.region) ? m.region : 'us');
// on a non-US region the Form is Spot or Perp, Spot when none is stored (spec §5.4); elsewhere the stored form or none
const nonUs = m => REGIONED.has(tabOf(m)) && regionOf(m) !== 'us';
// Options are on Crypto and on US stocks; no other tab, no other region lists a chain (spec 2026-11-22 §5.4)
const optionsHere = m => tabOf(m) === 'crypto' || (tabOf(m) === 'stocks' && regionOf(m) === 'us');
// Compute (spec 2026-11-22-markets-compute §5) is Spot (Ornn's indices) and Event (the questions on them) alone
const COMPUTE_FORMS = ['spot', 'event'];
const formOf = m => (nonUs(m) ? (m?.form === 'perp' ? 'perp' : 'spot')
  : tabOf(m) === 'compute' ? (COMPUTE_FORMS.includes(m?.form) ? m.form : '')
  : m?.form === 'option' ? (optionsHere(m) ? 'option' : '') : FORMS.live.includes(m?.form) ? m.form : '');
/** Whether the view is on option chains: its Source is the one fixed entry naming the option venues. */
export const onOptions = m => formOf(isRecord(m) ? m : {}) === 'option';
/** Whether the view is on Compute with its Source fixed: Spot (Ornn's indices, the market's own read, no source) or no form (the indices
 *  and the questions on them, which no source list may narrow); on Event the event sources are picked as Macro's. */
export const computeFixed = m => tabOf(m) === 'compute' && formOf(isRecord(m) ? m : {}) !== 'event';
// a share's currency by its venue, when no read names it
const VENUE_CURRENCY = { hk: 'HKD', kr: 'KRW', tw: 'TWD' };
/** The region's own read the view is on (spec §5.6): Stocks cn/hk/kr/tw on Spot, its share venue; Indices on Spot (any region),
 *  `ix`; else null (Japan and India on Spot have no source: the generic read, no rows). */
export function onLocal(m) {
  const tab = tabOf(m);
  if (!REGIONED.has(tab) || formOf(m) !== 'spot') return null;
  const region = regionOf(m);
  if (tab === 'indices') return { venue: 'ix', region };
  return SHARE_VENUES[region] ? { venue: SHARE_VENUES[region], region } : null;
}
/** Stocks › China A: the Tencent ranking, not an explore read. */
export const onChinaA = m => onLocal(m)?.venue === 'china';
/** Stocks on Japan or India › Spot: no free source lists those shares (their perps are under Perp). */
export const noSpotSource = m => tabOf(m) === 'stocks' && ['jp', 'in'].includes(regionOf(m)) && formOf(m) === 'spot';
/** The empty state's line on Japan and India › Spot, or null elsewhere. */
export const noSpotSourceWord = m => (noSpotSource(m) ? t('markets.empty.noSpotSource') : null);
// a venue's source by name; the indices' (each row naming its own) in the table's word
// the option venues' names, one entry (Crypto: Deribit and OKX; Stocks: Nasdaq)
const optionVenues = m => (tabOf(m) === 'crypto' ? t('markets.option.venuesCrypto') : t('markets.option.venuesStocks'));
const localName = venue => (venue === 'ix' ? t('markets.tab.indices') : LOCAL_NAMES[venue] ?? '');
const sourcesOfTab = m => {
  const tab = tabOf(m);
  if (tab === 'watchlist') return { main: [], also: [] };
  // a non-US region's perps (Stocks or Indices, China A too) are trade.xyz's; its Spot is a read of its own, never a registered source (spec §5.6)
  if (nonUs(m)) return { main: ['trade-xyz'], also: [] };
  return TAB_SOURCES[tab === 'stocks' ? `stocks:${regionOf(m)}` : tab] ?? { main: [], also: [] };
};
const familyKey = id => id.replace(/-preipo$/, '');
const registryOf = m => new Map(records(m?.sources?.data?.value)
  .filter(s => typeof s.id === 'string' && typeof s.name === 'string' && s.name.trim()).map(s => [s.id, s.name.trim()]));
// a family's name: the registry's for the plain id, else its -preipo source's without " Pre-IPO", else the id
function familyLabel(id, registry) {
  if (registry.has(id)) return registry.get(id);
  const pre = registry.get(`${id}-preipo`);
  return pre ? pre.replace(/\s*Pre-IPO$/i, '') || id : id;
}

/** The tab's source families (G4): one a venue (an id and its -preipo sibling one family, its id the plain one), the main
 *  family or families first; named from the registry's read, by id when there is none. */
export function familiesOf(markets) {
  const m = isRecord(markets) ? markets : {};
  // a view on a region's own read: its one source, by name, fixed
  const local = onLocal(m);
  if (local) return [{ id: local.venue, label: localName(local.venue), ids: [local.venue], main: true }];
  if (onOptions(m)) return [{ id: 'options', label: optionVenues(m), ids: [], main: true }];
  // Compute on Spot: Ornn alone; with no form, Ornn and the event sources the market's own search reads
  if (computeFixed(m)) return [formOf(m) === 'spot' ? { id: 'ornn', label: ORNN, ids: ['ornn'], main: true } : { id: 'compute', label: t('markets.compute.sources'), ids: [], main: true }];
  const { main, also } = sourcesOfTab(m);
  const registry = registryOf(m);
  const out = new Map();
  const add = (key, id, isMain) => {
    const was = out.get(key);
    if (was) { if (!was.ids.includes(id)) was.ids.push(id); return; }
    out.set(key, { id: key, label: familyLabel(key, registry), ids: [id], main: isMain });
  };
  const folded = MAIN_FAMILY[tabOf(m)];
  for (const id of main) add(folded ?? familyKey(id), id, true);
  for (const id of also) add(familyKey(id), id, false);
  return [...out.values()];
}

// the source ids the Source in effect reads: Main the main ids, All sources main and also, a family its own
function selectedIds(m) {
  const { main, also } = sourcesOfTab(m);
  const source = typeof m?.source === 'string' ? m.source : 'main';
  if (source === 'all') return [...main, ...also];
  if (source === 'main') return main;
  return familiesOf(m).find(f => f.id === source)?.ids ?? main;
}
// Options on a tab that lists chains, under any Source (the market reads them itself, no source of the tab carries them)
const withOptions = (m, forms) => (nonUs(m) || !optionsHere(m) ? forms : [...forms, 'option']);
const formsOfIds = ids => FORMS.live.filter(f => ids.some(id => (SOURCE_FORMS[id] ?? []).includes(f)));
// a non-US region on Stocks or Indices is Spot and Perp alone (spec §5.4); Indices › US also gains Spot, the cash levels
// Compute is Spot (its indices, no source's) and its sources' Event
const inRegion = (m, forms) => (nonUs(m) ? ['spot', 'perp'] : tabOf(m) === 'compute' ? ['spot', ...forms.filter(f => f === 'event')]
  : tabOf(m) === 'indices' && !forms.includes('spot') ? ['spot', ...forms] : forms);
/** The forms the main sources carry (a Form outside them switches Source to All sources, G4). */
export const mainFormsOf = markets => withOptions(markets, inRegion(markets, formsOfIds(sourcesOfTab(markets).main)));
/** The forms a Form pick may take now (G3): under Main or All sources every form the tab's sources carry, under a family its
 *  own; China A spot alone. */
export function formsInView(markets) {
  const m = isRecord(markets) ? markets : {};
  if (tabOf(m) === 'watchlist') return [];
  // on an options view the Source is the fixed one: the other forms judge the Main sources
  const source = onOptions(m) ? 'main' : typeof m.source === 'string' ? m.source : 'main';
  const { main, also } = sourcesOfTab(m);
  return withOptions(m, inRegion(m, formsOfIds(source === 'main' || source === 'all' ? [...main, ...also] : selectedIds({ ...m, source }))));
}
/** The forms the Source in effect carries: a Form outside them would empty the table. */
export const formsOfSource = markets => {
  const m = isRecord(markets) ? markets : {};
  return withOptions(m, inRegion(m, formsOfIds(selectedIds(onOptions(m) ? { ...m, source: 'main' } : m))));
};
/** Whether `v` is a Source value of the tab: Main, All sources, or one of its families. */
export const isSourceOf = (markets, v) => v === 'main' || v === 'all' || familiesOf(markets).some(f => f.id === v);

const sortOf = m => (ACCOUNT_SORT_IDS.includes(m?.sort) ? m.sort : 'volume');
/** The explore read the tab on screen takes, or null on Stocks › China A (its ranking, rankQueryOf): the Watchlist the
 *  unscoped read; a tab its asset, the sort, its region (Stocks, Indices), its form and the source ids the Source selects
 *  (All sources the tab's whole list, never none; region cn none, as the market asks). */
export function exploreQueryOf(markets) {
  const m = isRecord(markets) ? markets : {};
  const tab = tabOf(m);
  if (tab === 'watchlist') return `limit=${MARKET_ROWS}`;
  if (onLocal(m)) return null;
  // the options read: the market's own, by underlying; no source (its venues are fixed), the region only on Stocks; sorted by volume or
  // movers alone (the market refuses Closing soonest, kept from an Event view: then by volume)
  if (onOptions(m)) return `asset=${tab}&form=option&sort=${sortOf(m) === 'movers' ? 'movers' : 'volume'}&limit=${MARKET_ROWS}${tab === 'stocks' ? '&region=us' : ''}`;
  // Compute on Spot or with no form: the market's own read of Ornn's indices, no source, by Most traded or Biggest moves alone (it refuses
  // Closing soonest wherever spot rows are in the answer, kept from Event: then by volume); on Event the generic path below
  if (computeFixed(m)) return `asset=compute&sort=${sortOf(m) === 'movers' ? 'movers' : 'volume'}&limit=${MARKET_ROWS}${formOf(m) ? '&form=spot' : ''}`;
  const form = formOf(m) ? `&form=${formOf(m)}` : '';
  const region = REGIONED.has(tab) ? `&region=${regionOf(m)}` : '';
  // a non-US region names no public source on Spot (the market refuses one beside it, reads.ts): the class alone, which answers
  // its empty state; its Perp is trade.xyz's, filtered by region
  const source = nonUs(m) ? (formOf(m) === 'perp' ? '&source=trade-xyz' : '') : `&source=${selectedIds(m).join(',')}`;
  return `asset=${tab}&sort=${sortOf(m)}&limit=${MARKET_ROWS}${region}${form}${source}`;
}
/** The query the connected half takes: under All sources the tab's class with no source list, so every connected line of
 *  the class shows (spec §5.2; the join then rules the public lines alone, `allSources`); none (null) on an options view, which
 *  no connected venue lists; otherwise exploreQueryOf's. */
export function connectedQueryOf(markets) {
  // no connected venue lists an option chain: the options read is the market's alone
  if (onOptions(markets)) return null;
  // nor an index: Compute's Spot and its formless read are the market's alone (its Event is asked as Macro's)
  if (computeFixed(markets)) return null;
  const query = exploreQueryOf(markets);
  if (query === null || tabOf(markets) === 'watchlist' || markets?.source !== 'all') return query;
  const p = new URLSearchParams(query);
  p.delete('source');
  return decodeURIComponent(p.toString());
}
/** A region's own ranking read (null off one): by Biggest moves or Most traded, never Closing soonest (China refuses it). */
const rankQuery = (asset, region, markets) => `asset=${asset}&form=spot&region=${region}&sort=${markets?.sort === 'movers' ? 'movers' : 'volume'}&limit=${RANK_LIMIT}`;
export function rankQueryOf(markets) {
  const local = onLocal(markets);
  return local ? rankQuery(local.venue === 'ix' ? 'indices' : 'stocks', local.region, markets) : null;
}
/** China A's ranking read whatever the view is on: the host reads China's state off it from another screen. */
export const chinaRankQueryOf = markets => rankQuery('stocks', 'cn', markets);
// a query without its sort: a sort change keeps the rows drawn while its own read is asked
const unsorted = query => { const p = new URLSearchParams(query); p.delete('sort'); return p.toString(); };

const regionWords = () => ({
  us: t('markets.region.us'), cn: t('markets.region.cn'), hk: t('markets.region.hk'), jp: t('markets.region.jp'),
  kr: t('markets.region.kr'), tw: t('markets.region.tw'), in: t('markets.region.in'), eu: t('markets.region.eu'),
});
const formWords = () => ({
  '': t('markets.form.all'), spot: t('markets.form.spot'), perp: t('markets.form.perp'), token: t('markets.form.token'),
  event: t('markets.form.event'), option: t('markets.form.option'),
});
/** A region's word (Hong Kong, Korea…), else its id. */
export const regionWord = id => regionWords()[id] ?? id;
const formWord = id => formWords()[id ?? ''] ?? id;
const mainWord = m => t('markets.source.main', { names: familiesOf(m).filter(f => f.main).map(f => f.label).join(' + ') });
function sourceWordOfState(m) {
  const source = typeof m.source === 'string' ? m.source : 'main';
  if (source === 'all') return t('markets.source.all');
  if (source === 'main') return mainWord(m);
  return familiesOf(m).find(f => f.id === source)?.label ?? mainWord(m);
}

/** The filters the tab draws (G2–G4), or null on the Watchlist (none there, G6): Region on Stocks and Indices (piece 2's
 *  greyed), Form (one a selection does not carry greyed "none here", Options greyed piece 3), Source (Main · names, All
 *  sources, then the families, the main first), and a chip for a Form set and for a Source other than Main. */
export function filtersOf(markets) {
  const m = isRecord(markets) ? markets : {};
  const tab = tabOf(m);
  if (tab === 'watchlist') return null;
  const inView = formsInView(m);
  const form = formOf(m);
  const chipForm = nonUs(m) ? (m.form === 'perp' ? 'perp' : '') : form;
  const source = isSourceOf(m, m.source) ? m.source : 'main';
  const sourceLabel = sourceWordOfState({ ...m, source });
  // on Indices Spot is a cash index's level, not a share: its own word
  // and on Compute an index's settle: Spot
  const formLabel = id => ((tab === 'indices' || tab === 'compute') && id === 'spot' ? t('markets.form.spotIndex') : formWord(id));
  return {
    ...(REGIONED.has(tab) ? {
      region: {
        value: regionOf(m),
        options: [
          ...REGIONS[tab].map(id => ({ id, label: regionWord(id), disabled: false, note: null })),
          ...(REGIONS.later[tab] ?? []).map(id => ({ id, label: regionWord(id), disabled: true, note: t('markets.filter.noEuShares') })),
        ],
      },
    } : {}),
    form: {
      value: form,
      label: formLabel(form),
      options: [
        ...(nonUs(m) ? [] : [{ id: '', label: formLabel(''), disabled: false, note: null }]),
        ...(nonUs(m) ? inView : FORMS.live).map(id => ({ id, label: formLabel(id), disabled: !inView.includes(id), note: inView.includes(id) ? null : t('markets.filter.noneHere') })),
      ],
    },
    source: {
      value: source,
      label: sourceLabel,
      options: [
        { id: 'main', label: mainWord(m), main: false },
        { id: 'all', label: t('markets.source.all'), main: false },
        ...familiesOf(m).map(f => ({ id: f.id, label: f.label, main: f.main })),
      ],
    },
    chips: [
      ...(chipForm ? [{ kind: 'form', label: formLabel(chipForm) }] : []),
      ...(source !== 'main' ? [{ kind: 'source', label: sourceLabel }] : []),
    ],
  };
}

/** The market a line belongs to, independent of a connected account's display name. The colon after a CCXT settlement
 *  pair (BTC/USDC:USDC) is not a HIP-3 prefix; other deployers are never presented as native Hyperliquid or trade.xyz. */
export function marketOriginOf(leg) {
  const venue = typeof leg?.venue === 'string' ? leg.venue : '';
  const connector = typeof leg?.connector === 'string' ? leg.connector : '';
  const symbol = typeof leg?.symbol === 'string' ? leg.symbol : '';
  if (venue === 'trade-xyz') return 'xyz';
  if (leg?.paper === true && connector === 'live:paper' && typeof leg.dex === 'string') return leg.dex === 'xyz' ? 'xyz' : leg.dex === '' ? 'hyperliquid' : null;
  const hl = /^hyperliquid(?:-(?:preipo|trade|paper))?$/.test(venue) || /^live:hyperliquid(?:-(?:trade|paper))?$/.test(connector);
  if (!hl) return null;
  if (typeof leg?.dex === 'string') return leg.dex === 'xyz' ? 'xyz' : leg.dex === '' ? 'hyperliquid' : null;
  if (/^xyz[:-]/i.test(symbol)) return 'xyz';
  // CCXT HIP-3 symbols use DEX-COIN/QUOTE:SETTLE. Without explicit metadata, an unrecognised deployer gets no native badge.
  if (/^[a-z0-9]+-[^/]+\/[^/]+:[^/]+$/i.test(symbol)) return null;
  if (/^[a-z0-9]+:/i.test(symbol) || venue === 'hyperliquid-preipo') return null;
  return 'hyperliquid';
}

const tabWords = () => ({
  all: t('markets.tab.all'), crypto: t('markets.tab.crypto'), stocks: t('markets.tab.stocks'), rwas: t('markets.tab.rwas'),
  indices: t('markets.tab.indices'), commodities: t('markets.tab.commodities'), fx: t('markets.tab.fx'),
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

// the ranges each local market's source reads, and the one a page opens on: Korea's and the indices' daily history alone (no
// intraday chart), Taiwan's up to a year, Hong Kong's minutes for one day (no five-day) and its daily bars; China's every range
const LONG_RANGES = ['1M', '3M', '6M', 'YTD', '1Y', '5Y', 'MAX'];
const LOCAL_RANGES = { hk: ['1D', ...LONG_RANGES], kr: LONG_RANGES, ix: LONG_RANGES, tw: ['1M', '3M', '6M', 'YTD', '1Y'] };
const LOCAL_FIRST_RANGE = { hk: '1D', kr: '3M', ix: '3M', tw: '3M' };
/** The ranges a local key's market reads (a Hong Kong, Korean or Taiwanese share's, an index's), in CANDLE_RANGES's order; every
 *  range for any other key. @param {unknown} id */
export function localRangesOf(id) {
  const venue = localKeyOf(id)?.venue;
  return venue && Object.hasOwn(LOCAL_RANGES, venue) ? LOCAL_RANGES[venue] : CANDLE_RANGES;
}
/** The range a page's chart is drawn at: `kept` when its market reads it, else the market's first (3M for Korea, Taiwan and the
 *  indices, 1D for Hong Kong and every other key). */
export function localRangeOf(id, kept) {
  const ranges = localRangesOf(id);
  if (typeof kept === 'string' && ranges.includes(kept)) return kept;
  const venue = localKeyOf(id)?.venue;
  return venue && Object.hasOwn(LOCAL_FIRST_RANGE, venue) ? LOCAL_FIRST_RANGE[venue] : '1D';
}
/** A local page's range seg items, `[label, id]`: its market's ranges alone. */
export const localCandleRanges = id => { const ranges = localRangesOf(id); return candleRanges().filter(([, r]) => ranges.includes(r)); };

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
  return status ? `${name} · ${status}` : name; // words-order: a provider and its status under the visual separator
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

/** A count in a compact word: 1.2k, 3.4M, 950. */
export const compactNumber = value => compact(value);
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
  // a share's turnover in its own currency (Hong Kong, Korea, Taiwan): its mark before it (HK$4.8B), never a dollar sign
  if (priced.volumeUnit === 'local') return localAmount(volume, typeof priced.currency === 'string' && priced.currency ? priced.currency : null);
  return `$${compact(volume)}`;
}

/** The watchlist's words: this browser's store's (`read`, `unsaved`, `full`), else the Account's own sentence when it refused
 *  a setWatch (host/markets.js keeps it as the error); nothing else. */
export function watchWord(error) {
  if (isSaid(error)) return sayOf(error);
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

// the ranking kept, when it is the one the view on screen reads: read for its query (its sort aside), or — one that names none, as
// China's always did — on Stocks › China A
function rankFits(data, m) {
  const query = rankQueryOf(m);
  if (query === null || !isRecord(data)) return false;
  return typeof data.query === 'string' ? unsorted(data.query) === unsorted(query) : onChinaA(m);
}
// a share's currency as the row's unit (`hkd`), USD's when it names none
const CURRENCY_UNITS = { CNY: 'cny', HKD: 'hkd', KRW: 'krw', TWD: 'twd' };

/** A region's own rows (spec 2026-11-20 §5.6): the ranking's items in its order, when the read is for the view on screen and the sort
 *  in effect (no rows of another region, nor in another sort's order). An A share as China's rows always were — its board, its star
 *  (cnStarsOf's: the Account keys starred, the page's china entries `atPage` names, an old cn star not yet moved); a Hong Kong, Korean
 *  or Taiwanese share its code and its local name, its price and turnover in its currency (`currency`, `unit`); a cash index its
 *  level, change and change %, no currency. No star on any but an A share (spec §2 non-goal). */
export function localRowsOf(markets, atPage = []) {
  const m = isRecord(markets) ? markets : {};
  const data = rankOf(m);
  const sort = m.sort === 'movers' ? 'movers' : 'volume';
  const local = onLocal(m);
  if (!data || !local || data.sort !== sort || !rankFits(data, m)) return [];
  const venue = local.venue;
  const starred = venue === 'china' ? new Set(cnStarsOf(m, atPage)) : new Set();
  return records(data.items).filter(i => localKeyOf(str(i.id))?.venue === venue).map(i => {
    const symbol = str(i.symbol) || localKeyOf(i.id).symbol;
    const name = str(i.name) || symbol;
    const row = {
      id: i.id, live: null, closeTime: null, pastEnd: false, paper: false, atAccount: false, legs: [],
      tabs: [venue === 'china' ? CHINA_TAB : venue], form: 'spot', region: local.region,
    };
    if (venue === 'china') {
      const priced = { price: number(i.price), unit: 'cny', changePct: number(i.change_pct), change24h: null, volume: number(i.turnover), volumeUnit: 'yuan', implied: null };
      return {
        ...row, source: 'china', kind: 'stock', name, tile: cnTileOf(str(i.name), symbol), sub: `${symbol} · ${cnBoardOf(symbol)}`,
        priced, price: priced.price, sourceWord: TENCENT, watched: starred.has(i.id),
      };
    }
    const sourceWord = str(i.quote_from) || localName(venue);
    if (venue === 'ix') {
      const priced = { price: number(i.price), unit: 'level', changePct: number(i.change_pct), change24h: number(i.change), volume: null, volumeUnit: 'none', implied: null };
      return {
        ...row, source: 'local', kind: 'index', name, tile: Array.from(name)[0] ?? symbol, sub: symbol.toUpperCase(),
        priced, price: priced.price, sourceWord, watched: false, noStar: true, unit: 'level', currency: null,
      };
    }
    const currency = str(i.currency) || null;
    const unit = CURRENCY_UNITS[currency] ?? 'usd';
    const priced = { price: number(i.price), unit, changePct: number(i.change_pct), change24h: null, volume: number(i.turnover), volumeUnit: 'local', currency, implied: null };
    const nameLocal = str(i.name_local);
    return {
      ...row, source: 'local', kind: 'share', name, tile: Array.from(name)[0] ?? symbol,
      sub: [symbol, nameLocal].filter(Boolean).join(' · '), // words-order: a code and its local name under the visual separator
      code: symbol, nameLocal: nameLocal || null, priced, price: priced.price, sourceWord, watched: false, noStar: true, unit, currency,
    };
  });
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
const sourced = (from, at, now) => { const age = ageWords(at, now); return age ? `${from} · ${age}` : from; }; // words-order: a source and its age under the visual separator

/** Where a row's price is from, in the Account's own words: the row's `quoteFrom` (`Robinhood · real time`, `Cboe · 15 min
 *  delayed`), else the venue its 24h change is from (`changeFrom`); else the first venue the owner connected that lists it —
 *  that line's `quoteFrom`, else its name; else nothing — never a public listing's line for itself. With the price's age
 *  (`· 2 min ago`) once its `quoteAt` — the row's, else that line's — is more than five seconds old. */
export function sourceWordOf(item, now = Date.now()) {
  const it = isRecord(item) ? item : {};
  const stamp = typeof it.quoteAt === 'string' ? it.quoteAt : undefined;
  const rowWord = str(it.quoteFrom).trim() || (isRecord(it.changeFrom) ? str(it.changeFrom.venueName).trim() : '');
  if (rowWord) return sourced(rowWord, stamp, now);
  const line = records(it.at).find(l => l.connected === true);
  const lineWord = line ? str(line.quoteFrom).trim() || str(line.venueName).trim() : '';
  return lineWord ? sourced(lineWord, stamp ?? line.quoteAt, now) : '';
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
    ...(typeof l.dex === 'string' ? { dex: l.dex } : {}),
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
const displayBase = item => str(item.base).replace(/^[a-z0-9]+:/i, '');
const tileOf = item => (item.kind === 'event' ? str(item.category) || t('markets.tile.event') : displayBase(item) || str(item.name));
// The aggregator synthesizes `<base> perp` (G7). Its namespace belongs to the identity and source badge, not the title.
// Only that exact generated form is shortened; a market's supplied name remains verbatim.
function displayName(item) {
  const base = str(item.base);
  const name = str(item.name);
  const dex = base.match(/^([a-z0-9]+):/i)?.[1];
  const recognized = dex && records(item.at).some(l => l.dex === dex || (dex === 'xyz' && marketOriginOf(l) === 'xyz'));
  return item.kind === 'perp' && recognized && name === base + ' perp' ? name.slice(dex.length + 1) : name;
}
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
const locatedRowsOf = m => Object.values(isRecord(m.located) ? m.located : {}).flatMap(r => everyRow(own(r, 'data')));
const exploreRowsOf = m => [...Object.values(isRecord(m.explore) ? m.explore : {}).map(r => own(r, 'data')), m.results?.data].flatMap(everyRow).concat(locatedRowsOf(m));
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
  const base = displayBase(item);
  switch (item.kind) {
    case 'perp': return isPreipo(item) ? t('markets.sub.preipoPerp') : base ? t('markets.sub.basePerp', { base }) : t('markets.kind.perp');
    case 'event': return str(item.category);
    case 'coin': return base;
    case 'stock': case 'rwa': return (legs.find(l => l.connected) ?? legs.find(l => l.public))?.venueName ?? '';
    default: return '';
  }
}

// where a row's price is from: the live quote's own source and stamp where it names one, else the item's
const wordOf = (item, live, now) => { const from = str(live?.quoteFrom).trim(); return from ? sourced(from, live.quoteAt, now) : sourceWordOf(item, now); };

// `atAccount`: starred on the Account's own list alone, never the face's
function accountRow(item, quotes, watched, now, atAccount = false) {
  const legs = legsOf(item);
  const pair = pairOf(legs);
  const quote = pair ? own(quotes, pair) : undefined;
  const live = isRecord(quote) ? noIcon(quote) : null;
  const priced = priceOf(item);
  return {
    id: str(item.key), source: 'account', kind: str(item.kind), name: displayName(item), tile: tileOf(item), sub: subOf(item, legs),
    priced, price: shownPrice(live, priced), live, sourceWord: wordOf(item, live, now),
    closeTime: str(item.closeTime) || null, pastEnd: item.pastEnd === true, paper: legs.find(l => l.connected)?.paper === true, watched, atAccount, legs,
    tabs: Array.isArray(item.tabs) ? item.tabs.filter(tab => typeof tab === 'string') : [],
    asset: str(item.asset) || null, form: str(item.form) || null, region: str(item.region) || null,
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
    watched, atAccount, legs: [], tabs: ['all'], form: 'spot', region: 'cn',
  };
}

// a search's Hong Kong, Korean or Taiwanese share, or its cash index (localHitsOf's hit and its price): drawn as its region's ranking
// row is, no star, its class its tab's
function localHitRow(hit, quote) {
  const index = hit.venue === 'ix';
  const symbol = index ? hit.symbol.slice(hit.symbol.indexOf(':') + 1) : hit.symbol;
  const name = hit.name || symbol;
  const currency = index ? null : hit.currency ?? VENUE_CURRENCY[hit.venue] ?? null;
  const unit = index ? 'level' : CURRENCY_UNITS[currency] ?? 'usd';
  const priced = { price: number(quote?.price), unit, changePct: number(quote?.change_pct), change24h: null, volume: null, volumeUnit: index ? 'none' : 'local', currency, implied: null };
  return {
    id: hit.id, source: 'local', kind: index ? 'index' : 'share', name, tile: Array.from(name)[0] ?? symbol,
    sub: index ? symbol.toUpperCase() : [symbol, hit.nameLocal].filter(Boolean).join(' · '), // words-order: a code and its local name under the visual separator
    priced, price: priced.price, live: null, sourceWord: str(hit.quoteFrom) || localName(hit.venue), closeTime: null, pastEnd: false, paper: false, watched: false,
    atAccount: false, noStar: true, legs: [], tabs: [hit.venue], asset: index ? 'indices' : 'stocks', form: 'spot', unit, currency,
  };
}

// ── the option chains (spec 2026-11-22 §5.4): a row an underlying, its figures the market's (`item.option`); a chain's page ──

// an expiry (`2026-11-28`) as a short date (Nov 28), its own calendar day whatever the zone; '' for none
export function expiryWord(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(day));
  return m ? fmtDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime()) : '';
}
/** The units a leg is priced in dollars by: Nasdaq's USD, a linear option's USDC or USDT. */
export const DOLLAR_UNITS = new Set(['USD', 'USDC', 'USDT']);
const OPTION_VENUE_NAMES = { deribit: 'Deribit', okx: 'OKX', nasdaq: 'Nasdaq' }; // en-kept: the venues' names
const optionVenueName = v => (v === 'nasdaq' ? t('markets.option.venuesStocks') : OPTION_VENUE_NAMES[v] ?? v);
// a compact count: 1.2k, 3.4M
const counted = v => (v === null ? null : compact(v));
/** An option row (an explore item of kind optionChain) as the table draws it: its underlying's price and day change, its volume —
 *  dollars where the market gives them, else contracts — and its open interest (a coin's in the coin, a US ticker's in contracts), its
 *  nearest expiry and the ATM IV, each a word ('' for none); a US row's figures are its nearest expiry's (`nearestOnly`). No star. */
function optionRowOf(item) {
  const o = isRecord(item.option) ? item.option : {};
  const base = str(item.base) || str(item.key).slice(4);
  const crypto = str(item.category || item.asset) === 'crypto';
  const usd = number(o.volumeUsd);
  const volume = number(o.volume);
  const priced = {
    price: number(item.price), unit: 'usd', changePct: number(item.changePct24h), change24h: null,
    volume: usd ?? volume, volumeUnit: usd !== null ? 'usd' : 'contracts', implied: null,
  };
  const oi = counted(number(o.openInterest));
  const iv = number(o.atmIv);
  const venues = records(item.at).map(l => str(l.venue)).filter(Boolean);
  return {
    id: str(item.key), source: 'option', kind: 'optionChain', name: t('markets.option.name', { underlying: base }), tile: base,
    // its venues, and on a US row that its figures are its nearest expiry's
    sub: [...new Set(venues.map(optionVenueName)), o.nearestOnly === true ? t('markets.option.nearestOnly') : ''].filter(Boolean).join(' · '), // words-order: the venues' names under the visual separator
    priced, price: priced.price, live: null, sourceWord: str(item.quoteFrom), closeTime: null, pastEnd: false, paper: false,
    watched: false, atAccount: false, noStar: true, legs: [], tabs: [], asset: crypto ? 'crypto' : 'stocks', form: 'option', region: crypto ? null : 'us',
    option: {
      underlying: base, venues, nearestOnly: o.nearestOnly === true, expiry: expiryWord(o.nearestExpiry),
      volume: volumeWordOf(priced),
      openInterest: oi === null ? '' : crypto ? t('markets.option.inCoin', { n: oi, coin: base }) : t('markets.volume.contracts', { n: oi }),
      atmIv: iv === null ? '' : `${iv.toFixed(1)}%`,
    },
  };
}
// a search's option rows, when they answer the query typed now
const optionHitsOf = m => (isRecord(m.optionHits) && str(m.optionHits.q) === str(m.q).trim()
  ? [m.optionHits.crypto, m.optionHits.stocks].flatMap(itemsOf).filter(i => i.kind === 'optionChain' && optionKeyOf(i.key)) : []);
// every option row the slice's reads carry: the options views', a search's
const optionItemsOf = m => [...exploreRowsOf(m), ...optionHitsOf(m)].filter(i => i.kind === 'optionChain');

/** The venues a chain's page reads, `{ crypto, venues }`: a row's (a crypto row's Deribit and OKX, or OKX alone; a US row's Nasdaq),
 *  else a coin's both and any other underlying Nasdaq. */
export function optionVenuesOf(markets, underlying) {
  const m = isRecord(markets) ? markets : {};
  const row = optionItemsOf(m).find(i => i.key === `opt:${underlying}`);
  const listed = records(row?.at).map(l => str(l.venue)).filter(v => Object.hasOwn(OPTION_VENUE_NAMES, v));
  const crypto = row ? str(row.category || row.asset) === 'crypto' : OPTION_COINS.includes(underlying);
  const venues = crypto ? ['deribit', 'okx'].filter(v => (listed.length ? listed.includes(v) : true)) : ['nasdaq'];
  return { crypto, venues: venues.length ? venues : crypto ? ['deribit', 'okx'] : ['nasdaq'] };
}
/** The venue and expiry a chain's page reads: the ones picked on it, else its first venue (Deribit for a coin it lists, Nasdaq for a
 *  US ticker) and the market's nearest expiry (null: none named). */
export function chainPickOf(markets, underlying) {
  const m = isRecord(markets) ? markets : {};
  const { venues } = optionVenuesOf(m, underlying);
  const pick = isRecord(m.chainPick) && m.chainPick.underlying === underlying ? m.chainPick : null;
  const venue = venues.includes(pick?.venue) ? pick.venue : venues[0];
  // an expiry is the venue's it was picked on (none named: the first venue's)
  return { venue, expiry: pick && (pick.venue ?? venues[0]) === venue && str(pick.expiry) ? pick.expiry : null };
}
/** The options read a chain's page asks (`underlying=BTC&venue=deribit[&expiry=2026-11-28]`), else null for an id that is none. */
export function chainQueryOf(markets, id) {
  const key = optionKeyOf(id);
  if (!key) return null;
  const { venue, expiry } = chainPickOf(markets, key.underlying);
  return `underlying=${encodeURIComponent(key.underlying)}&venue=${venue}${expiry ? `&expiry=${expiry}` : ''}`;
}

/** A chain's page (`#/markets/opt:<U>`): its name and its row's price and day change (the chain's price once it answers), the venue
 *  switch (a coin both venues list), the expiry tabs (the chain's, the one read pressed), the strikes — calls | strike | puts, the
 *  at-the-money strike marked, the cells in the money (a call below the price, a put above) marked — and what is said under the price:
 *  the source, the last trade, a partial read's note. The chain kept is drawn only for the venue and expiry asked; else `status` says how
 *  far that read has got, with the market's sentence (`message`) when it refused. Null for an id that is no chain's. */
export function optionPageOf(markets, id) {
  const m = isRecord(markets) ? markets : {};
  const key = optionKeyOf(id);
  if (!key) return null;
  const { underlying } = key;
  const { crypto, venues } = optionVenuesOf(m, underlying);
  const pick = chainPickOf(m, underlying);
  const row = optionItemsOf(m).find(i => i.key === id);
  const kept = isRecord(m.chain) ? m.chain : {};
  const data = isRecord(kept.data) ? kept.data : null;
  const asked = chainQueryOf(m, id);
  // the chain kept is this page's when it is for the underlying, the venue and the expiry asked (the nearest when none is)
  // the chain kept at this underlying and venue, whatever its expiry: its expiry tabs and its price stay drawn while another expiry is
  // read, or after its read failed, so any expiry can be picked again
  const atVenue = data && data.underlying === underlying && data.venue === pick.venue ? data : null;
  const chain = atVenue && (pick.expiry === null || atVenue.expiry === pick.expiry) ? atVenue : null;
  const askedNow = kept.query === asked;
  const status = chain && !(askedNow && kept.status === 'error') ? 'ready' : askedNow ? str(kept.status) || 'idle' : 'idle';
  const message = askedNow && kept.status === 'error' ? (isSaid(kept.message) ? sayOf(kept.message) : str(kept.message)) || null : null;
  const price = (chain ?? atVenue)?.price ?? number(row?.price);
  const atm = chain?.atmStrike ?? null;
  // the money is shaded at the price the at-the-money strike was read at: the expiry's own underlying price where the chain carries
  // one (a crypto chain's), else the chain's price
  const money = chain?.expiryPrice ?? price;
  const rows = (chain?.strikes ?? []).map(s => ({
    strike: s.strike, atm: atm !== null && s.strike === atm, call: s.call, put: s.put,
    callItm: money !== null && s.strike < money, putItm: money !== null && s.strike > money,
  }));
  const unit = (chain?.strikes ?? []).map(s => s.call?.unit || s.put?.unit).find(Boolean) ?? '';
  return {
    // the day change is the row's: a coin's own; a US row's is the US stocks line's, not Nasdaq's last trade drawn beside it, so none
    id, underlying, name: t('markets.option.name', { underlying }), crypto, price, changePct: crypto ? number(row?.changePct24h) : null,
    venues: venues.map(v => ({ id: v, label: optionVenueName(v) })), venue: pick.venue, switchable: crypto && venues.length > 1,
    expiries: (atVenue?.expiries ?? []).map(e => ({ id: e, label: expiryWord(e) })), expiry: pick.expiry ?? atVenue?.expiry ?? null,
    // prices in a coin (an inverse option's) carry their dollars under them; a USD, USDC or USDT leg is dollar-priced
    chain, rows, unit, coinPriced: chain !== null && unit !== '' && !DOLLAR_UNITS.has(unit), status, message, failedOver: chain !== null && kept.status === 'error' && askedNow,
    quoteFrom: str((chain ?? atVenue)?.quoteFrom) || str(row?.quoteFrom), lastTrade: str((chain ?? atVenue)?.lastTrade), note: str(chain?.note),
  };
}

// ── Compute (spec 2026-11-22-markets-compute §5): Ornn's index rows, each priced with its unit; an index's page ──

// an index's unit after its price, in the table's words (`/GPU·hr`, `/M tokens`): the market's unit, else its kind's
const perUnitOf = (unit, gpu) => (unit === '$/GPU·hr' || (unit !== '$/M tokens' && gpu) ? t('markets.compute.perGpuHour') : t('markets.compute.perMTokens'));
// where an index's settle is from, in the table's words: the market's `Ornn · settle <date>` (and its ` · stale`) said in the language on
// screen; any other words of the market's as they came
function computeSourceWord(quoteFrom) {
  const hit = /^Ornn · settle (\d{4}-\d{2}-\d{2})( · stale)?$/.exec(str(quoteFrom));
  if (!hit) return str(quoteFrom) || ORNN;
  const source = t('markets.compute.source', { date: hit[1] });
  return hit[2] ? `${source} · ${t('markets.quote.stale')}` : source; // words-order: a source, then its state, under the visual separator
}
// an index's kind in a word
const indexKind = gpu => (gpu ? t('markets.compute.gpuIndex') : t('markets.compute.tokenIndex'));
/** An index row (an explore item of kind computeIndex) as the table draws it: its name, its kind's word, the latest settle in dollars
 *  (`priced.unit` 'compute') with its unit after it (`perUnit`), the change from the previous settle (none until the market has read the
 *  index's history), where its settle is from; no volume, no star (a view-only index is no market to watch). */
function computeRowOf(item) {
  const k = computeKeyOf(item.key);
  const name = str(item.name) || k.id.toUpperCase();
  const priced = { price: number(item.price), unit: 'compute', changePct: number(item.changePct24h), change24h: number(item.change24h), volume: null, volumeUnit: 'none', implied: null };
  return {
    id: item.key, source: 'compute', kind: 'computeIndex', name, tile: name.split(' ')[0], sub: indexKind(k.gpu),
    priced, price: priced.price, perUnit: perUnitOf(str(item.unit), k.gpu), live: null, sourceWord: computeSourceWord(item.quoteFrom),
    closeTime: null, pastEnd: false, paper: false, watched: false, atAccount: false, noStar: true, legs: [], tabs: [], asset: 'compute', form: 'spot', region: null,
  };
}
// every index row the slice's reads carry (Compute's, a search's)
const computeItemsOf = m => exploreRowsOf(m).filter(i => i.kind === 'computeIndex' && isComputeKey(i.key));

/** An index's page (`#/markets/cmp:<id>`), or null for an id that is none: its name and kind, its unit; the latest settle and the change
 *  from the previous one — its quote's (the page's own read, every minute), else its row's; the facts `{ label, value, unit, date?, at? }`
 *  — the latest settle and its date, the previous settle, the 30-day high and low, and a GPU's current value with its time while the
 *  current host answers; the notes under them (the market's, a GPU's current value not answering in the face's words when the market
 *  says none); the source line (`Ornn · settle <date>`); the quote read's state; the range kept (1M or 3M, 3M until one is chosen) and its
 *  history read, as a local page's. */
export function computePageOf(markets, id) {
  const m = isRecord(markets) ? markets : {};
  const k = computeKeyOf(id);
  if (!k) return null;
  const row = computeItemsOf(m).find(i => i.key === id);
  const kept = own(m.computeQuotes, id);
  const q = isRecord(kept?.data) ? kept.data : null;
  const name = str(q?.name) || str(row?.name) || k.id.toUpperCase();
  const price = q?.price ?? number(row?.price);
  const chart = own(m.candles, id);
  const range = computeRangeOf(isRecord(chart) ? chart.range : undefined);
  const data = isRecord(chart) && chart.data?.ok === true ? chart.data : null;
  const current = data !== null && data.range === range;
  const facts = q ? [
    { label: t('markets.compute.latestSettle'), value: q.price, unit: 'price', date: q.settleDate },
    { label: t('markets.compute.prevSettle'), value: q.prevSettle, unit: 'price' },
    { label: t('markets.compute.high30'), value: q.high30, unit: 'price' },
    { label: t('markets.compute.low30'), value: q.low30, unit: 'price' },
    ...(k.gpu && q.current ? [{ label: t('markets.compute.current'), value: q.current.value, unit: 'price', at: q.current.at }] : []),
  ] : [];
  // the market's note (a history or a current value that did not answer); a GPU's current value missing with none said, the face's
  const notes = q ? [q.note || (k.gpu && q.current === null ? t('markets.compute.currentDown') : '')].filter(Boolean) : [];
  return {
    id, name, gpu: k.gpu, kind: indexKind(k.gpu), perUnit: perUnitOf(str(q?.unit) || str(row?.unit), k.gpu),
    price, changePct: q ? q.changePct : number(row?.changePct24h), facts, notes,
    sourceLine: computeSourceWord(q?.quoteFrom || row?.quoteFrom),
    quote: { status: str(kept?.status) || 'idle', answered: q !== null, message: kept?.status === 'error' ? (isSaid(kept.message) ? sayOf(kept.message) : str(kept.message)) || null : null },
    range,
    history: {
      status: str(chart?.status) || 'idle', message: chart?.status === 'error' ? str(chart.message) || null : null, current,
      candles: current && Array.isArray(data.candles) ? data.candles : null, note: current ? str(data.note) : '',
    },
  };
}
/** An index page's range seg items, `[label, id]`: 1M and 3M alone. */
export const computeCandleRanges = () => candleRanges().filter(([, r]) => COMPUTE_RANGES.includes(r));

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

// the Markets tabs' words (Trade's are accountTabs's)
const marketTabWords = () => ({
  watchlist: t('markets.tab.watchlist'), crypto: t('markets.tab.crypto'), stocks: t('markets.tab.stocks'), indices: t('markets.tab.indices'),
  commodities: t('markets.tab.commodities'), compute: t('markets.tab.compute'), fx: t('markets.tab.fx'), preipo: t('markets.tab.preipo'), macro: t('markets.tab.macro'),
});
const tabWord = id => marketTabWords()[id] ?? id;
/** Markets' tabs as `{ id, label }` (G1): fixed, no counts. */
export const marketTabs = () => MARKET_TABS.map(id => ({ id, label: tabWord(id) }));
// a search result's class: its asset's tab word (an A share's, whose `asset` is the face's own, Stocks), else its form's word
const classOf = r => (typeof r.asset === 'string' ? r.asset : r.region === 'cn' ? 'stocks' : '');
const classWordOf = r => (MARKET_TABS.includes(classOf(r)) ? tabWord(classOf(r)) : r.form ? formWord(r.form) : '');
// a tab's explore read as the store keeps it, when it was asked with the query the screen asks now (its sort aside); else none
function shownRead(m, reads) {
  const tab = tabOf(m);
  const query = exploreQueryOf(m);
  const slot = own(reads, tab);
  return query !== null && isRecord(slot) && typeof slot.query === 'string' && unsorted(slot.query) === unsorted(query) ? slot : null;
}

/** The table on the renderer's clock (`now`, for the ages beside the source words), `page` the Account's: `{ rows, sorts, sort,
 *  tabs, filters, read, china, local, session, searching, empty }`.
 *  - rows: while searching (G5) the search's (`results`), its A shares the hits, each named by its class (`className`); on
 *    a region's own read (onLocal's: China A, Hong Kong, Korea, Taiwan, Indices on Spot) its ranking's; on the Watchlist (G6) every star, found in any read (else a placeholder that can still be
 *    un-starred), the A shares starred and an old us:/crypto: star the Account could not find, each `noStar`; on any other tab
 *    the rows of its own read once that read is for the filters on screen (a read for other filters is never drawn under
 *    these: Review Focus), sorted by the sort in effect.
 *    On Compute (Spot or no form) its indices in the market's order, then (no form) the questions on them.
 *  - sorts: a region's own read, the Watchlist and Compute's indices offer Most traded and Biggest moves; elsewhere Closing soonest too
 *    where a row closes.
 *  - tabs: marketTabs's; filters: filtersOf's, none while searching.
 *  - read: `{ status, answered, message }` of the rows' read — the search's, the ranking's, the tab's own (`loading` while the
 *    one for these filters is out).
 *  - local: onLocal's view (`{ venue, region }`) while not searching, else null; china: whether that is China A.
 *  - empty: `'watchlist'` on an empty Watchlist, `'noSpot'` on Stocks › Japan or India on Spot (no free source lists them),
 *    `'filters'` on a tab whose read answered with no rows, else null.
 *  - missing: on an empty `'filters'` answer, each source the answer says did not answer (`{ name, why }`, the market's words). */
export function tableOf(markets, now = Date.now(), page = null) {
  const m = isRecord(markets) ? markets : {};
  const searching = !blank(m.q);
  const tab = tabOf(m);
  const reads = isRecord(m.explore) ? m.explore : {};
  const atPage = watchKeysOf(page, exploreRowsOf(m));
  const local = searching ? null : onLocal(m);
  const china = local?.venue === 'china';
  const watchlist = !searching && tab === 'watchlist';
  // a region's ranking for another sort or another view is no answer for this one (its rows are in that sort's order, or another
  // region's); a read for this one that failed or is out, over rows kept for another, is this view's read with nothing answered
  const rankSort = m.sort === 'movers' ? 'movers' : 'volume';
  const rankShown = isRecord(m.rank) && (m.rank.data == null || (m.rank.data.sort === rankSort && rankFits(m.rank.data, m)));
  const rankFor = typeof m.rank?.query === 'string' ? unsorted(m.rank.query) === unsorted(rankQueryOf(m) ?? '') : china;
  const rankAsked = isRecord(m.rank) && m.rank.sort === rankSort && rankFor ? { ...m.rank, data: null } : null;
  const slot = searching ? m.results : local ? (rankShown ? m.rank : rankAsked) : shownRead(m, reads);
  const rows = local ? localRowsOf(m, atPage) : unsortedRowsOf(m, { searching, watchlist, slot }, now, atPage);
  // Compute on Spot or with no form: its indices in the market's order, then (no form) the questions on them; Most traded and Biggest
  // moves alone (the market refuses Closing soonest beside spot rows)
  const compute = !searching && tab === 'compute';
  const computeOwn = compute && computeFixed(m);
  const twoSorts = !!local || watchlist || computeOwn;
  const { sorts, sort } = twoSorts
    ? { sorts: accountSorts().filter(s => s.id !== 'closing'), sort: m.sort === 'movers' ? 'movers' : 'volume' }
    : sortsOf(rows, m.sort);
  const read = slot === null
    ? { status: 'loading', answered: false, message: null }
    : { status: str(slot?.status) || 'idle', answered: isRecord(slot) && slot.data != null,
      message: (isSaid(slot?.message) ? sayOf(slot.message) : str(slot?.message)) || null };
  const empty = rows.length > 0 || searching ? null : watchlist ? 'watchlist' : noSpotSource(m) ? 'noSpot' : read.answered ? 'filters' : null;
  // an empty answer whose sources did not answer: each named with the market's own words, so an empty table is not taken for the filters'
  // an options view: its rows in the market's order (it sorts them itself, by dollars or contracts within an asset), its notes (what
  // each source's figures are, a list read in part) and the sources that did not answer, each the market's words, under the rows
  const options = !searching && onOptions(m);
  // Compute's notes too (what its indices are, a source read in part, the questions' search)
  const optionsRead = (options || compute) && isRecord(slot?.data);
  const missing = (empty === 'filters' || optionsRead) && isRecord(slot?.data)
    ? records(slot.data.missing).map(x => ({ name: str(x.venueName) || str(x.venue), why: str(x.why) })).filter(x => x.name)
    : [];
  return {
    rows: local || options ? rows : computeOwn ? [...rows.filter(r => r.source === 'compute'), ...sorted(rows.filter(r => r.source !== 'compute'), sort)] : sorted(rows, sort),
    sorts, sort, tabs: marketTabs(), filters: searching ? null : filtersOf(m), read,
    china, local, session: local && rankFits(rankOf(m), m) ? rankOf(m)?.session ?? null : null, searching, empty, missing, options, compute, computeOwn,
    notes: optionsRead && Array.isArray(slot.data.notes) ? slot.data.notes.filter(n => typeof n === 'string' && n.trim()) : [],
    stale: optionsRead && slot.data.stale === true,
  };
}

/** The table's rows (tableOf's, `page` the Account's), sorted by the sort in effect. */
export function rowsOf(markets, now = Date.now(), page = null) {
  return tableOf(markets, now, page).rows;
}

function unsortedRowsOf(m, { searching, watchlist, slot }, now, atPage) {
  const reads = isRecord(m.explore) ? m.explore : {};
  const listed = records(m.watchlist).map(a => normalizeAsset(a)).filter(Boolean);
  const old = listed.filter(a => a.market !== 'cn');
  // the A shares starred (the Account keys', the page's china entries, an old cn star not moved): drawn as their A-share rows
  const cnStars = cnStarsOf(m, atPage);
  const cnPageOnly = new Set(atPage.filter(isCnKey).filter(key => !starredOf(m).includes(key) && !listed.some(a => a.id === key)));
  const starred = starredOf(m).filter(key => !isCnKey(key));
  const isStarred = new Set(starred);
  const pageOnly = atPage.filter(key => !isCnKey(key) && !isStarred.has(key));
  const atAccount = new Set(pageOnly);
  const quotes = isRecord(m.accountQuotes) ? m.accountQuotes : {};
  const row = item => {
    if (item.kind === 'optionChain' && optionKeyOf(item.key)) return optionRowOf(item);
    if (item.kind === 'computeIndex' && isComputeKey(item.key)) return computeRowOf(item);
    const key = str(item.key);
    return accountRow(item, quotes, isStarred.has(key) || atAccount.has(key), now, atAccount.has(key));
  };
  const dollars = body => itemsOf(body).filter(i => !isLocalKey(i.key));
  if (searching) {
    const cnListed = new Set(cnStars);
    // the search's A shares: its cn items, drawn as the cn rows they are (their prices the hits' own), never as the Account's rows;
    // beside them its Hong Kong, Korean and Taiwanese shares and its cash indices, each its region's row
    const hits = cnHitsOf(m.results?.data).assets.map(a => cnRow(a, m, cnListed.has(a.id)));
    const local = localHitsOf(m.results?.data);
    const others = local.hits.filter(h => h.venue !== 'china').map(h => localHitRow(h, own(m.hitQuotes, h.id) ?? own(local.quotes, h.id)));
    const found = readable(m.results?.data) ? dollars(m.results.data).map(row) : [];
    // the market's option rows for the query (explore?q=…&form=option), each its chain's: named Options
    const chains = optionHitsOf(m).filter(i => !found.some(r => r.id === i.key)).map(optionRowOf);
    return [...found, ...hits, ...others, ...chains].map(r => ({ ...r, className: r.source === 'option' ? formWord('option') : classWordOf(r) }));
  }
  if (watchlist) {
    const lists = [...everyRow(bodyOf(reads, 'watchlist')), ...exploreRowsOf(m)];
    const cn = cnStars.map(key => cnAssetOf(m, key)).filter(Boolean);
    return [
      ...starred.map(key => { const item = lists.find(i => i.key === key); return item ? row(item) : placeholderRow(key); }),
      ...pageOnly.map(key => row(lists.find(i => i.key === key))),
      ...cn.map(a => cnRow(a, m, true, cnPageOnly.has(a.id))),
      ...old.filter(a => own(m.asked, a.id) === null).map(notListedRow),
    ].map(r => ({ ...r, noStar: true }));
  }
  return slot && readable(slot.data) ? dollars(slot.data).map(row) : [];
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
 *    (`watched`, rowsOf's rule); what gravit's conversations on it are found by (`about`, for mentionsOf: its base, or — an
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
  const found = [bodyOf(reads, m.tab), m.results?.data, own(m.located, id)?.data].flatMap(everyRow).concat(exploreRowsOf(m)).find(i => i.key === id);
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
  const name = displayName(item);
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

// ── a local market's page (spec 2026-11-20 §5.6): a Hong Kong, Korean or Taiwanese share's, a cash index's — the A share's kind of page ──

/** A session's phase (a quote's `market_status`, a ranking's `phase`) in the region's word: Open, Lunch break, Closed; '' for none. */
export function localSessionWord(phase) {
  if (phase === 'open' || phase === 'trading') return t('markets.session.open');
  if (phase === 'midday') return t('markets.session.midday');
  if (phase === 'closed') return t('markets.cn.closed');
  return '';
}

/** The line above a region's own table (not China A's, whose times are Beijing's: chinaWord), from its ranking's session: closed, the
 *  last session's day; the lunch break; else nothing. */
export function localWord(session) {
  if (session?.phase === 'closed' && typeof session.lastSession === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(session.lastSession)) {
    return t('markets.session.closedOn', { day: session.lastSession.slice(5) });
  }
  if (session?.phase === 'closed') return t('markets.cn.closed');
  if (session?.phase === 'midday') return t('markets.session.midday');
  return '';
}

/** Where a region's rows would be when its read failed before it answered: its source named, and what cannot be read. */
export function localDownWord(venue) {
  const source = localName(venue);
  switch (venue) {
    case 'hk': return t('markets.local.downHk', { source });
    case 'kr': return t('markets.local.downKr', { source });
    case 'tw': return t('markets.local.downTw', { source });
    case 'ix': return t('markets.local.downIx');
    default: return t('markets.unavailable');
  }
}
/** A local page's state line under its price, as the A share's (cnStateWord): the market not answering (the proxy re-serving its last
 *  read, or the venue's provider said not answering) — its price is as last read; the venue's source failing (its provider in error) —
 *  the source's own sentence, else its source named; else nothing. */
export function localStateWord(venue, connection, providers = []) {
  const market = venue === 'china' ? 'cn' : venue;
  const provider = (Array.isArray(providers) ? providers : []).find(p => p?.market === market);
  if (connection === 'stale' || provider?.notAnswering === true) return t('markets.local.notAnswering');
  if (provider?.status === 'error') return str(provider.said) || localDownWord(venue);
  return '';
}
/** A refresh of a region's ranking that failed over the rows kept, its source named. */
export const localRefreshWord = venue => t('markets.local.refreshFailed', { source: localName(venue) });

// a local key's asset as its page names it: the ranking's row, else the search's hit, else its quote (their names kept), else its code
function localAssetOf(m, id) {
  const k = localKeyOf(id);
  if (!k || k.venue === 'china') return null;
  const index = k.venue === 'ix';
  const ranked = records(rankOf(m)?.items).find(i => i.id === id);
  const hit = localHitsOf(m.results?.data).hits.find(h => h.id === id);
  const quote = own(m.quotes, id);
  const code = index ? k.symbol.slice(k.symbol.indexOf(':') + 1) : k.symbol;
  const name = str(ranked?.name) || str(hit?.name) || (isRecord(quote) ? str(quote.name) : '') || (index ? code.toUpperCase() : code);
  const nameLocal = str(ranked?.name_local) || str(hit?.nameLocal) || null;
  const currency = index ? null : str(isRecord(quote) ? quote.currency : '') || str(ranked?.currency) || str(hit?.currency) || VENUE_CURRENCY[k.venue];
  return { id, venue: k.venue, kind: index ? 'index' : 'share', region: index ? k.symbol.slice(0, k.symbol.indexOf(':')) : k.venue, symbol: code, name, nameLocal, currency };
}

// a local page's facts, in the order the page draws them: a share's prices, volume and turnover, then the session and the source; an
// index's without the share's volume and turnover
const localFacts = share => [
  [t('markets.cnFact.prevClose'), 'prev_close', 'price'], [t('markets.cnFact.open'), 'open', 'price'], [t('markets.cnFact.high'), 'high', 'price'], [t('markets.cnFact.low'), 'low', 'price'],
  ...(share ? [[t('markets.cnFact.volume'), 'volume', 'shares'], [t('markets.cnFact.turnover'), 'turnover', 'amount']] : []),
];

/** A Hong Kong, Korean or Taiwanese share's page, or a cash index's (spec 2026-11-20 §5.6), or null for any other id: its asset
 *  (`{ id, venue, kind, region, symbol, name, nameLocal, currency }`, an index's currency null), its quote (the quotes poll's, else its
 *  search hit's price), its facts `{ label, value, unit }` — `price` in its currency (an index's level bare), `shares`, `amount` in its
 *  currency, `word` — the range kept (its market's first, localRangeOf, until one it reads is chosen) and its history read, as the A
 *  share's (cnPageOf). */
export function localPageOf(markets, id) {
  const m = isRecord(markets) ? markets : {};
  const asset = localAssetOf(m, id);
  if (!asset) return null;
  const quote = own(m.quotes, id) ?? own(m.hitQuotes, id) ?? null;
  const chart = own(m.candles, id);
  const range = localRangeOf(id, isRecord(chart) ? chart.range : undefined);
  const data = isRecord(chart) && chart.data?.ok === true ? chart.data : null;
  const current = data !== null && data.range === range;
  const q = isRecord(quote) ? quote : {};
  return {
    asset, quote, range,
    facts: [
      ...localFacts(asset.kind === 'share').map(([label, key, unit]) => ({ label, value: number(q[key]), unit })),
      { label: t('markets.fact.session'), value: localSessionWord(q.market_status) || null, unit: 'word' },
      { label: t('markets.head.source'), value: str(q.source) || null, unit: 'word' },
    ],
    history: {
      status: str(chart?.status) || 'idle', message: chart?.status === 'error' ? str(chart.message) || null : null, current,
      sessions: current && Array.isArray(data.sessions) ? data.sessions : null, candles: current && Array.isArray(data.candles) ? data.candles : null,
    },
  };
}

/** What Hand to gravit names a market by, `{ symbol, name }`: an Account key by its page's item — its base, else its name, and its
 *  name — a face id by its asset's symbol and name; null for a key no read lists, or an id that is neither. */
export function handWordsOf(markets, account, id, now = Date.now()) {
  // an index: its name (H100 SXM, DeepSeek tokens)
  const index = computePageOf(markets, id);
  if (index) return { symbol: index.name, name: index.name };
  // an option chain: its underlying, and the chains' name
  const option = optionKeyOf(id);
  if (option) return { symbol: option.underlying, name: t('markets.option.name', { underlying: option.underlying }) };
  // a Hong Kong, Korean or Taiwanese share, a cash index: its page's asset, by its code and its name
  if (isLocalKey(id) && !isCnKey(id)) {
    const asset = localPageOf(markets, id)?.asset;
    return asset ? { symbol: asset.symbol, name: asset.name } : null;
  }
  if (!isCnKey(id) && isAccountKey(id)) {
    const item = pageOf(markets, account, id, now)?.item;
    const name = str(item?.name);
    const symbol = str(item?.base) || name;
    return symbol ? { symbol, name } : null;
  }
  const asset = faceAssetOf(markets, id);
  return asset ? { symbol: asset.symbol, name: asset.name } : null;
}
