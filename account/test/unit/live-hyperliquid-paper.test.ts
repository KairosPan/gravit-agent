import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, recoverTypedDataAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { HL_FAUCET, HL_TESTNET_API, HYPERLIQUID_PAPER_KEY, hyperliquidTradeSource, openHyperliquid, type HyperliquidClient, type OpenHyperliquid } from "../../src/portfolio/live/hyperliquid-trade.ts";
import { CONNECTORS, KEY_SHAPES, keyFileStatus, liveOptions, openLive, type LiveDeps } from "../../src/portfolio/live/index.ts";
import { locator } from "../../src/portfolio/live/location.ts";
import { reachOf, type ReachDeps } from "../../src/portfolio/live/reach.ts";
import type { LiveTrader, OrderRequest } from "../../src/portfolio/live/trade.ts";
import type { Http, HttpReply, LiveBalance, LiveSource } from "../../src/portfolio/live/types.ts";

/** PAPER TRADING at Hyperliquid: the same connection to its TESTNET (live:hyperliquid-paper). The client is the real installed library's,
 * switched to the testnet by its own sandbox mode and disarmed by the connector's opener, with its network call replaced: every request it
 * builds is recorded. The testnet's answers are in the shape of mainnet's (live-hyperliquid-trade.test.ts: read 2026-10-08, trimmed here
 * to two perpetuals and one spot pair); the exchange endpoint's answer is the one Hyperliquid's docs show. Nothing leaves the process,
 * and the API wallet's key is generated here and thrown away. What this proves: every call goes to api.hyperliquid-testnet.xyz, an action
 * is signed as the testnet takes it (the phantom agent's source "b"), and the source says it is paper — a balance that is not money. */
const NOW = 1791484300000; // 2026-10-08T18:31:40Z
const DAY = 86_400_000;
const CLIENT = "0123456789abcdef0123456789abcdef";
const ACCOUNT = "0x0000000000000000000000000000000000a11ce5";
const PK = generatePrivateKey();
const AGENT = privateKeyToAccount(PK).address;
const KEY = { walletAddress: ACCOUNT, privateKey: PK };
const GEO = "https://polymarket.com/api/geoblock";
const MAINNET_API = "https://api.hyperliquid.xyz";

type Dict = Record<string, unknown>;

