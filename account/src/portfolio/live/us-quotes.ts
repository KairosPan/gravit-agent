/** US STOCK QUOTES IN REAL TIME, KEYLESS: the price of a US share as the market has it now, so a listing (public-stocks.ts) — and a paper
 * account, which fills at it — is not fifteen minutes behind. Two sources, each through the fixed-host guard (public-markets.ts
 * PUBLIC_HOSTS); where neither answers in time, the caller says Cboe's delayed quote, which it asks AT THE SAME TIME, not after.
 *
 * What is read, and what it is (checked keyless from this machine on Wed 2026-10-14 between 16:30 and 17:50 UTC, 12:30–13:50 New York, in
 * the regular session):
 *   GET api.robinhood.com/rhj/prices                                ROBINHOOD's prices for its Stock Tokens, ALL of them in one answer (194
 *                       that day, 98.7 KB, 0.17–0.35 s at 17:49 UTC, 1.4 s once earlier): {quotes: [{tokenSymbol, bid, ask, currency,
 *                       isTradingHalt, generatedAt, dailyHigh, dailyLow, dailyTradingVolume, tokenBid, tokenAsk, …}]}. The record names the
 *                       share only by `tokenSymbol`, which is the TOKEN's symbol and NOT ALWAYS the share's ticker: 193 of the 194 matched
 *                       Cboe's symbol book by ticker and company (twelve also checked against Nasdaq's quote the same minute, each bid and
 *                       ask within a cent), but SATS is EchoStar's token (/rhj/assets: tokenName "EchoStar • Robinhood Token", isin
 *                       US2787681061) while EchoStar's share trades as ECHO — Nasdaq answers SATS "Symbol not exists.", Cboe's book lists
 *                       ECHO and not SATS, and Robinhood's SATS bid and ask (87.87/87.93 at 17:49 UTC) are ECHO's. So a Robinhood quote is
 *                       taken only for a ticker the caller says the market lists under that name (UsAsk.listed: Cboe's symbol book).
 *                       `bid` and `ask` are the UNDERLYING SHARE's quote, in dollars; `tokenBid` and `tokenAsk` are the token's (the share's
 *                       times the token's multiplier, 1.0011 for CRM that day) and are not read. `generatedAt` is the answer's own stamp,
 *                       ONE for all 194 quotes: Robinhood writes the whole answer about every fifteen seconds (16:51:47, 16:52:02, 16:52:17,
 *                       16:52:32 UTC that day; 17:49:28 and 17:49:43 later) and serves the same one in between, whether or not a quote in
 *                       it moved — it says the writer is running, not how old a quote is. So a share's quote is stamped with the
 *                       generatedAt of the FIRST answer in which its bid and ask stood as they stand now ("unchanged since"), never the
 *                       latest answer's: a book that stops moving ages, and is passed over after FRESH_MS. Since when a book has stood is
 *                       known only from an answer that saw it move: a book FIRST SEEN — after a restart, when nothing was read before — is
 *                       not taken until it moves while watched (it may have stood since the last session: Friday's book, read on Sunday
 *                       night), and one that moved across answers that were not read is stamped with the last answer read before them,
 *                       the earliest it may have moved (ROBINHOOD_NEXT_MS). A share Robinhood has halted
 *                       (`isTradingHalt` true) is left out. Only these 194 are quoted (no JPM, BRK.B, V, WMT or HOOD); a symbol asked one at
 *                       a time (/rhj/prices/{SYM}) is not asked here — the one answer serves them all. Robinhood's assets list (/rhj/assets)
 *                       marks 191 of them TRADABLE overnight (tradingCapabilities.overnight). Whether this answer's quotes keep moving in the
 *                       overnight session (20:00 to 04:00 New York), and from when in pre-market, was NOT watched: ROBINHOOD_OVERNIGHT says
 *                       what the account assumes
 *   GET api.nasdaq.com/api/quote/{SYM}/info?assetclass=stocks       NASDAQ's own quote page's data, sent with a desktop browser's
 *                       user-agent (without one, curl's HTTP/2 stream is reset — "INTERNAL_ERROR" — and HTTP/1.1 waits forever; Node's
 *                       own got 200 that day): {data: {symbol, companyName, exchange, marketStatus, primaryData: {lastSalePrice "$344.9472",
 *                       netChange "+3.6772", percentageChange "+1.08%", lastTradeTimestamp "Oct 14, 2026 12:33 PM ET", isRealTime true,
 *                       bidPrice "$344.85", askPrice "$344.89", bidSize, askSize, volume}, secondaryData}}: prices are strings with a "$"
 *                       and commas, the time is New York's to the minute. Eight asked at once answered in 0.3 s at 17:50 UTC. An ETF
 *                       answers only as assetclass=etf (SPY as "stocks" answered 200 with data null and status.rCode 400 "Symbol not
 *                       exists."), so a symbol is asked as a stock first — as an ETF first where the caller says it is likely one (its
 *                       company's name in Cboe's book: Nasdaq.hint) — then as the other, and the class that answered is remembered (an hour,
 *                       for at most a thousand symbols, shared by the quote and the chart); a symbol neither knows is not listed (kept ten
 *                       minutes). A dotted class share is written with its dot (BRK.B). Nasdaq's book (bidPrice, askPrice) is NASDAQ's own,
 *                       not the national best: where it is crossed (bid above ask) neither side is taken, only the last trade. OUTSIDE THE
 *                       REGULAR SESSION it was not watched live; archived answers of the same URL (web.archive.org, captured 2025-08-21 08:46,
 *                       2026-04-13 18:22, 2026-04-13 20:02 and 2026-04-14 00:52 and 01:56 New York, and weekends) show: marketStatus
 *                       "Pre-Market" or "After-Hours" with primaryData the extended session's last trade ("Aug 21, 2025 8:02 AM ET", "Apr 13,
 *                       2026 6:22 PM ET", isRealTime true, its bid and ask, and its change FROM THE LAST REGULAR CLOSE: AKAM $76.65 +0.59
 *                       beside a close of $76.06) and secondaryData that close ("Closed at Apr 13, 2026 4:00 PM ET", isRealTime false, the
 *                       change of the session before it); marketStatus "Closed" (from 20:00, overnight and at weekends) with primaryData
 *                       stamped by a DATE alone ("Apr 13, 2026"), isRealTime false, bid and ask "N/A", secondaryData null. So a quote is
 *                       taken only where it is real time and stamped to the minute, with primaryData's change (the change of the price
 *                       taken, from the last regular close before it); anything else is no quote. Its stamp is the last trade's, however
 *                       old: a share that has not traded in the session that is on keeps an older stamp, and the line says so
 *                       (public-stocks.ts usSessionWords). Nasdaq keeps no overnight session (its extended-trading page answers
 *                       markettype=overnight with rCode 400), so it is not asked overnight or while the market is closed
 *   GET api.nasdaq.com/api/quote/{SYM}/chart?assetclass=stocks      the last market day's minutes from 04:00, the pre-market and
 *                       after-hours ones too (512 points from 04:00 to 12:32 at 12:33 that day; archived: to 19:54 on a Friday, read on the
 *                       Sunday after): {data: {timeAsOf, lastSalePrice, previousClose, chart: [{x, y, z: {dateTime "4:00 AM ET", value}}],
 *                       volumeChart}}. `y` is ONE PRICE A MINUTE, not the minute's open, high, low and close; `volumeChart` is the same
 *                       price series again (checked 17:50 UTC: its last points equal chart's), so there is no volume. `x` is New York's
 *                       WALL-CLOCK time written as if it were UTC (x 1791950400000 = 2026-10-14T04:00Z is labelled "4:00 AM ET"), so it is
 *                       read back through fromEt. A lone sample far from both its neighbours while they agree is a stray print, not
 *                       where the price was (NVDA on 2026-10-14: 221.20 at 4:47 PM, 233.4137 at 4:48, 221.1941 at 4:49 — Robinhood and
 *                       Nasdaq's own quote never left 221): it is left out (withoutStrays), so one print neither stretches a chart nor
 *                       values a paper book
 *
 * The chain (usQuote), with ONE deadline (RT_WAIT_MS) for all of it: Robinhood's quote for a symbol it quotes and the caller says is listed
 * under that ticker, while its stamp is fresh (FRESH_MS) and the session is one it trades (pre-market, the regular session, after-hours — and
 * overnight while ROBINHOOD_OVERNIGHT says so); else Nasdaq's, in pre-market, the regular session and after-hours, for at most one batch
 * (NASDAQ_AT_ONCE) of the symbols asked, the first ones; else nothing, and the caller says Cboe's delayed quote. Nasdaq is asked AT THE SAME
 * TIME as Robinhood, never after it: for every symbol Robinhood's latest answer does not price fresh now (each of them, before Robinhood has
 * answered once), so a share Robinhood does not quote waits for one round trip, not two. What has not answered by the deadline is not waited
 * for: its answer, when it comes, is KEPT UNTIL THE NEXT ASK, which takes it whenever a new one is not back in time — a Nasdaq answer comes in
 * 1.2 to 3.3 s (measured 2026-10-16), past the deadline more often than not, and one thrown away at the next ask's start would never be used.
 * It is taken only WHILE IT IS RECENT (Nasdaq.latest): it came within FRESH_MS, and no refusal that says to wait holds Nasdaq back now — an
 * answer from hours before, or from before Nasdaq refused, is no real-time quote, and the line is Cboe's, said as delayed.
 * One refusal of Nasdaq that says to wait (an edge's page, a place rule, a 429) holds back every Nasdaq ask, every symbol, quote and chart, for
 * as long as holdBackMs says; NO ANSWER holds nothing until it is the source's way (NO_ANSWER_HOLD_AFTER in a row, with no answer between): one
 * slow request is one symbol's lost ask, not every share's twenty seconds. Robinhood's one answer likewise. Every answer carries the source's
 * own stamp (`at`), how far behind it is (`delayMs`: 0 for both) and which it is in words (`from`); nothing is worked out but Robinhood's price,
 * the middle of its bid and ask. These are the websites' own unofficial endpoints, not a licensed feed: either may change or refuse without
 * notice, which is why the delayed fallback stays.
 *
 * THE BACKGROUND READER (UsQuoteFeed, feat/paper-live phase 3): the shares someone is looking at now — a paper account's open orders and what
 * it holds (live/paper.ts renews its want at each look), the shares a page on the account's push channel shows (service.ts) — read as their
 * sources write them, in memory only, and told to whoever listens as they move: Robinhood's one answer read just after each of its writes
 * (robinhoodQuotes nextWrite: the window on this machine's clock in which its next write shows, learnt from the answers themselves — a
 * read that still has the write before raises its floor, the write's own stamp read on this clock ends it (its stamp, and the least time a
 * copy has taken to come back here after its stamp), the next a cadence on — and read halfway into it until it is narrow, then at its end.
 * Robinhood wrote at 04:35:19.07, 04:35:34.18 and 04:35:49.14 UTC on Saturday 2026-10-17, 15.1 s and 15.0 s apart, each read in 59–95 ms:
 * an answer is read within ROBINHOOD_PRECISE_MS of its write, with one or two reads a write, instead of anywhere up to ten seconds after it;
 * a write that does not come — Robinhood late, or its writer stopped — asked for again a few times quickly, then less and less often, a
 * cadence apart at most, until a new one is read. ONE WRITE IS SEVERAL COPIES (ROBINHOOD_SPREAD_MS, measured Monday 2026-10-19 in the regular
 * session): a read reaches whichever copy it reaches, made up to half a second after another — a later copy of the same write is that
 * write's newer word, never the next write. Read as the next write, it set the window a whole cadence on from when it was read, and every
 * US share reached the page five to eleven seconds after its write that day, 5.7 s at the middle; and a window ended by when a write was
 * first read, not by its stamp, was set late by any read that came late — a listing's. Read as one write, each write reached the page
 * 0.45 s after it at the middle the same afternoon, 0.47 s at the 90th percentile), and Nasdaq every NASDAQ_EVERY_MS for each wanted
 * share Robinhood does not price young (ROBINHOOD_STANDS_MS) — never as a share's FIRST quote while Robinhood is still to give it
 * (ROBINHOOD_FIRST_MS): Nasdaq stamps its quote with the minute, and the first quote a page was pushed after a start was Nasdaq's, 35 to
 * 75 seconds old by its stamp, before Robinhood's came. It stands beside the venues' streams (live/stream-hub.ts) as one more
 * MarketHub, for the US stocks line alone: its quotes are the same REST reads, never a stream's, and say so (`from`; `everyMs`, how often
 * Robinhood writes its answer; `askedEveryMs`, how often the account asks Nasdaq, which writes nothing on a cadence of its own) */
