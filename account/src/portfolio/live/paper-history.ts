/** A PAPER ACCOUNT'S PAST, told again from its own book.
 *
 * A paper account (paper.ts) is the account's own record: every order it ever filled is in its book (`book.orders` is never pruned — the
 * fills list keeps only the last 500, so the replay is not built from it), with the size filled, the price, the fee and when. So what the paper
 * account was worth at any moment since it started is KNOWN, not guessed: its cash is the starting money moved by each fill in turn, and
 * what it held is valued at the public sources' price bars between the fills. This module does that, and says which bars it needs
 * (paperBarsWanted), and nothing else: it is pure (no file, no network, no clock), the caller hands it the book and the bars and gets the
 * curve back.
 *
 * What is read, and what it is:
 *   the book     `PaperBook` (paper.ts): `createdAt` and `startCashUsd` (the start: that much cash, nothing held), every order whose
 *                `filledQty` is above zero, in the order of its fill time (`filledAt` where the book keeps one, else `updatedAt`: a filled
 *                order changes no more), at its `avgPrice` and its `feeUsd`; each market's kind and quote (every market a paper account trades is
 *                priced in dollars: one that is not — a book written by hand — is left out, and that is said) (`book.markets[symbol]`), and an event's settlement as its venue said it
 *                (`settled`: what a contract paid, and when the venue settled it); the funding each perpetual paid or received
 *                (`book.funding`, hour by hour, where the book keeps it) and each open position's own running total of it
 *                (`book.positions[symbol].fundingUsd`); the paper money the owner added since it started (`book.deposits`, each at its
 *                moment: cash put in from then on)
 *   the bars     `PriceSeries`: one symbol's bars at one interval (1m to 1w; the rebuild asks 5m, 1h and 1d), oldest first, as the paper
 *                account's own `candles` passes them through from the market's source (public-markets.ts). A bar's close is known when the
 *                bar has closed — its start plus
 *                its interval, unless the series says otherwise (`closeAt`: a source whose daily bar is stamped at the session's open closes
 *                it at the session's end, not a day later)
 *
 * How the book moves, as fill() moves it (paper.ts):
 *   a holding    a coin, a share, a token, an event contract: a buy moves cash by −(qty × price + fee) and adds the qty; a sell by
 *                +(qty × price − fee) and takes it away. An event's settlement (an order the engine wrote, `settlement-…`) is a sell at
 *                what the venue paid
 *   a perpetual  the side, the size and the average entry kept exactly as fill() keeps them: an order on the position's side (or with none
 *                open) opens or adds, an order on the other side reduces it up to the position and never flips it. The margin put up is
 *                the paper account's own money still, so here it is counted as cash: opening moves cash by −fee only, reducing by
 *                +realised − fee, realised being (price − entry) × qty for a long and (entry − price) × qty for a short — and, the margin
 *                being all a position can lose, by the loss past it back again, as the order says it (`lossPastMarginUsd`). A liquidation
 *                (an order the engine wrote, `liquidation-…`) is a reduce at its price. Funding moves cash by what was paid, at its time
 *
 * What it is worth at a moment t: the cash, plus each holding's qty × its close at t, plus each perpetual's unrealised
 * profit at its close at t. The close at t is that of the latest bar whose close is known at or before t — of every series given for the
 * symbol, the bar that closed last; where two closed at the same moment, the finer one's (5m before 1h before 1d): a finer series that has
 * stopped (a venue that drops its no-trade bars, a window that ends) never stands over a coarser bar that closed after it. An event
 * contract its venue has settled is worth what the venue paid from the moment the venue says it settled (`settled.at`: Kalshi's
 * settlement_ts, Gamma's closedTime — the end of its oracle's resolution — both read live 2026-10-14), not its last bar, until the account
 * wrote the payout at its next look. No bar known yet: the last price the paper account traded that symbol at, at or before t — a price it
 * really traded at — and the point is marked partial, with the symbol in `missing`.
 *
 * The points: one at the book's start (its starting money) when that is inside the range — or, a book started before the range, one at the
 * range's start itself, valued as every point is, so that a curve and its change start where the account stood then and not at the grid's
 * first step after it — then one at every multiple of `stepMs` from the range's start (never before the book's start) to its end; when the
 * caller gives the live value now (`nowUsd`), the last point, at the range's end, is that — it has in it what the replay cannot see.
 * Rounded to cents.
 *
 * What it cannot know is said, in `inexact`, in plain sentences, never papered over — and only when it is so, with the book's own figure:
 * funding an open position paid that the book's list hour by hour does not have (its `fundingUsd` against the list), the loss past the
 * position's margin of a liquidation whose order does not say it (a book's from before it was written down: the margin rests on a leverage
 * the order does not keep), a symbol with no bars. And the replay checks itself against the book: the cash and
 * margin it ends with (any funding missing from the list shows here, with its size), and what it ends holding, on which side, against the
 * book's own — a difference is said, with its size.
 */
