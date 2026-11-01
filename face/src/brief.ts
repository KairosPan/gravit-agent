// face/src/brief.ts
/** The pre-close brief: `builtin:brief`, the first built-in producer (rulings P2-2, P2-5, P2-14; spec §5.9).
 *
 * WHAT IT GIVES. A standing order's producer runs before the order's turn, and the firing quotes its text in the
 * wake message beside the order's own (desk/STANDING.md). This producer's text is a {@link Brief} as JSON: the
 * index and sector ETFs' day moves, the operator's holdings against their stops and targets, and the levels within
 * {@link NEAR_PCT}% of triggering - the block the model writes the operator's pre-close message from.
 *
 * WHAT IT READS. The desk's own book and nothing else: `desk/holdings.yml` and `desk/levels.yml`, each through
 * desk-book.ts's loaders, whose results it carries as they are: a refused entry is a refusal in the brief, a refused
 * file an error, and a missing file is `missing` (holdings) or absent from `files` (levels). NOT a strategy's
 * `strategies/<name>/levels.yml`: those sit in directories the research sessions can write, and the brief quotes a
 * level's plan into an unattended turn whose text reaches the phone, so they join the brief only once P4 pins each one
 * at arming (charter D20; the P2 fix wave's I3) - `notYet` says so, and the model does not report them as nothing.
 * Then ONE `hub.snapshot()` over the index ETFs, the sector ETFs, the holdings and the levels' symbols, in that order,
 * each once and at most {@link BRIEF_SYMBOLS_MAX} of them - below the hub's cache limit, which would refuse the whole
 * snapshot as busy - those past the bound named in `quotesOmitted` (p2-m15): the face's live quotes, the numbers
 * `desk_quotes` shows (P2-2 - no Python and no bars). Before any of it, the firing's ET date is checked once: one that
 * is not `YYYY-MM-DD` fails the producer with one error, and nothing is read or asked.
 *
 * EVERY NUMBER NAMES ITS SOURCE AND TIME (dsh/profile/desk.md). A price carries `at`, desk-tools.ts's `quoteTime`:
 * the feed and New York's clock to the second (`IEX 15:21:03 ET`), dated when the quote is from another ET day. The
 * brief's own time is `takenAt`, and the holdings file's last edit is `edited`, as desk.ts's `deskTime` writes a
 * time. Nothing is shown that the snapshot cannot time: a quote without a price - or without the time that price was
 * traded at - shows no number at all (`last`, `prevClose`, `chgPct` and `at` null), and every number measured from
 * it (a P&L, a distance) is null too. Percentages and P&L are rounded to 2 decimals, half away from zero.
 *
 * INFORMS ONLY (B2). It measures - a day's move from the previous close, P&L against the operator's own cost, the
 * distance to the operator's own levels - and proposes nothing. A holding's `dayPnl` is measured from the previous
 * close, as if the position was held at it: for a position opened today it is not the broker's day P&L, which runs
 * from the fill.
 *
 * FAILURES ARE DATA. Past the date check, the brief fails - `{ ok: false }` - only when its prices are unavailable,
 * and it still carries itself: the files read, every price null, `quotesError` set, so the firing quotes it and the
 * model can say what is unavailable. `quotesError` is:
 * - `quotes unavailable: busy` when the hub refuses with 429 - its own message is the quotes page's, in Chinese;
 * - `quotes unavailable: <message>` for any other throw;
 * - `quotes unavailable: the hub has no price for any symbol (alpaca <state>)` when the snapshot answers without a
 *   single price - no keys, or a feed that is down - `<state>` the US provider's state as its English word
 *   (`unconfigured`, `error`, …), and `unknown` when the payload names no US provider or a state that is not one of
 *   those words: never its UI message. A brief with no price is no success.
 * A file that is missing, refused or unreadable is named in its block and never fails the brief.
 * {@link briefProducer} never rejects.
 *
 * A CUT KEEPS THE ERRORS. The firing quotes at most 32,768 characters of a producer's text (producer.ts
 * `PRODUCER_TEXT_MAX`) and cuts the rest, so the brief's keys are written with the long lists last: `quotesError`
 * straight after the session, ahead of every quote; in each block, the file's state and its errors ahead of its rows,
 * near levels and refusals; `notYet` at the very end. A book past the cap loses the tail of its refusals and of its
 * near levels - nearest first, so the farthest go - before the levels error, with one exception: the holdings rows
 * come ahead of the whole levels block, so many long-labelled holdings can push the levels error past the cap first.
 *
 * MODULE WEIGHT. It brings desk-book.ts (and js-yaml with it) and desk.ts, so only a firing loads it
 * - through the schedule, itself loaded on first use - and the pause switch (scripts/desk.ts) never does.
 * @module
 */
