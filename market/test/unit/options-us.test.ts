import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import type { CnHttp, CnReply } from "../../src/live/cn-http.ts";
import {
  nasdaqNum, parseExpiryGroup, parseLastTrade, SUMMARY_GAP_MS, US_OPTION_UNDERLYINGS, usOptions,
} from "../../src/live/options-us.ts";

const text = (n: string): string => readFileSync(fileURLToPath(new URL(`../fixtures/options/${n}.json`, import.meta.url)), "utf8");
const fx = (n: string): any => JSON.parse(text(n));
const reply = (b: string, status = 200): CnReply => ({ status, bytes: new TextEncoder().encode(b) });
const answered = <T,>(v: T | Refusal): T => { if (isRefusal(v)) throw new Error(`refused: ${v.message}`); return v; };
const refusedWith = (v: unknown): string => { if (!isRefusal(v)) throw new Error("answered"); return v.message; };

/** the default (nearest) page: no `fromdate` in the URL */
const isDefault = (url: string): boolean => !url.includes("fromdate=");
type Ask = { url: string; at: number };
function net(answer: (url: string) => CnReply) {
  const sent: Ask[] = [];
  const http: CnHttp = async (url, init) => {
    sent.push({ url, at: Date.now() });
    expect(init.headers?.accept).toBe("application/json");
    expect(init.headers?.["user-agent"]).toMatch(/Mozilla/);
    return answer(url);
  };
  return { http, sent };
}
/** every ticker's default page is the AAPL fixture; the December range is the expiry fixture */
const fixtures = (url: string): CnReply => {
  if (url.includes("/BRK.A/")) return reply(text("nasdaq-none"));
  if (isDefault(url)) return reply(text("nasdaq-aapl"));
  if (url.includes("fromdate=2026-12-02&todate=2026-12-31")) return reply(text("nasdaq-aapl-expiry"));
  return { status: 404, bytes: new Uint8Array() };
};

/** Sunday 2026-11-22 06:00 UTC: the fixtures' morning, the US closed */
const SUNDAY = Date.parse("2026-11-22T06:00:00Z");
/** Monday 2026-11-23 15:00 UTC = 10:00 New York: in session */
const MONDAY_SESSION = Date.parse("2026-11-23T15:00:00Z");

beforeEach(() => { vi.useFakeTimers(); });
/** a read that may wait out the 3 s spacing (the stocks-then-etf fallback) */
async function settle<T>(p: Promise<T>): Promise<T> { await vi.advanceTimersByTimeAsync(4_000); return p; }
afterEach(() => { vi.useRealTimers(); });

describe("parsing", () => {
  it("Nasdaq's '--', '' and 'N/A' are null, never 0; numbers may carry commas", () => {
    expect(nasdaqNum("--")).toBeNull();
    expect(nasdaqNum("")).toBeNull();
    expect(nasdaqNum("N/A")).toBeNull();
    expect(nasdaqNum(null)).toBeNull();
    expect(nasdaqNum("1,234")).toBe(1234);
    expect(nasdaqNum("-6.78")).toBe(-6.78);
    expect(nasdaqNum("0")).toBe(0);
  });
  it("an expiry group is a date", () => {
    expect(parseExpiryGroup("November 23, 2026")).toBe("2026-11-23");
    expect(parseExpiryGroup("December 4, 2026")).toBe("2026-12-04");
    expect(parseExpiryGroup("")).toBeNull();
    expect(parseExpiryGroup("Smarch 4, 2026")).toBeNull();
  });
  it("the last trade line: its price and its date as words", () => {
    expect(parseLastTrade("LAST TRADE: $342.56 (AS OF NOV 20, 2026)")).toEqual({ price: 342.56, asOf: "NOV 20, 2026" });
    expect(parseLastTrade(null)).toBeNull();
    expect(parseLastTrade("nothing")).toBeNull();
  });
});

