/** The clocks of the rails.
 *
 * Money has business hours. An ACH moves on bank days and is cut off in the
 * evening; an RWA redemption is cut off at 4pm; a stock settles the next
 * settlement day; a chain, an exchange and a card authorisation never close.
 * These rails keep New York time, so everything here is computed in ET from a
 * UTC instant — never from the machine's own time zone.
 *
 * Holidays are computed by rule, not listed: the Federal Reserve's (a holiday
 * on a Sunday is observed on Monday; one on a Saturday is NOT observed on
 * Friday) and the stock market's (which closes the Friday before a Saturday
 * holiday, closes on Good Friday, and stays open on Columbus Day and Veterans
 * Day). The cut-off and settlement times are the ones the rails publish
 * (same-day ACH 3:00pm, standard ACH 8:30pm, NAV 4:00pm); they are quotes of
 * the rule, not measurements.
 *
 * The stock market's EARLY CLOSES are computed by rule too, from NYSE's own
 * calendar (https://www.nyse.com/trade/hours-calendars, read 2026-10-14; the
 * older /markets/hours-calendars answers HTTP 302 to it): see earlyCloseDate
 * below.
 */
import type { MarketSession, SessionClock, SessionPhase } from "../live/trade.ts";

const NY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export interface EtTime {
  y: number;
  m: number;
  d: number;
  /** 0 Sunday … 6 Saturday */
  dow: number;
  /** minutes since midnight, New York */
  minutes: number;
}

export function et(ms: number): EtTime {
  const p = Object.fromEntries(NY.formatToParts(new Date(ms)).map((x) => [x.type, x.value])) as Record<string, string>;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), dow: DOW.indexOf(p.weekday!), minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** the UTC instant of a New York wall-clock time on a New York date */
export function fromEt(y: number, m: number, d: number, hour = 0, minute = 0): number {
  const noon = Date.UTC(y, m - 1, d, 12);
  const offset = 12 - Math.floor(et(noon).minutes / 60);
  return Date.UTC(y, m - 1, d, hour + offset, minute);
}

const dowOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const nthDow = (y: number, m: number, dow: number, n: number) => 1 + ((7 + dow - dowOf(y, m, 1)) % 7) + 7 * (n - 1);
const lastDow = (y: number, m: number, dow: number) => {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return last - ((7 + dowOf(y, m, last) - dow) % 7);
};

/** Easter Sunday (anonymous Gregorian algorithm): Good Friday is two days before */
function easter(y: number): { m: number; d: number } {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, mm = Math.floor((a + 11 * h + 22 * l) / 451);
  return { m: Math.floor((h + l - 7 * mm + 114) / 31), d: ((h + l - 7 * mm + 114) % 31) + 1 };
}

const key = (m: number, d: number) => m * 100 + d;

function holidays(y: number, market: boolean): Set<number> {
  const out = new Set<number>();
  // a fixed-date holiday: the bank observes a Sunday on Monday and ignores a Saturday; the market also closes the Friday before a Saturday
  const fixed = (m: number, d: number, fridayBefore = market) => {
    const dow = dowOf(y, m, d);
    if (dow === 0) out.add(key(m, d + 1));
    else if (dow === 6) {
      if (fridayBefore) out.add(key(m, d - 1));
    } else out.add(key(m, d));
  };
  // New Year's Day on a Saturday is observed by neither (the market does not close 31 December)
  fixed(1, 1, false);
  out.add(key(1, nthDow(y, 1, 1, 3)));
  out.add(key(2, nthDow(y, 2, 1, 3)));
  out.add(key(5, lastDow(y, 5, 1)));
  fixed(6, 19);
  fixed(7, 4);
  out.add(key(9, nthDow(y, 9, 1, 1)));
  out.add(key(11, nthDow(y, 11, 4, 4)));
  fixed(12, 25);
  if (market) {
    const e = easter(y);
    const good = new Date(Date.UTC(y, e.m - 1, e.d - 2));
    out.add(key(good.getUTCMonth() + 1, good.getUTCDate()));
  } else {
    out.add(key(10, nthDow(y, 10, 1, 2)));
    fixed(11, 11);
  }
  return out;
}

const cache = new Map<string, Set<number>>();
const holidaySet = (y: number, market: boolean) => {
  const k = `${y}:${market}`;
  if (!cache.has(k)) cache.set(k, holidays(y, market));
  return cache.get(k)!;
};

/** a day the banks settle: Monday to Friday, not a Federal Reserve holiday */
export function isBankDay(ms: number): boolean {
  const t = et(ms);
  return t.dow >= 1 && t.dow <= 5 && !holidaySet(t.y, false).has(key(t.m, t.d));
}