import { isRefusal, type Refusal } from "../../core/errors.ts";
import { fromEt, usPhaseAt } from "../account/calendar.ts";
import { no } from "../refuse.ts";
import { fin, fixedHosts, holdBackMs, isRec, keeper, LIST_MS, list, mid, pos, PUBLIC_HOSTS, publicNo, rec, str, type PublicDeps } from "./public-markets.ts";
import type { HubBook, HubQuote, HubRange, HubTick, MarketHub } from "./stream-hub.ts";
import type { Candle, PublicTrade } from "./trade.ts";
import { edgeRefused, realHttp, unreachable, type Http, type HttpReply } from "./types.ts";
import { HOST_LIMITS, hostLane } from "./history.ts";

export const ROBINHOOD_PRICES = "https://api.robinhood.com/rhj/prices";
export const NASDAQ_QUOTE = "https://api.nasdaq.com/api/quote";
/** a desktop browser's user-agent, which Nasdaq's quote API answers (see the top of this file) */
export const NASDAQ_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
/** the words a price from each source carries (Market.quoteFrom) */
export const ROBINHOOD_FROM = "Robinhood · real time";
export const NASDAQ_FROM = "Nasdaq · real time";
/** Robinhood's quotes are taken in the overnight session (20:00 to 04:00 New York, ahead of a market day) too. AN ASSUMPTION, NOT A
 * MEASUREMENT: its assets list says 191 of its Stock Tokens are tradable overnight, and its AAPL daily low on 2026-10-14 (340.29) lay a cent
 * below the lowest the earlier pass found anywhere else (340.30, the 13 October after-hours low) — a margin any one print could explain, so
 * it suggests an overnight session and does not show one. Nobody watched its bid and ask move after 20:00. Set false if they do not:
 * overnight a share then has no real-time price, and nothing is filled or offered in that session. A book that does not move ages out on its
 * own either way (a quote is stamped "unchanged since", FRESH_MS), and one first seen is not taken until it moves: a book frozen since the
 * last session is not taken for a live one, after a restart either */
export const ROBINHOOD_OVERNIGHT = true;
/** a quote older than this (by its own stamp) is not taken as real time */
export const FRESH_MS = 120_000;
/** the ONE deadline of the chain: a listing waits this long at most for the real-time sources, then says what answered. The callers allow a
 * source four seconds in all (paper.ts SOURCE_MS, explore.ts), the first search of a ticker waits up to 1.5 s for Cboe's symbol book before
 * it (public-stocks.ts), and Cboe's quotes are asked at the same time as this chain */
export const RT_WAIT_MS = 1_500;
/** Robinhood's one answer for every symbol is kept this long at most — less where its next write is out for certain sooner (nextWrite): it
 * writes a new one about every fifteen seconds */
const ROBINHOOD_MS = 10_000;
/** how often Robinhood writes its one answer, before the answers themselves have said (measured: see the top of this file) */
export const ROBINHOOD_EVERY_MS = 15_000;
/** a kept answer stands this long past the moment its next write is out for certain (nextWrite's `hi`) */
export const ROBINHOOD_AFTER_MS = 250;
/** how much a write's moment wobbles about its cadence (15.109 s and 14.969 s apart on 2026-10-17), either side */
export const ROBINHOOD_JITTER_MS = 150;
/** ONE WRITE, SEVERAL COPIES: Robinhood serves its answer from several copies, each made on its own as the one before it runs out — five
 * made between 16:27:25.172 and 25.582 UTC on Monday 2026-10-19, five more between 40.322 and 40.743, each then served about fifteen
 * seconds, a read answered by whichever it reaches (one made for the read itself, in half a second, or one made a moment before for another,
 * in a tenth) — their books as they stood at each copy's moment (11 to 20 of 195 moved from one copy to the next). A copy whose stamp lies
 * within this long of the first copy read of a write is one more copy of that write: a newer word of its books where its stamp is later,
 * never the next write — the cadence and the next write's window are a write's, not a copy's */
export const ROBINHOOD_SPREAD_MS = 2_000;
/** how soon after its stamp a copy has come back here at best — the way back from Robinhood and the difference of the two clocks — is
 * kept for each of the last this many writes: the next write's window is placed by its stamp with the least of them */
export const ROBINHOOD_LAGS = 8;
/** the background reader reads at the window's end (`hi`) once the window is this narrow, and halfway into it before: a write is read at
 * most this long after it shows, with one or two reads a write once the window has narrowed */
export const ROBINHOOD_PRECISE_MS = 700;
/** a write past its window (Robinhood late, or skipping one) is asked for again this soon, this many times at most; then a third of its
 * cadence later, and twice as long each time after that, a cadence at most (ROBINHOOD_BACKOFF), until a new write is read — never another
 * round of quick asks: a writer that has stopped, or an answer that is older or stamps no book (every share halted, an edge's stale copy),
 * costs a read a cadence, not one a second */
export const ROBINHOOD_RETRY_MS = 400;
export const ROBINHOOD_RETRIES = 8;
/** the waits past the quick asks, as parts of the cadence: a third, then doubled, then the cadence itself from then on */
export const ROBINHOOD_BACKOFF = 1 / 3;
/** an answer is kept at least this long, whatever its next write's moment says: a write that is late is not asked for again and again —
 * and one read once that moment has passed with no new write in it is kept a third of a cadence (ROBINHOOD_BACKOFF): the background reader
 * asks for the late write on its own, and what it reads is kept here */
const ROBINHOOD_MIN_KEEP_MS = 1_000;
/** Robinhood's quote of a share STANDS over Nasdaq's — Nasdaq not asked for it, its answer not taken over it — while it is no older than this
 * by its own stamp ("unchanged since"): the age an open order is judged at (live/paper.ts STOCK_JUDGE_MS), so a book that has stood still
 * longer than that has Nasdaq asked beside it again, and a share is never left without a quote young enough to judge at while Nasdaq has one */
export const ROBINHOOD_STANDS_MS = 60_000;
/** an answer read within this long of the one read before it follows it (Robinhood writes one about every fifteen seconds; read every ten
 * seconds at most, every other one may be missed): a book that moved between the two moved in that time. Across a longer gap — answers that
 * were not read, nobody asking — it may have moved at any time since the last one read */
export const ROBINHOOD_NEXT_MS = 30_000;
/** one Nasdaq quote is kept this long from when it came — less than NASDAQ_EVERY_MS, so each of the background reader's asks reads anew;
 * a symbol Nasdaq does not know, ten minutes (LIST_MS). An answer older than that is still the next ask's while a new one is not back in time
 * (Nasdaq.latest): kept until the next ask — while it came within FRESH_MS, and no refusal that says to wait holds Nasdaq back */
