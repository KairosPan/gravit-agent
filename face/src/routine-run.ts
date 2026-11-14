/**
 * One run of a routine: a named instruction the operator confirmed, run by an unattended desk agent that reads and
 * reports. The clock row (src/routine-clock.ts) decides when, appends the run's `started` to `routines.jsonl` under its
 * key, and hands the run over; this module runs it:
 *
 * 1. the instruction-chain fence on the desk's journal (src/desk-session.ts `findChainViolation`): a violation is
 *    `finished` with outcome `error` and the fence's line, and no session is made;
 * 2. a fresh desk agent in `desk/journal` (made when missing) on the desk's route, the route and the create together
 *    bounded by the turn's deadline;
 * 3. the wake ({@link routineWake}), supervised under the deadline with the fence at the turn's start, its source
 *    `{ kind: "routine", routine, slot, date }`; a watchdog {@link RUN_SLACK_MS} past the deadline cancels the turn
 *    (`desk deadline`) and the run ends without its record;
 * 4. at the turn's end its `desk-turn` event in `events.jsonl`, so its tokens count against the day's caps, then
 *    `finished`: `ended` for an answer, `no-answer` for an empty one, the supervisor's outcome otherwise - a turn the
 *    fence refused is `error` with the fence's line; its `headline` is {@link splitAnswer}'s, cut to
 *    {@link HEADLINE_MAX};
 * 5. an answer longer than its headline is a report: a `report` record, its body cut to {@link REPORT_BODY_MAX}, and a
 *    line noted into Gravit's one conversation (`deps.note`, src/conversation.ts `noteMessage`, fenced as data there).
 *    A one-line answer posts nothing. Nothing ever goes to the phone;
 * 6. the session's dispose, awaited at most {@link RUN_DISPOSE_MS}, and only then the supervision's end.
 *
 * An abort cancels the turn under way as `shutdown`, writes nothing more and lets the session go: a `started` with no
 * end reads as interrupted at the next boot. Every turn the supervisor reports after the run stopped waiting for its
 * own is still counted in `events.jsonl`. {@link runRoutine} never rejects.
 *
 * MODULE WEIGHT. It brings src/desk-session.ts - the desk preset, the role library, js-yaml, dsh-agent - and dsh-llm:
 * src/desk.ts loads it lazily, inside `installDesk`, and src/desk.ts, src/desk-tools.ts, src/routines.ts and
 * src/conversation.ts never import it.
 * @module
 */
import { relative, resolve, sep } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { appendEvent, appendRecord, type TurnUsage } from "./desk.ts";
import type { DeskLine } from "./conversation.ts";
import {
  deskJournalDir, deskTurnEvent, fenceRefusalLine, findChainViolation, formatDuration, provenanceLine, superviseDeskTurns,
  type DeskClock, type DeskTurnRecord, type SessionEventsOn,
} from "./desk-session.ts";
import { etClock } from "./et.ts";
import type { AgentLike } from "./room.ts";
import type { MessageLike } from "./room-rules.ts";
import { ROUTINES_LEDGER, type Routine } from "./routines.ts";
import { DEFAULT_TURN_DEADLINE_MS } from "./standing.ts";

/** Diagnostic label, the one every `${BIN}:`-prefixed line in the face uses; desk lines add `desk:`. */
const BIN = "gravit-face";
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
/** Where a run's lines go unless its deps pass `log`: stderr, as the desk's others do. */
const defaultLog = (line: string): void => { console.error(line); };

/* ---------- the records ---------- */

/** How a run ended: its turn `ended` with an answer, or with none (`no-answer`); its deadline cut it (`timed-out`);
 * its model call failed (`failed`); something cancelled it (`cancelled`); or it could not run (`error`: the fence, a
 * session that could not be made or woken, a turn that never started). */
export type RunOutcome = "ended" | "timed-out" | "failed" | "cancelled" | "no-answer" | "error";

/** One run as the clock row hands it over: its key, the routine as last loaded, the New York date and slot (`HH:MM`)
 * it runs for, the slot's instant in ms since the epoch, and `test` for a run the operator asked for by hand. */
