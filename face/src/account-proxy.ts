/** `/data/account` and `/data/account/<route>`: the Account's reads and the
 * owner's writes, proxied (spec 2026-10-22 §5.1). The Account (after Linqi's
 * buyer-agent-demo, the service in the repo's `account/`, on 127.0.0.1:4820)
 * answers only bare loopback requests — its fence refuses any page at another
 * origin — so the face's page never asks it: the page asks the face, and the
 * face asks the Account with a plain loopback fetch (no Origin, no
 * Sec-Fetch-Site, no cookie, the URL's own Host, `redirect: "error"`).
 * Forty-three routes: twenty-five reads ({@link ReadRoute} — the Account,
 * a connected venue's market and comparison, holdings and venues, the wallet
 * half's `asset`, `funding`, `receive`, `earn`, `sellable` and
 * `signin/status`, and, since plan A2, a connected venue's own
 * `connected/{explore,quotes,candles,book,trades}`, and, since plan B1a, the
 * Identity tab's `identity` and `identity/pending`; the public reads
 * `explore`, `quotes`, `candles`, `book` and `trades` are the market's,
 * src/market-proxy.ts, since plan A2's Task 7), the Account's push channel — `stream`, and
 * `stream/markets`, the markets it follows — and fifteen writes
 * ({@link WriteRoute}: `pair`, `prepare`, `exchange`, `wallet/challenge`,
 * `wallet/prove`, `signin/start`, `bridge-routes`, `live/order-sent`,
 * `live/order-requote`, `live/sent`, `revoke`, `guard`, and Identity's
 * `identity/telegram/token`, `identity/pending/not-me` and
 * `identity/pending/drop`) — and the OAuth
 * sign-in's callback, `signin/callback`, the one route a venue's page navigates
 * the browser to; each an `exact` route, never a prefix: the route table is the allow-list, and nothing else
 * of the Account's surface is reachable through the face — the identity
 * `inbox` and `send` among it: no page reaches the operator's texts or a
 * message to the phone.
 * {@link registerAccountProxy} returns the `account` route's reader, which
 * `main.ts` hands to `seat.ts`: `/data/seat.json` and `/data/account` share
 * one upstream read. {@link createAccountReader} is that read without a
 * route, for a seat route handed none.
 *
 * The rules, the seat route's generalised (since plan A2 they live in the proxy core, src/upstream-proxy.ts,
 * which the market's half, src/market-proxy.ts, is built on too; the writes and the callback stay here):
 * - The fence first (`isTrustedDataRequest`, 403 with the fixed body), then 405
 *   for any method but the route's (GET; POST for `stream/markets` and the
 *   writes), then the query, rebuilt from the route's names in
 *   {@link ACCOUNT_QUERY} ({@link rebuildQuery}); anything else is 400
 *   `invalid account request` and
 *   the Account is never asked. The raw query never reaches it, and `fresh` is
 *   the face's own flag, never forwarded. A disabled seat row disables the
 *   proxy: every valid read then answers 503 `disabled` and asks nothing (a
 *   malformed query or a wrong method is refused before the row's state is
 *   consulted, and so, on a POST route, are a body not declared JSON, 415,
 *   and a body past its limit, 413).
 * - The Account's status and body pass through as they are, never parsed: its
 *   `{ok:false, refusal}` is the page's to draw, in its words. Every JSON
 *   answer is `application/json` and `no-store`, as the Account's own reads
 *   are.
 * - A failure of the fetch itself — refused, hanging past the route's abort on
 *   the headers or the body, a body that cannot be read — is a state, not an
 *   error: 503 `{"ok":false,"unreachable":"<CODE>"}` with the failure's code,
 *   never its text; a query with a kept answer is re-served that answer
 *   flagged `stale: true` instead (http.ts's `markStale`). The reader never
 *   re-serves stale: the seat box shows the service's absence.
 * - Only a 2xx answer is kept: per route by rebuilt query for the route's
 *   {@link ACCOUNT_TTL_MS}, at most {@link ACCOUNT_CACHE_KEYS} queries, the
 *   least recently used out first; a refusal is never kept and never
 *   re-served. Reads of one query share one fetch; `?fresh=1` skips the TTL
 *   and never joins a plain read in flight — it asks again once that one
 *   settles (the seat route's rule).
 * - `stream` is piped, one upstream request per browser connection, never
 *   kept: `client` required ({@link STREAM_CLIENT}), `since` the browser's
 *   `Last-Event-ID` when it sends one, else the query's (the Account's own
 *   order), `markets` at most 4 000 characters, each name once. The
 *   Account's 200 is written through chunk by chunk as it comes — ids,
 *   `retry:`, its heartbeat — never buffered, re-framed or read, and the
 *   response ends when the Account ends the stream. The upstream is
 *   aborted when the browser's response closes or errors, when the browser
 *   falls 256 KiB behind (the response then destroyed, as `quotes.ts` does)
 *   and on `dispose`. Any other answer is the Account's status and body — its
 *   refusal past 32 streams among them.
 * - The sixteen POST routes — `stream/markets` and the fifteen writes, each at
 *   its Account path ({@link WRITE_PATHS}: `exchange` is `/api/exchange`,
 *   `revoke` `/api/revoke`, `guard` `/api/mode`, the rest
 *   `/api/account/<path>`) — take a body declared `application/json` (else 415, as
 *   the face's other POST routes answer) and a target that names no query
 *   parameter (else 400), both refused before the body is read. The body — at
 *   most the route's bytes ({@link STREAM_BODY_LIMIT}, {@link WRITE_BODY_LIMIT}),
 *   else 413 — is forwarded as posted with `content-type: application/json`,
 *   never parsed, kept or echoed; a disabled row answers `disabled` once the
 *   body is read. The Account's status and body come back as they are, never
 *   kept and never stale; the request is cut at the route's abort
 *   ({@link WRITE_ABORT_MS}; 7 s for `stream/markets`).
 * - The one exception to "forwarded as posted": `guard`'s body is read under
 *   its 256 bytes and discarded; the Account always receives `{"mode":"guard"}`.
 * - `wallet/challenge` and `signin/start` alone carry {@link FACE_ORIGIN_HEADER},
 *   `http://` and the browser's own loopback `Host` ({@link faceOriginOf}), never
 *   a header the browser names.
 * - `signin/callback` has its own fence, `isTrustedNavigation` (a loopback Host, a
 *   GET top-level document navigation, no Origin; any Sec-Fetch-Site, since the
 *   venue's page sends `cross-site`), else 403 with the fixed body; every other
 *   route still refuses that navigation. Its query is rebuilt from
 *   {@link CALLBACK_QUERY}, each name at most once and within its bound (else
 *   400), and forwarded to `GET /api/account/signin/callback`, cut at 30 s,
 *   never kept and never stale. The Account's status and its HTML page come back
 *   with {@link CALLBACK_HEADERS} (a content-security-policy of no script, no load,
 *   no form, no frame among them); a failed fetch or a disabled row is 503 with
 *   the fixed page {@link CALLBACK_UNREACHABLE}.
 * - Nothing of a body, a query or a frame is logged here.
 * @module
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { seatUrl } from "./account-seat.ts";
import { FORBIDDEN, isLoopbackHost, isTrustedNavigation } from "./http.ts";
import type { RouteRegistrar } from "./static.ts";
import {
  UPSTREAM_CACHE_KEYS, askUpstream, mountReads, mountStream, postHandler, rebuildQueryOf, searchOf, send, upstreamReads,
  type PostOptions, type UpstreamAnswer, type UpstreamRead, type UpstreamReads, type UpstreamSettings,
} from "./upstream-proxy.ts";

/** The Account's reads the face proxies: `account` is its `GET /api/account`, `reach` its
 * `GET /api/account/connect/reach`, `books` its `GET /api/account/paper/books`, a `connected<X>` its
 * `GET /api/account/connected/<x>` (a connected venue's own data, plan A2), the rest `GET /api/account/<route>`;
 * the face's path is the same under `/data/account`. */
