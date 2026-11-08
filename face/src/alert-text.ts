// face/src/alert-text.ts
/** The alert copy: every line the watch sends the phone, and the text it posts the desk - pure. src/watch.ts reads
 * it; nothing on the desk's own import path does (the plan's module weight).
 *
 * THE STAMP (M4, M11). A price is stamped with its feed, upper-cased, and its exchange's time: a US share's as
 * desk-tools.ts `quoteTime` writes it (`ROBINHOOD 10:21:03 ET`, `CBOE DELAYED 10:05:00 ET`), an A share's as its
 * `cnQuoteTime` does (`TENCENT 14:03:12 Beijing`), each dated when not `now`'s date on its own clock - so the phone
 * and `desk_quotes` stamp one print alike. A stamp never
 * names a process: the price is the Market's read, and the feed made it.
 *
 * THE ALERT (spec §5.9). Its lines, in order:
 * - **A level or a price rule:** `<SYMBOL> <price> · <stamp>`; what fired - `<kind> <price | low-high> <when>[ · gap]
 *   · <file>[ · <levelSource>]`, `<id>: the move from the previous close reached <pct>%[ · gap] · <file>` or `<id>:
 *   the first print is <pct>% or more from the previous close · gap · <file>`; the holding, `held <qty> @ <avg cost,
 *   2 dp>[ · day P&L <signed, en-US, 2 dp>]` or `not held`; `plan: <plan>`, verbatim, when there is one; and `day:
 *   <signed %, 2 dp> from the previous close <prevClose>` or `day: no previous close yet`.
 * - **A filing:** `<SYMBOL> <form> · accepted <HH:MM:SS> ET · filed <date>` (`accepted time unknown` without one);
 *   `items <a>, <b>` when it lists any; its URL; `<rule id> · <file> · <holding>`; and its plan, when it has one.
 * - **The note,** last: `annotation follows`, the budget's `no annotation: …`, or nothing.
 *
 * THE WHY POST (spec §5.3, §5.4). {@link whyPost} posts the desk a US price move's alerts with what may explain them:
 * each symbol's headlines from the Market (src/market-news.ts) and its EDGAR filings, then {@link WHY_INSTRUCTIONS},
 * the reply's shape - cut to {@link WHY_POST_MAX} by its headlines alone.
 *
 * Prices print as the feed gave them. A change and a P&L carry their sign, and a zero none, as rounded.
 *
 * THE WATCH'S LINES. {@link WATCH_LINES} renders the plan's phone-line table, row for row. A row is one line of at
 * most {@link LINE_MAX} characters (code points), cut with a `…`: the lists the table cuts, and any error or reason
 * a row quotes.
 * @module
 */
import { deskTime } from "./desk.ts";
import type { AlertMessageSource, DeskSource } from "./desk-session.ts";
import type { LevelKind, LoadRefusal, Level } from "./desk-book.ts";
import { cnQuoteTime, quoteTime } from "./desk-tools.ts";
import type { Filing } from "./edgar.ts";
import { etClock } from "./et.ts";
import { FILINGS_SYMBOLS_MAX } from "./filings.ts";
import type { Headline, NewsAnswer } from "./market-news.ts";
import type { Market } from "./symbols.ts";
import type { AlertHit, QuoteSnap } from "./watch-eval.ts";

/** The most items the overflow line lists (ruling 5); the rest are counted. */
export const BATCH_ITEMS_MAX = 20;
/** The longest phone line the watch sends of its own, in characters (code points). */
const LINE_MAX = 500;

/** Every line break of any kind, as desk-book.ts's `LINE_BREAK_RE` names them. */
const LINE_BREAKS_RE = /[\n\r\v\f\u0085\u2028\u2029]+/g;

/** `text` as one line: each run of line breaks a space. */
const oneLine = (text: string): string => text.replace(LINE_BREAKS_RE, " ");