export interface RunItem {
  key: string;
  routine: Routine;
  date: string;
  slot: string;
  at: number;
  test?: true;
}

/** A line of `routines.jsonl` about a run, beside the acts' lines (src/routines.ts). `t` and every time are ISO-8601
 * UTC. A `started` consumes a slot's key (the clock row's); a `finished` ends it - its outcome, its headline, whether
 * it reported, its session, its wall time from the run's start and its tokens; a `report`, an answer longer than its
 * headline; a `missed`, a slot whose grace passed unstarted, and why; a `skipped`, a run the pause or the cap refused;
 * an `interrupted`, a `started` a boot found with no end. */
export type RoutineRunRecord =
  | { t: string; kind: "started"; key: string; routine: string; name: string; sha256: string; date: string; slot: string; at: string; test?: true }
  | {
    t: string; kind: "finished"; key: string; routine: string; outcome: RunOutcome; headline: string; reported: boolean; sessionId?: string;
    wallMs: number; usage?: TurnUsage; error?: string; test?: true;
  }
  | { t: string; kind: "report"; key: string; routine: string; name: string; headline: string; body: string }
  | {
    t: string; kind: "missed"; key: string; routine: string; date: string; slot: string; why: "asleep" | "down" | "late" | "busy";
    asleep?: { from: string; to: string }; foundAt: string;
  }
  | { t: string; kind: "skipped"; routine: string; why: "paused" | "cap" }
  | { t: string; kind: "interrupted"; key: string; routine: string; startedAt: string };

const OUTCOMES: ReadonlySet<string> = new Set<RunOutcome>(["ended", "timed-out", "failed", "cancelled", "no-answer", "error"]);
const MISSED_WHY: ReadonlySet<string> = new Set(["asleep", "down", "late", "busy"]);
const SKIPPED_WHY: ReadonlySet<string> = new Set(["paused", "cap"]);

/** Whether `x` is a {@link RoutineRunRecord}: its kind and the fields each kind's readers rely on, as strings, numbers
 * or booleans - an act's line of src/routines.ts is not one. */
