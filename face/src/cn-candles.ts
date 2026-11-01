/** `GET /data/cn/candles?id=cn:<code>&range=<1D…MAX>`: an A share's price
 * history for its Markets page (spec 2026-10-31 §5). 1D and 5D are Tencent's
 * minutes on the session's 242-point grid (`day/query`, five days at most);
 * the longer ranges are Tencent's forward-adjusted bars (`fqkline`, daily,
 * weekly for 5Y, monthly for MAX), in the Account's candle shape. The grid
 * rules are the Lunhui parser's (`face/plugins/lunhui/lib/market.mjs`
 * `parseTencentMinutes`), copied: the face imports nothing from `plugins/`.
 * Behind the `/data` fence, nothing logged; answers kept per id and range.
 * @module
 */
import type { ServerResponse } from "node:http";
import type { RouteRegistrar } from "./static.ts";
import { FORBIDDEN, isTrustedDataRequest } from "./http.ts";
import { parseInstrumentId } from "./quotes.ts";
import { QUOTE_TIMEOUT_MS, tencentCode, type QuoteFetch } from "./quote-snapshots.ts";
import type { QuoteIdentity } from "./quote-types.ts";

/** The ranges a page asks for; equal to the client's `CANDLE_RANGES` (a test pins it). */
export const CN_RANGES = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;
export type CnRange = typeof CN_RANGES[number];
/** One session's minutes on the 242-point grid, up to the last minute traded; `date` is `YYYY-MM-DD`. */
export interface CnMinutes { date: string; prec: number; price: number[]; amount: number[] }
/** One bar; `t` is its date at 15:00 Beijing, in ms. */
export interface CnCandle { t: number; o: number; h: number; l: number; c: number }
export type CandleAnswer =
  | { ok: true; range: "1D" | "5D"; sessions: CnMinutes[] }
  | { ok: true; range: Exclude<CnRange, "1D" | "5D">; candles: CnCandle[] };
export type CnCandles = (asset: QuoteIdentity, range: CnRange) => Promise<CandleAnswer>;

type Interval = "day" | "week" | "month";
const BARS: Record<Exclude<CnRange, "1D" | "5D">, [Interval, number]> = {
  "1M": ["day", 22], "3M": ["day", 66], "6M": ["day", 132], YTD: ["day", 260], "1Y": ["day", 250], "5Y": ["week", 260], MAX: ["month", 500],
};
const MINUTES_URL = "https://web.ifzq.gtimg.cn/appstock/app/day/query";
const KLINE_URL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
const BODY_LIMIT = 1024 * 1024;
const MINUTES_TTL_MS = 30_000, BARS_TTL_MS = 600_000;
const INVALID = '{"ok":false,"error":"invalid candles request"}';
const UNAVAILABLE = '{"ok":false,"error":"history unavailable"}';

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

/** Tencent's forward-adjusted bars (`qfq<interval>`: date, open, close, high, low, volume) to candles, oldest first. */
export function parseKline(body: string, code: string, interval: Interval): CnCandle[] {
  const rows = nodeOf(body, code)[`qfq${interval}`];
  if (!Array.isArray(rows)) throw new Error("invalid history");
  const candles: CnCandle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || typeof row[0] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row[0])) continue;
    const [o, c, h, l] = [num(row[1]), num(row[2]), num(row[3]), num(row[4])];
    if (o === null || c === null || h === null || l === null) continue;
    candles.push({ t: Date.parse(`${row[0]}T15:00:00+08:00`), o, h, l, c });
  }
  return candles;
}

export function createCnCandles(options: { fetch?: QuoteFetch; now?: () => number; timeoutMs?: number } = {}): CnCandles {
  const fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? QUOTE_TIMEOUT_MS;
  const kept = new Map<string, { at: number; answer: CandleAnswer }>();
  const flights = new Map<string, Promise<CandleAnswer>>();

  async function get(url: URL): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, { method: "GET", redirect: "error", signal: controller.signal });
      if (!response.ok) throw new Error("http");
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > BODY_LIMIT) throw new Error("payload");
      return new TextDecoder("utf-8").decode(bytes);
    } finally { clearTimeout(timer); }
  }

  async function read(code: string, range: CnRange): Promise<CandleAnswer> {
    if (range === "1D" || range === "5D") {
      const sessions = parseDayQuery(await get(new URL(`${MINUTES_URL}?code=${code}`)), code);
      return range === "1D" ? { ok: true, range, sessions: sessions.slice(-1) } : { ok: true, range, sessions: sessions.slice(-5) };
    }
    const [interval, count] = BARS[range];
    let candles = parseKline(await get(new URL(`${KLINE_URL}?param=${code},${interval},,,${count},qfq`)), code, interval);
    if (range === "YTD" && candles.length) {
      const from = Date.parse(`${new Date(candles.at(-1)!.t).getUTCFullYear()}-01-01T00:00:00+08:00`);
      candles = candles.filter((c) => c.t >= from);
    }
    return { ok: true, range, candles };
  }

  return (asset, range) => {
    const code = tencentCode(asset.symbol);
    if (!code) return Promise.reject(new Error("no Tencent code"));
    const key = `${asset.id}|${range}`;
    const hit = kept.get(key);
    const ttl = range === "1D" || range === "5D" ? MINUTES_TTL_MS : BARS_TTL_MS;
    if (hit && now() - hit.at < ttl) return Promise.resolve(hit.answer);
    const flying = flights.get(key);
    if (flying) return flying;
    const flight = read(code, range).then((answer) => { kept.set(key, { at: now(), answer }); return answer; })
      .finally(() => flights.delete(key));
    flights.set(key, flight);
    return flight;
  };
}

/** Mount `/data/cn/candles` behind the `/data` fence. @returns the route's unwind (it holds nothing). */
export function registerCnCandlesRoute(webServer: RouteRegistrar, candles: CnCandles): () => void {
  const send = (res: ServerResponse, status: number, body: string): void => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
  };
  webServer.register({ kind: "exact", path: "/data/cn/candles", handler: async (req, res) => {
    if (!isTrustedDataRequest(req)) return send(res, 403, FORBIDDEN);
    if (req.method !== "GET") return send(res, 405, JSON.stringify({ ok: false, error: "method not allowed" }));
    let asset: QuoteIdentity | null = null, range: CnRange;
    try {
      const params = new URL(req.url ?? "", "http://localhost").searchParams;
      const names = [...params.keys()].sort();
      const r = params.get("range") as CnRange | null;
      asset = parseInstrumentId(params.get("id") ?? "");
      if (names.join(",") !== "id,range" || !asset || !r || !CN_RANGES.includes(r) || !tencentCode(asset.symbol)) return send(res, 400, INVALID);
      range = r;
    } catch { return send(res, 400, INVALID); }
    try { send(res, 200, JSON.stringify(await candles(asset, range))); } catch { send(res, 503, UNAVAILABLE); }
  } });
  return () => {};
}
