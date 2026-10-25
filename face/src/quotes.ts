/** On-demand A-share quote hub: one shared iFinD poll for every subscribed
 * `cn` id, a bounded latest-value cache, and no market-directory or PIT reads. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError, FORBIDDEN } from "./http.ts";
import type { RouteRegistrar } from "./static.ts";
import { createQuoteSnapshots } from "./quote-snapshots.ts";
import type { LiveQuote, ProviderState, QuoteIdentity, QuotePayload, QuoteUpdate, SnapshotSource } from "./quote-types.ts";

export const QUOTE_LIMIT = 100;
export const QUOTE_CLIENT_LIMIT = 8;
const CACHE_LIMIT = 512;
const CACHE_MS = 5_000;
const PROVIDERS = { cn: "ifind" } as const;
/** The ids the face quoted before the Account's graft (`us:AAPL`, `crypto:BTC/USD`): well-formed still, quoted by no
 * one now — a request naming one is answered without it, not refused. */
const RETIRED = /^(?:us:[A-Z][A-Z0-9.-]{0,14}|crypto:[A-Z0-9]{1,15}\/[A-Z0-9]{2,10})$/;

/** One instrument id in the face's grammar — `cn:600519` — or null. The one check the quote routes make; it admits
 * six digits and nothing else. */
export function parseInstrumentId(raw: string): QuoteIdentity | null {
  const [market, symbol, extra] = raw.trim().split(":");
  if (extra !== undefined || market !== "cn" || !symbol || !/^\d{6}$/.test(symbol)) return null;
  return { id: `cn:${symbol}`, market: "cn", symbol };
}

export function parseQuoteRequest(rawUrl: string): QuoteIdentity[] {
  if (rawUrl.length > 8192 || /%(?![a-f\d]{2})/i.test(rawUrl)) throw new HttpError(400, "invalid quote request");
  const url = new URL(rawUrl, "http://localhost");
  if (url.searchParams.getAll("ids").length !== 1) throw new HttpError(400, "ids is required");
  const raw = url.searchParams.get("ids")!;
  if (!raw.trim()) return [];
  const parts = raw.split(",");
  if (parts.length > QUOTE_LIMIT) throw new HttpError(400, `最多同时查询 ${QUOTE_LIMIT} 个自选。`);
  const assets = new Map<string, QuoteIdentity>();
  for (const part of parts) {
    const identity = parseInstrumentId(part);
    if (identity) assets.set(identity.id, identity);
    else if (!RETIRED.test(part.trim())) throw new HttpError(400, "invalid quote symbol");
  }
  return [...assets.values()];
}

function initialProvider(): ProviderState {
  return { id: PROVIDERS.cn, market: "cn", status: "connecting", source: "iFinD", feed: "", transport: "poll", message: "正在连接行情…" };
}
function initialQuote(asset: QuoteIdentity): LiveQuote {
  return { ...asset, price: null, prev_close: null, change: null, change_pct: null, volume: null,
    as_of: null, received_at: null, volume_as_of: null, source: "iFinD",
    feed: "", basis: "previous_close", quote_status: "unavailable",
    market_status: "unknown", message: "正在连接行情…" };
}
const usable = (state?: ProviderState): boolean => state?.status === "connected" || state?.status === "limited";
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const quoteDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" });
function eventOrder(value: string): bigint {
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? "";
  return BigInt(Date.parse(value)) * 1_000_000n + BigInt(fraction.padEnd(9, "0").slice(3, 9));
}

