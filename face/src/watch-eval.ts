// face/src/watch-eval.ts
/** The watch's evaluator: which prints are judged, what fires, what the gate lets through, and the records the watch
 * appends to `alerts.jsonl` - pure, but for the ids' randomness. src/watch.ts polls the Market's read and drives it.
 *
 * WHAT IS JUDGED (ruling 2). Only a `live` or `delayed` print with an `as_of`, inside its own market's session:
 * - **US.** `as_of` in one of the three phases of the XNYS session handed over ({@link usPhaseOf}): pre-market from
 *   04:00 ET to the open, the regular session `[open, close)`, after-hours from the close to the close plus 4 h. A
 *   US `move_pct` key with `sessions: all` judges all three; a `sessions: regular` key, a level and a `gap` key judge
 *   the regular session alone.
 * - **A shares.** The Market's phase `trading`, the session's Beijing date, and the Beijing clock in `[09:30, 11:30)`
 *   or `[13:00, 15:00)`, so the auction and the midday break are never judged; and, whatever the phase says, a print
 *   stamped inside `[15:00:00, 15:00:30]` - the close print. Past the XSHG table (a session marked `uncovered`) the
 *   Market's phase stands in for the calendar only on whether the day is a session; the bands, the phase `trading`
 *   inside them and the close print still decide which prints are judged, since the Market says `trading` through
 *   the 09:15-09:25 auction too.
 *
 * Each key judges a print once per `as_of`. Its state belongs to its reference ({@link referenceOf}): for a US print the
 * date of the close its change is measured from - that day's close after-hours, the previous session's before and
 * during the session - and for an A share its Beijing session date. A print with another reference starts the key
 * afresh, so after-hours, the next pre-market and the next session share one crossing.
 *
 * WHAT FIRES (ruling 1). A level or a `move_pct` key fires on a crossing between two judged observations, and once,
 * labelled `gap`, when already past at its first judged observation of the session and not yet alerted for it. A key
 * that reads the previous close (`move_pct`, `gap`) observes only prints that carry one. A `gap` rule judges only its
 * first such observation, and only inside {@link GAP_RULE_WINDOW_MS} of its market's open. A hit inside its cooldown
 * is a repeat, counted and not returned. Outside the regular session a hit waits for a second distinct print still
 * past, {@link THIN_SECOND_MS} or more after the first, or fires the first alone ({@link THIN_ALONE_MS}).
 *
 * THE GATE (ruling 5). OFF, then MUTE, then the cap: {@link ALERTS_PER_HOUR} sends in a rolling hour. A capped alert
 * is held for the batch, which falls due in a later ET hour.
 * @module
 */
import { randomBytes } from "node:crypto";
import type { DeliverResult } from "./desk-conversation.ts";
import { resolveSymbols, type Holding, type Level, type LevelKind, type Rule } from "./desk-book.ts";
import { nyInstant, type MarketSession } from "./market-clock.ts";
import type { MarketQuote } from "./market-quotes.ts";
import { bjClock, bjDate, etDate } from "./et.ts";
import { marketOf, type Market } from "./symbols.ts";

/** The most alerts sent in a rolling hour; the rest wait for the batch. */
export const ALERTS_PER_HOUR = 6;
/** An hour, in ms: the cap's window. */
export const HOUR_MS = 3_600_000;
/** How long after its market's open a `gap` rule still judges its first observation. */
export const GAP_RULE_WINDOW_MS = 1_800_000;
/** How far back {@link rebuildDay} reads: five days, so a long weekend or Thanksgiving between an after-hours alert
 * and the next pre-market keeps its crossing. */
export const REBUILD_WINDOW_MS = 432_000_000;
/** How far back {@link findOrphans} reads: an A-share session and the US one before it, with room. */
const ORPHAN_WINDOW_MS = 36 * HOUR_MS;
/** Outside the regular session, how long after the first print past a threshold a second one must be stamped to
 * confirm it. */
export const THIN_SECOND_MS = 20_000;
/** Outside the regular session, how long after it was first seen a lone print past a threshold waits for a second
 * before it fires alone. */
export const THIN_ALONE_MS = 120_000;
/** How old, from when it was first seen, a print waiting for its second may grow before it is dropped, never fired
 * alone or confirmed: a print left at the end of after-hours is not the next morning's news. */
