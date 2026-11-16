/** The memory gate: when an order card is about to be raised for a seat write, the face's own code asks the owner's
 * memory which lessons apply to each of the order's lines, and keeps the answer by the tool call's id for the card
 * to draw ({@link createMemoryGate}).
 *
 * A check reads the call's arguments into validated lines (src/memory-order.ts `gateOrdersOf`); a call the gate does
 * not check is kept as `not checked`, with why, and the memory is not opened. Otherwise, on one clock for the whole
 * check: the memory is opened; then, for every line together, the venue (`paper` is the Account's one paper venue),
 * the position (read fresh) and the instrument's kind under {@link GATE_ACCOUNT_MS}; the price facts under
 * {@link GATE_FACTS_MS} when a market was placed, each of their two reads asked under {@link GATE_FACT_READ_MS}
 * (src/memory-facts.ts); then the recall, as {@link FACE_MEMORY_NAME}, with whatever is left of {@link GATE_CHECK_MS}. The recall is asked only the line's validated fields and the face's own facts: nothing of
 * the model's arguments is passed on as text, and a fact the model supplied is not carried over. A read that loses
 * its race is left to finish and ignored; the kept view never changes once the check settles.
 *
 * `check` never rejects and settles within {@link GATE_CHECK_MS}. Each entry records the session it was checked for;
 * a callId checked again is held by a placeholder until the new check settles, then replaced whole. At most
 * {@link GATE_KEPT} calls are kept, the oldest out first, save a red line still waiting (no override on record, not
 * answered) and a placeholder whose check runs, which are never evicted. {@link gateAccount} is the gate's Account
 * over the Account proxy's in-process reads.
 *
 * A kept call is red-lined when a lesson with `strength: "red-line"` and `says: "dont"` applies to one of its lines.
 * Gate 2's guard reads `redLineReason` on every granted seat write, with the calling execution's session: a callId
 * being checked again is refused with {@link CHECK_NOT_FINISHED}, one kept for another session with
 * {@link HELD_BY_ANOTHER}, and a red-lined call with no override on record with {@link redLineRefusal} of its first
 * red line, in line order. `override` keeps the owner's words for a red-lined card that is still waiting; a card
 * answered takes none.
 *
 * The owner's answer is registered by this code, in the owner's name, as {@link FACE_MEMORY_NAME} ({@link followAnswers}
 * feeds it): its trigger is the session's own `approval/decided` for the call, the seat's result and the Account's card
 * status, and its content the validated line, the override form and those answers' shapes - never a tool argument or a
 * model's text. Every decided card is marked answered, and only from the session it was checked for. Declined at
 * Gate 2, each checked line is written at once, `pass` or `hold`. Approved, each line's position is read again as the
 * approval lands, under {@link GATE_POSITION_MS}; that read counts only when it answered before the seat's result
 * came - one still running then is dropped, so a read that settled after the seat's result is never used - and
 * otherwise the position the check read stands in, when it read one at most {@link GATE_POSITION_FRESH_MS} before the
 * approval arrived. The line is written once the seat's result says it was
 * placed, as the one action that position settles - or nothing, with why, when there is no position or it settles
 * none, or when the order is neither a market nor a limit order (a conditional order's approval is no sale yet).
 *
 * A line the seat answers with the Account's card (Guard mode) says `watching` while one poller watches every such
 * card: each {@link GATE_WATCH_EVERY_MS} it reads the Account's pending cards through the account read's cache, and only
 * when a watched card has left them - or they could not be read - the Account's overview, once for every card that
 * left, for its status and outcome. A card still pending costs no overview read. Each line is watched until its card
 * is answered, or {@link GATE_WATCH_GRACE_MS} past its expiry; approved there with its release refused, nothing is
 * written. A line not registered says why on the card and in one log line. Each call is registered once; nothing is kept across a
 * restart, and after `dispose` nothing more is read or written.
 * @module
 */
import type { RecallAnswer } from "gravit-memory";
import type { AccountReader } from "./account-proxy.ts";
import { heldFacts, type Facts } from "./memory-facts.ts";
import {
  approvedAction, conditionalOrder, consideringOf, declinedAction, gateOrdersOf, marketOfKind, memorySymbol, orderWords, VENUE_ID,
  type Action, type OrderLine, type Position,
} from "./memory-order.ts";
import { AGENT_MEMORY_NAME, FACE_MEMORY_NAME, memoryFaultWords, type MemoryStanding } from "./memory.ts";
import type { UpstreamAnswer, UpstreamRouteRead } from "./upstream-proxy.ts";

