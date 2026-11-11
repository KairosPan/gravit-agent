// face/plugins/analog/lib/bars.mjs
/**
 * A company's whole daily history read through the market's `GET /api/candles`, and the keep that holds those
 * histories in memory for a trading session. The market is the only host asked; its refusals are kept in its own
 * words.
 *
 * A history is read latest page first (`range=MAX`, 5,000 bars), then older pages of 1,000 bars before the oldest bar
 * so far, at most 12 pages, until the market says there is no more or a page adds no older bar. A refusal on any page
 * refuses the whole read. The market answers a page it could not have from Nasdaq with another source's bars, and a
 * page Nasdaq holds nothing for empty, so a history is `short` when any page's source is not Nasdaq's or when a page
 * said there was more and the next brought no older bar; its `source` is then the first source that is not Nasdaq's.
 * When the latest page's last bar is built from the session's minutes, `today` holds the market's words for it, and
 * `sessionOpen` is true only while those words say the session is open. `adjustment` holds the first page's words for
 * how its prices are adjusted, when it gives them.
 *
 * The keep:
 * - reads at most four companies at a time, and one read of a company serves every caller asking while it runs;
 * - reads `SPY` first when it is asked for; when the date of its latest bar is later than any the keep has seen, every
 *   other kept history is dropped before the rest are read (an answer ending earlier drops nothing and moves no date);
 * - reads a company named in `fresh` again, whole, unless a read of it is already running;
 * - waits out one hold of a minute or less per call: no new read starts while it lasts, and every read begun before
 *   it ended and refused with such a hold is asked once more after it; any later refusal is final;
 * - stops a call's reads when the market does not answer: the rest of the call is refused with those words;
 * - names, instead of reading, a company not yet started once `deadlineMs` have passed since the call began;
 * - holds at most `max` histories, dropping the least recently used (never `SPY`);
 * - never holds a history read short: the next call that asks for it reads it again.
 */
import { marketOrigin } from "../../lunhui/lib/market-fetch.mjs";
import { dateOf } from "./episodes.mjs";

/**
 * @typedef {import("./selloff.mjs").Bar} Bar
 * @typedef {(query: Record<string, string>) => Promise<{ status: number, body: any }>} Ask
 * @typedef {{ symbol: string, bars: Bar[], source: string, firstBar: string, short: boolean, today: string | null,
 *   sessionOpen: boolean, adjustment: string | null, readAt: number }} History
 * @typedef {{ symbol: string, refused: string, holdMs: number | null, down: boolean }} Refused
 * @typedef {{ read: Map<string, History>, refused: Map<string, string>, timedOut: string[], down: boolean }} Histories
 * @typedef {{ histories: (symbols: string[], options?: { fresh?: string[], deadlineMs?: number }) => Promise<Histories> }} BarsKeep
 */

/** The bars the first page asks for, and each older page. */
export const DAY_PAGE = 5000;
export const OLDER_PAGE = 1000;
/** The most pages one history is read in. */
export const MAX_PAGES = 12;
/** The most companies read from the market at a time. */
export const AT_ONCE = 4;
/** A hold this long or shorter is waited out once per call; a longer one never is. */
export const HOLD_WAIT_MAX_MS = 60_000;
/** The most histories the keep holds. */
export const KEEP_MAX = 160;

/** The market's words for a session-so-far bar while the session is open; after the close it words the same bar
 * otherwise until the daily bar is published. */
export const OPEN_SESSION = "Today so far";
/** The market's own symbol, read first: its latest date says when the kept histories are stale. */
const MARKET_SYMBOL = "SPY";
/** How long one request to the market may take before it counts as unanswered. */
const ASK_TIMEOUT_MS = 30_000;
/** How long a refused source is held, by the market's refusal. */
const HOLD_UNREACHABLE_MS = 20_000;
const HOLD_RATE_LIMITED_MS = 60_000;
const HOLD_GEOBLOCKED_MS = 600_000;

/**
 * An `Ask` onto the market's candles route at `origin`. A redirect is refused, never followed, so no other host is
 * reached. A request that gets no JSON answer within 30 s, or is redirected, is the market being down: status 0 and
 * the refusal `E_MARKET_DOWN`.
 * @param {string} origin
 * @param {typeof fetch} [fetchImpl]
 * @returns {Ask}
 */
