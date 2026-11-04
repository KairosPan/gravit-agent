/** `/data/account` and `/data/account/<route>` (spec 2026-10-22 §5.1): the
 * Account's reads through the face — the whitelist, the fence, the bodies
 * passed through, the per-route caches and their flights, the failure codes,
 * the disabled row, and the shared `account` reader `seat.ts` reads — and its
 * push channel: `stream` piped per browser connection, `stream/markets`
 * forwarded — and the twelve writes, `pair`, `prepare`, `exchange` and the
 * Market and wallet halves' nine, forwarded as `stream/markets` is, `guard`
 * with its fixed body and `wallet/challenge` and `signin/start` with the face's
 * origin — and the OAuth sign-in's callback, a venue's navigation forwarded
 * behind its own fence. */
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";
import { seatUrl } from "../src/account-seat.ts";
import {
  ACCOUNT_ABORT_MS,
  ACCOUNT_CACHE_KEYS,
  ACCOUNT_QUERY,
  ACCOUNT_TTL_MS,
  CALLBACK_QUERY,
  STREAM_BODY_LIMIT,
  STREAM_CLIENT,
  FACE_ORIGIN_HEADER,
  WRITE_ABORT_MS,
  WRITE_BODY_LIMIT,
  createAccountReader,
  faceOriginOf,
  rebuildQuery,
  registerAccountProxy,
  type AccountProxyDeps,
} from "../src/account-proxy.ts";
import { registerSeatRoute, type SeatView } from "../src/seat.ts";

const URL_ = "http://127.0.0.1:4820";
const NOW = 1_760_000_000_000;
const FORBIDDEN = '{"ok":false,"error":"forbidden"}';
const INVALID = '{"ok":false,"error":"invalid account request"}';
const DISABLED = '{"ok":false,"unreachable":"disabled"}';
const OK_BODY = '{"ok":true}';
const JSON_TYPE = "application/json; charset=utf-8";

/** The twelve read paths, in the order they are registered, and the Account path each one asks. */
const ROUTES: ReadonlyArray<readonly [face: string, account: string]> = [
  ["/data/account", "/api/account"],
  ["/data/account/market", "/api/account/market"],
  ["/data/account/compare", "/api/account/compare"],
  ["/data/account/holdings", "/api/account/holdings"],
  ["/data/account/positions", "/api/account/positions"],
  ["/data/account/statement", "/api/account/statement"],
  ["/data/account/history", "/api/account/history"],
  ["/data/account/agents", "/api/account/agents"],
  ["/data/account/venues", "/api/account/venues"],
  ["/data/account/connect/reach", "/api/account/connect/reach"],
  ["/data/account/keyfile", "/api/account/keyfile"],
  ["/data/account/paper/books", "/api/account/paper/books"],
];
/** The wallet half's six reads, in the order they are registered after the twelve: the Account path, the route's
 * row, and a query of its names. */
const NEW_READS: ReadonlyArray<readonly [face: string, account: string, route: "asset" | "funding" | "receive" | "earn" | "sellable" | "signinStatus", query: string]> = [
  ["/data/account/asset", "/api/account/asset", "asset", "key=crypto%3ABTC&interval=1h&range=1d"],
  ["/data/account/funding", "/api/account/funding", "funding", "venue=paper&limit=10"],
  ["/data/account/receive", "/api/account/receive", "receive", "venue=paper&asset=USDC&network=base"],
  ["/data/account/earn", "/api/account/earn", "earn", "venue=paper&asset=USDC"],
  ["/data/account/sellable", "/api/account/sellable", "sellable", ""],
  ["/data/account/signin/status", "/api/account/signin/status", "signinStatus", "state=s1"],
];
/** The five connected reads (plan A2), in the order they are registered after the six: the Account path, the route,
 * and a query of its names. */
