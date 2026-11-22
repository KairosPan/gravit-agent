import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import type { CnHttp, CnReply } from "../../src/live/cn-http.ts";
import { localHosts, LOCAL_HOSTS } from "../../src/live/local-http.ts";
import { CRYPTO_CHAIN_MS, cryptoOptions, SUMMARY_CAP } from "../../src/live/options-crypto.ts";
import { atmStrike, parseDeribitName } from "../../src/live/options.ts";

const text = (n: string): string => readFileSync(fileURLToPath(new URL(`../fixtures/options/${n}.json`, import.meta.url)), "utf8");
const fx = (n: string): any => JSON.parse(text(n));
const reply = (b: string, status = 200): CnReply => ({ status, bytes: new TextEncoder().encode(b) });
const answered = <T,>(v: T | Refusal): T => { if (isRefusal(v)) throw new Error(`refused: ${v.message}`); return v; };
const refusedWith = (v: unknown): string => { if (!isRefusal(v)) throw new Error("answered"); return v.message; };

type Route = [string, CnReply | ((url: string) => CnReply)];
function net(routes: Route[]) {
  const sent: string[] = [];
  const http: CnHttp = async (url) => {
    sent.push(url);
    const hit = routes.find(([k]) => url.includes(k));
    if (!hit) return { status: 404, bytes: new Uint8Array() };
    return typeof hit[1] === "function" ? hit[1](url) : hit[1];
  };
  return { http, sent };
}
const ROUTES: Route[] = [
  ["currency=BTC&kind=option", reply(text("deribit-btc"))],
  ["currency=ETH&kind=option", reply(text("deribit-eth"))],
  ["currency=USDC&kind=option", reply(text("deribit-usdc"))],
  ["public/underlying?instType=OPTION", reply(text("okx-underlying"))],
  ["market/tickers?instType=OPTION&instFamily=BTC-USD", reply(text("okx-btc"))],
  ["opt-summary?instFamily=BTC-USD", reply(text("okx-opt-summary"))],
  ["open-interest?instType=OPTION&instFamily=BTC-USD", reply(text("okx-open-interest"))],
  ["index-tickers?instId=BTC-USD", reply(text("okx-index"))],
];
/** the fixtures' morning: 2026-11-22 03:00 UTC (the 22NOV26 expiry settles in 5 hours, so the default is 23NOV26) */
const NOW = Date.parse("2026-11-22T03:00:00Z");
function source(routes: Route[] = ROUTES, start = NOW) {
  let t = start;
  const n = net(routes);
  const src = cryptoOptions({ http: n.http, clock: () => t });
  return { src, sent: n.sent, at: (ms: number) => { t = ms; }, later: (ms: number) => { t += ms; } };
}
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe("the hosts", () => {
  it("the shared local guard covers Deribit, OKX and Nasdaq", () => {
    for (const h of ["www.deribit.com", "www.okx.com", "api.nasdaq.com"]) expect(LOCAL_HOSTS).toContain(h);
  });
});

