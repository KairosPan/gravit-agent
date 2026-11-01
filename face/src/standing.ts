/** The standing orders: `$DSH_HOME/face/desk/standing.yml`, what the operator armed the desk to do on the
 * exchange calendar, unattended (rulings P2-8, P2-9, P2-13, P2-16, P2-22, P2-24).
 *
 * THE FILE. A mapping of `budget:` - `dailyTokens`, the day's cap on the desk's tokens (no key, no cap) -
 * and `orders:`, a list. Only the face parses it, with js-yaml's CORE_SCHEMA ({@link readDeskYaml}): an
 * unquoted date stays a string, a boolean is CORE's (`true`/`false`, `True`/`TRUE`), and there are no
 * timestamps or sexagesimals, so `at: 9:30` is the text `9:30`, refused, and `expires: 2026-11-30` the text
 * `2026-11-30`. An empty file, comments only, or a bare `orders:` is no orders. The file lives outside the
 * repository, mode 0600, so no sandboxed session can write it; `npm run desk -- arm` and `rearm` write it,
 * and the operator may edit it by hand.
 *
 * AN ORDER. `id` (a-z, 0-9 and -, opening with a letter, at most 40 characters, unique); `dir` - `desk`, whose
 * turn runs in `desk/journal`, or `strategies/<name>`, a channel's directory, never `_template`
 * ({@link orderCwd}); `file`, the order's text in that directory (`STANDING.md` by default), and `sha256`, its
 * bytes' hash at arming; `at`, the anchor ({@link parseAnchor}); `producer` (scripts/<file>.py, its bytes
 * pinned by `producerSha256`, or builtin:<name>, nothing to hash - producer.ts); `wake` (true: the producer's
 * text, if any, goes to a turn; false: the producer runs alone, so it needs one); `model`, the turn's route as
 * PROVIDER/MODEL; `turnDeadline` (1 to 30 min, 10 min by default) and `producerDeadline` (10 s to 180 min,
 * 5 min by default), each `<n>s` or `<n>m`; `expires`, the last ET date it fires, inclusive; `enabled`; and
 * `armedAt`, when `arm` wrote it.
 *
 * FAIL CLOSED (P2-9). {@link parseStanding} refuses the whole file for any fault, every error a line opening
 * with the order it is about - `orders[<i>] (<id>): ` - and naming its key; a refused file stops every order
 * until it is fixed. Among the faults:
 * - unknown keys, at the top, in the budget and in an order;
 * - an order without its arming fields (P2-22): no `armedAt`, no `sha256`, or a script producer without
 *   `producerSha256` is `not armed: npm run desk -- arm <dir> …` - never skipped silently;
 * - an anchor whose offset would leave its session's ET date (P2-24): `open-Nm` past 570 minutes is before
 *   00:00 ET, `close+Nm` past 479 after 23:59 ET (on a 16:00 close; an early close only moves it earlier);
 * - a `close-Nm` whose N minutes cannot hold the producer's deadline, the turn's and the 5-minute grace
 *   (P2-16): a firing that starts late inside the grace must still end before the close it is about.
 *
 * THE ANCHOR. `open` and `close` are the session's, from the market clock - its DST and its early closes
 * already inside them - plus the offset; `HH:MM` is that wall time on the session's ET date, never moved by
 * an early close ({@link anchorInstant}).
 *
 * THE ARMING EDITS. `arm` and `rearm` edit the file as text, so the operator's comments, spacing and budget
 * stay as they wrote them: {@link appendOrder} adds an entry at the end of `orders:` and {@link rehashOrder}
 * rewrites one order's hash lines - and its `expires`, when `rearm --expires` extends it. Each keeps its edit
 * only when the edited text parses to exactly the old load plus that change; any other shape - a flow-style
 * list, `orders:` before another key, an order whose `- id:` is not its first line - gets the text to paste
 * by hand instead. {@link writeStanding} replaces the file in one step under the face's file lock, refusing
 * a file that changed since the edit read it.
 *
 * MODULE WEIGHT. js-yaml comes with this module, so neither the face's desk (src/desk.ts) nor the pause
 * switch (scripts/desk.ts) imports it at load: the switch's `arm` and `rearm` and the schedule load it on
 * first use. The channel-name rule comes from the leaf channel-name.ts, not channels.ts and its graph.
 * @module
 */
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { CORE_SCHEMA, load } from "js-yaml";
import { NAME_RE } from "./channel-name.ts";
import { cut, escaped } from "./echo.ts";
import { deskDir, type TurnUsage } from "./desk.ts";
import { etDayStart } from "./et.ts";
import type { MarketSession } from "./market-clock.ts";
import { formatDuration, formatProducer, parseProducer, type ProducerSpec } from "./producer.ts";
import { parseModelRoute } from "./room-rules.ts";

/* ---------- the limits ---------- */