const CONNECTED: ReadonlyArray<readonly [face: string, account: string, route: "connectedExplore" | "connectedQuotes" | "connectedCandles" | "connectedBook" | "connectedTrades", query: string]> = [
  ["/data/account/connected/explore", "/api/account/connected/explore", "connectedExplore", "tab=crypto&q=BTC&key=crypto%3ABTC&sort=volume&limit=20"],
  ["/data/account/connected/quotes", "/api/account/connected/quotes", "connectedQuotes", "pairs=paper-1%7CBTC%2FUSDT"],
  ["/data/account/connected/candles", "/api/account/connected/candles", "connectedCandles", "venue=paper-1&symbol=BTC%2FUSDT&interval=1h&range=1d&before=1&limit=100"],
  ["/data/account/connected/book", "/api/account/connected/book", "connectedBook", "venue=paper-1&symbol=BTC%2FUSDT&depth=20"],
  ["/data/account/connected/trades", "/api/account/connected/trades", "connectedTrades", "venue=paper-1&symbol=BTC%2FUSDT&limit=50"],
];
const STREAM = "/data/account/stream";
const CALLBACK = "/data/account/signin/callback";
/** A venue's page sending the browser back: a top-level GET document navigation, cross-site, no Origin. */
const NAVIGATION = { host: "127.0.0.1:3090", "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
const FOLLOW = "/data/account/stream/markets";
/** The three write paths, in the order they are registered, the Account path each one asks, and its row. */
const WRITES: ReadonlyArray<readonly [face: string, account: string, route: "pair" | "prepare" | "exchange"]> = [
  ["/data/account/pair", "/api/account/pair", "pair"],
  ["/data/account/prepare", "/api/account/prepare", "prepare"],
  ["/data/account/exchange", "/api/exchange", "exchange"],
];
type NewWrite = "challenge" | "prove" | "signinStart" | "bridgeRoutes" | "orderSent" | "orderRequote" | "sent" | "revoke" | "guard";
/** The nine writes of the two halves, in the order they are registered after the three. */
const NEW_WRITES: ReadonlyArray<readonly [face: string, account: string, route: NewWrite]> = [
  ["/data/account/wallet/challenge", "/api/account/wallet/challenge", "challenge"],
  ["/data/account/wallet/prove", "/api/account/wallet/prove", "prove"],
  ["/data/account/signin/start", "/api/account/signin/start", "signinStart"],
  ["/data/account/bridge-routes", "/api/account/bridge-routes", "bridgeRoutes"],
  ["/data/account/live/order-sent", "/api/account/live/order-sent", "orderSent"],
  ["/data/account/live/order-requote", "/api/account/live/order-requote", "orderRequote"],
  ["/data/account/live/sent", "/api/account/live/sent", "sent"],
  ["/data/account/revoke", "/api/revoke", "revoke"],
  ["/data/account/guard", "/api/mode", "guard"],
];
/** The new writes whose body passes as posted: every one but `guard`. */
const FORWARDING = NEW_WRITES.filter(([, , route]) => route !== "guard");
/** A tab's stream name as the face's page mints it: `face-` and 24 hex. */
const CLIENT = "face-0123456789abcdef01234567";
const JSON_POST = { host: "127.0.0.1:3090", "content-type": "application/json" };
const SSE_HEADERS = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" };

/** The response a handler answers into: its status, headers and the body `end` carried; for a stream, every
 * chunk written and how it closed. `hangUp` is the browser leaving; a test sets `writableLength`. */
class FakeRes extends EventEmitter {
  status = 0;
  headers: Record<string, string> = {};
  body = "";
  writes: Uint8Array[] = [];
  ended = false;
  destroyed = false;
  /** The face destroyed the response, as opposed to the browser leaving. */
  dropped = false;
  writableLength = 0;
  writeHead(status: number, headers?: Record<string, string>): this { this.status = status; Object.assign(this.headers, headers ?? {}); return this; }
  write(chunk: Uint8Array): boolean { this.writes.push(chunk); return true; }
  end(body?: string | Buffer): this { this.body = String(body ?? ""); this.ended = true; return this; }
  destroy(): this { this.dropped = true; this.hangUp(); return this; }
  hangUp(): void { if (!this.destroyed) { this.destroyed = true; this.emit("close"); } }
}

function fakeRes(): { out: FakeRes; res: ServerResponse } {
  const out = new FakeRes();
  return { out, res: out as unknown as ServerResponse };
}

/** A request; with a `body`, one the handler can read, as the face's `readBody` reads it. */
const req = (url: string, headers: Record<string, string> = { host: "127.0.0.1:3090" }, method = "GET", body?: string): IncomingMessage =>
  (body === undefined ? { url, headers, method } : Object.assign(Readable.from([Buffer.from(body)]), { url, headers, method })) as unknown as IncomingMessage;

type FakeAnswer = { ok: boolean; status: number; text(): Promise<string>; headers?: Headers; body?: ReadableStream<Uint8Array> | null };
type FakeInit = { signal: AbortSignal; redirect: string; headers?: unknown; method?: string; body?: unknown };
type FakeFetch = (url: string, init: FakeInit) => Promise<FakeAnswer>;

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const aborted = (): DOMException => new DOMException("This operation was aborted", "AbortError");
const sseAnswer = (body: ReadableStream<Uint8Array>): FakeAnswer =>
  ({ ok: true, status: 200, headers: new Headers({ "content-type": "text/event-stream" }), text: async () => "", body });

/** The Account's stream: its body emits `chunks`, then ends. */
const streaming = (chunks: readonly Uint8Array[]): FakeFetch => async () =>
  sseAnswer(new ReadableStream<Uint8Array>({ start(c) { for (const chunk of chunks) c.enqueue(chunk); c.close(); } }));

/** An Account whose every stream stays open: `push(i, chunk)` sends a chunk on the i-th one opened; aborting a
 * request errors its body, as undici's does. */
function holdingAccount() {
  const pushers: Array<(chunk: Uint8Array) => void> = [];
  const doFetch: FakeFetch = async (_url, init) => sseAnswer(new ReadableStream<Uint8Array>({
    start(c) {
      pushers.push((chunk) => c.enqueue(chunk));
      init.signal.addEventListener("abort", () => c.error(aborted()));
    },
  }));
  return { doFetch, push: (i: number, chunk: Uint8Array): void => pushers[i](chunk) };
}

const ok = (body: string, status = 200): FakeAnswer => ({ ok: status >= 200 && status < 300, status, text: async () => body });
const answering = (body: string, status = 200): FakeFetch => async () => ok(body, status);
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Register the proxy with a fake fetch and clock; every URL and init the fake saw is kept. */
function proxyWith(doFetch: FakeFetch, now: () => number = () => NOW, more: AccountProxyDeps = {}) {
  const routes: WebRoute[] = [];
  const fetched: string[] = [];
  const inits: FakeInit[] = [];
  const spy: FakeFetch = (url, init) => { fetched.push(url); inits.push(init); return doFetch(url, init); };
  const proxy = registerAccountProxy({ register: (route) => routes.push(route) }, { url: URL_, fetch: spy as unknown as typeof fetch, now, ...more });
  return { routes, fetched, inits, proxy };
}

/** Start one request through the route found by the URL's path; `done` settles when the handler has answered into `out`. */
function start(routes: WebRoute[], url: string, headers?: Record<string, string>, method?: string, body?: string) {
  const path = url.split("?", 1)[0];
  const route = routes.find((r) => r.path === path);
  assert.ok(route !== undefined, `no route at ${path}`);
  const { out, res } = fakeRes();
  return { out, done: Promise.resolve(route.handler(req(url, headers, method, body), res)) };
}

async function call(routes: WebRoute[], url: string, headers?: Record<string, string>, method?: string, body?: string) {
  const one = start(routes, url, headers, method, body);
  await one.done;
  return one.out;
}

test("rebuildQuery: the whitelist, once each, 240 characters, fresh stripped", () => {
  assert.deepEqual(rebuildQuery("connectedExplore", "/data/account/connected/explore?tab=crypto&q=btc&limit=60"), { query: "tab=crypto&q=btc&limit=60", fresh: false });
  assert.deepEqual(rebuildQuery("holdings", "/data/account/holdings?cost=1&fresh=1"), { query: "cost=1", fresh: true });
  assert.equal(rebuildQuery("connectedExplore", "/data/account/connected/explore?tab=a&tab=b"), null, "a repeated name");
  assert.equal(rebuildQuery("connectedExplore", "/data/account/connected/explore?force=1"), null, "an unknown name");
  assert.equal(rebuildQuery("connectedExplore", `/data/account/connected/explore?q=${"x".repeat(241)}`), null, "an over-long value");
  assert.deepEqual(rebuildQuery("account", "/data/account"), { query: "", fresh: false });
});

test("the routes: thirty-eight exact paths, the callback last; the fence refuses a foreign Origin and a missing Host before any fetch", async () => {
  const { routes, fetched } = proxyWith(answering(OK_BODY));
  const paths = [
    ...ROUTES.map(([face]) => face), ...NEW_READS.map(([face]) => face), ...CONNECTED.map(([face]) => face), STREAM, FOLLOW,
    ...WRITES.map(([face]) => face), ...NEW_WRITES.map(([face]) => face), CALLBACK,
  ];
  assert.equal(paths.length, 38, "thirty-eight: the five public reads are the market's (src/market-proxy.ts)");
  assert.ok(routes.every((r) => r.kind === "exact"), "no prefix route");
  assert.deepEqual(routes.map((r) => `${r.kind} ${r.path}`), paths.map((face) => `exact ${face}`));
  for (const face of paths) {
    const foreign = await call(routes, face, { host: "127.0.0.1:3090", origin: "https://evil.example" });
    assert.equal(foreign.status, 403, face); assert.equal(foreign.body, FORBIDDEN);
    assert.equal(foreign.headers["content-type"], JSON_TYPE);
    const noHost = await call(routes, face, {});
    assert.equal(noHost.status, 403, face); assert.equal(noHost.body, FORBIDDEN);
    assert.equal((await call(routes, face, { host: "evil.example:3090" })).status, 403, "a rebound Host");
    assert.equal((await call(routes, face, { host: "127.0.0.1:3090", "sec-fetch-site": "cross-site" })).status, 403, "a cross-site page");
    if (face === CALLBACK) continue;
    /* The callback's exception is its own: every other route still refuses a venue's navigation, GET or POST. */
    for (const method of ["GET", "POST"]) {
      const nav = await call(routes, face, method === "POST" ? { ...NAVIGATION, "content-type": "application/json" } : NAVIGATION, method, method === "POST" ? "{}" : undefined);
      assert.equal(nav.status, 403, `${method} ${face} refuses a navigation`); assert.equal(nav.body, FORBIDDEN);
    }
  }
  /* the public reads are the market's: nothing under /data/account answers them, the host's 404 does */
  for (const gone of ["explore", "quotes", "candles", "book", "trades"]) {
    assert.ok(!routes.some((r) => r.path === `/data/account/${gone}`), `/data/account/${gone} is not registered`);
  }
  const refusedFirst = await call(routes, "/data/account/connected/explore?force=1", { host: "127.0.0.1:3090", origin: "https://evil.example" });
  assert.equal(refusedFirst.status, 403, "the fence comes before the query");
  assert.equal(fetched.length, 0, "a refused request never reaches the Account");
});

test("a GET passes the Account's status and body through, with application/json and no-store", async () => {
  const body = '{"ok":true,  "venues":[] }';
  const { routes, fetched } = proxyWith(answering(body));
  const a = await call(routes, "/data/account");
  assert.equal(a.status, 200); assert.equal(a.body, body, "the bytes pass unparsed");
  assert.equal(a.headers["content-type"], JSON_TYPE); assert.equal(a.headers["cache-control"], "no-store");
  for (const [face, account] of ROUTES) {
    await call(routes, face);
    assert.equal(fetched.at(-1), `${URL_}${account}`, `${face} asks ${account}`);
  }

  /* A refusal is the Account's answer, not a failure: passed as it is, never kept, never re-served stale. */
  const refusal = '{"ok":false,"refusal":{"code":"E_ACCOUNT_BAD_ACTION","message":"q is longer than 60 characters"}}';
  let clock = NOW;
  let answer = ok('{"ok":true,"items":[]}');
  const flaky = proxyWith(async () => answer, () => clock);
  await call(flaky.routes, "/data/account/connected/explore?tab=crypto");
  clock += ACCOUNT_TTL_MS.connectedExplore + 1;
  answer = ok(refusal, 409);
  const b = await call(flaky.routes, "/data/account/connected/explore?tab=crypto");
  assert.equal(b.status, 409); assert.equal(b.body, refusal, "the Account's words, not the kept rows");
  assert.equal(b.headers["content-type"], JSON_TYPE); assert.equal(b.headers["cache-control"], "no-store");
  await call(flaky.routes, "/data/account/connected/explore?tab=crypto");
  assert.equal(flaky.fetched.length, 3, "a refusal is never kept: the next read asks again");
});

test("a repeated or unknown name, an over-long value: 400 invalid account request, nothing forwarded", async () => {
  const { routes, fetched } = proxyWith(answering(OK_BODY));
  const wide = "%E4%B8%80".repeat(240);
  assert.notEqual(rebuildQuery("connectedExplore", `/data/account/connected/explore?q=${wide}`), null, "240 characters, nine bytes each on the wire, is one fair value");
  const refused = [
    "/data/account/connected/explore?tab=a&tab=b",
    "/data/account/connected/explore?force=1",
    `/data/account/connected/explore?q=${"x".repeat(241)}`,
    "/data/account/connected/explore?fresh=1",
    "/data/account?fresh=1&fresh=1",
    "/data/account?venue=paper-1",
    "/data/account/connected/quotes?pairs=okx|BTC/USDT&pair=broker|NVDA",
    "/data/account/holdings?cost=1&paper=1&cost=1",
    "/data/account/positions?venue[x]=okx",
    `/data/account/connected/explore?tab=${wide}&q=${wide}&key=${wide}&limit=${wide}`,
  ];
  for (const url of refused) {
    const a = await call(routes, url);
    assert.equal(a.status, 400, url.slice(0, 80)); assert.equal(a.body, INVALID);
    assert.equal(a.headers["content-type"], JSON_TYPE);
  }
  assert.equal(fetched.length, 0, "a refused query never reaches the Account");
  assert.deepEqual(ACCOUNT_QUERY, {
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
    asset: ["key", "interval", "range", "fresh"],
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
  });
  assert.equal((await call(routes, `/data/account/connected/explore?q=${"x".repeat(240)}`)).status, 200, "240 characters pass");
  assert.deepEqual(fetched, [`${URL_}/api/account/connected/explore?q=${"x".repeat(240)}`]);
});

/** Twelve markets as the Markets screen asks them, `venue|symbol` each: perpetuals, Kalshi contracts, Polymarket slugs. */
const TWELVE_PAIRS = [
  "hyperliquid|BTC/USDC:USDC", "hyperliquid|ETH/USDC:USDC", "hyperliquid|SOL/USDC:USDC", "coinbase|BTC-USD",
  "kalshi|KXFED-25DEC-T4.00:YES", "kalshi|KXFED-25DEC-T4.25:NO", "kalshi|KXCPIYOY-25NOV-T3.0:YES", "kalshi|KXBTCD-25DEC3117-T99999.99:YES",
  "polymarket|will-the-federal-reserve-cut-interest-rates-by-fifty-basis-points-or-more-at-the-december-2026-fomc-meeting-in-washington-per-the-official-statement:YES",
  "polymarket|will-the-us-unemployment-rate-for-november-2026-as-reported-by-the-bureau-of-labor-statistics-be-above-four-point-five-percent-seasonally-adjusted:NO",
  "polymarket|will-bitcoin-close-above-one-hundred-and-fifty-thousand-dollars-on-the-last-trading-day-of-december-2026-on-coinbase-at-midnight-utc-per-its-daily-candle:YES",
  "polymarket|which-party-will-win-the-majority-of-seats-in-the-united-states-house-of-representatives-in-the-november-2026-midterm-elections-as-called-by-the-ap:DEM",
];

test("quotes: twelve markets in one pairs value pass through whole; pairs has its own 2 000, every other name keeps 240", async () => {
  const value = TWELVE_PAIRS.join(",");
  assert.equal(TWELVE_PAIRS.length, 12);
  assert.ok(value.length > 800 && value.length < 1_000, `about 900 characters, past the 240 of any other name: ${value.length}`);
  const { routes, fetched } = proxyWith(answering(OK_BODY));
  const twelve = await call(routes, `/data/account/connected/quotes?pairs=${encodeURIComponent(value)}`);
  assert.equal(twelve.status, 200);
  assert.deepEqual(fetched, [`${URL_}/api/account/connected/quotes?${new URLSearchParams({ pairs: value })}`], "the whole value, re-encoded");
  assert.equal((await call(routes, `/data/account/connected/quotes?pairs=${"x".repeat(2_000)}`)).status, 200, "2 000 characters pass");
  const over = await call(routes, `/data/account/connected/quotes?pairs=${"x".repeat(2_001)}`);
  assert.equal(over.status, 400); assert.equal(over.body, INVALID);
  assert.equal(rebuildQuery("market", `/data/account/market?symbol=${"x".repeat(241)}`), null, "another name keeps 240");
  assert.equal(rebuildQuery("connectedCandles", `/data/account/connected/candles?symbol=${"x".repeat(241)}`), null);
  // 1 000 characters decoded, nine bytes each on the wire: a request target past 8 192 is refused whatever it decodes to
  assert.equal(rebuildQuery("connectedQuotes", `/data/account/connected/quotes?pairs=${"%E4%B8%80".repeat(1_000)}`), null);
  assert.equal(fetched.length, 2, "a refused value never reaches the Account");
});

test("the upstream request carries no Origin, no Sec-Fetch-Site, no cookie, redirect error, and the rebuilt query only", async () => {
  const { routes, fetched, inits } = proxyWith(answering(OK_BODY));
  const browser = {
    host: "127.0.0.1:3090",
    origin: "http://127.0.0.1:3090",
    "sec-fetch-site": "same-origin",
    cookie: "dsh-auth-1=secret",
    "user-agent": "Mozilla/5.0",
  };
  const a = await call(routes, "/data/account/holdings?cost=1&fresh=1", browser);
  assert.equal(a.status, 200, "the face's own page passes the fence");
  assert.deepEqual(fetched, [`${URL_}/api/account/holdings?cost=1`], "fresh is the face's flag, never forwarded");
  assert.equal(inits[0].headers, undefined, "no header of the browser's is passed: no Origin, no Sec-Fetch-Site, no cookie");
  assert.equal(inits[0].redirect, "error");
  assert.equal(inits[0].method, undefined, "a plain GET");
  assert.ok(inits[0].signal instanceof AbortSignal);
  await call(routes, "/data/account/connected/explore?q=btc%26force%3D1&tab=crypto");
  assert.equal(fetched[1], `${URL_}/api/account/connected/explore?q=btc%26force%3D1&tab=crypto`, "an & inside a value stays inside it; the order is the browser's");
  await call(routes, "/data/account/connected/quotes?pairs=okx|BTC/USDT,broker|NVDA");
  assert.equal(fetched[2], `${URL_}/api/account/connected/quotes?pairs=okx%7CBTC%2FUSDT%2Cbroker%7CNVDA`, "re-encoded, the same value");
  const slash = proxyWith(answering(OK_BODY), () => NOW, { url: `${URL_}/` });
  await call(slash.routes, "/data/account");
  assert.deepEqual(slash.fetched, [`${URL_}/api/account`], "a trailing slash on the URL is not doubled");
  const fetchedByDefault: string[] = [];
  const byDefault: WebRoute[] = [];
  const spy: FakeFetch = async (url) => { fetchedByDefault.push(url); return ok(OK_BODY); };
  registerAccountProxy({ register: (route) => byDefault.push(route) }, { fetch: spy as unknown as typeof fetch });
  await call(byDefault, "/data/account");
  assert.deepEqual(fetchedByDefault, [`${seatUrl().replace(/\/+$/, "")}/api/account`], "the Account the seat names by default");
});

test("two reads within the TTL fetch once; ?fresh=1 fetches again and never joins a plain flight; the TTL expires per route", async () => {
  assert.deepEqual(ACCOUNT_TTL_MS, {
    account: 15_000, market: 3_000, compare: 15_000,
    holdings: 8_000, positions: 10_000, statement: 10_000, history: 60_000, agents: 15_000,
    venues: 60_000, reach: 5_000, keyfile: 5_000, books: 5_000,
    asset: 5_000, funding: 60_000, receive: 60_000, earn: 15_000, sellable: 5_000, signinStatus: 1_000,
    connectedExplore: 20_000, connectedQuotes: 3_000, connectedCandles: 30_000, connectedBook: 2_000, connectedTrades: 2_000,
  });
  let clock = NOW;
  const { routes, fetched, proxy } = proxyWith(answering(OK_BODY), () => clock);
  await call(routes, "/data/account/holdings?cost=1");
  await call(routes, "/data/account/holdings?cost=1");
  assert.equal(fetched.length, 1);
  await call(routes, "/data/account/holdings?cost=1&fresh=1");
  assert.equal(fetched.length, 2, "fresh skips the TTL");
  assert.equal(fetched[1], `${URL_}/api/account/holdings?cost=1`);
  await call(routes, "/data/account");
  assert.equal(fetched.length, 3);
  clock += ACCOUNT_TTL_MS.holdings + 1;
  await call(routes, "/data/account/holdings?cost=1");
  assert.equal(fetched.length, 4, "the holdings read has expired");
  await call(routes, "/data/account");
  assert.equal(fetched.length, 4, "the account read has not");
  clock = NOW + ACCOUNT_TTL_MS.account + 1;
  await call(routes, "/data/account");
  assert.equal(fetched.length, 5);
  proxy.dispose();
  await call(routes, "/data/account");
  assert.equal(fetched.length, 6, "dispose forgets every kept answer");

  const gates: Array<(a: FakeAnswer) => void> = [];
  const gated = proxyWith(() => new Promise<FakeAnswer>((r) => { gates.push(r); }));
  const plain = start(gated.routes, "/data/account/statement");
  const fresh = start(gated.routes, "/data/account/statement?fresh=1");
  await tick();
  assert.equal(gated.fetched.length, 1, "the fresh read waits for the plain one to settle");
  gates[0](ok('{"ok":true,"lines":[]}'));
  await plain.done;
  await tick();
  assert.equal(gated.fetched.length, 2, "then asks the Account again");
  gates[1](ok('{"ok":true,"lines":[1]}'));
  await fresh.done;
  assert.equal(plain.out.body, '{"ok":true,"lines":[]}', "the plain read's answer is the one it asked for");
  assert.equal(fresh.out.body, '{"ok":true,"lines":[1]}', "the fresh read's answer is from after the plain one");
  const again = await call(gated.routes, "/data/account/statement");
  assert.equal(gated.fetched.length, 2, "a plain read within the TTL is served the fresh answer");
  assert.equal(again.body, '{"ok":true,"lines":[1]}');
  const f1 = start(gated.routes, "/data/account/statement?fresh=1");
  const f2 = start(gated.routes, "/data/account/statement?fresh=1");
  await tick();
  assert.equal(gated.fetched.length, 3, "a fresh read joins a fresh flight");
  gates[2](ok('{"ok":true,"lines":[2]}'));
  await Promise.all([f1.done, f2.done]);
  assert.equal(f2.out.body, '{"ok":true,"lines":[2]}');
});

test("concurrent reads of one key share a fetch; two keys are two fetches; the 65th key evicts the least recently used", async () => {
  const gates: Array<(a: FakeAnswer) => void> = [];
  const gated = proxyWith(() => new Promise<FakeAnswer>((r) => { gates.push(r); }));
  const a = start(gated.routes, "/data/account/connected/explore?tab=crypto");
  const b = start(gated.routes, "/data/account/connected/explore?tab=crypto");
  const c = start(gated.routes, "/data/account/connected/explore?tab=stocks");
  await tick();
  assert.deepEqual(gated.fetched, [`${URL_}/api/account/connected/explore?tab=crypto`, `${URL_}/api/account/connected/explore?tab=stocks`]);
  gates[0](ok('{"ok":true,"tab":"crypto"}'));
  gates[1](ok('{"ok":true,"tab":"stocks"}'));
  await Promise.all([a.done, b.done, c.done]);
  assert.equal(a.out.body, '{"ok":true,"tab":"crypto"}'); assert.equal(b.out.body, a.out.body);
  assert.equal(c.out.body, '{"ok":true,"tab":"stocks"}');

  assert.equal(ACCOUNT_CACHE_KEYS, 64);
  const { routes, fetched } = proxyWith(answering(OK_BODY));
  for (let i = 1; i <= ACCOUNT_CACHE_KEYS; i += 1) await call(routes, `/data/account/connected/explore?q=k${i}`);
  assert.equal(fetched.length, 64);
  await call(routes, "/data/account/connected/explore?q=k1");
  assert.equal(fetched.length, 64, "k1 is kept, and is now the most recently used");
  await call(routes, "/data/account/connected/explore?q=k65");
  assert.equal(fetched.length, 65);
  await call(routes, "/data/account/connected/explore?q=k1");
  assert.equal(fetched.length, 65, "k1 outlived the 65th key");
  await call(routes, "/data/account/connected/explore?q=k2");
  assert.equal(fetched.length, 66, "k2, the least recently used, was evicted");
  await call(routes, "/data/account/market?venue=okx&symbol=BTC");
  await call(routes, "/data/account/connected/explore?q=k65");
  assert.equal(fetched.length, 67, "another route's keys are its own");
});

test("an unreachable, hanging, refusing or unreadable Account: 503 with the code and never the text; a cached read is re-served stale:true", async () => {
  assert.deepEqual(ACCOUNT_ABORT_MS, {
    account: 7_000, market: 7_000, compare: 7_000,
    holdings: 12_000, positions: 7_000, statement: 7_000, history: 12_000, agents: 7_000,
    venues: 30_000, reach: 30_000, keyfile: 30_000, books: 30_000,
    asset: 25_000, funding: 12_000, receive: 30_000, earn: 30_000, sellable: 30_000, signinStatus: 7_000,
    connectedExplore: 10_000, connectedQuotes: 7_000, connectedCandles: 25_000, connectedBook: 7_000, connectedTrades: 7_000,
  });
  const refused = proxyWith(async () => { throw Object.assign(new TypeError("fetch failed secret-host-name"), { cause: { code: "ECONNREFUSED" } }); });
  const a = await call(refused.routes, "/data/account/holdings?cost=1");
  assert.equal(a.status, 503); assert.equal(a.body, '{"ok":false,"unreachable":"ECONNREFUSED"}');
  assert.equal(a.headers["content-type"], JSON_TYPE); assert.equal(a.headers["cache-control"], "no-store");
  assert.doesNotMatch(a.body, /secret/);
  const bare = proxyWith(async () => { throw new Error("something private"); });
  const b = await call(bare.routes, "/data/account/statement");
  assert.equal(b.status, 503); assert.equal(b.body, '{"ok":false,"unreachable":"unreachable"}');
  const prose = proxyWith(async () => { throw Object.assign(new Error("x"), { code: "a code with private words" }); });
  assert.equal((await call(prose.routes, "/data/account/agents")).body, '{"ok":false,"unreachable":"unreachable"}', "a code not shaped like one is not passed");

  const abort = (signal: AbortSignal, reject: (err: Error) => void): void =>
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  const hanging = proxyWith((_url, init) => new Promise<FakeAnswer>((_resolve, reject) => abort(init.signal, reject)), () => NOW, { abortMs: { connectedCandles: 20 } });
  const h = await call(hanging.routes, "/data/account/connected/candles?venue=broker&symbol=NVDA&range=1D");
  assert.equal(h.status, 503); assert.equal(h.body, '{"ok":false,"unreachable":"timeout"}', "the headers past the abort");
  const stalling = proxyWith(async (_url, init) => ({ ok: true, status: 200, text: () => new Promise<string>((_resolve, reject) => abort(init.signal, reject)) }), () => NOW, { abortMs: { history: 20 } });
  assert.equal((await call(stalling.routes, "/data/account/history?range=1w")).body, '{"ok":false,"unreachable":"timeout"}', "the body past the abort");
  const unreadable = proxyWith(async () => ({ ok: true, status: 200, text: async () => { throw new TypeError("terminated: private"); } }));
  const u = await call(unreadable.routes, "/data/account/positions");
  assert.equal(u.status, 503); assert.equal(u.body, '{"ok":false,"unreachable":"unreadable"}');

  let clock = NOW;
  let down = false;
  const flaky = proxyWith(async (url) => {
    if (down) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    return ok(url.endsWith("/api/account") ? '{"ok":true,"venues":[]}' : '{"ok":true,"rows":[1]}');
  }, () => clock);
  await call(flaky.routes, "/data/account/holdings?cost=1");
  await call(flaky.routes, "/data/account");
  down = true;
  clock += ACCOUNT_TTL_MS.account + 1;
  const stale = await call(flaky.routes, "/data/account/holdings?cost=1");
  assert.equal(stale.status, 200); assert.deepEqual(JSON.parse(stale.body), { ok: true, rows: [1], stale: true });
  assert.equal(stale.headers["cache-control"], "no-store");
  assert.deepEqual(JSON.parse((await call(flaky.routes, "/data/account/holdings?cost=1&fresh=1")).body), { ok: true, rows: [1], stale: true }, "a fresh read too");
  const elsewhere = await call(flaky.routes, "/data/account/holdings?cost=1&paper=1");
  assert.equal(elsewhere.status, 503, "a query with nothing kept has nothing to re-serve");
  assert.equal(elsewhere.body, '{"ok":false,"unreachable":"ECONNREFUSED"}');
  assert.deepEqual(JSON.parse((await call(flaky.routes, "/data/account")).body), { ok: true, venues: [], stale: true });
  assert.deepEqual(await flaky.proxy.reader.read(), { unreachable: "ECONNREFUSED" }, "the reader never re-serves stale: the seat box shows the absence");
});

test("a disabled row answers 503 unreachable disabled on every route without a fetch", async () => {
  const { routes, fetched, proxy } = proxyWith(answering(OK_BODY), () => NOW, { disabled: true });
  for (const [face] of ROUTES) {
    const a = await call(routes, face);
    assert.equal(a.status, 503, face); assert.equal(a.body, DISABLED);
    assert.equal(a.headers["content-type"], JSON_TYPE); assert.equal(a.headers["cache-control"], "no-store");
  }
  assert.equal((await call(routes, "/data/account?fresh=1")).body, DISABLED);
  const stream = await call(routes, `${STREAM}?client=${CLIENT}`);
  assert.equal(stream.status, 503); assert.equal(stream.body, DISABLED);
  const follow = await call(routes, FOLLOW, JSON_POST, "POST", `{"client":"${CLIENT}","markets":[]}`);
  assert.equal(follow.status, 503); assert.equal(follow.body, DISABLED);
  for (const [face, , route] of WRITES) {
    const write = await call(routes, face, JSON_POST, "POST", '{"draft":{"type":"setWatch"}}');
    assert.equal(write.status, 503, face); assert.equal(write.body, DISABLED);
    assert.equal((await call(routes, face, JSON_POST, "POST", "x".repeat(WRITE_BODY_LIMIT[route] + 1))).status, 413, "the body is read before the row's state is consulted");
  }
  assert.equal((await call(routes, `${STREAM}?client=short`)).status, 400, "a malformed request is refused before the row's state is consulted");
  assert.deepEqual(await proxy.reader.read(), { unreachable: "disabled" });
  assert.deepEqual(await proxy.reader.read(true), { unreachable: "disabled" });
  let asked = 0;
  const counting: FakeFetch = async () => { asked += 1; return ok(OK_BODY); };
  assert.deepEqual(await createAccountReader({ url: URL_, fetch: counting as unknown as typeof fetch, disabled: true }).read(), { unreachable: "disabled" });
  assert.equal(fetched.length, 0); assert.equal(asked, 0);
});

test("POST on a GET route is 405", async () => {
  const { routes, fetched } = proxyWith(answering(OK_BODY));
  for (const face of [...ROUTES.map(([path]) => path), STREAM]) {
    const a = await call(routes, face, { host: "127.0.0.1:3090", "content-type": "application/json" }, "POST");
    assert.equal(a.status, 405, face); assert.equal(a.body, '{"ok":false,"error":"method not allowed"}');
    assert.equal(a.headers["content-type"], JSON_TYPE);
  }
  assert.equal((await call(routes, "/data/account/connected/explore", undefined, "DELETE")).status, 405);
  assert.equal((await call(routes, "/data/account", { host: "127.0.0.1:3090", origin: "https://evil.example" }, "POST")).status, 403, "the fence comes before the method");
  assert.equal(fetched.length, 0);
});

test("createAccountReader: read() is the account route's cache; read(true) asks again", async () => {
  let clock = NOW;
  let n = 0;
  const fetched: string[] = [];
  const counting: FakeFetch = async (url) => { fetched.push(url); n += 1; return ok(`{"ok":true,"n":${n}}`); };
  const deps = { url: URL_, fetch: counting as unknown as typeof fetch, now: () => clock };
  const reader = createAccountReader(deps);
  assert.deepEqual(await reader.read(), { status: 200, body: '{"ok":true,"n":1}' });
  assert.deepEqual(await reader.read(), { status: 200, body: '{"ok":true,"n":1}' });
  assert.deepEqual(fetched, [`${URL_}/api/account`]);
  assert.deepEqual(await reader.read(true), { status: 200, body: '{"ok":true,"n":2}' });
  clock += ACCOUNT_TTL_MS.account + 1;
  assert.deepEqual(await reader.read(), { status: 200, body: '{"ok":true,"n":3}' }, "the TTL expires");

  let m = 0;
  const own = proxyWith(async () => { m += 1; return ok(`{"ok":true,"m":${m}}`); });
  assert.equal((await call(own.routes, "/data/account")).body, '{"ok":true,"m":1}');
  assert.deepEqual(await own.proxy.reader.read(), { status: 200, body: '{"ok":true,"m":1}' });
  assert.equal(own.fetched.length, 1, "the proxy's own reader and /data/account share one read");
  assert.equal((await call(own.routes, "/data/account?fresh=1")).body, '{"ok":true,"m":2}');
  assert.deepEqual(await own.proxy.reader.read(), { status: 200, body: '{"ok":true,"m":2}' }, "the route's fresh answer is the reader's too");
  assert.equal(own.fetched.length, 2);
});

test("the seat route and /data/account share one upstream read within the TTL", async () => {
  const page = JSON.stringify({
    ok: true,
    keys: [{ address: "0xab12", name: "Gravit", status: "ok" }],
    spend: [{ agent: "0xab12", scope: "trade", allow: ["paper-1"], perPaymentUsd: 25, budgetUsd: 100, spentUsd: 0, reservedUsd: 0 }],
    venues: [{ id: "paper-1", name: "Paper account · paper", paper: true, usd: 10_000 }],
    cards: [],
  });
  /* The answer reads as JSON too: a seat route that asked the Account on its own would read it, and the count alone would say so. */
  const fetched: string[] = [];
  const counting: FakeFetch = async (url) => {
    fetched.push(url);
    return Object.assign(ok(page), { json: async (): Promise<unknown> => JSON.parse(page) });
  };
  const routes: WebRoute[] = [];
  const register = (route: WebRoute): void => { routes.push(route); };
  const proxy = registerAccountProxy({ register }, { url: URL_, fetch: counting as unknown as typeof fetch, now: () => NOW });
  registerSeatRoute({ register }, { url: URL_, seatName: "Gravit", reader: proxy.reader, fetch: counting as unknown as typeof fetch, now: () => NOW });

  const proxied = await call(routes, "/data/account");
  assert.equal(proxied.status, 200); assert.equal(proxied.body, page);
  const seat = await call(routes, "/data/seat.json");
  assert.equal(seat.status, 200);
  const view = JSON.parse(seat.body) as SeatView;
  assert.equal(view.reachable, true); assert.equal(view.seat?.status, "admitted");
  assert.deepEqual(view.venues?.map((v) => [v.id, v.paper]), [["paper-1", true]]);
  assert.deepEqual(fetched, [`${URL_}/api/account`], "one upstream read serves both routes");

  const fresh = await call(routes, "/data/seat.json?fresh=1");
  assert.equal((JSON.parse(fresh.body) as SeatView).seat?.status, "admitted");
  assert.equal(fetched.length, 2, "the seat's ?fresh=1 asks the Account again");
  await call(routes, "/data/account");
  assert.equal(fetched.length, 2, "and /data/account is served that answer: one cache, read from either route");
});

test("the stream: a bad client id is 400; a good one opens upstream with accept text/event-stream, since and markets as sent; frames pass through byte for byte", async () => {
  assert.equal(String(STREAM_CLIENT), "/^[A-Za-z0-9_-]{8,48}$/");
  /* A frame cut inside a two-byte letter: a pipe that decoded and re-encoded its chunks would break it. */
  const frame = encode('id: 1a2b3c4d.2\nevent: statement\ndata: {"venue":"Café"}\n\n');
  const cut = frame.indexOf(0xc3) + 1;
  const chunks = [encode("retry: 1000\n\n"), encode('id: ab.1\nevent: hb\ndata: {"at":1}\n\n'), frame.subarray(0, cut), frame.subarray(cut)];
  const { routes, fetched, inits } = proxyWith(streaming(chunks));
  const refused = [
    STREAM,
    `${STREAM}?client=`,
    `${STREAM}?client=abcdefg`,
    `${STREAM}?client=${"a".repeat(49)}`,
    `${STREAM}?client=face.0123456789`,
    `${STREAM}?client=face%200123456789`,
    `${STREAM}?client=face-0123%2F456789`,
    `${STREAM}?since=1a2b3c4d.7&markets=okx:BTC-USDT`,
    `${STREAM}?client=${CLIENT}&client=${CLIENT}`,
    `${STREAM}?client=${CLIENT}&since=a.1&since=a.2`,
    `${STREAM}?client=${CLIENT}&force=1`,
    `${STREAM}?client=${CLIENT}&fresh=1`,
    `${STREAM}?client=${CLIENT}&since=${"1".repeat(241)}`,
    `${STREAM}?client=${CLIENT}&markets=${"m".repeat(4001)}`,
  ];
  for (const url of refused) {
    const a = await call(routes, url);
    assert.equal(a.status, 400, url.slice(0, 80)); assert.equal(a.body, INVALID);
    assert.equal(a.headers["content-type"], JSON_TYPE); assert.equal(a.headers["cache-control"], "no-store");
  }
  assert.equal(fetched.length, 0, "a refused stream never reaches the Account");

  const browser = { host: "127.0.0.1:3090", "sec-fetch-site": "same-origin", cookie: "dsh-auth-1=secret", accept: "text/event-stream" };
  const a = await call(routes, `${STREAM}?since=1a2b3c4d.7&client=${CLIENT}&markets=okx:BTC-USDT,~coinbase:ETH-USD`, browser);
  assert.deepEqual(fetched, [`${URL_}/api/account/stream?since=1a2b3c4d.7&client=${CLIENT}&markets=okx%3ABTC-USDT%2C%7Ecoinbase%3AETH-USD`]);
  assert.deepEqual([...new URL(fetched[0]).searchParams], [["since", "1a2b3c4d.7"], ["client", CLIENT], ["markets", "okx:BTC-USDT,~coinbase:ETH-USD"]], "the values as sent, in their order");
  assert.deepEqual(inits[0].headers, { accept: "text/event-stream" }, "accept alone: no header of the browser's");
  assert.equal(inits[0].redirect, "error"); assert.equal(inits[0].method, undefined);
  assert.ok(inits[0].signal instanceof AbortSignal);
  assert.equal(a.status, 200); assert.deepEqual(a.headers, SSE_HEADERS);
  assert.deepEqual(a.writes, chunks, "each chunk written as it came: no frame re-cut, no byte re-encoded");
  assert.equal(Buffer.concat(a.writes).toString("utf8"), 'retry: 1000\n\nid: ab.1\nevent: hb\ndata: {"at":1}\n\nid: 1a2b3c4d.2\nevent: statement\ndata: {"venue":"Café"}\n\n');
  assert.equal(a.ended, true, "the response ends when the Account ends the stream");
  assert.equal(a.dropped, false);

  const widest = await call(routes, `${STREAM}?client=${"a".repeat(48)}&since=${"1".repeat(240)}&markets=${"m".repeat(4000)}`);
  assert.equal(widest.status, 200, "48, 240 and 4 000 characters pass");
  assert.equal(fetched.length, 2);
});

test("Last-Event-ID becomes since and wins over a since in the query, as the Account reads it", async () => {
  const { routes, fetched, inits } = proxyWith(streaming([encode("retry: 1000\n\n")]));
  const resuming = (id: string): Record<string, string> => ({ host: "127.0.0.1:3090", "last-event-id": id });
  await call(routes, `${STREAM}?client=${CLIENT}`, resuming("1a2b3c4d.42"));
  assert.equal(fetched[0], `${URL_}/api/account/stream?client=${CLIENT}&since=1a2b3c4d.42`);
  assert.deepEqual(inits[0].headers, { accept: "text/event-stream" }, "the id travels as since, never as a header");
  await call(routes, `${STREAM}?since=1a2b3c4d.40&client=${CLIENT}`, resuming("1a2b3c4d.42"));
  assert.equal(fetched[1], `${URL_}/api/account/stream?since=1a2b3c4d.42&client=${CLIENT}`, "the header's id wins, in the query's place: an EventSource reconnecting to the URL it opened resumes from its newest id");
  await call(routes, `${STREAM}?since=1a2b3c4d.40&client=${CLIENT}`);
  assert.equal(fetched[2], `${URL_}/api/account/stream?since=1a2b3c4d.40&client=${CLIENT}`, "without the header, the query's since");
  await call(routes, `${STREAM}?since=1a2b3c4d.40&client=${CLIENT}`, resuming(""));
  assert.equal(fetched[3], `${URL_}/api/account/stream?since=1a2b3c4d.40&client=${CLIENT}`, "an empty header is no id");
  await call(routes, `${STREAM}?client=${CLIENT}`);
  assert.equal(fetched[4], `${URL_}/api/account/stream?client=${CLIENT}`, "neither: no since");
  await call(routes, `${STREAM}?client=${CLIENT}`, resuming("x&client=someone-else-1"));
  assert.equal(fetched[5], `${URL_}/api/account/stream?client=${CLIENT}&since=x%26client%3Dsomeone-else-1`, "the header is one value: it names no parameter of its own");
  const long = await call(routes, `${STREAM}?since=1a2b3c4d.40&client=${CLIENT}`, resuming("1".repeat(241)));
  assert.equal(long.status, 400, "an id longer than a since may be is refused as that since is"); assert.equal(long.body, INVALID);
  assert.equal(fetched.length, 6);
});

test("the Account's 503 passes through as 503 with its body; an unreachable upstream is 503 unreachable", async () => {
  const refusing = (status: number, body: string): FakeFetch => async () =>
    ({ ok: false, status, headers: new Headers({ "content-type": "application/json; charset=utf-8" }), text: async () => body, body: null });
  const full = '{"ok":false,"error":"this account has 32 pages listening already: close a tab of it, and this one listens again on its next try"}';
  const a = await call(proxyWith(refusing(503, full)).routes, `${STREAM}?client=${CLIENT}`);
  assert.equal(a.status, 503); assert.equal(a.body, full, "the Account's sentence, as it said it");
  assert.equal(a.headers["content-type"], JSON_TYPE); assert.equal(a.headers["cache-control"], "no-store");
  assert.deepEqual(a.writes, [], "no stream is opened on a refusal");
  const named = '{"ok":false,"error":"a page names itself in 8 to 48 letters, digits, dashes or underscores"}';
  const b = await call(proxyWith(refusing(400, named)).routes, `${STREAM}?client=${CLIENT}`);
  assert.equal(b.status, 400); assert.equal(b.body, named, "any answer but a 200 is the Account's status and body");

  const refused = proxyWith(async () => { throw Object.assign(new TypeError("fetch failed secret-host-name"), { cause: { code: "ECONNREFUSED" } }); });
  const c = await call(refused.routes, `${STREAM}?client=${CLIENT}`);
  assert.equal(c.status, 503); assert.equal(c.body, '{"ok":false,"unreachable":"ECONNREFUSED"}');
  assert.equal(c.headers["content-type"], JSON_TYPE); assert.equal(c.headers["cache-control"], "no-store");
  assert.doesNotMatch(c.body, /secret/);
  const redirected = proxyWith(async () => { throw new TypeError("fetch failed: redirect to a private place"); });
  assert.equal((await call(redirected.routes, `${STREAM}?client=${CLIENT}`)).body, '{"ok":false,"unreachable":"unreachable"}', "a failure with no code says unreachable");
  const unreadable = proxyWith(async () => ({ ok: false, status: 503, text: async () => { throw new TypeError("terminated: private"); }, body: null }));
  const u = await call(unreadable.routes, `${STREAM}?client=${CLIENT}`);
  assert.equal(u.status, 503); assert.equal(u.body, '{"ok":false,"unreachable":"unreadable"}');
});

test("closing the browser response aborts the upstream fetch", async () => {
  /* The browser leaves while the Account is still to answer. */
  const pending = proxyWith((_url, init) => new Promise<FakeAnswer>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(aborted()))));
  const early = start(pending.routes, `${STREAM}?client=${CLIENT}`);
  await tick();
  assert.equal(pending.inits[0].signal.aborted, false, "the request waits on the Account");
  early.out.hangUp();
  await early.done;
  assert.equal(pending.inits[0].signal.aborted, true, "a browser gone before the Account answers cancels the request");
  assert.equal(early.out.status, 0, "and is written nothing");

  /* The browser leaves mid-stream. */
  const account = holdingAccount();
  const live = proxyWith(account.doFetch);
  const one = start(live.routes, `${STREAM}?client=${CLIENT}`);
  await tick();
  account.push(0, encode("retry: 1000\n\n"));
  await tick();
  assert.equal(one.out.status, 200); assert.equal(one.out.writes.length, 1);
  assert.equal(live.inits[0].signal.aborted, false, "an open stream holds its upstream");
  one.out.hangUp();
  await one.done;
  assert.equal(live.inits[0].signal.aborted, true, "a closed response closes its upstream");
  assert.equal(one.out.ended, false, "and is not written to again");

  /* The response errors. */
  const two = start(live.routes, `${STREAM}?client=${CLIENT}`);
  await tick();
  two.out.emit("error", new Error("write EPIPE"));
  await two.done;
  assert.equal(live.inits[1].signal.aborted, true, "an errored response closes its upstream");

  /* A browser that reads too slowly. */
  const three = start(live.routes, `${STREAM}?client=${CLIENT}`);
  await tick();
  three.out.writableLength = 256 * 1024;
  account.push(2, encode("retry: 1000\n\n"));
  await tick();
  assert.equal(three.out.writes.length, 1, "256 KiB unread is still written to");
  three.out.writableLength = 256 * 1024 + 1;
  account.push(2, encode(': hb 1\nevent: hb\ndata: {"at":1}\n\n'));
  await three.done;
  assert.equal(three.out.dropped, true, "past 256 KiB the response is destroyed, as quotes.ts destroys it");
  assert.equal(three.out.writes.length, 1, "the chunk past the bound is not written");
  assert.equal(live.inits[2].signal.aborted, true, "and the upstream is aborted with it");

  /* The proxy disposed. */
  const four = start(live.routes, `${STREAM}?client=${CLIENT}`);
  await tick();
  live.proxy.dispose();
  await four.done;
  assert.equal(live.inits[3].signal.aborted, true, "dispose aborts every open upstream");
  assert.equal(four.out.ended, true, "and ends the browser's response");
  /* main.ts disposes once the web server has stopped, from its shutdown or from installFailLoud's release: twice is harmless. */
  assert.doesNotThrow(() => live.proxy.dispose());
});

