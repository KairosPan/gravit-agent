/** The local regions' (Hong Kong, Korea, Taiwan, world indices) shared network guard: `cnHosts`'s allowlist plus a polite pause. A 403, a 429 or a
 * source's own refusal page stops every ask of that host for a quarter of an hour, so the workbench never hammers a source that has said no. */
import { cnHosts, type CnHttp, type CnReply } from "./cn-http.ts";

export const HK_HOSTS: readonly string[] = ["qt.gtimg.cn", "stock.gtimg.cn", "web.ifzq.gtimg.cn", "smartbox.gtimg.cn"];
export const EASTMONEY_HOSTS: readonly string[] = ["push2delay.eastmoney.com", "push2his.eastmoney.com"];
export const NAVER_HOSTS: readonly string[] = ["polling.finance.naver.com", "m.stock.naver.com", "api.stock.naver.com", "ac.stock.naver.com"];
export const TWSE_HOSTS: readonly string[] = ["openapi.twse.com.tw", "mis.twse.com.tw", "www.twse.com.tw"];

export const PAUSE_MS = 900_000;

/** `http` limited to `hosts` (as `cnHosts`) and polite: a reply of 403 or 429, or one `isRefusalPage` recognises (the ask then throws "refused"),
 * pauses that host for `pauseMs`; while paused an ask to it throws "paused" and sends nothing. Other hosts are not affected. */
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
      if (reply.status === 403 || reply.status === 429) pausedUntil.set(host, clock() + pauseMs);
      else if (o.isRefusalPage?.(reply)) { pausedUntil.set(host, clock() + pauseMs); throw new Error("refused"); }
    }
    return reply;
  };
}

/** One more ask after a "timeout" or a network error (a TypeError, as fetch throws); never after a status, a pause, a refusal or anything else */
export async function retryOnce(ask: () => Promise<CnReply>): Promise<CnReply> {
  try { return await ask(); }
  catch (e) {
    if ((e as Error)?.message === "timeout" || e instanceof TypeError) return ask();
    throw e;
  }
}