export interface QuoteHub {
  snapshot(assets: QuoteIdentity[]): Promise<QuotePayload>;
  subscribe(assets: QuoteIdentity[], listener: (payload: QuotePayload) => void): () => void;
  close(): void;
}
export function createQuoteHub(options: {
  snapshots?: SnapshotSource;
  now?: () => number;
  ifindPollMs?: number;
} = {}): QuoteHub {
  const now = options.now ?? Date.now;
  const snapshots = options.snapshots ?? createQuoteSnapshots();
  const cache = new Map<string, LiveQuote>();
  const attempts = new Map<string, number>();
  let polled: ProviderState | undefined;
  const pinned = new Map<string, number>();
  const quoteErrors = new Set<string>();
  let snapshotClients = 0;
  const clients = new Set<{ assets: QuoteIdentity[]; listener: (payload: QuotePayload) => void }>();
  let active = new Map<string, QuoteIdentity>();
  let flight: Promise<void> | undefined;
  let flightController: AbortController | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let notifyTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const configuredPoll = Number(process.env.FACE_IFIND_POLL_MS);
  const ifindPollMs = Math.max(15_000, options.ifindPollMs ?? (Number.isFinite(configuredPoll) && configuredPoll > 0 ? configuredPoll : 30_000));

  const provider = (): ProviderState => polled ?? initialProvider();
  /** Every payload names iFinD, the face's one provider, whatever was asked. */
  function payload(assets: QuoteIdentity[]): QuotePayload {
    const state = provider();
    return { ok: true, generated_at: new Date(now()).toISOString(),
      quotes: assets.map((asset) => {
        const quote = { ...(cache.get(asset.id) ?? initialQuote(asset)) };
        quote.transport = "poll";
        if (quote.price === null || quote.as_of === null) {
          quote.quote_status = "unavailable";
          quote.message = quote.message && quote.message !== "正在连接行情…" ? quote.message : state.message;
        } else {
          const old = quote.market_status !== "closed" && now() - Date.parse(quote.as_of) > 5 * 60_000;
          quote.quote_status = !usable(state) || old || quoteErrors.has(asset.id) ? "stale" : "live";
          if (!usable(state)) quote.message = state.message || "行情连接已断开，保留上次报价。";
          else if (old && !quote.message) quote.message = "最近成交时间较早，请留意行情时间。";
        }
        return quote;
      }), providers: [state] };
  }
  function publish(): void {
    if (disposed || notifyTimer || clients.size === 0) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = undefined;
      for (const client of clients) client.listener(payload(client.assets));
    }, 500);
    notifyTimer.unref();
  }
  function merge(update: QuoteUpdate): void {
    const quote = cache.get(update.id);
    if (!quote) return; // A removed or never-requested symbol cannot grow the cache.
    const incomingTime = timestamp(update.as_of) ? eventOrder(update.as_of) : null;
    const previousTime = quote.as_of ? eventOrder(quote.as_of) : null;
    const recent = incomingTime !== null && (previousTime === null || incomingTime >= previousTime);
    const day = (value: string) => quoteDay.format(new Date(value));
    const validPrice = finite(update.price) && update.price > 0 && recent;
    if (validPrice) {
      if (quote.as_of && day(quote.as_of) !== day(update.as_of!)) {
        quote.prev_close = null; quote.volume = null; quote.volume_as_of = null;
      }
      quote.price = update.price!;
      quote.as_of = update.as_of!;
      quote.received_at = new Date(now()).toISOString();
      quote.source = update.source;
      quote.feed = update.feed;
      quote.basis = update.basis;
      quote.message = update.message ?? "";
      quoteErrors.delete(update.id);
    } else if (update.message) { quote.message = update.message; quoteErrors.add(update.id); }
    // The prior close belongs to the session of the trade it is reported with.
    const matchingSession = timestamp(update.as_of) && quote.as_of && day(update.as_of) === day(quote.as_of);
    if (finite(update.prev_close) && update.prev_close > 0 && matchingSession) quote.prev_close = update.prev_close;
    else if (update.prev_close === null && recent) quote.prev_close = null;
    const incomingVolumeTime = timestamp(update.volume_as_of) ? Date.parse(update.volume_as_of) : NaN;
    const currentVolumeSession = !quote.as_of || timestamp(update.volume_as_of) && day(update.volume_as_of) === day(quote.as_of);
    if (finite(update.volume) && update.volume >= 0 && currentVolumeSession && (
      quote.volume === null || Number.isFinite(incomingVolumeTime) && incomingVolumeTime >= Date.parse(quote.volume_as_of ?? "1970-01-01")
      || quote.volume_as_of === null && (incomingTime === null || recent)
    )) {
      quote.volume = update.volume;
      quote.volume_as_of = timestamp(update.volume_as_of) ? update.volume_as_of : null;
    } else if (update.volume === null && recent) { quote.volume = null; quote.volume_as_of = null; }
    if (update.market_status) quote.market_status = update.market_status;
    if (!quote.feed) { quote.source = update.source; quote.feed = update.feed; quote.basis = update.basis; }
    quote.change = quote.price !== null && quote.prev_close !== null ? quote.price - quote.prev_close : null;
    quote.change_pct = quote.change !== null && quote.prev_close !== null ? quote.change / quote.prev_close * 100 : null;
    publish();
  }

  function reserve(assets: QuoteIdentity[]): void {
    for (const asset of assets) if (!cache.has(asset.id)) cache.set(asset.id, initialQuote(asset));
    if (cache.size > CACHE_LIMIT) for (const id of cache.keys()) {
      if (!active.has(id) && !pinned.has(id) && !assets.some((asset) => asset.id === id)) {
        cache.delete(id); attempts.delete(id); quoteErrors.delete(id);
      }
      if (cache.size <= CACHE_LIMIT) break;
    }
  }
  async function refresh(assets: QuoteIdentity[], maxAge = CACHE_MS): Promise<void> {
    if (disposed || assets.length === 0) return;
    reserve(assets);
    const pending = assets.filter((asset) => now() - (attempts.get(asset.id) ?? -Infinity) >= maxAge);
    if (!pending.length) return;
    if (flight) { await flight; return refresh(assets, maxAge); }
    for (const asset of pending) attempts.set(asset.id, now());
    flightController = new AbortController();
    const controller = flightController;
    const deadline = setTimeout(() => controller.abort(), 8_000);
    flight = (async () => {
      try {
        const result = await snapshots.load(pending, controller.signal);
        if (disposed) return;
        for (const update of result.updates) merge(update);
        for (const state of result.providers) polled = state;
      } catch {
        polled = { ...initialProvider(), status: "error", message: "行情查询失败，请稍后重试。" };
      } finally {
        clearTimeout(deadline);
        for (const asset of pending) attempts.set(asset.id, now());
        flight = undefined; flightController = undefined; publish();
      }
    })();
    await flight;
  }
  function sync(): void {
    active = new Map([...clients].flatMap((client) => client.assets.map((asset) => [asset.id, asset] as const)));
    reserve([...active.values()]);
    if (active.size && !pollTimer) {
      pollTimer = setInterval(() => {
        const due = [...active.values()].filter((asset) => now() - (attempts.get(asset.id) ?? -Infinity) >= ifindPollMs);
        void refresh(due);
        publish();
      }, 5_000);
      pollTimer.unref();
    } else if (!active.size && pollTimer) { clearInterval(pollTimer); pollTimer = undefined; }
    void refresh([...active.values()]);
  }
  return {
    async snapshot(assets) {
      if (snapshotClients >= QUOTE_CLIENT_LIMIT || new Set([...active.keys(), ...pinned.keys(), ...assets.map((asset) => asset.id)]).size > CACHE_LIMIT) {
        throw new HttpError(429, "行情请求过多，请稍后重试。");
      }
      snapshotClients++;
      for (const asset of assets) pinned.set(asset.id, (pinned.get(asset.id) ?? 0) + 1);
      try { await refresh(assets); return payload(assets); }
      finally {
        snapshotClients--;
        for (const asset of assets) { const count = pinned.get(asset.id)! - 1; if (count) pinned.set(asset.id, count); else pinned.delete(asset.id); }
      }
    },
    subscribe(assets, listener) {
      if (disposed) throw new HttpError(503, "行情服务已停止。");
      if (clients.size >= QUOTE_CLIENT_LIMIT) throw new HttpError(429, "行情连接过多，请关闭多余页面。");
      const union = new Set([...active.keys(), ...assets.map((asset) => asset.id)]);
      if (union.size > 200 || new Set([...union, ...pinned.keys()]).size > CACHE_LIMIT) throw new HttpError(429, "同时订阅的标的过多。");
      const client = { assets, listener };
      clients.add(client); sync(); listener(payload(assets));
      return () => { if (clients.delete(client)) sync(); };
    },
    close() {
      disposed = true; clients.clear();
      flightController?.abort();
      clearInterval(pollTimer); clearTimeout(notifyTimer);
    },
  };
}