import type { PaperBook, PaperMarketRef, PaperOrder } from "./paper.ts";
import { inDollars, INTERVAL_MS, plain, type Candle, type CandleInterval } from "./trade.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** how long a bar of each interval lasts: its close is known this long after its start, unless its series says otherwise */
const BAR_MS: Readonly<Record<CandleInterval, number>> = INTERVAL_MS;
/** finer first: where two bars closed at the same moment, the finer one's close stands */
const FINENESS: Readonly<Record<CandleInterval, number>> = { "1m": 0, "5m": 1, "15m": 2, "1h": 3, "4h": 4, "1d": 5, "1w": 6 };
/** the most points one rebuild draws: a range and a step that ask for more are a mistake of the caller's, not a curve */
export const REBUILD_MAX_POINTS = 50_000;
/** a difference between the replay's cash and the book's smaller than this is the two roundings, not something the replay missed */
const CASH_TOLERANCE_USD = 0.01;
const QTY_EPS = 1e-9;

export interface PriceSeries {
  symbol: string;
  interval: CandleInterval;
  /** oldest first */
  candles: Candle[];
  /** when the bar's close is known (ms); absent: its start plus the interval */
  closeAt?: (c: Candle) => number;
}

export interface RebuiltEquity {
  /** oldest first; `partial`: a symbol held then had no bar known yet, and is valued at the last price the account traded it at */
  points: Array<{ at: number; usd: number; partial?: true }>;
  /** the paper money the book started with */
  startUsd: number;
  /** when the book started (ms): no point is ever before it */
  createdAt: number;
  /** symbols held at some point with no price bar known at that point */
  missing: string[];
  /** plain sentences on what the rebuild cannot know */
  inexact: string[];
}

/** the book replayed: cash (with the margin of every open perpetual in it, as equity counts it), what is held, the perpetuals open */
export interface PaperReplay {
  cashUsd: number;
  held: Record<string, number>;
  positions: Record<string, { side: "long" | "short"; qty: number; entryPrice: number }>;
}

const round = (x: number, places: number): number => Number(x.toFixed(places));
const cents = (x: number): number => round(x, 2);
const iso = (ms: number): string => new Date(ms).toISOString();
const usd = (n: number): string => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** an order the engine wrote itself: a perpetual liquidated at the mark, an event contract paid out at its settlement */
const isLiquidation = (o: PaperOrder): boolean => typeof o.clientId === "string" && o.clientId.startsWith("liquidation-");
const isSettlement = (o: PaperOrder): boolean => typeof o.clientId === "string" && o.clientId.startsWith("settlement-");

/** when an order filled: its own fill time where the book keeps one, else when it last changed (a filled order changes no more), else when
 * it was placed */
function filledAtOf(o: PaperOrder): number {
  const f = (o as PaperOrder & { filledAt?: unknown }).filledAt;
  const own = typeof f === "string" ? Date.parse(f) : finite(f) ? f : NaN;
  if (Number.isFinite(own)) return own;
  const updated = Date.parse(o.updatedAt);
  return Number.isFinite(updated) ? updated : Date.parse(o.at);
}

/** the book's order refs are p1, p2 … in the order it wrote them: the tie-break between two things at the same millisecond */
const seqOf = (ref: string, i: number): number => {
  const m = /^p(\d+)$/.exec(ref);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER - 1_000_000 + i;
};

/** a market priced in dollars (or one the book does not describe) */
const dollarMarket = (ref: PaperMarketRef | undefined): boolean => !ref || inDollars(String(ref.quote ?? ""));