/** a day the stock market trades its regular session */
export function isMarketDay(ms: number): boolean {
  const t = et(ms);
  return t.dow >= 1 && t.dow <= 5 && !holidaySet(t.y, true).has(key(t.m, t.d));
}

/** the UTC instant of `hour:minute` New York time, `n` bank days after the New York date of `ms` (n = 0: that date itself, which must then be a bank day) */
function bankDayAt(ms: number, n: number, hour: number, minute = 0): number {
  const t = et(ms);
  let at = fromEt(t.y, t.m, t.d, hour, minute);
  let left = n;
  while (left > 0) {
    at += DAY;
    const x = et(at);
    at = fromEt(x.y, x.m, x.d, hour, minute);
    if (isBankDay(at)) left--;
  }
  return at;
}

/** the first bank day that is not before `ms` (its New York date), at `hour:minute` */
function firstBankDay(ms: number, hour: number, minute = 0): number {
  const t = et(ms);
  let at = fromEt(t.y, t.m, t.d, hour, minute);
  while (!isBankDay(at)) {
    at += DAY;
    const x = et(at);
    at = fromEt(x.y, x.m, x.d, hour, minute);
  }
  return at;
}

const ACH_CUTOFF = 20 * 60 + 30;
const SAME_DAY_CUTOFF = 15 * 60;
const NAV_CUTOFF = 16 * 60;

/** A standard ACH: handed to the network on the first bank day whose 8:30pm cut-off has not passed, settled at 9:00am the bank day after. */
export function achArrival(nowMs: number): number {
  const t = et(nowMs);
  const today = isBankDay(nowMs) && t.minutes < ACH_CUTOFF;
  const processed = today ? nowMs : firstBankDay(nowMs + (isBankDay(nowMs) ? DAY : 0), 0);
  return bankDayAt(processed, 1, 9);
}

/** A same-day ACH: before 3:00pm on a bank day it settles that evening; after that it goes out as a standard one. */
export function sameDayAchArrival(nowMs: number): number {
  const t = et(nowMs);
  return isBankDay(nowMs) && t.minutes < SAME_DAY_CUTOFF ? fromEt(t.y, t.m, t.d, 17) : achArrival(nowMs);
}

/** An instruction that needs the fund's daily price (a non-instant redemption): in before 4:00pm on a business day, paid the next business day; otherwise the one after. */
export function navArrival(nowMs: number): number {
  const t = et(nowMs);
  const today = isBankDay(nowMs) && t.minutes < NAV_CUTOFF;
  const accepted = today ? nowMs : firstBankDay(nowMs + (isBankDay(nowMs) ? DAY : 0), 0);
  return bankDayAt(accepted, 1, 17);
}

/** Cash from a sale is withdrawable when the trade settles: the settlement day after its TRADE DATE. A fill in the overnight session (from
 * 8pm) carries the next trading day's date, so Monday 9pm is a Tuesday trade and settles Wednesday. */
export function settlementArrival(nowMs: number): number {
  const t = et(nowMs);
  let trade = fromEt(t.y, t.m, t.d, 12);
  if (t.minutes >= 20 * 60 || !isMarketDay(trade)) {
    do trade += DAY;
    while (!isMarketDay(trade));
  }
  return bankDayAt(trade, 1, 9);
}

export type Session = "overnight" | "pre-market" | "regular" | "after-hours" | "closed";

// the stock market's day, in minutes after midnight New York: pre-market from 04:00, the regular session 09:30 to 16:00 (13:00 on an early
// close), after-hours to 20:00 (17:00 on an early close), and the overnight session from 20:00 to 04:00 ahead of a market day
const PRE_START = 4 * 60;
const REGULAR_OPEN = 9 * 60 + 30;
const REGULAR_CLOSE = 16 * 60;
const EARLY_CLOSE = 13 * 60;
const AFTER_END = 20 * 60;
const EARLY_AFTER_END = 17 * 60;
const OVERNIGHT_START = 20 * 60;

/** Whether a New York date is one of the market's EARLY CLOSES, when it is a market day at all (isMarketDay says that). NYSE's calendar
 * (https://www.nyse.com/trade/hours-calendars, read 2026-10-14; /markets/hours-calendars answers HTTP 302 to it) lists them in its
 * footnotes, each "Each market will close early at 1:00 p.m. (1:15 p.m. for eligible options)" and "NYSE American Equities, NYSE Arca
 * Equities, NYSE National, and NYSE Texas late trading sessions will close at 5:00 p.m.": Friday 27 November 2026, Friday 26 November 2027 and Friday 24 November 2028 ("the day after
 * Thanksgiving"), Thursday 24 December 2026, and Monday 3 July 2028. It lists none on Thursday 2 July 2026 (Independence Day is observed on
 * Friday 3 July that year), none on 23 or 24 December 2027 (Christmas falls on a Saturday and Friday 24 December is the observed holiday)
 * and none on Friday 2 July 2027 (3 July is a Saturday). The rule that gives exactly those dates: the Friday after Thanksgiving, and 24
 * December and 3 July when either is a market day — not when it is the observed holiday itself or a weekend, and then no other day closes
 * early in its place */