export const THIN_STALE_MS = 600_000;
/** How long after the close after-hours runs: to 20:00 ET, or 17:00 on an early close. */
export const AFTER_HOURS_MS = 4 * HOUR_MS;

/* ---------- the quote ---------- */

/** A quote as the watch judges it: the Market's quote, its feed named, and an A share's phase (`null` for a US one). */
export interface WatchQuote {
  market: Market;
  symbol: string;
  price: number | null;
  prevClose: number | null;
  changePct: number | null;
  asOf: string | null;
  receivedAt: string | null;
  feed: string;
  status: "live" | "delayed" | "stale" | "unavailable";
  phase: "trading" | "midday" | "closed" | null;
}

/** The quote the watch judges, from the Market's. */
export function watchQuoteOf(q: MarketQuote): WatchQuote {
  return {
    market: q.market, symbol: q.symbol, price: q.price, prevClose: q.prev_close, changePct: q.change_pct, asOf: q.as_of, receivedAt: q.received_at,
    feed: q.feed, status: q.quote_status, phase: q.cn?.phase ?? null,
  };
}

/** A US print's phase in its session. */
export type UsPhase = "pre" | "regular" | "after";

/** An XNYS session as the watch hands it over: `prev` the date of the session before it. */
export type UsSession = MarketSession & { prev: string };

/** Each market's session for the pass: the XNYS one on its ET date, the XSHG one on its Beijing date - `uncovered`
 * when the date is past the table and the Market's phase, not the calendar, made the day a session. The prints are
 * judged as on a covered day. */
export interface WatchSessions {
  us?: UsSession;
  cn?: MarketSession & { uncovered?: true };
}

/** The A share's judged bands and its close print's, as Beijing clock text (`HH:MM:SS` compares as text). */
const CN_BANDS: readonly (readonly [string, string])[] = [["09:30:00", "11:30:00"], ["13:00:00", "15:00:00"]];
const CN_CLOSE_PRINT = ["15:00:00", "15:00:30"] as const;

/**
 * A US print's phase in `s`: `pre` from 04:00 ET of its date to the open, `regular` from the open to the close,
 * `after` from the close to the close plus 4 h (20:00 ET, or 17:00 on an early close); else `undefined`.
 * @param asOf - the print's `as_of`, in ms.
 * @param s - the session.
 */
export function usPhaseOf(asOf: number, s: UsSession): UsPhase | undefined {
  const open = Date.parse(s.open);
  const close = Date.parse(s.close);
  if (asOf >= Date.parse(nyInstant(s.date, 4, 0)) && asOf < open) return "pre";
  if (asOf >= open && asOf < close) return "regular";
  if (asOf >= close && asOf < close + AFTER_HOURS_MS) return "after";
  return undefined;
}

/**
 * The date of the close a US print in `phase` measures its change from: that day's after-hours, the previous
 * session's before and during the session.
 * @param phase - the print's phase.
 * @param s - its session.
 */
export function referenceOf(phase: UsPhase, s: UsSession): string {
  return phase === "after" ? s.date : s.prev;
}

/** Where a print is judged: its session's date, its reference, and a US print's phase. */
type Judged = { date: string; ref: string; phase?: UsPhase };

/** Where `q` is judged, else `undefined` (ruling 2). */
function judgedOf(q: WatchQuote, sessions: WatchSessions): Judged | undefined {
  if (q.status !== "live" && q.status !== "delayed") return undefined;
  if (q.asOf === null) return undefined;
  const at = Date.parse(q.asOf);
  if (!Number.isFinite(at)) return undefined;
  const when = new Date(at);
  if (q.market === "us") {
    const s = sessions.us;
    if (s === undefined || etDate(when) !== s.date) return undefined;
    const phase = usPhaseOf(at, s);
    return phase === undefined ? undefined : { date: s.date, ref: referenceOf(phase, s), phase };
  }
  const s = sessions.cn;
  if (s === undefined || bjDate(when) !== s.date) return undefined;
  const cn = { date: s.date, ref: s.date };
  const clock = bjClock(when);
  if (clock >= CN_CLOSE_PRINT[0] && clock <= CN_CLOSE_PRINT[1]) return cn;
  if (q.phase !== "trading") return undefined;
  return CN_BANDS.some(([from, to]) => clock >= from && clock < to) ? cn : undefined;
}

