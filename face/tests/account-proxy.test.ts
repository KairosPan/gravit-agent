/** `/data/account` and `/data/account/<route>` (spec 2026-10-22 §5.1): the
 * Account's reads through the face — the whitelist, the fence, the bodies
 * passed through, the per-route caches and their flights, the failure codes,
 * the disabled row, and the shared `account` reader `seat.ts` reads. */
import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";
import { seatUrl } from "../src/account-seat.ts";
import {
  ACCOUNT_ABORT_MS,
  ACCOUNT_CACHE_KEYS,
  ACCOUNT_QUERY,
  ACCOUNT_TTL_MS,
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

function fakeRes(): { out: { status: number; body: string; headers: Record<string, string> }; res: ServerResponse } {
  const out = { status: 0, body: "", headers: {} as Record<string, string> };
  const res = {
    writeHead(status: number, headers?: Record<string, string>) { out.status = status; Object.assign(out.headers, headers ?? {}); return res; },
    end(body?: string | Buffer) { out.body = String(body ?? ""); return res; },
  };
  return { out, res: res as unknown as ServerResponse };
}

const req = (url: string, headers: Record<string, string> = { host: "127.0.0.1:3090" }, method = "GET"): IncomingMessage =>
  ({ url, headers, method } as unknown as IncomingMessage);

type FakeAnswer = { ok: boolean; status: number; text(): Promise<string> };
type FakeInit = { signal: AbortSignal; redirect: string; headers?: unknown; method?: string };
type FakeFetch = (url: string, init: FakeInit) => Promise<FakeAnswer>;

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
function start(routes: WebRoute[], url: string, headers?: Record<string, string>, method?: string) {
  const path = url.split("?", 1)[0];
  const route = routes.find((r) => r.path === path);
  assert.ok(route !== undefined, `no route at ${path}`);
  const { out, res } = fakeRes();
  return { out, done: Promise.resolve(route.handler(req(url, headers, method), res)) };
}

async function call(routes: WebRoute[], url: string, headers?: Record<string, string>, method?: string) {
  const one = start(routes, url, headers, method);
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

test("the routes: eleven exact paths; the fence refuses a foreign Origin and a missing Host before any fetch", async () => {
  const { routes, fetched } = proxyWith(answering(OK_BODY));
  assert.deepEqual(routes.map((r) => `${r.kind} ${r.path}`), ROUTES.map(([face]) => `exact ${face}`));
  for (const [face] of ROUTES) {
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
  assert.deepEqual(await proxy.reader.read(), { unreachable: "disabled" });
  assert.deepEqual(await proxy.reader.read(true), { unreachable: "disabled" });
  let asked = 0;
  const counting: FakeFetch = async () => { asked += 1; return ok(OK_BODY); };
  assert.deepEqual(await createAccountReader({ url: URL_, fetch: counting as unknown as typeof fetch, disabled: true }).read(), { unreachable: "disabled" });
  assert.equal(fetched.length, 0); assert.equal(asked, 0);
});

test("POST on a GET route is 405", async () => {
  const { routes, fetched } = proxyWith(answering(OK_BODY));
  for (const [face] of ROUTES) {
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
