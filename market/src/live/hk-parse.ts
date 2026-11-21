/** Hong Kong shares from Tencent, parsed: the ranking (`hk_rank.php`), the quote lines (`r_hk`), the daily bars (`hkfqkline`), the one-day minutes
 * (`hkMinute`) and the smartbox search. Each parser answers null for a body that is not what it expects; the routes, keeps and fallback stay
 * in hongkong.ts. Hong Kong's zone is UTC+8 all year, so a time written without a zone is read as +08:00. */
import type { CnBar, CnMinutes } from "./cn-history.ts";

export const HK_RANK_ROWS = 200, HK_RANK_PAGE = 50;
export const HK_BODY_LIMIT = 512 * 1024;

export interface HkRankRow { code: string; name: string; price: number | null; changePct: number | null; turnover: number | null }
export interface HkQuote {
  code: string; name: string | null; price: number | null; prevClose: number | null; open: number | null; high: number | null; low: number | null;
  volume: number | null; turnover: number | null; /** ISO 8601 with +08:00, or null */ asOf: string | null;
}
export interface HkHit { code: string; name: string }
export type HkInterval = "day" | "week" | "month";

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const figure = (v: unknown, positive = false): number | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  if (typeof v === "string" && !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) && (positive ? n > 0 : n >= 0) ? n : null;
};
const signed = (v: unknown): number | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
function json(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

/** A Hong Kong code from what a person or a page types: its digits only, one to five of them, left-padded to five (`700` is `00700`) */
export function hkCode(input: string): string | null {
  return /^\d{1,5}$/.test(input) ? input.padStart(5, "0") : null;
}

// ---- URLs ------------------------------------------------------------------------------------------------------------------------
export const hkRankUrl = (page: number): string =>
  `https://stock.gtimg.cn/data/hk_rank.php?board=main_all&metric=amount&pageSize=${HK_RANK_PAGE}&reqPage=${page}&order=decs&var_name=list_data`;
export const hkQuoteUrl = (codes: readonly string[]): string => `https://qt.gtimg.cn/q=${codes.map((c) => `r_hk${c}`).join(",")}`;
export const hkMinuteUrl = (code: string): string => `https://web.ifzq.gtimg.cn/appstock/app/hkMinute/query?code=hk${code}`;
export const hkKlineUrl = (code: string, interval: HkInterval, count: number): string =>
  `https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get?param=hk${code},${interval},,,${count},qfq`;
export const hkSearchUrl = (q: string): string => {
  const url = new URL("https://smartbox.gtimg.cn/s3/");
  url.searchParams.set("v", "2");
  url.searchParams.set("q", q);
  url.searchParams.set("t", "hk");
  return url.href;
};

/** "2026/11/20 16:08:37" (Hong Kong time) to ISO 8601 with +08:00; null if it is no real time */
function stamp(value: string | undefined): string | null {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const local = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`;
  const t = Date.parse(local);
  return Number.isFinite(t) && new Date(t + 8 * 3_600_000).toISOString().slice(0, 19) === local.slice(0, 19) ? local : null;
}

// ---- the ranking -----------------------------------------------------------------------------------------------------------------
/** one page of `hk_rank.php` (`list_data={...}`): its rows in the order given and the board's share count; null for any other body */
export function parseHkRank(text: string): { total: number; rows: HkRankRow[] } | null {
  const m = /^\s*list_data\s*=\s*(\{.*\})\s*;?\s*$/s.exec(text);
  if (!m) return null;
  const value = json(m[1]!);
  if (!isRecord(value) || value.code !== 0 || !isRecord(value.data) || !Array.isArray(value.data.page_data)) return null;
  const rows: HkRankRow[] = [];
  for (const line of value.data.page_data) {
    if (typeof line !== "string") continue;
    const f = line.split("~");
    const name = f[1]?.trim();
    if (f.length < 9 || !/^\d{5}$/.test(f[0]!) || !name) continue;
    rows.push({ code: f[0]!, name, price: figure(f[2], true), changePct: signed(f[3]), turnover: figure(f[8]) });
  }
  const total = value.data.stock_count;
  return { total: typeof total === "number" && Number.isFinite(total) ? total : rows.length, rows };
}

// ---- quotes ----------------------------------------------------------------------------------------------------------------------
/** the `r_hk` lines of a decoded `qt.gtimg.cn` reply, by five-digit code; a line under 38 fields or for another code is absent. Null when the
 * reply holds no quote line at all */
export function parseHkQuotes(text: string): Map<string, HkQuote> | null {
  if (!/v_\w+="/.test(text)) return null;
  const quotes = new Map<string, HkQuote>();
  for (const [, code, value] of text.matchAll(/v_r_hk(\d{5})="([^"]*)";/g)) {
    const f = value!.split("~");
    if (f.length < 38 || f[2] !== code) continue;
    const asOf = stamp(f[30]);
    quotes.set(code!, {
      code: code!, name: f[1]?.trim() || null, price: figure(f[3], true), prevClose: figure(f[4], true), open: figure(f[5], true),
      high: figure(f[33], true), low: figure(f[34], true), volume: asOf ? figure(f[6]) : null, turnover: figure(f[37]), asOf,
    });
  }
  return quotes;
}

// ---- charts ----------------------------------------------------------------------------------------------------------------------
function nodeOf(text: string, code: string): Record<string, unknown> | null {
  const value = json(text);
  if (!isRecord(value) || (value.code !== undefined && value.code !== 0 && value.code !== "0") || !isRecord(value.data)) return null;
  const node = Object.hasOwn(value.data, `hk${code}`) ? value.data[`hk${code}`] : undefined;
  return isRecord(node) ? node : null;
}

/** `hkfqkline`'s forward-adjusted bars (date, open, close, high, low, volume, …), oldest first; a bar is stamped its date at 16:00 Hong Kong */
export function parseHkKline(text: string, code: string, interval: HkInterval): CnBar[] | null {
  const node = nodeOf(text, code);
  const rows = node?.[`qfq${interval}`] ?? node?.[interval];
  if (!Array.isArray(rows)) return null;
  const bars: CnBar[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || typeof row[0] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row[0])) continue;
    const [o, c, h, l] = [figure(row[1], true), figure(row[2], true), figure(row[3], true), figure(row[4], true)];
    if (o === null || c === null || h === null || l === null) continue;
    bars.push({ t: Date.parse(`${row[0]}T16:00:00+08:00`), o, h, l, c });
  }
  return bars;
}

/** "HHMM" (Hong Kong) to its place on the day's 332-point grid: 09:30–12:00 are 0–150, 13:00–16:00 are 151–331; the closing auction's print
 * (16:00 to 16:10) is the last point; anything else is null */
export function hkGridIndex(hhmm: string): number | null {
  const m = /^(\d{2})(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const t = Number(m[1]) * 60 + Number(m[2]);
  if (t >= 570 && t <= 720) return t - 570;
  if (t >= 780 && t <= 960) return t - 780 + 151;
  if (t > 960 && t <= 970) return 331;
  return null;
}

/** `hkMinute`'s one day: cumulative volume and amount per minute, put on the grid up to the last minute traded, the amount per minute; the
 * previous close is the quote block's field 4. One session, or null for another shape */
export function parseHkMinutes(text: string, code: string): CnMinutes[] | null {
  const node = nodeOf(text, code);
  if (!node || !isRecord(node.data) || !Array.isArray(node.data.data) || typeof node.data.date !== "string" || !/^\d{8}$/.test(node.data.date)) return null;
  const qt = isRecord(node.qt) ? node.qt[`hk${code}`] : undefined;
  const prec = Array.isArray(qt) ? figure(qt[4], true) : null;
  if (prec === null) return null;
  const points = new Map<number, { price: number; volume: number; amount: number }>();
  for (const row of node.data.data) {
    if (typeof row !== "string") continue;
    const [hhmm, p, v, a] = row.trim().split(/\s+/);
    const index = hkGridIndex(hhmm ?? "");
    const [price, volume, amount] = [figure(p, true), figure(v), figure(a)];
    if (index === null || price === null || volume === null || amount === null) continue;
    points.set(index, { price, volume, amount });
  }
  if (points.size === 0) return null;
  const last = Math.max(...points.keys());
  const price: number[] = [], amount: number[] = [];
  let lastPrice = prec, lastVolume = 0, lastAmount = 0;
  for (let i = 0; i <= last; i++) {
    const point = points.get(i);
    if (!point) { price.push(lastPrice); amount.push(0); continue; }
    if (point.volume < lastVolume || point.amount < lastAmount) return null;
    price.push(point.price);
    amount.push(Math.round((point.amount - lastAmount) * 100) / 100);
    lastPrice = point.price; lastVolume = point.volume; lastAmount = point.amount;
  }
  const d = node.data.date;
  return [{ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, prec, price, amount }];
}

// ---- search ----------------------------------------------------------------------------------------------------------------------
/** the smartbox reply (`v_hint="hk~00700~name~pinyin~GP^…"`, the name in JS escapes): the Hong Kong shares (kind GP) in the order given; the
 * RMB counters (codes from 80000) are another line of the same share and are left out. "N" is no suggestion; any other body is null */
export function parseHkSearch(text: string): HkHit[] | null {
  const m = /^\s*v_hint\s*=\s*("(?:[^"\\]|\\.)*")\s*;?\s*$/s.exec(text);
  if (!m) return null;
  const value = json(m[1]!);
  if (typeof value !== "string") return null;
  const rows = value && value !== "N" ? value.split("^").filter(Boolean) : [];
  const hits = new Map<string, HkHit>();
  for (const row of rows) {
    const f = row.split("~");
    if (f.length < 5) return null;
    const [market, code, name, , kind] = f;
    if (market !== "hk" || kind !== "GP" || !/^[0-7]\d{4}$/.test(code ?? "") || !name?.trim()) continue;
    if (!hits.has(code!)) hits.set(code!, { code: code!, name: name.trim() });
  }
  return [...hits.values()];
}
