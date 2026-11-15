/** The memory gate: when an order card is about to be raised for a seat write, the face's own code asks the owner's
 * memory which lessons apply to each of the order's lines, and keeps the answer by the tool call's id for the card
 * to draw ({@link createMemoryGate}).
 *
 * A check reads the call's arguments into validated lines (src/memory-order.ts `gateOrdersOf`); a call the gate does
 * not check is kept as `not checked`, with why, and the memory is not opened. Otherwise, on one clock for the whole
 * check: the memory is opened; then, for every line together, the venue (`paper` is the Account's one paper venue),
 * the position and the instrument's kind under {@link GATE_ACCOUNT_MS}; the price facts under {@link GATE_FACTS_MS}
 * when a market was placed (src/memory-facts.ts); then the recall, as {@link FACE_MEMORY_NAME}, with whatever is left
 * of {@link GATE_CHECK_MS}. The recall is asked only the line's validated fields and the face's own facts: nothing of
 * the model's arguments is passed on as text, and a fact the model supplied is not carried over. A read that loses
 * its race is left to finish and ignored; the kept view never changes once the check settles.
 *
 * `check` never rejects and settles within {@link GATE_CHECK_MS}; at most {@link GATE_KEPT} calls are kept, the
 * oldest out first. {@link gateAccount} is the gate's Account over the Account proxy's in-process reads.
 *
 * A kept call is red-lined when a lesson with `strength: "red-line"` and `says: "dont"` applies to one of its lines.
 * Gate 2's guard reads `redLineReason` on every granted seat write: a red-lined call with no override on record is
 * refused with {@link redLineRefusal} of its first red line, in line order. `override` keeps the owner's words for a
 * red-lined card that is still waiting; a card answered takes none.
 * @module
 */
import type { RecallAnswer } from "gravit-memory";
import type { AccountReader } from "./account-proxy.ts";
import { heldFacts, type Facts } from "./memory-facts.ts";
import {
  consideringOf, gateOrdersOf, marketOfKind, memorySymbol, orderWords, VENUE_ID,
  type Action, type OrderLine, type Position,
} from "./memory-order.ts";
import { FACE_MEMORY_NAME, memoryFaultWords, type MemoryStanding } from "./memory.ts";
import type { UpstreamAnswer, UpstreamRouteRead } from "./upstream-proxy.ts";

/** The whole check's bound, the Account reads' and the price facts'; and how many calls are kept. */
export const GATE_CHECK_MS = 3_000, GATE_ACCOUNT_MS = 1_000, GATE_FACTS_MS = 1_500, GATE_KEPT = 200;

/** A tool call's id the gate keeps an answer by. */
export const CALL_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/** A seat write about to be carded. */
export interface GateCall { callId: string; name: string; args: unknown; sessionId: string }

/** A lesson that applies, as the card draws it: the owner's record of it. */
export interface GateLesson {
  id: string; strength: "caveat" | "red-line"; says: "dont" | "do" | "careful"; words: string;
  fired: number; followed: number; overridden: number;
}

/** A lesson that could not be told, and what it needs: `market`, or a fact's name. */
export interface GateUntold { id: string; needs: string[] }

/** One order line as checked. */
export interface GateLine {
  leg?: number; order: string; considering: Action[]; positionRead: boolean; market?: "US"; recall?: string;
  lessons: GateLesson[]; lessonsMore: number; untold: GateUntold[]; untoldMore: number; fault?: string;
  /** What was written for this line, or why nothing was. */
  registered?: string;
}

/** What is kept for a call. */
export interface GateView {
  callId: string; state: "checked" | "not checked" | "not connected"; words?: string; lines: GateLine[];
  redLine: boolean; overridden: boolean;
}

/** What a check tells its caller: how many lessons apply, and whether one is a red line. */
export interface GateNote { lessons: number; redLine: boolean }

/** The Account as the gate reads it. */
export interface GateAccount {
  /** The one venue whose `paper` is true. */
  paperVenue(): Promise<string | undefined>;
  position(venue: string, symbol: string): Promise<Position | null | undefined>;
  kind(venue: string, symbol: string): Promise<string | undefined>;
}

export interface MemoryGateDeps {
  open: () => Promise<MemoryStanding>;
  facts: (symbol: string, market: "US") => Promise<Facts>;
  account: GateAccount;
  log: (line: string) => void;
  now?: () => number; setTimer?: (run: () => void, ms: number) => unknown; clearTimer?: (timer: unknown) => void;
}