/** The file's name in the desk's directory ({@link deskDir}). */
export const STANDING_FILE = "standing.yml";
/** The most bytes `standing.yml` may hold. */
export const STANDING_YAML_MAX_BYTES = 65_536;
/** The most bytes an order's text (`STANDING.md`) may hold, all of it UTF-8. */
export const STANDING_TEXT_MAX_BYTES = 16_384;
/** An order's text when it names no `file`. */
export const STANDING_TEXT_FILE = "STANDING.md";
/** A turn's deadline when the order names none: 10 min. */
export const DEFAULT_TURN_DEADLINE_MS = 600_000;
/** A producer's deadline when the order names none: 5 min. */
export const DEFAULT_PRODUCER_DEADLINE_MS = 300_000;
/** How long past its anchor an order is still due: 5 min. */
export const GRACE_MS = 300_000;
/** A turn's deadline: 1 to 30 min. */
export const TURN_DEADLINE_MIN_MS = 60_000;
export const TURN_DEADLINE_MAX_MS = 1_800_000;
/** A producer's deadline: 10 s to 180 min. */
export const PRODUCER_DEADLINE_MIN_MS = 10_000;
export const PRODUCER_DEADLINE_MAX_MS = 10_800_000;

/** The copy source under `strategies/` (channels.ts's own), which is never an order's directory. NAME_RE's
 * leading letter or digit already refuses it; the check stays, as createChannel keeps its own, so a change to
 * the name rule cannot make the template an order's directory. */
const TEMPLATE = "_template";

/* ---------- the reader ---------- */

/**
 * Parse a desk YAML file - `standing.yml`, `holdings.yml`, `levels.yml` - under js-yaml's CORE_SCHEMA (P2-13):
 * a date stays a string, a time is a string, a boolean is only CORE's spelling, and duplicate keys,
 * timestamps and unknown tags are refused.
 * @param text - the file's text.
 * @returns what it holds: `undefined` for an empty file, `null` for comments only.
 * @throws Error - js-yaml's first message line (`tab characters must not be used in indentation (2:1)`).
 */
export function readDeskYaml(text: string): unknown {
  try {
    return load(text, { schema: CORE_SCHEMA });
  } catch (error) {
    const first = (error instanceof Error ? error.message : String(error)).split("\n", 1)[0].trim();
    throw new Error(first === "" ? "the YAML parser failed and gave no reason" : first);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `value` is a real date written `YYYY-MM-DD` - `2026-02-30` is not - read as a New York date. */
export function isEtDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === value;
}

/** Whether `value` is an instant exactly as `Date.prototype.toISOString` writes it, as `arm` writes `armedAt`. */
function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value;
}

/* ---------- the anchors ---------- */

/** When an order fires: the session's open or close and an offset in minutes, or a wall time on its ET date. */
export type Anchor = { kind: "open" | "close"; offsetMin: number } | { kind: "time"; hour: number; minute: number };

const MOMENT_RE = /^(open|close)(?:([+-])([1-9]\d{0,2})m)?$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** The farthest an offset reaches either way, in minutes. */
const OFFSET_MAX_MIN = 600;
/** `open-Nm`'s farthest: 09:30 ET back to 00:00 ET. */
const OPEN_BEFORE_MAX_MIN = 570;
/** `close+Nm`'s farthest: 16:00 ET on to 23:59 ET. */
const CLOSE_AFTER_MAX_MIN = 479;

/**
 * Parse an anchor: `open`, `close`, `open±Nm` or `close±Nm` - N a whole number of minutes from 1 to 600 with
 * no leading zero, `open-Nm` at most 570 and `close+Nm` at most 479, so it never leaves the session's ET date
 * (P2-24) - or `HH:MM`, two digits each, 00:00 to 23:59. Nothing is trimmed, and case counts.
 * @param text - the anchor as written.
 * @returns the anchor, or `undefined` for anything else.
 */
export function parseAnchor(text: string): Anchor | undefined {
  if (typeof text !== "string") return undefined;
  const time = TIME_RE.exec(text);
  if (time !== null) return { kind: "time", hour: Number(time[1]), minute: Number(time[2]) };
  const moment = MOMENT_RE.exec(text);
  if (moment === null) return undefined;
  const kind = moment[1] === "open" ? "open" : "close";
  if (moment[2] === undefined) return { kind, offsetMin: 0 };
  const minutes = Number(moment[3]);
  if (minutes > OFFSET_MAX_MIN) return undefined;
  if (kind === "open" && moment[2] === "-" && minutes > OPEN_BEFORE_MAX_MIN) return undefined;
  if (kind === "close" && moment[2] === "+" && minutes > CLOSE_AFTER_MAX_MIN) return undefined;
  return { kind, offsetMin: moment[2] === "-" ? -minutes : minutes };
}

/**
 * Spell an anchor as {@link parseAnchor} reads it: `parseAnchor(formatAnchor(a))` is `a` again.
 * @param a - an anchor.
 */
export function formatAnchor(a: Anchor): string {
  if (a.kind === "time") return `${String(a.hour).padStart(2, "0")}:${String(a.minute).padStart(2, "0")}`;
  if (a.offsetMin === 0) return a.kind;
  return `${a.kind}${a.offsetMin < 0 ? "-" : "+"}${Math.abs(a.offsetMin)}m`;
}

/**
 * The instant an anchor names in a session: its open or close plus the offset - so `close-30m` is 17:30Z on
 * the early close of 2026-11-27 - or, for `HH:MM`, that wall time on the session's ET date
 * ({@link etDayStart} of its open), which an early close does not move.
 * @param a - the anchor.
 * @param session - the session, from the market clock.
 * @returns ms since the epoch.
 */