export type ReadRoute =
  | "account" | "market" | "compare" | "holdings" | "positions" | "statement" | "history" | "agents"
  | "venues" | "reach" | "keyfile" | "books"
  | "asset" | "funding" | "receive" | "earn" | "sellable" | "signinStatus"
  | "connectedExplore" | "connectedQuotes" | "connectedCandles" | "connectedBook" | "connectedTrades"
  | "identity" | "identityPending";

/** How long one answer is served without asking again, per route: the retired page's cadence (spec §5.1). */
export const ACCOUNT_TTL_MS: Readonly<Record<ReadRoute, number>> = {
  account: 15_000, market: 3_000, compare: 15_000,
  holdings: 8_000, positions: 10_000, statement: 10_000, history: 60_000, agents: 15_000,
  venues: 60_000, reach: 5_000, keyfile: 5_000, books: 5_000,
  asset: 5_000, funding: 60_000, receive: 60_000, earn: 15_000, sellable: 5_000, signinStatus: 1_000,
  connectedExplore: 20_000, connectedQuotes: 3_000, connectedCandles: 30_000, connectedBook: 2_000, connectedTrades: 2_000,
  identity: 2_000, identityPending: 1_000,
};

/** How long the Account may take, headers and body, per route: the reads that settle venue polls take
 * seconds, a first candles view waits for a source, and a cold venues or reach read probes every venue. */
