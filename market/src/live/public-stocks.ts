/** US STOCKS WITHOUT A KEY: real-time quotes where a keyless source gives them — Robinhood's, else Nasdaq's (us-quotes.ts) — and Nasdaq's
 * last regular close (us-closes.ts) where neither prices a share in time, so the Markets screen's Stocks tab — and a paper account — have
 * real US stock prices before any broker is connected. Read-only: nothing is traded through this listing; a US stock trades at a connected
 * broker (Alpaca, Robinhood: "Connect to trade") or in a paper account, which fills at these quotes by its own declared rule (paper.ts).
 * The source keeps the id "cboe" (US_STOCKS_ID): paper books already name it as the source of what they hold. No price is asked of Cboe.
 *
 * Every line says which source priced it and how far behind that source is (quoteFrom: "Robinhood · real time", "Nasdaq · real time",
 * "Nasdaq · close"), with the price's own time (quoteAt: as its source stamps it, or the close's own instant, 16:00 New York on most days)
 * and the delay (delayMs: 0, or US_CLOSE_DELAY_MS for a close, a day old at the least): a paper account judges a fill by them, never by the
 * clock alone, and never fills at a close. The price, bid and ask on a line are all one source's (a close has no bid or ask). A listing asks
 * the real-time chain first, waited for RT_WAIT_MS at most (us-quotes.ts) — Nasdaq only for NASDAQ_AT_ONCE of the lines Robinhood did not
 * price, those it has no recent answer for first — and every line the chain did not price in time, in any phase, is Nasdaq's last close.
 *
 * THE CLOSE LINE — the market closed (20:00 to 04:00 New York, weekends, holidays), overnight for a share Robinhood does not price, and in
 * pre-market, the regular session and after-hours for a share no live source priced in time (Nasdaq held back, Robinhood refusing, a share
 * still waiting its turn among Nasdaq's eight): Nasdaq's daily bars for the share, asked by dates (Nasdaq.daily, through Nasdaq's one lane
 * and one hold), read once per share per close and kept (us-closes.ts dailyCloses: a read that failed, or came without the last closed
 * session's bar, is asked again no sooner than DAYS_RETRY_MS) — and only for the shares someone looks at: one listing starts NASDAQ_AT_ONCE
 * reads at most, so a long list fills over a few reads. The line is the latest bar whose session has closed (lastClose): its close, stamped
 * at that session's close, its change against the bar before it, its words naming the day ("the price is Nasdaq's close of Mon 23 Nov").
 * Nasdaq's quote page is not read for it: at 21:58 New York on Monday 2026-11-23 it still said Friday's price, while the chart asked by
 * dates had Monday's bar. A line neither the chain nor the bars price is left out; nothing listed and a refusal from Robinhood, Nasdaq or
 * a daily read, that refusal is the answer.
 *
 * The DAY'S CHANGE on a line (change24h, changePct24h) is the change of the line's price from the last regular-session close before the
 * price's own time — yesterday's close in pre-market and the regular session, today's in after-hours — so the price less the change is that
 * close: Nasdaq's own figure (primaryData); for a Robinhood line, which gives none, its price less that close as the Market's other reads of
 * the same share say it (robinhoodDay) in pre-market, the regular session and after-hours — Nasdaq's answer for the share where one is kept
 * (its price less its change), else the close one read of Nasdaq's quote page found (asked in pre-market and after-hours only where nothing
 * else at hand says it — right after the close the daily bars have not the day yet — once per share and close, kept), else the daily bars'
 * bar of that session (the close line's own read: a Robinhood line whose close nothing at hand says starts it) — and none overnight or where
 * none says it; for a close line, its close against the bar before it.
 *
 * What is still read from Cboe — PRICE HISTORY only (cboe.com's own quote pages read the same files; checked keyless from this machine
 * 2026-10-13): …/charts/intraday/{symbol}.json, the last market day's regular-session minutes, each with its real open, high, low, close and
 * volume, {datetime (New York, no zone written), price: {open, high, low, close}, volume: {stock_volume}}, fifteen minutes behind;
 * …/charts/historical/{symbol}.json every day since 2004 (600 KB, kept ten minutes), its rows on days the market was closed (2025-05-26
 * copies 05-23) and its repeated dates (SPY 2024-12-31) left out. A symbol Cboe keeps no file of answers HTTP 403 from the store behind the
 * CDN (an XML AccessDenied, not a refusal of this network): read as "keeps no history". A dotted class share is written with its dot (BRK.B).
 * THE BOOK — which tickers the market lists, and what each company is called — is Nasdaq Trader's symbol directory (us-directory.ts: its two
 * files, read whole on their own lane, kept twelve hours), read for a search (the ticker whole, then its start, then the company's name), the
 * lines' names, which tickers the market lists and which are ETFs (Nasdaq is asked for those as an ETF first). A plain ticker (one to five
 * letters, a class letter after a dot) is a stock or an ETF; an index (^SPX), a futures root or a preferred share ("ABR$D") is not offered.
 * A ROBINHOOD QUOTE is taken for a ticker only where the directory lists it and, where Robinhood has a token of that symbol, the token's
 * name (/rhj/assets, us-tokens.ts) and the directory's agree (us-tokens.ts listedGate): SATS is EchoStar's token, while the directory's
 * SATS is Strive's preferred stock. Until both have answered, only for the well-known few this file names itself (US_SHARES). The
 * directory refusing at cold start leaves the well-known list priced and a ticker typed whole answered; a search by a company's name then
 * answers the directory's refusal, and the notes say that company names are unavailable. Once the directory has answered, a search past its
 * twelve hours waits DIR_WAIT_MS at most for the next read and is answered from the last one meanwhile.
 * PRICE HISTORY (feat/paper-live phase H, live/history-stocks.ts): Robinhood's real bars in bars of 1m to 1h for the windows it keeps — the
 * latest session in minutes, five sessions in five minutes, a month of hours with pre-market and after-hours, three of the regular session —
 * folded into 15m and 4h; Robinhood's daily bars for a year or five, Nasdaq's by dates for all of it and for every page scrolled left, today's
 * bar built from the session's minutes ("Today so far"), weeks folded from days; Cboe's days where both refuse. Every page says its source, that
 * its prices are split-adjusted and not dividend-adjusted, which hours it covers, and each night it has no bars of ("No overnight data").
 * Where Robinhood does not answer the minutes, the latest session's minutes of both Cboe and Nasdaq, asked at once and merged by time: Cboe's
 * real minute bars wherever Cboe has the minute (the regular session, to fifteen minutes ago), and Nasdaq's one-price-a-minute SAMPLES
 * (us-quotes.ts Nasdaq.chart: open, high, low and close the same, no volume) for the minutes Cboe has none of — pre-market, the last fifteen
 * minutes of a session under way, after-hours. A bar with any sampled minute in it understates its range, and carries no volume (a bar's
 * volume is said only where every minute in it has one); the page names both sources. Only what each source says is carried. Cboe's volume
 * is in shares, so no dollar volume is said (nothing here is estimated). The trading session is the account's own US market calendar
 * (account/calendar.ts usSessionFull): the regular session 09:30–16:00 New York on market days (13:00 on an early close), and which phase is on
 * — pre-market, after-hours, overnight — with whether a limit order may be sent for it (extendedHours): in pre-market and after-hours where a
 * real-time source priced the line (a paper account fills only at a quote stamped in the phase that is on, and a close never is); overnight
 * only where Robinhood priced it, its 24-hour market, while ROBINHOOD_OVERNIGHT says so. The source carries the calendar's clock
 * (`sessions`) for a paper account to judge a quote's own time by. Out of the regular session the line says so, and says when a real-time
 * price is not from the phase that is on; a close line says whose close it is, in any phase.
 *
 * WAITING: a listing waits for the daily reads it started (and the Nasdaq reads of a close a Robinhood line wants) to CLOSE_WAIT_MS from its
 * start at most — an answer that comes later is kept for the next read. ONE SHARE'S LINE (line: a paper account pricing a share it knows)
 * asks the chain and, where it needs them, the daily bars for that share alone — one read at most, where a search of a short ticker starts
 * eight — and THE BACKGROUND READER (feed: live/us-quotes.ts UsQuoteFeed) reads the shares someone is looking at as Robinhood and Nasdaq
 * write them, sharing this line's one answer of each; usLineAt says a line again at the reader's newer quote.
 *
 * Every GET goes through the fixed-host guard (public-markets.ts PUBLIC_HOSTS); a 451, a 429, an edge's 403 page or no answer from a source is
 * held back as any public source's is (holdBackMs). */
