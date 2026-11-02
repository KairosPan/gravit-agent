// face/src/report.ts
/** The pre-market report: `builtin:report`, a strategy's producer (P4 rulings 3, 4, 8, 10; spec §5.10).
 *
 * WHAT IT GIVES. A strategy's standing order runs this producer before its turn, and the firing quotes its text in the
 * wake message beside the order's own (the template's `strategies/_template/STANDING.md`). The text is a
 * {@link Report} as JSON: the strategy's screen line, its `status.yaml`, the last print of each symbol its levels name
 * and each level against it - the block the model writes the operator's pre-market message from.
 *
 * WHAT IT READS (P4-1). Nothing but:
 * - the strategy's Lunhui runs, `<dir>/analysis/<run>/run.json`, through channels.ts `readRunManifests` - the screen;
 * - `<dir>/status.yaml`, through desk-book.ts `readDeskFile` (no link followed, no FIFO waited on, capped) and then
 *   channels.ts `parseChannelStatus` on the bytes that read gave - the file is opened once;
 * - the firing's verified `levels.yml` bytes, `input.levels` - never the file, which a research session can write
 *   between the firing's check and this read;
 * - the Market's quote source: ONE snapshot per market that has symbols, the two in parallel.
 * The screen is read first, before any quote is asked.
 *
 * THE SCREEN (ruling 3). No screen exists apart from the strategy's Lunhui research run, so the screen line is the
 * newest sealed run, by its `sealed_at` instant, never by string: a run sealed for the previous session or later
 * covers it, and the line names the latest-sealed covering run, else the latest-sealed run. An open run is neither
 * taken nor counted; a manifest that cannot be used and a `sealed_at` that is no time are counted in `skipped`. A
 * strategy with no `analysis/` - or one that is a link - has {@link NO_SCREEN}.
 *
 * EACH PRINT ON ITS OWN MARKET (ruling 4). A quote is judged on its own market's date (`dateOf`), whatever the
 * order's market: `pre-market` before that date's session opens, `session` after; `close` when it is dated the
 * previous session; `earlier` before that, or for a `stale` quote, which is never `pre-market` or `session`; `none`
 * without a price or a time it can be read at. Only `pre-market` and `session` carry the previous close and the gap
 * from it; a `close` print's distance is the distance at the close.
 *
 * NAMES ARE THE MARKET'S (ruling 10). A price names its feed and its exchange time (`ROBINHOOD 07:58:03 ET`, `TENCENT
 * 15:00:03 Beijing`, alert-text.ts `priceStamp`); the block never names a process as a price's source.
 *
 * FAILURES ARE DATA. The report fails - `{ ok: false }` - for a firing that is not its own (not `strategies/<name>`, no
 * verified levels, a date it cannot read), and when no symbol it asked for is priced, and it then still carries
 * itself. `quotesError` is the Global Constraints' "Quote texts", word for word. A file that is missing, malformed,
 * unreadable or refused is named in its block and never fails it. {@link reportProducer} never rejects. Informs only
 * (B2): it measures distances to the operator's own levels and proposes nothing.
 *
 * MODULE WEIGHT. It brings desk-book.ts, channels.ts and js-yaml, so only a firing loads it - through the schedule,
 * itself loaded on first use - and the pause switch never does.
 * @module
 */
import { join } from "node:path";
import { load } from "js-yaml";
import { priceStamp } from "./alert-text.ts";
import { parseChannelStatus, readRunManifests, type ChannelStatus } from "./channels.ts";
import { levelDistancePct, parseLevels, readDeskFile, type Level, type LevelKind, type LoadRefusal } from "./desk-book.ts";
import { deskTime } from "./desk.ts";
import { cut, escaped } from "./echo.ts";
import { bjDate, bjSessionTime, dateOf, etClock, etDate, etTime } from "./et.ts";
import { HttpError } from "./http.ts";
import { sessionFor, xnysWindow, type MarketSession } from "./market-clock.ts";
import type { MarketQuote, MarketQuoteIdentity, MarketQuoteSource } from "./market-quotes.ts";
import type { BuiltinProducer, ProducerInput, ProducerOutput } from "./producer.ts";
import { isEtDate, isOrderDir } from "./standing.ts";
import { idOf, type Market } from "./symbols.ts";
import { snapOf, watchQuoteOf } from "./watch-eval.ts";
import { xshgSession } from "./xshg-clock.ts";