const NASDAQ_MS = 4_000;
export const NASDAQ_EVERY_MS = 5_000;
const CHART_MS = 60_000;
/** Nasdaq is asked for at most this many symbols in one ask of the chain (one batch, all at once), and the background reader has at most
 * this many of its asks on their way */
export const NASDAQ_AT_ONCE = 8;
/** how long one request may take before it is given up as no answer. No listing waits for these: it waits RT_WAIT_MS at most, and an answer
 * that comes after that is kept for the next ask — so a slow answer (Robinhood took 1.4 s once; Nasdaq 3.3 s on 2026-10-16) is not thrown
 * away, and a hung one is let go well inside the callers' four seconds of the next ask */
const ROBINHOOD_TIMEOUT_MS = 2_500;
const NASDAQ_TIMEOUT_MS = 6_000;
/** how long one ask of Nasdaq's daily bars by dates may take: a whole history is about ten seconds (see nasdaqSource) */
export const NASDAQ_DAILY_MS = 20_000;
/** NO ANSWER from a source (a timeout, a reset, a 5xx) holds it back — every symbol, holdBackMs's twenty seconds — only once it has not
 * answered this many times in a row: one slow request holds nothing back */
export const NO_ANSWER_HOLD_AFTER = 3;
/** the class Nasdaq answered a symbol as is remembered this long, for at most this many symbols (the oldest let go first) */
const CLASS_MS = 3_600_000;
const CLASS_KEPT = 1_000;

/** one US share's quote from a real-time source */
export interface UsQuote {
  /** the share's ticker (AAPL, BRK.B) */
  symbol: string;
  /** the last trade (Nasdaq), or the middle of the bid and ask (Robinhood) */
  price?: number | undefined;
  bid?: number | undefined;
  ask?: number | undefined;
  /** the source's own stamp for it, in ms: for Robinhood, the generatedAt of the first answer in which this bid and ask stood ("unchanged
   * since") — of the last answer read before it, where it moved across answers that were not read; for Nasdaq, its lastTradeTimestamp (to
   * the minute) */
  at: number;
  /** how far behind the market the source is: 0 for both */
  delayMs: number;
  /** which source, in words (ROBINHOOD_FROM, NASDAQ_FROM) */
  from: string;
  /** the change of `price` from the last regular-session close before `at` — yesterday's close in pre-market and the regular session, today's
   * in after-hours — in dollars and in percent, where the source says it (Nasdaq's primaryData; Robinhood gives none) */
  change?: number | undefined;
  changePct?: number | undefined;
}

/** an ISO stamp in ms, nanoseconds and all ("2026-10-14T16:33:08.490956509Z", Robinhood's): the fraction is cut to milliseconds first */
function isoMs(v: unknown): number | undefined {
  const s = str(v);
  if (!s) return undefined;
  const t = Date.parse(s.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isFinite(t) ? t : undefined;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Nasdaq's stamp, "Oct 14, 2026 12:33 PM ET" (New York, to the minute), in ms; nothing for a date alone ("Apr 13, 2026", a closed
 * market's) or anything else */
export function nasdaqTimeMs(v: unknown): number | undefined {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM) ET$/.exec(String(v ?? "").trim());
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[1]!) + 1;
  const hour12 = Number(m[4]);
  if (month < 1 || hour12 < 1 || hour12 > 12) return undefined;
  return fromEt(Number(m[3]), month, Number(m[2]), (hour12 % 12) + (m[6] === "PM" ? 12 : 0), Number(m[5]));
}

/** a Nasdaq figure: "$1,234.56", "+3.6772", "-1.14%" as a number; nothing for "N/A", "" or anything else */
export function nasdaqNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const s = String(v ?? "").trim().replace(/^\$/, "").replace(/%$/, "").replace(/,/g, "");
  return /^[+-]?\d+(\.\d+)?$/.test(s) ? fin(s) : undefined;
}

/** a refusal that is NO ANSWER — the request lost: a timeout, a reset, a 5xx, a page that is not the API — and not the source's own word to
 * wait (a time it named, a 429, a place rule): held back only once it is the source's way (NO_ANSWER_HOLD_AFTER in a row) */
const noAnswer = (r: Refusal): boolean => r.code === "E_VENUE_UNREACHABLE" && (r.native as { until?: unknown } | undefined)?.until === undefined;

/** a quote is fresh by its own stamp: no older than FRESH_MS, and not stamped further ahead of this clock than that */
export const freshQuote = (q: UsQuote, now: number): boolean => now - q.at < FRESH_MS && q.at - now < FRESH_MS;

/** Robinhood's latest answer as it was read (RobinhoodReader.latest) */
export interface RobinhoodAnswer {
  /** its quotes as the reader takes them: a book first seen is not one of them yet */
  quotes: Map<string, UsQuote>;
  /** every share it quoted with a bid and an ask in dollars and no halt — a book first seen too, and a token whose symbol is not the share's
   * ticker (SATS): which shares Robinhood quotes at all */
  symbols: ReadonlySet<string>;
  /** Robinhood's own stamp of the answer (generatedAt), and when it came here, ms */
  written: number;
  readAt: number;
}
/** ROBINHOOD'S ONE ANSWER, read and kept (robinhoodQuotes) */
export interface RobinhoodReader {
  /** the answer as it stands: the one kept while Robinhood's next write is not due yet (ROBINHOOD_MS at most), else read now */
  (): Promise<Map<string, UsQuote> | Refusal>;
  /** read now, whatever is kept — the background reader's read just after a write — save while a refusal that says to wait holds it back.
   * One read at a time: one on its way is the one */
  read(): Promise<Map<string, UsQuote> | Refusal>;
  /** the latest answer read, or undefined before one */
  latest(): RobinhoodAnswer | undefined;
  /** WHEN ITS NEXT WRITE SHOWS HERE, on this machine's clock: not before `lo`, and by `hi`. The write before showed after the latest read
   * that still came back with the one before it (sent then), and by its stamp read on this clock — its stamp, and the least time any copy
   * has taken to come back here after its stamp (ROBINHOOD_LAGS writes of it): never later than the first read that came back with it, and
   * never pushed later by a copy read long after it was made — and the next shows a cadence (everyMs) after, give or take
   * ROBINHOOD_JITTER_MS. A read that comes back with a copy of the same write (ROBINHOOD_SPREAD_MS) raises `lo` to when it was sent. Read
   * halfway between them, the window halves; read at `hi`, the write is out. Undefined before an answer */
  nextWrite(): { lo: number; hi: number } | undefined;
  /** the cadence of its writes as its answers have shown it: the middle of the last gaps between two writes read one after the other,
   * ROBINHOOD_EVERY_MS before any */
  everyMs(): number;
  /** let go of the refusal held */
  clear(): void;
}

/** ROBINHOOD's one answer for every Stock Token's share (see the top of this file): its quotes by the token's symbol, kept until its next
 * write is due (ROBINHOOD_MS at most), each stamped with the generatedAt of the first answer in which its bid and ask stood as they stand
 * ("unchanged since"). A book first seen is left out until it moves while watched: since when it has stood is not known. A halted share, one
 * with no bid or no ask (or a crossed book), and one not in dollars are left out. Robinhood refusing this network, or an answer with no
 * quotes in it, is a refusal, never an empty map; a refusal that says to wait is kept as holdBackMs says, no answer only once it is the
 * source's way (NO_ANSWER_HOLD_AFTER) */