import { isRefusal, type Refusal } from "../core/errors.ts";
import { et, etDate, fromEt, isMarketDay, nextRegularSession, regularSession, usClock, usPhaseAt, usSessionFull } from "../calendar.ts";
import { no } from "../refuse.ts";
import { hostLane } from "./history.ts";
import { stockHistory } from "./history-stocks.ts";
import { badHistory, fixedHosts, has, keeper, LIST_MS, list, nonNeg, pos, PUBLIC_HOSTS, publicNo, rec, round, type Listing, type PublicDeps, type PublicSource } from "./public-markets.ts";
import type { Candle, MarketSession } from "./trade.ts";
import { realHttp, unreachable, type HttpReply } from "./types.ts";
import { closedSessionBefore, closeOfSession, dailyCloses, lastClose, NASDAQ_CLOSE_FROM, US_CLOSE_DELAY_MS, type SessionClose } from "./us-closes.ts";
import { usDirectory, type DirEntry } from "./us-directory.ts";
import { FRESH_MS, NASDAQ_AT_ONCE, NASDAQ_FROM, nasdaqSource, ROBINHOOD_FROM, ROBINHOOD_OVERNIGHT, usQuote, UsQuoteFeed, type NasdaqClosing, type UsQuote } from "./us-quotes.ts";
import { listedGate, robinhoodTokenNames } from "./us-tokens.ts";

/** whether Robinhood's quotes are taken in the overnight session (us-quotes.ts, where it is set): a share Robinhood priced is then offered
 * for an extended-hours limit order overnight */
export { ROBINHOOD_OVERNIGHT };
/** a close line's words and delay (us-closes.ts, where they are set): the face and the account's parity test read them from here */
export { NASDAQ_CLOSE_FROM, US_CLOSE_DELAY_MS };

export const CBOE = "https://cdn-api.cboe.com/api/global/delayed_quotes";
/** how far behind the market Cboe's delayed quote was: the old rule a paper account still asks of a line with no stamp (cboeQuoteInSession) */
export const CBOE_DELAY_MS = 15 * 60_000;
/** the stocks and ETFs shown before anything is typed */
export const US_SHARES: readonly string[] = ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "SPY", "QQQ", "AMD", "NFLX", "COIN", "HOOD", "MSTR", "PLTR", "BRK.B", "JPM", "V", "LLY", "UNH", "XOM", "WMT", "COST"];
/** the source's id, as it has always been: paper books name it as the source of what they hold */
export const US_STOCKS_ID = "cboe";
export const US_STOCKS_NAME = "US stocks";
/** Cboe's own name, for what Cboe itself answers or refuses (price history) */
const CBOE_NAME = "Cboe";
/** the words a price from Cboe's delayed file carried (Market.quoteFrom): no line here says them now, but paper books written before do,
 * and the account's tests build such a line */
export const CBOE_FROM = "Cboe · 15 min delayed";
/** the source's line in words: real time, with the close as the fallback */
export const US_STOCKS_LINE = "US stocks · real time, else Nasdaq's last close";
export const US_STOCKS_READ_ONLY = "Real-time quotes from Robinhood or Nasdaq, else Nasdaq's last close — each line says which: a US stock trades at a connected broker (Alpaca, Robinhood), or in a paper account";
/** a plain ticker: one to five letters, a class letter after a dot (BRK.B) — the same as us-quotes.ts US_TICKER, written out here: this file
 * and that one import each other (through public-markets.ts), so neither reads the other's values while it is being loaded */
const TICKER = /^[A-Z]{1,5}(\.[A-Z])?$/;
/** how long a search for a plain ticker — and a share's line, and a listing with nothing searched for — waits for the symbol directory (and
 * the token names) on their first read before answering without them: the directory's two files are well over a megabyte, and the Markets
 * read allows a source four seconds in all */
export const DIR_WAIT_MS = 1_500;
/** what the notes say once the directory has refused and never answered */
const NO_NAMES = "Company names are unavailable: Nasdaq Trader's symbol directory did not answer; search by ticker.";
/** how long a listing (and one share's line) waits, from its start, for the daily reads it started and the Nasdaq reads of a close: a
 * Nasdaq that is slow or hangs does not hold back the lines the chain priced past the callers' four seconds. An answer that comes later is
 * kept for the next read */
export const CLOSE_WAIT_MS = 2_500;
/** a real-time quote said to be the phase's own live quote: in the phase that is on, and no older than FRESH_MS and the minute to which
 * Nasdaq stamps a trade */
