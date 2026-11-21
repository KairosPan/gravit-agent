/** Eastmoney's public lists and bars, the fallback and the backbone of the local regions: a clist (a ranking), a ulist (named secids) and a
 * daily kline, parsed. Every ask goes through `politeHosts(EASTMONEY_HOSTS)` with the Referer it wants, 4 s a try, one more try at most on a
 * timeout or a network error. A refusal carries the market's words, never Eastmoney's text, a URL or a thrown message. */
import type { Refusal } from "../core/errors.ts";
import { no } from "../refuse.ts";
import type { CnBar } from "./cn-history.ts";
import { realCnHttp, type CnHttp, type CnReply } from "./cn-http.ts";
import { EASTMONEY_HOSTS, politeHosts, retryOnce } from "./local-http.ts";

export const EASTMONEY_NAME = "Eastmoney";
export const EASTMONEY_TIMEOUT_MS = 4_000;
const BODY_LIMIT = 2 * 1024 * 1024;
const LIST_UT = "bd1d9ddb04089700cf9c27f6f7426281";
const HISTORY_UT = "fa5fd1943c7b386f172d6893dbfba10b";
const LIST_FIELDS = "f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18";
const SECID_FIELDS = "f2,f3,f4,f12,f14,f18,f124";
const REFERER = "https://quote.eastmoney.com/";
const UNAVAILABLE = "Eastmoney is not answering";

export interface EmRow {
  code: string; name: string; price: number | null; changePct: number | null; change: number | null; turnover: number | null;
  prevClose: number | null; open: number | null; high: number | null; low: number | null; volume: number | null;
  /** the quote's own time, ISO 8601, where the row carries one (f124, epoch seconds) */
  at?: string;
}

/** a ranking: `fs` is Eastmoney's market filter (`m:128+t:3,...`), `fid` the field it sorts by, largest first */
export function emListUrl(fs: string, o: { fid: "f6" | "f3"; pz: number }): string {
  return `https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=${o.pz}&po=1&np=1&fltt=2&invt=2&fid=${o.fid}&fs=${fs}&fields=${LIST_FIELDS}&ut=${LIST_UT}`;
}
/** named things (`100.N225`) in one ask */
export function emSecidsUrl(secids: readonly string[]): string {
  return `https://push2delay.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids.join(",")}&fields=${SECID_FIELDS}&ut=${LIST_UT}`;
}
/** daily bars, the latest `limit`, forward-adjusted */
export function emKlineUrl(secid: string, limit: number): string {
  return `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&lmt=${limit}&end=20500101&ut=${HISTORY_UT}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
/** Eastmoney writes a missing number as "-" */
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "" || v.trim() === "-") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
function json(text: string): Record<string, unknown> | null {
  try { const v: unknown = JSON.parse(text); return isRecord(v) ? v : null; } catch { return null; }
}

/** a clist or ulist reply to its rows; null for anything that is not that JSON (an HTML page, a busy notice, a body with no rows) */
export function parseEmList(text: string): EmRow[] | null {
  const body = json(text);
  const data = body?.data;
  if (!isRecord(data)) return null;
  const diff = Array.isArray(data.diff) ? data.diff : isRecord(data.diff) ? Object.values(data.diff) : null;
  if (diff === null) return null;
  const rows: EmRow[] = [];
  for (const r of diff) {
    if (!isRecord(r) || typeof r.f12 !== "string" || r.f12 === "" || typeof r.f14 !== "string") continue;
    const stamp = num(r.f124);
    rows.push({
      code: r.f12, name: r.f14, price: num(r.f2), changePct: num(r.f3), change: num(r.f4), volume: num(r.f5), turnover: num(r.f6),
      high: num(r.f15), low: num(r.f16), open: num(r.f17), prevClose: num(r.f18),
      ...(stamp !== null && stamp > 0 ? { at: new Date(stamp * 1000).toISOString() } : {}),
    });
  }
  return rows;
}

/** a kline reply (`date,open,close,high,low,...` rows) to bars, oldest first; null for anything that is not that JSON */
export function parseEmKline(text: string): CnBar[] | null {
  const data = json(text)?.data;
  if (!isRecord(data) || !Array.isArray(data.klines)) return null;
  const bars: CnBar[] = [];
  for (const row of data.klines) {
    if (typeof row !== "string") continue;
    const [date, o, c, h, l] = row.split(",");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const [open, close, high, low] = [num(o), num(c), num(h), num(l)];
    if (open === null || close === null || high === null || low === null) continue;
    bars.push({ t: Date.parse(`${date}T15:00:00+08:00`), o: open, h: high, l: low, c: close });
  }
  return bars;
}

const unavailable = (): Refusal => no("E_VENUE_UNREACHABLE", { venue: EASTMONEY_NAME, message: UNAVAILABLE });

export function eastmoney(deps: { http?: CnHttp; clock?: () => number } = {}): {
  list(url: string): Promise<EmRow[] | Refusal>;
  kline(url: string): Promise<CnBar[] | Refusal>;
} {
  const http = politeHosts(deps.http ?? realCnHttp, EASTMONEY_HOSTS, deps.clock ? { clock: deps.clock } : {});
  /** one try bounded by its own timer, so a source that never answers is let go; the reply must be a 200 */
  const ask = (url: string): Promise<CnReply> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), EASTMONEY_TIMEOUT_MS); });
    const work = http(url, { timeoutMs: EASTMONEY_TIMEOUT_MS, maxBytes: BODY_LIMIT, headers: { referer: REFERER, accept: "application/json, text/plain, */*" } });
    work.catch(() => {});
    return Promise.race([work, timedOut]).finally(() => clearTimeout(timer));
  };
  async function read<T>(url: string, parse: (text: string) => T | null): Promise<T | Refusal> {
    try {
      const reply = await retryOnce(() => ask(url));
      if (reply.status !== 200) return unavailable();
      const parsed = parse(new TextDecoder("utf-8").decode(reply.bytes));
      return parsed === null ? unavailable() : parsed;
    } catch { return unavailable(); }
  }
  return { list: (url) => read(url, parseEmList), kline: (url) => read(url, parseEmKline) };
}