export function isRunRecord(x: unknown): x is RoutineRunRecord {
  if (x === null || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  const str = (...names: string[]): boolean => names.every((n) => typeof r[n] === "string");
  if (!str("t", "kind", "routine")) return false;
  switch (r.kind) {
    case "started":
      return str("key", "name", "sha256", "date", "slot", "at");
    case "finished":
      return str("key", "headline") && OUTCOMES.has(r.outcome as string) && typeof r.reported === "boolean" && typeof r.wallMs === "number";
    case "report":
      return str("key", "name", "headline", "body");
    case "missed":
      return str("key", "date", "slot", "foundAt") && MISSED_WHY.has(r.why as string);
    case "skipped":
      return SKIPPED_WHY.has(r.why as string);
    case "interrupted":
      return str("key", "startedAt");
    default:
      return false;
  }
}

/* ---------- the wake and the answer ---------- */

/** The longest headline, in characters: past it, cut with an ellipsis. */
export const HEADLINE_MAX = 80;
/** The longest report body a `report` record keeps, in characters: past it, cut with an ellipsis. */
export const REPORT_BODY_MAX = 8_000;
/** The longest a run waits past its turn's deadline for the supervisor to report the turn's end: then the watchdog
 * cancels it and the run ends without it. */
export const RUN_SLACK_MS = 60_000;
/** The longest a run waits for its session's dispose before it ends without it, the dispose going on alone. */
export const RUN_DISPOSE_MS = 10_000;

/** The face's rules for a routine's answer, after the instruction in every wake. */
export const ROUTINE_RULES = "Read and report; do nothing else. Your first line is a headline of at most 80 characters with its number "
  + "(\"1 idea: long AMD\", \"No ideas\"). With nothing to report, that line is your whole answer. Otherwise leave a blank line "
  + "and write the report: every figure with its source and time. A source you cannot read: say so, and let no older figure "
  + "stand in. Your answer goes to the operator's Desk page, not their phone.";

/**
 * The message that wakes a routine's turn: its provenance line, `[routine · <name> · <date> <HH:MM> ET]` at the slot's
 * instant; the time the face cancels the turn, `deadlineMs` after `firedAt`, to the second in New York; a blank line;
 * the instruction as confirmed; a blank line; {@link ROUTINE_RULES}; and, given a non-empty `state`, a blank line, the
 * state's provenance line at `firedAt` and the state. Lines are joined with `\n`.
 * @param item - the run.
 * @param firedAt - when it is woken, in ms since the epoch.
 * @param deadlineMs - the turn's deadline.
 * @param state - the desk's state as the face sees it (src/desk-tools.ts), when there is one.
 */
export function routineWake(item: RunItem, firedAt: number, deadlineMs: number, state?: string): string {
  const lines = [
    provenanceLine({ kind: "routine", name: item.routine.name, slot: item.slot }, new Date(item.at)),
    `The face cancels this turn at ${etClock(new Date(firedAt + deadlineMs))} ET.`,
    "",
    item.routine.instruction,
    "",
    ROUTINE_RULES,
  ];
  if (state !== undefined && state !== "") lines.push("", provenanceLine({ kind: "state" }, new Date(firedAt)), state);
  return lines.join("\n");
}

/**
 * An answer split as {@link ROUTINE_RULES} asks for it: its first line with words, trimmed, is the headline; what
 * follows, its leading blank lines and its trailing white space dropped, is the body - `""` for a one-line answer. Line
 * ends are read as `\n` whatever they were.
 * @param text - the turn's final text.
 */
export function splitAnswer(text: string): { headline: string; body: string } {
  const lines = text.replace(/\r\n?/g, "\n").replace(/^\s+/, "").split("\n");
  const headline = (lines[0] ?? "").trim();
  const body = lines.slice(1).join("\n").replace(/^(?:[ \t]*\n)+/, "").trimEnd();
  return { headline, body };
}

/** `text` cut to at most `max` characters (code points), a cut ending in `…`. */
function cut(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/* ---------- a run ---------- */

/** What a run reads of its world: `home` the harness home (the ledgers'); `root` the repository root; `clock` every
 * stamp and timer; `deadlineMs` the turn's deadline, {@link DEFAULT_TURN_DEADLINE_MS} by default; `createAgent` a fresh
 * desk agent (src/desk-session.ts `createDeskAgent`); `resolveRoute` the desk's route (`undefined`: its own); `on` the
 * root bus; `supervise` src/desk-session.ts `superviseDeskTurns`, the default; `state` the desk's state for the wake
 * (none when absent or when it fails, with one line); `note` a report's line into Gravit's one conversation (src/desk.ts
 * binds it); `log` where a line goes (stderr). */
export interface RunDeps {
  home: string;
  root: string;
  clock: DeskClock;
  deadlineMs?: number;
  createAgent(opts: { cwd: string; route: { provider: string; model: string }; make?: boolean }): Promise<{ agent: AgentLike; sessionId: string; dispose(): Promise<void> }>;
  resolveRoute(raw: string | undefined): Promise<{ provider: string; model: string }>;
  on: SessionEventsOn;
  supervise?: typeof superviseDeskTurns;
  state?: () => Promise<string | undefined>;
  note?: (line: DeskLine) => void;
  log?: (line: string) => void;
}

/** What a wait an abort cut short resolves to. */
const ABORTED: unique symbol = Symbol("aborted");
/** What a wait the open's bound cut short resolves to. */
const LATE: unique symbol = Symbol("late");

/** `p`'s value, or {@link ABORTED} once `signal` aborts, or {@link LATE} once `clock` reaches `by`; `p` is then left
 * to settle alone, its rejection handled. A rejection that comes first is `p`'s own. */
function bounded<T>(p: Promise<T>, signal: AbortSignal, clock: DeskClock, by: number): Promise<T | typeof ABORTED | typeof LATE> {
  return new Promise((done, reject) => {
    if (signal.aborted) {
      p.catch(() => {});
      done(ABORTED);
      return;
    }
    const stop = (): void => {
      clock.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      stop();
      p.catch(() => {});
      done(ABORTED);
    };
    const timer = clock.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      p.catch(() => {});
      done(LATE);
    }, Math.max(0, by - clock.now()));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then((value) => { stop(); done(value); }, (err: unknown) => { stop(); reject(err); });
  });
}

