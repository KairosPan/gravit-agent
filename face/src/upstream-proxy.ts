/** The face's proxy core: the rules one upstream's reads, stream and POST routes are served by, shared by the
 * account's half (src/account-proxy.ts, `/data/account/…` → the account at `FACE_ACCOUNT_URL`) and the market's
 * (src/market-proxy.ts, `/data/market/…` → the market at `FACE_MARKET_URL`). The upstream answers only bare
 * loopback requests — its fence refuses any page at another origin — so the face's page never asks it: the page
 * asks the face, and the face asks the upstream with a plain loopback fetch (no Origin, no Sec-Fetch-Site, no
 * cookie, the URL's own Host, `redirect: "error"`). Every route is `exact`, never a prefix: the route table is the
 * allow-list.
 *
 * The rules (extracted unchanged from the account proxy's):
 * - The fence first (`isTrustedDataRequest`, 403 with the fixed body), then 405 for any method but the route's
 *   (GET; POST for a follow and the writes), then the query, rebuilt from the read's names ({@link rebuildQueryOf});
 *   anything else is 400 with the half's {@link UpstreamSettings.invalid} sentence and the upstream is never asked.
 *   The raw query never reaches it, and `fresh` is the face's own flag, never forwarded. A disabled row disables
 *   the half: every valid read then answers 503 `disabled` and asks nothing (a malformed query or a wrong method is
 *   refused before the row's state is consulted, and so, on a POST route, are a body not declared JSON, 415, and a
 *   body past its limit, 413).
 * - The upstream's status and body pass through as they are, never parsed. Every JSON answer is
 *   `application/json` and `no-store`.
 * - A failure of the fetch itself — refused, hanging past the read's abort on the headers or the body, a body that
 *   cannot be read — is a state, not an error: 503 `{"ok":false,"unreachable":"<CODE>"}` with the failure's code,
 *   never its text; a query with a kept answer is re-served that answer flagged `stale: true` instead (http.ts's
 *   `markStale`). An in-process read ({@link UpstreamRouteRead}) never re-serves stale.
 * - Only a 2xx answer is kept: per read by rebuilt query for the read's TTL, at most {@link UPSTREAM_CACHE_KEYS}
 *   queries, the least recently used out first; a refusal is never kept and never re-served. Reads of one query
 *   share one fetch; `?fresh=1` skips the TTL and never joins a plain read in flight — it asks again once that one
 *   settles.
 * - A stream is piped, one upstream request per browser connection, never kept: `client` required
 *   ({@link STREAM_CLIENT}), `since` the browser's `Last-Event-ID` when it sends one, else the query's, `markets`
 *   at most 4 000 characters, each name once. The upstream's 200 is written through chunk by chunk as it comes,
 *   never buffered, re-framed or read, and the response ends when the upstream ends the stream. The upstream is
 *   aborted when the browser's response closes or errors, when the browser falls 256 KiB behind (the response then
 *   destroyed) and on `abortAll`. Any other answer is the upstream's status and body.
 * - A POST route takes a body declared `application/json` (else 415) and a target that names no query parameter
 *   (else 400), both refused before the body is read. The body — at most the route's bytes, else 413 — is
 *   forwarded as posted with `content-type: application/json`, never parsed, kept or echoed; a disabled row
 *   answers `disabled` once the body is read. The upstream's status and body come back as they are, never kept and
 *   never stale; the request is cut at the route's abort.
 * - Nothing of a body, a query or a frame is logged here.
 * @module
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { FORBIDDEN, HttpError, isJsonBody, isTrustedDataRequest, markStale, readBody } from "./http.ts";
import type { RouteRegistrar } from "./static.ts";

/** One read the face proxies: its face path, the upstream's path, the query names it passes on (`fresh` among them
 * when the read takes the face's own flag), the names whose value may run past 240 characters with theirs, how long
 * an answer is served without asking again, and how long the upstream may take, headers and body. */
export interface UpstreamRead { face: string; upstream: string; query: readonly string[]; long?: ReadonlyMap<string, number>; ttlMs: number; abortMs: number }

