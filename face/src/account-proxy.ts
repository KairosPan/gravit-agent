/** `/data/account` and `/data/account/<route>`: the Account's reads and the
 * owner's writes, proxied (spec 2026-10-22 §5.1). The Account (after Linqi's
 * buyer-agent-demo, the service in the repo's `account/`, on 127.0.0.1:4820)
 * answers only bare loopback requests — its fence refuses any page at another
 * origin — so the face's page never asks it: the page asks the face, and the
 * face asks the Account with a plain loopback fetch (no Origin, no
 * Sec-Fetch-Site, no cookie, the URL's own Host, `redirect: "error"`).
 * Thirty-eight routes: twenty-three reads ({@link ReadRoute} — the Account,
 * its markets, holdings and venues, and for the Market half and the wallet
 * half `asset`, `book`, `trades`, `funding`, `receive`, `earn`, `sellable`
 * and `signin/status`), the Account's push channel — `stream`, and
 * `stream/markets`, the markets it follows — and twelve writes
 * ({@link WriteRoute}: `pair`, `prepare`, `exchange`, `wallet/challenge`,
 * `wallet/prove`, `signin/start`, `bridge-routes`, `live/order-sent`,
 * `live/order-requote`, `live/sent`, `revoke` and `guard`) — and the OAuth
 * sign-in's callback, `signin/callback`, the one route a venue's page navigates
 * the browser to; each an `exact` route, never a prefix: the route table is the allow-list, and nothing else
 * of the Account's surface is reachable through the face.
 * {@link registerAccountProxy} returns the `account` route's reader, which
 * `main.ts` hands to `seat.ts`: `/data/seat.json` and `/data/account` share
 * one upstream read. {@link createAccountReader} is that read without a
 * route, for a seat route handed none.
 *
 * The rules, the seat route's generalised:
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
 * - The thirteen POST routes — `stream/markets` and the twelve writes, each at
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
 *   with {@link CALLBACK_HEADERS}; a failed fetch or a disabled row is 503 with
 *   the fixed page {@link CALLBACK_UNREACHABLE}.
 * - Nothing of a body, a query or a frame is logged here.
 * @module
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { seatUrl } from "./account-seat.ts";
import { FORBIDDEN, HttpError, isJsonBody, isLoopbackHost, isTrustedDataRequest, isTrustedNavigation, markStale, readBody } from "./http.ts";
import type { RouteRegistrar } from "./static.ts";

/** The Account's reads the face proxies: `account` is its `GET /api/account`, `reach` its
 * `GET /api/account/connect/reach`, `books` its `GET /api/account/paper/books`, the rest `GET /api/account/<route>`;
 * the face's path is the same under `/data/account`. */
export type ReadRoute =
  | "account" | "explore" | "market" | "quotes" | "compare" | "candles" | "holdings" | "positions" | "statement" | "history" | "agents"
  | "venues" | "reach" | "keyfile" | "books"
  | "asset" | "book" | "trades" | "funding" | "receive" | "earn" | "sellable" | "signinStatus";

/** How long one answer is served without asking again, per route: the Account's own page's cadence (spec §5.1). */
export const ACCOUNT_TTL_MS: Readonly<Record<ReadRoute, number>> = {
  account: 15_000, explore: 20_000, market: 3_000, quotes: 3_000, compare: 15_000, candles: 30_000,
  holdings: 8_000, positions: 10_000, statement: 10_000, history: 60_000, agents: 15_000,
  venues: 60_000, reach: 5_000, keyfile: 5_000, books: 5_000,
  asset: 5_000, book: 2_000, trades: 2_000, funding: 60_000, receive: 60_000, earn: 15_000, sellable: 5_000, signinStatus: 1_000,
};

/** How long the Account may take, headers and body, per route: the reads that settle venue polls take
 * seconds, a first candles view waits for a source, and a cold venues or reach read probes every venue. */
export const ACCOUNT_ABORT_MS: Readonly<Record<ReadRoute, number>> = {
  account: 7_000, explore: 10_000, market: 7_000, quotes: 7_000, compare: 7_000, candles: 25_000,
  holdings: 12_000, positions: 7_000, statement: 7_000, history: 12_000, agents: 7_000,
  venues: 30_000, reach: 30_000, keyfile: 30_000, books: 30_000,
  asset: 25_000, book: 7_000, trades: 7_000, funding: 12_000, receive: 30_000, earn: 30_000, sellable: 30_000, signinStatus: 7_000,
};