/**
 * The session date a print is judged in, else `undefined` (ruling 2): a US print in any of its session's three
 * phases, which a key may still not judge (its `sessions`).
 * @param q - the print.
 * @param sessions - each market's session for the pass.
 */
export function judgedDate(q: WatchQuote, sessions: WatchSessions): string | undefined {
  return judgedOf(q, sessions)?.date;
}

/* ---------- the keys ---------- */

/** What a price key watches: a level, or a rule's change from the previous close. */
export type KeyTrigger =
  | { type: "level"; kind: LevelKind; price?: number; range?: [number, number]; when: Level["when"]; levelSource?: string }
  | { type: "move"; rule: string; pct: number }
  | { type: "gap"; rule: string; pct: number };

/** What a filing alert carries: the rule and the filing as SEC lists it. */
export type FilingTrigger = {
  type: "filing"; rule: string; form: string; accession: string; accepted: string | null; filingDate: string; items: string | null; url: string;
};

/** One thing the watch judges: a level, or a rule on one symbol. */
export interface PriceKey {
  key: string;
  market: Market;
  symbol: string;
  label: string;
  trigger: KeyTrigger;
  cooldownMs: number;
  /** The US phases it judges: `all` for a `move_pct` rule's key unless the rule says `regular`; `regular` for a
   * level and a `gap` key. An A-share key judges its own session whatever it says. */
  sessions: "all" | "regular";
  annotate: boolean;
  /** Whether its alerts go `urgent`, through quiet hours: its rule's `urgent`; a level never. */
  urgent: boolean;
  plan: string | null;
  source: { file: string; index: number };
}

/**
 * The book's price keys: one per level, `level:<file>:<symbol>:<kind>:<price or low-high>:<when>`, labelled by its
 * kind; and one per `move_pct` or `gap` rule and resolved symbol, `rule:<id>:<symbol>`, labelled by the rule id. A
 * `gap` key's cooldown is 0; a filing rule makes no price key; a repeated key keeps its first.
 * @param book - the loaded levels, rules and holdings.
 */
export function priceKeys(book: { levels: readonly Level[]; rules: readonly Rule[]; holdings: readonly Holding[] }): PriceKey[] {
  const keys = new Map<string, PriceKey>();
  const add = (k: PriceKey): void => {
    if (!keys.has(k.key)) keys.set(k.key, k);
  };
  for (const l of book.levels) {
    const at = l.range !== undefined ? `${l.range[0]}-${l.range[1]}` : String(l.price);
    add({
      key: `level:${l.file}:${l.symbol}:${l.kind}:${at}:${l.when}`, market: l.market, symbol: l.symbol, label: l.kind,
      trigger: {
        type: "level", kind: l.kind, ...(l.price !== undefined && { price: l.price }), ...(l.range !== undefined && { range: l.range }), when: l.when,
        ...(l.source !== undefined && { levelSource: l.source }),
      },
      cooldownMs: l.cooldownMs, sessions: "regular", annotate: l.annotate, urgent: false, plan: l.plan, source: { file: l.file, index: l.index },
    });
  }
  const scope = { holdings: book.holdings.map((h) => h.symbol), levels: book.levels.map((l) => l.symbol) };
  for (const r of book.rules) {
    if (r.kind === "filing") continue;
    const trigger: KeyTrigger = r.kind === "gap" ? { type: "gap", rule: r.id, pct: r.gapPct } : { type: "move", rule: r.id, pct: r.movePct };
    for (const symbol of resolveSymbols(r.symbols, scope)) {
      const market = marketOf(symbol);
      if (market === undefined) continue;
      add({
        key: `rule:${r.id}:${symbol}`, market, symbol, label: r.id, trigger, cooldownMs: r.kind === "gap" ? 0 : r.cooldownMs,
        sessions: r.kind === "move_pct" ? r.sessions : "regular", annotate: r.annotate, urgent: r.urgent, plan: r.plan ?? null, source: { file: r.file, index: r.index },
      });
    }
  }
  return [...keys.values()];
}

/**
 * Whether `q` reads past `k`: `cross_down` at or under the level, `cross_up` at or over it, `enter` inside the range,
 * its edges included; a `move` or `gap` key when `|change|` is at least its percent, the change being the print's,
 * or read from its previous close when it carries none.
 * @returns `undefined` with no price, or, for a `move` or `gap` key, with no previous close.
 */
