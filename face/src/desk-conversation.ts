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
 * one in force refuses (src/desk.ts); the instruction-chain fence - a violation refuses, and is a `desk-refused`
 * event (src/desk-session.ts `findDeskFenceViolation`); the desk session, ensured - live, resumed or created;
 * then the message, its provenance line first. A refusal comes back as a {@link PostResult} carrying the line
 * the phone gets; nothing here sends it.
 *
 * EVERY TURN on the session, whoever opened it, is supervised (src/desk-session.ts `superviseDeskTurns`): its
 * deadline and its fence check run from its `turn/start`. At its end it is one ledger event - a `desk-turn`,
 * or a `desk-refused` when its fence check cut it - and then, for a turn opened by the phone, an alert or a
 * wake, one delivery to the outlet: its final text, the fence's refusal line, or the timed-out line when the
 * deadline cut it before it said anything. A browser turn's answer stays in its transcript. Records keep turn
 * order and so do deliveries, each delivery after its own record; nothing at a turn's end can reject - a send
 * that fails is one line.
 *
 * ONE AT A TIME. `start`, `post` and `renew` run in the order they were called, each once the one before has
 * settled: two ensures at once would both find no conversation in the ledger and open two. `stop`,
 * `setOutlet`, `current` and `dispose` act at once.
 *
 * THE SWITCH. When an ensure answers another session, or another agent object, than the one supervised, the
 * supervision moves to it. Another agent object for the same session means the old one is gone, and its
 * supervision goes at once. Another session - a renew, the phone's `/new` - retires the old one: its
 * supervision stays until that agent is idle (dsh-agent `whenIdle`: the turn running at the switch and any
 * its inbox already held), so a turn under way keeps its deadline, its record and its delivery.
 *
 * MODULE WEIGHT. src/desk.ts imports this module, and `npm run desk` and scripts/service.ts import src/desk.ts.
 * src/desk-session.ts brings src/desk-preset.ts (src/roles.ts, src/bots.ts, js-yaml) and dsh-agent with it,
 * and dsh-llm brings cordis, so this module loads both on a conversation's first use ({@link loadMachinery}),
 * never with itself: the pause switch stays as light as src/desk-names.ts made it.
 * @module
 */
import type { MessageSource } from "@deepseek-ai/dsh-llm";
import { appendEvent, clearOff, deskTime, readOffState, type OffState } from "./desk.ts";
import type { DeskClock, DeskSessionCtxLike, DeskSessionDeps, DeskSource, DeskTurnRecord, SessionEventsOn } from "./desk-session.ts";
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

/** The sources whose answers go to the outlet: the phone, an alert, a wake. A `user` turn is the operator at the
 * browser, answered in its own transcript. */
const DELIVERED: ReadonlySet<string> = new Set(["telegram", "alert", "wake"]);

/** The journal, repo-relative: what a refused turn names when its record carries no violation (the supervisor
 * always gives one; this is the fail-closed reading of a record that did not). */
const JOURNAL = "desk/journal";

/** Where a turn's answer goes when it should leave the face: the Telegram bridge is one, and P3 adds no other.
 * `send` resolves the ids of the messages it sent, or `{ queued: true }` when it kept the text to send later. */
export interface DeskOutlet {
  send(text: string, opts?: { replyTo?: number }): Promise<{ sent: number[] } | { queued: true }>;
}

/** What {@link DeskConversation.post} answers: the turn opened on `sessionId`, or why not, with the line the
 * phone gets. */
export type PostResult =
  | { opened: true; sessionId: string }
  | { refused: "paused"; line: string }
  | { refused: "fence"; path: string; line: string }
  | { refused: "error"; line: string };

/** The booted ROOT context as src/desk.ts hands it to a conversation: the desk session's slice and the root
 * bus. `on` is cordis's, called on the context, never detached. */
export type DeskConversationCtxLike = DeskSessionCtxLike & {
  on(name: "session/event", listener: (session: { id: string }, event: EventLike) => void): () => unknown;
};

/** What {@link createDeskConversation} needs. `session` is src/desk-session.ts's ensure deps, whose `root` and
 * `home` this reads too; `on`, the root bus; `deadlineMs`, every turn's deadline (five minutes by default),
 * which `deadlineFor` may only shorten for a source (P3's alerts); `clock`, the timers and the stamps (the
 * global ones); `log`, where a failure line goes (stderr). */
export interface DeskConversationDeps {
  session: DeskSessionDeps;
  on: SessionEventsOn;
  deadlineMs?: number;
  deadlineFor?: (kind: string) => number | undefined;
  clock?: DeskClock;
  log?: (line: string) => void;
}