export function anchorInstant(a: Anchor, session: MarketSession): number {
  if (a.kind === "time") return etDayStart(Date.parse(session.open)) + a.hour * 3_600_000 + a.minute * 60_000;
  return Date.parse(a.kind === "open" ? session.open : session.close) + a.offsetMin * 60_000;
}

/** What an order runs before the close: its producer, its turn, or both - never neither, since an order with
 * neither runs nothing and is refused before its room is asked about. Each is the deadline it runs under. */
export type RoomNeed = { producerMs: number; turnMs?: number } | { producerMs?: number; turnMs: number };

/**
 * Why a `close-Nm` anchor cannot hold what must fit before the close (P2-16) - the producer's deadline when
 * there is a producer, the turn's when it wakes one, and the 5-minute grace - or `undefined` when it can, or
 * when the anchor is anything but `close-Nm`.
 * @param anchor - the anchor.
 * @param need - `producerMs`, the producer's deadline, absent without a producer; `turnMs`, the turn's
 *   deadline, absent when nothing is woken; at least one of the two.
 * @returns `close-<N>m leaves <N> min before the close; its producer (<p>), its turn (<t>) and the 5-minute
 *   grace need <sum>`, the parts present only when they count, durations as producer.ts's `formatDuration`.
 */
export function roomProblem(anchor: Anchor, need: RoomNeed): string | undefined {
  if (anchor.kind !== "close" || anchor.offsetMin >= 0) return undefined;
  const room = -anchor.offsetMin * 60_000;
  const sum = (need.producerMs ?? 0) + (need.turnMs ?? 0) + GRACE_MS;
  if (room >= sum) return undefined;
  const parts = [
    ...(need.producerMs === undefined ? [] : [`its producer (${formatDuration(need.producerMs)})`]),
    ...(need.turnMs === undefined ? [] : [`its turn (${formatDuration(need.turnMs)})`]),
  ];
  const listed = parts.length === 1 ? `${parts[0]} and ` : `${parts.join(", ")} and `;
  return `${formatAnchor(anchor)} leaves ${-anchor.offsetMin} min before the close; ${listed}the 5-minute grace need ${formatDuration(sum)}`;
}

/* ---------- the other values ---------- */

const DURATION_RE = /^(\d+)(s|m)$/;

/**
 * Read a deadline as `standing.yml` and `arm` spell it: digits, then `s` or `m`.
 * @param value - the value as parsed; only a string can be one.
 * @param minMs - the shortest allowed, inclusive.
 * @param maxMs - the longest allowed, inclusive.
 * @returns the duration in milliseconds, or `undefined` for another spelling or one out of range.
 */
export function parseStandingDuration(value: unknown, minMs: number, maxMs: number): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = DURATION_RE.exec(value);
  if (match === null) return undefined;
  const ms = Number(match[1]) * (match[2] === "s" ? 1_000 : 60_000);
  return Number.isSafeInteger(ms) && ms >= minMs && ms <= maxMs ? ms : undefined;
}

/**
 * A duration as `standing.yml` spells it: `10m` for a whole number of minutes, else seconds (`90s`).
 * @param ms - a whole number of seconds, in milliseconds.
 */
export function formatStandingDuration(ms: number): string {
  return ms % 60_000 === 0 ? `${ms / 60_000}m` : `${ms / 1_000}s`;
}

const ID_RE = /^[a-z][a-z0-9-]{0,39}$/;

/** Whether `value` is an order id: a-z, 0-9 and -, opening with a letter, at most 40 characters. */
export function isOrderId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}

/**
 * Whether `dir` is an order's directory: `desk`, or `strategies/<name>` with `<name>` a channel's name as
 * channels.ts makes one - channel-name.ts's `NAME_RE`, in NFC - and never `_template` (P2-4).
 * @param dir - the directory as written, repo-relative.
 */
export function isOrderDir(dir: unknown): dir is string {
  if (dir === "desk") return true;
  if (typeof dir !== "string" || !dir.startsWith("strategies/")) return false;
  const name = dir.slice("strategies/".length);
  return NAME_RE.test(name) && name === name.normalize("NFC") && name !== TEMPLATE;
}

/**
 * The directory an order's turn runs in (P2-4): `desk` runs in `<root>/desk/journal`, `strategies/<name>` in
 * itself.
 * @param root - the repository root.
 * @param dir - the order's `dir`.
 * @throws TypeError - for a `dir` {@link isOrderDir} refuses.
 */
export function orderCwd(root: string, dir: string): string {
  if (!isOrderDir(dir)) throw new TypeError(`orderCwd takes desk or strategies/NAME, not ${JSON.stringify(dir)}`);
  return dir === "desk" ? join(root, "desk", "journal") : join(root, "strategies", dir.slice("strategies/".length));
}

/** Whether `value` is a route: PROVIDER/MODEL, as room-rules.ts's `parseModelRoute` reads one. */
export function isModelRoute(value: unknown): value is string {
  return typeof value === "string" && parseModelRoute(value) !== undefined;
}

/**
 * The SHA-256 of `bytes` - a string's UTF-8 - as lowercase hex: the pin `arm` records and a firing checks.
 * @param bytes - the bytes, or a string.
 */
export function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const SHA256_RE = /^[0-9a-f]{64}$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*\.md$/;

