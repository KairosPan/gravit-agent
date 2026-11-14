/** `GET /data/desk/news`: the Desk screen's News, one New York day of the watch's alerts read back from the desk's
 * ledgers. Each alert of `alerts.jsonl` is a row - sent, queued, undelivered, still pending, or held back by the gate
 * with its word - grouped by symbol, and the reason Gravit wrote for its pass (the `annotated` line) is joined to it:
 * its headline the line of the reply that starts with the row's own ticker, the pages its session opened counted from
 * the `desk-fetch` events of `events.jsonl`. The watch's rules come with the day's count each, and the three sources
 * the watch reads with their state.
 *
 * Read-only, and cheap: `alerts.jsonl` is parsed again only when its size or mtime moved. Texts are passed through as
 * written - the server never escapes; the client draws them as text. A line this module's guards refuse - torn, half
 * written, of another shape - is skipped, so a bad line never fails the route.
 *
 * src/desk.ts loads this module (its `installDesk` registers the route) and this module reads the ledgers through
 * src/desk.ts: neither uses the other at module top level, so the cycle is safe. The watch's modules are named for
 * their types alone (tests/desk-weight.test.ts). */
import { stat } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { ALERTS_FILE, deskDir, readEvents, readRecords } from "./desk.ts";
import { etDate } from "./et.ts";
import { fencedGet, isTrustedDataRequest } from "./http.ts";
import type { RouteRegistrar } from "./static.ts";
import type { RuleStatus, WatchStatus } from "./watch.ts";

/** Why the gate held an alert back, as its `suppressed` says. */
export type NewsHeld = "cooldown" | "cap" | "muted" | "off" | "window";

/** The reason Gravit wrote for an alert's pass: `headline` the reply's line for this row's symbol (else its first
 * line), `label` the short line under it or `null`, `text` the whole reply as written, `pages` the pages its session
 * opened, `sessionId` and `outcome` its turn's. */
export interface NewsReason { headline: string; label: string | null; text: string; pages: number; sessionId: string; outcome: string }

/** One alert as News draws it. */
export interface NewsAlert {
  id: string; t: string; symbol: string; market: string; label: string;
  kind: "move" | "gap" | "level" | "filing";
  /** The quote's change on the previous close; null for a level or a filing. */
  movePct: number | null;
  /** 1-based among the symbol's alerts of the day, held-back ones counted. */
  nth: number;
  delivery: "sent" | "queued" | "undelivered" | "pending" | "held";
  held?: NewsHeld;
  reason?: NewsReason;
}

/** One symbol's alerts of the day: the latest, and the earlier ones newest first. */
export interface NewsGroup { symbol: string; count: number; latest: NewsAlert; earlier: NewsAlert[] }

/** A watch rule with the day's alerts it fired. */
export interface NewsRule { id: string; kind: "move_pct" | "gap" | "filing"; pct?: number; forms?: string[]; symbols: string[]; holdings: boolean; levels: boolean; alertsToday: number }

/** One source the watch reads, and its state. */
export interface NewsSource { id: "quotes" | "headlines" | "filings"; state: "ok" | "unavailable" | "off"; reason?: string }

/** What `GET /data/desk/news` answers, after `ok`. */
export interface DeskNews {
  /** The New York date shown. */
  date: string;
  /** False when an earlier day stands in. */
  today: boolean;
  sources: NewsSource[];
  /** Groups ordered by their latest alert, newest first. */
  alerts: { total: number; groups: NewsGroup[] };
  /** Plan 2 fills it. */
  reports: { total: number; groups: never[] };
  rules: NewsRule[];
  levels: number;
}

/* ---------- the records, as this module reads them ---------- */