export const ACCOUNT_ABORT_MS: Readonly<Record<ReadRoute, number>> = {
  account: 7_000, market: 7_000, compare: 7_000,
  holdings: 12_000, positions: 7_000, statement: 7_000, history: 12_000, agents: 7_000,
  venues: 30_000, reach: 30_000, keyfile: 30_000, books: 30_000,
  asset: 25_000, funding: 12_000, receive: 30_000, earn: 30_000, sellable: 30_000, signinStatus: 7_000,
  connectedExplore: 10_000, connectedQuotes: 7_000, connectedCandles: 25_000, connectedBook: 7_000, connectedTrades: 7_000,
  identity: 7_000, identityPending: 7_000,
};

/** The writes the face proxies, each a POST, at the face's and the Account's paths in {@link WRITE_PATHS}: the
 * owner's `pair`, `prepare` and `exchange`; the wallet's `challenge` and `prove`; the sign-in's `signinStart`;
 * `bridgeRoutes`; the live order's `orderSent`, `orderRequote` and `sent`; the two unsigned writes the
 * Account itself defines as the safer direction, `revoke` (Close to agents) and `guard`; and, since plan B1a, the
 * Identity tab's three: `identityToken` (the bot's token, its body forwarded unparsed and unlogged, never kept),
 * `identityNotMe` and `identityDrop`. */
export type WriteRoute =
  | "pair" | "prepare" | "exchange"
  | "challenge" | "prove" | "signinStart" | "bridgeRoutes" | "orderSent" | "orderRequote" | "sent" | "revoke" | "guard"
  | "identityToken" | "identityNotMe" | "identityDrop";

/** Most bytes a write's body may carry, per route; `guard`'s is read under its limit and discarded. */
export const WRITE_BODY_LIMIT: Readonly<Record<WriteRoute, number>> = {
  pair: 4_096, prepare: 16_384, exchange: 65_536,
  challenge: 1_024, prove: 2_048, signinStart: 512, bridgeRoutes: 4_096, orderSent: 512, orderRequote: 512, sent: 512, revoke: 512, guard: 256,
  identityToken: 1_024, identityNotMe: 256, identityDrop: 256,
};

/** How long the Account may take on a write, headers and body, per route: a prepare asks the venue for a quote. */
export const WRITE_ABORT_MS: Readonly<Record<WriteRoute, number>> = {
  pair: 7_000, prepare: 30_000, exchange: 30_000,
  challenge: 7_000, prove: 12_000, signinStart: 30_000, bridgeRoutes: 30_000, orderSent: 30_000, orderRequote: 30_000, sent: 30_000,
  revoke: 7_000, guard: 7_000,
  identityToken: 30_000, identityNotMe: 7_000, identityDrop: 7_000,
};

/** The header that tells the Account the browser's own origin on the face, set on `challenge` and `signinStart`
 * alone: the Account builds the wallet message's domain and the sign-in's redirect on it. */
export const FACE_ORIGIN_HEADER = "x-gravit-face-origin";

/** The face's origin as the browser reached it: `http://` and the request's `Host` as WHATWG parses it, only for
 * a loopback Host ({@link isLoopbackHost}); else `null`. Derived from the Host alone, never from a header the
 * browser could name. */
