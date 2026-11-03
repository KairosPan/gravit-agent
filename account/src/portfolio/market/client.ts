/** THE ACCOUNT'S TRANSPORT TO THE MARKET (plan A1 task 4): plain HTTP to the market service (127.0.0.1:4821, PORTFOLIO_MARKET_URL), and
 * nothing else of the market's — the account never reads a public venue, China, AKShare or iFinD itself. Three ways to ask:
 *
 *   get     a protocol answer (the market's protocol.ts: `{ok: true, value, readAt?}` or `{ok: false, refusal}`): the value, stamped as read
 *           when the market says it was (shapes.ts readLike — a paper account prices by that moment, never by when it was handed on), with the
 *           envelope's other fields beside it (`notes`, China's `status`); or the refusal it carried; or, where the market did not answer,
 *           marketDown(). Kept `ttlMs` and shared while on its way; a refusal is kept two seconds at most
 *   post    a protocol write (a hub hold or want, a source's reset): its value, or a refusal
 *   raw     a relay (Lunhui's and AKShare's routes): the market's Response as it came, never parsed, or marketDown()
 *
 * A network error, a timeout, a body that is not JSON or a 5xx is the market not answering: marketDown(), and `staleSince` says since when.
 * Any request it answers clears it. No `Origin` header is sent (the market's fence refuses a foreign one). */
import { isRefusal, type Refusal } from "../../core/errors.ts";
import { no } from "../refuse.ts";
import { MARKET_DOWN_HOLD_MS, readLike } from "./shapes.ts";

export const MARKET_URL_DEFAULT = "http://127.0.0.1:4821";
/** the one sentence the account says while the market does not answer */
export const MARKET_DOWN = "The market service is not answering, so prices here are not current.";
/** the market not answering: `native.market` "down" marks it as the market service's, not a venue's, so the account holds a source back
 * for it only MARKET_DOWN_HOLD_MS (shapes.ts holdBackMs) — a market that is back is asked again within seconds */
export function marketDown(): Refusal {
  return no("E_VENUE_UNREACHABLE", { venue: "market", message: MARKET_DOWN, native: { market: "down" } });
}

export interface MarketClient {
  readonly url: string;
  /** a protocol answer: value (restamped with readLike from readAt), the refusal it carried, or marketDown() — kept ttlMs, shared in flight */
  get<T>(path: string, ttlMs: number): Promise<{ value: T; extra: Record<string, unknown> } | Refusal>;
  post<T>(path: string, body: unknown): Promise<T | Refusal>;
  /** a relay: the market's Response as it came, or marketDown() — never parsed */
  raw(path: string, init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string | Uint8Array; signal?: AbortSignal; timeoutMs: number }): Promise<Response | Refusal>;
  /** the first failure since the last answer, ms; undefined while it answers */
  staleSince(): number | undefined;
  /** when the market last answered anything, ms; undefined before it has */
  answeredAt(): number | undefined;
  /** told at the first failure after an answer (the moment staleSince goes from undefined to set), not at each failure after it;
   * returns the unsubscribe */
  onFail(fn: () => void): () => void;
}

/** the longest a refusal is kept: a market that comes back is asked again within this (shapes.ts MARKET_DOWN_HOLD_MS is the same) */
export const REFUSAL_KEEP_MS = MARKET_DOWN_HOLD_MS;
/** past this many kept answers, the ones run out are let go */
const KEPT_MOST = 500;

type Got<T> = { value: T; extra: Record<string, unknown> } | Refusal;