function earlyCloseDate(y: number, m: number, d: number): boolean {
  if (m === 11) return d === nthDow(y, 11, 4, 4) + 1;
  return (m === 12 && d === 24) || (m === 7 && d === 3);
}
/** the regular session's close and the after-hours session's end on a New York date, in minutes after midnight */
const closeOf = (y: number, m: number, d: number): number => (earlyCloseDate(y, m, d) ? EARLY_CLOSE : REGULAR_CLOSE);
const afterEndOf = (y: number, m: number, d: number): number => (earlyCloseDate(y, m, d) ? EARLY_AFTER_END : AFTER_END);
/** `minutes` after midnight on a New York date, as the UTC instant */
const atMinutes = (y: number, m: number, d: number, minutes: number): number => fromEt(y, m, d, Math.floor(minutes / 60), minutes % 60);
/** the New York date `i` days after `t`'s, counted in UTC so that no daylight-saving change skips or repeats one */
function dateAfter(t: EtTime, i: number): { y: number; m: number; d: number } {
  const day = new Date(Date.UTC(t.y, t.m - 1, t.d + i));
  return { y: day.getUTCFullYear(), m: day.getUTCMonth() + 1, d: day.getUTCDate() };
}

/** a day the stock market closes early (13:00 New York, after-hours to 17:00): a market day that is one of NYSE's early closes (see
 * earlyCloseDate) */
export function isEarlyClose(ms: number): boolean {
  const t = et(ms);
  return isMarketDay(ms) && earlyCloseDate(t.y, t.m, t.d);
}

/** Alpaca's sessions: overnight 8pm–4am from Sunday evening to Friday morning, pre-market 4:00–9:30, regular 9:30–4:00, after-hours 4:00–8:00.
 * On an early close the regular session ends at 1:00pm and after-hours at 5:00pm (NYSE's late trading sessions "will close at 5:00 p.m."),
 * and from then until 8pm the market is closed */
export function marketSession(ms: number): Session {
  const t = et(ms);
  const open = isMarketDay(ms);
  const close = closeOf(t.y, t.m, t.d);
  if (open && t.minutes >= PRE_START && t.minutes < REGULAR_OPEN) return "pre-market";
  if (open && t.minutes >= REGULAR_OPEN && t.minutes < close) return "regular";
  if (open && t.minutes >= close && t.minutes < afterEndOf(t.y, t.m, t.d)) return "after-hours";
  // the overnight session belongs to the NEXT trading day: Sunday to Thursday evening before a market day, and until 4am on one
  if (t.minutes >= OVERNIGHT_START && t.dow <= 4 && isMarketDay(ms + DAY)) return "overnight";
  if (t.minutes < PRE_START && open) return "overnight";
  return "closed";
}

/** The REGULAR SESSION (9:30 to 16:00 New York — to 13:00 on an early close — on a market day) under way at `ms`, or else the next one:
 * whether it is under way, and the instants it opens and closes. A market day is isMarketDay's, so the market's holidays are closed days;
 * an early close is isEarlyClose's */
export function nextRegularSession(ms: number): { open: boolean; opensAt: number; closesAt: number } {
  const t = et(ms);
  // the New York dates from this one on; a market day is never more than four days away (a weekend beside a holiday)
  for (let i = 0; i < 10; i++) {
    const { y, m, d } = dateAfter(t, i);
    const closesAt = atMinutes(y, m, d, closeOf(y, m, d));
    if (ms >= closesAt || !isMarketDay(closesAt)) continue;
    const opensAt = atMinutes(y, m, d, REGULAR_OPEN);
    return { open: ms >= opensAt, opensAt, closesAt };
  }
  throw new Error(`no market day within ten days of ${new Date(ms).toISOString()}`);
}

/** The regular session as a market carries it (live/trade.ts Market.session), from this calendar: in session now (marketSession says
 * "regular") and, ISO, when it closes while it is open, or when it next opens while it is not. This is the session of a venue that sends
 * every stock order for the regular session (Robinhood's market_hours "regular_hours") */
