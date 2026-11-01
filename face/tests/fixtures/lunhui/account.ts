/**
 * A fake Account for the Lunhui freeze tests: a `fetch` that answers the two routes the Account
 * adapter (`plugins/lunhui/lib/account-fetch.mjs`) speaks, over the one fixture mapping
 * (`createFixtureFetch`) of `dir`, never the network.
 *
 * - `GET <origin>/api/cn/relay?url=<URL>`: the fixture mapper's (or `opts.upstream`'s) answer for
 *   the decoded URL - its status and bytes, `content-type` and `location` kept - marked
 *   `x-cn-relay: upstream`. A URL `opts.stall` holds hangs until the caller's signal aborts, after
 *   resolving `reached`.
 * - `POST <origin>/api/cn/ifind`: `wencai-universe.json`'s bytes marked `x-cn-ifind: upstream`, or
 *   with `ifind: "unconfigured"` a 503 `{ok:false, ifind:"unconfigured"}` marked `x-cn-ifind: refused`.
 *   The body's `query` is recorded either way.
 * - Anything else: a 404 with no mark.
 */
import { DEFAULT_ACCOUNT_URL, WENCAI_QUERY_URL } from "../../../plugins/lunhui/lib/account-fetch.mjs";
import { createFixtureFetch } from "../../../plugins/lunhui/lib/fixture-fetch.mjs";

type Upstream = (target: URL, init?: RequestInit) => Promise<Response> | undefined;

const NULL_BODY = new Set([101, 204, 205, 304]);

export function fakeAccount(dir: string, opts: {
  origin?: string;
  ifind?: "configured" | "unconfigured";
  stall?: (upstream: URL) => boolean;
  upstream?: Upstream;
} = {}) {
  const origin = new URL(opts.origin ?? DEFAULT_ACCOUNT_URL).origin;
  const serve = createFixtureFetch(dir);
  const sent: URL[] = [];
  const upstream: URL[] = [];
  const queries: string[] = [];
  let stalled!: () => void;
  const reached = new Promise<void>((resolve) => { stalled = resolve; });

  /** A hang until the caller's signal aborts, after `reached` resolves. */
  function hang(init?: RequestInit): Promise<Response> {
    stalled();
    return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
  }

  /** The upstream's answer re-sent as the Account sends it: status, bytes, two headers, the mark. */
  async function relayed(answer: Response, mark: string): Promise<Response> {
    const headers = new Headers({ [mark]: "upstream" });
    for (const name of ["content-type", "location"]) {
      const value = answer.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const body = NULL_BODY.has(answer.status) || answer.body === null ? null : new Uint8Array(await answer.arrayBuffer());
    return new Response(body, { status: answer.status, headers });
  }

  async function fetch(url: string | URL, init?: RequestInit): Promise<Response> {
    const target = new URL(String(url));
    sent.push(target);
    const method = (init?.method ?? "GET").toUpperCase();
    if (target.origin === origin && target.pathname === "/api/cn/relay" && method === "GET") {
      const raw = target.searchParams.get("url");
      if (raw !== null) {
        const asked = new URL(raw);
        upstream.push(asked);
        if (opts.stall?.(asked)) return hang(init);
        return relayed((await opts.upstream?.(asked, init)) ?? (await serve(asked.href, init)), "x-cn-relay");
      }
    }
    if (target.origin === origin && target.pathname === "/api/cn/ifind" && method === "POST") {
      queries.push(JSON.parse(String(init?.body)).query);
      if (opts.ifind === "unconfigured") {
        return new Response(JSON.stringify({ ok: false, ifind: "unconfigured" }), {
          status: 503, headers: { "content-type": "application/json", "x-cn-ifind": "refused" },
        });
      }
      if (opts.stall?.(new URL(WENCAI_QUERY_URL))) return hang(init);
      return relayed(await serve(WENCAI_QUERY_URL, init), "x-cn-ifind");
    }
    return new Response("not found", { status: 404 });
  }

  return { fetch, sent, upstream, queries, reached };
}