/** One half's upstream: its URL (no trailing slash), the fetch, the clock, whether its row is disabled — and the
 * sentence a malformed request is refused with, in the half's own words (default {@link INVALID_REQUEST}). */
export interface UpstreamSettings { url: string; doFetch: typeof fetch; now: () => number; disabled: boolean; invalid?: string }

/** The upstream's answer — its status and its body as text — or the code of a fetch that failed. */
export type UpstreamAnswer = { status: number; body: string } | { unreachable: string };

/** One read in-process, through the same cache and flights its face path is served from: `query` is one
 * {@link rebuildQueryOf} would pass on. A disabled row answers `{ unreachable: "disabled" }` and asks nothing. No
 * stale answer is re-served here: a failure is the failure. */
export type UpstreamRouteRead = (query: string) => Promise<UpstreamAnswer>;

/** Most queries kept per read; the least recently used leaves first. */
export const UPSTREAM_CACHE_KEYS = 64;
/** The name a tab gives its stream, in the upstream's grammar; the face's page mints `face-<24 hex>`. */
export const STREAM_CLIENT = /^[A-Za-z0-9_-]{8,48}$/;
/** Most bytes a follow (`stream/markets`) body may carry. */
export const STREAM_BODY_LIMIT = 4096;
/** How long the upstream may take on a follow, headers and body. */
export const FOLLOW_ABORT_MS = 7_000;
/** A malformed request's answer where a half names none of its own. */
export const INVALID_REQUEST = '{"ok":false,"error":"invalid request"}';

/** Longest value one query name may carry, in characters, decoded. */
const VALUE_MAX = 240;
/** Longest request target a read may arrive with. */
const RAW_URL_MAX = 8_192;
/** The stream's query names, each with the longest value it may carry, in characters, decoded; `client` is held to
 * {@link STREAM_CLIENT} besides. */
const STREAM_QUERY: ReadonlyMap<string, number> = new Map([["since", VALUE_MAX], ["client", VALUE_MAX], ["markets", 4_000]]);
/** Most bytes a browser may leave unread on its stream; past it the face drops the response, as `quotes.ts` does. */
const STREAM_UNREAD_MAX = 256 * 1024;
const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no",
} as const;
const METHOD_NOT_ALLOWED = '{"ok":false,"error":"method not allowed"}';
const JSON_ONLY = '{"ok":false,"error":"application/json only"}';
/** The 503 body of a failed fetch or a disabled row. */
export const unreachableBody = (code: string): string => JSON.stringify({ ok: false, unreachable: code });
const invalidOf = (s: UpstreamSettings): string => s.invalid ?? INVALID_REQUEST;

/** A request target's query; `null` when the target is over-long or unparsable. */
export function searchOf(rawUrl: string): URLSearchParams | null {
  if (rawUrl.length > RAW_URL_MAX) return null;
  try {
    return new URL(rawUrl, "http://localhost").searchParams;
  } catch {
    return null;
  }
}

/** The query a read may pass on, rebuilt from its `allowed` names in the order they came, each at most once, each
 * value at most 240 characters (`longer` names the longer ones), re-encoded; `fresh=1` sets `fresh` and is never
 * part of the query. `null`: an unknown or repeated name, an over-long value, an over-long or unparsable URL. */
export function rebuildQueryOf(
  allowed: readonly string[], longer: ReadonlyMap<string, number> | undefined, rawUrl: string,
): { query: string; fresh: boolean } | null {
  const asked = searchOf(rawUrl);
  if (asked === null) return null;
  const seen = new Set<string>();
  const rebuilt = new URLSearchParams();
  let fresh = false;
  for (const [name, value] of asked) {
    if (!allowed.includes(name) || seen.has(name) || value.length > (longer?.get(name) ?? VALUE_MAX)) return null;
    seen.add(name);
    if (name === "fresh") fresh = value === "1";
    else rebuilt.append(name, value);
  }
  return { query: rebuilt.toString(), fresh };
}

/** The query a stream passes on: `since`, `client` and `markets` in the order they came, each at most once and
 * within its {@link STREAM_QUERY} bound, re-encoded, `client` shaped as {@link STREAM_CLIENT}. The browser's
 * `Last-Event-ID`, when it sends one, is `since` — in place of a `since` in the query, within the same bound — as
 * the upstream itself reads it. `null`: anything else. */
