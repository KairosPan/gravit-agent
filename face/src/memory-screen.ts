/** The owner's memory screen, its four reads: the lessons, the decisions, what waits for the owner and the home's
 * health, each shaped for the page from one call of the library, through the face's own handle (src/memory.ts
 * `MemoryStanding`).
 *
 * Only `lessons`, `decisions`, `review` and `status` are called: nothing here writes the memory, and nothing is kept
 * between calls but the reads out: one read of a kind at a time (the decisions' kind is their filter), a request while
 * one is out awaiting it, past its bound too, so a slow memory is asked once. Each request races the open and the one
 * library call against its own timer of {@link SCREEN_READ_MS}; one that loses the race rejects as the
 * {@link ScreenFault} `late`, the read left to finish; a read that throws or rejects otherwise rejects as the fault
 * `fault`, its error kept as the cause. A standing that is not connected answers `connected: false` with the face's
 * words for it; a read that rejects with the package's `E_NO_HOME` - a home that was never made - with the package's
 * words and the command that makes the home, the one not-connected answer that carries a command.
 *
 * Every command the screen shows is built here ({@link commandOf}), from ids that fit their shapes and the home of
 * the face's own standing: a row whose id does not fit carries none. A card's text is served at most
 * {@link SCREEN_TEXT_MAX} characters, marked `cut` when cut.
 * @module
 */
import type { Card, CardRecord, Check, DecisionView, Figure, LessonView, Memory, ProposalLine, Status } from "gravit-memory";
import { FACE_FACTS } from "./memory-facts.ts";
import { MEMORY_NO_HOME_NOTICE, MEMORY_NO_INSTALL_NOTICE, NO_MEMORY_HERE, type MemoryStanding } from "./memory.ts";

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

/** Not connected: why, and the words that say so; `command`, for a home never made alone, the one that makes it. */
export type NotConnected = { connected: false; why: "disabled" | "no install" | "no home named" | "no home"; say: string; command?: string };

/** One row of what a card checks: a check, with its operator and value as the card has them, or (no `op`, no
 *  `value`) a fact the card defines and does not check. `own`: the card's own definition of the fact; `definition`:
 *  the face's, when `face` - the face computes the fact. */
export interface CheckRow { fact: string; op?: Check["op"]; value?: Check["value"]; own: string | null; definition: string | null; face: boolean }

/** A card's text as served: at most {@link SCREEN_TEXT_MAX} characters, `cut` when cut. */
export interface LessonText { sha256: string; text: string; cut?: true; card?: Card; fault?: string }

/** One lesson card as the Lessons tab draws it. */
export interface LessonRow {
  id: string; state: "armed" | "changed" | "broken" | "unarmed" | "retired" | "refused"; fault?: string; armedAt?: string;
  armed?: LessonText; file?: LessonText; record: CardRecord | null;
  /** Each check of the card that applies (the armed copy's, else the file's) in its order, then each fact it defines
   *  and does not check. */
  checks: CheckRow[];
  /** The terminal's command for each act the state allows. */
  commands: { arm?: string; retire?: string; review?: string };
}

/** One decision as the Decisions tab draws it; `command`: the void, when it is not void. */
export interface DecisionRow { view: DecisionView; figures: Figure[]; command?: string }

