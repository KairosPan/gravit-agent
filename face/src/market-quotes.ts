/**
 * The desk's quote contract and its one source, for both its markets: what the pre-close brief (src/brief.ts),
 * `desk_quotes` (src/desk-tools.ts) and the watch ask for. The desk keeps its own shapes, named for the Market part
 * (operator ruling M11): a quote's `source` is `market`, and its `feed` the Market's word for where the price came from.
 *
 * THE SOURCE IS THE MARKET'S READS (the operator's decisions of 2026-11-01): {@link marketQuotes} asks the Account's
 * Market part in-process, through the face's proxy (src/account-proxy.ts: each route's cache and flights,
 * `FACE_ACCOUNT_URL`), no new route and no new host. A snapshot splits what it is asked by market:
 * - a US share: `GET /api/account/explore?q=<SYM>&key=stock:<SYM>&limit=1`, once per symbol, kept 20 s by the proxy.
 *   The Market answers it keyless (the Account's live US quotes: Robinhood's or Nasdaq's real-time quote, else Cboe's delayed
 *   one). The row keyed `stock:<SYM>` with a `price` and its `quoteAt` becomes the quote's `price` and `as_of`,
 *   `change24h` its `change` and `price - change24h` its `prev_close`;
 * - an A share: `GET /api/account/quotes?pairs=china|<code>,…`, at most {@link CN_QUOTES_BATCH} codes a read (the
 *   Account's cap), the codes sorted, kept 3 s by the proxy. The China row's `price`, `quoteAt`, `change24h`,
 *   `changePct24h` and `cn` (Tencent's previous close, volume, quote status and the session's phase) become the quote.
 * Every read runs in the same {@link QUOTES_CONCURRENCY} lanes, and the quotes come back in the order asked. `feedOf`
 * names the feed from the row's `quoteFrom`; a US quote is `delayed` when that word says so. Nothing is invented: no
 * row, no `quoteAt`, a refusal - no price.
 *
 * Honest degradation, in the readers' words (`quotes unavailable: <reason>`, `unavailable: <reason>`):
 * - the Account not running, timed out, or the seat row disabled: the snapshot rejects with why, when no read of any
 *   market got an answer at all; when one did, the others' quotes say why, unpriced;
 * - the Account busy (429): an `HttpError` 429, which the readers say as `busy`;
 * - a symbol the Market lists no share for, a row without a timed price, a refused pair or read, a body that is no
 *   JSON: that quote `unavailable`, with why (`the Market read …`);
 * - a body marked `stale: true` - which the in-process read never returns - marks that read's quotes `stale`.
 * {@link unwiredMarketQuotes} stays for a face with no Market read wired (the tests, a host without the proxy).
 * @module
 */
import type { AccountAnswer, AccountRouteRead } from "./account-proxy.ts";
import { HttpError } from "./http.ts";
import type { Market } from "./symbols.ts";

/** An instrument as the desk asks for it: `{ id: "us:NVDA", market: "us", symbol: "NVDA" }`,
 * `{ id: "cn:600519", market: "cn", symbol: "600519" }`. */
export interface MarketQuoteIdentity { id: string; market: Market; symbol: string }

/** One market's state in a payload: `connected` when a quote of it is priced, `error` when the Account could not be
 * asked for it, else `limited`. */
export interface MarketProviderState {
  id: string;
  market: string;
  status: "connecting" | "connected" | "unconfigured" | "error" | "limited";
  source: string;
  feed: string;
  transport: "stream" | "poll";
  message: string;
}

/** An A share's session as the Market reads it: its phase and the last session's date. */
export interface CnSessionFacts { phase: "trading" | "midday" | "closed"; lastSession: string | null }

/** One quote: a price only with the time it traded at, and its feed in the Market's words (`nasdaq`, `tencent`).
 * `market_status` is `open` for an A share in its trading phase, `closed` at the midday break and after the close,
 * and `unknown` for a US share, whose row carries no session; `cn` is an A share's alone. */
export interface MarketQuote extends MarketQuoteIdentity {
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
  cn?: CnSessionFacts;
}

/** One snapshot's answer: its quotes in the order asked, and one provider state per market asked. */
export interface MarketQuotePayload {
  ok: true;
  generated_at: string;
  quotes: MarketQuote[];
  providers: MarketProviderState[];
}