/** what the replay says as it goes: its sentences, and the fills it left out (the cash check names them) */
interface Told {
  notes: Set<string>;
  left: string[];
}
const told = (): Told => ({ notes: new Set(), left: [] });
const leaveOut = (t: Told, ref: string, sentence: string): void => {
  t.notes.add(sentence);
  t.left.push(ref);
};

type Step =
  | { kind: "fill"; at: number; rank: number; seq: number; o: PaperOrder; qty: number; price: number; fee: number }
  | { kind: "funding"; at: number; rank: number; seq: number; symbol: string; usd: number }
  | { kind: "deposit"; at: number; rank: number; seq: number; usd: number };

/** where each thing that moved the book falls among the things at the same millisecond: the order of the book's own pass (see stepsOf) —
 * and paper money the owner added (a signed topUpPaper, taken by the door between the book's looks) before all of it */
const RANK = { deposit: -1, funding: 0, liquidation: 1, fill: 2, settlement: 3 } as const;

/** everything that moved the book, in the order it happened. At one millisecond the book's own pass runs in this order (paper.ts settle):
 * the perpetuals marked first — each one's funding, then its liquidation where the margin left has fallen that far (one perpetual's funding
 * and another's liquidation move different things, so every funding is placed before every liquidation) — then the orders judged, then
 * the event contracts settled. So a position a look liquidates is gone before an order the same look fills opens the next one, and a
 * contract sold in part in a look is paid out on what is left. Funding a fill pays before it moves its position (paper.ts fill) is
 * stamped at the hour it settles to, at or before the fill: first as well */
function stepsOf(book: PaperBook, t: Told): Step[] {
  const out: Step[] = [];
  Object.values(book.orders ?? {}).forEach((o, i) => {
    if (!o || !(finite(o.filledQty) && o.filledQty > 0)) return;
    const at = filledAtOf(o);
    if (!Number.isFinite(at)) {
      leaveOut(t, o.ref, `${o.ref} (${o.symbol}) is filled with no time the replay can read, so it is left out of the curve`);
      return;
    }
    if (!(finite(o.avgPrice) && o.avgPrice >= 0)) {
      leaveOut(t, o.ref, `${o.ref} (${o.symbol}) is filled with no price on it, so it is left out of the curve`);
      return;
    }
    const ref = book.markets?.[o.symbol];
    if (!dollarMarket(ref)) {
      leaveOut(t, o.ref, `${o.ref} (${o.symbol}) is priced in ${ref!.quote}, not dollars, so it is left out of the curve`);
      return;
    }
    if (o.status === "partial" || o.filledQty < o.qty - QTY_EPS)
      t.notes.add(`${o.ref} (${o.symbol}) filled ${plain(o.filledQty)} of ${plain(o.qty)}: the replay places all of it at its last fill (${iso(at)}), at its average price`);
    const rank = isLiquidation(o) ? RANK.liquidation : isSettlement(o) ? RANK.settlement : RANK.fill;
    out.push({ kind: "fill", at, rank, seq: seqOf(o.ref, i), o, qty: o.filledQty, price: o.avgPrice, fee: finite(o.feeUsd) ? o.feeUsd : 0 });
  });
  (book.funding ?? []).forEach((f, i) => {
    const at = Date.parse(f?.at ?? "");
    if (!Number.isFinite(at) || !finite(f.usd)) return;
    out.push({ kind: "funding", at, rank: RANK.funding, seq: i, symbol: f.symbol, usd: f.usd });
  });
  // paper money the owner added (topUpPaper): cash from its moment on, put in — never a gain
  (book.deposits ?? []).forEach((d, i) => {
    const at = Date.parse(d?.at ?? "");
    if (!Number.isFinite(at) || !finite(d.usd)) return;
    out.push({ kind: "deposit", at, rank: RANK.deposit, seq: i, usd: d.usd });
  });
  return out.sort((a, b) => a.at - b.at || a.rank - b.rank || a.seq - b.seq);
}