describe("a chain", () => {
  it("AAPL's December 2 chain: the expiries, a strike row with call and put, '--' cells null, the last trade", async () => {
    vi.setSystemTime(SUNDAY);
    const n = net(fixtures);
    const src = usOptions({ http: n.http });
    const c = answered(await src.chain("aapl", "2026-12-02"));
    expect(c.underlying).toBe("AAPL");
    expect(c.venue).toBe("nasdaq");
    expect(c.venueName).toBe("Nasdaq");
    expect(c.quoteFrom).toBe("Nasdaq");
    expect(c.expiry).toBe("2026-12-02");
    expect(c.price).toBe(342.56);
    expect(c.lastTrade).toBe("NOV 20, 2026");
    for (const e of ["2026-11-23", "2026-12-02", "2026-12-04", "2027-01-15", "2029-01-19"]) expect(c.expiries).toContain(e);
    expect([...c.expiries].sort()).toEqual(c.expiries);
    expect(new Set(c.expiries).size).toBe(c.expiries.length);
    // only December 2's rows
    const rows = (fx("nasdaq-aapl-expiry").data.table.rows as any[]);
    const dec2 = rows.slice(1, rows.findIndex((r, i) => i > 0 && r.expirygroup));
    expect(c.strikes.length).toBe(dec2.length);
    const k270 = c.strikes.find((s) => s.strike === 270)!;
    expect(k270.call).toMatchObject({ bid: 72.4, ask: 75.1, last: null, volume: null, unit: "USD" });
    expect(k270.call!.openInterest).toBeUndefined();
    expect(k270.call!.change).toBeUndefined();
    expect(k270.put).toMatchObject({ bid: 0.07, ask: 0.38, last: 0.23, change: 0.16, volume: 17, unit: "USD" });
    expect(k270.call!.iv).toBeUndefined();
    expect(k270.call!.symbol).toBe("AAPL261202C00270000");
    expect(k270.put!.symbol).toBe("AAPL261202P00270000");
    expect(c.atmStrike).toBe(atm(c.strikes.map((s) => s.strike), 342.56));
    // the nearest page, then the December range's first page (December 4 seen: no more pages)
    expect(n.sent.map((s) => s.url)).toEqual([
      "https://api.nasdaq.com/api/quote/AAPL/option-chain?assetclass=stocks&limit=60",
      "https://api.nasdaq.com/api/quote/AAPL/option-chain?assetclass=stocks&limit=60&offset=0&fromdate=2026-12-02&todate=2026-12-31&money=all&type=all",
    ]);
  });

  it("no expiry: the nearest with a day left, asked in its month's range", async () => {
    vi.setSystemTime(SUNDAY);
    const n = net((url) => (url.includes("fromdate=2026-11-23&todate=2026-11-30") ? reply(text("nasdaq-aapl")) : fixtures(url)));
    const c = answered(await usOptions({ http: n.http }).chain("AAPL"));
    expect(c.expiry).toBe("2026-11-23");
    expect(c.strikes.length).toBe(19);
  });

  it("pages with offset until the month is covered, keeping the asked expiry's rows", async () => {
    vi.setSystemTime(SUNDAY);
    const base = fx("nasdaq-aapl-expiry");
    const header = base.data.table.rows[0];
    const strikeRow = (k: number) => ({ ...base.data.table.rows[1], strike: `${k}.00`, expirygroup: "" });
    const page = (offset: number, rows: unknown[]) => JSON.stringify({ ...base, data: { ...base.data, totalRecord: 130, table: { ...base.data.table, rows } } });
    const n = net((url) => {
      if (url.includes("fromdate=2026-12-02")) {
        const off = Number(/offset=(\d+)/.exec(url)![1]);
        if (off === 0) return reply(page(0, [header, ...Array.from({ length: 59 }, (_, i) => strikeRow(100 + i))]));
        if (off === 60) return reply(page(60, Array.from({ length: 60 }, (_, i) => strikeRow(200 + i))));
        if (off === 120) return reply(page(120, Array.from({ length: 10 }, (_, i) => strikeRow(300 + i))));
      }
      return fixtures(url);
    });
    const c = answered(await usOptions({ http: n.http }).chain("AAPL", "2026-12-02"));
    expect(c.strikes.length).toBe(129);
    expect(c.note).toBeUndefined();
    expect(n.sent.filter((s) => s.url.includes("fromdate=2026-12-02")).map((s) => /offset=(\d+)/.exec(s.url)![1])).toEqual(["0", "60", "120"]);
  });

  it("stops at 10 pages and says so in the chain's note", async () => {
    vi.setSystemTime(SUNDAY);
    const base = fx("nasdaq-aapl-expiry");
    const header = base.data.table.rows[0];
    const n = net((url) => {
      if (url.includes("fromdate=2026-12-02")) {
        const off = Number(/offset=(\d+)/.exec(url)![1]);
        const rows = Array.from({ length: 60 }, (_, i) => ({ ...base.data.table.rows[1], strike: `${off + i + 1}.00`, expirygroup: "" }));
        return reply(JSON.stringify({ ...base, data: { ...base.data, totalRecord: 5000, table: { ...base.data.table, rows: off === 0 ? [header, ...rows.slice(1)] : rows } } }));
      }
      return fixtures(url);
    });
    const c = answered(await usOptions({ http: n.http }).chain("AAPL", "2026-12-02"));
    expect(n.sent.filter((s) => s.url.includes("fromdate=2026-12-02")).length).toBe(10);
    expect(c.note).toMatch(/first 600 of 5000/);
  });

  it("a ticker Nasdaq has no options for is refused in the market's words", async () => {
    vi.setSystemTime(SUNDAY);
    const n = net(fixtures);
    const r = await settle(usOptions({ http: n.http }).chain("BRK.A"));
    expect(refusedWith(r)).toBe("Nasdaq lists no options for BRK.A");
  });

  it("an expiry Nasdaq does not list is refused; a bad expiry or ticker too", async () => {
    vi.setSystemTime(SUNDAY);
    const src = usOptions({ http: net(fixtures).http });
    expect(refusedWith(await src.chain("AAPL", "2026-10-02"))).toBe("Nasdaq lists no AAPL expiry on 2026-10-02");
    expect(refusedWith(await src.chain("AAPL", "Dec 2"))).toMatch(/YYYY-MM-DD/);
    expect(refusedWith(await src.chain("a b"))).toMatch(/no such ticker/);
  });

  it("is kept 60 s in session; a 403 pauses Nasdaq; an unparseable 200 is a failure", async () => {
    vi.setSystemTime(MONDAY_SESSION);
    const n = net(fixtures);
    const src = usOptions({ http: n.http });
    answered(await src.chain("AAPL", "2026-12-02"));
    answered(await src.chain("AAPL", "2026-12-02"));
    expect(n.sent.length).toBe(2);
    vi.setSystemTime(MONDAY_SESSION + 61_000);
    answered(await src.chain("AAPL", "2026-12-02"));
    expect(n.sent.length).toBe(4);

    const bad = usOptions({ http: net(() => reply("<html>")).http });
    expect(refusedWith(await bad.chain("AAPL"))).toMatch(/Nasdaq is not answering/);
    expect(bad.status().state).toBe("unavailable");

    const m = net(() => reply("", 403));
    const shut = usOptions({ http: m.http });
    expect(refusedWith(await shut.chain("AAPL"))).toMatch(/refused this place \(HTTP 403\)/);
    expect(refusedWith(await shut.chain("MSFT"))).toMatch(/refused this place/);
    expect(m.sent.length).toBe(1);
  });

  it("outside a session is kept until the next US open", async () => {
    vi.setSystemTime(SUNDAY);
    const n = net(fixtures);
    const src = usOptions({ http: n.http });
    answered(await src.chain("AAPL", "2026-12-02"));
    vi.setSystemTime(Date.parse("2026-11-23T14:00:00Z")); // Monday 09:00 New York
    answered(await src.chain("AAPL", "2026-12-02"));
    expect(n.sent.length).toBe(2);
    vi.setSystemTime(Date.parse("2026-11-23T14:31:00Z")); // past the open
    answered(await src.chain("AAPL", "2026-12-02"));
    expect(n.sent.length).toBe(4);
  });

  it("a 451 is said plainly and pauses nothing; a 'paused' throw from the shared guard is a refusal", async () => {
    vi.setSystemTime(SUNDAY);
    const m = net(() => reply("", 451));
    const src = usOptions({ http: m.http });
    expect(refusedWith(await src.chain("AAPL"))).toBe("Nasdaq refuses this place (HTTP 451): its options cannot be read from here");
    await src.chain("MSFT");
    expect(m.sent.length).toBe(2);
    const paused: CnHttp = async () => { throw new Error("paused"); };
    expect(refusedWith(await usOptions({ http: paused }).chain("AAPL"))).toMatch(/Nasdaq refused this place \(lately\)/);
  });

  it("expiries already settled, or outside the current ranges, are not listed", async () => {
    vi.setSystemTime(SUNDAY);
    const src = usOptions({ http: net(fixtures).http });
    const c = answered(await src.chain("AAPL", "2026-12-02"));
    expect(c.expiries).toContain("2026-11-23");
    vi.setSystemTime(Date.parse("2026-12-03T00:00:00Z")); // December 2 settled at 16:00 New York
    const d = answered(await src.chain("AAPL"));
    expect(d.expiry).toBe("2026-12-04");
    expect(d.expiries).not.toContain("2026-11-23");
    expect(d.expiries).not.toContain("2026-12-02");
    expect(d.expiries).toContain("2026-12-04");
  });

  it("a month that answers no options for a ticker that has them: no such expiry", async () => {
    vi.setSystemTime(SUNDAY);
    const n = net((url) => (url.includes("fromdate=2027-01-15") ? reply(text("nasdaq-none")) : fixtures(url)));
    expect(refusedWith(await usOptions({ http: n.http }).chain("AAPL", "2027-01-15"))).toBe("Nasdaq lists no AAPL expiry on 2027-01-15");
  });

  it("a ticker outside the list is asked as a share, then as an ETF 3 s later", async () => {
    vi.setSystemTime(SUNDAY);
    const n = net((url) => (url.includes("/GLD/") && url.includes("assetclass=stocks") ? reply(text("nasdaq-none")) : fixtures(url)));
    const src = usOptions({ http: n.http });
    const p = src.chain("GLD", "2026-12-02");
    await vi.advanceTimersByTimeAsync(4_000);
    const c = answered(await p);
    expect(c.underlying).toBe("GLD");
    expect(n.sent[0]!.url).toContain("assetclass=stocks");
    expect(n.sent[1]!.url).toContain("assetclass=etf");
    expect(n.sent[1]!.at - n.sent[0]!.at).toBeGreaterThanOrEqual(SUMMARY_GAP_MS);
    expect(n.sent[2]!.url).toContain("assetclass=etf&limit=60&offset=0&fromdate=2026-12-02");
  });

  it("has: the listed tickers, and a ticker a chain found options for", async () => {
    vi.setSystemTime(SUNDAY);
    const src = usOptions({ http: net(fixtures).http });
    expect(src.has("spy")).toBe(true);
    expect(src.has("AMD")).toBe(false);
    answered(await src.chain("AMD", "2026-12-02"));
    expect(src.has("AMD")).toBe(true);
    await settle(src.chain("BRK.A"));
    expect(src.has("BRK.A")).toBe(false);
  });
});

