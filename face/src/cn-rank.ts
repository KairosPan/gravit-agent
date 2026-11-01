/** `GET /data/cn/rank?sort=volume|movers`: the day's top 20 A shares from
 * Tencent's ranking (spec 2026-10-31 §4, §6), for the Markets screen's China
 * tab. `volume` is one call by turnover; `movers` is two by change, the
 * gainers and the losers merged by the size of the move. The session rides
 * along (`cn-session.ts`). Answers are kept per sort for {@link RANK_TTL_MS}
 * and shared by every tab; a failure is never kept. Behind the `/data` fence,
 * nothing logged. The board is not sent: the client reads it from the code.
 * @module
 */
import type { ServerResponse } from "node:http";
import type { RouteRegistrar } from "./static.ts";
import { FORBIDDEN, isTrustedDataRequest } from "./http.ts";
import { QUOTE_TIMEOUT_MS, type QuoteFetch } from "./quote-snapshots.ts";
import { readCnSession, type CnSession } from "./cn-session.ts";

export type RankSort = "volume" | "movers";
/** One ranked share; `turnover` in yuan. */
export interface RankItem { id: string; symbol: string; name: string; price: number | null; change_pct: number | null; turnover: number | null }
export interface RankAnswer { ok: true; sort: RankSort; total: number; asOf: string; session: CnSession; items: RankItem[] }
export type CnRank = (sort: RankSort) => Promise<RankAnswer>;

export const RANK_ROWS = 20;
export const RANK_TTL_MS = 10_000;
const BODY_LIMIT = 256 * 1024;
const RANK_URL = "https://proxy.finance.qq.com/cgi/cgi-bin/rank/hs/getBoardRankList";
const INVALID = '{"ok":false,"error":"invalid rank request"}';
const UNAVAILABLE = '{"ok":false,"error":"ranking unavailable"}';

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
function figure(value: unknown, positive = false): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && (!positive || n > 0) ? n : null;
}

/** Tencent's ranking JSON to its total and its A-share rows; a body of any other shape throws. */
export function parseTencentRank(body: string): { total: number; items: RankItem[] } {
  const value: unknown = JSON.parse(body);
  if (!isRecord(value) || value.code !== 0 || !isRecord(value.data)) throw new Error("invalid ranking");
  const { total, rank_list: rows } = value.data;
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0 || !Array.isArray(rows)) throw new Error("invalid ranking");
  const items: RankItem[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const code = typeof row.code === "string" ? /^(?:sh|sz|bj)(\d{6})$/.exec(row.code) : null;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!code || !name) continue;
    const turnover = figure(row.turnover);
    items.push({ id: `cn:${code[1]}`, symbol: code[1]!, name, price: figure(row.zxj, true), change_pct: figure(row.zdf),
      turnover: turnover === null ? null : Math.round(turnover * 10_000) });
  }
  return { total, items };
}

/** The gainers and the losers as one list: by the size of the move, largest first, then by turnover; each id once. */
export function mergeMovers(gainers: RankItem[], losers: RankItem[], limit = RANK_ROWS): RankItem[] {
  const seen = new Set<string>();
  const all = [...gainers, ...losers].filter((i) => !seen.has(i.id) && seen.add(i.id));
  const size = (i: RankItem) => (i.change_pct === null ? -1 : Math.abs(i.change_pct));
  return all.sort((a, b) => size(b) - size(a) || (b.turnover ?? -1) - (a.turnover ?? -1)).slice(0, limit);
}

export function createCnRank(options: { fetch?: QuoteFetch; now?: () => number; timeoutMs?: number } = {}): CnRank {
  const fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? QUOTE_TIMEOUT_MS;
  const kept = new Map<RankSort, { at: number; answer: RankAnswer }>();
  const flights = new Map<RankSort, Promise<RankAnswer>>();

  async function page(sortType: string, direct: string): Promise<{ total: number; items: RankItem[] }> {
    const url = new URL(`${RANK_URL}?_appver=11.17.0&board_code=aStock&sort_type=${sortType}&direct=${direct}&offset=0&count=${RANK_ROWS}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, { method: "GET", redirect: "error", signal: controller.signal });
      if (!response.ok) throw new Error("http");
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > BODY_LIMIT) throw new Error("payload");
      return parseTencentRank(new TextDecoder("utf-8").decode(bytes));
    } finally { clearTimeout(timer); }
  }

  async function read(sort: RankSort): Promise<RankAnswer> {
    const session = readCnSession(fetcher, now());
    let total: number, items: RankItem[];
    if (sort === "volume") ({ total, items } = await page("turnover", "down"));
    else {
      const [gainers, losers] = await Promise.all([page("priceRatio", "down"), page("priceRatio", "up")]);
      total = gainers.total;
      items = mergeMovers(gainers.items, losers.items);
    }
    return { ok: true, sort, total, asOf: new Date(now()).toISOString(), session: await session, items: items.slice(0, RANK_ROWS) };
  }

  return (sort) => {
    const hit = kept.get(sort);
    if (hit && now() - hit.at < RANK_TTL_MS) return Promise.resolve(hit.answer);
    const flying = flights.get(sort);
    if (flying) return flying;
    const flight = read(sort).then((answer) => { kept.set(sort, { at: now(), answer }); return answer; })
      .finally(() => flights.delete(sort));
    flights.set(sort, flight);
    return flight;
  };
}

/** Mount `/data/cn/rank` behind the `/data` fence. @returns the route's unwind (nothing to release: no connection is held). */
export function registerCnRankRoute(webServer: RouteRegistrar, rank: CnRank): () => void {
  const send = (res: ServerResponse, status: number, body: string): void => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
  };
  webServer.register({ kind: "exact", path: "/data/cn/rank", handler: async (req, res) => {
    if (!isTrustedDataRequest(req)) return send(res, 403, FORBIDDEN);
    if (req.method !== "GET") return send(res, 405, JSON.stringify({ ok: false, error: "method not allowed" }));
    let sort: RankSort;
    try {
      const params = new URL(req.url ?? "", "http://localhost").searchParams;
      const names = [...params.keys()];
      const value = params.get("sort");
      if (names.length !== 1 || names[0] !== "sort" || (value !== "volume" && value !== "movers")) return send(res, 400, INVALID);
      sort = value;
    } catch { return send(res, 400, INVALID); }
    try { send(res, 200, JSON.stringify(await rank(sort))); } catch { send(res, 503, UNAVAILABLE); }
  } });
  return () => {};
}