export function pastOf(k: PriceKey, q: WatchQuote): boolean | undefined {
  const price = q.price;
  if (price === null || !Number.isFinite(price)) return undefined;
  const t = k.trigger;
  if (t.type === "level") {
    if (t.when === "enter") return t.range === undefined ? undefined : price >= t.range[0] && price <= t.range[1];
    if (t.price === undefined) return undefined;
    return t.when === "cross_down" ? price <= t.price : price >= t.price;
  }
  if (q.prevClose === null || !(q.prevClose > 0)) return undefined;
  const change = q.changePct ?? ((price - q.prevClose) / q.prevClose) * 100;
  return Math.abs(change) >= t.pct;
}

/* ---------- the day ---------- */

/** One key against one reference (`ref`, the date of the close it measures from; an A share's session date; a
 * filing key's ET date): its last reading (`side`, unknown until judged), its last hit, the `as_of` it last judged,
 * whether it alerted against that reference, the repeats its cooldown swallowed, and, outside the regular session,
 * the first print past its threshold still waiting for a second (`pending`, never recorded: a restart forgets it). */
export interface KeyDay {
  ref: string;
  side?: boolean;
  lastHitAt?: number;
  lastAsOf?: string;
  alerted: boolean;
  repeats: number;
  pending?: { asOf: string; firstAt: number; quote: WatchQuote; date: string; phase: UsPhase };
}

/** The watch's state: each key's day, the sends of the last hour (ms), and the alerts the cap holds for the batch. */
export interface WatchDay {
  keys: Map<string, KeyDay>;
  sends: number[];
  pending: { id: string; t: number }[];
}

/** A day with nothing judged, sent or held. */
export function emptyDay(): WatchDay {
  return { keys: new Map(), sends: [], pending: [] };
}

/** One hit: the key, the print it read, whether it is the reference's first observation (`gap`) or a crossing, the
 * session date it was judged in, its reference, a US print's phase, and `onePrint` when it fired on a lone print
 * outside the regular session. */
export type Hit = { key: PriceKey; quote: WatchQuote; gap: boolean; date: string; ref: string; phase?: UsPhase; onePrint?: true };

/**
 * Judges one pass: each key against its symbol's print, in key order, mutating `day`. Per key: a print it does not
 * judge is skipped; a lone print outside the regular session older than {@link THIN_ALONE_MS} fires (before the
 * unchanged-`as_of` skip, unless the new print settles it, and on a pass with no print the key judges too), and one
 * {@link THIN_STALE_MS} old is dropped first, neither fired nor confirmed; a print with a new reference starts the
 * key afresh; a first past print of a fresh key hits as `gap`, a not-past to past one as a crossing - outside the
 * regular session only once a second distinct print confirms it.
 * @param day - the watch's state.
 * @param keys - the price keys.
 * @param quotes - the pass's prints, at most one a market and symbol counted (the first).
 * @param sessions - each market's session.
 * @param now - the pass's time, for the cooldowns and the lone prints.
 * @returns the hits, in key order; repeats inside a cooldown are counted on the key's day, not returned.
 */