test("stream/markets: the body passes as bytes with application/json; 413 past 4096; GET is 405", async () => {
  assert.equal(STREAM_BODY_LIMIT, 4096);
  const following = '{"ok":true,"following":["okx:BTC-USDT","~kalshi:KXHIGHNY-25OCT23"]}';
  const { routes, fetched, inits } = proxyWith(answering(following));
  const body = `{"client":"${CLIENT}", "markets":["okx:BTC-USDT","~kalshi:KXHIGHNY-25OCT23"],"n":3,"note":"café"}`;
  const a = await call(routes, FOLLOW, JSON_POST, "POST", body);
  assert.equal(a.status, 200); assert.equal(a.body, following, "the Account's answer, as it said it");
  assert.equal(a.headers["content-type"], JSON_TYPE); assert.equal(a.headers["cache-control"], "no-store");
  assert.deepEqual(fetched, [`${URL_}/api/account/stream/markets`]);
  assert.equal(inits[0].method, "POST");
  assert.deepEqual(inits[0].headers, { "content-type": "application/json" });
  assert.equal(inits[0].body, body, "the body as posted: never parsed, never re-written");
  assert.equal(inits[0].redirect, "error"); assert.ok(inits[0].signal instanceof AbortSignal);
  await call(routes, FOLLOW, JSON_POST, "POST", body);
  assert.equal(fetched.length, 2, "never kept: every telling reaches the Account");

  const none = '{"ok":false,"error":"no stream of that page is open: it opens one at GET /api/account/stream first"}';
  const closed = await call(proxyWith(answering(none, 404)).routes, FOLLOW, JSON_POST, "POST", body);
  assert.equal(closed.status, 404); assert.equal(closed.body, none, "the Account's status and words");

  const tooBig = [["x".repeat(STREAM_BODY_LIMIT + 1), "4 097 bytes"], ["é".repeat(STREAM_BODY_LIMIT / 2 + 1), "2 049 letters, 4 098 bytes: the limit counts bytes"]] as const;
  for (const [over, why] of tooBig) {
    const big = await call(routes, FOLLOW, JSON_POST, "POST", over);
    assert.equal(big.status, 413, why); assert.equal(big.body, '{"ok":false,"error":"body too large"}');
    assert.equal(big.headers["content-type"], JSON_TYPE); assert.equal(big.headers["cache-control"], "no-store");
  }
  assert.equal(fetched.length, 2, "a body past the limit never reaches the Account");
  await call(routes, FOLLOW, JSON_POST, "POST", "x".repeat(STREAM_BODY_LIMIT));
  assert.equal(fetched.length, 3, "4 096 bytes pass");
  const cutOff = Object.assign(new Readable({ read() { this.destroy(new Error("aborted")); } }), { url: FOLLOW, headers: JSON_POST, method: "POST" });
  const halfRead = fakeRes();
  await routes.find((r) => r.path === FOLLOW)!.handler(cutOff as unknown as IncomingMessage, halfRead.res);
  assert.equal(halfRead.out.status, 400, "a body that breaks off is refused, never a rejection"); assert.equal(halfRead.out.body, INVALID);
  const queried = await call(routes, `${FOLLOW}?client=${CLIENT}&force=1`, JSON_POST, "POST", body);
  assert.equal(queried.status, 400, "the POST takes no query name"); assert.equal(queried.body, INVALID);
  assert.equal(queried.headers["content-type"], JSON_TYPE); assert.equal(queried.headers["cache-control"], "no-store");
  assert.equal((await call(routes, `${FOLLOW}?n=1`, JSON_POST, "POST", "x".repeat(STREAM_BODY_LIMIT + 1))).status, 400, "a query is refused before the body is read");
  assert.equal(fetched.length, 3, "a query on the POST reaches nothing");

  for (const method of ["GET", "PUT", "DELETE"]) {
    const m = await call(routes, FOLLOW, JSON_POST, method);
    assert.equal(m.status, 405, method); assert.equal(m.body, '{"ok":false,"error":"method not allowed"}');
  }
  assert.equal((await call(routes, FOLLOW, { ...JSON_POST, origin: "https://evil.example" }, "POST", body)).status, 403, "the fence comes first");
  assert.equal(fetched.length, 3);

  const refused = proxyWith(async () => { throw Object.assign(new TypeError("fetch failed secret-host-name"), { cause: { code: "ECONNREFUSED" } }); });
  const u = await call(refused.routes, FOLLOW, JSON_POST, "POST", body);
  assert.equal(u.status, 503); assert.equal(u.body, '{"ok":false,"unreachable":"ECONNREFUSED"}');
  assert.doesNotMatch(u.body, /secret/);
});

