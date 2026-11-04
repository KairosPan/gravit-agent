/** market:mcp — the market's own stdio MCP server: Gravit's keyless market reads, the face's mcp-market row. It holds no key, signs
 * nothing and keeps no state: every tool is one plain loopback read of the running market service (:4821), so the face's Markets screens and
 * the agent read one truth. A read here raises no card.
 *
 *   npm run market                    # the service
 *   npm run market:mcp                # this, over stdio; MARKET_URL overrides the base
 *
 * Tools, every one a read (readOnlyHint): market_explore (GET /api/explore) · market_quotes (GET /api/quotes) · market_candles
 * (GET /api/candles) · market_book (GET /api/book and GET /api/trades) · market_akshare (POST /api/akshare/call). What the owner has
 * connected, and the venues' own data there, is the account's seat (portfolio_account and its portfolio_live_* reads), not this server's.
 *
 * A market that does not answer is said in one sentence (MARKET_DOWN), never an HTTP code or a stack.
 *
 * The structure mirrors the account's seat, account/src/portfolio/mcp.ts. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AKSHARE_TOOLS } from "./live/akshare.ts";

const BASE = process.env.MARKET_URL ?? "http://127.0.0.1:4821";

/** the market's one sentence for itself not answering (A1's MARKET_DOWN, as the account says it) */
export const MARKET_DOWN = "The market service is not answering, so prices here are not current.";

