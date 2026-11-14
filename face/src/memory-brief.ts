// face/src/memory-brief.ts
/** What the pre-close brief says of the memory: its state, read by the face's own code, for the desk to say in one
 * line (dsh/profile/desk.md). The desk reads the open web and holds none of the memory's tools, so what it says of the
 * memory is this, built here.
 *
 * READ, NEVER CHANGED. {@link readBriefMemory} opens the memory through the opener main.ts builds from the row as
 * composed (src/memory.ts `memoryOpener`, the one the reconcile clock is given) and calls its `status` and `review`,
 * together, and nothing else - never `reconcile`, which is the clock's (src/memory-clock.ts).
 *
 * NUMBERS AND IDS, NEVER WORDS. The desk's model reads the brief, and the status the face's code is given holds unarmed
 * cards whole, so {@link BriefMemory} carries counts, a price run's time and outcome, and lesson ids - at most
 * {@link BRIEF_MEMORY_IDS}, each one only when it has a lesson id's shape ({@link LESSON_ID}): a hand-written ledger
 * line can put anything where an id belongs, and such a card is counted and not listed. No card's words, definition,
 * thesis or reason ever reaches it. Its only free text is one of this module's fixed sentences or a standing's `say`
 * (src/memory.ts's own): a fault is said by its code ({@link briefFaultWords}), never by its message.
 *
 * NOTHING WAITS ON IT. A memory that is not connected, a home nobody made, a fault, and a read that has not answered
 * within {@link BRIEF_MEMORY_LIMIT_MS} are each `{ connected: false, say }`; the reader never rejects. A read past its
 * limit is abandoned, not cancelled: its late answer is dropped.
 * @module
 */
import type { Review, Status } from "gravit-memory";
import { NO_MEMORY_HERE, type MemoryStanding } from "./memory.ts";

/** How long the brief waits for the memory: 2 s. */
export const BRIEF_MEMORY_LIMIT_MS = 2000;
/** The most changed lessons the brief names. */
export const BRIEF_MEMORY_IDS = 5;

/** A lesson id's shape: a lower-case letter or digit, then 1 to 39 lower-case letters, digits or dashes. */
const LESSON_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** The note when the owner's chain is broken: no card applies until the owner reseals it. */
const NOTE_RESEAL = "no lesson is applied until gravit-memory reseal";

/** A fault's sentence, with the package's code after it when the fault carries one. */
const FAULT_SAY = "the memory could not be read";

/** What the brief carries of the memory: not connected, with the words that say why; or its state - the proposals
 * waiting for the owner, the cards changed since they were armed (counted, and the first {@link BRIEF_MEMORY_IDS}
 * well-formed ids), the decisions past their horizon, and the price source: none, or its last run's time when that run
 * asked it, whether it answered and how many prices it refused, all three null before any run; `note` when the owner's
 * chain is broken. */
export type BriefMemory =
  | { connected: false; say: string }
  | {
      connected: true;
      proposals_waiting: number;
      cards_changed: number;
      cards_changed_ids: string[];
      past_horizon_unreviewed: number;
      prices: { source: false } | { source: true; last_asked: string | null; answered: boolean | null; refused: number | null };
      note?: string;
    };

/** The limit's timer; by default `setTimeout` and `clearTimeout`. */
export interface BriefMemoryTimers {
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
}

const DEFAULT_TIMERS: BriefMemoryTimers = {
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (timer) => clearTimeout(timer as NodeJS.Timeout),
};

/** A package's error code: `E_` then 1 to 24 upper-case letters, digits or underscores. */
const PACKAGE_CODE = /^E_[A-Z0-9_]{1,24}$/;

/**
 * A memory fault as the brief says it: by its code in a fixed sentence, never by its message, which can quote a file
 * of the home, a value the memory's config held or a path of the machine. A home nobody made is {@link NO_MEMORY_HERE};
 * a fault carrying a package code is `the memory could not be read (<code>)`; anything else, a file-system error
 * included, `the memory could not be read`. (src/memory.ts `memoryFaultWords` stays the log's wording.)
 */
