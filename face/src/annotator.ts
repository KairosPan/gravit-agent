// face/src/annotator.ts
/** The annotation lane: each alert pass's plan check, in a fresh desk agent of its own (spec §16 H1; the hardening
 * plan's Task 4, docs/superpowers/plans/2026-11-02-desk-hardening.md).
 *
 * WHY A LANE OF ITS OWN. An annotation used to be one more turn on the desk conversation's session
 * (src/desk-conversation.ts), where every phone, browser and wake turn is a turn of its own: an annotation could queue
 * five minutes behind the operator's turn, and then check a later price than the alert's. Here it never waits on the
 * operator: it opens at once in its own session, and waits at most behind another annotation.
 *
 * BEFORE THE AGENT ({@link Annotator.post}), the checks a phone post gets, in the conversation's order: the pause - an
 * `OFF` past its `until` is lifted, one in force refuses with the conversation's paused line; the day's token budget -
 * spent, it refuses with src/desk.ts `budgetReplyLine`, and one that cannot be read lets the post go on, with a line;
 * the instruction-chain fence (src/desk-session.ts `findDeskFenceViolation`) - a violation refuses and is a
 * `desk-refused` event. A refusal makes no agent and sends nothing: the watch answers it (src/watch.ts `queuePost`).
 *
 * THE RUN. A fresh desk agent (src/desk-session.ts `createDeskAgent`) in `desk/journal`, on the desk's route - no
 * `desk-session` record, so it never becomes the phone's conversation; its turns supervised with the alert deadline
 * (src/desk.ts `ALERT_DEADLINE_MS`, 240 s from its own `turn/start`) and the fence; the alerts' text sent once, under
 * its provenance line, with the alert's message as its source. The post resolves `opened` there and the run goes on:
 * - the watchdog: no turn's end by the deadline plus src/firing.ts `FIRING_SLACK_MS` from the followup - a turn that
 *   never started, or one that hung past the supervisor's cut - cancels it (`desk deadline`), and the run ends without
 *   it: the timed-out line for a turn that started, the no-text line for one that never did;
 * - the turn's end: one `desk-turn` (a `desk-refused` for a turn the fence cut) in `events.jsonl`, as the conversation
 *   records a phone turn, so the day's budget counts it; a turn the supervisor reports after the watchdog is recorded
 *   too, and nothing more;
 * - the reply, after its record, through the conversation's `deliver` (so the pause holds it) - `urgent` for a post
 *   marked `urgent`, else `alert` - as a reply to the first delivered alert's message: the turn's final text - with
 *   the cut line after an answer a cut interrupted - or the line for why there is none: the fence's refusal, the
 *   timed-out line, {@link notAnnotatedLine} for a failed model call, {@link NO_CHECK} for no text at all;
 * - the note: `onAnnotated` with the pass, the session, the outcome, the ids `deliver` sent and the reply, cut at
 *   {@link ANNOTATED_TEXT_MAX} - the watch's `annotated` record in `alerts.jsonl`;
 * - letting go: the agent's dispose, then the supervision's end, so a turn the dispose drains is still recorded; the
 *   dispose is awaited at most src/firing.ts `FIRING_DISPOSE_MS`, past which one line and it goes on alone.
 *
 * ONE AT A TIME. Posts run on the annotator's own chain, each once the one before has delivered and noted its reply -
 * not once its agent is let go, which goes on beside the next run. Each wait is bounded, so a check waits behind
 * another for a bounded time, never behind the operator: the agent's making at the deadline plus src/firing.ts
 * `FIRING_SLACK_MS` (300 s with the 240 s deadline; past it, the not-annotated line and the lane moves on, the agent let
 * go when it comes), the turn by the watchdog above (the same 300 s from the followup), and the reply by `deliver`'s
 * own minute.
 *
 * SHUTDOWN ({@link Annotator.dispose}). A turn under way is cancelled as `shutdown`; its run sends nothing and notes
 * nothing, records the cut turn when the supervisor reports it before the agent is let go, and lets the agent go; a
 * post that has not made its agent yet makes none. The dispose waits for the runs at most src/firing.ts
 * `FIRING_DISPOSE_MS` and a two-second margin - 12 s, inside launchd's 20 s `ExitTimeOut` - and then resolves whatever
 * is still under way (src/desk.ts `installDesk` disposes the annotator before the conversation). What that bound cuts
 * off goes on alone and can land after the conversation's dispose: a delivery under way, an agent's dispose that does
 * not settle, a making that hangs across the shutdown, whose agent is let go when it comes. Afterwards a post refuses.
 *
 * MODULE WEIGHT. src/desk.ts imports this module, so it imports nothing but types: src/desk.ts, src/desk-session.ts,
 * src/desk-conversation.ts, src/firing.ts (for its two bounds) and dsh-llm load on the first post ({@link
 * loadMachinery}), by which time the clock row has loaded the same graph.
 * @module
 */