const SPOT_TOKENS = [
  { name: "USDC", szDecimals: 8, weiDecimals: 8, index: 0, tokenId: "0x6d1e7cde53ba9467b783cb7c530ce054", isCanonical: true, fullName: null },
  { name: "PURR", szDecimals: 0, weiDecimals: 5, index: 1, tokenId: "0xc1fb593aeffbeb02f85e0308e9956a90", isCanonical: true, fullName: null },
];
const SPOT_PAIRS = [{ tokens: [1, 0], name: "PURR/USDC", index: 0, isCanonical: true }];
const SPOT_CTX = [{ prevDayPx: "0.12323", dayNtlVlm: "2473138.05", markPx: "0.11257", midPx: "0.112555", coin: "PURR/USDC", dayBaseVlm: "20663936.0" }];
const MAIN = [
  { universe: [{ szDecimals: 5, name: "BTC", maxLeverage: 40, marginTableId: 56 }, { szDecimals: 4, name: "ETH", maxLeverage: 25, marginTableId: 55 }] },
  [
    { funding: "0.0000125", openInterest: "39982.9", prevDayPx: "83341.0", dayNtlVlm: "3341631875.36", premium: "0.0002", oraclePx: "81016.9", markPx: "80992.0", midPx: "81035.5", impactPxs: ["81035.0", "81036.0"], dayBaseVlm: "40698.28" },
    { funding: "0.00001", openInterest: "1141235.5", prevDayPx: "2558.5", dayNtlVlm: "1797658280.14", premium: "-0.00005", oraclePx: "2426.1", markPx: "2425.1", midPx: "2425.75", impactPxs: ["2425.7", "2425.98"], dayBaseVlm: "720638.95" },
  ],
];
/** a testnet account: 1,000 mock USDC from the faucet, nothing held */
const CH = { marginSummary: { accountValue: "1000.0", totalNtlPos: "0.0", totalRawUsd: "1000.0", totalMarginUsed: "0.0" }, crossMarginSummary: { accountValue: "1000.0", totalNtlPos: "0.0", totalRawUsd: "1000.0", totalMarginUsed: "0.0" }, crossMaintenanceMarginUsed: "0.0", withdrawable: "1000.0", assetPositions: [], time: NOW };
const SPOT_CH = { balances: [{ coin: "USDC", token: 0, total: "0.0", hold: "0.0", entryNtl: "0.0" }] };
const BOOK_BTC = { coin: "BTC", time: NOW, levels: [[{ px: "81359.0", sz: "3.1", n: 16 }], [{ px: "81360.0", sz: "9.8", n: 33 }]] };
const RESTING = { status: "ok", response: { type: "order", data: { statuses: [{ resting: { oid: 77738308 } }] } } };
const INFO: Record<string, unknown> = {
  spotMeta: { tokens: SPOT_TOKENS, universe: SPOT_PAIRS },
  spotMetaAndAssetCtxs: [{ universe: SPOT_PAIRS, tokens: SPOT_TOKENS }, SPOT_CTX],
  metaAndAssetCtxs: (b: Dict) => (b.dex ? [{ universe: [], collateralToken: 0 }, []] : MAIN),
  perpDexs: [null],
  perpCategories: [],
  extraAgents: [{ name: "paper-agent", address: AGENT.toLowerCase(), validUntil: NOW + 90 * DAY }],
  userRole: (b: Dict) => (String(b.user).toLowerCase() === AGENT.toLowerCase() ? { role: "agent", data: { user: ACCOUNT } } : { role: "user" }),
  userAbstraction: "default",
  clearinghouseState: CH,
  spotClearinghouseState: SPOT_CH,
  allMids: { BTC: "81359.5", ETH: "2425.7" },
  l2Book: (b: Dict) => (b.coin === "BTC" ? BOOK_BTC : undefined),
  orderStatus: { status: "unknownOid" },
  userFillsByTime: [],
};

interface Net {
  seen: Array<{ to: "geo" | "info" | "exchange"; url: string; body: Dict }>;
  exchange: unknown[];
}
interface Lib extends HyperliquidClient {
  nonce: () => number;
  fetch: (url: string, method?: string, headers?: Record<string, string>, body?: string) => Promise<unknown>;
  handleErrors(code: number, reason: string, url: string, method: string, headers: Dict, body: string, response: unknown, requestHeaders: unknown, requestBody: unknown): unknown;
  handleHttpStatusCode(code: number, reason: string, url: string, method: string, body: string): unknown;
}
/** the library's client with its network call replaced, the URL it built kept with each request */
function wire(c: Lib, net: Net): Lib {
  c.enableRateLimit = false;
  c.nonce = () => NOW;
  c.fetch = async (url, method = "GET", headers = {}, body = undefined) => {
    const parsed = body ? (JSON.parse(body) as Dict) : {};
    const to = url.endsWith("/exchange") ? "exchange" : "info";
    net.seen.push({ to, url, body: parsed });
    let a = to === "info" ? INFO[String(parsed.type)] : net.exchange.shift();
    if (typeof a === "function") a = (a as (b: Dict) => unknown)(parsed);
    if (a === undefined) throw new Error(`not set up in this test: ${to} ${body}`);
    const text = JSON.stringify(a);
    const reply = a !== null && typeof a === "object" ? a : undefined;
    if (c.handleErrors(200, "", url, method, {}, text, reply, headers, body) === undefined) c.handleHttpStatusCode(200, "", url, method, text);
    return reply ?? text;
  };
  return c;
}
const opener = (net: Net): OpenHyperliquid => async (key) => wire((await openHyperliquid(key)) as Lib, net);
const geo = (country: string, region: string): HttpReply => {
  const body = { blocked: false, ip: "203.0.113.7", country, region };
  return { status: 200, body, text: JSON.stringify(body) };
};
const geoHttp = (net: Net, where: HttpReply = geo("IE", "L")): Http => async (url) => {
  if (url !== GEO) throw new Error(`not set up in this test: ${url}`);
  net.seen.push({ to: "geo", url, body: {} });
  return where;
};
const network = (): Net => ({ seen: [], exchange: [] });