export function robinhoodQuotes(deps: PublicDeps = {}): RobinhoodReader {
  const id = "robinhood";
  const name = "Robinhood";
  const clock = deps.clock ?? Date.now;
  const http = fixedHosts(deps.http ?? realHttp, PUBLIC_HOSTS, Math.min(deps.timeoutMs ?? ROBINHOOD_TIMEOUT_MS, ROBINHOOD_TIMEOUT_MS));
  // each symbol's bid and ask as last seen, since which answer they have stood so (`at`: not known for a book not yet seen to move), and
  // the last answer they were seen in (`saw`) — at most the ~200 Robinhood quotes
  const since = new Map<string, { bid: number; ask: number; at: number | undefined; saw: number }>();
  let latest: RobinhoodAnswer | undefined;
  // the gaps between two writes read one after the other (the last 8, each near the cadence: a gap of two writes is not one), and the window
  // in which the next write shows here (nextWrite)
  const gaps: number[] = [];
  const everyMs = (): number => {
    if (!gaps.length) return ROBINHOOD_EVERY_MS;
    const s = [...gaps].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  };
  let next: { lo: number; hi: number } | undefined;
  // the write the copies read last are of: the earliest and the latest stamp read of it (ROBINHOOD_SPREAD_MS) — and how soon after its
  // stamp a copy came back here at best, for each of the last ROBINHOOD_LAGS writes (a copy read long after it was made says nothing of it)
  let write: { first: number; last: number } | undefined;
  const lags: number[] = [];
  const lagMs = (): number => Math.min(...lags);
  // no answers in a row (a timeout, a reset): held back only from NO_ANSWER_HOLD_AFTER
  let quiet = 0;
  const once = async (sentAt: number): Promise<Map<string, UsQuote> | Refusal> => {
    let r: HttpReply;
    try {
      r = await http(ROBINHOOD_PRICES);
    } catch (err) {
      return unreachable(id, name, err);
    }
    if (r.status !== 200 || r.body === undefined) return publicNo(id, name, r);
    const quotes = list(rec(r.body).quotes).map(rec);
    if (!quotes.length) return no("E_VENUE_REJECTED", { venue: id, message: `${name} answered with no quotes`, native: { status: r.status } });
    const gotAt = clock();
    const out = new Map<string, UsQuote>();
    const symbols = new Set<string>();
    let stamp: number | undefined;
    for (const x of quotes) {
      const symbol = str(x.tokenSymbol)?.toUpperCase();
      if (!symbol || x.isTradingHalt === true || str(x.currency) !== "USD") continue;
      const bid = pos(x.bid);
      const ask = pos(x.ask);
      const price = mid(bid, ask);
      const written = isoMs(x.generatedAt);
      if (price === undefined || bid === undefined || ask === undefined || written === undefined) continue;
      stamp = stamp === undefined ? written : Math.max(stamp, written);
      const seen = since.get(symbol);
      // an answer older than one already read says nothing new of this book
      if (seen && written < seen.saw) continue;
      symbols.add(symbol);
      // since when this book has stood: unchanged, since when it stood before; moved since the answer read just before, this answer;
      // moved across answers not read, the last one read (the earliest it may have moved: a book that moved once in the gap and froze is
      // not fresh); first seen, not known — it may have stood since the last session — and not taken until it moves while watched
      const at = !seen ? undefined : seen.bid === bid && seen.ask === ask ? seen.at : written - seen.saw <= ROBINHOOD_NEXT_MS ? written : seen.saw;
      since.set(symbol, { bid, ask, at, saw: written });
      if (at !== undefined) out.set(symbol, { symbol, price, bid, ask, at, delayMs: 0, from: ROBINHOOD_FROM });
    }
    // when the next write shows here, and the writes' cadence: what this copy is beside the write read before (ROBINHOOD_SPREAD_MS)
    if (stamp !== undefined && write && Math.abs(stamp - write.first) <= ROBINHOOD_SPREAD_MS) {
      // ONE MORE COPY OF THE SAME WRITE: the next had not shown where this read was answered when it was sent — and a copy that came back
      // sooner after its stamp, or one made earlier, brings the next write's end closer, never later. A later copy is its books' newer word
      write.first = Math.min(write.first, stamp);
      write.last = Math.max(write.last, stamp);
      lags[lags.length - 1] = Math.min(lags[lags.length - 1]!, gotAt - stamp);
      if (next) next = { lo: Math.max(next.lo, sentAt), hi: Math.min(next.hi, write.first + lagMs() + everyMs() + ROBINHOOD_JITTER_MS) };
      if (latest && stamp >= latest.written) latest = { quotes: out, symbols, written: stamp, readAt: gotAt };
    } else if (stamp !== undefined && (!write || stamp > write.first)) {
      // A NEW WRITE: its cadence taken where it follows the write before (a gap of two writes is not one)
      const gap = write ? stamp - write.first : 0;
      if (gap >= ROBINHOOD_EVERY_MS / 2 && gap <= (ROBINHOOD_EVERY_MS * 3) / 2) {
        gaps.push(gap);
        if (gaps.length > 8) gaps.shift();
      }
      write = { first: stamp, last: stamp };
      lags.push(gotAt - stamp);
      if (lags.length > ROBINHOOD_LAGS) lags.shift();
      const every = everyMs();
      // this write showed after the window's floor (a read sent then still had the write before), within a cadence before it first came
      // back, and by its stamp read on this clock (at the latest when it first came back: no copy came back sooner after its stamp than
      // this one did); the next a cadence on
      const lo = Math.max(next?.lo ?? Number.NEGATIVE_INFINITY, gotAt - every - ROBINHOOD_JITTER_MS);
      next = { lo: lo + every - ROBINHOOD_JITTER_MS, hi: stamp + lagMs() + every + ROBINHOOD_JITTER_MS };
      latest = { quotes: out, symbols, written: stamp, readAt: gotAt };
    }
    // (a copy older than the write read before — an edge behind the others — says nothing of either)
    return out;
  };
  // the answer kept (or the refusal held), and the read on its way
  let kept: { until: number; p: Promise<Map<string, UsQuote> | Refusal>; held: boolean } | undefined;
  let flying: Promise<Map<string, UsQuote> | Refusal> | undefined;
  const ask = (): Promise<Map<string, UsQuote> | Refusal> => {
    if (flying) return flying;
    const sentAt = clock();
    const entry: { until: number; p: Promise<Map<string, UsQuote> | Refusal>; held: boolean } = { until: sentAt + ROBINHOOD_MS, p: Promise.resolve(new Map()), held: false };
    const p = once(sentAt).then(
      (r) => {
        if (flying === p) flying = undefined;
        if (isRefusal(r)) {
          quiet = noAnswer(r) ? quiet + 1 : 0;
          const hold = noAnswer(r) && quiet < NO_ANSWER_HOLD_AFTER ? 0 : holdBackMs(r);
          if (kept !== entry) return r;
          if (hold > 0) {
            entry.until = clock() + hold;
            entry.held = true;
          } else kept = undefined;
          return r;
        }
        quiet = 0;
        // kept until the next write is out for certain (nextWrite's `hi`), ROBINHOOD_MS at most, ROBINHOOD_MIN_KEEP_MS at least: a write
        // that shows sooner is the background reader's to read (it reads the window, and what it reads is kept here). A read sent once that
        // moment had passed, and still without a new write (Robinhood late, its writer stopped, an older answer or one no book stamps), is
        // kept a third of a cadence: the late write is not asked for again by every caller each second
        const left = next === undefined ? ROBINHOOD_MS : next.hi + ROBINHOOD_AFTER_MS - sentAt;
        if (kept === entry) entry.until = sentAt + (left <= 0 ? everyMs() * ROBINHOOD_BACKOFF : Math.max(ROBINHOOD_MIN_KEEP_MS, Math.min(ROBINHOOD_MS, left)));
        return r;
      },
      (err: unknown) => {
        if (flying === p) flying = undefined;
        if (kept === entry) kept = undefined;
        throw err;
      },
    );
    entry.p = p;
    kept = entry;
    flying = p;
    return p;
  };
  const all = (): Promise<Map<string, UsQuote> | Refusal> => (kept && clock() < kept.until ? kept.p : ask());
  return Object.assign(all, {
    read: (): Promise<Map<string, UsQuote> | Refusal> => (kept?.held && clock() < kept.until ? kept.p : ask()),
    latest: () => latest,
    nextWrite: () => (next ? { ...next } : undefined),
    everyMs,
    clear: () => {
      quiet = 0;
      if (kept?.held) kept = undefined;
    },
  });
}

export type AssetClass = "stocks" | "etf";

/** NASDAQ as one source (see the top of this file): its quote and its chart, sharing what is known of each symbol's class and one hold on
 * the whole source after a refusal that says to wait */
export interface Nasdaq {
  /** one share's quote, or null where Nasdaq does not know the symbol or has no real-time quote for it now: the answer that came within
   * NASDAQ_MS (a symbol it does not know, LIST_MS), else asked now — one ask a symbol at a time */
  quote(symbol: string): Promise<UsQuote | null | Refusal>;
  /** the last answer Nasdaq gave for the share — a late one among them, kept until the next ask takes it — WHILE IT IS RECENT: it came within
   * FRESH_MS, and no refusal that says to wait holds Nasdaq back now (an answer from before Nasdaq refused is not what it says now). Else
   * undefined: never answered, answered too long ago, or held back (null: it has no real-time quote for it). Its own stamp says how old its
   * quote is */
  latest(symbol: string): UsQuote | null | undefined;
  /** one share's minutes, or null where Nasdaq does not know the symbol or keeps no minutes for it */
  chart(symbol: string): Promise<Candle[] | null | Refusal>;
  /** ONE SHARE'S DAILY BARS between two New York dates, both included (YYYY-MM-DD), oldest first — the chart page asked by dates, which
   * answers daily bars and not minutes (history-sources.md: back to 1990 or an ETF's start in one call, about ten seconds for all of it) —
   * each stamped at its session's open, 09:30 New York; the days whose opening price Nasdaq gives as 0 (AAPL's in 1990 and 1991) left out
   * and counted (`noOpen`, and the latest of them). Null where Nasdaq does not know the symbol */
  daily(symbol: string, from: string, to: string): Promise<{ bars: Candle[]; noOpen: number; lastNoOpen?: number | undefined } | null | Refusal>;
  /** what the caller knows of a symbol's class before Nasdaq is asked (an ETF by its company's name in Cboe's book): asked as that class
   * first. What Nasdaq answered is never overwritten by a hint */
  hint(symbol: string, cls: AssetClass): void;
  /** let go of the refusals held (the whole source's and each symbol's), and of the answers kept: each symbol is asked anew */
  clear(): void;
}