/** The writes the face proxies, each a POST, at the face's and the Account's paths in {@link WRITE_PATHS}: the
 * owner's `pair`, `prepare` and `exchange`; the wallet's `challenge` and `prove`; the sign-in's `signinStart`;
 * `bridgeRoutes`; the live order's `orderSent`, `orderRequote` and `sent`; and the two unsigned writes the
 * Account itself defines as the safer direction, `revoke` (Close to agents) and `guard`. */
export type WriteRoute =
  | "pair" | "prepare" | "exchange"
  | "challenge" | "prove" | "signinStart" | "bridgeRoutes" | "orderSent" | "orderRequote" | "sent" | "revoke" | "guard";

/** Most bytes a write's body may carry, per route; `guard`'s is read under its limit and discarded. */
export const WRITE_BODY_LIMIT: Readonly<Record<WriteRoute, number>> = {
  pair: 4_096, prepare: 16_384, exchange: 65_536,
  challenge: 1_024, prove: 2_048, signinStart: 512, bridgeRoutes: 4_096, orderSent: 512, orderRequote: 512, sent: 512, revoke: 512, guard: 256,
};

/** How long the Account may take on a write, headers and body, per route: a prepare asks the venue for a quote. */
export const WRITE_ABORT_MS: Readonly<Record<WriteRoute, number>> = {
  pair: 7_000, prepare: 30_000, exchange: 30_000,
  challenge: 7_000, prove: 12_000, signinStart: 30_000, bridgeRoutes: 30_000, orderSent: 30_000, orderRequote: 30_000, sent: 30_000,
  revoke: 7_000, guard: 7_000,
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
 * venue's authorization server sends back (RFC 6749 §4.1.2, RFC 9207's `iss`). */
export const CALLBACK_QUERY: ReadonlyMap<string, number> = new Map([
  ["state", 240], ["code", 2_000], ["error", 240], ["error_description", 1_000], ["iss", 500],
]);

/** How long the Account may take to finish a sign-in, headers and body: it trades the code at the venue. */
export const CALLBACK_ABORT_MS = 30_000;

/** The callback's answer headers: the Account's page, never kept, never sniffed, and its URL (which carried the
 * code) never sent on as a referrer. */
export const CALLBACK_HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
} as const;

/** The callback's page when the Account did not answer, or the row is disabled. */
export const CALLBACK_UNREACHABLE = "The Account did not answer. Go back to Gravit and start the sign-in again.";

/** Most queries kept per route; the least recently used leaves first. */
export const ACCOUNT_CACHE_KEYS = 64;

/** The whitelist: route → allowed query names (`explore`'s `sort` is China's ranking's, `volume` or `movers`, beside its
 * `tab=china`); a value is at most 240 characters (`quotes`' `pairs` 2 000), each name at most once. */
export const ACCOUNT_QUERY: Readonly<Record<ReadRoute, readonly string[]>> = {
  account: ["fresh"],
  explore: ["tab", "q", "key", "sort", "limit"],
  market: ["venue", "symbol"],
  quotes: ["pairs"],
  compare: ["base", "side", "usd", "asset"],
  candles: ["venue", "symbol", "interval", "range", "before", "limit"],
  holdings: ["cost", "paper", "fresh"],
  positions: ["venue"],
  statement: ["fresh"],
  history: ["range", "paper", "venue"],
  agents: ["fresh"],
  venues: [],
  reach: ["connector"],
  keyfile: ["kind", "venue", "ref", "exchange"],
  books: [],
  asset: ["key", "interval", "range"],
  book: ["venue", "symbol", "depth"],
  trades: ["venue", "symbol", "limit"],
  funding: ["venue", "limit"],
  receive: ["venue", "asset", "network"],
  earn: ["venue", "asset", "fresh"],
  sellable: ["fresh"],
  signinStatus: ["state"],
};

/** The name a tab gives its stream, in the Account's grammar; the face's page mints `face-<24 hex>`. */
export const STREAM_CLIENT = /^[A-Za-z0-9_-]{8,48}$/;

/** Most bytes a `stream/markets` body may carry. */
export const STREAM_BODY_LIMIT = 4096;

/** The Account's answer — its status and its body as text — or the code of a fetch that failed. */
export type AccountAnswer = { status: number; body: string } | { unreachable: string };

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
/** Longest value one query name may carry, in characters, decoded. */
const VALUE_MAX = 240;
/** The names whose value runs longer, by route, with theirs: `pairs` carries twelve `venue|symbol` markets, and one
 * market's symbol alone (a Polymarket slug) can run past a hundred characters — so its bound is its own, as the
 * stream's `markets` is. */
