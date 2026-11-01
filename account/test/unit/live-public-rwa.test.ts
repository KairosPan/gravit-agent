import { describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { RWA_CATEGORY } from "../../src/portfolio/live/categories.ts";
import { ISSUER_TERMS, knownIssued } from "../../src/portfolio/live/dex.ts";
import { PUBLIC_HOSTS, publicSources, type Listing } from "../../src/portfolio/live/public-markets.ts";
import { ondoStocksPublic, XSTOCKS_SHOWN, xstocksPublic } from "../../src/portfolio/live/public-rwa.ts";
import { json, network } from "./live-public-markets-fixtures.ts";

/** TOKENISED SHARES WITHOUT A KEY (live/public-rwa.ts): xStocks at Gate's spot tickers with xStocks' own trading state, Ondo Stocks as LI.FI
 * prices them — through a stand-in network answering the shapes each answered on 2026-10-13. Nothing leaves the process. */
const NOW = Date.parse("2026-10-13T14:05:00Z");
const gate = (pair: string, last: number, extra: Record<string, unknown> = {}) => json([{ currency_pair: pair, last: String(last), lowest_ask: String(last + 0.15), lowest_size: "0.059", highest_bid: String(last - 0.1), highest_size: "0.059", change_percentage: "1.33", base_volume: "188.333", quote_volume: "64934.94613", high_24h: String(last + 2), low_24h: String(last - 7), ...extra }]);
const xstock = (symbol: string, name: string, underlying: string, trading: Record<string, unknown> = {}, halted = false) =>
  json({ id: "9e43a778", name, symbol, isin: "CH1436219187", underlyingSymbol: underlying, isTradingHalted: halted, trading: { currency: "USD", tradingHoursMode: "TwentyFourFive", isTradingHalted: halted, currentPeriod: "market", openNow: true, nextChangeAt: "2026-10-13T20:00:00.000Z", ...trading } });
const INVALID = { status: 400, body: { label: "INVALID_CURRENCY", message: "Invalid currency NOPEX" }, text: '{"label":"INVALID_CURRENCY","message":"Invalid currency NOPEX"}' };

describe("xStocks at Gate, keyless", () => {
  it("lists the best-known first, each at Gate's own last, bid, ask, change and quote volume, named as the library names Gate's pair, with xStocks' own word on whether it trades now and the issuer's words; a Gate pair that is not an xStock is never one", async () => {
    const net = network([
      ["currency_pair=NVDAX_USDT", gate("NVDAX_USDT", 226.55)],
      ["currency_pair=AAPLX_USDT", gate("AAPLX_USDT", 347.38)],
      ["currency_pair=TRX_USDT", gate("TRX_USDT", 0.31)],
      ["/public/assets/NVDAx", xstock("NVDAx", "NVIDIA xStock", "NVDA", { openNow: false, currentPeriod: "closed", nextChangeAt: "2026-10-14T13:30:00.000Z" })],
      ["/public/assets/AAPLx", xstock("AAPLx", "Apple xStock", "AAPL")],
      ["/public/assets/TRx", { status: 404, body: undefined, text: "Not Found" }],
    ]);
    const src = xstocksPublic({ http: net.http, clock: () => NOW });
    const got = (await src.listings({ limit: 2 })) as Listing[];
    expect(XSTOCKS_SHOWN.slice(0, 2)).toEqual(["NVDA", "AAPL"]);
    expect(got[1]).toEqual({
      symbol: "AAPLX/USDT",
      name: "Apple xStock",
      kind: "token",
      base: "AAPLX",
      quote: "USDT",
      price: 347.38,
      bid: 347.28,
      ask: 347.53,
      open: true,
      types: [],
      session: { open: true, closesAt: "2026-10-13T20:00:00.000Z" },
      changePct24h: 1.33,
      volumeUsd24h: 64934.94613,
      category: RWA_CATEGORY,
      issuer: ISSUER_TERMS.xstocks.issuer,
      eligibility: ISSUER_TERMS.xstocks.terms,
    });
    expect(got[1]!.eligibility).toContain("not intended for distribution in the United States");
    // out of its hours by xStocks' own word: not open, and said so, Gate's price still shown
    expect(got[0]).toMatchObject({ symbol: "NVDAX/USDT", open: false, price: 226.55, session: { open: false, opensAt: "2026-10-14T13:30:00.000Z" } });
    expect(got[0]!.note).toBe("xStocks: out of its trading hours now (closed), open again at 2026-10-14T13:30:00.000Z");
    // Gate and xStocks asked once each per token
    expect(net.sent.map((s) => new URL(s.url).host + new URL(s.url).pathname).sort()).toEqual(["api.gateio.ws/api/v4/spot/tickers", "api.gateio.ws/api/v4/spot/tickers", "api.xstocks.fi/api/v2/public/assets/AAPLx", "api.xstocks.fi/api/v2/public/assets/NVDAx"]);
    expect(src).toMatchObject({ id: "xstocks", kind: "tokens", connectTo: "gate", connector: "live:exchange:gate" });
    expect(src.readOnly).toBeUndefined();
    // a ticker typed whole: Gate's TRX_USDT exists, xStocks issues no TRx, so it is not an xStock
    expect(await src.listings({ q: "TR", limit: 5 })).toEqual([]);
    expect(src.notes!({})).toEqual([`xStocks at Gate: 2 of the best-known, at Gate's own spot prices · search for the rest by ticker.`]);
    expect(src.notes!({ q: "x" })[0]!.length).toBeLessThan(160);
  });

  it("a search by the share's ticker, the suffix in any spelling; a pair Gate does not list is not at Gate; a halted token is closed in xStocks' words; Gate refusing this network is its answer, held back", async () => {
    const net = network([
      ["currency_pair=COINX_USDT", gate("COINX_USDT", 300)],
      ["currency_pair=HOODX_USDT", INVALID],
      ["/public/assets/COINx", xstock("COINx", "Coinbase xStock", "COIN", {}, true)],
      ["/public/assets/HOODx", xstock("HOODx", "Robinhood xStock", "HOOD")],
    ]);
    const src = xstocksPublic({ http: net.http, clock: () => NOW });
    for (const q of ["coin", "COINx", "coinx/usdt", "COINX_USDT"]) {
      const got = (await src.listings({ q, limit: 5 })) as Listing[];
      expect(got.map((m) => m.symbol)).toEqual(["COINX/USDT"]);
      expect(got[0]).toMatchObject({ open: false, note: "xStocks has halted trading in it" });
    }
    expect(await src.listings({ q: "HOOD", limit: 5 })).toEqual([]);
    const blocked = network([["currency_pair=", { status: 403, body: undefined, text: "<html><title>Attention Required! | Cloudflare</title></html>" }], ["/public/assets/", xstock("NVDAx", "NVIDIA xStock", "NVDA")]]);
    const held = xstocksPublic({ http: blocked.http, clock: () => NOW });
    const r = (await held.listings({ limit: 1 })) as Refusal;
    expect(r.code).toBe("E_VENUE_GEOBLOCKED");
    expect(r.message).toContain("Gate refuses this network");
    await held.listings({ limit: 1 });
    expect(blocked.sent.filter((s) => s.url.includes("gateio"))).toHaveLength(1);
    expect(PUBLIC_HOSTS).toEqual(expect.arrayContaining(["api.gateio.ws", "api.xstocks.fi", "li.quest"]));
    expect(publicSources().map((s) => s.id)).toEqual(expect.arrayContaining(["xstocks", "ondo-stocks"]));
  });
});

describe("Ondo Stocks as LI.FI prices them, keyless, read-only", () => {
  const ondo = knownIssued().filter((k) => k.issuer === "ondo");
  const aapl = ondo.find((k) => k.symbol === "AAPLon" && k.chain === "Ethereum")!;
  const nvdaBnb = ondo.find((k) => k.symbol === "NVDAon" && k.chain === "BNB Chain")!;
  const token = (k: { address: string; symbol: string }, price: number, volume?: number) => json({ address: k.address, chainId: 1, symbol: k.symbol, decimals: 18, name: `${k.symbol} (Ondo Tokenized)`, coinKey: k.symbol, priceUSD: String(price), marketCapUSD: 9033009, ...(volume !== undefined ? { volumeUSD24H: volume } : {}), tags: ["rwa"], verificationStatus: "verified" });

  it("lists Ondo's best-known tokens with LI.FI's price of each — the Ethereum token first, BNB Chain's where that gives none — named as the wallet's rows name them, with Ondo's own words; nothing is traded through the listing", async () => {
    const net = network([
      [`token=${aapl.address}`, token(aapl, 346.049, 1252161)],
      [`chain=1&token=`, { status: 404, body: { message: "Token not found" }, text: '{"message":"Token not found"}' }],
      [`token=${nvdaBnb.address}`, token(nvdaBnb, 190.2)],
    ]);
    const src = ondoStocksPublic({ http: net.http, clock: () => NOW });
    const got = (await src.listings({ q: "a", limit: 10 })) as Listing[];
    expect(got.map((m) => m.symbol)).toEqual(["NVDAon/USDC@BNB Chain", "AAPLon/USDC@Ethereum"]);
    expect(got[1]).toEqual({ symbol: "AAPLon/USDC@Ethereum", name: "Apple (Ondo Stock)", kind: "token", base: "AAPLon", quote: "USDC", price: 346.049, open: true, types: [], volumeUsd24h: 1252161, category: RWA_CATEGORY, issuer: "Ondo Global Markets", eligibility: ISSUER_TERMS.ondo.terms });
    expect(got[0]!.volumeUsd24h).toBeUndefined();
    expect(src).toMatchObject({ id: "ondo-stocks", name: "Ondo Global Markets", kind: "tokens", connectTo: "wallet", connector: "live:wallet" });
    expect(src.readOnly).toContain("trades from a connected wallet");
    expect(net.sent.every((s) => new URL(s.url).host === "li.quest")).toBe(true);
    // a price is kept a minute
    const asked = net.sent.length;
    await src.listings({ q: "a", limit: 10 });
    expect(net.sent).toHaveLength(asked);
    expect(src.notes!({})[0]!.length).toBeLessThan(160);
  });

  it("LI.FI rate-limiting this machine is its answer for the listing, and the asking stops at it", async () => {
    const busy = network([["/v1/token", { status: 429, body: undefined, text: "Too Many Requests", retryAfterMs: 30_000 }]]);
    const src = ondoStocksPublic({ http: busy.http, clock: () => NOW });
    const r = (await src.listings({ limit: 10 })) as Refusal;
    expect(r.code).toBe("E_VENUE_UNREACHABLE");
    expect(r.message).toContain("rate-limiting");
    // one request, not one per token
    expect(busy.sent).toHaveLength(1);
    expect(isRefusal(await src.listings({ limit: 10 }))).toBe(true);
    expect(busy.sent).toHaveLength(1);
  });
});