import { join } from "node:path";
import { loadHoldings, loadLevels, type Holding, type Level, type LevelKind, type LoadRefusal } from "./desk-book.ts";
import { deskTime } from "./desk.ts";
import { quoteTime } from "./desk-tools.ts";
import { etClock, etTime } from "./et.ts";
import { HttpError } from "./http.ts";
import type { BuiltinProducer, ProducerInput, ProducerOutput } from "./producer.ts";
import type { UsLiveQuote as LiveQuote, UsProviderState as ProviderState, UsQuoteIdentity as QuoteIdentity, UsQuotePayload as QuotePayload, UsQuoteSource } from "./us-quotes.ts";
import { isEtDate } from "./standing.ts";

/* ---------- the symbols ---------- */

/** The index ETFs the brief opens with: the S&P 500, the Nasdaq-100, the Russell 2000 and the Dow. */
export const BRIEF_INDEXES = ["SPY", "QQQ", "IWM", "DIA"] as const;

/** The eleven Select Sector SPDR ETFs. */
export const BRIEF_SECTORS = ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"] as const;

/** The most symbols one brief asks the hub for: well below the hub's cache limit (512, its own and the page's quotes
 * counted with them), past which the hub refuses the snapshot whole. The book's caps (60 holdings, 40 levels) and the
 * 15 ETFs stay under it today; P4's strategies' levels would not. */
export const BRIEF_SYMBOLS_MAX = 200;

/** A quote's status when the brief left its symbol out of the snapshot: past {@link BRIEF_SYMBOLS_MAX}. */
const OMITTED = "omitted: past the brief's symbol bound";

/** A level within this many percent of the last price, either way, is near: about to trigger. */
export const NEAR_PCT = 2;

/** The book's files, as the brief labels them: repo-relative. */
const HOLDINGS_FILE = "desk/holdings.yml";
const DESK_LEVELS_FILE = "desk/levels.yml";
/** What the brief does not carry yet, said in the brief so the model does not report it as nothing. */
const NOT_YET = "alerts, suppressed alerts and filings arrive with the watch (P3); strategies' levels.yml join once each is pinned at arming (P4)";

/** A quote's status when the snapshot holds none for its symbol: the hub's own word for a symbol without a price. */
const UNAVAILABLE = "unavailable";

/** `quotesError` when the hub refuses with 429, in the plan's words: the hub's own message is the quotes page's, in
 * Chinese, and never reaches the model. */
const QUOTES_BUSY = "quotes unavailable: busy";

/** The states a priceless brief may name: quote-types.ts's `ProviderState` status, English words all. Anything else
 * the payload holds is written `unknown`. */
const PROVIDER_STATES: ReadonlySet<string> = new Set<ProviderState["status"]>(["connecting", "connected", "unconfigured", "error", "limited"]);

/* ---------- the shapes ---------- */

/** What the brief closes over: the quote hub's snapshot (the one hub main.ts shares with `/data/quotes` and
 * `desk_quotes`), the repository root its files are read under, and `now` (default `Date.now`), the clock the
 * brief's times are read against, for tests. */
export interface BriefDeps {
  hub: UsQuoteSource;
  root: string;
  now?: () => number;
  /** The symbol bound, {@link BRIEF_SYMBOLS_MAX} by default; for tests. */
  symbolsMax?: number;
}