test("stream/markets: text/plain or no content type is 415 before the body is read, and nothing is fetched", async () => {
  const { routes, fetched } = proxyWith(answering('{"ok":true,"following":[]}'));
  const body = `{"client":"${CLIENT}","markets":[]}`;
  const notJson: Array<Record<string, string>> = [{ host: "127.0.0.1:3090", "content-type": "text/plain" }, { host: "127.0.0.1:3090" }];
  for (const headers of notJson) {
    const a = await call(routes, FOLLOW, headers, "POST", body);
    assert.equal(a.status, 415, headers["content-type"] ?? "no content type"); assert.equal(a.body, '{"ok":false,"error":"application/json only"}');
    assert.equal(a.headers["content-type"], JSON_TYPE); assert.equal(a.headers["cache-control"], "no-store");
  }
  assert.equal((await call(routes, FOLLOW, notJson[0], "POST", "x".repeat(STREAM_BODY_LIMIT + 1))).status, 415, "refused before the body is read: never a 413");
  assert.equal(fetched.length, 0, "nothing reaches the Account");
  const charset = await call(routes, FOLLOW, { host: "127.0.0.1:3090", "content-type": "application/json; charset=utf-8" }, "POST", body);
  assert.equal(charset.status, 200, "application/json with a charset passes");
  assert.equal(fetched.length, 1);
});

