/** The market: the Market part's keyless public data behind one API on this machine, which the account and Gravit's face reach. It
 * holds no wallet, no home and no key, and writes nothing to disk. It serves no page: every request outside /api/ is 404 with
 * MARKET_NO_PAGE.
 *
 *   npm run market                    → http://127.0.0.1:4821 · `--port <n>` listens elsewhere; MARKET_BIND widens the listener and
 *                                       MARKET_HOSTS (comma-separated `host:port`) names extra Host values answered as local
 *
 *   GET  /api/health                  {ok: true, service: "market", sources, china, akshare, ifind} (protocol.ts; no token named)
 *   the source protocol               protocol.ts: the sources, the hub, China and a price, for the account's adapters
 *   Lunhui's reach and AKShare        routes-cn.ts: /api/cn/relay, /api/cn/ifind, /api/akshare/tools, /api/akshare/call
 *   the public reads                  reads.ts: /api/explore, /api/quotes, /api/candles, /api/book, /api/trades (for the face, plan A2)
 *   the stream                        follows.ts: GET /api/stream, POST /api/stream/markets (a followed market's quote, book and trades)
 *
 * Only this machine's own programs talk to it: a foreign Origin, a Sec-Fetch-Site of cross-site or same-site, or a Host that is not this
 * machine's (a DNS-rebinding page) is 403 before any route sees it. No answer is stored by the browser (cache-control: no-store).
 *
 * The fence, the no-page answer, the JSON parser and the unread-body answer mirror account/src/portfolio/server.ts. */
import express from "express";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { akshareCommand } from "./live/akshare.ts";
import { realMarketCore } from "./core.ts";
import { mountProtocol } from "./protocol.ts";
import { mountCn } from "./routes-cn.ts";
import { marketReads, mountReads } from "./reads.ts";
import { mountStream } from "./follows.ts";

export const MARKET_PORT = 4821;

export const MARKET_NO_PAGE = "The market serves no page: its screens are Gravit's face (Markets). This address answers its API under /api/.";

/** the Host values that are this machine's own: 127.0.0.1, localhost or [::1], with or without a port */
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

/** MARKET_HOSTS as the fence reads it: comma-separated, each entry trimmed, empties dropped, nothing else changed */
export function parseHosts(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((h) => h.trim()).filter((h) => h !== "");
}

export interface MarketServerOptions {
  port: number;
  /** the address to listen on (MARKET_BIND): 127.0.0.1 unless said; the server's own url stays http://127.0.0.1:<port> */
  bind?: string | undefined;
  /** extra Host values answered as local (MARKET_HOSTS), each compared exactly, `host:port`: none unless said */
  hosts?: readonly string[] | undefined;
  /** the routes behind the fence: mounted after the fence, the no-page answer and the JSON parser, before the unread-body answer */
  mount?: ((app: express.Express) => void) | undefined;
  /** run on close, before the listener closes */
  close?: (() => Promise<void>) | undefined;
}

export interface MarketServerHandle {
  url: string;
  close(): Promise<void>;
}