export function faceOriginOf(req: IncomingMessage): string | null {
  const host = req.headers.host;
  if (!isLoopbackHost(host)) return null;
  try {
    return `http://${new URL(`http://${host}`).host}`;
  } catch {
    return null;
  }
}

/** The OAuth callback's query names, each with the longest value it may carry, in characters, decoded: what a
 * venue's authorization server sends back (RFC 6749 §4.1.2, `error_uri` among them, which the Account's `finish` ignores; RFC 9207's
 * `iss`). */
export const CALLBACK_QUERY: ReadonlyMap<string, number> = new Map([
  ["state", 240], ["code", 2_000], ["error", 240], ["error_description", 1_000], ["error_uri", 500], ["iss", 500],
]);

/** How long the Account may take to finish a sign-in, headers and body: it trades the code at the venue. */
export const CALLBACK_ABORT_MS = 30_000;

/** The callback's answer headers: the callback's page, never kept, never sniffed, its URL (which carried the code)
 * never sent on as a referrer — and, since the page is served on the face's own origin beside the owner's key in
 * IndexedDB, a policy that lets it run no script, load nothing, post no form and be framed by no one: its inline
 * style alone is drawn. (The Account's success page carries no script: its words say the tab may be closed.) */
export const CALLBACK_HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
} as const;

/** The callback's page when the Account did not answer, or the row is disabled. */
export const CALLBACK_UNREACHABLE = "The Account did not answer. Go back to Gravit and start the sign-in again.";

/** Most queries kept per route; the least recently used leaves first. */
export const ACCOUNT_CACHE_KEYS = UPSTREAM_CACHE_KEYS;

/** The whitelist: route → allowed query names; a value is at most 240 characters (`connectedQuotes`' `pairs` 2 000),
 * each name at most once. */
export const ACCOUNT_QUERY: Readonly<Record<ReadRoute, readonly string[]>> = {
  account: ["fresh"],
  market: ["venue", "symbol"],
  compare: ["base", "side", "usd", "asset"],
  holdings: ["cost", "paper", "fresh"],
  positions: ["venue"],
  statement: ["fresh"],
  history: ["range", "paper", "venue"],
  agents: ["fresh"],
  venues: [],
  reach: ["connector"],
  keyfile: ["kind", "venue", "ref", "exchange"],
  books: [],
  asset: ["key", "fresh"],
  funding: ["venue", "limit"],
  receive: ["venue", "asset", "network"],
  earn: ["venue", "asset", "fresh"],
  sellable: ["fresh"],
  signinStatus: ["state"],
  connectedExplore: ["tab", "q", "key", "sort", "limit"],
  connectedQuotes: ["pairs"],
  connectedCandles: ["venue", "symbol", "interval", "range", "before", "limit"],
  connectedBook: ["venue", "symbol", "depth"],
  connectedTrades: ["venue", "symbol", "limit"],
  identity: [],
  identityPending: ["id"],
};

export { STREAM_BODY_LIMIT, STREAM_CLIENT, codeOf } from "./upstream-proxy.ts";

/** The Account's answer — its status and its body as text — or the code of a fetch that failed. */
export type AccountAnswer = UpstreamAnswer;

/** `GET /api/account` through the `account` route's cache: what `seat.ts` reads. */
export interface AccountReader { read(fresh?: boolean): Promise<AccountAnswer> }

export interface AccountProxyDeps {
  /** The Account service; default `FACE_ACCOUNT_URL` or `http://127.0.0.1:4820`. */
  url?: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** The composed `mcp-account` row is disabled: every valid read answers `disabled` and never asks the Account. */
  disabled?: boolean;
  /** Per-route aborts in place of {@link ACCOUNT_ABORT_MS}, for the tests. */
  abortMs?: Partial<Record<ReadRoute, number>>;
}

const READ_ROUTES = Object.keys(ACCOUNT_QUERY) as ReadRoute[];
/** The names whose value runs longer, by route, with theirs: `pairs` carries twelve `venue|symbol` markets, and one
 * market's symbol alone (a Polymarket slug) can run past a hundred characters — so its bound is its own, as the
 * stream's `markets` is. */
const LONG_VALUES: Readonly<Partial<Record<ReadRoute, ReadonlyMap<string, number>>>> = {
  connectedQuotes: new Map([["pairs", 2_000]]),
};
const INVALID = '{"ok":false,"error":"invalid account request"}';

