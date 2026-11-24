import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fromEt } from "../../src/calendar.ts";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { closeOfSession, closedSessionBefore, dailyCloses, DAYS_RETRY_MS, lastClose } from "../../src/live/us-closes.ts";
import type { Candle } from "../../src/live/trade.ts";
import { nasdaqSource } from "../../src/live/us-quotes.ts";
import { no } from "../../src/refuse.ts";
import { json } from "./live-public-markets-fixtures.ts";

/** NASDAQ'S DAILY CLOSES (live/us-closes.ts), over AAPL's chart page as Nasdaq answered it for 19 to 23 November 2026
 * (fixtures/us-stocks/chart-AAPL-daily.json: the bars of 19, 20 and 23 November), read through Nasdaq.daily. Nothing leaves the process. */
const FIXTURE = JSON.parse(readFileSync(new URL("../fixtures/us-stocks/chart-AAPL-daily.json", import.meta.url), "utf8")) as unknown;
const AAPL = nasdaqSource({ pace: async () => undefined, http: async () => json(FIXTURE) }).daily("AAPL", "2026-11-13", "2026-11-23");
const bars = async (): Promise<Candle[]> => {
  const d = await AAPL;
  if (!d || isRefusal(d)) throw new Error("the fixture did not parse");
  return d.bars;
};

/** a Nasdaq stand-in whose `daily` answers by a function and counts its asks */
function standIn(answer: (n: number) => Promise<{ bars: Candle[]; noOpen: number } | null | Refusal>) {
  const asked: Array<{ symbol: string; from: string; to: string }> = [];
  return {
    asked,
    daily: (symbol: string, from: string, to: string) => {
      asked.push({ symbol, from, to });
      return answer(asked.length);
    },
  };
}
const REFUSAL = no("E_ACCOUNT_BAD_ACTION", { venue: "nasdaq", message: "a stand-in refusal" });

describe("a session's close and the one before it", () => {
  it("closeOfSession: Monday 23 November's session closed at 349.08 after Friday's 342.56", async () => {
    const ref = closedSessionBefore(fromEt(2026, 11, 23, 21, 58))!;
    expect(ref.closesAt).toBe(fromEt(2026, 11, 23, 16, 0));
    expect(closeOfSession(await bars(), ref)).toMatchObject({ close: 349.08, prev: 342.56, closesAt: ref.closesAt });
    // a session the bars do not hold
    expect(closeOfSession(await bars(), closedSessionBefore(fromEt(2026, 11, 24, 21, 58))!)).toBeUndefined();
  });

  it("lastClose: after Monday's close it is Monday's; at 15:00 the same day it is Friday's, against Thursday's", async () => {
    const b = await bars();
    expect(lastClose(b, fromEt(2026, 11, 23, 21, 58))).toMatchObject({ close: 349.08, prev: 342.56 });
    expect(lastClose(b, fromEt(2026, 11, 23, 15, 0))).toMatchObject({ close: 342.56, prev: 349.21 });
    expect(lastClose([], fromEt(2026, 11, 23, 15, 0))).toBeUndefined();
  });

  it("Thanksgiving: at noon on Thursday 26 November the session closed before is Wednesday 25 November's", () => {
    expect(closedSessionBefore(fromEt(2026, 11, 26, 12, 0))?.closesAt).toBe(fromEt(2026, 11, 25, 16, 0));
  });
});

describe("dailyCloses: one read per share per reference close", () => {
  it("two calls after Monday's close make one read, from 2026-11-13 to 2026-11-23; Tuesday's close makes a new one", async () => {
    const b = await bars();
    const n = standIn(async () => ({ bars: b, noOpen: 0 }));
    const c = dailyCloses(n, () => fromEt(2026, 11, 23, 22, 0));
    expect(await c.bars("aapl", fromEt(2026, 11, 23, 21, 58))).toEqual(b);
    expect(await c.bars("AAPL", fromEt(2026, 11, 23, 23, 0))).toEqual(b);
    expect(n.asked).toEqual([{ symbol: "AAPL", from: "2026-11-13", to: "2026-11-23" }]);
    await c.bars("AAPL", fromEt(2026, 11, 24, 16, 30));
    expect(n.asked).toHaveLength(2);
    expect(n.asked[1]).toMatchObject({ to: "2026-11-24" });
  });

  it("two asks at once share one read", async () => {
    const b = await bars();
    const n = standIn(async () => ({ bars: b, noOpen: 0 }));
    const c = dailyCloses(n, () => fromEt(2026, 11, 23, 22, 0));
    const [x, y] = await Promise.all([c.bars("AAPL", fromEt(2026, 11, 23, 22, 0)), c.bars("AAPL", fromEt(2026, 11, 23, 22, 0))]);
    expect([x, y]).toEqual([b, b]);
    expect(n.asked).toHaveLength(1);
  });

  it("an answer without the reference bar, or a refusal, is asked again no sooner than DAYS_RETRY_MS; held() keeps the last bars meanwhile", async () => {
    const b = await bars();
    let now = fromEt(2026, 11, 24, 16, 30);
    // Tuesday's close is not in the bars: lacking
    const lacking = standIn(async () => ({ bars: b, noOpen: 0 }));
    const c = dailyCloses(lacking, () => now);
    await c.bars("AAPL", now);
    now += 5 * 60_000;
    await c.bars("AAPL", now);
    expect(lacking.asked).toHaveLength(1);
    expect(c.held("AAPL")).toEqual(b);
    now += DAYS_RETRY_MS;
    await c.bars("AAPL", now);
    expect(lacking.asked).toHaveLength(2);

    // a refusal after a good read: held keeps the bars, the retry waits
    let ask = 0;
    const flaky = standIn(async () => (ask++ === 0 ? { bars: b, noOpen: 0 } : REFUSAL));
    now = fromEt(2026, 11, 23, 22, 0);
    const d = dailyCloses(flaky, () => now);
    await d.bars("AAPL", now);
    now = fromEt(2026, 11, 24, 16, 30);
    expect(await d.bars("AAPL", now)).toEqual(b);
    now += 60_000;
    await d.bars("AAPL", now);
    expect(flaky.asked).toHaveLength(2);
    expect(d.held("AAPL")).toEqual(b);
    now += DAYS_RETRY_MS;
    await d.bars("AAPL", now);
    expect(flaky.asked).toHaveLength(3);

    // a refusal with nothing before: the refusal is the answer, and nothing is held
    const refused = standIn(async () => REFUSAL);
    const e = dailyCloses(refused, () => now);
    expect(isRefusal(await e.bars("AAPL", now))).toBe(true);
    expect(e.held("AAPL")).toBeUndefined();
    await e.bars("AAPL", now + 1_000);
    expect(refused.asked).toHaveLength(1);
  });

  it("a symbol Nasdaq does not know answers null, and is asked again only after DAYS_RETRY_MS", async () => {
    let now = fromEt(2026, 11, 23, 22, 0);
    const n = standIn(async () => null);
    const c = dailyCloses(n, () => now);
    expect(await c.bars("ZZZZ", now)).toBeNull();
    now += DAYS_RETRY_MS - 1;
    expect(await c.bars("ZZZZ", now)).toBeNull();
    expect(n.asked).toHaveLength(1);
    now += 1;
    await c.bars("ZZZZ", now);
    expect(n.asked).toHaveLength(2);
    expect(c.held("ZZZZ")).toBeUndefined();
  });
});
