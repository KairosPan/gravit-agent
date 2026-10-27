import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { paperCurve, paperRangeStart, type PaperHistory, type PaperVenueSeries } from "../../src/portfolio/account/paper-equity.ts";
import { signOwner, simKey, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import type { LiveDeps } from "../../src/portfolio/live/index.ts";
import { rebuildEquity } from "../../src/portfolio/live/paper-history.ts";
import { paperBookPath, type PaperBook } from "../../src/portfolio/live/paper.ts";
import type { Listing, PublicSource } from "../../src/portfolio/live/public-markets.ts";
import { INTERVAL_MS, type Candle, type CandleInterval } from "../../src/portfolio/live/trade.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

/** The paper accounts' curve (account/paper-equity.ts): each account's points — the ones the service wrote winning over the ones told again
 * from its book — added up on the net worth curve's buckets; each account's change from where it stood at the range's start, or from what
 * it started with when it started inside it; the last point the figure now. Pure: no book, no network, the clock given */
const H = 3_600_000;
const NOW = Date.parse("2026-10-14T15:00:00Z");
const curve = (series: PaperVenueSeries[], range = "1d", venue?: string): PaperHistory => {
  const c = paperCurve(series, { range, now: NOW, ...(venue ? { venue } : {}) });
  if (isRefusal(c)) throw new Error(c.message);
  return c;
};
const at = (c: PaperHistory, ms: number) => c.points.find((p) => p.at === new Date(ms).toISOString())?.usd;
const iso = (ms: number): string => new Date(ms).toISOString();
const MIN = 60_000;
const DAY = 24 * H;
const r2 = (n: number): number => Number(n.toFixed(2));

describe("the paper accounts' curve", () => {
  it("one account started inside the range: its start at what it started with, its told-again points on the buckets, the figure now last; its change since it started", () => {
    const created = NOW - 3 * H;
    const rebuilt = [{ at: created, usd: 10000 }, ...Array.from({ length: 36 }, (_, i) => ({ at: created + (i + 1) * 300_000, usd: 10000 + i }))];
    const c = curve([{ venue: "paper-1", name: "Paper account", startUsd: 10000, createdAt: created, rebuilt, nowUsd: 10050 }]);
    expect(c).toMatchObject({ range: "1d", bucket: "5m", paper: true, rebuilt: true, startUsd: 10000, sinceStartUsd: 50, changeUsd: 50, changePct: 0.5, first: new Date(created).toISOString() });
    expect(c.points[0]).toEqual({ at: new Date(created).toISOString(), usd: 10000 });
    expect(c.points[c.points.length - 1]).toEqual({ at: new Date(NOW).toISOString(), usd: 10050 });
    // nothing before it started
    expect(c.points.every((p) => Date.parse(p.at) >= created)).toBe(true);
    expect(at(c, created + 3_600_000)).toBe(10011);
  });

  it("the written points win where they stand; the told-again ones fill where the service was not looking", () => {
    const created = NOW - 6 * H;
    const rebuilt = Array.from({ length: 72 }, (_, i) => ({ at: created + (i + 1) * 300_000, usd: 1000 }));
    // the service wrote points from 2 hours ago on: 2000
    const recorded = Array.from({ length: 24 }, (_, i) => ({ at: NOW - 2 * H + i * 300_000, usd: 2000 }));
    const c = curve([{ venue: "paper-1", name: "P", startUsd: 1000, createdAt: created, rebuilt, recorded, nowUsd: 2000 }]);
    expect(at(c, NOW - 3 * H)).toBe(1000);
    expect(at(c, NOW - H)).toBe(2000);
    // a gap of three hours in the written points: more than the hour and a quarter in which the log writes even an unchanged paper account,
    // so the service was down for some of it — the last written point stands its twenty minutes, then the told-again past stands in the gap
    const long = Array.from({ length: 48 }, (_, i) => ({ at: NOW - 4 * H + i * 300_000, usd: 2000 }));
    const gappy = long.filter((p) => p.at < NOW - 3.5 * H || p.at > NOW - 0.5 * H);
    const g = curve([{ venue: "paper-1", name: "P", startUsd: 1000, createdAt: created, rebuilt, recorded: gappy, nowUsd: 2000 }]);
    expect(at(g, NOW - 3.5 * H)).toBe(2000);
    expect(at(g, NOW - 3 * H)).toBe(1000);
    expect(at(g, NOW - H)).toBe(1000);
    // a gap of an hour or so with nothing written is a quiet hour (the log writes an unchanged account once an hour): the written point stands
    const quiet = recorded.filter((p) => p.at < NOW - 1.5 * H || p.at > NOW - 0.5 * H);
    expect(at(curve([{ venue: "paper-1", name: "P", startUsd: 1000, createdAt: created, rebuilt, recorded: quiet, nowUsd: 2000 }]), NOW - H)).toBe(2000);
  });

  it("a written point stands as long as the log's own rule says it does: a quiet paper account written once an hour does not saw against its told-again past", () => {
    const created = NOW - 6 * H;
    // what the book tells again sits a hundred dollars below what the service saw (funding the book did not list, say)
    const rebuilt = Array.from({ length: 72 }, (_, i) => ({ at: created + (i + 1) * 300_000, usd: 2000 }));
    // unchanged, so written once an hour
    const recorded = Array.from({ length: 6 }, (_, i) => ({ at: created + i * H, usd: 2100 }));
    const c = curve([{ venue: "paper-1", name: "P", startUsd: 2000, createdAt: created, rebuilt, recorded, nowUsd: 2100 }]);
    const after = c.points.filter((p) => Date.parse(p.at) > created);
    expect(after).toHaveLength(72);
    expect(after.every((p) => p.usd === 2100)).toBe(true);
  });

  it("a book started before the range: its change is from where it stood at the range's start, told again at that very moment — nothing written yet, or written days before", () => {
    // a day's curve asked at 15:03:17, the book started three days before with $10,000 and put it all in 0.1 BTC at once; BTC climbed from
    // 100,000 to 110,000 over the three days, in five-minute bars
    const now = Date.parse("2026-10-14T15:03:17Z");
    const created = now - 3 * DAY;
    const close = (t: number): number => r2(100_000 + (10_000 * (t - created)) / (3 * DAY));
    const candles: Candle[] = [];
    for (let t = Math.floor(created / (5 * MIN)) * 5 * MIN; t + 5 * MIN <= now; t += 5 * MIN) candles.push({ t, o: close(t), h: close(t), l: close(t), c: close(t) });
    const book = {
      version: 1,
      id: "paper-1",
      name: "Paper account",
      createdAt: iso(created),
      updatedAt: iso(created),
      startCashUsd: 10_000,
      feeBps: 0,
      cashUsd: 0,
      holdings: { "BTC/USD": { qty: 0.1, costUsd: 10_000 } },
      positions: {},
      orders: { p1: { ref: "p1", clientId: "c-p1", symbol: "BTC/USD", side: "buy", type: "market", qty: 0.1, status: "filled", filledQty: 0.1, avgPrice: 100_000, feeUsd: 0, at: iso(created), updatedAt: iso(created) } },
      fills: [],
      markets: { "BTC/USD": { source: "kraken", kind: "spot", base: "BTC", quote: "USD", name: "BTC/USD" } },
      leverage: {},
      seq: 1,
    } as unknown as PaperBook;
    // as the service asks it: from the range's start (after the book's), every five minutes, the live value last
    const startMs = now - DAY;
    const told = rebuildEquity(book, [{ symbol: "BTC/USD", interval: "5m", candles }], { fromMs: startMs, toMs: now, stepMs: 5 * MIN, nowUsd: 11_000 });
    // the bar that closed last before 15:03:17 the day before: the one that started at 14:55
    const then = r2(0.1 * close(Date.parse("2026-10-13T14:55:00Z")));
    const account = { venue: "paper-1", name: "Paper account", startUsd: 10_000, createdAt: created, rebuilt: told.points, nowUsd: 11_000 };
    for (const recorded of [undefined, [{ at: created, usd: 10_000 }]]) {
      const c = paperCurve([{ ...account, recorded }], { range: "1d", now });
      if (isRefusal(c)) throw new Error(c.message);
      expect(c.points[0]).toEqual({ at: iso(startMs), usd: then });
      expect(c.changeUsd).toBe(r2(11_000 - then));
      expect(c.changePct).toBe(r2(((11_000 - then) / then) * 100));
      expect(c.sinceStartUsd).toBe(1000);
    }
  });

  it("an account told by its written points alone: one written long before the range does not stand for its start; it comes in at its first point in the range, as a connection would", () => {
    const venueOwn = { venue: "alpaca-paper", name: "Alpaca paper", recorded: [{ at: NOW - 3 * DAY, usd: 100_000 }, { at: NOW - 5 * H, usd: 100_800 }, { at: NOW - H, usd: 100_900 }], nowUsd: 101_000 };
    const c = curve([venueOwn]);
    // the service was not looking for two and a half days: what the account made in them is not the day's
    expect(c.changeUsd).toBe(200);
    expect(c.points[0]).toEqual({ at: iso(NOW - 5 * H), usd: 100_800 });
    expect(c.first).toBe(iso(NOW - 3 * DAY));
    // one written within the hour and a quarter before the range's start stands for it
    const near = curve([{ ...venueOwn, recorded: [{ at: NOW - DAY - 30 * MIN, usd: 100_500 }, ...venueOwn.recorded.slice(1)] }]);
    expect(near.points[0]).toEqual({ at: iso(NOW - DAY), usd: 100_500 });
    expect(near.changeUsd).toBe(500);
  });

  it("several accounts add up; one started inside the range counts from its start, not as a gain; one with no book is its written points", () => {
    const old = { venue: "paper-1", name: "Old", startUsd: 10000, createdAt: NOW - 10 * 24 * H, rebuilt: [{ at: NOW - 30 * H, usd: 10100 }, { at: NOW - 23 * H, usd: 10200 }], nowUsd: 10300 };
    const fresh = { venue: "paper-2", name: "Fresh", startUsd: 5000, createdAt: NOW - 2 * H, rebuilt: [{ at: NOW - 2 * H, usd: 5000 }], nowUsd: 4900 };
    const venueOwn = { venue: "alpaca-paper", name: "Alpaca paper", recorded: [{ at: NOW - 20 * H, usd: 100000 }, { at: NOW - H, usd: 100500 }], nowUsd: 100600 };
    const c = curve([old, fresh, venueOwn]);
    // the day's change: the old one from where it stood a day ago (10,100), the fresh one from its 5,000, Alpaca's from its first point
    expect(c.changeUsd).toBe(10300 - 10100 + (4900 - 5000) + (100600 - 100000));
    // a venue's own paper account says nothing of what it started with: no start for all of them together
    expect(c.startUsd).toBeUndefined();
    expect(c.points[c.points.length - 1]!.usd).toBe(10300 + 4900 + 100600);
    // where the fresh one started, it stands at what it started with
    expect(at(c, NOW - 2 * H)).toBe(10200 + 5000 + 100000);
  });

  it("all of it starts at the earliest start; a range that is not one of the four is refused", () => {
    expect(paperRangeStart("all", NOW, [{ createdAt: NOW - 5 * H }, { recorded: [{ at: NOW - 9 * H, usd: 1 }] }])).toBe(NOW - 9 * H);
    expect(paperRangeStart("1w", NOW, [])).toBe(NOW - 7 * 24 * H);
    const c = curve([{ venue: "paper-1", name: "P", startUsd: 100, createdAt: NOW - 5 * H, rebuilt: [], nowUsd: 110 }], "all");
    expect(c.from).toBe(new Date(NOW - 5 * H).toISOString());
    expect(c.bucket).toBe("5m");
    expect(isRefusal(paperCurve([], { range: "3m", now: NOW }))).toBe(true);
  });

  it("says what the told-again past cannot know, and the markets it had no price for", () => {
    const c = curve([{ venue: "paper-1", name: "P", startUsd: 100, createdAt: NOW - H, rebuilt: [{ at: NOW - H, usd: 100 }, { at: NOW - 0.5 * H, usd: 101, partial: true }], nowUsd: 102, inexact: ["Funding before the account kept it is not in the curve."], missing: ["XYZ-PERP"] }]);
    expect(c).toMatchObject({ partial: true, inexact: ["Funding before the account kept it is not in the curve."], missing: ["XYZ-PERP"] });
  });
});

/** The service's own paper curve (service.ts paperHistory): a paper account the account keeps itself, connected and traded through the
 * door, its book told again from a stand-in public source's bars, the clock the test's */
const homes: string[] = [];
afterAll(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })));
type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const owner = simKey("owner");

