/** The facts the face computes for the memory: numbers and flags read by the face's own code, never supplied by a
 * model, each with the sentence that says where it came from.
 *
 * - The price facts ({@link priceFacts}): `price` and `change_1d_pct` from the Market's quote (src/market-quotes.ts),
 *   `change_5d_pct`, `change_20d_pct` and `change_60d_pct` from the Market's daily bars (`/api/candles`, six months,
 *   through the market proxy's in-process read, src/market-proxy.ts). A change is taken against the close N full
 *   sessions before the last full one ({@link changesFrom}); a provisional bar of today is dropped first
 *   ({@link fullBars}). The quote and the bars are read together, each raced against its own timer of
 *   {@link FACT_READ_MS}, or of the caller's `readMs`; a read that loses the race is left to finish and ignored.
 * - The held facts ({@link heldFacts}): `held` from the Account's position on a venue, and `unrealized_pct` for a long
 *   with an entry price and a last price.
 *
 * Every value is rounded to two decimals; every key of `facts` has its line in `sources`, at most
 * {@link SOURCE_MAX} characters. Nothing here throws or rejects: what cannot be computed is absent.
 * @module
 */
import { bjDate, etDate } from "./et.ts";
import type { MarketQuote, MarketQuoteSource } from "./market-quotes.ts";
import { CN_SYMBOL_RE, idOf, SYMBOL_RE } from "./symbols.ts";
import type { UpstreamAnswer, UpstreamRouteRead } from "./upstream-proxy.ts";

/** The market a fact is computed in: a US share or an A share. */
export type FactMarket = "US" | "CN";

/** Facts by name, and for each the sentence that says where it came from. */
export interface Facts { facts: Record<string, number | boolean>; sources: Record<string, string> }

/** How long each of the two reads may take before the facts are given without it. */
export const FACT_READ_MS = 2_000;

/** One daily bar: its open time, in ms since the epoch, and its close. */
export interface DayBar { t: number; c: number }

/** The reads the price facts are taken from, and the clock and timer they run on. */
export interface FactReads {
  quotes: MarketQuoteSource;
  candles: UpstreamRouteRead;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

/** The longest source line. */
const SOURCE_MAX = 120;

/** The changes taken from the daily bars, by sessions back. */
const CHANGE_SESSIONS = [5, 20, 60] as const;

const empty = (): Facts => ({ facts: {}, sources: {} });
const round2 = (x: number): number => Math.round(x * 100) / 100;
const positive = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;
const pctOver = (last: number, base: number): number => round2((last / base - 1) * 100);
const clip = (line: string): string => line.slice(0, SOURCE_MAX);

/** Pure: the three changes from the last price and the full daily bars, oldest first. A change N sessions back
 * is absent when `full` has fewer than N + 1 bars. */
export function changesFrom(last: number, full: readonly DayBar[], sourceOf: (base: DayBar) => string): Facts {
  const out = empty();
  for (const n of CHANGE_SESSIONS) {
    if (full.length < n + 1) continue;
    const base = full[full.length - 1 - n];
    const key = `change_${n}d_pct`;
    out.facts[key] = pctOver(last, base.c);
    out.sources[key] = clip(sourceOf(base));
  }
  return out;
}

/** Pure: drops a provisional last bar. `us`: the answer's `today.t`, the last bar provisional when it opens then;
 * `cn`: the last bar provisional when it falls on today's Shanghai date while the quote's phase is not `closed`. */
export function fullBars(bars: readonly DayBar[], mark: { us?: number; cn?: { phase: string; today: string } }): DayBar[] {
  const last = bars[bars.length - 1];
  if (last === undefined) return [];
  const provisional = (mark.us !== undefined && last.t === mark.us)
    || (mark.cn !== undefined && mark.cn.phase !== "closed" && bjDate(new Date(last.t)) === mark.cn.today);
  return provisional ? bars.slice(0, -1) : [...bars];
}

/** held, unrealized_pct. `position` null is flat; undefined is not read: no fact at all. `unrealized_pct` is a
 * long's alone, with an entry price and a last price. */
export function heldFacts(position: { side: "long" | "short"; entryPrice?: number } | null | undefined, last: number | undefined, venue: string): Facts {
  const out = empty();
  if (position === undefined) return out;
  out.facts.held = position !== null;
  out.sources.held = clip(`the Account's position on ${venue}`);
  if (position !== null && position.side === "long" && positive(position.entryPrice) && positive(last)) {
    out.facts.unrealized_pct = pctOver(last, position.entryPrice);
    out.sources.unrealized_pct = clip(`the Market's quote over the Account's entry price on ${venue}`);
  }
  return out;
}

/** `read` raced against its own timer of `ms`: its value, or `undefined` when it throws, rejects or loses the race. */
function within<T>(read: () => Promise<T>, reads: FactReads, ms: number): Promise<T | undefined> {
  const setTimer = reads.setTimer ?? ((run: () => void, ms: number): unknown => setTimeout(run, ms));
  const clearTimer = reads.clearTimer ?? ((timer: unknown): void => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let pending: Promise<T>;
  try {
    pending = read();
  } catch {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    let done = false;
    const settle = (value: T | undefined): void => {
      if (done) return;
      done = true;
      clearTimer(timer);
      resolve(value);
    };
    const timer = setTimer(() => settle(undefined), ms);
    Promise.resolve(pending).then(settle, () => settle(undefined));
  });
}

/** The daily bars of a 200 answer whose body is JSON with a `candles` list of `{ t, c }`, and its `today.t` when
 * set; `undefined` for anything else. */
function barsOf(answer: UpstreamAnswer | undefined): { bars: DayBar[]; today?: number } | undefined {
  if (answer === undefined || !("status" in answer) || answer.status !== 200) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(answer.body);
  } catch {
    return undefined;
  }
  const candles = (body as { candles?: unknown } | null)?.candles;
  if (!Array.isArray(candles)) return undefined;
  const bars: DayBar[] = [];
  for (const bar of candles) {
    const { t, c } = (bar ?? {}) as { t?: unknown; c?: unknown };
    if (typeof t !== "number" || !Number.isFinite(t) || !positive(c)) return undefined;
    bars.push({ t, c });
  }
  const today = (body as { today?: { t?: unknown } }).today?.t;
  return typeof today === "number" ? { bars, today } : { bars };
}

