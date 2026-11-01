// face/src/firing.ts
/** One firing of a standing order: the checks that may refuse it, its producer, one turn in a fresh desk session with
 * the armed text inline, and the one message the operator's phone gets (docs/superpowers/specs/2026-10-19-always-on-gravit-design.md
 * §5.9; rulings P2-3, P2-4, P2-6, P2-7, P2-14, P2-20, P2-25, P2-26). The clock row (src/schedule.ts) decides when an
 * order is due, records the `started` that consumes its key, and hands the firing here; this module decides nothing
 * about time but the market moment a firing's text must beat.
 *
 * BEFORE IT RUNS ({@link checkFiring}), in this order: the pause - one in force refuses, and so does a switch that
 * cannot be read; the day's token budget - spent, it refuses, and one that cannot be read lets the firing go on (the
 * plan's ruling 8); the order's text, whose bytes must hash to the pin `npm run desk -- arm` recorded, read as
 * strictly as arm read them (src/producer.ts `readScriptBytes`: no link followed, no FIFO waited on); a script
 * producer's bytes, likewise; and the instruction-chain fence for the order's cwd (src/desk-session.ts
 * `findChainViolation`). A refusal consumes nothing: the clock row records it and may ask again inside the grace. What
 * passes carries the very bytes it hashed ({@link Verified}), so the text the model reads is the text the operator
 * armed - never a second read the file could change under.
 *
 * THE RUN ({@link runFiring}), once the clock row has recorded its `started`:
 * - the producer: a builtin raced against the order's producer deadline, or a script through src/producer.ts
 *   `runScriptProducer`, which hashes it again and runs a private copy of exactly those bytes; either text cut at
 *   32,768 characters before it is quoted. A producer that fails - the run's own hash refusal included, the backstop
 *   for a script swapped between the check and the run - is a fact the turn is told, never a reason to skip it;
 *   `wake: false` runs the producer alone and speaks only when it fails.
 * - the session: fresh from src/desk-session.ts `createDeskAgent` - no `desk-session` record, so a firing never
 *   becomes the phone's conversation - in the order's cwd, on the order's route ({@link resolveFiringRoute}),
 *   supervised with the order's own deadline and the chain fence, and woken once ({@link wakeMessage}) with the
 *   schedule's source.
 * - the watchdog: a turn the supervisor never reports - none started, or one hung past its cancel - is cancelled
 *   {@link FIRING_SLACK_MS} after the deadline, and the firing ends without it.
 * - the turn's end: recorded in `events.jsonl` exactly as the desk conversation records a phone turn, so a firing's
 *   tokens count toward the day's turns and its budget, a cancelled turn's included; then what the turn changed in its
 *   cwd ({@link snapshotFiles}, {@link diffFiles}) and the fence again.
 * - the delivery, through the desk conversation's `deliver` (P2-7): the final text - held back when the turn ends
 *   after the market moment it was about ({@link cutoffOf}, P2-20) - or the one line that says why there is none;
 *   then one line for a violation the turn left behind. Every line is a {@link LINES} builder: the plan's phone-line
 *   table.
 * - letting go: the session's dispose, then the supervision's end, so a turn the dispose drains is still reported;
 *   the dispose is awaited at most {@link FIRING_DISPOSE_MS}, and past it the firing ends with one line, the dispose
 *   and then the supervision's end going on alone.
 * Each step is a line in `firings.jsonl` ({@link FiringRecord}); the clock row writes the other kinds.
 *
 * EVERY TURN IT OUTLIVES IS COUNTED. A turn the supervisor reports once the firing has stopped waiting for its own - the
 * hung turn after the watchdog, the cut one after an abort, a browser's post on its session - gets its `desk-turn` (or
 * `desk-refused`) in `events.jsonl` all the same, so its tokens reach the budget; it adds nothing to `firings.jsonl`
 * and sends nothing.
 *
 * AN ABORT - the clock row's shutdown - cancels the turn under way as `shutdown`, records nothing more in
 * `firings.jsonl`, sends nothing more, lets the session go and resolves `undefined`: a `started` with no `finished`
 * reads as interrupted at the next boot, and is never run again. One that lands while `finished` is written leaves that
 * record, and still resolves `undefined`.
 *
 * MODULE WEIGHT. It brings src/desk-session.ts - the desk preset, the role library, js-yaml, dsh-agent - and dsh-llm:
 * only the clock row loads it, itself loaded on first use, so the pause switch never does.
 * @module
 */
import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import {
  appendEvent, appendRecord, budgetReplyLine, deskDir, deskTime, FIRINGS_FILE, readOffState, type BudgetState, type DeskEvent, type TurnUsage,
} from "./desk.ts";
import type { DeliverResult } from "./desk-conversation.ts";
import {
  findChainViolation, provenanceLine, resolveDeskRoute, superviseDeskTurns, type DeskClock, type DeskTurnRecord, type SessionEventsOn,
} from "./desk-session.ts";
import { etClock } from "./et.ts";
import type { MarketSession } from "./market-clock.ts";
import {
  capText, formatDuration, formatProducer, PRODUCER_TEXT_MAX, readScriptBytes, resolveScript, runScriptProducer,
  type BuiltinName, type BuiltinProducer, type ProducerInput, type ProducerOutput, type ProducerRunner, type ProducerSpec,
} from "./producer.ts";
import type { AgentLike } from "./room.ts";
import type { MessageLike } from "./room-rules.ts";
import { orderCwd, sha256Hex, STANDING_TEXT_MAX_BYTES, type StandingOrder } from "./standing.ts";

/** Diagnostic label, the one every `${BIN}:`-prefixed line in the face uses; desk lines add `desk:`. */
const BIN = "gravit-face";
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const codeOf = (err: unknown): unknown => (err as { code?: unknown } | null | undefined)?.code;
/** A failure as a line names it: its code when it has one (`EACCES`), else its message. */
const reasonOf = (err: unknown): string => {
  const code = codeOf(err);
  return typeof code === "string" ? code : errText(err);
};
/** Where a firing's lines go unless its deps pass `log`: stderr, as the desk's others do. */
const defaultLog = (line: string): void => { console.error(line); };

/* ---------- the firing and its ledger ---------- */

/** A model route: a provider and its model. */
export type Route = { provider: string; model: string };

/** A firing's key, `<id>:<session date>`: what its `started` consumes (P2-9, P2-23). */
export function firingKey(id: string, date: string): string {
  return `${id}:${date}`;
}

/** One firing as the clock row hands it over: its key, the order as last loaded, the session date it fires for, that
 * date's session and its anchor's instant (ms since the epoch). */
export interface FiringItem {
  key: string;
  order: StandingOrder;
  date: string;
  session: MarketSession;
  anchorMs: number;
}

/** A file a firing turn added, modified or removed, by its path relative to the turn's cwd, `/`-joined. */
export type FileChange = { path: string; change: "added" | "modified" | "removed" };

/** A `hash` or `producer-hash` detail for a file now past the size it was armed under: changed, never read whole. */
export const OVERSIZED = "oversized";

