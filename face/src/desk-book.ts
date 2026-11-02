/** The desk's book: the operator's holdings (`desk/holdings.yml`) and price levels (`desk/levels.yml` and each
 * strategy's `strategies/<name>/levels.yml`), as the pre-close brief prices the desk's two - a strategy's joins it
 * only once P4 pins it at arming - and the watch (P3) and the per-strategy report (P4) read them (rulings P2-5,
 * P2-13; spec §5.5).
 *
 * THE FILES. Each is a YAML list of entries the operator writes by hand. The real files are gitignored - the
 * repository is public (B4) - and `desk/holdings.example.yml` and `desk/levels.example.yml` are the tracked
 * examples. Only the face parses them, with js-yaml's CORE_SCHEMA (standing.ts's {@link readDeskYaml}): an
 * unquoted date stays the text `2026-11-30`, a boolean is CORE's (`true`/`false`, `True`/`TRUE`), so `yes` is
 * text, and duplicate keys are refused. An empty file, or one of comments only, holds no entries, and an
 * optional key left empty (or `~`) is as if it were not there. The face never takes a price from them: prices
 * come from the Market's reads (src/market-quotes.ts).
 *
 * TWO MARKETS. A `symbol` is a US ticker ({@link SYMBOL_RE}, `NVDA`, `BRK.B`) or an A share's six digits (`600519`),
 * read by src/symbols.ts `marketOf`, and every entry carries its `market`, `us` or `cn`. An A share's code is quoted
 * in YAML (`symbol: "600519"`): unquoted, YAML reads it as a number, and a number is refused, never coerced.
 *
 * A HOLDING. `symbol`, a ticker or a six-digit A share; `qty`, a number other than 0 (below 0 is a short);
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
 * A RULE (`desk/rules.yml`, tracked: it holds no position and no price). `id`, spelled like a standing order's
 * (`^[a-z][a-z0-9-]{0,39}$`); `kind`, move_pct, gap or filing - a halt rule is refused, since the
 * Market's read carries no trading status; `symbols`, the word `holdings`, the word `levels`, or a non-empty list
 * of tickers, A shares and those two words, never `on:`; `move_pct` or `gap_pct`, above 0 and at most
 * {@link RULE_PCT_MAX}, each only on its own kind; `forms`, only on a filing rule, a list of 8-K, 8-K/A and 4, all
 * three by default; `cooldown`, the level's grammar, 30m by default, on any kind but gap - a kind's own key left
 * empty on another kind counts as absent, as any empty optional key does; `annotate`, false by default, and true
 * only with a `plan`, one line of at most 300 characters. An id is defined once: a second rule with it is refused
 * `<id> is defined twice; the first stands`, or `...; neither entry loads` when the first was refused, as a held
 * symbol is. A filing rule lists no A share -
 * filings are SEC's - but `holdings` or `levels` may hold one, and filings.ts skips it. At most {@link RULES_MAX}.
 *
 * TWO READS FOR P4. {@link readDeskFile} reads any one desk file - a strategy's `status.yaml`, the `levels.yml` a
 * firing verifies against its pin - on producer.ts's descriptor read (no link followed, no FIFO waited on, the size
 * capped), and {@link parseLevels} is {@link loadLevels} on text already read, so the report quotes exactly the bytes
 * the firing checked. {@link levelsPin} is the pin `arm` and `rearm` take on the same read.
 *
 * MODULE WEIGHT. It imports standing.ts, and js-yaml with it, so the pause switch (scripts/desk.ts) never
 * imports it eagerly: `arm` and `rearm`, which pin a strategy's `levels.yml`, load it on first use.
 * @module
 */