/* ---------- the load ---------- */

/** One order as the face fires it. `at` is the anchor as written - always {@link formatAnchor}'s spelling. */
export interface StandingOrder {
  id: string;
  dir: string;
  file: string;
  sha256: string;
  at: string;
  anchor: Anchor;
  producer?: ProducerSpec;
  producerSha256?: string;
  wake: boolean;
  model?: string;
  turnDeadlineMs: number;
  producerDeadlineMs: number;
  expires: string;
  enabled: boolean;
  armedAt: string;
}

/** `standing.yml` read: the budget, when it sets one, and the orders - or every reason it is refused. */
export type StandingLoad = { ok: true; budget?: { dailyTokens: number }; orders: StandingOrder[] } | { ok: false; errors: string[] };

/** `standing.yml`'s keys, in the order a refusal lists them. A later section is one more key, parser and field. */
const SECTIONS: readonly string[] = ["budget", "orders"];
/** An order's keys, in the order its refusals come. */
const ORDER_KEYS: ReadonlySet<string> = new Set([
  "id", "dir", "file", "sha256", "at", "producer", "producerSha256", "wake", "model", "turnDeadline", "producerDeadline", "expires", "enabled", "armedAt",
]);
/** The most characters of a value a refusal quotes. */
const SHOWN_MAX = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A value as a refusal quotes it: a string in JSON quotes (cut at {@link SHOWN_MAX} characters), else its kind. */
function shown(value: unknown): string {
  if (typeof value === "string") {
    const chars = [...value];
    return JSON.stringify(chars.length <= SHOWN_MAX ? value : `${chars.slice(0, SHOWN_MAX - 1).join("")}…`);
  }
  if (value === null || value === undefined) return "nothing";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "a mapping";
  return String(value);
}

/** A key as a refusal names it: bare when it is a plain word, else quoted. */
function keyName(key: string): string {
  return /^[A-Za-z0-9_-]{1,40}$/.test(key) ? key : shown(key);
}

/** `budget:`, read; its faults land in `errors`. */
function parseBudget(raw: unknown, errors: string[]): { dailyTokens: number } | undefined {
  if (!isRecord(raw)) {
    errors.push("budget must be a mapping with dailyTokens");
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (key !== "dailyTokens") errors.push(`budget.${keyName(key)} is not a key budget takes (dailyTokens)`);
  }
  const tokens = raw.dailyTokens;
  if (tokens === undefined) {
    errors.push("budget.dailyTokens is missing");
    return undefined;
  }
  if (typeof tokens !== "number" || !Number.isSafeInteger(tokens) || tokens < 1) {
    errors.push(`budget.dailyTokens must be a whole number of tokens, at least 1 (got ${shown(tokens)})`);
    return undefined;
  }
  return { dailyTokens: tokens };
}

/** parseProducer's refusal of a well-formed builtin name it does not know: `unknown builtin "<name>"`. */
const UNKNOWN_BUILTIN_RE = /^unknown builtin "/;

/** parseProducer's refusal as an order's, opening with the key. Its two texts: `producer must be scripts/<file>.py
 * or builtin:<name>`, kept as it is, and `unknown builtin "<name>"`, read `producer names an unknown builtin
 * "<name>"`; any other text it may come to give is carried as `producer is refused: <text>`. */
function producerFault(error: string): string {
  if (UNKNOWN_BUILTIN_RE.test(error)) return `producer names an ${error}`;
  return error.startsWith("producer ") ? error : `producer is refused: ${error}`;
}

