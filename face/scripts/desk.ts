/** The desk's switch from a terminal: pause the desk, and - from here only - resume it; and arm the standing
 * orders it fires on the exchange calendar. The switch is desk.ts's `OFF` file ({@link writeOff},
 * {@link clearOff}); the phone and the Desk panel can set it too, but nothing but this command, the file's
 * deletion or its own expiry lifts it. The orders are `standing.yml` beside it (src/standing.ts), which only
 * the operator writes: here, or by hand.
 * Spec: docs/superpowers/specs/2026-10-19-always-on-gravit-design.md §5.8; rulings P2-9, P2-16, P2-22, P2-24.
 *
 *   npm run desk -- pause          pause the desk until a resume
 *   npm run desk -- pause 2h       pause it for a while: Nm, Nh or Nd, a whole number of minutes, hours or days
 *   npm run desk -- resume         lift the pause
 *   npm run desk -- arm desk --id preclose --at close-30m --producer builtin:brief --expires 2026-11-30
 *                                  arm a standing order: pin its text's hash (and its script's), add it to standing.yml
 *   npm run desk -- rearm preclose take a changed text's (or script's) new hash, after reviewing the change
 *   npm run desk -- rearm preclose --expires 2026-12-31
 *                                  extend its last day, an expired order's too - refused while a pinned file has
 *                                  changed: review it and rearm first
 *
 * It acts on the harness home this shell resolves - `$DSH_HOME`, else ~/.dsh - as `npm start` and
 * `npm run service -- install` do, and pins files in the repository this script sits in. No face need be
 * running: the switch and the orders are files, which the face reads when it needs them; each set and lift of
 * the switch is a line in the desk's ledger, and the face reads `standing.yml` again within 30 s of a change.
 *
 * The export is {@link runDesk}, the commands over an injected home, printer, clock, repository root and
 * market clock, which the tests drive against temp homes. Importing this file runs nothing; run as a script,
 * the guard at the end resolves the home and exits with the command's code.
 *
 * MODULE WEIGHT. `arm` and `rearm` load src/standing.ts (with js-yaml), src/producer.ts and
 * src/market-clock.ts on their first use, so `pause` and `resume` load no more than they did.
 * @module
 */
import { existsSync, realpathSync } from "node:fs";
import { constants as fsConstants, mkdir, open, readFile, type FileHandle } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { OFF_FILE, clearOff, deskDir, deskTime, parseDuration, writeOff, type OffState } from "../src/desk.ts";
import { etDate } from "../src/et.ts";
import type { MarketClock } from "../src/market-clock.ts";

/** What {@link runDesk} prints for a command or an argument it does not know. */
const USAGE = "usage: npm run desk -- pause [Nm | Nh | Nd] | resume | arm <desk | strategies/NAME> --id ID --at ANCHOR --expires YYYY-MM-DD"
  + " [--producer scripts/FILE.py | builtin:NAME] [--model PROVIDER/MODEL] [--turn-deadline DURATION] [--producer-deadline DURATION] [--no-wake]"
  + " | rearm ID [--expires YYYY-MM-DD]";

/** The repository this script sits in: `<root>/face/scripts/desk.ts`. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** What {@link runDesk} runs over. */
export interface DeskDeps {
  /** The harness home. */
  home: string;
  /** The printer: one call per line printed. */
  out: (line: string) => void;
  /** The clock, `Date.now` by default. */
  now?: () => number;
  /** The repository whose files `arm` and `rearm` pin, this script's own by default. */
  root?: string;
  /** The market clock `arm` asks, the builtin XNYS rules (src/market-clock.ts) by default. */
  marketClock?: MarketClock;
}

