/** `/data/market/<read>`: the market's public reads and its push channel, proxied (plan A2). The market (the service
 * in the repo's `market/`, on 127.0.0.1:4821, `FACE_MARKET_URL`) holds no key and no wallet; like the account it
 * answers only bare loopback requests, so the page asks the face and the face asks the market, on the same proxy core
 * as the account's half (src/upstream-proxy.ts: the fence, 405, the rebuilt query, the kept-answer cache, stale
 * re-serve, the unreachable codes, the piped stream and the POST rules).
 *
 * Seven exact routes, mapped one to one onto the market's own paths:
 * - five reads ({@link MARKET_READS}): `explore`, `quotes`, `candles`, `book` and `trades`, each
 *   `/data/market/<read>` → `/api/<read>`, their query names, TTLs and aborts copied from the account's routes of
 *   the same name (`ACCOUNT_QUERY`, `ACCOUNT_TTL_MS`, `ACCOUNT_ABORT_MS`), `pairs` with its own 2 000 characters;
 * - the stream, `/data/market/stream` → `/api/stream`, piped per browser connection, and its follows,
 *   `POST /data/market/stream/markets` → `/api/stream/markets`, under the account stream's query names, limits and
 *   aborts.
 *
 * The half follows the `mcp-market` row as composed (src/market-row.ts `composedMarketRow`): its URL, or, with the
 * row disabled, 503 `disabled` on every valid request and nothing asked — the account's half is not touched.
 * {@link registerMarketProxy} returns the `explore` and `quotes` reads in-process, which the desk's quotes are taken
 * from (src/market-quotes.ts). Nothing of a body, a query or a frame is logged here.
 * @module
 */
import { ACCOUNT_ABORT_MS, ACCOUNT_QUERY, ACCOUNT_TTL_MS } from "./account-proxy.ts";
import { marketUrl } from "./market-row.ts";
import type { RouteRegistrar } from "./static.ts";
import { mountReads, mountStream, type UpstreamRead, type UpstreamRouteRead, type UpstreamSettings } from "./upstream-proxy.ts";

/** The market's five public reads, in the order they are mounted. */
const READ_NAMES = ["explore", "quotes", "candles", "book", "trades"] as const;
type MarketReadName = typeof READ_NAMES[number];
/** `pairs` carries twelve `venue|symbol` markets: its bound is its own, as the account's `quotes` has it. */
const LONG_VALUES: Readonly<Partial<Record<MarketReadName, ReadonlyMap<string, number>>>> = { quotes: new Map([["pairs", 2_000]]) };

/** explore, quotes, candles, book, trades: face `/data/market/<r>` → `/api/<r>`, query names, TTLs and aborts copied
 * from the account's routes of the same name. */
export const MARKET_READS: readonly UpstreamRead[] = READ_NAMES.map((name) => ({
  face: `/data/market/${name}`,
  upstream: `/api/${name}`,
  query: ACCOUNT_QUERY[name],
  ...(LONG_VALUES[name] === undefined ? {} : { long: LONG_VALUES[name] }),
  ttlMs: ACCOUNT_TTL_MS[name],
  abortMs: ACCOUNT_ABORT_MS[name],
}));

/** A malformed request's answer, in the market's words. */
const INVALID = '{"ok":false,"error":"invalid market request"}';

/** Mount the market's seven routes on the host webserver. `url` defaults to `FACE_MARKET_URL` or
 * `http://127.0.0.1:4821`; `disabled` is the composed `mcp-market` row's. `explore` and `quotes` are those reads
 * in-process, through the same caches their routes are served from; `dispose` forgets every kept answer and aborts
 * every open stream's upstream. */
export function registerMarketProxy(
  webServer: RouteRegistrar,
  deps: { url?: string; fetch?: typeof fetch; now?: () => number; disabled?: boolean } = {},
): { explore: UpstreamRouteRead; quotes: UpstreamRouteRead; dispose(): void } {
  const s: UpstreamSettings = {
    url: (deps.url ?? marketUrl()).replace(/\/+$/, ""),
    doFetch: deps.fetch ?? fetch,
    now: deps.now ?? Date.now,
    disabled: deps.disabled === true,
    invalid: INVALID,
  };
  const reads = mountReads(webServer, s, MARKET_READS);
  const stream = mountStream(webServer, s, {
    face: "/data/market/stream", upstream: "/api/stream", followFace: "/data/market/stream/markets", followUpstream: "/api/stream/markets",
  });
  return {
    explore: reads.read.get("/data/market/explore")!,
    quotes: reads.read.get("/data/market/quotes")!,
    dispose: () => {
      reads.clear();
      stream.abortAll();
    },
  };
}
