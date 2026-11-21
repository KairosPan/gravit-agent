/** The local regions' (Hong Kong, Korea, Taiwan, world indices) shared network guard: `cnHosts`'s allowlist plus a polite pause. A 403, a 429, a
 * redirect (no redirect is followed: a source that answers one is sending the workbench away) or a source's own refusal page stops every ask of
 * that host for a quarter of an hour, so the workbench never hammers a source that has said no. The market's core builds one guard over all
 * the local hosts and hands it to every source, so a pause of a host holds for every source that asks it. */
import { cnHosts, type CnHttp, type CnReply } from "./cn-http.ts";

export const HK_HOSTS: readonly string[] = ["qt.gtimg.cn", "stock.gtimg.cn", "web.ifzq.gtimg.cn", "smartbox.gtimg.cn"];
export const EASTMONEY_HOSTS: readonly string[] = ["push2delay.eastmoney.com", "push2his.eastmoney.com"];
export const NAVER_HOSTS: readonly string[] = ["polling.finance.naver.com", "m.stock.naver.com", "api.stock.naver.com", "ac.stock.naver.com"];
export const TWSE_HOSTS: readonly string[] = ["openapi.twse.com.tw", "mis.twse.com.tw", "www.twse.com.tw"];

export const PAUSE_MS = 900_000;

/** `http` limited to `hosts` (as `cnHosts`) and polite: a reply of 403, 429 or any 3xx, or one `isRefusalPage` recognises (the ask then throws
 * "refused"), pauses that host for `pauseMs`; while paused an ask to it throws "paused" and sends nothing. Other hosts are not affected. A 403,
 * 429 or 3xx reply is still returned, and every source takes a non-200 status as a failure. `isRefusalPage` is kept for a source whose refusal
 * comes as a 200 page; no source needs one now (each one's refusals arrive as a status). */
export function politeHosts(
  http: CnHttp,
  hosts: readonly string[],
  o: { clock?: () => number; pauseMs?: number; isRefusalPage?: (reply: CnReply) => boolean } = {},
): CnHttp {
  const clock = o.clock ?? Date.now;
  const pauseMs = o.pauseMs ?? PAUSE_MS;
  const pausedUntil = new Map<string, number>();
  const guarded = cnHosts(http, hosts);
  return async (url, init) => {
    let host: string | null = null;
    try { host = new URL(url).hostname; } catch { /* cnHosts says it */ }
    if (host !== null && hosts.includes(host)) {
      const until = pausedUntil.get(host);
      if (until !== undefined) {
        if (clock() < until) throw new Error("paused");
        pausedUntil.delete(host);
      }
    }
    const reply = await guarded(url, init);
    if (host !== null) {
      if (reply.status === 403 || reply.status === 429 || (reply.status >= 300 && reply.status < 400)) pausedUntil.set(host, clock() + pauseMs);
      else if (o.isRefusalPage?.(reply)) { pausedUntil.set(host, clock() + pauseMs); throw new Error("refused"); }
    }
    return reply;
  };
}

/** every local source's hosts but Eastmoney's (whose one client the core hands Hong Kong and the indices alike) */
export const LOCAL_HOSTS: readonly string[] = [...HK_HOSTS, ...NAVER_HOSTS, ...TWSE_HOSTS];
/** THE ONE GUARD the market's core builds over every local host and hands to Hong Kong, Korea, Taiwan and the indices as their `http`, so a
 * host that pauses for one source (Tencent for Hong Kong's shares and the indices, Naver for Korea and the indices, TWSE for Taiwan and TAIEX)
 * is paused for all; each source's own `politeHosts` inside it still limits that source to its own hosts */
export function localHosts(http: CnHttp, o: { clock?: () => number } = {}): CnHttp {
  return politeHosts(http, LOCAL_HOSTS, o);
}

/** One more ask after a "timeout" or a network error (a TypeError, as fetch throws); never after a status, a pause, a refusal or anything else */
export async function retryOnce(ask: () => Promise<CnReply>): Promise<CnReply> {
  try { return await ask(); }
  catch (e) {
    if ((e as Error)?.message === "timeout" || e instanceof TypeError) return ask();
    throw e;
  }
}
