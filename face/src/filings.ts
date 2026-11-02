// face/src/filings.ts
/** The filings' decisions, pure: which symbols the watch polls SEC for, when a poll is due, which filing may ping,
 * and the baseline `filings.jsonl` keeps (plan ruling 9). src/edgar.ts reads SEC; src/watch.ts drives both.
 *
 * SYMBOLS. The filing rules' resolved US symbols, holdings first, at most {@link FILINGS_SYMBOLS_MAX}; A shares are
 * skipped and counted, SEC listing none.
 *
 * THE WINDOW. A poll is due every {@link FILINGS_POLL_MS}, 07:00-20:00 ET ({@link FILINGS_WINDOW_MIN}, the end
 * excluded), on an XNYS session day. A filing may ping only when accepted on today's ET date inside that window; any
 * other is `suppressed: window`.
 *
 * THE BASELINE. A symbol's first good poll - one with no `errors` entry for it - seeds it silently with every
 * accession that poll listed (a `seeded` record). After that, an accession the symbol has not listed before is
 * fresh, and is recorded `seen` once judged. A symbol that fails stays unseeded, so a poll that cannot read it never
 * mistakes its whole history for news. Accessions are kept per symbol: two tickers on one CIK (`GOOG`, `GOOGL`) each
 * judge the filing.
 * @module
 */
import type { Holding, Level, Rule } from "./desk-book.ts";
import { resolveSymbols } from "./desk-book.ts";
import type { EdgarResult, Filing } from "./edgar.ts";
import type { DayAnswer } from "./market-clock.ts";
import { etClock, etDate } from "./et.ts";
import { marketOf } from "./symbols.ts";

/** The least time between two polls' starts. */
export const FILINGS_POLL_MS = 300_000;
/** No symbol starts after this long into a poll. */
export const FILINGS_STOP_AFTER_MS = 90_000;
/** A poll is aborted after this long. */
export const FILINGS_ABORT_MS = 120_000;
/** How many days back a poll asks for: filings dated on or after today's ET date less these. */
export const FILINGS_LOOKBACK_DAYS = 7;
/** The window, in minutes after 00:00 ET: 07:00 included, 20:00 excluded. */
export const FILINGS_WINDOW_MIN = [420, 1200] as const;
/** The most symbols polled. */
export const FILINGS_SYMBOLS_MAX = 60;

/* ---------- the records ---------- */

/** A `filings.jsonl` line: a symbol seeded with the accessions its first good poll listed, or one filing judged. */
export type FilingRecord =
  | { t: string; kind: "seeded"; symbol: string; accessions: string[] }
  | { t: string; kind: "seen"; symbol: string; accession: string; form: string; filingDate: string; accepted: string | null; items: string | null; url: string };

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isText = (x: unknown): x is string => typeof x === "string" && x !== "";
const isTextOrNull = (x: unknown): boolean => x === null || typeof x === "string";

/** Whether `x` is a {@link FilingRecord}. */
export function isFilingRecord(x: unknown): x is FilingRecord {
  if (!isObject(x) || !isText(x.t) || !isText(x.symbol)) return false;
  switch (x.kind) {
    case "seeded":
      return Array.isArray(x.accessions) && x.accessions.every(isText);
    case "seen":
      return isText(x.accession) && isText(x.form) && isText(x.filingDate) && isTextOrNull(x.accepted) && isTextOrNull(x.items) && isText(x.url);
    default:
      return false;
  }
}

/** The key {@link Baseline.seen} holds for a symbol's accession. */
export const seenKey = (symbol: string, accession: string): string => `${symbol} ${accession}`;

/** What `filings.jsonl` says so far: the symbols seeded, and each symbol's accessions listed ({@link seenKey}). */
export interface Baseline {
  seeded: Set<string>;
  seen: Set<string>;
}

/**
 * The baseline from `filings.jsonl`'s lines; anything not a {@link FilingRecord} is skipped.
 * @param records - the file's lines, parsed.
 */
export function baselineFrom(records: readonly unknown[]): Baseline {
  const base: Baseline = { seeded: new Set(), seen: new Set() };
  for (const r of records) {
    if (!isFilingRecord(r)) continue;
    if (r.kind === "seeded") {
      base.seeded.add(r.symbol);
      for (const accession of r.accessions) base.seen.add(seenKey(r.symbol, accession));
    } else {
      base.seen.add(seenKey(r.symbol, r.accession));
    }
  }
  return base;
}

/**
 * What a poll changes: the symbols it seeds, and the filings fresh for the symbols already seeded, each once, in the
 * result's order. Only `symbols` are read; a symbol with an `errors` entry is neither seeded nor judged. Pure: the
 * watch appends the records and folds them into its baseline.
 * @param base - the baseline before the poll.
 * @param result - the poll's result.
 * @param symbols - the symbols polled.
 */