/** `p`'s value, or {@link ABORTED} as soon as `signal` aborts - at once when it already has. `p` never rejects here. */
function unlessAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  return new Promise((done) => {
    if (signal.aborted) {
      done(ABORTED);
      return;
    }
    const onAbort = (): void => { done(ABORTED); };
    signal.addEventListener("abort", onAbort, { once: true });
    void p.then((value) => {
      signal.removeEventListener("abort", onAbort);
      done(value);
    });
  });
}

/** Whether `p` settles within `ms` on `clock`: `false` when the bound comes first, `p` then left to settle alone. */
function settlesWithin(clock: DeskClock, ms: number, p: Promise<unknown>): Promise<boolean> {
  return new Promise((done) => {
    const timer = clock.setTimeout(() => { done(false); }, ms);
    const settled = (): void => {
      clock.clearTimeout(timer);
      done(true);
    };
    p.then(settled, settled);
  });
}

/** How the wait for a run's turn ended: the supervisor's record, the watchdog, or a wake that never went. */
type TurnEnd = { kind: "turn"; record: DeskTurnRecord } | { kind: "watchdog"; started: boolean } | { kind: "error"; error: string };

/** A `finished` record's fields after its outcome, each only when it has a value. */
type Ending = { outcome: RunOutcome; headline?: string; reported?: boolean; sessionId?: string; usage?: TurnUsage; error?: string };

/** A supervisor's record as a run's ending: the outcome, and the headline and body of an `ended` answer. */
function endingOf(r: DeskTurnRecord, sessionId: string, cwdRel: string): Ending & { body?: string } {
  const base = { sessionId, ...(r.usage === undefined ? {} : { usage: r.usage }) };
  switch (r.outcome) {
    case "ended": {
      const { headline, body } = splitAnswer(r.finalText);
      if (headline === "") return { ...base, outcome: "no-answer" };
      return { ...base, outcome: "ended", headline: cut(headline, HEADLINE_MAX), body };
    }
    case "refused":
      return { ...base, outcome: "error", error: fenceRefusalLine(r.violation ?? cwdRel) };
    case "cancelled":
      return { ...base, outcome: "cancelled", ...(r.cancel === undefined ? {} : { error: r.cancel }) };
    case "failed":
      return { ...base, outcome: "failed", ...(r.error === undefined ? {} : { error: r.error }) };
    default:
      return { ...base, outcome: "timed-out" };
  }
}

/**
 * Run one routine, once the clock row has appended its `started` (see the module header). Never rejects: an
 * unexpected failure is one line, and the run is left unfinished.
 * @param deps - see {@link RunDeps}.
 * @param item - the run.
 * @param signal - the clock row's abort.
 */
export async function runRoutine(deps: RunDeps, item: RunItem, signal: AbortSignal): Promise<void> {
  const log = deps.log ?? defaultLog;
  try {
    await run(deps, item, signal, log);
  } catch (err) {
    log(`${BIN}: desk: routine run ${item.key} failed: ${errText(err)}; it is left unfinished`);
  }
}

