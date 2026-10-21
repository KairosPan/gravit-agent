/** The desk's book: the operator's holdings (`desk/holdings.yml`) and price levels (`desk/levels.yml` and each
 * strategy's `strategies/<name>/levels.yml`), as the pre-close brief prices them and the watch (P3) and the
 * per-strategy report (P4) read them (rulings P2-5, P2-13; spec §5.5).
 *
 * THE FILES. Each is a YAML list of entries the operator writes by hand. The real files are gitignored - the
 * repository is public (B4) - and `desk/holdings.example.yml` and `desk/levels.example.yml` are the tracked
 * examples. Only the face parses them, with js-yaml's CORE_SCHEMA (standing.ts's {@link readDeskYaml}): an
 * unquoted date stays the text `2026-11-30`, a boolean is CORE's (`true`/`false`, `True`/`TRUE`), so `yes` is
 * text, and duplicate keys are refused. An empty file, or one of comments only, holds no entries, and an
 * optional key left empty (or `~`) is as if it were not there. The face never takes a price from them: prices
 * come from the quote hub.
 *
 * A HOLDING. `symbol`, a ticker ({@link SYMBOL_RE}); `qty`, a number other than 0 (below 0 is a short);
 * `avg_cost`, a number above 0; and, if wanted, `opened`, a date (YYYY-MM-DD), and `broker`, one line of at most
 * 40 characters. A symbol is held once: a second entry for a symbol is refused `<SYMBOL> is held twice; the
 * first entry stands`, or `<SYMBOL> is held twice; neither entry loads` when the first was refused for a fault
 * of its own - a verdict on places in the file, so the book never picks between two entries. At most
 * {@link HOLDINGS_MAX}.
 *
 * A LEVEL. `symbol`; `kind`, buy_zone, stop, target or watch; `price`, above 0, with `when: cross_up` or
 * `cross_down`, or `range: [low, high]`, 0 < low < high, with `when: enter`; `plan`, required: what to do when
 * it is reached, one line of at most 300 characters; `source`, where it came from, one line of at most 200;
 * `expires`, required: the last ET date it holds, inclusive, so one before `today` is refused `expired
 * <date>`; `annotate`, true by default (a plan-check turn follows the alert); `cooldown`, `<n>m` from 1 to
 * 1440, 30m by default. At most {@link LEVELS_PER_FILE} per file.
 *
 * TEXT. A plan, a source and a broker are one line each, with no line break of any kind, and are kept with
 * their ends trimmed: a folded block's final newline makes no second line, and an empty or blank source or
 * broker is left out. None may hold a control character other than a tab (C0, DEL, C1) or a direction
 * embedding, override or isolate (U+202A to U+202E, U+2066 to U+2069) - `<key> holds a control or direction
 * character` - since a plan goes to the phone verbatim. Their limits count characters (code points), not
 * UTF-16 units.
 *
 * REFUSALS ARE DATA. Where standing.yml is refused whole for any fault (fail closed), a book file loads
 * without the entries it refuses: each is one {@link LoadRefusal} with its 0-based index, its symbol when that
 * is a ticker, and its first fault - not a mapping, then an unknown key, then the keys in the order above. The
 * entries past a cap are one refusal, `entries <a>-<b> are past the cap of …`, numbered from 1, and a refused
 * entry inside the cap still takes its place. A fault of the file itself is the result's `error`, with no
 * entries: over 65,536 bytes, not a regular file, unreadable (its code), not UTF-8, not YAML (the parser's
 * first line) or not a list. A missing file is `missing`, which is no fault. What a refusal echoes - a value,
 * a key, the parser's line - is cut at 60 characters, the last a `…`, with each control, line-separator and
 * direction character written as its escape (`\u202e`), so every reason is one plain line for the phone.
 *
 * THE READ. A book file is a regular file with one name. A symbolic link, a FIFO, a device, a directory, or a
 * file with a second name (a hard link: a link count other than 1) is `<file> is not a regular file`, found by
 * `lstat` and never opened: a sandboxed session can plant a link to a file it cannot read, and the face reads
 * unsandboxed, so a followed link could echo another file's text in a refusal. The open then follows no link
 * swapped in since (`O_NOFOLLOW`; ELOOP reads the same), never waits on a FIFO (`O_NONBLOCK`), and checks the
 * type and the link count again on the descriptor that is read; at most 65,537 bytes are read. Only the file's
 * own name is checked: a directory above it that is a link is followed (channels.ts's `listChannelDirs` lists
 * no strategy that is one). `sha256` and `mtime` describe the bytes read, so a result has them whenever the
 * whole file was read: loaded, or refused as not UTF-8, not YAML or not a list.
 *
 * MODULE WEIGHT. It imports standing.ts, and js-yaml with it, so the pause switch (scripts/desk.ts) never
 * imports it eagerly: a command that needs it, as P4's `arm` will, loads it on first use.
 * @module
 */
