// face/src/desk-conversation.ts
/** The desk conversation: the one owner of the desk session (docs/superpowers/specs/2026-10-19-always-on-gravit-design.md
 * §5.3, §5.8; the plan's Global Constraints, docs/superpowers/plans/2026-10-20-desk-p1-bridge.md).
 *
 * ONE OWNER. Whatever reaches the desk session from the face goes through here: the phone's texts (the
 * Telegram bridge posts them, and is the outlet their answers go to). The watch's alert annotations do not: they run
 * in desk agents of their own (src/annotator.ts, spec §16 H1), and only their replies leave through here. It exists
 * whenever the desk is on, Telegram or not - src/desk.ts `installDesk` creates it and calls {@link
 * DeskConversation.start} - because what it does for a turn does not depend on who opened it: a turn the
 * operator opens in the browser gets the same deadline, fence check and ledger record as a phone turn.
 *
 * THE FALLBACK (one-entry plan 3). With Gravit's one conversation bound (src/desk.ts `bindRouter`), the phone's texts go
 * there - pause, fence and key, but no budget (src/conversation.ts) - and this conversation is never started: it stays
 * only the outlet and the pause's choke point ({@link DeskConversation.deliver}). The desk session answers the phone
 * only with `FACE_ROUTER=0` or a conversation that could not be installed, and only there does the budget below still
 * refuse a phone post.
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
 * on an error. An alert's turn - one the boot woke from a session an older face left queued - is answered the same
 * way, with no reply to its alert; the annotation lane has its own lines (src/annotator.ts). A browser turn's answer
 * stays in its transcript. Records keep turn order and so do deliveries, each
 * delivery after its own record and none waiting on an outlet more than a minute; nothing at a turn's end can
 * reject - a send that fails is one line.
 *
 * ONE TEXT, ONE MESSAGE (spec §16 H3). A post with a `key` - the bridge's `telegram:<update_id>` - is a message whose
 * id is that key (dsh-llm's `freezeMessage`, `createUserMessage` taking no id of a caller's), and is sent once: a
 * key already in the desk session's log, or waiting on either of its inbox's lists, opens nothing and answers
 * `duplicate`. The log is read once per session - flushed, then read to its end - and kept current from then on by
 * the root bus's `user/message` events and by the conversation's own sends. A keyed post answers `opened` only once
 * the persistence's `flush` has settled, so the bridge stores its offset past a text the session holds on disk: a
 * crash before that leaves the update for Telegram to deliver again, and the text delivered again is answered once.
 * A face with no session persistence refuses a keyed post. A post with no key is built and sent as before.
 *
 * DELIVERY (rulings P2-7, P2-19). Everything the desk sends leaves through {@link DeskConversation.deliver} - a
 * turn's answer, and in P2 and P3 a firing's text, an alert and an annotation's reply. It holds a text back while
 * the pause is in force - read, never lifted, so a delivery writes nothing - and holds it back too when the switch
 * cannot be read; with no outlet it says so; else it is the outlet's answer, a send that fails or keeps the outlet
 * past a minute being one line and an `undelivered` reason, a send the account held back an `undelivered` reason and
 * no line. Every send names its kind (src/phone.ts): a phone turn's answer goes as `chat` to the network the text came
 * from (the turn's message's `network`), a cut phone turn's line as `chat` with no network, an alert turn's as `alert`, a wake's as `report`; other callers name their own.
 *
 * AFTER A RESTART (spec §16 H3). When `start`'s ensure resumed a cold desk session - the face came back up - two things
 * the restart left are dealt with, and only then. A phone turn it cut - the log's last turn, never ended or closed
 * `interrupted` by the resume (src/desk-session.ts `cutPhoneTurn`) - is a `desk-turn` cancelled by `restart`, wall time
 * 0, and one line through {@link DeskConversation.deliver}'s path, so a pause holds it: `a restart cut your message of
 * <time> before it was answered; send it again`; once per session and turn, a `desk-turn` the ledger already holds for
 * it doing neither again. Then the phone texts and alerts still queued are woken (src/desk-session.ts
 * `requeuePending`): a resumed agent sits idle beside its rebuilt inbox - after the instruction-chain fence, as before a
 * post: a violation is a `desk-refused` event and leaves them queued, as does a check that fails (one line), for the
 * next post, which the fence refuses first. The log is read before the requeue, so a turn the requeue opens is never
 * taken for a cut one.
 *
 * WHAT A GRACEFUL STOP CARRIED (spec §16 H3, R93). dsh's teardown clears the desk session's inbox whatever the desk's
 * own cancel keeps, and on dsh 0.2.1 closes the turn it aborts as `disposed` (measured on a real tree,
 * .superpowers/sdd/2026-11-02-desk-hardening/graceful-stop-measurement.md), so a graceful stop carries the phone's part
 * through the ledger instead: {@link DeskConversation.dispose} reads one `desk-carry` in the same tick as it cancels, and
 * `start` answers every one no `desk-carried` names, oldest first - whether its ensure resumed the session or created
 * one, and only past the boot's fence check: a violation, or a check that fails, carries nothing and leaves the records
 * for a later boot; a malformed one is skipped with one line. Each carried text is posted again as a phone's keyed post
 * is, in order and without the desk state, its provenance line saying `(carried over a restart)` after the time it was
 * written: a key the session already holds is skipped (ONE TEXT, ONE MESSAGE), and a post refused - the pause, the
 * budget - stops the carrying, with one line, leaving that carry and every later one for a later boot. Then the turn
 * the stop cut gets the restart line, unless this boot already sent it or the boot's own cut above already answered
 * that session and turn (a `desk-turn` cancelled by `restart`); then a `desk-carried` names the carry and what it
 * posted and skipped. A turn a carry names is no cut to src/desk-session.ts `cutPhoneTurn` when dsh closed it
 * `disposed`, so it gets one line.
 *
 * A CUT CUTS ONE TURN. The phone's `/stop` ({@link DeskConversation.stop}), like the deadline, cancels the turn
 * under way and only it: the messages queued behind it are kept and answered, each in its own turn
 * (src/desk-session.ts `cancelKeepingQueue`). A shutdown keeps nothing: the ledger's `desk-carry` does.
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
 * SHUTDOWN ({@link DeskConversation.dispose}). First the phone's part, from every supervised agent - the
 * conversation's and any it retired: each phone text dsh has claimed for its open turn and not yet logged (dsh-agent's
 * `agent/inbox/claimed`, heard through `onClaimed`), then each waiting on its inbox's two lists, at most {@link CARRY_MAX} of them
 * and each cut at {@link CARRY_TEXT_MAX} characters, and the phone turn under way - is one `desk-carry` in the ledger,
 * when there is any - read in the same tick as every turn under way is cancelled as `shutdown`, the inbox with it, so
 * no turn claims a queued text between the two. The carry's write and the cut agents going idle, so the cut turns are
 * recorded, share two seconds; a failure is one line. Then every supervision
 * ends, a start, post or renew under way gets five seconds to settle, and the records under way are waited for - so
 * nothing the conversation writes lands after the ledger's `shutdown`, which src/desk.ts appends once this has settled.
 *
 * MODULE WEIGHT. src/desk.ts imports this module, and `npm run desk` and scripts/service.ts import src/desk.ts.
 * src/desk-session.ts brings src/desk-preset.ts (src/roles.ts, src/bots.ts, js-yaml) and dsh-agent with it,
 * and dsh-llm brings cordis. So this module imports nothing but types: src/desk.ts, src/desk-session.ts, src/watch.ts
 * (its `cutAt`) and dsh-llm load on a conversation's first use ({@link loadMachinery}). The pause switch loads no more than it
 * did, and the cycle with src/desk.ts has no value edge.
 * @module
 */