/** Why {@link checkFiring} refused a firing. A `hash` or `producer-hash` detail is the sha the file holds now,
 * `missing`, or {@link OVERSIZED}; a `fence` detail is the violation's path, relative to the repository root. */
export type Refusal =
  | { reason: "off" }
  | { reason: "budget"; state: BudgetState }
  | { reason: "hash"; detail: string }
  | { reason: "producer-hash"; detail: string }
  | { reason: "fence"; detail: string };

/** What {@link checkFiring} let through: the turn's cwd, and the order's text as the bytes it hashed, decoded as UTF-8,
 * with their sha - and a script producer's sha. */
export interface Verified {
  cwd: string;
  standingText: string;
  standingSha: string;
  producerSha?: string;
}

/** The clock row's record that a firing began: the one record that consumes its key. `cwd` is repo-relative, `anchor`
 * the anchor's instant, `deadlineMs` the turn's. */
export type StartedRecord = {
  t: string; kind: "started"; key: string; order: string; date: string; dir: string; cwd: string; at: string; anchor: string;
  standingSha: string; producer?: string; producerSha?: string; wake: boolean; deadlineMs: number;
};
/** A producer's run: how it ended - its error, a script's exit code, whether its deadline stopped it - its wall time,
 * and how many characters it wrote, counted before the cut. */
export type ProducerRecord = {
  t: string; kind: "producer"; key: string; producer: string; ok: boolean; error?: string; code?: number | null; timedOut?: true;
  wallMs: number; chars: number;
};
/** The session a firing woke, and its route as `provider/model`. */
export type WokeRecord = { t: string; kind: "woke"; key: string; sessionId: string; route: string };
/** A firing's turn as its `finished` record keeps it. `no-turn` and `timed-out` without a `wallMs` are the watchdog's;
 * `error` is a session that could not be made or woken, `error` saying why. */
export type FiringTurn = {
  sessionId?: string;
  outcome: "ended" | "timed-out" | "failed" | "cancelled" | "refused" | "no-turn" | "error";
  cancel?: string;
  deadlineMs: number;
  wallMs?: number;
  usage?: TurnUsage;
  error?: string;
};
/** A firing's end: its wall time, its producer, its turn, the files the turn changed (the first
 * {@link FILES_RECORD_MAX}, `filesTruncated` when there were more or a walk was cut), the fence violation found after
 * the turn, whether its text was held back, what the delivery answered and how long the final text was. */
export type FinishedRecord = {
  t: string; kind: "finished"; key: string; order: string; date: string; wallMs: number;
  producer?: { spec: string; ok: boolean; error?: string };
  turn?: FiringTurn;
  files?: FileChange[];
  filesTruncated?: true;
  violation?: string;
  withheld?: "after the close" | "after the open";
  delivery?: DeliverResult;
  chars?: number;
};
/** A refusal, as the clock row records it: `reported` when its phone line went out. */
export type RefusedRecord = {
  t: string; kind: "refused"; key: string; order: string; date: string; reason: Refusal["reason"]; detail?: string; reported: boolean;
};
/** An anchor found past its grace: why - the face `asleep` across it (the gap), `down` when it came, or found `late` -
 * and when it was found. */
export type MissedRecord = {
  t: string; kind: "missed"; key: string; order: string; date: string; anchor: string; why: "asleep" | "down" | "late";
  asleep?: { from: string; to: string }; foundAt: string;
};
/** A `started` the last run left without a `finished`, found at boot. */
export type InterruptedRecord = { t: string; kind: "interrupted"; key: string; order: string; date: string; startedAt: string };
/** An order past its `expires`, once per expiry: its key is `<id>:<expires>`, its `date` the expiry. */
export type ExpiredRecord = { t: string; kind: "expired"; key: string; order: string; date: string; expires: string };

/** One line of `firings.jsonl`. Every record carries `t`, when the face wrote it (ISO-8601 UTC), and its `kind`. */
export type FiringRecord =
  | StartedRecord
  | ProducerRecord
  | WokeRecord
  | FinishedRecord
  | RefusedRecord
  | MissedRecord
  | InterruptedRecord
  | ExpiredRecord;

/** Every kind {@link FiringRecord} has, and only those: a record over the union, so a kind added to the type and not
 * here fails to compile. */
const FIRING_KINDS: Readonly<Record<FiringRecord["kind"], true>> = {
  started: true,
  producer: true,
  woke: true,
  finished: true,
  refused: true,
  missed: true,
  interrupted: true,
  expired: true,
};

/** Whether a line's object is a firing record: a string `t` and a known `kind`, as src/desk.ts reads an event. The
 * face is the file's one writer; the rest of the shape is the writer's to keep. */
export function isFiringRecord(x: unknown): x is FiringRecord {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const { t, kind } = x as { t?: unknown; kind?: unknown };
  return typeof t === "string" && typeof kind === "string" && Object.hasOwn(FIRING_KINDS, kind);
}

/**
 * A record's outcome as the status shows it. A `finished` with a turn reads by the turn first - `timed out`, `refused:
 * fence`, `never started`, `failed` (the model's failure, or a session that could not run), `cancelled` - then
 * `withheld (<reason>)`, then by its delivery: `delivered`, `queued` (any of it waiting in the outbox) or `undelivered
 * (<reason>)`. One without a turn (`wake: false`) reads `producer ran` or `producer failed`. The other kinds read
 * `refused (<reason>)`, `missed`, `interrupted`, `expired` - and `started`, `producer ran`/`producer failed` and `woke`
 * for the steps between.
 * @param r - a record.
 */
export function outcomeOf(r: FiringRecord): string {
  switch (r.kind) {
    case "finished":
      return finishedOutcome(r);
    case "refused":
      return `refused (${r.reason})`;
    case "producer":
      return r.ok ? "producer ran" : "producer failed";
    default:
      return r.kind;
  }
}

function finishedOutcome(r: FinishedRecord): string {
  if (r.turn === undefined) {
    if (r.producer === undefined) return "finished";
    return r.producer.ok ? "producer ran" : "producer failed";
  }
  switch (r.turn.outcome) {
    case "timed-out":
      return "timed out";
    case "refused":
      return "refused: fence";
    case "no-turn":
      return "never started";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "ended":
      break;
  }
  if (r.withheld !== undefined) return `withheld (${r.withheld})`;
  const delivery = r.delivery;
  if (delivery === undefined) return "ended";
  if ("undelivered" in delivery) return `undelivered (${delivery.undelivered})`;
  return delivery.queued === true ? "queued" : "delivered";
}

/* ---------- the phone's lines ---------- */