/** NASDAQ's quote and chart for US shares (see the top of this file) */
export function nasdaqSource(deps: PublicDeps = {}): Nasdaq {
  const id = "nasdaq";
  const name = "Nasdaq";
  const clock = deps.clock ?? Date.now;
  const http: Http = fixedHosts(deps.http ?? realHttp, PUBLIC_HOSTS, Math.min(deps.timeoutMs ?? NASDAQ_TIMEOUT_MS, NASDAQ_TIMEOUT_MS));
  // a whole history by dates is about ten seconds of Nasdaq's (AAPL from 1990: 9.7 s, 1.7 MB, 2026-10-17): its own, longer deadline
  const slow: Http = fixedHosts(deps.http ?? realHttp, PUBLIC_HOSTS, Math.max(deps.timeoutMs ?? NASDAQ_DAILY_MS, NASDAQ_DAILY_MS));
  // the class each symbol answered as (`sure`) or is likely to be (a hint), kept CLASS_MS, at most CLASS_KEPT symbols
  const classes = new Map<string, { cls: AssetClass; sure: boolean; until: number }>();
  const classOf = (symbol: string) => {
    const c = classes.get(symbol);
    if (c && clock() >= c.until) classes.delete(symbol);
    return c && clock() < c.until ? c : undefined;
  };
  const setClass = (symbol: string, cls: AssetClass, sure: boolean) => {
    classes.delete(symbol);
    classes.set(symbol, { cls, sure, until: clock() + CLASS_MS });
    if (classes.size > CLASS_KEPT) classes.delete(classes.keys().next().value!);
  };
  // the hold on the whole source: one refusal that says to wait holds back every ask until then; no answer, only once it has not answered
  // NO_ANSWER_HOLD_AFTER times in a row (`quiet`), whichever symbols they were for
  let held: { until: number; r: Refusal } | undefined;
  let quiet = 0;
  const hold = (r: Refusal): Refusal => {
    quiet = noAnswer(r) ? quiet + 1 : 0;
    const ms = noAnswer(r) && quiet < NO_ANSWER_HOLD_AFTER ? 0 : holdBackMs(r);
    if (ms > 0) held = { until: clock() + ms, r };
    return r;
  };
  // every GET of Nasdaq waits its turn in the process's one line for it (live/history.ts hostLane: HOST_LIMITS.nasdaq) — the background
  // reader's quotes, a chart's minutes and its daily history alike — so all of them together stay under the one limit, and a burst of one
  // never draws a refusal that holds back the others
  const pace = deps.pace ?? hostLane;
  type Once = { data: Record<string, unknown> | null } | { other: HttpReply } | Refusal;
  const once = async (path: string, symbol: string, cls: AssetClass, query = ""): Promise<Once> => {
    if (held && clock() < held.until) return held.r;
    await pace("nasdaq");
    if (held && clock() < held.until) return held.r;
    let r: HttpReply;
    try {
      r = await (query ? slow : http)(`${NASDAQ_QUOTE}/${encodeURIComponent(symbol)}/${path}?assetclass=${cls}${query}`, { headers: { "user-agent": NASDAQ_UA } });
    } catch (err) {
      return hold(unreachable(id, name, err));
    }
    if (r.status === 200 && r.body !== undefined) {
      quiet = 0;
      const data = rec(r.body).data;
      return { data: isRec(data) ? data : null };
    }
    if (r.status >= 400 && r.status < 500 && r.status !== 429 && r.status !== 451 && !edgeRefused(r.status, r.text)) {
      quiet = 0;
      return { other: r };
    }
    return hold(publicNo(id, name, r));
  };
  /** Nasdaq's `data` for one symbol from one of its pages (info, chart): asked as the class it answered as before, or else as a stock then
   * an ETF (an ETF first where hinted), where Nasdaq does not answer the first (a 200 with data null, or a 4xx that is not a wait, a place
   * rule or an edge's page). Null where Nasdaq said it has no data; where every class asked answered a 4xx, Nasdaq's refusal */
  const data = async (path: "info" | "chart", symbol: string, query = ""): Promise<Record<string, unknown> | null | Refusal> => {
    const c = classOf(symbol);
    const order: AssetClass[] = c?.sure ? [c.cls] : c?.cls === "etf" ? ["etf", "stocks"] : ["stocks", "etf"];
    let refused: HttpReply | undefined;
    let none = false;
    for (const cls of order) {
      const got = await once(path, symbol, cls, query);
      if (isRefusal(got)) return got;
      if ("other" in got) refused ??= got.other;
      else if (got.data === null) none = true;
      else {
        setClass(symbol, cls, true);
        return got.data;
      }
    }
    return none || !refused ? null : publicNo(id, name, refused);
  };
  // each symbol's last answer and when it came (at most CLASS_KEPT symbols, the oldest let go first): an answer is the next ask's for
  // NASDAQ_MS from when it came (a symbol Nasdaq does not know, ten minutes), and after that whenever the next ask's own is late, while it
  // came within FRESH_MS and Nasdaq is not held back (latest); the asks on their way, one a symbol
  const answers = new Map<string, { q: UsQuote | null; listed: boolean; at: number }>();
  const asking = new Map<string, Promise<UsQuote | null | Refusal>>();
  const answered = (sym: string, a: { q: UsQuote | null; listed: boolean }): UsQuote | null => {
    answers.delete(sym);
    answers.set(sym, { ...a, at: clock() });
    if (answers.size > CLASS_KEPT) answers.delete(answers.keys().next().value!);
    return a.q;
  };
  /** primaryData's last trade, bid and ask where Nasdaq says it is real time and stamps it to the minute — the book only where it is not
   * crossed — and primaryData's change, the change of that price from the last regular close before it */
  const askQuote = async (sym: string): Promise<UsQuote | null | Refusal> => {
    const d = await data("info", sym);
    if (isRefusal(d)) return d;
    if (d === null) return answered(sym, { q: null, listed: false });
    const p = rec(d.primaryData);
    const at = nasdaqTimeMs(p.lastTradeTimestamp);
    const price = nasdaqNumber(p.lastSalePrice);
    if (p.isRealTime !== true || at === undefined || price === undefined || price <= 0) return answered(sym, { q: null, listed: true });
    const bid = nasdaqNumber(p.bidPrice);
    const ask = nasdaqNumber(p.askPrice);
    const crossed = bid !== undefined && ask !== undefined && bid > ask;
    const change = nasdaqNumber(p.netChange);
    const changePct = nasdaqNumber(p.percentageChange);
    return answered(sym, {
      q: { symbol: sym, price, ...(!crossed && bid !== undefined && bid > 0 ? { bid } : {}), ...(!crossed && ask !== undefined && ask > 0 ? { ask } : {}), at, delayMs: 0, from: NASDAQ_FROM, ...(change !== undefined ? { change } : {}), ...(changePct !== undefined ? { changePct } : {}) },
      listed: true,
    });
  };
  const charts = keeper<Candle[] | null>(clock, (a) => (a === null ? LIST_MS : CHART_MS));
  return {
    quote(symbol) {
      const sym = symbol.trim().toUpperCase();
      const a = answers.get(sym);
      if (a && clock() - a.at < (a.listed ? NASDAQ_MS : LIST_MS)) return Promise.resolve(a.q);
      const on = asking.get(sym);
      if (on) return on;
      const p = askQuote(sym).finally(() => {
        if (asking.get(sym) === p) asking.delete(sym);
      });
      asking.set(sym, p);
      return p;
    },
    latest(symbol) {
      const a = answers.get(symbol.trim().toUpperCase());
      const now = clock();
      // an answer from hours before (a share searched this morning), or one from before Nasdaq said to wait (a 429, an edge's hold), is no
      // quote of now: the line is then Cboe's, said as delayed — never this one, said as real time
      if (!a || now - a.at >= FRESH_MS || (held && now < held.until)) return undefined;
      return a.q;
    },
    /** the minutes, oldest first, as one-minute bars at the minute's price — open, high, low and close the same, no volume: SAMPLES, not
     * the minute's range — each at its real instant (`x` read back from New York's wall-clock time) */
    chart(symbol) {
      const sym = symbol.trim().toUpperCase();
      return charts(sym, async () => {
        const d = await data("chart", sym);
        if (isRefusal(d) || d === null) return d;
        const out: Candle[] = [];
        for (const x of list(d.chart).map(rec)) {
          const wall = fin(x.x);
          const y = pos(x.y);
          if (wall === undefined || y === undefined) continue;
          const w = new Date(wall);
          const t = fromEt(w.getUTCFullYear(), w.getUTCMonth() + 1, w.getUTCDate(), w.getUTCHours(), w.getUTCMinutes());
          out.push({ t, o: y, h: y, l: y, c: y });
        }
        return out.length ? withoutStrays(out.sort((a, b) => a.t - b.t)) : null;
      });
    },
    async daily(symbol, from, to) {
      const sym = symbol.trim().toUpperCase();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return no("E_ACCOUNT_BAD_ACTION", { venue: id, message: "a daily history is asked between two dates, YYYY-MM-DD" });
      const d = await data("chart", sym, `&fromdate=${from}&todate=${to}`);
      if (isRefusal(d) || d === null) return d;
      const bars: Candle[] = [];
      let noOpen = 0;
      let lastNoOpen: number | undefined;
      for (const x of list(d.chart).map(rec)) {
        const z = rec(x.z);
        const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(z.dateTime ?? "").trim());
        const [o, h, l, c, v] = [nasdaqNumber(z.open), nasdaqNumber(z.high), nasdaqNumber(z.low), nasdaqNumber(z.close), nasdaqNumber(z.volume)];
        if (!m || h === undefined || l === undefined || c === undefined || !(h > 0 && l > 0 && c > 0)) continue;
        const t = fromEt(Number(m[3]), Number(m[1]), Number(m[2]), 9, 30);
        // an opening price of 0 is no price: the day is left out, never given an open it did not have
        if (o === undefined || !(o > 0)) {
          noOpen++;
          lastNoOpen = Math.max(lastNoOpen ?? t, t);
          continue;
        }
        bars.push({ t, o, h, l, c, ...(v !== undefined && v >= 0 ? { v } : {}) });
      }
      bars.sort((a, b) => a.t - b.t);
      return { bars, noOpen, ...(lastNoOpen !== undefined ? { lastNoOpen } : {}) };
    },
    hint(symbol, cls) {
      const sym = symbol.trim().toUpperCase();
      if (!classOf(sym)) setClass(sym, cls, false);
    },
    clear() {
      held = undefined;
      quiet = 0;
      answers.clear();
      charts.clear();
    },
  };
}

/** how far a sample is from both its neighbours to be a stray print, and how near they are to each other (a share's own moves, however
 * quick, keep the next minute near the new price: only a print the price at once left again goes) */
