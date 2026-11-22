// The market's option chains (spec 2026-11-22 §5.4) as the shapes the Markets store draws: a chain page's key (`opt:<U>`), and one chain
// as /api/options answers it (market/src/live/options.ts OptionChain) — its legs' figures as the source gives them, a figure it does not
// give null, never 0. Pure: no DOM, no fetch.
import { number } from './market-model.js';

/** The coins the market reads options on at Deribit and OKX (market/src/reads.ts OPTION_COINS): a chain page of any other underlying
 *  with no row to say otherwise is a US ticker's, at Nasdaq. */
export const OPTION_COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'AVAX', 'TRX', 'HYPE'];
/** The option venues, as the market names them. */
export const OPTION_VENUES = ['deribit', 'okx', 'nasdaq'];
// a chain's underlying: a coin (BTC) or a US ticker (AAPL, BRK.A), upper-case
const UNDERLYING = /^[A-Z0-9][A-Z0-9.]{0,14}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');

/** A chain page's key (`opt:BTC`, `opt:AAPL`, `opt:BRK.A`) as its underlying, else null (`opt:btc`, `opt:`, `stock:AAPL`).
 *  @param {unknown} id */
export function optionKeyOf(id) {
  if (typeof id !== 'string' || !id.startsWith('opt:')) return null;
  const underlying = id.slice(4);
  return UNDERLYING.test(underlying) ? { underlying } : null;
}
/** @param {unknown} id */
export const isOptionKey = id => optionKeyOf(id) !== null;

// a leg's prices in dollars, where the source gives them (a crypto leg's coin prices times the underlying)
function usdOf(u) {
  if (!isRecord(u)) return null;
  return { bid: number(u.bid), ask: number(u.ask), last: number(u.last) };
}
// a leg as the page draws it: each figure the source's own or null; `change` (in the leg's unit) and `changePct` apart
function legOf(l) {
  if (!isRecord(l)) return null;
  return {
    symbol: str(l.symbol), bid: number(l.bid), ask: number(l.ask), last: number(l.last),
    change: number(l.change), changePct: number(l.changePct), volume: number(l.volume),
    openInterest: number(l.openInterest), iv: number(l.iv), unit: str(l.unit), usd: usdOf(l.usd),
  };
}

/** An /api/options answer (`{ ok: true, value: OptionChain }`) as the chain the page draws, else null (a refusal, a body of another
 *  shape). Its strikes in order, each with its call and its put where listed; its expiries the market's, in order; `stale` for an
 *  answer the face's proxy re-served as kept.
 *  @param {unknown} body */
export function optionChainOf(body) {
  if (!isRecord(body) || body.ok !== true || !isRecord(body.value)) return null;
  const v = body.value;
  const underlying = str(v.underlying);
  if (!UNDERLYING.test(underlying) || !OPTION_VENUES.includes(v.venue) || !Array.isArray(v.strikes) || !Array.isArray(v.expiries)) return null;
  const strikes = v.strikes.filter(isRecord).map(s => ({ strike: number(s.strike), call: legOf(s.call), put: legOf(s.put) }))
    .filter(s => s.strike !== null).sort((a, b) => a.strike - b.strike);
  return {
    underlying, venue: v.venue, venueName: str(v.venueName), price: number(v.price), asOf: str(v.asOf), quoteFrom: str(v.quoteFrom),
    lastTrade: str(v.lastTrade), note: str(v.note), expiries: v.expiries.filter(e => typeof e === 'string' && DAY.test(e)),
    expiry: DAY.test(str(v.expiry)) ? v.expiry : '', atmStrike: number(v.atmStrike), strikes,
    // the proxy re-serving its kept answer (the market not answering): the chain as last read
    stale: body.stale === true,
  };
}
