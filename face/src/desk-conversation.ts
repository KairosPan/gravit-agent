// face/src/desk-conversation.ts
/** The desk conversation: the one owner of the desk session (docs/superpowers/specs/2026-10-19-always-on-gravit-design.md
 * §5.3, §5.8; the plan's Global Constraints, docs/superpowers/plans/2026-10-20-desk-p1-bridge.md).
 *
 * ONE OWNER. Whatever reaches the desk session from the face goes through here: the phone's texts (the
 * Telegram bridge posts them, and is the outlet their answers go to) and, in P3, the watch's alerts. It exists
 * whenever the desk is on, Telegram or not - src/desk.ts `installDesk` creates it and calls {@link
 * DeskConversation.start} - because what it does for a turn does not depend on who opened it: a turn the
 * operator opens in the browser gets the same deadline, fence check and ledger record as a phone turn.
 *
 * BEFORE A TURN ({@link DeskConversation.post}), in this order: the pause - an `OFF` past its `until` is lifted,
 * one in force refuses (src/desk.ts); the day's token budget, when the owner passes one - spent, it refuses
 * with src/desk.ts `budgetReplyLine`, no turn and no event, and one that cannot be read lets the post go on,
 * with a line (ruling P2-8: the pause outranks the budget, and a paused post never reads it); the
 * instruction-chain fence - a violation refuses, and is a `desk-refused` event (src/desk-session.ts
 * `findDeskFenceViolation`); the desk session, ensured - live, resumed or created; for a phone's text, the
 * desk state ({@link DeskConversation.setState}), waited for {@link STATE_WAIT_MS} at most and injected just
 * before the message only while nothing is under way (the P3 plan's ruling 6: a text queued behind a turn
 * carries none); then the message, its provenance line first. A refusal comes back as a {@link PostResult}
 * carrying the line the phone gets; nothing here sends it.
 *
 * EVERY TURN on the session, whoever opened it, is supervised (src/desk-session.ts `superviseDeskTurns`): its
 * deadline and its fence check run from its `turn/start`. At its end it is one ledger event - a `desk-turn`,
 * or a `desk-refused` when its fence check cut it - and then, for a turn opened by the phone, an alert or a
 * wake, one delivery through {@link DeskConversation.deliver}: the fence's refusal line for a refused turn; else
 * its final text - with `(cut off: <what cut it>)` after it when a cut interrupted the answer mid-stream - or,
 * when it said nothing, the timed-out line for a turn the deadline cut and the failed line for one that ended
 * on an error - an alert's annotation having its own lines, and one for a check that ended with no text
 * (P3-15). A browser turn's answer stays in its transcript. Records keep turn order and so do deliveries, each
 * delivery after its own record and none waiting on an outlet more than a minute; nothing at a turn's end can
 * reject - a send that fails is one line.
 *
 * ANNOTATIONS (P3). An alert's post with `replyTo` keeps it under the alert's id - the newest 50, until that
 * alert's turn ends - and that turn is answered as a reply to the alert's message, whatever it ends in. An alert
 * id whose message another turn claims (a wake or browser turn under way takes it as its own input) stays in the
 * map until the fifty newer ones evict it, and its annotation goes without a reply.
 *
 * DELIVERY (rulings P2-7, P2-19). Everything the desk sends leaves through {@link DeskConversation.deliver} - a
 * turn's answer, and in P2 and P3 a firing's text and an alert. It holds a text back while the pause is in force
 * - read, never lifted, so a delivery writes nothing - and holds it back too when the switch cannot be read; with
 * no outlet it says so; else it is the outlet's answer, a send that fails or keeps the outlet past a minute
 * being one line and an `undelivered` reason.
 *
 * A CUT CUTS ONE TURN. The phone's `/stop` ({@link DeskConversation.stop}), like the deadline, cancels the turn
 * under way and only it: the messages queued behind it are kept and answered, each in its own turn
 * (src/desk-session.ts `cancelKeepingQueue`). A shutdown keeps nothing.
 *
 * ONE AT A TIME. `start`, `post` and `renew` run in the order they were called, each once the one before has
 * settled: two ensures at once would both find no conversation in the ledger and open two. `stop`,
 * `setOutlet`, `current` and `dispose` act at once.
 *
 * WORK UNDER WAY is dsh-agent's `whenIdle` wherever the agent has it, not its status: the status reads
 * `idle` while maintenance runs with a followup latched behind it, and `whenIdle` waits for both.
 *
 * THE SWITCH. When an ensure answers another session, or another agent object, than the one supervised, the
 * supervision moves to it. Another agent object for the same session means the old one is gone, and its
 * supervision goes at once. Another session - a renew, the phone's `/new` - retires the old one: its
 * supervision stays until that agent is idle (`whenIdle`: the turn running at the switch and any its inbox
 * already held), so a turn under way keeps its deadline, its record and its delivery.
 *
 * SHUTDOWN ({@link DeskConversation.dispose}). Every turn under way, on the conversation and on any it
 * retired, is cancelled as `shutdown`, and its agent gets two seconds to go idle, so the cut turn is
 * recorded; then every supervision ends, a start, post or renew under way gets five seconds to settle, and
 * the records under way are waited for - so nothing the conversation writes lands after the ledger's
 * `shutdown`, which src/desk.ts appends once this has settled.
 *
 * MODULE WEIGHT. src/desk.ts imports this module, and `npm run desk` and scripts/service.ts import src/desk.ts.
 * src/desk-session.ts brings src/desk-preset.ts (src/roles.ts, src/bots.ts, js-yaml) and dsh-agent with it,
 * and dsh-llm brings cordis. So this module imports nothing but types: src/desk.ts, src/desk-session.ts and
 * dsh-llm load on a conversation's first use ({@link loadMachinery}). The pause switch loads no more than it
 * did, and the cycle with src/desk.ts has no value edge.
 * @module
 */