/** `text` as one line, cut to `max` characters (code points), the last a `…` when it is cut, as desk.ts cuts its own. */
function cut(text: string, max = LINE_MAX): string {
  const line = oneLine(text);
  const chars = [...line];
  return chars.length <= max ? line : `${chars.slice(0, max - 1).join("")}…`;
}

/** `n` to two places with its sign: `+1.50`, `-2.43`, and `0.00` for a zero as rounded - en-US grouped when asked. */
function signed(n: number, grouped: boolean): string {
  const abs = grouped
    ? Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : Math.abs(n).toFixed(2);
  if (/^[0.,]*$/.test(abs)) return abs;
  return `${n < 0 ? "-" : "+"}${abs}`;
}

/**
 * A price's stamp: its feed, upper-cased, and its exchange time - `ROBINHOOD 10:21:03 ET`, `TENCENT 14:03:12 Beijing`,
 * dated on another date of its own clock; with no feed, the time alone. A time `Date` cannot read stays as given.
 * @param snap - the print an alert read.
 * @param now - the time it is read at.
 */
export function priceStamp(snap: QuoteSnap, now: number): string {
  return (snap.market === "us" ? quoteTime : cnQuoteTime)(snap.feed, snap.asOf, now);
}

/** The holding line: `held 100 @ 120.50`, with the day's P&L when the print carries a previous close; `not held`. */
function holdingLine(hit: AlertHit): string {
  if (hit.holding === null) return "not held";
  const head = `held ${hit.holding.qty} @ ${hit.holding.avgCost.toFixed(2)}`;
  const q = hit.quote;
  if (q === null || q.prevClose === null || !(q.prevClose > 0)) return head;
  return `${head} · day P&L ${signed(hit.holding.qty * (q.price - q.prevClose), true)}`;
}

/** The day's line: the print's change, else read from its previous close. */
function dayLine(q: QuoteSnap | null): string {
  if (q === null || q.prevClose === null || !(q.prevClose > 0)) return "day: no previous close yet";
  const pct = q.chgPct ?? ((q.price - q.prevClose) / q.prevClose) * 100;
  return `day: ${signed(pct, false)}% from the previous close ${q.prevClose}`;
}

/** What a level or a price rule fired on: line 2 of its alert. */
function firedLine(hit: AlertHit): string {
  const t = hit.trigger;
  const gap = hit.gap ? " · gap" : "";
  const file = hit.source.file;
  switch (t.type) {
    case "level": {
      const at = t.range !== undefined ? `${t.range[0]}-${t.range[1]}` : String(t.price);
      return `${t.kind} ${at} ${t.when}${gap} · ${file}${t.levelSource !== undefined ? ` · ${t.levelSource}` : ""}`;
    }
    case "move":
      return `${t.rule}: the move from the previous close reached ${t.pct}%${gap} · ${file}`;
    case "gap":
      return `${t.rule}: the first print is ${t.pct}% or more from the previous close · gap · ${file}`;
    case "filing":
      return `${t.rule} · ${file} · ${holdingLine(hit)}`;
  }
}

/**
 * An alert as the phone shows it, in spec §5.9's order (see the module header).
 * @param hit - the alert's record.
 * @param now - the time it is sent at, for the stamp's date.
 * @param note - `follows` when an annotation will reply, `budget` when the day's tokens are spent, `none` for neither.
 */