/** One order, read; its faults land in `errors`, each opening `orders[<i>] (<id>): `. */
function parseOrder(raw: unknown, i: number, seen: Map<string, number>, errors: string[]): StandingOrder | undefined {
  if (!isRecord(raw)) {
    errors.push(`orders[${i}]: must be a mapping of an order's keys`);
    return undefined;
  }
  const id = isOrderId(raw.id) ? raw.id : undefined;
  const lead = `orders[${i}]${id === undefined ? "" : ` (${id})`}: `;
  const before = errors.length;
  const fault = (text: string): void => {
    errors.push(`${lead}${text}`);
  };

  for (const key of Object.keys(raw)) {
    if (!ORDER_KEYS.has(key)) fault(`${keyName(key)} is not a key an order takes`);
  }
  if (raw.id === undefined) fault("id is missing");
  else if (id === undefined) fault(`id must be a-z, 0-9 and -, opening with a letter, at most 40 characters (got ${shown(raw.id)})`);
  else if (seen.has(id)) fault(`id ${id} is already orders[${seen.get(id)}]'s`);
  else seen.set(id, i);

  const dir = isOrderDir(raw.dir) ? raw.dir : undefined;
  if (raw.dir === undefined) fault("dir is missing");
  else if (dir === undefined) fault(`dir must be desk or strategies/NAME (got ${shown(raw.dir)})`);

  const file = raw.file === undefined ? STANDING_TEXT_FILE : raw.file;
  if (typeof file !== "string" || !FILE_RE.test(file)) fault(`file must be a .md file's name in the order's directory (got ${shown(raw.file)})`);

  if (raw.sha256 !== undefined && !(typeof raw.sha256 === "string" && SHA256_RE.test(raw.sha256))) {
    fault(`sha256 must be 64 lowercase hex digits (got ${shown(raw.sha256)})`);
  }

  const anchor = typeof raw.at === "string" ? parseAnchor(raw.at) : undefined;
  if (raw.at === undefined) fault("at is missing");
  else if (anchor === undefined) fault(`at must be open, close, open±Nm, close±Nm or HH:MM, on its session's ET date (got ${shown(raw.at)})`);

  let producer: ProducerSpec | undefined;
  let producerRead = true;
  if (raw.producer !== undefined) {
    const parsed = parseProducer(raw.producer);
    if ("error" in parsed) {
      producerRead = false;
      fault(producerFault(parsed.error));
    } else {
      producer = parsed;
    }
  }

  if (raw.producerSha256 !== undefined) {
    if (!(typeof raw.producerSha256 === "string" && SHA256_RE.test(raw.producerSha256))) {
      fault(`producerSha256 must be 64 lowercase hex digits (got ${shown(raw.producerSha256)})`);
    } else if (producer?.kind === "builtin") {
      fault(`producerSha256 is for a script producer; ${formatProducer(producer)} has nothing to hash`);
    } else if (producerRead && producer === undefined) {
      fault("producerSha256 is for a script producer, and this order names none");
    }
  }

  const wake = raw.wake === undefined ? true : raw.wake;
  if (typeof wake !== "boolean") fault(`wake must be true or false (got ${shown(raw.wake)})`);
  else if (!wake && producerRead && producer === undefined) fault("wake is false, so it needs a producer: an order with neither runs nothing");

  if (raw.model !== undefined && !isModelRoute(raw.model)) fault(`model must be PROVIDER/MODEL (got ${shown(raw.model)})`);

  const turnDeadlineMs = raw.turnDeadline === undefined
    ? DEFAULT_TURN_DEADLINE_MS
    : parseStandingDuration(raw.turnDeadline, TURN_DEADLINE_MIN_MS, TURN_DEADLINE_MAX_MS);
  if (turnDeadlineMs === undefined) fault(`turnDeadline must be <n>s or <n>m, from 1 min to 30 min (got ${shown(raw.turnDeadline)})`);
  const producerDeadlineMs = raw.producerDeadline === undefined
    ? DEFAULT_PRODUCER_DEADLINE_MS
    : parseStandingDuration(raw.producerDeadline, PRODUCER_DEADLINE_MIN_MS, PRODUCER_DEADLINE_MAX_MS);
  if (producerDeadlineMs === undefined) fault(`producerDeadline must be <n>s or <n>m, from 10 s to 180 min (got ${shown(raw.producerDeadline)})`);

  if (raw.expires === undefined) fault("expires is missing");
  else if (!isEtDate(raw.expires)) fault(`expires must be a date, YYYY-MM-DD (got ${shown(raw.expires)})`);

  const enabled = raw.enabled === undefined ? true : raw.enabled;
  if (typeof enabled !== "boolean") fault(`enabled must be true or false (got ${shown(raw.enabled)})`);

  if (raw.armedAt !== undefined && !isIsoInstant(raw.armedAt)) fault(`armedAt must be a UTC time as arm writes it, 2026-10-20T18:00:00.000Z (got ${shown(raw.armedAt)})`);

  /* The room rule, only once everything it reads is good - and never for an order with neither a producer nor a
   * turn, whose one fault is the line above: one fault, one line. */
  if (anchor !== undefined && producerRead && typeof wake === "boolean" && turnDeadlineMs !== undefined && producerDeadlineMs !== undefined) {
    let need: RoomNeed | undefined;
    if (wake) need = producer === undefined ? { turnMs: turnDeadlineMs } : { producerMs: producerDeadlineMs, turnMs: turnDeadlineMs };
    else if (producer !== undefined) need = { producerMs: producerDeadlineMs };
    const room = need === undefined ? undefined : roomProblem(anchor, need);
    if (room !== undefined) fault(room);
  }

  if (raw.armedAt === undefined || raw.sha256 === undefined || (producer?.kind === "script" && raw.producerSha256 === undefined)) {
    fault(`not armed: npm run desk -- arm ${dir ?? "<desk | strategies/NAME>"} …`);
  }

  if (errors.length > before) return undefined;
  return {
    id: id as string,
    dir: dir as string,
    file: file as string,
    sha256: raw.sha256 as string,
    at: raw.at as string,
    anchor: anchor as Anchor,
    ...(producer === undefined ? {} : { producer }),
    ...(raw.producerSha256 === undefined ? {} : { producerSha256: raw.producerSha256 as string }),
    wake: wake as boolean,
    ...(raw.model === undefined ? {} : { model: raw.model as string }),
    turnDeadlineMs: turnDeadlineMs as number,
    producerDeadlineMs: producerDeadlineMs as number,
    expires: raw.expires as string,
    enabled: enabled as boolean,
    armedAt: raw.armedAt as string,
  };
}

/** `orders:`, read: none for a bare key; its faults land in `errors`. */
function parseOrders(raw: unknown, errors: string[]): StandingOrder[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push("orders must be a list of orders");
    return [];
  }
  const seen = new Map<string, number>();
  const orders: StandingOrder[] = [];
  raw.forEach((entry, i) => {
    const order = parseOrder(entry, i, seen, errors);
    if (order !== undefined) orders.push(order);
  });
  return orders;
}