/** the book's state at a moment, moved step by step exactly as the book moved it (paper.ts fill, markPerps, settleEvents) */
class Replay {
  cash: number;
  readonly held = new Map<string, number>();
  readonly positions = new Map<string, { side: "long" | "short"; qty: number; entryPrice: number }>();
  /** the last price each symbol filled at */
  readonly lastPrice = new Map<string, number>();
  /** when each perpetual open now was opened: its funding since is what the position's own `fundingUsd` counts */
  readonly openedAt = new Map<string, number>();
  private next = 0;

  constructor(private readonly book: PaperBook, private readonly steps: Step[], private readonly told: Told) {
    this.cash = book.startCashUsd;
  }

  /** every step at or before `t` applied */
  until(t: number): void {
    while (this.next < this.steps.length && this.steps[this.next]!.at <= t) this.apply(this.steps[this.next++]!);
  }

  private apply(s: Step): void {
    if (s.kind === "funding") {
      this.cash = round(this.cash - s.usd, 6);
      return;
    }
    if (s.kind === "deposit") {
      this.cash = round(this.cash + s.usd, 6);
      return;
    }
    const { o, qty, price, fee } = s;
    const kind = this.book.markets?.[o.symbol]?.kind;
    if (kind === undefined) this.told.notes.add(`the book does not say what market ${o.symbol} is: its fills are replayed as a holding bought and sold`);
    this.lastPrice.set(o.symbol, price);
    if (kind === "perp") return this.perp(s);
    const notional = round(qty * price, 8);
    const was = this.held.get(o.symbol) ?? 0;
    if (o.side === "buy") {
      this.cash = round(this.cash - notional - fee, 6);
      this.held.set(o.symbol, round(was + qty, 12));
      return;
    }
    // a sell (a settlement is one, at what the venue paid): the cash as the book took it; the holding never below nothing
    this.cash = round(this.cash + notional - fee, 6);
    if (was + QTY_EPS < qty) this.told.notes.add(`${o.ref} sells ${plain(qty)} ${o.symbol} where the replay holds ${plain(was)}: the book has a fill the replay cannot account for`);
    const left = round(was - qty, 12);
    if (left <= QTY_EPS) this.held.delete(o.symbol);
    else this.held.set(o.symbol, left);
  }

  private perp(s: Extract<Step, { kind: "fill" }>): void {
    const { o, qty, price, fee } = s;
    const p = this.positions.get(o.symbol);
    const opposite = !!p && ((p.side === "long" && o.side === "sell") || (p.side === "short" && o.side === "buy"));
    if (isLiquidation(o) && !opposite) {
      leaveOut(this.told, o.ref, `${o.ref} liquidates ${o.symbol} where the replay has no position open to liquidate, so it is left out of the curve`);
      return;
    }
    if (opposite && p) {
      const q = Math.min(qty, p.qty);
      if (qty > p.qty + QTY_EPS) this.told.notes.add(`${o.ref} closes ${plain(qty)} ${o.symbol} where the replay has ${plain(p.qty)} open: the book never flips a side in one order, so only the position is closed here`);
      const realised = round((p.side === "long" ? price - p.entryPrice : p.entryPrice - price) * q, 6);
      // isolated margin: a loss past the margin was never taken from the cash, and the order says how much of it (lossPastMarginUsd). The
      // margin here is counted with the cash, so whatever of the position's margin the engine took for the loss — the part closed, and on a
      // partial close the margin left before anything past it — is in realised − fee already: what is added back is only what the margin did
      // not take, and the replay's cash and margin move as the book's did
      const past = finite(o.lossPastMarginUsd) && o.lossPastMarginUsd > 0 ? o.lossPastMarginUsd : 0;
      this.cash = round(this.cash + realised - fee + past, 6);
      if (q >= p.qty - QTY_EPS) {
        this.positions.delete(o.symbol);
        this.openedAt.delete(o.symbol);
      } else p.qty = round(p.qty - q, 12);
      return;
    }
    if (o.reduceOnly) {
      leaveOut(this.told, o.ref, `${o.ref} is reduce-only on ${o.symbol} where the replay has no position to reduce, so it is left out of the curve`);
      return;
    }
    this.cash = round(this.cash - fee, 6);
    if (p) {
      p.entryPrice = round((p.entryPrice * p.qty + price * qty) / (p.qty + qty), 10);
      p.qty = round(p.qty + qty, 12);
    } else {
      this.positions.set(o.symbol, { side: o.side === "buy" ? "long" : "short", qty, entryPrice: price });
      this.openedAt.set(o.symbol, s.at);
    }
  }
}