/** A failure as its code when it has one (ENOTDIR, EACCES, EPERM), else its message. */
function reasonOf(err: unknown): string {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string") return code;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run one command - `npm run desk -- <cmd> [arguments]` - and return its exit code: 0 when it is done or there
 * was nothing to do, 1 when it was refused or the file could not be written or removed, 2 for a command or an
 * argument it does not know. Every line goes through `deps.out`; nothing here exits the process.
 *
 * - `pause [duration]`: writes `OFF`, set by `terminal` - with `until` the duration after `now()`
 *   when one is given ({@link parseDuration}) - and prints `paused`, or `paused until HH:MM ET`,
 *   dated `YYYY-MM-DD HH:MM ET` when that is not today in New York ({@link deskTime}). A terminal
 *   pause replaces whatever pause is there. A duration that does not parse - a zero one, one past
 *   36,500 days - or a second argument is the usage line, and nothing is written.
 * - `resume`: removes `OFF` and prints `resumed`, or `not paused` when there was none. An argument
 *   is the usage line.
 * - `arm <desk | strategies/NAME> --id ID --at ANCHOR --expires YYYY-MM-DD [--producer …] [--model …]
 *   [--turn-deadline …] [--producer-deadline …] [--no-wake]`: arms a standing order (see {@link arm}).
 * - `rearm ID [--expires YYYY-MM-DD]`: takes the new hashes of an armed order's changed files; with `--expires`,
 *   extends its last day instead, refused while a pinned file has changed (see {@link rearm}).
 *
 * A switch it cannot write or remove is one line naming the file and the error's code.
 * @param cmd - the command.
 * @param args - what follows it.
 * @param deps - `home`, the harness home; `out`, the printer; `now`, the clock, default `Date.now` - read once,
 *   where the command needs the time; `root`, the repository `arm` and `rearm` pin files in; `marketClock`, the
 *   clock `arm` asks.
 */
export async function runDesk(cmd: string, args: string[], deps: DeskDeps): Promise<number> {
  const now = deps.now ?? Date.now;
  const file = join(deskDir(deps.home), OFF_FILE);
  if (cmd === "pause" && args.length <= 1) {
    const at = now();
    const ms = args.length === 0 ? undefined : parseDuration(args[0]);
    if (args.length === 1 && ms === undefined) {
      deps.out(USAGE);
      return 2;
    }
    let state: OffState;
    try {
      state = await writeOff(deps.home, { by: "terminal", ...(ms === undefined ? {} : { until: at + ms }) }, () => at);
    } catch (err) {
      deps.out(`cannot write ${file}: ${reasonOf(err)}`);
      return 1;
    }
    deps.out(state.until === undefined ? "paused" : `paused until ${deskTime(new Date(state.until), new Date(at))}`);
    return 0;
  }
  if (cmd === "resume" && args.length === 0) {
    const at = now();
    let lifted: boolean;
    try {
      lifted = await clearOff(deps.home, "terminal", () => at);
    } catch (err) {
      deps.out(`cannot remove ${file}: ${reasonOf(err)}`);
      return 1;
    }
    deps.out(lifted ? "resumed" : "not paused");
    return 0;
  }
  if (cmd === "arm") return arm(args, deps, now());
  if (cmd === "rearm") return rearm(args, deps, now);
  deps.out(USAGE);
  return 2;
}

/* ---------- what arm and rearm load on first use ---------- */

/** src/standing.ts, src/producer.ts and src/market-clock.ts, as arm and rearm use them. */
interface Machinery {
  standing: typeof import("../src/standing.ts");
  producer: typeof import("../src/producer.ts");
  clock: typeof import("../src/market-clock.ts");
}

let machinery: Promise<Machinery> | undefined;

/** The machinery, imported on the first arm or rearm and shared after it (see the module header's MODULE WEIGHT). */
function loadMachinery(): Promise<Machinery> {
  machinery ??= Promise.all([import("../src/standing.ts"), import("../src/producer.ts"), import("../src/market-clock.ts")])
    .then(([standing, producer, clock]) => ({ standing, producer, clock }))
    .catch((err: unknown) => {
      machinery = undefined;
      throw err;
    });
  return machinery;
}

/* ---------- the files an order pins ---------- */

/**
 * An order's text, `<root>/<dir>/<file>`, read and hashed: a regular file - not a link, not a FIFO - of at most
 * `maxBytes`, all of it UTF-8.
 * @returns its sha256, or why it cannot be pinned, naming it `<dir>/<file>`: `is missing`, `is not a regular
 *   file`, `is <n> bytes; the limit is 16,384`, `is not UTF-8` or `cannot be read: <code>`.
 */
async function hashText(m: Machinery, root: string, dir: string, file: string): Promise<{ sha256: string } | { error: string }> {
  const label = `${dir}/${file}`;
  const limit = m.standing.STANDING_TEXT_MAX_BYTES;
  let handle: FileHandle;
  try {
    handle = await open(join(root, dir, file), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  } catch (err) {
    const code = reasonOf(err);
    if (code === "ENOENT" || code === "ENOTDIR") return { error: `${label} is missing` };
    if (code === "ELOOP") return { error: `${label} is not a regular file` };
    return { error: `${label} cannot be read: ${code}` };
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) return { error: `${label} is not a regular file` };
    const bytes = info.size > limit ? undefined : await handle.readFile();
    const size = bytes?.length ?? info.size;
    if (bytes === undefined || size > limit) return { error: `${label} is ${size.toLocaleString("en-US")} bytes; the limit is ${limit.toLocaleString("en-US")}` };
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { error: `${label} is not UTF-8` };
    }
    return { sha256: m.standing.sha256Hex(bytes) };
  } catch (err) {
    return { error: `${label} cannot be read: ${reasonOf(err)}` };
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * A script producer's bytes, found and read exactly as a firing finds and reads them - producer.ts's
 * `resolveScript` (a regular file whose real path lies under `<root>/scripts/`) and `readScriptBytes` (no link
 * followed, no FIFO waited on, the type and the size checked on the descriptor read) - and hashed.
 * @returns its sha256, or why not, in the firing's words: `<script> is missing`, `leaves scripts/` or `is not a
 *   regular file` - or `is over the 1,048,576-byte limit`, which no firing would read whole.
 */
async function hashScript(m: Machinery, root: string, script: string): Promise<{ sha256: string } | { error: string }> {
  const found = await m.producer.resolveScript(root, script);
  if ("error" in found) return found;
  const bytes = await m.producer.readScriptBytes(found.path);
  if (bytes === "missing") return { error: `${script} is missing` };
  if (bytes === "irregular") return { error: `${script} is not a regular file` };
  if (bytes === "oversized") return { error: `${script} is over the ${m.producer.SCRIPT_MAX_BYTES.toLocaleString("en-US")}-byte limit` };
  return { sha256: m.standing.sha256Hex(bytes) };
}

/**
 * `standing.yml`'s text: `""` and `found: false` when there is none.
 * @returns the text, or `cannot read <path>: <code>`.
 */
async function readStanding(path: string): Promise<{ text: string; found: boolean } | { error: string }> {
  try {
    return { text: await readFile(path, "utf8"), found: true };
  } catch (err) {
    if (reasonOf(err) === "ENOENT") return { text: "", found: false };
    return { error: `cannot read ${path}: ${reasonOf(err)}` };
  }
}

/** The first 12 hex digits of a hash, as the lines print it. */
const short = (sha256: string): string => `${sha256.slice(0, 12)}…`;

/**
 * Why `standing.yml` is refused, as a refusal's reason ends: its faults, and - when some are orders that are
 * not armed (P2-22) - the way out, since `arm` adds nothing to a refused file and `rearm` changes nothing in
 * one: `; remove orders[<i>] (<id>) from standing.yml, then arm it again`.
 */
function refusedFile(m: Machinery, errors: readonly string[]): string {
  const unarmed = m.standing.unarmedOrders(errors);
  if (unarmed.length === 0) return errors.join("; ");
  const named = unarmed.length === 1 ? unarmed[0] : `${unarmed.slice(0, -1).join(", ")} and ${unarmed[unarmed.length - 1]}`;
  return `${errors.join("; ")}; remove ${named} from standing.yml, then arm ${unarmed.length === 1 ? "it" : "them"} again`;
}

/**
 * Check a new last day as `arm` checks `--expires`: a real date, `YYYY-MM-DD`, not before today in New York.
 * @returns why not, or `undefined`.
 */
function expiresProblem(m: Machinery, expires: string, now: number): string | undefined {
  const today = etDate(new Date(now));
  if (!m.standing.isEtDate(expires)) return `--expires ${expires} is not a date, YYYY-MM-DD`;
  if (expires < today) return `--expires ${expires} is before today, ${today} ET`;
  return undefined;
}

/* ---------- arm ---------- */

/** arm's flags that take a value. */
const VALUE_FLAGS: ReadonlySet<string> = new Set(["--id", "--at", "--expires", "--producer", "--model", "--turn-deadline", "--producer-deadline"]);

/** arm's arguments, read: exactly one directory, each flag at most once, `--id`, `--at` and `--expires` given. */
interface ArmArgs {
  dir: string;
  flags: Map<string, string>;
  noWake: boolean;
}

/** Read arm's arguments, or `undefined` - the usage line - for an unknown flag, a flag without its value (a
 * value may not open with `--`), a flag given twice, a second directory, or a missing directory or flag. */
function parseArmArgs(args: string[]): ArmArgs | undefined {
  let dir: string | undefined;
  const flags = new Map<string, string>();
  let noWake = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--no-wake") {
      if (noWake) return undefined;
      noWake = true;
    } else if (VALUE_FLAGS.has(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--") || flags.has(arg)) return undefined;
      flags.set(arg, value);
      i += 1;
    } else if (arg.startsWith("-") || dir !== undefined) {
      return undefined;
    } else {
      dir = arg;
    }
  }
  if (dir === undefined || !flags.has("--id") || !flags.has("--at") || !flags.has("--expires")) return undefined;
  return { dir, flags, noWake };
}

/**
 * `arm <dir> --id ID --at ANCHOR --expires YYYY-MM-DD [--producer scripts/FILE.py | builtin:NAME]
 * [--model PROVIDER/MODEL] [--turn-deadline DURATION] [--producer-deadline DURATION] [--no-wake]`.
 *
 * An unknown flag or a missing value is the usage line, exit 2, before any file is read or the clock asked.
 * Then, in order: the id; the directory (`desk` or `strategies/NAME`, a trailing slash dropped);
 * `<dir>/STANDING.md` (a regular file, at most 16,384 bytes, UTF-8), hashed; the producer, a script's bytes
 * hashed as a firing reads them (`--no-wake` needs one); `--at`; `--expires`, a date not before today in New
 * York; the deadlines and the room before the close (P2-16); `--model`'s syntax; `standing.yml` loads - a file
 * refused for an order that is not armed names the way out; the id is not taken; the market clock answers for
 * today. The entry - `armedAt` now - is appended ({@link Machinery}'s `appendOrder`) and the file written 0600,
 * unless it changed since it was read.
 *
 * Prints `armed <id> in <root>: <dir>/STANDING.md sha256 <12 hex>…, at <at>, expires <date>[, producer
 * <spec>[ sha256 <12 hex>…]]; the face reads standing.yml again within 30 s`, exit 0; or one line
 * `cannot arm <id>: <reason>`, exit 1, and nothing written.
 */
async function arm(args: string[], deps: DeskDeps, now: number): Promise<number> {
  const parsed = parseArmArgs(args);
  if (parsed === undefined) {
    deps.out(USAGE);
    return 2;
  }
  const m = await loadMachinery();
  const { standing } = m;
  const { flags } = parsed;
  const dir = parsed.dir.replace(/\/+$/, "");
  const id = flags.get("--id") as string;
  const refuse = (reason: string): number => {
    deps.out(`cannot arm ${id}: ${reason}`);
    return 1;
  };
  const root = deps.root ?? REPO_ROOT;

  if (!standing.isOrderId(id)) return refuse(`--id ${id} is not an order id: a-z, 0-9 and -, opening with a letter, at most 40 characters`);
  if (!standing.isOrderDir(dir)) return refuse(`${parsed.dir} is not desk or strategies/NAME`);
  const file = standing.STANDING_TEXT_FILE;
  const text = await hashText(m, root, dir, file);
  if ("error" in text) return refuse(text.error);

  const producerFlag = flags.get("--producer");
  const spec = producerFlag === undefined ? undefined : m.producer.parseProducer(producerFlag);
  if (spec !== undefined && "error" in spec) return refuse(spec.error);
  if (spec === undefined && parsed.noWake) return refuse("--no-wake needs a --producer: an order with neither runs nothing");
  let scriptSha: string | undefined;
  if (spec?.kind === "script") {
    const script = await hashScript(m, root, spec.script);
    if ("error" in script) return refuse(script.error);
    scriptSha = script.sha256;
  }

  const atFlag = flags.get("--at") as string;
  const anchor = standing.parseAnchor(atFlag);
  if (anchor === undefined) {
    return refuse(`--at ${atFlag} is not open, close, open±Nm, close±Nm (N 1-600; open-Nm at most 570, close+Nm at most 479) or HH:MM`);
  }

  const expires = flags.get("--expires") as string;
  const expiry = expiresProblem(m, expires, now);
  if (expiry !== undefined) return refuse(expiry);

  const turnDeadline = flags.get("--turn-deadline") ?? standing.formatStandingDuration(standing.DEFAULT_TURN_DEADLINE_MS);
  const turnMs = standing.parseStandingDuration(turnDeadline, standing.TURN_DEADLINE_MIN_MS, standing.TURN_DEADLINE_MAX_MS);
  if (turnMs === undefined) return refuse(`--turn-deadline ${turnDeadline} must be <n>s or <n>m, from 1 min to 30 min`);
  const producerDeadline = flags.get("--producer-deadline") ?? standing.formatStandingDuration(standing.DEFAULT_PRODUCER_DEADLINE_MS);
  const producerMs = standing.parseStandingDuration(producerDeadline, standing.PRODUCER_DEADLINE_MIN_MS, standing.PRODUCER_DEADLINE_MAX_MS);
  if (producerMs === undefined) return refuse(`--producer-deadline ${producerDeadline} must be <n>s or <n>m, from 10 s to 180 min`);
  /* Never neither: --no-wake without a producer was refused above. */
  const room = standing.roomProblem(anchor, parsed.noWake ? { producerMs } : { ...(spec === undefined ? {} : { producerMs }), turnMs });
  if (room !== undefined) return refuse(room);

  const model = flags.get("--model");
  if (model !== undefined && !standing.isModelRoute(model)) return refuse(`--model ${model} is not PROVIDER/MODEL`);

  const path = join(deskDir(deps.home), standing.STANDING_FILE);
  const read = await readStanding(path);
  if ("error" in read) return refuse(read.error);
  const load = standing.parseStanding(read.text);
  if (!load.ok) return refuse(`${path} is refused, so nothing is added to it until it is fixed: ${refusedFile(m, load.errors)}`);
  if (load.orders.some((order) => order.id === id)) return refuse(`${id} is already armed; npm run desk -- rearm ${id} takes a changed file's new hash`);

  const calendar = m.clock.createMarketCalendar(deps.marketClock === undefined ? {} : { ask: deps.marketClock });
  const day = await calendar.today(now);
  if (!day.ok) return refuse(`the market calendar failed in ${calendar.clock}: ${day.error}`);

  const producerText = spec === undefined ? undefined : m.producer.formatProducer(spec);
  const next = standing.appendOrder(read.text, {
    id, dir, file, sha256: text.sha256, at: atFlag,
    ...(producerText === undefined ? {} : { producer: producerText }),
    ...(scriptSha === undefined ? {} : { producerSha256: scriptSha }),
    wake: !parsed.noWake,
    ...(model === undefined ? {} : { model }),
    turnDeadline, producerDeadline, expires, armedAt: new Date(now).toISOString(),
  });
  if ("error" in next) return refuse(next.error);
  try {
    await standing.writeStanding(deps.home, next.text, { expect: read.found ? read.text : null });
  } catch (err) {
    return refuse(`cannot write ${path}: ${reasonOf(err)}`);
  }
  const producerPart = producerText === undefined ? "" : `, producer ${producerText}${scriptSha === undefined ? "" : ` sha256 ${short(scriptSha)}`}`;
  deps.out(`armed ${id} in ${root}: ${dir}/${file} sha256 ${short(text.sha256)}, at ${atFlag}, expires ${expires}${producerPart}; the face reads standing.yml again within 30 s`);
  /* orders sharing an anchor run one after another: the later may start late, and a close-Nm one be held back (M5) */
  const sharing = load.orders.filter((o) => o.enabled && standing.formatAnchor(o.anchor) === standing.formatAnchor(anchor)).map((o) => o.id);
  if (sharing.length > 0) {
    deps.out(`note: ${sharing.join(", ")} also fire${sharing.length > 1 ? "" : "s"} at ${atFlag}; orders sharing an anchor run one after another, so ${id} may start late - and a close-anchored text that finishes after the close is held back`);
  }
  return 0;
}

/* ---------- rearm ---------- */

/** rearm's arguments, read: the id, and `--expires` at most once with its value; else `undefined`, the usage line. */
function parseRearmArgs(args: string[]): { id: string; expires?: string } | undefined {
  let id: string | undefined;
  let expires: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--expires") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--") || expires !== undefined) return undefined;
      expires = value;
      i += 1;
    } else if (arg.startsWith("-") || id !== undefined) {
      return undefined;
    } else {
      id = arg;
    }
  }
  return id === undefined ? undefined : { id, ...(expires === undefined ? {} : { expires }) };
}