/**
 * Read `standing.yml` (see the module header for what it holds and what refuses it).
 * @param text - the file's text; `""` for a file that is not there.
 * @returns `{ ok: true, budget?, orders }` - the budget only when it sets one - or `{ ok: false, errors }`,
 *   every fault found: `standing.yml is <n> bytes; the limit is 65,536` or `standing.yml is not YAML: <the
 *   parser's first line>` alone, else a line per fault, an order's opening `orders[<i>] (<id>): ` (or
 *   `orders[<i>]: ` without a good id).
 */
export function parseStanding(text: string): StandingLoad {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > STANDING_YAML_MAX_BYTES) {
    return { ok: false, errors: [`${STANDING_FILE} is ${bytes.toLocaleString("en-US")} bytes; the limit is ${STANDING_YAML_MAX_BYTES.toLocaleString("en-US")}`] };
  }
  let doc: unknown;
  try {
    doc = readDeskYaml(text);
  } catch (error) {
    /* the parser's line quotes the file: cut and escaped, as a book refusal's is, since it reaches the phone */
    return { ok: false, errors: [`${STANDING_FILE} is not YAML: ${escaped(cut((error as Error).message))}`] };
  }
  if (doc === undefined || doc === null) return { ok: true, orders: [] };
  if (!isRecord(doc)) return { ok: false, errors: [`${STANDING_FILE} must be a mapping of budget: and orders:`] };
  const errors: string[] = [];
  for (const key of Object.keys(doc)) {
    if (!SECTIONS.includes(key)) errors.push(`${keyName(key)} is not a key ${STANDING_FILE} takes (${SECTIONS.join(", ")})`);
  }
  const budget = doc.budget === undefined ? undefined : parseBudget(doc.budget, errors);
  const orders = parseOrders(doc.orders, errors);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, ...(budget === undefined ? {} : { budget }), orders };
}

/** A not-armed fault as {@link parseOrder} writes it: the order's label, then `not armed: `. */
const NOT_ARMED_RE = /^(orders\[\d+\](?: \([a-z][a-z0-9-]*\))?): not armed: /;

/**
 * The orders a refused load names as not armed (P2-22), labelled as their refusals label them -
 * `orders[<i>] (<id>)`, or `orders[<i>]` without a good id - so a refusal can name the way out: such an order
 * is removed and armed again, since `arm` adds nothing to a refused file.
 * @param errors - a refused load's errors.
 * @returns the labels, in file order; none when no fault is a not-armed one.
 */
export function unarmedOrders(errors: readonly string[]): string[] {
  return errors.flatMap((error) => {
    const match = NOT_ARMED_RE.exec(error);
    return match === null ? [] : [match[1]];
  });
}

/* ---------- what the schedule reports (filled by the schedule, read by the status) ---------- */

/** One firing as the status shows it: the last of an order's, or one of the recent. */
export interface FiringSummary {
  key: string;
  order: string;
  date: string;
  kind: "finished" | "refused" | "missed" | "interrupted" | "expired";
  outcome: string;
  t: string;
  sessionId?: string;
  wallMs?: number;
  usage?: TurnUsage;
  files?: number;
}

/** A pin's state against the file on disk. */
type HashState = "ok" | "changed" | "missing" | "unknown";

/** The standing orders as the status shows them. */
export interface StandingStatus {
  file: { path: string; state: "missing" | "loaded" | "refused"; loadedAt?: string; errors?: string[] };
  ledger?: { error: string };
  calendar: {
    python: string;
    state: "unknown" | "ok" | "stale" | "failed";
    source?: string;
    today?: { date: string; closed: true } | { date: string; open: string; close: string; early: boolean };
    error?: string;
  };
  /** The last good load's orders. */
  orders: {
    id: string;
    dir: string;
    file: string;
    at: string;
    producer?: string;
    wake: boolean;
    enabled: boolean;
    expires: string;
    expired: boolean;
    hash: HashState;
    producerHash?: HashState;
    nextAnchor?: string;
    last?: FiringSummary;
  }[];
  running?: { key: string; startedAt: string; sessionId?: string };
  queued: string[];
  /** Newest first, at most 10. */
  recent: FiringSummary[];
}

/* ---------- the arming edits ---------- */

/** An order as `npm run desk -- arm` writes it: its deadlines as written, `enabled` always true. */
export interface ArmEntry {
  id: string;
  dir: string;
  file: string;
  sha256: string;
  at: string;
  producer?: string;
  producerSha256?: string;
  wake: boolean;
  model?: string;
  turnDeadline: string;
  producerDeadline: string;
  expires: string;
  armedAt: string;
}

/**
 * An entry as block YAML, one list item: the keys in {@link ArmEntry}'s order, `enabled: true` after
 * `expires`, every string scalar double-quoted (JSON's quoting, which YAML reads the same).
 * @param entry - the entry.
 * @param indent - the column of its `-`; its keys sit two further in.
 * @returns the lines, each ending in a newline.
 */
