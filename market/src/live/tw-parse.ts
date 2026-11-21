/** Taiwan shares from TWSE, parsed: the day table (`STOCK_DAY_ALL`, one row per listed share and product), MIS's real-time quotes
 * (`getStockInfo.jsp`) and the monthly daily bars (`STOCK_DAY`). Each parser answers null for a body that is not what it expects; the routes,
 * keeps and stale rule stay in taiwan.ts. TWSE writes numbers as strings (the day table plain, `STOCK_DAY` with thousands commas), dates in the
 * Republic of China calendar (year 115 is 2026), and "-" or "--" for a figure it does not have. Taiwan's zone is UTC+8 all year. */
import type { CnBar } from "./cn-history.ts";

export const TW_UNIVERSE = 200;
/** the symbols one MIS ask carries (MIS states no limit; the 200 are priced in `ceil(200 / MIS_BATCH)` asks) */
export const MIS_BATCH = 50;
export const TW_BODY_LIMIT = 2 * 1024 * 1024;

export interface DayRow { code: string; name: string; tradeValue: number | null; close: number | null; change: number | null }
export interface DayTable { /** the table's own trading date, YYYY-MM-DD */ date: string; rows: DayRow[] }
export interface MisQuote {
  code: string; name: string | null; price: number | null; prevClose: number | null; open: number | null; high: number | null; low: number | null;
  /** MIS counts the day's volume in lots of 1,000 shares */ lots: number | null; asOf: string | null; date: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const json = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };
/** "2,330.00", "-40.00" or a plain figure; null for "", "-", "--" and anything else */
function figure(v: unknown, positive = false): number | null {
  if (typeof v === "number") return Number.isFinite(v) && (!positive || v > 0) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/,/g, "").trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return positive && n <= 0 ? null : n;
}

/** a Taiwan code: four to six characters, digits and upper-case letters (`2330`, `2881A`, `00400A`) */
export const TW_CODE = /^[0-9A-Z]{4,6}$/;
/** A Taiwan code from what a person or a page types, upper-cased; null when it is not one */
export function twCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  return TW_CODE.test(code) ? code : null;
}

// ---- URLs ------------------------------------------------------------------------------------------------------------------------
export const twDayAllUrl = (): string => "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
/** `delay=0` asks MIS for the figures as they stand; the symbols are listed (`tse_`) shares */
export const twMisUrl = (codes: readonly string[]): string =>
  `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${codes.map((c) => `tse_${c}.tw`).join("|")}&json=1&delay=0`;
/** one month of a share's daily bars; `month` is `YYYYMM` */
export const twStockDayUrl = (code: string, month: string): string =>
  `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${month}01&stockNo=${code}`;

/** `1151120` or `115/11/20` as `2026-11-20` */
function rocDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{2,3})\/?(\d{2})\/?(\d{2})$/.exec(v.trim());
  return m ? `${Number(m[1]) + 1911}-${m[2]}-${m[3]}` : null;
}

// ---- the day table ---------------------------------------------------------------------------------------------------------------
/** the day table: its trading date and its rows; null when it is not a list, holds no row of a code, or has no date */
export function parseDayAll(text: string): DayTable | null {
  const value = json(text);
  if (!Array.isArray(value)) return null;
  const rows: DayRow[] = [];
  let date: string | null = null;
  for (const r of value) {
    if (!isRecord(r) || typeof r.Code !== "string" || !TW_CODE.test(r.Code) || typeof r.Name !== "string" || !r.Name.trim()) continue;
    date ??= rocDate(r.Date);
    rows.push({ code: r.Code, name: r.Name.trim(), tradeValue: figure(r.TradeValue), close: figure(r.ClosingPrice, true), change: figure(r.Change) });
  }
  return date && rows.length ? { date, rows } : null;
}

// ---- MIS -------------------------------------------------------------------------------------------------------------------------
/** MIS's `msgArray` by code (the index lines, whose codes are not share codes, are left out); null for a reply that is not `rtcode` "0000"
 * with an array. `z` is the last price: "-" means no trade yet, and the quote has no price. */
export function parseMis(text: string): Map<string, MisQuote> | null {
  const value = json(text);
  if (!isRecord(value) || value.rtcode !== "0000" || !Array.isArray(value.msgArray)) return null;
  const quotes = new Map<string, MisQuote>();
  for (const m of value.msgArray) {
    if (!isRecord(m) || typeof m.c !== "string" || !TW_CODE.test(m.c)) continue;
    const t = typeof m.tlong === "string" || typeof m.tlong === "number" ? Number(m.tlong) : NaN;
    const d = typeof m.d === "string" ? /^(\d{4})(\d{2})(\d{2})$/.exec(m.d) : null;
    quotes.set(m.c, {
      code: m.c, name: typeof m.n === "string" && m.n.trim() ? m.n.trim() : null, price: figure(m.z, true), prevClose: figure(m.y, true),
      open: figure(m.o, true), high: figure(m.h, true), low: figure(m.l, true), lots: figure(m.v),
      asOf: Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null, date: d ? `${d[1]}-${d[2]}-${d[3]}` : null,
    });
  }
  return quotes;
}

// ---- the month's bars ------------------------------------------------------------------------------------------------------------
/** one month's daily bars, oldest first, each stamped its date at 13:30 Taipei; a month TWSE says it has no data for is []; null for anything else */
export function parseStockDay(text: string): CnBar[] | null {
  const value = json(text);
  if (!isRecord(value)) return null;
  if (value.stat !== "OK") return typeof value.stat === "string" && value.stat.includes("沒有符合") ? [] : null;
  if (!Array.isArray(value.data)) return null;
  const bars: CnBar[] = [];
  for (const row of value.data) {
    if (!Array.isArray(row)) continue;
    const day = rocDate(row[0]);
    const [o, h, l, c] = [figure(row[3], true), figure(row[4], true), figure(row[5], true), figure(row[6], true)];
    if (!day || o === null || h === null || l === null || c === null) continue; // a day without a trade has "--"
    const t = Date.parse(`${day}T13:30:00+08:00`);
    if (Number.isFinite(t)) bars.push({ t, o, h, l, c });
  }
  return bars;
}