/** A quote source: one snapshot per call. A rejection with an `HttpError` 429 means busy. `unavailable`, when set,
 * is why the source has no price at all: its readers answer that reason and ask nothing. */
export interface MarketQuoteSource {
  snapshot(assets: MarketQuoteIdentity[]): Promise<MarketQuotePayload>;
  readonly unavailable?: string;
}

/** Why a desk has no price when no Market read is wired: the reason the brief's `quotesError` and `desk_quotes`'
 * `error` carry. */
export const NO_QUOTES = "no quote source is wired: this face has no Market read to ask";

/** The source for a face with no Market read wired: `unavailable` is {@link NO_QUOTES}, and a snapshot asked anyway
 * rejects with it. */
export function unwiredMarketQuotes(): MarketQuoteSource {
  return { unavailable: NO_QUOTES, snapshot: () => Promise.reject(new Error(NO_QUOTES)) };
}

/** How many of the Market's reads one snapshot keeps in flight at once: a brief asks up to 200 symbols. */
export const QUOTES_CONCURRENCY = 6;

/** The most A shares one `quotes` read asks for: the Account's cap on one read. */
export const CN_QUOTES_BATCH = 12;

/** The source's name in a quote and in its provider state. */
const MARKET_SOURCE = "market";

/** The Market's own feed words, each as the desk names it; the key is {@link plainWords}'s. */
const FEEDS: ReadonlyMap<string, string> = new Map([
  ["robinhood real time", "robinhood"],
  ["nasdaq real time", "nasdaq"],
  ["cboe 15 min delayed", "cboe delayed"],
  ["tencent", "tencent"],
]);

/** A feed word lower-cased, its `·` dropped and its spaces collapsed and trimmed. */
const plainWords = (text: string): string => text.toLowerCase().replace(/·/g, " ").replace(/\s+/g, " ").trim();

/**
 * A quote's feed in the Market's words, from the row's `quoteFrom`: `Robinhood · real time` → `robinhood`,
 * `Nasdaq · real time` → `nasdaq`, `Cboe · 15 min delayed` → `cboe delayed`, `Tencent` → `tencent`; any other word
 * lower-cased, its `·` dropped and its spaces collapsed, at most 40 characters.
 * @param quoteFrom - the row's `quoteFrom`.
 */
export function feedOf(quoteFrom: string): string {
  const words = plainWords(quoteFrom);
  return FEEDS.get(words) ?? words.slice(0, 40).trim();
}

/** An `unreachable` code from the proxy, as the readers say it: the Account is the process. */
function unreachableWords(code: string): string {
  if (code === "disabled") return "the Account seat row is disabled";
  if (code === "timeout") return "the Account did not answer in time";
  return code === "unreachable" ? "the Account is not reachable" : `the Account is not reachable (${code})`;
}

const isPrice = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
/** A row's `quoteAt`, when `Date` can read it. */
const timeOf = (value: unknown): string | null => typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;

/** One asset's answer: a quote, or why the Account could not be asked (`fatal`) - every other failure is a quote with
 * no price. */
type SymbolAnswer = { quote: MarketQuote } | { fatal: Error };

function unpriced(asset: MarketQuoteIdentity, message: string, receivedAt: string): MarketQuote {
  return {
    ...asset, transport: "poll", price: null, prev_close: null, change: null, change_pct: null, volume: null, as_of: null,
    received_at: receivedAt, volume_as_of: null, source: MARKET_SOURCE, feed: "", basis: "previous_close",
    quote_status: "unavailable", market_status: "unknown", message,
  };
}

/** A read's answer, judged as a whole: a body to read the rows of, or what every asset of the read gets - `fatal` when
 * the Account could not be asked, else a reason its quotes are unpriced. */
type ReadVerdict =
  | { body: Record<string, unknown>; stale: boolean }
  | { fatal: Error }
  | { refused: string };

function readVerdict(answer: AccountAnswer): ReadVerdict {
  if ("unreachable" in answer) return { fatal: new Error(unreachableWords(answer.unreachable)) };
  if (answer.status === 429) return { fatal: new HttpError(429, "the Account is busy") };
  let parsed: unknown = null;
  try { parsed = JSON.parse(answer.body); } catch { /* below */ }
  if (!isRecord(parsed)) return { refused: `the Market read answered ${answer.status} with no JSON` };
  if (answer.status < 200 || answer.status >= 300 || parsed.ok !== true) {
    const refusal = parsed.refusal;
    const why = isRecord(refusal) && typeof refusal.message === "string" ? refusal.message.slice(0, 200) : `status ${answer.status}`;
    return { refused: `the Market read refused: ${why}` };
  }
  return { body: parsed, stale: parsed.stale === true };
}