type Trigger = { type: NewsAlert["kind"]; rule?: string };
type AlertLine = {
  t: string; kind: "alert"; id: string; pass: string; market: string; symbol: string; label: string;
  trigger: Trigger; quote?: { chgPct?: unknown } | null; decision: "send" | "suppressed"; suppressed?: string;
};
type DeliveredLine = { t: string; kind: "delivered"; id: string; delivery: { sent?: unknown; queued?: unknown; undelivered?: unknown } };
type AnnotationLine = { t: string; kind: "annotation"; pass: string };
type AnnotatedLine = { t: string; kind: "annotated"; pass: string; sessionId: string; outcome: string; text: string };
type NewsRecord = AlertLine | DeliveredLine | AnnotationLine | AnnotatedLine;

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isText = (x: unknown): x is string => typeof x === "string";
const TRIGGERS: ReadonlySet<unknown> = new Set(["move", "gap", "level", "filing"]);
const HELD: ReadonlySet<unknown> = new Set(["cooldown", "cap", "muted", "off", "window"]);

/** Whether `x` is one of the four lines News reads, by the fields it reads of each; a `batch` line, and any other, is not. */
function isNewsRecord(x: unknown): x is NewsRecord {
  if (!isObject(x) || !isText(x.t)) return false;
  switch (x.kind) {
    case "alert":
      return isText(x.id) && isText(x.pass) && isText(x.market) && isText(x.symbol) && x.symbol !== "" && isText(x.label)
        && isObject(x.trigger) && TRIGGERS.has(x.trigger.type) && (x.trigger.rule === undefined || isText(x.trigger.rule))
        && (x.quote === undefined || x.quote === null || isObject(x.quote))
        && (x.decision === "send" || x.decision === "suppressed");
    case "delivered":
      return isText(x.id) && isObject(x.delivery);
    case "annotation":
      return isText(x.pass);
    case "annotated":
      return isText(x.pass) && isText(x.sessionId) && isText(x.outcome) && isText(x.text);
    default:
      return false;
  }
}

/* ---------- the view ---------- */

/** An alert's word for its delivery: held back by the gate, else what its `delivered` line says, else pending. */
function deliveryOf(a: AlertLine, d: DeliveredLine | undefined): Pick<NewsAlert, "delivery" | "held"> {
  if (a.decision === "suppressed") return { delivery: "held", ...(HELD.has(a.suppressed) ? { held: a.suppressed as NewsHeld } : {}) };
  if (d === undefined) return { delivery: "pending" };
  const { sent, queued, undelivered } = d.delivery;
  if (Array.isArray(sent) && sent.length > 0) return { delivery: "sent" };
  if (queued === true) return { delivery: "queued" };
  if (isText(undelivered)) return { delivery: "undelivered" };
  return { delivery: "pending" };
}

/** Whether `line` starts with the ticker `symbol`, a whole one: `AMD` is not the start of `AMDL`. */
const startsWithSymbol = (line: string, symbol: string): boolean =>
  line.startsWith(symbol) && !/^[A-Za-z0-9]/.test(line.slice(symbol.length));

/** The reason a row of `symbol` carries from its pass's reply `r`: see {@link NewsReason}. A label is taken only under a
 * headline that starts with `symbol` itself, and never from a line that starts with another of `passSymbols`, the
 * symbols the pass alerted on: a row whose headline is the reply's first line has none. */
function reasonOf(symbol: string, passSymbols: readonly string[], r: AnnotatedLine, pagesBySession: ReadonlyMap<string, number>): NewsReason {
  const lines = r.text.split(/\r?\n/).map((l) => l.trim());
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const own = lines.findIndex((l) => startsWithSymbol(l, symbol));
  const at = own >= 0 ? own : lines.findIndex((l) => l !== "");
  const headline = at < 0 ? "" : lines[at]!;
  const next = own < 0 ? undefined : lines[own + 1];
  const label = next !== undefined && next !== "" && next.length <= 40 && own + 1 < lines.length - 1
    && !passSymbols.some((other) => other !== symbol && startsWithSymbol(next, other)) ? next : null;
  return { headline, label, text: r.text, pages: pagesBySession.get(r.sessionId) ?? 0, sessionId: r.sessionId, outcome: r.outcome };
}