/** The owner's override of a red-lined card, in their own words. */
export interface GateOverride { reason: string; wrongIf?: string }

export interface MemoryGate {
  /** Asks the memory for an order card about to be raised and keeps the answer by callId. Never rejects; settles within GATE_CHECK_MS. */
  check(call: GateCall): Promise<GateNote | undefined>;
  view(callId: string): GateView | undefined;
  /** Keeps the owner's override for a red-lined card that is still waiting. */
  override(callId: string, body: GateOverride): "kept" | "no such card" | "no red line" | "answered";
  /** The guard's read: words when the call is red-lined with no override on record, else undefined. Synchronous; never throws. */
  redLineReason(callId: string | undefined): string | undefined;
  dispose(): void;
}

/** A line's fault when its recall loses the race. */
const LATE = "the memory did not answer in time";

/** How much of a lesson's words the guard's refusal quotes. */
const REFUSAL_WORDS_MAX = 200;

/** The guard's refusal of a red-lined call with no override on record; the lesson's words cut to 200 characters. */
export function redLineRefusal(words: string): string {
  const cut = [...String(words)].slice(0, REFUSAL_WORDS_MAX).join("");
  return `a red line applies to this order - "${cut}" - and no override is on record: the owner opens the card and overrides it in their own words`;
}

/** One line of a kept call: the order as read, the position it was read against, and what the card draws. */
interface LineEntry { order: OrderLine; position: Position | null | undefined; view: GateLine }

/** One kept call: the call, its state, and its lines. `pending` while the check runs. `override` is the owner's, kept
 * only for a red-lined card; `answered` is set once the card is answered, after which no override is taken. */
interface Entry {
  call: GateCall; state: GateView["state"] | "pending"; words?: string; lines: LineEntry[];
  override?: GateOverride; answered?: boolean;
}

/** The words of the entry's first red-line lesson, in line order, or undefined. */
function firstRedLine(entry: Entry): string | undefined {
  for (const line of entry.lines) {
    for (const lesson of line.view.lessons) if (isRedLine(lesson)) return lesson.words;
  }
  return undefined;
}

/** A read's outcome against its timer. */
type Raced<T> = { kind: "ok"; value: T } | { kind: "late" } | { kind: "fault"; error: unknown };

const valueOf = <T>(r: Raced<T>): T | undefined => (r.kind === "ok" ? r.value : undefined);
const isRedLine = (l: GateLesson): boolean => l.strength === "red-line" && l.says === "dont";
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** The facts that may be given: a finite number or a flag, with a source line. */
function givenFacts(...parts: Facts[]): Facts {
  const out: Facts = { facts: {}, sources: {} };
  for (const part of parts) {
    for (const [key, value] of Object.entries(part?.facts ?? {})) {
      const source = part.sources?.[key];
      if (typeof source !== "string" || !(typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))) continue;
      out.facts[key] = value;
      out.sources[key] = source;
    }
  }
  return out;
}

/** The recall's answer as the card draws it. */
function answered(view: GateLine, answer: RecallAnswer): void {
  view.recall = String(answer.recall_id);
  view.lessons = answer.applies.map((card) => ({
    id: card.id, strength: card.strength, says: card.says, words: card.words,
    fired: count(card.record?.owner?.fired), followed: count(card.record?.owner?.followed), overridden: count(card.record?.owner?.overridden),
  }));
  view.lessonsMore = count(answer.applies_more);
  view.untold = answer.untold.map((card) => ({ id: card.id, needs: card.needs.map((need) => (need.what === "fact" ? need.fact : "market")) }));
  view.untoldMore = count(answer.untold_more);
}