describe("summaries", () => {
  it("lists BTC and ETH with Deribit's figures alone and both venues", async () => {
    const { src } = source();
    const r = answered(await src.summaries());
    expect(r.stale).toBeUndefined();
    const btc = r.items.find((i) => i.underlying === "BTC")!;
    const rows = fx("deribit-btc").result as any[];
    expect(btc.asset).toBe("crypto");
    expect(btc.venues).toEqual(["deribit", "okx"]);
    expect(btc.quoteFrom).toBe("Deribit");
    expect(btc.price).toBe(59510.55);
    expect(btc.volumeUsd).toBeCloseTo(sum(rows.map((x) => x.volume_usd)), 2);
    expect(btc.volume).toBeCloseTo(sum(rows.map((x) => x.volume)), 4);
    expect(btc.openInterest).toBeCloseTo(sum(rows.map((x) => x.open_interest)), 4);
    expect(btc.nearestExpiry).toBe("2026-11-23");
    const exp = rows.filter((x) => parseDeribitName(x.instrument_name)!.expiry === "2026-11-23");
    const k = atmStrike(exp.map((x) => parseDeribitName(x.instrument_name)!.strike), exp[0].underlying_price)!;
    const call = exp.find((x) => x.instrument_name === `BTC-23NOV26-${k}-C`);
    expect(btc.atmIv).toBe(call.mark_iv);
    const eth = r.items.find((i) => i.underlying === "ETH")!;
    expect(eth.venues).toEqual(["deribit", "okx"]);
    expect(eth.price).toBe((fx("deribit-eth").result as any[])[0].estimated_delivery_price);
    expect(r.items[0]!.underlying).toBe("BTC"); // the busiest first
  });

  it("lists Deribit's linear underlyings (SOL, XRP) from the USDC book with Deribit's figures; never OKX's tickers for an underlying Deribit lists", async () => {
    const { src, sent } = source();
    const r = answered(await src.summaries());
    const sol = r.items.find((i) => i.underlying === "SOL")!;
    expect(sol.venues).toEqual(["deribit", "okx"]);
    expect(sol.quoteFrom).toBe("Deribit");
    expect(sol.price).toBe(69.3658);
    expect(r.items.find((i) => i.underlying === "XRP")!.venues).toEqual(["deribit"]);
    for (const c of ["BTC", "ETH", "SOL"]) expect(sent.some((u) => u.includes(`market/tickers?instType=OPTION&instFamily=${c}-USD`))).toBe(false);
    // HYPE is not in the trimmed USDC fixture, so it is OKX-only here: its tickers are asked (404 in this net: left out)
    expect(sent.some((u) => u.includes("instFamily=HYPE-USD"))).toBe(true);
    expect(r.items.map((i) => i.underlying).sort()).toEqual(["BTC", "ETH", "SOL", "XRP"]);
  });

  it("OKX's gold family (XAU-USD) is not crypto: never listed, never asked; its chain is refused", async () => {
    const { src, sent } = source();
    const r = answered(await src.summaries());
    expect(r.items.map((i) => i.underlying)).not.toContain("XAU");
    expect(refusedWith(await src.chain("XAU", "okx"))).toMatch(/OKX's XAU options are not crypto/);
    expect(sent.some((u) => u.includes("XAU-USD"))).toBe(false);
  });

  it("one Deribit book failing lists what answered, flagged partial and naming the book", async () => {
    const routes: Route[] = [["currency=USDC&kind=option", reply("", 500)], ...ROUTES];
    const { src } = source(routes);
    const r = answered(await src.summaries());
    expect(r.partial).toBe(true);
    expect(r.note).toMatch(/USDC/);
    expect(r.stale).toBeUndefined();
    expect(r.items.map((i) => i.underlying).sort()).toEqual(["BTC", "ETH"]);
  });

  it("a 451 is refused without claiming a pause", async () => {
    const { src } = source([["www.deribit.com", reply("", 451)], ...ROUTES]);
    const m = refusedWith(await src.chain("BTC", "deribit"));
    expect(m).toMatch(/Deribit refuses this place/);
    expect(m).not.toMatch(/minutes/);
  });

  it("an underlying only OKX lists shows OKX's volume in USD, no OI or IV; the list caps at the busiest six", async () => {
    const okx = text("okx-btc");
    const fam = ["BTC", "ETH", "TON", "DOGE", "ADA", "DOT", "LTC"];
    const routes: Route[] = [
      ...ROUTES.filter(([k]) => !k.includes("underlying")),
      ["public/underlying?instType=OPTION", reply(JSON.stringify({ code: "0", data: [fam.map((c) => `${c}-USD`)], msg: "" }))],
      ["market/tickers?instType=OPTION&instFamily=", (u) => { const c = /instFamily=([A-Z]+)-USD/.exec(u)![1]!; return reply(okx.replaceAll("BTC-USD", `${c}-USD`)); }],
      ["index-tickers?instId=", (u) => { const c = /instId=([A-Z]+)-USD/.exec(u)![1]!; const px = { TON: 5, DOGE: 0.4, ADA: 1, DOT: 8, LTC: 100 }[c] ?? 1; return reply(JSON.stringify({ code: "0", data: [{ instId: `${c}-USD`, idxPx: String(px) }], msg: "" })); }],
    ];
    const { src } = source(routes);
    const r = answered(await src.summaries());
    expect(r.items).toHaveLength(SUMMARY_CAP);
    const vol = sum((fx("okx-btc").data as any[]).map((x) => Number(x.volCcy24h)));
    const ltc = r.items.find((i) => i.underlying === "LTC")!;
    expect(ltc.venues).toEqual(["okx"]);
    expect(ltc.quoteFrom).toBe("OKX");
    expect(ltc.price).toBe(100);
    expect(ltc.volume).toBeCloseTo(vol, 6);
    expect(ltc.volumeUsd).toBeCloseTo(vol * 100, 4);
    expect(ltc.openInterest).toBeNull();
    expect(ltc.atmIv).toBeUndefined();
    const names = r.items.map((i) => i.underlying);
    expect(names).not.toContain("DOGE"); // the two least busy are left out
    const usd = r.items.map((i) => i.volumeUsd ?? -1);
    expect([...usd].sort((a, b) => b - a)).toEqual(usd);
  });

  it("is kept 30 s; a failed read answers the last good one stale within 10 min, then refuses", async () => {
    let down = false;
    const routes: Route[] = ROUTES.map(([k, v]) => [k, (u: string) => (down && k.includes("kind=option") ? reply("", 500) : typeof v === "function" ? v(u) : v)]);
    const s = source(routes);
    const first = answered(await s.src.summaries());
    const asked = s.sent.length;
    s.later(10_000);
    answered(await s.src.summaries());
    expect(s.sent.length).toBe(asked);
    down = true;
    s.later(CRYPTO_CHAIN_MS);
    const stale = answered(await s.src.summaries());
    expect(stale.stale).toBe(true);
    expect(stale.asOf).toBe(first.asOf);
    expect(stale.items.map((i) => i.underlying)).toEqual(first.items.map((i) => i.underlying));
    expect(s.src.status().state).toBe("stale");
    s.later(600_000);
    expect(refusedWith(await s.src.summaries())).toMatch(/Deribit/);
    expect(s.src.status().state).toBe("unavailable");
  });

  it("an unparseable 200 is a failure, never kept", async () => {
    const routes: Route[] = [["currency=BTC&kind=option", reply("<html>not json</html>")], ...ROUTES];
    const s = source(routes);
    expect(refusedWith(await s.src.chain("BTC", "deribit"))).toMatch(/Deribit is not answering/);
    await s.src.chain("BTC", "deribit");
    expect(s.sent.filter((u) => u.includes("currency=BTC")).length).toBe(2);
    const list = answered(await s.src.summaries());
    expect(list.partial).toBe(true);
    expect(list.items.map((i) => i.underlying)).not.toContain("BTC");
    const shapeless: Route[] = [["kind=option", reply(JSON.stringify({ result: { nope: 1 } }))], ...ROUTES];
    expect(isRefusal(await source(shapeless).src.summaries())).toBe(true);
  });
});

describe("chains", () => {
  it("the BTC chain from Deribit: its default expiry, the ATM strike at that expiry's underlying, legs in coin and USD", async () => {
    const { src } = source();
    const c = answered(await src.chain("btc", "deribit"));
    expect(c.underlying).toBe("BTC");
    expect(c.venue).toBe("deribit");
    expect(c.venueName).toBe("Deribit");
    expect(c.quoteFrom).toBe("Deribit");
    expect(c.expiry).toBe("2026-11-23");
    expect(c.expiries).toEqual([...c.expiries].sort());
    expect(c.expiries).toContain("2026-11-22");
    expect(c.expiries).toContain("2027-03-26");
    expect(c.price).toBe(59510.55);
    const rows = (fx("deribit-btc").result as any[]).filter((x) => x.instrument_name.includes("-23NOV26-"));
    const strikes = [...new Set(rows.map((x) => parseDeribitName(x.instrument_name)!.strike))].sort((a, b) => a - b);
    expect(c.strikes.map((s) => s.strike)).toEqual(strikes);
    expect(c.atmStrike).toBe(atmStrike(strikes, rows[0].underlying_price));
    const withBid = rows.find((x) => typeof x.bid_price === "number" && x.bid_price > 0 && x.instrument_name.endsWith("-C"))!;
    const leg = c.strikes.find((s) => s.strike === parseDeribitName(withBid.instrument_name)!.strike)!.call!;
    expect(leg.symbol).toBe(withBid.instrument_name);
    expect(leg.unit).toBe("BTC");
    expect(leg.bid).toBe(withBid.bid_price);
    expect(leg.usd!.bid).toBeCloseTo(withBid.bid_price * withBid.underlying_price, 6);
    expect(leg.iv).toBe(withBid.mark_iv);
    expect(leg.openInterest).toBe(withBid.open_interest);
    expect(leg.volume).toBe(withBid.volume);
    expect(leg.change).toBeUndefined();
    if (withBid.price_change !== null) expect(leg.changePct).toBe(withBid.price_change);
  });

  it("an expiry asked is answered; one not listed is refused in the market's words", async () => {
    const { src } = source();
    expect(answered(await src.chain("BTC", "deribit", "2027-03-26")).expiry).toBe("2027-03-26");
    expect(refusedWith(await src.chain("BTC", "deribit", "2027-03-27"))).toMatch(/2027-03-27/);
    expect(refusedWith(await src.chain("NOPE", "deribit"))).toMatch(/Deribit lists no options on NOPE/);
  });

  it("a linear chain (SOL) is priced in USDC, its usd the same numbers", async () => {
    const { src } = source();
    const c = answered(await src.chain("SOL", "deribit"));
    const leg = c.strikes.flatMap((s) => [s.call, s.put]).find((l) => l && l.bid !== null)!;
    expect(leg.unit).toBe("USDC");
    expect(leg.usd).toEqual({ bid: leg.bid, ask: leg.ask, last: leg.last });
  });

  it("an OKX chain from okx-btc.json: coin legs, IV = markVol x 100, OI = oiCcy, usd at OKX's index", async () => {
    const { src } = source();
    const c = answered(await src.chain("BTC", "okx"));
    expect(c.venue).toBe("okx");
    expect(c.quoteFrom).toBe("OKX");
    expect(c.expiries).toEqual(["2026-11-22", "2026-11-23", "2026-11-24"]);
    expect(c.expiry).toBe("2026-11-23");
    expect(c.price).toBe(59395.5);
    const t = (fx("okx-btc").data as any[]).find((x) => x.instId.includes("-261123-") && x.bidPx !== "" && Number(x.bidPx) > 0)!;
    const s = (fx("okx-opt-summary").data as any[]).find((x) => x.instId === t.instId)!;
    const oi = (fx("okx-open-interest").data as any[]).find((x) => x.instId === t.instId)!;
    const strike = Number(t.instId.split("-")[3]);
    const row = c.strikes.find((x) => x.strike === strike)!;
    const leg = t.instId.endsWith("-C") ? row.call! : row.put!;
    expect(leg.symbol).toBe(t.instId);
    expect(leg.unit).toBe("BTC");
    expect(leg.bid).toBe(Number(t.bidPx));
    expect(leg.usd!.bid).toBeCloseTo(Number(t.bidPx) * 59395.5, 6);
    expect(leg.iv).toBeCloseTo(Number(s.markVol) * 100, 8);
    expect(leg.openInterest).toBe(Number(oi.oiCcy));
    expect(leg.volume).toBe(Number(t.volCcy24h));
    const fwd = Number((fx("okx-opt-summary").data as any[]).find((x) => x.instId.includes("-261123-")).fwdPx);
    expect(c.atmStrike).toBe(atmStrike(c.strikes.map((x) => x.strike), fwd));
    const empty = (fx("okx-btc").data as any[]).find((x) => x.bidPx === "")!;
    const er = c.strikes.find((x) => x.strike === Number(empty.instId.split("-")[3]));
    if (er && empty.instId.includes("-261123-")) expect((empty.instId.endsWith("-C") ? er.call : er.put)!.bid).toBeNull();
  });

  it("an OKX family OKX does not list is refused without asking its tickers", async () => {
    const { src, sent } = source();
    expect(refusedWith(await src.chain("XRP", "okx"))).toMatch(/OKX lists no options on XRP/);
    expect(sent.some((u) => u.includes("instFamily=XRP-USD"))).toBe(false);
  });

  it("a chain is kept 30 s, one flight at a time", async () => {
    const s = source();
    await Promise.all([s.src.chain("BTC", "deribit"), s.src.chain("BTC", "deribit")]);
    const once = s.sent.filter((u) => u.includes("currency=BTC")).length;
    expect(once).toBe(1);
    s.later(29_000);
    await s.src.chain("BTC", "deribit", "2027-03-26");
    expect(s.sent.filter((u) => u.includes("currency=BTC")).length).toBe(1);
    s.later(1_000);
    await s.src.chain("BTC", "deribit");
    expect(s.sent.filter((u) => u.includes("currency=BTC")).length).toBe(2);
  });

  it("a 429 from Deribit pauses it (one pause, shared through the local guard) and OKX still answers", async () => {
    let t = NOW;
    const n = net([["www.deribit.com", reply("{}", 429)], ...ROUTES]);
    const shared = localHosts(n.http, { clock: () => t });
    const src = cryptoOptions({ http: shared, clock: () => t });
    expect(refusedWith(await src.chain("BTC", "deribit"))).toMatch(/Deribit refused/);
    const asked = n.sent.length;
    t += 60_000;
    expect(refusedWith(await src.chain("ETH", "deribit"))).toMatch(/Deribit/);
    expect(n.sent.length).toBe(asked); // paused: nothing sent
    // another source on the same guard is paused too
    await expect(shared("https://www.deribit.com/api/v2/public/get_currencies", { timeoutMs: 1000, maxBytes: 1000 })).rejects.toThrow("paused");
    const okx = answered(await src.chain("BTC", "okx"));
    expect(okx.strikes.length).toBeGreaterThan(0);
    t += 900_000;
    await src.chain("ETH", "deribit");
    expect(n.sent.length).toBeGreaterThan(asked + 4);
  });
});