/** A read's path under `/api/account` and `/data/account` where it is not `/<route>`. */
const READ_PATHS: Readonly<Partial<Record<ReadRoute, string>>> = {
  account: "", reach: "/connect/reach", books: "/paper/books", signinStatus: "/signin/status",
  connectedExplore: "/connected/explore", connectedQuotes: "/connected/quotes", connectedCandles: "/connected/candles",
  connectedBook: "/connected/book", connectedTrades: "/connected/trades",
  identity: "/identity", identityPending: "/identity/pending",
};
const subPath = (route: ReadRoute): string => READ_PATHS[route] ?? `/${route}`;
/** Each write's sub-path under the face's `/data/account/`, and the Account's path. */
const WRITE_PATHS: Readonly<Record<WriteRoute, { face: string; account: string }>> = {
  pair: { face: "pair", account: "/api/account/pair" },
  prepare: { face: "prepare", account: "/api/account/prepare" },
  exchange: { face: "exchange", account: "/api/exchange" },
  challenge: { face: "wallet/challenge", account: "/api/account/wallet/challenge" },
  prove: { face: "wallet/prove", account: "/api/account/wallet/prove" },
  signinStart: { face: "signin/start", account: "/api/account/signin/start" },
  bridgeRoutes: { face: "bridge-routes", account: "/api/account/bridge-routes" },
  orderSent: { face: "live/order-sent", account: "/api/account/live/order-sent" },
  orderRequote: { face: "live/order-requote", account: "/api/account/live/order-requote" },
  sent: { face: "live/sent", account: "/api/account/live/sent" },
  revoke: { face: "revoke", account: "/api/revoke" },
  guard: { face: "guard", account: "/api/mode" },
  identityToken: { face: "identity/telegram/token", account: "/api/account/identity/telegram/token" },
  identityNotMe: { face: "identity/pending/not-me", account: "/api/account/identity/pending/not-me" },
  identityDrop: { face: "identity/pending/drop", account: "/api/account/identity/pending/drop" },
};
const WRITE_ROUTES = Object.keys(WRITE_PATHS) as WriteRoute[];
/** The writes whose upstream carries {@link FACE_ORIGIN_HEADER}. */
const ORIGIN_ROUTES: ReadonlySet<WriteRoute> = new Set(["challenge", "signinStart"]);
/** What `guard` always sends the Account, whatever the browser posted. */
const GUARD_BODY = '{"mode":"guard"}';

/** One read route as the core reads it: `/data/account<sub>` → `/api/account<sub>`, its names, TTL and abort. */
const readOf = (route: ReadRoute, abortMs: Partial<Record<ReadRoute, number>>): UpstreamRead => ({
  face: `/data/account${subPath(route)}`,
  upstream: `/api/account${subPath(route)}`,
  query: ACCOUNT_QUERY[route],
  ...(LONG_VALUES[route] === undefined ? {} : { long: LONG_VALUES[route] }),
  ttlMs: ACCOUNT_TTL_MS[route],
  abortMs: abortMs[route] ?? ACCOUNT_ABORT_MS[route],
});

/** The query a read may pass on, rebuilt from the route's whitelisted names in the order they came, each
 * at most once, each value at most 240 characters ({@link LONG_VALUES} names the longer ones), re-encoded;
 * `fresh=1` sets `fresh` and is never part of the query. `null`: an unknown or repeated name, an over-long
 * value, an over-long or unparsable URL. */
export function rebuildQuery(route: ReadRoute, rawUrl: string): { query: string; fresh: boolean } | null {
  return rebuildQueryOf(ACCOUNT_QUERY[route], LONG_VALUES[route], rawUrl);
}

/** The callback's query, rebuilt from {@link CALLBACK_QUERY} in the order the names came, each at most once and
 * within its bound, re-encoded; `null` for anything else, as {@link rebuildQuery} refuses it. */
export function rebuildCallbackQuery(rawUrl: string): string | null {
  const asked = searchOf(rawUrl);
  if (asked === null) return null;
  const rebuilt = new URLSearchParams();
  for (const [name, value] of asked) {
    const max = CALLBACK_QUERY.get(name);
    if (max === undefined || rebuilt.has(name) || value.length > max) return null;
    rebuilt.append(name, value);
  }
  return rebuilt.toString();
}

