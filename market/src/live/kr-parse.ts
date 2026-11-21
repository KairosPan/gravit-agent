/** Korean shares from Naver, parsed: the KOSPI ranking by market value (`marketValue/KOSPI`), the polling quotes, the day candles and the
 * autocomplete search. Each parser answers null for a body that is not what it expects; the routes, keeps and stale rule stay in korea.ts.
 * Naver writes numbers as strings with thousands commas; its `*Raw` fields are plain. Korea's zone is UTC+9 all year. */
import type { CnBar } from "./cn-history.ts";

export const KR_RANK_ROWS = 200, KR_RANK_PAGE = 100;
export const KR_BODY_LIMIT = 1024 * 1024;

export interface KrRankRow {
  code: string; name: string; price: number | null; changePct: number | null; turnover: number | null;
  /** the row's own trade time, ISO 8601 with +09:00 */ at: string | null; delayMin: number | null;
}
export interface KrQuote {
  code: string; name: string | null; price: number | null; prevClose: number | null; changePct: number | null; open: number | null; high: number | null;
  low: number | null; volume: number | null; turnover: number | null; asOf: string | null; delayMin: number | null;
}
export interface KrHit { code: string; name: string }

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const json = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };
/** "180,900", "-8.13" or a number; null for anything else (and for a "-" or "N/A") */
function figure(v: unknown, positive = false): number | null {
  if (typeof v === "number") return Number.isFinite(v) && (!positive || v > 0) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/,/g, "").trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return positive && n <= 0 ? null : n;
}
/** the field's `*Raw` twin when there is one, else the field itself */
const raw = (o: Record<string, unknown>, key: string, positive = false): number | null => figure(o[`${key}Raw`], positive) ?? figure(o[key], positive);
const stampOf = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(t) ? v : null;
};
const delayOf = (o: Record<string, unknown>): number | null => {
  const x = o.stockExchangeType;
  return isRecord(x) && typeof x.delayTime === "number" && Number.isFinite(x.delayTime) && x.delayTime >= 0 ? x.delayTime : null;
};

/** A Korean code from what a person or a page types: six digits, kept as they are (`005935` is the preferred share, not `5935`) */
export function krCode(input: string): string | null {
  return /^\d{6}$/.test(input) ? input : null;
}

// ---- URLs ------------------------------------------------------------------------------------------------------------------------
export const krRankUrl = (page: number): string => `https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=${page}&pageSize=${KR_RANK_PAGE}`;
export const krQuoteUrl = (codes: readonly string[]): string => `https://polling.finance.naver.com/api/realtime/domestic/stock/${codes.join(",")}`;
export const krChartUrl = (code: string): string => `https://api.stock.naver.com/chart/domestic/item/${code}?periodType=dayCandle`;
export const krSearchUrl = (q: string): string => {
  const url = new URL("https://ac.stock.naver.com/ac");
  url.searchParams.set("q", q);
  url.searchParams.set("target", "stock");
  return url.href;
};

// ---- the ranking -----------------------------------------------------------------------------------------------------------------
/** one page of `marketValue/KOSPI`: its shares (`stockEndType` "stock", exchange-traded products left out) in the order given, and the board's
 * count; null for any other body */
export function parseKrRank(text: string): { total: number; rows: KrRankRow[] } | null {
  const value = json(text);
  if (!isRecord(value) || !Array.isArray(value.stocks)) return null;
  const rows: KrRankRow[] = [];
  for (const s of value.stocks) {
    if (!isRecord(s) || s.stockEndType !== "stock") continue;
    const code = s.itemCode, name = s.stockName;
    if (typeof code !== "string" || !/^\d{6}$/.test(code) || typeof name !== "string" || !name.trim()) continue;
    rows.push({ code, name: name.trim(), price: raw(s, "closePrice", true), changePct: figure(s.fluctuationsRatio), turnover: figure(s.accumulatedTradingValueRaw),
      at: stampOf(s.localTradedAt), delayMin: delayOf(s) });
  }
  const total = value.totalCount;
  return { total: typeof total === "number" && Number.isFinite(total) ? total : rows.length, rows };
}

// ---- quotes ----------------------------------------------------------------------------------------------------------------------
/** the `datas` of a polling reply, by six-digit code; null when the body holds none */
export function parseKrQuotes(text: string): Map<string, KrQuote> | null {
  const value = json(text);
  if (!isRecord(value) || !Array.isArray(value.datas)) return null;
  const quotes = new Map<string, KrQuote>();
  for (const d of value.datas) {
    if (!isRecord(d) || typeof d.itemCode !== "string" || !/^\d{6}$/.test(d.itemCode)) continue;
    const price = raw(d, "closePrice", true), change = raw(d, "compareToPreviousClosePrice");
    const asOf = stampOf(d.localTradedAt);
    quotes.set(d.itemCode, {
      code: d.itemCode, name: typeof d.stockName === "string" && d.stockName.trim() ? d.stockName.trim() : null, price,
      prevClose: price !== null && change !== null && price - change > 0 ? price - change : null,
      changePct: raw(d, "fluctuationsRatio"), open: raw(d, "openPrice", true), high: raw(d, "highPrice", true), low: raw(d, "lowPrice", true),
      volume: asOf ? raw(d, "accumulatedTradingVolume") : null, turnover: figure(d.accumulatedTradingValueRaw), asOf, delayMin: delayOf(d),
    });
  }
  return quotes;
}

// ---- the chart -------------------------------------------------------------------------------------------------------------------
/** Naver's day candles, oldest first; a bar is stamped its date at 15:30 Seoul */
export function parseKrChart(text: string, code: string): CnBar[] | null {
  const value = json(text);
  if (!isRecord(value) || value.code !== code || !Array.isArray(value.priceInfos)) return null;
  const bars: CnBar[] = [];
  for (const p of value.priceInfos) {
    if (!isRecord(p) || typeof p.localDate !== "string") continue;
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(p.localDate);
    const [o, h, l, c] = [figure(p.openPrice, true), figure(p.highPrice, true), figure(p.lowPrice, true), figure(p.closePrice, true)];
    if (!m || o === null || h === null || l === null || c === null) continue;
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T15:30:00+09:00`);
    if (Number.isFinite(t)) bars.push({ t, o, h, l, c });
  }
  return bars;
}

// ---- search ----------------------------------------------------------------------------------------------------------------------
/** the Korean listings of an autocomplete reply (it answers the world's): nationCode KOR, a six-digit code; null for any other body */
export function parseKrSearch(text: string): KrHit[] | null {
  const value = json(text);
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const hits: KrHit[] = [];
  const seen = new Set<string>();
  for (const i of value.items) {
    if (!isRecord(i) || i.nationCode !== "KOR" || typeof i.code !== "string" || !/^\d{6}$/.test(i.code) || typeof i.name !== "string" || !i.name.trim()) continue;
    if (seen.has(i.code)) continue;
    seen.add(i.code);
    hits.push({ code: i.code, name: i.name.trim() });
  }
  return hits;
}