async function paper(net: Net, label = "", where?: HttpReply): Promise<{ t: LiveTrader; source: LiveSource; first: LiveBalance[] }> {
  const clock = () => NOW;
  const opened = await hyperliquidTradeSource({ venue: "hyperliquid-paper", label, reference: "credentials/hyperliquid-paper/api-key.json", key: KEY, where: locator({ http: geoHttp(net, where), clock }), clock, open: opener(net), net: "testnet" });
  if (isRefusal(opened)) throw new Error(`${opened.code}: ${opened.message}`);
  return { t: opened.source.trader!, source: opened.source, first: opened.first };
}
const ok = <T>(x: T | Refusal): T => {
  if (isRefusal(x)) throw new Error(`expected an answer, got ${x.code}: ${x.message}`);
  return x;
};
const order = (o: Partial<OrderRequest> = {}): OrderRequest => ({ symbol: "BTC/USDC:USDC", side: "buy", type: "limit", qty: 0.001, limitPrice: 80000, clientId: CLIENT, ...o });

/** msgpack, as Hyperliquid's own SDK packs an action: maps in their keys' order, the smallest form of each integer, str for strings */
function msgpack(v: unknown): number[] {
  const be = (x: number | bigint, bytes: number): number[] => {
    let n = BigInt(x);
    const out: number[] = [];
    for (let i = 0; i < bytes; i++) {
      out.unshift(Number(n & 0xffn));
      n >>= 8n;
    }
    return out;
  };
  if (v === null || v === undefined) return [0xc0];
  if (v === true) return [0xc3];
  if (v === false) return [0xc2];
  if (typeof v === "number") {
    if (!Number.isInteger(v) || v < 0) throw new Error(`no such number in an action: ${v}`);
    return v < 0x80 ? [v] : v < 0x100 ? [0xcc, v] : v < 0x10000 ? [0xcd, ...be(v, 2)] : v < 0x100000000 ? [0xce, ...be(v, 4)] : [0xcf, ...be(v, 8)];
  }
  if (typeof v === "string") {
    const b = [...new TextEncoder().encode(v)];
    return [...(b.length < 32 ? [0xa0 | b.length] : b.length < 0x100 ? [0xd9, b.length] : [0xda, ...be(b.length, 2)]), ...b];
  }
  if (Array.isArray(v)) return [...(v.length < 16 ? [0x90 | v.length] : [0xdc, ...be(v.length, 2)]), ...v.flatMap(msgpack)];
  const entries = Object.entries(v as Dict);
  return [...(entries.length < 16 ? [0x80 | entries.length] : [0xde, ...be(entries.length, 2)]), ...entries.flatMap(([k, x]) => [...msgpack(k), ...msgpack(x)])];
}
/** who signed a posted action, read as a given net takes it: msgpack(action) ‖ nonce ‖ 0x00, keccak-256, the connectionId of the phantom
 * agent {source} — "a" on mainnet, "b" on the testnet — in the domain Exchange · 1 · 1337 · the zero address */