/** The desk session's one owner. See the module header; each member's own comment says what it does. */
export interface DeskConversation {
  /** Ensure the desk session and supervise it, so a turn opened from the browser is supervised before any
   * post. Never rejects: a failure is one line, and the next post tries again. */
  start(): Promise<void>;
  /** Open a turn: `text` after the provenance line for `source`, sent with `message` as its source - or the
   * reason it was not, as {@link PostResult}. Never rejects. */
  post(input: { text: string; source: DeskSource; message: { kind: string } & Record<string, unknown> }): Promise<PostResult>;
  /** Open another desk conversation (the phone's `/new`), recorded as `new`, and supervise it; resolves its id.
   * Rejects when the ensure does, and once disposed. */
  renew(): Promise<{ sessionId: string }>;
  /** Cancel every supervised turn that runs - the current conversation's and a retiring one's - with
   * `{ kind: "hook", reason }`; `true` when there was one, `false` when nothing ran. */
  stop(reason: string): Promise<boolean>;
  /** Where answers go from now on: read at each delivery, so `undefined` stops them while records go on. */
  setOutlet(outlet: DeskOutlet | undefined): void;
  /** The conversation supervised now, and whether a desk turn runs - exactly when {@link stop} has one to cancel. */
  current(): { sessionId?: string; running: boolean };
  /** Cancel every running turn with `{ kind: "hook", reason: "shutdown" }`, end every supervision and wait for
   * the records already under way. Once: a second call settles with the first. Afterwards a post refuses and a
   * renew rejects. Never rejects. */
  dispose(): Promise<void>;
}

/* ---------- what a conversation loads on first use ---------- */

/** src/desk-session.ts and dsh-llm's `createUserMessage`, as a conversation uses them. */
interface Machinery {
  session: typeof import("./desk-session.ts");
  createUserMessage: (typeof import("@deepseek-ai/dsh-llm"))["createUserMessage"];
}

let machinery: Promise<Machinery> | undefined;

/** The machinery, imported on the first call and shared after it (see the module header's MODULE WEIGHT). */
function loadMachinery(): Promise<Machinery> {
  machinery ??= Promise.all([import("./desk-session.ts"), import("@deepseek-ai/dsh-llm")])
    .then(([session, llm]) => ({ session, createUserMessage: llm.createUserMessage }));
  return machinery;
}

/* ---------- the lines ---------- */

/** The phone's line for a post the pause refused, each time as the desk shows one (src/desk.ts `deskTime`). */
function pausedLine(state: OffState, now: Date): string {
  const until = state.until === undefined ? "" : ` until ${deskTime(new Date(state.until), now)}`;
  return `paused since ${deskTime(new Date(state.setAt), now)} by ${state.by}${until}; a terminal resumes it: npm run desk -- resume`;
}

/** The phone's line for a turn its deadline cut before it said anything: the Global Constraints' "5 min" for
 * the default deadline, whole or fractional seconds for any other. */
function timedOutLine(deadlineMs: number): string {
  const after = deadlineMs === 300_000 ? "5 min" : `${deadlineMs / 1000} s`;
  return `timed out after ${after}; a card or a long tool was pending`;
}

/** What a post refuses as once the conversation is disposed. */
const SHUT_DOWN = "the desk is shut down";
const failedLine = (reason: string): string => `the desk could not open a turn: ${reason}`;

/* ---------- the conversation ---------- */

/** One supervised session: its id, the agent object it was ensured as, and the supervisor's disposer. */
interface Watch {
  readonly sessionId: string;
  readonly agent: AgentLike;
  readonly unwatch: () => void;
}

/** dsh-agent's `Agent.whenIdle`, which the structural {@link AgentLike} leaves out: it resolves once the
 * agent's driver has retired - after the turn it was running and every turn its inbox held. */
