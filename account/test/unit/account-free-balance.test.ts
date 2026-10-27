import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, describe, expect, it } from "vitest";
import { isRefusal } from "../../src/core/errors.ts";
import type { Outcome } from "../../src/portfolio/account/exchange.ts";
import { signOwner, simKey, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { liveAccount } from "../../src/portfolio/adapters/live.ts";
import { exchangeSource, type ExchangeClient, type OpenExchange } from "../../src/portfolio/live/exchange.ts";
import { hyperliquidTradeSource, type HyperliquidClient } from "../../src/portfolio/live/hyperliquid-trade.ts";
import type { LiveDeps } from "../../src/portfolio/live/index.ts";
import type { Locator } from "../../src/portfolio/live/location.ts";
import { freePart, type Http, type LiveBalance, type LiveSource } from "../../src/portfolio/live/types.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

/** What of a line is free to spend now (LiveBalance and Holding `freeUsd`, `freeAmount`): an exchange's `free` beside its `total`,
 * Hyperliquid's withdrawable beside its perps account value and its spot `hold` — carried from the source, through the adapter, to each
 * venue's holdings on the page (GET /api/account), where the trade ticket's "Available to trade" reads it. What the line is worth, the
 * venue's total and its cash are not changed by it. Stand-ins for the exchange library and the network: nothing here leaves the process,
 * and no key in this file is anyone's. */
type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const START = Date.parse("2026-10-14T14:00:00.000Z");
const ADDRESS = "0x00000000000000000000000000000000000000a1";
const owner = simKey("owner");
const KEY = { apiKey: "made-up-key-0041", secret: "made-up-secret-0041" };
const homes: string[] = [];
afterAll(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })));

const json = (body: unknown, status = 200) => ({ status, body, text: JSON.stringify(body) });

/** an exchange that answers its balance as the library shapes one: `total` and `free` per asset; its funding wallet says no `free` */
function fakeExchange(id: string, spot: Record<string, unknown>): ExchangeClient {
  return {
    id,
    name: id === "binance" ? "Binance" : id,
    requiredCredentials: { apiKey: true, secret: true },
    markets: { "BTC/USDT": {}, "ETH/USDT": {} },
    async loadMarkets() {},
    async fetchTime() {
      return 1;
    },
    async fetchBalance(params: Record<string, unknown> = {}) {
      return params.type === "funding" ? { total: { USDT: 50 } } : spot;
    },
    async fetchTickers() {
      return { "BTC/USDT": { last: 60_000 }, "ETH/USDT": { last: 2_000 } };
    },
    async sapiGetAccountApiRestrictions() {
      return { ipRestrict: true, enableReading: true, enableWithdrawals: false, enableSpotAndMarginTrading: false, permitsUniversalTransfer: false, enableInternalTransfer: false, enableFutures: false };
    },
  } as ExchangeClient;
}

async function boot(over: { open?: OpenExchange; http?: Http } = {}) {
  let n = 0;
  const home = mkdtempSync(join(tmpdir(), "account-free-"));
  homes.push(home);
  const liveDeps: Partial<LiveDeps> = { ...(over.open ? { openExchange: over.open } : {}), clock: () => 1_000_000, http: over.http ?? (async () => ({ status: 599, body: undefined, text: "no network in tests" })), price: async () => undefined };
  const svc = await PortfolioService.create({ home, now: () => new Date(START).toISOString(), venues: "frontline", liveDeps, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date(START).toISOString() }] } });
  const own = async (a: NoNonce<OwnerAction>) => svc.exchange(await signOwner(owner, { ...a, nonce: START + ++n } as OwnerAction));
  const keyFile = (ref: string) => {
    const path = join(home, ref);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(KEY));
    chmodSync(path, 0o600);
  };
  const connect = async (venue: string, connector: string, credentialRef = "") => {
    const r: Outcome = await own({ type: "connectVenue", venue, connector, label: "", credentialRef });
    if (isRefusal(r)) throw new Error(`${r.code}: ${r.message}`);
  };
  /** a venue's row as GET /api/account serves it: the service's account view */
  const venue = async (id: string) => (await svc.accountView())!.venues.find((v) => v.id === id)!;
  return { svc, keyFile, connect, venue };
}