/** One quote as the brief carries it: the last price; its move from the previous close, in percent; the previous
 * close; `at`, the feed and New York's time (`IEX 15:21:03 ET`); and `status`, the hub's `quote_status`. Without a
 * price, or without the time it was traded at, `last`, `chgPct`, `prevClose` and `at` are all null. The hub's UI
 * message is left out. */
export interface BriefQuote {
  symbol: string;
  last: number | null;
  chgPct: number | null;
  prevClose: number | null;
  at: string | null;
  status: string;
}

/** A holding's stop or target: the level's price - or its range, for a level written as one - and its `when`, so a
 * level the price has already gone through reads as crossed (a `cross_down` stop with a distance above 0); how far
 * it is from the last price, in percent (null without a price); and the file it came from. */
export interface LevelRef {
  price?: number;
  range?: [number, number];
  when: Level["when"];
  distancePct: number | null;
  file: string;
}

/** One holding, priced: its quote; what the operator typed - `qty` (below 0, a short), `avgCost`, and `opened` and
 * `broker` when written; the day's P&L, `qty·(last − prevClose)` - not the broker's for a position opened today -
 * and the open P&L, `qty·(last − avgCost)`; the stop and the target nearest the last price, from any levels file;
 * and `noStop`, true when no loaded level is a stop for its symbol. */
export type HoldingRow = BriefQuote & {
  qty: number;
  avgCost: number;
  opened?: string;
  broker?: string;
  dayPnl: number | null;
  openPnl: number | null;
  stop: LevelRef | null;
  target: LevelRef | null;
  noStop: boolean;
};

/** A level within {@link NEAR_PCT}% of the last price: the level as the operator wrote it and the file it came
 * from, the last price and its time, and the distance in percent - 0 inside a range. */
export interface NearLevel {
  symbol: string;
  kind: LevelKind;
  price?: number;
  range?: [number, number];
  when: Level["when"];
  plan: string;
  file: string;
  last: number;
  at: string;
  distancePct: number;
}

/** The brief, as its text holds it, its keys in the order its text writes them (see the module header: a cut keeps
 * the errors). `session` is the firing's session in New York's time; `holdings.edited` is when `desk/holdings.yml`
 * was last written, null when it was not read; `levels.files` lists the levels files present, read or refused;
 * `levels.loaded` counts the levels that loaded; `near` lists the near levels nearest first; `sectors` come
 * strongest first, those without a move after them. */
export interface Brief {
  date: string;
  takenAt: string;
  session: { open: string; close: string; early: boolean };
  quotesError?: string;
  quotesOmitted?: string[];
  indexes: BriefQuote[];
  sectors: BriefQuote[];
  holdings: {
    file: "desk/holdings.yml";
    edited: string | null;
    missing?: true;
    error?: string;
    rows: HoldingRow[];
    refusals: LoadRefusal[];
  };
  levels: {
    files: string[];
    loaded: number;
    errors: { file: string; error: string }[];
    near: NearLevel[];
    refusals: LoadRefusal[];
  };
  notYet: typeof NOT_YET;
}

/* ---------- the numbers ---------- */

/** A thrown value's message. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" ? message : String(error);
}

/** Whether `value` is a price as the hub keeps one: a finite number above 0. */
function isPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** `value` to 2 decimals, half away from zero - a loss and a gain of one size round alike - and never `-0`. */
function round2(value: number): number {
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * 100)) / 100;
  return rounded === 0 ? 0 : rounded;
}

/**
 * How far `level` is from `last`, in percent of `last`: `(level − last) / last · 100` for a price; for a range, 0
 * inside it (its edges included), else measured to its nearest edge. Below 0 when the level is under the price.
 * Unrounded.
 * @param level - a level as desk-book.ts loads it: a price or a range.
 * @param last - the last price, above 0.
 */
function levelDistancePct(level: Pick<Level, "price" | "range">, last: number): number {
  let edge: number;
  if (level.range !== undefined) {
    const [low, high] = level.range;
    if (last >= low && last <= high) return 0;
    edge = last < low ? low : high;
  } else {
    edge = level.price as number;
  }
  return ((edge - last) / last) * 100;
}