export function regularSession(ms: number): { open: boolean; opensAt?: string; closesAt?: string } {
  const s = nextRegularSession(ms);
  return marketSession(ms) === "regular" ? { open: true, closesAt: new Date(s.closesAt).toISOString() } : { open: false, opensAt: new Date(s.opensAt).toISOString() };
}

const PHASE: Record<Session, SessionPhase> = { "pre-market": "pre", regular: "regular", "after-hours": "after", overnight: "overnight", closed: "closed" };

/** the US stock market's phase at `ms` (live/trade.ts SessionPhase), from marketSession: pre-market "pre", the regular session "regular",
 * after-hours "after", the overnight session "overnight", anything else "closed" — the instant asked, which may be a quote's own time and
 * not now */
export function usPhaseAt(ms: number): SessionPhase {
  return PHASE[marketSession(ms)];
}

/** when the phase under way at `ms` ends: the first of the day's turns (04:00, 09:30, the close, the end of after-hours, 20:00 New York, on
 * this date and the ones after it) at which usPhaseAt says another phase. A weekend's closed phase ends on Sunday 20:00 when Monday is a
 * market day, or at a later evening's 20:00 or morning's 04:00 when it is not */
export function usPhaseEndsAt(ms: number): number {
  const now = usPhaseAt(ms);
  const t = et(ms);
  for (let i = 0; i < 10; i++) {
    const { y, m, d } = dateAfter(t, i);
    for (const minutes of [PRE_START, REGULAR_OPEN, closeOf(y, m, d), afterEndOf(y, m, d), OVERNIGHT_START]) {
      const at = atMinutes(y, m, d, minutes);
      if (at > ms && usPhaseAt(at) !== now) return at;
    }
  }
  throw new Error(`no change of the market's phase within ten days of ${new Date(ms).toISOString()}`);
}

/** When a DAY order placed at `ms` ends (Alpaca's rule, its orders page: a day order is canceled after the close, one sent after the close
 * waits for the next day; with extended hours it carries through pre-market, the regular session and after-hours and is canceled at 8:00pm
 * — one placed in the overnight session too): the regular close of the market day it is placed in or before — the next market day's when it
 * is placed after that close, or in the overnight session ahead of it — or, `extended`, that market day's end of after-hours, 20:00 New York
 * (17:00 on an early close), the next market day's when placed after it */
export function usDayEndAt(ms: number, extended: boolean): number {
  const t = et(ms);
  for (let i = 0; i < 10; i++) {
    const { y, m, d } = dateAfter(t, i);
    const end = atMinutes(y, m, d, extended ? afterEndOf(y, m, d) : closeOf(y, m, d));
    if (ms >= end || !isMarketDay(end)) continue;
    return end;
  }
  throw new Error(`no market day within ten days of ${new Date(ms).toISOString()}`);
}

/** the US stock market's clock (live/trade.ts SessionClock), from this calendar: a public source of US stocks carries it, so a paper account
 * judges a quote's own time by it and ends a DAY order at its close */
export const usClock: SessionClock = { city: "New York", zone: "America/New_York", phaseAt: usPhaseAt, dayEndAt: usDayEndAt };

/** The US stock market's session at `ms` IN FULL, as a market carries it (live/trade.ts MarketSession): the regular session as
 * regularSession says it (in session now, and its close, or the next open), which phase is on and when it ends, and whether a limit order
 * may be sent for the session that is on (`extendedHours`): in pre-market and after-hours always, in the overnight session only where
 * `overnight` says the market is traded overnight (a source with a price in that session: Robinhood's 24-hour market) */
export function usSessionFull(ms: number, overnight: boolean): MarketSession {
  const phase = usPhaseAt(ms);
  return { ...regularSession(ms), phase, phaseEndsAt: new Date(usPhaseEndsAt(ms)).toISOString(), extendedHours: phase === "pre" || phase === "after" || (phase === "overnight" && overnight) };
}

/** `Tue 6 Oct` — a New York date as a person reads it */
export function etDate(ms: number): string {
  const t = et(ms);
  return `${DOW[t.dow]} ${t.d} ${MONTH[t.m - 1]}`;
}

/** how long until money lands, in the page's words: `now` · `~2 min` · `~3 h` · `Tue 6 Oct` */
export function whenLabel(nowMs: number, arrivalMs: number): string {
  const wait = arrivalMs - nowMs;
  if (wait <= 60_000) return "now";
  if (wait < HOUR) return `~${Math.round(wait / 60_000)} min`;
  const a = et(nowMs), b = et(arrivalMs);
  if (a.y === b.y && a.m === b.m && a.d === b.d) return `~${Math.round(wait / HOUR)} h`;
  return etDate(arrivalMs);
}