const LONG_VALUES: Readonly<Partial<Record<ReadRoute, ReadonlyMap<string, number>>>> = { quotes: new Map([["pairs", 2_000]]) };
/** Longest request target a read may arrive with. */
const RAW_URL_MAX = 8_192;
/** The stream's query names, each with the longest value it may carry, in characters, decoded: `markets` to
 * the Account's own cut; `client` is held to {@link STREAM_CLIENT} besides. */
const STREAM_QUERY: ReadonlyMap<string, number> = new Map([["since", VALUE_MAX], ["client", VALUE_MAX], ["markets", 4_000]]);
/** How long the Account may take on a `stream/markets` POST, headers and body. */
const FOLLOW_ABORT_MS = 7_000;
/** Most bytes a browser may leave unread on its stream; past it the face drops the response, as `quotes.ts` does. */
const STREAM_UNREAD_MAX = 256 * 1024;
const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no",
} as const;
const INVALID = '{"ok":false,"error":"invalid account request"}';
const METHOD_NOT_ALLOWED = '{"ok":false,"error":"method not allowed"}';
const JSON_ONLY = '{"ok":false,"error":"application/json only"}';
const unreachable = (code: string): string => JSON.stringify({ ok: false, unreachable: code });

/** A read's path under `/api/account` and `/data/account` where it is not `/<route>`. */
const READ_PATHS: Readonly<Partial<Record<ReadRoute, string>>> = {
  account: "", reach: "/connect/reach", books: "/paper/books", signinStatus: "/signin/status",
};
const subPath = (route: ReadRoute): string => READ_PATHS[route] ?? `/${route}`;
const facePath = (route: ReadRoute): string => `/data/account${subPath(route)}`;
const accountUrl = (base: string, route: ReadRoute, query: string): string =>
  `${base}/api/account${subPath(route)}${query === "" ? "" : `?${query}`}`;
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
};
const WRITE_ROUTES = Object.keys(WRITE_PATHS) as WriteRoute[];
/** The writes whose upstream carries {@link FACE_ORIGIN_HEADER}. */
const ORIGIN_ROUTES: ReadonlySet<WriteRoute> = new Set(["challenge", "signinStart"]);
/** What `guard` always sends the Account, whatever the browser posted. */
const GUARD_BODY = '{"mode":"guard"}';

/** The query a read may pass on, rebuilt from the route's whitelisted names in the order they came, each
 * at most once, each value at most 240 characters ({@link LONG_VALUES} names the longer ones), re-encoded;
 * `fresh=1` sets `fresh` and is never part of the query. `null`: an unknown or repeated name, an over-long
 * value, an over-long or unparsable URL. */
export function rebuildQuery(route: ReadRoute, rawUrl: string): { query: string; fresh: boolean } | null {
  const asked = searchOf(rawUrl);
  if (asked === null) return null;
  const allowed = ACCOUNT_QUERY[route];
  const longer = LONG_VALUES[route];
  const seen = new Set<string>();
  const rebuilt = new URLSearchParams();
  let fresh = false;
  for (const [name, value] of asked) {
    if (!allowed.includes(name) || seen.has(name) || value.length > (longer?.get(name) ?? VALUE_MAX)) return null;
    seen.add(name);
    if (name === "fresh") fresh = value === "1";
    else rebuilt.append(name, value);
  }
  return { query: rebuilt.toString(), fresh };
}

/** A request target's query; `null` when the target is over-long or unparsable. */
function searchOf(rawUrl: string): URLSearchParams | null {
  if (rawUrl.length > RAW_URL_MAX) return null;
  try {
    return new URL(rawUrl, "http://localhost").searchParams;
  } catch {
    return null;
  }
}

/** The query a stream passes on: `since`, `client` and `markets` in the order they came, each at most once
 * and within its {@link STREAM_QUERY} bound, re-encoded, `client` shaped as {@link STREAM_CLIENT}. The
 * browser's `Last-Event-ID`, when it sends one, is `since` — in place of a `since` in the query, within the
 * same bound — as the Account itself reads it: an EventSource reconnects to the URL it opened, its newest id
 * in the header. `null`: anything else, as {@link rebuildQuery} refuses it. */
