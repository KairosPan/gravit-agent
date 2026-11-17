/** One recall of the owner's memory, as {@link FACE_MEMORY_NAME}, shared by the places the face's own code asks it
 * which lessons apply ({@link askMemory}): the order card's gate (src/memory-gate.ts) among them.
 *
 * The recall is given the question - the actions considered, the symbol and its market when one was placed - and the
 * face's own facts with their sources, when there are any; nothing else. Its answer is mapped into the lessons that
 * apply, the lessons that could not be told and what each needs, the counts left out, and the recall's id. The memory
 * is opened and asked on one timer of the caller's `ms`: a recall that loses the race is left to finish and ignored,
 * and is the fault {@link ASK_LATE}; an `open` or a recall that rejects with the package's `E_NO_HOME` - a home that
 * was never made - is not connected, in `memoryFaultWords`'s words; one that otherwise throws, rejects or answers what
 * cannot be read is a fault in those words. Nothing here throws or rejects.
 * @module
 */
import type { RecallAnswer } from "gravit-memory";
import type { Facts, FactMarket } from "./memory-facts.ts";
import type { Action } from "./memory-order.ts";
import { FACE_MEMORY_NAME, memoryFaultWords, type MemoryStanding } from "./memory.ts";

/** A lesson that applies, as the card draws it: the owner's record of it. */
export interface GateLesson {
  id: string; strength: "caveat" | "red-line"; says: "dont" | "do" | "careful"; words: string;
  fired: number; followed: number; overridden: number;
}

/** A lesson that could not be told, and what it needs: `market`, or a fact's name. */
export interface GateUntold { id: string; needs: string[] }

/** What one recall told: its id when it answered, or a fault. */
export interface Asked { recall?: string; lessons: GateLesson[]; lessonsMore: number; untold: GateUntold[]; untoldMore: number; fault?: string }

/** The question: the actions considered, the symbol and its market when one was placed, and the face's own facts. */
export interface AskInput { considering: Action[]; symbol?: string; market?: FactMarket; facts: Facts }

/** What was asked, or the memory's words for why it is not connected. */
export type AskAnswer = { asked: Asked } | { notConnected: string };

/** The fault of a recall that did not answer within its bound. */
export const ASK_LATE = "the memory did not answer in time";

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** Whether `error` is the package's for a home that was never made: judged by its `code`, as src/memory.ts
 * `memoryFaultWords` judges it. */
export const noHome = (error: unknown): boolean => typeof error === "object" && error !== null && (error as { code?: unknown }).code === "E_NO_HOME";

/** Nothing told, with why. */
const faulted = (fault: string): AskAnswer => ({ asked: { lessons: [], lessonsMore: 0, untold: [], untoldMore: 0, fault } });

/** The recall's answer as the card draws it; throws on an answer that cannot be read. */
function mapped(answer: RecallAnswer): Asked {
  return {
    recall: String(answer.recall_id),
    lessons: answer.applies.map((card) => ({
      id: card.id, strength: card.strength, says: card.says, words: card.words,
      fired: count(card.record?.owner?.fired), followed: count(card.record?.owner?.followed), overridden: count(card.record?.owner?.overridden),
    })),
    lessonsMore: count(answer.applies_more),
    untold: answer.untold.map((card) => ({ id: card.id, needs: card.needs.map((need) => (need.what === "fact" ? need.fact : "market")) })),
    untoldMore: count(answer.untold_more),
  };
}

/** What `recall` is given: the question, and the symbol with its market when one was placed, and the facts with
 * their sources when there are any. */
function recallInput(input: AskInput): Record<string, unknown> {
  const out: Record<string, unknown> = { considering: input.considering };
  if (input.symbol !== undefined) Object.assign(out, { symbol: input.symbol, market: input.market });
  if (Object.keys(input.facts.facts).length > 0) Object.assign(out, { facts: input.facts.facts, fact_sources: input.facts.sources });
  return out;
}

/** One recall as `gravit-face`, settled within `ms`: `open` and the recall race one timer, set as the ask begins; no
 * time left asks nothing. Never rejects. */
export function askMemory(
  open: () => Promise<MemoryStanding>, input: AskInput,
  opts: { ms: number; setTimer?: (run: () => void, ms: number) => unknown; clearTimer?: (timer: unknown) => void },
): Promise<AskAnswer> {
  if (!(opts.ms > 0)) return Promise.resolve(faulted(ASK_LATE));
  const setTimer = opts.setTimer ?? ((run: () => void, ms: number): unknown => setTimeout(run, ms));
  const clearTimer = opts.clearTimer ?? ((timer: unknown): void => clearTimeout(timer as ReturnType<typeof setTimeout>));
  return new Promise((resolve) => {
    let done = false;
    let timer: unknown;
    const settle = (answer: AskAnswer): void => {
      if (done) return;
      done = true;
      try {
        clearTimer(timer);
      } catch {
        /* the timer fires into a settled ask */
      }
      resolve(answer);
    };
    const ask = async (): Promise<AskAnswer> => {
      const standing = await open();
      if (done) return faulted(ASK_LATE);
      if (standing?.connected !== true) return { notConnected: String(standing?.say) };
      const answer = await standing.memory.recall(FACE_MEMORY_NAME, recallInput(input));
      return { asked: mapped(answer) };
    };
    ask().then(settle, (error: unknown) => settle(noHome(error) ? { notConnected: memoryFaultWords(error) } : faulted(memoryFaultWords(error))));
    try {
      timer = setTimer(() => settle(faulted(ASK_LATE)), opts.ms);
    } catch {
      settle(faulted(ASK_LATE));
    }
  });
}