test("the four stage-2 reads are registered with their names and never force", async () => {
  const { routes, fetched } = proxyWith(answering(OK_BODY));
  const refused = [
    "/data/account/venues?force=1",
    "/data/account/venues?fresh=1",
    "/data/account/connect/reach?connector=live:kalshi&force=1",
    "/data/account/connect/reach?connector=live:kalshi&connector=live:okx",
    "/data/account/keyfile?kind=alpaca-paper&value=1",
    "/data/account/paper/books?venue=paper",
  ];
  for (const url of refused) {
    const a = await call(routes, url);
    assert.equal(a.status, 400, url); assert.equal(a.body, INVALID);
  }
  assert.equal(fetched.length, 0, "force, fresh or a name off the row never reaches the Account");

  await call(routes, "/data/account/connect/reach?connector=live:kalshi");
  assert.equal(fetched[0], `${URL_}/api/account/connect/reach?connector=live%3Akalshi`);
  assert.deepEqual([...new URL(fetched[0]).searchParams], [["connector", "live:kalshi"]], "connector, the only name");
  await call(routes, "/data/account/keyfile?kind=alpaca-paper&venue=alpaca-paper&ref=keys/a.json&exchange=okx");
  assert.equal(new URL(fetched[1]).pathname, "/api/account/keyfile");
  assert.deepEqual([...new URL(fetched[1]).searchParams], [["kind", "alpaca-paper"], ["venue", "alpaca-paper"], ["ref", "keys/a.json"], ["exchange", "okx"]]);
  await call(routes, "/data/account/venues");
  await call(routes, "/data/account/paper/books");
  assert.deepEqual(fetched.slice(2), [`${URL_}/api/account/venues`, `${URL_}/api/account/paper/books`]);
  await call(routes, "/data/account/venues");
  await call(routes, "/data/account/paper/books");
  await call(routes, "/data/account/connect/reach?connector=live:kalshi");
  assert.equal(fetched.length, 4, "kept within the TTL, as the stage-1 reads are");
});