async function run(deps: RunDeps, item: RunItem, signal: AbortSignal, log: (line: string) => void): Promise<void> {
  if (signal.aborted) return;
  const { clock, home } = deps;
  const { key, routine } = item;
  const begun = clock.now();
  const stamp = (): string => new Date(clock.now()).toISOString();
  const cwd = deskJournalDir(deps.root);
  const cwdRel = relative(resolve(deps.root), resolve(cwd)).split(sep).join("/");
  const deadlineMs = deps.deadlineMs ?? DEFAULT_TURN_DEADLINE_MS;
  const finish = (e: Ending): Promise<void> => appendRecord(home, ROUTINES_LEDGER, {
    t: stamp(), kind: "finished", key, routine: routine.id, outcome: e.outcome, headline: e.headline ?? "", reported: e.reported ?? false,
    ...(e.sessionId === undefined ? {} : { sessionId: e.sessionId }),
    wallMs: clock.now() - begun,
    ...(e.usage === undefined ? {} : { usage: e.usage }),
    ...(e.error === undefined ? {} : { error: e.error }),
    ...(item.test === true ? { test: true as const } : {}),
  } satisfies RoutineRunRecord, { log });
  const couldNotRun = async (reason: string): Promise<void> => {
    log(`${BIN}: desk: routine run ${key} could not run: ${reason}`);
    await finish({ outcome: "error", error: reason });
  };

  /* 1. the fence, before any session */
  let violation: string | undefined;
  try {
    violation = await findChainViolation(deps.root, cwd);
  } catch (err) {
    log(`${BIN}: desk: the fence check before routine run ${key} failed (${errText(err)}); it counts as a violation at ${cwdRel}`);
    violation = cwdRel;
  }
  if (signal.aborted) return;
  if (violation !== undefined) {
    await finish({ outcome: "error", error: fenceRefusalLine(violation) });
    return;
  }

  /* 2. the session: the route and the create together bounded by the turn's deadline */
  const openBy = clock.now() + deadlineMs;
  const notOpened = `the session did not open in ${formatDuration(deadlineMs)}`;
  let route: { provider: string; model: string };
  try {
    const routed = await bounded(Promise.resolve().then(() => deps.resolveRoute(undefined)), signal, clock, openBy);
    if (routed === ABORTED) return;
    if (routed === LATE) return couldNotRun(notOpened);
    route = routed;
  } catch (err) {
    return couldNotRun(errText(err));
  }
  const creating = Promise.resolve().then(() => deps.createAgent({ cwd, route, make: true }));
  /* made after the abort or the bound: nobody else holds it */
  const letGo = (): void => { creating.then((late) => late.dispose(), () => {}).catch(() => {}); };
  let session: Awaited<typeof creating>;
  try {
    const made = await bounded(creating, signal, clock, openBy);
    if (made === ABORTED || made === LATE) {
      letGo();
      if (made === LATE) await couldNotRun(notOpened);
      return;
    }
    session = made;
  } catch (err) {
    return couldNotRun(errText(err));
  }

  /* Every turn the supervisor reports is counted in events.jsonl, in the order reported: the run's own, then any it
   * outlives - one that ends after an abort or after the watchdog - so its tokens reach the caps. */
  let counted: Promise<void> = Promise.resolve();
  const count = (record: DeskTurnRecord): Promise<void> => {
    counted = counted.then(() => appendEvent(home, deskTurnEvent(record, stamp(), cwdRel), { log }));
    return counted;
  };
  let waiting = true;
  let closed = false;
  let endedWith: TurnEnd | undefined;
  let settle: (end: TurnEnd) => void = () => {};
  const ended = new Promise<TurnEnd>((done) => { settle = done; });
  const end = (e: TurnEnd): void => {
    if (!waiting) return;
    waiting = false;
    endedWith = e;
    settle(e);
  };
  const onTurnEnd = (record: DeskTurnRecord): void => {
    if (closed) return;
    if (waiting) end({ kind: "turn", record });
    else void count(record);
  };
  const cancelTurn = (reason: string): void => {
    try {
      session.agent.cancel({ kind: "hook", reason });
    } catch (err) {
      log(`${BIN}: desk: the turn of routine run ${key} could not be cancelled: ${errText(err)}`);
    }
  };

  let unwatch: (() => void) | undefined;
  let offBus: (() => void) | undefined;
  let watchdog: unknown;
  try {
    let state: string | undefined;
    if (deps.state !== undefined) {
      try {
        state = await deps.state();
      } catch (err) {
        log(`${BIN}: desk: the desk's state could not be read for routine run ${key}: ${errText(err)}; it wakes without it`);
      }
      if (signal.aborted) return;
    }

    /* 3. the wake, and its watchdog */
    let started = false;
    let woken = false;
    try {
      offBus = deps.on("session/event", (s, event) => {
        if (s.id === session.sessionId && event.type === "turn/start") started = true;
      });
      unwatch = (deps.supervise ?? superviseDeskTurns)({
        on: deps.on,
        sessionId: session.sessionId,
        agent: session.agent,
        deadlineMs,
        clock,
        log,
        fence: () => findChainViolation(deps.root, cwd),
        fenceLabel: cwdRel,
        onTurnEnd,
      });
      const firedAt = clock.now();
      const text = routineWake(item, firedAt, deadlineMs, state);
      const message = createUserMessage({ content: [{ type: "text", text }], source: { kind: "routine", routine: routine.id, slot: item.slot, date: item.date } });
      session.agent.followup(message as unknown as MessageLike);
      woken = true;
      const slackMs = deadlineMs + RUN_SLACK_MS;
      watchdog = clock.setTimeout(() => {
        watchdog = undefined;
        log(`${BIN}: desk: routine run ${key} saw ${started ? "no end to its turn" : "no turn start"} in ${formatDuration(slackMs)}; the watchdog cancels it`);
        end({ kind: "watchdog", started });
      }, slackMs);
    } catch (err) {
      end({ kind: "error", error: errText(err) });
    }
    const ending = await unlessAborted(ended, signal);
    if (watchdog !== undefined) {
      clock.clearTimeout(watchdog);
      watchdog = undefined;
    }
    if (ending === ABORTED) {
      /* a turn whose end came with the abort is counted, and nothing more is done for it */
      if (endedWith?.kind === "turn") void count(endedWith.record);
      waiting = false;
      if (woken) cancelTurn("shutdown");
      return;
    }

    /* 4. the turn's end */
    let e: Ending & { body?: string };
    if (ending.kind === "watchdog") {
      cancelTurn("desk deadline");
      e = ending.started
        ? { outcome: "timed-out", sessionId: session.sessionId }
        : { outcome: "error", sessionId: session.sessionId, error: "never started a turn" };
    } else if (ending.kind === "error") {
      log(`${BIN}: desk: routine run ${key} could not run: ${ending.error}`);
      e = { outcome: "error", sessionId: session.sessionId, error: ending.error };
    } else {
      await count(ending.record);
      e = endingOf(ending.record, session.sessionId, cwdRel);
    }
    if (signal.aborted) return;
    const body = e.body ?? "";
    const reported = body !== "";
    await finish({ ...e, reported });
    if (!reported || signal.aborted) return;

    /* 5. the report, and its line in the conversation */
    const headline = e.headline ?? "";
    const kept = cut(body, REPORT_BODY_MAX);
    await appendRecord(home, ROUTINES_LEDGER, {
      t: stamp(), kind: "report", key, routine: routine.id, name: routine.name, headline, body: kept,
    } satisfies RoutineRunRecord, { log });
    if (signal.aborted) return;
    try {
      deps.note?.({ kind: "routine", routine: routine.id, name: routine.name, key, date: item.date, text: `${headline}\n\n${kept}` });
    } catch (err) {
      log(`${BIN}: desk: routine run ${key} could not be noted in the conversation: ${errText(err)}`);
    }
  } finally {
    if (watchdog !== undefined) clock.clearTimeout(watchdog);
    waiting = false;
    offBus?.();
    /* 6. the session first, then the supervision - so a turn the dispose drains is still reported, and counted */
    const disposing = (async (): Promise<void> => {
      try {
        await session.dispose();
      } catch (err) {
        log(`${BIN}: desk: the session of routine run ${key}, ${session.sessionId}, could not be disposed: ${errText(err)}`);
      }
    })();
    const endSupervision = (): void => {
      try {
        unwatch?.();
      } catch (err) {
        log(`${BIN}: desk: the supervision of routine run ${key} could not be ended: ${errText(err)}`);
      }
      closed = true;
    };
    if (await settlesWithin(clock, RUN_DISPOSE_MS, disposing)) {
      endSupervision();
      await counted;
    } else {
      log(`${BIN}: desk: routine run ${key} could not dispose its session ${session.sessionId} in ${formatDuration(RUN_DISPOSE_MS)}; it ends, and the dispose goes on alone`);
      void disposing.then(endSupervision);
    }
  }
}