export async function startMarketServer(o: MarketServerOptions): Promise<MarketServerHandle> {
  const hosts = o.hosts ?? [];
  const app = express();
  // nothing the market says is stored by the browser
  app.use((_req, res, next) => {
    res.setHeader("cache-control", "no-store");
    next();
  });
  // Only this machine's own programs talk to the market: a request that names another site as its origin, or reaches it under a host name
  // that is not this server's (a DNS-rebinding page), is turned away before any route sees it
  app.use((req, res, next) => {
    const host = String(req.headers.host ?? "");
    // a Host named in MARKET_HOSTS (a compose peer's `market:4821`) is local too, matched exactly; its origin is checked as any other
    const local = LOCAL_HOST.test(host) || hosts.includes(host);
    const origin = req.headers.origin;
    // a browser says where a request comes from (Fetch Metadata): another site's request is refused, a navigation among them
    const site = req.headers["sec-fetch-site"];
    const foreignOrigin = typeof origin === "string" && origin !== `${req.protocol}://${host}`;
    const foreignSite = site === "cross-site" || site === "same-site";
    if (!local || foreignOrigin || foreignSite) return void res.status(403).json({ ok: false, error: "this server answers only programs on this machine" });
    next();
  });
  // no page: everything outside /api/ that passed the fence is one sentence naming the face
  app.use((req, res, next) => (req.path.startsWith("/api/") ? next() : void res.status(404).json({ ok: false, error: MARKET_NO_PAGE })));
  // JSON bodies are read only once the request is known to be this machine's own (above). No body is inflated (inflate: false): a body
  // declared gzip that is not would otherwise end in zlib's error instead of the one fixed sentence below
  app.use(express.json({ inflate: false }));

  o.mount?.(app);
  // the bare health answer, where the routes mounted give none of their own (protocol.ts mountProtocol answers it with the core's parts)
  app.get("/api/health", (_req, res) => void res.json({ ok: true, service: "market" }));

  // A body the JSON parser could not read — not JSON, too large, an encoding it does not take — is answered with one fixed sentence and is
  // neither logged nor said back: the parser's own message quotes what it could not read. Every other error goes on to express as before
  const unreadBody: express.ErrorRequestHandler = (err, _req, res, next) => {
    const e = err as { type?: unknown; status?: unknown; code?: unknown } | null;
    // the parser's own errors carry a type ("entity.parse.failed", "encoding.unsupported" …); zlib's, had a body been inflated, a Z_ code
    const fromParser = !!e && (typeof e.type === "string" || (typeof e.code === "string" && e.code.startsWith("Z_")));
    if (!e || !fromParser || typeof e.status !== "number" || e.status < 400 || e.status > 499) return next(err);
    if (res.headersSent) return;
    res.status(e.status).json({ ok: false, error: "The body of this request could not be read as JSON; it was not kept." });
  };
  app.use(unreadBody);

  const server: Server = await new Promise((resolve, reject) => {
    const s = app.listen(o.port, o.bind ?? "127.0.0.1", () => resolve(s));
    s.on("error", reject);
  });
  const bound = server.address();
  // the listener's close, kept on its own: once begun it is the same promise for every caller, and it never rejects
  let listenerClosed: Promise<void> | undefined;
  const closeListener = (): Promise<void> =>
    (listenerClosed ??= new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }));
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${typeof bound === "object" && bound ? bound.port : o.port}`,
    close() {
      // the first close runs the core's close and says how it went: a close that throws rejects this call alone. Every later one waits
      // for that first one to end, then only for the listener (never before the core's close is done), so a rejection is never served
      // again. The listener closes whatever the core's close does: a throwing close never leaves the port held
      if (closing) return closing.then(closeListener, closeListener);
      closing = (async () => {
        try {
          await o.close?.();
        } finally {
          await closeListener();
        }
      })();
      return closing;
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const at = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const port = Number(at("--port") ?? MARKET_PORT);
  if (!Number.isInteger(port) || port < 0) throw new Error("--port is a port number");
  const core = realMarketCore();
  let endStream: (() => void) | undefined;
  const mount = (app: express.Express) => {
    mountProtocol(app, core);
    mountCn(app, core);
    mountReads(app, core, marketReads(core));
    endStream = mountStream(app, core).close;
  };
  // the pages' streams end and their holds are let go before the core (its hub) closes
  const close = async () => {
    try {
      endStream?.();
    } finally {
      await core.close();
    }
  };
  const srv = await startMarketServer({ port, bind: process.env.MARKET_BIND || undefined, hosts: parseHosts(process.env.MARKET_HOSTS), mount, close }).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "EADDRINUSE") throw e;
    console.error(`port ${port} is already in use: a market is probably running already`);
    process.exit(1);
  });
  console.log(`market at ${srv.url} · keyless public data · Ctrl-C to stop`);
  console.log(`Lunhui's reach: /api/cn/relay (Tencent, Eastmoney) · ${core.cn?.ifind.configured() ? "iFinD configured" : "iFinD not configured (IFIND_REFRESH_TOKEN or IFIND_ACCESS_TOKEN in this process's environment)"}`);
  console.log(`AKShare: ${akshareCommand()} · started on first use (/api/akshare/tools, /api/akshare/call)`);
  const stop = () => srv.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
