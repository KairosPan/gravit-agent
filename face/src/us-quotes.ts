/**
 * The desk's US quote contract and its one source: what the pre-close brief (src/brief.ts) and `desk_quotes`
 * (src/desk-tools.ts) ask for, in the shapes the face's quote hub answered with before main's wire became A shares
 * alone (2026-10-30, Tencent; src/quotes.ts refuses every `us:` id as retired). The desk keeps its own copy of those
 * shapes so it does not depend on the A-share hub's types.
 *
 * THE SOURCE IS THE ACCOUNT'S MARKET READ (the operator's decision, 2026-11-01): {@link accountUsQuotes} asks the
 * Account's `GET /api/account/explore?q=<SYM>&key=stock:<SYM>&limit=1` once per symbol, in-process through the face's
 * proxy (src/account-proxy.ts: the `explore` route's cache and flights, `FACE_ACCOUNT_URL`), no new route and no new
 * host. The Account answers a US share keyless (its live/us-quotes.ts: Robinhood's or Nasdaq's real-time quote, else
 * Cboe's delayed one), and a connected venue's own price where one trades it. One row's `price` with its `quoteAt`
 * becomes a quote's `price` and `as_of`, `quoteFrom` its `feed` (a delayed one `delayed`), `change24h` its `change`
 * and `price - change24h` its `prev_close`. Nothing is invented: no row, no `quoteAt`, a refusal - no price.
 *
 * Honest degradation, in the readers' words (`quotes unavailable: <reason>`, `unavailable: <reason>`):
 * - the Account not running, timed out, or the seat row disabled: the snapshot rejects with why, when no symbol got
 *   an answer at all;
 * - the Account busy (429): an `HttpError` 429, which the readers say as `busy`;
 * - a symbol the Account lists no US share for, or a row without a timed price: that quote `unavailable`, with why.
 * {@link unwiredUsQuotes} stays for a face with no Account wired (the tests, a host without the proxy).
 * @module
 */
import { HttpError } from "./http.ts";
import type { AccountAnswer } from "./account-proxy.ts";

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

/** Why a desk has no US price when no Account is wired: the reason the brief's `quotesError` and `desk_quotes`' `error` carry. */
export const NO_US_QUOTES = "no US quote source is wired: this face has no Account read to ask";

/** The source for a face with no Account wired: `unavailable` is {@link NO_US_QUOTES}, and a snapshot asked anyway
 * rejects with it. */
export function unwiredUsQuotes(): UsQuoteSource {
  return { unavailable: NO_US_QUOTES, snapshot: () => Promise.reject(new Error(NO_US_QUOTES)) };
}

/** How many of the Account's reads one snapshot keeps in flight at once: a brief asks up to 200 symbols. */
export const ACCOUNT_QUOTES_CONCURRENCY = 6;

/** The source's name in a quote and in its provider state. */
const ACCOUNT_SOURCE = "account";

/** An `unreachable` code from the proxy, as the readers say it. */
function unreachableWords(code: string): string {
  if (code === "disabled") return "the Account seat row is disabled";
  if (code === "timeout") return "the Account did not answer in time";
  return code === "unreachable" ? "the Account is not reachable" : `the Account is not reachable (${code})`;
}

/** The fields of one explore row the desk reads; anything else in it is ignored. */
interface ExploreRow { key?: unknown; price?: unknown; quoteFrom?: unknown; quoteAt?: unknown; change24h?: unknown }

const isPrice = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** One symbol's answer: a quote, or why the Account could not be asked (`fatal`) - every other failure is a quote with no price. */
type SymbolAnswer = { quote: UsLiveQuote } | { fatal: Error };

function unpriced(asset: UsQuoteIdentity, message: string, receivedAt: string): UsLiveQuote {
  return {
    ...asset, transport: "poll", price: null, prev_close: null, change: null, change_pct: null, volume: null, as_of: null,
    received_at: receivedAt, volume_as_of: null, source: ACCOUNT_SOURCE, feed: "", basis: "previous_close",
    quote_status: "unavailable", market_status: "unknown", message,
  };
}

