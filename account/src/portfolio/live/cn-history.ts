/** An A share's price history from Tencent, parsed: the parsing half of the face's cn-candles.ts.
 * 1D and 5D are Tencent's minutes on the session's 242-point grid (`day/query`, five days at most);
 * the longer ranges are Tencent's forward-adjusted bars (`fqkline`, daily, weekly for 5Y, monthly for MAX).
 * The routes and the caches stay behind. */

export type ChinaRange = "1D" | "5D" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "5Y" | "MAX";
/** One session's minutes on the 242-point grid, up to the last minute traded; `date` is `YYYY-MM-DD`. */
export interface CnMinutes { date: string; prec: number; price: number[]; amount: number[] }
/** One bar; `t` is its date at 15:00 Beijing, in ms. */
export interface CnBar { t: number; o: number; h: number; l: number; c: number }

type Interval = "day" | "week" | "month";
export const CN_BARS: Record<Exclude<ChinaRange, "1D" | "5D">, [Interval, number]> = {
  "1M": ["day", 22], "3M": ["day", 66], "6M": ["day", 132], YTD: ["day", 260], "1Y": ["day", 250], "5Y": ["week", 260], MAX: ["month", 500],
};
export const HISTORY_BODY_LIMIT = 1024 * 1024;
const MINUTES_URL = "https://web.ifzq.gtimg.cn/appstock/app/day/query";
const KLINE_URL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const cents = (v: number) => Math.round(v * 100) / 100;

/** "HHMM" (Beijing) to its grid index: 09:30–11:30 are 0–120, 13:00–15:00 are 121–241; anything else is null. */
export function gridIndex(hhmm: string): number | null {
  const m = /^(\d{2})(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const t = Number(m[1]) * 60 + Number(m[2]);
  if (t >= 570 && t <= 690) return t - 570;
  if (t >= 780 && t <= 900) return t - 780 + 121;
  return null;
}

function nodeOf(body: string, code: string): Record<string, unknown> {
  const value: unknown = JSON.parse(body);
  if (!isRecord(value) || (value.code !== undefined && value.code !== 0 && value.code !== "0") || !isRecord(value.data)) throw new Error("invalid history");
  const node = Object.hasOwn(value.data, code) ? value.data[code] : undefined;
  if (!isRecord(node)) throw new Error("invalid history");
  return node;
}

/** Tencent's `day/query` to its sessions on the grid, oldest first; a body of another shape throws. */
export function parseDayQuery(body: string, code: string): CnMinutes[] {
  const days = nodeOf(body, code).data;
  if (!Array.isArray(days) || days.length > 10) throw new Error("invalid history");
  const sessions: CnMinutes[] = [];
  for (const day of [...days].reverse()) {
    if (!isRecord(day) || typeof day.date !== "string" || !/^\d{8}$/.test(day.date) || !Array.isArray(day.data)) throw new Error("invalid history");
    const prec = num(day.prec);
    if (prec === null || prec <= 0) throw new Error("invalid history");
    const points = new Map<number, { price: number; volume: number; amount: number }>();
    for (const row of day.data) {
      if (typeof row !== "string") continue;
      const [hhmm, p, v, a] = row.trim().split(/\s+/);
      const index = gridIndex(hhmm ?? "");
      const price = num(p), volume = num(v), amount = num(a);
      if (index === null || price === null || price <= 0 || volume === null || amount === null) continue;
      points.set(index, { price, volume, amount });
    }
    if (points.size === 0) continue;
    const last = Math.max(...points.keys());
    const price: number[] = [], amount: number[] = [];
    let lastPrice = prec, lastVolume = 0, lastAmount = 0;
    for (let i = 0; i <= last; i++) {
      const point = points.get(i);
      if (!point) { price.push(lastPrice); amount.push(0); continue; }
      if (point.volume < lastVolume || point.amount < lastAmount) throw new Error("cumulative figures went backwards");
      price.push(point.price);
      amount.push(cents(point.amount - lastAmount));
      lastPrice = point.price; lastVolume = point.volume; lastAmount = point.amount;
    }
    const d = day.date;
    sessions.push({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, prec, price, amount });
  }
  return sessions;
}

/** Tencent's forward-adjusted bars (`qfq<interval>`: date, open, close, high, low, volume) to bars, oldest first. */
export function parseKline(body: string, code: string, interval: Interval): CnBar[] {
  const rows = nodeOf(body, code)[`qfq${interval}`];
  if (!Array.isArray(rows)) throw new Error("invalid history");
  const bars: CnBar[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || typeof row[0] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row[0])) continue;
    const [o, c, h, l] = [num(row[1]), num(row[2]), num(row[3]), num(row[4])];
    if (o === null || c === null || h === null || l === null) continue;
    bars.push({ t: Date.parse(`${row[0]}T15:00:00+08:00`), o, h, l, c });
  }
  return bars;
}

/** The one GET a range needs for `code` (Tencent's code, `sh600519`). */
export function historyUrl(code: string, range: ChinaRange): string {
  if (range === "1D" || range === "5D") return `${MINUTES_URL}?code=${code}`;
  const [interval, count] = CN_BARS[range];
  return `${KLINE_URL}?param=${code},${interval},,,${count},qfq`;
}