export const STRAY_OFF = 0.02;
export const STRAY_AGREE = 0.005;
/** the samples (oldest first) without a lone one more than STRAY_OFF from both neighbours while they are within STRAY_AGREE of each other */
export function withoutStrays(xs: Candle[]): Candle[] {
  const off = (x: number, y: number): number => Math.abs(x - y) / y;
  return xs.filter((b, i) => {
    const a = xs[i - 1];
    const c = xs[i + 1];
    return !a || !c || !(off(a.c, c.c) <= STRAY_AGREE && off(b.c, a.c) > STRAY_OFF && off(b.c, c.c) > STRAY_OFF);
  });
}

/** one share's quote from NASDAQ's info alone (Nasdaq.quote) */
export function nasdaqQuote(deps: PublicDeps = {}): ((symbol: string) => Promise<UsQuote | null | Refusal>) & { clear(): void } {
  const n = nasdaqSource(deps);
  return Object.assign((symbol: string) => n.quote(symbol), { clear: n.clear });
}

/** one share's minutes from NASDAQ's chart alone (Nasdaq.chart) */
export function nasdaqChart(deps: PublicDeps = {}): ((symbol: string) => Promise<Candle[] | null | Refusal>) & { clear(): void } {
  const n = nasdaqSource(deps);
  return Object.assign((symbol: string) => n.chart(symbol), { clear: n.clear });
}

/** what a caller of the chain says with its ask */
export interface UsAsk {
  /** whether the market lists a share under this very ticker (Cboe's symbol book): Robinhood's quote is taken only for a symbol this says
   * yes to, since Robinhood names a share by its token's symbol and that is not always the share's ticker (SATS is EchoStar's token; the
   * share is ECHO). Not given — no book to check against — Robinhood's quote is taken for none, and Nasdaq, which knows the tickers, is asked */
  listed?: ((symbol: string) => boolean) | undefined;
  /** how long the chain is waited for, RT_WAIT_MS unless said */
  waitMs?: number | undefined;
}

/** the chain over both (usQuote) */
export interface UsQuotes {
  /** one share's real-time quote, or nothing (the caller says Cboe's delayed one) */
  (symbol: string, ask?: UsAsk): Promise<UsQuote | undefined>;
  /** many at once, within RT_WAIT_MS: Robinhood's one answer for the ones `listed` allows, and AT THE SAME TIME Nasdaq for the first
   * NASDAQ_AT_ONCE of the ones Robinhood's latest answer does not price fresh; a symbol neither priced in time — nor by a recent answer of
   * Nasdaq's that came after an earlier ask had stopped waiting (Nasdaq.latest) — is not in the map */
  many(symbols: readonly string[], ask?: UsAsk): Promise<Map<string, UsQuote>>;
  /** start reading Robinhood's answer where the session is one it is taken in, so a caller with something else to wait for first (Cboe's
   * symbol book) does not wait for it after: the answer is kept, and the next ask takes it */
  warm(): void;
  /** let go of the refusals each source holds */
  clear(): void;
  /** the two sources asked, and which sessions each is taken in now — what the background reader (UsQuoteFeed) reads, so a listing and the
   * reader share one answer of each */
  robinhood: RobinhoodReader;
  nasdaq: Nasdaq;
  sessions(now: number): { robinhood: boolean; nasdaq: boolean };
}

/** which of the two sources is taken in the session on at `now`: Robinhood in pre-market, the regular session and after-hours, and overnight
 * while ROBINHOOD_OVERNIGHT says so; Nasdaq in the first three (it keeps no overnight session); neither while the market is closed */
export function usSources(now: number): { robinhood: boolean; nasdaq: boolean } {
  const phase = usPhaseAt(now);
  const day = phase === "pre" || phase === "regular" || phase === "after";
  return { robinhood: day || (phase === "overnight" && ROBINHOOD_OVERNIGHT), nasdaq: day };
}

/** US shares in real time (see the top of this file): Robinhood's quote where it is fresh, listed under that ticker and its session is on,
 * else Nasdaq's in pre-market, the regular session and after-hours, else nothing — all of it within one deadline, the two asked at once. A
 * source that refuses is passed over, never the answer for the chain. `nasdaq` is the Nasdaq source to ask, shared with the caller's chart
 * where it has one */
export function usQuote(deps: PublicDeps = {}, nasdaq: Nasdaq = nasdaqSource(deps)): UsQuotes {
  const clock = deps.clock ?? Date.now;
  const robinhood = robinhoodQuotes(deps);
  const many = async (symbols: readonly string[], ask: UsAsk = {}): Promise<Map<string, UsQuote>> => {
    const start = clock();
    const on = usSources(start);
    const want = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    const out = new Map<string, UsQuote>();
    if (!want.length || (!on.robinhood && !on.nasdaq)) return out;
    const listed = ask.listed;
    // what Robinhood's latest answer prices fresh now (listed under that ticker): every other share is asked of Nasdaq at the same time as
    // Robinhood is read, not after it — each of them before Robinhood has answered once
    const last = on.robinhood && listed ? robinhood.latest() : undefined;
    const priced = (s: string): boolean => {
      const q = last?.quotes.get(s);
      return !!q && !!listed && listed(s) && freshQuote(q, start);
    };
    const ofNasdaq = on.nasdaq ? want.filter((s) => !priced(s)).slice(0, NASDAQ_AT_ONCE) : [];
    const ofRobinhood = new Map<string, UsQuote>();
    const rh =
      on.robinhood && listed
        ? robinhood().then(
            (all) => {
              if (isRefusal(all)) return;
              const now = clock();
              for (const s of want) {
                const q = all.get(s);
                if (q && listed(s) && freshQuote(q, now)) ofRobinhood.set(s, q);
              }
            },
            () => undefined,
          )
        : Promise.resolve();
    const ofNq = new Map<string, UsQuote>();
    const nq = Promise.all(
      ofNasdaq.map((s) =>
        nasdaq.quote(s).then(
          (q) => {
            if (q && !isRefusal(q)) ofNq.set(s, q);
          },
          () => undefined,
        ),
      ),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.all([rh, nq]), new Promise<void>((go) => (timer = setTimeout(go, Math.max(0, ask.waitMs ?? RT_WAIT_MS))))]);
    clearTimeout(timer);
    // what answered by the deadline: Robinhood's fresh quote; else Nasdaq's answer to this ask — or, where it is not back in time, the last
    // one Nasdaq gave while it is recent (a late answer to an earlier ask, kept until this one: Nasdaq.latest — none from long before, none
    // while Nasdaq says to wait), its own stamp saying how old it is. An answer still on its way is kept by its source for the next ask, never
    // added to this one
    for (const s of want) {
      const r = ofRobinhood.get(s);
      if (r) out.set(s, r);
      else if (on.nasdaq) {
        const n = ofNq.get(s) ?? nasdaq.latest(s);
        if (n) out.set(s, n);
      }
    }
    return out;
  };
  const one = async (symbol: string, ask?: UsAsk): Promise<UsQuote | undefined> => (await many([symbol], ask)).get(symbol.trim().toUpperCase());
  return Object.assign(one, {
    many,
    warm: () => {
      if (usSources(clock()).robinhood) void robinhood().catch(() => undefined);
    },
    clear: () => {
      robinhood.clear();
      nasdaq.clear();
    },
    robinhood,
    nasdaq,
    sessions: usSources,
  });
}

// ---- THE BACKGROUND READER (feat/paper-live, phase 3) --------------------------------------------------------------------------------

/** a US share's ticker as the US stocks line names it: one to five letters, a class letter after a dot (BRK.B) */
export const US_TICKER = /^[A-Z]{1,5}(\.[A-Z])?$/;
/** how long a share no one wants any more is still read, and how long the paper account's want lasts from its last look (as the venues'
 * streams keep theirs: stream-hub.ts IDLE_MS) */
export const US_IDLE_MS = 60_000;
/** the most shares read at once: one more is not (its listing is read as before, its age said), unless one no one wants any more makes room */
export const US_MAX_SHARES = 100;
/** the reader's own look: shares no one wants any more let go, Nasdaq asked for the wanted shares Robinhood does not price, live flips told */
const US_LOOK_MS = 1_000;
/** A SHARE'S FIRST QUOTE IS ROBINHOOD'S where Robinhood quotes it: Robinhood prices a book once it has been seen to move, at the first write
 * read after the share is wanted — a cadence at most, and the halving of the reader's first window after a start — while
 * Nasdaq's quote, which comes in a second, is stamped with its last trade's MINUTE (35 to 75 s old by that stamp when it was the first quote
 * pushed on Monday 2026-10-19). So Nasdaq's quote waits this long from when the share is first wanted, set aside, to be a share's first —
 * taken then only where Robinhood has not priced it (a book that has not moved) — save where Robinhood will not price it: its session not
 * on, the share not listed under that ticker or not in its answer, or its last read refused */
export const ROBINHOOD_FIRST_MS = 20_000;

export interface UsFeedOptions {
  /** the US stocks line's id (public-stocks.ts US_STOCKS_ID): the one public source whose markets this reads */
  source: string;
  /** the chain whose two sources it reads (usQuote): a listing and this reader share one answer of each, and one hold of each */
  quotes: Pick<UsQuotes, "robinhood" | "nasdaq" | "sessions">;
  /** whether the market lists a share under this very ticker (Cboe's symbol book): Robinhood's quote is taken only for one it says yes to,
   * since Robinhood names a share by its token's symbol (UsAsk.listed) */
  listed: (symbol: string) => boolean;
  clock?: (() => number) | undefined;
  maxShares?: number | undefined;
}