import type { MessageSource } from "@deepseek-ai/dsh-llm";
import type { BudgetState, DeskEvent, OffState } from "./desk.ts";
import type {
  DeskClock, DeskSessionCtxLike, DeskSessionDeps, DeskSource, DeskStateMessageSource, DeskSupervision, DeskTurnRecord, SessionEventsOn,
} from "./desk-session.ts";
import type { PhoneKind } from "./phone.ts";
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
/** The line a phone reply's context opens with, in its own part of the message (spec §16 H1b). */
export const CONTEXT_HEAD = "the message this replies to:";
/** The longest a delivery waits on the outlet before the next one goes ahead. */
const DELIVERY_MS = 60_000;
/** How long {@link DeskConversation.dispose} gives an agent it cancelled to go idle, so the cut turn is recorded. */
const SHUTDOWN_IDLE_MS = 2_000;
/** How long {@link DeskConversation.dispose} gives a start, post or renew under way to settle. */
const SHUTDOWN_QUEUE_MS = 5_000;
/** The most phone texts one `desk-carry` holds, oldest first; and the longest each is, in characters. The
 * conversation's carry (src/conversation.ts) holds as many. */
export const CARRY_MAX = 20;
export const CARRY_TEXT_MAX = 4_000;
/** How many phone texts' `at` the conversation remembers by key, newest kept, for a `desk-carry` to name. */
const AT_KEPT = 200;

/** The sources whose answers go to the outlet, each with the kind it is sent as (src/phone.ts): the phone's as `chat`, back
 * to the network the message that named the turn came through ({@link deliverOptsOf}); an alert's (one a resumed session
 * still held) as `alert`; a wake's as `report`. A `user` turn is the operator at the browser, answered in its own
 * transcript. */
const DELIVERED: ReadonlyMap<string, DeliverOpts> = new Map<string, DeliverOpts>([
  ["telegram", { kind: "chat" }],
  ["alert", { kind: "alert" }],
  ["wake", { kind: "report" }],
]);
/** The networks a phone text comes through (src/phone.ts `PHONE_NETWORKS`; this module imports types alone). */
const PHONE_NETWORKS: ReadonlySet<string> = new Set(["telegram", "slack"]);
/** How a line answering a phone text the desk cut goes: `chat` with no network - no message names it here - which the
 * account sends to every network the Chat row ticks (plan B2, ruling 12). */
const PHONE_LINE: DeliverOpts = { kind: "chat" };

/** How turn `r`'s answer goes: its source's {@link DELIVERED} kind, and for a phone turn the network of the message that
 * named it (`r.message.network`) when it is one of {@link PHONE_NETWORKS} - else none, as a cut turn's line goes; an
 * older face's record names no network. `undefined` for a source the outlet does not answer. */
function deliverOptsOf(r: Pick<DeskTurnRecord, "source" | "message">): DeliverOpts | undefined {
  const opts = DELIVERED.get(r.source);
  if (opts === undefined || r.source !== "telegram") return opts;
  const network = r.message?.network;
  return typeof network === "string" && PHONE_NETWORKS.has(network) ? { ...opts, network } : opts;
}

/** The journal, repo-relative: what a refused turn names when its record carries no violation (the supervisor
 * always gives one; this is the fail-closed reading of a record that did not). */
const JOURNAL = "desk/journal";

/** How a desk text is sent: its `kind` (src/phone.ts - the account routes by it, so each caller names its own), the
 * message it replies to (`<network>:<id>`), and for a `chat` reply the network the operator's text came from. */
export type DeliverOpts = { kind: PhoneKind; replyTo?: string; network?: string };

/** Where a turn's answer goes when it should leave the face: the phone bridge. `send` resolves the ids of the messages
 * it sent, each `<network>:<id>` - with `queued: true` when some of it waits to go - `{ queued: true }` when all of it
 * does, or `{ held: <reason> }` when the account kept it back (`quiet hours`, `not routed`, `nothing connected`). */
export interface DeskOutlet {
  send(text: string, opts: DeliverOpts): Promise<{ sent: string[]; queued?: true } | { queued: true } | { held: string }>;
}

/** What {@link DeskConversation.deliver} answers: the outlet's answer, or why the text did not reach it - `paused`,
 * `no phone`, the account's hold (`quiet hours`, `not routed`, `nothing connected`), `send failed: <reason>`,
 * `the outlet did not answer in 60 s`, `the pause could not be read: <reason>`, or `the desk could not load: <reason>`. */
export type DeliverResult = { sent: string[]; queued?: true } | { queued: true } | { undelivered: string };