const SAID_LIVE_MS = FRESH_MS + 60_000;
const HISTORY_MS = 60_000;
const TIMEOUT_MS = 8_000;
/** the store behind Cboe's CDN answering for a symbol it has no file for (its history files) */
const NOT_LISTED = /<Code>\s*AccessDenied\s*<\/Code>/;

/** a line asked for: a directory entry, or a ticker typed whole that the directory does not carry (its name is then its ticker) */
type Wanted = Pick<DirEntry, "symbol" | "name">;

/** "2026-10-13T09:45:44" (New York, as Cboe's history files write it) in ms; nothing for anything else */
function cboeTimeMs(v: unknown): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(v ?? ""));
  if (!m) return undefined;
  return fromEt(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])) + Number(m[6] ?? 0) * 1000;
}

/** THE OLD RULE, from when every US stock was priced by Cboe alone: whether a quote fifteen minutes behind the market is from inside the
 * regular session now, true from 09:45 to 16:15 New York on a market day (13:15 on an early close). A line now says its own source, stamp
 * and delay (quoteAt, delayMs) and the source carries the market's clock (`sessions`: account/calendar.ts usClock), by which a fill is
 * judged instead; this stays only until paper.ts no longer asks it */
export const cboeQuoteInSession = (nowMs: number): boolean => nextRegularSession(nowMs - CBOE_DELAY_MS).open;

/** the US stock market's REGULAR session now, from the account's own calendar: open or closed and when, with no phase (the old shape — a
 * line now carries account/calendar.ts usSessionFull, which says the phase too) */
export const usSession = (nowMs: number): MarketSession => regularSession(nowMs);

/** whose close a close line's price is, by the close's own instant */
const closeWords = (closeAt: number): string => `the price is Nasdaq's close of ${etDate(closeAt)}`;

/** the words a line carries while the market is out of its session: that it is closed and when it opens, and — for a close line, its close's
 * instant `closeAt` given — whose close the price is */
export function usClosedWords(session: MarketSession, closeAt?: number): string {
  const opens = session.opensAt ? Date.parse(session.opensAt) : NaN;
  return `the US stock market is closed${Number.isFinite(opens) ? `: it opens ${etDate(opens)}, 09:30 New York` : ""}${closeAt !== undefined ? `; ${closeWords(closeAt)}` : ""}`;
}

const PHASE_WORDS: Partial<Record<string, string>> = { pre: "pre-market trading", after: "after-hours trading", overnight: "the overnight session" };
/** a phase's name, for the phase a quote's own time is in */
const PHASE_NAMES: Partial<Record<string, string>> = { pre: "pre-market", regular: "regular session", after: "after-hours", overnight: "overnight session", closed: "market closed" };
/** a New York time of day, "09:30" */
function etClock(ms: number): string {
  const t = et(ms);
  return `${String(Math.floor(t.minutes / 60)).padStart(2, "0")}:${String(t.minutes % 60).padStart(2, "0")}`;
}

/** The words a line carries: outside the regular session, which phase is on and until when, and whose price it is — a real-time source's
 * quote from that phase; or, where the real-time price is not from the phase that is on or is older than SAID_LIVE_MS (Nasdaq's last trade
 * is taken however old: a share that has not traded since the close), that source's last trade or quote and when, in which phase; or, where
 * no real-time source answered, Nasdaq's close and of which day (a close line: quoteFrom NASDAQ_CLOSE_FROM, `quoteAt` the close's instant).
 * Closed — or overnight for a share not traded then — usClosedWords. Inside the regular session, a real-time line carries none and a close
 * line that no real-time quote answered. `quoteAt` is the price's own time, `now` the listing's */
export function usSessionWords(session: MarketSession, quoteFrom: string, quoteAt?: number, now?: number): string | undefined {
  const closeAt = quoteFrom === NASDAQ_CLOSE_FROM ? quoteAt : undefined;
  if (session.open) return closeAt !== undefined ? `no real-time quote answered: ${closeWords(closeAt)}` : undefined;
  const phase = PHASE_WORDS[session.phase ?? ""];
  const ends = session.phaseEndsAt ? Date.parse(session.phaseEndsAt) : NaN;
  const opens = session.opensAt ? Date.parse(session.opensAt) : NaN;
  // overnight, a share is traded only where Robinhood's 24-hour market priced it (extendedHours): for any other, the market is closed
  if (!phase || !Number.isFinite(ends) || (session.phase === "overnight" && !session.extendedHours)) return usClosedWords(session, closeAt);
  const until = `${phase} is on until ${etClock(ends)} New York`;
  const opening = Number.isFinite(opens) ? `; the regular session opens ${etDate(opens)}, 09:30 New York` : "";
  const who = quoteFrom === ROBINHOOD_FROM ? "Robinhood" : quoteFrom === NASDAQ_FROM ? "Nasdaq" : undefined;
  if (!who) return `${until}, but no real-time quote answered${closeAt !== undefined ? `: ${closeWords(closeAt)}` : ""}${opening}`;
  if (quoteAt === undefined || (usPhaseAt(quoteAt) === session.phase && (now ?? quoteAt) - quoteAt <= SAID_LIVE_MS)) return `${until}: the price is ${who}'s real-time quote${opening}`;
  const day = now !== undefined && etDate(now) === etDate(quoteAt) ? "" : ` on ${etDate(quoteAt)}`;
  return `${until}: the price is ${who}'s ${who === "Nasdaq" ? "last trade" : "quote"} at ${etClock(quoteAt)} New York${day} (${PHASE_NAMES[usPhaseAt(quoteAt)] ?? usPhaseAt(quoteAt)})${opening}`;
}

/** a trade stamped up to this long after the close is still the session's: the closing cross is printed in the moments after it */
const CLOSE_PRINT_MS = 60_000;
/** the phases in which a Robinhood line carries a change from a regular close (the overnight session is not one: no read here says its close) */
const CHANGE_PHASES = new Set(["pre", "regular", "after"]);
/** a Nasdaq read for a close that found none (a refusal, no answer, no close said) is asked again no sooner than this */
export const CLOSE_RETRY_MS = 60_000;
/** the closes one read of Nasdaq found are kept for this many shares and closes at most (the oldest let go first); a close never changes */
const CLOSES_KEPT = 1_000;

/** a Nasdaq trade's change is measured from this reference close: the trade is in a phase with a change, and its stamp — to the minute —
 * less CLOSE_PRINT_MS is past that close. A trade stamped in the close's own minute (4:00 PM) may be the regular session's last, whose
 * change is from the close before: it is read as of the session before */