interface Share {
  symbol: string;
  /** pages holding it, and the paper account's want (and a release's) until */
  holds: number;
  until: number;
  /** its real-time quote as last taken, the seq that rose with it, whether it was last told live, when a source last answered for it, and
   * when Nasdaq was last asked for it */
  q?: UsQuote | undefined;
  seq: number;
  live: boolean;
  recvAt: number;
  askedAt: number;
  /** when it was first wanted; Nasdaq's latest answer set aside while Robinhood is still to give its first quote (robinhoodDue), with when
   * it came; and Robinhood's answer last taken for it (each answer is taken once) */
  addedAt: number;
  held?: { q: UsQuote; at: number } | undefined;
  rhSeen?: RobinhoodAnswer | undefined;
}

/** THE US SHARES' BACKGROUND READER (see the top of this file): the shares someone is looking at, read as their sources write them —
 *   Robinhood    its one answer read as each write shows (RobinhoodReader.nextWrite: halfway into the window the write shows in, then
 *                at its end once it is ROBINHOOD_PRECISE_MS narrow; a write past its window asked for again every ROBINHOOD_RETRY_MS,
 *                ROBINHOOD_RETRIES times, then backing off to a cadence apart until a new write is read), while a wanted share is one
 *                Robinhood may quote (in its latest answer, or not yet known) and its session is on — and each answer read, by this
 *                reader or by a listing first, taken at once (a share wanted while it runs is given the answer read last);
 *   Nasdaq       every NASDAQ_EVERY_MS for each wanted share Robinhood does not price young now (ROBINHOOD_STANDS_MS) — before Robinhood's
 *                first answer each of them, AT THE SAME TIME as Robinhood is read, never after it — at most NASDAQ_AT_ONCE on their way at
 *                once, in pre-market, the regular session and after-hours; its answer set aside, never a share's first quote, while
 *                Robinhood is still to give that (ROBINHOOD_FIRST_MS);
 * and Cboe never: its delayed quote is the line's (public-stocks.ts), never this reader's, so a delayed quote is never pushed as live. A
 * share's quote is its source's own, with its own stamp (`at`: Robinhood's "unchanged since", Nasdaq's last trade, to the minute) — and it
 * is LIVE while that stamp is fresh (FRESH_MS, the chain's own rule) and its source's session is on: otherwise its last word, its age said.
 * Robinhood's young quote stands over Nasdaq's, and one source's quote replaces the other's only with a newer stamp. A share is read while
 * it is wanted — HELD by a page that shows it (hold), or WANTED by the
 * paper account for US_IDLE_MS from its last look (want) — and US_IDLE_MS after; at most US_MAX_SHARES at once. Nothing runs until a share
 * is wanted, nothing is written anywhere, and close() stops every timer (a share wanted again starts them again). It reads only: no key, no
 * order, nothing signed — the same keyless GETs, through the same fixed-host guard, as the listing */
export class UsQuoteFeed implements MarketHub {
  private readonly clock: () => number;
  private readonly max: number;
  private readonly shares = new Map<string, Share>();
  private readonly listeners = new Set<(t: HubTick) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private rhTimer: ReturnType<typeof setTimeout> | undefined;
  private rhBusy = false;
  private rhTries = 0;
  /** Robinhood's last read refused (or lost): no share waits for its first quote then */
  private rhDown = false;
  private readonly asking = new Set<string>();
  /** the count every share's seq is taken from: it only rises */
  private seqNo = 0;

  private readonly o: UsFeedOptions;

  constructor(o: UsFeedOptions) {
    this.o = o;
    this.clock = o.clock ?? Date.now;
    this.max = o.maxShares ?? US_MAX_SHARES;
  }

  covers(source: string, symbol: string): boolean {
    return source === this.o.source && US_TICKER.test(String(symbol ?? ""));
  }
  /** a share's price is all this carries: no book, no trades (service.ts tells a page its quote alone) */
  pricesOnly(source: string, symbol: string): boolean {
    return this.covers(source, symbol);
  }

  want(source: string, symbol: string): boolean {
    const sh = this.ensure(source, symbol);
    if (!sh) return false;
    sh.until = Math.max(sh.until, this.clock() + US_IDLE_MS);
    return true;
  }