/** The whole check's bound, the Account reads' and the price facts'; and how many calls are kept. */
export const GATE_CHECK_MS = 3_000, GATE_ACCOUNT_MS = 1_000, GATE_FACTS_MS = 1_500, GATE_KEPT = 200;

/** Each of the price facts' two reads, the quote and the bars, as the gate asks them: inside GATE_FACTS_MS, so a late
 * bars read still leaves the quote's facts. */
export const GATE_FACT_READ_MS = 1_200;

/** The position read again for an approval's action; how often the Account's card is polled and how long past its
 * expiry it is watched; how recent Gravit's own decision on the symbol is to be the approval's evidence. */
export const GATE_POSITION_MS = 5_000, GATE_WATCH_EVERY_MS = 5_000, GATE_WATCH_GRACE_MS = 60_000, GATE_OWN_CALL_MS = 600_000;

/** How recent the position the check read must be, at the approval's arrival, to stand in for the approval's own read. */
export const GATE_POSITION_FRESH_MS = 60_000;

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
  /** Set while the line's Account card is watched (Guard mode), until its ending settles. */
  watching?: true;
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
  /** The ids of the Account's cards still pending, from its account read (cached); undefined when it was not read. */
  pendingCards(): Promise<Set<string> | undefined>;
  /** The Account's cards `ids` as its overview lists them, by id; a card not listed, or not read, is absent. */
  approvals(ids: readonly string[]): Promise<Map<string, CardStatus>>;
}

/** An Account card's status: `refused` is a card it approved whose release did not pass. */
export type CardStatus = "pending" | "approved" | "refused" | "rejected";

export interface MemoryGateDeps {
  open: () => Promise<MemoryStanding>;
  /** The price facts, each of their reads bounded by `opts.readMs`. */
  facts: (symbol: string, market: "US", opts: { readMs: number }) => Promise<Facts>;
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
  /** The guard's read for the calling execution's session: words when the call is red-lined with no override on
   * record, held by another session's card, or still being checked again; else undefined. Synchronous; never throws. */
  redLineReason(callId: string | undefined, sessionId: string | undefined): string | undefined;
  /** Gate 2's answer for a kept call, from the session it was checked for: `rejected` is written at once,
   * `allowed-once` waits for {@link MemoryGate.settled}; every answer marks the card answered. Never throws. */
  answered(callId: string, outcome: string, sessionId: string | undefined): void;
  /** The seat call's final result for a kept call answered `allowed-once`, from the session it was checked for.
   * Never throws. */
  settled(callId: string, result: { isError: boolean; text: string }, sessionId: string | undefined): void;
  /** Resolves when no registration is in flight (tests). */
  idle(): Promise<void>;
  dispose(): void;
}

/** What a seat answer says of one line. */
export type SeatOutcome =
  | { kind: "placed" } | { kind: "pending"; card: string; expiresAt?: number } | { kind: "refused" } | { kind: "unreadable" };

/** A line's fault when its recall loses the race. */
const LATE = "the memory did not answer in time";

/** How much of a lesson's words the guard's refusal quotes. */
const REFUSAL_WORDS_MAX = 200;

/** The guard's refusal of a red-lined call with no override on record; the lesson's words cut to 200 characters. */
export function redLineRefusal(words: string): string {
  const cut = [...String(words)].slice(0, REFUSAL_WORDS_MAX).join("");
  return `a red line applies to this order - "${cut}" - and no override is on record: the owner opens the card and overrides it in their own words`;
}

/** The guard's refusal of a call whose id is kept for another session's card. */
export const HELD_BY_ANOTHER = "this call id is held by another order card: the order is not run - place it again";

/** The guard's refusal of a call whose id is being checked again. */
export const CHECK_NOT_FINISHED = "the memory's check of this call is not finished: the order is not run - place it again";

/** The registered theses' leads, each followed by `: <order words>.`, and an approval's price source. */
const APPROVED = "Approved Gravit's order card", DECLINED = "Declined Gravit's order card";
const ACCOUNT_DECLINED = "Declined the Account's card for Gravit's order";
const PRICE_SOURCE = "the order card's limit price";

/** Why nothing was registered for a line, as `not registered: <why>` on the card and in the log. */
const POSITION_UNREAD = "the position could not be read - tell Gravit what you decided";
const SELLS_UNSAID = "the order does not say how much of the position it sells - tell Gravit what you decided";
const CONDITIONAL = "a conditional order - tell Gravit when it fills";
const SEAT_REFUSED = "the seat refused the order";
const SEAT_UNREADABLE = "the seat's answer could not be read";
const CARD_EXPIRED = "the Account's card expired";
const CARD_REFUSED = "the Account approved the card but the order did not pass";
const CARD_CLOSED = "the Account's card was declined or expired";
const CARD_UNREAD = "the Account's card could not be read";