export function alertText(hit: AlertHit, now: number, note: "follows" | "budget" | "none"): string {
  const t = hit.trigger;
  const lines: string[] = [];
  if (t.type === "filing") {
    const at = t.accepted === null ? Number.NaN : Date.parse(t.accepted);
    const accepted = Number.isNaN(at) ? "accepted time unknown" : `accepted ${etClock(new Date(at))} ET`;
    lines.push(`${hit.symbol} ${oneLine(t.form)} · ${accepted} · filed ${oneLine(t.filingDate)}`);
    const items = (t.items ?? "").split(",").map((i) => oneLine(i).trim()).filter((i) => i !== "");
    if (items.length > 0) lines.push(`items ${items.join(", ")}`);
    lines.push(oneLine(t.url), firedLine(hit));
    if (hit.plan !== null) lines.push(`plan: ${hit.plan}`);
  } else {
    const q = hit.quote;
    lines.push(q === null ? `${hit.symbol} no price` : `${hit.symbol} ${q.price} · ${priceStamp(q, now)}`);
    lines.push(firedLine(hit), holdingLine(hit));
    if (hit.plan !== null) lines.push(`plan: ${hit.plan}`);
    lines.push(dayLine(q));
  }
  if (note === "follows") lines.push("annotation follows");
  else if (note === "budget") lines.push("no annotation: the desk's token budget for today is spent");
  return lines.join("\n");
}

/**
 * The overflow row: `<n> more alerts suppressed: <SYMBOL> <label> <HH:MM ET>, …[, and <k> more]`, each at the time
 * it was held, at most {@link BATCH_ITEMS_MAX} listed; `1 more alert suppressed: …` for one; empty for none.
 * @param hits - the held alerts, in the order held.
 * @param now - the time the batch goes, for the items' dates.
 */
export function batchText(hits: readonly AlertHit[], now: number): string {
  if (hits.length === 0) return "";
  const at = new Date(now);
  const items = hits.slice(0, BATCH_ITEMS_MAX).map((h) => `${h.symbol} ${h.label} ${deskTime(new Date(h.t), at)}`);
  const rest = hits.length - items.length;
  const head = hits.length === 1 ? "1 more alert suppressed" : `${hits.length} more alerts suppressed`;
  return `${head}: ${items.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`;
}

/** The most orphans the lost line names (spec §16 H2); the rest are counted. */
const LOST_ITEMS_MAX = 5;

/**
 * An orphan sent late at the ledger's first read (spec §16 H2): `late: the face restarted before this alert was sent
 * (raised <time>)`, then its alert text with no note - a replay is never annotated, since a check would read a market
 * that has moved.
 * @param hit - the orphan's record.
 * @param now - the time it is sent at.
 */
export function lateAlertText(hit: AlertHit, now: number): string {
  const raised = deskTime(new Date(hit.t), new Date(now));
  return `late: the face restarted before this alert was sent (raised ${raised})\n${alertText(hit, now, "none")}`;
}

/**
 * The lost orphans' line (spec §16 H2): `<n> alerts raised before a restart were never sent: <SYMBOL> <label>
 * <time>, …[, and <k> more]`, at most {@link LOST_ITEMS_MAX} named; `1 alert raised before a restart was never sent:
 * …` for one; empty for none.
 * @param hits - the lost orphans, in the ledger's order.
 * @param now - the time the line goes, for the items' dates.
 */
export function lostAlertsLine(hits: readonly AlertHit[], now: number): string {
  if (hits.length === 0) return "";
  const at = new Date(now);
  const items = hits.slice(0, LOST_ITEMS_MAX).map((h) => `${h.symbol} ${h.label} ${deskTime(new Date(h.t), at)}`);
  const rest = hits.length - items.length;
  const head = hits.length === 1 ? "1 alert raised before a restart was never sent" : `${hits.length} alerts raised before a restart were never sent`;
  return cut(`${head}: ${items.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`);
}

/**
 * A pass's annotation post: each alert's text, a blank line between, with no note. One alert keeps its rule's form
 * (`[alert · <SYMBOL> · <label>]`, the message naming the alert); several are `[alerts · <n> · …]`, the message
 * naming the pass and the symbols, each once, joined by `,`. Either message carries the pass as `pass`, which the
 * annotation lane's `annotated` record names (src/annotator.ts).
 * @param hits - the pass's delivered alerts, in order.
 * @param pass - the pass's id.
 * @param now - the time of the post.
 */