import type { MessageSource } from "@deepseek-ai/dsh-llm";
import type { BudgetState, OffState } from "./desk.ts";
import type {
  DeskClock, DeskSessionCtxLike, DeskSessionDeps, DeskSource, DeskStateMessageSource, DeskTurnRecord, SessionEventsOn,
} from "./desk-session.ts";
import type { AgentLike } from "./room.ts";
import type { EventLike, MessageLike } from "./room-rules.ts";

/** Diagnostic label, the one every `${BIN}:`-prefixed line in the face uses; desk lines add `desk:`. */
const BIN = "gravit-face";
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
/** Where the conversation's lines go unless its owner passes `log`: stderr, as src/desk.ts's do. */
const defaultLog = (line: string): void => { console.error(line); };
const defaultClock: DeskClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

/** Every desk turn's deadline unless the owner says otherwise: five minutes (the plan's Global Constraints). */
const DESK_DEADLINE_MS = 300_000;
/** The longest a phone's post waits for the desk state before it goes without (the P3 plan's ruling 6). */
export const STATE_WAIT_MS = 3_500;
/** The most alert replies kept waiting for their turns' ends; past it the oldest is dropped. */
const REPLIES_MAX = 50;
/** The longest a delivery waits on the outlet before the next one goes ahead. */
const DELIVERY_MS = 60_000;
/** How long {@link DeskConversation.dispose} gives an agent it cancelled to go idle, so the cut turn is recorded. */
const SHUTDOWN_IDLE_MS = 2_000;
/** How long {@link DeskConversation.dispose} gives a start, post or renew under way to settle. */
const SHUTDOWN_QUEUE_MS = 5_000;

/** The sources whose answers go to the outlet: the phone, an alert, a wake. A `user` turn is the operator at the
 * browser, answered in its own transcript. */
const DELIVERED: ReadonlySet<string> = new Set(["telegram", "alert", "wake"]);

/** The journal, repo-relative: what a refused turn names when its record carries no violation (the supervisor
 * always gives one; this is the fail-closed reading of a record that did not). */
const JOURNAL = "desk/journal";

/** Where a turn's answer goes when it should leave the face: the Telegram bridge is one, and P3 adds no other.
 * `send` resolves the ids of the messages it sent, or `{ queued: true }` when it kept the text to send later. */
export interface DeskOutlet {
  send(text: string, opts?: { replyTo?: number }): Promise<{ sent: number[]; queued?: true } | { queued: true }>;
}

/** What {@link DeskConversation.deliver} answers: the outlet's own answer, or why the text did not reach it -
 * `paused`, `telegram not configured`, `send failed: <reason>`, `the outlet did not answer in 60 s`,
 * `the pause could not be read: <reason>`, or `the desk could not load: <reason>`. */
export type DeliverResult = Awaited<ReturnType<DeskOutlet["send"]>> | { undelivered: string };

/** What {@link DeskConversation.post} answers: the turn opened on `sessionId`, or why not, with the line the
 * phone gets. */