export function evaluatePass(day: WatchDay, keys: readonly PriceKey[], quotes: readonly WatchQuote[], sessions: WatchSessions, now: number): Hit[] {
  const prints = new Map<string, WatchQuote>();
  for (const q of quotes) {
    const id = `${q.market}:${q.symbol}`;
    if (!prints.has(id)) prints.set(id, q);
  }
  const hits: Hit[] = [];
  /** A hit, unless its cooldown swallows it as a repeat. */
  const fire = (k: PriceKey, kd: KeyDay, hit: Omit<Hit, "key" | "ref">): void => {
    if (kd.lastHitAt !== undefined && now - kd.lastHitAt < k.cooldownMs) {
      kd.repeats += 1;
      return;
    }
    kd.lastHitAt = now;
    kd.alerted = true;
    hits.push({ key: k, ...hit, ref: kd.ref });
  };
  /** A waiting print {@link THIN_STALE_MS} old or more is dropped. */
  const dropStale = (kd: KeyDay): void => {
    if (kd.pending !== undefined && now - kd.pending.firstAt >= THIN_STALE_MS) delete kd.pending;
  };
  /** A lone print past the threshold that waited long enough, and not too long, fires alone. */
  const alone = (k: PriceKey, kd: KeyDay): void => {
    dropStale(kd);
    const p = kd.pending;
    if (p === undefined || now - p.firstAt < THIN_ALONE_MS) return;
    delete kd.pending;
    const gap = kd.side === undefined;
    kd.side = true;
    fire(k, kd, { quote: p.quote, gap, date: p.date, phase: p.phase, onePrint: true });
  };
  for (const k of keys) {
    const held = day.keys.get(k.key);
    const q = prints.get(`${k.market}:${k.symbol}`);
    const j = q === undefined ? undefined : judgedOf(q, sessions);
    if (q === undefined || j === undefined || (j.phase !== undefined && j.phase !== "regular" && k.sessions !== "all")) {
      /* no print, or none this key judges: a waiting print may still fire alone */
      if (held !== undefined) alone(k, held);
      continue;
    }
    const same = held !== undefined && held.ref === j.ref ? held : undefined;
    if (same !== undefined) dropStale(same);
    if (same !== undefined && same.lastAsOf === q.asOf) {
      alone(k, same);
      continue;
    }
    const past = pastOf(k, q);
    if (past === undefined) {
      if (same !== undefined) alone(k, same);
      continue;
    }
    let kd = same;
    if (kd === undefined) {
      kd = { ref: j.ref, alerted: false, repeats: 0 };
      day.keys.set(k.key, kd);
    }
    const asOf = q.asOf as string;
    kd.lastAsOf = asOf;
    const at = { date: j.date, ...(j.phase !== undefined && { phase: j.phase }) };
    if (k.trigger.type === "gap") {
      if (kd.side === undefined) {
        const open = sessions[k.market]?.open;
        const early = open !== undefined && Date.parse(asOf) < Date.parse(open) + GAP_RULE_WINDOW_MS;
        kd.side = past;
        if (early && past && !kd.alerted) fire(k, kd, { quote: q, gap: true, ...at });
      }
      continue;
    }
    /* true: a gap, false: a crossing, undefined: nothing */
    const hit = kd.side === undefined ? (past && !kd.alerted ? true : undefined) : !kd.side && past ? false : undefined;
    if (hit === undefined) {
      kd.side = past;
      delete kd.pending;
      continue;
    }
    if (j.phase === "pre" || j.phase === "after") {
      const p = kd.pending;
      if (p === undefined) {
        kd.pending = { asOf, firstAt: now, quote: q, date: j.date, phase: j.phase };
        continue;
      }
      if (Date.parse(asOf) - Date.parse(p.asOf) < THIN_SECOND_MS) {
        alone(k, kd);
        continue;
      }
    }
    delete kd.pending;
    kd.side = true;
    fire(k, kd, { quote: q, gap: hit, ...at });
  }
  return hits;
}

/* ---------- the gate and the batch ---------- */

/** Whether an alert is sent, or why not. */
export type Gate = { send: true } | { send: false; suppressed: "off" | "muted" | "cap" };

/**
 * The gate for one alert: OFF, then MUTE, then the cap. A send is counted; a capped alert joins `pending`.
 * @param day - the watch's state.
 * @param now - the alert's time.
 * @param flags - whether the desk is OFF and whether it is muted.
 * @param id - the alert's id.
 */
export function gate(day: WatchDay, now: number, flags: { off: boolean; muted: boolean }, id: string): Gate {
  if (flags.off) return { send: false, suppressed: "off" };
  if (flags.muted) return { send: false, suppressed: "muted" };
  day.sends = day.sends.filter((t) => now - t < HOUR_MS);
  if (day.sends.length >= ALERTS_PER_HOUR) {
    day.pending.push({ id, t: now });
    return { send: false, suppressed: "cap" };
  }
  day.sends.push(now);
  return { send: true };
}

/** Whether the held alerts fall due: some are held, and `now` is in a later ET hour than the first. New York's offset
 * is a whole number of hours, so its hours begin on the UTC hours. */
export function batchDue(day: WatchDay, now: number): boolean {
  const first = day.pending[0];
  return first !== undefined && Math.floor(now / HOUR_MS) > Math.floor(first.t / HOUR_MS);
}

/** The held alerts' ids, in the order held; `pending` is emptied. */
export function takeBatch(day: WatchDay): string[] {
  const ids = day.pending.map((p) => p.id);
  day.pending = [];
  return ids;
}