import type { MessageSource } from "@deepseek-ai/dsh-llm";
import type { BudgetState, OffState } from "./desk.ts";
import type { DeskConversation, PostResult } from "./desk-conversation.ts";
import type { DeskClock, DeskSessionDeps, DeskTurnRecord, SessionEventsOn } from "./desk-session.ts";
import type { AgentLike } from "./room.ts";
import type { MessageLike } from "./room-rules.ts";
import type { AnnotatedRecord } from "./watch.ts";

/** Diagnostic label, the one every `${BIN}:`-prefixed line in the face uses; desk lines add `desk:`. */
const BIN = "gravit-face";
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const defaultLog = (line: string): void => { console.error(line); };
const defaultClock: DeskClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

/** The most characters of a reply the `annotated` note keeps (the plan's Global Constraints). */
export const ANNOTATED_TEXT_MAX = 2_000;
/** What {@link Annotator.dispose} waits past src/firing.ts `FIRING_DISPOSE_MS` - the bound on letting an agent go - for
 * the runs under way before it resolves: the whole stays well inside launchd's 20 s `ExitTimeOut`. */
const SHUTDOWN_MARGIN_MS = 2_000;
/** The journal, repo-relative: the label a refusal without a violation names, and every annotation's cwd. */
const JOURNAL = "desk/journal";

/** The phone's line for an annotation whose model call failed, or that could not be opened, before it said anything. */
export const notAnnotatedLine = (error: string): string => `the desk could not annotate this alert: ${error}`;
/** The phone's line for an annotation that ended, was cancelled, or never started, before it said anything. */
export const NO_CHECK = "the desk's check of this alert ended with no text";
const SHUT_DOWN = "the desk is shut down";

/** A desk agent as {@link createDeskAgent} answers one - and as a test's fake does. */
type MadeAgent = { agent: AgentLike; sessionId: string; dispose(): Promise<void> };

/** What {@link createAnnotator} needs. `session` is src/desk-session.ts's deps, as the conversation's ensure gets them -
 * its `route` the desk's; `home` the ledger's, `root` the repository the journal is in; `on` the root bus; `deliver` the
 * desk conversation's; `budget` the day's, as a post reads it - none, no check; `deadlineMs` the annotation's turn
 * deadline, src/desk.ts `ALERT_DEADLINE_MS` when absent; `onAnnotated` where each run's note goes (the watch's
 * `noteAnnotated`); `clock` the timers and stamps; `log` where a line goes (stderr); `createAgent`, a test seam for
 * src/desk-session.ts `createDeskAgent` over `session`. */
export interface AnnotatorDeps {
  session: DeskSessionDeps;
  home: string;
  root: string;
  on: SessionEventsOn;
  deliver: DeskConversation["deliver"];
  budget?: () => Promise<BudgetState>;
  deadlineMs?: number;
  onAnnotated?: (r: AnnotatedRecord) => void;
  clock?: DeskClock;
  log?: (line: string) => void;
  createAgent?: (opts: { cwd: string; route: { provider: string; model: string } }) => Promise<MadeAgent>;
}