function rebuildStreamQuery(rawUrl: string, lastEventId: string | string[] | undefined): string | null {
  const asked = searchOf(rawUrl);
  if (asked === null) return null;
  const rebuilt = new URLSearchParams();
  for (const [name, value] of asked) {
    const max = STREAM_QUERY.get(name);
    if (max === undefined || rebuilt.has(name) || value.length > max) return null;
    rebuilt.append(name, value);
  }
  if (!STREAM_CLIENT.test(rebuilt.get("client") ?? "")) return null;
  if (typeof lastEventId === "string" && lastEventId !== "") {
    if (lastEventId.length > VALUE_MAX) return null;
    rebuilt.set("since", lastEventId);
  }
  return rebuilt.toString();
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

/** Whether a request target names no query parameter: a route whose row allows none refuses any. */
const queryless = (rawUrl: string): boolean => searchOf(rawUrl)?.size === 0;

/** A failure's code, bounded to a code's shape so no error text ever reaches the page. */
export function codeOf(err: unknown): string {
  const e = err as { cause?: { code?: unknown }; code?: unknown } | null;
  const code = e?.cause?.code ?? e?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,31}$/.test(code) ? code : "unreachable";
}

/** One request to the Account — a GET, or what `init` asks — cut at `abortMs` on the headers and the body:
 * its status and body, or the failure's code. Never rejects. */
async function askAccount(doFetch: typeof fetch, url: string, abortMs: number, init: RequestInit = {}): Promise<AccountAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), abortMs);
  try {
    const r = await doFetch(url, { ...init, signal: controller.signal, redirect: "error" });
    try {
      return { status: r.status, body: await r.text() };
    } catch {
      return { unreachable: controller.signal.aborted ? "timeout" : "unreadable" };
    }
  } catch (err) {
    return { unreachable: controller.signal.aborted ? "timeout" : codeOf(err) };
  } finally {
    clearTimeout(timer);
  }
}

interface Settings {
  url: string;
  doFetch: typeof fetch;
  now: () => number;
  disabled: boolean;
  abortMs: Partial<Record<ReadRoute, number>>;
}

const settingsOf = (deps: AccountProxyDeps): Settings => ({
  url: (deps.url ?? seatUrl()).replace(/\/+$/, ""),
  doFetch: deps.fetch ?? fetch,
  now: deps.now ?? Date.now,
  disabled: deps.disabled === true,
  abortMs: deps.abortMs ?? {},
});

/** One 2xx answer of the Account's, and when it came. */
interface Kept { status: number; body: string; at: number }

/** One route's reads of the Account. */
interface Reads {
  /** Within the TTL the kept answer, else the Account's: one fetch per query in flight. */
  read(query: string, fresh: boolean): Promise<AccountAnswer>;
  /** The last 2xx kept for a query, however old: what a failure re-serves as stale. */
  kept(query: string): Kept | undefined;
  clear(): void;
}

function routeReads(route: ReadRoute, s: Settings): Reads {
  const ttlMs = ACCOUNT_TTL_MS[route];
  const abortMs = s.abortMs[route] ?? ACCOUNT_ABORT_MS[route];
  /* A Map iterates in insertion order: re-inserting a query on every use keeps the least recently used first. */
  const answers = new Map<string, Kept>();
  /** The read in flight per query, and whether it is a fresh one: a plain read joins any flight, a fresh
   * read joins only a fresh one and otherwise asks again after the plain one settles. */
  const flights = new Map<string, { answer: Promise<AccountAnswer>; fresh: boolean }>();

  const remember = (query: string, entry: Kept): void => {
    answers.delete(query);
    answers.set(query, entry);
    while (answers.size > ACCOUNT_CACHE_KEYS) answers.delete(answers.keys().next().value!);
  };

  const ask = async (query: string): Promise<AccountAnswer> => {
    const answer = await askAccount(s.doFetch, accountUrl(s.url, route, query), abortMs);
    if ("status" in answer && answer.status >= 200 && answer.status < 300) remember(query, { ...answer, at: s.now() });
    return answer;
  };

  const fly = (query: string, fresh: boolean): Promise<AccountAnswer> => {
    const flight = flights.get(query);
    if (flight !== undefined && (!fresh || flight.fresh)) return flight.answer;
    const run = (): Promise<AccountAnswer> => ask(query);
    const own = { answer: flight === undefined ? run() : flight.answer.then(run, run), fresh };
    flights.set(query, own);
    /* `then(clear, clear)`, not `finally`: a `finally` would derive an unawaited rejection. */
    const clear = (): void => { if (flights.get(query) === own) flights.delete(query); };
    void own.answer.then(clear, clear);
    return own.answer;
  };

  return {
    read: async (query, fresh) => {
      if (s.disabled) return { unreachable: "disabled" };
      const hit = answers.get(query);
      if (!fresh && hit !== undefined && s.now() - hit.at < ttlMs) {
        remember(query, hit);
        return { status: hit.status, body: hit.body };
      }
      return fly(query, fresh);
    },
    kept: (query) => answers.get(query),
    clear: () => answers.clear(),
  };
}