function changeIsFrom(at: number, ref: { closesAt: number }): boolean {
  return CHANGE_PHASES.has(usPhaseAt(at)) && closedSessionBefore(at - CLOSE_PRINT_MS)?.closesAt === ref.closesAt;
}

/** the close Nasdaq's kept answer for the share says (Nasdaq.latest: it came within FRESH_MS): its price less its change, where its own trade's
 * change is from the reference close (changeIsFrom) */
function keptNasdaqClose(nq: UsQuote | null | undefined, ref: { closesAt: number }): number | undefined {
  if (!nq || nq.from !== NASDAQ_FROM || nq.price === undefined || nq.change === undefined || !changeIsFrom(nq.at, ref)) return undefined;
  const c = nq.price - nq.change;
  return c > 0 ? c : undefined;
}

/** THE CLOSE ONE READ OF NASDAQ'S QUOTE PAGE SAYS (Nasdaq.closing) for the reference session `ref`, in order: secondaryData's close stamped
 * in that session (to its close's minute); else primaryData's last trade stamped in the close's own minute — right after the close that
 * print IS the session's close (the one changeIsFrom refuses as a change's base: its change is from the close before, its price is this
 * close); else primaryData's price less its change, where its change is from that close. Nothing otherwise */
export function nasdaqCloseOf(a: NasdaqClosing, ref: { opensAt: number; closesAt: number }): number | undefined {
  if (a.closed && a.closed.at >= ref.opensAt && a.closed.at <= ref.closesAt + CLOSE_PRINT_MS) return a.closed.price;
  if (a.last && a.last.at >= ref.closesAt && a.last.at < ref.closesAt + CLOSE_PRINT_MS) return a.last.price;
  if (a.last && a.last.change !== undefined && changeIsFrom(a.last.at, ref)) {
    const c = a.last.price - a.last.change;
    if (c > 0) return c;
  }
  return undefined;
}

/** THE REFERENCE CLOSE OF A ROBINHOOD LINE from what is at hand — no read is made here — in order, the first that says it WINS:
 *   1. NASDAQ'S KEPT ANSWER for the share (keptNasdaqClose), measured by Nasdaq from the official close — the closing cross — in real time;
 *   2. THE CLOSE ONE NASDAQ READ FOUND for this share and this close (`known`: usStocksPublic asks it right after the close, see robinhoodDay);
 *   3. NASDAQ'S DAILY BARS held for the share: the bar of that very session (closeOfSession — bars read for an earlier close lack it).
 * So where Nasdaq's real-time answer and the bars disagree, Nasdaq's is said */
function referenceClose(nq: UsQuote | null | undefined, known: number | undefined, bars: readonly Candle[] | undefined, ref: { opensAt: number; closesAt: number }): number | undefined {
  return keptNasdaqClose(nq, ref) ?? known ?? (bars ? closeOfSession(bars, ref)?.close : undefined);
}

/** A ROBINHOOD LINE'S DAY CHANGE (see the top of this file): Robinhood's price is the middle of its bid and ask and carries no change, so
 * the reference close — the last regular close before the quote's own time, in pre-market, the regular session and after-hours — is taken
 * from the Market's other reads of the same share (referenceClose): Nasdaq's kept answer; else the close one read of Nasdaq found
 * (Nasdaq.closing — asked in pre-market and after-hours only where neither of the others says it, once per share and close, kept, and a
 * failed read asked again no sooner than CLOSE_RETRY_MS: right after the close Nasdaq's chart has not the day's bar yet); else the daily
 * bars' bar of that session. Nothing otherwise: overnight, or where none says it */
function robinhoodDay(rt: UsQuote, bars: readonly Candle[] | undefined, nq: UsQuote | null | undefined, known: number | undefined): { change: number; changePct: number } | undefined {
  if (rt.price === undefined || !CHANGE_PHASES.has(usPhaseAt(rt.at))) return undefined;
  const ref = closedSessionBefore(rt.at);
  if (!ref) return undefined;
  const close = referenceClose(nq, known, bars, ref);
  if (close === undefined || !(close > 0)) return undefined;
  const change = rt.price - close;
  return { change: round(change, 6), changePct: round((change / close) * 100, 4) };
}

/** A CLOSE LINE'S DAY CHANGE: its close against the bar before it, where there is one */
function closeDay(c: SessionClose): { change: number; changePct: number } | undefined {
  if (c.prev === undefined || !(c.prev > 0)) return undefined;
  const change = c.close - c.prev;
  return { change: round(change, 6), changePct: round((change / c.prev) * 100, 4) };
}

/** A US LINE SAID AGAIN AT A NEWER REAL-TIME QUOTE — the background reader's (live/us-quotes.ts UsQuoteFeed), which a paper account prices a
 * share it knows from (live/paper.ts): the listing's own figures, what the market is, under that quote's price, bid, ask, stamp, delay and
 * source (never one source's price beside another's bid: a side the quote does not give is none); the session at `now` as the line says it
 * with that quote (an extended-hours order offered where a real-time source priced it — overnight only Robinhood) and its words; the day's
 * change the quote's own (Nasdaq's), else at this price from the close the listing's change was measured from (its price less its change),
 * while the listing's price and this quote are of one regular session — none otherwise, as robinhoodDay says none */
export function usLineAt(m: Listing, rt: UsQuote, now: number): Listing {
  const session = usSessionFull(now, ROBINHOOD_OVERNIGHT && rt.from === ROBINHOOD_FROM);
  const note = usSessionWords(session, rt.from, rt.at, now);
  const { price: p0, bid: _b, ask: _a, quoteAt: q0, delayMs: _d, quoteFrom: _f, session: _s, note: _n, change24h: c0, changePct24h: _c, ...rest } = m;
  let change = rt.change;
  let changePct = rt.changePct;
  if (change === undefined && changePct === undefined && rt.price !== undefined && p0 !== undefined && c0 !== undefined) {
    const was = q0 ? Date.parse(q0) : NaN;
    const ref = p0 - c0;
    if (ref > 0 && Number.isFinite(was) && usPhaseAt(rt.at) === "regular" && usPhaseAt(was) === "regular" && etDate(rt.at) === etDate(was)) {
      change = round(rt.price - ref, 6);
      changePct = round(((rt.price - ref) / ref) * 100, 4);
    }
  }
  return {
    ...rest,
    ...(rt.price !== undefined ? { price: rt.price } : {}),
    ...(rt.bid !== undefined ? { bid: rt.bid } : {}),
    ...(rt.ask !== undefined ? { ask: rt.ask } : {}),
    quoteAt: new Date(rt.at).toISOString(),
    delayMs: rt.delayMs,
    quoteFrom: rt.from,
    session,
    ...(note ? { note } : {}),
    ...(change !== undefined ? { change24h: change } : {}),
    ...(changePct !== undefined ? { changePct24h: changePct } : {}),
  };
}