/** `<id> · <date>`: an order and its session's date, as a firing's lines open. */
const of = (id: string, date: string): string => `${id} · ${date}`;
/** A count as the lines print one: `2,013,402`. */
const counted = (n: number): string => n.toLocaleString("en-US");
/** `text` cut to at most `max` characters (code points), a cut ending in `…`. */
function cut(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/** The most characters of `standing.yml`'s errors its refusal line quotes. */
const STANDING_ERRORS_MAX = 500;

/**
 * The phone's lines for the standing orders, one builder per row of the plan's phone-line table (Global Constraints),
 * each returning its row's text exactly - with `cancelled`, the line for a firing turn something cancelled before it
 * said anything, and `budgetReply`, src/desk.ts's own line for a phone post while the budget is spent. A time is
 * New York's as src/desk.ts `deskTime` shows it, dated when it falls on another New York day; a duration as
 * src/producer.ts `formatDuration` spells it (`10 min`, `90 s`); a count as `en-US` writes it.
 */
export const LINES = {
  /** A firing turn its deadline cut before it said anything. */
  timedOut: (id: string, date: string, deadlineMs: number): string =>
    `${of(id, date)} timed out after ${formatDuration(deadlineMs)}; a card or a long tool was pending`,
  /** A firing turn that ended and said nothing. */
  noText: (id: string, date: string): string => `${of(id, date)} ended with no text`,
  /** A firing turn whose model call failed before it said anything. */
  failed: (id: string, date: string, error: string): string => `${of(id, date)} could not answer: ${error}; nothing was done`,
  /** A firing turn something cancelled - the browser's stop, a disposal - before it said anything. */
  cancelled: (id: string, date: string, cancel: string): string => `${of(id, date)} was cancelled (${cancel}); nothing more will be said`,
  /** The fence refused a firing, before it or at its turn's start. */
  fence: (id: string, date: string, path: string): string =>
    `${of(id, date)} refused: ${path} exists; it would steer every desk turn. Remove it.`,
  /** The watchdog found no turn. */
  noTurn: (id: string, date: string): string => `${of(id, date)} never started a turn; nothing ran`,
  /** The session could not be made or woken. */
  couldNotRun: (id: string, date: string, reason: string): string => `${of(id, date)} could not run: ${reason}`,
  /** The turn left a fence violation behind. */
  leftBehind: (id: string, date: string, path: string): string =>
    `${of(id, date)} left ${path} behind; every desk turn is refused until it is removed`,
  /** Its text or its script changed since arming. */
  changed: (id: string, date: string, path: string): string =>
    `${of(id, date)} refused: ${path} changed since arming. Review it, then: npm run desk -- rearm ${id}`,
  /** Its text or its script is missing. */
  missing: (id: string, date: string, path: string): string =>
    `${of(id, date)} refused: ${path} is missing. Restore it, or remove the order from standing.yml`,
  /** A close-anchored text that finished after the close. */
  afterClose: (id: string): string => `${id} finished after the close; not sent - it describes a market that has moved`,
  /** An open-anchored text that finished after the open. */
  afterOpen: (id: string): string => `${id} finished after the open; not sent - it describes a market that has moved`,
  /** The day's budget is spent: the first refusal of the ET day. */
  budgetSpent: (state: BudgetState): string =>
    `standing orders are refused for the rest of the day: the desk's token budget is spent (${counted(state.used.total)}`
    + `${state.dailyTokens === undefined ? "" : ` of ${counted(state.dailyTokens)}`} tokens since 00:00 ET)`,
  /** An anchor missed: the face asleep across it, not running, or finding it past the grace - each time as it was
   * when the miss was found. */
  missed: (r: Pick<MissedRecord, "order" | "date" | "anchor" | "why" | "asleep" | "foundAt">): string => {
    const found = new Date(r.foundAt);
    const at = (iso: string): string => deskTime(new Date(iso), found);
    let why: string;
    if (r.why === "asleep") why = r.asleep === undefined ? "the face was asleep" : `the face was asleep from ${at(r.asleep.from)} to ${at(r.asleep.to)}`;
    else if (r.why === "down") why = "the face was not running";
    else why = `found at ${at(r.foundAt)}, past the 5-minute grace`;
    return `${of(r.order, r.date)} missed its ${at(r.anchor)} anchor: ${why}. A standing order never runs late`;
  },
  /** A `started` a restart left unfinished. */
  interrupted: (id: string, date: string): string => `${of(id, date)} was cut off by a restart; a standing order never runs twice`,
  /** An order past its last day. */
  expired: (id: string, expires: string): string =>
    `${id} expired after ${expires} and no longer fires; extend it with npm run desk -- rearm ${id} --expires <YYYY-MM-DD> to keep it`,
  /** A `wake: false` order whose producer failed. */
  producerFailed: (id: string, date: string, spec: string, error: string): string =>
    `${of(id, date)} producer ${spec} failed (${error}); nothing was woken`,
  /** `standing.yml` refused: its errors, cut at 500 characters. */
  standingRefused: (errors: readonly string[]): string =>
    `standing.yml is refused, so no standing order runs until it is fixed: ${cut(errors.join("; "), STANDING_ERRORS_MAX)}`,
  /** `firings.jsonl` cannot be read. */
  ledgerUnreadable: (path: string, code: string): string =>
    `the firing ledger ${path} cannot be read (${code}), so no standing order runs until it can`,
  /** No calendar for the day: the FACE_PYTHON hint only for an interpreter without pandas_market_calendars (P2 Task
   * 8's ruling 2) - any other error, the line without it. */
  noCalendar: (python: string, error: string): string =>
    `no standing order runs today: the market calendar failed in ${python} (${error})`
    + (/is not importable in /.test(error) ? ". FACE_PYTHON must name an interpreter with pandas_market_calendars" : ""),
  /** A phone post while the budget is spent: src/desk.ts `budgetReplyLine`, the conversation's own. */
  budgetReply: budgetReplyLine,
} as const;

/* ---------- the route ---------- */

/**
 * A firing's model route (P2-6): the order's `model`, validated as `FACE_DESK_MODEL` is (src/desk-session.ts
 * `resolveDeskRoute`: one provider/model pair the tree serves, else the tree's default with one line) - or, when the
 * order names none, the tree's default selection: the face's main route (spec §6), never the desk's flash.
 * @param ctx - the booted ROOT context's default model and model calls, or their slice.
 * @param raw - the order's `model`; `undefined` or empty for none.
 * @param log - where `resolveDeskRoute`'s fallback line goes.
 * @returns the provider and the model, nothing else.
 */
export async function resolveFiringRoute(
  ctx: { agentDefaultModel: { currentSelection(): Route }; llm: { resolveCallConfig(c: Route): Promise<unknown> } },
  raw: string | undefined,
  log: (line: string) => void,
): Promise<Route> {
  if (raw === undefined || raw === "") {
    const selection = ctx.agentDefaultModel.currentSelection();
    return { provider: selection.provider, model: selection.model };
  }
  return resolveDeskRoute(ctx, raw, log);
}

/* ---------- the files a turn changed ---------- */

/** The most entries a walk of a firing's cwd visits (the plan's ruling 12). */
export const FILES_WALK_MAX = 2_000;
/** The most changed files a `finished` record lists. */
export const FILES_RECORD_MAX = 200;

/** A file as a snapshot holds it: `lstat`'s size and modification time. */
type FileInfo = { size: number; mtimeMs: number };

/** Code-unit order: the same on every machine, unlike `localeCompare`. */
const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
/** Whether a failure says the path is gone: ENOENT, or ENOTDIR - no longer a directory. */
const isGone = (err: unknown): boolean => codeOf(err) === "ENOENT" || codeOf(err) === "ENOTDIR";

/**
 * Every entry under `dir` that is not a directory, by its path relative to `dir` (`/`-joined), with `lstat`'s size and
 * mtime: a bounded walk of a firing's cwd, before and after its turn (the plan's ruling 12 - the journal is
 * gitignored, so git would show nothing). Depth first, each directory's entries in code-unit order; no symlink is
 * followed - a link is an entry of its own, its target never walked, and a `dir` that is itself a link holds nothing.
 * The walk stops after `max` entries, directories included, with `truncated`. A `dir` that is not there (a cwd not made
 * yet) holds nothing; a directory that cannot be listed, or an entry that cannot be `lstat`ed, for any reason but having
 * gone, sets `truncated` too, the listing then being incomplete. Never rejects.
 * @param dir - the directory, a firing's cwd.
 * @param max - the most entries visited, {@link FILES_WALK_MAX} by default.
 */
export async function snapshotFiles(dir: string, max: number = FILES_WALK_MAX): Promise<{ files: Map<string, FileInfo>; truncated: boolean }> {
  const files = new Map<string, FileInfo>();
  let seen = 0;
  let truncated = false;
  /** Walk `abs`, at `rel` under `dir`; `false` once the walk must stop. */
  const walk = async (abs: string, rel: string): Promise<boolean> => {
    let entries: Dirent[];
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch (err) {
      if (!isGone(err)) truncated = true;
      return true;
    }
    for (const entry of entries.sort(byName)) {
      if (seen >= max) {
        truncated = true;
        return false;
      }
      seen += 1;
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      const child = join(abs, entry.name);
      if (entry.isDirectory()) {
        if (!(await walk(child, path))) return false;
        continue;
      }
      try {
        const info = await lstat(child);
        files.set(path, { size: info.size, mtimeMs: info.mtimeMs });
      } catch (err) {
        if (!isGone(err)) truncated = true;
      }
    }
    return true;
  };
  try {
    if ((await lstat(dir)).isSymbolicLink()) return { files, truncated };
  } catch (err) {
    return { files, truncated: !isGone(err) };
  }
  await walk(dir, "");
  return { files, truncated };
}

/**
 * What changed between two snapshots ({@link snapshotFiles}): `added` - in `after` only; `removed` - in `before` only;
 * `modified` - in both, its size or its mtime moved.
 * @param before - the snapshot before the turn.
 * @param after - the snapshot after it.
 * @returns the changes, sorted by path in code-unit order.
 */
export function diffFiles(before: ReadonlyMap<string, FileInfo>, after: ReadonlyMap<string, FileInfo>): FileChange[] {
  const changes: FileChange[] = [];
  for (const [path, was] of before) {
    const now = after.get(path);
    if (now === undefined) changes.push({ path, change: "removed" });
    else if (now.size !== was.size || now.mtimeMs !== was.mtimeMs) changes.push({ path, change: "modified" });
  }
  for (const path of after.keys()) {
    if (!before.has(path)) changes.push({ path, change: "added" });
  }
  return changes.sort((a, b) => byName({ name: a.path }, { name: b.path }));
}

/* ---------- before a firing ---------- */

/** What a firing reads of its world: see {@link checkFiring} and {@link runFiring}. `home` is the harness home (the
 * ledger's, `OFF`'s); `root` the repository root; `clock` every stamp and timer; `runScript` the runner a script producer
 * runs under (src/producer.ts `defaultProducerRunner` of the face's interpreter); `builtins` the face's builders,
 * by name; `createAgent` a fresh desk agent (src/desk-session.ts `createDeskAgent`); `resolveRoute` an order's model as
 * a route ({@link resolveFiringRoute}); `on` the root bus; `supervise` src/desk-session.ts `superviseDeskTurns`, the
 * default; `deliver` the desk conversation's; `budget` the day's (src/desk.ts `readBudget`); `log` where a line goes
 * (stderr); `carry` what a rotation its appends set off hands on. */
export interface FiringDeps {
  home: string;
  root: string;
  clock: DeskClock;
  runScript: ProducerRunner;
  builtins: Partial<Record<BuiltinName, BuiltinProducer>>;
  createAgent(opts: { cwd: string; route: Route }): Promise<{ agent: AgentLike; sessionId: string; dispose(): Promise<void> }>;
  resolveRoute(raw: string | undefined): Promise<Route>;
  on: SessionEventsOn;
  supervise?: typeof superviseDeskTurns;
  deliver(text: string): Promise<DeliverResult>;
  budget(): Promise<BudgetState>;
  log?: (line: string) => void;
  /** What a rotation of `firings.jsonl` that one of the firing's own appends sets off hands on to the new file -
   * the clock row's carry (src/schedule.ts), so the day's keys survive it; nothing when absent. */
  carry?: (rotated: string) => readonly string[];
}

/**
 * Whether `order` may fire now, in this order (see the module header): the pause - in force, or a switch that cannot be
 * read (one line), refuses `off`; the budget - spent, refuses `budget`; one that cannot be read lets the firing on, with
 * one line; the order's text, `<root>/<dir>/<file>` read once as arm reads it (a link, a FIFO, anything but a regular
 * file reads as missing) - refused `hash`, the detail its sha or `missing`, unless its bytes hash to `order.sha256`; a
 * script producer's bytes, found under `scripts/` and read the same way, against `order.producerSha256` - refused
 * `producer-hash` likewise; and the chain fence over the order's cwd - refused `fence`, the detail the violation's
 * repo-relative path. A refusal never consumes the key: that is the clock row's `started`.
 * @param deps - `home`, `root`, `clock` (the pause's expiry is judged on it), `budget` and `log`, as {@link FiringDeps}.
 * @param order - the order, as last loaded.
 * @returns `{ refuse }` or `{ go }`: the cwd, the text as the bytes hashed, decoded as UTF-8 - so `go.standingText`'s
 *   UTF-8 hashes to the pin - its sha, and a script producer's.
 * @throws TypeError - for an order whose `dir` is not an order's directory (src/standing.ts `orderCwd`), before
 *   anything is read: the caller's mistake, which a loaded order never makes.
 */
export async function checkFiring(
  deps: Pick<FiringDeps, "home" | "root" | "clock" | "budget" | "log">,
  order: StandingOrder,
): Promise<{ refuse: Refusal } | { go: Verified }> {
  const log = deps.log ?? defaultLog;
  const cwd = orderCwd(deps.root, order.dir);
  try {
    const { state, expired } = await readOffState(deps.home, () => deps.clock.now());
    if (state !== undefined && !expired) return { refuse: { reason: "off" } };
  } catch (err) {
    /* src/desk.ts: a switch that cannot be read never reads as no switch */
    log(`${BIN}: desk: the pause could not be read (${reasonOf(err)}); standing order ${order.id} is refused as paused`);
    return { refuse: { reason: "off" } };
  }
  try {
    const state = await deps.budget();
    if (state.spent) return { refuse: { reason: "budget", state } };
  } catch (err) {
    log(`${BIN}: desk: the token budget could not be read (${reasonOf(err)}); standing order ${order.id} goes on`);
  }
  const text = await readScriptBytes(join(deps.root, order.dir, order.file), STANDING_TEXT_MAX_BYTES);
  /* a text past the limit arm read it under has changed since arming: refused as changed, never read whole */
  if (typeof text === "string") return { refuse: { reason: "hash", detail: text === "oversized" ? OVERSIZED : "missing" } };
  const standingSha = sha256Hex(text);
  if (standingSha !== order.sha256) return { refuse: { reason: "hash", detail: standingSha } };
  let producerSha: string | undefined;
  if (order.producer?.kind === "script") {
    const found = await resolveScript(deps.root, order.producer.script);
    const bytes = "error" in found ? "missing" : await readScriptBytes(found.path);
    if (typeof bytes === "string") return { refuse: { reason: "producer-hash", detail: bytes === "oversized" ? OVERSIZED : "missing" } };
    producerSha = sha256Hex(bytes);
    if (producerSha !== order.producerSha256) return { refuse: { reason: "producer-hash", detail: producerSha } };
  }
  const violation = await findChainViolation(deps.root, cwd);
  if (violation !== undefined) return { refuse: { reason: "fence", detail: violation } };
  return { go: { cwd, standingText: text.toString("utf8"), standingSha, ...(producerSha === undefined ? {} : { producerSha }) } };
}

/* ---------- the wake message ---------- */

/** A producer's output as a wake message quotes it: its spec, its output - the text already cut ({@link runFiring}) -
 * and how many characters it wrote before the cut. */
interface Quoted {
  spec: string;
  output: ProducerOutput;
  chars: number;
}

/**
 * The message that wakes a firing's turn: its provenance line ([schedule · <id> · <date>]); the session it fires for,
 * when it fired and when the face cancels it - the deadline from `firedAt`, the supervisor's own from the turn's start
 * - and where its final text goes; then the order's text verbatim between its markers, with the sha it was verified
 * by; then, with a producer, its output between its own: `ok, <n> characters`, `ok, cut to 32,768 of <n> characters`
 * or `failed (<error>)`, its text - none when it has none - and the end marker. Lines are joined with `\n`, so the text
 * between the markers is the verified text exactly, and hashes to its sha.
 * @param input - `item` the firing; `firedAt` when it is woken, in ms since the epoch; `verified` what
 *   {@link checkFiring} let through; `producer` its output as quoted - the text already cut - and `chars`, the
 *   length before the cut, which decides the `cut to` form.
 */
export function wakeMessage(input: {
  item: FiringItem;
  firedAt: number;
  verified: Verified;
  producer?: { spec: string; output: ProducerOutput; chars: number };
}): string {
  const { item, firedAt, verified, producer } = input;
  const { order, date, session } = item;
  const at = new Date(firedAt);
  const label = `${order.dir}/${order.file}`;
  const early = session.early ? ", an early close" : "";
  const lines = [
    provenanceLine({ kind: "schedule", order: order.id, date }, at),
    `Standing order ${order.id}, for the ${date} session (open ${deskTime(new Date(session.open), at)}, close ${deskTime(new Date(session.close), at)}${early}), `
      + `fired at ${etClock(at)} ET. The face cancels this turn at ${etClock(new Date(firedAt + order.turnDeadlineMs))} ET; your final text goes to the operator's phone.`,
    "",
    `--- ${label}, sha256 ${verified.standingSha}, as armed ---`,
    verified.standingText,
    `--- end of ${label} ---`,
  ];
  if (producer !== undefined) {
    const { output, chars } = producer;
    let state: string;
    if (!output.ok) state = `failed (${output.error})`;
    else if (chars > PRODUCER_TEXT_MAX) state = `ok, cut to ${counted(PRODUCER_TEXT_MAX)} of ${counted(chars)} characters`;
    else state = `ok, ${counted(chars)} characters`;
    const text = output.text ?? "";
    lines.push("", `--- producer ${producer.spec}: ${state} ---`, ...(text === "" ? [] : [text]), "--- end of producer output ---");
  }
  return lines.join("\n");
}

/* ---------- the market moment ---------- */

/** The longest a firing waits past its turn's deadline for the supervisor to report the turn's end (the plan's
 * ruling 10): then the watchdog cancels it and the firing ends without it. */
export const FIRING_SLACK_MS = 60_000;

/** The longest a firing waits for its session's dispose before it ends without it, the dispose going on alone. */
export const FIRING_DISPOSE_MS = 10_000;

/**
 * The market moment a firing's final text must beat (P2-20, P2-25): its session's close for a `close-Nm` anchor, its
 * open for an `open-Nm` one - an order anchored before its moment - else `undefined`: `close`, `close+Nm`, `open`,
 * `open+Nm` and `HH:MM` have none, or they could never deliver.
 * @param item - the firing: its order's anchor and its session.
 * @returns the moment, in ms since the epoch.
 */
export function cutoffOf(item: Pick<FiringItem, "order" | "session">): number | undefined {
  const anchor = item.order.anchor;
  if (anchor.kind === "time" || anchor.offsetMin >= 0) return undefined;
  return Date.parse(anchor.kind === "close" ? item.session.close : item.session.open);
}

/* ---------- a firing ---------- */

/** What a wait that an abort cut short resolves to. */
const ABORTED: unique symbol = Symbol("aborted");

/** `p`'s value, or {@link ABORTED} as soon as `signal` aborts - at once when it already has; `p` is then left to
 * settle alone, its rejection handled. */
function unlessAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  return new Promise((resolveWith, reject) => {
    const onAbort = (): void => { resolveWith(ABORTED); };
    if (signal.aborted) {
      p.catch(() => {});
      resolveWith(ABORTED);
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolveWith(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/** One firing under way: its deps, the item, what was verified, the abort, the log and when it began. */
interface Run {
  deps: FiringDeps;
  item: FiringItem;
  verified: Verified;
  signal: AbortSignal;
  log: (line: string) => void;
  begun: number;
}

/** A firing's own appends to `firings.jsonl`: its log, and the clock row's carry. */
const ledgerOpts = (run: Run): { log: (line: string) => void; carry?: (rotated: string) => readonly string[] } =>
  (run.deps.carry === undefined ? { log: run.log } : { log: run.log, carry: run.deps.carry });

/** The clock now, as a record's `t`. */
const stamp = (deps: FiringDeps): string => new Date(deps.clock.now()).toISOString();

/** What a producer's run gives: its output as quoted, and its record's fields. */
interface Produced {
  quoted: Quoted;
  record: Omit<ProducerRecord, "t" | "kind" | "key">;
}

/** `output` with its text cut at {@link PRODUCER_TEXT_MAX} (src/producer.ts `capText`). */
function quoteOf(output: ProducerOutput): ProducerOutput {
  if (output.text === undefined) return output;
  const text = capText(output.text).text;
  return output.ok ? { ok: true, text } : { ok: false, error: output.error, text };
}

/** A builtin, raced against `timeoutMs` on the firing's clock: it gets a signal of its own, aborted at the deadline -
 * then its output is `timed out after <duration>` whatever it does - or when the firing aborts. A builtin that is not
 * in this face, or that throws or rejects, is a failed output. Never rejects. */
async function runBuiltin(run: Run, name: BuiltinName, input: ProducerInput, timeoutMs: number): Promise<{ output: ProducerOutput; timedOut: boolean; wallMs: number }> {
  const { deps, signal } = run;
  const started = deps.clock.now();
  const builtin = deps.builtins[name];
  if (builtin === undefined) return { output: { ok: false, error: `builtin:${name} is not available in this face` }, timedOut: false, wallMs: 0 };
  const late = `timed out after ${formatDuration(timeoutMs)}`;
  const stop = new AbortController();
  const onAbort = (): void => { stop.abort(signal.reason); };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  let timer: unknown;
  const deadline = new Promise<typeof late>((done) => {
    timer = deps.clock.setTimeout(() => {
      stop.abort(new Error(late));
      done(late);
    }, timeoutMs);
  });
  const produced = (async (): Promise<ProducerOutput> => {
    try {
      return await builtin(input, stop.signal);
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  })();
  const first = await Promise.race([produced, deadline]);
  deps.clock.clearTimeout(timer);
  signal.removeEventListener("abort", onAbort);
  const wallMs = deps.clock.now() - started;
  return typeof first === "string" ? { output: { ok: false, error: late }, timedOut: true, wallMs } : { output: first, timedOut: false, wallMs };
}

/** The order's producer, run: a builtin ({@link runBuiltin}), or a script through src/producer.ts
 * `runScriptProducer` - the order's pin checked again, a private copy of the verified bytes run in `<desk dir>/run`
 * (absolute), its stderr one face line. Its text cut for the quote; its length counted before the cut. Never rejects. */
async function produce(run: Run, spec: ProducerSpec): Promise<Produced> {
  const { deps, item } = run;
  const { order } = item;
  const input: ProducerInput = {
    order: order.id, firing: item.key, date: item.date, dir: order.dir,
    session: { open: item.session.open, close: item.session.close, early: item.session.early },
  };
  const name = formatProducer(spec);
  let output: ProducerOutput;
  let chars: number;
  let wallMs: number;
  let timedOut: boolean;
  let code: { code: number | null } | undefined;
  if (spec.kind === "script") {
    const ran = await runScriptProducer({
      root: deps.root,
      script: spec.script,
      sha256: order.producerSha256 ?? "",
      runBase: resolve(deskDir(deps.home), "run"),
      run: deps.runScript,
      input,
      timeoutMs: order.producerDeadlineMs,
      log: run.log,
      now: () => deps.clock.now(),
    });
    ({ output, chars, wallMs, timedOut } = ran);
    code = { code: ran.code };
  } else {
    ({ output, timedOut, wallMs } = await runBuiltin(run, spec.name, input, order.producerDeadlineMs));
    chars = output.text?.length ?? 0;
  }
  return {
    quoted: { spec: name, output: quoteOf(output), chars },
    record: {
      producer: name,
      ok: output.ok,
      ...(output.ok ? {} : { error: output.error }),
      ...code,
      ...(timedOut ? { timedOut: true as const } : {}),
      wallMs,
      chars,
    },
  };
}

/** Send `text` through the firing's `deliver`, which should never reject; one that does is one line and an
 * `undelivered` answer. */
async function send(run: Run, text: string): Promise<DeliverResult> {
  try {
    return await run.deps.deliver(text);
  } catch (err) {
    run.log(`${BIN}: desk: firing ${run.item.key} could not deliver its message: ${errText(err)}`);
    return { undelivered: `send failed: ${errText(err)}` };
  }
}

/** The firing's `finished` record, appended: its wall time, its producer, and `rest` - each key only when it has a
 * value, so the record reads back as it was written. Resolves `undefined` when the abort came while it was appended:
 * the record stays, and nothing more is sent. */
async function finish(
  run: Run,
  quoted: Quoted | undefined,
  rest: Omit<FinishedRecord, "t" | "kind" | "key" | "order" | "date" | "wallMs" | "producer">,
): Promise<FinishedRecord | undefined> {
  const { deps, item } = run;
  const output = quoted?.output;
  const record: FinishedRecord = {
    t: stamp(deps), kind: "finished", key: item.key, order: item.order.id, date: item.date, wallMs: deps.clock.now() - run.begun,
    ...(quoted === undefined || output === undefined
      ? {}
      : { producer: { spec: quoted.spec, ok: output.ok, ...(output.ok ? {} : { error: output.error }) } }),
    ...rest,
  };
  await appendRecord(deps.home, FIRINGS_FILE, record, ledgerOpts(run));
  return run.signal.aborted ? undefined : record;
}

/** Whether `p` settles - fulfilled or rejected - within `ms` on `clock`: `false` when the bound comes first, `p` then
 * left to settle alone. Never rejects. */
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

/** A session that could not be made: one face line, the could-not-run line to the phone, and `finished`. */
async function couldNotRun(run: Run, quoted: Quoted | undefined, reason: string): Promise<FinishedRecord | undefined> {
  const { item, signal } = run;
  run.log(`${BIN}: desk: firing ${item.key} could not run: ${reason}`);
  const delivery = await unlessAborted(send(run, LINES.couldNotRun(item.order.id, item.date, reason)), signal);
  if (delivery === ABORTED) return undefined;
  return finish(run, quoted, { turn: { outcome: "error", deadlineMs: item.order.turnDeadlineMs, error: reason }, delivery });
}

/** Cancel the firing's turn with `{ kind: "hook", reason }` - the inbox with it: the session is let go next. A cancel
 * that throws is one line. */
function cancelTurn(run: Run, agent: AgentLike, reason: string): void {
  try {
    agent.cancel({ kind: "hook", reason });
  } catch (err) {
    run.log(`${BIN}: desk: the turn of firing ${run.item.key} could not be cancelled: ${errText(err)}`);
  }
}

/** The repo-relative form of `cwd`, `/`-joined: `desk/journal`, `strategies/<name>`. The clock row's too. */
export const repoRelative = (root: string, cwd: string): string => relative(resolve(root), resolve(cwd)).split(sep).join("/");

/** How the wait for a firing's turn ended: the supervisor's record, the watchdog, or a wake that never went. */
type TurnEnd = { kind: "turn"; record: DeskTurnRecord } | { kind: "watchdog"; started: boolean } | { kind: "error"; error: string };

/** A supervisor's record as a `finished` record keeps the turn. */
function turnOf(r: DeskTurnRecord, sessionId: string): FiringTurn {
  return {
    sessionId,
    outcome: r.outcome,
    ...(r.cancel === undefined ? {} : { cancel: r.cancel }),
    deadlineMs: r.deadlineMs,
    wallMs: r.wallMs,
    ...(r.usage === undefined ? {} : { usage: r.usage }),
    ...(r.error === undefined ? {} : { error: r.error }),
  };
}

/** A turn's end as the desk conversation records a phone turn (src/desk-conversation.ts `record`): a `desk-refused`
 * for a turn the fence cut, else a `desk-turn` with its tokens and why it was cancelled or failed. */
function turnEvent(r: DeskTurnRecord, t: string, cwdRel: string): DeskEvent {
  if (r.outcome === "refused") return { t, kind: "desk-refused", reason: "fence", path: r.violation ?? cwdRel };
  return {
    t, kind: "desk-turn", sessionId: r.sessionId, source: r.source, turn: r.turn, outcome: r.outcome, wallMs: r.wallMs,
    ...(r.usage === undefined ? {} : { usage: r.usage }),
    ...(r.cancel === undefined ? {} : { cancel: r.cancel }),
    ...(r.error === undefined ? {} : { error: r.error }),
  };
}

/** The line after an answer a cut interrupted mid-stream, in the desk conversation's form: `(cut off: <what cut it>)` -
 * the order's deadline, or what cancelled the turn. */
function cutOffLine(r: DeskTurnRecord, order: StandingOrder): string {
  return `(cut off: ${r.outcome === "timed-out" ? `timed out after ${formatDuration(order.turnDeadlineMs)}` : r.cancel ?? r.outcome})`;
}

/** What a firing's turn sends: for a turn the fence refused, the fence's line - never a text written over a
 * violation; else its final text, with its cut-off line when a cut interrupted it - or, past the market moment, the
 * after-the-close or after-the-open line instead; else the line for why it said nothing. */
function whatToSay(item: FiringItem, turn: FiringTurn, record: DeskTurnRecord | undefined, now: number, cwdRel: string): {
  text: string;
  withheld?: FinishedRecord["withheld"];
  chars?: number;
} {
  const { order, date } = item;
  const id = order.id;
  if (turn.outcome === "refused") return { text: LINES.fence(id, date, record?.violation ?? cwdRel) };
  if (record !== undefined && record.finalText !== "") {
    const chars = record.finalText.length;
    const cutoff = cutoffOf(item);
    if (cutoff !== undefined && now >= cutoff) {
      return order.anchor.kind === "close"
        ? { text: LINES.afterClose(id), withheld: "after the close", chars }
        : { text: LINES.afterOpen(id), withheld: "after the open", chars };
    }
    return { text: record.interrupted === true ? `${record.finalText}\n${cutOffLine(record, order)}` : record.finalText, chars };
  }
  switch (turn.outcome) {
    case "timed-out":
      return { text: LINES.timedOut(id, date, order.turnDeadlineMs) };
    case "failed":
      return { text: LINES.failed(id, date, turn.error ?? "error") };
    case "cancelled":
      return { text: LINES.cancelled(id, date, turn.cancel ?? "unknown") };
    case "no-turn":
      return { text: LINES.noTurn(id, date) };
    case "error":
      return { text: LINES.couldNotRun(id, date, turn.error ?? "error") };
    default:
      return { text: LINES.noText(id, date) };
  }
}

/**
 * Run one firing, once the clock row has recorded its `started` (see the module header's THE RUN):
 * 1. the producer, when the order has one, and its `producer` record;
 * 2. `wake: false`: `finished` with no turn, after one line when the producer failed - and done;
 * 3. the session: `resolveRoute(order.model)`, a snapshot of the cwd, `createAgent` - its `woke` record;
 * 4. the wake: supervised (`order.turnDeadlineMs`, the chain fence), then one `followup` of {@link wakeMessage} with the
 *    source `{ kind: "schedule", order, firing, date }`;
 * 5. the watchdog: no turn's end by `turnDeadlineMs + FIRING_SLACK_MS` from the wake cancels the turn (`desk
 *    deadline`): `no-turn` when no `turn/start` was seen on the session, else `timed-out`;
 * 6. the turn's end, recorded as the conversation records a phone turn (`desk-turn`, `desk-refused` for a refused
 *    turn); then the files the turn changed and the fence again;
 * 7. the delivery: the text or the line ({@link LINES}), then `finished` with what `deliver` answered, then the
 *    left-behind line for a violation the turn did not start over, then the session's dispose - awaited at most
 *    {@link FIRING_DISPOSE_MS}, past which one line and the dispose goes on alone - and only after it the supervision's
 *    end.
 * Any turn the supervisor reports once the firing has stopped waiting for its own is recorded in `events.jsonl` alone
 * (the module header's EVERY TURN IT OUTLIVES IS COUNTED). A session that cannot be made or woken - a route, a create
 * or a wake that throws - is outcome `error` with the could-not-run line. An abort cancels the turn under way as
 * `shutdown` - when it was woken - records nothing more in `firings.jsonl`, sends nothing more, lets the session go and
 * resolves `undefined`; a session made after it is disposed when it comes. Never rejects: an unexpected failure is one
 * line and `undefined`.
 * @param deps - see {@link FiringDeps}.
 * @param item - the firing.
 * @param verified - what {@link checkFiring} let through for it.
 * @param signal - the clock row's abort.
 * @returns the `finished` record, or `undefined` when aborted.
 */
export async function runFiring(deps: FiringDeps, item: FiringItem, verified: Verified, signal: AbortSignal): Promise<FinishedRecord | undefined> {
  const log = deps.log ?? defaultLog;
  try {
    return await fire({ deps, item, verified, signal, log, begun: deps.clock.now() });
  } catch (err) {
    log(`${BIN}: desk: firing ${item.key} failed: ${errText(err)}; it is left unfinished`);
    return undefined;
  }
}

/** Steps 1 and 2 of {@link runFiring}, then the wake. */
async function fire(run: Run): Promise<FinishedRecord | undefined> {
  const { deps, item, signal } = run;
  if (signal.aborted) return undefined;
  let quoted: Quoted | undefined;
  if (item.order.producer !== undefined) {
    const produced = await unlessAborted(produce(run, item.order.producer), signal);
    if (produced === ABORTED) return undefined;
    quoted = produced.quoted;
    const record: ProducerRecord = { t: stamp(deps), kind: "producer", key: item.key, ...produced.record };
    await appendRecord(deps.home, FIRINGS_FILE, record, ledgerOpts(run));
    if (signal.aborted) return undefined;
  }
  if (item.order.wake) return wake(run, quoted);
  let delivery: DeliverResult | undefined;
  if (quoted !== undefined && !quoted.output.ok) {
    const sent = await unlessAborted(send(run, LINES.producerFailed(item.order.id, item.date, quoted.spec, quoted.output.error)), signal);
    if (sent === ABORTED) return undefined;
    delivery = sent;
  }
  return finish(run, quoted, delivery === undefined ? {} : { delivery });
}

/** Steps 3 to 7 of {@link runFiring}. */
async function wake(run: Run, quoted: Quoted | undefined): Promise<FinishedRecord | undefined> {
  const { deps, item, verified, signal, log } = run;
  const { order, key, date } = item;
  const { clock } = deps;
  const cwd = verified.cwd;
  const cwdRel = repoRelative(deps.root, cwd);

  /* 3. the session */
  let route: Route;
  try {
    const routed = await unlessAborted(deps.resolveRoute(order.model), signal);
    if (routed === ABORTED) return undefined;
    route = routed;
  } catch (err) {
    return couldNotRun(run, quoted, errText(err));
  }
  const before = await snapshotFiles(cwd);
  if (signal.aborted) return undefined;
  /* a then-callback, so a create that throws is a rejection, and a could-not-run, like one that rejects */
  const creating = Promise.resolve().then(() => deps.createAgent({ cwd, route }));
  let session: Awaited<typeof creating>;
  try {
    const made = await unlessAborted(creating, signal);
    if (made === ABORTED) {
      /* made after the abort: nobody else holds it */
      creating.then((late) => late.dispose(), () => {}).catch(() => {});
      return undefined;
    }
    session = made;
  } catch (err) {
    return couldNotRun(run, quoted, errText(err));
  }

  /* Every turn the supervisor reports is recorded in events.jsonl, in the order reported: the firing's own, then any
   * it outlives - one that ends after an abort or after the watchdog, or a browser's post on its session - so its
   * tokens reach the budget. A turn outlived gets only that event: no firings.jsonl record, no line. */
  let counted: Promise<void> = Promise.resolve();
  const count = (record: DeskTurnRecord): Promise<void> => {
    counted = counted.then(() => appendEvent(deps.home, turnEvent(record, stamp(deps), cwdRel), { log }));
    return counted;
  };
  /* The wait for the firing's turn, which its record, the watchdog or a failed wake ends - and an abort, after which
   * a record is a turn outlived. `closed` once the supervision has ended: no record comes after it. */
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

  let unwatch: (() => void) | undefined;
  let offBus: (() => void) | undefined;
  let watchdog: unknown;
  try {
    await appendRecord(deps.home, FIRINGS_FILE, { t: stamp(deps), kind: "woke", key, sessionId: session.sessionId, route: `${route.provider}/${route.model}` } satisfies WokeRecord, ledgerOpts(run));
    if (signal.aborted) return undefined;

    /* 4. the wake, and 5. its watchdog */
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
        deadlineMs: order.turnDeadlineMs,
        clock,
        log,
        fence: () => findChainViolation(deps.root, cwd),
        onTurnEnd,
      });
      const text = wakeMessage({ item, firedAt: clock.now(), verified, ...(quoted === undefined ? {} : { producer: quoted }) });
      const message = createUserMessage({ content: [{ type: "text", text }], source: { kind: "schedule", order: order.id, firing: key, date } });
      session.agent.followup(message as unknown as MessageLike);
      woken = true;
      const slackMs = order.turnDeadlineMs + FIRING_SLACK_MS;
      watchdog = clock.setTimeout(() => {
        watchdog = undefined;
        log(`${BIN}: desk: firing ${key} saw ${started ? "no end to its turn" : "no turn start"} in ${formatDuration(slackMs)}; the watchdog cancels it`);
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
      /* a turn whose end came with the abort is counted, and nothing more is done for it; what the cancel ends is
       * reported in a microtask, once the finally below has stopped the wait */
      if (endedWith?.kind === "turn") void count(endedWith.record);
      if (woken) cancelTurn(run, session.agent, "shutdown");
      return undefined;
    }

    /* 6. the turn's end */
    let record: DeskTurnRecord | undefined;
    let turn: FiringTurn;
    if (ending.kind === "watchdog") {
      cancelTurn(run, session.agent, "desk deadline");
      turn = { sessionId: session.sessionId, outcome: ending.started ? "timed-out" : "no-turn", deadlineMs: order.turnDeadlineMs };
    } else if (ending.kind === "error") {
      log(`${BIN}: desk: firing ${key} could not run: ${ending.error}`);
      turn = { sessionId: session.sessionId, outcome: "error", deadlineMs: order.turnDeadlineMs, error: ending.error };
    } else {
      record = ending.record;
      turn = turnOf(record, session.sessionId);
      await count(record);
    }
    let left: Pick<FinishedRecord, "files" | "filesTruncated" | "violation"> = {};
    if (ending.kind !== "error") {
      const after = await snapshotFiles(cwd);
      const changes = diffFiles(before.files, after.files);
      let violation: string | undefined;
      try {
        violation = await findChainViolation(deps.root, cwd);
      } catch (err) {
        log(`${BIN}: desk: the fence check after firing ${key} failed (${errText(err)}); it counts as a violation at ${cwdRel}`);
        violation = cwdRel;
      }
      left = {
        files: changes.slice(0, FILES_RECORD_MAX),
        ...(before.truncated || after.truncated || changes.length > FILES_RECORD_MAX ? { filesTruncated: true as const } : {}),
        ...(violation === undefined ? {} : { violation }),
      };
    }
    if (signal.aborted) return undefined;

    /* 7. the delivery */
    const said = whatToSay(item, turn, record, clock.now(), cwdRel);
    const delivery = await unlessAborted(send(run, said.text), signal);
    if (delivery === ABORTED) return undefined;
    const finished = await finish(run, quoted, {
      turn,
      ...left,
      ...(said.withheld === undefined ? {} : { withheld: said.withheld }),
      delivery,
      ...(said.chars === undefined ? {} : { chars: said.chars }),
    });
    if (finished === undefined) return undefined;
    const violation = left.violation;
    /* a turn the fence refused started over this violation: its line said so already */
    if (violation !== undefined && !(turn.outcome === "refused" && record?.violation === violation)) {
      const sent = await unlessAborted(send(run, LINES.leftBehind(order.id, date, violation)), signal);
      if (sent === ABORTED) return undefined;
    }
    return finished;
  } finally {
    if (watchdog !== undefined) clock.clearTimeout(watchdog);
    waiting = false;
    offBus?.();
    /* The session first, then the supervision - so a turn the dispose drains is still reported, and counted - the
     * dispose awaited at most FIRING_DISPOSE_MS: past that the firing ends, and the supervision ends with the dispose,
     * whenever that comes. */
    const disposing = (async (): Promise<void> => {
      try {
        await session.dispose();
      } catch (err) {
        log(`${BIN}: desk: the session of firing ${key}, ${session.sessionId}, could not be disposed: ${errText(err)}`);
      }
    })();
    const endSupervision = (): void => {
      try {
        unwatch?.();
      } catch (err) {
        log(`${BIN}: desk: the supervision of firing ${key} could not be ended: ${errText(err)}`);
      }
      closed = true;
    };
    if (await settlesWithin(clock, FIRING_DISPOSE_MS, disposing)) {
      endSupervision();
      await counted;
    } else {
      log(`${BIN}: desk: firing ${key} could not dispose its session ${session.sessionId} in ${formatDuration(FIRING_DISPOSE_MS)}; it ends, and the dispose goes on alone`);
      void disposing.then(endSupervision);
    }
  }
}