/**
 * `rearm ID [--expires YYYY-MM-DD]`. Plain, after the operator has reviewed a change to an armed order's text -
 * or its script - it takes the new hashes. With `--expires` it moves the order's last day, which is how an
 * expired order fires again - and only that: a pinned file that changed since arming is refused, `<dir>/<file>
 * changed since arming; review it, then: npm run desk -- rearm <id>` (its text first, then its script), since an
 * expired order is never fired and so no firing has refused that edit; the plain rearm re-pins it after review,
 * and `--expires` follows.
 *
 * The order is found first; then the new date is checked as `arm` checks one (a real date, not before today in
 * New York - the clock is read there, after `standing.yml`); then the order's `<dir>/<file>` (and a script
 * producer's bytes) are hashed as `arm` hashes them. When nothing would change it prints `<id>: nothing changed
 * since arming`, exit 0; else only that order's hash lines - or, with `--expires`, its `expires:` line, the hash
 * lines written again as they were - are rewritten (`rehashOrder`; `armedAt` and everything else stay), the file
 * written only if it has not changed since it was read, and it prints `re-armed <id>: <dir>/<file> sha256 <12
 * hex>…[, <script> sha256 <12 hex>…][, expires <date>]`, exit 0. A refusal is one line, `cannot re-arm <id>:
 * <reason>` - `no such order in standing.yml` among them - exit 1, and nothing written. Other arguments are the
 * usage line, exit 2. The market clock is not asked.
 */