/** A level's price, or its range, as the brief writes it. */
function levelAt(level: Level): { price: number } | { range: [number, number] } {
  return level.range !== undefined ? { range: [level.range[0], level.range[1]] } : { price: level.price as number };
}

/* ---------- the quotes ---------- */

/**
 * One quote as the brief carries it ({@link BriefQuote}), from the snapshot's quote for `symbol`. A price counts only
 * with the time it was traded at - the hub's own rule for `unavailable` - and a quote without one shows no number at
 * all, its previous close included: a number that cannot name its time is never shown.
 * @param symbol - the ticker.
 * @param quote - the snapshot's quote; `undefined` when the snapshot holds none for it, or failed.
 * @param now - when the brief is taken: what "today" is for {@link quoteTime}.
 */
function briefQuote(symbol: string, quote: LiveQuote | undefined, now: number): BriefQuote {
  const status = quote?.quote_status ?? UNAVAILABLE;
  const price = quote?.price;
  const asOf = quote?.as_of;
  if (quote === undefined || !isPrice(price) || typeof asOf !== "string") {
    return { symbol, last: null, chgPct: null, prevClose: null, at: null, status };
  }
  const prevClose = isPrice(quote.prev_close) ? quote.prev_close : null;
  return {
    symbol,
    last: price,
    chgPct: prevClose === null ? null : round2(((price - prevClose) / prevClose) * 100),
    prevClose,
    at: quoteTime(typeof quote.feed === "string" ? quote.feed : "", asOf, now),
    status,
  };
}

/** The sector ETFs strongest first by the day's move; those without a move after them, in their own order. */
function strongestFirst(quotes: readonly BriefQuote[]): BriefQuote[] {
  const moved = quotes.filter((quote) => quote.chgPct !== null);
  moved.sort((a, b) => (b.chgPct as number) - (a.chgPct as number));
  return [...moved, ...quotes.filter((quote) => quote.chgPct === null)];
}

/** The US provider's state in a snapshot's payload, as its English word ({@link PROVIDER_STATES}); `unknown` when
 * the payload names none, or names something else. */
function usProviderState(payload: QuotePayload | undefined): string {
  const providers: unknown = payload?.providers;
  const state = Array.isArray(providers)
    ? (providers as Partial<ProviderState>[]).find((provider) => provider?.market === "us")?.status
    : undefined;
  return typeof state === "string" && PROVIDER_STATES.has(state) ? state : "unknown";
}

/* ---------- the book ---------- */

/** The level among `levels` nearest `last`, as a {@link LevelRef}: the first in file order on a tie, and the first
 * outright when there is no price to measure from; null when `levels` is empty. */
function nearestRef(levels: readonly Level[], last: number | null): LevelRef | null {
  let best: Level | undefined;
  let bestDistance = Infinity;
  for (const level of levels) {
    const distance = last === null ? 0 : Math.abs(levelDistancePct(level, last));
    if (best === undefined || distance < bestDistance) {
      best = level;
      bestDistance = distance;
    }
  }
  if (best === undefined) return null;
  return {
    ...levelAt(best),
    when: best.when,
    distancePct: last === null ? null : round2(levelDistancePct(best, last)),
    file: best.file,
  };
}

/** One holding priced from its quote, with its stop and target from `levels`, every levels file's. */
function holdingRow(holding: Holding, quote: BriefQuote, levels: readonly Level[]): HoldingRow {
  const own = levels.filter((level) => level.symbol === holding.symbol);
  const stops = own.filter((level) => level.kind === "stop");
  const { last, prevClose } = quote;
  return {
    ...quote,
    qty: holding.qty,
    avgCost: holding.avgCost,
    ...(holding.opened === undefined ? {} : { opened: holding.opened }),
    ...(holding.broker === undefined ? {} : { broker: holding.broker }),
    dayPnl: last === null || prevClose === null ? null : round2(holding.qty * (last - prevClose)),
    openPnl: last === null ? null : round2(holding.qty * (last - holding.avgCost)),
    stop: nearestRef(stops, last),
    target: nearestRef(own.filter((level) => level.kind === "target"), last),
    noStop: stops.length === 0,
  };
}