export type PostResult =
  | { opened: true; sessionId: string }
  | { refused: "paused"; line: string }
  | { refused: "budget"; line: string }
  | { refused: "fence"; path: string; line: string }
  | { refused: "error"; line: string };

/** The booted ROOT context as src/desk.ts hands it to a conversation: the desk session's slice and the root
 * bus. `on` is cordis's, called on the context, never detached. */
export type DeskConversationCtxLike = DeskSessionCtxLike & {
  on(name: "session/event", listener: (session: { id: string }, event: EventLike) => void): () => unknown;
};

/** What {@link createDeskConversation} needs. `session` is src/desk-session.ts's ensure deps, whose `root` and
 * `home` this reads too; `on`, the root bus; `deadlineMs`, every turn's deadline (five minutes by default),
 * which `deadlineFor` may only shorten for a source (P3's alerts); `budget`, the day's token budget, read by
 * each post the pause lets through (src/desk.ts `readBudget` over the standing orders' cap) - no budget, no
 * check; `clock`, the timers and the stamps (the global ones); `log`, where a failure line goes (stderr). */
export interface DeskConversationDeps {
  session: DeskSessionDeps;
  on: SessionEventsOn;
  deadlineMs?: number;
  deadlineFor?: (kind: string) => number | undefined;
  budget?: () => Promise<BudgetState>;
  clock?: DeskClock;
  log?: (line: string) => void;
}

/** The desk session's one owner. See the module header; each member's own comment says what it does. */
export interface DeskConversation {
  /** Ensure the desk session and supervise it, so a turn opened from the browser is supervised before any
   * post. Never rejects: a failure is one line, and the next post tries again. */
  start(): Promise<void>;
  /** Open a turn: `text` after the provenance line for `source`, sent with `message` as its source - or the
   * reason it was not, as {@link PostResult}. An alert's post (`message.kind` `alert`) with `replyTo` has its
   * turn answered as a reply to that message; a phone's (`source.kind` `telegram`) carries the desk state
   * ahead of it when one is ready and nothing is under way. Never rejects. */
  post(input: { text: string; source: DeskSource; message: { kind: string } & Record<string, unknown>; replyTo?: number }): Promise<PostResult>;
  /** Open another desk conversation (the phone's `/new`), recorded as `new`, and supervise it; resolves its id.
   * Rejects when the ensure does, and when the conversation is disposed before or while it runs. */
  renew(): Promise<{ sessionId: string }>;
  /** Cancel the work under way - on the current conversation and on any it retired - with `{ kind: "hook",
   * reason }`, and only it: the messages queued behind it are kept and answered, each in its own turn
   * (src/desk-session.ts `cancelKeepingQueue`); `true` when there was some, `false` when nothing was under way. */
  stop(reason: string): Promise<boolean>;
  /** Send `text` to the outlet - the first part as a reply to `replyTo` when given - and answer what the outlet
   * answered, or why the text did not reach it ({@link DeliverResult}): `paused` while the pause is in force (a
   * pause past its `until` is not; the switch is read, never lifted, and a switch that cannot be read holds the
   * text back too, with one line), `telegram not configured` with no outlet, `send failed: <reason>` with one line
   * when the send throws or rejects, and, with one line, an outlet that has not answered in a minute. The way
   * every desk text leaves the face - each turn's answer, a firing's, an alert. Never rejects. */
  deliver(text: string, opts?: { replyTo?: number }): Promise<DeliverResult>;
  /** Where answers go from now on: read at each delivery, so `undefined` stops them while records go on. */
  setOutlet(outlet: DeskOutlet | undefined): void;
  /** The desk state from now on: what a phone's post asks for, waited for {@link STATE_WAIT_MS} at most - a
   * throw or lateness is one line, and the message goes without it, as it does on `undefined`. Read at each
   * post; `undefined` asks nothing. */
  setState(provider: (() => Promise<string | undefined>) | undefined): void;
  /** The conversation supervised now, and whether a supervised agent's status reads `running` - a snapshot:
   * maintenance with a followup latched behind it reads idle here, which {@link stop} does not go by. */
  current(): { sessionId?: string; running: boolean };
  /** Shut the conversation down (see the module header's SHUTDOWN). Once: a second call settles with the
   * first. Afterwards a post refuses and a renew rejects. Never rejects. */
  dispose(): Promise<void>;
}

/* ---------- what a conversation loads on first use ---------- */

