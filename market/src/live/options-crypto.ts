/** CRYPTO OPTIONS, keyless: Deribit's book summaries (inverse BTC and ETH options priced in the coin; linear USDC options for AVAX, BTC, ETH,
 * HYPE, SOL, TRX, XRP priced in USDC) and OKX's coin-margined option families (`<C>-USD`, priced in the coin). The list (`summaries`) reads
 * Deribit's three books and, only for an underlying Deribit does not list, OKX's tickers and index; it never reads OKX's whole chain for an
 * underlying Deribit lists. A row's figures are Deribit's alone where Deribit lists the underlying (spec §5.1: its contracts are one coin,
 * OKX's a fraction, so counts never add across venues); an OKX-only row shows OKX's volume and no OI or IV. A chain (`chain`) is one venue's:
 * Deribit's legs in the coin (or USDC) with `usd` at the row's own `underlying_price`; OKX's in the coin with `usd` at OKX's index, IV from
 * `opt-summary` (`markVol` x 100) and open interest from `open-interest` (`oiCcy`, in the coin as Deribit's is). Every ask is kept 30 s (OKX's
 * family list a day), one flight per URL; a failure is never kept. A list read some Deribit book failed lists what answered, flagged
 * partial; one every book failed answers the last good list up to 10 min, flagged stale. OKX's non-crypto families (XAU…) are dropped. Each host is asked through `politeHosts`, inside whatever shared guard the core hands in as `http`: a 3xx, 403 or 429 pauses it. */
import { isRefusal, type Refusal } from "../core/errors.ts";
import { no } from "../refuse.ts";
import { cnKeeper, STALE_KEEP_MS } from "./china.ts";
import { realCnHttp, type CnHttp } from "./cn-http.ts";
import { DERIBIT_HOST, OKX_HOST, PAUSE_MS, politeHosts, retryOnce } from "./local-http.ts";
import type { LocalStatus } from "./local.ts";
import {
  atmStrike, defaultExpiry, parseDeribitName, parseOkxName, VENUE_NAMES, type OptionChain, type OptionLeg, type OptionName, type OptionSummary,
} from "./options.ts";