test("a write forwards its body as bytes with the Account's status", async () => {
  const refusal = '{"ok":false,"refusal":{"code":"E_ACCOUNT_STALE_NONCE","message":"that nonce is spent: prepare again"},  "detail":{}}';
  const { routes, fetched, inits } = proxyWith(answering(refusal, 409));
  const browser = { ...JSON_POST, origin: "http://127.0.0.1:3090", "sec-fetch-site": "same-origin", cookie: "dsh-auth-1=secret" };
  const body = '{"draft": {"type":"setWatch","venue":"ex","symbol":"BTC/USDT","on":"true"}, "note":"café"}';
  for (const [face, account] of WRITES) {
    const a = await call(routes, face, browser, "POST", body);
    assert.equal(a.status, 409, face); assert.equal(a.body, refusal, "the Account's bytes, as it said them");
    assert.equal(a.headers["content-type"], JSON_TYPE); assert.equal(a.headers["cache-control"], "no-store");
    assert.equal(fetched.at(-1), `${URL_}${account}`, `${face} asks ${account}`);
    const init = inits.at(-1)!;
    assert.equal(init.method, "POST");
    assert.deepEqual(init.headers, { "content-type": "application/json" }, "content-type alone: no Origin, no Sec-Fetch-Site, no cookie");
    assert.equal(init.body, body, "the body as posted: never parsed, never re-written");
    assert.equal(init.redirect, "error"); assert.ok(init.signal instanceof AbortSignal);
  }
  const accepted = '{"ok":true,"kind":"account"}';
  const a = await call(proxyWith(answering(accepted)).routes, "/data/account/exchange", JSON_POST, "POST", body);
  assert.equal(a.status, 200); assert.equal(a.body, accepted);
});

test("a write past its limit is 413, a non-JSON one 415, a query on it 400", async () => {
  assert.deepEqual(WRITE_BODY_LIMIT, {
    pair: 4_096, prepare: 16_384, exchange: 65_536,
    challenge: 1_024, prove: 2_048, signinStart: 512, bridgeRoutes: 4_096, orderSent: 512, orderRequote: 512, sent: 512, revoke: 512, guard: 256,
  });
  const { routes, fetched } = proxyWith(answering(OK_BODY));
  for (const [face, , route] of WRITES) {
    const limit: number = WRITE_BODY_LIMIT[route];
    const big = await call(routes, face, JSON_POST, "POST", "x".repeat(limit + 1));
    assert.equal(big.status, 413, `${face} at ${limit + 1} bytes`); assert.equal(big.body, '{"ok":false,"error":"body too large"}');
    assert.equal(big.headers["content-type"], JSON_TYPE); assert.equal(big.headers["cache-control"], "no-store");
    assert.equal((await call(routes, face, JSON_POST, "POST", "é".repeat(limit / 2 + 1))).status, 413, "the limit counts bytes");
    assert.equal((await call(routes, face, JSON_POST, "POST", "x".repeat(limit))).status, 200, `${limit} bytes pass`);
    for (const headers of [{ host: "127.0.0.1:3090", "content-type": "text/plain" }, { host: "127.0.0.1:3090" }] as Array<Record<string, string>>) {
      const plain = await call(routes, face, headers, "POST", "x".repeat(limit + 1));
      assert.equal(plain.status, 415, `${face} ${headers["content-type"] ?? "no content type"}: refused before the body is read`);
      assert.equal(plain.body, '{"ok":false,"error":"application/json only"}');
    }
    for (const url of [`${face}?nonce=1`, `${face}?fresh=1`]) {
      const queried = await call(routes, url, JSON_POST, "POST", "x".repeat(limit + 1));
      assert.equal(queried.status, 400, `${url}: refused before the body is read`); assert.equal(queried.body, INVALID);
    }
    for (const method of ["GET", "PUT", "DELETE"]) {
      const m = await call(routes, face, JSON_POST, method);
      assert.equal(m.status, 405, `${method} ${face}`); assert.equal(m.body, '{"ok":false,"error":"method not allowed"}');
    }
    assert.equal((await call(routes, face, { ...JSON_POST, origin: "https://evil.example" }, "POST", "{}")).status, 403, "the fence comes first");
  }
  assert.equal(fetched.length, 3, "only the three bodies at their limits reach the Account");
  const cutOff = Object.assign(new Readable({ read() { this.destroy(new Error("aborted")); } }), { url: "/data/account/prepare", headers: JSON_POST, method: "POST" });
  const halfRead = fakeRes();
  await routes.find((r) => r.path === "/data/account/prepare")!.handler(cutOff as unknown as IncomingMessage, halfRead.res);
  assert.equal(halfRead.out.status, 400, "a body that breaks off is refused, never a rejection"); assert.equal(halfRead.out.body, INVALID);
  assert.equal(fetched.length, 3);
});

test("a write never serves stale and never caches", async () => {
  let n = 0;
  let down = false;
  const { routes, fetched } = proxyWith(async () => {
    if (down) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    n += 1;
    return ok(`{"ok":true,"kind":"account","n":${n}}`);
  });
  const body = '{"action":{"type":"setWatch","nonce":"1760000000001"},"nonce":"1760000000001","signature":"0xabc"}';
  assert.equal((await call(routes, "/data/account/exchange", JSON_POST, "POST", body)).body, '{"ok":true,"kind":"account","n":1}');
  assert.equal((await call(routes, "/data/account/exchange", JSON_POST, "POST", body)).body, '{"ok":true,"kind":"account","n":2}');
  assert.deepEqual(fetched, [`${URL_}/api/exchange`, `${URL_}/api/exchange`], "two identical writes reach the Account twice");
  down = true;
  const after = await call(routes, "/data/account/exchange", JSON_POST, "POST", body);
  assert.equal(after.status, 503, "a write's earlier answer is never re-served");
  assert.equal(after.body, '{"ok":false,"unreachable":"ECONNREFUSED"}');
  assert.doesNotMatch(after.body, /stale/);
});