describe("summaries", () => {
  const quote = vi.fn(async (t: string) => (t === "TSLA" ? null : { price: 100, changePct: 1.5, quoteFrom: "Cboe · 15 min delayed" }));
  beforeEach(() => { quote.mockClear(); });

  it("the ten tickers are asked one at a time, at least 3 s apart, never two at once", async () => {
    vi.setSystemTime(MONDAY_SESSION);
    let flying = 0, most = 0;
    const sent: Ask[] = [];
    const http: CnHttp = async (url) => {
      sent.push({ url, at: Date.now() });
      flying++; most = Math.max(most, flying);
      await new Promise((r) => setTimeout(r, 500));
      flying--;
      return fixtures(url);
    };
    const src = usOptions({ http, quote });
    // a cold start answers at once: nothing kept, the queue reading in the background
    const r = answered(await src.summaries());
    expect(r.items).toEqual([]);
    expect((r as any).partial).toBe(true);
    expect((r as any).note).toBe("0 of 10 read");
    await vi.advanceTimersByTimeAsync(600);
    const some = answered(await src.summaries());
    expect(some.items.length).toBe(1);
    expect((some as any).note).toBe("1 of 10 read");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent.length).toBe(10);
    expect(most).toBe(1);
    for (let i = 1; i < sent.length; i++) expect(sent[i]!.at - sent[i - 1]!.at).toBeGreaterThanOrEqual(SUMMARY_GAP_MS);
    expect(sent.map((s) => /quote\/([^/]+)\//.exec(s.url)![1])).toEqual([...US_OPTION_UNDERLYINGS]);
    expect(sent[0]!.url).toBe("https://api.nasdaq.com/api/quote/SPY/option-chain?assetclass=etf&limit=60");
    expect(sent[3]!.url).toBe("https://api.nasdaq.com/api/quote/AAPL/option-chain?assetclass=stocks&limit=60");
    const all = answered(await src.summaries());
    expect(all.items.length).toBe(10);
    expect((all as any).partial).toBeUndefined();
  });

  it("a summary is the nearest expiry's alone: summed volume and open interest; price and change are the quote's", async () => {
    vi.setSystemTime(MONDAY_SESSION);
    const n = net(fixtures);
    const src = usOptions({ http: n.http, quote });
    void src.summaries();
    await vi.advanceTimersByTimeAsync(60_000);
    const r = answered(await src.summaries());
    const rows = (fx("nasdaq-aapl").data.table.rows as any[]).slice(1);
    const add = (f: (r: any) => string) => rows.reduce((a, x) => a + (Number(f(x)) || 0), 0);
    const aapl = r.items.find((i) => i.underlying === "AAPL")!;
    expect(aapl).toMatchObject({
      asset: "stocks", venues: ["nasdaq"], nearestOnly: true, nearestExpiry: "2026-11-23",
      price: 100, changePct: 1.5, quoteFrom: "Cboe · 15 min delayed",
    });
    expect(aapl.volume).toBe(add((x) => x.c_Volume) + add((x) => x.p_Volume));
    expect(aapl.openInterest).toBe(add((x) => x.c_Openinterest) + add((x) => x.p_Openinterest));
    expect(aapl.atmIv).toBeUndefined();
    expect(aapl.volumeUsd).toBeUndefined();
    // the quote refuses: the row still lists, without price or change
    const tsla = r.items.find((i) => i.underlying === "TSLA")!;
    expect(tsla.price).toBeNull();
    expect(tsla.changePct).toBeUndefined();
    expect(tsla.quoteFrom).toBe("Nasdaq");
  });

  it("each summary is kept 10 min in session, then asked again", async () => {
    vi.setSystemTime(MONDAY_SESSION);
    const n = net(fixtures);
    const src = usOptions({ http: n.http, quote });
    void src.summaries();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(n.sent.length).toBe(10);
    vi.setSystemTime(MONDAY_SESSION + 9 * 60_000);
    answered(await src.summaries());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(n.sent.length).toBe(10);
    vi.setSystemTime(MONDAY_SESSION + 11 * 60_000 + 30_000);
    answered(await src.summaries());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(n.sent.length).toBe(20);
  });

  it("all past their keep: answered at once, flagged stale, while the queue reads them again", async () => {
    vi.setSystemTime(MONDAY_SESSION);
    let slow = false;
    const n = net((url) => fixtures(url));
    const http: CnHttp = async (url, init) => {
      if (slow) await new Promise((r) => setTimeout(r, 5_000));
      return n.http(url, init);
    };
    const src = usOptions({ http, quote });
    void src.summaries();
    await vi.advanceTimersByTimeAsync(60_000);
    slow = true;
    vi.setSystemTime(MONDAY_SESSION + 11 * 60_000);
    const r = answered(await src.summaries());
    expect(r.stale).toBe(true);
    expect(r.items.length).toBe(10);
    expect((r as any).note).toBe("0 of 10 read");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(n.sent.length).toBe(20);
  });

  it("outside a session each summary is kept until the next US open", async () => {
    vi.setSystemTime(SUNDAY);
    const n = net(fixtures);
    const src = usOptions({ http: n.http, quote });
    void src.summaries();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(n.sent.length).toBe(10);
    vi.setSystemTime(Date.parse("2026-11-23T14:00:00Z")); // Monday 09:00 New York
    const r = answered(await src.summaries());
    expect(r.items.length).toBe(10);
    expect(r.stale).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(n.sent.length).toBe(10);
    vi.setSystemTime(Date.parse("2026-11-23T14:31:00Z")); // past the open
    void src.summaries();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(n.sent.length).toBe(20);
  });

  it("a failed read answers the last good summaries up to 10 min, flagged stale; then the refusal", async () => {
    vi.setSystemTime(MONDAY_SESSION);
    let down = false;
    const n = net((url) => (down ? { status: 500, bytes: new Uint8Array() } : fixtures(url)));
    const src = usOptions({ http: n.http, quote });
    void src.summaries();
    await vi.advanceTimersByTimeAsync(60_000);
    down = true;
    vi.setSystemTime(MONDAY_SESSION + 11 * 60_000);
    const s = src.summaries();
    await vi.advanceTimersByTimeAsync(1_000);
    const r = answered(await s);
    expect(r.stale).toBe(true);
    expect(r.items.length).toBe(10);
    vi.setSystemTime(MONDAY_SESSION + 25 * 60_000);
    const g = src.summaries();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refusedWith(await g)).toMatch(/Nasdaq is not answering/);
  });
});

function atm(strikes: number[], p: number): number {
  return [...strikes].sort((a, b) => Math.abs(a - p) - Math.abs(b - p) || a - b)[0]!;
}