/** One explore answer for `asset` as a quote: the row keyed `stock:<SYM>` with a price and its time, or no price and why. */
function quoteOf(asset: UsQuoteIdentity, answer: AccountAnswer, receivedAt: string): SymbolAnswer {
  if ("unreachable" in answer) return { fatal: new Error(unreachableWords(answer.unreachable)) };
  if (answer.status === 429) return { fatal: new HttpError(429, "the Account is busy") };
  type Body = { ok?: unknown; items?: unknown; refusal?: { message?: unknown } };
  let parsed: unknown = null;
  try { parsed = JSON.parse(answer.body); } catch { /* below */ }
  const body = parsed as Body | null;
  if (body === null || typeof body !== "object") return { quote: unpriced(asset, `the Account answered ${answer.status} with no JSON`, receivedAt) };
  if (answer.status < 200 || answer.status >= 300 || body.ok !== true) {
    const why = typeof body.refusal?.message === "string" ? body.refusal.message.slice(0, 200) : `status ${answer.status}`;
    return { quote: unpriced(asset, `the Account refused: ${why}`, receivedAt) };
  }
  const items = Array.isArray(body.items) ? (body.items as ExploreRow[]) : [];
  const row = items.find((item) => item !== null && typeof item === "object" && item.key === `stock:${asset.symbol}`);
  if (row === undefined) return { quote: unpriced(asset, `the Account lists no US share ${asset.symbol}`, receivedAt) };
  const at = typeof row.quoteAt === "string" && !Number.isNaN(Date.parse(row.quoteAt)) ? row.quoteAt : null;
  if (!isPrice(row.price) || at === null) return { quote: unpriced(asset, `the Account has no timed price for ${asset.symbol}`, receivedAt) };
  const from = typeof row.quoteFrom === "string" ? row.quoteFrom.trim().slice(0, 40) : "";
  const change = isNumber(row.change24h) ? row.change24h : null;
  const prevClose = change !== null && isPrice(row.price - change) ? Math.round((row.price - change) * 1e4) / 1e4 : null;
  return {
    quote: {
      ...asset, transport: "poll", price: row.price, prev_close: prevClose, change,
      change_pct: prevClose === null || change === null ? null : Math.round((change / prevClose) * 1e6) / 1e4,
      volume: null, as_of: at, received_at: receivedAt, volume_as_of: null, source: ACCOUNT_SOURCE, feed: from,
      basis: "previous_close", quote_status: /delay/i.test(from) ? "delayed" : "live", market_status: "unknown", message: "",
    },
  };
}

export interface AccountUsQuotesDeps {
  /** The proxy's `explore` read (src/account-proxy.ts registerAccountProxy). */
  explore: (query: string) => Promise<AccountAnswer>;
  now?: () => number;
  concurrency?: number;
}

/** The desk's US quotes from the Account's market read: one explore read per symbol, at most
 * {@link ACCOUNT_QUOTES_CONCURRENCY} at once, in the order asked. Rejects - an `HttpError` 429 when busy - only when
 * the Account could not be asked for any symbol; otherwise every symbol has its quote, priced or not. */
export function accountUsQuotes(deps: AccountUsQuotesDeps): UsQuoteSource {
  const now = deps.now ?? Date.now;
  const width = Math.max(1, deps.concurrency ?? ACCOUNT_QUOTES_CONCURRENCY);
  return {
    async snapshot(assets) {
      const answers: SymbolAnswer[] = new Array(assets.length);
      let next = 0;
      const lane = async (): Promise<void> => {
        while (next < assets.length) {
          const i = next++;
          const asset = assets[i] as UsQuoteIdentity;
          const query = new URLSearchParams({ q: asset.symbol, key: `stock:${asset.symbol}`, limit: "1" }).toString();
          answers[i] = quoteOf(asset, await deps.explore(query), new Date(now()).toISOString());
        }
      };
      await Promise.all(Array.from({ length: Math.min(width, assets.length) }, lane));
      const quotes: UsLiveQuote[] = [];
      let fatal: Error | undefined;
      answers.forEach((answer, i) => {
        if ("quote" in answer) quotes.push(answer.quote);
        else {
          fatal ??= answer.fatal;
          quotes.push(unpriced(assets[i] as UsQuoteIdentity, answer.fatal.message, new Date(now()).toISOString()));
        }
      });
      if (fatal !== undefined && answers.every((answer) => "fatal" in answer)) throw fatal;
      const priced = quotes.some((quote) => quote.price !== null);
      const generatedAt = new Date(now()).toISOString();
      return {
        ok: true,
        generated_at: generatedAt,
        quotes,
        providers: [{
          id: ACCOUNT_SOURCE, market: "us", status: priced ? "connected" : fatal !== undefined ? "error" : "limited",
          source: ACCOUNT_SOURCE, feed: "", transport: "poll", message: "",
        }],
      };
    },
  };
}
