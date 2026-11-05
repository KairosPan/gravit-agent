// The Account's China answers as the shapes the Markets store already draws: the ranking's rows (chinaRowsOf), a quote (LiveQuote), a
// search's hits and the provider's state. Pure: no DOM, no fetch; the face holds no key and asks no upstream.
import { normalizeAsset, number } from "./market-model.js";

export const CHINA_VENUE = "china";

const isRecord = v => !!v && typeof v === "object" && !Array.isArray(v);
const str = v => (typeof v === "string" ? v : "");
const numOrNull = v => number(v);
const CN_KEY = /^cn:\d{6}$/;
const PHASE = { trading: "open", midday: "midday", closed: "closed" };
const PROVIDER_STATUS = { live: "connected", stale: "limited", unavailable: "error" };

/** @param {unknown} id */
export const isCnKey = id => typeof id === "string" && CN_KEY.test(id);

/** The Account's pair for a cn key (`china|600519`), else null. @param {unknown} id */
export function chinaPairOf(id) {
  return isCnKey(id) ? `${CHINA_VENUE}|${id.slice(3)}` : null;
}

/** An explore tab=china answer as the ranking the store keeps; null for any other body or another sort.
 * @param {unknown} body @param {string} [sort] */
export function rankOf(body, sort = "volume") {
  if (!isRecord(body) || body.ok !== true || !Array.isArray(body.items) || !isRecord(body.china)) return null;
  const read = body.china;
  if (read.sort !== sort) return null;
  const items = body.items.filter(i => isRecord(i) && isCnKey(i.key)).map(i => ({
    id: i.key, symbol: str(i.base) || i.key.slice(3), name: str(i.name) || i.key.slice(3),
    price: numOrNull(i.price), change_pct: numOrNull(i.changePct24h), turnover: numOrNull(i.turnoverCny),
  }));
  const status = isRecord(read.status) ? read.status : { state: "unavailable", said: "" };
  return {
    ok: true, sort, total: numOrNull(read.total) ?? items.length, asOf: str(read.asOf) || str(body.asOf),
    session: isRecord(read.session) ? read.session : { phase: "closed", lastSession: null }, status, stale: body.stale === true || status.state === "stale", items,
  };
}

/** A quotes row ({ venue, symbol, market } or a refusal) as the LiveQuote the views read; null for a refused row.
 * @param {unknown} row @param {number | Date} [now] */
export function cnQuoteOf(row, now = Date.now()) {
  if (!isRecord(row) || !isRecord(row.market) || row.refusal !== undefined) return null;
  const m = row.market;
  const cn = isRecord(m.cn) ? m.cn : {};
  const symbol = str(m.symbol) || str(row.symbol);
  if (!/^\d{6}$/.test(symbol)) return null;
  const asOf = str(m.quoteAt) || null;
  return {
    id: `cn:${symbol}`, market: "cn", symbol, name: str(m.name) || symbol,
    price: numOrNull(m.price), prev_close: numOrNull(cn.prevClose), change: numOrNull(m.change24h), change_pct: numOrNull(m.changePct24h),
    volume: numOrNull(cn.volume), as_of: asOf, received_at: new Date(now).toISOString(), volume_as_of: asOf,
    source: "Tencent", feed: "", basis: "previous_close", // en-kept: the provider's name
    quote_status: cn.quoteStatus === "delayed" ? "delayed" : "live", market_status: PHASE[cn.phase] ?? "unknown", message: "",
    last_session: str(cn.lastSession) || null,
    open: numOrNull(cn.open), high: numOrNull(cn.high), low: numOrNull(cn.low), turnover: numOrNull(cn.turnover),
    turnover_rate: numOrNull(cn.turnoverRate), market_cap: numOrNull(cn.marketCap), pe_ttm: numOrNull(cn.peTtm),
    limit_up: numOrNull(cn.limitUp), limit_down: numOrNull(cn.limitDown), amplitude: numOrNull(cn.amplitude),
  };
}

/** An explore?q= answer's A-share hits as assets and their prices; other items are not China's. @param {unknown} body */
export function cnHitsOf(body) {
  const assets = [], quotes = {};
  if (!isRecord(body) || !Array.isArray(body.items)) return { assets, quotes };
  for (const i of body.items) {
    if (!isRecord(i) || !isCnKey(i.key)) continue;
    const asset = normalizeAsset({ id: i.key, market: "cn", symbol: str(i.base) || i.key.slice(3), name: str(i.name), currency: "CNY" });
    if (!asset) continue;
    assets.push(asset);
    quotes[asset.id] = { price: numOrNull(i.price), change_pct: numOrNull(i.changePct24h) };
  }
  return { assets, quotes };
}

/** The ranking's ChinaStatus as the provider list the screens read; [] for none. A status the face set itself for the market
 *  not answering (`notAnswering: true`) keeps that flag, so the host knows it by its code, never by its words.
 *  @param {unknown} status */
export function chinaProviderOf(status) {
  if (!isRecord(status) || !(str(status.state) in PROVIDER_STATUS)) return [];
  const provider = { id: "tencent", market: "cn", status: PROVIDER_STATUS[status.state], said: str(status.said) };
  return [status.notAnswering === true ? { ...provider, notAnswering: true } : provider];
}
