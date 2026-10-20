/** `GET /data/bars?id=&days=`: daily bars for one us instrument, for the Market page's chart.
 *
 * A thin cache in front of `scripts/face_bars.py`, built like data.ts's producer routes, with the two
 * differences this route needs. Its argv carries a SYMBOL and a DAY COUNT — both checked first
 * ({@link parseBarsRequest}: the face's us grammar through `parseInstrumentId`, an integer in
 * {@link BARS_DAYS}) — so no unvalidated request data reaches the child. And its cache is per key
 * (`SYMBOL:DAYS`), bounded to {@link BARS_CACHE_LIMIT} keys and least-recently-used, where the producer
 * routes keep one entry per mode. The rest are the producer routes' rules: the fence first, GET only,
 * single flight, stale on error, and the child's stderr never in a body.
 * @module
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { FORBIDDEN, HttpError, markStale } from "./http.ts";
import { parseInstrumentId } from "./quotes.ts";
import type { RouteRegistrar } from "./static.ts";
import type { Spawner } from "./data.ts";

/** Daily bars change once a day; ten minutes keeps a reopened page from spawning again. */
export const BARS_TTL_MS = 600_000;
/** Most keys kept; the least recently used leaves first. */
export const BARS_CACHE_LIMIT = 64;
/** One read: the producer's own live deadline is 12 s, the bed read a parquet file. */
export const BARS_TIMEOUT_MS = 30_000;
/** The day counts a request may ask for, and the one it gets when it names none. */
export const BARS_DAYS = { min: 5, max: 730, fallback: 120 } as const;

const INVALID = "invalid bars request";
const PRODUCER_FAILED = '{"ok":false,"error":"producer failed"}';

/** The one symbol and day count a request names, checked; anything else is a 400 with fixed text. */
export function parseBarsRequest(rawUrl: string): { symbol: string; days: number } {
  if (rawUrl.length > 2048 || /%(?![a-f\d]{2})/i.test(rawUrl)) throw new HttpError(400, INVALID);
  const url = new URL(rawUrl, "http://localhost");
  const ids = url.searchParams.getAll("id");
  const dayParams = url.searchParams.getAll("days");
  if (ids.length !== 1 || dayParams.length > 1) throw new HttpError(400, INVALID);
  const identity = parseInstrumentId(ids[0]!);
  if (!identity || identity.market !== "us") throw new HttpError(400, INVALID);
  let days: number = BARS_DAYS.fallback;
  if (dayParams.length === 1) {
    if (!/^\d+$/.test(dayParams[0]!)) throw new HttpError(400, INVALID);
    days = Number(dayParams[0]);
    if (days < BARS_DAYS.min || days > BARS_DAYS.max) throw new HttpError(400, INVALID);
  }
  return { symbol: identity.symbol, days };
}

/**
 * Mount `exact /data/bars`.
 * @param webServer - the host webserver service, or a test recorder.
 * @param opts - `isTrusted` (data.ts's fence), `spawn` (data.ts's spawner), `script` (the producer's
 * absolute path), `now` (default `Date.now`).
 */
export function registerBarsRoute(
  webServer: RouteRegistrar,
  opts: { isTrusted: (req: IncomingMessage) => boolean; spawn: Spawner; script: string; now?: () => number },
): void {
  const now = opts.now ?? Date.now;
  /* A Map iterates in insertion order: re-inserting a key on every use keeps the least recently used first. */
  const cache = new Map<string, { body: string; at: number }>();
  const inflight = new Map<string, Promise<{ stdout: string; code: number }>>();

  const send = (res: ServerResponse, status: number, body: string): void => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(body);
  };
  const remember = (key: string, body: string): void => {
    cache.delete(key);
    cache.set(key, { body, at: now() });
    while (cache.size > BARS_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  };

  webServer.register({
    kind: "exact",
    path: "/data/bars",
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      /* FIRST: a refused request reaches neither the parser nor the cache nor a child. */
      if (!opts.isTrusted(req)) return send(res, 403, FORBIDDEN);
      if (req.method !== "GET") return send(res, 405, JSON.stringify({ ok: false, error: "method not allowed" }));
      let request: { symbol: string; days: number };
      try {
        request = parseBarsRequest(req.url ?? "");
      } catch (err) {
        if (err instanceof HttpError) return send(res, err.status, JSON.stringify({ ok: false, error: err.message }));
        throw err;
      }
      const key = `${request.symbol}:${request.days}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < BARS_TTL_MS) {
        cache.delete(key);
        cache.set(key, hit);
        return send(res, 200, hit.body);
      }

      let flight = inflight.get(key);
      if (!flight) {
        flight = opts.spawn([opts.script, request.symbol, String(request.days)], BARS_TIMEOUT_MS);
        inflight.set(key, flight);
        /* `then(clear, clear)`, as data.ts does: a `finally` would derive an unawaited rejection. */
        const clear = (): void => void inflight.delete(key);
        void flight.then(clear, clear);
      }

      try {
        const { stdout, code } = await flight;
        if (code === 0 && stdout !== "") {
          remember(key, stdout);
          return send(res, 200, stdout);
        }
        if (hit) return send(res, 200, markStale(hit.body));
        return send(res, 503, stdout || PRODUCER_FAILED);
      } catch (err) {
        if (hit) return send(res, 200, markStale(hit.body));
        /* Fixed text plus the error's code, never its message: execFile's message carries the child's stderr. */
        const raw = (err as { code?: unknown } | null)?.code;
        const code = typeof raw === "string" || typeof raw === "number" ? raw : null;
        return send(res, 503, JSON.stringify({ ok: false, error: "producer spawn failed", code }));
      }
    },
  });
}