/** What every asset of a read that gave no rows gets. */
function failed(asset: MarketQuoteIdentity, verdict: { fatal: Error } | { refused: string }, receivedAt: string): SymbolAnswer {
  return "fatal" in verdict ? verdict : { quote: unpriced(asset, verdict.refused, receivedAt) };
}

/** One explore answer for a US `asset` as a quote: the row keyed `stock:<SYM>` with a price and its time, or no price
 * and why. */
function usQuoteOf(asset: MarketQuoteIdentity, answer: AccountAnswer, receivedAt: string): SymbolAnswer {
  const verdict = readVerdict(answer);
  if (!("body" in verdict)) return failed(asset, verdict, receivedAt);
  const items = Array.isArray(verdict.body.items) ? verdict.body.items : [];
  const row = items.find((item): item is Record<string, unknown> => isRecord(item) && item.key === `stock:${asset.symbol}`);
  if (row === undefined) return { quote: unpriced(asset, `the Market read lists no US share ${asset.symbol}`, receivedAt) };
  const at = timeOf(row.quoteAt);
  if (!isPrice(row.price) || at === null) return { quote: unpriced(asset, `the Market read has no timed price for ${asset.symbol}`, receivedAt) };
  const from = typeof row.quoteFrom === "string" ? row.quoteFrom : "";
  const change = isNumber(row.change24h) ? row.change24h : null;
  const prevClose = change !== null && isPrice(row.price - change) ? Math.round((row.price - change) * 1e4) / 1e4 : null;
  return {
    quote: {
      ...asset, transport: "poll", price: row.price, prev_close: prevClose, change,
      change_pct: prevClose === null || change === null ? null : Math.round((change / prevClose) * 1e6) / 1e4,
      volume: null, as_of: at, received_at: receivedAt, volume_as_of: null, source: MARKET_SOURCE, feed: feedOf(from),
      basis: "previous_close", quote_status: verdict.stale ? "stale" : /delay/i.test(from) ? "delayed" : "live",
      market_status: "unknown", message: "",
    },
  };
}

const CN_PHASES: ReadonlySet<string> = new Set(["trading", "midday", "closed"]);

/** One China row for an A share `asset` as a quote: its timed price with Tencent's facts, or no price and why. */
function cnQuoteOf(asset: MarketQuoteIdentity, row: Record<string, unknown> | undefined, stale: boolean, receivedAt: string): MarketQuote {
  if (row === undefined) return unpriced(asset, `the Market read lists no A share ${asset.symbol}`, receivedAt);
  if (row.refusal !== undefined) {
    const refusal = row.refusal;
    const why = isRecord(refusal) && typeof refusal.message === "string" ? refusal.message.slice(0, 200) : `the Market read refused ${asset.symbol}`;
    return unpriced(asset, why, receivedAt);
  }
  const market = isRecord(row.market) ? row.market : {};
  const at = timeOf(market.quoteAt);
  if (!isPrice(market.price) || at === null) return unpriced(asset, `the Market read has no timed price for ${asset.symbol}`, receivedAt);
  const facts = isRecord(market.cn) ? market.cn : {};
  const phase = typeof facts.phase === "string" && CN_PHASES.has(facts.phase) ? facts.phase as CnSessionFacts["phase"] : undefined;
  const lastSession = typeof facts.lastSession === "string" ? facts.lastSession : null;
  return {
    ...asset, transport: "poll", price: market.price,
    prev_close: isPrice(facts.prevClose) ? facts.prevClose : null,
    change: isNumber(market.change24h) ? market.change24h : null,
    change_pct: isNumber(market.changePct24h) ? market.changePct24h : null,
    volume: isNumber(facts.volume) ? facts.volume : null,
    as_of: at, received_at: receivedAt, volume_as_of: null, source: MARKET_SOURCE,
    feed: feedOf(typeof market.quoteFrom === "string" ? market.quoteFrom : ""), basis: "previous_close",
    quote_status: stale ? "stale" : facts.quoteStatus === "delayed" ? "delayed" : "live",
    market_status: phase === undefined ? "unknown" : phase === "trading" ? "open" : "closed",
    message: "",
    ...(phase === undefined ? {} : { cn: { phase, lastSession } }),
  };
}

