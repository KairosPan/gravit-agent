// face/tests/analog-fixtures.ts
/** Synthetic daily bars for the analog tests: no real price history is committed (spec §7). One session per
 * calendar day from 2020-01-01, stamped 14:30 UTC, so a bar's date is its index. */
import assert from "node:assert/strict";

export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number | null }
const DAY = 86_400_000;
export const START = Date.UTC(2020, 0, 1, 14, 30);
export const dateAt = (i: number): string => new Date(START + i * DAY).toISOString().slice(0, 10);

/** Bars from closes: open = the previous close (the first bar's own close), high and low the larger and smaller of
 * open and close, volume 1,000; `overrides[i]` replaces a bar's open or volume. */
export function barsFrom(closes: readonly number[], overrides: Record<number, { o?: number; v?: number | null }> = {}): Bar[] {
  return closes.map((c, i) => {
    const over = overrides[i];
    const o = over?.o ?? (i === 0 ? c : closes[i - 1]!);
    const v = over !== undefined && "v" in over ? over.v! : 1000;
    return { t: START + i * DAY, o, h: Math.max(o, c), l: Math.min(o, c), c, v };
  });
}
export const flat = (n: number, v: number): number[] => Array.from({ length: n }, () => v);
/** A fall of 30% in 20 sessions from a close of 100: the last five take it from 80 to 70. */
export const FALL = [98.5, 97, 95.5, 94, 92.5, 91, 89.5, 88, 86.5, 85, 84, 83, 82, 81, 80, 79, 74, 73, 71, 70];
/** The query: 310 sessions at 95, a high of 100 at index 310 (2020-11-06), the fall to 70 at index 330 (2020-11-26),
 * a 6% gap down and four times the usual volume at index 327 (2020-11-23). */
export const SELLOFF = barsFrom([...flat(310, 95), 100, ...FALL], { 327: { o: 74.26, v: 4000 } });
/** Another company: a sell-off from a high at index 100 (2020-04-10) whose nearest day is index 124 (2020-05-04), with
 * a recovery after it; then the query's own fall from index 305 (2020-11-01), ending five sessions before the last bar. */
export const PAST = barsFrom(
  [...flat(100, 95), 100, ...Array.from({ length: 19 }, (_, j) => 99 - j), 80, 79, 75, 73, 72, 74, 76, 75, 70,
    ...flat(15, 78), ...flat(40, 81), 90, ...flat(120, 90), 100, ...FALL, ...flat(5, 70)],
  { 122: { o: 75.05, v: 3000 }, 322: { o: 74.26, v: 4000 } },
);
/** The market: flat at 400 but for one close of 368 at index 124, so it is 8% down from 2020-04-10 to 2020-05-04. */
export const MARKET = barsFrom(flat(331, 400).map((v, i) => (i === 124 ? 368 : v)));

export function near(actual: number | null | undefined, expected: number, tolerance = 1e-9): void {
  assert.ok(typeof actual === "number" && Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

type Held = {
  bars: Bar[]; source?: string; today?: boolean | string;
  older?: "none" | { source: string; bars: Bar[] };
} | { refusal: object; status?: number };
/** A stand-in for the market's `/api/candles`, paging as it pages: `range=MAX` answers the latest `limit` bars,
 * `before` the `limit` bars before that bar, `more` whether older bars exist. `calls` records every query.
 * `older` answers every page asked with `before` as the market does when Nasdaq does not: `"none"` an empty page
 * (Nasdaq holds nothing there), an object the last `limit` of its bars dated before it under its own source (Cboe's,
 * where Nasdaq refused the request), both with `more: false`. `today` puts a session-so-far bar's words on the
 * latest page: `true` is "Today so far" (the session open), a string the words themselves. */
export function fakeMarket(histories: Record<string, Held>) {
  const calls: Array<Record<string, string>> = [];
  const ask = async (query: Record<string, string>): Promise<{ status: number; body: any }> => {
    calls.push({ ...query });
    const held = histories[query.symbol!];
    if (held === undefined) return { status: 409, body: { ok: false, refusal: { code: "E_VENUE_REJECTED", message: `Nasdaq keeps no daily bars of ${query.symbol}` } } };
    if ("refusal" in held) return { status: held.status ?? 409, body: { ok: false, refusal: held.refusal } };
    const limit = Number(query.limit);
    const source = held.source ?? `Nasdaq · ${query.symbol}`;
    if (query.before !== undefined && held.older !== undefined) {
      if (held.older === "none") return { status: 200, body: { ok: true, candles: [], more: false, source } };
      const before = held.older.bars.filter((b) => b.t < Number(query.before));
      return { status: 200, body: { ok: true, candles: before.slice(Math.max(0, before.length - limit)), more: false, source: held.older.source } };
    }
    const end = query.before === undefined ? held.bars.length : held.bars.findIndex((b) => b.t === Number(query.before));
    const from = Math.max(0, end - limit);
    const words = held.today === true ? "Today so far" : typeof held.today === "string" ? held.today : undefined;
    const today = words !== undefined && query.before === undefined ? { today: { t: held.bars.at(-1)!.t, words } } : {};
    return { status: 200, body: { ok: true, candles: held.bars.slice(from, end), more: from > 0, source, ...today } };
  };
  return { ask, calls };
}