/** the whole book replayed (or up to `untilMs`): what the rebuild starts from at each point, and what it checks itself against the book with */
export function replayPaperBook(book: PaperBook, untilMs = Number.POSITIVE_INFINITY): PaperReplay {
  const t = told();
  const r = new Replay(book, stepsOf(book, t), t);
  r.until(untilMs);
  return { cashUsd: r.cash, held: Object.fromEntries(r.held), positions: Object.fromEntries([...r.positions].map(([k, p]) => [k, { ...p }])) };
}

/** When a book started: its `createdAt`, or — a book that does not say (one edited by hand) — the first thing that moved it, where
 * rebuildEquity starts its curve too; nothing, a book with neither. What a caller asks the rebuild for starts here, never at a time that
 * does not parse */
export function paperBookStart(book: PaperBook): number | undefined {
  const created = Date.parse(book.createdAt);
  return Number.isFinite(created) ? created : stepsOf(book, told())[0]?.at;
}

/** five-minute bars are asked over the last day, and a range a little longer than a day (a clock that moved on) is still told with them */
const FIVE_MINUTE_REACH_MS = DAY + HOUR;
/** hourly bars reach back a month and a day (744 bars; a source gives HISTORY_MOST in one ask now, live/trade.ts — it gave 300 before
 * phase H, twelve days), so a month's curve is hourly from end to end */
const HOURLY_REACH_MS = 31 * DAY;
/** a US stock's daily bars are asked from a week before the range: the session that closed last before it started is in them, over a
 * weekend and the holidays beside one */
const STOCK_DAYS_BACK_MS = 7 * DAY;

/** The bars a book's past from `fromMs` to `now` is told with, to be asked of the paper account's own trader (its market's source): every
 * market it held at `fromMs` or traded since, in the finest bars that reach back that far — five-minute bars over the last day, hourly over
 * the last month (HOURLY_REACH_MS), daily before — each from the bar before the one where it is needed starts: a bar is stamped at its start and a
 * source gives the bars that start at or after what was asked, so the bar that had closed when the range started is the one before the bar
 * the range started in (a coin's daily bar, the one that started at midnight UTC the day before), and without it the range's first point
 * would have no price. And a US stock's daily bars whatever the range: its source keeps minutes for the last market day alone
 * (public-stocks.ts), so before that day's first minute only its daily closes price it — without them it would stand at its fill price
 * through every night and weekend of a day's or a week's curve. Its daily bar is stamped at its session's open, so the caller says it is
 * known at the session's end (a series' `closeAt`), never before */
export function paperBarsWanted(book: PaperBook, fromMs: number, now: number): Array<{ symbol: string; interval: CandleInterval; since: number }> {
  /** the start of the bar before the one that t falls in */
  const barBefore = (t: number, interval: CandleInterval): number => Math.floor(t / BAR_MS[interval]) * BAR_MS[interval] - BAR_MS[interval];
  // the markets held at fromMs, and the ones traded since
  const held = new Map<string, number>();
  const traded = new Set<string>();
  const fills = Object.values(book.orders ?? {}).filter((o) => o?.filledQty > 0).sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  for (const o of fills) {
    const at = Date.parse(o.updatedAt);
    if (at >= fromMs) traded.add(o.symbol);
    else held.set(o.symbol, (held.get(o.symbol) ?? 0) + (o.side === "buy" ? o.filledQty : -o.filledQty) * (book.markets?.[o.symbol]?.kind === "perp" ? 0 : 1));
  }
  for (const sym of Object.keys(book.positions ?? {})) traded.add(sym);
  const symbols = [...new Set([...traded, ...[...held].filter(([, q]) => Math.abs(q) > 1e-12).map(([s]) => s)])];
  const wants: Array<{ symbol: string; interval: CandleInterval; since: number }> = [];
  for (const symbol of symbols) {
    if (now - fromMs <= FIVE_MINUTE_REACH_MS) wants.push({ symbol, interval: "5m", since: barBefore(fromMs, "5m") });
    else {
      wants.push({ symbol, interval: "1h", since: barBefore(Math.max(fromMs, now - HOURLY_REACH_MS), "1h") });
      wants.push({ symbol, interval: "5m", since: now - DAY });
    }
    if (book.markets?.[symbol]?.kind === "stock") wants.push({ symbol, interval: "1d", since: fromMs - STOCK_DAYS_BACK_MS });
    else if (fromMs < now - HOURLY_REACH_MS) wants.push({ symbol, interval: "1d", since: barBefore(fromMs, "1d") });
  }
  return wants;
}

