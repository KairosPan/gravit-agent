/** THE SOURCE PROTOCOL: what a caller elsewhere — the account, through its adapters (plan A1 task 4) — needs to use the market's keyless
 * public sources, its stream hub, China and a coin's price over HTTP, as if they were its own.
 *
 * THE ANSWER: every route answers 200 with `{ok: true, value, readAt?}` or `{ok: false, refusal}` — a source's refusal is an answer, not an
 * error. A bad parameter is 400 `{ok: false, error}`, an unknown source id (or a read a source does not answer) 404. `readAt` is when the
 * value was read from its venue (live/public-markets.ts readAtOf): for an object its moment, for a list a parallel list of each item's
 * (null where one was not stamped), left out when nothing was stamped. A Map goes over the wire as a list of `[key, value]` entries.
 *
 *   GET  /api/health                                   {ok, service: "market", sources, china, akshare, ifind} — no token named
 *   GET  /api/sources                                  each source: id, name, kind, connectTo, connector, readOnly?, historyApart?,
 *                                                      sessions? (its clock's zone) and `has` (which reads it answers)
 *   GET  /api/source/:id/listings?q=&limit=            Listing[] · readAt[] · notes: string[] (the source's notes, after the listing)
 *   GET  /api/source/:id/line?symbol=                  Listing | null
 *   GET  /api/source/:id/stats?symbols=a,b             [symbol, MarketStats][] (no symbols: the well-known ones)
 *   GET  /api/source/:id/events?category=&closingWithinMs=&limit=   Listing[]
 *   GET  /api/source/:id/candles?symbol=&interval=&since=&until=&limit=&range=&own=   Candle[] | CandlePage
 *   GET  /api/source/:id/book?symbol=&depth=  · /trades?symbol=&limit=  · /settlement?symbol=  · /funding?symbol=&from=&to=
 *   POST /api/source/:id/reset                         {ok: true}: the source's holds here, and its own, let go of
 *   GET  /api/china/rank?sort= · /search?q= · /quotes?symbols=a,b · /history?symbol=&range=   the ChinaSource's value (quotes as
 *                                                      entries), each answer with `status: ChinaStatus` beside it
 *   GET  /api/china/status                             ChinaStatus
 *   GET  /api/price?asset=                             number | null
 *   GET  /api/hub/covers?source=&symbol=               {covers, pricesOnly}
 *   GET  /api/hub/confirmed?source=&symbol=&maxAgeMs=&waitMs=   HubQuote | null (waiting HUB_WAIT_MAX_MS at most)
 *   GET  /api/hub?client=                              server-sent events, one JSON object per `data:` line (HubEvent)
 *   POST /api/hub/hold {client, source, symbol, book, held}     {ok: true}; every hold of a client let go when its /api/hub closes
 *   POST /api/hub/want {client, source, symbol}        value: boolean (hub.want) */
import type express from "express";
import { isRefusal } from "./core/errors.ts";
import type { MarketCore } from "./core.ts";
import type { ChinaSource } from "./live/china.ts";
import type { ChinaRange } from "./live/cn-history.ts";
import { readAtOf, type PublicSource } from "./live/public-markets.ts";
import { IDLE_MS, type HubBook, type HubQuote, type MarketHub } from "./live/stream-hub.ts";
import { CANDLE_INTERVALS, CANDLE_RANGES, HISTORY_MOST, type CandleInterval, type CandleRange, type CandleWindow } from "./live/trade.ts";
import { thrownBy } from "./read-cache.ts";
import { wrap } from "./routes-cn.ts";

/** a caller's own name for itself, as it opens its hub stream (copied from account/src/portfolio/account/stream.ts CLIENT_ID) */
export const CLIENT_ID = /^[A-Za-z0-9_-]{8,48}$/;
/** what goes out at most once a window per market, the latest of what came: the window, ms (account/stream.ts COALESCE_MS) */
export const COALESCE_MS: Readonly<Record<"quote" | "trades" | "book", number>> = { quote: 100, trades: 100, book: 250 };
/** the longest /api/hub/confirmed waits for a word that confirms a price */
export const HUB_WAIT_MAX_MS = 5_000;
/** a comment line on the hub stream this often, so a quiet stream is not taken for a dead one */
export const HEARTBEAT_MS = 15_000;
/** the latest trades a `trades` event carries beside its ring */
export const RECENT_TRADES = 100;