/** src/desk.ts, src/desk-session.ts and dsh-llm's `createUserMessage`, as a conversation uses them. */
interface Machinery {
  desk: typeof import("./desk.ts");
  session: typeof import("./desk-session.ts");
  createUserMessage: (typeof import("@deepseek-ai/dsh-llm"))["createUserMessage"];
}

let machinery: Promise<Machinery> | undefined;

/** The machinery, imported on the first call and shared after it (see the module header's MODULE WEIGHT). */
function loadMachinery(): Promise<Machinery> {
  machinery ??= Promise.all([import("./desk.ts"), import("./desk-session.ts"), import("@deepseek-ai/dsh-llm")])
    .then(([desk, session, llm]) => ({ desk, session, createUserMessage: llm.createUserMessage }));
  return machinery;
}

/* ---------- the lines ---------- */

/** The phone's line for a post the pause refused, each time as the desk shows one (src/desk.ts `deskTime`). */
function pausedLine(state: OffState, now: Date, deskTime: Machinery["desk"]["deskTime"]): string {
  const until = state.until === undefined ? "" : ` until ${deskTime(new Date(state.until), now)}`;
  return `paused since ${deskTime(new Date(state.setAt), now)} by ${state.by}${until}; a terminal resumes it: npm run desk -- resume`;
}

/** The phone's line for a turn its deadline cut before it said anything, the deadline as desk-session.ts's
 * `formatDuration` spells it - the default `5 min`, a firing's alike. */
function timedOutLine(deadlineMs: number, m: Machinery): string {
  return `timed out after ${m.session.formatDuration(deadlineMs)}; a card or a long tool was pending`;
}

/** The phone's line for a turn that ended on an error before it said anything. */
const notAnsweredLine = (error: string): string => `the desk could not answer: ${error}; nothing was done - send it again later`;

/** What a post refuses as once the conversation is disposed. */
const SHUT_DOWN = "the desk is shut down";
const notOpenedLine = (reason: string): string => `the desk could not open a turn: ${reason}`;

/** The phone's line for an alert's annotation whose model call failed before it said anything. */
const notAnnotatedLine = (error: string): string => `the desk could not annotate this alert: ${error}`;
/** The phone's line for an alert's annotation that ended, or was cancelled, before it said anything. */
const NO_CHECK = "the desk's check of this alert ended with no text";

/** What a turn's end sends: the refusal line for a refused turn; else its final text - with a line naming the cut
 * when a cut interrupted it mid-stream; else why it said nothing - cut by its deadline, or failed - and `""`,
 * nothing to send, for one that just ended on a tool or was cancelled before it said anything (the phone's `/stop`
 * is answered by the bridge, a shutdown by nobody). An alert's turn has its own lines for a failure and for no text
 * at all (P3-15): the operator has the alert, and is told its check came to nothing. */
function replyOf(r: DeskTurnRecord, m: Machinery): string {
  if (r.outcome === "refused") return m.session.fenceRefusalLine(r.violation ?? JOURNAL);
  if (r.finalText !== "") return r.interrupted === true ? `${r.finalText}\n${m.session.cutOffLine(r)}` : r.finalText;
  if (r.outcome === "timed-out") return timedOutLine(r.deadlineMs, m);
  const alert = r.source === "alert";
  if (r.outcome === "failed") return alert ? notAnnotatedLine(r.error ?? "error") : notAnsweredLine(r.error ?? "error");
  return alert ? NO_CHECK : "";
}

/** The alert id a turn was opened for: its naming message's `alert`, when that message is an alert's. */
function alertOf(r: DeskTurnRecord): string | undefined {
  const alert = r.message?.kind === "alert" ? r.message.alert : undefined;
  return typeof alert === "string" ? alert : undefined;
}

/* ---------- agents at rest ---------- */

/** dsh-agent's `Agent.inject`, which the structural {@link AgentLike} leaves out: context queued for the next
 * pre-step without waking the driver, so the followup that wakes it claims both. */
type Injecting = { inject?: (message: MessageLike) => void };
/** dsh-agent's `Agent.inbox`, the one call the desk state needs: removing a pending message, from either list, by id. */
type InboxAware = { inbox?: { remove(id: string): boolean } };

/** dsh-agent's `Agent.whenIdle`, which the structural {@link AgentLike} leaves out: it resolves once the
 * agent's driver has retired - after the turn it was running, every turn its inbox held, and any maintenance
 * with the followup latched behind it. */