function rebuildStreamQuery(rawUrl: string, lastEventId: string | string[] | undefined): string | null {
  const asked = searchOf(rawUrl);
  if (asked === null) return null;
  const rebuilt = new URLSearchParams();
  for (const [name, value] of asked) {
    const max = STREAM_QUERY.get(name);
    if (max === undefined || rebuilt.has(name) || value.length > max) return null;
    rebuilt.append(name, value);
  }
  if (!STREAM_CLIENT.test(rebuilt.get("client") ?? "")) return null;
  if (typeof lastEventId === "string" && lastEventId !== "") {
    if (lastEventId.length > VALUE_MAX) return null;
    rebuilt.set("since", lastEventId);
  }
  return rebuilt.toString();
}

/** Whether a request target names no query parameter: a route that allows none refuses any. */
export const queryless = (rawUrl: string): boolean => searchOf(rawUrl)?.size === 0;

/** A failure's code, bounded to a code's shape so no error text ever reaches the page. */
export function codeOf(err: unknown): string {
  const e = err as { cause?: { code?: unknown }; code?: unknown } | null;
  const code = e?.cause?.code ?? e?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,31}$/.test(code) ? code : "unreachable";
}

/** One request to the upstream — a GET, or what `init` asks — cut at `abortMs` on the headers and the body: its
 * status and body, or the failure's code. Never rejects. */