/* ---------- the limits and the words ---------- */

/** The most Lunhui runs the screen reads, the newest by id. */
export const SCREEN_RUNS_MAX = 200;
/** The most characters (code points) a status text keeps; a longer one keeps one fewer and ends `…`. */
export const STATUS_TEXT_MAX = 300;
/** The most `numbers` keys a status keeps; the rest are one `"…": "<k> more"`. */
export const STATUS_NUMBERS_MAX = 20;
/** The screen line of a strategy with no `analysis/`. */
export const NO_SCREEN = "no screen is wired for this strategy";

/** The most days {@link previousSessionDate} walks back. */
const SESSION_WALK_DAYS = 10;
/** A manifest's string the line names, or this when it holds none. */
const UNKNOWN = "unknown";
/** `sealed_at` as a time: an ISO date-time `Date.parse` reads. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T/;
/** A quote's status when its market was not priced, or the snapshot holds none for it. */
const UNAVAILABLE = "unavailable";
/** The error when no symbol asked for is priced and no reason was given. */
const NO_PRICE = "quotes unavailable: the Market's read has no price for any symbol";
/** Each market's word in a rejected snapshot's reason. */
const MARKET_WORDS: Readonly<Record<Market, string>> = { us: "US", cn: "A-share" };
/** The markets in the order their reasons join. */
const MARKETS: readonly Market[] = ["us", "cn"];

/* ---------- the shapes ---------- */

/** The screen line and the run it names. `skipped` counts the unusable manifests and the `sealed_at`s that are no
 * time, present only when above 0. */
export interface Screen {
  wired: boolean;
  ran: boolean | null;
  line: string;
  run?: { id: string; kind: string; session: string; sealedAt: string; artifacts: string[] };
  skipped?: number;
}

/** How a print stands to its market's date (ruling 4). */
export type Print = "pre-market" | "session" | "close" | "earlier" | "none";

/** One symbol's last print. `feed` is `""` when its market was not priced; `at` the print's stamp. */
export interface ReportQuote {
  symbol: string;
  market: Market;
  feed: string;
  last: number | null;
  at: string | null;
  print: Print;
  prevClose: number | null;
  sinceClosePct: number | null;
  status: string;
}

/** One level against its symbol's print. */
export interface ReportLevel {
  symbol: string;
  market: Market;
  kind: LevelKind;
  price?: number;
  range?: [number, number];
  when: Level["when"];
  plan: string;
  source?: string;
  expires: string;
  distancePct: number | null;
  closeDistancePct: number | null;
  crossedSinceClose: boolean | null;
}

/** The block, in the key order its text is written in: the screen near the front, so a cut keeps it. */
export interface Report {
  strategy: string;
  market: Market;
  date: string;
  takenAt: string;
  session: { open: string; close: string; early: boolean };
  screen: Screen;
  statusFile: "read" | "missing" | "unreadable" | "malformed";
  status: ChannelStatus;
  quotes: ReportQuote[];
  quotesError?: string;
  levels: { file: string; rows: ReportLevel[]; refusals: LoadRefusal[]; missing?: true; error?: string };
}

/** What the report closes over: the Market's quote source, the repository root, and `now` (default `Date.now`). */
export interface ReportDeps {
  quotes: Pick<MarketQuoteSource, "snapshot" | "unavailable">;
  root: string;
  now?: () => number;
}

/* ---------- small helpers ---------- */

/** A thrown value's message. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" ? message : String(error);
}

/** A thrown value's errno code, else its message. */
function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : messageOf(error);
}

/** Whether `value` is a price: a finite number above 0. */
function isPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** `value` to 2 decimals, half away from zero, never `-0`. */
function round2(value: number): number {
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * 100)) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** The day before a `YYYY-MM-DD` date. */
function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** A manifest's text as a line names it: one plain line, at most 60 characters, else {@link UNKNOWN}. */
function named(value: unknown): string {
  return typeof value === "string" && value !== "" ? escaped(cut(value)) : UNKNOWN;
}

/** A market's session on its own date, or `undefined` for a closed day or one the calendar does not cover. */
function sessionOn(market: Market, date: string): MarketSession | undefined {
  const session = market === "cn" ? xshgSession(date) : sessionFor(xnysWindow(date, 1), date);
  return typeof session === "object" ? session : undefined;
}