export function registerQuoteRoutes(webServer: RouteRegistrar, options: {
  isTrusted: (req: IncomingMessage) => boolean;
  hub?: QuoteHub;
}): () => void {
  const hub = options.hub ?? createQuoteHub();
  const connections = new Set<() => void>();
  const json = (res: ServerResponse, status: number, value: unknown): void => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(typeof value === "string" ? value : JSON.stringify(value));
  };
  const handle = (streaming: boolean) => async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!options.isTrusted(req)) return json(res, 403, FORBIDDEN);
    if (req.method !== "GET") return json(res, 405, { ok: false, error: "method not allowed" });
    try {
      const assets = parseQuoteRequest(req.url ?? "");
      if (!streaming) return json(res, 200, await hub.snapshot(assets));
      let ended = false;
      let unsubscribe: (() => void) | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const stop = (destroy = false): void => {
        if (ended) return;
        ended = true; clearInterval(heartbeat); unsubscribe?.();
        connections.delete(stop);
        if (destroy) res.destroy(); else res.end();
      };
      // Subscribe before committing headers so quota errors can still be JSON.
      let initial: QuotePayload | undefined;
      let ready = false;
      unsubscribe = hub.subscribe(assets, (value) => {
        if (!ready) { initial = value; return; }
        if (ended || res.destroyed) return stop();
        // A slow browser gets disconnected rather than an unbounded buffer.
        if (res.writableLength > 256 * 1024) return stop(true);
        res.write(`event: quotes\ndata: ${JSON.stringify(value)}\n\n`);
      });
      connections.add(stop);
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform",
        connection: "keep-alive", "x-accel-buffering": "no" });
      ready = true;
      res.write(`retry: 3000\n\nevent: quotes\ndata: ${JSON.stringify(initial)}\n\n`);
      heartbeat = setInterval(() => {
        if (res.destroyed || res.writableLength > 256 * 1024) return stop(true);
        res.write(`event: heartbeat\ndata: ${JSON.stringify({ generated_at: new Date().toISOString() })}\n\n`);
      }, 15_000);
      heartbeat.unref();
      res.once("close", () => stop()); res.once("error", () => stop(true));
      if (res.destroyed) stop();
    } catch (error) {
      json(res, error instanceof HttpError ? error.status : 503,
        { ok: false, error: error instanceof HttpError ? error.message : "行情服务暂不可用。" });
    }
  };
  webServer.register({ kind: "exact", path: "/data/quotes", handler: handle(false) });
  webServer.register({ kind: "exact", path: "/data/quotes/stream", handler: handle(true) });
  return () => { for (const stop of connections) stop(); hub.close(); };
}
