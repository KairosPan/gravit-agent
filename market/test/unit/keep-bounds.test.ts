/** WHAT THE MARKET KEEPS IS BOUNDED BY WHAT IS STILL KEPT: an answer past its keep is let go, not held until two hundred newer keys push it
 * out — a key that moves with the clock (a Kalshi candlestick window, a Polymarket price-history window: a new URL each minute) keeps only
 * the answers within their keep. The China source's keeps likewise, which had no bound at all: a set of codes asked once, a chart opened
 * once, kept for the life of the process. */
import { describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { CN_KEPT, cnKeeper } from "../../src/live/china.ts";
import { getter, keeper, KEEP_MS } from "../../src/live/public-markets.ts";
import type { Http } from "../../src/live/types.ts";
import { no } from "../../src/refuse.ts";

const MIN = 60_000;

describe("a public source's keeper", () => {
  it("lets an answer go once its keep has run out: one key a minute, kept 90 s, is at most two answers kept", async () => {
    let now = 1_800_000_000_000;
    const keep = keeper<{ bars: number[] }>(() => now, KEEP_MS);
    for (let minute = 0; minute < 300; minute++) {
      await keep(`candlesticks?end_ts=${minute * 60}`, async () => ({ bars: Array.from({ length: 100 }, (_, i) => i) }));
      now += MIN;
    }
    expect(keep.size).toBeLessThanOrEqual(2);
  });

  it("keeps an answer for its keep, and asks again only after it", async () => {
    let now = 0;
    let asked = 0;
    const keep = keeper<number>(() => now, KEEP_MS);
    const ask = () => keep("k", async () => ++asked);
    expect(await ask()).toBe(1);
    now += KEEP_MS - 1;
    expect(await ask()).toBe(1);
    now += 1;
    expect(await ask()).toBe(2);
  });

  it("never lets go an answer still on its way, whatever its age: one asked again then is the same ask", async () => {
    let now = 0;
    let asked = 0;
    let finish!: (v: number) => void;
    const keep = keeper<number>(() => now, 1_000);
    const first = keep("slow", () => new Promise<number>((go) => ((asked += 1), (finish = go))));
    now += 10_000;
    // another key comes in long after: the slow one is still on its way and stays
    await keep("other", async () => 7);
    expect(keep.size).toBe(2);
    finish(42);
    expect(await first).toBe(42);
    expect(asked).toBe(1);
  });

  it("keeps a refusal that holds the venue back for as long as it holds, then lets it go", async () => {
    let now = 0;
    const keep = keeper<number>(() => now, KEEP_MS);
    const down: Refusal = no("E_VENUE_UNREACHABLE", { venue: "kalshi", message: "Kalshi did not answer" });
    await keep("held", async () => down);
    now += 10_000;
    expect(isRefusal(await keep("held", async () => 1))).toBe(true);
    now += 20_000;
    await keep("later", async () => 2);
    expect(await keep("held", async () => 3)).toBe(3);
    // the ones past their keep went as the new ones came
    now += 2 * KEEP_MS;
    await keep("last", async () => 4);
    expect(keep.size).toBe(1);
  });

  it("a getter keeps one body a URL only while its keep lasts", async () => {
    let now = 0;
    const http: Http = async (url) => ({ status: 200, body: { url, rows: Array.from({ length: 50 }, (_, i) => i) }, text: "" });
    const get = getter(http, "kalshi", "Kalshi", () => now, KEEP_MS);
    for (let minute = 0; minute < 250; minute++) {
      await get(`https://external-api.kalshi.com/trade-api/v2/markets/candlesticks?market_tickers=KX&start_ts=1&end_ts=${minute * 60}`);
      now += MIN;
    }
    expect(get.size).toBeLessThanOrEqual(2);
  });
});

describe("the China source's keeper", () => {
  const isNumber = (v: number | Refusal): v is number => typeof v === "number";

  it("lets an answer go once its keep has run out", async () => {
    let now = 0;
    const keep = cnKeeper<number>(() => now, () => 5_000);
    for (let i = 0; i < 1_000; i++) {
      await keep.ask(`600${String(i).padStart(3, "0")}`, async () => i, isNumber);
      now += 10_000;
    }
    expect(keep.kept.size).toBeLessThanOrEqual(1);
  });

  it("keeps at most CN_KEPT answers within their keep, the oldest let go first", async () => {
    const keep = cnKeeper<number>(() => 0, () => 600_000);
    for (let i = 0; i < CN_KEPT + 300; i++) await keep.ask(`chart-${i}`, async () => i, isNumber);
    expect(keep.kept.size).toBe(CN_KEPT);
    expect(keep.kept.has("chart-0")).toBe(false);
    expect(keep.kept.has(`chart-${CN_KEPT + 299}`)).toBe(true);
  });

  it("keeps an answer for its keep, and never a refusal", async () => {
    let now = 0;
    let asked = 0;
    const keep = cnKeeper<number>(() => now, () => 5_000);
    const ok = (v: number | Refusal): v is number => typeof v === "number";
    expect(await keep.ask("a", async () => ++asked, ok)).toBe(1);
    now += 4_999;
    expect(await keep.ask("a", async () => ++asked, ok)).toBe(1);
    now += 1;
    expect(await keep.ask("a", async () => ++asked, ok)).toBe(2);
    await keep.ask("b", async () => no("E_VENUE_UNREACHABLE", { venue: "china", message: "no" }), ok);
    expect(keep.kept.has("b")).toBe(false);
  });
});
