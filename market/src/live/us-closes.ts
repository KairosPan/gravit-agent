/**
 * NASDAQ'S DAILY CLOSES, kept one read per share per close — the price the US stocks line shows where no live source prices a share (off
 * hours, or in session while the share waits its turn among Nasdaq's eight at a time): the share's last regular close, from the chart page
 * asked by dates (Nasdaq.daily), and the change against the close before it, from the same answer.
 *
 * Nothing here asks Cboe, and nothing here imports public-stocks.ts (which imports this file): the calendar helpers and the types of
 * us-quotes.ts are all it needs.
 */
import { isRefusal, type Refusal } from "../core/errors.ts";
import { et, fromEt, nextRegularSession } from "../calendar.ts";
import type { Candle } from "./trade.ts";
import { unreachable } from "./types.ts";
import type { Nasdaq } from "./us-quotes.ts";

/** the source words of a line priced by a daily close (English, as every `quoteFrom` word is: the face does not translate them) */
export const NASDAQ_CLOSE_FROM = "Nasdaq · close";
/** a close line is a day old at the least, never real time: the delay a paper account reads and refuses to take as a live price */
export const US_CLOSE_DELAY_MS = 60_000;
/** a daily read that failed, or came without the reference session's bar, is asked again no sooner than this */
export const DAYS_RETRY_MS = 600_000;
/** the shares whose bars are kept at most (the oldest read let go first) */
const SHARES_KEPT = 2_000;
/** how far back before the reference close a read starts, so the bar before the session's is in it whatever holidays lie between */
const LOOKBACK_MS = 10 * 86_400_000;

/** THE REFERENCE CLOSE of a price stamped `ms`: the last regular session that has closed by then — the day before's in pre-market and the
 * regular session, the same day's in after-hours — as the calendar says it. Each step back is half a day, shorter than the time between one
 * session's close and the next one's (21 hours at the least, after an early close), so none is passed over */
export function closedSessionBefore(ms: number): { opensAt: number; closesAt: number } | undefined {
  for (let k = 1; k <= 24; k++) {
    const s = nextRegularSession(ms - k * 12 * 3_600_000);
    if (s.closesAt <= ms) return s;
  }
  return undefined;
}

/** a session's close, with the session's own times and the close of the bar before it (where there is one) */
export interface SessionClose {
  close: number;
  opensAt: number;
  closesAt: number;
  prev?: number | undefined;
}

/** the bar of the session `ref` (a daily bar is stamped at its session's open, so it lies in [opensAt, closesAt)), with the close of the bar
 * before it; nothing where the bars hold none for that session. `bars` is oldest first */
export function closeOfSession(bars: readonly Candle[], ref: { opensAt: number; closesAt: number }): SessionClose | undefined {
  const i = bars.findIndex((b) => b.t >= ref.opensAt && b.t < ref.closesAt);
  const bar = bars[i];
  if (!bar) return undefined;
  return { close: bar.c, opensAt: ref.opensAt, closesAt: ref.closesAt, prev: bars[i - 1]?.c };
}

/** the latest bar whose session had closed by `now`, with the close of the bar before it; nothing where there is none. A bar stamped at or
 * before the open of the reference close's session is a closed session's */
export function lastClose(bars: readonly Candle[], now: number): SessionClose | undefined {
  const ref = closedSessionBefore(now);
  if (!ref) return undefined;
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i]!;
    if (b.t > ref.opensAt) continue;
    const s = nextRegularSession(b.t);
    if (!(b.t >= s.opensAt && b.t < s.closesAt)) continue;
    return { close: b.c, opensAt: s.opensAt, closesAt: s.closesAt, prev: bars[i - 1]?.c };
  }
  return undefined;
}