describe("an exchange's free balance (the library's `free` beside its `total`)", () => {
  it("each line carries what the exchange says is free of it, where that is less than all of it; a field it leaves out is no word, never none", async () => {
    const client = fakeExchange("binance", { info: {}, total: { BTC: 1, USDT: "100", ETH: 2 }, free: { BTC: 0.6, USDT: "40", ETH: 2 } });
    const r = await exchangeSource({ venue: "binance", exchangeId: "binance", label: "", reference: "credentials/binance/api-key.json", key: KEY, open: async () => client });
    if (isRefusal(r)) throw new Error(r.message);
    expect(r.first).toEqual<LiveBalance[]>([
      { asset: "BTC", amount: 1, where: "spot", freeAmount: 0.6, usd: 60_000 },
      { asset: "USDT", amount: 100, where: "spot", freeAmount: 40 },
      { asset: "ETH", amount: 2, where: "spot", usd: 4_000 },
      // the funding wallet's answer has no `free`: all of it is free, as before
      { asset: "USDT", amount: 50, where: "funding" },
    ]);
  });

  it("reaches the venue's holdings on the page: the units as the exchange said them, the dollars in the same share — and its worth and cash unchanged", async () => {
    const x = await boot({ open: async (id) => (id === "binance" ? fakeExchange("binance", { info: {}, total: { BTC: 1, USDT: 100 }, free: { BTC: 0.6, USDT: 40 } }) : undefined) });
    x.keyFile("credentials/binance/api-key.json");
    await x.connect("binance", "live:exchange:binance");
    const v = await x.venue("binance");
    expect(v.holdings.map((h) => [h.asset, h.note, h.amount, h.usd, h.freeAmount, h.freeUsd])).toEqual([
      ["BTC", "spot", 1, 60_000, 0.6, 36_000],
      ["USDT", "spot", 100, 100, 40, 40],
      ["USDT", "funding", 50, 50, undefined, undefined],
    ]);
    // what is held is what it is worth, free or not: the venue's total and its cash count all of it
    expect([v.usd, v.cashUsd]).toEqual([60_150, 150]);
  });
});

describe("Hyperliquid by address: the perps account value with its withdrawable, the spot balances with their hold", () => {
  /** `said`: the perps answer's withdrawable as Hyperliquid sends it, or `{}` for an answer without one */
  const answers = (abstraction: string, said: { withdrawable?: unknown } = { withdrawable: "1200.5" }) =>
    (async (_url, init = {}) => {
      const body = JSON.parse(init.body ?? "{}") as { type: string };
      if (body.type === "clearinghouseState") return json({ marginSummary: { accountValue: "1500.5", totalMarginUsed: "300.0" }, ...said, assetPositions: [] });
      if (body.type === "userAbstraction") return json(abstraction);
      return json({ balances: [{ coin: "USDC", token: 0, total: "500.0", hold: "120.0" }, { coin: "HYPE", token: 150, total: "2.5", hold: "0.0" }] });
    }) as Http;

  it("the perps line's free dollars are its withdrawable, and a spot balance's free units are its total less its hold — on the page's holdings", async () => {
    const x = await boot({ http: answers("default") });
    await x.connect("hyperliquid", "live:hyperliquid", ADDRESS);
    const v = await x.venue("hyperliquid");
    const usdc = v.holdings.filter((h) => h.asset === "USDC").map((h) => [h.note, h.usd, h.freeUsd, h.freeAmount]);
    expect(usdc).toEqual([
      ["perps · 1200.50 withdrawable", 1500.5, 1200.5, undefined],
      ["spot", 500, 380, 380],
    ]);
    // nothing of HYPE is held
    expect(v.holdings.find((h) => h.asset === "HYPE")).not.toHaveProperty("freeAmount");
    expect(v.cashUsd).toBe(2000.5);
  });

  it("a perps answer with no withdrawable is no word about what of it is free: all of it is, never none, and its note names none; one it gives is that much", async () => {
    const perps = async (said: { withdrawable?: unknown }) => {
      const x = await boot({ http: answers("default", said) });
      await x.connect("hyperliquid", "live:hyperliquid", ADDRESS);
      return (await x.venue("hyperliquid")).holdings.find((h) => h.asset === "USDC" && h.note?.startsWith("perps"))!;
    };
    // no "0.00 withdrawable" in the note beside a line all free: a number Hyperliquid never gave
    const none = await perps({});
    expect([none.note, none.usd, none.freeUsd, none.freeAmount]).toEqual(["perps", 1500.5, undefined, undefined]);
    // a field there but no number is no word either, read as freePart reads it
    const blank = await perps({ withdrawable: "" });
    expect([blank.note, blank.freeUsd]).toEqual(["perps", undefined]);
    const some = await perps({ withdrawable: 400 });
    expect([some.note, some.usd, some.freeUsd, some.freeAmount]).toEqual(["perps · 400.00 withdrawable", 1500.5, 400, undefined]);
    // a nought it says is a word: none of it free, and the note says so
    const nought = await perps({ withdrawable: "0.0" });
    expect([nought.note, nought.freeUsd]).toEqual(["perps · 0.00 withdrawable", 0]);
  });

  it("a unified account: no perps line, and the USDC the perps margin holds is not free", async () => {
    const x = await boot({ http: answers("unifiedAccount") });
    await x.connect("hyperliquid", "live:hyperliquid", ADDRESS);
    const v = await x.venue("hyperliquid");
    expect(v.holdings.filter((h) => h.asset === "USDC").map((h) => [h.usd, h.freeUsd, h.freeAmount])).toEqual([[500, 380, 380]]);
  });
});