export function marketAsk(origin, fetchImpl = (url, init) => globalThis.fetch(url, init)) {
  const base = marketOrigin(origin);
  const down = { status: 0, body: { ok: false, refusal: { code: "E_MARKET_DOWN", message: `the market at ${base} did not answer` } } };
  return async (query) => {
    try {
      const response = await fetchImpl(`${base}/api/candles?${new URLSearchParams(query)}`, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
      });
      return { status: response.status, body: await response.json() };
    } catch {
      return down;
    }
  };
}

/**
 * How long the market holds the source a refusal came from, or null when it does not say.
 * @param {any} refusal
 * @returns {number | null}
 */
function holdOf(refusal) {
  if (refusal?.code === "E_VENUE_UNREACHABLE") return HOLD_UNREACHABLE_MS;
  if (refusal?.native?.status === 429) return HOLD_RATE_LIMITED_MS;
  if (refusal?.code === "E_VENUE_GEOBLOCKED") return HOLD_GEOBLOCKED_MS;
  return null;
}

/**
 * A refusal of `symbol` from one answer that is not an ok page.
 * @param {string} symbol @param {{ status: number, body: any }} answer
 * @returns {Refused}
 */
function refusedBy(symbol, { status, body }) {
  const message = body?.refusal?.message;
  return {
    symbol,
    refused: typeof message === "string" && message !== "" ? message : `the market refused the daily bars of ${symbol}`,
    holdMs: status === 0 ? null : holdOf(body?.refusal),
    down: status === 0,
  };
}

/** @param {{ status: number, body: any }} answer */
const isPage = ({ status, body }) => status !== 0 && body?.ok === true && Array.isArray(body.candles);

/**
 * The whole daily history of `symbol`, oldest first, or the market's refusal.
 * @param {Ask} ask @param {string} symbol @param {() => number} [now]
 * @returns {Promise<History | Refused>}
 */
export async function readHistory(ask, symbol, now = Date.now) {
  const first = await ask({ venue: "cboe", symbol, interval: "1d", range: "MAX", limit: String(DAY_PAGE) });
  if (!isPage(first)) return refusedBy(symbol, first);
  /** @type {Bar[]} */
  let bars = first.body.candles;
  if (bars.length === 0) return { symbol, refused: `the market answered no daily bars of ${symbol}`, holdMs: null, down: false };
  /** @param {any} body */
  const sourceOf = (body) => (typeof body.source === "string" ? body.source : "");
  let source = sourceOf(first.body);
  /** whether a page promised older bars and the next brought none */
  let broken = false;
  let more = first.body.more === true;
  for (let pages = 1; more && pages < MAX_PAGES; pages++) {
    const oldest = bars[0].t;
    const page = await ask({ venue: "cboe", symbol, interval: "1d", before: String(oldest), limit: String(OLDER_PAGE) });
    if (!isPage(page)) return refusedBy(symbol, page);
    const pageSource = sourceOf(page.body);
    if (source.startsWith("Nasdaq") && !pageSource.startsWith("Nasdaq")) source = pageSource;
    /** @type {Bar[]} */
    const older = page.body.candles.filter((/** @type {Bar} */ b) => b.t < oldest);
    if (older.length === 0) { broken = true; break; }
    bars = [...older, ...bars];
    more = page.body.more === true;
  }
  const words = first.body.today?.words;
  const today = typeof words === "string" ? words : null;
  const adjustment = typeof first.body.adjustment === "string" ? first.body.adjustment : null;
  return {
    symbol, bars, source, firstBar: dateOf(bars[0].t), short: broken || !source.startsWith("Nasdaq"),
    today, sessionOpen: today === OPEN_SESSION, adjustment, readAt: now(),
  };
}

/**
 * The in-memory keep of daily histories.
 * @param {{ ask: Ask, now?: () => number, sleep?: (ms: number) => Promise<void>, max?: number }} options
 * @returns {BarsKeep}
 */