test("an unreachable Account on a write is 503 with the code", async () => {
  const refused = proxyWith(async () => { throw Object.assign(new TypeError("fetch failed secret-host-name"), { cause: { code: "ECONNREFUSED" } }); });
  const bare = proxyWith(async () => { throw new Error("something private"); });
  const unreadable = proxyWith(async () => ({ ok: true, status: 200, text: async () => { throw new TypeError("terminated: private"); } }));
  for (const [face] of WRITES) {
    const a = await call(refused.routes, face, JSON_POST, "POST", "{}");
    assert.equal(a.status, 503, face); assert.equal(a.body, '{"ok":false,"unreachable":"ECONNREFUSED"}');
    assert.equal(a.headers["content-type"], JSON_TYPE); assert.equal(a.headers["cache-control"], "no-store");
    assert.doesNotMatch(a.body, /secret/);
    assert.equal((await call(bare.routes, face, JSON_POST, "POST", "{}")).body, '{"ok":false,"unreachable":"unreachable"}', "a failure with no code says unreachable");
    assert.equal((await call(unreadable.routes, face, JSON_POST, "POST", "{}")).body, '{"ok":false,"unreachable":"unreadable"}');
  }
});

test("a write's abort is the row's", async (t) => {
  assert.deepEqual(WRITE_ABORT_MS, {
    pair: 7_000, prepare: 30_000, exchange: 30_000,
    challenge: 7_000, prove: 12_000, signinStart: 30_000, bridgeRoutes: 30_000, orderSent: 30_000, orderRequote: 30_000, sent: 30_000,
    revoke: 7_000, guard: 7_000,
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const [face, , route] of [...WRITES, ...NEW_WRITES]) {
    const hanging = proxyWith((_url, init) => new Promise<FakeAnswer>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(aborted()))));
    const one = start(hanging.routes, face, JSON_POST, "POST", "{}");
    for (let i = 0; i < 50 && hanging.inits.length === 0; i += 1) await new Promise<void>((r) => setImmediate(r));
    assert.equal(hanging.inits.length, 1, `${face} asked the Account`);
    t.mock.timers.tick(WRITE_ABORT_MS[route] - 1);
    assert.equal(hanging.inits[0].signal.aborted, false, `${face} waits ${WRITE_ABORT_MS[route] - 1} ms`);
    t.mock.timers.tick(1);
    assert.equal(hanging.inits[0].signal.aborted, true, `${face} is cut at ${WRITE_ABORT_MS[route]} ms`);
    await one.done;
    assert.equal(one.out.status, 503); assert.equal(one.out.body, '{"ok":false,"unreachable":"timeout"}');
  }
});

test("the new reads keep their whitelists and TTLs", async () => {
  const ttl = { asset: 5_000, funding: 60_000, receive: 60_000, earn: 15_000, sellable: 5_000, signinStatus: 1_000 };
  const abort = { asset: 25_000, funding: 12_000, receive: 30_000, earn: 30_000, sellable: 30_000, signinStatus: 7_000 };
  const names = {
    asset: ["key", "interval", "range", "fresh"], funding: ["venue", "limit"],
    receive: ["venue", "asset", "network"], earn: ["venue", "asset", "fresh"], sellable: ["fresh"], signinStatus: ["state"],
  };
  for (const [face, account, route, query] of NEW_READS) {
    assert.equal(ACCOUNT_TTL_MS[route], ttl[route], `${route} TTL`);
    assert.equal(ACCOUNT_ABORT_MS[route], abort[route], `${route} abort`);
    assert.deepEqual(ACCOUNT_QUERY[route], names[route], `${route} names`);
    let clock = NOW;
    const { routes, fetched } = proxyWith(answering(OK_BODY), () => clock);
    const unknown = await call(routes, `${face}?${query}${query === "" ? "" : "&"}force=1`);
    assert.equal(unknown.status, 400, `${face}: an unknown name`); assert.equal(unknown.body, INVALID);
    assert.equal(fetched.length, 0, `${face}: nothing fetched for an unknown name`);
    const url = query === "" ? face : `${face}?${query}`;
    const a = await call(routes, url);
    assert.equal(a.status, 200); assert.equal(a.body, OK_BODY);
    assert.equal(fetched[0], `${URL_}${account}${query === "" ? "" : `?${query}`}`, `${face}: the query rebuilt in order`);
    await call(routes, url);
    assert.equal(fetched.length, 1, `${face}: a second read inside the TTL fetches once`);
    clock += ttl[route];
    await call(routes, url);
    assert.equal(fetched.length, 2, `${face}: the TTL expires at ${ttl[route]} ms`);
  }
  const { routes, fetched } = proxyWith(answering(OK_BODY));
  await call(routes, "/data/account/sellable");
  await call(routes, "/data/account/sellable?fresh=1");
  assert.deepEqual(fetched, [`${URL_}/api/account/sellable`, `${URL_}/api/account/sellable`], "sellable?fresh=1 asks again, fresh never forwarded");
});

test("the new writes forward their bodies as bytes", async () => {
  const refusal = '{"ok":false,"refusal":{"code":"E_X","message":"no"}}';
  const { routes, fetched, inits } = proxyWith(answering(refusal, 409));
  const body = '{"venue":"paper",  "asset":"USDC", "note":"café"}';
  for (const [face, account, route] of FORWARDING) {
    assert.ok(Buffer.byteLength(body) <= WRITE_BODY_LIMIT[route]);
    const a = await call(routes, face, JSON_POST, "POST", body);
    assert.equal(a.status, 409, face); assert.equal(a.body, refusal);
    assert.equal(a.headers["content-type"], JSON_TYPE); assert.equal(a.headers["cache-control"], "no-store");
    assert.equal(fetched.at(-1), `${URL_}${account}`, `${face} asks ${account}`);
    const init = inits.at(-1)!;
    assert.equal(init.method, "POST"); assert.equal(init.body, body, `${face}: the body as posted`);
    assert.equal((init.headers as Record<string, string>)["content-type"], "application/json");
    assert.equal(init.redirect, "error");
  }
  const n = fetched.length;
  for (const [face, , route] of NEW_WRITES) {
    const limit = WRITE_BODY_LIMIT[route];
    const big = await call(routes, face, JSON_POST, "POST", "x".repeat(limit + 1));
    assert.equal(big.status, 413, `${face} at ${limit + 1} bytes`);
    const plain = await call(routes, face, { host: "127.0.0.1:3090", "content-type": "text/plain" }, "POST", "{}");
    assert.equal(plain.status, 415, `${face} text/plain`);
    const queried = await call(routes, `${face}?x=1`, JSON_POST, "POST", "{}");
    assert.equal(queried.status, 400, `${face} with a query`); assert.equal(queried.body, INVALID);
  }
  assert.equal(fetched.length, n, "no refused write reaches the Account");
});

test("guard sends the fixed body whatever the browser posted", async () => {
  const answer = '{"ok":true,  "mode":"guard"}';
  const { routes, fetched, inits } = proxyWith(answering(answer, 202));
  const a = await call(routes, "/data/account/guard", JSON_POST, "POST", '{"mode":"open"}');
  assert.equal(fetched.at(-1), `${URL_}/api/mode`);
  assert.equal(inits.at(-1)!.body, '{"mode":"guard"}', "the browser's body never reaches the Account");
  assert.deepEqual(inits.at(-1)!.headers, { "content-type": "application/json" });
  assert.equal(a.status, 202); assert.equal(a.body, answer, "the Account's status and body as they are");
  const big = await call(routes, "/data/account/guard", JSON_POST, "POST", "x".repeat(257));
  assert.equal(big.status, 413);
  assert.equal(fetched.length, 1, "a body past 256 bytes is refused and nothing is fetched");
  await call(routes, "/data/account/guard", JSON_POST, "POST", "x".repeat(256));
  assert.equal(inits.at(-1)!.body, '{"mode":"guard"}', "256 bytes are read and discarded");
});

test("the face's origin rides challenge and signin/start only", async () => {
  assert.equal(FACE_ORIGIN_HEADER, "x-gravit-face-origin");
  for (const [host, origin] of [["localhost:3090", "http://localhost:3090"], ["127.0.0.1:3090", "http://127.0.0.1:3090"], ["LOCALHOST:3090", "http://localhost:3090"]]) {
    const { routes, fetched, inits } = proxyWith(answering(OK_BODY));
    const headers = { host, "content-type": "application/json", [FACE_ORIGIN_HEADER]: "http://evil.example" };
    for (const [face, account, route] of [...WRITES, ...NEW_WRITES]) {
      await call(routes, face, headers, "POST", "{}");
      assert.equal(fetched.at(-1), `${URL_}${account}`);
      const sent = inits.at(-1)!.headers as Record<string, string>;
      if (route === "challenge" || route === "signinStart") {
        assert.deepEqual(sent, { "content-type": "application/json", [FACE_ORIGIN_HEADER]: origin }, `${face} on ${host}: the browser's own Host`);
      } else {
        assert.deepEqual(sent, { "content-type": "application/json" }, `${face}: no origin header`);
      }
    }
    for (const [face] of [...ROUTES, ...NEW_READS]) await call(routes, face, headers);
    await call(routes, FOLLOW, headers, "POST", "{}");
    const reads = inits.filter((init) => init.method !== "POST");
    assert.ok(reads.length > 0);
    for (const init of reads) assert.equal(JSON.stringify(init.headers ?? {}).includes(FACE_ORIGIN_HEADER), false, "no read carries it");
    assert.deepEqual(inits.at(-1)!.headers, { "content-type": "application/json" }, "stream/markets carries none");
  }
  const reqOf = (host?: string): IncomingMessage => ({ url: "/", method: "POST", headers: host === undefined ? {} : { host } }) as unknown as IncomingMessage;
  assert.equal(faceOriginOf(reqOf("127.0.0.1:3090")), "http://127.0.0.1:3090");
  assert.equal(faceOriginOf(reqOf("[::1]:3090")), "http://[::1]:3090");
  assert.equal(faceOriginOf(reqOf("evil.example:3090")), null);
  assert.equal(faceOriginOf(reqOf("10.0.0.2:3090")), null);
  assert.equal(faceOriginOf(reqOf()), null);
  assert.equal(faceOriginOf(reqOf("::1")), null, "a loopback spelling with no URL form gives no origin");
});

