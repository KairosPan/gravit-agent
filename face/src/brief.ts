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
 * at arming (charter D28; the P2 fix wave's I3) - `scope` says so, and the model does not report them as nothing.
 * THE BRIEF IS US. An A-share holding or level (src/symbols.ts: six digits) is neither priced nor listed here; the
 * brief counts them in `aShares`, and the watch and the strategies' reports are theirs (ruling 11).
 * THE WATCH'S BLOCKS (ruling 11). `alerts` and `filings` list what the watch (src/watch.ts) wrote to the desk's
 * ledgers since the order's previous brief ({@link briefSince}): `alerts.jsonl`'s alerts - both markets', for the
 * brief's prices stay US but its alerts are the day's - each with its outcome, and `filings.jsonl`'s filings judged,
 * each `alerted` or not. Each keeps its newest {@link BRIEF_WATCH_ITEMS_MAX}, newest first, and counts the rest. A
 * ledger that cannot be read is its block's `error`, and a brief given no home says `no ledger`; neither fails it.
 * Then ONE `quotes.snapshot()` over the index ETFs, the sector ETFs, the US holdings and the US levels' symbols, in
 * that order, each once and at most {@link BRIEF_SYMBOLS_MAX} of them - one Market explore read each - those past the
 * bound named in `quotesOmitted` (p2-m15): the numbers `desk_quotes` shows (P2-2 - no Python and no bars). Before any of it, the firing's ET date is checked once: one that
 * is not `YYYY-MM-DD` fails the producer with one error, and nothing is read or asked.
 *
 * EVERY NUMBER NAMES ITS SOURCE AND TIME (dsh/profile/desk.md). A price carries `at`, desk-tools.ts's `quoteTime`:
 * the feed and New York's clock to the second (`NASDAQ 15:21:03 ET`), dated when the quote is from another ET day. The
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
 * - `quotes unavailable: busy` when the source refuses with 429;
 * - `quotes unavailable: <message>` for any other throw - why the Account could not be asked (not reachable,
 *   timed out, the seat row disabled);
 * - `quotes unavailable: <reason>`, nothing asked, when the source is `unavailable` (src/market-quotes.ts) - main.ts
 *   wires the Market's reads, so this is a face with no Market read wired;
 * - `quotes unavailable: the source has no price for any symbol (US provider <state>)` when the snapshot answers without a
 *   single price - no keys, or a feed that is down - `<state>` the US provider's state as its English word
 *   (`unconfigured`, `error`, …), and `unknown` when the payload names no US provider or a state that is not one of
 *   those words: never its UI message. A brief with no price is no success.
 * A file that is missing, refused or unreadable is named in its block and never fails the brief.
 * {@link briefProducer} never rejects.
 *
 * A CUT TAKES THE TAIL. The firing quotes at most 32,768 characters of a producer's text (producer.ts
 * `PRODUCER_TEXT_MAX`) and cuts the rest, so the brief's keys are written with the errors early: `quotesError`
 * straight after the session, ahead of every quote; in each block, the file's state and its errors ahead of its rows,
 * near levels and refusals; the watch's blocks after the levels block, each with its counts, `more` and error ahead of
 * its items, newest first; `aShares` and `scope` at the very end. A brief past the cap loses from its end: `scope`,
 * `aShares`, then the filings' items oldest first and the filings' head, then the alerts' items oldest first and the
 * alerts' head, then the tail of the levels' refusals and near levels (nearest first, so the farthest go).
 * `quotesError` and the levels' errors come earlier and survive, with one exception: the holdings rows come ahead of
 * the whole levels block, so many long-labelled holdings can push the levels error past the cap first. A book at its
 * caps (60 holdings, 40 levels with long plans) already passes 32,768 characters, so its brief loses both watch blocks
 * whole, their counts and errors with them (DEVELOPMENT.md R71).
 *
 * MODULE WEIGHT. It brings desk-book.ts (and js-yaml with it) and desk.ts, so only a firing loads it
 * - through the schedule, itself loaded on first use - and the pause switch (scripts/desk.ts) never does.
 * @module
 */