/** one symbol's bars, every series given for it, each walked forward as the points move forward */
interface Walk {
  fineness: number;
  closes: number[];
  prices: number[];
  /** how many of its bars have closed by the last moment asked */
  i: number;
}

function walksOf(series: PriceSeries[]): Map<string, Walk[]> {
  const out = new Map<string, Walk[]>();
  for (const s of series) {
    if (!s || typeof s.symbol !== "string" || !Object.hasOwn(BAR_MS, s.interval) || !Array.isArray(s.candles)) continue;
    const span = BAR_MS[s.interval];
    const bars: Array<[number, number]> = [];
    for (const c of s.candles) {
      if (!c || !finite(c.t) || !finite(c.c) || c.c < 0) continue;
      const closed = s.closeAt ? s.closeAt(c) : c.t + span;
      if (finite(closed)) bars.push([closed, c.c]);
    }
    bars.sort((a, b) => a[0] - b[0]);
    const w: Walk = { fineness: FINENESS[s.interval], closes: bars.map((b) => b[0]), prices: bars.map((b) => b[1]), i: 0 };
    out.set(s.symbol, [...(out.get(s.symbol) ?? []), w]);
  }
  return out;
}

/** the close of the latest bar of `symbol` known at `t` (the moments asked only ever move forward): of every series, the bar that closed
 * last; at the same moment, the finer one's */
function closeAt(walks: Map<string, Walk[]>, symbol: string, t: number): number | undefined {
  let best: { closed: number; fineness: number; price: number } | undefined;
  for (const w of walks.get(symbol) ?? []) {
    while (w.i < w.closes.length && w.closes[w.i]! <= t) w.i++;
    if (w.i === 0) continue;
    const closed = w.closes[w.i - 1]!;
    if (!best || closed > best.closed || (closed === best.closed && w.fineness < best.fineness)) best = { closed, fineness: w.fineness, price: w.prices[w.i - 1]! };
  }
  return best?.price;
}

/** an event contract its venue has settled: what a contract paid, and from when — the venue's own settlement time, which is when the
 * payout was decided (it is at or before the account's next look, when the book wrote the payout) */
function settledOf(book: PaperBook, symbol: string): { payout: number; at: number } | undefined {
  const ref = book.markets?.[symbol];
  const s = ref?.kind === "event" ? ref.settled : undefined;
  const at = s ? Date.parse(s.at) : NaN;
  return s && finite(s.payout) && s.payout >= 0 && Number.isFinite(at) ? { payout: s.payout, at } : undefined;
}

/** "paid $1.20" or "received $0.40": funding as the book counts it, above zero paid */
const paidWords = (x: number): string => `${usd(Math.abs(x))} ${x >= 0 ? "paid" : "received"}`;
/** "a and b", "a, b and c" */
const and = (xs: string[]): string => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
/** "a, b, or c" */
const either = (xs: string[]): string => (xs.length < 2 ? (xs[0] ?? "") : xs.length === 2 ? `${xs[0]} or ${xs[1]}` : `${xs.slice(0, -1).join(", ")}, or ${xs.at(-1)}`);

/** What a paper account was worth from `fromMs` to `toMs`, every `stepMs`, told again from its own book and the public sources' bars (see
 * the top). Throws a RangeError for a step that is not a positive number of milliseconds, a range that ends before it starts, or a range
 * and step that would draw more than REBUILD_MAX_POINTS points: those are the caller's mistake, not a curve */