/* ---------- the records ---------- */

/** The print an alert read, as `alerts.jsonl` keeps it. */
export type QuoteSnap = {
  market: Market;
  price: number;
  asOf: string;
  feed: string;
  status: WatchQuote["status"];
  prevClose: number | null;
  chgPct: number | null;
  receivedAt: string | null;
};

/** The snapshot of `q`, or `null` without a price or an `as_of`. */
export function snapOf(q: WatchQuote): QuoteSnap | null {
  if (q.price === null || q.asOf === null) return null;
  return { market: q.market, price: q.price, asOf: q.asOf, feed: q.feed, status: q.status, prevClose: q.prevClose, chgPct: q.changePct, receivedAt: q.receivedAt };
}

/** One alert: what fired, what it read, and what the gate decided. A filing's `label` is its form. */
export type AlertHit = {
  t: string;
  kind: "alert";
  id: string;
  pass: string;
  date: string;
  key: string;
  market: Market;
  symbol: string;
  label: string;
  trigger: KeyTrigger | FilingTrigger;
  gap: boolean;
  quote: QuoteSnap | null;
  holding: { qty: number; avgCost: number } | null;
  plan: string | null;
  source: { file: string; index: number };
  decision: "send" | "suppressed";
  suppressed?: "cooldown" | "cap" | "muted" | "off" | "window";
  annotate: boolean;
  /** Its rule said `urgent: true`: sent `urgent`, through quiet hours (src/phone.ts). Absent otherwise. */
  urgent?: true;
  /** The date of the close a price alert measured from (an A share's: its session date). Absent on older records,
   * whose `date` stands in. */
  ref?: string;
  /** A US price alert's phase. Absent on an A share's, a filing's and older records. */
  phase?: UsPhase;
  /** It fired on a lone print outside the regular session. Absent otherwise. */
  onePrint?: true;
};

/** A sent alert's delivery: its `delivery.sent` ids are `<network>:<id>` - alerts.jsonl keeps an older face's numeric
 * ids as written, and src/watch.ts reads them as `telegram:<n>` in memory. `tradeMs` from the quote's `as_of`,
 * `receivedMs` from its `receivedAt`, each to the send resolving; both `null` for a send the outlet queued, and for a replay. `replayed` marks an orphan sent late at the
 * ledger's first read ({@link findOrphans}). */
export type AlertDelivered = {
  t: string;
  kind: "delivered";
  id: string;
  delivery: DeliverResult;
  latency: { tradeMs: number | null; receivedMs: number | null };
  replayed?: true;
};

/** One batch of capped alerts: sent, or dropped when it fell due under OFF or MUTE. */
export type AlertBatch = { t: string; kind: "batch"; id: string; date: string; alerts: string[]; delivery?: DeliverResult; dropped?: "off" | "muted" };

/** One pass's annotation turn: opened on a session, or refused. */
export type AlertAnnotation = {
  t: string;
  kind: "annotation";
  pass: string;
  alerts: string[];
  result: "opened" | "refused";
  reason?: string;
  sessionId?: string;
};

/** A line of `alerts.jsonl`. */
export type AlertRecord = AlertHit | AlertDelivered | AlertBatch | AlertAnnotation;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isText = (x: unknown): x is string => typeof x === "string";
const isTexts = (x: unknown): x is string[] => Array.isArray(x) && x.every(isText);

/** Whether `x` is one of the four records, by its `t`, its `kind` and the fields the rebuild and the Desk view read. */
export function isAlertRecord(x: unknown): x is AlertRecord {
  if (!isRecord(x) || !isText(x.t)) return false;
  switch (x.kind) {
    case "alert":
      return isText(x.id) && isText(x.pass) && isText(x.date) && isText(x.key) && isText(x.symbol) && (x.market === "us" || x.market === "cn")
        && (x.decision === "send" || x.decision === "suppressed") && (x.suppressed === undefined || isText(x.suppressed))
        && (x.ref === undefined || isText(x.ref)) && (x.phase === undefined || x.phase === "pre" || x.phase === "regular" || x.phase === "after")
        && (x.onePrint === undefined || x.onePrint === true);
    case "delivered":
      return isText(x.id) && isRecord(x.delivery) && isRecord(x.latency);
    case "batch":
      return isText(x.id) && isText(x.date) && isTexts(x.alerts);
    case "annotation":
      return isText(x.pass) && isTexts(x.alerts) && (x.result === "opened" || x.result === "refused");
    default:
      return false;
  }
}