import { join } from "node:path";
import { priceStamp } from "./alert-text.ts";
import { levelDistancePct, loadHoldings, loadLevels, type Holding, type Level, type LevelKind, type LoadRefusal } from "./desk-book.ts";
import { ALERTS_FILE, deskTime, FILINGS_FILE, FIRINGS_FILE, readRecords } from "./desk.ts";
import { quoteTime } from "./desk-tools.ts";
import { etClock, etDate, etDayStart, etTime } from "./et.ts";
import { isFilingRecord, type FilingRecord } from "./filings.ts";
import { isFiringRecord } from "./firing.ts";
import { HttpError } from "./http.ts";
import type { BuiltinProducer, ProducerInput, ProducerOutput } from "./producer.ts";
import type { MarketProviderState as ProviderState, MarketQuote as LiveQuote, MarketQuoteIdentity as QuoteIdentity, MarketQuotePayload as QuotePayload, MarketQuoteSource } from "./market-quotes.ts";
import { isEtDate } from "./standing.ts";
import type { Market } from "./symbols.ts";
import { isAlertRecord, type AlertDelivered, type AlertHit, type AlertRecord, type QuoteSnap } from "./watch-eval.ts";

/* ---------- the symbols ---------- */

/** The index ETFs the brief opens with: the S&P 500, the Nasdaq-100, the Russell 2000 and the Dow. */
export const BRIEF_INDEXES = ["SPY", "QQQ", "IWM", "DIA"] as const;

/** The eleven Select Sector SPDR ETFs. */
export const BRIEF_SECTORS = ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"] as const;

/** The most symbols one brief asks the Market's read for. The book's caps (60 holdings, 40 levels) and the 15 ETFs
 * stay under it today; P4's strategies' levels would not. */
export const BRIEF_SYMBOLS_MAX = 200;

/** A quote's status when the brief left its symbol out of the snapshot: past {@link BRIEF_SYMBOLS_MAX}. */
const OMITTED = "omitted: past the brief's symbol bound";

/** A level within this many percent of the last price, either way, is near: about to trigger. */
export const NEAR_PCT = 2;

/** The book's files, as the brief labels them: repo-relative. */
const HOLDINGS_FILE = "desk/holdings.yml";
const DESK_LEVELS_FILE = "desk/levels.yml";
/** What the brief covers, said in the brief so the model does not report what it leaves out as nothing. */
export const BRIEF_SCOPE = "desk/ only; A shares and each strategy's levels.yml are the watch's and their reports'";

/** The most items each of the brief's watch blocks lists: its newest; `more` counts the rest. */
export const BRIEF_WATCH_ITEMS_MAX = 50;

/** How many ET dates back the watch blocks reach when the order has no earlier `started` firing. */
const SINCE_DAYS_BACK = 3;

/** A watch block's `error` when the brief was given no harness home to read the ledgers under. */
const NO_LEDGER = "no ledger";

/** A quote's status when the snapshot holds none for its symbol: the source's own word for a symbol without a price. */
const UNAVAILABLE = "unavailable";

/** `quotesError` when the source refuses with 429, in the plan's words. */
const QUOTES_BUSY = "quotes unavailable: busy";

/** The states a priceless brief may name: quote-types.ts's `ProviderState` status, English words all. Anything else
 * the payload holds is written `unknown`. */
const PROVIDER_STATES: ReadonlySet<string> = new Set<ProviderState["status"]>(["connecting", "connected", "unconfigured", "error", "limited"]);

/* ---------- the shapes ---------- */

/** What the brief closes over: the Market's quote source (the one main.ts shares with `desk_quotes`), the
 * repository root its files are read under, and `now` (default `Date.now`), the clock the brief's times are read
 * against, for tests. */
