/** On-demand A-share discovery through Tencent's smartbox. Only individual
 * queries are cached, in memory; this service never downloads or persists a
 * market directory. Suggestions identify instruments, and deliberately carry no
 * quote.
 */
import type { ServerResponse } from "node:http";
import type { RouteRegistrar } from "./static.ts";
import { FORBIDDEN, HttpError, isTrustedDataRequest } from "./http.ts";

export type SearchMarket = "cn";
export interface SearchAsset {
  id: string;
  market: SearchMarket;
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  aliases: string[];
}
interface ProviderResult { assets: SearchAsset[]; truncated: boolean }
interface ProviderStatus { id: string; status: "ok" | "error"; message?: string }
export interface SearchResult {
  ok: boolean;
  assets: SearchAsset[];
  providers: ProviderStatus[];
  partial: boolean;
  truncated: boolean;
  error?: string;
  note?: string;
}
export const SEARCH_TTL_MS = 60_000;
export const SEARCH_TIMEOUT_MS = 6_000;
export const SEARCH_CACHE_LIMIT = 128;
export const SEARCH_FLIGHT_LIMIT = 32;
export const SEARCH_RESPONSE_LIMIT = 256 * 1024;
const RESULT_LIMIT = 30;
export type SearchFetch = (url: URL, options: RequestInit) => Promise<Response>;
/** One search, as {@link createSymbolSearch} makes it: a bounded query and a market in, a result out. */
export type SymbolSearch = (query: string, market: SearchMarket) => Promise<SearchResult>;

/** Normalize only user input. `market` may name `cn` or `all` — both the A
 * shares, the one market searched — and nothing else; it never picks a host or
 * path. The bounded query is always URL-encoded upstream. */
export function parseSearchRequest(rawUrl: string): { query: string; market: SearchMarket } {
  if (rawUrl.length > 2048 || /%(?![a-f\d]{2})/i.test(rawUrl)) throw new HttpError(400, "invalid search query");
  const url = new URL(rawUrl, "http://localhost");
  if (url.searchParams.getAll("q").length !== 1 || url.searchParams.getAll("market").length > 1) {
    throw new HttpError(400, "invalid search query");
  }
  const raw = url.searchParams.get("q") ?? "";
  if (/[\u0000-\u001f\u007f-\u009f\ufffd]/u.test(raw)) throw new HttpError(400, "invalid search query");
  const query = raw.trim().normalize("NFKC");
  if (!query || [...query].length > 80 || Buffer.byteLength(query) > 240) throw new HttpError(400, "invalid search query");
  const market = url.searchParams.get("market") ?? "all";
  if (market !== "all" && market !== "cn") throw new HttpError(400, "invalid market");
  return { query, market: "cn" };
}

/** The kinds Tencent files an A share under: `GP-A`, and `GP-A-KCB` on the STAR
 * Market, its CDRs among them. An index (`ZS`), a fund (`ETF`, `LOF`, `KJ`) and
 * a B share (`GP-B`) are none: their codes collide with an A share's
 * (`sh000001`, the index, beside `sz000001`) or are no code the quote wire files. */
const A_SHARE_KINDS = new Set(["GP-A", "GP-A-KCB"]);

/** Tencent's smartbox returns a JavaScript string assignment, not executable
 * data. Parse the quoted string as JSON; never evaluate vendor JavaScript. */
export function parseTencentSearch(body: string): ProviderResult {
  const match = /^\s*v_hint\s*=\s*("(?:[^"\\]|\\.)*")\s*;?\s*$/s.exec(body);
  if (!match) throw new Error("invalid provider response");
  const value: unknown = JSON.parse(match[1]!);
  if (typeof value !== "string") throw new Error("invalid provider response");
  // Tencent explicitly uses "N" for a successful query with no suggestions.
  const rows = value && value !== "N" ? value.split("^").filter(Boolean) : [];
  const assets = new Map<string, SearchAsset>();
  for (const row of rows) {
    if (row.split("~").length < 5) throw new Error("invalid provider response");
    const [venue, symbol, name, alias, kind] = row.split("~");
    if (!venue || !["sh", "sz", "bj"].includes(venue) || !A_SHARE_KINDS.has(kind ?? "")
      || !symbol || !/^\d{6}$/.test(symbol) || !name?.trim()) continue;
    const asset: SearchAsset = {
      id: `cn:${symbol}`, market: "cn", symbol, name: name.trim(), currency: "CNY",
      exchange: venue.toUpperCase(), aliases: alias ? [alias] : [],
    };
    assets.set(asset.id, asset);
  }
  return { assets: [...assets.values()], truncated: rows.length >= 10 };
}