import { constants as fsConstants, type Stats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { cut, escaped } from "./echo.ts";
import { readFileBytes } from "./producer.ts";
import { LEVELS_NONE, isEtDate, isOrderId, readDeskYaml, sha256Hex } from "./standing.ts";
import { marketOf, SYMBOL_RE, type Market } from "./symbols.ts";

/** A ticker (src/symbols.ts, re-exported for the book's readers). */
export { SYMBOL_RE };

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

/** The kinds a rule may be. */
export const RULE_KINDS = ["move_pct", "gap", "filing"] as const;
/** The forms a filing rule may ask for; all three when it names none. */
export const FILING_FORMS = ["8-K", "8-K/A", "4"] as const;
/** The most rules `rules.yml` loads; the entries past them are one refusal. */
export const RULES_MAX = 20;
/** The most a rule's `move_pct` or `gap_pct` may be. */
export const RULE_PCT_MAX = 50;

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

/* ---------- the shapes ---------- */

/** One refusal: an entry the file holds and the load leaves out, or - with no index - the entries past a cap. */
export interface LoadRefusal {
  /** The file's repo-relative label, as the caller named it. */
  file: string;
  /** The entry's place in the file, from 0; absent for the entries past a cap. */
  index?: number;
  /** The entry's symbol, when it is a ticker or an A share's code; a refusal of the symbol itself quotes it. */
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
  market: Market;
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
  market: Market;
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

/** A rule's kind. */
export type RuleKind = (typeof RULE_KINDS)[number];
/** A form a filing rule asks for. */
export type FilingForm = (typeof FILING_FORMS)[number];

/** The symbols a rule names: the two words, and the tickers and A shares it lists, each once, as written. */
export interface SymbolSet {
  holdings: boolean;
  levels: boolean;
  symbols: string[];
}

/** One urgent-event rule, with the file and the place it came from. */
export type Rule = { file: string; index: number; id: string; symbols: SymbolSet; annotate: boolean; plan?: string } & (
  | { kind: "move_pct"; movePct: number; cooldownMs: number }
  | { kind: "gap"; gapPct: number }
  | { kind: "filing"; forms: FilingForm[]; cooldownMs: number }
);

/** A holding's keys. */
const HOLDING_KEYS: ReadonlySet<string> = new Set(["symbol", "qty", "avg_cost", "opened", "broker"]);
/** A level's keys. */
const LEVEL_KEYS: ReadonlySet<string> = new Set(["symbol", "kind", "price", "range", "when", "plan", "source", "expires", "annotate", "cooldown"]);
const LEVEL_KINDS: ReadonlySet<string> = new Set<LevelKind>(["buy_zone", "stop", "target", "watch"]);

/** A rule's keys. */
const RULE_KEYS: ReadonlySet<string> = new Set(["id", "kind", "symbols", "move_pct", "gap_pct", "forms", "cooldown", "annotate", "plan"]);
/** The keys only some kinds take, and the keys each kind takes of them. */
const KIND_ONLY_KEYS = ["move_pct", "gap_pct", "forms", "cooldown"] as const;
const KIND_KEYS: Readonly<Record<RuleKind, ReadonlySet<string>>> = {
  move_pct: new Set(["move_pct", "cooldown"]),
  gap: new Set(["gap_pct"]),
  filing: new Set(["forms", "cooldown"]),
};
const BAD_RULE_SYMBOLS = "symbols must be holdings, levels or a list of tickers, holdings and levels";

const NO_PLAN = "a level without a plan is refused: write what to do when it is reached";
const NO_EXPIRY = "a level without an expiry is refused: write expires: YYYY-MM-DD, the last day it holds";
const BAD_SYMBOL = "symbol must be a US ticker (NVDA, BRK.B) or six digits for an A share (600519)";

/* ---------- the values ---------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` is a finite number. */
function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

/** The entry's symbol, when it is a mapping whose `symbol` is a ticker or an A share's code. */
function tickerOf(raw: unknown): string | undefined {
  return isRecord(raw) && marketOf(raw.symbol) !== undefined ? raw.symbol as string : undefined;
}

/** The entry's first key outside `keys`, as a refusal names it. */
function unknownKey(raw: Record<string, unknown>, keys: ReadonlySet<string>): string | undefined {
  const key = Object.keys(raw).find((name) => !keys.has(name));
  return key === undefined ? undefined : `unknown key ${shown(key)}`;
}

/** Why `value` is neither a ticker nor an A share's code, or `undefined` when it is one. */
function symbolFault(value: unknown): string | undefined {
  if (value === undefined) return "symbol is missing";
  return marketOf(value) !== undefined ? undefined : `${BAD_SYMBOL} (got ${shown(value)})`;
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

/** Why a cooldown is refused: the level's and the rule's one reason. */
function cooldownFault(value: unknown): { reason: string } {
  return { reason: `cooldown must be <n>m, from ${COOLDOWN_MIN_MINUTES}m to ${COOLDOWN_MAX_MINUTES}m (got ${shown(value)})` };
}

/** Why an annotate is refused: the level's and the rule's one reason. */
function annotateFault(value: unknown): { reason: string } {
  return { reason: `annotate must be true or false (got ${shown(value)})` };
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
      market: marketOf(ticker) as Market,
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
  if (typeof annotate !== "boolean") return annotateFault(raw.annotate);

  const cooldown = raw.cooldown === undefined || raw.cooldown === null ? DEFAULT_LEVEL_COOLDOWN_MS : cooldownMs(raw.cooldown);
  if (cooldown === undefined) {
    return cooldownFault(raw.cooldown);
  }

  return {
    entry: {
      file,
      index,
      symbol: ticker,
      market: marketOf(ticker) as Market,
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

/** A rule's `symbols`, read: the word `holdings`, the word `levels`, or a non-empty list of tickers, A shares and
 * those words; `undefined` for anything else - an unquoted six-digit number included. */
function symbolSet(value: unknown): SymbolSet | undefined {
  const items = typeof value === "string" ? [value] : value;
  if (!Array.isArray(items) || items.length === 0) return undefined;
  const set: SymbolSet = { holdings: false, levels: false, symbols: [] };
  for (const item of items) {
    if (item === "holdings") set.holdings = true;
    else if (item === "levels") set.levels = true;
    else if (Array.isArray(value) && marketOf(item) !== undefined) {
      if (!set.symbols.includes(item as string)) set.symbols.push(item as string);
    } else return undefined;
  }
  return set;
}

/** A filing rule's `forms`: a non-empty list of 8-K, 8-K/A and 4 (CORE reads an unquoted `4` as a number), each
 * once, in {@link FILING_FORMS} order; all three when absent; `undefined` for anything else. */
function filingForms(value: unknown): FilingForm[] | undefined {
  if (value === undefined || value === null) return [...FILING_FORMS];
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const named = value.map((item) => (item === 4 ? "4" : item));
  if (!named.every((item) => (FILING_FORMS as readonly unknown[]).includes(item))) return undefined;
  return FILING_FORMS.filter((form) => named.includes(form));
}

/** One rule, judged, at `index` in `file`. `seen` maps each id an earlier rule spelled well to whether that first
 * rule loaded, and takes this rule's id when it is the first to name it - whatever its verdict. */
function judgeRule(raw: unknown, index: number, file: string, seen: Map<string, boolean>): Verdict<Rule> {
  const id = isRecord(raw) && isOrderId(raw.id) ? raw.id : undefined;
  const first = id === undefined ? undefined : seen.get(id);
  const verdict = ruleVerdict(raw, index, file, first);
  if (id !== undefined && first === undefined) seen.set(id, "entry" in verdict);
  return verdict;
}

/** One rule's verdict. `first` is whether the first rule with its id loaded; `undefined` when it is that first
 * rule. */
function ruleVerdict(raw: unknown, index: number, file: string, first: boolean | undefined): Verdict<Rule> {
  if (!isRecord(raw)) return { reason: "a rule must be a mapping: id, kind, symbols, move_pct, gap_pct, forms, cooldown, annotate, plan" };
  if ("on" in raw) return { reason: 'unknown key "on": a rule names its symbols under symbols:' };
  const unknown = unknownKey(raw, RULE_KEYS);
  if (unknown !== undefined) return { reason: unknown };

  if (raw.id === undefined) return { reason: "id is missing" };
  if (!isOrderId(raw.id)) return { reason: `id must be a-z, 0-9 and -, opening with a letter, at most 40 characters (got ${shown(raw.id)})` };
  const id = raw.id;
  if (first !== undefined) return { reason: `${id} is defined twice; ${first ? "the first stands" : "neither entry loads"}` };

  const kind = raw.kind;
  if (kind === "halt") return { reason: "halts need a trading-status feed; the Market's read carries none" };
  if (kind === undefined || kind === null) return { reason: "a rule needs kind: move_pct, gap or filing" };
  if (typeof kind !== "string" || !(RULE_KINDS as readonly string[]).includes(kind)) return { reason: "kind must be move_pct, gap or filing" };
  const ruleKind = kind as RuleKind;
  /* A key left empty is as if it were not there, here as everywhere in the book. */
  const foreign = KIND_ONLY_KEYS.find((key) => raw[key] !== undefined && raw[key] !== null && !KIND_KEYS[ruleKind].has(key));
  if (foreign !== undefined) return { reason: `${foreign} is not a key of a ${ruleKind} rule` };

  const symbols = symbolSet(raw.symbols);
  if (symbols === undefined) return { reason: BAD_RULE_SYMBOLS };
  if (ruleKind === "filing") {
    const aShare = symbols.symbols.find((symbol) => marketOf(symbol) === "cn");
    if (aShare !== undefined) return { reason: `filings are SEC's: ${aShare} is an A share` };
  }

  let body: { kind: "move_pct"; movePct: number } | { kind: "gap"; gapPct: number } | { kind: "filing"; forms: FilingForm[] };
  if (ruleKind === "filing") {
    const forms = filingForms(raw.forms);
    if (forms === undefined) return { reason: "forms must be a list of 8-K, 8-K/A and 4" };
    body = { kind: "filing", forms };
  } else {
    const key = ruleKind === "move_pct" ? "move_pct" : "gap_pct";
    const pct = raw[key];
    if (!isNumber(pct) || pct <= 0 || pct > RULE_PCT_MAX) return { reason: `${key} must be a number above 0 and at most ${RULE_PCT_MAX}` };
    body = ruleKind === "move_pct" ? { kind: "move_pct", movePct: pct } : { kind: "gap", gapPct: pct };
  }

  let cooldown: number | undefined;
  if (ruleKind !== "gap") {
    cooldown = raw.cooldown === undefined || raw.cooldown === null ? DEFAULT_LEVEL_COOLDOWN_MS : cooldownMs(raw.cooldown);
    if (cooldown === undefined) {
      return cooldownFault(raw.cooldown);
    }
  }

  const annotate = raw.annotate === undefined || raw.annotate === null ? false : raw.annotate;
  if (typeof annotate !== "boolean") return annotateFault(raw.annotate);

  let plan = "";
  if (!isBlank(raw.plan)) {
    const line = oneLine("plan", raw.plan, PLAN_MAX_CHARS);
    if ("reason" in line) return line;
    plan = line.text;
  }
  if (annotate && plan === "") return { reason: "annotate: true needs a plan: write what the check is for" };

  return {
    entry: {
      file,
      index,
      id,
      symbols,
      annotate,
      ...(plan === "" ? {} : { plan }),
      ...body,
      ...(cooldown === undefined ? {} : { cooldownMs: cooldown }),
    } as Rule,
  };
}

/**
 * The symbols a rule's set names in `book`: the union of its tickers and A shares, the book's holdings when it
 * says `holdings` and the book's levels' symbols when it says `levels`, each once, sorted.
 * @param set - the rule's symbols.
 * @param book - the symbols the book holds and the symbols its levels name.
 */
export function resolveSymbols(set: SymbolSet, book: { holdings: string[]; levels: string[] }): string[] {
  const all = new Set(set.symbols);
  if (set.holdings) for (const symbol of book.holdings) all.add(symbol);
  if (set.levels) for (const symbol of book.levels) all.add(symbol);
  return [...all].sort();
}

/**
 * How far `level` is from `last`, in percent of `last`: `(level − last) / last · 100` for a price; for a range, 0
 * inside it (its edges included), else measured to its nearest edge. Below 0 when the level is under the price.
 * Unrounded. The brief and the watch both measure with it.
 * @param level - a level as this module loads it: a price or a range.
 * @param last - the last price, above 0.
 */
export function levelDistancePct(level: Pick<Level, "price" | "range">, last: number): number {
  let edge: number;
  if (level.range !== undefined) {
    const [low, high] = level.range;
    if (last >= low && last <= high) return 0;
    edge = last < low ? low : high;
  } else {
    edge = level.price as number;
  }
  return ((edge - last) / last) * 100;
}

/* ---------- the file ---------- */

/** One desk file as {@link readDeskFile} reads it. */
export type DeskFile =
  | { state: "absent" }
  | { state: "unreadable"; reason: string }
  | { state: "oversize" }
  | { state: "ok"; bytes: Buffer; text: string };

/**
 * Read one desk file whole, on producer.ts's descriptor read (`readFileBytes`): a link at the path is never followed,
 * a FIFO never waited on, a file with a second name (a hard link) refused as the book's loaders refuse one, and at
 * most one byte past `maxBytes` is read.
 * @param path - the file.
 * @param maxBytes - the most bytes it may hold, {@link DESK_FILE_MAX_BYTES} by default.
 * @returns `absent` for `ENOENT` or `ENOTDIR`; `unreadable` with the failure's code for any other, with `not a
 *   regular file` for a link, a hard link, a FIFO, a directory or a device, and with `not UTF-8` for bytes a fatal UTF-8 decode
 *   refuses; `oversize` past `maxBytes`; else `ok`, the bytes and their text.
 */
export async function readDeskFile(path: string, maxBytes: number = DESK_FILE_MAX_BYTES): Promise<DeskFile> {
  const read = await readFileBytes(path, maxBytes, { oneName: true });
  if (read === "irregular") return { state: "unreadable", reason: "not a regular file" };
  if (read === "oversized") return { state: "oversize" };
  if (!Buffer.isBuffer(read)) {
    return read.errno === "ENOENT" || read.errno === "ENOTDIR" ? { state: "absent" } : { state: "unreadable", reason: read.errno };
  }
  try {
    return { state: "ok", bytes: read, text: new TextDecoder("utf-8", { fatal: true }).decode(read) };
  } catch {
    return { state: "unreadable", reason: "not UTF-8" };
  }
}

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
 * @param pin - the bytes' `sha256` and, when they were read from a file, its `mtime`, carried into the result.
 */
function parseBook<T>(text: string, file: string, rules: BookRules<T>, pin: { sha256: string; mtime?: string }): LoadResult<T> {
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
  return loadBook(path, file, levelRules(file, today));
}

/** How a levels file is judged, at `file` against `today`. */
function levelRules(file: string, today: string): BookRules<Level> {
  return { max: LEVELS_PER_FILE, capNoun: "levels per file", judge: (raw, index) => judgeLevel(raw, index, file, today) };
}

/**
 * {@link loadLevels} without the read: a levels file's text, already read and verified by the caller, parsed and
 * judged the same way. Its size cap is the text's UTF-8 length, its `sha256` the caller's, and it has no `mtime`.
 * `loadLevels` keeps its own read and its own `sha256`, which the watch keys on.
 * @param text - the file's text.
 * @param file - its repo-relative label, `strategies/<name>/levels.yml`.
 * @param today - the date a level's expiry is judged against, YYYY-MM-DD.
 * @param sha256 - the pin the caller verified the bytes against.
 * @throws TypeError - when `today` is not a real date written YYYY-MM-DD.
 */
export function parseLevels(text: string, file: string, today: string, sha256: string): LoadResult<Level> {
  if (!isEtDate(today)) throw new TypeError(`parseLevels takes today as YYYY-MM-DD, not ${JSON.stringify(today)}`);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > DESK_FILE_MAX_BYTES) return { file, entries: [], refusals: [], error: oversized(file, bytes), sha256 };
  return parseBook(text, file, levelRules(file, today), { sha256 });
}

/**
 * Load `rules.yml` (see the module header for its keys and refusals).
 * @param path - where it is.
 * @param file - its repo-relative label, `desk/rules.yml`, which each rule, refusal and error names.
 * @returns the rules that load, in file order, with every refusal.
 */
export async function loadRules(path: string, file: string): Promise<LoadResult<Rule>> {
  const seen = new Map<string, boolean>();
  return loadBook(path, file, { max: RULES_MAX, capNoun: "rules", judge: (raw, index) => judgeRule(raw, index, file, seen) });
}

/**
 * The pin `arm` and `rearm` take of a strategy's `levels.yml` (`levelsSha256`, P4 ruling 5): the bytes read once
 * through {@link readDeskFile} - as a firing reads them against the pin - and judged by {@link parseLevels}, so a
 * file no firing could take is never pinned.
 * @param root - the repository root.
 * @param dir - the order's directory, `strategies/<name>`.
 * @param today - the order's market date, YYYY-MM-DD: a level that expires before it is refused, as the watch
 *   refuses one.
 * @returns the bytes' sha256 and the levels that load - {@link LEVELS_NONE} and none when there is no file - or
 *   the reason not, naming `<dir>/levels.yml`: `is not a regular file`, `is not UTF-8`, `cannot be read (<code>)`,
 *   `is <n> bytes; the limit is 65,536`, or the parse's whole-file error (`must be a list of entries`, `is not
 *   YAML: …`). A refused entry is the watch's to report, not the arming's.
 */
export async function levelsPin(root: string, dir: string, today: string): Promise<{ sha256: string; levels: Level[] } | { error: string }> {
  const file = `${dir}/levels.yml`;
  const path = join(root, dir, "levels.yml");
  const read = await readDeskFile(path);
  if (read.state === "absent") return { sha256: LEVELS_NONE, levels: [] };
  if (read.state === "unreadable") {
    if (read.reason === "not a regular file") return { error: `${file} is not a regular file` };
    if (read.reason === "not UTF-8") return { error: `${file} is not UTF-8` };
    return { error: `${file} cannot be read (${read.reason})` };
  }
  if (read.state === "oversize") {
    /* the read stops one byte past the cap; the size is the file's own, when it can still be read */
    const size = await lstat(path).then((stats) => stats.size, () => DESK_FILE_MAX_BYTES + 1);
    return { error: oversized(file, Math.max(size, DESK_FILE_MAX_BYTES + 1)) };
  }
  const sha256 = sha256Hex(read.bytes);
  const parsed = parseLevels(read.text, file, today, sha256);
  if (parsed.error !== undefined) return { error: parsed.error };
  return { sha256, levels: parsed.entries };
}