/** The state of the Market's reads (the quotes, and the headlines with them) as the watch's US market tells it. */
function marketSource(id: "quotes" | "headlines", watch: WatchStatus | undefined): NewsSource {
  const us = watch?.markets.us;
  if (us === undefined || us.state === "off") return { id, state: "off" };
  if (us.lastError !== undefined) return { id, state: "unavailable", reason: us.lastError };
  return { id, state: "ok" };
}

/** The state of SEC's filings as the watch's filings poll tells it. */
function filingsSource(watch: WatchStatus | undefined): NewsSource {
  const f = watch?.filings;
  if (f === undefined || f.state === "off") return { id: "filings", state: "off" };
  if (f.state === "polling") return { id: "filings", state: "ok" };
  return { id: "filings", state: "unavailable", reason: f.lastError ?? f.state };
}

/**
 * One day's News from the ledgers' lines.
 *
 * The day is the New York date of `now` when an alert has it, else the latest New York date any alert has (a Saturday
 * shows Friday's), else today with no groups. Each of the day's alerts is a row, its `nth` counted in time order
 * among its symbol's, held-back ones counted; rows are grouped by symbol, the groups ordered by their latest row,
 * newest first. A row's reason is the last `annotated` line of its own non-empty `pass` (a filing's pass is empty: it
 * has none); a label is read only under a headline of the row's own ticker. The rules are the watch's, each with the day's alerts whose `trigger.rule` - or, a level's, whose
 * `label` - is its id; no watch gives none, and no sources but `off`.
 * @param input - `records`, the lines of `alerts.jsonl` (any line this module's guards refuse is skipped); `fetches`,
 *   the ledger's `desk-fetch` events, every one, since a reason's pages are counted by its session whatever the day;
 *   `watch`, the watch's status when it runs; `now`, in ms since the epoch.
 */
export function buildNews(input: { records: unknown[]; fetches: { sessionId: string }[]; watch?: WatchStatus; now: number }): DeskNews {
  const { watch, now } = input;
  const alerts: AlertLine[] = [];
  const delivered = new Map<string, DeliveredLine>();
  const annotated = new Map<string, AnnotatedLine>();
  for (const r of input.records) {
    if (!isNewsRecord(r)) continue;
    if (r.kind === "alert") alerts.push(r);
    else if (r.kind === "delivered") delivered.set(r.id, r);
    else if (r.kind === "annotated") annotated.set(r.pass, r);
  }
  const dayOf = new Map<AlertLine, string>();
  for (const a of alerts) {
    const ms = Date.parse(a.t);
    if (Number.isFinite(ms)) dayOf.set(a, etDate(new Date(ms)));
  }
  const today = etDate(new Date(now));
  const days = [...dayOf.values()];
  const date = days.includes(today) || days.length === 0 ? today : days.reduce((a, b) => (b > a ? b : a));
  const ofDay = alerts.filter((a) => dayOf.get(a) === date).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));

  const symbolsByPass = new Map<string, string[]>();
  for (const a of alerts) {
    const list = symbolsByPass.get(a.pass) ?? [];
    if (!list.includes(a.symbol)) list.push(a.symbol);
    symbolsByPass.set(a.pass, list);
  }
  const pagesBySession = new Map<string, number>();
  for (const f of input.fetches) pagesBySession.set(f.sessionId, (pagesBySession.get(f.sessionId) ?? 0) + 1);

  const bySymbol = new Map<string, NewsAlert[]>();
  for (const a of ofDay) {
    const rows = bySymbol.get(a.symbol) ?? [];
    const kind = a.trigger.type;
    const chg = a.quote?.chgPct;
    const reasonLine = a.pass === "" ? undefined : annotated.get(a.pass);
    rows.push({
      id: a.id, t: a.t, symbol: a.symbol, market: a.market, label: a.label, kind,
      movePct: (kind === "move" || kind === "gap") && typeof chg === "number" && Number.isFinite(chg) ? chg : null,
      nth: rows.length + 1,
      ...deliveryOf(a, delivered.get(a.id)),
      ...(reasonLine === undefined ? {} : { reason: reasonOf(a.symbol, symbolsByPass.get(a.pass) ?? [], reasonLine, pagesBySession) }),
    });
    bySymbol.set(a.symbol, rows);
  }
  const groups: NewsGroup[] = [...bySymbol].map(([symbol, rows]) => {
    const newest = [...rows].reverse();
    return { symbol, count: rows.length, latest: newest[0]!, earlier: newest.slice(1) };
  });
  groups.sort((a, b) => Date.parse(b.latest.t) - Date.parse(a.latest.t));

  const ruleOf = (a: AlertLine): string => a.trigger.rule ?? a.label;
  const rules: NewsRule[] = (watch?.rules ?? []).map((rule: RuleStatus) => ({
    ...rule,
    alertsToday: ofDay.filter((a) => ruleOf(a) === rule.id).length,
  }));

  return {
    date,
    today: date === today,
    sources: [marketSource("quotes", watch), marketSource("headlines", watch), filingsSource(watch)],
    alerts: { total: ofDay.length, groups },
    reports: { total: 0, groups: [] },
    rules,
    levels: watch?.levels ?? 0,
  };
}