/** the minutes of both sources, merged by time (see the top of this file): every one of Cboe's minute bars, and Nasdaq's samples for the
 * minutes outside Cboe's — after Cboe's last minute, and before its first where that is not the regular session (Cboe's first bar of a
 * session is stamped 09:31) */
function mergeMinutes(cboe: Candle[], nasdaq: Candle[]): Candle[] {
  if (!cboe.length) return nasdaq;
  let first = Infinity;
  let last = -Infinity;
  for (const b of cboe) {
    first = Math.min(first, b.t);
    last = Math.max(last, b.t);
  }
  return [...cboe, ...nasdaq.filter((b) => b.t > last || (b.t < first && usPhaseAt(b.t) !== "regular"))];
}

/** at most `ms` waiting for `p` (it goes on after) */
function within(p: Promise<unknown>, ms: number): Promise<void> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p.then(() => undefined, () => undefined), new Promise<void>((go) => (t = setTimeout(go, Math.max(0, ms))))]).finally(() => clearTimeout(t));
}

/** what `p` answers within `ms`, else nothing (it goes on after) */
function upTo<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<undefined>((go) => (t = setTimeout(() => go(undefined), Math.max(0, ms))))]).finally(() => clearTimeout(t));
}

/** US stocks and ETFs in real time where a keyless source gives it, else at Nasdaq's last close (see the top of this file) */
export function usStocksPublic(deps: PublicDeps = {}): PublicSource {
  const id = US_STOCKS_ID;
  const name = US_STOCKS_NAME;
  const clock = deps.clock ?? Date.now;
  const http = fixedHosts(deps.http ?? realHttp, PUBLIC_HOSTS, deps.timeoutMs ?? TIMEOUT_MS);
  // one Nasdaq for the quotes, the daily bars and the chart: one memory of each symbol's class, one hold on the whole source after a refusal
  const nasdaq = nasdaqSource(deps);
  const live = usQuote(deps, nasdaq);
  // NASDAQ'S DAILY BARS (us-closes.ts), one read per share per close: the close line, and the close beside a Robinhood price
  const daily = dailyCloses(nasdaq, clock);
  // THE BOOK (see the top of this file): Nasdaq Trader's directory, read whole on its own lane, and Robinhood's token names, through the same
  // guard (it passes the directory's own maxText through)
  const directory = usDirectory({ http, pace: deps.pace ?? hostLane, clock });
  const tokens = robinhoodTokenNames({ http, pace: deps.pace ?? hostLane, clock });
  /** whether Robinhood's quote may be taken for a ticker, as the directory and the token names last said (us-tokens.ts listedGate) */
  const gate = () => listedGate(directory.now(), tokens.now());
  /** whether the directory's last read refused (its notes say company names are unavailable once it has, and never before) */
  let dirSaidNo = false;
  /** the directory's entries (us-directory.ts entries: kept, shared while on its way), its answer noted for the notes */
  const readDir = (): Promise<DirEntry[] | Refusal> => {
    const p = directory.entries();
    void p.then(
      (r) => (dirSaidNo = isRefusal(r)),
      () => undefined,
    );
    return p;
  };
  /** both reads started, or the ones kept answered: each is kept (twelve hours, a day; a refusal ten minutes) and shared while on its way */
  const readBook = () => Promise.all([readDir(), tokens.read()]).catch(() => undefined);
  const minutes = keeper<Candle[]>(clock, HISTORY_MS);
  const days = keeper<Candle[]>(clock, LIST_MS);
  const months = keeper<Candle[]>(clock, HISTORY_MS);
  // the long history (live/history-stocks.ts), its pages through the same guard with a longer deadline for Nasdaq's whole history
  const history = stockHistory(
    {
      http: fixedHosts(deps.http ?? realHttp, PUBLIC_HOSTS, deps.timeoutMs ?? TIMEOUT_MS),
      pace: deps.pace ?? hostLane,
      clock,
      nasdaq,
      cboeDaily: (sym) => cboeDays(sym),
      month: (sym) => cboeMonth(sym),
      minutes: async (sym) => {
        // both at once; either refusing leaves the other's minutes, and both refusing is Cboe's refusal
        const [nq, cb] = await Promise.all([nasdaq.chart(sym), cboeMinutes(sym)]);
        const sampled = nq && !isRefusal(nq) ? nq : undefined;
        if (isRefusal(cb) && !sampled) return cb;
        return mergeMinutes(isRefusal(cb) ? [] : cb, sampled ?? []);
      },
    },
    id,
  );
  const ask = async (url: string): Promise<HttpReply | Refusal> => {
    try {
      return await http(url);
    } catch (err) {
      return unreachable(id, CBOE_NAME, err);
    }
  };
  /** the last market day's regular-session minutes from Cboe (see the top of this file) */
  const cboeMinutes = (sym: string): Promise<Candle[] | Refusal> =>
    minutes(sym, async () => {
      const r = await ask(`${CBOE}/charts/intraday/${encodeURIComponent(sym)}.json`);
      if (isRefusal(r)) return r;
      if (r.status === 403 && NOT_LISTED.test(r.text)) return no("E_VENUE_REJECTED", { venue: id, message: `${CBOE_NAME} keeps no history of ${sym}` });
      if (r.status !== 200 || r.body === undefined) return publicNo(id, CBOE_NAME, r);
      const out: Candle[] = [];
      for (const x of list(rec(r.body).data).map(rec)) {
        const t = cboeTimeMs(x.datetime);
        const p = rec(x.price);
        const [o, h, l, c, v] = [pos(p.open), pos(p.high), pos(p.low), pos(p.close), nonNeg(rec(x.volume).stock_volume)];
        if (t === undefined || o === undefined || h === undefined || l === undefined || c === undefined) continue;
        out.push({ t, o, h, l, c, ...(v !== undefined ? { v } : {}) });
      }
      return out;
    });
  /** Cboe's last month of ten-minute regular-session bars (…/charts/one_month/{symbol}.json, the intraday file's shape, 874 bars from
   * 2026-09-16 09:40 to 10-16 15:50 read live 2026-10-17), kept a minute. Each bar is stamped at its START, ten minutes before its label: a
   * day's first label is 09:40 and its last 15:50, as the intraday file's first minute is labelled 09:31 and carries the opening cross — a
   * label is where the bar ends (inferred from both files; Cboe does not say) */
  const cboeMonth = (sym: string): Promise<Candle[] | Refusal> =>
    months(sym, async () => {
      const r = await ask(`${CBOE}/charts/one_month/${encodeURIComponent(sym)}.json`);
      if (isRefusal(r)) return r;
      if (r.status === 403 && NOT_LISTED.test(r.text)) return no("E_VENUE_REJECTED", { venue: id, message: `${CBOE_NAME} keeps no history of ${sym}` });
      if (r.status !== 200 || r.body === undefined) return publicNo(id, CBOE_NAME, r);
      const out: Candle[] = [];
      for (const x of list(rec(r.body).data).map(rec)) {
        const end = cboeTimeMs(x.datetime);
        const p = rec(x.price);
        const [o, h, l, c, v] = [pos(p.open), pos(p.high), pos(p.low), pos(p.close), nonNeg(rec(x.volume).stock_volume)];
        if (end === undefined || o === undefined || h === undefined || l === undefined || c === undefined) continue;
        out.push({ t: end - 10 * 60_000, o, h, l, c, ...(v !== undefined ? { v } : {}) });
      }
      return out.sort((a, b) => a.t - b.t);
    });
  /** every day Cboe keeps since 2004, oldest first, each at its session's open: its rows on days the market was closed (a holiday's row
   * copies the day before) and a date it repeats left out (see the top of this file) */
  const cboeDays = (sym: string): Promise<Candle[] | Refusal> =>
    days(sym, async () => {
      const r = await ask(`${CBOE}/charts/historical/${encodeURIComponent(sym)}.json`);
      if (isRefusal(r)) return r;
      if (r.status === 403 && NOT_LISTED.test(r.text)) return no("E_VENUE_REJECTED", { venue: id, message: `${CBOE_NAME} keeps no history of ${sym}` });
      if (r.status !== 200 || r.body === undefined) return publicNo(id, CBOE_NAME, r);
      const out = new Map<number, Candle>();
      for (const x of list(rec(r.body).data).map(rec)) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(x.date ?? ""));
        const [o, h, l, c, v] = [pos(x.open), pos(x.high), pos(x.low), pos(x.close), nonNeg(x.volume)];
        if (!m || o === undefined || h === undefined || l === undefined || c === undefined) continue;
        // a day's bar at its session's open, New York
        const t = fromEt(Number(m[1]), Number(m[2]), Number(m[3]), 9, 30);
        // a row on a day the calendar calls closed is left out: calendar.ts says how far back its rules hold, and the closures they do not know
        if (!isMarketDay(t) || out.has(t)) continue;
        out.set(t, { t, o, h, l, c, ...(v !== undefined ? { v } : {}) });
      }
      return [...out.values()].sort((a, b) => a.t - b.t);
    });
  /** the directory as last read, by symbol: one read before answers at once (read again in the background once it is twelve hours old);
   * none read yet, the directory and the token names waited for DIR_WAIT_MS at most (they finish loading for the next ask) */
  const dirNow = async (): Promise<ReadonlyMap<string, DirEntry> | undefined> => {
    const on = readBook();
    if (!directory.now() || !tokens.now()) await within(on, DIR_WAIT_MS);
    return directory.now();
  };
  /** THE BACKGROUND READER (live/us-quotes.ts UsQuoteFeed) of the shares someone is looking at, on this line's own chain: Robinhood's quote
   * taken by the gate a listing takes it by — before the directory and the token names have answered, for the well-known few this file
   * names itself */
  const feed = new UsQuoteFeed({
    source: id,
    quotes: live,
    listed: (s) => {
      if (!directory.now() || !tokens.now()) void readBook();
      return gate()(s);
    },
    clock,
  });
  // THE CLOSES ONE READ OF NASDAQ FOUND (robinhoodDay), by share and close: a close found is kept (it never changes), a read on its way is
  // shared, and one that found none is asked again no sooner than CLOSE_RETRY_MS — at most one Nasdaq read a share a close, but for retries
  const closes = new Map<string, { close?: number; failedAt?: number; on?: Promise<void> }>();
  const closeKey = (sym: string, ref: { closesAt: number }) => `${sym}@${ref.closesAt}`;
  const setClose = (k: string, v: { close?: number; failedAt?: number; on?: Promise<void> }) => {
    closes.delete(k);
    closes.set(k, v);
    if (closes.size > CLOSES_KEPT) closes.delete(closes.keys().next().value!);
  };
  const knownClose = (sym: string, at: number): number | undefined => {
    const ref = closedSessionBefore(at);
    return ref ? closes.get(closeKey(sym, ref))?.close : undefined;
  };
  /** the reference close a Robinhood line wants and nothing at hand says (referenceClose), in pre-market, the regular session and
   * after-hours; nothing for any other line, or where something at hand says it */
  const closeWanted = (sym: string, rt: UsQuote): { opensAt: number; closesAt: number } | undefined => {
    if (rt.from !== ROBINHOOD_FROM || rt.price === undefined || !CHANGE_PHASES.has(usPhaseAt(rt.at))) return undefined;
    const ref = closedSessionBefore(rt.at);
    if (!ref || referenceClose(nasdaq.latest(sym), knownClose(sym, rt.at), daily.held(sym), ref) !== undefined) return undefined;
    return ref;
  };
  /** whether a line wants Nasdaq's quote page asked for its close now: Robinhood priced it in pre-market or after-hours, nothing at hand says
   * the close (Nasdaq's kept answer, a read of Nasdaq's, the daily bars — right after the close Nasdaq's chart has not the day yet), and no
   * read for it is on its way or has found none within CLOSE_RETRY_MS */
  const wantsClose = (sym: string, rt: UsQuote | undefined): { opensAt: number; closesAt: number } | undefined => {
    if (!rt) return undefined;
    const phase = usPhaseAt(rt.at);
    if (phase !== "pre" && phase !== "after") return undefined;
    const ref = closeWanted(sym, rt);
    if (!ref) return undefined;
    const c = closes.get(closeKey(sym, ref));
    if (c?.on || (c?.failedAt !== undefined && clock() - c.failedAt < CLOSE_RETRY_MS)) return undefined;
    return ref;
  };
  /** one read of Nasdaq for a share's close (Nasdaq.closing, on its lane, under its hold), kept by share and close */
  const askClose = (sym: string, ref: { opensAt: number; closesAt: number }): Promise<void> => {
    const k = closeKey(sym, ref);
    const on = nasdaq.closing(sym).then(
      (a) => {
        const close = a && !isRefusal(a) ? nasdaqCloseOf(a, ref) : undefined;
        setClose(k, close !== undefined ? { close } : { failedAt: clock() });
      },
      () => setClose(k, { failedAt: clock() }),
    );
    setClose(k, { on });
    return on;
  };
  /** THE READS A LISTING MAKES FOR ITS CLOSES (see the top of this file), waited for until `by` (Date.now()) at most — an answer that comes
   * later is kept for the next read:
   *   · Nasdaq's daily bars (dailyCloses) for each line the chain did not price, and for each Robinhood line in pre-market, the regular
   *     session or after-hours whose close nothing at hand says — NASDAQ_AT_ONCE reads at most, the unpriced lines holding no bars first,
   *     then the unpriced holding an earlier close's, then the Robinhood lines; a line whose bars have the session it wants is not asked;
   *   · then Nasdaq's quote page for the close a Robinhood line in pre-market or after-hours still wants (wantsClose), NASDAQ_AT_ONCE at most.
   * Each refusal a daily read answers is told to `refused` */
  const settle = async (lines: Array<{ sym: string; rt: UsQuote | undefined }>, now: number, by: number, refused: (r: Refusal) => void): Promise<void> => {
    const none: string[] = [];
    const older: string[] = [];
    const changes: string[] = [];
    const base = closedSessionBefore(now);
    for (const { sym, rt } of lines) {
      const ref = rt ? closeWanted(sym, rt) : base;
      if (!ref) continue;
      const held = daily.held(sym);
      if (held && closeOfSession(held, ref)) continue;
      (rt ? changes : held ? older : none).push(sym);
    }
    const reads = [...none, ...older, ...changes].slice(0, NASDAQ_AT_ONCE).map((sym) =>
      daily.bars(sym, now).then(
        (r) => {
          if (isRefusal(r)) refused(r);
        },
        () => undefined,
      ),
    );
    if (reads.length) await within(Promise.all(reads), by - Date.now());
    const asks: Promise<void>[] = [];
    for (const l of lines) {
      if (asks.length >= NASDAQ_AT_ONCE) break;
      const ref = wantsClose(l.sym, l.rt);
      if (ref) asks.push(askClose(l.sym, ref));
    }
    if (asks.length) await within(Promise.all(asks), by - Date.now());
  };
  /** a share's last close as the bars at hand say it at `now` (lastClose): the close line's price */
  const closeNow = (sym: string, now: number): SessionClose | undefined => {
    const bars = daily.held(sym);
    return bars ? lastClose(bars, now) : undefined;
  };
  // how much of the list a listing with nothing searched for shows, for the sentence under it
  let shown: { of: number; total: number } | undefined;
  /** one line: the real-time source's price, bid, ask, stamp and delay where one priced it, else Nasdaq's close (`close`) — never one
   * source's price beside another's bid; the day's change by the rule at the top of this file; the session in full, an extended-hours order
   * offered only where a real-time source priced the line (overnight, only Robinhood) */
  const listing = (symbol: string, rt: UsQuote | undefined, close: SessionClose | undefined, company: string | undefined, now: number): Listing => {
    const full = usSessionFull(now, ROBINHOOD_OVERNIGHT && rt?.from === ROBINHOOD_FROM);
    // a close is no live price: a paper account never fills an extended-hours order at it, so none is offered beside it
    const session = rt || !full.extendedHours ? full : { ...full, extendedHours: false };
    const price = rt ? rt.price : close?.close;
    const at = rt ? rt.at : close?.closesAt;
    const from = rt ? rt.from : NASDAQ_CLOSE_FROM;
    const day = rt ? (rt.from === ROBINHOOD_FROM ? robinhoodDay(rt, daily.held(symbol), nasdaq.latest(symbol), knownClose(symbol, rt.at)) : rt) : close ? closeDay(close) : undefined;
    const note = usSessionWords(session, from, at, now);
    return {
      symbol,
      name: company ?? symbol,
      kind: "stock",
      base: symbol,
      quote: "USD",
      ...(price !== undefined ? { price } : {}),
      ...(rt?.bid !== undefined ? { bid: rt.bid } : {}),
      ...(rt?.ask !== undefined ? { ask: rt.ask } : {}),
      ...(at !== undefined ? { quoteAt: new Date(at).toISOString() } : {}),
      delayMs: rt ? rt.delayMs : US_CLOSE_DELAY_MS,
      quoteFrom: from,
      // a broker takes a stock order at any hour and holds it for the open: the session, not `open`, says whether the market is in session
      open: true,
      types: [],
      session,
      ...(note ? { note } : {}),
      ...(day?.change !== undefined ? { change24h: day.change } : {}),
      ...(day?.changePct !== undefined ? { changePct24h: day.changePct } : {}),
      // the line is the US stocks line, whichever source priced it (quoteFrom says which): named after a source, its "Connect to trade"
      // would read as connecting that source
      venueName: US_STOCKS_NAME,
    };
  };
  return {
    id,
    name,
    kind: "stocks",
    connectTo: "alpaca",
    connector: "live:alpaca",
    readOnly: US_STOCKS_READ_ONLY,
    sessions: usClock,
    feed,
    /** ONE SHARE'S LINE, asked alone (live/paper.ts Pricer.find: a paper account pricing a share it knows): the real-time chain for it, then
     * — where the chain did not price it, or a Robinhood price wants the close its change is measured from — Nasdaq's daily bars for it alone
     * (one read at most, P16: a search of a short ticker starts eight) and, right after the close, one read of Nasdaq's quote page for the
     * close; all of it waited for to CLOSE_WAIT_MS from the start at most, once per share and close. Nasdaq's last close is the line only
     * where the chain priced nothing. Null: not a plain ticker, or no source prices it; the refusal a source answered where nothing priced it
     * and one refused */
    async line(symbol) {
      const started = Date.now();
      live.warm();
      const sym = symbol.trim().toUpperCase();
      if (!TICKER.test(sym)) return null;
      const dir = await dirNow();
      const entry = dir?.get(sym);
      if (entry?.etf) nasdaq.hint(sym, "etf");
      let refused: Refusal | undefined;
      const said = (r: Refusal) => {
        refused ??= r;
      };
      const rt = (await live.many([sym], { listed: gate(), refused: said })).get(sym);
      const now = clock();
      await settle([{ sym, rt }], now, started + CLOSE_WAIT_MS, said);
      if (rt) return listing(sym, rt, undefined, entry?.name, now);
      const close = closeNow(sym, now);
      return close ? listing(sym, undefined, close, entry?.name, now) : (refused ?? null);
    },
    reset: () => {
      live.clear();
      daily.clear();
      closes.clear();
      directory.clear();
      tokens.clear();
      minutes.clear();
      days.clear();
      months.clear();
    },
    async listings(o) {
      // Robinhood's one answer for every share it quotes is on its way while the directory is read (it is kept, and asked once)
      live.warm();
      const Q = (o.q ?? "").trim().toUpperCase();
      const limit = Math.max(1, o.limit);
      let pool: Wanted[];
      // the directory's refusal, where a search found it refusing and no earlier read is at hand: the answer to a search that listed nothing
      // and that no price source refused (no name could be looked up)
      let dirRefused: Refusal | undefined;
      if (Q) {
        // a search: the directory, by the ticker first (whole, then its start), then the company's name. A plain ticker typed whole is
        // asked for directly as well, and does not wait for the directory past DIR_WAIT_MS: its two files are over a megabyte, and the first
        // search of "AAPL" answers from the price alone while the directory finishes loading for the next one (it is kept on its way). Once
        // a read has answered, no search waits past DIR_WAIT_MS for the next one (twelve hours on): the last read answers meanwhile
        const ticker = TICKER.test(Q);
        const asked = Date.now();
        const last = directory.now();
        // the token names are read beside the directory, and waited for within the same DIR_WAIT_MS on their first read (the gate needs both)
        const tokensOn = tokens.read().catch(() => undefined);
        const on = readDir();
        const got = ticker || last ? await upTo(on, DIR_WAIT_MS) : await on;
        if (!tokens.now()) await within(tokensOn, asked + DIR_WAIT_MS - Date.now());
        if (isRefusal(got) && !last) {
          if (!ticker) return got;
          dirRefused = got;
        }
        const all = got && !isRefusal(got) ? got : last ? [...last.values()] : [];
        const score = (e: DirEntry): number => (e.symbol === Q ? 3 : e.symbol.startsWith(Q) ? 2 : has(Q, e.name) ? 1 : 0);
        pool = all
          .map((e) => ({ e, s: score(e) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s || a.e.symbol.length - b.e.symbol.length || a.e.symbol.localeCompare(b.e.symbol))
          .slice(0, limit)
          .map((x) => x.e);
        // a ticker typed whole that the directory does not carry (or that it has not yet answered for) is still asked for: Nasdaq knows the
        // tickers that trade, and a ticker it does not know is not listed
        if (ticker && !pool.some((e) => e.symbol === Q)) pool = [{ symbol: Q, name: Q }, ...pool].slice(0, limit);
      } else {
        // the well-known few carry their company's name from the directory, waited for DIR_WAIT_MS at most on its first read; the directory
        // refusing (or late) leaves them their tickers
        pool = US_SHARES.slice(0, limit).map((s) => ({ symbol: s, name: s }));
        await dirNow();
      }
      const names = directory.now();
      // a fund, as the directory says, is asked of Nasdaq as an ETF first
      for (const e of pool) if (names?.get(e.symbol)?.etf) nasdaq.hint(e.symbol, "etf");
      const started = Date.now();
      // the first refusal a source answered (Robinhood, Nasdaq, a daily read): the answer where nothing is listed
      let refused: Refusal | undefined;
      const said = (r: Refusal) => {
        refused ??= r;
      };
      // real time within its one deadline: Robinhood's one answer for the tickers the gate lets through, then Nasdaq for NASDAQ_AT_ONCE of the
      // lines it did not price, those it has no recent answer for first (us-quotes.ts). The gate (us-tokens.ts listedGate): the directory
      // lists the ticker and the token's name agrees with the directory's, since a token's symbol may not be the share's ticker (SATS);
      // before both have answered, only the well-known few, tickers this file names itself (US_SHARES) — never another ticker typed
      const rt = await live.many(
        pool.map((e) => e.symbol),
        { listed: gate(), refused: said },
      );
      const now = clock();
      // the closes: Nasdaq's daily bars for what the chain did not price and for the close beside a Robinhood price, and right after the
      // close one read of Nasdaq's quote page — waited for to CLOSE_WAIT_MS from the start at most
      await settle(
        pool.map((e) => ({ sym: e.symbol, rt: rt.get(e.symbol) })),
        now,
        started + CLOSE_WAIT_MS,
        said,
      );
      const out: Listing[] = [];
      for (const e of pool) {
        const q = rt.get(e.symbol);
        const close = q ? undefined : closeNow(e.symbol, now);
        if (q || close) out.push(listing(e.symbol, q, close, names?.get(e.symbol)?.name ?? (e.name !== e.symbol ? e.name : undefined), now));
      }
      // nothing listed: the refusal that says why no price came (Robinhood's, Nasdaq's, a daily read's) — else, for a search with no directory
      // to look names up in, the directory's — not a list with no prices
      if (!out.length && (refused || dirRefused)) return (refused ?? dirRefused)!;
      if (!Q) shown = { of: out.length, total: US_SHARES.length };
      return out;
    },
    notes: (o) => [
      o.q?.trim()
        ? `${name}: real-time quotes from Robinhood or Nasdaq, else Nasdaq's last close, for any US stock or ETF in Nasdaq Trader's symbol directory.`
        : `${name}: real-time quotes (Robinhood, else Nasdaq) for ${shown?.of ?? US_SHARES.length} well-known names, else Nasdaq's last close · search any stock or ETF.`,
      // once the directory has refused, while it has never answered (a first read still on its way says nothing yet)
      ...(!directory.now() && dirSaidNo ? [NO_NAMES] : []),
    ],
    /** price history, keyless (see the top of this file and live/history-stocks.ts): a plain ticker (AAPL, BRK.B), in bars of 1m to 1w,
     * for a chart's first view or one page before the first bar it has */
    async candles(symbol, interval, w) {
      const now = clock();
      const bad = badHistory(id, interval, w, now);
      if (bad) return bad;
      const sym = symbol.trim().toUpperCase();
      if (!TICKER.test(sym)) return no("E_ACCOUNT_BAD_ACTION", { venue: id, message: `a US stock here is its ticker (AAPL, BRK.B), not "${symbol.slice(0, 40)}"` });
      // a fund is asked of Nasdaq as an ETF first (as the directory says, where it has been read)
      if (directory.now()?.get(sym)?.etf) nasdaq.hint(sym, "etf");
      return history(sym, interval, w);
    },
  };
}
