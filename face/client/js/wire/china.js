// The market's China answers as the shapes the Markets store already draws: the ranking's rows (market-view.js localRowsOf), a quote (LiveQuote), a
// search's hits and the provider's state. Pure: no DOM, no fetch; the face holds no key and asks no upstream.
import { normalizeAsset, number } from "./market-model.js";
import { localRankOf, localQuoteOf, localProviderOf } from "./local.js";

export const CHINA_VENUE = "china";

const isRecord = v => !!v && typeof v === "object" && !Array.isArray(v);
const str = v => (typeof v === "string" ? v : "");
const numOrNull = v => number(v);
const CN_KEY = /^cn:\d{6}$/;

/** @param {unknown} id */
export const isCnKey = id => typeof id === "string" && CN_KEY.test(id);
/** An A share's code on ChiNext (300, 301, 302): the one test host/market-view.js cnBoardOf and host/lunhui.js boardOf share. */
export const isChiNext = code => /^30[0-2]/.test(String(code ?? ""));

/** The Account's pair for a cn key (`china|600519`), else null. @param {unknown} id */
export function chinaPairOf(id) {
  return isCnKey(id) ? `${CHINA_VENUE}|${id.slice(3)}` : null;
}

/** An explore tab=china answer as the ranking the store keeps (wire/local.js localRankOf's, read for China A at the sort); null for
 * any other body or another sort. @param {unknown} body @param {string} [sort] */
export function rankOf(body, sort = "volume") {
  return localRankOf(body, `asset=stocks&form=spot&region=cn&sort=${encodeURIComponent(String(sort))}`);
}

/** A quotes row ({ venue, symbol, market } or a refusal) as the LiveQuote the views read (localQuoteOf's, at venue china); null for
 * a refused row. @param {unknown} row @param {number | Date} [now] */
export function cnQuoteOf(row, now = Date.now()) {
  return localQuoteOf(isRecord(row) ? { ...row, venue: CHINA_VENUE } : row, now);
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

/** The ranking's ChinaStatus as the provider list the screens read (localProviderOf's for china); [] for none. A status the face
 *  set itself for the market not answering (`notAnswering: true`) keeps that flag, so the host knows it by its code, never by its
 *  words. @param {unknown} status */
export const chinaProviderOf = status => localProviderOf(CHINA_VENUE, status);