/** one event on /api/hub */
export type HubEvent =
  | { t: "quote"; source: string; symbol: string; quote: HubQuote }
  | { t: "book"; source: string; symbol: string; book: HubBook }
  | { t: "trades"; source: string; symbol: string; ring: Array<{ seq: number; at: number; price: number; snap: boolean }>; evictedSeq: number; recent: ReturnType<MarketHub["trades"]> }
  | { t: "live"; source: string; symbol: string; live: boolean };

const SYMBOL_MAX = 200;
/** the ranges a China history is asked for (live/cn-history.ts ChinaRange) */
const CN_RANGES: readonly ChinaRange[] = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX"];

/** a value as it goes over the wire: a Map as its entries */
const wire = (v: unknown): unknown => (v instanceof Map ? [...v.entries()] : v);
/** when a value was read from its venue: an object's moment, a list's each item's — nothing where nothing was stamped */
function readAtFor(v: unknown): number | Array<number | null> | undefined {
  if (Array.isArray(v)) {
    const at = v.map((x) => readAtOf(x) ?? null);
    return at.some((x) => x !== null) ? at : undefined;
  }
  return readAtOf(v);
}
/** the answer: a refusal as an answer, else the value with when it was read */
function answer(res: express.Response, v: unknown, extra: Record<string, unknown> = {}): void {
  if (isRefusal(v)) return void res.json({ ok: false, refusal: v, ...extra });
  const at = readAtFor(v);
  res.json({ ok: true, value: wire(v) ?? null, ...(at !== undefined ? { readAt: at } : {}), ...extra });
}
const bad = (res: express.Response, error: string): void => void res.status(400).json({ ok: false, error });

/** a query's parameters read one by one: a parameter given twice, too long, or not what it must be is a 400 (sent once, then every read
 * answers undefined and `failed` is true) */
class Ask {
  failed = false;
  constructor(private readonly req: express.Request, private readonly res: express.Response) {}
  private fail(error: string): undefined {
    if (!this.failed) bad(this.res, error);
    this.failed = true;
    return undefined;
  }
  /** a text parameter: absent or empty is undefined unless `need` */
  str(k: string, o: { need?: boolean; max?: number } = {}): string | undefined {
    if (this.failed) return undefined;
    const v = this.req.query[k];
    if (Array.isArray(v) || (v !== undefined && typeof v !== "string")) return this.fail(`"${k}" is given more than once`);
    const s = (v ?? "").trim();
    if (s.length > (o.max ?? SYMBOL_MAX)) return this.fail(`"${k}" is too long`);
    if (!s) return o.need ? this.fail(`"${k}" is needed`) : undefined;
    return s;
  }
  /** a whole number from `lo` to `hi`: absent is `dflt` (needed when there is none) */
  int(k: string, lo: number, hi: number, dflt?: number): number | undefined {
    const s = this.str(k, { max: 20 });
    if (this.failed) return undefined;
    if (s === undefined) return dflt !== undefined ? dflt : this.fail(`"${k}" is needed: a whole number from ${lo} to ${hi}`);
    const n = /^-?\d{1,16}$/.test(s) ? Number(s) : NaN;
    if (!Number.isSafeInteger(n) || n < lo || n > hi) return this.fail(`"${k}" is a whole number from ${lo} to ${hi}`);
    return n;
  }
  /** one of a list's words */
  oneOf<T extends string>(k: string, words: readonly T[], need: boolean): T | undefined {
    const s = this.str(k, { need });
    if (this.failed || s === undefined) return undefined;
    return (words as readonly string[]).includes(s) ? (s as T) : this.fail(`"${k}" is one of ${words.join(", ")}`);
  }
  /** a comma-separated list: absent or empty is undefined */
  list(k: string, most: number): string[] | undefined {
    const s = this.str(k, { max: most * (SYMBOL_MAX + 1) });
    if (this.failed || s === undefined) return undefined;
    const xs = s.split(",").map((x) => x.trim()).filter((x) => x !== "");
    if (xs.length > most) return this.fail(`"${k}" names ${most} at most`);
    return xs.length ? xs : undefined;
  }
}

/** a read the source answers by a method of its own, its throw a refusal like a kept read's */
const asked = <T>(s: PublicSource, run: () => Promise<T>): Promise<T | ReturnType<typeof thrownBy>> => run().catch((err: unknown) => thrownBy(s.id, s.name, err));