export function rebuildEquity(book: PaperBook, series: PriceSeries[], o: { fromMs: number; toMs: number; stepMs: number; nowUsd?: number }): RebuiltEquity {
  if (!(finite(o.stepMs) && o.stepMs > 0)) throw new RangeError(`a rebuild's step is a positive number of milliseconds, not ${String(o.stepMs)}`);
  if (!finite(o.fromMs) || !finite(o.toMs)) throw new RangeError("a rebuild's range is two moments in milliseconds");
  if (o.toMs < o.fromMs) throw new RangeError(`a rebuild's range ends before it starts (${o.toMs} before ${o.fromMs})`);
  const said = told();
  const notes = said.notes;
  const steps = stepsOf(book, said);
  let created = Date.parse(book.createdAt);
  if (!Number.isFinite(created)) {
    created = steps[0]?.at ?? o.fromMs;
    notes.add(`the book does not say when it started; the curve starts at ${steps.length ? "its first fill" : "the range's start"} (${iso(created)})`);
  }
  const startUsd = cents(book.startCashUsd);
  const replay = new Replay(book, steps, said);
  const walks = walksOf(series);
  const missing = new Set<string>();
  const points: RebuiltEquity["points"] = [];
  const now = o.nowUsd !== undefined && finite(o.nowUsd) ? o.nowUsd : undefined;

  /** what the book was worth at t (the moments asked only ever move forward): the cash, what it held at its close, its perpetuals' unrealised */
  const worth = (t: number): RebuiltEquity["points"][number] => {
    replay.until(t);
    let value = replay.cash;
    let partial = false;
    const priced = (symbol: string): number => {
      // settled by its venue and not yet paid out by the account: worth what the venue paid, whatever its last bar said
      const settled = settledOf(book, symbol);
      if (settled && settled.at <= t) return settled.payout;
      const c = closeAt(walks, symbol, t);
      if (c !== undefined) return c;
      partial = true;
      missing.add(symbol);
      return replay.lastPrice.get(symbol) ?? 0;
    };
    for (const [symbol, qty] of replay.held) value += qty * priced(symbol);
    for (const [symbol, p] of replay.positions) {
      const c = priced(symbol);
      value += (p.side === "long" ? c - p.entryPrice : p.entryPrice - c) * p.qty;
    }
    return { at: t, usd: cents(value), ...(partial ? { partial: true as const } : {}) };
  };

  const first = Math.ceil(Math.max(o.fromMs, created) / o.stepMs) * o.stepMs;
  const count = first <= o.toMs ? Math.floor((o.toMs - first) / o.stepMs) + 1 : 0;
  if (count > REBUILD_MAX_POINTS) throw new RangeError(`a rebuild of ${count} points is more than the ${REBUILD_MAX_POINTS} one curve draws: a longer step, or a shorter range`);
  if (created >= o.fromMs && created <= o.toMs) points.push({ at: created, usd: startUsd });
  // a book started before the range: where it stood at the range's start, unless the grid has a point there, or the live value is the
  // range's only point
  else if (created < o.fromMs && first !== o.fromMs && !(now !== undefined && o.fromMs === o.toMs)) points.push(worth(o.fromMs));
  for (let k = 0; k < count; k++) {
    const t = first + k * o.stepMs;
    if (t === created) continue;
    // the last point is the live value when it is given: nothing to rebuild there
    if (now !== undefined && t === o.toMs) continue;
    points.push(worth(t));
  }
  if (now !== undefined && o.toMs >= created) {
    while (points.length && points[points.length - 1]!.at >= o.toMs) points.pop();
    points.push({ at: o.toMs, usd: cents(now) });
  }

  // what the rebuild cannot know, said once each — and only what is so, with the book's own figure where it has one
  replay.until(Number.POSITIVE_INFINITY);
  const orders = Object.values(book.orders ?? {}).filter((x): x is PaperOrder => !!x && typeof x.symbol === "string");
  // a liquidation that does not say how far its loss went past the margin (`lossPastMarginUsd`: a book's orders from before it was written
  // down): the margin it lost rests on a leverage the order does not keep. A close or a liquidation that says it is replayed exactly; a close
  // from before it never lost less than its price says (no close was held to its margin then)
  const liquidations = orders.filter((x) => isLiquidation(x) && x.filledQty > 0 && !finite(x.lossPastMarginUsd));
  for (const x of liquidations) {
    const at = filledAtOf(x);
    notes.add(`${x.symbol} was liquidated (${x.ref}${Number.isFinite(at) ? `, ${iso(at)}` : ""}): the replay closes it at its price as a reduce, but a loss past the position's margin is not known to the replay — the order does not say it, the paper account lost no more than the margin, and the margin rests on a leverage the order does not keep — so the curve from then on can sit below the book`);
  }
  if (missing.size)
    notes.add(`no price bar was at hand for ${[...missing].join(", ")} at some points: there ${missing.size === 1 ? "it is" : "they are"} valued at the last price this account traded ${missing.size === 1 ? "it" : "them"} at, and those points are marked partial`);
  // the funding of each open perpetual by the book's own figure (`fundingUsd`, everything it paid or received since it was opened) against
  // the book's list hour by hour since then: what the list does not have — settled before the account kept the list, or past the last it
  // keeps — is not in the curve, and its size is known exactly
  let unlisted = 0;
  for (const [symbol, p] of Object.entries(book.positions ?? {})) {
    if (!p || !finite(p.fundingUsd)) continue;
    const since = replay.openedAt.get(symbol) ?? Number.NEGATIVE_INFINITY;
    const listed = round((book.funding ?? []).reduce((sum, f) => (f?.symbol === symbol && finite(f.usd) && Date.parse(f.at) > since ? sum + f.usd : sum), 0), 6);
    const gap = round(p.fundingUsd - listed, 6);
    if (Math.abs(gap) <= CASH_TOLERANCE_USD) continue;
    unlisted += gap;
    notes.add(`${symbol}'s open position has funding of ${paidWords(p.fundingUsd)} by the book's own figure and ${paidWords(listed)} in its list hour by hour (the rest was settled before the account kept the list): the ${usd(Math.abs(gap))} between them is not in the curve, so before now it sits ${gap > 0 ? "above" : "below"} the book by up to that`);
  }
  // the replay checked against the book: the cash and margin it ends with (the book's margin has every funding payment in it), past the
  // funding said above
  const bookCash = book.cashUsd + Object.values(book.positions ?? {}).reduce((sum, p) => sum + (finite(p?.marginUsd) ? p.marginUsd : 0), 0);
  const off = round(replay.cash - bookCash, 6);
  const rest = round(off - unlisted, 6);
  if (Math.abs(rest) > CASH_TOLERANCE_USD) {
    const perpTraded = orders.some((x) => book.markets?.[x.symbol]?.kind === "perp") || Object.keys(book.positions ?? {}).length > 0 || (book.funding ?? []).length > 0;
    const why = [
      ...(perpTraded ? ["funding paid or received before the account kept it hour by hour"] : []),
      ...(liquidations.length ? ["a liquidation's loss past its margin"] : []),
      ...(said.left.length ? [`${and(said.left)} left out above`] : []),
      "a fill the book no longer has",
    ];
    notes.add(`the replay ends with ${usd(replay.cash)} in cash and margin, the book with ${usd(bookCash)}: ${usd(Math.abs(rest))}${unlisted ? " past the open positions' funding said above" : ""} the replay cannot place in time (${either(why)}), so the curve before now is ${rest > 0 ? "above" : "below"} the book by up to that`);
  }
  // and what it ends holding, a perpetual on which side
  const symbols = new Set([...Object.keys(book.holdings ?? {}), ...replay.held.keys(), ...Object.keys(book.positions ?? {}), ...replay.positions.keys()]);
  for (const symbol of symbols) {
    const mine = replay.held.get(symbol) ?? replay.positions.get(symbol)?.qty ?? 0;
    const theirs = book.holdings?.[symbol]?.qty ?? book.positions?.[symbol]?.qty ?? 0;
    const [mySide, theirSide] = [replay.positions.get(symbol)?.side, book.positions?.[symbol]?.side];
    if (Math.abs(mine - theirs) > Math.max(QTY_EPS, 1e-12 * Math.max(Math.abs(mine), Math.abs(theirs)))) notes.add(`the replay ends holding ${plain(mine)} ${symbol} and the book ${plain(theirs)}: a fill is missing from one of them`);
    else if (mySide && theirSide && mySide !== theirSide) notes.add(`the replay ends ${mySide} ${plain(mine)} ${symbol} and the book ${theirSide}: a fill is missing from one of them or on the other side, so the curve's unrealised profit on it has the wrong sign`);
  }
  return { points, startUsd, createdAt: created, missing: [...missing], inexact: [...notes] };
}