export async function askUpstream(doFetch: typeof fetch, url: string, abortMs: number, init: RequestInit = {}): Promise<UpstreamAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), abortMs);
  try {
    const r = await doFetch(url, { ...init, signal: controller.signal, redirect: "error" });
    try {
      return { status: r.status, body: await r.text() };
    } catch {
      return { unreachable: controller.signal.aborted ? "timeout" : "unreadable" };
    }
  } catch (err) {
    return { unreachable: controller.signal.aborted ? "timeout" : codeOf(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** A JSON answer: `application/json`, `no-store`. */
export function send(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

/** One 2xx answer of the upstream's, and when it came. */
interface Kept { status: number; body: string; at: number }

/** One read's cache and flights. */
export interface UpstreamReads {
  /** Within the TTL the kept answer, else the upstream's: one fetch per query in flight. */
  read(query: string, fresh: boolean): Promise<UpstreamAnswer>;
  /** The last 2xx kept for a query, however old: what a failure re-serves as stale. */
  kept(query: string): Kept | undefined;
  clear(): void;
}

/** One read's cache and flights over the upstream in `s`. */
export function upstreamReads(r: UpstreamRead, s: UpstreamSettings): UpstreamReads {
  /* A Map iterates in insertion order: re-inserting a query on every use keeps the least recently used first. */
  const answers = new Map<string, Kept>();
  /** The read in flight per query, and whether it is a fresh one: a plain read joins any flight, a fresh read joins
   * only a fresh one and otherwise asks again after the plain one settles. */
  const flights = new Map<string, { answer: Promise<UpstreamAnswer>; fresh: boolean }>();

  const remember = (query: string, entry: Kept): void => {
    answers.delete(query);
    answers.set(query, entry);
    while (answers.size > UPSTREAM_CACHE_KEYS) answers.delete(answers.keys().next().value!);
  };

  const ask = async (query: string): Promise<UpstreamAnswer> => {
    const answer = await askUpstream(s.doFetch, `${s.url}${r.upstream}${query === "" ? "" : `?${query}`}`, r.abortMs);
    if ("status" in answer && answer.status >= 200 && answer.status < 300) remember(query, { ...answer, at: s.now() });
    return answer;
  };

  const fly = (query: string, fresh: boolean): Promise<UpstreamAnswer> => {
    const flight = flights.get(query);
    if (flight !== undefined && (!fresh || flight.fresh)) return flight.answer;
    const run = (): Promise<UpstreamAnswer> => ask(query);
    const own = { answer: flight === undefined ? run() : flight.answer.then(run, run), fresh };
    flights.set(query, own);
    /* `then(clear, clear)`, not `finally`: a `finally` would derive an unawaited rejection. */
    const clear = (): void => { if (flights.get(query) === own) flights.delete(query); };
    void own.answer.then(clear, clear);
    return own.answer;
  };

  return {
    read: async (query, fresh) => {
      if (s.disabled) return { unreachable: "disabled" };
      const hit = answers.get(query);
      if (!fresh && hit !== undefined && s.now() - hit.at < r.ttlMs) {
        remember(query, hit);
        return { status: hit.status, body: hit.body };
      }
      return fly(query, fresh);
    },
    kept: (query) => answers.get(query),
    clear: () => answers.clear(),
  };
}

/** One read's handler: the fence, GET only, the rebuilt query, then the upstream through the read's cache. */
const readHandler = (r: UpstreamRead, reads: UpstreamReads, s: UpstreamSettings) => async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  /* FIRST: a refused request reaches neither the parser nor the cache nor the upstream. */
  if (!isTrustedDataRequest(req)) return send(res, 403, FORBIDDEN);
  if (req.method !== "GET") return send(res, 405, METHOD_NOT_ALLOWED);
  const asked = rebuildQueryOf(r.query, r.long, req.url ?? "");
  if (asked === null) return send(res, 400, invalidOf(s));
  if (s.disabled) return send(res, 503, unreachableBody("disabled"));
  const answer = await reads.read(asked.query, asked.fresh);
  if ("status" in answer) return send(res, answer.status, answer.body);
  const kept = reads.kept(asked.query);
  return kept === undefined ? send(res, 503, unreachableBody(answer.unreachable)) : send(res, 200, markStale(kept.body));
};

/** Mount `reads` on the host webserver, each an exact GET route at its face path, in the order given. `own` hands
 * a read's cache made beforehand (by face path), so a caller that reads it otherwise — the account's own reader —
 * shares it. `read` is each read's in-process {@link UpstreamRouteRead} by face path; `clear` forgets every kept
 * answer. */
export function mountReads(
  webServer: RouteRegistrar, s: UpstreamSettings, reads: readonly UpstreamRead[], own: ReadonlyMap<string, UpstreamReads> = new Map(),
): { read: Map<string, UpstreamRouteRead>; clear(): void } {
  const read = new Map<string, UpstreamRouteRead>();
  const all: UpstreamReads[] = [];
  for (const r of reads) {
    const cache = own.get(r.face) ?? upstreamReads(r, s);
    all.push(cache);
    read.set(r.face, (query) => cache.read(query, false));
    webServer.register({ kind: "exact", path: r.face, handler: readHandler(r, cache, s) });
  }
  return { read, clear: () => { for (const cache of all) cache.clear(); } };
}

/** One browser connection's stream: the upstream's 200 written through chunk by chunk as it comes, unchanged, and
 * ended when the upstream ends it; a browser {@link STREAM_UNREAD_MAX} bytes behind is dropped; any other answer is
 * the upstream's status and body, a failure 503 with its code. A response the browser has closed is written
 * nothing. Never rejects. */
async function pipeStream(doFetch: typeof fetch, url: string, signal: AbortSignal, res: ServerResponse): Promise<void> {
  const answer = (status: number, body: string): void => { if (!res.destroyed) send(res, status, body); };
  let r: Response;
  try {
    r = await doFetch(url, { headers: { accept: "text/event-stream" }, redirect: "error", signal });
  } catch (err) {
    return answer(503, unreachableBody(codeOf(err)));
  }
  if (r.status !== 200) {
    let body: string;
    try {
      body = await r.text();
    } catch {
      return answer(503, unreachableBody("unreadable"));
    }
    return answer(r.status, body);
  }
  res.writeHead(200, SSE_HEADERS);
  try {
    for await (const chunk of r.body ?? []) {
      if (res.destroyed) break;
      if (res.writableLength > STREAM_UNREAD_MAX) {
        res.destroy();
        break;
      }
      res.write(chunk);
    }
  } catch {
    /* The upstream broke off, or the request was aborted: a stream already open has nothing more to say. */
  }
  if (!res.destroyed) res.end();
}

/** A stream's handler: the fence, GET only, the rebuilt query, then one upstream stream for this browser connection,
 * aborted when its response closes or errors, or on `abortAll` (through `open`). */
const streamHandler = (s: UpstreamSettings, upstream: string, open: Set<AbortController>) => async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  if (!isTrustedDataRequest(req)) return send(res, 403, FORBIDDEN);
  if (req.method !== "GET") return send(res, 405, METHOD_NOT_ALLOWED);
  const query = rebuildStreamQuery(req.url ?? "", req.headers["last-event-id"]);
  if (query === null) return send(res, 400, invalidOf(s));
  if (s.disabled) return send(res, 503, unreachableBody("disabled"));
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  /* Wired before the fetch: a browser that leaves while the upstream is still to answer cancels the request. */
  res.once("close", abort);
  res.on("error", abort);
  if (res.destroyed) abort();
  open.add(controller);
  try {
    await pipeStream(s.doFetch, `${s.url}${upstream}?${query}`, controller.signal, res);
  } finally {
    open.delete(controller);
  }
};

/** A POST route's request up to its body: the fence, POST only, a body declared `application/json`, no query name,
 * then the body read under `limit` bytes. The body as posted, or `null` once the refusal is answered. The body is
 * never parsed, kept or logged. */
async function readJsonPost(req: IncomingMessage, res: ServerResponse, limit: number, s: UpstreamSettings): Promise<string | null> {
  if (!isTrustedDataRequest(req)) { send(res, 403, FORBIDDEN); return null; }
  if (req.method !== "POST") { send(res, 405, METHOD_NOT_ALLOWED); return null; }
  if (!isJsonBody(req)) { send(res, 415, JSON_ONLY); return null; }
  if (!queryless(req.url ?? "")) { send(res, 400, invalidOf(s)); return null; }
  try {
    return await readBody(req, limit);
  } catch (err) {
    if (err instanceof HttpError) send(res, err.status, JSON.stringify({ ok: false, error: err.message }));
    else send(res, 400, invalidOf(s));
    return null;
  }
}

/** What a POST route adds to the plain forward: headers derived from the browser's request (never copied from it),
 * and a body sent in place of the browser's, which is then read under the limit and discarded. */
export interface PostOptions {
  extraHeaders?: (req: IncomingMessage) => Record<string, string>;
  fixedBody?: string;
}

/** A POST route — a follow or a write: {@link readJsonPost}, then the body forwarded as posted (or `fixedBody`) to the
 * upstream's `path`, cut at `abortMs`; its status and body come back as they are, never kept, never stale. */
export const postHandler = (s: UpstreamSettings, path: string, limit: number, abortMs: number, options: PostOptions = {}) =>
  async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const posted = await readJsonPost(req, res, limit, s);
  if (posted === null) return;
  if (s.disabled) return send(res, 503, unreachableBody("disabled"));
  const body = options.fixedBody ?? posted;
  const answer = await askUpstream(s.doFetch, `${s.url}${path}`, abortMs, {
    method: "POST", headers: { ...options.extraHeaders?.(req), "content-type": "application/json" }, body,
  });
  return "status" in answer ? send(res, answer.status, answer.body) : send(res, 503, unreachableBody(answer.unreachable));
};

/** Mount a push channel: `face` piped from the upstream's `upstream` per browser connection, and `followFace` (POST)
 * forwarded to `followUpstream` under {@link STREAM_BODY_LIMIT} and {@link FOLLOW_ABORT_MS}. `abortAll` aborts every
 * open stream's upstream. */
export function mountStream(
  webServer: RouteRegistrar, s: UpstreamSettings, o: { face: string; upstream: string; followFace: string; followUpstream: string },
): { abortAll(): void } {
  /* The upstream streams open now, one per browser connection. */
  const open = new Set<AbortController>();
  webServer.register({ kind: "exact", path: o.face, handler: streamHandler(s, o.upstream, open) });
  webServer.register({ kind: "exact", path: o.followFace, handler: postHandler(s, o.followUpstream, STREAM_BODY_LIMIT, FOLLOW_ABORT_MS) });
  return { abortAll: () => { for (const stream of open) stream.abort(); } };
}