export function createBarsKeep({ ask, now = Date.now, sleep = (ms) => new Promise((done) => setTimeout(done, ms)), max = KEEP_MAX }) {
  /** @type {Map<string, History>} kept histories, least recently used first */
  const kept = new Map();
  /** @type {Map<string, Promise<History | Refused>>} */
  const flying = new Map();
  /** @type {string | undefined} the latest date of the market's latest bar the keep has seen */
  let marketDate;
  let running = 0;
  /** @type {Array<() => void>} */
  const waiting = [];

  /** Notes `SPY`'s latest date, then holds `history` unless it was read short.
   * @param {string} symbol @param {History} history */
  function keep(symbol, history) {
    if (symbol === MARKET_SYMBOL) {
      const date = dateOf(history.bars[history.bars.length - 1].t);
      // Only a later date is a new session: an answer without the session-so-far bar ends earlier and drops nothing.
      if (marketDate === undefined || date > marketDate) {
        if (marketDate !== undefined) for (const other of [...kept.keys()]) if (other !== MARKET_SYMBOL) kept.delete(other);
        marketDate = date;
      }
    }
    if (history.short) return;
    kept.delete(symbol);
    kept.set(symbol, history);
    for (const old of [...kept.keys()]) {
      if (kept.size <= max) break;
      if (old !== MARKET_SYMBOL) kept.delete(old);
    }
  }

  /** One read of `symbol` from the market, shared by every caller while it runs, at most four running. */
  function obtain(/** @type {string} */ symbol) {
    const shared = flying.get(symbol);
    if (shared !== undefined) return shared;
    const read = (async () => {
      // A finished read hands its slot straight to the next waiting one, so no new read can take it in between.
      if (running >= AT_ONCE) await new Promise((/** @type {(v?: any) => void} */ go) => waiting.push(go));
      else running++;
      try {
        const got = await readHistory(ask, symbol, now);
        if (!("refused" in got)) keep(symbol, got);
        return got;
      } finally {
        const next = waiting.shift();
        if (next !== undefined) next();
        else running--;
        flying.delete(symbol);
      }
    })();
    flying.set(symbol, read);
    return read;
  }

  return {
    async histories(symbols, { fresh = [], deadlineMs } = {}) {
      const began = now();
      const renew = new Set(fresh);
      const unique = [...new Set(symbols)];
      /** @type {Map<string, History>} */
      const read = new Map();
      /** @type {Map<string, string>} */
      const refused = new Map();
      /** @type {string[]} */
      const timedOut = [];
      let down = false;
      let downWords = "";
      /** @type {Promise<void> | null} the call's one wait for a hold */
      let hold = null;
      let holdOver = false;

      /** Reads from `queue` until it is empty, one company at a time. */
      async function worker(/** @type {string[]} */ queue) {
        for (;;) {
          if (hold !== null && !holdOver) await hold;
          const symbol = queue.shift();
          if (symbol === undefined) return;
          if (down) { refused.set(symbol, downWords); continue; }
          const have = kept.get(symbol);
          if (have !== undefined && !renew.has(symbol)) {
            kept.delete(symbol); kept.set(symbol, have);
            read.set(symbol, have);
            continue;
          }
          if (deadlineMs !== undefined && now() - began >= deadlineMs) { timedOut.push(symbol); continue; }
          const begunBeforeHoldOver = !holdOver;
          const got = await obtain(symbol);
          if (!("refused" in got)) { read.set(symbol, got); continue; }
          if (got.down) {
            if (!down) { down = true; downWords = got.refused; }
            refused.set(symbol, got.refused);
            continue;
          }
          const waitable = got.holdMs !== null && got.holdMs <= HOLD_WAIT_MAX_MS && begunBeforeHoldOver;
          if (!waitable || down) { refused.set(symbol, got.refused); continue; }
          if (hold === null) hold = sleep(got.holdMs ?? 0).then(() => { holdOver = true; });
          await hold;
          if (down) { refused.set(symbol, got.refused); continue; }
          const again = await obtain(symbol);
          if (!("refused" in again)) { read.set(symbol, again); continue; }
          if (again.down && !down) { down = true; downWords = again.refused; }
          refused.set(symbol, again.refused);
        }
      }

      /** Runs `queue` through at most four of this call's workers. */
      async function drain(/** @type {string[]} */ queue) {
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, () => worker(queue)));
      }

      if (unique.includes(MARKET_SYMBOL)) await drain([MARKET_SYMBOL]);
      await drain(unique.filter((s) => s !== MARKET_SYMBOL));
      return { read, refused, timedOut, down };
    },
  };
}
