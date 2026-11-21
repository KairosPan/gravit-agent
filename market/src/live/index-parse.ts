/** The world indices' replies, parsed: Tencent's index lines (A shares and Hong Kong, in one GBK reply), Naver's world and domestic index
 * polling, and TWSE MIS's TAIEX line. Eastmoney's index list is parsed by eastmoney.ts and Naver's day candles by `parseNaverIndexChart`.
 * Each parser answers null for a body that is not what it expects and leaves out a line with no price; the routes, keeps and the stale rule
 * stay in world-indices.ts. Every index is a level: no currency, no volume that anyone draws. */
import type { CnBar } from "./cn-history.ts";

/** one index's level as a source gave it */
export interface IxLevel {
  level: number; change: number | null; changePct: number | null; prevClose: number | null;
  open: number | null; high: number | null; low: number | null;
  /** the level's own time, ISO 8601 with its zone, where the source says it */
  at: string | null;
  /** the source's declared delay in minutes: 0 real time, null not declared */
  delayMin: number | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const json = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };
/** "22,410.80", "-1.89" or a number; null for anything else */
export function figure(v: unknown, positive = false): number | null {
  if (typeof v === "number") return Number.isFinite(v) && (!positive || v > 0) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/,/g, "").trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return positive && n <= 0 ? null : n;
}
const round = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places;
/** a level with the move filled in from the previous close where the source gave no move */
function level(o: Omit<IxLevel, "change" | "changePct"> & { change: number | null; changePct: number | null }): IxLevel {
  const change = o.change ?? (o.prevClose !== null ? round(o.level - o.prevClose, 4) : null);
  const changePct = o.changePct ?? (o.prevClose !== null ? round((o.level / o.prevClose - 1) * 100, 2) : null);
  return { ...o, change, changePct };
}

// ---- URLs ------------------------------------------------------------------------------------------------------------------------
export const tencentIndexUrl = (codes: readonly string[]): string => `https://qt.gtimg.cn/q=${codes.join(",")}`;
export const naverWorldUrl = (codes: readonly string[]): string => `https://polling.finance.naver.com/api/realtime/worldstock/index/${codes.join(",")}`;
export const naverDomesticUrl = (codes: readonly string[]): string => `https://polling.finance.naver.com/api/realtime/domestic/index/${codes.join(",")}`;
export const naverIndexChartUrl = (code: string): string => `https://api.stock.naver.com/chart/foreign/index/${code}?periodType=dayCandle`;
export const misIndexUrl = (code: string): string => `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_${code}.tw&json=1&delay=0`;

// ---- Tencent ---------------------------------------------------------------------------------------------------------------------
/** Tencent's two time forms, both Beijing/Hong Kong (+08:00): `2026/11/20 18:31:27` and `20261120161427` */
function tencentAt(v: string | undefined): string | null {
  const m = /^(\d{4})[/-]?(\d{2})[/-]?(\d{2})[ T]?(\d{2}):?(\d{2}):?(\d{2})$/.exec((v ?? "").trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}
/** The asked codes' lines (`v_hkHSI="..."`, `v_sh000300="..."`) from a decoded reply, by code; null when the reply has none of them */
export function parseTencentIndices(text: string, codes: readonly string[]): Map<string, IxLevel> | null {
  const out = new Map<string, IxLevel>();
  for (const [, code, value] of text.matchAll(/v_(\w+)="([^"]*)";?/g)) {
    if (!codes.includes(code!)) continue;
    const f = value!.split("~");
    const price = figure(f[3], true);
    if (f.length < 35 || price === null) continue;
    out.set(code!, level({ level: price, change: figure(f[31]), changePct: figure(f[32]), prevClose: figure(f[4], true), open: figure(f[5], true),
      high: figure(f[33], true), low: figure(f[34], true), at: tencentAt(f[30]), delayMin: null }));
  }
  return out.size ? out : null;
}

// ---- Naver -----------------------------------------------------------------------------------------------------------------------
/** Naver's index polling by its own code (`.N225` in the world reply's `reutersCode`, `KOSPI` in the domestic one's `itemCode`); null when the
 * reply is not that JSON or carries no index with a level. The delay is `stockExchangeType.delayTime`. */
export function parseNaverIndices(text: string, kind: "world" | "domestic"): Map<string, IxLevel> | null {
  const value = json(text);
  if (!isRecord(value) || !Array.isArray(value.datas)) return null;
  const out = new Map<string, IxLevel>();
  for (const d of value.datas) {
    if (!isRecord(d)) continue;
    const code = kind === "world" ? d.reutersCode : d.itemCode;
    const price = figure(d.closePriceRaw, true) ?? figure(d.closePrice, true);
    if (typeof code !== "string" || price === null) continue;
    const x = isRecord(d.stockExchangeType) ? d.stockExchangeType.delayTime : undefined;
    const delay = typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null;
    const traded = typeof d.localTradedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(d.localTradedAt) && Number.isFinite(Date.parse(d.localTradedAt)) ? d.localTradedAt : null;
    const change = figure(d.compareToPreviousClosePriceRaw) ?? figure(d.compareToPreviousClosePrice);
    out.set(code, level({ level: price, change, changePct: figure(d.fluctuationsRatioRaw) ?? figure(d.fluctuationsRatio),
      prevClose: change !== null ? round(price - change, 4) : null,
      open: figure(d.openPriceRaw, true) ?? figure(d.openPrice, true), high: figure(d.highPriceRaw, true) ?? figure(d.highPrice, true),
      low: figure(d.lowPriceRaw, true) ?? figure(d.lowPrice, true), at: traded, delayMin: delay }));
  }
  return out.size ? out : null;
}

/** Naver's index day candles, oldest first; a bar is stamped its date at 15:30 UTC+9 (the bars are drawn by date) */
export function parseNaverIndexChart(text: string, code: string): CnBar[] | null {
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

// ---- TWSE MIS --------------------------------------------------------------------------------------------------------------------
/** MIS's index line for `code` (`t00`, TAIEX): `z` the level, `y` the previous close; null for a reply that is not `rtcode` "0000" with that line priced */
export function parseMisIndex(text: string, code: string): IxLevel | null {
  const value = json(text);
  if (!isRecord(value) || value.rtcode !== "0000" || !Array.isArray(value.msgArray)) return null;
  const m = value.msgArray.find((x) => isRecord(x) && x.c === code);
  if (!isRecord(m)) return null;
  const price = figure(m.z, true);
  if (price === null) return null;
  const t = Number(m.tlong);
  return level({ level: price, change: null, changePct: null, prevClose: figure(m.y, true), open: figure(m.o, true), high: figure(m.h, true), low: figure(m.l, true),
    at: Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null, delayMin: 0 });
}
