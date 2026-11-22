/** US OPTIONS, keyless: Nasdaq's `option-chain` read per ticker (shares and ETFs). Nasdaq gives no IV, so none is shown; a leg's `change` is
 * Nasdaq's absolute change in USD. The list (`summaries`) is a fixed set of ten underlyings (US_OPTION_UNDERLYINGS), each the nearest expiry's
 * figures alone (`nearestOnly`): the volume and open interest of its calls and puts summed from Nasdaq's default page (near the money as
 * Nasdaq filters it). Its price and day change are the market's US quote line's (`quote`, injected; when it refuses the row lists without
 * them), never Nasdaq's. The ten are read one at a time, at least SUMMARY_GAP_MS apart, by one queue: a `summaries()` call answers what is
 * kept (flagged partial, "n of 10 read", while the queue is still reading) and starts the queue if it is not running; it never waits for
 * the queue: the ten are always its rows, one not read yet without figures (on a cold start all ten, "0 of 10 read"). Each summary is kept 10
 * min in a US session, until the next US open outside it; one past its keep is still shown, flagged stale, for STALE_KEEP_MS. A chain
 * (`chain`) asks its expiry alone (`fromdate` = `todate` = the expiry, `money=all&type=all`, 60 rows a page, paged with `offset`, at most
 * CHAIN_PAGES pages, said in the chain's note when cut; a cut or a refusal that leaves no row is said as such, never as "no such expiry"); its
 * price is Nasdaq's "LAST TRADE" line, the line's date kept as words. Its expiries are every group the month ranges Nasdaq's `filterlist`
 * names hold: a range of more than one date is scanned near the money (`money=at`, at most SCAN_PAGES pages), each scan kept as a summary
 * is. Every other page is kept 60 s in a US session, until the next US open outside it, one flight per URL; a failure is never kept. Every
 * ask waits its turn in the process's one Nasdaq line (history.ts hostLane, HOST_LIMITS.nasdaq, shared with the US quotes and charts), and
 * goes through `politeHosts`, inside whatever shared guard the core hands in as `http`: a 3xx, 403 or 429 pauses it. */
import { isRefusal, type Refusal } from "../core/errors.ts";
import { no } from "../refuse.ts";
import { cnKeeper, STALE_KEEP_MS } from "./china.ts";
import { realCnHttp, type CnHttp } from "./cn-http.ts";
import { hostLane, type Pace } from "./history.ts";
import { NASDAQ_HOST, PAUSE_MS, politeHosts, retryOnce } from "./local-http.ts";
import { SESSIONS } from "./local-session.ts";
import { rankTtlMs, type LocalStatus } from "./local.ts";
import { atmStrike, defaultExpiry, settleMs, VENUE_NAMES, type OptionChain, type OptionLeg, type OptionSummary } from "./options.ts";

export const US_OPTION_UNDERLYINGS = ["SPY", "QQQ", "IWM", "AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "META", "GOOGL"] as const;
/** Nasdaq's asset class for these is `etf`; every other ticker is asked as `stocks` first, then as `etf` when Nasdaq lists no options */
const ETFS: ReadonlySet<string> = new Set(["SPY", "QQQ", "IWM"]);
export const SUMMARY_GAP_MS = 3_000;
export const SUMMARY_KEEP_MS = 600_000;
export const US_CHAIN_MS = 60_000;
export const PAGE_ROWS = 60;
export const CHAIN_PAGES = 10;
/** the pages of a month's near-the-money scan read for its expiry groups */
export const SCAN_PAGES = 2;
const TIMEOUT_MS = 10_000;
const LIMIT = 2_000_000;
const HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
};
const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const EXPIRY = /^\d{4}-\d{2}-\d{2}$/;
const NAME = VENUE_NAMES.nasdaq;