export function renderOrder(entry: ArmEntry, indent: number): string {
  const dash = " ".repeat(indent);
  const pad = " ".repeat(indent + 2);
  const q = (value: string): string => JSON.stringify(value);
  const lines = [
    `${dash}- id: ${q(entry.id)}`,
    `${pad}dir: ${q(entry.dir)}`,
    `${pad}file: ${q(entry.file)}`,
    `${pad}sha256: ${q(entry.sha256)}`,
    `${pad}at: ${q(entry.at)}`,
    ...(entry.producer === undefined ? [] : [`${pad}producer: ${q(entry.producer)}`]),
    ...(entry.producerSha256 === undefined ? [] : [`${pad}producerSha256: ${q(entry.producerSha256)}`]),
    `${pad}wake: ${entry.wake ? "true" : "false"}`,
    ...(entry.model === undefined ? [] : [`${pad}model: ${q(entry.model)}`]),
    `${pad}turnDeadline: ${q(entry.turnDeadline)}`,
    `${pad}producerDeadline: ${q(entry.producerDeadline)}`,
    `${pad}expires: ${q(entry.expires)}`,
    `${pad}enabled: true`,
    `${pad}armedAt: ${q(entry.armedAt)}`,
  ];
  return lines.map((line) => `${line}\n`).join("");
}

/** Whether a parsed order is exactly what `entry` says - checked on its own, so a slip in the rendering is caught. */
function matchesEntry(order: StandingOrder, entry: ArmEntry): boolean {
  return order.id === entry.id && order.dir === entry.dir && order.file === entry.file && order.sha256 === entry.sha256
    && order.at === entry.at
    && (order.producer === undefined ? entry.producer === undefined : formatProducer(order.producer) === entry.producer)
    && order.producerSha256 === entry.producerSha256 && order.wake === entry.wake && order.model === entry.model
    && order.turnDeadlineMs === parseStandingDuration(entry.turnDeadline, TURN_DEADLINE_MIN_MS, TURN_DEADLINE_MAX_MS)
    && order.producerDeadlineMs === parseStandingDuration(entry.producerDeadline, PRODUCER_DEADLINE_MIN_MS, PRODUCER_DEADLINE_MAX_MS)
    && order.expires === entry.expires && order.enabled && order.armedAt === entry.armedAt;
}

/** `entry` as the order it loads as, or `undefined` when it would be refused or not load as itself. */
function entryOrder(entry: ArmEntry): StandingOrder | undefined {
  const alone = parseStanding(`orders:\n${renderOrder(entry, 2)}`);
  if (!alone.ok || alone.orders.length !== 1) return undefined;
  return matchesEntry(alone.orders[0], entry) ? alone.orders[0] : undefined;
}