export function briefFaultWords(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === "E_NO_HOME") return NO_MEMORY_HERE;
  return typeof code === "string" && PACKAGE_CODE.test(code) ? `${FAULT_SAY} (${code})` : FAULT_SAY;
}

/** The length of `value` when it is an array, else 0. */
function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/** The price source as the brief says it, from the status's `prices`. A last run's time is written as an ISO-8601 UTC
 * time, and one that is not a time is null, so nothing but a time reaches the brief. */
function pricesOf(prices: Status["prices"] | undefined): Extract<BriefMemory, { connected: true }>["prices"] {
  if (typeof prices?.url !== "string" || prices.url === "") return { source: false };
  const last = prices.last;
  if (last === undefined || last === null) return { source: true, last_asked: null, answered: null, refused: null };
  const at = typeof last.t === "string" ? Date.parse(last.t) : Number.NaN;
  const asked = last.asked === undefined || (typeof last.asked === "number" && last.asked >= 1);
  return {
    source: true,
    last_asked: asked && Number.isFinite(at) ? new Date(at).toISOString() : null,
    answered: typeof last.ok === "boolean" ? last.ok : null,
    refused: Number.isInteger(last.refused) && last.refused >= 0 ? last.refused : null,
  };
}

/** The brief's memory from a status and a review: numbers and well-formed ids alone. */
function briefMemoryOf(status: Status, review: Review): BriefMemory {
  const changed = (Array.isArray(status.cards) ? status.cards : []).filter((card) => card?.state === "changed");
  const ids = changed.map((card) => card.id).filter((id): id is string => typeof id === "string" && LESSON_ID.test(id));
  const ownerBroken = (Array.isArray(status.chains) ? status.chains : []).some((chain) => chain?.file === "owner.jsonl" && chain.ok === false);
  return {
    connected: true,
    proposals_waiting: countOf(review.proposals),
    cards_changed: changed.length,
    cards_changed_ids: ids.slice(0, BRIEF_MEMORY_IDS),
    past_horizon_unreviewed: countOf(review.past_horizon),
    prices: pricesOf(status.prices),
    ...(ownerBroken ? { note: NOTE_RESEAL } : {}),
  };
}

/** One read, never a throw: the standing that is not connected, the state, or the fault in words - a home nobody made
 * said as the door says it. */
async function readMemory(open: () => Promise<MemoryStanding>): Promise<BriefMemory> {
  try {
    const standing = await open();
    if (!standing.connected) return { connected: false, say: standing.say };
    const [status, review] = await Promise.all([standing.memory.status(), standing.memory.review()]);
    return briefMemoryOf(status, review);
  } catch (error) {
    return { connected: false, say: briefFaultWords(error) };
  }
}

/**
 * The memory's state for the brief (see the module header), within `limitMs`.
 * @param open - opens the memory as the row was composed (src/memory.ts `memoryOpener`).
 * @param limitMs - how long to wait, {@link BRIEF_MEMORY_LIMIT_MS} by default.
 * @param timers - the limit's timer, for tests.
 * @returns never rejects.
 */
export function readBriefMemory(
  open: () => Promise<MemoryStanding>,
  limitMs: number = BRIEF_MEMORY_LIMIT_MS,
  timers: BriefMemoryTimers = DEFAULT_TIMERS,
): Promise<BriefMemory> {
  return new Promise<BriefMemory>((resolve) => {
    let done = false;
    /* declared before `finish` reads it, so a timer that fires at once finds it */
    let limit: unknown;
    const finish = (memory: BriefMemory): void => {
      if (done) return;
      done = true;
      timers.clearTimer(limit);
      resolve(memory);
    };
    limit = timers.setTimer(() => finish({ connected: false, say: `the memory did not answer in ${limitMs / 1000} s` }), limitMs);
    void readMemory(open).then(finish);
  });
}
