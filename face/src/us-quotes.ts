/**
 * The desk's US quote contract: what the pre-close brief (src/brief.ts) and `desk_quotes`
 * (src/desk-tools.ts) ask a US quote source for, in the shapes the face's quote hub answered with
 * before main's wire became A shares alone (2026-10-30, Tencent; src/quotes.ts now refuses every
 * `us:` id as retired). The desk keeps its own copy of those shapes so it does not depend on the
 * A-share hub's types.
 *
 * NO SOURCE IS WIRED. main.ts hands the desk {@link unwiredUsQuotes}, `unavailable` set to
 * {@link NO_US_QUOTES}: the brief asks nothing and degrades to every price null with
 * `quotes unavailable: <that reason>` as its `quotesError`, and `desk_quotes` answers
 * `unavailable: <that reason>` as its `error`. Which source to wire - the Account's
 * market reads through src/account-proxy.ts, the seat, a desk-owned IEX source, or another - is the
 * operator's decision; this module invents none.
 * @module
 */

/** A US instrument as the desk asks for it: `{ id: "us:NVDA", market: "us", symbol: "NVDA" }`. */
export interface UsQuoteIdentity { id: string; market: "us"; symbol: string }

/** A provider's state in a payload, as the old hub reported one. */
export interface UsProviderState {
  id: string;
  market: string;
  status: "connecting" | "connected" | "unconfigured" | "error" | "limited";
  source: string;
  feed: string;
  transport: "stream" | "poll";
  message: string;
}

/** One quote: a price only with the time it traded at, its feed (`iex`, `sip`, `delayed_sip`). */
export interface UsLiveQuote extends UsQuoteIdentity {
  transport?: "stream" | "poll";
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
  basis: "previous_close" | "24h";
  quote_status: "live" | "delayed" | "stale" | "unavailable";
  market_status: "open" | "closed" | "unknown";
  message: string;
}

/** One snapshot's answer. */
export interface UsQuotePayload {
  ok: true;
  generated_at: string;
  quotes: UsLiveQuote[];
  providers: UsProviderState[];
}

/** A US quote source: one snapshot per call. A rejection with an `HttpError` 429 means busy. `unavailable`, when
 * set, is why the source has no price at all: its readers answer that reason and ask nothing. */
export interface UsQuoteSource {
  snapshot(assets: UsQuoteIdentity[]): Promise<UsQuotePayload>;
  readonly unavailable?: string;
}

/** Why the desk has no US price: the reason the brief's `quotesError` and `desk_quotes`' `error` carry. */
export const NO_US_QUOTES =
  "no US quote source is wired: the face's quote wire serves A shares only (Tencent) since 2026-10-30, and the operator has not chosen a US source";

/** The source main.ts hands the desk while no US source is wired: `unavailable` is {@link NO_US_QUOTES}, and a
 * snapshot asked anyway rejects with it. */
export function unwiredUsQuotes(): UsQuoteSource {
  return { unavailable: NO_US_QUOTES, snapshot: () => Promise.reject(new Error(NO_US_QUOTES)) };
}