describe("Hyperliquid through an API wallet: the perps account's and each HIP-3 DEX's withdrawable, in the note only where Hyperliquid gave one", () => {
  const PK = generatePrivateKey();
  const AGENT = privateKeyToAccount(PK).address;
  /** a place Hyperliquid serves: its line is location.ts's, and tested with it */
  const served: Locator = { verdict: async () => "served", place: async () => undefined };
  /** the library's client, its info reads answered here as it hands them back (a bare JSON string as its text, quotes and all): the API
   * wallet approved, an ordinary account, its main perps account and the xyz HIP-3 DEX's with `main` and `xyz` (each one's withdrawable as
   * Hyperliquid sends it, or `{}` for an answer without one), no spot balances; nothing traded */
  const client = (main: { withdrawable?: unknown }, xyz: { withdrawable?: unknown }): HyperliquidClient => {
    const answers: Record<string, (body: Record<string, unknown>) => unknown> = {
      extraAgents: () => [{ name: "agent", address: AGENT.toLowerCase(), validUntil: START + 90 * 86_400_000 }],
      userAbstraction: () => '"default"',
      clearinghouseState: (body) => (body.dex === "xyz" ? { marginSummary: { accountValue: "250.0" }, ...xyz, assetPositions: [] } : { marginSummary: { accountValue: "1500.5" }, ...main, assetPositions: [] }),
      spotClearinghouseState: () => ({ balances: [] }),
      perpDexs: () => [null, { name: "xyz", fullName: "XYZ" }],
      perpCategories: () => [],
    };
    const refuse = async (): Promise<never> => {
      throw new Error("nothing is traded in this test");
    };
    return {
      id: "hyperliquid",
      options: {},
      markets: {
        "BTC/USDC:USDC": { symbol: "BTC/USDC:USDC", swap: true, baseName: "BTC", baseId: 0, quote: "USDC", settle: "USDC", info: { name: "BTC", szDecimals: 5 } },
        "XYZ-NVDA/USDC:USDC": { symbol: "XYZ-NVDA/USDC:USDC", swap: true, baseName: "xyz:NVDA", baseId: 110002, quote: "USDC", settle: "USDC", info: { name: "xyz:NVDA", dex: "xyz", szDecimals: 3 } },
      },
      loadMarkets: async () => undefined,
      publicPostInfo: async (body) => {
        const a = answers[String(body.type)];
        if (!a) throw new Error(`not set up in this test: ${String(body.type)}`);
        return a(body);
      },
      createOrder: refuse,
      cancelOrder: refuse,
      setLeverage: refuse,
      amountToPrecision: (_symbol, amount) => String(amount),
      priceToPrecision: (_symbol, price) => String(price),
    };
  };
  const perpsLines = async (main: { withdrawable?: unknown }, xyz: { withdrawable?: unknown }) => {
    const r = await hyperliquidTradeSource({ venue: "hyperliquid-trade", label: "", reference: "credentials/hyperliquid-trade/api-key.json", key: { walletAddress: ADDRESS, privateKey: PK }, where: served, clock: () => START, open: async () => client(main, xyz) });
    if (isRefusal(r)) throw new Error(`${r.code}: ${r.message}`);
    return r.first.filter((l) => l.where?.startsWith("perps")).map((l) => [l.where, l.usd, l.freeUsd]);
  };

  it("a withdrawable given is in the note and is the line's free dollars; one left out is neither: no 0.00 it never said, and all of it free", async () => {
    expect(await perpsLines({ withdrawable: "1200.5" }, { withdrawable: "200.0" })).toEqual([
      ["perps · 1200.50 withdrawable", 1500.5, 1200.5],
      ["perps · XYZ (HIP-3) · 200.00 withdrawable", 250, 200],
    ]);
    expect(await perpsLines({}, {})).toEqual([
      ["perps", 1500.5, undefined],
      ["perps · XYZ (HIP-3)", 250, undefined],
    ]);
    // a field there but no number is no word either, read as freePart reads it; a nought said is a word
    expect(await perpsLines({ withdrawable: null }, { withdrawable: "0.0" })).toEqual([
      ["perps", 1500.5, undefined],
      ["perps · XYZ (HIP-3) · 0.00 withdrawable", 250, 0],
    ]);
  });
});