/** One `quotes` answer, read once: each A share of it as its answer - its China row's quote, or what the whole read
 * gives every asset of it. */
function cnAnswersOf(answer: AccountAnswer, receivedAt: string): (asset: MarketQuoteIdentity) => SymbolAnswer {
  const verdict = readVerdict(answer);
  if (!("body" in verdict)) return (asset) => failed(asset, verdict, receivedAt);
  const rows = Array.isArray(verdict.body.quotes) ? verdict.body.quotes.filter(isRecord) : [];
  const rowOf = (code: string) => rows.find((row) => row.symbol === code && (row.venue === undefined || row.venue === "china"));
  return (asset) => ({ quote: cnQuoteOf(asset, rowOf(asset.symbol), verdict.stale, receivedAt) });
}

export interface MarketQuotesDeps {
  /** The proxy's `explore` read (src/account-proxy.ts registerAccountProxy): a US share's. */
  explore: AccountRouteRead;
  /** The proxy's `quotes` read: an A share's. */
  quotes: AccountRouteRead;
  now?: () => number;
  concurrency?: number;
}

/** The markets a payload names a provider for, in this order. */
const MARKETS: readonly Market[] = ["us", "cn"];

/** The desk's quotes from the Market's reads, both markets in one snapshot: one explore read per US symbol and one
 * quotes read per {@link CN_QUOTES_BATCH} A shares, at most {@link QUOTES_CONCURRENCY} reads at once, in the order
 * asked. Rejects - an `HttpError` 429 when busy - only when no read of any market was answered; otherwise every asset
 * has its quote, priced or not. */
export function marketQuotes(deps: MarketQuotesDeps): MarketQuoteSource {
  const now = deps.now ?? Date.now;
  const width = Math.max(1, deps.concurrency ?? QUOTES_CONCURRENCY);
  const stamp = (): string => new Date(now()).toISOString();
  return {
    async snapshot(assets) {
      const answers: SymbolAnswer[] = new Array(assets.length);
      /* the reads to make: one per US asset, then the A shares' codes, each once, sorted and cut into batches */
      const jobs: Array<() => Promise<void>> = [];
      assets.forEach((asset, i) => {
        if (asset.market !== "us") return;
        const query = new URLSearchParams({ q: asset.symbol, key: `stock:${asset.symbol}`, limit: "1" }).toString();
        jobs.push(async () => { answers[i] = usQuoteOf(asset, await deps.explore(query), stamp()); });
      });
      const codes = [...new Set(assets.filter((asset) => asset.market === "cn").map((asset) => asset.symbol))].sort();
      for (let at = 0; at < codes.length; at += CN_QUOTES_BATCH) {
        const batch = codes.slice(at, at + CN_QUOTES_BATCH);
        const query = new URLSearchParams({ pairs: batch.map((code) => `china|${code}`).join(",") }).toString();
        jobs.push(async () => {
          const answerFor = cnAnswersOf(await deps.quotes(query), stamp());
          assets.forEach((asset, i) => {
            if (asset.market === "cn" && batch.includes(asset.symbol)) answers[i] = answerFor(asset);
          });
        });
      }
      let next = 0;
      const lane = async (): Promise<void> => {
        while (next < jobs.length) await (jobs[next++] as () => Promise<void>)();
      };
      await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, lane));

      const quotes: MarketQuote[] = [];
      let fatal: Error | undefined;
      const fatalIn = new Set<Market>();
      answers.forEach((answer, i) => {
        const asset = assets[i] as MarketQuoteIdentity;
        if ("quote" in answer) {
          quotes.push(answer.quote);
        } else {
          fatal ??= answer.fatal;
          fatalIn.add(asset.market);
          quotes.push(unpriced(asset, answer.fatal.message, stamp()));
        }
      });
      if (fatal !== undefined && answers.every((answer) => "fatal" in answer)) throw fatal;
      return {
        ok: true,
        generated_at: stamp(),
        quotes,
        providers: MARKETS.filter((market) => assets.some((asset) => asset.market === market)).map((market): MarketProviderState => ({
          id: MARKET_SOURCE, market,
          status: quotes.some((quote) => quote.market === market && quote.price !== null) ? "connected" : fatalIn.has(market) ? "error" : "limited",
          source: MARKET_SOURCE, feed: "", transport: "poll", message: "",
        })),
      };
    },
  };
}