export function annotationPost(hits: readonly AlertHit[], pass: string, now: number): { text: string; source: DeskSource; message: AlertMessageSource } {
  const text = hits.map((h) => alertText(h, now, "none")).join("\n\n");
  const only = hits.length === 1 ? hits[0] : undefined;
  if (only !== undefined) {
    return { text, source: { kind: "alert", symbol: only.symbol, rule: only.label }, message: { kind: "alert", alert: only.id, symbol: only.symbol, pass } };
  }
  const symbols = [...new Set(hits.map((h) => h.symbol))].join(",");
  return { text, source: { kind: "alerts", count: hits.length }, message: { kind: "alert", alert: pass, symbol: symbols, pass } };
}

/* ---------- the why post ---------- */

/** The longest why post, in characters (code points): only its headlines are cut to fit it. */
export const WHY_POST_MAX = 12_000;

/** The why post's last block, verbatim: what to find and the reply's shape (spec §5.4). */
export const WHY_INSTRUCTIONS = [
  "Explain why this moved. Answer in Chinese, plain text, at most 4,000 characters. For each symbol, in this shape (a shared cause first when several moved together):",
  "<SYMBOL> <盘前|盘中|盘后> <±x.x%> · <the cause in a few words>",
  "<one label>",
  "· <a fact, with its numbers>",
  "· <a fact, with its numbers>",
  "· <它自己|整个板块|大盘>：QQQ <±x.x%>，<its sector ETF> <±x.x%>，<two or three peers> <±x.x%>",
  "· 计划：<the plan the alert quotes> → <满足|未满足>（<the measurement>） — only when the alert quotes a plan",
  "来源：<outlet or filing> <HH:MM ET> · <outlet or filing> <HH:MM ET>",
  "The label is exactly one of: 公司公布 · 确定 — the company's own filing, release or statement says what happened; 媒体报道 — a named outlet reports a concrete event the company has not confirmed; 媒体解读 · 公司没发公告 — outlets put the move down to sentiment, flows, a sector or a macro event; 没找到明确原因 — nothing fits, and then say what you checked.",
  "For an index, name the sectors leading the move instead of peers. Price QQQ, SPY, the sector ETF and the peers in one desk_quotes call. Open a page with web_fetch when a headline is not enough. Never state a cause without a source, an outlet's claim as the company's, or an older story as today's cause, and never advise a trade.",
].join("\n");

/** What a why post reads besides its alerts: each symbol's headlines, and its filings of the last 24 hours (the
 * caller's window) or why none could be read. A symbol missing from `news` was not read; from `filings`, has none. */
export interface WhyContext {
  news: Map<string, NewsAnswer>;
  filings: Map<string, Filing[]> | { unavailable: string };
}

/** `text`'s length in characters (code points). */
const charCount = (text: string): number => [...text].length;

/** An instant as the desk writes it, `10:05 ET`, dated when not `at`'s date; a time `Date` cannot read stays as given. */
function whenOf(time: string, at: Date): string {
  const ms = Date.parse(time);
  return Number.isNaN(ms) ? oneLine(time) : deskTime(new Date(ms), at);
}

/** A headline's line: `- <time> · <outlet> · <title> · <url>`. */
const headlineLine = (h: Headline, at: Date): string =>
  `- ${whenOf(h.time, at)} · ${oneLine(h.outlet)} · ${oneLine(h.title)} · ${oneLine(h.url)}`;

/** A filing's line: `- <form>[ · items <a>, <b>] · accepted <time> · <url>`, `accepted time unknown` without one. */
function filingLine(f: Filing, at: Date): string {
  const parts = [oneLine(f.form)];
  const items = (f.items ?? "").split(",").map((i) => oneLine(i).trim()).filter((i) => i !== "");
  if (items.length > 0) parts.push(`items ${items.join(", ")}`);
  parts.push(f.accepted === null || Number.isNaN(Date.parse(f.accepted)) ? "accepted time unknown" : `accepted ${whenOf(f.accepted, at)}`);
  parts.push(oneLine(f.url));
  return `- ${parts.join(" · ")}`;
}

