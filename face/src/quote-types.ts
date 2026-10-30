/** Shared live-quote contract — the A shares alone, polled from Tencent. Provider
 * event time and receipt time stay separate. */
export type QuoteMarket = "cn";
export type QuoteProvider = "tencent";
export interface QuoteIdentity { id: string; market: QuoteMarket; symbol: string }
export type MarketStatus = "open" | "closed" | "unknown";
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
}
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