async function rearm(args: string[], deps: DeskDeps, now: () => number): Promise<number> {
  const parsed = parseRearmArgs(args);
  if (parsed === undefined) {
    deps.out(USAGE);
    return 2;
  }
  const { id, expires } = parsed;
  const refuse = (reason: string): number => {
    deps.out(`cannot re-arm ${id}: ${reason}`);
    return 1;
  };
  const m = await loadMachinery();
  const { standing } = m;
  const root = deps.root ?? REPO_ROOT;
  const path = join(deskDir(deps.home), standing.STANDING_FILE);
  const read = await readStanding(path);
  if ("error" in read) return refuse(read.error);
  const load = standing.parseStanding(read.text);
  if (!load.ok) return refuse(`${path} is refused, so nothing in it changes until it is fixed: ${refusedFile(m, load.errors)}`);
  const order = load.orders.find((o) => o.id === id);
  if (order === undefined) return refuse("no such order in standing.yml");
  if (expires !== undefined) {
    const expiry = expiresProblem(m, expires, now());
    if (expiry !== undefined) return refuse(expiry);
  }

  const text = await hashText(m, root, order.dir, order.file);
  if ("error" in text) return refuse(text.error);
  const script = order.producer?.kind === "script" ? order.producer.script : undefined;
  let scriptSha: string | undefined;
  if (script !== undefined) {
    const hashed = await hashScript(m, root, script);
    if ("error" in hashed) return refuse(hashed.error);
    scriptSha = hashed.sha256;
  }
  /* --expires extends what was reviewed and pinned, never an edit made since: an expired order is never fired,
   * so no firing refused that edit - re-pinning it is a plain rearm's, after the operator has read it. */
  const textMoved = text.sha256 !== order.sha256;
  const scriptMoved = script !== undefined && scriptSha !== order.producerSha256;
  if (expires !== undefined) {
    /* every pin that moved, the text first (p2-m11) */
    const changed = [...(textMoved ? [`${order.dir}/${order.file}`] : []), ...(scriptMoved ? [script] : [])];
    if (changed.length > 0) {
      return refuse(`${changed.join(" and ")} changed since arming; review ${changed.length > 1 ? "them" : "it"}, then: npm run desk -- rearm ${id}`);
    }
  }
  if (text.sha256 === order.sha256 && scriptSha === order.producerSha256 && (expires === undefined || expires === order.expires)) {
    deps.out(`${id}: nothing changed since arming`);
    return 0;
  }
  const next = standing.rehashOrder(read.text, id, {
    sha256: text.sha256,
    ...(scriptSha === undefined ? {} : { producerSha256: scriptSha }),
    ...(expires === undefined ? {} : { expires }),
  });
  if ("error" in next) return refuse(next.error);
  try {
    await standing.writeStanding(deps.home, next.text, { expect: read.found ? read.text : null });
  } catch (err) {
    return refuse(`cannot write ${path}: ${reasonOf(err)}`);
  }
  /* each pin marked when it moved, so the operator sees what the re-arm took (p2-m11) */
  const moved = (yes: boolean): string => (yes ? " (changed)" : "");
  const scriptPart = script === undefined || scriptSha === undefined ? "" : `, ${script} sha256 ${short(scriptSha)}${moved(scriptMoved)}`;
  const expiresPart = expires === undefined ? "" : `, expires ${expires}`;
  deps.out(`re-armed ${id}: ${order.dir}/${order.file} sha256 ${short(text.sha256)}${moved(textMoved)}${scriptPart}${expiresPart}`);
  return 0;
}

/* Run only as a script - the tests import runDesk. Compared as real paths, as service.ts does: a
 * checkout reached through a symlink spells the same file two ways. */
const invokedAs = process.argv[1];
if (invokedAs !== undefined && existsSync(invokedAs) && realpathSync(invokedAs) === realpathSync(fileURLToPath(import.meta.url))) {
  const [cmd = "", ...args] = process.argv.slice(2);
  const code = await runDesk(cmd, args, { home: resolveDshHome(undefined), out: (line) => console.log(line) }).catch((err: unknown) => {
    console.error(err);
    return 1;
  });
  /* Exit with the command's code once stdout has drained, as service.ts does: on macOS a pipe is
   * written asynchronously, and process.exit drops what is still queued. */
  process.stdout.write("", () => process.exit(code));
}