/** price, change_1d_pct, change_5d_pct, change_20d_pct, change_60d_pct. Never rejects; what cannot be computed is
 * absent. A symbol off its market's shape asks nothing. `opts.readMs` bounds each of the two reads, FACT_READ_MS by
 * default. */
export async function priceFacts(reads: FactReads, symbol: string, market: FactMarket, opts: { readMs?: number } = {}): Promise<Facts> {
  const ms = opts.readMs ?? FACT_READ_MS;
  const cn = market === "CN";
  if (!(cn ? CN_SYMBOL_RE : SYMBOL_RE).test(symbol)) return empty();
  const id = idOf(cn ? "cn" : "us", symbol);
  const query = cn ? `venue=china&symbol=${symbol}&range=6M` : `venue=cboe&symbol=${symbol}&interval=1d&range=6M`;
  const [payload, answer] = await Promise.all([
    within(() => reads.quotes.snapshot([{ id, market: cn ? "cn" : "us", symbol }]), reads, ms),
    within(() => reads.candles(query), reads, ms),
  ]);
  const quote: MarketQuote | undefined = payload?.quotes?.find((q) => q.id === id);
  if (quote === undefined || !positive(quote.price)) return empty();
  const price = quote.price;
  const out = empty();
  const quoteSource = clip(`the Market's quote (${quote.feed}) at ${quote.as_of ?? "no stated time"}`);
  out.facts.price = round2(price);
  out.sources.price = quoteSource;
  if (positive(quote.prev_close)) {
    out.facts.change_1d_pct = pctOver(price, quote.prev_close);
    out.sources.change_1d_pct = quoteSource;
  }
  const read = barsOf(answer);
  if (read === undefined) return out;
  const now = (reads.now ?? Date.now)();
  const full = cn
    ? fullBars(read.bars, { cn: { phase: quote.cn?.phase ?? "unknown", today: bjDate(new Date(now)) } })
    : fullBars(read.bars, read.today === undefined ? {} : { us: read.today });
  const dateOfBar = cn ? bjDate : etDate;
  const changes = changesFrom(price, full, (base) => `the Market's daily bars, base close ${dateOfBar(new Date(base.t))}`);
  Object.assign(out.facts, changes.facts);
  Object.assign(out.sources, changes.sources);
  return out;
}