export function marketClient(o: { url: string; fetch?: typeof fetch; clock?: () => number; timeoutMs?: number }): MarketClient {
  const http = o.fetch ?? fetch;
  const clock = o.clock ?? Date.now;
  const timeoutMs = o.timeoutMs ?? 8_000;
  let stale: number | undefined;
  let lastAnswer: number | undefined;
  const answered = () => {
    stale = undefined;
    lastAnswer = clock();
  };
  const failing = new Set<() => void>();
  const failed = () => {
    if (stale !== undefined) return;
    stale = clock();
    for (const fn of [...failing]) {
      try {
        fn();
      } catch {
        // a listener's throw is its own: the rest are told
      }
    }
  };
  const kept = new Map<string, { until: number; p: Promise<Got<unknown>> }>();

  /** one request, its time bounded (and the caller's signal followed): the Response, or why there is none */
  const send = async (path: string, init: RequestInit & { timeoutMs: number }): Promise<Response | "down"> => {
    const signals = [AbortSignal.timeout(init.timeoutMs), ...(init.signal ? [init.signal] : [])];
    const { timeoutMs: _t, signal, ...rest } = init;
    try {
      return await http(new URL(path, o.url), { ...rest, signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0]!, redirect: "manual" });
    } catch {
      // a caller that went away says nothing of the market
      if (!signal?.aborted) failed();
      return "down";
    }
  };
  /** a protocol answer read: its value stamped, or its refusal, or the market down */
  const read = async <T>(r: Response | "down"): Promise<Got<T>> => {
    if (r === "down") return marketDown();
    let body: unknown;
    try {
      const text = await r.text();
      if (r.status >= 500) throw new Error("5xx");
      body = JSON.parse(text);
    } catch {
      failed();
      return marketDown();
    }
    answered();
    const b = (body ?? {}) as { ok?: unknown; value?: unknown; readAt?: unknown; refusal?: unknown; error?: unknown };
    if (b.ok === false) {
      if (isRefusal(b.refusal)) return b.refusal;
      return no("E_VENUE_REJECTED", { venue: "market", message: typeof b.error === "string" ? b.error : `the market refused the request (HTTP ${r.status})` });
    }
    const { ok: _ok, value, readAt, ...extra } = b as Record<string, unknown>;
    stamp(value, readAt);
    return { value: value as T, extra };
  };

  return {
    url: o.url,
    get<T>(path: string, ttlMs: number): Promise<Got<T>> {
      const now = clock();
      const was = kept.get(path);
      if (was && was.until > now) return was.p as Promise<Got<T>>;
      if (kept.size > KEPT_MOST) for (const [k, v] of kept) if (v.until <= now) kept.delete(k);
      const entry = { until: Infinity, p: undefined as unknown as Promise<Got<unknown>> };
      entry.p = send(path, { method: "GET", timeoutMs })
        .then((r) => read<T>(r))
        .then((v) => {
          entry.until = clock() + (isRefusal(v) ? Math.min(ttlMs, REFUSAL_KEEP_MS) : ttlMs);
          return v;
        });
      kept.set(path, entry);
      return entry.p as Promise<Got<T>>;
    },
    async post<T>(path: string, body: unknown): Promise<T | Refusal> {
      const r = await read<T>(await send(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}), timeoutMs }));
      return isRefusal(r) ? r : r.value;
    },
    async raw(path, init) {
      const r = await send(path, { method: init.method, ...(init.headers ? { headers: init.headers } : {}), ...(init.body !== undefined ? { body: init.body as BodyInit } : {}), ...(init.signal ? { signal: init.signal } : {}), timeoutMs: init.timeoutMs });
      if (r === "down") return marketDown();
      answered();
      return r;
    },
    staleSince: () => stale,
    answeredAt: () => lastAnswer,
    onFail(fn) {
      failing.add(fn);
      return () => void failing.delete(fn);
    },
  };
}

/** the value stamped as read when the market says: an object at its moment (a list at one moment — a Map's entries — the list itself too),
 * a list's each item at its own */
function stamp(value: unknown, readAt: unknown): void {
  if (typeof readAt === "number") {
    readLike(value, readAt);
    if (Array.isArray(value)) readLike([value], readAt);
  }
  else if (Array.isArray(readAt) && Array.isArray(value)) value.forEach((v, i) => (typeof readAt[i] === "number" ? readLike(v, readAt[i]) : undefined));
}