describe("the adapter keeps a free part within its line", () => {
  const source = (rows: LiveBalance[]): LiveSource => ({ name: "Stand-in", kind: "cex", reference: "standin", via: "a stand-in", probe: { can: ["read"], note: "" }, read: async () => rows });

  it("never more than the line, never below none; the dollars follow the units where only the units were said; none said, none set", async () => {
    const rows: LiveBalance[] = [
      // a paper account's margin line: none of it free
      { asset: "USD", amount: 5000, usd: 5000, class: "cash", freeUsd: 0 },
      { asset: "USDC", amount: 100, usd: 100, freeUsd: 150 },
      { asset: "BTC", amount: 1, usd: 60_000, freeAmount: 0.25 },
      { asset: "ETH", amount: 2, usd: 4_000, freeAmount: 5 },
      { asset: "SOL", amount: 10, usd: 1_000, freeAmount: -3 },
      { asset: "DOGE", amount: 100, usd: 20 },
    ];
    const a = await liveAccount("standin", source(rows), { connector: "live:standin", first: rows });
    const got = new Map((await a.read()).map((h) => [h.asset, [h.freeUsd, h.freeAmount]]));
    expect(Object.fromEntries(got)).toEqual({ USD: [0, undefined], USDC: [100, undefined], BTC: [15_000, 0.25], ETH: [4_000, 2], SOL: [0, 0], DOGE: [undefined, undefined] });
  });

  it("freePart: set only where the venue said less than the whole, in the unit it said it in", () => {
    expect(freePart("0.6", 1, "amount")).toEqual({ freeAmount: 0.6 });
    expect(freePart(400, 1000, "usd")).toEqual({ freeUsd: 400 });
    expect(freePart(1, 1, "amount")).toEqual({});
    expect(freePart(undefined, 1, "amount")).toEqual({});
    expect(freePart(null, 1, "usd")).toEqual({});
    expect(freePart("", 1, "usd")).toEqual({});
    expect(freePart(-2, 1, "usd")).toEqual({ freeUsd: 0 });
  });
});

describe("a paper account's adapter after a wake: a read begun before the write never becomes the kept book", () => {
  it("an older read that finishes after a newer one hands its callers what it read, keeps the newer book and its time, and the next read asks again — a failed one serves the newer book", async () => {
    const OLD: LiveBalance[] = [{ asset: "USD", amount: 10_000, usd: 10_000, class: "cash" }];
    const NEW: LiveBalance[] = [{ asset: "USD", amount: 9_400, usd: 9_400, class: "cash" }, { asset: "BTC", amount: 0.01, usd: 600 }];
    const answers: Array<{ go: (rows: LiveBalance[]) => void; fail: (err: Error) => void }> = [];
    let t = 1_000_000;
    const source: LiveSource = {
      name: "Paper",
      kind: "cex",
      reference: "paper",
      via: "the account's own book",
      probe: { can: ["read", "trade"], note: "" },
      paper: true,
      read: () => new Promise<LiveBalance[]>((go, fail) => answers.push({ go, fail })),
    };
    const a = await liveAccount("pap", source, { connector: "live:paper", first: OLD, clock: () => t });
    // an order is placed: the book is woken, and a read starts (it will answer with the book from before the fill)
    a.wake!();
    t += 10;
    const before = a.read();
    // the fill lands while that read is on its way: woken again, and a read begun after it answers first, with the book after the fill
    a.wake!();
    t += 10;
    const after = a.read();
    expect(answers).toHaveLength(2);
    answers[1]!.go(NEW);
    expect((await after).map((h) => h.asset)).toEqual(["USD", "BTC"]);
    const asOf = a.account.asOf;
    expect(asOf).toBe(new Date(t).toISOString());
    // the older read answers last: its caller gets what it read, but the kept book stays the newer one, and so does its time
    t += 10;
    answers[0]!.go(OLD);
    expect((await before).map((h) => [h.asset, h.amount])).toEqual([["USD", 10_000]]);
    expect(a.account.asOf).toBe(asOf);
    // the next read asks the book again (the stale answer forced it), and when that read fails what is served is the newer book
    t += 10;
    const next = a.read();
    expect(answers).toHaveLength(3);
    answers[2]!.fail(new Error("the book did not answer"));
    expect((await next).map((h) => [h.asset, h.amount])).toEqual([["USD", 9_400], ["BTC", 0.01]]);
  });
});
