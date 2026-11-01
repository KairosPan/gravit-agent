/** The A-share wire's network: a GET that hands back the body's raw bytes, so a GBK reply is decoded whole before it is split (the Account's
 * `Http` decodes every body as UTF-8 and keeps 2,000 characters, which would mangle a GBK name and cut a ranking short). `cnHosts` is the
 * host guard, after `fixedHosts` in public-markets.ts: https, the default port, no user, a listed host, GET. */

/** The hosts an A share is read from: Tencent's quote, search, rank and chart hosts */
export const CN_HOSTS: readonly string[] = ["qt.gtimg.cn", "smartbox.gtimg.cn", "proxy.finance.qq.com", "web.ifzq.gtimg.cn"];

export interface CnReply { status: number; bytes: Uint8Array; contentType?: string; location?: string }
/** `body` makes the request a POST (the iFinD route's alone); without it the request is a GET */
export type CnHttp = (url: string, init: { timeoutMs: number; maxBytes: number; headers?: Record<string, string>; body?: string }) => Promise<CnReply>;

/** The body of a stream, read to its end; past `maxBytes` the read is cancelled and throws "too-large" */
export async function readCapped(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) throw new Error("too-large");
      chunks.push(part.value);
    }
  } catch (e) {
    void reader.cancel().catch(() => {});
    throw e;
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

/** A GET (a POST when a body is given) with no redirect followed, the body streamed and cut at `maxBytes`, the whole bounded by `timeoutMs` ("timeout") */
export const realCnHttp: CnHttp = async (url, init) => {
  const controller = new AbortController();
  let rejectTimeout!: (e: Error) => void;
  const timedOut = new Promise<never>((_, reject) => { rejectTimeout = reject; });
  const timer = setTimeout(() => { controller.abort(); rejectTimeout(new Error("timeout")); }, init.timeoutMs);
  const work = (async (): Promise<CnReply> => {
    const r = await fetch(url, { method: init.body !== undefined ? "POST" : "GET", ...(init.body !== undefined ? { body: init.body } : {}), redirect: "manual", signal: controller.signal, ...(init.headers ? { headers: init.headers } : {}) });
    const contentType = r.headers.get("content-type") ?? undefined;
    const location = r.headers.get("location") ?? undefined;
    const meta = { ...(contentType ? { contentType } : {}), ...(location ? { location } : {}) };
    if (!r.body || Number(r.headers.get("content-length")) > init.maxBytes) {
      void r.body?.cancel();
      if (r.body) throw new Error("too-large");
      return { status: r.status, bytes: new Uint8Array(), ...meta };
    }
    return { status: r.status, bytes: await readCapped(r.body, init.maxBytes), ...meta };
  })();
  work.catch(() => {});
  try { return await Promise.race([work, timedOut]); }
  finally { clearTimeout(timer); controller.abort(); }
};

/** `http` limited to a GET over https to one of `hosts` on the default port with no user in the URL; anything else is not asked */
export function cnHosts(http: CnHttp, hosts: readonly string[] = CN_HOSTS): CnHttp {
  return async (url, init) => {
    let u: URL;
    try { u = new URL(url); } catch { throw new Error(`not a URL is not asked: an A share is read from ${hosts.join(", ")} only`); }
    if (u.protocol !== "https:" || u.username || u.password || u.port || !hosts.includes(u.hostname))
      throw new Error(`${u.protocol}//${u.host} is not asked: an A share is read from ${hosts.join(", ")} only`);
    return http(url, init);
  };
}