/** The lane. `post` takes the watch's annotation post - `message.pass`, else `message.alert`, names the pass - and
 * answers `opened` once its agent has the message, or why not (the module header); it never rejects. `dispose` shuts it
 * down (the module header's SHUTDOWN), once. `idle` resolves once no post is running or waiting on the chain - each
 * reply delivered and noted (the module header's ONE AT A TIME) - at once when the lane is idle, and at once once the
 * dispose has begun; it never rejects. */
export interface Annotator {
  post: DeskConversation["post"];
  idle(): Promise<void>;
  dispose(): Promise<void>;
}

/* ---------- what the lane loads on first use ---------- */

interface Machinery {
  desk: typeof import("./desk.ts");
  session: typeof import("./desk-session.ts");
  conversation: typeof import("./desk-conversation.ts");
  firing: typeof import("./firing.ts");
  createUserMessage: (typeof import("@deepseek-ai/dsh-llm"))["createUserMessage"];
}

let machinery: Promise<Machinery> | undefined;

/** The machinery, imported on the first call and shared after it (see the module header's MODULE WEIGHT). */
function loadMachinery(): Promise<Machinery> {
  machinery ??= Promise.all([
    import("./desk.ts"), import("./desk-session.ts"), import("./desk-conversation.ts"), import("./firing.ts"), import("@deepseek-ai/dsh-llm"),
  ]).then(([desk, session, conversation, firing, llm]) => ({ desk, session, conversation, firing, createUserMessage: llm.createUserMessage }));
  return machinery;
}

/** How a run's wait for its turn ended: the turn's record, the watchdog, or the shutdown. */
type Ending = { kind: "turn"; record: DeskTurnRecord } | { kind: "watchdog"; started: boolean } | { kind: "shutdown" };

/** A run under way, as {@link Annotator.dispose} reaches it. */
interface Run {
  shutDown(): void;
  done: Promise<void>;
}

/**
 * The annotation lane. Nothing runs until `post` is called.
 * @param deps - see {@link AnnotatorDeps}.
 */