/* ---------- the screen ---------- */

/**
 * The market's last session before `date`: walked back day by day, at most 10 days, on the XNYS rules or the XSHG
 * table.
 * @param market - the market.
 * @param date - its date, `YYYY-MM-DD`.
 * @returns the session's date; `{ error }` - `the A-share calendar does not cover <d>` for a day past the XSHG table,
 *   `no session in the 10 days before <date>` when the walk finds none, or the clock's refusal of a bad date.
 */
export function previousSessionDate(market: Market, date: string): string | { error: string } {
  try {
    let d = date;
    for (let n = 0; n < SESSION_WALK_DAYS; n++) {
      d = dayBefore(d);
      const session = market === "cn" ? xshgSession(d) : sessionFor(xnysWindow(d, 1), d);
      if (session === "uncovered") return { error: `the A-share calendar does not cover ${d}` };
      if (typeof session === "object") return session.date;
    }
    return { error: `no session in the ${SESSION_WALK_DAYS} days before ${date}` };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

/** A sealed run, as the screen weighs it. */
interface Sealed {
  id: string;
  at: number;
  sealedAt: string;
  manifest: Record<string, unknown>;
}

/**
 * The strategy's screen line (ruling 3; see the module header).
 * @param root - the repository root.
 * @param dir - the strategy's directory, repo-relative (`strategies/<name>`).
 * @param market - the order's market: whose previous session a run must cover.
 * @param date - the order's market date.
 * @param now - the time the line is written at, for {@link deskTime}.
 */
export async function readScreen(root: string, dir: string, market: Market, date: string, now: number): Promise<Screen> {
  let manifests: Awaited<ReturnType<typeof readRunManifests>>;
  try {
    manifests = await readRunManifests(join(root, dir), SCREEN_RUNS_MAX);
  } catch (error) {
    const code = codeOf(error);
    if (code === "ENOENT" || code === "ENOTDIR") return { wired: false, ran: null, line: NO_SCREEN };
    return { wired: true, ran: null, line: `cannot tell whether the screen ran: ${dir}/analysis/ cannot be read (${code})` };
  }
  let skipped = 0;
  const sealed: Sealed[] = [];
  for (const entry of manifests) {
    if ("missing" in entry) continue;
    if ("unusable" in entry) {
      skipped += 1;
      continue;
    }
    const at = entry.manifest.sealed_at;
    if (at === undefined || at === null) continue; // open: neither taken nor counted
    const ms = typeof at === "string" && ISO_RE.test(at) ? Date.parse(at) : Number.NaN;
    if (!Number.isFinite(ms)) {
      skipped += 1;
      continue;
    }
    sealed.push({ id: entry.run, at: ms, sealedAt: at as string, manifest: entry.manifest });
  }
  const tail = skipped > 0 ? { skipped } : {};
  if (sealed.length === 0) return { wired: true, ran: false, line: `not run: no Lunhui run in ${dir}/analysis/ is sealed`, ...tail };
  const prev = previousSessionDate(market, date);
  if (typeof prev !== "string") return { wired: true, ran: null, line: `cannot tell whether the screen ran: ${prev.error}`, ...tail };

  /* the latest by instant, the newer id winning a tie (the list is newest first) */
  const latest = (runs: readonly Sealed[]): Sealed | undefined => runs.reduce<Sealed | undefined>((best, run) => (best === undefined || run.at > best.at ? run : best), undefined);
  const covers = (run: Sealed): boolean => {
    const session = run.manifest.session;
    return typeof session === "string" && isEtDate(session) && session >= prev;
  };
  const covering = latest(sealed.filter(covers));
  const chosen = (covering ?? latest(sealed)) as Sealed;
  const raw = chosen.manifest.artifacts;
  const run = {
    id: chosen.id,
    kind: named(chosen.manifest.kind),
    session: named(chosen.manifest.session),
    sealedAt: chosen.sealedAt,
    artifacts: Array.isArray(raw) && raw.every((item) => typeof item === "string") ? raw.map((item: string) => escaped(cut(item))) : [],
  };
  const sealedTime = deskTime(new Date(chosen.at), new Date(now));
  const line = covering !== undefined
    ? `ran: Lunhui run ${run.id} (${run.kind}) sealed ${sealedTime} covers the ${run.session} session; artifacts: ${run.artifacts.length === 0 ? "none" : run.artifacts.join(", ")}`
    : `not run for the ${prev} session: the last sealed Lunhui run is ${run.id} (${run.kind}), for the ${run.session} session, sealed ${sealedTime}`;
  return { wired: true, ran: covering !== undefined, line, run, ...tail };
}

/* ---------- the status ---------- */

/** `text` kept to {@link STATUS_TEXT_MAX} characters (code points), the last a `…` when cut. */
function clip(text: string): string {
  return cut(text, STATUS_TEXT_MAX);
}

/** The status as the block carries it: each text clipped, `numbers` past {@link STATUS_NUMBERS_MAX} keys counted. */
function boundedStatus(status: ChannelStatus): ChannelStatus {
  const out: ChannelStatus = {};
  if (status.status !== undefined) out.status = clip(status.status);
  if (status.one_line !== undefined) out.one_line = clip(status.one_line);
  if (status.next !== undefined) out.next = clip(status.next);
  if (status.numbers !== undefined) {
    const entries = Object.entries(status.numbers);
    const numbers: Record<string, string> = {};
    for (const [key, value] of entries.slice(0, STATUS_NUMBERS_MAX)) numbers[clip(key)] = clip(value);
    if (entries.length > STATUS_NUMBERS_MAX) numbers["…"] = `${entries.length - STATUS_NUMBERS_MAX} more`;
    out.numbers = numbers;
  }
  return out;
}

/** `<dir>/status.yaml`: how its read went, and its values - {@link parseChannelStatus} of the text the guarded read
 * gave, so the file is opened once, and only as a regular file with one name. */
async function readStatus(root: string, dir: string): Promise<Pick<Report, "statusFile" | "status">> {
  const file = await readDeskFile(join(root, dir, "status.yaml"));
  if (file.state === "absent") return { statusFile: "missing", status: {} };
  if (file.state !== "ok") return { statusFile: "unreadable", status: {} };
  let malformed = false;
  try {
    const doc: unknown = load(file.text);
    malformed = doc !== null && doc !== undefined && (typeof doc !== "object" || Array.isArray(doc));
  } catch {
    malformed = true;
  }
  return { statusFile: malformed ? "malformed" : "read", status: boundedStatus(parseChannelStatus(file.text)) };
}

/* ---------- the quotes ---------- */

/** One market's date, its session that day, and its previous session, as the prints are judged on them. */
interface MarketDay {
  date: string;
  session?: MarketSession;
  prev?: string;
}

/** `market`'s day at `now`. */
function marketDay(market: Market, now: number): MarketDay {
  const date = dateOf(market, now);
  const prev = previousSessionDate(market, date);
  const session = sessionOn(market, date);
  return { date, ...(session === undefined ? {} : { session }), ...(typeof prev === "string" ? { prev } : {}) };
}

/** A print at `at` with `status`, judged on its market's day (ruling 4). */
function printOf(market: Market, at: number, status: string, day: MarketDay): Print {
  const date = market === "cn" ? bjDate(new Date(at)) : etDate(new Date(at));
  if (date === day.date && day.session !== undefined && status !== "stale") return at < Date.parse(day.session.open) ? "pre-market" : "session";
  return date === day.prev ? "close" : "earlier";
}

/** A quote that shows no number: its market not priced (`feed` empty), or no price it can time. */
function noPrint(identity: MarketQuoteIdentity, feed: string, status: string): ReportQuote {
  return { symbol: identity.symbol, market: identity.market, feed, last: null, at: null, print: "none", prevClose: null, sinceClosePct: null, status };
}

/** One symbol's print as the block carries it, from the snapshot's quote. */
function reportQuote(identity: MarketQuoteIdentity, quote: MarketQuote | undefined, day: MarketDay, now: number): ReportQuote {
  if (quote === undefined) return noPrint(identity, "", UNAVAILABLE);
  const feed = typeof quote.feed === "string" ? quote.feed : "";
  const status = typeof quote.quote_status === "string" ? quote.quote_status : UNAVAILABLE;
  const at = typeof quote.as_of === "string" ? Date.parse(quote.as_of) : Number.NaN;
  const snap = snapOf(watchQuoteOf(quote));
  if (!isPrice(quote.price) || !Number.isFinite(at) || snap === null) return noPrint(identity, feed, status);
  const print = printOf(identity.market, at, status, day);
  const gapped = print === "pre-market" || print === "session";
  const prevClose = gapped && isPrice(quote.prev_close) ? quote.prev_close : null;
  return {
    symbol: identity.symbol,
    market: identity.market,
    feed,
    last: quote.price,
    at: priceStamp(snap, now),
    print,
    prevClose,
    sinceClosePct: prevClose === null ? null : round2(((quote.price - prevClose) / prevClose) * 100),
    status,
  };
}

/** Whether `level` was crossed between the previous close and the last print. */
function crossed(level: Level, prevClose: number, last: number): boolean {
  if (level.range !== undefined) {
    const [low, high] = level.range;
    return (prevClose < low || prevClose > high) && last >= low && last <= high;
  }
  const price = level.price as number;
  return level.when === "cross_up" ? prevClose < price && price <= last : prevClose > price && price >= last;
}

/** One level against its symbol's print. */
function reportLevel(level: Level, quote: ReportQuote | undefined): ReportLevel {
  const last = quote?.last ?? null;
  const print = quote?.print ?? "none";
  const prevClose = quote?.prevClose ?? null;
  const distancePct = last === null ? null : round2(levelDistancePct(level, last));
  const gapped = print === "pre-market" || print === "session";
  const closeDistancePct = gapped ? (prevClose === null ? null : round2(levelDistancePct(level, prevClose))) : print === "close" ? distancePct : null;
  return {
    symbol: level.symbol,
    market: level.market,
    kind: level.kind,
    ...(level.range !== undefined ? { range: [level.range[0], level.range[1]] as [number, number] } : { price: level.price as number }),
    when: level.when,
    plan: level.plan,
    ...(level.source === undefined ? {} : { source: level.source }),
    expires: level.expires,
    distancePct,
    closeDistancePct,
    crossedSinceClose: gapped && last !== null && prevClose !== null ? crossed(level, prevClose, last) : null,
  };
}

/** A rejected snapshot's reason: `busy` for a 429, else the error's message. */
function reasonOf(error: unknown): string {
  return error instanceof HttpError && error.status === 429 ? "busy" : messageOf(error);
}

/** Every symbol's print: one snapshot per market that has symbols, in parallel, each over that market's ids alone;
 * and the reasons the prices are short, in the plan's words. */
async function quoteAll(
  deps: ReportDeps, identities: readonly MarketQuoteIdentity[], now: number,
): Promise<{ quotes: ReportQuote[]; reasons: string[] }> {
  if (identities.length === 0) return { quotes: [], reasons: [] };
  const unavailable = deps.quotes.unavailable;
  if (unavailable !== undefined) {
    return { quotes: identities.map((identity) => noPrint(identity, "", UNAVAILABLE)), reasons: [`quotes unavailable: ${unavailable}`] };
  }
  const markets = MARKETS.filter((market) => identities.some((identity) => identity.market === market));
  const settled = await Promise.allSettled(markets.map((market) => deps.quotes.snapshot(identities.filter((identity) => identity.market === market))));
  const byId = new Map<string, MarketQuote>();
  const rejected = new Set<Market>();
  const reasons: string[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      for (const quote of result.value.quotes) byId.set(quote.id, quote);
    } else {
      rejected.add(markets[i]);
      reasons.push(`${MARKET_WORDS[markets[i]]} quotes unavailable: ${reasonOf(result.reason)}`);
    }
  });
  const days = new Map(markets.map((market) => [market, marketDay(market, now)] as const));
  const quotes = identities.map((identity) => rejected.has(identity.market)
    ? noPrint(identity, "", UNAVAILABLE)
    : reportQuote(identity, byId.get(identity.id), days.get(identity.market) as MarketDay, now));
  return { quotes, reasons };
}