/** A card id the seat's answer may give; a decision id the memory's decisions may hold. */
const CARD_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const DECISION_ID = /^d-\d{8}-[0-9a-f]{8}$/;
/** How many of the symbol's newest decisions are looked through for Gravit's own; the memory's longest note. */
const OWN_CALL_LOOK = 20, NOTE_MAX = 500;

/** One line of a kept call: the order as read, the venue the check resolved, the position it was read against and
 * when that read answered, and what the card draws. */
interface LineEntry { order: OrderLine; venue?: string; position: Position | null | undefined; positionAt?: number; view: GateLine }

/** One kept call: the call (its session among it), its state, and its lines. `pending` while the check runs.
 * `override` is the owner's, kept only for a red-lined card; `answered` is set once the card is answered, after which
 * no override is taken. `checking` marks a placeholder standing for a kept callId checked again. `approval` holds,
 * once Gate 2 approved the card, each line's read of the position begun then; `positions` is each line's position as
 * the seat's result found it, fixed when that result is taken (`settled`). */
interface Entry {
  call: GateCall; state: GateView["state"] | "pending"; words?: string; lines: LineEntry[];
  override?: GateOverride; answered?: boolean; checking?: boolean;
  approval?: Reread[]; positions?: Array<Position | null | undefined>; settled?: boolean;
}

/** A line's position read again as Gate 2's approval lands: `read` once a readable answer came, while it still counts;
 * `closed` once the seat's result was taken, after which an answer is ignored; `end` ends the read's race; `fallback`
 * the position the check read, when it answered at most GATE_POSITION_FRESH_MS before the approval, else none. */
interface Reread { read: boolean; value?: Position | null; closed: boolean; end?: () => void; fallback: Position | null | undefined }

/** A line waiting on the Account's card: the card, its expiry when the seat gave one, and when the watch gives up. */
interface Watched { entry: Entry; i: number; card: string; expiresAt?: number; deadline: number }

/** A plain object, not an array and not null. */
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One answer of the seat's, as one line's outcome. */
function outcomeOf(body: unknown): SeatOutcome {
  if (!isRecord(body)) return { kind: "unreadable" };
  if (body.ok === false) return { kind: "refused" };
  if (body.ok !== true) return { kind: "unreadable" };
  if (body.pending === true) {
    const card = body.card;
    if (!isRecord(card) || typeof card.id !== "string" || !CARD_ID.test(card.id)) return { kind: "unreadable" };
    const at = typeof card.expiresAt === "string" ? Date.parse(card.expiresAt) : Number.NaN;
    return Number.isFinite(at) ? { kind: "pending", card: card.id, expiresAt: at } : { kind: "pending", card: card.id };
  }
  return isRecord(body.order) ? { kind: "placed" } : { kind: "unreadable" };
}

/** What a seat call's final result says of each of its `lines`: an error result is a refusal of every line; otherwise
 * the text is the seat's JSON - one answer for one line, or a batch's `legs`, one per line in leg order. Anything
 * else is `unreadable` for every line. Pure. */
export function seatOutcomes(result: { isError: boolean; text: string }, lines: number): SeatOutcome[] {
  const count = Number.isInteger(lines) && lines > 0 ? lines : 0;
  const every = (kind: "refused" | "unreadable"): SeatOutcome[] => Array.from({ length: count }, () => ({ kind }));
  if (result?.isError === true) return every("refused");
  let body: unknown;
  try {
    body = JSON.parse(typeof result?.text === "string" ? result.text : "");
  } catch {
    return every("unreadable");
  }
  if (isRecord(body) && Array.isArray(body.legs)) {
    const legs = body.legs;
    if (legs.length !== count || legs.some((leg, i) => !isRecord(leg) || leg.leg !== i + 1)) return every("unreadable");
    return legs.map(outcomeOf);
  }
  return count === 1 ? [outcomeOf(body)] : every("unreadable");
}

/** A number as the order's words show it, with no `+` (an exponent's sign). */
const numberWords = (n: number): string => String(n).replace("+", "");

/** An approval's `size`: the quantity, or the dollars as `$100`; none for a close of the whole position. */
function sizeOf(order: OrderLine): string | undefined {
  if (order.qty !== undefined) return numberWords(order.qty);
  if (order.usd !== undefined && !order.close) return `$${numberWords(order.usd)}`;
  return undefined;
}

