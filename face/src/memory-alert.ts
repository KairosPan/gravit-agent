/** An alert as the owner's memory is asked about it: when the watch sends a price alert, the face's own code asks the
 * memory, as `gravit-face`, which of the owner's lessons apply, and builds the short block the phone is sent under
 * the alert and the note the conversation is told. No model is in the path.
 *
 * - What might be done on a hit ({@link alertConsidering}): `buy` when it is not held; when it is, `add`, `hold` and
 *   `trim` when it is up or flat, `sell` in place of `trim` when it is down - up and down on the day's change of the
 *   hit's own quote, its previous close standing in for a change it lacks, else on the price against the book's
 *   average cost. Nothing for a filing, a hit with no quote, or a symbol off its market's shape.
 * - Its facts ({@link hitFacts}): `price`, `change_1d_pct`, `held` and `unrealized_pct` from the hit's own quote and
 *   holding, then the three bar-based changes of src/memory-facts.ts, read within {@link ALERT_FACTS_MS}.
 * - The ask ({@link createAlertLessons}): the shape-checked symbol, its market and the facts computed here, nothing
 *   else; the memory is opened first, so a memory not connected reads nothing at the Market, and the open, the bars
 *   and the recall share one budget of {@link ALERT_ASK_MS}. A read that loses its race is left to finish and ignored.
 *   A fault is one log line; not connected, a home that was never made among it, is none. The ask never throws or
 *   rejects.
 * - The block ({@link alertBlock}) and the note ({@link alertNote}): built by code under a fixed head, each lesson's
 *   words escaped (src/echo.ts) and cut to {@link ALERT_WORDS_MAX} characters, the block at most
 *   {@link ALERT_BLOCK_MAX}. A lesson's id and a need are shown only in the memory's own shapes.
 *
 * MODULE WEIGHT. It imports src/watch-eval.ts for types alone.
 * @module
 */
import { cut, escaped } from "./echo.ts";
import { ASK_LATE, askMemory, noHome, type Asked, type GateLesson } from "./memory-ask.ts";
import { changeFacts, type FactMarket, type Facts } from "./memory-facts.ts";
import { MEMORY_SYMBOL, type Action } from "./memory-order.ts";
import { memoryFaultWords, type MemoryStanding } from "./memory.ts";
import { CN_SYMBOL_RE, SYMBOL_RE } from "./symbols.ts";
import type { UpstreamRouteRead } from "./upstream-proxy.ts";
import type { AlertHit } from "./watch-eval.ts";

/** The whole ask's budget: the bars read and the recall. */
export const ALERT_ASK_MS = 3_000;
/** The most of {@link ALERT_ASK_MS} the bars read may take. */
export const ALERT_FACTS_MS = 1_500;
/** The longest block, in characters. */
export const ALERT_BLOCK_MAX = 700;
/** The most lessons a block shows. */
export const ALERT_LESSONS_MAX = 3;
/** The most characters of a lesson's words a block shows. */
export const ALERT_WORDS_MAX = 400;
/** The most lessons that could not be told a note shows. */
export const ALERT_UNTOLD_MAX = 3;

/** The memory's own shape of a lesson's id (the package's `LESSON_ID`). */
const LESSON_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
/** The memory's own shape of a fact's name (the package's `FACT_NAME`). */
const FACT_NAME = /^[a-z0-9_]{1,40}$/;
/** The longest source line. */
const SOURCE_MAX = 120;
/** The most characters of a symbol a head shows, and of a recall id or a fault a line shows. */
const SHOWN_MAX = 40;
const FAULT_MAX = 200;

const round2 = (x: number): number => Math.round(x * 100) / 100;
const positive = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;
const pctOver = (last: number, base: number): number => round2((last / base - 1) * 100);
const chars = (text: string): number => [...text].length;
/** A line from text the face did not write: one plain line of at most `max` characters. */
const shown = (text: string, max: number): string => cut(escaped(String(text)), max);

/** The memory's market for a hit's, or undefined for anything else. */
function marketOfHit(hit: AlertHit): FactMarket | undefined {
  if (hit.market === "us") return "US";
  if (hit.market === "cn") return "CN";
  return undefined;
}

/** Whether the hit's symbol has its market's shape and the memory's. */
function shapedSymbol(hit: AlertHit, market: FactMarket): boolean {
  const symbol = hit.symbol;
  return typeof symbol === "string" && (market === "CN" ? CN_SYMBOL_RE : SYMBOL_RE).test(symbol) && MEMORY_SYMBOL.test(symbol);
}

