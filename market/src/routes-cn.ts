/** LUNHUI'S REACH AND THE AKSHARE SIDECAR on the market: the four route bodies of account/src/portfolio/server.ts at cb4930c4 —
 * `/api/cn/relay`, `/api/cn/ifind`, `/api/akshare/tools` and `/api/akshare/call` — with their status tables, moved verbatim (account split,
 * plan A1). Where they read `opts.cn` and `opts.akshare` they read the core's. Each answers the upstream's status, content type and bytes
 * unchanged, marked by a header; a refusal is its own word and status. The account keeps its own copies until plan A1 task 4.
 *
 *   GET  /api/cn/relay?url=        the relay (live/cn-relay.ts): Tencent's and Eastmoney's listed hosts, bytes unchanged · x-cn-relay
 *   POST /api/cn/ifind {query}     iFinD's one query (live/cn-ifind.ts) · x-cn-ifind
 *   GET  /api/akshare/tools        the sidecar's tools (live/akshare.ts)
 *   POST /api/akshare/call {tool, arguments?}   one tool's answer, unchanged; a caller that goes away aborts the ask */
import type express from "express";
import { isRefusal } from "./core/errors.ts";
import type { AkshareWord } from "./live/akshare.ts";
import { IFIND_QUERY } from "./live/cn-ifind.ts";
import { RELAY_URL_MAX, relayTarget } from "./live/cn-relay.ts";
import type { MarketCore } from "./core.ts";

const RELAY_STATUS = { "not-listed": 403, timeout: 504, "too-large": 502, unreachable: 502, off: 503 } as const;
const IFIND_STATUS = { unconfigured: 503, credential: 502, timeout: 504, "too-large": 502, unreachable: 502, "not-the-query": 400, off: 503 } as const;

const AKSHARE_STATUS = { off: 503, "unknown-tool": 400, "bad-arguments": 400, unavailable: 503, timeout: 504, "too-large": 502 } as const satisfies Record<AkshareWord, number>;

/** A route that throws: a refusal thrown is answered as the refusal it is; anything else is answered with one fixed sentence, and what it
 * said goes to this process's log — no exception's words, paths or hosts reach a caller */
export const wrap = (fn: (req: express.Request, res: express.Response) => Promise<void> | void) => (req: express.Request, res: express.Response) => {
  Promise.resolve(fn(req, res)).catch((err: unknown) => {
    if (res.headersSent) return;
    if (isRefusal(err)) return void res.status(409).json({ ok: false, refusal: err });
    console.error(`${req.method} ${req.path}: ${String((err as Error)?.stack ?? (err as Error)?.message ?? err).slice(0, 600)}`);
    res.status(500).json({ ok: false, error: "The market hit an error answering this; it was recorded." });
  });
};

/** `cnQueueMs`: how long past a relay target's own limit a request may wait for a slot in the relay's queue (milliseconds): 3000 unless said */
export function mountCn(app: express.Express, core: MarketCore, o: { cnQueueMs?: number } = {}): void {
  // Lunhui's reach: two reads, behind the fence. Each answers the upstream's status, content type and bytes unchanged, marked by a header;
  // a refusal is its own word and status
  app.get("/api/cn/relay", wrap(async (req, res) => {
    const refuse = (word: keyof typeof RELAY_STATUS) => void res.status(RELAY_STATUS[word]).set("x-cn-relay", "refused").json({ ok: false, relay: word });
    const raw = req.query.url;
    if (typeof raw !== "string" || raw.length > RELAY_URL_MAX) return refuse("not-listed");
    if (!core.cn) return refuse("off");
    const target = relayTarget(raw);
    if (!target) return refuse("not-listed");
    const headers: Record<string, string> = {};
    for (const k of ["accept", "referer", "user-agent"]) { const v = req.headers[k]; if (typeof v === "string") headers[k] = v; }
    // a request queued for a slot has no deadline of its own until it holds one: its whole wait is bounded here
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<"late">((resolve) => { timer = setTimeout(() => resolve("late"), target.timeoutMs + (o.cnQueueMs ?? 3_000)); });
    const gone = new AbortController();
    res.on("close", () => gone.abort());
    const a = await Promise.race([core.cn.relay(raw, headers, gone.signal), late]).finally(() => clearTimeout(timer));
    if (a === "late") { gone.abort(); return refuse("timeout"); }
    if (a.kind === "refused") return refuse(a.word);
    res.status(a.status).set("x-cn-relay", "upstream").set("x-content-type-options", "nosniff").set("content-type", a.contentType ?? "application/octet-stream");
    if (a.status >= 300 && a.status < 400 && a.location) res.set("location", a.location);
    res.send(Buffer.from(a.bytes));
  }));
  app.post("/api/cn/ifind", wrap(async (req, res) => {
    const refuse = (word: keyof typeof IFIND_STATUS) => void res.status(IFIND_STATUS[word]).set("x-cn-ifind", "refused").json({ ok: false, ifind: word });
    const q = (req.body as { query?: unknown } | undefined)?.query;
    if (typeof q !== "string" || !IFIND_QUERY.test(q)) return refuse("not-the-query");
    if (!core.cn) return refuse("off");
    const a = await core.cn.ifind.ask(q);
    if (a.kind === "refused") return refuse(a.word);
    res.status(a.status).set("x-cn-ifind", "upstream").set("x-content-type-options", "nosniff").set("content-type", a.contentType ?? "application/octet-stream").send(Buffer.from(a.bytes));
  }));

  // The AKShare sidecar: two reads, behind the fence, nothing written. The child's answer comes back unchanged; a refusal is the route's own
  // word and status
  const akshareRefuse = (res: express.Response, word: AkshareWord, message: string) => void res.status(AKSHARE_STATUS[word]).json({ ok: false, akshare: word, message });
  /** aborted when the caller goes away before the answer is sent */
  const callerGone = (res: express.Response) => {
    const c = new AbortController();
    res.on("close", () => { if (!res.writableFinished) c.abort(); });
    return c.signal;
  };
  app.get("/api/akshare/tools", wrap(async (_req, res) => {
    if (!core.akshare) return akshareRefuse(res, "off", "this Account runs no AKShare sidecar");
    const a = await core.akshare.tools(callerGone(res));
    if (a.kind === "refused") return akshareRefuse(res, a.word, a.message);
    res.json({ ok: true, tools: a.value });
  }));
  app.post("/api/akshare/call", wrap(async (req, res) => {
    const body = req.body as { tool?: unknown; arguments?: unknown } | undefined;
    if (typeof body?.tool !== "string") return akshareRefuse(res, "bad-arguments", "the body is {tool: string, arguments?: object}");
    if (!core.akshare) return akshareRefuse(res, "off", "this Account runs no AKShare sidecar");
    const a = await core.akshare.call(body.tool, body.arguments, callerGone(res));
    if (a.kind === "refused") return akshareRefuse(res, a.word, a.message);
    res.json({ ok: true, tool: body.tool, isError: a.value.isError, content: a.value.content });
  }));
}