/** the source's description as /api/sources gives it */
function described(s: PublicSource) {
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    connectTo: s.connectTo,
    connector: s.connector,
    ...(s.readOnly !== undefined ? { readOnly: s.readOnly } : {}),
    ...(s.historyApart ? { historyApart: true as const } : {}),
    ...(s.sessions ? { sessions: s.sessions.zone } : {}),
    has: { line: !!s.line, stats: !!s.stats, events: !!s.events, candles: !!s.candles, book: !!s.book, trades: !!s.trades, settlement: !!s.settlement, fundingHistory: !!s.fundingHistory, notes: !!s.notes },
  };
}

/** a client of the hub: its streams open now, its holds (by `source|symbol|book`), what it wants until when, the last ring seq it was sent
 * by market */
interface HubClient {
  streams: Set<express.Response>;
  holds: Map<string, { source: string; symbol: string; book: boolean; release: () => void }>;
  wants: Map<string, number>;
  sent: Map<string, number>;
}

export function mountProtocol(app: express.Express, core: MarketCore): void {
  app.get("/api/health", (_req, res) => void res.json({ ok: true, service: "market", sources: core.sources().length, china: !!core.china, akshare: !!core.akshare, ifind: core.cn?.ifind.configured() ?? false }));

  // ---- the sources ---------------------------------------------------------------------------------------------------------------
  app.get("/api/sources", (_req, res) => void res.json({ ok: true, value: core.sources().map(described) }));

  /** the source a route names, or a 404 */
  const sourceOf = (req: express.Request, res: express.Response): PublicSource | undefined => {
    const s = core.source(String(req.params.id ?? ""));
    if (!s) res.status(404).json({ ok: false, error: `the market has no source "${String(req.params.id ?? "").slice(0, 60)}"` });
    return s;
  };
  /** a read the source does not answer: a 404 */
  const answersNo = (res: express.Response, s: PublicSource, what: string) => void res.status(404).json({ ok: false, error: `${s.name} answers no ${what} here` });

  app.get("/api/source/:id/listings", wrap(async (req, res) => {
    const s = sourceOf(req, res);
    if (!s) return;
    const a = new Ask(req, res);
    const q = a.str("q");
    const limit = a.int("limit", 1, 5_000);
    if (a.failed) return;
    const v = await s.listings({ ...(q !== undefined ? { q } : {}), limit: limit! });
    if (isRefusal(v)) return answer(res, v);
    answer(res, v, { notes: s.notes?.({ q }) ?? [] });
  }));
  app.get("/api/source/:id/line", wrap(async (req, res) => {
    const s = sourceOf(req, res);
    if (!s) return;
    if (!s.line) return answersNo(res, s, "line");
    const a = new Ask(req, res);
    const symbol = a.str("symbol", { need: true });
    if (a.failed) return;
    answer(res, await s.line(symbol!));
  }));
  app.get("/api/source/:id/stats", wrap(async (req, res) => {
    const s = sourceOf(req, res);
    if (!s) return;
    if (!s.stats) return answersNo(res, s, "24-hour stats");
    const a = new Ask(req, res);
    const symbols = a.list("symbols", 500);
    if (a.failed) return;
    answer(res, await s.stats(symbols));
  }));
  app.get("/api/source/:id/events", wrap(async (req, res) => {
    const s = sourceOf(req, res);
    if (!s) return;
    if (!s.events) return answersNo(res, s, "events");
    const a = new Ask(req, res);
    const category = a.str("category");
    const closingWithinMs = a.str("closingWithinMs") !== undefined ? a.int("closingWithinMs", 0, Number.MAX_SAFE_INTEGER) : undefined;
    const limit = a.int("limit", 1, 5_000);
    if (a.failed) return;
    answer(res, await s.events({ ...(category !== undefined ? { category } : {}), ...(closingWithinMs !== undefined ? { closingWithinMs } : {}), limit: limit! }));
  }));
  app.get("/api/source/:id/candles", wrap(async (req, res) => {
    const s = sourceOf(req, res);
    if (!s) return;
    if (!s.candles) return answersNo(res, s, "price history");
    const a = new Ask(req, res);
    const symbol = a.str("symbol", { need: true });
    const interval = a.oneOf<CandleInterval>("interval", CANDLE_INTERVALS, true);
    const since = a.str("since") !== undefined ? a.int("since", 0, Number.MAX_SAFE_INTEGER) : undefined;
    const until = a.str("until") !== undefined ? a.int("until", 0, Number.MAX_SAFE_INTEGER) : undefined;
    const limit = a.str("limit") !== undefined ? a.int("limit", 1, HISTORY_MOST) : undefined;
    const range = a.oneOf<CandleRange>("range", CANDLE_RANGES, false);
    const own = a.oneOf("own", ["true"] as const, false);
    if (a.failed) return;
    const w: CandleWindow = { ...(since !== undefined ? { since } : {}), ...(until !== undefined ? { until } : {}), ...(limit !== undefined ? { limit } : {}), ...(range !== undefined ? { range } : {}), ...(own ? { own: true as const } : {}) };
    answer(res, await s.candles(symbol!, interval!, w));
  }));
  app.get("/api/source/:id/book", wrap(async (req, res) => {
    const s = sourceOf(req, res);
    if (!s) return;
    if (!s.book) return answersNo(res, s, "book");
    const a = new Ask(req, res);
    const symbol = a.str("symbol", { need: true });
    const depth = a.int("depth", 1, 50, 20);
    if (a.failed) return;
    answer(res, await asked(s, () => s.book!(symbol!, depth!)));
  }));
  app.get("/api/source/:id/trades", wrap(async (req, res) => {
    const s = sourceOf(req, res);
    if (!s) return;
    if (!s.trades) return answersNo(res, s, "trades");
    const a = new Ask(req, res);
    const symbol = a.str("symbol", { need: true });
    const limit = a.int("limit", 1, 100, 30);
    if (a.failed) return;
    answer(res, await asked(s, () => s.trades!(symbol!, limit!)));
  }));
  app.get("/api/source/:id/settlement", wrap(async (req, res) => {
    const s = sourceOf(req, res);
    if (!s) return;
    if (!s.settlement) return answersNo(res, s, "settlement");
    const a = new Ask(req, res);
    const symbol = a.str("symbol", { need: true });
    if (a.failed) return;
    answer(res, await asked(s, () => s.settlement!(symbol!)));
  }));
  app.get("/api/source/:id/funding", wrap(async (req, res) => {
    const s = sourceOf(req, res);
    if (!s) return;
    if (!s.fundingHistory) return answersNo(res, s, "funding history");
    const a = new Ask(req, res);
    const symbol = a.str("symbol", { need: true });
    const from = a.int("from", 0, Number.MAX_SAFE_INTEGER);
    const to = a.int("to", 0, Number.MAX_SAFE_INTEGER);
    if (a.failed) return;
    answer(res, await asked(s, () => s.fundingHistory!(symbol!, from!, to!)));
  }));
  app.post("/api/source/:id/reset", (req, res) => {
    const s = sourceOf(req, res);
    if (!s) return;
    s.reset?.();
    res.json({ ok: true });
  });

  // ---- China and a price ----------------------------------------------------------------------------------------------------------
  const china = (res: express.Response): ChinaSource | undefined => {
    if (!core.china) res.status(404).json({ ok: false, error: "the market reads no China here" });
    return core.china;
  };
  app.get("/api/china/rank", wrap(async (req, res) => {
    const c = china(res);
    if (!c) return;
    const a = new Ask(req, res);
    const sort = a.oneOf("sort", ["volume", "movers"] as const, true);
    if (a.failed) return;
    const v = await c.rank(sort!);
    answer(res, v, { status: c.status() });
  }));
  app.get("/api/china/search", wrap(async (req, res) => {
    const c = china(res);
    if (!c) return;
    const a = new Ask(req, res);
    const q = a.str("q", { need: true });
    if (a.failed) return;
    const v = await c.search(q!);
    answer(res, v, { status: c.status() });
  }));
  app.get("/api/china/quotes", wrap(async (req, res) => {
    const c = china(res);
    if (!c) return;
    const a = new Ask(req, res);
    const symbols = a.list("symbols", 30);
    if (a.failed) return;
    if (!symbols) return bad(res, `"symbols" is needed`);
    const v = await c.quotes(symbols);
    answer(res, v, { status: c.status() });
  }));
  app.get("/api/china/history", wrap(async (req, res) => {
    const c = china(res);
    if (!c) return;
    const a = new Ask(req, res);
    const symbol = a.str("symbol", { need: true });
    const range = a.oneOf("range", CN_RANGES, true);
    if (a.failed) return;
    const v = await c.history(symbol!, range!);
    answer(res, v, { status: c.status() });
  }));
  app.get("/api/china/status", (_req, res) => {
    const c = china(res);
    if (!c) return;
    res.json({ ok: true, value: c.status() });
  });
  app.get("/api/price", wrap(async (req, res) => {
    const a = new Ask(req, res);
    const asset = a.str("asset", { need: true, max: 40 });
    if (a.failed) return;
    const p = await core.price(asset!).catch(() => undefined);
    res.json({ ok: true, value: typeof p === "number" && Number.isFinite(p) ? p : null });
  }));

  mountHub(app, core.hub);
}