  hold(source: string, symbol: string): () => void {
    const sh = this.ensure(source, symbol);
    if (!sh) return () => undefined;
    sh.holds++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      if (this.shares.get(sh.symbol) !== sh) return;
      sh.holds = Math.max(0, sh.holds - 1);
      sh.until = Math.max(sh.until, this.clock() + US_IDLE_MS);
    };
  }

  /** the share's quote as its real-time source last gave it, in the hub's shape: Robinhood's bid and ask (its price their middle, so no
   * `last`), or Nasdaq's last trade with its book; `at`, `seenAt` and — for Robinhood, whose write it first stood in is its own moment —
   * `priceAt` its own stamp, so its age is its source's, never the moment it was read; `from` saying it is a REST read, and how it comes:
   * Robinhood's `everyMs`, how often it writes its answer, which is read as it is written — or Nasdaq's `askedEveryMs`, how often the account
   * asks it (Nasdaq writes nothing on a cadence of its own: its stamp is its last trade's, to the minute); `us` the quote itself. Undefined
   * before a source has priced it */
  quote(source: string, symbol: string): HubQuote | undefined {
    if (!this.covers(source, symbol)) return undefined;
    const sh = this.shares.get(symbol);
    const q = sh?.q;
    if (!sh || !q) return undefined;
    const rh = q.from === ROBINHOOD_FROM;
    return {
      ...(q.bid !== undefined ? { bid: q.bid } : {}),
      ...(q.ask !== undefined ? { ask: q.ask } : {}),
      ...(!rh && q.price !== undefined ? { last: q.price } : {}),
      at: q.at,
      ...(rh ? { priceAt: q.at } : {}),
      recvAt: sh.recvAt,
      seenAt: q.at,
      src: rh ? "Robinhood" : "Nasdaq",
      seq: sh.seq,
      live: this.isLive(sh, this.clock()),
      from: q.from,
      delayMs: q.delayMs,
      ...(rh ? { everyMs: this.o.quotes.robinhood.everyMs() } : { askedEveryMs: NASDAQ_EVERY_MS }),
      us: q,
    };
  }
  book(): HubBook | undefined {
    return undefined;
  }
  trades(): PublicTrade[] {
    return [];
  }
  since(_source: string, symbol: string, seq: number): HubRange {
    return { trades: 0, seq: this.shares.get(symbol)?.seq ?? seq };
  }
  /** its quote while it is live and its stamp within `maxAgeMs`: nothing is waited for — a REST source says nothing between its writes */
  async confirmed(source: string, symbol: string, maxAgeMs: number): Promise<HubQuote | undefined> {
    const q = this.quote(source, symbol);
    return q?.live && this.clock() - q.seenAt <= maxAgeMs ? q : undefined;
  }
  onTick(fn: (t: HubTick) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  close(): void {
    this.stop();
    this.shares.clear();
    this.listeners.clear();
  }
  /** the shares read now and whether each is live, by their source: what a test reads */
  status(): Array<{ symbol: string; live: boolean; from?: string | undefined }> {
    const now = this.clock();
    return [...this.shares.values()].map((s) => ({ symbol: s.symbol, live: this.isLive(s, now), ...(s.q ? { from: s.q.from } : {}) }));
  }

  // ---- interest, and the reads -------------------------------------------------------------------------------------------------------

  private ensure(source: string, symbol: string): Share | undefined {
    if (!this.covers(source, symbol)) return undefined;
    const had = this.shares.get(symbol);
    if (had) return had;
    if (this.shares.size >= this.max) {
      const now = this.clock();
      const spare = [...this.shares.values()].filter((s) => !s.holds && now >= s.until).sort((a, b) => a.until - b.until)[0];
      if (!spare) return undefined;
      this.shares.delete(spare.symbol);
    }
    const sh: Share = { symbol, holds: 0, until: 0, seq: this.seqNo, live: false, recvAt: 0, askedAt: Number.NEGATIVE_INFINITY, addedAt: this.clock() };
    this.shares.set(symbol, sh);
    // a share wanted while the reader runs is given Robinhood's answer read last at the end of this turn, not at the reader's next look
    if (this.timer) queueMicrotask(() => this.fromRobinhood(this.clock()));
    this.start();
    return sh;
  }
  private start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.look(), US_LOOK_MS);
    this.timer.unref?.();
    // what was wanted in this turn is asked for at its end, together
    queueMicrotask(() => {
      this.look();
      if (!this.rhTimer && !this.rhBusy) void this.rhRead();
    });
  }
  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.rhTimer) clearTimeout(this.rhTimer);
    this.rhTimer = undefined;
    this.rhTries = 0;
  }
  private tell(sh: Share, what: HubTick["what"]): void {
    for (const fn of [...this.listeners]) {
      try {
        fn({ source: this.o.source, symbol: sh.symbol, what });
      } catch {
        // a listener's fault is its own
      }
    }
  }
  /** live: a real-time quote fresh by its own stamp, its source's session on now */
  private isLive(sh: Share, now: number): boolean {
    const q = sh.q;
    if (!q || !freshQuote(q, now)) return false;
    const on = this.o.quotes.sessions(now);
    return q.from === ROBINHOOD_FROM ? on.robinhood : on.nasdaq;
  }
  /** Robinhood's quote stands for the share now — live, and no older by its own stamp than ROBINHOOD_STANDS_MS, the age an open order is
   * judged at: Nasdaq is not asked for it. A book that has stood still longer has Nasdaq asked beside it again */
  private robinhoodStands(sh: Share, now: number): boolean {
    return sh.q?.from === ROBINHOOD_FROM && this.isLive(sh, now) && now - sh.q.at <= ROBINHOOD_STANDS_MS;
  }
  /** ROBINHOOD IS STILL TO GIVE THIS SHARE ITS FIRST QUOTE (ROBINHOOD_FIRST_MS): none taken for it yet, less than that since it was first
   * wanted, Robinhood's session on and its last read not refused, the share listed under that ticker and in Robinhood's latest answer (or
   * none read yet). Nasdaq's quote is set aside meanwhile, never the share's first */
  private robinhoodDue(sh: Share, now: number): boolean {
    if (sh.q || this.rhDown || now - sh.addedAt >= ROBINHOOD_FIRST_MS) return false;
    if (!this.o.quotes.sessions(now).robinhood || !this.o.listed(sh.symbol)) return false;
    const last = this.o.quotes.robinhood.latest();
    return !last || last.symbols.has(sh.symbol);
  }
  /** a quote a source gave for a share, taken where it is newer: told as a quote where it moved (its seq rising), as a live flip where only
   * that changed. Robinhood's standing quote is not replaced by Nasdaq's, and Nasdaq's is not a share's first while Robinhood is still to
   * give it (set aside: letHeld); and one source's quote replaces the other's only with a NEWER stamp — a Robinhood book that has stood
   * unchanged longer than Nasdaq's last trade is older than it, not a fresher word. `recvAt`: when the source's answer came, now unless said */
  private take(symbol: string, q: UsQuote, recvAt?: number): void {
    const sh = this.shares.get(symbol);
    if (!sh) return;
    const now = this.clock();
    if (q.from !== ROBINHOOD_FROM && this.robinhoodStands(sh, now)) return;
    if (q.from !== ROBINHOOD_FROM && this.robinhoodDue(sh, now)) {
      if (!sh.held || q.at >= sh.held.q.at) sh.held = { q, at: recvAt ?? now };
      return;
    }
    sh.recvAt = recvAt ?? now;
    const was = sh.q;
    // an older word of the same source (an answer that crossed a newer one on its way) says nothing new; the other source's, nothing newer
    // unless its own stamp is
    if (was && (was.from === q.from ? q.at < was.at : q.at <= was.at)) return;
    const moved = !was || was.from !== q.from || was.at !== q.at || was.bid !== q.bid || was.ask !== q.ask || was.price !== q.price;
    sh.q = q;
    sh.held = undefined;
    const live = this.isLive(sh, now);
    if (moved) {
      sh.seq = ++this.seqNo;
      sh.live = live;
      this.tell(sh, "quote");
    } else if (live !== sh.live) {
      sh.live = live;
      this.tell(sh, "live");
    }
  }
  /** the reader's look: shares no one wants any more let go, live flips told, Nasdaq asked; with no share left, every timer stopped */
  private look(): void {
    const now = this.clock();
    for (const sh of [...this.shares.values()]) {
      if (sh.holds || now < sh.until) continue;
      this.shares.delete(sh.symbol);
      if (sh.live) {
        sh.live = false;
        this.tell(sh, "live");
      }
    }
    if (!this.shares.size) return void this.stop();
    this.fromRobinhood(now);
    this.letHeld(now);
    for (const sh of this.shares.values()) {
      const live = this.isLive(sh, now);
      if (live === sh.live) continue;
      sh.live = live;
      this.tell(sh, "live");
    }
    this.askNasdaq(now);
    if (!this.rhTimer && !this.rhBusy) this.rhAgain(0);
  }
  /** ROBINHOOD'S LATEST ANSWER, whoever read it — this reader, or a listing's ask that came first — taken for each wanted share it prices
   * fresh, once an answer: a write a listing read first is told at this reader's next look, not a cadence later at its next write; a share
   * wanted while the reader runs is given the answer read last at once */
  private fromRobinhood(now: number): void {
    const l = this.o.quotes.robinhood.latest();
    if (!l) return;
    for (const sh of this.shares.values()) {
      if (sh.rhSeen === l) continue;
      sh.rhSeen = l;
      const q = l.quotes.get(sh.symbol);
      if (q && this.o.listed(sh.symbol) && freshQuote(q, now)) this.take(sh.symbol, q, l.readAt);
    }
  }
  /** Nasdaq's answers set aside while Robinhood was still to give a share its first quote (robinhoodDue), once it no longer is: let go where
   * Robinhood has given it; else taken — Robinhood did not in time (a book that has not moved), or will not (its session over, a refusal) */
  private letHeld(now: number): void {
    for (const sh of this.shares.values()) {
      if (!sh.held || this.robinhoodDue(sh, now)) continue;
      const h = sh.held;
      sh.held = undefined;
      if (!sh.q) this.take(sh.symbol, h.q, h.at);
    }
  }
  /** Nasdaq for each wanted share Robinhood does not price fresh, every NASDAQ_EVERY_MS — or, for more shares than Nasdaq's line takes in
   * that (HOST_LIMITS.nasdaq: a few a second), as often as the line lets each have its turn — the shares a page shows asked first, at most
   * NASDAQ_AT_ONCE on their way, in its sessions */
  private askNasdaq(now: number): void {
    if (!this.o.quotes.sessions(now).nasdaq) return;
    const due = [...this.shares.values()].filter((sh) => !this.robinhoodStands(sh, now));
    const limit = HOST_LIMITS.nasdaq;
    const every = Math.max(NASDAQ_EVERY_MS, Math.ceil((due.length * limit.perMs) / limit.max));
    for (const sh of due.sort((a, b) => Number(b.holds > 0) - Number(a.holds > 0))) {
      if (this.asking.size >= NASDAQ_AT_ONCE) return;
      if (this.asking.has(sh.symbol) || now - sh.askedAt < every) continue;
      sh.askedAt = now;
      this.asking.add(sh.symbol);
      void this.o.quotes.nasdaq
        .quote(sh.symbol)
        .then(
          (q) => {
            if (q && !isRefusal(q)) this.take(sh.symbol, q);
          },
          () => undefined,
        )
        .finally(() => this.asking.delete(sh.symbol));
    }
  }
  /** whether a wanted share is one Robinhood may quote: in its latest answer, or not known yet (no answer, or one older than LIST_MS: its
   * tokens change) — and listed under that ticker */
  private robinhoodWanted(now: number): boolean {
    const last = this.o.quotes.robinhood.latest();
    for (const sh of this.shares.values()) if (this.o.listed(sh.symbol) && (!last || last.symbols.has(sh.symbol) || now - last.readAt > LIST_MS)) return true;
    return false;
  }
  private rhAgain(ms: number): void {
    if (this.rhTimer) clearTimeout(this.rhTimer);
    if (!this.shares.size) return void (this.rhTimer = undefined);
    this.rhTimer = setTimeout(() => void this.rhRead(), Math.max(0, ms));
    this.rhTimer.unref?.();
  }
  /** WHEN TO READ ROBINHOOD NEXT, from the window its next write shows in (RobinhoodReader.nextWrite): at the window's end once it is
   * ROBINHOOD_PRECISE_MS narrow — the write is out by then — else halfway into it, which halves it either way (a read that still has the
   * write before raises its floor; one that has the new write ends it). A write past its window (late, or skipped) is asked for again every
   * ROBINHOOD_RETRY_MS, ROBINHOOD_RETRIES times; then a third of a cadence later, twice that the time after, and a cadence apart from then on
   * (ROBINHOOD_BACKOFF) — the reads past the window counted (rhTries) until a new write is read, which moves the window on and starts the
   * count again: a writer that has stopped, or an answer older than the last or with no book stamped in it, is never asked for again in
   * quick rounds. Before any answer: now */
  private rhWait(now: number): number {
    const r = this.o.quotes.robinhood;
    const w = r.nextWrite();
    if (!w) return 0;
    if (now >= w.hi) {
      const n = this.rhTries;
      this.rhTries = Math.min(n + 1, ROBINHOOD_RETRIES + 4);
      if (n < ROBINHOOD_RETRIES) return ROBINHOOD_RETRY_MS;
      const every = r.everyMs();
      return Math.min(every, every * ROBINHOOD_BACKOFF * 2 ** (n - ROBINHOOD_RETRIES));
    }
    this.rhTries = 0;
    return Math.max(0, (w.hi - w.lo <= ROBINHOOD_PRECISE_MS ? w.hi : Math.max(now, (w.lo + w.hi) / 2)) - now);
  }
  /** ROBINHOOD READ AS IT IS WRITTEN: its answer read when the window says (rhWait), the wanted shares it prices fresh taken from the answer
   * read last (fromRobinhood: a copy of the same write is its books' newer word where its stamp is later); a refusal (held as its rule says)
   * asked again a cadence later, the reads past the window still counted, and no share waiting for Robinhood's first quote meanwhile; nothing
   * it may quote wanted, or its session not on, looked at again each US_LOOK_MS without a read — and read at once when it is */
  private async rhRead(): Promise<void> {
    this.rhTimer = undefined;
    if (!this.shares.size || this.rhBusy) return;
    const r = this.o.quotes.robinhood;
    const now = this.clock();
    if (!this.o.quotes.sessions(now).robinhood || !this.robinhoodWanted(now)) return void this.rhAgain(US_LOOK_MS);
    this.rhBusy = true;
    let got: Map<string, UsQuote> | Refusal | undefined;
    try {
      got = await r.read();
    } catch {
      got = undefined;
    } finally {
      this.rhBusy = false;
    }
    if (!this.shares.size) return;
    this.rhDown = !got || isRefusal(got);
    const t = this.clock();
    this.fromRobinhood(t);
    this.letHeld(t);
    this.rhAgain(this.rhDown ? r.everyMs() : this.rhWait(t));
  }
}