/** A text from the phone as the bridge posts it (src/phone-bridge.ts): the operator's `text`, the provenance `source`, the
 * logged `message` source (`<network>:<id>`), its delivery `key` - the message's id - and, for a reply to an alert or its
 * annotation, the `context`. The desk conversation's {@link DeskConversation.post} takes it, and so does the router
 * conversation's (src/conversation.ts `ConversationHandle.post`). */
export type PhonePost = {
  text: string;
  source: { kind: "telegram"; network?: string; at?: number; carried?: true };
  message: { kind: "telegram"; network: string; messageId: string };
  key: string;
  context?: string;
};

/** A phone message's content: one text part, the provenance line then `text`; or, with `context` (spec §16 H1b), three -
 * the provenance line, the context headed {@link CONTEXT_HEAD}, then `text`. */
export function phoneContent(provenance: string, text: string, context?: string): { type: "text"; text: string }[] {
  return context === undefined
    ? [{ type: "text", text: `${provenance}\n${text}` }]
    : [
      { type: "text", text: provenance },
      { type: "text", text: `${CONTEXT_HEAD}\n${context}` },
      { type: "text", text },
    ];
}

/** The pause as a post reads it: an `OFF` past its `until` is lifted (a failure to lift is one line, and the post goes
 * on), then the switch is read again - a pause set since stands. The one in force, or `undefined`. Rejects when the
 * switch cannot be read: a post fails closed. `desk` is src/desk.ts, loaded by the caller.
 * @param desk - src/desk.ts's `readOffState` and `clearOff`.
 * @param home - the harness home, the switch's.
 * @param now - the clock.
 * @param log - where the line goes. */
export async function pauseInForce(
  desk: { readOffState: (typeof import("./desk.ts"))["readOffState"]; clearOff: (typeof import("./desk.ts"))["clearOff"] },
  home: string,
  now: () => number,
  log: (line: string) => void,
): Promise<OffState | undefined> {
  let off = await desk.readOffState(home, now);
  if (off.state !== undefined && off.expired) {
    try {
      await desk.clearOff(home, "expiry", now);
    } catch (err) {
      log(`${BIN}: desk: the expired pause could not be lifted (${errText(err)}); the desk goes on`);
    }
    off = await desk.readOffState(home, now);
  }
  return off.state !== undefined && !off.expired ? off.state : undefined;
}

/** What {@link DeskConversation.post} answers: the turn opened on `sessionId` - `duplicate` when its key was already
 * there, and nothing was sent - or why not, with the line the phone gets. */