/** the daily bars Nasdaq gives, kept per share (see dailyCloses) */
export interface DailyCloses {
  /** the share's bars for the reference close before `now`, read once per share per reference close (the global rule): a read that failed or
   * lacked the reference session's bar is asked again no sooner than DAYS_RETRY_MS, and what is at hand in the meantime is answered (the bars
   * of an earlier close, where there are any). Null where Nasdaq does not know the symbol */
  bars(symbol: string, now: number): Promise<readonly Candle[] | null | Refusal>;
  /** the bars at hand for the share, without reading — the latest kept, whichever close they were read for */
  held(symbol: string): readonly Candle[] | undefined;
  /** whether a read of the share for the reference close before `now` is worth one of a listing's NASDAQ_AT_ONCE slots: none made yet for
   * that close, one on its way (it is shared, and waited for), or one that did not find the session's bar and whose retry is due. False
   * where the last read for that close found the bar, or answered null, a refusal or bars without the bar and its retry is not due yet —
   * bars() would only say that answer again, so a slot given to it is a slot another share does not get */
  due(symbol: string, now: number): boolean;
  clear(): void;
}

/** the New York date of `ms` as Nasdaq's chart page asks it: YYYY-MM-DD */
const ymd = (ms: number): string => {
  const t = et(ms);
  return `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
};

/** NASDAQ'S DAILY BARS, one read per share per reference close (see DailyCloses), by `nasdaq.daily` — through Nasdaq's one lane and one hold,
 * as every ask of it goes. Two asks of one share at once share the one read */
export function dailyCloses(nasdaq: Pick<Nasdaq, "daily">, clock: () => number): DailyCloses {
  interface Entry {
    /** the reference close (its instant) the last read was for */
    ref: number;
    /** the last bars read, kept past the next close: their latest bar is stale, the ones before it are not */
    bars?: readonly Candle[] | undefined;
    /** what the last read said when it gave no bars: null (not known) or its refusal */
    said?: null | Refusal | undefined;
    /** the last read found the reference session's bar */
    found: boolean;
    /** the earliest a read that did not find it is made again */
    retryAt: number;
    reading?: Promise<void> | undefined;
  }
  const kept = new Map<string, Entry>();
  const sym = (s: string) => s.trim().toUpperCase();
  const answer = (e: Entry): readonly Candle[] | null | Refusal => e.bars ?? e.said ?? null;
  return {
    async bars(symbol, now) {
      const s = sym(symbol);
      const ref = closedSessionBefore(now);
      let e = kept.get(s);
      if (!ref) return e ? answer(e) : null;
      if (e?.reading) {
        await e.reading;
        return answer(e);
      }
      if (e && e.ref === ref.closesAt && (e.found || clock() < e.retryAt)) return answer(e);
      if (!e) {
        e = { ref: ref.closesAt, found: false, retryAt: 0 };
        kept.set(s, e);
        if (kept.size > SHARES_KEPT) kept.delete(kept.keys().next().value!);
      }
      const entry = e;
      entry.reading = (async () => {
        // a read that throws (a stand-in, a fault below the guard) is Nasdaq not answering, said as such — never "Nasdaq does not know it"
        const d = await nasdaq.daily(s, ymd(ref.closesAt - LOOKBACK_MS), ymd(ref.closesAt)).catch((err: unknown): Refusal => unreachable("nasdaq", "Nasdaq", err));
        entry.ref = ref.closesAt;
        entry.retryAt = clock() + DAYS_RETRY_MS;
        if (d === null || isRefusal(d)) {
          entry.said = d;
          entry.found = false;
        } else {
          entry.bars = d.bars;
          entry.said = undefined;
          entry.found = closeOfSession(d.bars, ref) !== undefined;
        }
      })().finally(() => {
        entry.reading = undefined;
      });
      await entry.reading;
      return answer(entry);
    },
    held: (symbol) => kept.get(sym(symbol))?.bars,
    due(symbol, now) {
      const ref = closedSessionBefore(now);
      const e = kept.get(sym(symbol));
      if (!ref) return false;
      if (!e || e.reading) return true;
      return !(e.ref === ref.closesAt && (e.found || clock() < e.retryAt));
    },
    clear: () => kept.clear(),
  };
}