/** Newest first; a time `Date` cannot read counts as the oldest. The sort is stable. */
function newestFirst(headlines: readonly Headline[]): Headline[] {
  const ms = (h: Headline): number => {
    const t = Date.parse(h.time);
    return Number.isNaN(t) ? -Infinity : t;
  };
  return [...headlines].sort((a, b) => ms(b) - ms(a));
}

/**
 * A US price move's why post (spec §5.3): the alerts, each with no note, a blank line between; then per alerted
 * symbol, each once in the alerts' order, `Headlines for <SYM>:` with its lines newest first, `: none` or
 * `: unavailable: <reason>`; then per symbol `Filings for <SYM> in the last 24 h:` likewise; then
 * {@link WHY_INSTRUCTIONS}. Past {@link WHY_POST_MAX} the oldest headline of the symbol keeping the most is dropped,
 * the first such symbol first, until the post fits or none is left - so each symbol loses its oldest in turn - and a
 * symbol that lost any says `- <n> older headlines left out for length`; an alert, a filing or the instructions are
 * never cut. Its source and message are {@link annotationPost}'s.
 * @param hits - the delivered alerts, in order.
 * @param pass - the pass's id.
 * @param now - the time of the post.
 * @param ctx - the headlines and filings read for the alerted symbols.
 */
export function whyPost(hits: readonly AlertHit[], pass: string, now: number, ctx: WhyContext): { text: string; source: DeskSource; message: AlertMessageSource } {
  const { source, message } = annotationPost(hits, pass, now);
  const at = new Date(now);
  const alerts = hits.map((h) => alertText(h, now, "none"));
  const symbols = [...new Set(hits.map((h) => h.symbol))];
  const news = symbols.map((symbol): { unavailable: string } | { lines: string[] } => {
    const answer = ctx.news.get(symbol);
    if (answer === undefined) return { unavailable: "not read" };
    if ("unavailable" in answer) return { unavailable: oneLine(answer.unavailable) };
    return { lines: newestFirst(answer.headlines).map((h) => headlineLine(h, at)) };
  });
  const filings = symbols.map((symbol) => {
    const head = `Filings for ${symbol} in the last 24 h:`;
    if (!(ctx.filings instanceof Map)) return `${head} unavailable: ${oneLine(ctx.filings.unavailable)}`;
    const list = ctx.filings.get(symbol) ?? [];
    return list.length === 0 ? `${head} none` : [head, ...list.map((f) => filingLine(f, at))].join("\n");
  });
  const keep = news.map((n) => ("lines" in n ? n.lines.length : 0));
  const compose = (): string => {
    const headlines = symbols.map((symbol, i) => {
      const head = `Headlines for ${symbol}:`;
      const n = news[i]!;
      if ("unavailable" in n) return `${head} unavailable: ${n.unavailable}`;
      if (n.lines.length === 0) return `${head} none`;
      const out = keep[i]!;
      const left = n.lines.length - out;
      const tail = left > 0 ? [`- ${left} older headline${left === 1 ? "" : "s"} left out for length`] : [];
      return [head, ...n.lines.slice(0, out), ...tail].join("\n");
    });
    return [...alerts, ...headlines, ...filings, WHY_INSTRUCTIONS].join("\n\n");
  };
  let text = compose();
  while (charCount(text) > WHY_POST_MAX) {
    const most = Math.max(0, ...keep);
    if (most === 0) break;
    const i = keep.indexOf(most);
    keep[i] = most - 1;
    text = compose();
  }
  return { text, source, message };
}

/* ---------- the desk state ---------- */

/** A level near its last price: its market and symbol, what it is, its last print and that print's stamp, how far
 * the price is from it (percent of the price), its plan and its file. */
export interface NearView {
  market: Market;
  symbol: string;
  kind: LevelKind;
  level: string;
  when: Level["when"];
  last: number;
  at: string;
  distancePct: number;
  plan: string;
  file: string;
}