export interface BriefDeps {
  quotes: Pick<MarketQuoteSource, "snapshot" | "unavailable">;
  root: string;
  /** The harness home whose desk ledgers (`firings.jsonl`, `alerts.jsonl`, `filings.jsonl`) the watch blocks read;
   * without one, both blocks carry `error: "no ledger"`. */
  home?: string;
  now?: () => number;
  /** The symbol bound, {@link BRIEF_SYMBOLS_MAX} by default; for tests. */
  symbolsMax?: number;
}

/** One quote as the brief carries it: the last price; its move from the previous close, in percent; the previous
 * close; `at`, the feed and New York's time (`NASDAQ 15:21:03 ET`); and `status`, the source's `quote_status`.
 * Without a price, or without the time it was traded at, `last`, `chgPct`, `prevClose` and `at` are all null. The
 * source's message is left out. */
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

/** Why the watch held an alert back (src/watch-eval.ts `AlertHit`'s `suppressed`). */
export type SuppressReason = NonNullable<AlertHit["suppressed"]>;

/** One alert since the last brief: when it fired (New York's time, as {@link deskTime} shows it), its market, symbol
 * and label (a filing's is its form), whether it fired as a gap, the price it read and that price's stamp
 * (src/alert-text.ts `priceStamp`: the feed and its exchange's clock) - both null for a filing - and its outcome:
 * `suppressed` with its reason, else what its `delivered` record says (`sent`, `queued` by the outlet,
 * `undelivered`), `pending` while the ledger holds no delivery for it - under way, or the face stopped first. */
export interface BriefAlert {
  at: string;
  market: Market;
  symbol: string;
  label: string;
  gap: boolean;
  price: number | null;
  stamp: string | null;
  outcome: "sent" | "queued" | "undelivered" | "suppressed" | "pending";
  suppressed?: string;
}

/** One filing the watch judged since the last brief (`filings.jsonl`'s `seen`): its form, SEC's acceptance time in
 * New York's (as given when `Date` cannot read it), its filing date, items and link, and whether an alert was sent
 * for it. */
export interface BriefFiling {
  symbol: string;
  form: string;
  accepted: string | null;
  filingDate: string;
  items: string | null;
  url: string;
  alerted: boolean;
}

/** The alerts since the last brief: `since` (New York's time), how many were sent and suppressed, by reason, and
 * the newest {@link BRIEF_WATCH_ITEMS_MAX}, newest first, `more` counting the rest; `error` when the ledger could
 * not be read, the counts then zero. */
export interface BriefAlerts {
  since: string;
  error?: string;
  sent: number;
  suppressed: number;
  byReason: Partial<Record<SuppressReason, number>>;
  more: number;
  items: BriefAlert[];
}

/** The filings since the last brief, the same way. */
export interface BriefFilings {
  since: string;
  error?: string;
  more: number;
  items: BriefFiling[];
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
  /** The alerts and the filings since the order's last brief, both markets' ({@link briefSince}). */
  alerts: BriefAlerts;
  filings: BriefFilings;
  /** The A-share holdings and levels the book loaded, which the brief neither prices nor lists. */
  aShares: { holdings: number; levels: number };
  scope: typeof BRIEF_SCOPE;
}

/* ---------- the numbers ---------- */

/** A thrown value's message. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" ? message : String(error);
}

/** Whether `value` is a price as the source keeps one: a finite number above 0. */
function isPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** `value` to 2 decimals, half away from zero - a loss and a gain of one size round alike - and never `-0`. */
function round2(value: number): number {
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * 100)) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** A level's price, or its range, as the brief writes it. */
function levelAt(level: Level): { price: number } | { range: [number, number] } {
  return level.range !== undefined ? { range: [level.range[0], level.range[1]] } : { price: level.price as number };
}

/* ---------- the quotes ---------- */