export function diffFilings(base: Baseline, result: EdgarResult, symbols: readonly string[]): { seed: { symbol: string; accessions: string[] }[]; fresh: Filing[] } {
  const failed = new Set(result.errors.map((e) => e.symbol));
  const seed: { symbol: string; accessions: string[] }[] = [];
  const fresh: Filing[] = [];
  for (const symbol of symbols) {
    if (failed.has(symbol)) continue;
    const listed = result.filings.filter((f) => f.symbol === symbol);
    if (!base.seeded.has(symbol)) {
      seed.push({ symbol, accessions: [...new Set(listed.map((f) => f.accession))] });
      continue;
    }
    const taken = new Set<string>();
    for (const f of listed) {
      const key = seenKey(symbol, f.accession);
      if (base.seen.has(key) || taken.has(key)) continue;
      taken.add(key);
      fresh.push(f);
    }
  }
  // the result's order, not the symbols'
  const rank = new Map(result.filings.map((f, i) => [f, i]));
  fresh.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  return { seed, fresh };
}

/* ---------- the decisions ---------- */

/**
 * The first error, when SEC refused every symbol polled (each one's error starts `refused:`); else `undefined`.
 * @param result - the poll's result.
 * @param symbols - the symbols polled; a symbol with no error answered.
 */
export function allRefused(result: EdgarResult, symbols: readonly string[]): string | undefined {
  if (symbols.length === 0) return undefined;
  const bySymbol = new Map(result.errors.map((e) => [e.symbol, e.error]));
  for (const symbol of symbols) if (!bySymbol.get(symbol)?.startsWith("refused:")) return undefined;
  return bySymbol.get(symbols[0]);
}

/** Whether `answer` makes the ET date of `now` an XNYS session day. A stale answer still counts. */
function sessionDay(answer: DayAnswer | undefined, now: number): boolean {
  return answer !== undefined && answer.ok && answer.session !== "closed" && answer.date === etDate(new Date(now));
}

/** Whether the instant `at` falls inside {@link FILINGS_WINDOW_MIN} on New York's clock. */
function inWindow(at: Date): boolean {
  const [hh, mm] = etClock(at).split(":").map(Number);
  const minute = hh * 60 + mm;
  return minute >= FILINGS_WINDOW_MIN[0] && minute < FILINGS_WINDOW_MIN[1];
}

/**
 * Whether a poll is due at `now`: a session day, inside the window, and {@link FILINGS_POLL_MS} or more after the
 * last poll began.
 * @param now - the instant, in ms since the epoch.
 * @param lastPollAt - when the last poll began; `undefined` before the first.
 * @param sessionToday - XNYS's answer for today's ET date.
 */
export function pollDue(now: number, lastPollAt: number | undefined, sessionToday: DayAnswer | undefined): boolean {
  if (!sessionDay(sessionToday, now) || !inWindow(new Date(now))) return false;
  return lastPollAt === undefined || now - lastPollAt >= FILINGS_POLL_MS;
}

/**
 * Whether a filing may ping: accepted on the ET date of `now`, inside the window, on a session day. A `null` or an
 * unreadable acceptance is judged at `now`.
 * @param accepted - the filing's acceptance time, as src/edgar.ts writes it.
 * @param sessionToday - XNYS's answer for today's ET date.
 * @param now - the instant, in ms since the epoch.
 */
export function inFilingWindow(accepted: string | null, sessionToday: DayAnswer | undefined, now: number): boolean {
  if (!sessionDay(sessionToday, now)) return false;
  const parsed = accepted === null ? Number.NaN : Date.parse(accepted);
  const at = new Date(Number.isFinite(parsed) ? parsed : now);
  return etDate(at) === etDate(new Date(now)) && inWindow(at);
}

/* ---------- the symbols ---------- */

/**
 * The symbols the watch polls SEC for: the filing rules' resolved US symbols, the holdings' first in their order and
 * then the rest sorted, at most {@link FILINGS_SYMBOLS_MAX}; `overCap` the ones past it, `aShares` how many A shares
 * the rules named.
 * @param rules - every rule loaded; only `filing` rules are read.
 * @param book - the holdings and the levels loaded.
 */
export function filingSymbols(rules: readonly Rule[], book: { holdings: Holding[]; levels: Level[] }): { polled: string[]; overCap: string[]; aShares: number } {
  const names = { holdings: book.holdings.map((h) => h.symbol), levels: book.levels.map((l) => l.symbol) };
  const all = new Set<string>();
  for (const rule of rules) if (rule.kind === "filing") for (const symbol of resolveSymbols(rule.symbols, names)) all.add(symbol);
  const us = [...all].filter((s) => marketOf(s) === "us");
  const aShares = [...all].filter((s) => marketOf(s) === "cn").length;
  const held = names.holdings.filter((s, i, list) => all.has(s) && marketOf(s) === "us" && list.indexOf(s) === i);
  const ordered = [...held, ...us.filter((s) => !held.includes(s)).sort()];
  return { polled: ordered.slice(0, FILINGS_SYMBOLS_MAX), overCap: ordered.slice(FILINGS_SYMBOLS_MAX), aShares };
}