/** the hub's routes: covers, confirmed, the stream, holds and wants */
function mountHub(app: express.Express, hub: MarketHub | undefined): void {
  const clients = new Map<string, HubClient>();
  const clientOf = (id: string): HubClient => {
    let c = clients.get(id);
    if (!c) clients.set(id, (c = { streams: new Set(), holds: new Map(), wants: new Map(), sent: new Map() }));
    return c;
  };
  /** whether a client is told of a market: it holds it, or wanted it within IDLE_MS; its book only for a book hold */
  const follows = (c: HubClient, k: string, now: number): boolean => {
    for (const h of c.holds.values()) if (`${h.source}|${h.symbol}` === k) return true;
    const until = c.wants.get(k);
    return until !== undefined && until > now;
  };
  const followsBook = (c: HubClient, k: string): boolean => c.holds.has(`${k}|book`);
  const send = (c: HubClient, e: HubEvent): void => {
    const line = "data: " + JSON.stringify(e) + "\n\n";
    for (const r of c.streams) r.write(line);
  };
  /** one market's word to each client that follows it, as the hub has it when it goes out */
  const tell = (what: "quote" | "book" | "trades", source: string, symbol: string, only?: HubClient): void => {
    if (!hub) return;
    const k = `${source}|${symbol}`;
    const now = Date.now();
    if (what !== "quote" && hub.pricesOnly?.(source, symbol) === true) return;
    for (const c of only ? [only] : clients.values()) {
      if (!c.streams.size || !follows(c, k, now)) continue;
      if (what === "quote") {
        const quote = hub.quote(source, symbol);
        if (quote) send(c, { t: "quote", source, symbol, quote });
      } else if (what === "book") {
        if (!followsBook(c, k)) continue;
        const book = hub.book(source, symbol);
        if (book) send(c, { t: "book", source, symbol, book });
      } else {
        const after = c.sent.get(k) ?? 0;
        const r = hub.ring?.(source, symbol, after) ?? { trades: [], evictedSeq: 0 };
        const last = r.trades.reduce((m, t) => Math.max(m, t.seq), after);
        c.sent.set(k, last);
        send(c, { t: "trades", source, symbol, ring: r.trades, evictedSeq: r.evictedSeq, recent: hub.trades(source, symbol, RECENT_TRADES) });
      }
    }
  };
  /** at most once a window per market: the latest of what came, written when it goes out */
  const due = new Map<string, ReturnType<typeof setTimeout>>();
  const later = (what: "quote" | "book" | "trades", source: string, symbol: string): void => {
    const key = `${what}|${source}|${symbol}`;
    if (due.has(key)) return;
    const t = setTimeout(() => {
      due.delete(key);
      tell(what, source, symbol);
    }, COALESCE_MS[what]);
    t.unref?.();
    due.set(key, t);
  };
  if (hub) {
    hub.onTick((t) => {
      const k = `${t.source}|${t.symbol}`;
      const now = Date.now();
      let any = false;
      for (const c of clients.values()) if (c.streams.size && follows(c, k, now)) any = true;
      if (!any) return;
      if (t.what === "live") {
        const live = hub.quote(t.source, t.symbol)?.live === true;
        for (const c of clients.values()) if (c.streams.size && follows(c, k, now)) send(c, { t: "live", source: t.source, symbol: t.symbol, live });
        later("quote", t.source, t.symbol);
        later("book", t.source, t.symbol);
        return;
      }
      later(t.what, t.source, t.symbol);
    });
  }

  app.get("/api/hub/covers", (req, res) => {
    const a = new Ask(req, res);
    const source = a.str("source", { need: true });
    const symbol = a.str("symbol");
    if (a.failed) return;
    const covers = !!hub && symbol !== undefined && hub.covers(source!, symbol);
    res.json({ ok: true, value: { covers, pricesOnly: covers && hub!.pricesOnly?.(source!, symbol!) === true } });
  });
  app.get("/api/hub/confirmed", wrap(async (req, res) => {
    const a = new Ask(req, res);
    const source = a.str("source", { need: true });
    const symbol = a.str("symbol", { need: true });
    const maxAgeMs = a.int("maxAgeMs", 0, 86_400_000);
    const waitMs = a.int("waitMs", 0, Number.MAX_SAFE_INTEGER, 0);
    if (a.failed) return;
    const q = hub ? await hub.confirmed(source!, symbol!, maxAgeMs!, Math.min(waitMs!, HUB_WAIT_MAX_MS)) : undefined;
    res.json({ ok: true, value: q ?? null });
  }));
  app.get("/api/hub", (req, res) => {
    const a = new Ask(req, res);
    const id = a.str("client", { need: true, max: 48 });
    if (a.failed) return;
    if (!CLIENT_ID.test(id!)) return bad(res, `"client" is 8 to 48 letters, digits, "-" or "_"`);
    const c = clientOf(id!);
    res.status(200).set({ "content-type": "text/event-stream", connection: "keep-alive" });
    res.flushHeaders();
    res.write(":\n\n");
    c.streams.add(res);
    const beat = setInterval(() => res.write(":\n\n"), HEARTBEAT_MS);
    beat.unref?.();
    res.on("close", () => {
      clearInterval(beat);
      c.streams.delete(res);
      if (c.streams.size) return;
      // the client's last stream closed: every hold of it let go, its wants and what it was sent forgotten
      for (const h of c.holds.values()) h.release();
      clients.delete(id!);
    });
    // what it holds already (a hold sent before its stream opened, or a stream opened again) is told as the hub has it now
    for (const h of c.holds.values()) {
      tell("quote", h.source, h.symbol, c);
      if (h.book) tell("book", h.source, h.symbol, c);
    }
  });

  /** a hold's or a want's body, or a 400 */
  const bodyOf = (req: express.Request, res: express.Response): { client: string; source: string; symbol: string; b: Record<string, unknown> } | undefined => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const s = (v: unknown, max: number) => typeof v === "string" && v.trim() !== "" && v.length <= max;
    if (!s(b.client, 48) || !CLIENT_ID.test(b.client as string)) return void bad(res, `"client" is 8 to 48 letters, digits, "-" or "_"`);
    if (!s(b.source, 60) || !s(b.symbol, SYMBOL_MAX)) return void bad(res, `"source" and "symbol" are needed`);
    return { client: b.client as string, source: (b.source as string).trim(), symbol: (b.symbol as string).trim(), b };
  };
  app.post("/api/hub/hold", (req, res) => {
    const x = bodyOf(req, res);
    if (!x) return;
    if (typeof x.b.held !== "boolean") return bad(res, `"held" is true or false`);
    if (x.b.book !== undefined && typeof x.b.book !== "boolean") return bad(res, `"book" is true or false`);
    const book = x.b.book === true;
    const key = `${x.source}|${x.symbol}${book ? "|book" : ""}`;
    if (x.b.held) {
      const c = clientOf(x.client);
      if (!c.holds.has(key) && hub) {
        c.holds.set(key, { source: x.source, symbol: x.symbol, book, release: hub.hold(x.source, x.symbol, { book }) });
        tell("quote", x.source, x.symbol, c);
        if (book) tell("book", x.source, x.symbol, c);
      }
    } else {
      const c = clients.get(x.client);
      const h = c?.holds.get(key);
      if (c && h) {
        h.release();
        c.holds.delete(key);
      }
    }
    res.json({ ok: true });
  });
  app.post("/api/hub/want", (req, res) => {
    const x = bodyOf(req, res);
    if (!x) return;
    const wanted = hub ? hub.want(x.source, x.symbol) : false;
    // a client with no stream open is told nothing: its want is the hub's alone
    if (wanted && clients.get(x.client)?.streams.size) clients.get(x.client)!.wants.set(`${x.source}|${x.symbol}`, Date.now() + IDLE_MS);
    res.json({ ok: true, value: wanted });
  });
}