describe("the service's paper accounts' curve", () => {
  // BTC climbs ten dollars an hour from 100,000 at T0
  const T0 = Date.parse("2026-10-11T12:00:00Z");
  const price = (t: number): number => r2(100_000 + (10 * (t - T0)) / H);
  const SPAN: Record<CandleInterval, number> = INTERVAL_MS;
  /** three days and a few minutes on, between two five-minute bars */
  const NOW3 = T0 + 3 * DAY + 3 * MIN + 17_000;

  /** a paper account connected at T0 (the paper log's first point written then, at what it started with), 0.05 BTC bought at the ask an
   * hour later, and nothing written since (the service was not running); the clock at NOW3 */
  async function paperAccount() {
    const clock = { t: T0 };
    const btc: Listing = { symbol: "BTC/USD", name: "BTC market", kind: "spot", base: "BTC", quote: "USD", price: price(T0), bid: price(T0) - 10, ask: price(T0) + 10, open: true, types: [], volumeUsd24h: 2e9 };
    const candles = (interval: CandleInterval, since: number): Candle[] => {
      const out: Candle[] = [];
      for (let t = Math.floor((T0 - DAY) / SPAN[interval]) * SPAN[interval]; t + SPAN[interval] <= clock.t; t += SPAN[interval]) if (t >= since) out.push({ t, o: price(t), h: price(t), l: price(t), c: price(t) });
      return out;
    };
    const kraken: PublicSource = { id: "kraken", name: "Kraken", kind: "exchange", connectTo: "kraken", connector: "live:exchange:kraken", listings: async (q) => [btc].filter((m) => !q.q || m.base.includes(q.q.toUpperCase())), candles: async (symbol, interval, w) => (symbol === "BTC/USD" ? candles(interval, w.since ?? 0) : []) };
    const home = mkdtempSync(join(tmpdir(), "paper-equity-"));
    homes.push(home);
    const liveDeps: Partial<LiveDeps> = { clock: () => clock.t, http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined };
    const svc = await PortfolioService.create({ home, now: () => new Date(T0).toISOString(), venues: "frontline", real: true, liveDeps, publicMarkets: [kraken], liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date(T0).toISOString() }] } });
    let n = 0;
    const own = async (a: NoNonce<OwnerAction>) => svc.exchange(await signOwner(owner, { ...a, nonce: T0 + ++n } as OwnerAction));
    const connected = await own({ type: "connectVenue", venue: "paper-1", connector: "live:paper", label: "", credentialRef: "" });
    if (isRefusal(connected)) throw new Error(connected.message);
    await svc.snapshot({ kind: "connect", venue: "paper-1", name: "Paper account", paper: true });
    clock.t = T0 + H;
    Object.assign(btc, { price: price(clock.t), bid: price(clock.t) - 10, ask: price(clock.t) + 10 });
    const p = await svc.account!.prepare({ type: "liveOrder", venue: "paper-1", symbol: "BTC/USD", side: "buy", orderType: "market", qty: "0.05" });
    if (isRefusal(p)) throw new Error(p.message);
    const { nonce: _n, ...rest } = p.action as Extract<OwnerAction, { type: "liveOrder" }>;
    const placed = await own(rest as NoNonce<OwnerAction>);
    if (isRefusal(placed) || placed.kind !== "order") throw new Error(`expected an order, got ${isRefusal(placed) ? placed.code : placed.kind}`);
    clock.t = NOW3;
    Object.assign(btc, { price: price(NOW3), bid: price(NOW3) - 10, ask: price(NOW3) + 10 });
    return { svc, home, clock };
  }

  it("starts a day's curve and its change where the book stood at the range's start, not at a point written days before", async () => {
    const { svc } = await paperAccount();
    const h = await svc.paperHistory("1d", "paper-1");
    if (isRefusal(h)) throw new Error(h.message);
    // bought at the ask with the fee; the range starts between two five-minute bars, and the bar that closed last before it started at 11:55
    const ask = price(T0 + H) + 10;
    const then = r2(10_000 - 0.05 * ask - 0.05 * ask * 0.001 + 0.05 * price(T0 + 2 * DAY - 5 * MIN));
    expect(h.points[0]!.at).toBe(iso(NOW3 - DAY));
    expect(h.points[0]!.usd).toBeCloseTo(then, 2);
    expect(h.changeUsd).toBeCloseTo(h.points.at(-1)!.usd - then, 2);
    // that bar was asked for (it started before the range), so no point stood at the fill price
    expect(h.partial).toBeUndefined();
    expect(h.missing).toBeUndefined();
  });

  it("tells each range with its own bars: a day asked in the same minute as a week is not given the week's bars, which start after the day's", async () => {
    const { svc } = await paperAccount();
    const week = await svc.paperHistory("1w", "paper-1");
    if (isRefusal(week)) throw new Error(week.message);
    const day = await svc.paperHistory("1d", "paper-1");
    if (isRefusal(day)) throw new Error(day.message);
    expect(day.points[0]!.at).toBe(iso(NOW3 - DAY));
    expect(day.partial).toBeUndefined();
    expect(day.missing).toBeUndefined();
  });

  it("tells a book whose own start does not parse (edited by hand) from its first fill, with a note, on every range, instead of failing every paper account's curve", async () => {
    const { svc, home } = await paperAccount();
    const path = paperBookPath(home, "paper-1");
    writeFileSync(path, JSON.stringify({ ...(JSON.parse(readFileSync(path, "utf8")) as PaperBook), createdAt: "not a date" }));
    for (const range of ["1d", "1w", "all"]) {
      const c = (await svc.paperHistory(range)) as PaperHistory | Refusal;
      if (isRefusal(c)) throw new Error(c.message);
      expect(c.inexact).toContain(`the book does not say when it started; the curve starts at its first fill (${iso(T0 + H)})`);
      expect(c.points.length).toBeGreaterThan(1);
      if (range !== "1d") expect(c.first).toBe(iso(T0 + H));
    }
  });
});