/* ---------- the report ---------- */

/** A session's instant as the block writes it: New York's wall clock for a US order, Beijing's with New York's beside
 * it for an A-share one; text `Date` cannot read stays as given. */
function sessionTime(market: Market, instant: string): string {
  if (!Number.isFinite(Date.parse(instant))) return instant;
  return market === "cn" ? bjSessionTime(new Date(instant)) : etTime(new Date(instant));
}

/**
 * Build one strategy's pre-market report for one firing (see the module header).
 * @param deps - the quote source, the repository root and the clock.
 * @param input - the firing: `dir` the strategy, `market` its market (absent is `us`), `date` that market's date,
 *   `session` the times shown, `levels` the verified bytes.
 * @returns `{ ok: true, text }`, the {@link Report} as JSON; `{ ok: false, error, text }` when no symbol asked for is
 *   priced, `error` the block's `quotesError`; `{ ok: false, error }`, nothing read, for `builtin:report runs only in
 *   strategies/<name>`, `the firing carried no verified levels.yml`, or a date that is not `YYYY-MM-DD`.
 */
export async function buildReport(deps: ReportDeps, input: ProducerInput): Promise<ProducerOutput> {
  if (!isOrderDir(input.dir) || input.dir === "desk") return { ok: false, error: "builtin:report runs only in strategies/<name>" };
  if (input.levels === undefined) return { ok: false, error: "the firing carried no verified levels.yml" };
  if (!isEtDate(input.date)) {
    return { ok: false, error: `the report takes the firing's date as YYYY-MM-DD, not ${JSON.stringify(String(input.date).slice(0, 40))}` };
  }
  const clock = deps.now ?? Date.now;
  const market: Market = input.market ?? "us";
  /* the screen first, before any quote is asked */
  const screen = await readScreen(deps.root, input.dir, market, input.date, clock());
  const status = await readStatus(deps.root, input.dir);

  const verified = input.levels;
  const parsed = verified.text === null ? undefined : parseLevels(verified.text, verified.file, input.date, verified.sha256);
  const levels = parsed?.entries ?? [];
  const seen = new Set<string>();
  const identities: MarketQuoteIdentity[] = [];
  for (const level of levels) {
    const id = idOf(level.market, level.symbol);
    if (seen.has(id)) continue;
    seen.add(id);
    identities.push({ id, market: level.market, symbol: level.symbol });
  }
  const now = clock();
  const { quotes, reasons } = await quoteAll(deps, identities, now);
  const priced = identities.length === 0 || quotes.some((quote) => quote.last !== null);
  const quotesError = reasons.length > 0 ? reasons.join("; ") : priced ? undefined : NO_PRICE;
  const quoteOf = new Map(quotes.map((quote) => [idOf(quote.market, quote.symbol), quote] as const));

  const report: Report = {
    strategy: input.dir,
    market,
    date: input.date,
    takenAt: `${etClock(new Date(now))} ET`,
    session: { open: sessionTime(market, input.session.open), close: sessionTime(market, input.session.close), early: input.session.early },
    screen,
    statusFile: status.statusFile,
    status: status.status,
    quotes,
    ...(quotesError === undefined ? {} : { quotesError }),
    levels: {
      file: verified.file,
      rows: levels.map((level) => reportLevel(level, quoteOf.get(idOf(level.market, level.symbol)))),
      refusals: parsed?.refusals ?? [],
      ...(parsed === undefined ? { missing: true as const } : {}),
      ...(parsed?.error === undefined ? {} : { error: parsed.error }),
    },
  };
  const text = JSON.stringify(report);
  return priced ? { ok: true, text } : { ok: false, error: quotesError as string, text };
}

