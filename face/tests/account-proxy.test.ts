/** `/data/account` and `/data/account/<route>` (spec 2026-10-22 §5.1): the
 * Account's reads through the face — the whitelist, the fence, the bodies
 * passed through, the per-route caches and their flights, the failure codes,
 * the disabled row, and the shared `account` reader `seat.ts` reads — and its
 * push channel: `stream` piped per browser connection, `stream/markets`
 * forwarded. */
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
  STREAM_BODY_LIMIT,
  STREAM_CLIENT,
  createAccountReader,
  rebuildQuery,
  registerAccountProxy,
  type AccountProxyDeps,
  type AccountReader,
} from "../src/account-proxy.ts";

const URL_ = "http://127.0.0.1:4820";
const NOW = 1_760_000_000_000;
const FORBIDDEN = '{"ok":false,"error":"forbidden"}';
const INVALID = '{"ok":false,"error":"invalid account request"}';
const DISABLED = '{"ok":false,"unreachable":"disabled"}';
const OK_BODY = '{"ok":true}';
const JSON_TYPE = "application/json; charset=utf-8";

/** The eleven face paths, in the order they are registered, and the Account path each one asks. */
const ROUTES: ReadonlyArray<readonly [face: string, account: string]> = [
  ["/data/account", "/api/account"],
  ["/data/account/explore", "/api/account/explore"],
  ["/data/account/market", "/api/account/market"],
  ["/data/account/quotes", "/api/account/quotes"],
  ["/data/account/compare", "/api/account/compare"],
  ["/data/account/candles", "/api/account/candles"],
  ["/data/account/holdings", "/api/account/holdings"],
  ["/data/account/positions", "/api/account/positions"],
  ["/data/account/statement", "/api/account/statement"],
  ["/data/account/history", "/api/account/history"],
  ["/data/account/agents", "/api/account/agents"],
];
const STREAM = "/data/account/stream";
const FOLLOW = "/data/account/stream/markets";
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
function proxyWith(doFetch: FakeFetch, now: () => number = () => NOW, more: AccountProxyDeps & { reader?: AccountReader } = {}) {
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
  assert.deepEqual(rebuildQuery("explore", "/data/account/explore?tab=crypto&q=btc&limit=60"), { query: "tab=crypto&q=btc&limit=60", fresh: false });
  assert.deepEqual(rebuildQuery("holdings", "/data/account/holdings?cost=1&fresh=1"), { query: "cost=1", fresh: true });
  assert.equal(rebuildQuery("explore", "/data/account/explore?tab=a&tab=b"), null, "a repeated name");
  assert.equal(rebuildQuery("explore", "/data/account/explore?force=1"), null, "an unknown name");
  assert.equal(rebuildQuery("explore", `/data/account/explore?q=${"x".repeat(241)}`), null, "an over-long value");
  assert.deepEqual(rebuildQuery("account", "/data/account"), { query: "", fresh: false });
});

test("the routes: thirteen exact paths; the fence refuses a foreign Origin and a missing Host before any fetch", async () => {
  const { routes, fetched } = proxyWith(answering(OK_BODY));
  const paths = [...ROUTES.map(([face]) => face), STREAM, FOLLOW];
  assert.deepEqual(routes.map((r) => `${r.kind} ${r.path}`), paths.map((face) => `exact ${face}`));
  for (const face of paths) {
    const foreign = await call(routes, face, { host: "127.0.0.1:3090", origin: "https://evil.example" });
    assert.equal(foreign.status, 403, face); assert.equal(foreign.body, FORBIDDEN);
    assert.equal(foreign.headers["content-type"], JSON_TYPE);
    const noHost = await call(routes, face, {});
    assert.equal(noHost.status, 403, face); assert.equal(noHost.body, FORBIDDEN);
    assert.equal((await call(routes, face, { host: "evil.example:3090" })).status, 403, "a rebound Host");
    assert.equal((await call(routes, face, { host: "127.0.0.1:3090", "sec-fetch-site": "cross-site" })).status, 403, "a cross-site page");
  }
  const refusedFirst = await call(routes, "/data/account/explore?force=1", { host: "127.0.0.1:3090", origin: "https://evil.example" });
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
  await call(flaky.routes, "/data/account/explore?tab=crypto");
  clock += ACCOUNT_TTL_MS.explore + 1;
  answer = ok(refusal, 409);
  const b = await call(flaky.routes, "/data/account/explore?tab=crypto");
  assert.equal(b.status, 409); assert.equal(b.body, refusal, "the Account's words, not the kept rows");
  assert.equal(b.headers["content-type"], JSON_TYPE); assert.equal(b.headers["cache-control"], "no-store");
  await call(flaky.routes, "/data/account/explore?tab=crypto");
  assert.equal(flaky.fetched.length, 3, "a refusal is never kept: the next read asks again");
});