/**
 * One quote as the brief carries it ({@link BriefQuote}), from the snapshot's quote for `symbol`. A price counts only
 * with the time it was traded at - the source's own rule for `unavailable` - and a quote without one shows no number at
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

/* ---------- the watch's ledgers ---------- */

/** A ledger's failure as a block names it: its code when it has one (`EISDIR`), else its message. */
function ledgerReason(error: unknown): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : messageOf(error);
}

/** 00:00 ET of the ET date {@link SINCE_DAYS_BACK} dates before `now`'s, in ms since the epoch. */
function sinceFallback(now: number): number {
  const day = new Date(`${etDate(new Date(now))}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - SINCE_DAYS_BACK);
  return etDayStart(day.getTime());
}

/**
 * Where the watch blocks begin: the `t` of the last `started` firing of `order` for an ET date before `date` - the
 * order's previous brief, not this firing's own `started` - and with none, 00:00 ET of the ET date three dates
 * before `now`'s. Rejects when the firing ledger cannot be read, so an unreadable ledger is never an empty one.
 * @param home - the harness home.
 * @param order - the standing order's id.
 * @param date - the firing's ET date, `YYYY-MM-DD`.
 * @param now - the time the brief is taken, in ms since the epoch.
 * @returns an ISO-8601 UTC time.
 */
export async function briefSince(home: string, order: string, date: string, now: number): Promise<string> {
  const { records } = await readRecords(home, FIRINGS_FILE, isFiringRecord);
  let last = Number.NEGATIVE_INFINITY;
  for (const r of records) {
    if (r.kind !== "started" || r.order !== order || typeof r.date !== "string" || r.date >= date) continue;
    const at = Date.parse(r.t);
    if (Number.isFinite(at) && at <= now && at > last) last = at;
  }
  return new Date(Number.isFinite(last) ? last : sinceFallback(now)).toISOString();
}

/** A print as `alerts.jsonl` keeps it, when it is one the stamp can read: a price and an `asOf`. The watch is the
 * file's one writer; the guard checks only the fields the rebuild reads, so the rest is checked here. */
function snapOfRecord(quote: unknown): QuoteSnap | null {
  if (typeof quote !== "object" || quote === null) return null;
  const q = quote as Partial<QuoteSnap>;
  if (!isPrice(q.price) || typeof q.asOf !== "string" || (q.market !== "us" && q.market !== "cn")) return null;
  return { ...(q as QuoteSnap), feed: typeof q.feed === "string" ? q.feed : "" };
}

/** An alert's outcome: its gate's decision, then its `delivered` record's answer. */
function alertOutcome(r: AlertHit, delivery: AlertDelivered | undefined): BriefAlert["outcome"] {
  if (r.decision === "suppressed") return "suppressed";
  if (delivery === undefined) return "pending";
  const d = delivery.delivery as Record<string, unknown>;
  return "undelivered" in d ? "undelivered" : "sent" in d ? "sent" : "queued";
}

/** `items` in time order, newest first - file order kept on a tie - cut to {@link BRIEF_WATCH_ITEMS_MAX}, with how
 * many were cut. */
function newestFirst<T>(items: readonly { at: number; item: T }[]): { more: number; items: T[] } {
  const sorted = items.map((x, i) => ({ ...x, i })).sort((a, b) => b.at - a.at || b.i - a.i);
  /* `more` ahead of `items`, as the text writes them: a cut takes the oldest items first */
  return { more: Math.max(0, sorted.length - BRIEF_WATCH_ITEMS_MAX), items: sorted.slice(0, BRIEF_WATCH_ITEMS_MAX).map((x) => x.item) };
}

/** A ledger's records, or why it could not be read. */
type Read<T> = { records: T[] } | { error: string };

/** `file`'s records under `home`'s desk directory, or its failure as a block names it. */
function readLedger<T>(home: string, file: string, guard: (x: unknown) => x is T): Promise<Read<T>> {
  return readRecords(home, file, guard).then(({ records }) => ({ records }), (error: unknown) => ({ error: ledgerReason(error) }));
}

/** The alerts block: `alerts.jsonl`'s `alert` records at or after `sinceMs`, each joined to its `delivered` record
 * by id. */
function alertsBlock(read: Read<AlertRecord>, sinceMs: number, now: number, since: string): BriefAlerts {
  if ("error" in read) return { since, error: read.error, sent: 0, suppressed: 0, byReason: {}, more: 0, items: [] };
  const records = read.records;
  const deliveries = new Map<string, AlertDelivered>();
  const hits: { at: number; r: AlertHit }[] = [];
  for (const r of records) {
    if (r.kind === "delivered") deliveries.set(r.id, r);
    else if (r.kind === "alert") {
      const at = Date.parse(r.t);
      if (Number.isFinite(at) && at >= sinceMs) hits.push({ at, r });
    }
  }
  let sent = 0;
  let suppressed = 0;
  const byReason: Partial<Record<SuppressReason, number>> = {};
  const listed = hits.map(({ at, r }) => {
    if (r.decision === "send") sent += 1;
    else {
      suppressed += 1;
      if (r.suppressed !== undefined) byReason[r.suppressed] = (byReason[r.suppressed] ?? 0) + 1;
    }
    const snap = snapOfRecord(r.quote);
    const item: BriefAlert = {
      at: deskTime(new Date(at), new Date(now)), market: r.market, symbol: r.symbol, label: String(r.label), gap: r.gap === true,
      price: snap?.price ?? null, stamp: snap === null ? null : priceStamp(snap, now), outcome: alertOutcome(r, deliveries.get(r.id)),
      ...(r.suppressed === undefined ? {} : { suppressed: r.suppressed }),
    };
    return { at, item };
  });
  return { since, sent, suppressed, byReason, ...newestFirst(listed) };
}

/** The filings block: `filings.jsonl`'s `seen` records at or after `sinceMs`, each `alerted` when an `alert` record
 * sent for its symbol and accession. An alert ledger that cannot be read is the alerts block's error; here it only
 * leaves every `alerted` false. */
function filingsBlock(read: Read<FilingRecord>, alerts: Read<AlertRecord>, sinceMs: number, now: number, since: string): BriefFilings {
  if ("error" in read) return { since, error: read.error, more: 0, items: [] };
  const filings = read.records;
  const alerted = new Set<string>();
  for (const r of "error" in alerts ? [] : alerts.records) {
    if (r.kind !== "alert") continue;
    /* the guard does not check a trigger, so its fields are read as unknown */
    const trigger = r.trigger as { type?: unknown; accession?: unknown } | null | undefined;
    if (r.decision === "send" && trigger?.type === "filing" && typeof trigger.accession === "string") alerted.add(`${r.symbol} ${trigger.accession}`);
  }
  const listed: { at: number; item: BriefFiling }[] = [];
  for (const r of filings) {
    if (r.kind !== "seen") continue;
    const at = Date.parse(r.t);
    if (!Number.isFinite(at) || at < sinceMs) continue;
    const accepted = r.accepted === null ? null : Number.isFinite(Date.parse(r.accepted)) ? deskTime(new Date(r.accepted), new Date(now)) : r.accepted;
    listed.push({ at, item: { symbol: r.symbol, form: r.form, accepted, filingDate: r.filingDate, items: r.items, url: r.url, alerted: alerted.has(`${r.symbol} ${r.accession}`) } });
  }
  return { since, ...newestFirst(listed) };
}

/** Both watch blocks since the order's last brief; with no home, both `no ledger`. Never rejects: a ledger that cannot
 * be read is its block's `error`, and a firing ledger that cannot be read reaches back as far as having none would. */
async function watchBlocks(home: string | undefined, input: ProducerInput, now: number): Promise<{ alerts: BriefAlerts; filings: BriefFilings }> {
  let sinceMs = sinceFallback(now);
  if (home !== undefined) {
    try {
      sinceMs = Date.parse(await briefSince(home, input.order, input.date, now));
    } catch {
      /* the fallback stands, the last three dates rather than none: a firing whose ledger cannot be read never
       * starts (src/schedule.ts), so this is a ledger lost between the firing's start and its producer */
    }
  }
  const since = deskTime(new Date(sinceMs), new Date(now));
  if (home === undefined) {
    return {
      alerts: { since, error: NO_LEDGER, sent: 0, suppressed: 0, byReason: {}, more: 0, items: [] },
      filings: { since, error: NO_LEDGER, more: 0, items: [] },
    };
  }
  const [alerts, filings] = await Promise.all([readLedger(home, ALERTS_FILE, isAlertRecord), readLedger(home, FILINGS_FILE, isFilingRecord)]);
  return { alerts: alertsBlock(alerts, sinceMs, now, since), filings: filingsBlock(filings, alerts, sinceMs, now, since) };
}

/* ---------- the brief ---------- */

/**
 * Build the pre-close brief for one firing (see the module header): check the firing's date, read the book, take
 * one snapshot, price the book's US entries from it. Never rejects for a file or a source: what fails is named in
 * the brief.
 * @param deps - the quote source, the repository root and the clock.
 * @param input - the firing: `date` is the ET date a level's expiry is judged against, `session` the times shown.
 * @returns `{ ok: true, text }`, the {@link Brief} as JSON; when the prices are unavailable - the source threw, or its
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
  const allLevels = levelResults.flatMap((result) => result.entries);
  /* the brief is US: an A share is counted, never priced or listed */
  const usHoldings = holdings.entries.filter((holding) => holding.market === "us");
  const levels = allLevels.filter((level) => level.market === "us");
  const aShares = { holdings: holdings.entries.length - usHoldings.length, levels: allLevels.length - levels.length };

  const symbols = [...new Set<string>([
    ...BRIEF_INDEXES, ...BRIEF_SECTORS, ...usHoldings.map((holding) => holding.symbol), ...levels.map((level) => level.symbol),
  ])];
  /* the first ones in the order above are asked; the rest are named, never silently dropped */
  const bound = deps.symbolsMax ?? BRIEF_SYMBOLS_MAX;
  const asked = symbols.slice(0, bound);
  const omitted = symbols.slice(bound);
  const snapshot = new Map<string, LiveQuote>();
  let payload: QuotePayload | undefined;
  let quotesError: string | undefined;
  if (deps.quotes.unavailable !== undefined) {
    quotesError = `quotes unavailable: ${deps.quotes.unavailable}`;
  } else try {
    const assets = asked.map((symbol): QuoteIdentity => ({ id: `us:${symbol}`, market: "us", symbol }));
    payload = await deps.quotes.snapshot(assets);
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
    quotesError = `quotes unavailable: the source has no price for any symbol (US provider ${usProviderState(payload)})`;
  }
  const watch = await watchBlocks(deps.home, input, now);
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
      rows: usHoldings.map((holding) => holdingRow(holding, quoteFor(holding.symbol), levels)),
      refusals: holdings.refusals,
    },
    levels: {
      files: levelResults.filter((result) => result.missing !== true).map((result) => result.file),
      loaded: allLevels.length,
      errors: deskLevels.error === undefined ? [] : [{ file: deskLevels.file, error: deskLevels.error }],
      near: nearLevels(levels, quotes),
      refusals: levelResults.flatMap((result) => result.refusals),
    },
    alerts: watch.alerts,
    filings: watch.filings,
    aShares,
    scope: BRIEF_SCOPE,
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
 * and starts nothing when the signal has already aborted; what it started (a file read, the proxy's shared read)
 * runs on to its own end, unread. It never rejects: anything the brief did not expect is `{ ok: false, error: "the
 * brief failed: <message>" }`.
 * @param deps - the quote source, the repository root and the clock.
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