/** The levels within {@link NEAR_PCT}% of their symbol's last price - the rounded distance, as the brief shows it -
 * nearest first, file order on a tie. A level whose symbol has no price is never near: there is nothing to measure. */
function nearLevels(levels: readonly Level[], quotes: ReadonlyMap<string, BriefQuote>): NearLevel[] {
  const near: NearLevel[] = [];
  for (const level of levels) {
    const quote = quotes.get(level.symbol);
    if (quote === undefined || quote.last === null || quote.at === null) continue;
    const distancePct = round2(levelDistancePct(level, quote.last));
    if (Math.abs(distancePct) > NEAR_PCT) continue;
    near.push({
      symbol: level.symbol, kind: level.kind, ...levelAt(level), when: level.when, plan: level.plan, file: level.file,
      last: quote.last, at: quote.at, distancePct,
    });
  }
  return near.sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct));
}

/** A session instant (`2026-10-20T13:30:00Z`) as New York's wall time, `09:30 ET`; one `Date` cannot read stays as given. */
function sessionTime(instant: string): string {
  return Number.isFinite(Date.parse(instant)) ? etTime(new Date(instant)) : instant;
}

/* ---------- the brief ---------- */

/**
 * Build the pre-close brief for one firing (see the module header): check the firing's date, read the book, take
 * one snapshot, price the book from it. Never rejects for a file or a hub: what fails is named in the brief.
 * @param deps - the hub, the repository root and the clock.
 * @param input - the firing: `date` is the ET date a level's expiry is judged against, `session` the times shown.
 * @returns `{ ok: true, text }`, the {@link Brief} as JSON; when the prices are unavailable - the hub threw, or its
 *   snapshot holds no price at all - `{ ok: false, error, text }`, `error` being the brief's `quotesError` and
 *   `text` the brief with every price null; and when `input.date` is not a `YYYY-MM-DD` date, `{ ok: false, error:
 *   "the brief takes the firing's ET date as YYYY-MM-DD, not \"<date>\"" }`, nothing read and nothing asked.
 */
