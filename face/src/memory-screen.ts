/** The owner's memory screen, its four reads: the lessons, the decisions, what waits for the owner and the home's
 * health, each shaped for the page from one call of the library, through the face's own handle (src/memory.ts
 * `MemoryStanding`).
 *
 * Only `lessons`, `decisions`, `review` and `status` are called: nothing here writes the memory, and nothing is kept
 * between calls. Each read opens the memory and races the open and the one library call against one timer of
 * {@link SCREEN_READ_MS}; a read that loses the race is left to finish and ignored, and rejects as the
 * {@link ScreenFault} `late`; a read that throws or rejects otherwise rejects as the fault `fault`, its error kept as
 * the cause. A standing that is not connected, and a read that rejects with the package's `E_NO_HOME` - a home that
 * was never made - answer `connected: false` with the words that say so and the command that makes the home.
 *
 * Every command the screen shows is built here ({@link commandOf}), from ids that fit their shapes and the home of
 * the face's own standing: a row whose id does not fit carries none. A card's text is served at most
 * {@link SCREEN_TEXT_MAX} characters, marked `cut` when cut.
 * @module
 */
import type { Card, CardRecord, DecisionView, Figure, LessonView, Memory, ProposalLine, Status } from "gravit-memory";
import { FACE_FACTS } from "./memory-facts.ts";
import { NO_MEMORY_HERE, type MemoryStanding } from "./memory.ts";

/** How long one read may take, the open included. */
export const SCREEN_READ_MS = 5_000;
/** The most characters of a card's text served. */
export const SCREEN_TEXT_MAX = 16_384;

/** A lesson id the screen builds a command from. */
const LESSON_SHAPE = /^[a-z0-9][a-z0-9-]{1,39}$/;
/** A decision id the screen builds a command from. */
const DECISION_SHAPE = /^d-\d{8}-[0-9a-f]{8}$/;
/** A home written into a command unquoted. */
const PLAIN_HOME = /^[A-Za-z0-9_./~-]+$/;
/** The place of the owner's words in a command: a double quote, an ellipsis, a double quote. */
const WORDS_PLACEHOLDER = "\"\u2026\"";
/** The five commands the Health tab lists, in its order. */
const HEALTH_COMMANDS = ["status", "verify", "reconcile", "review", "reseal"] as const;

/** Not connected: why, the words that say so, and the command that makes the home. */
export type NotConnected = { connected: false; why: "disabled" | "no install" | "no home named" | "no home"; say: string; command: string };

/** A card's text as served: at most {@link SCREEN_TEXT_MAX} characters, `cut` when cut. */
export interface LessonText { sha256: string; text: string; cut?: true; card?: Card; fault?: string }

/** One lesson card as the Lessons tab draws it. */
export interface LessonRow {
  id: string; state: "armed" | "changed" | "broken" | "unarmed" | "retired" | "refused"; fault?: string; armedAt?: string;
  armed?: LessonText; file?: LessonText; record: CardRecord | null;
  /** The facts the card checks; `face`: the face computes it. */
  checks: { fact: string; definition: string | null; face: boolean }[];
  /** The terminal's command for each act the state allows. */
  commands: { arm?: string; retire?: string; review?: string };
}

/** One decision as the Decisions tab draws it; `command`: the void, when it is not void. */
export interface DecisionRow { view: DecisionView; figures: Figure[]; command?: string }

/** The screen's four reads. */
export interface MemoryScreen {
  lessons(): Promise<{ connected: true; ownerChainBroken: boolean; lessons: LessonRow[] } | NotConnected>;
  decisions(filter: { symbol?: string; before?: string; limit?: number }): Promise<{ connected: true; items: DecisionRow[]; more: boolean } | NotConnected>;
  waiting(): Promise<{ connected: true; proposals: ProposalLine[]; pastHorizon: string[]; withoutWrongIf: number; command: string } | NotConnected>;
  health(): Promise<{ connected: true; home: string; lines: Record<string, number>; partial: string[]; chains: { file: string; ok: boolean; line?: number }[];
    prices: { url: string; last?: { t: string; ok: boolean; refused: number; asked?: number } }; facts: typeof FACE_FACTS; commands: { name: string; line: string }[] } | NotConnected>;
}