export function createAnnotator(deps: AnnotatorDeps): Annotator {
  const { home, root } = deps;
  const clock = deps.clock ?? defaultClock;
  const log = deps.log ?? defaultLog;
  const stamp = (): string => new Date(clock.now()).toISOString();
  let disposed = false;
  let disposing: Promise<void> | undefined;
  const runs = new Set<Run>();

  /* one post at a time; the chain itself never rejects */
  let chain: Promise<unknown> = Promise.resolve();
  /* settled when the dispose begins, so an idle waiting on the chain answers at once */
  let signalDisposed: () => void = () => {};
  const disposedSignal = new Promise<void>((done) => { signalDisposed = done; });

  /* every turn's record, in the order reported */
  let recording: Promise<void> = Promise.resolve();
  const record = (r: DeskTurnRecord, m: Machinery): Promise<void> => {
    recording = recording.then(() => m.desk.appendEvent(home, m.session.deskTurnEvent(r, stamp(), JOURNAL), { log })).catch((err: unknown) => {
      log(`${BIN}: desk: annotation turn ${r.turn} on ${r.sessionId} could not be recorded: ${errText(err)}`);
    });
    return recording;
  };

  const shutDown = (): PostResult => ({ refused: "error", line: notAnnotatedLine(SHUT_DOWN) });
  const failed = (err: unknown): PostResult => {
    const line = notAnnotatedLine(errText(err));
    log(`${BIN}: desk: ${line}`);
    return { refused: "error", line };
  };

  /** The pause as a post reads it: lifted when past its `until`, then read again - a pause set since stands. */
  const pause = async (m: Machinery): Promise<OffState | undefined> => {
    const now = (): number => clock.now();
    let off = await m.desk.readOffState(home, now);
    if (off.state !== undefined && off.expired) {
      try {
        await m.desk.clearOff(home, "expiry", now);
      } catch (err) {
        log(`${BIN}: desk: the expired pause could not be lifted (${errText(err)}); the desk goes on`);
      }
      off = await m.desk.readOffState(home, now);
    }
    return off.state !== undefined && !off.expired ? off.state : undefined;
  };

  /** The day's budget when it is spent, else `undefined` - and `undefined`, with a line, when it cannot be read. */
  const spentBudget = async (): Promise<BudgetState | undefined> => {
    const read = deps.budget;
    if (read === undefined) return undefined;
    try {
      const state = await read();
      return state.spent ? state : undefined;
    } catch (err) {
      log(`${BIN}: desk: the token budget could not be read (${errText(err)}); the desk goes on`);
      return undefined;
    }
  };

  /** Whether `p` settles within `ms` on the clock; never rejects. */
  const settlesWithin = (ms: number, p: Promise<unknown>): Promise<boolean> => new Promise((done) => {
    const timer = clock.setTimeout(() => { done(false); }, ms);
    const settled = (): void => {
      clock.clearTimeout(timer);
      done(true);
    };
    p.then(settled, settled);
  });

  /** What a turn's end sends: the refusal line, the final text (with the cut line after an interrupted answer), or why
   * there is none. */
  const replyOf = (r: DeskTurnRecord, m: Machinery): string => {
    if (r.outcome === "refused") return m.session.fenceRefusalLine(r.violation ?? JOURNAL);
    if (r.finalText !== "") return r.interrupted === true ? `${r.finalText}\n${m.session.cutOffLine(r)}` : r.finalText;
    if (r.outcome === "timed-out") return m.conversation.timedOutLine(r.deadlineMs, m.session.formatDuration);
    if (r.outcome === "failed") return notAnnotatedLine(r.error ?? "error");
    return NO_CHECK;
  };

  /** One post: the checks, the agent, the message - `open` answered there - then the turn's end, the record, the reply,
   * the note, and the agent let go (see the module header). Never rejects. */
  const annotate = async (input: Parameters<Annotator["post"]>[0], open: (r: PostResult) => void): Promise<void> => {
    if (disposed) return open(shutDown());
    let m: Machinery;
    try {
      m = await loadMachinery();
      const paused = await pause(m);
      if (paused !== undefined) return open({ refused: "paused", line: m.conversation.pausedLine(paused, new Date(clock.now()), m.desk.deskTime) });
      const spent = await spentBudget();
      if (spent !== undefined) return open({ refused: "budget", line: m.desk.budgetReplyLine(spent) });
      const path = await m.session.findDeskFenceViolation(root);
      if (path !== undefined) {
        await m.desk.appendEvent(home, { t: stamp(), kind: "desk-refused", reason: "fence", path }, { log });
        return open({ refused: "fence", path, line: m.session.fenceRefusalLine(path) });
      }
    } catch (err) {
      return open(failed(err));
    }
    if (disposed) return open(shutDown());
    const deadlineMs = deps.deadlineMs ?? m.desk.ALERT_DEADLINE_MS;
    const cwd = m.session.deskJournalDir(root);
    const route = deps.session.route;
    /* the making bounded as a firing bounds its open (src/firing.ts): one that never settles must not stall the lane;
     * an agent made after the bound, or once the shutdown has begun, is let go when it comes */
    const makeMs = deadlineMs + m.firing.FIRING_SLACK_MS;
    const creating = Promise.resolve().then(() => (deps.createAgent ?? ((opts) => m.session.createDeskAgent(deps.session, opts)))({ cwd, route }));
    const letGoLate = (): void => {
      creating.then((late) => late.dispose(), () => {}).catch(() => {});
    };
    let made: MadeAgent;
    try {
      const within = await new Promise<{ made: MadeAgent } | undefined>((done, fail) => {
        const timer = clock.setTimeout(() => { done(undefined); }, makeMs);
        creating.then(
          (value) => { clock.clearTimeout(timer); done({ made: value }); },
          (err: unknown) => { clock.clearTimeout(timer); fail(err); },
        );
      });
      if (within === undefined) {
        letGoLate();
        return open(failed(new Error(`the desk agent was not made in ${m.session.formatDuration(makeMs)}`)));
      }
      made = within.made;
    } catch (err) {
      return open(failed(err));
    }
    if (disposed) {
      letGoLate();
      return open(shutDown());
    }
    const { agent, sessionId } = made;
    const where = `annotation session ${sessionId}`;

    /* the wait for the run's turn: its record, the watchdog or the shutdown; `closed` once the supervision has ended */
    let waiting = true;
    let closed = false;
    let settle: (e: Ending) => void = () => {};
    const ended = new Promise<Ending>((done) => { settle = done; });
    const end = (e: Ending): void => {
      if (!waiting) return;
      waiting = false;
      settle(e);
    };
    /* the first record the run's own; every one recorded, a late one only recorded */
    let recorded: Promise<void> = Promise.resolve();
    const onTurnEnd = (r: DeskTurnRecord): void => {
      if (closed) return;
      recorded = record(r, m);
      end({ kind: "turn", record: r });
    };
    let started = false;
    let unwatch: (() => void) | undefined;
    let offBus: (() => void) | undefined;
    let watchdog: unknown;
    const run: Run = {
      shutDown: () => {
        if (!waiting) return;
        try {
          agent.cancel({ kind: "hook", reason: "shutdown" });
        } catch (err) {
          log(`${BIN}: desk: the turn on ${where} could not be cancelled: ${errText(err)}`);
        }
        end({ kind: "shutdown" });
      },
      done: Promise.resolve(),
    };

    /** Let the agent go, then end the supervision - so a turn the dispose drains is still recorded - the dispose
     * awaited at most FIRING_DISPOSE_MS. Never rejects. */
    const letGo = async (): Promise<void> => {
      if (watchdog !== undefined) clock.clearTimeout(watchdog);
      waiting = false;
      offBus?.();
      const disposing = made.dispose().catch((err: unknown) => {
        log(`${BIN}: desk: ${where} could not be disposed: ${errText(err)}`);
      });
      const endSupervision = (): void => {
        try {
          unwatch?.();
        } catch (err) {
          log(`${BIN}: desk: the supervision of ${where} could not be ended: ${errText(err)}`);
        }
        closed = true;
      };
      if (await settlesWithin(m.firing.FIRING_DISPOSE_MS, disposing)) {
        endSupervision();
        await recording;
      } else {
        log(`${BIN}: desk: ${where} could not be disposed in ${m.session.formatDuration(m.firing.FIRING_DISPOSE_MS)}; the lane goes on, and the dispose goes on alone`);
        void disposing.then(endSupervision);
      }
    };

    try {
      offBus = deps.on("session/event", (s, event) => {
        if (s.id === sessionId && event.type === "turn/start") started = true;
      });
      unwatch = m.session.superviseDeskTurns({
        on: deps.on, sessionId, agent, deadlineMs, clock, log,
        fence: () => m.session.findDeskFenceViolation(root),
        onTurnEnd,
      });
      const text = `${m.session.provenanceLine(input.source, new Date(clock.now()))}\n${input.text}`;
      const message = m.createUserMessage({ content: [{ type: "text", text }], source: input.message as MessageSource });
      agent.followup(message as unknown as MessageLike);
    } catch (err) {
      await letGo();
      return open(failed(err));
    }
    runs.add(run);
    let lettingGo: Promise<void> = Promise.resolve();
    run.done = (async () => {
      open({ opened: true, sessionId });
      if (disposed) run.shutDown();
      const slackMs = deadlineMs + m.firing.FIRING_SLACK_MS;
      watchdog = clock.setTimeout(() => {
        watchdog = undefined;
        if (!waiting) return;
        log(`${BIN}: desk: ${where} saw ${started ? "no end to its turn" : "no turn start"} in ${m.session.formatDuration(slackMs)}; the watchdog cancels it`);
        try {
          agent.cancel({ kind: "hook", reason: "desk deadline" });
        } catch (err) {
          log(`${BIN}: desk: the turn on ${where} could not be cancelled: ${errText(err)}`);
        }
        end({ kind: "watchdog", started });
      }, slackMs);
      const ending = await ended;
      if (watchdog !== undefined) {
        clock.clearTimeout(watchdog);
        watchdog = undefined;
      }
      if (ending.kind === "shutdown") {
        await letGo();
        return;
      }
      let outcome: DeskTurnRecord["outcome"];
      let reply: string;
      if (ending.kind === "turn") {
        await recorded;
        outcome = ending.record.outcome;
        reply = replyOf(ending.record, m);
      } else {
        outcome = "timed-out";
        reply = ending.started ? m.conversation.timedOutLine(deadlineMs, m.session.formatDuration) : NO_CHECK;
      }
      let sent: string[] = [];
      try {
        /* an annotation goes as its alerts went - `urgent` or `alert` (src/phone.ts) - threaded under the alert's message */
        const kind = input.urgent === true ? "urgent" : "alert";
        const result = await deps.deliver(reply, input.replyTo === undefined ? { kind } : { kind, replyTo: input.replyTo });
        if ("sent" in result) sent = result.sent;
      } catch (err) {
        log(`${BIN}: desk: the reply of ${where} could not be delivered: ${errText(err)}`);
      }
      const pass = typeof input.message.pass === "string" ? input.message.pass : typeof input.message.alert === "string" ? input.message.alert : "";
      try {
        deps.onAnnotated?.({ t: stamp(), kind: "annotated", pass, sessionId, outcome, sent, text: reply.slice(0, ANNOTATED_TEXT_MAX) });
      } catch (err) {
        log(`${BIN}: desk: the annotation of ${where} could not be noted: ${errText(err)}`);
      }
      lettingGo = letGo();
    })().catch((err: unknown) => {
      log(`${BIN}: desk: ${where} failed: ${errText(err)}`);
    });
    await run.done;
    /* the chain moves on now; the agent's letting go is the dispose's to wait for */
    const gone: Run = { shutDown: () => {}, done: lettingGo.finally(() => { runs.delete(gone); }) };
    runs.delete(run);
    runs.add(gone);
  };

  return {
    post(input) {
      return new Promise<PostResult>((resolve) => {
        let answered = false;
        const open = (r: PostResult): void => {
          if (answered) return;
          answered = true;
          resolve(r);
        };
        const step = chain.then(() => annotate(input, open)).catch((err: unknown) => { open(failed(err)); });
        /* annotate answers every post; this only keeps a caller from waiting on one it somehow did not */
        chain = step.then(() => { if (!answered) open(failed(new Error("the lane gave no answer"))); });
      });
    },

    async idle() {
      /* a post queued while the chain is awaited extends it: wait again until it stands still */
      for (let seen = chain; ; seen = chain) {
        if (disposed) return;
        await Promise.race([seen, disposedSignal]);
        if (disposed || seen === chain) return;
      }
    },

    dispose() {
      disposing ??= (async () => {
        disposed = true;
        signalDisposed();
        for (const run of runs) run.shutDown();
        const loaded = machinery === undefined ? undefined : await machinery.catch(() => undefined);
        await settlesWithin((loaded?.firing.FIRING_DISPOSE_MS ?? 0) + SHUTDOWN_MARGIN_MS, (async () => {
          await chain;
          while (runs.size > 0) await Promise.all([...runs].map((r) => r.done));
          await recording;
        })());
      })();
      return disposing;
    },
  };
}