/** A builtin's answer when its signal stopped it: `stopped: <the signal's reason>`. */
function stopped(signal: AbortSignal): ProducerOutput {
  return { ok: false, error: `stopped: ${signal.reason === undefined ? "aborted" : messageOf(signal.reason)}` };
}

/**
 * The report as a built-in producer, `builtin:report`: {@link buildReport} over `deps` for each firing's input. It
 * stops when `signal` aborts - the firing's deadline - settling at once with `{ ok: false, error: "stopped: <reason>"
 * }`, and starts nothing when the signal has already aborted; what it started runs on to its own end, unread. It never
 * rejects: anything the report did not expect is `{ ok: false, error: "the report failed: <message>" }`.
 * @param deps - the quote source, the repository root and the clock.
 */
export function reportProducer(deps: ReportDeps): BuiltinProducer {
  return (input, signal) => {
    if (signal.aborted) return Promise.resolve(stopped(signal));
    return new Promise<ProducerOutput>((resolve) => {
      const onAbort = (): void => resolve(stopped(signal));
      signal.addEventListener("abort", onAbort, { once: true });
      const settle = (output: ProducerOutput): void => {
        signal.removeEventListener("abort", onAbort);
        resolve(output);
      };
      buildReport(deps, input).then(settle, (error: unknown) => settle({ ok: false, error: `the report failed: ${messageOf(error)}` }));
    });
  };
}