/** What might be done on a hit. undefined for a filing, a hit with no quote, or a symbol off its market's shape. */
export function alertConsidering(hit: AlertHit): Action[] | undefined {
  const market = marketOfHit(hit);
  if (market === undefined || hit.trigger?.type === "filing" || !shapedSymbol(hit, market)) return undefined;
  const quote = hit.quote;
  if (quote === null || quote === undefined || !positive(quote.price)) return undefined;
  if (hit.holding === null || hit.holding === undefined) return ["buy"];
  const chg = quote.chgPct;
  const day = typeof chg === "number" && Number.isFinite(chg) ? chg : positive(quote.prevClose) ? quote.price / quote.prevClose - 1 : undefined;
  const up = day !== undefined ? day >= 0 : quote.price >= hit.holding.avgCost;
  return up ? ["add", "trim", "hold"] : ["add", "sell", "hold"];
}

/** price, change_1d_pct, held, unrealized_pct from the hit's own quote and holding. */
export function hitFacts(hit: AlertHit): Facts {
  const out: Facts = { facts: {}, sources: {} };
  const quote = hit.quote;
  const price = quote !== null && quote !== undefined && positive(quote.price) ? quote.price : undefined;
  if (price !== undefined) {
    const source = shown(`the watch's quote (${quote!.feed}) at ${quote!.asOf}`, SOURCE_MAX);
    out.facts.price = round2(price);
    out.sources.price = source;
    if (positive(quote!.prevClose)) {
      out.facts.change_1d_pct = pctOver(price, quote!.prevClose);
      out.sources.change_1d_pct = source;
    }
  }
  const holding = hit.holding ?? null;
  out.facts.held = holding !== null;
  out.sources.held = "the desk's book";
  if (holding !== null && price !== undefined && positive(holding.avgCost)) {
    out.facts.unrealized_pct = pctOver(price, holding.avgCost);
    out.sources.unrealized_pct = "the watch's quote over the desk's book's average cost";
  }
  return out;
}

/** A lesson's line, its words escaped and cut. */
function lessonLine(lesson: GateLesson): string {
  const strength = lesson.strength === "red-line" ? "red line" : "caveat";
  const says = lesson.says === "dont" ? "don't" : lesson.says === "do" ? "do" : "careful";
  return `· ${strength} (${says}): "${shown(lesson.words, ALERT_WORDS_MAX)}" · fired ${lesson.fired} · followed ${lesson.followed} · overridden ${lesson.overridden}`;
}

/** The phone's block, or undefined when no lesson applies. */
export function alertBlock(symbol: string, asked: Asked): string | undefined {
  const lessons = [...asked.lessons.filter((l) => l.strength === "red-line"), ...asked.lessons.filter((l) => l.strength !== "red-line")];
  if (lessons.length === 0) return undefined;
  const head = `Your own lessons on ${shown(symbol, SHOWN_MAX)}, not advice:`;
  const more = asked.lessonsMore;
  const textOf = (lines: string[]): string => {
    const left = lessons.length - lines.length + more;
    return [head, ...lines, ...(left > 0 ? [`and ${left} more`] : [])].join("\n");
  };
  const lines: string[] = [];
  for (const lesson of lessons.slice(0, ALERT_LESSONS_MAX)) {
    const next = [...lines, lessonLine(lesson)];
    if (chars(textOf(next)) > ALERT_BLOCK_MAX) break;
    lines.push(next[next.length - 1]);
  }
  return lines.length === 0 ? undefined : textOf(lines);
}

/** What the conversation is told, or undefined with neither a lesson nor an untold one. */
export function alertNote(symbol: string, asked: Asked): string | undefined {
  if (asked.lessons.length === 0 && asked.untold.length === 0) return undefined;
  const out: string[] = [];
  const block = alertBlock(symbol, asked);
  if (block !== undefined) out.push(block);
  const name = shown(symbol, SHOWN_MAX);
  for (const untold of asked.untold.slice(0, ALERT_UNTOLD_MAX)) {
    const id = LESSON_ID.test(untold.id) ? untold.id : "a lesson";
    const needs = untold.needs.map((need) => (need === "market" || FACT_NAME.test(need) ? need : "a fact"));
    out.push(`could not be checked on ${name}: ${id} needs ${needs.join(", ")}`);
  }
  const left = asked.untold.length - Math.min(asked.untold.length, ALERT_UNTOLD_MAX) + asked.untoldMore;
  if (left > 0) out.push(`and ${left} more could not be checked`);
  if (asked.recall !== undefined) out.push(`recall ${shown(asked.recall, SHOWN_MAX)}`);
  return out.join("\n");
}

