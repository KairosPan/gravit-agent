/** Shared live-quote contract — the A shares alone, polled from Tencent. Provider
 * event time and receipt time stay separate. */
export type QuoteMarket = "cn";
export type QuoteProvider = "tencent";
export interface QuoteIdentity { id: string; market: QuoteMarket; symbol: string }
export type MarketStatus = "open" | "midday" | "closed" | "unknown";
export interface ProviderState {
  id: QuoteProvider;
  market: QuoteMarket;
  status: "connecting" | "connected" | "unconfigured" | "error" | "limited";
  source: string;
  feed: string;
  transport: "poll";
  message: string;
}
/** A patch may carry a new trade OR a new cumulative volume, never invent one
 * from the other. Omitted fields retain their last known values. */
export interface QuoteUpdate {
  id: string;
  source: string;
  feed: string;
  basis: "previous_close";
  price?: number | null;
  prev_close?: number | null;
  volume?: number | null;
  as_of?: string | null;
  volume_as_of?: string | null;
  market_status?: MarketStatus;
  message?: string;
  /** The A-share page's facts (spec 2026-10-31 §5): yuan for `turnover` and `market_cap`, percent for
   * `turnover_rate` and `amplitude`; a negative `pe_ttm` is a loss-making share's. */
  name?: string | null;
  /** The session's last trading day, `YYYY-MM-DD` (上证指数's last trade): the Closed line's date. */
  last_session?: string | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  turnover?: number | null;
  turnover_rate?: number | null;
  market_cap?: number | null;
  pe_ttm?: number | null;
  limit_up?: number | null;
  limit_down?: number | null;
  amplitude?: number | null;
}
/** The facts a quote carries beside its price, in the order the page draws them. */
export const QUOTE_FACTS = ["open", "high", "low", "turnover", "turnover_rate", "market_cap", "pe_ttm", "limit_up", "limit_down", "amplitude"] as const;
export type QuoteFact = typeof QUOTE_FACTS[number];
export interface LiveQuote extends QuoteIdentity {
  transport?: "poll";
  price: number | null;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
  volume: number | null;
  as_of: string | null;
  received_at: string | null;
  volume_as_of: string | null;
  source: string;
  feed: string;
  basis: "previous_close";
  quote_status: "live" | "delayed" | "stale" | "unavailable";
  market_status: MarketStatus;
  message: string;
  name: string | null;
  last_session: string | null;
  open: number | null;
  high: number | null;
  low: number | null;
  turnover: number | null;
  turnover_rate: number | null;
  market_cap: number | null;
  pe_ttm: number | null;
  limit_up: number | null;
  limit_down: number | null;
  amplitude: number | null;
}
export interface QuotePayload {
  ok: true;
  generated_at: string;
  quotes: LiveQuote[];
  providers: ProviderState[];
}
export interface SnapshotResult { updates: QuoteUpdate[]; providers: ProviderState[] }
export interface SnapshotSource {
  load(assets: QuoteIdentity[], signal?: AbortSignal): Promise<SnapshotResult>;
}