test("nothing of a new write's body is logged", async (t) => {
  const seen: string[] = [];
  const keep = (...args: unknown[]): void => { seen.push(args.map(String).join(" ")); };
  t.mock.method(console, "log", keep);
  t.mock.method(console, "error", keep);
  t.mock.method(console, "warn", keep);
  t.mock.method(console, "info", keep);
  const body = '{"address":"0xabc1234567","signature":"0xdef7654321"}';
  for (const doFetch of [answering(OK_BODY), answering('{"ok":false}', 409), (async () => { throw Object.assign(new TypeError("x"), { cause: { code: "ECONNREFUSED" } }); }) as FakeFetch]) {
    const { routes } = proxyWith(doFetch);
    for (const [face] of NEW_WRITES) {
      await call(routes, face, JSON_POST, "POST", body);
      await call(routes, face, JSON_POST, "POST", body + "x".repeat(5_000));
    }
  }
  assert.equal(seen.some((line) => line.includes("0xabc") || line.includes("0xdef")), false);
});

test("the callback forwards a venue's navigation and answers the Account's page", async () => {
  const page = "<!doctype html><title>Robinhood sign-in</title><p>Go back to Gravit</p>";
  const { routes, fetched, inits } = proxyWith(answering(page));
  const a = await call(routes, `${CALLBACK}?state=s1&code=c1&iss=https%3A%2F%2Fexample`, NAVIGATION);
  assert.equal(a.status, 200);
  assert.equal(a.body, page, "the Account's bytes");
  assert.deepEqual(a.headers, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
  assert.deepEqual(fetched, [`${URL_}/api/account/signin/callback?state=s1&code=c1&iss=https%3A%2F%2Fexample`], "once, the rebuilt query");
  assert.equal(inits[0]!.redirect, "error");
  assert.equal(inits[0]!.headers, undefined, "a plain loopback fetch: no Origin, no Sec-Fetch-*, no cookie");
  assert.equal(inits[0]!.method, undefined, "a GET");

  /* Every name the venue may send, and a navigation with no Sec-Fetch-Site or `none` (typed, or a bookmark). */
  const all = "state=s2&code=c2&error=access_denied&error_description=the+owner+said+no&iss=https%3A%2F%2Fexample";
  await call(routes, `${CALLBACK}?${all}`, { ...NAVIGATION, "sec-fetch-site": "none" });
  assert.equal(fetched.at(-1), `${URL_}/api/account/signin/callback?${all}`);
  const { "sec-fetch-site": _site, ...noSite } = NAVIGATION;
  assert.equal((await call(routes, `${CALLBACK}?state=s3`, noSite)).status, 200);

  /* Not kept: the same callback asks again. */
  const before = fetched.length;
  await call(routes, `${CALLBACK}?state=s3`, NAVIGATION);
  assert.equal(fetched.length, before + 1, "never kept");

  /* A refusal is the Account's page, its status passed through. */
  const refused = proxyWith(answering("<p>this sign-in is not one this server started</p>", 400));
  const r = await call(refused.routes, `${CALLBACK}?state=x`, NAVIGATION);
  assert.equal(r.status, 400); assert.equal(r.body, "<p>this sign-in is not one this server started</p>");
  assert.equal(r.headers["content-type"], "text/html; charset=utf-8");
});

test("the callback forwards error_uri", async () => {
  const { routes, fetched } = proxyWith(answering("<p>The sign-in did not finish</p>", 400));
  const q = "state=s4&error=access_denied&error_uri=https%3A%2F%2Fexample%2Fe";
  const out = await call(routes, `${CALLBACK}?${q}`, NAVIGATION);
  assert.equal(out.status, 400, "the Account's own answer");
  assert.deepEqual(fetched, [`${URL_}/api/account/signin/callback?${q}`], "both names reach the stub Account");
  assert.equal(CALLBACK_QUERY.size, 6);
});

test("the callback: a fetch, a form, an Origin, a rebound Host are 403; a bad query 400; nothing is fetched", async () => {
  const { routes, fetched } = proxyWith(answering("<p>ok</p>"));
  const q = `${CALLBACK}?state=s1&code=c1`;
  for (const [headers, method, why] of [
    [{ ...NAVIGATION, "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }, "GET", "a fetch()"],
    [{ ...NAVIGATION, "sec-fetch-dest": "empty" }, "GET", "not a document"],
    [{ ...NAVIGATION, "sec-fetch-dest": "iframe" }, "GET", "a frame"],
    [{ ...NAVIGATION, origin: "https://evil.example" }, "GET", "an Origin"],
    [{ ...NAVIGATION, host: "evil.example:3090" }, "GET", "a rebound Host"],
    [{ host: "127.0.0.1:3090" }, "GET", "no Fetch Metadata"],
    [NAVIGATION, "POST", "a form's POST"],
  ] as const) {
    const out = await call(routes, q, { ...headers }, method);
    assert.equal(out.status, 403, why); assert.equal(out.body, FORBIDDEN, why);
  }
  for (const bad of ["?foo=1", "?state=a&state=b", `?state=s&code=${"c".repeat(2_001)}`, `?state=${"s".repeat(241)}`,
    `?error_description=${"d".repeat(1_001)}`, `?iss=${"i".repeat(501)}`, `?error=${"e".repeat(241)}`, `?error_uri=${"u".repeat(501)}`, "?fresh=1"]) {
    const out = await call(routes, `${CALLBACK}${bad}`, NAVIGATION);
    assert.equal(out.status, 400, bad.slice(0, 40)); assert.equal(out.body, INVALID);
  }
  assert.equal(fetched.length, 0, "nothing reaches the Account");
  assert.equal((await call(routes, `${CALLBACK}?state=s&code=${"c".repeat(2_000)}`, NAVIGATION)).status, 200, "2 000 characters pass");
  assert.equal((await call(routes, `${CALLBACK}?state=s&error_uri=${"u".repeat(500)}`, NAVIGATION)).status, 200, "an error_uri of 500 characters passes");
});

test("the callback: an Account that does not answer, and a disabled row, are 503 with the fixed page", async () => {
  const fixed = "The Account did not answer. Go back to Gravit and start the sign-in again.";
  const html = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
  const refused = proxyWith(async () => { throw Object.assign(new TypeError("fetch failed: secret text"), { cause: { code: "ECONNREFUSED" } }); });
  const a = await call(refused.routes, `${CALLBACK}?state=s1`, NAVIGATION);
  assert.equal(a.status, 503); assert.equal(a.body, fixed); assert.deepEqual(a.headers, html);
  /* A good answer first, then a failure: never re-served stale. */
  let fail = false;
  const flaky = proxyWith(async () => { if (fail) throw new TypeError("x"); return ok("<p>signed in</p>"); });
  await call(flaky.routes, `${CALLBACK}?state=s1`, NAVIGATION);
  fail = true;
  const b = await call(flaky.routes, `${CALLBACK}?state=s1`, NAVIGATION);
  assert.equal(b.status, 503); assert.equal(b.body, fixed, "never stale");
  const disabled = proxyWith(answering("<p>ok</p>"), () => NOW, { disabled: true });
  const c = await call(disabled.routes, `${CALLBACK}?state=s1`, NAVIGATION);
  assert.equal(c.status, 503); assert.equal(c.body, fixed); assert.deepEqual(c.headers, html);
  assert.equal(disabled.fetched.length, 0);
});

test("the callback's abort is thirty seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hanging = proxyWith((_url, init) => new Promise<FakeAnswer>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(aborted()))));
  const one = start(hanging.routes, `${CALLBACK}?state=s1`, NAVIGATION);
  for (let i = 0; i < 50 && hanging.inits.length === 0; i += 1) await new Promise<void>((r) => setImmediate(r));
  assert.equal(hanging.inits.length, 1, "the callback asked the Account");
  t.mock.timers.tick(29_999);
  assert.equal(hanging.inits[0].signal.aborted, false, "waits 29 999 ms");
  t.mock.timers.tick(1);
  assert.equal(hanging.inits[0].signal.aborted, true, "cut at 30 s");
  await one.done;
  assert.equal(one.out.status, 503); assert.equal(one.out.body, "The Account did not answer. Go back to Gravit and start the sign-in again.");
});

test("funding is read with no venue, as the Account's own page reads it: every venue that lists it", async () => {
  const { routes, fetched } = proxyWith(answering(OK_BODY), () => NOW);
  const a = await call(routes, "/data/account/funding?limit=100");
  assert.equal(a.status, 200); assert.equal(a.body, OK_BODY);
  assert.equal(fetched[0], `${URL_}/api/account/funding?limit=100`);
  const bare = await call(routes, "/data/account/funding");
  assert.equal(bare.status, 200);
  assert.equal(fetched[1], `${URL_}/api/account/funding`);
});

test("the connected reads go to /api/account/connected/*", async () => {
  /* the connected reads keep the names, TTLs and aborts the account's public reads had (now the market's own, src/market-proxy.ts) */
  assert.deepEqual([ACCOUNT_QUERY.connectedExplore, ACCOUNT_QUERY.connectedQuotes, ACCOUNT_QUERY.connectedCandles, ACCOUNT_QUERY.connectedBook, ACCOUNT_QUERY.connectedTrades], [
    ["tab", "q", "key", "sort", "limit"], ["pairs"], ["venue", "symbol", "interval", "range", "before", "limit"], ["venue", "symbol", "depth"], ["venue", "symbol", "limit"],
  ]);
  for (const [face, account, own, query] of CONNECTED) {
    let clock = NOW;
    const { routes, fetched } = proxyWith(answering(OK_BODY), () => clock);
    const unknown = await call(routes, `${face}?${query}&force=1`);
    assert.equal(unknown.status, 400, `${face}: an unknown name`); assert.equal(unknown.body, INVALID);
    assert.equal(fetched.length, 0, `${face}: nothing fetched for an unknown name`);
    const a = await call(routes, `${face}?${query}`);
    assert.equal(a.status, 200, face); assert.equal(a.body, OK_BODY);
    assert.equal(fetched[0], `${URL_}${account}?${query}`, `${face}: the account's connected path, the query rebuilt in order`);
    await call(routes, `${face}?${query}`);
    assert.equal(fetched.length, 1, `${face}: a second read inside the TTL fetches once`);
    clock += ACCOUNT_TTL_MS[own];
    await call(routes, `${face}?${query}`);
    assert.equal(fetched.length, 2, `${face}: the TTL expires`);
  }
  const pairs = Array.from({ length: 12 }, (_, i) => `paper-1|${"X".repeat(150)}${i}`).join(",");
  const { routes, fetched } = proxyWith(answering(OK_BODY));
  const long = await call(routes, `/data/account/connected/quotes?pairs=${encodeURIComponent(pairs)}`);
  assert.equal(long.status, 200, "pairs keeps its own 2 000 on the connected quotes too");
  assert.equal(fetched.length, 1);
  const disabled = proxyWith(answering(OK_BODY), () => NOW, { disabled: true });
  for (const [face, , , query] of CONNECTED) {
    const d = await call(disabled.routes, `${face}?${query}`);
    assert.equal(d.status, 503, face); assert.equal(d.body, DISABLED);
  }
  assert.equal(disabled.fetched.length, 0, "a disabled seat row asks nothing");
});