type IdleAware = { whenIdle?: () => Promise<void> };

/** `agent`'s `whenIdle`, bound and never throwing - a synchronous throw becomes a rejection - or `undefined`
 * when the agent has none. */
function idleWaitOf(agent: AgentLike): (() => Promise<void>) | undefined {
  const whenIdle = (agent as AgentLike & IdleAware).whenIdle;
  if (typeof whenIdle !== "function") return undefined;
  return () => {
    try {
      return Promise.resolve(whenIdle.call(agent));
    } catch (err) {
      return Promise.reject(err);
    }
  };
}

/** Whether `agent` has work under way. With `whenIdle`, an idle agent's settles within microtasks, so one
 * still pending after a turn of the event loop is work under way; a `whenIdle` that rejects counts as idle.
 * Without it, the status. */
async function busy(agent: AgentLike): Promise<boolean> {
  const wait = idleWaitOf(agent);
  if (wait === undefined) return agent.status === "running";
  let idle = false;
  wait().then(() => { idle = true; }, () => { idle = true; });
  await new Promise<void>((done) => { setImmediate(done); });
  return !idle;
}

/* ---------- the conversation ---------- */

/** One supervised session: its id, the agent object it was ensured as, and the supervisor's disposer. */
interface Watch {
  readonly sessionId: string;
  readonly agent: AgentLike;
  readonly unwatch: () => void;
}

/** How a promise settled within a bound: `ok` with its value, `failed` with its error, or `late` - left to settle
 * alone. */
type Within<T> = { kind: "ok"; value: T } | { kind: "failed"; error: unknown } | { kind: "late" };

/** What the outlet answers a send. */
type OutletResult = Awaited<ReturnType<DeskOutlet["send"]>>;

/**
 * The desk session's one owner. Nothing runs until a member is called: src/desk.ts `installDesk` calls
 * {@link DeskConversation.start} at once, without awaiting it.
 * @param deps - see {@link DeskConversationDeps}.
 */