export function createMemoryGate(deps: MemoryGateDeps): MemoryGate {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((run: () => void, ms: number): unknown => setTimeout(run, ms));
  const clearTimer = deps.clearTimer ?? ((timer: unknown): void => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const entries = new Map<string, Entry>();
  /** Every race still running, by the function that ends it as late. */
  const running = new Set<() => void>();
  let disposed = false;

  const say = (line: string): void => {
    try {
      deps.log(`memory gate: ${line}`);
    } catch {
      /* a log that throws costs the check nothing */
    }
  };

  /** `read` raced against its own timer of `ms`; no time left asks nothing. Never rejects. */
  function within<T>(read: () => Promise<T>, ms: number): Promise<Raced<T>> {
    if (disposed || !(ms > 0)) return Promise.resolve({ kind: "late" });
    let pending: Promise<T>;
    try {
      pending = Promise.resolve(read());
    } catch (error) {
      return Promise.resolve({ kind: "fault", error });
    }
    return new Promise((resolve) => {
      let done = false;
      let timer: unknown;
      const settle = (outcome: Raced<T>): void => {
        if (done) return;
        done = true;
        running.delete(late);
        try {
          clearTimer(timer);
        } catch {
          /* the timer fires into a settled race */
        }
        resolve(outcome);
      };
      const late = (): void => settle({ kind: "late" });
      running.add(late);
      pending.then((value) => settle({ kind: "ok", value }), (error: unknown) => settle({ kind: "fault", error }));
      try {
        timer = setTimer(late, ms);
      } catch {
        late();
      }
    });
  }

  function keep(entry: Entry): void {
    entries.set(entry.call.callId, entry);
    while (entries.size > GATE_KEPT) entries.delete(entries.keys().next().value!);
  }

  /** One line, checked: its account reads, its facts, its recall. */
  async function checkLine(
    order: OrderLine, memory: { recall: (by: string, input: unknown) => Promise<RecallAnswer> }, paper: Promise<string | undefined>,
    accountLeft: () => number, left: () => number,
  ): Promise<LineEntry> {
    const venue = order.venue === "paper" ? await paper : order.venue;
    let position: Position | null | undefined;
    let market: "US" | undefined;
    if (venue !== undefined) {
      const [held, kind] = await Promise.all([
        within(() => deps.account.position(venue, order.symbol), accountLeft()),
        within(() => deps.account.kind(venue, order.symbol), accountLeft()),
      ]);
      position = valueOf(held);
      market = marketOfKind(valueOf(kind));
    }
    const symbol = memorySymbol(order, market);
    const price = symbol === undefined ? undefined : valueOf(await within(() => deps.facts(symbol, "US"), Math.min(GATE_FACTS_MS, left())));
    const last = price?.facts?.price;
    const given = givenFacts(price ?? { facts: {}, sources: {} }, heldFacts(position, typeof last === "number" ? last : undefined, venue ?? order.venue));
    const considering = consideringOf(order, position);
    const input: Record<string, unknown> = { considering };
    if (symbol !== undefined) Object.assign(input, { symbol, market });
    if (Object.keys(given.facts).length > 0) Object.assign(input, { facts: given.facts, fact_sources: given.sources });
    const view: GateLine = {
      ...(order.leg === undefined ? {} : { leg: order.leg }),
      order: orderWords(order), considering: [...considering], positionRead: position !== undefined,
      ...(symbol === undefined ? {} : { market }),
      lessons: [], lessonsMore: 0, untold: [], untoldMore: 0,
    };
    const recalled = await within(() => memory.recall(FACE_MEMORY_NAME, input), left());
    if (recalled.kind === "ok") {
      try {
        answered(view, recalled.value);
      } catch (error) {
        Object.assign(view, { lessons: [], lessonsMore: 0, untold: [], untoldMore: 0, fault: memoryFaultWords(error) });
        delete view.recall;
      }
    } else {
      view.fault = recalled.kind === "late" ? LATE : memoryFaultWords(recalled.error);
    }
    if (view.fault !== undefined) say(`${view.order}: ${view.fault}`);
    return { order, position, view };
  }

  async function run(call: GateCall, entry: Entry): Promise<GateNote | undefined> {
    const start = now();
    const left = (): number => GATE_CHECK_MS - (now() - start);
    const orders = gateOrdersOf(call.name, call.args);
    if (orders.kind === "none") {
      Object.assign(entry, { state: "not checked", words: orders.why });
      return undefined;
    }
    const opened = await within(() => deps.open(), left());
    const standing = valueOf(opened);
    if (standing?.connected !== true) {
      const words = standing !== undefined ? standing.say : opened.kind === "fault" ? memoryFaultWords(opened.error) : LATE;
      Object.assign(entry, { state: "not connected", words: String(words) });
      return undefined;
    }
    const accountStart = now();
    const accountLeft = (): number => Math.min(GATE_ACCOUNT_MS - (now() - accountStart), left());
    const paper = orders.lines.some((line) => line.venue === "paper")
      ? within(() => deps.account.paperVenue(), accountLeft()).then((r) => {
        const id = valueOf(r);
        return typeof id === "string" && VENUE_ID.test(id) ? id : undefined;
      })
      : Promise.resolve(undefined);
    const lines = await Promise.all(orders.lines.map((order) => checkLine(order, standing.memory, paper, accountLeft, left)));
    Object.assign(entry, { state: "checked", lines });
    const views = lines.map((line) => line.view);
    return {
      lessons: views.reduce((n, view) => n + view.lessons.length + view.lessonsMore, 0),
      redLine: views.some((view) => view.lessons.some(isRedLine)),
    };
  }

  return {
    async check(call) {
      try {
        if (disposed || typeof call?.callId !== "string" || !CALL_ID.test(call.callId) || entries.has(call.callId)) return undefined;
        const entry: Entry = { call, state: "pending", lines: [] };
        keep(entry);
        try {
          return await run(call, entry);
        } catch (error) {
          Object.assign(entry, { state: "not checked", words: memoryFaultWords(error), lines: [] });
          say(`${call.callId}: ${memoryFaultWords(error)}`);
          return undefined;
        }
      } catch {
        return undefined;
      }
    },
    view(callId) {
      const entry = entries.get(callId);
      if (entry === undefined || entry.state === "pending") return undefined;
      const lines = entry.lines.map((line) => structuredClone(line.view));
      return {
        callId, state: entry.state, ...(entry.words === undefined ? {} : { words: entry.words }), lines,
        redLine: lines.some((line) => line.lessons.some(isRedLine)), overridden: entry.override !== undefined,
      };
    },
    override(callId, body) {
      const entry = entries.get(callId);
      if (entry === undefined || entry.state === "pending") return "no such card";
      if (entry.answered === true) return "answered";
      if (firstRedLine(entry) === undefined) return "no red line";
      entry.override = { reason: String(body.reason), ...(body.wrongIf === undefined ? {} : { wrongIf: String(body.wrongIf) }) };
      return "kept";
    },
    redLineReason(callId) {
      try {
        if (typeof callId !== "string") return undefined;
        const entry = entries.get(callId);
        if (entry === undefined || entry.state !== "checked" || entry.override !== undefined) return undefined;
        const words = firstRedLine(entry);
        return words === undefined ? undefined : redLineRefusal(words);
      } catch (error) {
        try {
          say(`${callId}: the red line could not be read: ${memoryFaultWords(error)}`);
        } catch {
          /* an error that throws as it is read costs the guard nothing */
        }
        return undefined;
      }
    },
    dispose() {
      disposed = true;
      entries.clear();
      for (const late of [...running]) late();
    },
  };
}

/** A 200 answer's body as JSON whose `ok` is true, or undefined. */
function okBody(answer: UpstreamAnswer | undefined): Record<string, unknown> | undefined {
  if (answer === undefined || !("status" in answer) || answer.status !== 200) return undefined;
  try {
    const body = JSON.parse(answer.body) as unknown;
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const positiveOf = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

/** `GateAccount` over the Account proxy's reads. */
export function gateAccount(reads: { reader: AccountReader; positions: UpstreamRouteRead; market: UpstreamRouteRead }): GateAccount {
  const read = async (ask: () => Promise<UpstreamAnswer>): Promise<UpstreamAnswer | undefined> => {
    try {
      return await ask();
    } catch {
      return undefined;
    }
  };
  return {
    async paperVenue() {
      const venues = okBody(await read(() => reads.reader.read()))?.venues;
      if (!Array.isArray(venues)) return undefined;
      const paper = venues.filter((v) => (v as { paper?: unknown } | null)?.paper === true);
      const id = paper.length === 1 ? (paper[0] as { id?: unknown }).id : undefined;
      return typeof id === "string" && VENUE_ID.test(id) ? id : undefined;
    },
    async position(venue, symbol) {
      const body = okBody(await read(() => reads.positions(new URLSearchParams({ venue }).toString())));
      if (body?.ok !== true || !Array.isArray(body.positions)) return undefined;
      const entry = body.positions.find((p) => (p as { symbol?: unknown } | null)?.symbol === symbol) as Record<string, unknown> | undefined;
      if (entry === undefined) return null;
      const { side } = entry;
      const qty = positiveOf(entry.qty);
      if ((side !== "long" && side !== "short") || qty === undefined) return undefined;
      const entryPrice = positiveOf(entry.entryPrice);
      return entryPrice === undefined ? { side, qty } : { side, qty, entryPrice };
    },
    async kind(venue, symbol) {
      const body = okBody(await read(() => reads.market(new URLSearchParams({ venue, symbol }).toString())));
      const kind = body?.ok === true ? (body.market as { kind?: unknown } | null | undefined)?.kind : undefined;
      return typeof kind === "string" ? kind : undefined;
    },
  };
}