/** Why a read gave nothing: it faulted (its error the cause), or it did not answer within {@link SCREEN_READ_MS}. */
export class ScreenFault extends Error {
  constructor(readonly why: "fault" | "late", cause?: unknown) {
    super(why === "late" ? "the memory did not answer in time" : "the memory could not be read", cause === undefined ? undefined : { cause });
    this.name = "ScreenFault";
  }
}

/** `npx --no gravit-memory <words> --home <home>`, the home double-quoted unless it is all of `[A-Za-z0-9_./~-]`
 *  (a double quote, a backslash, a dollar sign and a backtick escaped inside the quotes); no `--home` when no home
 *  is given. */
export function commandOf(home: string | undefined, words: readonly string[]): string {
  const line = `npx --no gravit-memory ${words.join(" ")}`;
  if (home === undefined) return line;
  return `${line} --home ${PLAIN_HOME.test(home) ? home : `"${home.replace(/["\\$`]/g, (ch) => `\\${ch}`)}"`}`;
}

/** Whether `error` is the package's for a home that was never made, judged by its `code` (src/memory-ask.ts). */
const noHome = (error: unknown): boolean => typeof error === "object" && error !== null && (error as { code?: unknown }).code === "E_NO_HOME";

/** A text bounded at {@link SCREEN_TEXT_MAX} characters, whole code points kept. */
function bounded<T extends { sha256: string; text: string; card?: Card; fault?: string }>(copy: T | undefined): LessonText | undefined {
  if (copy === undefined) return undefined;
  const out: LessonText = { sha256: copy.sha256, text: copy.text };
  if (copy.text.length > SCREEN_TEXT_MAX) {
    let text = copy.text.slice(0, SCREEN_TEXT_MAX);
    if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
    out.text = text;
    out.cut = true;
  }
  if (copy.card !== undefined) out.card = copy.card;
  if (copy.fault !== undefined) out.fault = copy.fault;
  return out;
}

/** The face's facts by name. */
const faceDefinitions = new Map(FACE_FACTS.map((f) => [f.fact, f.definition]));

/** The facts `card` checks, each once in its order, then those it defines and does not check. */
function checksOf(card: Card | undefined): LessonRow["checks"] {
  if (card === undefined) return [];
  const names: string[] = [];
  for (const check of card.check ?? []) if (!names.includes(check.fact)) names.push(check.fact);
  for (const fact of Object.keys(card.facts ?? {})) if (!names.includes(fact)) names.push(fact);
  return names.map((fact) => {
    const face = faceDefinitions.get(fact);
    const own = card.facts !== undefined && Object.hasOwn(card.facts, fact) ? card.facts[fact] : undefined;
    return { fact, definition: face ?? own ?? null, face: face !== undefined };
  });
}

/** The commands a lesson's state allows, none for an id off the lesson shape. */
function commandsOf(view: LessonView, home: string): LessonRow["commands"] {
  const out: LessonRow["commands"] = {};
  if (!LESSON_SHAPE.test(view.id)) return out;
  const parses = view.file !== undefined && view.file.card !== undefined && view.file.fault === undefined;
  if (parses && view.state !== "armed" && view.state !== "refused") out.arm = commandOf(home, ["arm", view.id]);
  if (view.state === "armed" || view.state === "changed" || view.state === "broken") out.retire = commandOf(home, ["retire", view.id, "--reason", WORDS_PLACEHOLDER]);
  if (view.state === "changed") out.review = commandOf(home, ["review"]);
  return out;
}

/** One lesson as the screen serves it. */
function lessonRow(view: LessonView, home: string): LessonRow {
  const row: LessonRow = { id: view.id, state: view.state, record: view.record, checks: checksOf(view.armed?.card ?? view.file?.card), commands: commandsOf(view, home) };
  if (view.fault !== undefined) row.fault = view.fault;
  if (view.armedAt !== undefined) row.armedAt = view.armedAt;
  const armed = bounded(view.armed);
  if (armed !== undefined) row.armed = armed;
  const file = bounded(view.file);
  if (file !== undefined) row.file = file;
  return row;
}

/** The decisions' filter with only the keys that are given: the package's filter is strict. */
function filterOf(filter: { symbol?: string; before?: string; limit?: number }): { symbol?: string; before?: string; limit?: number } {
  const out: { symbol?: string; before?: string; limit?: number } = {};
  if (filter.symbol !== undefined) out.symbol = filter.symbol;
  if (filter.before !== undefined) out.before = filter.before;
  if (filter.limit !== undefined) out.limit = filter.limit;
  return out;
}

/** The screen over `open`, its timers injectable for a test. */
export function createMemoryScreen(deps: {
  open: () => Promise<MemoryStanding>;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}): MemoryScreen {
  const setTimer = deps.setTimer ?? ((run: () => void, ms: number): unknown => setTimeout(run, ms));
  const clearTimer = deps.clearTimer ?? ((timer: unknown): void => clearTimeout(timer as ReturnType<typeof setTimeout>));

  /** Opens the memory and runs `read` on it, both within one timer: the shaped answer, not connected, or a fault. */
  function within<T>(read: (memory: Memory, home: string) => Promise<T>): Promise<T | NotConnected> {
    return new Promise((resolve, reject) => {
      let done = false;
      let timer: unknown;
      const finish = (settle: () => void): void => {
        if (done) return;
        done = true;
        try {
          clearTimer(timer);
        } catch {
          /* the timer fires into a settled read */
        }
        settle();
      };
      let home: string | undefined;
      const run = async (): Promise<T | NotConnected> => {
        const standing = await deps.open();
        if (standing.connected !== true) return { connected: false, why: standing.why, say: standing.say, command: commandOf(undefined, ["init"]) };
        home = standing.home;
        return read(standing.memory, standing.home);
      };
      run().then(
        (answer) => finish(() => resolve(answer)),
        (error: unknown) => finish(() => (noHome(error)
          ? resolve({ connected: false, why: "no home", say: NO_MEMORY_HERE, command: commandOf(home, ["init"]) })
          : reject(new ScreenFault("fault", error)))),
      );
      try {
        timer = setTimer(() => finish(() => reject(new ScreenFault("late"))), SCREEN_READ_MS);
      } catch (error) {
        finish(() => reject(new ScreenFault("fault", error)));
      }
    });
  }

  return {
    lessons: () => within(async (memory, home) => {
      const read = await memory.lessons();
      return { connected: true as const, ownerChainBroken: read.ownerChainBroken === true, lessons: read.lessons.map((view) => lessonRow(view, home)) };
    }),
    decisions: (filter) => within(async (memory, home) => {
      const read = await memory.decisions(filterOf(filter));
      const items = read.items.map(({ view, figures }): DecisionRow => {
        const id = view.line.id;
        return !view.void && typeof id === "string" && DECISION_SHAPE.test(id)
          ? { view, figures, command: commandOf(home, ["void", id, "--reason", WORDS_PLACEHOLDER]) }
          : { view, figures };
      });
      return { connected: true as const, items, more: read.more === true };
    }),
    waiting: () => within(async (memory, home) => {
      const read = await memory.review();
      return { connected: true as const, proposals: read.proposals, pastHorizon: read.past_horizon, withoutWrongIf: read.without_wrong_if, command: commandOf(home, ["review"]) };
    }),
    health: () => within(async (memory, home) => {
      const read: Status = await memory.status();
      return {
        connected: true as const, home: read.home, lines: read.lines, partial: read.partial, chains: read.chains, prices: read.prices,
        facts: FACE_FACTS, commands: HEALTH_COMMANDS.map((name) => ({ name, line: commandOf(home, [name]) })),
      };
    }),
  };
}