export type CryptoVenue = "deribit" | "okx";
export const CRYPTO_CHAIN_MS = 30_000;
export const OKX_FAMILIES_MS = 86_400_000;
/** the list's busiest underlyings */
export const SUMMARY_CAP = 6;
const TIMEOUT_MS = 10_000;
/** Deribit's USDC book is about 2 MB (3,300 options) */
const DERIBIT_LIMIT = 8_000_000;
const OKX_LIMIT = 4_000_000;
const HEADERS = { accept: "application/json" };
/** Deribit's inverse books; every other underlying is in its USDC book */
const INVERSE = ["BTC", "ETH"] as const;
const BOOKS = [...INVERSE, "USDC"] as const;
/** OKX's option families that are not crypto (gold, silver, the other metals, fiat): never listed, never asked here */
export const OKX_NOT_CRYPTO: ReadonlySet<string> = new Set(["XAU", "XAG", "XPT", "XPD", "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "CNH", "CNY", "HKD", "SGD", "NZD", "KRW", "TWD"]);

export const deribitBookUrl = (currency: string): string =>
  `https://${DERIBIT_HOST}/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`;
const OKX_API = `https://${OKX_HOST}/api/v5`;
export const OKX_FAMILIES_URL = `${OKX_API}/public/underlying?instType=OPTION`;
export const okxTickersUrl = (family: string): string => `${OKX_API}/market/tickers?instType=OPTION&instFamily=${family}`;
export const okxSummaryUrl = (family: string): string => `${OKX_API}/public/opt-summary?instFamily=${family}`;
export const okxOpenInterestUrl = (family: string): string => `${OKX_API}/public/open-interest?instType=OPTION&instFamily=${family}`;
export const okxIndexUrl = (family: string): string => `${OKX_API}/market/index-tickers?instId=${family}`;

type Rows = { rows: unknown[]; at: number };
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
/** a finite number from a number or a numeric string; null for "", null, anything else */
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round8 = (v: number): number => Math.round(v * 1e8) / 1e8;
const UNDERLYING = /^[A-Z0-9]{1,15}$/;
const EXPIRY = /^\d{4}-\d{2}-\d{2}$/;

/** Deribit's `result` rows (each with an `instrument_name`), OKX's `data` rows (code "0"); null for a body that is neither */
function deribitRows(body: unknown): unknown[] | null {
  if (!isObj(body) || !Array.isArray(body.result)) return null;
  return body.result.every((r) => isObj(r) && typeof r.instrument_name === "string") ? body.result : null;
}
function okxRows(body: unknown): unknown[] | null {
  if (!isObj(body) || body.code !== "0" || !Array.isArray(body.data)) return null;
  return body.data;
}

export function cryptoOptions(deps: { http?: CnHttp; clock?: () => number } = {}): {
  summaries(): Promise<{ items: OptionSummary[]; asOf: string; stale?: true; partial?: true; note?: string } | Refusal>;
  chain(underlying: string, venue: CryptoVenue, expiry?: string): Promise<OptionChain | Refusal>;
  status(): LocalStatus;
} {
  const now = deps.clock ?? Date.now;
  const raw = deps.http ?? realCnHttp;
  const clock = deps.clock ? { clock: deps.clock } : {};
  const hosts: Record<CryptoVenue, CnHttp> = { deribit: politeHosts(raw, [DERIBIT_HOST], clock), okx: politeHosts(raw, [OKX_HOST], clock) };
  let status: LocalStatus = { state: "unavailable", said: "Crypto options · not read yet" };

  const name = (v: CryptoVenue): string => VENUE_NAMES[v];
  const unreachable = (v: CryptoVenue): Refusal => no("E_VENUE_UNREACHABLE", { venue: v, message: `${name(v)} is not answering: its options cannot be read now` });
  const refused = (v: CryptoVenue, why: string): Refusal =>
    no("E_VENUE_UNREACHABLE", { venue: v, message: `${name(v)} refused this place (${why}): its options are not asked for ${PAUSE_MS / 60_000} minutes` });
  /** a 451 pauses nothing (politeHosts pauses on a 3xx, 403 or 429): the venue refuses this place, and that is all that is said */
  const refuses = (v: CryptoVenue): Refusal => no("E_VENUE_UNREACHABLE", { venue: v, message: `${name(v)} refuses this place (HTTP 451): its options cannot be read from here` });
  const badAction = (v: CryptoVenue, message: string): Refusal => no("E_ACCOUNT_BAD_ACTION", { venue: v, message });
  const isRows = (r: Rows | Refusal): r is Rows => !isRefusal(r);

  /** one ask, kept per URL (30 s; OKX's family list a day), one flight per URL; a refusal is never kept */
  const keep = cnKeeper<Rows>(now, (key) => (key === OKX_FAMILIES_URL ? OKX_FAMILIES_MS : CRYPTO_CHAIN_MS));
  function ask(v: CryptoVenue, url: string): Promise<Rows | Refusal> {
    return keep.ask(url, async () => {
      try {
        const r = await retryOnce(() => hosts[v](url, { timeoutMs: TIMEOUT_MS, maxBytes: v === "deribit" ? DERIBIT_LIMIT : OKX_LIMIT, headers: HEADERS }));
        if (r.status === 451) return refuses(v);
        if (r.status === 403 || r.status === 429 || (r.status >= 300 && r.status < 400)) return refused(v, `HTTP ${r.status}`);
        if (r.status !== 200) return unreachable(v);
        let body: unknown;
        try { body = JSON.parse(new TextDecoder("utf-8").decode(r.bytes)); } catch { return unreachable(v); }
        const rows = v === "deribit" ? deribitRows(body) : okxRows(body);
        return rows ? { rows, at: now() } : unreachable(v);
      } catch (e) {
        return (e as Error)?.message === "paused" ? refused(v, "lately") : unreachable(v);
      }
    }, isRows);
  }

  /** OKX's coin-margined crypto option families as coins (`BTC-USD` → BTC; `XAU-USD` and the other OKX_NOT_CRYPTO dropped), or null when the
   * list cannot be read (then nothing is assumed) */
  async function okxCoins(): Promise<Set<string> | null> {
    const r = await ask("okx", OKX_FAMILIES_URL);
    if (isRefusal(r)) return null;
    const out = new Set<string>();
    for (const f of r.rows.flat()) { const m = typeof f === "string" ? /^([A-Z0-9]+)-USD$/.exec(f) : null; if (m && !OKX_NOT_CRYPTO.has(m[1]!)) out.add(m[1]!); }
    return out;
  }

  // ---- Deribit ---------------------------------------------------------------------------------------------------------------------
  type DRow = { n: OptionName; r: Obj };
  /** a book's rows by underlying: the inverse books' coin options, the USDC book's linear USDC options */
  function deribitByUnderlying(book: Rows, settle: OptionName["settle"]): Map<string, DRow[]> {
    const out = new Map<string, DRow[]>();
    for (const r of book.rows as Obj[]) {
      const n = parseDeribitName(r.instrument_name as string);
      if (!n || n.settle !== settle) continue;
      const list = out.get(n.underlying);
      if (list) list.push({ n, r }); else out.set(n.underlying, [{ n, r }]);
    }
    return out;
  }
  const expiriesOf = (rows: Array<{ n: OptionName }>): string[] => [...new Set(rows.map((x) => x.n.expiry))].sort();

  /** Deribit's figures for one underlying (spec §5.1) */
  function deribitSummary(u: string, rows: DRow[], okx: Set<string> | null): OptionSummary {
    let volume = 0, volumeUsd = 0, oi = 0;
    for (const { r } of rows) { volume += num(r.volume) ?? 0; volumeUsd += num(r.volume_usd) ?? 0; oi += num(r.open_interest) ?? 0; }
    const expiries = expiriesOf(rows);
    const nearest = defaultExpiry(expiries, now(), "deribit");
    let atmIv: number | undefined;
    if (nearest !== null) {
      const at = rows.filter((x) => x.n.expiry === nearest);
      const under = at.map((x) => num(x.r.underlying_price)).find((p) => p !== null) ?? null;
      const k = under === null ? null : atmStrike(at.map((x) => x.n.strike), under);
      const atK = at.filter((x) => x.n.strike === k);
      /** the call's mark IV, the put's when the call has none */
      const iv = [...atK.filter((x) => x.n.right === "C"), ...atK.filter((x) => x.n.right === "P")].map((x) => num(x.r.mark_iv)).find((v) => v !== null);
      if (iv !== undefined && iv !== null) atmIv = iv;
    }
    const price = rows.map((x) => num(x.r.estimated_delivery_price)).find((p) => p !== null) ?? null;
    return {
      underlying: u, asset: "crypto", price, nearestExpiry: nearest ?? expiries[0] ?? null,
      volume: round8(volume), volumeUsd: round8(volumeUsd), openInterest: round8(oi), ...(atmIv !== undefined ? { atmIv } : {}),
      venues: okx?.has(u) ? ["deribit", "okx"] : ["deribit"], quoteFrom: name("deribit"),
    };
  }

  function deribitLeg(x: DRow): OptionLeg {
    const r = x.r;
    const bid = num(r.bid_price), ask_ = num(r.ask_price), last = num(r.last);
    const linear = x.n.settle !== "coin";
    const under = num(r.underlying_price);
    const times = (p: number | null): number | null => (p === null || under === null ? null : p * under);
    const changePct = num(r.price_change), oi = num(r.open_interest), iv = num(r.mark_iv);
    return {
      symbol: r.instrument_name as string, bid, ask: ask_, last,
      ...(changePct !== null ? { changePct } : {}),
      volume: num(r.volume), ...(oi !== null ? { openInterest: oi } : {}), ...(iv !== null ? { iv } : {}),
      unit: linear ? x.n.settle : (typeof r.base_currency === "string" ? r.base_currency : x.n.underlying),
      ...(linear ? { usd: { bid, ask: ask_, last } } : under !== null ? { usd: { bid: times(bid), ask: times(ask_), last: times(last) } } : {}),
    };
  }

  async function deribitChain(u: string, expiry: string | undefined): Promise<OptionChain | Refusal> {
    const inverse = (INVERSE as readonly string[]).includes(u);
    const book = await ask("deribit", deribitBookUrl(inverse ? u : "USDC"));
    if (isRefusal(book)) return book;
    const rows = deribitByUnderlying(book, inverse ? "coin" : "USDC").get(u) ?? [];
    if (!rows.length) return badAction("deribit", `Deribit lists no options on ${u}`);
    const expiries = expiriesOf(rows);
    const chosen = expiry ?? defaultExpiry(expiries, now(), "deribit") ?? expiries[0]!;
    if (!expiries.includes(chosen)) return badAction("deribit", `Deribit lists no ${u} expiry on ${chosen}`);
    const at = rows.filter((x) => x.n.expiry === chosen);
    const under = at.map((x) => num(x.r.underlying_price)).find((p) => p !== null) ?? null;
    const price = rows.map((x) => num(x.r.estimated_delivery_price)).find((p) => p !== null) ?? null;
    return assemble(u, "deribit", price, book.at, expiries, chosen, under, at.map((x) => ({ n: x.n, leg: deribitLeg(x) })));
  }

  // ---- OKX -------------------------------------------------------------------------------------------------------------------------
  type ORow = { n: OptionName; r: Obj };
  function okxParsed(t: Rows): ORow[] {
    const out: ORow[] = [];
    for (const r of t.rows) {
      if (!isObj(r) || typeof r.instId !== "string") continue;
      const n = parseOkxName(r.instId);
      if (n && n.settle === "coin") out.push({ n, r });
    }
    return out;
  }
  const idxOf = (r: Rows | Refusal): number | null => (isRefusal(r) ? null : r.rows.filter(isObj).map((x) => num(x.idxPx)).find((p) => p !== null) ?? null);
  const byInst = (r: Rows | Refusal): Map<string, Obj> => {
    const out = new Map<string, Obj>();
    if (!isRefusal(r)) for (const x of r.rows) if (isObj(x) && typeof x.instId === "string") out.set(x.instId, x);
    return out;
  };

  async function okxChain(u: string, expiry: string | undefined): Promise<OptionChain | Refusal> {
    if (OKX_NOT_CRYPTO.has(u)) return badAction("okx", `OKX's ${u} options are not crypto: they are not read here`);
    const coins = await okxCoins();
    if (coins && !coins.has(u)) return badAction("okx", `OKX lists no options on ${u}`);
    const family = `${u}-USD`;
    const [t, s, o, ix] = await Promise.all([
      ask("okx", okxTickersUrl(family)), ask("okx", okxSummaryUrl(family)), ask("okx", okxOpenInterestUrl(family)), ask("okx", okxIndexUrl(family)),
    ]);
    if (isRefusal(t)) return t;
    const rows = okxParsed(t);
    if (!rows.length) return badAction("okx", `OKX lists no options on ${u}`);
    const expiries = expiriesOf(rows);
    const chosen = expiry ?? defaultExpiry(expiries, now(), "okx") ?? expiries[0]!;
    if (!expiries.includes(chosen)) return badAction("okx", `OKX lists no ${u} expiry on ${chosen}`);
    const idx = idxOf(ix);
    const summary = byInst(s), interest = byInst(o);
    const at = rows.filter((x) => x.n.expiry === chosen);
    /** the expiry's own forward (opt-summary's `fwdPx`) for its at-the-money strike; OKX's index when it has none */
    const fwd = at.map((x) => num(summary.get(x.r.instId as string)?.fwdPx)).find((p) => p !== null) ?? idx;
    const times = (p: number | null): number | null => (p === null || idx === null ? null : p * idx);
    const legs = at.map(({ n, r }) => {
      const id = r.instId as string;
      const bid = num(r.bidPx), ask_ = num(r.askPx), last = num(r.last);
      const mv = num(summary.get(id)?.markVol), oi = num(interest.get(id)?.oiCcy);
      const leg: OptionLeg = {
        symbol: id, bid, ask: ask_, last, volume: num(r.volCcy24h),
        ...(oi !== null ? { openInterest: oi } : {}), ...(mv !== null ? { iv: mv * 100 } : {}),
        unit: u, ...(idx !== null ? { usd: { bid: times(bid), ask: times(ask_), last: times(last) } } : {}),
      };
      return { n, leg };
    });
    return assemble(u, "okx", idx, t.at, expiries, chosen, fwd, legs);
  }

  /** an OKX-only underlying's row: OKX's volume (in the coin, and in USD at its index), no OI or IV; null when its tickers do not answer */
  async function okxSummary(u: string): Promise<OptionSummary | null> {
    const family = `${u}-USD`;
    const [t, ix] = await Promise.all([ask("okx", okxTickersUrl(family)), ask("okx", okxIndexUrl(family))]);
    if (isRefusal(t)) return null;
    const rows = okxParsed(t);
    if (!rows.length) return null;
    let volume = 0;
    for (const { r } of rows) volume += num(r.volCcy24h) ?? 0;
    const idx = idxOf(ix);
    const expiries = expiriesOf(rows);
    return {
      underlying: u, asset: "crypto", price: idx, nearestExpiry: defaultExpiry(expiries, now(), "okx") ?? expiries[0] ?? null,
      volume: round8(volume), ...(idx !== null ? { volumeUsd: round8(volume * idx) } : {}), openInterest: null,
      venues: ["okx"], quoteFrom: name("okx"),
    };
  }

  // ---- shared ----------------------------------------------------------------------------------------------------------------------
  function assemble(
    u: string, venue: CryptoVenue, price: number | null, at: number, expiries: string[], expiry: string, under: number | null,
    legs: Array<{ n: OptionName; leg: OptionLeg }>,
  ): OptionChain {
    const byStrike = new Map<number, { strike: number; call?: OptionLeg; put?: OptionLeg }>();
    for (const { n, leg } of legs) {
      const row = byStrike.get(n.strike) ?? { strike: n.strike };
      if (n.right === "C") row.call = leg; else row.put = leg;
      byStrike.set(n.strike, row);
    }
    const strikes = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
    const asOf = new Date(at).toISOString();
    status = { state: "live", said: `${name(venue)} · answering`, at: asOf };
    return {
      underlying: u, venue, venueName: name(venue), price, asOf, quoteFrom: name(venue), expiries, expiry,
      atmStrike: under === null ? null : atmStrike(strikes.map((s) => s.strike), under), strikes,
    };
  }

  async function chain(underlying: string, venue: CryptoVenue, expiry?: string): Promise<OptionChain | Refusal> {
    if (venue !== "deribit" && venue !== "okx") return no("E_ACCOUNT_BAD_ACTION", { venue: "options", message: "crypto options are read from Deribit or OKX" });
    const u = String(underlying ?? "").trim().toUpperCase();
    if (!UNDERLYING.test(u)) return badAction(venue, "no such underlying");
    if (expiry !== undefined && !EXPIRY.test(expiry)) return badAction(venue, "an expiry is a date, YYYY-MM-DD");
    const r = venue === "deribit" ? await deribitChain(u, expiry) : await okxChain(u, expiry);
    if (isRefusal(r) && r.code === "E_VENUE_UNREACHABLE") status = { state: "unavailable", said: r.message };
    return r;
  }

  // ---- the list --------------------------------------------------------------------------------------------------------------------
  /** `partial`: a Deribit book did not answer, and `note` names it; what answered is listed */
  type ListAnswer = { items: OptionSummary[]; asOf: string; partial?: true; note?: string };
  type ListReply = ListAnswer & { stale?: true };
  let kept: { at: number; answer: ListAnswer } | null = null;
  let lastGood: { at: number; answer: ListAnswer } | null = null;
  let flight: Promise<ListReply | Refusal> | null = null;

  async function readList(): Promise<ListAnswer | Refusal> {
    const [books, coins] = await Promise.all([Promise.all(BOOKS.map((c) => ask("deribit", deribitBookUrl(c)))), okxCoins()]);
    const answeredBooks = books.filter(isRows);
    if (!answeredBooks.length) return books.find(isRefusal)!;
    const missing = BOOKS.filter((_, i) => isRefusal(books[i]!));
    const [btc, eth, usdc] = books;
    const byU = new Map<string, DRow[]>();
    for (const b of [btc, eth]) if (b && isRows(b)) for (const [u, rows] of deribitByUnderlying(b, "coin")) byU.set(u, rows);
    // BTC and ETH: the inverse book's figures; when an inverse book did not answer, its underlying is left out, never filled from USDC
    if (usdc && isRows(usdc)) for (const [u, rows] of deribitByUnderlying(usdc, "USDC")) if (!byU.has(u) && !(missing as string[]).includes(u)) byU.set(u, rows);
    const items = [...byU].map(([u, rows]) => deribitSummary(u, rows, coins));
    /** an OKX-only underlying is one no Deribit book lists; while a book is missing, only the inverse coins' families are known to be Deribit's */
    const okxOnly = missing.length ? [] : [...(coins ?? [])].filter((c) => !byU.has(c));
    for (const s of await Promise.all(okxOnly.map(okxSummary))) if (s) items.push(s);
    items.sort((a, b) => (b.volumeUsd ?? -1) - (a.volumeUsd ?? -1));
    const at = Math.min(...answeredBooks.map((b) => b.at));
    const base = { items: items.slice(0, SUMMARY_CAP), asOf: new Date(at).toISOString() };
    return missing.length ? { ...base, partial: true, note: `Deribit's ${missing.join(", ")} book${missing.length > 1 ? "s" : ""} did not answer: ${missing.length > 1 ? "their" : "its"} underlyings are not listed` } : base;
  }

  async function summaries(): Promise<ListReply | Refusal> {
    if (kept && now() - kept.at < CRYPTO_CHAIN_MS) return kept.answer;
    if (flight) return flight;
    flight = readList().then((r) => {
      const t = now();
      if (!isRefusal(r)) {
        // a partial list is answered and is the last good one, but not kept: the next read asks the missing book again
        lastGood = { at: t, answer: r };
        if (!r.partial) kept = lastGood;
        status = r.partial ? { state: "live", said: `Crypto options · ${r.note}`, at: r.asOf } : { state: "live", said: "Crypto options · answering", at: r.asOf };
        return r;
      }
      if (lastGood && t - lastGood.at < STALE_KEEP_MS) {
        status = { state: "stale", said: `${r.message} · the last list shown`, at: lastGood.answer.asOf };
        return { ...lastGood.answer, stale: true as const };
      }
      status = { state: "unavailable", said: r.message };
      return r;
    }).finally(() => { flight = null; });
    return flight;
  }

  return { summaries, chain, status: () => status };
}