test("a repeated or unknown name, an over-long value: 400 invalid account request, nothing forwarded", async () => {
  const { routes, fetched } = proxyWith(answering(OK_BODY));
  const wide = "%E4%B8%80".repeat(240);
  assert.notEqual(rebuildQuery("explore", `/data/account/explore?q=${wide}`), null, "240 characters, nine bytes each on the wire, is one fair value");
  const refused = [
    "/data/account/explore?tab=a&tab=b",
    "/data/account/explore?force=1",
    `/data/account/explore?q=${"x".repeat(241)}`,
    "/data/account/explore?fresh=1",
    "/data/account?fresh=1&fresh=1",
    "/data/account?venue=paper-1",
    "/data/account/quotes?pairs=okx|BTC/USDT&pair=broker|NVDA",
    "/data/account/holdings?cost=1&paper=1&cost=1",
    "/data/account/positions?venue[x]=okx",
    `/data/account/explore?tab=${wide}&q=${wide}&key=${wide}&limit=${wide}`,
  ];
  for (const url of refused) {
    const a = await call(routes, url);
    assert.equal(a.status, 400, url.slice(0, 80)); assert.equal(a.body, INVALID);
    assert.equal(a.headers["content-type"], JSON_TYPE);
  }
  assert.equal(fetched.length, 0, "a refused query never reaches the Account");
  assert.deepEqual(ACCOUNT_QUERY, {
    account: ["fresh"],
    explore: ["tab", "q", "key", "limit"],
    market: ["venue", "symbol"],
    quotes: ["pairs"],
    compare: ["base", "side", "usd", "asset"],
    candles: ["venue", "symbol", "interval", "range", "before", "limit"],
    holdings: ["cost", "paper", "fresh"],
    positions: ["venue"],
    statement: ["fresh"],
    history: ["range", "paper", "venue"],
    agents: ["fresh"],
  });
  assert.equal((await call(routes, `/data/account/explore?q=${"x".repeat(240)}`)).status, 200, "240 characters pass");
  assert.deepEqual(fetched, [`${URL_}/api/account/explore?q=${"x".repeat(240)}`]);
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
  await call(routes, "/data/account/explore?q=btc%26force%3D1&tab=crypto");
  assert.equal(fetched[1], `${URL_}/api/account/explore?q=btc%26force%3D1&tab=crypto`, "an & inside a value stays inside it; the order is the browser's");
  await call(routes, "/data/account/quotes?pairs=okx|BTC/USDT,broker|NVDA");
  assert.equal(fetched[2], `${URL_}/api/account/quotes?pairs=okx%7CBTC%2FUSDT%2Cbroker%7CNVDA`, "re-encoded, the same value");
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
    account: 15_000, explore: 20_000, market: 3_000, quotes: 3_000, compare: 15_000, candles: 30_000,
    holdings: 8_000, positions: 10_000, statement: 10_000, history: 60_000, agents: 15_000,
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
  const a = start(gated.routes, "/data/account/explore?tab=crypto");
  const b = start(gated.routes, "/data/account/explore?tab=crypto");
  const c = start(gated.routes, "/data/account/explore?tab=stocks");
  await tick();
  assert.deepEqual(gated.fetched, [`${URL_}/api/account/explore?tab=crypto`, `${URL_}/api/account/explore?tab=stocks`]);
  gates[0](ok('{"ok":true,"tab":"crypto"}'));
  gates[1](ok('{"ok":true,"tab":"stocks"}'));
  await Promise.all([a.done, b.done, c.done]);
  assert.equal(a.out.body, '{"ok":true,"tab":"crypto"}'); assert.equal(b.out.body, a.out.body);
  assert.equal(c.out.body, '{"ok":true,"tab":"stocks"}');

  assert.equal(ACCOUNT_CACHE_KEYS, 64);
  const { routes, fetched } = proxyWith(answering(OK_BODY));
  for (let i = 1; i <= ACCOUNT_CACHE_KEYS; i += 1) await call(routes, `/data/account/explore?q=k${i}`);
  assert.equal(fetched.length, 64);
  await call(routes, "/data/account/explore?q=k1");
  assert.equal(fetched.length, 64, "k1 is kept, and is now the most recently used");
  await call(routes, "/data/account/explore?q=k65");
  assert.equal(fetched.length, 65);
  await call(routes, "/data/account/explore?q=k1");
  assert.equal(fetched.length, 65, "k1 outlived the 65th key");
  await call(routes, "/data/account/explore?q=k2");
  assert.equal(fetched.length, 66, "k2, the least recently used, was evicted");
  await call(routes, "/data/account/market?venue=okx&symbol=BTC");
  await call(routes, "/data/account/explore?q=k65");
  assert.equal(fetched.length, 67, "another route's keys are its own");
});

