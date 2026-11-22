// The market's option answers in its shapes (market/src/live/options.ts optionRow, OptionChain; market/src/reads.ts exploreOptions), small
// and hand-made from the market's fixtures' figures (market/test/fixtures/options/): an options list per tab, a BTC chain at Deribit and
// OKX, an AAPL chain at Nasdaq, and Nasdaq's refusal of a ticker it lists no options for.

const at = (venues, underlying, price, quoteFrom) => venues.map(venue => ({
  venue, venueName: { deribit: 'Deribit', okx: 'OKX', nasdaq: 'Nasdaq' }[venue], symbol: underlying, connected: false, canTrade: false, public: true,
  ...(price !== null ? { price } : {}), quoteFrom,
}));
/** An option row as the market's explore lists it (optionRow). */
export function optionItem(underlying, { asset = 'crypto', price = null, changePct, venues, quoteFrom, option = {} } = {}) {
  const v = venues ?? (asset === 'crypto' ? ['deribit', 'okx'] : ['nasdaq']);
  const from = quoteFrom ?? (asset === 'crypto' ? 'Deribit' : 'Cboe · 15 min delayed');
  return {
    key: `opt:${underlying}`, kind: 'optionChain', name: `${underlying} options`, base: underlying, category: asset, asset, form: 'option',
    ...(asset === 'stocks' ? { region: 'us' } : {}), ...(price !== null ? { price } : {}), ...(changePct !== undefined ? { changePct24h: changePct } : {}),
    quoteFrom: from, tabs: [], at: at(v, underlying, price, from), option,
  };
}
const listOf = (items, notes, over = {}) => ({ ok: true, asOf: '2026-11-22T06:00:00.000Z', tabs: [], items, movers: [], closing: [], mostTraded: [], missing: [], notes, ...over });

/** Crypto › Options: BTC and ETH at Deribit and OKX (Deribit's figures), HYPE at OKX alone. */
export const cryptoOptionsList = (over = {}) => listOf([
  optionItem('BTC', { price: 60487.12, changePct: 1.84, option: { nearestExpiry: '2026-11-23', volume: 2140.5, volumeUsd: 129_500_000, openInterest: 412_300, atmIv: 41.2 } }),
  optionItem('ETH', { price: 2310.4, changePct: -2.05, option: { nearestExpiry: '2026-11-23', volume: 41_000, volumeUsd: 94_700_000, openInterest: 1_820_000, atmIv: 55.6 } }),
  optionItem('HYPE', { price: 31.2, venues: ['okx'], quoteFrom: 'OKX', option: { nearestExpiry: '2026-11-28', volume: 1200, openInterest: 9800 } }),
], ["Crypto options: Deribit's figures where Deribit lists the coin (volume in USD, open interest in the coin), else OKX's; view-only."], over);

/** Stocks › US › Options: three of the ten read, the nearest expiry's figures alone. */
export const usOptionsList = (over = {}) => listOf([
  optionItem('NVDA', { asset: 'stocks', price: 182.4, changePct: 1.9, option: { nearestExpiry: '2026-11-28', volume: 1_250_000, openInterest: 3_400_000, nearestOnly: true } }),
  optionItem('AAPL', { asset: 'stocks', price: 342.56, changePct: -0.4, option: { nearestExpiry: '2026-11-28', volume: 610_000, openInterest: 2_100_000, nearestOnly: true } }),
  optionItem('SPY', { asset: 'stocks', option: { nearestExpiry: '2026-11-24', volume: 2_900_000, openInterest: 9_000_000, nearestOnly: true } }),
], ["US options: Nasdaq's nearest expiry alone (volume and open interest summed), no IV; price from the US stocks line; view-only.", 'US options: 3 of 10 read'], over);

const coinLeg = (symbol, bid, ask, last, under, over = {}) => ({
  symbol, bid, ask, last, changePct: over.changePct, volume: over.volume ?? 12.5, openInterest: over.openInterest ?? 340.2, iv: over.iv ?? 41.5, unit: 'BTC',
  usd: { bid: bid === null ? null : bid * under, ask: ask === null ? null : ask * under, last: last === null ? null : last * under },
});
const BTC_EXPIRIES = ['2026-11-23', '2026-11-24', '2026-11-28', '2026-12-26', '2027-03-26'];
/** BTC's chain at a venue for an expiry (the nearest when none): three strikes around 60,487, the ATM 60,000. */
export function btcChain(expiry = '2026-11-23', venue = 'deribit') {
  const under = 60487.12;
  const d = expiry.replace(/-/g, '').slice(2);
  const leg = (k, r, bid, ask, last, over) => coinLeg(`BTC-${d}-${k}-${r}`, bid, ask, last, under, over);
  return {
    underlying: 'BTC', venue, venueName: venue === 'okx' ? 'OKX' : 'Deribit', price: under, asOf: '2026-11-22T06:00:00.000Z',
    quoteFrom: venue === 'okx' ? 'OKX' : 'Deribit', expiries: venue === 'okx' ? ['2026-11-23', '2026-11-28'] : BTC_EXPIRIES, expiry, atmStrike: 60000,
    strikes: [
      { strike: 58000, call: leg(58000, 'C', 0.0405, 0.042, 0.041, { changePct: 3.2 }), put: leg(58000, 'P', 0.0021, 0.0025, null, { iv: 44.1 }) },
      { strike: 60000, call: leg(60000, 'C', 0.0152, 0.0161, 0.0158, { changePct: -1.1 }), put: leg(60000, 'P', 0.0081, 0.0088, 0.0085) },
      { strike: 62000, call: leg(62000, 'C', 0.0031, 0.0036, 0.0033), put: leg(62000, 'P', 0.0335, 0.0352, null) },
    ],
  };
}
/** AAPL's chain at Nasdaq: dollars, no IV, an absolute change; its last trade in Nasdaq's words. */
export function aaplChain(expiry = '2026-11-28') {
  const leg = (k, r, bid, ask, last, change) => ({ symbol: `AAPL--${expiry.replace(/-/g, '').slice(2)}${r}${String(k * 1000).padStart(8, '0')}`, bid, ask, last, change, volume: 1520, openInterest: 8800, unit: 'USD' });
  return {
    underlying: 'AAPL', venue: 'nasdaq', venueName: 'Nasdaq', price: 342.56, asOf: '2026-11-22T06:00:00.000Z', quoteFrom: 'Nasdaq',
    lastTrade: 'LAST TRADE: $342.56 (AS OF NOV 20, 2026)', expiries: ['2026-11-28', '2026-12-05', '2026-12-19'], expiry, atmStrike: 345,
    strikes: [
      { strike: 340, call: leg(340, 'C', 5.1, 5.35, 5.2, 0.45), put: leg(340, 'P', 2.4, 2.55, 2.5, -0.3) },
      { strike: 345, call: leg(345, 'C', 2.6, 2.75, 2.7, 0.2), put: leg(345, 'P', 4.9, 5.1, null, null) },
    ],
  };
}
/** The answer /data/market/options gives: a chain, or the market's refusal (409) as the app's getJson carries it. */
export const chainAnswer = chain => ({ ok: true, value: chain });
export const NO_OPTIONS = 'Nasdaq lists no options for BRK.A';
export const noOptionsBody = () => ({ ok: false, refusal: { code: 'E_MARKET_NOT_FOUND', venue: 'nasdaq', message: NO_OPTIONS } });