/** `phone`: the block; `note`: the conversation's text; `key`: the symbol, the hit's date and the lessons' and untold ids. */
export interface AlertLessonsAnswer { phone?: string; note?: string; key: string }

/** The memory's door, the Market's bars read in-process, the log, and the clock and timer the ask runs on. */
export interface AlertLessonsDeps {
  open: () => Promise<MemoryStanding>;
  candles: UpstreamRouteRead;
  log: (line: string) => void;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

/** An open's outcome against its timer. */
type Opened = { kind: "ok"; standing: MemoryStanding } | { kind: "late" } | { kind: "fault"; error: unknown };

/** `deps.open()` raced against a timer of `ms`; a throw is a fault. Never rejects. */
function openWithin(deps: AlertLessonsDeps, ms: number): Promise<Opened> {
  const setTimer = deps.setTimer ?? ((run: () => void, wait: number): unknown => setTimeout(run, wait));
  const clearTimer = deps.clearTimer ?? ((timer: unknown): void => clearTimeout(timer as ReturnType<typeof setTimeout>));
  return new Promise((resolve) => {
    let done = false;
    let timer: unknown;
    const settle = (outcome: Opened): void => {
      if (done) return;
      done = true;
      try {
        clearTimer(timer);
      } catch {
        /* the timer fires into a settled open */
      }
      resolve(outcome);
    };
    Promise.resolve()
      .then(() => deps.open())
      .then((standing) => settle({ kind: "ok", standing }), (error: unknown) => settle({ kind: "fault", error }));
    try {
      timer = setTimer(() => settle({ kind: "late" }), ms);
    } catch {
      settle({ kind: "late" });
    }
  });
}

/** The ids, sorted and joined by commas. */
const idsOf = (items: ReadonlyArray<{ id: string }>): string => items.map((item) => item.id).sort().join(",");

/** The watch's ask. Never rejects; undefined when there is nothing to say. */
export function createAlertLessons(deps: AlertLessonsDeps): (hit: AlertHit) => Promise<AlertLessonsAnswer | undefined> {
  const say = (line: string): void => {
    try {
      deps.log(line);
    } catch {
      /* a log that throws costs the alert nothing */
    }
  };
  const ask = async (hit: AlertHit): Promise<AlertLessonsAnswer | undefined> => {
    const considering = alertConsidering(hit);
    if (considering === undefined) return undefined;
    const market = marketOfHit(hit)!;
    const symbol = hit.symbol;
    const now = deps.now ?? Date.now;
    const timers = { now: deps.now, setTimer: deps.setTimer, clearTimer: deps.clearTimer };
    const start = now();
    const opened = await openWithin(deps, ALERT_ASK_MS);
    if (opened.kind === "fault") {
      if (!noHome(opened.error)) say(`memory alert: ${symbol}: ${shown(memoryFaultWords(opened.error), FAULT_MAX)}`);
      return undefined;
    }
    if (opened.kind === "late") {
      say(`memory alert: ${symbol}: ${ASK_LATE}`);
      return undefined;
    }
    const standing = opened.standing;
    if (standing?.connected !== true) return undefined;
    const own = hitFacts(hit);
    const changes = await changeFacts({ candles: deps.candles, ...timers }, symbol, market, hit.quote!.price, market === "CN" ? "trading" : undefined, { readMs: ALERT_FACTS_MS });
    const facts: Facts = { facts: { ...own.facts, ...changes.facts }, sources: { ...own.sources, ...changes.sources } };
    const spent = Math.max(0, now() - start);
    const answer = await askMemory(() => Promise.resolve(standing), { considering, symbol, market, facts }, {
      ms: ALERT_ASK_MS - spent, setTimer: deps.setTimer, clearTimer: deps.clearTimer,
    });
    if (!("asked" in answer)) return undefined;
    const asked = answer.asked;
    if (asked.fault !== undefined) {
      say(`memory alert: ${symbol}: ${shown(asked.fault, FAULT_MAX)}`);
      return undefined;
    }
    const note = alertNote(symbol, asked);
    if (note === undefined) return undefined;
    const phone = alertBlock(symbol, asked);
    const key = `${symbol}:${hit.date}:${idsOf(asked.lessons)}|${idsOf(asked.untold)}`;
    return phone === undefined ? { note, key } : { phone, note, key };
  };
  return (hit) => {
    try {
      return ask(hit).catch(() => undefined);
    } catch {
      return Promise.resolve(undefined);
    }
  };
}