/** The `account` route's reads as a reader: `GET /api/account` through that route's cache. */
const readerOf = (reads: Reads): AccountReader => ({ read: (fresh = false) => reads.read("", fresh) });

/** The `account` route's reader, with no route registered: `GET /api/account` through its own cache. */
export function createAccountReader(deps: AccountProxyDeps = {}): AccountReader {
  return readerOf(routeReads("account", settingsOf(deps)));
}

function send(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

/** One route's handler: the fence, GET only, the rebuilt query, then the Account through the route's reads. */
const handler = (route: ReadRoute, reads: Reads, disabled: boolean) => async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  /* FIRST: a refused request reaches neither the parser nor the cache nor the Account. */
  if (!isTrustedDataRequest(req)) return send(res, 403, FORBIDDEN);
  if (req.method !== "GET") return send(res, 405, METHOD_NOT_ALLOWED);
  const asked = rebuildQuery(route, req.url ?? "");
  if (asked === null) return send(res, 400, INVALID);
  if (disabled) return send(res, 503, unreachable("disabled"));
  const answer = await reads.read(asked.query, asked.fresh);
  if ("status" in answer) return send(res, answer.status, answer.body);
  const kept = reads.kept(asked.query);
  return kept === undefined ? send(res, 503, unreachable(answer.unreachable)) : send(res, 200, markStale(kept.body));
};

/** `signin/callback`: {@link isTrustedNavigation}, the rebuilt query, then the Account's page, forwarded as it
 * answers with {@link CALLBACK_HEADERS}; never kept, never stale. */
const callbackHandler = (s: Settings) => async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  /* FIRST: a script's fetch, a form's POST, a rebound Host reach neither the parser nor the Account. */
  if (!isTrustedNavigation(req)) return send(res, 403, FORBIDDEN);
  const query = rebuildCallbackQuery(req.url ?? "");
  if (query === null) return send(res, 400, INVALID);
  const page = (status: number, body: string): void => { res.writeHead(status, CALLBACK_HEADERS); res.end(body); };
  if (s.disabled) return page(503, CALLBACK_UNREACHABLE);
  const answer = await askAccount(s.doFetch, `${s.url}/api/account/signin/callback${query === "" ? "" : `?${query}`}`, CALLBACK_ABORT_MS);
  return "status" in answer ? page(answer.status, answer.body) : page(503, CALLBACK_UNREACHABLE);
};

/** One browser connection's stream: the Account's 200 written through chunk by chunk as it comes, unchanged,
 * and ended when the Account ends it; a browser {@link STREAM_UNREAD_MAX} bytes behind is dropped; any other
 * answer is the Account's status and body, a failure 503 with its code. A response the browser has closed
 * is written nothing. Never rejects. */
async function pipeStream(doFetch: typeof fetch, url: string, signal: AbortSignal, res: ServerResponse): Promise<void> {
  const answer = (status: number, body: string): void => { if (!res.destroyed) send(res, status, body); };
  let r: Response;
  try {
    r = await doFetch(url, { headers: { accept: "text/event-stream" }, redirect: "error", signal });
  } catch (err) {
    return answer(503, unreachable(codeOf(err)));
  }
  if (r.status !== 200) {
    let body: string;
    try {
      body = await r.text();
    } catch {
      return answer(503, unreachable("unreadable"));
    }
    return answer(r.status, body);
  }
  res.writeHead(200, SSE_HEADERS);
  try {
    for await (const chunk of r.body ?? []) {
      if (res.destroyed) break;
      if (res.writableLength > STREAM_UNREAD_MAX) {
        res.destroy();
        break;
      }
      res.write(chunk);
    }
  } catch {
    /* The Account broke off, or the request was aborted: a stream already open has nothing more to say. */
  }
  if (!res.destroyed) res.end();
}

/** `stream`: the fence, GET only, the rebuilt query, then one upstream stream for this browser connection,
 * aborted when its response closes or errors, or on `dispose` (through `open`). */