/** The screen's four reads. */
export interface MemoryScreen {
  /** `reseal`: the command that reseals the owner's chain, while it is broken and only then. */
  lessons(): Promise<{ connected: true; ownerChainBroken: boolean; lessons: LessonRow[]; reseal?: string } | NotConnected>;
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

/** What the screen says for a standing that is not connected, in the face's own words: with no home named, what
 *  names one; with no install, what installs it; a disabled row, its standing's words. */
function sayOf(why: "disabled" | "no install" | "no home named", say: string): string {
  if (why === "no home named") return MEMORY_NO_HOME_NOTICE;
  if (why === "no install") return MEMORY_NO_INSTALL_NOTICE;
  return say;
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

/** Each check of `card` in its order, with the card's own definition of its fact and the face's, then each fact the
 *  card defines and does not check. */
function checksOf(card: Card | undefined): CheckRow[] {
  if (card === undefined) return [];
  const about = (fact: string): Omit<CheckRow, "fact" | "op" | "value"> => {
    const face = faceDefinitions.get(fact);
    const own = card.facts !== undefined && Object.hasOwn(card.facts, fact) ? card.facts[fact] : undefined;
    return { own: own ?? null, definition: face ?? null, face: face !== undefined };
  };
  const checks = card.check ?? [];
  const rows: CheckRow[] = checks.map((check) => ({ fact: check.fact, op: check.op, value: check.value, ...about(check.fact) }));
  for (const fact of Object.keys(card.facts ?? {})) {
    if (!checks.some((check) => check.fact === fact)) rows.push({ fact, ...about(fact) });
  }
  return rows;
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

  /** The reads out now by kind, each until it settles, past its bound too. */
  const out = new Map<string, Promise<unknown>>();

  /** Opens the memory and runs `read` on it: the shaped answer, not connected, or the error. */
  async function run<T>(read: (memory: Memory, home: string) => Promise<T>): Promise<T | NotConnected> {
    const standing = await deps.open();
    if (standing.connected !== true) return { connected: false, why: standing.why, say: sayOf(standing.why, standing.say) };
    try {
      return await read(standing.memory, standing.home);
    } catch (error) {
      if (noHome(error)) return { connected: false, why: "no home", say: NO_MEMORY_HERE, command: commandOf(standing.home, ["init"]) };
      throw error;
    }
  }

  /** The read of kind `kind`, one at a time: a request while one is out awaits it, past its bound too, so a slow
   *  memory is asked once; each request waits within its own timer: the shaped answer, not connected, or a fault. */
  function within<T>(kind: string, read: (memory: Memory, home: string) => Promise<T>): Promise<T | NotConnected> {
    let pending = out.get(kind) as Promise<T | NotConnected> | undefined;
    if (pending === undefined) {
      const started = run(read);
      pending = started;
      out.set(kind, started);
      const clear = (): void => { if (out.get(kind) === started) out.delete(kind); };
      started.then(clear, clear);
    }
    const answer = pending;
    return new Promise((resolve, reject) => {
      let done = false;
      let timer: unknown;
      const finish = (settle: () => void): void => {
        if (done) return;
        done = true;
        try {
          clearTimer(timer);
        } catch {
          /* a timer that cannot be cleared fires into a read already settled, which ignores it */
        }
        settle();
      };
      answer.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(new ScreenFault("fault", error))),
      );
      try {
        timer = setTimer(() => finish(() => reject(new ScreenFault("late"))), SCREEN_READ_MS);
      } catch (error) {
        finish(() => reject(new ScreenFault("fault", error)));
      }
    });
  }

  return {
    lessons: () => within("lessons", async (memory, home) => {
      const read = await memory.lessons();
      const ownerChainBroken = read.ownerChainBroken === true;
      const lessons = read.lessons.map((view) => lessonRow(view, home));
      return ownerChainBroken
        ? { connected: true as const, ownerChainBroken, lessons, reseal: commandOf(home, ["reseal"]) }
        : { connected: true as const, ownerChainBroken, lessons };
    }),
    decisions: (filter) => within(`decisions ${JSON.stringify(filterOf(filter))}`, async (memory, home) => {
      const read = await memory.decisions(filterOf(filter));
      const items = read.items.map(({ view, figures }): DecisionRow => {
        const id = view.line.id;
        return !view.void && typeof id === "string" && DECISION_SHAPE.test(id)
          ? { view, figures, command: commandOf(home, ["void", id, "--reason", WORDS_PLACEHOLDER]) }
          : { view, figures };
      });
      return { connected: true as const, items, more: read.more === true };
    }),
    waiting: () => within("waiting", async (memory, home) => {
      const read = await memory.review();
      return { connected: true as const, proposals: read.proposals, pastHorizon: read.past_horizon, withoutWrongIf: read.without_wrong_if, command: commandOf(home, ["review"]) };
    }),
    health: () => within("health", async (memory, home) => {
      const read: Status = await memory.status();
      return {
        connected: true as const, home: read.home, lines: read.lines, partial: read.partial, chains: read.chains, prices: read.prices,
        facts: FACE_FACTS, commands: HEALTH_COMMANDS.map((name) => ({ name, line: commandOf(home, [name]) })),
      };
    }),
  };
}