/** The face's view of the desk, injected before a phone's text: the holdings with their last prints, the near
 * levels, today's alert counts, the mute and why prices are missing, when they are. */
export interface DeskStateView {
  holdings: { market: Market; symbol: string; qty: number; avgCost: number; last: number | null; at: string | null; chgPct: number | null }[];
  near: NearView[];
  alerts: { sent: number; suppressed: number };
  muted?: string;
  prices?: string;
}

/** The state message's body: the view as JSON. */
export function stateBody(view: DeskStateView): string {
  return JSON.stringify(view);
}

/* ---------- the watch's lines ---------- */

/** A market as the phone names it. */
const marketName = (market: Market): string => (market === "us" ? "US" : "A-share");

/** One refusal as the loaded line lists it: `#<n>[ <SYMBOL>]: <reason>`, counted from 1 as the operator counts
 * entries; one past a cap has no place and is its reason alone. */
function refusalItem(r: LoadRefusal): string {
  const place = r.index === undefined ? "" : `#${r.index + 1}${r.symbol !== undefined ? ` ${r.symbol}` : ""}: `;
  return `${place}${r.reason}`;
}

/** The watch's rows of the plan's phone-line table, each cut at {@link LINE_MAX} characters. */
export const WATCH_LINES = {
  /** A book file refused whole. */
  fileRefused: (file: string, error: string): string => cut(`${file} is refused, so the watch keeps its last good load: ${error}`),
  /** A book file loaded with refusals - at least one: a load with none is {@link WATCH_LINES.fileChanged}'s line. */
  fileLoaded: (file: string, loaded: number, refusals: readonly LoadRefusal[]): string =>
    cut(`${file}: ${loaded} loaded, ${refusals.length} refused - ${refusals.map(refusalItem).join("; ")}`),
  /** A book file changed, nothing refused: its new hash's first 8 hex. */
  fileChanged: (file: string, sha256: string, loaded: number): string => cut(`${file} changed (sha256 ${sha256.slice(0, 8)}): ${loaded} loaded`),
  /** A market's symbols past its cap. */
  overCap: (market: Market, n: number, symbols: readonly string[]): string =>
    cut(`the watch covers ${n} ${marketName(market)} symbols; not watched: ${symbols.join(", ")}`),
  /** A market's first failed poll of its session date. */
  noPrices: (market: Market, reason: string): string => cut(`the watch has no ${marketName(market)} prices today: ${reason}`),
  /** A watched symbol unpriced on its first polls of a session date. */
  unpriced: (symbol: string, reason: string): string => cut(`the watch has no price for ${symbol} this session: ${reason}`),
  /** A shares past the XSHG table. */
  cnPastTable: (last: string): string =>
    cut(`the A-share calendar ends ${last}; the watch judges A shares on the Beijing bands, the close print and the Market's phase for whether the day trades, until face/src/xshg-clock.ts is extended`),
  /** No XNYS calendar today. */
  noCalendar: (error: string): string => cut(`the watch is off for US shares today: the market calendar failed (${error})`),
  /** Another face holds the watch's lease on this home. */
  heldElsewhere: (pid: number): string => `this face does not watch: another face (pid ${pid}) holds the watch on this home`,
  /** The lease step failed: its code, else its message. */
  leaseFailed: (error: string): string => cut(`the watch is off today: its lease cannot be written (${error})`),
  /** A filing rule, and no SEC contact. */
  filingsNoContact: (): string => "the watch's filings are off: set ALPHA_EDGAR_USER_AGENT to a contact email (SEC asks for one)",
  /** SEC refused every symbol's request. */
  filingsRefused: (error: string): string =>
    cut(`the watch's filings are off until tomorrow: SEC refused every request (${error}); check ALPHA_EDGAR_USER_AGENT`),
  /** The filings' symbols past their cap. */
  filingsOverCap: (symbols: readonly string[]): string => cut(`the watch's filings cover ${FILINGS_SYMBOLS_MAX} symbols; not polled: ${symbols.join(", ")}`),
} as const;