type IdleAware = { whenIdle?: () => Promise<void> };

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
  /** The conversation supervised now. */
  let current: Watch | undefined;
  /** Conversations a renew left with work under way, each supervised until its agent is idle. */
  const retiring = new Set<Watch>();
  let disposed = false;
  let disposing: Promise<void> | undefined;
  const watches = (): Watch[] => [...(current === undefined ? [] : [current]), ...retiring];

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

  const record = async (r: DeskTurnRecord): Promise<void> => {
    const t = stamp();
    if (r.outcome === "refused") {
      await appendEvent(home, { t, kind: "desk-refused", reason: "fence", path: r.violation ?? JOURNAL }, { log });
      return;
    }
    await appendEvent(home, {
      t, kind: "desk-turn", sessionId: r.sessionId, source: r.source, turn: r.turn, outcome: r.outcome, wallMs: r.wallMs,
      ...(r.usage === undefined ? {} : { usage: r.usage }),
    }, { log });
  };

  const deliver = async (r: DeskTurnRecord, m: Machinery): Promise<void> => {
    const to = outlet;
    if (to === undefined || !DELIVERED.has(r.source)) return;
    const text = r.outcome === "refused"
      ? m.session.fenceRefusalLine(r.violation ?? JOURNAL)
      : r.outcome === "timed-out" && r.finalText === "" ? timedOutLine(r.deadlineMs) : r.finalText;
    if (text === "") return; // it ended on a tool: there is nothing to say
    try {
      await to.send(text);
    } catch (err) {
      log(`${BIN}: desk: the reply to turn ${r.turn} on desk session ${r.sessionId} could not be sent: ${errText(err)}`);
    }
  };

  /** The supervisor's hand at a turn's end. Synchronous, and nothing it starts can reject: an unhandled
   * rejection is a process exit in the face (main.ts `installFailLoud`). */
  const turnEnded = (r: DeskTurnRecord, m: Machinery): void => {
    const where = `turn ${r.turn} on desk session ${r.sessionId}`;
    const recorded = recording.then(() => record(r)).catch((err: unknown) => {
      log(`${BIN}: desk: ${where} could not be recorded: ${errText(err)}`);
    });
    recording = recorded;
    delivering = delivering.then(() => recorded).then(() => deliver(r, m)).catch((err: unknown) => {
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

  /** Keep `w` supervised until its agent is idle, or end it now when the agent is idle already. */
  const retire = (w: Watch): void => {
    const whenIdle = (w.agent as AgentLike & IdleAware).whenIdle;
    if (w.agent.status !== "running" || typeof whenIdle !== "function") {
      end(w);
      return;
    }
    retiring.add(w);
    const release = (): void => {
      if (retiring.delete(w)) end(w);
    };
    try {
      Promise.resolve(whenIdle.call(w.agent)).then(release, release);
    } catch {
      release();
    }
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

  /** Cancel `w`'s running turn with `cause`; whether the cancel went through. */
  const cancel = (w: Watch, cause: { kind: "hook"; reason: string }): boolean => {
    try {
      w.agent.cancel(cause);
      return true;
    } catch (err) {
      log(`${BIN}: desk: the turn on desk session ${w.sessionId} could not be cancelled: ${errText(err)}`);
      return false;
    }
  };

  /** A post that could not open its turn: one line, and the phone's. */
  const failed = (err: unknown): PostResult => {
    const line = failedLine(errText(err));
    log(`${BIN}: desk: ${line}`);
    return { refused: "error", line };
  };

  /** The pause as a post reads it: lifted when past its `until`, then read again - a pause set since stands. */
  const pause = async (): Promise<OffState | undefined> => {
    const now = (): number => clock.now();
    let off = await readOffState(home, now);
    if (off.state !== undefined && off.expired) {
      try {
        await clearOff(home, "expiry", now);
      } catch (err) {
        log(`${BIN}: desk: the expired pause could not be lifted (${errText(err)}); the desk goes on`);
      }
      off = await readOffState(home, now);
    }
    return off.state !== undefined && !off.expired ? off.state : undefined;
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
        if (disposed) return { refused: "error", line: failedLine(SHUT_DOWN) };
        try {
          const paused = await pause();
          if (paused !== undefined) return { refused: "paused", line: pausedLine(paused, new Date(clock.now())) };
          const m = await loadMachinery();
          const path = await m.session.findDeskFenceViolation(root);
          if (path !== undefined) {
            await appendEvent(home, { t: stamp(), kind: "desk-refused", reason: "fence", path }, { log });
            return { refused: "fence", path, line: m.session.fenceRefusalLine(path) };
          }
          if (disposed) return { refused: "error", line: failedLine(SHUT_DOWN) };
          const { agent, sessionId } = await ensure(false);
          if (disposed) return { refused: "error", line: failedLine(SHUT_DOWN) };
          const text = `${m.session.provenanceLine(input.source, new Date(clock.now()))}\n${input.text}`;
          const message = m.createUserMessage({ content: [{ type: "text", text }], source: input.message as MessageSource });
          agent.followup(message as unknown as MessageLike);
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
        return { sessionId };
      });
    },

    async stop(reason) {
      let stopped = false;
      for (const w of watches()) {
        if (w.agent.status === "running" && cancel(w, { kind: "hook", reason })) stopped = true;
      }
      return stopped;
    },

    setOutlet(next) {
      outlet = next;
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
        for (const w of all) {
          if (w.agent.status === "running") cancel(w, { kind: "hook", reason: "shutdown" });
          end(w);
        }
        await recording;
      })();
      return disposing;
    },
  };
}