/** Read a bounded streaming body, including providers without Content-Length. */
async function readProvider(response: Response, encoding: string): Promise<string> {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("provider unavailable");
  }
  if (Number(response.headers.get("content-length")) > SEARCH_RESPONSE_LIMIT) {
    await response.body.cancel();
    throw new Error("provider response too large");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > SEARCH_RESPONSE_LIMIT) throw new Error("provider response too large");
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  return new TextDecoder(encoding).decode(Buffer.concat(chunks));
}

/** Test seams replace network/clock/deadline; production always uses this one
 * fixed HTTPS endpoint, without redirects or user-supplied credentials. */
export function createSymbolSearch(options: { fetch?: SearchFetch; now?: () => number; timeoutMs?: number } = {}): SymbolSearch {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; result: SearchResult }>();
  const inflight = new Map<string, Promise<SearchResult>>();

  async function upstream(query: string): Promise<ProviderResult> {
    const url = new URL("https://smartbox.gtimg.cn/s3/");
    url.searchParams.set("q", query);
    url.searchParams.set("t", "all");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("provider timeout"));
      }, options.timeoutMs ?? SEARCH_TIMEOUT_MS);
    });
    const request = async (): Promise<ProviderResult> => {
      const response = await fetcher(url, { signal: controller.signal, redirect: "error",
        headers: { accept: "application/json, text/plain, */*", "user-agent": "Mozilla/5.0 Gravit-Symbol-Search" } });
      return parseTencentSearch(await readProvider(response, "gb18030"));
    };
    try { return await Promise.race([request(), deadline]); }
    finally { clearTimeout(timer); controller.abort(); }
  }

  async function run(query: string): Promise<SearchResult> {
    let found: ProviderResult;
    try { found = await upstream(query); } catch {
      const message = "搜索服务暂时不可用，请稍后重试。";
      return { ok: false, assets: [], providers: [{ id: "tencent", status: "error", message }], partial: false, truncated: false,
        error: message, note: message };
    }
    return { ok: true, assets: found.assets.slice(0, RESULT_LIMIT), providers: [{ id: "tencent", status: "ok" }], partial: false,
      truncated: found.truncated || found.assets.length > RESULT_LIMIT, note: "在线搜索结果由数据服务提供；搜索结果不含实时行情。" };
  }

  return async (query, market) => {
    const key = JSON.stringify([market, query.toLocaleLowerCase("en-US")]);
    const hit = cache.get(key);
    if (hit && now() - hit.at < SEARCH_TTL_MS) {
      cache.delete(key);
      cache.set(key, hit);
      return hit.result;
    }
    cache.delete(key);
    const pending = inflight.get(key);
    if (pending) return pending;
    if (inflight.size >= SEARCH_FLIGHT_LIMIT) throw new HttpError(429, "搜索请求过多，请稍后重试。");
    const flight = run(query).then((result) => {
      // Retry a failed provider on the next query instead of masking its outage.
      if (result.ok) {
        cache.set(key, { at: now(), result });
        if (cache.size > SEARCH_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      }
      return result;
    });
    inflight.set(key, flight);
    const clear = (): void => { inflight.delete(key); };
    void flight.then(clear, clear);
    return flight;
  };
}

/** Mount `/data/symbols/search` behind the face's `/data` fence (http.ts's
 * {@link isTrustedDataRequest}), answering from `search`.
 * @param webServer - the host webserver service, or a test recorder.
 * @param search - the search to answer from: {@link createSymbolSearch}'s, with its seams for tests.
 * @returns the route's unwind: it unregisters the route when the registrar gave a disposer back.
 */
export function registerSymbolSearchRoute(webServer: RouteRegistrar, search: SymbolSearch): () => void {
  const send = (res: ServerResponse, status: number, body: string): void => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
  };
  const unregister = webServer.register({ kind: "exact", path: "/data/symbols/search", handler: async (req, res) => {
    if (!isTrustedDataRequest(req)) return send(res, 403, FORBIDDEN);
    if (req.method !== "GET") return send(res, 405, JSON.stringify({ ok: false, error: "method not allowed" }));
    try {
      const { query, market } = parseSearchRequest(req.url ?? "");
      const result = await search(query, market);
      send(res, result.ok ? 200 : 503, JSON.stringify(result));
    } catch (error) {
      send(res, error instanceof HttpError ? error.status : 503,
        JSON.stringify({ ok: false, error: error instanceof HttpError ? error.message : "搜索服务暂时不可用，请稍后重试。" }));
    }
  } });
  return () => { if (typeof unregister === "function") unregister(); };
}