export async function buildBrief(deps: BriefDeps, input: ProducerInput): Promise<ProducerOutput> {
  if (!isEtDate(input.date)) {
    return { ok: false, error: `the brief takes the firing's ET date as YYYY-MM-DD, not ${JSON.stringify(String(input.date).slice(0, 40))}` };
  }
  const clock = deps.now ?? Date.now;
  /* The loaders never throw: a file's every fault is in its result, and the one argument they refuse - the date - is
   * checked above. */
  const [holdings, deskLevels] = await Promise.all([
    loadHoldings(join(deps.root, "desk", "holdings.yml"), HOLDINGS_FILE),
    loadLevels(join(deps.root, "desk", "levels.yml"), DESK_LEVELS_FILE, input.date),
  ]);
  const levelResults = [deskLevels];
  const levels = levelResults.flatMap((result) => result.entries);

  const symbols = [...new Set<string>([
    ...BRIEF_INDEXES, ...BRIEF_SECTORS, ...holdings.entries.map((holding) => holding.symbol), ...levels.map((level) => level.symbol),
  ])];
  /* the first ones in the order above are asked; the rest are named, never silently dropped */
  const bound = deps.symbolsMax ?? BRIEF_SYMBOLS_MAX;
  const asked = symbols.slice(0, bound);
  const omitted = symbols.slice(bound);
  const snapshot = new Map<string, LiveQuote>();
  let payload: QuotePayload | undefined;
  let quotesError: string | undefined;
  try {
    const assets = asked.map((symbol): QuoteIdentity => ({ id: `us:${symbol}`, market: "us", symbol }));
    payload = await deps.hub.snapshot(assets);
    for (const quote of payload.quotes) snapshot.set(quote.id, quote);
  } catch (error) {
    quotesError = error instanceof HttpError && error.status === 429 ? QUOTES_BUSY : `quotes unavailable: ${messageOf(error)}`;
  }

  const now = clock();
  const left = new Set(omitted);
  const quotes = new Map(symbols.map((symbol) => [
    symbol,
    left.has(symbol) ? { symbol, last: null, chgPct: null, prevClose: null, at: null, status: OMITTED } : briefQuote(symbol, snapshot.get(`us:${symbol}`), now),
  ] as const));
  if (quotesError === undefined && ![...quotes.values()].some((quote) => quote.last !== null)) {
    quotesError = `quotes unavailable: the hub has no price for any symbol (alpaca ${usProviderState(payload)})`;
  }
  /* Every symbol the brief prices is one the snapshot was asked for, so each has its quote. */
  const quoteFor = (symbol: string): BriefQuote => quotes.get(symbol) as BriefQuote;

  /* The keys in the order the text writes them: the errors ahead of the long lists, so a cut keeps them. */
  const brief: Brief = {
    date: input.date,
    takenAt: `${etClock(new Date(now))} ET`,
    session: { open: sessionTime(input.session.open), close: sessionTime(input.session.close), early: input.session.early },
    ...(quotesError === undefined ? {} : { quotesError }),
    ...(omitted.length === 0 ? {} : { quotesOmitted: omitted }),
    indexes: BRIEF_INDEXES.map((symbol) => quoteFor(symbol)),
    sectors: strongestFirst(BRIEF_SECTORS.map((symbol) => quoteFor(symbol))),
    holdings: {
      file: HOLDINGS_FILE,
      edited: holdings.mtime === undefined ? null : deskTime(new Date(holdings.mtime), new Date(now)),
      ...(holdings.missing === true ? { missing: true as const } : {}),
      ...(holdings.error === undefined ? {} : { error: holdings.error }),
      rows: holdings.entries.map((holding) => holdingRow(holding, quoteFor(holding.symbol), levels)),
      refusals: holdings.refusals,
    },
    levels: {
      files: levelResults.filter((result) => result.missing !== true).map((result) => result.file),
      loaded: levels.length,
      errors: deskLevels.error === undefined ? [] : [{ file: deskLevels.file, error: deskLevels.error }],
      near: nearLevels(levels, quotes),
      refusals: levelResults.flatMap((result) => result.refusals),
    },
    notYet: NOT_YET,
  };
  const text = JSON.stringify(brief);
  return quotesError === undefined ? { ok: true, text } : { ok: false, error: quotesError, text };
}

/** A builtin's answer when its signal stopped it: `stopped: <the signal's reason>`. */
function stopped(signal: AbortSignal): ProducerOutput {
  return { ok: false, error: `stopped: ${signal.reason === undefined ? "aborted" : messageOf(signal.reason)}` };
}

/**
 * The brief as a built-in producer, `builtin:brief`: {@link buildBrief} over `deps` for each firing's input. It stops
 * when `signal` aborts - the firing's deadline - settling at once with `{ ok: false, error: "stopped: <reason>" }`,
 * and starts nothing when the signal has already aborted; what it started (a file read, the hub's shared refresh)
 * runs on to its own end, unread. It never rejects: anything the brief did not expect is `{ ok: false, error: "the
 * brief failed: <message>" }`.
 * @param deps - the hub, the repository root and the clock.
 */
export function briefProducer(deps: BriefDeps): BuiltinProducer {
  return (input, signal) => {
    if (signal.aborted) return Promise.resolve(stopped(signal));
    return new Promise<ProducerOutput>((resolve) => {
      const onAbort = (): void => resolve(stopped(signal));
      signal.addEventListener("abort", onAbort, { once: true });
      const settle = (output: ProducerOutput): void => {
        signal.removeEventListener("abort", onAbort);
        resolve(output);
      };
      buildBrief(deps, input).then(settle, (error: unknown) => settle({ ok: false, error: `the brief failed: ${messageOf(error)}` }));
    });
  };
}