import { constants as fsConstants, type Stats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { isEtDate, readDeskYaml, sha256Hex } from "./standing.ts";

/* ---------- the limits ---------- */

/** The most bytes a book file may hold. */
export const DESK_FILE_MAX_BYTES = 65_536;
/** The most levels one levels file loads; the entries past them are one refusal. */
export const LEVELS_PER_FILE = 40;
/** The most holdings `holdings.yml` loads; the entries past them are one refusal. */
export const HOLDINGS_MAX = 60;
/** The most characters a level's plan may hold. */
export const PLAN_MAX_CHARS = 300;
/** The most characters a level's source may hold. */
export const SOURCE_MAX_CHARS = 200;
/** A level's cooldown when it names none: 30 min. */
export const DEFAULT_LEVEL_COOLDOWN_MS = 1_800_000;
/** A ticker: a capital letter, then at most 9 of A-Z, 0-9, `.` and `-` (`BRK.B`, `BF-B`). */
export const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

/** The most characters a holding's broker may hold. */
const BROKER_MAX_CHARS = 40;
/** A cooldown's bounds, in minutes. */
const COOLDOWN_MIN_MINUTES = 1;
const COOLDOWN_MAX_MINUTES = 1_440;
/** What ends a line: a text field that holds one is more than one line. */
const LINE_BREAK_RE = /[\n\r\v\f\u0085\u2028\u2029]/;
/** What a one-line text field may not hold: a control character other than a tab (C0, DEL, C1), or a
 * direction embedding, override or isolate (U+202A to U+202E, U+2066 to U+2069). */
const UNSAFE_TEXT_RE = /[\x00-\x08\x0a-\x1f\x7f-\x9f\u{202a}-\u{202e}\u{2066}-\u{2069}]/u;
/** What an echo writes as its escape: the same, and the line and paragraph separators. */
const UNSAFE_ECHO_RE = /[\x00-\x08\x0a-\x1f\x7f-\x9f\u{2028}\u{2029}\u{202a}-\u{202e}\u{2066}-\u{2069}]/gu;
/** The most characters of a value a refusal quotes, and of the parser's line. */
const SHOWN_MAX = 60;

/* ---------- the shapes ---------- */

/** One refusal: an entry the file holds and the load leaves out, or - with no index - the entries past a cap. */
export interface LoadRefusal {
  /** The file's repo-relative label, as the caller named it. */
  file: string;
  /** The entry's place in the file, from 0; absent for the entries past a cap. */
  index?: number;
  /** The entry's symbol, when it is a ticker ({@link SYMBOL_RE}); a refusal of the symbol itself quotes it. */
  symbol?: string;
  reason: string;
}

/** A book file, loaded: its entries and its refusals; `missing` when there is no file; `error` when the file
 * itself is refused, with no entries; `sha256` and `mtime` (ISO) whenever the whole file was read. */
export interface LoadResult<T> {
  /** The file's repo-relative label, as the caller named it. */
  file: string;
  entries: T[];
  refusals: LoadRefusal[];
  missing?: true;
  error?: string;
  sha256?: string;
  mtime?: string;
}

/** One holding, as the operator typed it. */
export interface Holding {
  symbol: string;
  qty: number;
  avgCost: number;
  opened?: string;
  broker?: string;
}

/** What a level is to the operator. */
export type LevelKind = "buy_zone" | "stop" | "target" | "watch";

/** One price level, with the file and the place it came from. */
export interface Level {
  file: string;
  index: number;
  symbol: string;
  kind: LevelKind;
  price?: number;
  range?: [number, number];
  when: "cross_up" | "cross_down" | "enter";
  plan: string;
  source?: string;
  expires: string;
  annotate: boolean;
  cooldownMs: number;
}

/** A holding's keys. */
const HOLDING_KEYS: ReadonlySet<string> = new Set(["symbol", "qty", "avg_cost", "opened", "broker"]);
/** A level's keys. */
const LEVEL_KEYS: ReadonlySet<string> = new Set(["symbol", "kind", "price", "range", "when", "plan", "source", "expires", "annotate", "cooldown"]);
const LEVEL_KINDS: ReadonlySet<string> = new Set<LevelKind>(["buy_zone", "stop", "target", "watch"]);

const NO_PLAN = "a level without a plan is refused: write what to do when it is reached";
const NO_EXPIRY = "a level without an expiry is refused: write expires: YYYY-MM-DD, the last day it holds";
const BAD_SYMBOL = "symbol must be a ticker: a capital letter, then at most 9 of A-Z, 0-9, . and -";

/* ---------- the values ---------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` is a finite number. */
function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** `text` cut to {@link SHOWN_MAX} characters (code points), the last a `…` when it is cut. */
function cut(text: string): string {
  const chars = [...text];
  return chars.length <= SHOWN_MAX ? text : `${chars.slice(0, SHOWN_MAX - 1).join("")}…`;
}

/** `text` with each control, line-separator and direction character ({@link UNSAFE_ECHO_RE}) written as its
 * `\uXXXX` escape: the only form in which a refusal echoes one. */
function escaped(text: string): string {
  return text.replace(UNSAFE_ECHO_RE, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** A value as a refusal quotes it: a string in JSON quotes, {@link cut} and {@link escaped}; a list of at most
 * four plain values written out; else its kind. */
function shown(value: unknown): string {
  if (typeof value === "string") return escaped(JSON.stringify(cut(value)));
  if (value === null || value === undefined) return "nothing";
  if (Array.isArray(value)) {
    const plain = value.length <= 4 && value.every((item) => item === null || typeof item !== "object");
    return plain ? `[${value.map(shown).join(", ")}]` : "a list";
  }
  if (typeof value === "object") return "a mapping";
  return String(value);
}

/** The entry's symbol, when it is a mapping whose `symbol` is a ticker. */
function tickerOf(raw: unknown): string | undefined {
  return isRecord(raw) && typeof raw.symbol === "string" && SYMBOL_RE.test(raw.symbol) ? raw.symbol : undefined;
}

/** The entry's first key outside `keys`, as a refusal names it. */
function unknownKey(raw: Record<string, unknown>, keys: ReadonlySet<string>): string | undefined {
  const key = Object.keys(raw).find((name) => !keys.has(name));
  return key === undefined ? undefined : `unknown key ${shown(key)}`;
}

/** Why `value` is not a ticker, or `undefined` when it is one. */
function symbolFault(value: unknown): string | undefined {
  if (value === undefined) return "symbol is missing";
  return typeof value === "string" && SYMBOL_RE.test(value) ? undefined : `${BAD_SYMBOL} (got ${shown(value)})`;
}

/** Whether a text field is left blank: absent, empty, or nothing but spaces. */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/** One line of text of at most `max` characters, its ends trimmed - or why `value` is not one. */
function oneLine(key: string, value: unknown, max: number): { text: string } | { reason: string } {
  if (typeof value !== "string") return { reason: `${key} must be one line of text, at most ${max} characters (got ${shown(value)})` };
  const text = value.trim();
  if (LINE_BREAK_RE.test(text)) return { reason: `${key} must be one line` };
  if (UNSAFE_TEXT_RE.test(text)) return { reason: `${key} holds a control or direction character` };
  const chars = [...text].length;
  if (chars > max) return { reason: `${key} is ${chars.toLocaleString("en-US")} characters; the limit is ${max}` };
  return { text };
}

const COOLDOWN_RE = /^(\d+)m$/;

/** A level's cooldown in ms: `<n>m`, n from 1 to 1440; `undefined` for anything else. */
function cooldownMs(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = COOLDOWN_RE.exec(value);
  if (match === null) return undefined;
  const minutes = Number(match[1]);
  return minutes >= COOLDOWN_MIN_MINUTES && minutes <= COOLDOWN_MAX_MINUTES ? minutes * 60_000 : undefined;
}

/* ---------- the entries ---------- */

/** One entry, judged: what it loads as, or why it is refused. */
type Verdict<T> = { entry: T } | { reason: string };

/** One holding, judged. `seen` maps each ticker an earlier entry named to whether that first entry loaded, and
 * takes this entry's ticker when it is the first to name it - whatever its verdict. */
function judgeHolding(raw: unknown, seen: Map<string, boolean>): Verdict<Holding> {
  const ticker = tickerOf(raw);
  const first = ticker === undefined ? undefined : seen.get(ticker);
  const verdict = holdingVerdict(raw, first);
  if (ticker !== undefined && first === undefined) seen.set(ticker, "entry" in verdict);
  return verdict;
}

/** One holding's verdict. `first` is whether the first entry for its ticker loaded; `undefined` when it is that
 * first entry. */
function holdingVerdict(raw: unknown, first: boolean | undefined): Verdict<Holding> {
  if (!isRecord(raw)) return { reason: "a holding must be a mapping: symbol, qty, avg_cost, opened, broker" };
  const unknown = unknownKey(raw, HOLDING_KEYS);
  if (unknown !== undefined) return { reason: unknown };
  const ticker = tickerOf(raw);
  const badSymbol = symbolFault(raw.symbol);
  if (badSymbol !== undefined || ticker === undefined) return { reason: badSymbol ?? BAD_SYMBOL };
  if (first !== undefined) return { reason: `${ticker} is held twice; ${first ? "the first entry stands" : "neither entry loads"}` };

  const { qty, avg_cost: avgCost, opened, broker } = raw;
  if (qty === undefined) return { reason: "qty is missing" };
  if (!isNumber(qty) || qty === 0) return { reason: `qty must be a number other than 0 (got ${shown(qty)})` };
  if (avgCost === undefined) return { reason: "avg_cost is missing" };
  if (!isNumber(avgCost) || avgCost <= 0) return { reason: `avg_cost must be a number above 0 (got ${shown(avgCost)})` };
  const hasOpened = opened !== undefined && opened !== null;
  if (hasOpened && !isEtDate(opened)) return { reason: `opened must be a date, YYYY-MM-DD (got ${shown(opened)})` };
  let brokerText = "";
  if (!isBlank(broker)) {
    const line = oneLine("broker", broker, BROKER_MAX_CHARS);
    if ("reason" in line) return line;
    brokerText = line.text;
  }
  return {
    entry: {
      symbol: ticker,
      qty,
      avgCost,
      ...(hasOpened ? { opened: opened as string } : {}),
      ...(brokerText === "" ? {} : { broker: brokerText }),
    },
  };
}

/** One level, judged, at `index` in `file`, against the ET date `today`. */
function judgeLevel(raw: unknown, index: number, file: string, today: string): Verdict<Level> {
  if (!isRecord(raw)) {
    return { reason: "a level must be a mapping: symbol, kind, price or range, when, plan, source, expires, annotate, cooldown" };
  }
  const unknown = unknownKey(raw, LEVEL_KEYS);
  if (unknown !== undefined) return { reason: unknown };
  const ticker = tickerOf(raw);
  const badSymbol = symbolFault(raw.symbol);
  if (badSymbol !== undefined || ticker === undefined) return { reason: badSymbol ?? BAD_SYMBOL };

  const { kind, price, range, when } = raw;
  if (kind === undefined) return { reason: "kind is missing" };
  if (typeof kind !== "string" || !LEVEL_KINDS.has(kind)) return { reason: `kind must be buy_zone, stop, target or watch (got ${shown(kind)})` };

  if (price !== undefined && range !== undefined) return { reason: "price and range are both set; a level takes one or the other" };
  if (price === undefined && range === undefined) return { reason: "a level needs a price or a range" };
  let bounds: [number, number] | undefined;
  if (price !== undefined) {
    if (!isNumber(price) || price <= 0) return { reason: `price must be a number above 0 (got ${shown(price)})` };
  } else {
    if (!Array.isArray(range) || range.length !== 2 || !isNumber(range[0]) || !isNumber(range[1]) || !(range[0] > 0 && range[0] < range[1])) {
      return { reason: `range must be [low, high] with 0 < low < high (got ${shown(range)})` };
    }
    bounds = [range[0], range[1]];
  }

  if (when === undefined) return { reason: "when is missing: cross_up or cross_down with a price, enter with a range" };
  if (when !== "cross_up" && when !== "cross_down" && when !== "enter") {
    return { reason: `when must be cross_up, cross_down or enter (got ${shown(when)})` };
  }
  if (bounds === undefined && when === "enter") return { reason: "when: enter takes a range; with a price, when is cross_up or cross_down" };
  if (bounds !== undefined && when !== "enter") return { reason: `when: ${when} takes a price; with a range, when is enter` };

  if (isBlank(raw.plan)) return { reason: NO_PLAN };
  const plan = oneLine("plan", raw.plan, PLAN_MAX_CHARS);
  if ("reason" in plan) return plan;

  let source = "";
  if (!isBlank(raw.source)) {
    const line = oneLine("source", raw.source, SOURCE_MAX_CHARS);
    if ("reason" in line) return line;
    source = line.text;
  }

  const expires = raw.expires;
  if (isBlank(expires)) return { reason: NO_EXPIRY };
  if (!isEtDate(expires)) return { reason: `expires must be a date, YYYY-MM-DD (got ${shown(expires)})` };
  if (expires < today) return { reason: `expired ${expires}` };

  const annotate = raw.annotate === undefined || raw.annotate === null ? true : raw.annotate;
  if (typeof annotate !== "boolean") return { reason: `annotate must be true or false (got ${shown(raw.annotate)})` };

  const cooldown = raw.cooldown === undefined || raw.cooldown === null ? DEFAULT_LEVEL_COOLDOWN_MS : cooldownMs(raw.cooldown);
  if (cooldown === undefined) {
    return { reason: `cooldown must be <n>m, from ${COOLDOWN_MIN_MINUTES}m to ${COOLDOWN_MAX_MINUTES}m (got ${shown(raw.cooldown)})` };
  }

  return {
    entry: {
      file,
      index,
      symbol: ticker,
      kind: kind as LevelKind,
      ...(bounds === undefined ? { price: price as number } : { range: bounds }),
      when,
      plan: plan.text,
      ...(source === "" ? {} : { source }),
      expires,
      annotate,
      cooldownMs: cooldown,
    },
  };
}

/* ---------- the file ---------- */

/** A book file as read: missing, refused whole, or its text. */
type BookRead =
  | { missing: true }
  | { error: string; sha256?: string; mtime?: string }
  | { text: string; sha256: string; mtime: string };

/** An errno's code, or the error's message when it has none. */
function codeOf(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === "string") return code;
  return error instanceof Error ? error.message : String(error);
}

/** `<file> is <n> bytes; the limit is 65,536`. */
function oversized(file: string, bytes: number): string {
  return `${file} is ${bytes.toLocaleString("en-US")} bytes; the limit is ${DESK_FILE_MAX_BYTES.toLocaleString("en-US")}`;
}

/** Whether a file's stats are a book file's own: a regular file with one name. */
function isPlainFile(stats: Stats): boolean {
  return stats.isFile() && stats.nlink === 1;
}

/**
 * Read a book file (see the module header): ENOENT is missing; a link, a FIFO, a device, a directory, a file with
 * a second name, a failed open or read, over 65,536 bytes, or bytes that are not UTF-8 are refused whole.
 * @param path - where it is.
 * @param file - its repo-relative label, for the refusals.
 */
async function readBook(path: string, file: string): Promise<BookRead> {
  const irregular = { error: `${file} is not a regular file` };
  try {
    /* Judged before any open: a link is never followed, and nothing but a plain file is opened. */
    if (!isPlainFile(await lstat(path))) return irregular;
  } catch (error) {
    const code = codeOf(error);
    return code === "ENOENT" ? { missing: true } : { error: `${file} cannot be read (${code})` };
  }
  let handle: FileHandle | undefined;
  try {
    /* A link swapped in since the lstat is ELOOP, and the descriptor is judged again. */
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW);
    const stats = await handle.stat();
    if (!isPlainFile(stats)) return irregular;
    if (stats.size > DESK_FILE_MAX_BYTES) return { error: oversized(file, stats.size) };
    /* One byte past the limit tells a file that grew since the stat, with no read of the rest. */
    const buffer = Buffer.alloc(DESK_FILE_MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > DESK_FILE_MAX_BYTES) return { error: oversized(file, Math.max(length, (await handle.stat()).size)) };
    const bytes = buffer.subarray(0, length);
    const pin = { sha256: sha256Hex(bytes), mtime: stats.mtime.toISOString() };
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), ...pin };
    } catch {
      return { error: `${file} is not UTF-8`, ...pin };
    }
  } catch (error) {
    const code = codeOf(error);
    if (code === "ELOOP") return irregular;
    return code === "ENOENT" ? { missing: true } : { error: `${file} cannot be read (${code})` };
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** How a list of entries is judged: its cap, the noun its cap refusal ends with, and one entry's verdict. */
interface BookRules<T> {
  max: number;
  capNoun: string;
  judge: (raw: unknown, index: number) => Verdict<T>;
}

/**
 * Parse a book file's text: CORE_SCHEMA YAML, a list, each entry within the cap judged in order.
 * @param text - the file's text.
 * @param file - its repo-relative label.
 * @param rules - the cap and the entry's judge.
 * @param pin - the bytes' `sha256` and `mtime`, carried into the result.
 */
function parseBook<T>(text: string, file: string, rules: BookRules<T>, pin: { sha256: string; mtime: string }): LoadResult<T> {
  const refused = (error: string): LoadResult<T> => ({ file, entries: [], refusals: [], error, ...pin });
  let doc: unknown;
  try {
    doc = readDeskYaml(text);
  } catch (error) {
    /* readDeskYaml gives the parser's first line, never its snippet; a tag's or an alias's name can still make it
     * long, or put a direction character in it. */
    return refused(`${file} is not YAML: ${escaped(cut((error as Error).message))}`);
  }
  if (doc === undefined || doc === null) return { file, entries: [], refusals: [], ...pin };
  if (!Array.isArray(doc)) return refused(`${file} must be a list of entries`);
  const entries: T[] = [];
  const refusals: LoadRefusal[] = [];
  doc.slice(0, rules.max).forEach((raw: unknown, index) => {
    const verdict = rules.judge(raw, index);
    if ("entry" in verdict) {
      entries.push(verdict.entry);
    } else {
      const symbol = tickerOf(raw);
      refusals.push({ file, index, ...(symbol === undefined ? {} : { symbol }), reason: verdict.reason });
    }
  });
  if (doc.length > rules.max) {
    refusals.push({ file, reason: `entries ${rules.max + 1}-${doc.length} are past the cap of ${rules.max} ${rules.capNoun}` });
  }
  return { file, entries, refusals, ...pin };
}

/** Read and parse a book file. */
async function loadBook<T>(path: string, file: string, rules: BookRules<T>): Promise<LoadResult<T>> {
  const read = await readBook(path, file);
  if ("missing" in read) return { file, entries: [], refusals: [], missing: true };
  if ("error" in read) return { file, entries: [], refusals: [], ...read };
  return parseBook(read.text, file, rules, { sha256: read.sha256, mtime: read.mtime });
}

/* ---------- the loaders ---------- */

/**
 * Load `holdings.yml` (see the module header for its keys and refusals).
 * @param path - where it is.
 * @param file - its repo-relative label, `desk/holdings.yml`, which every refusal and error names.
 * @returns the holdings that load, in file order, with every refusal.
 */
export async function loadHoldings(path: string, file: string): Promise<LoadResult<Holding>> {
  const seen = new Map<string, boolean>();
  return loadBook(path, file, { max: HOLDINGS_MAX, capNoun: "holdings", judge: (raw) => judgeHolding(raw, seen) });
}

/**
 * Load a `levels.yml` (see the module header for its keys and refusals).
 * @param path - where it is.
 * @param file - its repo-relative label (`desk/levels.yml`, `strategies/<name>/levels.yml`), which each level,
 *   refusal and error names.
 * @param today - the ET date, YYYY-MM-DD: a level that expires before it is refused.
 * @returns the levels that load, in file order, with every refusal.
 * @throws TypeError - when `today` is not a real date written YYYY-MM-DD.
 */
export async function loadLevels(path: string, file: string, today: string): Promise<LoadResult<Level>> {
  if (!isEtDate(today)) throw new TypeError(`loadLevels takes today as YYYY-MM-DD, not ${JSON.stringify(today)}`);
  return loadBook(path, file, { max: LEVELS_PER_FILE, capNoun: "levels per file", judge: (raw, index) => judgeLevel(raw, index, file, today) });
}