type AssetClass = "stocks" | "etf";
const BASE = `https://${NASDAQ_HOST}/api/quote`;
export const nasdaqNearestUrl = (t: string, cls: AssetClass): string => `${BASE}/${encodeURIComponent(t)}/option-chain?assetclass=${cls}&limit=${PAGE_ROWS}`;
/** one expiry's every strike (Nasdaq takes fromdate = todate: one date's rows alone) */
export const nasdaqDateUrl = (t: string, cls: AssetClass, date: string, offset: number): string =>
  `${BASE}/${encodeURIComponent(t)}/option-chain?assetclass=${cls}&limit=${PAGE_ROWS}&offset=${offset}&fromdate=${date}&todate=${date}&money=all&type=all`;
/** a month range near the money: a few strikes of each of its expiries, read for the expiry groups */
export const nasdaqScanUrl = (t: string, cls: AssetClass, from: string, to: string, offset: number): string =>
  `${BASE}/${encodeURIComponent(t)}/option-chain?assetclass=${cls}&limit=${PAGE_ROWS}&offset=${offset}&fromdate=${from}&todate=${to}&money=at&type=all`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** a Nasdaq cell as a number: "--", "", "N/A" and anything not a number are null, never 0; thousands commas are dropped */
export function nasdaqNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/,/g, "").replace(/^\$/, "");
  if (s === "" || s === "--" || s.toUpperCase() === "N/A" || !/^[-+]?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** an expiry group ("November 23, 2026") as YYYY-MM-DD; null on anything else */
export function parseExpiryGroup(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]!.toLowerCase());
  const d = Number(m[2]), y = Number(m[3]);
  if (month < 0 || d < 1 || d > new Date(Date.UTC(y, month + 1, 0)).getUTCDate()) return null;
  return `${y}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "LAST TRADE: $342.56 (AS OF NOV 20, 2026)" → its price and its date as Nasdaq words it; null on anything else */
export function parseLastTrade(s: unknown): { price: number; asOf: string } | null {
  if (typeof s !== "string") return null;
  const m = /LAST TRADE:\s*\$?([\d,]+(?:\.\d+)?)\s*\(AS OF\s+([^)]+)\)/i.exec(s);
  if (!m) return null;
  const price = nasdaqNum(m[1]);
  return price === null ? null : { price, asOf: m[2]!.trim() };
}

/** one strike row of a page, under its expiry group; null for the rows a page opens with before its first group (a page that continues
 * the previous page's last group) */
type Row = { expiry: string | null; strike: number; r: Obj };
type Dated = Row & { expiry: string };
/** a page: its rows by expiry, the filterlist's month ranges, the record count, the last trade line; or Nasdaq listing no options */
type Page = { kind: "page"; rows: Row[]; groups: string[]; ranges: Array<[string, string]>; total: number; count: number; lastTrade: string | null; at: number };
type None = { kind: "none"; at: number };
type Read = Page | None;

/** a Nasdaq reply body as a page; "none" for its no-options reply; null for a body that is neither */
function parsePage(body: unknown, at: number): Read | null {
  if (!isObj(body) || !isObj(body.data)) return null;
  const d = body.data;
  const table = isObj(d.table) ? d.table : null;
  const raw = table && Array.isArray(table.rows) ? table.rows : null;
  const total = nasdaqNum(d.totalRecord);
  if (raw === null) return total === 0 || (typeof body.message === "string" && /not available/i.test(body.message)) ? { kind: "none", at } : null;
  const rows: Row[] = [], groups: string[] = [];
  let group: string | null = null;
  for (const r of raw) {
    if (!isObj(r)) continue;
    const g = parseExpiryGroup(r.expirygroup);
    if (g !== null) { group = g; if (!groups.includes(g)) groups.push(g); continue; }
    const strike = nasdaqNum(r.strike);
    if (strike === null || strike <= 0) continue;
    rows.push({ expiry: group, strike, r });
  }
  const ranges: Array<[string, string]> = [];
  const fl = isObj(d.filterlist) && isObj(d.filterlist.fromdate) && Array.isArray(d.filterlist.fromdate.filter) ? d.filterlist.fromdate.filter : [];
  for (const f of fl) {
    const m = isObj(f) && typeof f.value === "string" ? /^(\d{4}-\d{2}-\d{2})\|(\d{4}-\d{2}-\d{2})$/.exec(f.value) : null;
    if (m) ranges.push([m[1]!, m[2]!]);
  }
  if (!rows.length && !groups.length && total === 0) return { kind: "none", at };
  return { kind: "page", rows, groups, ranges, total: total ?? rows.length, count: raw.length, lastTrade: typeof d.lastTrade === "string" ? d.lastTrade : null, at };
}

/** an OCC-style contract symbol: AAPL261202C00270000 */
const occ = (t: string, expiry: string, right: "C" | "P", strike: number): string =>
  `${t.replace(/[.\-]/g, "")}${expiry.slice(2).replace(/-/g, "")}${right}${String(Math.round(strike * 1000)).padStart(8, "0")}`;

function leg(t: string, x: Dated, side: "c" | "p"): OptionLeg {
  const oi = nasdaqNum(x.r[`${side}_Openinterest`]), change = nasdaqNum(x.r[`${side}_Change`]);
  return {
    symbol: occ(t, x.expiry, side === "c" ? "C" : "P", x.strike),
    bid: nasdaqNum(x.r[`${side}_Bid`]), ask: nasdaqNum(x.r[`${side}_Ask`]), last: nasdaqNum(x.r[`${side}_Last`]),
    ...(change !== null ? { change } : {}), volume: nasdaqNum(x.r[`${side}_Volume`]),
    ...(oi !== null ? { openInterest: oi } : {}), unit: "USD",
  };
}

/** a sum that is null when no cell had a number */
function total(xs: Array<number | null>): number | null {
  let s = 0, any = false;
  for (const x of xs) if (x !== null) { s += x; any = true; }
  return any ? Math.round(s * 1e6) / 1e6 : null;
}

export type UsQuote = (ticker: string) => Promise<{ price: number | null; changePct?: number; quoteFrom: string } | null>;
type SummaryCore = Omit<OptionSummary, "price" | "changePct" | "quoteFrom">;

export function usOptions(deps: { http?: CnHttp; clock?: () => number; quote?: UsQuote; pace?: Pace } = {}): {
  summaries(): Promise<{ items: OptionSummary[]; asOf: string; stale?: true; partial?: true; note?: string } | Refusal>;
  chain(ticker: string, expiry?: string): Promise<OptionChain | Refusal>;
  status(): LocalStatus;
} {
  const now = deps.clock ?? Date.now;
  const pace = deps.pace ?? hostLane;
  const http = politeHosts(deps.http ?? realCnHttp, [NASDAQ_HOST], deps.clock ? { clock: deps.clock } : {});
  let status: LocalStatus = { state: "unavailable", said: "US options · not read yet" };
  /** tickers a read found options for, and the asset class Nasdaq answered them under */
  const classOf = new Map<string, AssetClass>();
  /** every expiry group seen per ticker, so the chain's list grows as months are read */
  const seen = new Map<string, Set<string>>();
  /** when Nasdaq was last asked for a nearest page: the summaries' queue and the stocks-then-etf fallback keep SUMMARY_GAP_MS from it */
  let lastAsk = Number.NEGATIVE_INFINITY;
  const sleep = (ms: number): Promise<void> => new Promise((r) => { const h = setTimeout(r, ms); (h as { unref?: () => void }).unref?.(); });

  const unreachable = (): Refusal => no("E_VENUE_UNREACHABLE", { venue: "nasdaq", message: `${NAME} is not answering: its options cannot be read now` });
  const refused = (why: string): Refusal =>
    no("E_VENUE_UNREACHABLE", { venue: "nasdaq", message: `${NAME} refused this place (${why}): its options are not asked for ${PAUSE_MS / 60_000} minutes` });
  const refuses = (): Refusal => no("E_VENUE_UNREACHABLE", { venue: "nasdaq", message: `${NAME} refuses this place (HTTP 451): its options cannot be read from here` });
  const badAction = (message: string): Refusal => no("E_ACCOUNT_BAD_ACTION", { venue: "nasdaq", message });
  const noOptions = (t: string): Refusal => badAction(`${NAME} lists no options for ${t}`);
  const isRead = (r: Read | Refusal): r is Read => !isRefusal(r);

  /** as long as a summary is kept: 10 min in a US session, until the next US open outside it (never less than 10 min) */
  const summaryTtl = (at: number): number => Math.max(rankTtlMs(SESSIONS.us, at, SUMMARY_KEEP_MS), SUMMARY_KEEP_MS);
  /** one page, kept per URL 60 s in a US session, until the next US open outside it (a month's scan as a summary); one flight per URL; a
   * refusal is never kept */
  const keep = cnKeeper<Read>(now, (key, at) => (key.includes("&money=at&") ? summaryTtl(at) : rankTtlMs(SESSIONS.us, at, US_CHAIN_MS)));
  function ask(url: string): Promise<Read | Refusal> {
    return keep.ask(url, async () => {
      try {
        // the process's one Nasdaq line (history.ts hostLane): every GET of the host waits its turn, the quotes' and charts' too
        await pace("nasdaq");
        const r = await retryOnce(() => http(url, { timeoutMs: TIMEOUT_MS, maxBytes: LIMIT, headers: HEADERS }));
        if (r.status === 451) return refuses();
        if (r.status === 403 || r.status === 429 || (r.status >= 300 && r.status < 400)) return refused(`HTTP ${r.status}`);
        if (r.status !== 200) return unreachable();
        let body: unknown;
        try { body = JSON.parse(new TextDecoder("utf-8").decode(r.bytes)); } catch { return unreachable(); }
        return parsePage(body, now()) ?? unreachable();
      } catch (e) {
        return (e as Error)?.message === "paused" ? refused("lately") : unreachable();
      }
    }, isRead);
  }

  const note = (t: string, r: Read | Refusal): void => {
    if (isRefusal(r)) { if (r.code === "E_VENUE_UNREACHABLE") status = { state: "unavailable", said: r.message }; return; }
    status = { state: "live", said: `${NAME} · answering`, at: new Date(r.at).toISOString() };
    if (r.kind === "page") {
      let s = seen.get(t);
      if (!s) { s = new Set(); seen.set(t, s); }
      for (const g of r.groups) s.add(g);
    }
  };

  /** the ticker's nearest page (Nasdaq's default), under the asset class it answers to; "none" when Nasdaq lists no options for it */
  async function nearest(t: string): Promise<{ page: Page; cls: AssetClass } | "none" | Refusal> {
    const classes: AssetClass[] = classOf.has(t) ? [classOf.get(t)!] : ETFS.has(t) ? ["etf"] : ["stocks", "etf"];
    for (const [i, cls] of classes.entries()) {
      // the etf ask after a stocks ask that found no options keeps the queue's spacing
      if (i > 0) { const wait = lastAsk + SUMMARY_GAP_MS - now(); if (wait > 0) await sleep(wait); }
      lastAsk = now();
      const r = await ask(nasdaqNearestUrl(t, cls));
      note(t, r);
      if (isRefusal(r)) return r;
      if (r.kind === "page") { classOf.set(t, cls); return { page: r, cls }; }
    }
    classOf.delete(t);
    return "none";
  }

  // ---- a chain ---------------------------------------------------------------------------------------------------------------------
  async function chain(ticker: string, expiry?: string): Promise<OptionChain | Refusal> {
    const t = String(ticker ?? "").trim().toUpperCase();
    if (!TICKER.test(t)) return badAction("no such ticker");
    if (expiry !== undefined && !EXPIRY.test(expiry)) return badAction("an expiry is a date, YYYY-MM-DD");
    const n = await nearest(t);
    if (n === "none") return noOptions(t);
    if (isRefusal(n)) return n;
    const { page, cls } = n;
    // every month range of more than one date scanned near the money for its expiry groups (note() adds them to `seen`), in Nasdaq's line
    await Promise.all(page.ranges.filter(([a, b]) => a < b).map((range) => scan(t, cls, range)));
    /** the ranges' bounds and the groups seen, each inside one of the nearest page's current ranges and not yet settled (16:00 New York) */
    const listed = (): string[] => {
      const out = new Set<string>(seen.get(t) ?? []);
      for (const [a, b] of page.ranges) { out.add(a); out.add(b); }
      const t0 = now();
      return [...out].filter((e) => page.ranges.some(([a, b]) => a <= e && e <= b) && settleMs(e, "nasdaq") >= t0).sort();
    };
    const chosen = expiry ?? defaultExpiry(listed(), now(), "nasdaq") ?? listed()[0];
    if (chosen === undefined) return noOptions(t);
    if (!page.ranges.some(([a, b]) => a <= chosen && chosen <= b)) return badAction(`${NAME} lists no ${t} expiry on ${chosen}`);

    const rows = new Map<number, Dated>();
    /** the group the previous page ended in; a single date's first page opening without a group is that date's */
    let carried: string | null = chosen;
    let lastTrade = parseLastTrade(page.lastTrade);
    let at = page.at, pages = 0, lastTotal = 0, cut: string | undefined;
    for (let offset = 0; ; offset += PAGE_ROWS) {
      if (pages === CHAIN_PAGES) {
        cut = `${NAME} lists ${lastTotal} rows for ${chosen}: the first ${CHAIN_PAGES * PAGE_ROWS} of ${lastTotal} are read`;
        break;
      }
      const r = await ask(nasdaqDateUrl(t, cls, chosen, offset));
      note(t, r);
      if (isRefusal(r)) {
        if (pages === 0) return r;
        cut = `${NAME} answered ${pages} page${pages > 1 ? "s" : ""} of this expiry and then stopped: the strikes after them are not shown`;
        break;
      }
      pages++;
      // the ticker has options (its nearest page listed them): a date that answers none is no expiry of it
      if (r.kind === "none") break;
      at = Math.min(at, r.at);
      lastTrade = parseLastTrade(r.lastTrade) ?? lastTrade;
      lastTotal = r.total;
      for (const x of r.rows) {
        const e = x.expiry ?? carried;
        if (e === chosen) rows.set(x.strike, { ...x, expiry: e });
      }
      carried = r.groups.at(-1) ?? carried;
      // rows come in expiry order: a later expiry's group means the asked one is done
      if (r.groups.some((g) => g > chosen)) break;
      if (r.count < PAGE_ROWS || offset + PAGE_ROWS >= r.total) break;
    }
    // no row: a cut or a stop is said as itself (the date may well be listed); only a whole answer without it is "no such expiry"
    if (!rows.size) return cut ? no("E_VENUE_UNREACHABLE", { venue: "nasdaq", message: cut }) : badAction(`${NAME} lists no ${t} expiry on ${chosen}`);
    const strikes = [...rows.values()].sort((a, b) => a.strike - b.strike).map((x) => ({ strike: x.strike, call: leg(t, x, "c"), put: leg(t, x, "p") }));
    const price = lastTrade?.price ?? null;
    return {
      underlying: t, venue: "nasdaq", venueName: NAME, price, asOf: new Date(at).toISOString(), quoteFrom: NAME,
      ...(lastTrade ? { lastTrade: lastTrade.asOf } : {}),
      expiries: listed(), expiry: chosen, atmStrike: price === null ? null : atmStrike(strikes.map((s) => s.strike), price), strikes,
      ...(cut ? { note: cut } : {}),
    };
  }

  /** a month range's expiry groups, from at most SCAN_PAGES pages near the money; a refusal leaves the range's bounds alone listed */
  async function scan(t: string, cls: AssetClass, [a, b]: [string, string]): Promise<void> {
    for (let p = 0; p < SCAN_PAGES; p++) {
      const r = await ask(nasdaqScanUrl(t, cls, a, b, p * PAGE_ROWS));
      note(t, r);
      if (isRefusal(r) || r.kind !== "page" || r.count < PAGE_ROWS || (p + 1) * PAGE_ROWS >= r.total) return;
    }
  }

  // ---- the list --------------------------------------------------------------------------------------------------------------------
  type Kept = { at: number; core: SummaryCore | "none" };
  const summariesKept = new Map<string, Kept>();
  const fresh = (k: Kept | undefined, t: number): boolean => !!k && t - k.at < summaryTtl(k.at);
  let lastFailure: Refusal | null = null;
  let running: Promise<void> | null = null;

  async function readOne(t: string): Promise<Refusal | null> {
    const n = await nearest(t);
    if (isRefusal(n)) return n;
    if (n === "none") { summariesKept.set(t, { at: now(), core: "none" }); return null; }
    const groups = n.page.groups;
    const e = defaultExpiry(groups, now(), "nasdaq") ?? groups[0] ?? null;
    const at = n.page.rows.filter((x) => x.expiry === e);
    const pick = (f: string): Array<number | null> => at.map((x) => nasdaqNum(x.r[f]));
    summariesKept.set(t, {
      at: n.page.at,
      core: {
        underlying: t, asset: "stocks", nearestExpiry: e,
        volume: total([...pick("c_Volume"), ...pick("p_Volume")]), openInterest: total([...pick("c_Openinterest"), ...pick("p_Openinterest")]),
        venues: ["nasdaq"], nearestOnly: true,
      },
    });
    return null;
  }

  /** ONE PASS over the tickers past their keep, one ask at a time, SUMMARY_GAP_MS apart; a refusal ends the pass (the rest wait for the next) */
  function start(): void {
    if (running) return;
    running = (async () => {
      for (const t of US_OPTION_UNDERLYINGS) {
        if (fresh(summariesKept.get(t), now())) continue;
        const wait = lastAsk + SUMMARY_GAP_MS - now();
        if (wait > 0) await sleep(wait);
        const r = await readOne(t);
        lastFailure = r;
        if (r) break;
      }
    })().catch(() => { /* every ask answers a refusal instead of throwing */ }).finally(() => { running = null; });
  }

  async function summaries(): Promise<{ items: OptionSummary[]; asOf: string; stale?: true; partial?: true; note?: string } | Refusal> {
    // never waits for the queue: what is kept is answered, and the queue reads the rest in the background
    start();
    const t = now();
    // the ten are always the rows: one not read yet (or past its stale keep) has no figures until the queue reads it
    const shown: Array<{ core: SummaryCore; at: number | null; stale: boolean }> = [];
    let read = 0;
    for (const u of US_OPTION_UNDERLYINGS) {
      const k = summariesKept.get(u);
      const isFresh = !!k && fresh(k, t);
      if (isFresh) read++;
      if (k?.core === "none") continue;
      if (k && isFresh) shown.push({ core: k.core as SummaryCore, at: k.at, stale: false });
      else if (k && t - (k.at + summaryTtl(k.at)) < STALE_KEEP_MS) shown.push({ core: k.core as SummaryCore, at: k.at, stale: true });
      else shown.push({ core: { underlying: u, asset: "stocks", nearestExpiry: null, volume: null, openInterest: null, venues: ["nasdaq"], nearestOnly: true }, at: null, stale: false });
    }
    const readAts = shown.flatMap((s) => (s.at === null ? [] : [s.at]));
    // nothing read to show and the last pass failed: its refusal
    if (!readAts.length && lastFailure) return lastFailure;
    const items = await Promise.all(shown.map(async ({ core }) => {
      let q: Awaited<ReturnType<UsQuote>> = null;
      try { q = deps.quote ? await deps.quote(core.underlying) : null; } catch { q = null; }
      const s: OptionSummary = { ...core, price: q?.price ?? null, quoteFrom: q ? q.quoteFrom : NAME };
      if (q && typeof q.changePct === "number" && Number.isFinite(q.changePct)) s.changePct = q.changePct;
      return s;
    }));
    const asOf = new Date(readAts.length ? Math.min(...readAts) : t).toISOString();
    const stale = shown.some((s) => s.stale);
    const all = US_OPTION_UNDERLYINGS.length;
    return {
      items, asOf, ...(stale ? { stale: true as const } : {}),
      ...(read < all ? { partial: true as const, note: `${read} of ${all} read` } : {}),
    };
  }

  return { summaries, chain, status: () => status };
}