/** An entry never evicted: a placeholder whose check runs, or a checked entry that is red-lined, with no override on
 * record and not answered. */
function unevictable(entry: Entry): boolean {
  if (entry.checking === true) return true;
  return entry.state === "checked" && entry.override === undefined && entry.answered !== true && firstRedLine(entry) !== undefined;
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
  /** Every registration in flight; the poller's next tick, by its timer, while one is set. */
  const flights = new Set<Promise<void>>();
  const watches = new Set<unknown>();
  let disposed = false;

  const say = (line: string): void => {
    try {
      deps.log(`memory gate: ${line}`);
    } catch {
      /* a log that throws costs the check nothing */
    }
  };

  /** `read` raced against its own timer of `ms`; no time left asks nothing. Never rejects. `hold` is handed the
   * function that ends the race at once as late, its timer cleared. */
  function within<T>(read: () => Promise<T>, ms: number, hold?: (end: () => void) => void): Promise<Raced<T>> {
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
      hold?.(late);
    });
  }

  /** Keeps `entry` as its callId's only entry, the newest; past GATE_KEPT the oldest evictable entry goes first.
   * `entry` itself, a waiting red line and a placeholder whose check runs are never evicted, so the map may stay over
   * the cap while every other entry is one of them. */
  function keep(entry: Entry): void {
    entries.delete(entry.call.callId);
    entries.set(entry.call.callId, entry);
    while (entries.size > GATE_KEPT) {
      let victim: string | undefined;
      for (const [callId, kept] of entries) {
        if (kept !== entry && !unevictable(kept)) {
          victim = callId;
          break;
        }
      }
      if (victim === undefined) break;
      entries.delete(victim);
    }
  }

  /** One line, checked: its account reads, its facts, its recall. */
  async function checkLine(
    order: OrderLine, memory: { recall: (by: string, input: unknown) => Promise<RecallAnswer> }, paper: Promise<string | undefined>,
    accountLeft: () => number, left: () => number,
  ): Promise<LineEntry> {
    const venue = order.venue === "paper" ? await paper : order.venue;
    let position: Position | null | undefined;
    let positionAt: number | undefined;
    let market: "US" | undefined;
    if (venue !== undefined) {
      const [held, kind] = await Promise.all([
        within(async () => {
          const read = await deps.account.position(venue, order.symbol);
          positionAt = now();
          return read;
        }, accountLeft()),
        within(() => deps.account.kind(venue, order.symbol), accountLeft()),
      ]);
      position = valueOf(held);
      market = marketOfKind(valueOf(kind));
    }
    const symbol = memorySymbol(order, market);
    const price = symbol === undefined ? undefined : valueOf(await within(() => deps.facts(symbol, "US", { readMs: GATE_FACT_READ_MS }), Math.min(GATE_FACTS_MS, left())));
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
    return { order, ...(venue === undefined ? {} : { venue }), position, ...(position === undefined || positionAt === undefined ? {} : { positionAt }), view };
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

  /** Runs `work` as a registration in flight; it never rejects. */
  function track(work: () => Promise<void>): void {
    const flight = (async (): Promise<void> => {
      try {
        await work();
      } catch (error) {
        say(`a registration failed: ${memoryFaultWords(error)}`);
      }
    })();
    flights.add(flight);
    void flight.then(() => { flights.delete(flight); });
  }

  /** The kept entry `callId` names, when it stands checked or told for the session `sessionId` and the gate is live;
   * a placeholder, an entry still pending and another session's entry are none. */
  function ownEntry(callId: unknown, sessionId: unknown): Entry | undefined {
    if (disposed || typeof callId !== "string" || typeof sessionId !== "string") return undefined;
    const entry = entries.get(callId);
    if (entry === undefined || entry.checking === true || entry.state === "pending") return undefined;
    return entry.call.sessionId === sessionId ? entry : undefined;
  }

  /** Nothing is registered for `line`: the card says why, and the log does. */
  function notRegistered(entry: Entry, line: LineEntry, why: string): void {
    line.view.registered = `not registered: ${why}`;
    say(`${entry.call.callId}: ${line.view.order}: not registered: ${why}`);
  }

  /** A record's common fields, from the validated line and the gate's own call alone: the action, the owner's, the
   * thesis around the order's words, the symbol and market the check placed, its recall, the session and the call. */
  function recordOf(entry: Entry, line: LineEntry, action: Action, lead: string): Record<string, unknown> {
    const input: Record<string, unknown> = { action, whose: "owner", thesis: `${lead}: ${line.view.order}.` };
    const symbol = memorySymbol(line.order, line.view.market);
    if (symbol !== undefined) Object.assign(input, { symbol, market: "US" });
    if (typeof line.view.recall === "string") input.recall = line.view.recall;
    input.evidence = [`session ${entry.call.sessionId}`.slice(0, NOTE_MAX), `call ${entry.call.callId}`];
    return input;
  }

  /** Gravit's own decision on `symbol` within GATE_OWN_CALL_MS of now, by id; undefined on anything else. */
  async function ownCall(memory: MemoryStanding & { connected: true }, symbol: string): Promise<string | undefined> {
    const read = await within(() => memory.memory.decisions({ symbol, limit: OWN_CALL_LOOK }), GATE_CHECK_MS);
    const items = read.kind === "ok" ? (read.value as { items?: unknown } | null)?.items : undefined;
    if (!Array.isArray(items)) return undefined;
    for (const item of items) {
      const view = (item as { view?: { line?: unknown; void?: unknown } } | null)?.view;
      const line = view?.line as Record<string, unknown> | undefined;
      if (line === undefined || view?.void === true) continue;
      if (line.by !== AGENT_MEMORY_NAME || line.whose !== "agent" || line.symbol !== symbol) continue;
      const age = now() - (typeof line.t === "string" ? Date.parse(line.t) : Number.NaN);
      if (!(age >= 0 && age <= GATE_OWN_CALL_MS)) continue;
      if (typeof line.id === "string" && DECISION_ID.test(line.id)) return line.id;
    }
    return undefined;
  }

  /** Writes `input` for `line` as FACE_MEMORY_NAME, through the face's own handle; an approval looks for Gravit's
   * own call first. A memory not connected, or a write that fails, leaves the line not registered with why. */
  async function write(entry: Entry, line: LineEntry, input: Record<string, unknown>, approval: boolean): Promise<void> {
    const opened = await within(() => deps.open(), GATE_CHECK_MS);
    if (disposed) return;
    const standing = valueOf(opened);
    if (standing?.connected !== true) {
      notRegistered(entry, line, standing !== undefined ? String(standing.say) : opened.kind === "fault" ? memoryFaultWords(opened.error) : LATE);
      return;
    }
    if (approval && typeof input.symbol === "string") {
      const id = await ownCall(standing, input.symbol);
      if (disposed) return;
      if (id !== undefined) (input.evidence as string[]).push(`decision ${id}`);
    }
    try {
      await standing.memory.record(FACE_MEMORY_NAME, input);
    } catch (error) {
      notRegistered(entry, line, memoryFaultWords(error));
      return;
    }
    line.view.registered = `registered: ${String(input.action)}`;
  }

  /** A decline, Gate 2's or the Account's: `pass` for a buy, `hold` for a sell or a close. */
  function declined(entry: Entry, line: LineEntry, lead: string): Promise<void> {
    return write(entry, line, recordOf(entry, line, declinedAction(line.order), lead), false);
  }

  /** An approval of line `i`, the seat having placed it: nothing for a conditional order (a resting stop is not a
   * sale); else its action from the position fixed when the seat's result was taken, nothing when there is none or it
   * does not settle one; its price, its size, and the owner's override's words. */
  async function approved(entry: Entry, i: number): Promise<void> {
    const line = entry.lines[i];
    const position = entry.positions?.[i];
    if (disposed || line === undefined) return;
    if (conditionalOrder(line.order)) {
      notRegistered(entry, line, CONDITIONAL);
      return;
    }
    const action = approvedAction(line.order, position);
    if (action === undefined) {
      notRegistered(entry, line, position === undefined ? POSITION_UNREAD : SELLS_UNSAID);
      return;
    }
    const input = recordOf(entry, line, action, APPROVED);
    if (line.order.limitPrice !== undefined) Object.assign(input, { price: line.order.limitPrice, price_source: PRICE_SOURCE });
    const size = sizeOf(line.order);
    if (size !== undefined) input.size = size;
    if (entry.override !== undefined) {
      input.words = entry.override.reason;
      if (entry.override.wrongIf !== undefined) input.wrong_if = entry.override.wrongIf;
    }
    await write(entry, line, input, true);
  }

  /** Every line waiting on the Account's card; the poller's next tick, while one is set; whether a tick's reads run. */
  const watched = new Set<Watched>();
  let tick: unknown;
  let polling = false;

  /** Watches the Account's card `card` for line `i`, through the one poller, until the card is answered or until
   * GATE_WATCH_GRACE_MS past its expiry - past the seat's result, when it gave none. The line says `watching` until
   * its ending settles. Approved there, the approval; approved with its release refused, nothing; rejected before its
   * expiry, the Account's decline; rejected at or after it, an expiry - the Account closes an expired card as
   * rejected; rejected with no expiry given, declined or expired, which cannot be told apart. */
  function watch(entry: Entry, i: number, card: string, expiresAt: number | undefined): void {
    const line = entry.lines[i];
    if (line === undefined || disposed) return;
    line.view.watching = true;
    const deadline = (expiresAt ?? now()) + GATE_WATCH_GRACE_MS;
    watched.add({ entry, i, card, ...(expiresAt === undefined ? {} : { expiresAt }), deadline });
    schedule();
  }

  /** Sets the poller's next tick, GATE_WATCH_EVERY_MS from now, while a line is watched and no tick is set or running. */
  function schedule(): void {
    if (disposed || tick !== undefined || polling || watched.size === 0) return;
    const fire = (): void => {
      watches.delete(tick);
      tick = undefined;
      polling = true;
      track(async () => {
        try {
          await poll();
        } finally {
          polling = false;
          schedule();
        }
      });
    };
    try {
      tick = setTimer(fire, GATE_WATCH_EVERY_MS);
      watches.add(tick);
    } catch {
      tick = undefined;
      for (const w of [...watched]) ended(w, (line) => notRegistered(w.entry, line, CARD_UNREAD));
    }
  }

  /** One tick: the Account's pending cards, from its cached account read; then, only when a watched card is no longer
   * among them - or the list could not be read - one read of the overview, shared by every card that left. */
  async function poll(): Promise<void> {
    const pending = valueOf(await within(() => deps.account.pendingCards(), GATE_WATCH_EVERY_MS));
    if (disposed) return;
    const stillPending = (card: string): boolean => pending instanceof Set && pending.has(card);
    const left = [...new Set([...watched].map((w) => w.card).filter((card) => !stillPending(card)))];
    const statuses = left.length === 0 ? undefined : valueOf(await within(() => deps.account.approvals(left), GATE_WATCH_EVERY_MS));
    if (disposed) return;
    for (const w of [...watched]) {
      settleWatch(w, stillPending(w.card) ? "pending" : statuses instanceof Map ? statuses.get(w.card) : undefined);
    }
  }

  /** `w`'s card read as `status`: an ending, or none yet. */
  function settleWatch(w: Watched, status: CardStatus | undefined): void {
    const { entry, i, expiresAt } = w;
    if (status === "approved") return ended(w, () => approved(entry, i));
    if (status === "refused") return ended(w, (line) => notRegistered(entry, line, CARD_REFUSED));
    if (status === "rejected") {
      if (expiresAt === undefined) return ended(w, (line) => notRegistered(entry, line, CARD_CLOSED));
      if (now() < expiresAt) return ended(w, (line) => declined(entry, line, ACCOUNT_DECLINED));
      return ended(w, (line) => notRegistered(entry, line, CARD_EXPIRED));
    }
    if (now() >= w.deadline) ended(w, (line) => notRegistered(entry, line, status === "pending" ? CARD_EXPIRED : CARD_UNREAD));
  }

  /** `w` is watched no more: `then` runs for its line as a registration, and the line says `watching` until it settles. */
  function ended(w: Watched, then: (line: LineEntry) => Promise<void> | void): void {
    watched.delete(w);
    const line = w.entry.lines[w.i];
    if (line === undefined) return;
    track(async () => {
      try {
        await then(line);
      } finally {
        delete line.view.watching;
      }
    });
  }

  return {
    async check(call) {
      try {
        if (disposed || typeof call?.callId !== "string" || !CALL_ID.test(call.callId)) return undefined;
        /* A kept callId is checked again: each check is one execution about to raise its own card. The old entry -
         * its lines, its red line, its override, its answered mark - is replaced at once by a placeholder that holds
         * the new call's session and is being checked: no view, no override, and the guard refuses it for any caller
         * (CHECKING). When the new check settles, its entry takes the placeholder's place, unless a later check took
         * the callId meanwhile. A callId never kept before gets no placeholder: its own entry stands pending, seen as
         * unknown until it settles - its guard cannot run before its check has, and an order never waits on the
         * memory. */
        const entry: Entry = { call, state: "pending", lines: [] };
        const holder: Entry = entries.has(call.callId) ? { call, state: "pending", lines: [], checking: true } : entry;
        keep(holder);
        try {
          return await run(call, entry);
        } catch (error) {
          Object.assign(entry, { state: "not checked", words: memoryFaultWords(error), lines: [] });
          say(`${call.callId}: ${memoryFaultWords(error)}`);
          return undefined;
        } finally {
          if (holder !== entry && entries.get(call.callId) === holder) keep(entry);
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
    redLineReason(callId, sessionId) {
      try {
        if (typeof callId !== "string") return undefined;
        const entry = entries.get(callId);
        if (entry === undefined) return undefined;
        /* CHECKING: a callId checked again refuses every caller until its new entry stands; a kept entry refuses a
         * caller of another session (an undefined one among them), since grants are per session and ids are not */
        if (entry.checking === true) return CHECK_NOT_FINISHED;
        if (entry.call.sessionId !== sessionId) return HELD_BY_ANOTHER;
        if (entry.state !== "checked" || entry.override !== undefined) return undefined;
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
    answered(callId, outcome, sessionId) {
      try {
        const entry = ownEntry(callId, sessionId);
        if (entry === undefined || entry.answered === true) return;
        entry.answered = true;
        if (entry.state !== "checked") return;
        if (outcome === "rejected") {
          for (const line of entry.lines) track(() => declined(entry, line, DECLINED));
        } else if (outcome === "allowed-once") {
          /* read as the approval lands, ahead of the seat's run: the action is the order's against the position it
           * meets, never against one its own fill left (a buy from flat read after its fill would be an add). The
           * read counts only if it answers before the seat's result is taken (`settled` closes it). The check's
           * position stands in for it only when that read answered at most GATE_POSITION_FRESH_MS before now. */
          const at = now();
          entry.approval = entry.lines.map((line) => {
            const fresh = line.positionAt !== undefined && at - line.positionAt <= GATE_POSITION_FRESH_MS;
            const reread: Reread = { read: false, closed: false, fallback: fresh ? line.position : undefined };
            const { venue } = line;
            if (venue !== undefined) {
              void within(() => deps.account.position(venue, line.order.symbol), GATE_POSITION_MS, (end) => { reread.end = end; })
                .then((answer) => {
                  if (reread.closed || answer.kind !== "ok" || answer.value === undefined) return;
                  reread.read = true;
                  reread.value = answer.value;
                });
            }
            return reread;
          });
        }
      } catch (error) {
        say(`${String(callId)}: the answer could not be taken: ${memoryFaultWords(error)}`);
      }
    },
    settled(callId, result, sessionId) {
      try {
        const entry = ownEntry(callId, sessionId);
        if (entry === undefined || entry.approval === undefined || entry.settled === true) return;
        entry.settled = true;
        /* each line's position as of now: the approval's read when it already answered, else the check's when it read
         * one recently enough, else none; a read still running is dropped - left to finish, its answer ignored, its
         * timer cleared */
        entry.positions = entry.lines.map((_line, i) => {
          const reread = entry.approval?.[i];
          if (reread === undefined) return undefined;
          reread.closed = true;
          reread.end?.();
          return reread.read ? reread.value : reread.fallback;
        });
        const outcomes = seatOutcomes(result, entry.lines.length);
        entry.lines.forEach((line, i) => {
          const outcome = outcomes[i] ?? { kind: "unreadable" };
          if (outcome.kind === "placed") track(() => approved(entry, i));
          else if (outcome.kind === "pending") watch(entry, i, outcome.card, outcome.expiresAt);
          else notRegistered(entry, line, outcome.kind === "refused" ? SEAT_REFUSED : SEAT_UNREADABLE);
        });
      } catch (error) {
        say(`${String(callId)}: the seat's result could not be taken: ${memoryFaultWords(error)}`);
      }
    },
    async idle() {
      while (flights.size > 0) await Promise.all([...flights]);
    },
    dispose() {
      disposed = true;
      entries.clear();
      for (const timer of [...watches]) {
        try {
          clearTimer(timer);
        } catch {
          /* a watch whose timer cannot be cleared polls into a disposed gate, which writes nothing */
        }
      }
      watches.clear();
      watched.clear();
      tick = undefined;
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

/** `GateAccount` over the Account proxy's reads: `position` asks fresh every time, past the positions route's TTL, so a
 * fill a moment ago is never read as the position before it; the listing's kind may ride the cache. `pendingCards` is
 * the `cards` the account read lists - the Account lists its pending cards alone there - through the reader's cache.
 * `approvals` reads the overview's `approvals` once for every id asked: an approved card whose `outcome` - what its
 * release produced - is a refusal (`ok: false`) is `refused`. Shape only: nothing of the outcome is copied. */
export function gateAccount(reads: {
  reader: AccountReader; positions: UpstreamRouteRead; market: UpstreamRouteRead; overview: () => Promise<UpstreamAnswer>;
}): GateAccount {
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
      const body = okBody(await read(() => reads.positions(new URLSearchParams({ venue }).toString(), true)));
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
    async pendingCards() {
      const cards = okBody(await read(() => reads.reader.read()))?.cards;
      if (!Array.isArray(cards)) return undefined;
      const ids = new Set<string>();
      for (const card of cards) {
        const id = (card as { id?: unknown } | null)?.id;
        if (typeof id === "string") ids.add(id);
      }
      return ids;
    },
    async approvals(ids) {
      const out = new Map<string, CardStatus>();
      const approvals = okBody(await read(() => reads.overview()))?.approvals;
      if (!Array.isArray(approvals)) return out;
      const wanted = new Set(ids);
      for (const item of approvals) {
        const card = item as { id?: unknown; status?: unknown; outcome?: unknown } | null;
        const id = card?.id;
        if (typeof id !== "string" || !wanted.has(id) || out.has(id)) continue;
        const status = card?.status;
        if (status === "approved" && isRecord(card?.outcome) && card.outcome.ok === false) out.set(id, "refused");
        else if (status === "pending" || status === "approved" || status === "rejected") out.set(id, status);
      }
      return out;
    },
  };
}

/** A context's `on`, as the root bus offers it: `session/event` and dsh's `tools/result`. */
interface AnswersCtx { on(name: string, listener: (...args: never[]) => unknown): () => unknown }

/** How many asked approvals are held for their answer; the oldest leaves first. */
const ASKED_KEPT = GATE_KEPT;

/**
 * Subscribes `gate` to a root context's events; returns the disposer. The owner's answer comes from the session's own
 * events alone: an `approval/asked` naming a kept callId pairs its approval id, in that session, with the callId, and
 * that approval's `approval/decided` gives `answered` its outcome and the session. The seat's result comes from dsh's
 * `tools/result` - emitted scoped to the calling agent, and seen by a root listener for every agent - for a kept callId:
 * `settled` takes its error flag, its first text block and the agent's id. A listener's fault is contained.
 */
export function followAnswers(ctx: AnswersCtx, gate: Pick<MemoryGate, "answered" | "settled" | "view">): () => void {
  /** `<session id>\0<approval id>` to the callId it was asked for. */
  const asked = new Map<string, string>();
  const kept = (callId: unknown): callId is string => typeof callId === "string" && CALL_ID.test(callId) && gate.view(callId) !== undefined;
  const onEvent = (session: unknown, event: unknown): void => {
    try {
      const sessionId = (session as { id?: unknown } | null)?.id;
      const { type, data } = (event ?? {}) as { type?: unknown; data?: Record<string, unknown> | null };
      const id = data?.id;
      if (typeof sessionId !== "string" || typeof id !== "string") return;
      const key = `${sessionId}\0${id}`;
      if (type === "approval/asked") {
        const callId = data?.callId;
        if (!kept(callId)) return;
        asked.delete(key);
        asked.set(key, callId);
        if (asked.size > ASKED_KEPT) asked.delete(asked.keys().next().value as string);
      } else if (type === "approval/decided") {
        const callId = asked.get(key);
        if (callId === undefined) return;
        asked.delete(key);
        if (typeof data?.outcome === "string") gate.answered(callId, data.outcome, sessionId);
      }
    } catch {
      /* the gate's own methods say their faults; a malformed event costs the session nothing */
    }
  };
  const onResult = (exec: unknown, result: unknown): void => {
    try {
      const { callId, agent } = (exec ?? {}) as { callId?: unknown; agent?: { id?: unknown } | null };
      if (!kept(callId)) return;
      const { isError, content } = (result ?? {}) as { isError?: unknown; content?: unknown };
      const block = Array.isArray(content)
        ? (content as Array<{ type?: unknown; text?: unknown } | null>).find((b) => b?.type === "text" && typeof b.text === "string")
        : undefined;
      const sessionId = typeof agent?.id === "string" ? agent.id : undefined;
      gate.settled(callId, { isError: isError === true, text: typeof block?.text === "string" ? block.text : "" }, sessionId);
    } catch {
      /* as above */
    }
  };
  const offEvents = ctx.on("session/event", onEvent as (...args: never[]) => unknown);
  const offResults = ctx.on("tools/result", onResult as (...args: never[]) => unknown);
  return () => {
    offEvents();
    offResults();
  };
}