interface Settings extends UpstreamSettings {
  abortMs: Partial<Record<ReadRoute, number>>;
}

const settingsOf = (deps: AccountProxyDeps): Settings => ({
  url: (deps.url ?? seatUrl()).replace(/\/+$/, ""),
  doFetch: deps.fetch ?? fetch,
  now: deps.now ?? Date.now,
  disabled: deps.disabled === true,
  invalid: INVALID,
  abortMs: deps.abortMs ?? {},
});

/** The `account` route's reads as a reader: `GET /api/account` through that route's cache. */
const readerOf = (reads: UpstreamReads): AccountReader => ({ read: (fresh = false) => reads.read("", fresh) });

/** The `account` route's reader, with no route registered: `GET /api/account` through its own cache. */
export function createAccountReader(deps: AccountProxyDeps = {}): AccountReader {
  const s = settingsOf(deps);
  return readerOf(upstreamReads(readOf("account", s.abortMs), s));
}

/** `signin/callback`: {@link isTrustedNavigation}, the rebuilt query, then the callback's page, forwarded as it
 * answers with {@link CALLBACK_HEADERS}; never kept, never stale. */
const callbackHandler = (s: Settings) => async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  /* FIRST: a script's fetch, a form's POST, a rebound Host reach neither the parser nor the Account. */
  if (!isTrustedNavigation(req)) return send(res, 403, FORBIDDEN);
  const query = rebuildCallbackQuery(req.url ?? "");
  if (query === null) return send(res, 400, INVALID);
  const page = (status: number, body: string): void => { res.writeHead(status, CALLBACK_HEADERS); res.end(body); };
  if (s.disabled) return page(503, CALLBACK_UNREACHABLE);
  const answer = await askUpstream(s.doFetch, `${s.url}/api/account/signin/callback${query === "" ? "" : `?${query}`}`, CALLBACK_ABORT_MS);
  return "status" in answer ? page(answer.status, answer.body) : page(503, CALLBACK_UNREACHABLE);
};

/** {@link FACE_ORIGIN_HEADER} for the upstream request, when the browser's Host gives an origin. */
const originHeader = (req: IncomingMessage): Record<string, string> => {
  const origin = faceOriginOf(req);
  return origin === null ? {} : { [FACE_ORIGIN_HEADER]: origin };
};

/** Mount the twenty-five read routes, the two stream routes, the fifteen write routes and the OAuth sign-in's
 * callback (`signin/callback`, behind `isTrustedNavigation`) — forty-three in all — on the host webserver, over the
 * proxy core (src/upstream-proxy.ts). The reader returned is the `account` route's own: it and `/data/account` read
 * through one cache, so the seat route `main.ts` hands it to shares that route's upstream read. `dispose` forgets
 * every kept answer and aborts every open stream's upstream. */
export function registerAccountProxy(
  webServer: RouteRegistrar,
  deps: AccountProxyDeps = {},
): { reader: AccountReader; dispose(): void } {
  const s = settingsOf(deps);
  const reads = READ_ROUTES.map((route) => readOf(route, s.abortMs));
  const accountRead = reads[READ_ROUTES.indexOf("account")]!;
  const accountReads = upstreamReads(accountRead, s);
  const mounted = mountReads(webServer, s, reads, new Map([[accountRead.face, accountReads]]));
  const stream = mountStream(webServer, s, {
    face: "/data/account/stream", upstream: "/api/account/stream", followFace: "/data/account/stream/markets", followUpstream: "/api/account/stream/markets",
  });
  for (const route of WRITE_ROUTES) {
    const options: PostOptions = {
      ...(ORIGIN_ROUTES.has(route) ? { extraHeaders: originHeader } : {}),
      ...(route === "guard" ? { fixedBody: GUARD_BODY } : {}),
    };
    const { face, account } = WRITE_PATHS[route];
    webServer.register({ kind: "exact", path: `/data/account/${face}`, handler: postHandler(s, account, WRITE_BODY_LIMIT[route], WRITE_ABORT_MS[route], options) });
  }
  webServer.register({ kind: "exact", path: "/data/account/signin/callback", handler: callbackHandler(s) });
  return {
    reader: readerOf(accountReads),
    dispose: () => {
      mounted.clear();
      stream.abortAll();
    },
  };
}