async function signerOf(p: { action: Dict; nonce: number; signature: { r: string; s: string; v: number } }, source: "a" | "b"): Promise<string> {
  const n = BigInt(p.nonce);
  const nonce = Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(8 * (7 - i))) & 0xffn));
  const connectionId = keccak256(new Uint8Array([...msgpack(p.action), ...nonce, 0x00]));
  const signature = `0x${p.signature.r.replace(/^0x/, "").padStart(64, "0")}${p.signature.s.replace(/^0x/, "").padStart(64, "0")}${p.signature.v.toString(16)}` as Hex;
  return recoverTypedDataAddress({ domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000000" }, types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] }, primaryType: "Agent", message: { source, connectionId }, signature });
}

describe("Hyperliquid's testnet, through the library's sandbox mode", () => {
  it("the opener's testnet client sends everything to api.hyperliquid-testnet.xyz; the mainnet client is untouched", async () => {
    const t = await openHyperliquid({ ...KEY, testnet: true });
    expect((t.urls as Dict).api).toMatchObject({ public: HL_TESTNET_API, private: HL_TESTNET_API });
    expect(t.options.sandboxMode).toBe(true);
    // the mainnet client keeps the library's own host template (api.{hostname}, filled in with hyperliquid.xyz at each call), and no sandbox
    const m = await openHyperliquid(KEY);
    expect(String(((m.urls as Dict).api as Dict).public)).toMatch(/^https:\/\/api\.(\{hostname\}|hyperliquid\.xyz)$/);
    expect(String(((m.urls as Dict).api as Dict).public)).not.toContain("testnet");
    expect(m.options.sandboxMode).not.toBe(true);
    // disarmed, both: nothing done unasked
    for (const c of [t, m]) expect([c.options.builderFee, c.options.approvedBuilderFee, c.options.refSet]).toEqual([false, false, true]);
  });

  it("connected as a paper account: every question goes to the testnet, the source says paper, its name says so, and its mock USDC is read", async () => {
    const net = network();
    const { source, first } = await paper(net);
    expect(source.paper).toBe(true);
    expect(source.name).toBe("Hyperliquid · paper");
    expect(source.via).toContain("TESTNET");
    expect(source.probe.native).toMatchObject({ net: "testnet", agent: AGENT });
    expect(String((source.probe.native as Dict).account).toLowerCase()).toBe(ACCOUNT);
    expect(source.probe.note).toContain("PAPER");
    expect(source.readOnlyBecause).toContain(HL_FAUCET);
    expect(first).toEqual([{ asset: "USDC", amount: 1000, usd: 1000, where: "perps · 1000.00 withdrawable", class: "stable" }]);
    const asked = net.seen.filter((s) => s.to === "info");
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((s) => s.url.startsWith(HL_TESTNET_API))).toBe(true);
    expect(net.seen.some((s) => s.url.startsWith(MAINNET_API))).toBe(false);
    // the location was asked first, as for the real account: the same line (its terms cover the testnet app too)
    expect(net.seen[0]!.to).toBe("geo");
    // a label that says paper already is kept as it is
    expect((await paper(network(), "My paper HL")).source.name).toBe("My paper HL");
    expect(JSON.stringify(source)).not.toContain(PK.slice(2));
  });

  it("held to Hyperliquid's own line where the user is, before anything about the account is asked — a paper account is not a way around it", async () => {
    const net = network();
    const clock = () => NOW;
    const r = await hyperliquidTradeSource({ venue: "hyperliquid-paper", label: "", reference: "", key: KEY, where: locator({ http: geoHttp(net, geo("US", "NY")), clock }), clock, open: opener(net), net: "testnet" });
    expect(isRefusal(r) && r.code).toBe("E_VENUE_GEOBLOCKED");
    expect(net.seen.map((s) => s.to)).toEqual(["geo"]);
  });

  it("an order is signed as the testnet takes it: the phantom agent's source is “b” (not mainnet's “a”), posted to the testnet's exchange endpoint, and the market says it is paper", async () => {
    const net = network();
    const { t } = await paper(net);
    const list = ok(await t.markets(""));
    expect(list.map((m) => m.symbol)).toEqual(["BTC/USDC:USDC", "ETH/USDC:USDC", "PURR/USDC"]);
    expect(list[0]!.note).toContain("a PAPER market on Hyperliquid's testnet");
    net.exchange = [RESTING];
    net.seen.length = 0;
    const placed = ok(await t.place(order()));
    expect(placed).toMatchObject({ ref: "77738308", status: "open" });
    const posted = net.seen.filter((s) => s.to === "exchange");
    expect(posted).toHaveLength(1);
    expect(posted[0]!.url).toBe(`${HL_TESTNET_API}/exchange`);
    const p = posted[0]!.body as { action: Dict; nonce: number; signature: { r: string; s: string; v: number } };
    expect(p.action).toMatchObject({ type: "order", orders: [{ a: 0, b: true, p: "80000", s: "0.001", r: false, t: { limit: { tif: "Gtc" } }, c: `0x${CLIENT}` }], grouping: "na" });
    expect(await signerOf(p, "b")).toBe(AGENT);
    expect(await signerOf(p, "a")).not.toBe(AGENT);
  });
});

