/** THE STAND-IN'S PRICE CURVES (test/standin/model.ts): a curve's path from the stand-in's start is the same whenever the stand-in starts, so
 * a test that walks a curve from its start sees the same prices on every run. Timed on the wall clock instead, the ui-standin test's resting
 * SOL limit missed at about one start in twenty-five (2026-11-25 20:55 UTC: SOL came no lower than 0.39% under its start in seven days). */
import { describe, expect, it } from "vitest";
import { DAY, PriceBook } from "../standin/model.ts";

const SOL = { price: 142.85, change24h: -1.6, vol: 1.6 };
const MISSED = Date.UTC(2026, 10, 25, 20, 55, 17, 89);
const bookAt = (t0: number): PriceBook => {
  const book = new PriceBook(t0, () => t0);
  book.add("SOL", SOL);
  return book;
};

describe("PriceBook", () => {
  it("draws the same path from the start whenever the stand-in starts", () => {
    const a = bookAt(MISSED);
    const b = bookAt(MISSED + 3 * DAY + 7_777_777);
    for (const d of [0, 60_000, 7 * 60_000, 3 * 3_600_000, DAY, 5 * DAY, -DAY / 2]) {
      expect(a.at("SOL", MISSED + d)).toBeCloseTo(b.at("SOL", MISSED + 3 * DAY + 7_777_777 + d), 9);
    }
  });

  it("started when the ui-standin test missed, SOL still comes down 0.7% under its start within seven days", () => {
    const book = bookAt(MISSED);
    const start = book.at("SOL", MISSED);
    let t = MISSED;
    while (book.at("SOL", t) > start * 0.993 && t < MISSED + 7 * DAY) t += 60_000;
    expect(t).toBeLessThan(MISSED + 7 * DAY);
  });
});