export type PostResult =
  | { opened: true; sessionId: string; duplicate?: true }
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
 * which `deadlineFor` may only shorten for a source; `budget`, the day's token budget, read by
 * each post the pause lets through (src/desk.ts `readBudget` over the standing orders' cap) - no budget, no
 * check; `clock`, the timers and the stamps (the global ones); `log`, where a failure line goes (stderr);
 * `onClaimed`, dsh-agent's `agent/inbox/claimed` on the root context ({@link ClaimsOn}) - without it a text dsh has
 * claimed for a turn but not yet logged is not seen by a shutdown's carry. */
export interface DeskConversationDeps {
  session: DeskSessionDeps;
  on: SessionEventsOn;
  deadlineMs?: number;
  deadlineFor?: (kind: string) => number | undefined;
  budget?: () => Promise<BudgetState>;
  clock?: DeskClock;
  log?: (line: string) => void;
  onClaimed?: ClaimsOn;
}

/** dsh-agent's `agent/inbox/claimed` (runtime-types.d.ts: `{ agent, message, turn }`, emitted as dsh-agent-loop's
 * `preStep` claims a step's input from the inbox - before the turn logs it as `user/message`), subscribed on the root
 * context, which hears every agent's; it answers the unsubscriber. */
export type ClaimsOn = (listener: (payload: { agent: { id?: unknown }; message: MessageLike; turn: number }) => void) => () => void;

/** The desk session's one owner. See the module header; each member's own comment says what it does. */
export interface DeskConversation {
  /** Ensure the desk session and supervise it, so a turn opened from the browser is supervised before any
   * post; when the ensure resumed a cold session, deal with what a restart left in it (the module header's AFTER A
   * RESTART), and answer what a graceful stop carried through the ledger (WHAT A GRACEFUL STOP CARRIED). Never
   * rejects: a failure is one line, and the next post tries again. */
  start(): Promise<void>;
  /** Open a turn: `text` after the provenance line for `source`, sent with `message` as its source - or the
   * reason it was not, as {@link PostResult}. `replyTo` is the annotation lane's (src/annotator.ts, which shares this
   * signature): the conversation answers no turn as a reply. A phone's (`source.kind` `telegram`) carries the desk state
   * ahead of it when one is ready and nothing is under way. With `key`, the message's id is the key, a key the
   * session already holds answers `duplicate`, and the post answers once the session's log is flushed (the module
   * header's ONE TEXT, ONE MESSAGE). With `context` - the bridge's, for a phone reply to an alert or its annotation
   * (spec §16 H1b, src/watch.ts `contextFor`) - the message is three text parts: the provenance line, the context
   * headed `the message this replies to:`, then `text`. `urgent` is the annotation lane's too: its reply goes `urgent`
   * rather than `alert`; the conversation ignores it. Never rejects. */
  post(input: {
    text: string; source: DeskSource; message: { kind: string } & Record<string, unknown>; replyTo?: string; key?: string; context?: string; urgent?: boolean;
  }): Promise<PostResult>;
  /** Open another desk conversation (the phone's `/new`), recorded as `new`, and supervise it; resolves its id.
   * Rejects when the ensure does, and when the conversation is disposed before or while it runs. */
  renew(): Promise<{ sessionId: string }>;
  /** Cancel the work under way - on the current conversation and on any it retired - with `{ kind: "hook",
   * reason }`, and only it: the messages queued behind it are kept and answered, each in its own turn
   * (src/desk-session.ts `cancelKeepingQueue`); `true` when there was some, `false` when nothing was under way. */
  stop(reason: string): Promise<boolean>;
  /** Send `text` to the outlet as `opts.kind` - the first part as a reply to `opts.replyTo` when given - and answer
   * what the outlet answered, or why the text did not reach it ({@link DeliverResult}): `paused` while the pause is in
   * force (a pause past its `until` is not; the switch is read, never lifted, and a switch that cannot be read holds
   * the text back too, with one line), `no phone` with no outlet, the account's reason, with no line, for a send it
   * held back (`{ held }` becomes `{ undelivered: <reason> }`), `send failed: <reason>` with one line
   * when the send throws or rejects, and, with one line, an outlet that has not answered in a minute. The way
   * every desk text leaves the face - each turn's answer, a firing's, an alert, an annotation's. Never rejects. */
  deliver(text: string, opts: DeliverOpts): Promise<DeliverResult>;
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

/** src/desk.ts, src/desk-session.ts, src/watch.ts's `cutAt` and dsh-llm's `createUserMessage`, `freezeMessage` and
 * `MessageId`, as a conversation uses them. */
interface Machinery {
  desk: typeof import("./desk.ts");
  session: typeof import("./desk-session.ts");
  cutAt: (typeof import("./watch.ts"))["cutAt"];
  createUserMessage: (typeof import("@deepseek-ai/dsh-llm"))["createUserMessage"];
  freezeMessage: (typeof import("@deepseek-ai/dsh-llm"))["freezeMessage"];
  MessageId: (typeof import("@deepseek-ai/dsh-llm"))["MessageId"];
}

let machinery: Promise<Machinery> | undefined;

/** The machinery, imported on the first call and shared after it (see the module header's MODULE WEIGHT). */
function loadMachinery(): Promise<Machinery> {
  machinery ??= Promise.all([import("./desk.ts"), import("./desk-session.ts"), import("./watch.ts"), import("@deepseek-ai/dsh-llm")])
    .then(([desk, session, watch, llm]) => ({
      desk, session, cutAt: watch.cutAt, createUserMessage: llm.createUserMessage, freezeMessage: llm.freezeMessage, MessageId: llm.MessageId,
    }));
  return machinery;
}

/* ---------- the lines ---------- */

/** The phone's line for a post the pause refused, each time as the desk shows one (src/desk.ts `deskTime`) - the
 * conversation's and the annotation lane's (src/annotator.ts). */
export function pausedLine(state: OffState, now: Date, deskTime: (at: Date, now: Date) => string): string {
  const until = state.until === undefined ? "" : ` until ${deskTime(new Date(state.until), now)}`;
  return `paused since ${deskTime(new Date(state.setAt), now)} by ${state.by}${until}; a terminal resumes it: npm run desk -- resume`;
}

/** The phone's line for a turn its deadline cut before it said anything, the deadline as `format` spells it -
 * desk-session.ts's `formatDuration`: the default `5 min`, an annotation's `4 min` - the conversation's and the
 * annotation lane's (src/annotator.ts). */
export function timedOutLine(deadlineMs: number, format: (ms: number) => string): string {
  return `timed out after ${format(deadlineMs)}; a card or a long tool was pending`;
}

/** The phone's line for a turn that ended on an error before it said anything. */
const notAnsweredLine = (error: string): string => `the desk could not answer: ${error}; nothing was done - send it again later`;

/** What a post refuses as once the conversation is disposed. */
const SHUT_DOWN = "the desk is shut down";
const notOpenedLine = (reason: string): string => `the desk could not open a turn: ${reason}`;
/** Why a keyed post refuses on a face with no session persistence. */
const NO_PERSISTENCE = "this face has no session persistence, so a phone text cannot be checked against the desk session's log";

/** The lines {@link replyOf} is written with: src/desk-session.ts's three - the refusal line of the fence that cut the
 * turn, the cut line, and the duration's spelling - and, optionally, the line for a turn that failed before it said
 * anything (the desk's own when absent). The desk passes the module itself; the router conversation
 * (src/conversation.ts) its own refusal and failure lines beside the other two. */
export type ReplyLines = {
  fenceRefusalLine(path: string): string;
  cutOffLine(r: DeskTurnRecord): string;
  formatDuration(ms: number): string;
  notAnsweredLine?(error: string): string;
};

/** What a turn's end sends: the refusal line for a refused turn (at `fallbackPath`, the journal by default, when the
 * record names no violation); else its final text - with a line naming the cut
 * when a cut interrupted it mid-stream; else why it said nothing - cut by its deadline, or failed - and `""`,
 * nothing to send, for one that just ended on a tool or was cancelled before it said anything (the phone's `/stop`
 * is answered by the bridge, a shutdown by nobody). The desk's and the router conversation's (src/conversation.ts). */
export function replyOf(r: DeskTurnRecord, lines: ReplyLines, fallbackPath: string = JOURNAL): string {
  if (r.outcome === "refused") return lines.fenceRefusalLine(r.violation ?? fallbackPath);
  if (r.finalText !== "") return r.interrupted === true ? `${r.finalText}\n${lines.cutOffLine(r)}` : r.finalText;
  if (r.outcome === "timed-out") return timedOutLine(r.deadlineMs, lines.formatDuration);
  if (r.outcome === "failed") return (lines.notAnsweredLine ?? notAnsweredLine)(r.error ?? "error");
  return "";
}

/* ---------- agents at rest ---------- */

/** dsh-agent's `Agent.inject`, which the structural {@link AgentLike} leaves out: context queued for the next
 * pre-step without waking the driver, so the followup that wakes it claims both. */
type Injecting = { inject?: (message: MessageLike) => void };
/** dsh-agent's `Agent.inbox`, the calls the desk needs: its two lists - the next turn's and the next step's - and
 * removing a pending message, from either list, by id. */
type InboxAware = { inbox?: { readonly nextTurn?: readonly MessageLike[]; readonly nextStep?: readonly MessageLike[]; remove(id: string): boolean } };

/** Whether `agent`'s inbox holds a message with id `id` on either list. */
export function waiting(agent: AgentLike, id: string): boolean {
  const inbox = (agent as AgentLike & InboxAware).inbox;
  return [...(inbox?.nextTurn ?? []), ...(inbox?.nextStep ?? [])].some((message) => message.id === id);
}

/** The id of the message a `user/message` event logs, when it has one. */
export function loggedId(event: EventLike): string | undefined {
  if (event.type !== "user/message" || event.data === null || typeof event.data !== "object") return undefined;
  const id = (event.data as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

/** The operator's own words in a phone message the conversation built: the last of a reply's three parts, else its one
 * part after the provenance line. */
export function operatorText(message: MessageLike): string {
  const parts = (message.content ?? []).flatMap((part) => (typeof part?.text === "string" ? [part.text] : []));
  if (parts.length > 1) return parts[parts.length - 1];
  const only = parts[0] ?? "";
  const nl = only.indexOf("\n");
  return nl < 0 ? only : only.slice(nl + 1);
}

/** A `desk-carry`'s two halves, as a dispose collects them. */
type Carried = {
  queued: { key: string; text: string; at?: string }[];
  cut?: { sessionId: string; turn: number; key?: string; at?: string };
};

/** A `desk-carry` as the ledger holds one. */
export type Carry = Extract<DeskEvent, { kind: "desk-carry" }>;

/** Whether a ledger line of kind `desk-carry` has the shape a dispose writes: a session id, `queued` an array of
 * string keys and texts with an optional string `at`, and `cut`, when present, an object with a numeric turn. */
function isCarry(e: DeskEvent): e is Carry {
  const x = e as { t?: unknown; sessionId?: unknown; queued?: unknown; cut?: unknown };
  const optString = (v: unknown): boolean => v === undefined || typeof v === "string";
  if (typeof x.t !== "string" || typeof x.sessionId !== "string" || !Array.isArray(x.queued)) return false;
  const textsOk = x.queued.every((q: unknown) => {
    const y = q as { key?: unknown; text?: unknown; at?: unknown } | null;
    return typeof y === "object" && y !== null && typeof y.key === "string" && typeof y.text === "string" && optString(y.at);
  });
  if (!textsOk) return false;
  if (x.cut === undefined) return true;
  const c = x.cut as { turn?: unknown; key?: unknown; at?: unknown } | null;
  return typeof c === "object" && c !== null && typeof c.turn === "number" && Number.isFinite(c.turn) && optString(c.key) && optString(c.at);
}

/** Every `desk-carry` in `events` that no `desk-carried` names after it, oldest first - a malformed one skipped, with
 * one line: the ledger's reader checks only `t` and `kind`, and a hand-edited line must never stop the boot. The desk's
 * start and the conversation's boot (src/conversation.ts) both answer them.
 * @param events - the ledger's events, in order.
 * @param log - where the line goes.
 * @param who - the line's prefix after the face's name (`desk`, `conversation`). */
export function pendingCarries(events: readonly DeskEvent[], log: (line: string) => void, who = "desk"): Carry[] {
  const pending: Carry[] = [];
  events.forEach((e, i) => {
    if (e.kind !== "desk-carry") return;
    if (events.slice(i + 1).some((later) => later.kind === "desk-carried" && later.of === e.t)) return;
    if (!isCarry(e)) {
      log(`${BIN}: ${who}: the desk-carry of ${String((e as { t?: unknown }).t)} in the ledger is malformed and is skipped`);
      return;
    }
    pending.push(e);
  });
  return pending;
}

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

/** One supervised session: its id, the agent object it was ensured as, and the supervisor's disposer, which also says
 * which turn it has open (src/desk-session.ts `DeskSupervision`). */
interface Watch {
  readonly sessionId: string;
  readonly agent: AgentLike;
  readonly unwatch: DeskSupervision;
}

/** How a promise settled within a bound: `ok` with its value, `failed` with its error, or `late` - left to settle
 * alone. */
type Within<T> = { kind: "ok"; value: T } | { kind: "failed"; error: unknown } | { kind: "late" };

/** What the outlet answers a send. */
type OutletResult = Awaited<ReturnType<DeskOutlet["send"]>>;

/**
 * The desk session's one owner. Nothing runs until a member is called: src/desk.ts `installDesk` calls
 * {@link DeskConversation.start} once the Telegram bridge has set the outlet, without awaiting it.
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
  /** The conversation supervised now. */
  let current: Watch | undefined;
  /** Conversations a renew left with work under way, each supervised until its agent is idle. */
  const retiring = new Set<Watch>();
  let disposed = false;
  let disposing: Promise<void> | undefined;
  /** Each desk session's message ids, by session id: its log's, read once, and every `user/message` since. */
  const seen = new Map<string, { ids: Set<string>; loaded?: Promise<void> }>();
  /** The bus listener that keeps {@link seen} current, from the first keyed post to dispose. */
  let unhear: (() => void) | undefined;
  /** When the operator wrote each keyed phone text this conversation sent, by key - the newest {@link AT_KEPT} - for a
   * `desk-carry` to name: the message itself keeps it only in its provenance line. */
  const atOf = new Map<string, number>();
  /** The cut turns this conversation has sent the restart line for, as `<sessionId> <turn>`: a cut a carry names and the
   * boot's own cut found get one line between them, even when the ledger record that says so could not be written. */
  const lined = new Set<string>();
  /** The phone messages dsh claimed for each agent's latest turn, by agent id: what a turn holds before it logs it. */
  const claims = new Map<string, { turn: number; messages: MessageLike[] }>();
  let unclaim: (() => void) | undefined;
  /** Hear dsh's claims from the first supervision on, until dispose has taken its carry. */
  const hearClaims = (): void => {
    if (unclaim !== undefined || deps.onClaimed === undefined || disposed) return;
    try {
      unclaim = deps.onClaimed(({ agent, message, turn }) => {
        if (message?.source?.kind !== "telegram" || typeof agent?.id !== "string") return;
        const entry = claims.get(agent.id);
        if (entry === undefined || entry.turn !== turn) claims.set(agent.id, { turn, messages: [message] });
        else entry.messages.push(message);
      });
    } catch (err) {
      log(`${BIN}: desk: dsh's inbox claims could not be heard (${errText(err)}); a text claimed but not yet logged at a shutdown is not carried`);
    }
  };
  const rememberAt = (key: string, at: number): void => {
    atOf.delete(key);
    atOf.set(key, at);
    if (atOf.size > AT_KEPT) atOf.delete(atOf.keys().next().value as string);
  };
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
  const sendOut = async (text: string, opts: DeliverOpts, unsent: string, lateTail: string): Promise<DeliverResult> => {
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
    if (to === undefined) return { undelivered: "no phone" };
    let sending: Promise<OutletResult>;
    try {
      sending = Promise.resolve(to.send(text, opts));
    } catch (err) {
      log(`${unsent}: ${errText(err)}`);
      return { undelivered: `send failed: ${errText(err)}` };
    }
    const sent = await within(DELIVERY_MS, sending);
    if (sent.kind === "ok") return "held" in sent.value ? { undelivered: sent.value.held } : sent.value;
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
  const deliverTurn = async (r: DeskTurnRecord, m: Machinery): Promise<void> => {
    const opts = deliverOptsOf(r);
    if (opts === undefined) return;
    const text = replyOf(r, m.session);
    if (text === "") return; // it ended on a tool: there is nothing to say
    await sendOut(text, opts,
      `${BIN}: desk: the reply to turn ${r.turn} on desk session ${r.sessionId} could not be sent`, "; the next reply goes ahead");
  };

  /** The supervisor's hand at a turn's end. Synchronous, and nothing it starts can reject: an unhandled
   * rejection is a process exit in the face (main.ts `installFailLoud`). */
  const turnEnded = (r: DeskTurnRecord, m: Machinery): void => {
    const where = `turn ${r.turn} on desk session ${r.sessionId}`;
    const recorded = recording.then(() => record(r, m)).catch((err: unknown) => {
      log(`${BIN}: desk: ${where} could not be recorded: ${errText(err)}`);
    });
    recording = recorded;
    delivering = delivering.then(() => recorded).then(() => deliverTurn(r, m)).catch((err: unknown) => {
      log(`${BIN}: desk: ${where} could not be delivered: ${errText(err)}`);
    });
  };

  const supervise = (sessionId: string, agent: AgentLike, m: Machinery): Watch => (hearClaims(), {
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

  /** The desk session, ensured, and supervised unless the conversation is disposed by then; `resumed` when the ensure
   * resumed a cold one. */
  const ensure = async (fresh: boolean): Promise<{ agent: AgentLike; sessionId: string; resumed?: true }> => {
    const m = await loadMachinery();
    const { agent, sessionId, resumed } = await m.session.ensureDeskSession(deps.session, fresh ? { fresh: true } : {});
    if (!disposed) watch(sessionId, agent, m);
    return { agent, sessionId, ...(resumed === undefined ? {} : { resumed }) };
  };

  /** What the boot found in the desk session `sessionId`, just ensured as `agent` (the module header's AFTER A RESTART
   * and WHAT A GRACEFUL STOP CARRIED): when the ensure resumed it, the phone turn a restart cut, recorded and answered
   * once; then, past the fence, the texts and alerts still queued, woken, and every carry no boot has answered, oldest
   * first, posted again. Never rejects. */
  const afterBoot = async (agent: AgentLike, sessionId: string, resumed: boolean, m: Machinery): Promise<void> => {
    let ledger: DeskEvent[] | undefined;
    try {
      ledger = (await m.desk.readEvents(home)).events;
    } catch (err) {
      log(`${BIN}: desk: the ledger could not be read at boot (${errText(err)}); what a graceful stop carried waits for a later boot`);
    }
    const carries = ledger === undefined ? [] : pendingCarries(ledger, log);
    if (!resumed && carries.length === 0) return;
    if (resumed) {
      /* the turns a carry names on this session: their line is the carry's, when dsh closed them `disposed` */
      const named = new Set((ledger ?? []).flatMap((e) => {
        const cut = e.kind === "desk-carry" && e.sessionId === sessionId ? (e.cut as { turn?: unknown } | null | undefined) : undefined;
        return typeof cut?.turn === "number" ? [cut.turn] : [];
      }));
      /* the log as the restart left it, read before anything is woken: a turn the requeue opens is no cut */
      let cut: { turn: number; at: string } | undefined;
      try {
        await deps.session.ctx.sessionPersistence?.flush();
        cut = m.session.cutPhoneTurn(await m.session.readSessionEvents(deps.session.ctx, sessionId), named);
      } catch (err) {
        log(`${BIN}: desk: desk session ${sessionId}'s log could not be read (${errText(err)}); a phone turn a restart cut there goes unanswered`);
      }
      if (cut !== undefined) await answerCut(sessionId, cut, m);
    }
    /* the fence first, as before a post: a woken or carried text opens a turn at once, before that turn's own check has run */
    let violation: string | undefined;
    try {
      violation = await m.session.findDeskFenceViolation(root);
    } catch (err) {
      log(`${BIN}: desk: the fence check before waking what desk session ${sessionId} still had queued failed (${errText(err)}); it stays queued`);
      return;
    }
    if (violation !== undefined) {
      await m.desk.appendEvent(home, { t: stamp(), kind: "desk-refused", reason: "fence", path: violation }, { log });
      return;
    }
    if (disposed) return; // a shutdown begun during the fence check: nothing woken, nothing carried
    if (resumed) m.session.requeuePending(agent, log);
    /* oldest first; a carry stopped by a refusal holds back every later one, for a later boot */
    for (const carry of carries) {
      if (disposed) return;
      let done: boolean;
      try {
        done = await carryOver(carry, m);
      } catch (err) {
        log(`${BIN}: desk: the desk-carry of ${carry.t} could not be answered (${errText(err)}); a later boot tries again`);
        return;
      }
      if (!done) return;
    }
  };

  /** A carry, answered (the module header's WHAT A GRACEFUL STOP CARRIED): each text posted again, in order; then the
   * cut turn's line, unless this boot or the boot's cut already sent it; then the `desk-carried`. `true` once it is
   * recorded; `false`, with one line, when a post was refused or the ledger could not be read, and the carry waits for
   * a later boot. */
  const carryOver = async (carry: Carry, m: Machinery): Promise<boolean> => {
    let posted = 0;
    let skipped = 0;
    for (const text of carry.queued) {
      const at = text.at === undefined ? NaN : Date.parse(text.at);
      /* the key opens with the text's wire id (src/phone-bridge.ts `deliveryKey`): its network, when it is one */
      const prefix = text.key.slice(0, Math.max(0, text.key.indexOf(":")));
      const network = PHONE_NETWORKS.has(prefix) ? { network: prefix } : {};
      const result = await postNow({
        text: text.text, key: text.key,
        source: { kind: "telegram", ...network, ...(Number.isFinite(at) ? { at } : {}), carried: true },
        message: { kind: "telegram", ...network, carried: true },
      });
      if ("refused" in result) {
        log(`${BIN}: desk: the texts a graceful stop carried could not all be posted again (${result.line}); a later boot tries again`);
        return false;
      }
      if (result.duplicate === true) skipped += 1;
      else posted += 1;
    }
    const cut = carry.cut;
    if (cut !== undefined) {
      const where = `turn ${cut.turn} on desk session ${carry.sessionId}`;
      let answered = lined.has(`${carry.sessionId} ${cut.turn}`);
      try {
        const { events } = await m.desk.readEvents(home);
        answered ||= events.some((e) => e.kind === "desk-turn" && e.sessionId === carry.sessionId && e.turn === cut.turn && e.cancel === "restart");
      } catch (err) {
        log(`${BIN}: desk: the ledger could not be read for ${where}, which a graceful stop cut (${errText(err)}); a later boot tries again`);
        return false;
      }
      if (!answered) {
        lined.add(`${carry.sessionId} ${cut.turn}`);
        const at = [cut.at, carry.t].map((x) => (x === undefined ? NaN : Date.parse(x))).find(Number.isFinite) ?? clock.now();
        sendLine(m.session.cutPhoneTurnLine(new Date(at), new Date(clock.now())), `${where}, which a graceful stop cut`);
      }
    }
    await m.desk.appendEvent(home, { t: stamp(), kind: "desk-carried", of: carry.t, posted, skipped }, { log });
    return true;
  };

  /** `line` through {@link sendOut}, after the deliveries already under way; its failure lines name `what`. */
  const sendLine = (line: string, what: string): void => {
    delivering = delivering.then(async () => {
      await sendOut(line, PHONE_LINE, `${BIN}: desk: the line for ${what} could not be sent`, "; the next reply goes ahead");
    }).catch((err: unknown) => {
      log(`${BIN}: desk: the line for ${what} could not be delivered: ${errText(err)}`);
    });
  };

  /** A phone turn a restart cut: a `desk-turn` cancelled by `restart`, then its line through {@link sendOut} after the
   * deliveries already under way - once per session and turn, the ledger saying whether it was done. Never rejects. */
  const answerCut = async (sessionId: string, cut: { turn: number; at: string }, m: Machinery): Promise<void> => {
    const where = `turn ${cut.turn} on desk session ${sessionId}`;
    try {
      const { events } = await m.desk.readEvents(home);
      if (events.some((e) => e.kind === "desk-turn" && e.sessionId === sessionId && e.turn === cut.turn)) return;
    } catch (err) {
      log(`${BIN}: desk: the ledger could not be read for ${where}, which a restart cut (${errText(err)}); it goes unanswered`);
      return;
    }
    await m.desk.appendEvent(home, {
      t: stamp(), kind: "desk-turn", sessionId, source: "telegram", turn: cut.turn, outcome: "cancelled", wallMs: 0, cancel: "restart",
    }, { log });
    lined.add(`${sessionId} ${cut.turn}`);
    sendLine(m.session.cutPhoneTurnLine(new Date(cut.at), new Date(clock.now())), `${where}, which a restart cut`);
  };

  /** Cancel `w`'s work under way with `cause`; whether the cancel went through. With `keep`, the phone's stop and the
   * deadline: only the turn under way, the messages queued behind it kept and answered (src/desk-session.ts
   * `cancelKeepingQueue`); without it, a shutdown: the inbox goes too - dsh's teardown would clear it anyway, and the
   * `desk-carry` written before it holds the phone's part (spec §16 H3, R93). */
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

  /** The message ids session `sessionId` holds - its log's, flushed and read on the first call for it, and those
   * logged since. The bus is heard before the log is read, so nothing logged between the two is missed; a read
   * that rejects is tried again by the next call. */
  const seenIn = async (sessionId: string, m: Machinery): Promise<Set<string>> => {
    const persistence = deps.session.ctx.sessionPersistence;
    if (persistence === undefined) throw new Error(NO_PERSISTENCE);
    unhear ??= deps.on("session/event", (session, event) => {
      const id = loggedId(event);
      if (id !== undefined) seen.get(session.id)?.ids.add(id);
    });
    let entry = seen.get(sessionId);
    if (entry === undefined) {
      entry = { ids: new Set() };
      seen.set(sessionId, entry);
    }
    const state = entry;
    state.loaded ??= (async () => {
      await persistence.flush();
      for (const event of await m.session.readSessionEvents(deps.session.ctx, sessionId)) {
        const id = loggedId(event);
        if (id !== undefined) state.ids.add(id);
      }
    })().catch((err: unknown) => {
      state.loaded = undefined;
      throw err;
    });
    await state.loaded;
    return state.ids;
  };

  /** The session logs made durable before a keyed post answers. A flush that fails is one line, and the post still
   * answers: its message is in the session, and its turn will answer unless the face goes down first. */
  const flushed = async (): Promise<void> => {
    try {
      await deps.session.ctx.sessionPersistence?.flush();
    } catch (err) {
      log(`${BIN}: desk: the desk session's log could not be flushed (${errText(err)}); a crash before the next flush may lose this text`);
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
  const pause = (m: Machinery): Promise<OffState | undefined> => pauseInForce(m.desk, home, () => clock.now(), log);

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

  /** {@link DeskConversation.post}'s work, run in its turn of the queue - or straight from `start`, which holds it. */
  const postNow = async (input: Parameters<DeskConversation["post"]>[0]): Promise<PostResult> => {
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
      const key = input.key;
      const ids = key === undefined ? undefined : await seenIn(sessionId, m);
      if (key !== undefined && (ids?.has(key) === true || waiting(agent, key))) {
        await flushed();
        return { opened: true, sessionId, duplicate: true };
      }
      if (disposed) return shutDown();
      /* a carried text goes without the state: the boot posts them one after another, and each wait would hold it */
      const state = input.source.kind === "telegram" && input.source.carried !== true ? await deskState() : undefined;
      /* the state only on an idle desk: a text queued behind a turn would find it stale, or claimed by that turn */
      const inject = state !== undefined && !(await busy(agent)) ? (agent as AgentLike & Injecting).inject : undefined;
      if (disposed) return shutDown();
      const now = new Date(clock.now());
      const provenance = m.session.provenanceLine(input.source, now);
      /* a reply's context is its own part, between the provenance line and the operator's text (spec §16 H1b) */
      const content = phoneContent(provenance, input.text, input.context);
      const source = input.message as MessageSource;
      const message = key === undefined
        ? m.createUserMessage({ content, source })
        : m.freezeMessage({ id: m.MessageId(key), role: "user" as const, content, source });
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
        if (injected !== undefined) withdraw(agent, injected);
        throw err;
      }
      if (key !== undefined) {
        ids?.add(key);
        if (input.source.kind === "telegram" && input.source.at !== undefined) rememberAt(key, input.source.at);
        await flushed();
      }
      return { opened: true, sessionId };
    } catch (err) {
      return failed(err);
    }
  };

  /** The phone's part of `all` at a shutdown - each phone text waiting on an inbox's two lists, oldest first, at most
   * {@link CARRY_MAX} and each cut at {@link CARRY_TEXT_MAX} characters, and the phone turn under way - read at once,
   * before anything is cancelled. */
  const collectCarry = (all: readonly Watch[], m: Machinery): Carried => {
    const queued: Carried["queued"] = [];
    let cut: Carried["cut"];
    let dropped = 0;
    for (const w of all) {
      const inbox = (w.agent as AgentLike & InboxAware).inbox;
      const open = w.unwatch.openTurn?.();
      /* claimed for the open turn and not yet logged: out of the inbox, and in no record yet (dsh-agent-loop preStep) */
      const claim = claims.get(w.agent.id);
      const held = open !== undefined && claim?.turn === open.turn ? claim.messages.filter((message) => !open.logged.includes(message.id)) : [];
      const seenHere = new Set<string>();
      for (const message of [...held, ...(inbox?.nextTurn ?? []), ...(inbox?.nextStep ?? [])]) {
        if (message.source?.kind !== "telegram" || seenHere.has(message.id)) continue;
        seenHere.add(message.id);
        if (queued.length >= CARRY_MAX) {
          dropped += 1;
          continue;
        }
        const at = atOf.get(message.id);
        queued.push({ key: message.id, text: m.cutAt(operatorText(message), CARRY_TEXT_MAX), ...(at === undefined ? {} : { at: new Date(at).toISOString() }) });
      }
      if (cut === undefined && open?.source === "telegram") {
        const at = (open.id === undefined ? undefined : atOf.get(open.id)) ?? open.at;
        cut = {
          sessionId: w.sessionId, turn: open.turn,
          ...(open.id === undefined ? {} : { key: open.id }),
          ...(at === undefined ? {} : { at: new Date(at).toISOString() }),
        };
      }
    }
    if (dropped > 0) log(`${BIN}: desk: ${dropped} phone text(s) queued past the first ${CARRY_MAX} are not carried over the shutdown`);
    return { queued, ...(cut === undefined ? {} : { cut }) };
  };

  /** The `desk-carry` event for what {@link collectCarry} found in `all`, or `undefined` when there is nothing to carry or
   * it could not be read - that with one line. Synchronous: the shutdown takes it and cancels in the same tick. */
  const carryEvent = (all: readonly Watch[], m: Machinery | undefined): DeskEvent | undefined => {
    if (all.length === 0 || m === undefined) return undefined;
    try {
      const { queued, cut } = collectCarry(all, m);
      if (queued.length === 0 && cut === undefined) return undefined;
      return {
        t: stamp(), kind: "desk-carry", sessionId: cut?.sessionId ?? all[0].sessionId, queued,
        ...(cut === undefined ? {} : { cut: { turn: cut.turn, ...(cut.key === undefined ? {} : { key: cut.key }), ...(cut.at === undefined ? {} : { at: cut.at }) } }),
      };
    } catch (err) {
      log(`${BIN}: desk: the phone's texts could not be carried over the shutdown: ${errText(err)}`);
      return undefined;
    }
  };

  return {
    start() {
      return serially(async () => {
        if (disposed) return;
        let opened: Awaited<ReturnType<typeof ensure>>;
        try {
          opened = await ensure(false);
        } catch (err) {
          log(`${BIN}: desk: the desk session could not be opened: ${errText(err)}; the next message tries again`);
          return;
        }
        if (!disposed) await afterBoot(opened.agent, opened.sessionId, opened.resumed === true, await loadMachinery());
      });
    },

    post(input) {
      return serially(() => postNow(input));
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
        unhear?.();
        unhear = undefined;
        const all = watches();
        current = undefined;
        retiring.clear();
        let m: Machinery | undefined;
        if (all.length > 0) {
          try {
            m = await loadMachinery();
          } catch (err) {
            log(`${BIN}: desk: the phone's texts could not be carried over the shutdown: ${errText(err)}`);
          }
        }
        const working = await Promise.all(all.map((w) => busy(w.agent)));
        /* one tick: the carry's snapshot, then the cancels - no turn can claim a queued text between the two */
        const event = carryEvent(all, m);
        const cut = all.filter((w, i) => working[i] && cancel(w, { kind: "hook", reason: "shutdown" }));
        unclaim?.();
        unclaim = undefined;
        claims.clear();
        /* the carry's write and the cut agents' unwinding share the one bound */
        let wrote = event === undefined;
        const writing = event === undefined || m === undefined
          ? Promise.resolve()
          : m.desk.appendEvent(home, event, { log }).then(() => { wrote = true; }, (err: unknown) => {
            wrote = true;
            log(`${BIN}: desk: the phone's texts could not be carried over the shutdown: ${errText(err)}`);
          });
        const quietly = (p: Promise<void>): Promise<void> => p.then(() => undefined, () => undefined);
        await within(SHUTDOWN_IDLE_MS, Promise.all([writing, ...cut.map((w) => quietly(idleWaitOf(w.agent)?.() ?? Promise.resolve()))]));
        if (!wrote) log(`${BIN}: desk: the carry over the shutdown was not written in ${SHUTDOWN_IDLE_MS / 1000} s; the shutdown goes on`);
        for (const w of all) end(w);
        await within(SHUTDOWN_QUEUE_MS, queue);
        await recording;
      })();
      return disposing;
    },
  };
}