/* ---------- the rebuild ---------- */

/** How old an orphan may be and still be sent late at the ledger's first read: ten minutes (spec §16 H2). */
export const ALERT_REPLAY_MS = 600_000;

/**
 * The orphans in `alerts.jsonl` (spec §16 H2): each `send` decision of the last 36 hours with no `delivered` record
 * for its id - a restart came between the watch's two writes. One younger than {@link ALERT_REPLAY_MS} is to be
 * replayed, sent late; an older one is lost, named in one line. Each list in the ledger's order.
 * @param records - the file's lines, parsed; anything not a record is skipped.
 * @param now - the time of the read.
 */
export function findOrphans(records: readonly unknown[], now: number): { replay: AlertHit[]; lost: AlertHit[] } {
  const delivered = new Set<string>();
  const sends: { at: number; r: AlertHit }[] = [];
  for (const r of records) {
    if (!isAlertRecord(r)) continue;
    if (r.kind === "delivered") delivered.add(r.id);
    else if (r.kind === "alert" && r.decision === "send") {
      const at = Date.parse(r.t);
      if (Number.isFinite(at) && now - at <= ORPHAN_WINDOW_MS) sends.push({ at, r });
    }
  }
  const replay: AlertHit[] = [];
  const lost: AlertHit[] = [];
  for (const { at, r } of sends) {
    if (delivered.has(r.id)) continue;
    (now - at < ALERT_REPLAY_MS ? replay : lost).push(r);
  }
  return { replay, lost };
}

/**
 * The day as `alerts.jsonl` leaves it, from its `alert` and `batch` records of the last {@link REBUILD_WINDOW_MS}: a
 * key's reference is its newest record's `ref` (a record without one: its `date`), alerted, its `lastHitAt` that
 * reference's latest record not suppressed `cooldown`, its side unknown and nothing pending; `sends` the `send`
 * decisions within the hour, but for the `lost` ones - never sent, they spend none of the hour's cap, though each
 * still starts its key's cooldown; `pending` the `cap` alerts no batch lists.
 * @param records - the file's lines, parsed; anything not a record is skipped.
 * @param now - the time of the rebuild.
 * @param lost - the ids of the orphans {@link findOrphans} found lost.
 */
export function rebuildDay(records: readonly unknown[], now: number, lost: ReadonlySet<string> = new Set()): WatchDay {
  const alerts: { at: number; r: AlertHit }[] = [];
  const batched = new Set<string>();
  for (const r of records) {
    if (!isAlertRecord(r)) continue;
    const at = Date.parse(r.t);
    if (!Number.isFinite(at) || now - at > REBUILD_WINDOW_MS) continue;
    if (r.kind === "alert") alerts.push({ at, r });
    else if (r.kind === "batch") for (const id of r.alerts) batched.add(id);
  }
  alerts.sort((a, b) => a.at - b.at);
  const refOf = (r: AlertHit): string => r.ref ?? r.date;
  const newest = new Map<string, string>();
  for (const { r } of alerts) newest.set(r.key, refOf(r));
  const day = emptyDay();
  for (const { at, r } of alerts) {
    if (refOf(r) === newest.get(r.key)) {
      const kd = day.keys.get(r.key) ?? { ref: refOf(r), alerted: true, repeats: 0 };
      if (r.suppressed !== "cooldown") kd.lastHitAt = at;
      day.keys.set(r.key, kd);
    }
    if (r.decision === "send" && !lost.has(r.id) && now - at < HOUR_MS && at <= now) day.sends.push(at);
    if (r.suppressed === "cap" && !batched.has(r.id)) day.pending.push({ id: r.id, t: at });
  }
  return day;
}

/* ---------- ids ---------- */

const hex12 = (): string => randomBytes(6).toString("hex");
/** A fresh alert id: `a-` and 12 lowercase hex characters. */
export const alertId = (): string => `a-${hex12()}`;
/** A fresh pass id: `p-` and 12 lowercase hex characters. */
export const passId = (): string => `p-${hex12()}`;
/** A fresh batch id: `b-` and 12 lowercase hex characters. */
export const batchId = (): string => `b-${hex12()}`;