/** The last parse of `alerts.jsonl` per home, valid while its size and mtime hold. */
const newsCache = new Map<string, { key: string; records: NewsRecord[] }>();
async function readNewsRecords(home: string): Promise<NewsRecord[]> {
  let key = "absent";
  try {
    const st = await stat(join(deskDir(home), ALERTS_FILE));
    key = `${st.size}:${st.mtimeMs}`;
  } catch { /* absent or unreadable: readRecords decides */ }
  const hit = newsCache.get(home);
  if (hit !== undefined && hit.key === key) return hit.records;
  const { records } = await readRecords(home, ALERTS_FILE, isNewsRecord);
  newsCache.set(home, { key, records });
  return records;
}

/**
 * The day's News for `home`: {@link buildNews} over `alerts.jsonl` (parsed again only when its size or mtime moved)
 * and every `desk-fetch` event of the current `events.jsonl`.
 * @param deps - `home`, the harness home; `watch`, the watch's status while it runs; `now` (default `Date.now`).
 * @returns rejects when a ledger exists but cannot be read; an absent one is empty.
 */
export async function deskNews(deps: { home: string; watch?: () => WatchStatus | undefined; now?: () => number }): Promise<DeskNews> {
  const records = await readNewsRecords(deps.home);
  const { events } = await readEvents(deps.home);
  const fetches: { sessionId: string }[] = [];
  for (const e of events) if (e.kind === "desk-fetch") fetches.push({ sessionId: e.sessionId });
  const watch = deps.watch?.();
  return buildNews({ records, fetches, ...(watch === undefined ? {} : { watch }), now: (deps.now ?? Date.now)() });
}

/**
 * Mount `GET /data/desk/news` behind the browser fence, answering {@link deskNews} through http.ts's {@link fencedGet}:
 * the fence refuses first with the fixed `FORBIDDEN` body, and a ledger that cannot be read is a `500` with a fixed
 * message.
 * @param webServer - the host webserver service, or a test recorder.
 * @param deps - {@link deskNews}'s, read on every request, and `isTrusted`, the fence (default {@link isTrustedDataRequest}).
 * @throws when the path is already registered.
 */
export function registerDeskNewsRoute(
  webServer: RouteRegistrar,
  deps: Parameters<typeof deskNews>[0] & { isTrusted?: (req: IncomingMessage) => boolean },
): void {
  const isTrusted = deps.isTrusted ?? isTrustedDataRequest;
  webServer.register({ kind: "exact", path: "/data/desk/news", handler: fencedGet(isTrusted, () => deskNews(deps)) });
}