describe("the account's own table", () => {
  const home = mkdtempSync(join(tmpdir(), "hl-paper-"));
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it("live:hyperliquid-paper is a connection of its own: its key file under credentials/hyperliquid-paper, the testnet's API page named, a trader that is paper", async () => {
    expect(CONNECTORS.map((c) => c.kind)).toContain("hyperliquid-paper");
    expect(KEY_SHAPES["hyperliquid-paper"]).toBe(HYPERLIQUID_PAPER_KEY);
    expect(HYPERLIQUID_PAPER_KEY.example).toContain("app.hyperliquid-testnet.xyz");
    expect(liveOptions(home).options.find((o) => o.kind === "hyperliquid-paper")).toMatchObject({ connector: "live:hyperliquid-paper", needs: "key-file", venues: [] });
    expect(keyFileStatus(home, "hyperliquid-paper", "hyperliquid-paper", "")).toMatchObject({ ready: false, path: join(home, "credentials/hyperliquid-paper/api-key.json"), fields: ["walletAddress", "privateKey"] });
    mkdirSync(join(home, "credentials/hyperliquid-paper"), { recursive: true });
    const file = join(home, "credentials/hyperliquid-paper/api-key.json");
    writeFileSync(file, JSON.stringify(KEY));
    chmodSync(file, 0o600);
    const net = network();
    const deps = { home, http: geoHttp(net), clock: () => NOW, openHyperliquid: opener(net), proofs: {}, price: async () => undefined, mm: async () => ({}) } as unknown as LiveDeps;
    const opened = await openLive({ venue: "hyperliquid-paper", connector: "live:hyperliquid-paper", label: "", reference: "" }, deps);
    if (isRefusal(opened)) throw new Error(opened.message);
    expect(opened.source.paper).toBe(true);
    expect(opened.source.reference).toBe("credentials/hyperliquid-paper/api-key.json");
    expect(opened.summary).toContain("the venue says this credential can trade");
    expect(net.seen.filter((s) => s.to === "info").every((s) => s.url.startsWith(HL_TESTNET_API))).toBe(true);
    // the account's own key is refused, with the testnet's page named
    const own = await hyperliquidTradeSource({ venue: "hyperliquid-paper", label: "", reference: "", key: { walletAddress: AGENT, privateKey: PK }, where: locator({ http: geoHttp(net), clock: () => NOW }), clock: () => NOW, open: opener(net), net: "testnet" });
    expect(isRefusal(own) && own.code).toBe("E_ACCOUNT_CREDENTIAL");
    expect(isRefusal(own) && own.message).toContain("app.hyperliquid-testnet.xyz/API");
  });

  it("its first, keyless question goes to the testnet (reach): answered and served, ok; the same place rule as the real account's", async () => {
    const asked: string[] = [];
    const http = (where: HttpReply): Http => async (url) => {
      asked.push(url);
      if (url === GEO) return where;
      if (url === `${HL_TESTNET_API}/info`) return { status: 200, body: { universe: [] }, text: '{"universe":[]}' };
      return { status: 404, body: undefined, text: "not here" };
    };
    const deps = (where: HttpReply): ReachDeps => ({ http: http(where), clock: () => NOW, open: (async () => undefined) as never, mm: (async () => ({ authenticated: true })) as never });
    expect(await reachOf("live:hyperliquid-paper", deps(geo("IE", "L")))).toEqual({ connector: "live:hyperliquid-paper", state: "ok", at: new Date(NOW).toISOString() });
    expect(asked).toContain(`${HL_TESTNET_API}/info`);
    expect(asked.some((u) => u.startsWith(MAINNET_API))).toBe(false);
    const us = await reachOf("live:hyperliquid-paper", deps(geo("US", "NY")));
    expect(us.state).toBe("location");
    expect(us.said).toContain("Terms of Use (§1.6)");
    expect(JSON.stringify(us)).not.toMatch(/"US"|"NY"|203\.0\.113\.7/);
  });
});