const streamHandler = (s: Settings, open: Set<AbortController>) => async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  if (!isTrustedDataRequest(req)) return send(res, 403, FORBIDDEN);
  if (req.method !== "GET") return send(res, 405, METHOD_NOT_ALLOWED);
  const query = rebuildStreamQuery(req.url ?? "", req.headers["last-event-id"]);
  if (query === null) return send(res, 400, INVALID);
  if (s.disabled) return send(res, 503, unreachable("disabled"));
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  /* Wired before the fetch: a browser that leaves while the Account is still to answer cancels the request. */
  res.once("close", abort);
  res.on("error", abort);
  if (res.destroyed) abort();
  open.add(controller);
  try {
    await pipeStream(s.doFetch, `${s.url}/api/account/stream?${query}`, controller.signal, res);
  } finally {
    open.delete(controller);
  }
};

/** A POST route's request up to its body: the fence, POST only, a body declared `application/json`, no
 * query name, then the body read under `limit` bytes. The body as posted, or `null` once the refusal is
 * answered. The body is never parsed, kept or logged. */
async function readJsonPost(req: IncomingMessage, res: ServerResponse, limit: number): Promise<string | null> {
  if (!isTrustedDataRequest(req)) { send(res, 403, FORBIDDEN); return null; }
  if (req.method !== "POST") { send(res, 405, METHOD_NOT_ALLOWED); return null; }
  if (!isJsonBody(req)) { send(res, 415, JSON_ONLY); return null; }
  if (!queryless(req.url ?? "")) { send(res, 400, INVALID); return null; }
  try {
    return await readBody(req, limit);
  } catch (err) {
    if (err instanceof HttpError) send(res, err.status, JSON.stringify({ ok: false, error: err.message }));
    else send(res, 400, INVALID);
    return null;
  }
}

/** What a POST route adds to the plain forward: headers derived from the browser's request (never copied from
 * it), and a body sent in place of the browser's, which is then read under the limit and discarded. */
interface PostOptions {
  extraHeaders?: (req: IncomingMessage) => Record<string, string>;
  fixedBody?: string;
}

/** A POST route — `stream/markets` or a write: {@link readJsonPost}, then the body forwarded as posted (or
 * `fixedBody`) to the Account's `path`, cut at `abortMs`; its status and body come back as they are, never kept,
 * never stale. */
const postHandler = (s: Settings, path: string, limit: number, abortMs: number, options: PostOptions = {}) =>
  async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const posted = await readJsonPost(req, res, limit);
  if (posted === null) return;
  if (s.disabled) return send(res, 503, unreachable("disabled"));
  const body = options.fixedBody ?? posted;
  const answer = await askAccount(s.doFetch, `${s.url}${path}`, abortMs, {
    method: "POST", headers: { ...options.extraHeaders?.(req), "content-type": "application/json" }, body,
  });
  return "status" in answer ? send(res, answer.status, answer.body) : send(res, 503, unreachable(answer.unreachable));
};

/** {@link FACE_ORIGIN_HEADER} for the upstream request, when the browser's Host gives an origin. */
const originHeader = (req: IncomingMessage): Record<string, string> => {
  const origin = faceOriginOf(req);
  return origin === null ? {} : { [FACE_ORIGIN_HEADER]: origin };
};

/** Mount the twenty-three read routes, the two stream routes, the twelve write routes and the OAuth sign-in's
 * callback (`signin/callback`, behind `isTrustedNavigation`) — thirty-eight in all — on the host webserver.
 * The reader returned is the `account` route's own: it and `/data/account` read through one cache, so the
 * seat route `main.ts` hands it to shares that route's upstream read. `dispose` forgets every kept answer
 * and aborts every open stream's upstream. */
export function registerAccountProxy(webServer: RouteRegistrar, deps: AccountProxyDeps = {}): { reader: AccountReader; dispose(): void } {
  const s = settingsOf(deps);
  const accountReads = routeReads("account", s);
  const all: Reads[] = [];
  for (const route of READ_ROUTES) {
    const reads = route === "account" ? accountReads : routeReads(route, s);
    all.push(reads);
    webServer.register({ kind: "exact", path: facePath(route), handler: handler(route, reads, s.disabled) });
  }
  /* The upstream streams open now, one per browser connection. */
  const open = new Set<AbortController>();
  webServer.register({ kind: "exact", path: "/data/account/stream", handler: streamHandler(s, open) });
  webServer.register({ kind: "exact", path: "/data/account/stream/markets", handler: postHandler(s, "/api/account/stream/markets", STREAM_BODY_LIMIT, FOLLOW_ABORT_MS) });
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
      for (const reads of all) reads.clear();
      for (const stream of open) stream.abort();
    },
  };
}