export function createDeskConversation(deps: DeskConversationDeps): DeskConversation {
  const { home, root } = deps.session;
  const clock = deps.clock ?? defaultClock;
  const log = deps.log ?? defaultLog;
  const deadlineMs = deps.deadlineMs ?? DESK_DEADLINE_MS;
  const stamp = (): string => new Date(clock.now()).toISOString();

  let outlet: DeskOutlet | undefined;
  let stateOf: (() => Promise<string | undefined>) | undefined;
  /** Each alert's message to reply to, by the alert's id, oldest first: kept from its post to its turn's end. */
  const replies = new Map<string, number>();
  /** The conversation supervised now. */
  let current: Watch | undefined;
  /** Conversations a renew left with work under way, each supervised until its agent is idle. */
  const retiring = new Set<Watch>();
  let disposed = false;
  let disposing: Promise<void> | undefined;
  const watches = (): Watch[] => [...(current === undefined ? [] : [current]), ...retiring];

  /** How `p` settled within `ms` on the clock. Never rejects; a `p` left late is still handled when it
   * rejects, so it cannot become an unhandled rejection. */
  const within = <T>(ms: number, p: Promise<T>): Promise<Within<T>> => new Promise((done) => {
    const timer = clock.setTimeout(() => done({ kind: "late" }), ms);
    p.then(
      (value) => { clock.clearTimeout(timer); done({ kind: "ok", value }); },
      (error: unknown) => { clock.clearTimeout(timer); done({ kind: "failed", error }); },
    );
  });

  /* start, post and renew, one at a time; the chain itself never rejects */
  let queue: Promise<unknown> = Promise.resolve();
  const serially = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task);
    queue = run.then(() => undefined, () => undefined);
    return run;
  };

  /* a turn's end: its record, in turn order; then its delivery, in turn order, each after its own record */
  let recording: Promise<void> = Promise.resolve();
  let delivering: Promise<void> = Promise.resolve();

  const record = async (r: DeskTurnRecord, m: Machinery): Promise<void> => {
    await m.desk.appendEvent(home, m.session.deskTurnEvent(r, stamp(), JOURNAL), { log });
  };

  /** {@link DeskConversation.deliver}, its failure lines opening with `unsent` - the turn's reply, or a message -
   * and a late one ending with `lateTail`. Never rejects. */
  const sendOut = async (text: string, opts: { replyTo?: number } | undefined, unsent: string, lateTail: string): Promise<DeliverResult> => {
    const heldBack = (reason: string): DeliverResult => {
      log(`${unsent}: ${reason}`);
      return { undelivered: reason };
    };
    let m: Machinery;
    try {
      m = await loadMachinery();
    } catch (err) {
      return heldBack(`the desk could not load: ${errText(err)}`);
    }
    /* the switch read, never lifted: a delivery writes nothing, and one under way at shutdown cannot land after it */
    let paused: boolean;
    try {
      const { state, expired } = await m.desk.readOffState(home, () => clock.now());
      paused = state !== undefined && !expired;
    } catch (err) {
      return heldBack(`the pause could not be read: ${errText(err)}`);
    }
    if (paused) return { undelivered: "paused" };
    const to = outlet;
    if (to === undefined) return { undelivered: "telegram not configured" };
    let sending: Promise<OutletResult>;
    try {
      sending = Promise.resolve(opts?.replyTo === undefined ? to.send(text) : to.send(text, { replyTo: opts.replyTo }));
    } catch (err) {
      log(`${unsent}: ${errText(err)}`);
      return { undelivered: `send failed: ${errText(err)}` };
    }
    const sent = await within(DELIVERY_MS, sending);
    if (sent.kind === "ok") return sent.value;
    if (sent.kind === "failed") {
      log(`${unsent}: ${errText(sent.error)}`);
      return { undelivered: `send failed: ${errText(sent.error)}` };
    }
    const late = `the outlet did not answer in ${DELIVERY_MS / 1000} s`;
    log(`${unsent}: ${late}${lateTail}`);
    return { undelivered: late };
  };

  /** A turn's end, delivered: its reply ({@link replyOf}) through {@link sendOut}, for a source the outlet
   * answers. */
  const deliverTurn = async (r: DeskTurnRecord, replyTo: number | undefined, m: Machinery): Promise<void> => {
    if (!DELIVERED.has(r.source)) return;
    const text = replyOf(r, m);
    if (text === "") return; // it ended on a tool: there is nothing to say
    await sendOut(text, replyTo === undefined ? undefined : { replyTo },
      `${BIN}: desk: the reply to turn ${r.turn} on desk session ${r.sessionId} could not be sent`, "; the next reply goes ahead");
  };

  /** The supervisor's hand at a turn's end. Synchronous, and nothing it starts can reject: an unhandled
   * rejection is a process exit in the face (main.ts `installFailLoud`). */
  const turnEnded = (r: DeskTurnRecord, m: Machinery): void => {
    const where = `turn ${r.turn} on desk session ${r.sessionId}`;
    /* an alert's reply is taken at its turn's end: forgotten whatever the delivery does */
    const alert = alertOf(r);
    const replyTo = alert === undefined ? undefined : replies.get(alert);
    if (alert !== undefined) replies.delete(alert);
    const recorded = recording.then(() => record(r, m)).catch((err: unknown) => {
      log(`${BIN}: desk: ${where} could not be recorded: ${errText(err)}`);
    });
    recording = recorded;
    delivering = delivering.then(() => recorded).then(() => deliverTurn(r, replyTo, m)).catch((err: unknown) => {
      log(`${BIN}: desk: ${where} could not be delivered: ${errText(err)}`);
    });
  };

  const supervise = (sessionId: string, agent: AgentLike, m: Machinery): Watch => ({
    sessionId,
    agent,
    unwatch: m.session.superviseDeskTurns({
      on: deps.on, sessionId, agent, deadlineMs, deadlineFor: deps.deadlineFor, clock, log,
      fence: () => m.session.findDeskFenceViolation(root),
      onTurnEnd: (r) => turnEnded(r, m),
    }),
  });

  /** End `w`'s supervision. It runs from a promise too, so a disposer that throws is one line, never a
   * rejection. */
  const end = (w: Watch): void => {
    try {
      w.unwatch();
    } catch (err) {
      log(`${BIN}: desk: the supervision of desk session ${w.sessionId} could not be ended: ${errText(err)}`);
    }
  };

  /** Keep `w` supervised until its agent is idle by `whenIdle` - at once when it is - or, for an agent without
   * one, end it now. */
  const retire = (w: Watch): void => {
    const wait = idleWaitOf(w.agent);
    if (wait === undefined) {
      end(w);
      return;
    }
    retiring.add(w);
    const release = (): void => {
      if (retiring.delete(w)) end(w);
    };
    wait().then(release, release);
  };

  /** Supervise `sessionId` as `agent` unless it already is (see the module header's THE SWITCH). */
  const watch = (sessionId: string, agent: AgentLike, m: Machinery): void => {
    const old = current;
    if (old !== undefined && old.sessionId === sessionId && old.agent === agent) return;
    current = supervise(sessionId, agent, m);
    if (old === undefined) return;
    if (old.sessionId === sessionId) end(old);
    else retire(old);
  };

  /** The desk session, ensured, and supervised unless the conversation is disposed by then. */
  const ensure = async (fresh: boolean): Promise<{ agent: AgentLike; sessionId: string }> => {
    const m = await loadMachinery();
    const { agent, sessionId } = await m.session.ensureDeskSession(deps.session, fresh ? { fresh: true } : {});
    if (!disposed) watch(sessionId, agent, m);
    return { agent, sessionId };
  };

  /** Cancel `w`'s work under way with `cause`; whether the cancel went through. `keep`, the phone's stop: only the
   * turn under way, the messages queued behind it kept and answered (src/desk-session.ts `cancelKeepingQueue`);
   * without it, a shutdown: the inbox goes too. */
  const cancel = (w: Watch, cause: { kind: "hook"; reason: string }, keep?: Machinery): boolean => {
    try {
      if (keep === undefined) w.agent.cancel(cause);
      else keep.session.cancelKeepingQueue(w.agent, cause, log);
      return true;
    } catch (err) {
      log(`${BIN}: desk: the turn on desk session ${w.sessionId} could not be cancelled: ${errText(err)}`);
      return false;
    }
  };

  /** A post that could not open its turn: one line, and the phone's. */
  const failed = (err: unknown): PostResult => {
    const line = notOpenedLine(errText(err));
    log(`${BIN}: desk: ${line}`);
    return { refused: "error", line };
  };
  const shutDown = (): PostResult => ({ refused: "error", line: notOpenedLine(SHUT_DOWN) });

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

  /** The day's budget as a post reads it: its state when it is spent, else `undefined` - and `undefined`, with a
   * line, when it cannot be read, the budget failing open (the plan's ruling 8) where the pause and the fence fail
   * closed. No budget, no read. */
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

  /** Take back a desk state injected for a followup that then threw, so it is not context for some later turn:
   * dsh's inbox removes a pending message from either list by id. With no inbox, or once a step has claimed it,
   * it cannot be taken back, and that is one line. */
  const withdraw = (agent: AgentLike, message: MessageLike): void => {
    const notTaken = (reason: string): void => {
      log(`${BIN}: desk: the desk state could not be taken back (${reason}); it may reach the next turn`);
    };
    const inbox = (agent as AgentLike & InboxAware).inbox;
    if (inbox === undefined) return notTaken("the agent has no inbox");
    try {
      if (!inbox.remove(message.id)) notTaken("it is no longer pending");
    } catch (err) {
      notTaken(errText(err));
    }
  };

  /** Keep `replyTo` for `alert`'s turn, the newest last; past {@link REPLIES_MAX}, the oldest goes. */
  const remember = (alert: string, replyTo: number): void => {
    replies.delete(alert);
    replies.set(alert, replyTo);
    while (replies.size > REPLIES_MAX) {
      const oldest = replies.keys().next().value;
      if (oldest === undefined) break;
      replies.delete(oldest);
    }
  };

  /** The desk state for a phone's post, or `undefined`: none asked for, none given, or - with one line - a provider
   * that threw or had not answered in {@link STATE_WAIT_MS}. Never rejects. */
  const deskState = async (): Promise<string | undefined> => {
    const provider = stateOf;
    if (provider === undefined) return undefined;
    const notReady = (reason: string): undefined => {
      log(`${BIN}: desk: the desk state was not ready (${reason}); the message goes without it`);
      return undefined;
    };
    let asked: Promise<string | undefined>;
    try {
      asked = Promise.resolve(provider());
    } catch (err) {
      return notReady(errText(err));
    }
    const got = await within(STATE_WAIT_MS, asked);
    if (got.kind === "ok") return got.value;
    return notReady(got.kind === "failed" ? errText(got.error) : `it did not answer in ${STATE_WAIT_MS / 1000} s`);
  };

  return {
    start() {
      return serially(async () => {
        if (disposed) return;
        try {
          await ensure(false);
        } catch (err) {
          log(`${BIN}: desk: the desk session could not be opened: ${errText(err)}; the next message tries again`);
        }
      });
    },

    post(input) {
      return serially(async (): Promise<PostResult> => {
        if (disposed) return shutDown();
        try {
          const m = await loadMachinery();
          const paused = await pause(m);
          if (paused !== undefined) return { refused: "paused", line: pausedLine(paused, new Date(clock.now()), m.desk.deskTime) };
          const spent = await spentBudget();
          if (spent !== undefined) return { refused: "budget", line: m.desk.budgetReplyLine(spent) };
          const path = await m.session.findDeskFenceViolation(root);
          if (path !== undefined) {
            await m.desk.appendEvent(home, { t: stamp(), kind: "desk-refused", reason: "fence", path }, { log });
            return { refused: "fence", path, line: m.session.fenceRefusalLine(path) };
          }
          if (disposed) return shutDown();
          const { agent, sessionId } = await ensure(false);
          if (disposed) return shutDown();
          const state = input.source.kind === "telegram" ? await deskState() : undefined;
          /* the state only on an idle desk: a text queued behind a turn would find it stale, or claimed by that turn */
          const inject = state !== undefined && !(await busy(agent)) ? (agent as AgentLike & Injecting).inject : undefined;
          if (disposed) return shutDown();
          const now = new Date(clock.now());
          const text = `${m.session.provenanceLine(input.source, now)}\n${input.text}`;
          const message = m.createUserMessage({ content: [{ type: "text", text }], source: input.message as MessageSource });
          const alert = input.message.kind === "alert" && typeof input.message.alert === "string" ? input.message.alert : undefined;
          if (alert !== undefined && input.replyTo !== undefined) remember(alert, input.replyTo);
          /* one synchronous step: the state, then the message it is context for. `busy` read the desk idle a
           * macrotask ago; a wake or a browser turn may have started since, and the state would splice into it
           * (spike 4), so the status is read again here, with nothing awaited before the followup. */
          let injected: MessageLike | undefined;
          if (typeof inject === "function" && state !== undefined && agent.status !== "running") {
            const stateText = `${m.session.provenanceLine({ kind: "state" }, now)}\n${state}`;
            const stateSource: DeskStateMessageSource = { kind: "desk", form: "state" };
            const stateMessage = m.createUserMessage({ content: [{ type: "text", text: stateText }], source: stateSource }) as unknown as MessageLike;
            try {
              inject.call(agent, stateMessage);
              injected = stateMessage;
            } catch (err) {
              log(`${BIN}: desk: the desk state could not be injected (${errText(err)}); the message goes without it`);
            }
          }
          try {
            agent.followup(message as unknown as MessageLike);
          } catch (err) {
            if (alert !== undefined) replies.delete(alert);
            if (injected !== undefined) withdraw(agent, injected);
            throw err;
          }
          return { opened: true, sessionId };
        } catch (err) {
          return failed(err);
        }
      });
    },

    renew() {
      return serially(async () => {
        if (disposed) throw new Error(SHUT_DOWN);
        const { sessionId } = await ensure(true);
        if (disposed) throw new Error(SHUT_DOWN); // opened, but by now nobody supervises it: no id to hand out
        return { sessionId };
      });
    },

    async stop(reason) {
      const all = watches();
      if (all.length === 0) return false;
      const m = await loadMachinery();
      const stopped = await Promise.all(all.map(async (w) => (await busy(w.agent)) && cancel(w, { kind: "hook", reason }, m)));
      return stopped.includes(true);
    },

    deliver(text, opts) {
      return sendOut(text, opts, `${BIN}: desk: a message could not be sent`, "");
    },

    setOutlet(next) {
      outlet = next;
    },

    setState(provider) {
      stateOf = provider;
    },

    current() {
      return {
        ...(current === undefined ? {} : { sessionId: current.sessionId }),
        running: watches().some((w) => w.agent.status === "running"),
      };
    },

    dispose() {
      disposing ??= (async () => {
        disposed = true;
        const all = watches();
        current = undefined;
        retiring.clear();
        await Promise.all(all.map(async (w) => {
          if ((await busy(w.agent)) && cancel(w, { kind: "hook", reason: "shutdown" })) {
            await within(SHUTDOWN_IDLE_MS, idleWaitOf(w.agent)?.() ?? Promise.resolve());
          }
          end(w);
        }));
        await within(SHUTDOWN_QUEUE_MS, queue);
        await recording;
      })();
      return disposing;
    },
  };
}
