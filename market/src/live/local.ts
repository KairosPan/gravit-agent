/** The local regions' shared shapes (Hong Kong, Korea, Taiwan, the world indices): the rows a ranking draws, the read that says how it was made,
 * the quote facts and the history a page draws, and the source each region implements. They follow china.ts's: the same status, the same keeps
 * (`cnKeeper`), the same stale rule. Every row is view-only: `canTrade` false, nothing to connect, priced in its own currency. */
import type { Refusal } from "../core/errors.ts";
import type { CnBar, CnMinutes, ChinaRange } from "./cn-history.ts";
import type { CnPhase, CnSession } from "./cn-session.ts";
import { localSession, type SessionHours } from "./local-session.ts";
import { STALE_KEEP_MS, type ChinaStatus } from "./china.ts";
import type { RegionId } from "./categories.ts";
import type { ExploreItem } from "./explore.ts";
import type { CandleRange, Market } from "./trade.ts";

export type LocalVenue = "hk" | "kr" | "tw" | "ix";
export type LocalStatus = ChinaStatus;
export type LocalSort = "volume" | "movers";

export interface LocalRead {
  venue: LocalVenue | "china";
  region: RegionId;
  sort: LocalSort;
  total: number;
  asOf: string;
  session: CnSession;
  status: LocalStatus;
  note: string;
}

export interface LocalFacts {
  prevClose: number | null; open: number | null; high: number | null; low: number | null; volume: number | null; turnover: number | null;
  lastSession: string | null; phase: CnPhase; quoteStatus: "live" | "delayed" | "unsaid";
}
export type LocalMarket = Market & { currency?: "HKD" | "KRW" | "TWD"; local: LocalFacts };

export type LocalHistory =
  | { venue: LocalVenue; venueName: string; symbol: string; range: "1D" | "5D"; sessions: CnMinutes[]; source: string; adjustment?: string }
  | { venue: LocalVenue; venueName: string; symbol: string; range: Exclude<ChinaRange, "1D" | "5D">; candles: CnBar[]; source: string; adjustment?: string };

export interface LocalSource {
  venue: LocalVenue;
  name: string;
  rank(sort: LocalSort): Promise<{ items: ExploreItem[]; read: LocalRead } | Refusal>;
  search(q: string): Promise<ExploreItem[] | Refusal>;
  quotes(symbols: readonly string[]): Promise<Map<string, LocalMarket> | Refusal>;
  history(symbol: string, range: CandleRange): Promise<LocalHistory | Refusal>;
  status(): LocalStatus;
}

/** a source's words for a quote: its name alone where it declares no delay, "real time" where it declares zero, its own figure otherwise */
export function quoteWord(name: string, delayMin: number | null | undefined): string {
  if (delayMin === null || delayMin === undefined) return name;
  return delayMin === 0 ? `${name} · real time` : `${name} · ${delayMin} min delayed`;
}

/** one share as a row: view-only, in its own currency, in its region's tab alone */
export function shareRow(o: {
  venue: "hk" | "kr" | "tw"; venueName: string; code: string; name: string; nameLocal?: string;
  currency: "HKD" | "KRW" | "TWD"; price: number | null; changePct: number | null; turnover: number | null; quoteFrom: string;
}): ExploreItem {
  return {
    key: `${o.venue}:${o.code}`, kind: "share", name: o.name, base: o.code, currency: o.currency, asset: "stocks", form: "spot", region: o.venue,
    ...(o.nameLocal !== undefined ? { nameLocal: o.nameLocal } : {}),
    ...(o.price !== null ? { price: o.price } : {}),
    ...(o.changePct !== null ? { changePct24h: o.changePct } : {}),
    ...(o.turnover !== null ? { turnoverLocal: o.turnover } : {}),
    quoteFrom: o.quoteFrom, tabs: [],
    at: [{ venue: o.venue, venueName: o.venueName, symbol: o.code, connected: false, canTrade: false, public: true,
      ...(o.price !== null ? { price: o.price } : {}), quoteFrom: o.quoteFrom }],
  };
}

/** one cash index as a row: a level, no currency, view-only */
export function indexRow(o: {
  region: RegionId; id: string; name: string; level: number | null; change: number | null; changePct: number | null; quoteFrom: string; quoteAt?: string;
}): ExploreItem {
  return {
    key: `ix:${o.region}:${o.id}`, kind: "index", name: o.name, base: o.id, asset: "indices", form: "spot", region: o.region,
    ...(o.level !== null ? { price: o.level } : {}),
    ...(o.change !== null ? { change24h: o.change } : {}),
    ...(o.changePct !== null ? { changePct24h: o.changePct } : {}),
    ...(o.quoteAt !== undefined ? { quoteAt: o.quoteAt } : {}),
    quoteFrom: o.quoteFrom, tabs: [],
    at: [{ venue: "ix", venueName: "Indices", symbol: o.id, connected: false, canTrade: false, public: true,
      ...(o.level !== null ? { price: o.level } : {}), ...(o.quoteAt !== undefined ? { quoteAt: o.quoteAt } : {}), quoteFrom: o.quoteFrom }],
  };
}

/** a failed ranking answered from the last good one: within STALE_KEEP_MS of it, flagged stale with `said`; else null */
export function staleRank<T extends { read: LocalRead }>(last: { at: number; answer: T } | undefined, now: number, said: string): T | null {
  if (!last || now - last.at >= STALE_KEEP_MS) return null;
  return { ...last.answer, read: { ...last.answer.read, status: { state: "stale", said, at: last.answer.read.asOf } } };
}

const QUARTER_MS = 900_000;
/** How long a ranking read at `nowMs` is kept: `inSessionMs` while the market is trading or at midday, else until its next session's first window
 * opens (weekdays; the opening is found on a 15-minute grid, every market's windows open on one). Holidays are not modelled, so a ranking read
 * before a holiday is kept to the next weekday's open, which is when it would next change anyway. */
export function rankTtlMs(hours: SessionHours, nowMs: number, inSessionMs: number): number {
  const phase = localSession(hours, nowMs).phase;
  if (phase === "trading" || phase === "midday") return inSessionMs;
  const start = Math.floor(nowMs / QUARTER_MS) * QUARTER_MS;
  for (let t = start + QUARTER_MS; t <= start + 9 * 86_400_000; t += QUARTER_MS) {
    if (localSession(hours, t).phase === "trading") return Math.max(t - nowMs, inSessionMs);
  }
  return inSessionMs;
}