/** A top-level key's line: at column 0, not a comment, a list item or a document marker; the key up to its `:`. */
const TOP_KEY_RE = /^([^\s#\-][^:]*?)[ \t]*:(?:[ \t]|\r?$)/;
/** `orders:` with nothing after it but an empty list or a null - `[]`, `~` or CORE's `null` - and a comment. */
const ORDERS_LINE_RE = /^orders:[ \t]*((?:\[\]|~|null|Null|NULL)[ \t]*)?(#.*)?(\r?)$/;

/** The top-level keys of `lines`, in file order, with their line numbers. */
function topLevelKeys(lines: readonly string[]): { name: string; line: number }[] {
  const keys: { name: string; line: number }[] = [];
  lines.forEach((text, line) => {
    const match = TOP_KEY_RE.exec(text);
    if (match !== null) keys.push({ name: match[1], line });
  });
  return keys;
}

/** `text` ending in a newline, unless it is empty. */
function endingInNewline(text: string): string {
  return text === "" || text.endsWith("\n") ? text : `${text}\n`;
}

/**
 * Append an armed entry to `standing.yml`'s text: at the end of the file, under `orders:` when it is the last
 * top-level key (`orders: []` or `orders: ~` becoming `orders:`, the list's own indentation kept), or under an
 * `orders:` added at the end when there is none. The edit is kept only when the new text parses to the old
 * load plus exactly this order, the budget unchanged.
 * @param text - the file's text, `""` when there is none.
 * @param entry - the entry.
 * @returns the new text, or the error to print: `standing.yml has a shape arm cannot append to safely; add
 *   this entry under orders: by hand:\n<the entry rendered>`.
 */
export function appendOrder(text: string, entry: ArmEntry): { text: string } | { error: string } {
  const byHand = { error: `${STANDING_FILE} has a shape arm cannot append to safely; add this entry under orders: by hand:\n${renderOrder(entry, 2)}` };
  const old = parseStanding(text);
  const order = entryOrder(entry);
  if (!old.ok || order === undefined) return byHand;
  const lines = text.split("\n");
  const keys = topLevelKeys(lines);
  const at = keys.findIndex((key) => key.name === "orders");
  let next: string;
  if (at === -1) {
    next = `${endingInNewline(text)}orders:\n${renderOrder(entry, 2)}`;
  } else {
    if (at !== keys.length - 1) return byHand;
    const line = keys[at].line;
    const match = ORDERS_LINE_RE.exec(lines[line]);
    if (match === null) return byHand;
    if (match[1] !== undefined) lines[line] = `orders:${match[2] === undefined ? "" : ` ${match[2]}`}${match[3]}`;
    let indent = 2;
    for (const below of lines.slice(line + 1)) {
      const item = /^( *)-(?:[ \t]|\r?$)/.exec(below);
      if (item !== null) {
        indent = item[1].length;
        break;
      }
    }
    next = `${endingInNewline(lines.join("\n"))}${renderOrder(entry, indent)}`;
  }
  const got = parseStanding(next);
  if (!got.ok || !isDeepStrictEqual(got.budget, old.budget) || !isDeepStrictEqual(got.orders, [...old.orders, order])) return byHand;
  return { text: next };
}

/** A line rearm rewrites, at an order's key column: the key, its value - double-quoted, single-quoted or plain -
 * and a comment. */
const REWRITTEN_LINE_RE = /^( *)(sha256|producerSha256|expires):([ \t]*)("[^"]*"|'[^']*'|[^\s#'"][^\s#]*)([ \t]+#.*)?(\r?)$/;

/** What `rearm` changes in one order: its text's hash, a script producer's, and - `rearm --expires` - its last day. */
export interface OrderChange {
  sha256: string;
  producerSha256?: string;
  expires?: string;
}

/**
 * Rewrite one order's hashes in `standing.yml`'s text - and its `expires`, when `rearm --expires` extends it:
 * the `sha256:` line, and the `producerSha256:` and `expires:` lines when those are given, of the block that
 * opens `- id: <id>` (the id plain or quoted), each value written double-quoted, a comment on the line kept.
 * Each must be there exactly once. Nothing else moves; the edit is kept only when the new text parses to the
 * old load with exactly those values changed.
 * @param text - the file's text.
 * @param id - the order's id.
 * @param change - the new values.
 * @returns the new text, or the error to print: `standing.yml has a shape rearm cannot rewrite safely; set these
 *   keys of <id> by hand:` and the lines to paste.
 */
export function rehashOrder(text: string, id: string, change: OrderChange): { text: string } | { error: string } {
  const wanted = new Map<string, string>([
    ["sha256", change.sha256],
    ...(change.producerSha256 === undefined ? [] : [["producerSha256", change.producerSha256] as [string, string]]),
    ...(change.expires === undefined ? [] : [["expires", change.expires] as [string, string]]),
  ]);
  const pasted = [...wanted].map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`);
  const byHand = { error: `${STANDING_FILE} has a shape rearm cannot rewrite safely; set these keys of ${id} by hand:\n${pasted.join("\n")}` };
  const old = parseStanding(text);
  if (!old.ok || !isOrderId(id)) return byHand;
  const index = old.orders.findIndex((order) => order.id === id);
  if (index === -1) return byHand;
  const lines = text.split("\n");
  const opener = new RegExp(`^( *)- id:[ \\t]*(?:${id}|"${id}"|'${id}')[ \\t]*(?:#.*)?\\r?$`);
  const starts = lines.flatMap((line, i) => (opener.test(line) ? [i] : []));
  if (starts.length !== 1) return byHand;
  const dash = lines[starts[0]].indexOf("-");
  const rewritten = new Map<string, number>();
  for (let i = starts[0] + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (line.length - line.trimStart().length <= dash) break;
    const match = REWRITTEN_LINE_RE.exec(line);
    if (match === null || match[1].length !== dash + 2) continue;
    const [, pad, key, space, , comment = "", cr] = match;
    const value = wanted.get(key);
    if (value === undefined) continue;
    lines[i] = `${pad}${key}:${space || " "}${JSON.stringify(value)}${comment}${cr}`;
    rewritten.set(key, (rewritten.get(key) ?? 0) + 1);
  }
  if ([...wanted.keys()].some((key) => rewritten.get(key) !== 1)) return byHand;
  const next = lines.join("\n");
  const want = old.orders.map((order, i) => (i !== index ? order : {
    ...order,
    sha256: change.sha256,
    ...(change.producerSha256 === undefined ? {} : { producerSha256: change.producerSha256 }),
    ...(change.expires === undefined ? {} : { expires: change.expires }),
  }));
  const got = parseStanding(next);
  if (!got.ok || !isDeepStrictEqual(got.budget, old.budget) || !isDeepStrictEqual(got.orders, want)) return byHand;
  return { text: next };
}

/**
 * Write `standing.yml`: the desk's directory made, then - under the face's file lock on the file - the text
 * replaced in one step (`writeFileAtomic`: a sibling written 0600 and renamed over it), so a reader finds the
 * old file or the new one, never part of one, and the result is 0600 whatever was there.
 * @param home - the harness home.
 * @param text - the whole new text.
 * @param opts - `expect`, the text the edit was made from - `null` when there was no file - checked again
 *   under the lock, so an edit made from a file that has since changed is refused rather than written over it.
 * @throws Error - `it changed since it was read; run the command again` when `expect` no longer holds; else
 *   the failed step's own error (a directory or the lock that cannot be made, a write that fails).
 */
export async function writeStanding(home: string, text: string, opts: { expect?: string | null } = {}): Promise<void> {
  const dir = deskDir(home);
  const path = join(dir, STANDING_FILE);
  await mkdir(dir, { recursive: true });
  await withFileLock(path, async () => {
    if (opts.expect !== undefined) {
      let found: string | null;
      try {
        found = await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        found = null;
      }
      if (found !== opts.expect) throw new Error("it changed since it was read; run the command again");
    }
    await writeFileAtomic(path, text, { mode: 0o600 });
  });
}
