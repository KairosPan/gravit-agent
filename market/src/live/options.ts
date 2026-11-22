/** OPTION CHAINS: the shared types, the contract-name parsers and the small helpers the crypto (Deribit, OKX) and US (Nasdaq) option sources
 * build on. Nothing here asks a host. Expiry dates are UTC calendar dates; "N hours left" is measured to the expiry's settlement time, which
 * is a venue's own (SETTLE_AT). */
import type { ExploreAt, ExploreItem } from "./explore.ts";

export type OptionVenue = "deribit" | "okx" | "nasdaq";

export interface OptionLeg {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  /** absolute, in the leg's unit */
  change?: number | undefined;
  /** percent */
  changePct?: number | undefined;
  volume: number | null;
  openInterest?: number | undefined;
  /** the source's own figure, in percent; never computed here */
  iv?: number | undefined;
  /** what the prices are in: the coin (BTC), USDC, USD */
  unit: string;
  usd?: { bid: number | null; ask: number | null; last: number | null } | undefined;
}

export interface OptionChain {
  underlying: string;
  venue: OptionVenue;
  venueName: string;
  price: number | null;
  asOf: string;
  quoteFrom: string;
  lastTrade?: string | undefined;
  expiries: string[];
  expiry: string;
  atmStrike: number | null;
  strikes: Array<{ strike: number; call?: OptionLeg | undefined; put?: OptionLeg | undefined }>;
  /** a partial read said in words (Nasdaq's paging stopped short) */
  note?: string | undefined;
}

export interface OptionSummary {
  underlying: string;
  asset: "crypto" | "stocks";
  price: number | null;
  changePct?: number | undefined;
  nearestExpiry: string | null;
  volume: number | null;
  volumeUsd?: number | undefined;
  openInterest: number | null;
  atmIv?: number | undefined;
  venues: OptionVenue[];
  quoteFrom: string;
  nearestOnly?: true | undefined;
}

export interface OptionName {
  underlying: string;
  /** YYYY-MM-DD, a UTC calendar date */
  expiry: string;
  strike: number;
  right: "C" | "P";
  /** what the prices are in: the coin (inverse), or the quote currency of a linear contract */
  settle: "coin" | "USDC" | "USDT";
}

export const VENUE_NAMES: Record<OptionVenue, string> = { deribit: "Deribit", okx: "OKX", nasdaq: "Nasdaq" };

/** when an expiry settles, on its date, in a zone: the one table */
export const SETTLE_AT: Record<OptionVenue, { hhmm: string; zone: string }> = {
  deribit: { hhmm: "08:00", zone: "UTC" },
  okx: { hhmm: "08:00", zone: "UTC" },
  nasdaq: { hhmm: "16:00", zone: "America/New_York" },
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const DERIBIT = /^([A-Z0-9]+?)(?:_(USDC|USDT))?-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:d\d+)?)-([CP])$/;
/** `BTC-26MAR27-40000-C`, `SOL_USDC-27NOV26-154-P`, `XRP_USDC-27NOV26-2d2-C` (`d` for a decimal point); null on anything else (a perpetual,
 * a future, a combo) */
export function parseDeribitName(name: string): OptionName | null {
  const m = DERIBIT.exec(name);
  if (!m) return null;
  const month = MONTHS.indexOf(m[4]!);
  if (month < 0) return null;
  const expiry = isoDate(2000 + Number(m[5]), month + 1, Number(m[3]));
  const strike = Number(m[6]!.replace("d", "."));
  if (expiry === null || !Number.isFinite(strike) || strike <= 0) return null;
  return { underlying: m[1]!, expiry, strike, right: m[7] as "C" | "P", settle: m[2] === undefined ? "coin" : (m[2] as "USDC" | "USDT") };
}

const OKX = /^([A-Z0-9]+)-(USD|USDT|USDC)-(\d{2})(\d{2})(\d{2})-(\d+(?:\.\d+)?)-([CP])$/;
/** `BTC-USD-261218-44000-C`; null on anything else */
export function parseOkxName(name: string): OptionName | null {
  const m = OKX.exec(name);
  if (!m) return null;
  const expiry = isoDate(2000 + Number(m[3]), Number(m[4]), Number(m[5]));
  const strike = Number(m[6]);
  if (expiry === null || !Number.isFinite(strike) || strike <= 0) return null;
  return { underlying: m[1]!, expiry, strike, right: m[7] as "C" | "P", settle: m[2] === "USD" ? "coin" : (m[2] as "USDC" | "USDT") };
}

/** the instant (ms) a zone's wall clock reads `date` `hhmm` */
function zonedMs(date: string, hhmm: string, zone: string): number {
  const guess = Date.parse(`${date}T${hhmm}:00Z`);
  if (zone === "UTC") return guess;
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(guess)) p[x.type] = x.value;
  const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return guess - (shown - guess);
}

/** when an expiry (`YYYY-MM-DD`) settles at a venue, in ms */
export function settleMs(expiry: string, venue: OptionVenue): number {
  const s = SETTLE_AT[venue];
  return zonedMs(expiry, s.hhmm, s.zone);
}

const DAY_MS = 86_400_000;
/** the nearest expiry with at least 24 hours left to its settlement (a crypto venue's by default); null when none */
export function defaultExpiry(expiries: string[], nowMs: number, venue: OptionVenue = "deribit"): string | null {
  let best: string | null = null;
  for (const e of [...expiries].sort()) {
    if (settleMs(e, venue) - nowMs >= DAY_MS) { best = e; break; }
  }
  return best;
}

/** the strike nearest `price`; a tie goes to the lower */
export function atmStrike(strikes: number[], price: number): number | null {
  if (!Number.isFinite(price)) return null;
  let best: number | null = null;
  for (const k of strikes) {
    if (!Number.isFinite(k)) continue;
    if (best === null) { best = k; continue; }
    const d = Math.abs(k - price), bd = Math.abs(best - price);
    if (d < bd || (d === bd && k < best)) best = k;
  }
  return best;
}

/** the list's row for one underlying: view-only, an `at` per venue, its figures in `option` (never `volumeUsd24h`: option rows stay out of
 * the dollar-volume cut) */
export function optionRow(s: OptionSummary): ExploreItem {
  const at: ExploreAt[] = s.venues.map((v) => ({
    venue: v, venueName: VENUE_NAMES[v], symbol: s.underlying, connected: false, canTrade: false, public: true,
    ...(s.price !== null ? { price: s.price } : {}), quoteFrom: s.quoteFrom,
  }));
  return {
    key: `opt:${s.underlying}`, kind: "optionChain", name: `${s.underlying} options`, base: s.underlying,
    category: s.asset, asset: s.asset, form: "option", ...(s.asset === "stocks" ? { region: "us" as const } : {}),
    ...(s.price !== null ? { price: s.price } : {}),
    ...(s.changePct !== undefined ? { changePct24h: s.changePct } : {}),
    quoteFrom: s.quoteFrom, tabs: [], at,
    option: {
      nearestExpiry: s.nearestExpiry, volume: s.volume, openInterest: s.openInterest,
      ...(s.volumeUsd !== undefined ? { volumeUsd: s.volumeUsd } : {}),
      ...(s.atmIv !== undefined ? { atmIv: s.atmIv } : {}),
      ...(s.nearestOnly ? { nearestOnly: true as const } : {}),
    },
  };
}