/** one read of the market: its status and its JSON body, or "down" where it did not answer. A plain loopback fetch, no Origin header */
async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: unknown } | "down"> {
  const init: RequestInit = { method, headers: { "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  try {
    const r = await fetch(`${BASE}${path}`, init);
    return { status: r.status, body: await r.json().catch(() => ({})) };
  } catch {
    return "down";
  }
}

const text = (payload: unknown, isError = false): CallToolResult => ({ isError, content: [{ type: "text", text: JSON.stringify(payload) }] });
const down = (): CallToolResult => text({ ok: false, error: MARKET_DOWN }, true);

type Refused = { refusal?: { code: string; message: string; detail?: unknown }; error?: string };

/** a GET read passed on: the market's refusal as its code and words, any other failure as its error */
async function read(path: string): Promise<CallToolResult> {
  const r = await call("GET", path);
  if (r === "down") return down();
  const b = r.body as Record<string, unknown> & Refused;
  if (b.refusal) return text({ ok: false, code: b.refusal.code, message: b.refusal.message, ...(b.refusal.detail !== undefined ? { detail: b.refusal.detail } : {}) }, true);
  if (r.status >= 400) return text({ ok: false, error: b.error ?? `HTTP ${r.status}` }, true);
  return text(b);
}

const server = new McpServer({ name: "market", version: "0.1.0" });

const TABS = ["all", "crypto", "stocks", "rwas", "perps", "preipo", "predictions", "china"] as const;
const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"] as const;
const RANGES = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;

server.registerTool(
  "market_explore",
  {
    description:
      "MARKETS — what there is to trade: the public market data of the venues the market reads, without a key, as one list. A row's `at` entries say `public: true`, `canTrade: false` and `connectTo`: the venue the owner would connect first, on the owner's Gravit face (Account › Venues), to trade there; what the owner HAS connected is the seat's portfolio_account. One row per thing — a coin, a stock, a perpetual, a token that stands for a share (RWA), an event's question with its outcomes — with its price, 24-hour change (`changeFrom`: whose) and dollar volume where a venue reports them, close time, funding for a perpetual, and every venue it is listed at with THAT venue's own symbol. Nothing is estimated: a venue that gives no 24-hour change shows none, Kalshi counts contracts (`contracts24h`), not dollars, and Polymarket US publishes no volume in its lists. Also `movers` (24-hour change, $1M volume at least), `closing` (events closing within a day), `mostTraded`, the tabs with counts, and `missing` (venues that did not answer, or refuse this location, in their own words — nothing here looks for a way around a venue's rule). Predictions is a curated few: at most 12 rows when nothing is searched (Kalshi by a short list of busy series, Polymarket by 24-hour volume, Polymarket US — its own CFTC-regulated exchange, not polymarket.com — by the most traded markets of a few of its categories, without sports, weather and entertainment), each venue's busiest in turn; a search reaches every market the sources read. `notes` are the sentences under the list (what was read, what a search reaches); an `at` entry carries the venue's `bid`/`ask` where it gives them, `open` (false on a Kalshi leg past its close), a stock's `session` and `pastEnd` (an event past its listed end that still trades, as Polymarket's often do); an `at` entry from a line that names its quote's source — the public US stocks line — carries `quoteFrom`, which source priced it and how far behind the market that source is, in the source's words (\"Robinhood · real time\", \"Nasdaq · real time\", \"Cboe · 15 min delayed\"), and, where the source stamps one, `quoteAt`, the price's own time as that source stamps it, not when it was read (\"real time\" is the source, not the price's age: a real-time source's last trade can be yesterday's in pre-market, for a share not traded since); the row carries the two where such a line prices it, and other lines carry neither; the tabs are all · crypto · stocks · rwas · perps · preipo · predictions · china. `china` is the A shares Tencent ranks — view-only, priced in CNY (`currency`), sorted by `volume` (turnover, `turnoverCny`) or `movers`, never in `all`, and no venue trades them. Pre-IPO (`preipo`) is the pre-IPO perpetuals the venues list — contracts on a venue's estimate of a private company's valuation, not shares — one row per company (`group.id` is `preipo:<slug>`) with an `at` entry per venue; each `at` and the row carry `implied: { usd, unit }` — the valuation the price implies in dollars (`usd`; the row's is the median of its venues') and the venue's rule in words (`unit`: $1 of price stands for $1,000,000,000 at every venue except OKX's ANTHROPIC and OPENAI swaps, $10,000,000,000 since its 10:1 rebase); the row's `price` is that median in the $1-per-$1,000,000,000 convention. The prediction markets on IPOs are ordinary `predictions` rows (category IPO). Answers are kept thirty seconds. A read: nothing is ordered.",
    inputSchema: { tab: z.enum(TABS).optional().describe("one tab's rows; absent: every row"), q: z.string().max(60).optional().describe("a few letters of a symbol or a name"), sort: z.enum(["volume", "movers", "closing"]).optional(), limit: z.number().int().min(1).max(200).optional().describe("rows in `items` (default 30)") },
    annotations: { readOnlyHint: true },
  },
  async ({ tab, q, sort, limit }) => read(`/api/explore?${new URLSearchParams({ ...(tab ? { tab } : {}), ...(q ? { q } : {}), ...(sort ? { sort } : {}), limit: String(limit ?? 30) })}`),
);

server.registerTool(
  "market_quotes",
  {
    description:
      "A fresh price for each of 1 to 12 A shares, read now: `pairs` are `venue|symbol`, the venue `china` and the share's six digits (`china|600519`). Each answer is {venue, symbol, market} — the share's price in CNY, its quote's source and time — or {venue, symbol, refusal: {code, message}} for one that could not be priced, so one bad pair does not fail the rest. The market prices A shares here; a public market's price (a coin, a stock, a perpetual, an event) is its row in market_explore, and a pair at any other venue comes back refused. A read: nothing is ordered.",
    inputSchema: { pairs: z.array(z.string().regex(/^[^|,]{1,60}\|[^|,]{1,160}$/, "venue|symbol, e.g. china|600519")).min(1).max(12).describe("1 to 12 markets, each venue|symbol: china|600519") },
    annotations: { readOnlyHint: true },
  },
  async ({ pairs }) => read(`/api/quotes?${new URLSearchParams({ pairs: pairs.join(",") })}`),
);

server.registerTool(
  "market_candles",
  {
    description:
      "One market's price history, oldest first: {t (ms), o, h, l, c, v? in base units}, in bars of 1m, 5m, 15m, 1h, 4h, 1d or 1w. Ask a `range` (1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, MAX — in its own bar size unless `interval` is named: 1D 1m, 5D 5m, 1M 1h, 3M/6M 4h, YTD/1Y 1d, 5Y/MAX 1w; the latest 5,000 bars at most), or the page before a bar (`before`: its start in ms, `limit` bars) to go further back. The answer says `more` (older bars exist: ask `before` the first bar's t; with `partial`, the source refused or did not answer part of what was asked — ask again later, it is not where the history ends) and, where the history ends, why (`ends`: \"Hyperliquid keeps only the latest 5,000 bars at this size\", \"Intraday history starts …\"); `source` names whose bars they are, `adjustment` (US stocks: split-adjusted, not dividend-adjusted), `session` which hours, `folded` a size built from finer bars, `gaps` the stretches with no bars (\"No overnight data\"), `today` a daily bar built from intraday ones (\"Today so far\"); `interval` may come back coarser than asked, with `note` saying why. `venue` and `symbol` exactly as market_explore lists them in a row's `at`: the market answers from that venue's public market data, read without a key (an A share: venue `china`, its six digits). An event contract's prices are its probability in dollars (0.62 = 62¢). Kept seconds to minutes. A read.",
    inputSchema: {
      venue: z.string().max(60).describe("the venue's id, as an `at` entry of market_explore names it"),
      symbol: z.string().max(160).describe("the market there: BTC/USDT, KXFED-25DEC-T4.00:YES, <slug>:<outcome>"),
      interval: z.enum(INTERVALS).optional().describe("the bars (default: the range's own size; with neither, 1h over a month)"),
      range: z.enum(RANGES).optional().describe("how far back from now (not with `before`)"),
      before: z.number().int().positive().optional().describe("the start (ms) of the first bar already held: the page before it (not with `range`)"),
      limit: z.number().int().min(1).max(5_000).optional().describe("the most bars (a page: 1,000 at most)"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ venue, symbol, interval, range, before, limit }) => {
    const q = new URLSearchParams({ venue, symbol });
    if (interval) q.set("interval", interval);
    else if (!range && before === undefined) q.set("interval", "1h");
    if (range) q.set("range", range);
    if (before !== undefined) q.set("before", String(before));
    if (limit !== undefined) q.set("limit", String(limit));
    return read(`/api/candles?${q}`);
  },
);

server.registerTool(
  "market_book",
  {
    description:
      "One market's ORDER BOOK and its LATEST TRADES, as the Trade page shows them. `book`: {bids, asks: [[price, size]], best first — the highest bid, the lowest ask —, at, from, depth}; prices in the market's quote (an event contract's in dollars: 0.62 = 62¢), sizes in the units an order is sized in there (coins, shares, contracts). `depth: \"full\"` is the venue's own levels, and `more: {bids, asks}` says which side may go on past its last level (the source sent as many as asked or as it ever sends) — a sum of the far end of such a side is only part of that range. `depth: \"top\"` is only the best bid and best ask, with no size (null), stamped `at` the quote's own time (where it carries no time of its own, `at` is when it was read; one from a public listing kept a while carries `upToMs`, how old it may be at most: about two minutes): `topOnly: \"none\"` where the source publishes no depth at all (a US stock's public quote), `\"unread\"` where it has a book the market does not read. `trades`: the latest, newest first, {price, size, side?, at} — `side` (buy: a buyer took an offer; sell: a seller took a bid) only where the source says which side took. `venue` and `symbol` as for market_candles: the market answers from that venue's public data, without a key. A source that publishes no trades at all (a US stock's public quote) says so in `tradesNone`, a sentence, with `trades` empty; any other trades refusal is in `tradesRefused`. Kept a second or three. A read.",
    inputSchema: { venue: z.string().max(60).describe("the venue's id, as an `at` entry of market_explore names it"), symbol: z.string().max(160).describe("the market there: BTC/USDT, BTC-PERP, KXFED-25DEC-T4.00:YES, <slug>:<outcome>, AAPL"), depth: z.number().int().min(1).max(50).optional().describe("levels a side (default 20)") },
    annotations: { readOnlyHint: true },
  },
  async ({ venue, symbol, depth }) => {
    const q = new URLSearchParams({ venue, symbol });
    const [b, t] = await Promise.all([call("GET", `/api/book?${q}&depth=${depth ?? 20}`), call("GET", `/api/trades?${q}&limit=30`)]);
    if (b === "down" || t === "down") return down();
    type Answer = { ok?: boolean; venue?: string; venueName?: string; symbol?: string; book?: unknown; trades?: unknown; none?: string; public?: boolean } & Refused;
    const bb = b.body as Answer;
    const tb = t.body as Answer;
    const refused = (x: Answer, status: number) => (x.refusal ? { code: x.refusal.code, message: x.refusal.message } : status >= 400 ? { error: x.error ?? `HTTP ${status}` } : undefined);
    const bookNo = refused(bb, b.status);
    const tradesNo = refused(tb, t.status);
    // a source with no trades at all answers an empty list and the sentence why (reads.ts trades `none`): passed on as tradesNone
    const tradesNone = !tradesNo && typeof tb.none === "string" ? { tradesNone: tb.none } : {};
    if (bookNo) return text({ ok: false, ...bookNo, ...(tradesNo ? {} : { trades: tb.trades, ...tradesNone }) }, true);
    return text({ ok: true, venue: bb.venue, venueName: bb.venueName, symbol: bb.symbol, ...(bb.public ? { public: true } : {}), book: bb.book, ...(tradesNo ? { tradesRefused: tradesNo } : { trades: tb.trades, ...tradesNone }) });
  },
);

server.registerTool(
  "market_akshare",
  {
    description: `AKSHARE — public Chinese market data through the AKShare sidecar the market runs: A shares, Hong Kong and US listings, boards and fund flows, margin, fundamentals, macro, futures, funds, bonds, indices, options, FX and commodities. \`tool\` is one of the sidecar's tools — ${AKSHARE_TOOLS.join(", ")} — and \`arguments\` are that tool's own. Find a function first with akshare_discover (\`{query: "spot"}\`; an empty query lists every tool and its functions), then call its tool with \`{method: "<function>", params_json?: "<its parameters as JSON>", symbol?, start_date?, end_date?, period?, adjust?, date?}\`: \`{tool: "akshare_stock_a", arguments: {method: "stock_zh_a_spot_tx"}}\` is Tencent's whole A-share snapshot. At most 500 rows come back — check \`truncated\` and \`row_count\`; each call is bounded at 120 s. Live and unguarded, never evidence of a trade: check each result's errors and timestamps; retrieval time is not exchange time. A read: nothing is ordered.`,
    inputSchema: { tool: z.string().max(64), arguments: z.record(z.string(), z.unknown()).optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ tool, arguments: args }) => {
    const r = await call("POST", "/api/akshare/call", { tool, ...(args !== undefined ? { arguments: args } : {}) });
    if (r === "down") return down();
    const b = r.body as { ok?: boolean; isError?: boolean; content?: CallToolResult["content"]; akshare?: string; message?: string; error?: string };
    if (r.status === 404) return text({ ok: false, error: "this market has no AKShare sidecar (/api/akshare): restart it from this tree" }, true);
    if (b.ok === true) return { isError: b.isError === true, content: b.content ?? [] };
    if (typeof b.akshare === "string") return text({ ok: false, akshare: b.akshare, message: b.message }, true);
    return text({ ok: false, error: b.error ?? `HTTP ${r.status}` }, true);
  },
);

await server.connect(new StdioServerTransport());
process.stderr.write(`[market] up (stdio) → ${BASE} · keyless reads, no card, nothing signed\n`);