test("an unreachable, hanging, refusing or unreadable Account: 503 with the code and never the text; a cached read is re-served stale:true", async () => {
  assert.deepEqual(ACCOUNT_ABORT_MS, {
    account: 7_000, explore: 10_000, market: 7_000, quotes: 7_000, compare: 7_000, candles: 25_000,
    holdings: 12_000, positions: 7_000, statement: 7_000, history: 12_000, agents: 7_000,
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
  const hanging = proxyWith((_url, init) => new Promise<FakeAnswer>((_resolve, reject) => abort(init.signal, reject)), () => NOW, { abortMs: { candles: 20 } });
  const h = await call(hanging.routes, "/data/account/candles?venue=broker&symbol=NVDA&range=1D");
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
  assert.equal((await call(routes, "/data/account/explore", undefined, "DELETE")).status, 405);
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

  const routes: WebRoute[] = [];
  const proxy = registerAccountProxy({ register: (route) => routes.push(route) }, { ...deps, reader });
  assert.equal(proxy.reader, reader, "the reader handed in is the one handed back");
  assert.equal((await call(routes, "/data/account")).body, '{"ok":true,"n":3}');
  assert.equal(fetched.length, 3, "/data/account is served from the reader's cache");
  assert.equal((await call(routes, "/data/account?fresh=1")).body, '{"ok":true,"n":4}');
  assert.deepEqual(await reader.read(), { status: 200, body: '{"ok":true,"n":4}' }, "the route's fresh answer is the reader's too");
  assert.equal(fetched.length, 4);

  const own = proxyWith(answering(OK_BODY));
  await call(own.routes, "/data/account");
  assert.deepEqual(await own.proxy.reader.read(), { status: 200, body: OK_BODY });
  assert.equal(own.fetched.length, 1, "the proxy's own reader and /data/account share one read");

  const foreign: AccountReader = { read: async (fresh) => ({ status: 200, body: JSON.stringify({ ok: true, fresh: fresh === true }) }) };
  const through = proxyWith(answering(OK_BODY), () => NOW, { reader: foreign });
  assert.equal((await call(through.routes, "/data/account?fresh=1")).body, '{"ok":true,"fresh":true}', "a reader made elsewhere is read through");
  assert.equal(through.fetched.length, 0);
  const failing: AccountReader = { read: async () => { throw Object.assign(new Error("private words"), { code: "ECONNRESET" }); } };
  const broken = await call(proxyWith(answering(OK_BODY), () => NOW, { reader: failing }).routes, "/data/account");
  assert.equal(broken.status, 503); assert.equal(broken.body, '{"ok":false,"unreachable":"ECONNRESET"}', "its rejection is a code, never its text");
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

test("Last-Event-ID becomes since when the query has none; a since in the query wins", async () => {
  const { routes, fetched, inits } = proxyWith(streaming([encode("retry: 1000\n\n")]));
  const resuming = (id: string): Record<string, string> => ({ host: "127.0.0.1:3090", "last-event-id": id });
  await call(routes, `${STREAM}?client=${CLIENT}`, resuming("1a2b3c4d.42"));
  assert.equal(fetched[0], `${URL_}/api/account/stream?client=${CLIENT}&since=1a2b3c4d.42`);
  assert.deepEqual(inits[0].headers, { accept: "text/event-stream" }, "the id travels as since, never as a header");
  await call(routes, `${STREAM}?since=1a2b3c4d.40&client=${CLIENT}`, resuming("1a2b3c4d.42"));
  assert.equal(fetched[1], `${URL_}/api/account/stream?since=1a2b3c4d.40&client=${CLIENT}`, "the query's since wins");
  await call(routes, `${STREAM}?client=${CLIENT}`);
  assert.equal(fetched[2], `${URL_}/api/account/stream?client=${CLIENT}`, "neither: no since");
  await call(routes, `${STREAM}?client=${CLIENT}`, resuming("x&client=someone-else-1"));
  assert.equal(fetched[3], `${URL_}/api/account/stream?client=${CLIENT}&since=x%26client%3Dsomeone-else-1`, "the header is one value: it names no parameter of its own");
  const long = await call(routes, `${STREAM}?client=${CLIENT}`, resuming("1".repeat(241)));
  assert.equal(long.status, 400, "an id longer than a since may be is refused as that since is"); assert.equal(long.body, INVALID);
  assert.equal(fetched.length, 4);
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
  await call(routes, `${FOLLOW}?client=${CLIENT}&force=1`, JSON_POST, "POST", body);
  assert.equal(fetched.at(-1), `${URL_}/api/account/stream/markets`, "a query on the POST never reaches the Account");
  assert.equal(fetched.length, 4);

  for (const method of ["GET", "PUT", "DELETE"]) {
    const m = await call(routes, FOLLOW, JSON_POST, method);
    assert.equal(m.status, 405, method); assert.equal(m.body, '{"ok":false,"error":"method not allowed"}');
  }
  assert.equal((await call(routes, FOLLOW, { ...JSON_POST, origin: "https://evil.example" }, "POST", body)).status, 403, "the fence comes first");
  assert.equal(fetched.length, 4);

  const refused = proxyWith(async () => { throw Object.assign(new TypeError("fetch failed secret-host-name"), { cause: { code: "ECONNREFUSED" } }); });
  const u = await call(refused.routes, FOLLOW, JSON_POST, "POST", body);
  assert.equal(u.status, 503); assert.equal(u.body, '{"ok":false,"unreachable":"ECONNREFUSED"}');
  assert.doesNotMatch(u.body, /secret/);
});
