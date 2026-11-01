/** The A-share relay: the Lunhui freezes fetch their endpoints through the Account, which answers the upstream's status, content type,
 * location and raw bytes unchanged - no decoding, no caching, no redirect followed. Only the listed (host, path) pairs are asked; anything
 * else is refused with a word. Three request headers pass (cut at 256 characters, dropped if they hold CR or LF); a cookie never does. */
import { type CnHttp, cnHosts } from "./cn-http.ts";

export const RELAY_TIMEOUT_MS = 7_000;
export const MINUTES_TIMEOUT_MS = 4_000;
export const RELAY_MAX_BYTES = 512 * 1024;
export const RELAY_IN_FLIGHT = 16;
export const RELAY_URL_MAX = 2_048;
export const RELAY_HOSTS: readonly string[] = ["qt.gtimg.cn", "web.ifzq.gtimg.cn", "push2ex.eastmoney.com", "push2.eastmoney.com", "push2delay.eastmoney.com"];
export const RELAY_HEADERS = ["accept", "referer", "user-agent"] as const;
const HEADER_MAX = 256;

export interface RelayTarget { url: string; timeoutMs: number; maxBytes: number }

const PATHS: Readonly<Record<string, readonly string[]>> = {
  "web.ifzq.gtimg.cn": ["/appstock/app/fqkline/get", "/appstock/app/day/query"],
  "push2ex.eastmoney.com": ["/getTopicZTPool", "/getTopicZBPool", "/getYesterdayZTPool", "/getTopicZDFenBu"],
  "push2.eastmoney.com": ["/api/qt/clist/get"],
  "push2delay.eastmoney.com": ["/api/qt/clist/get"],
};

/** The target of a URL the rows ask, with its limits, or null when the URL is not one of them */
export function relayTarget(raw: string): RelayTarget | null {
  if (raw.length > RELAY_URL_MAX) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.hash || raw.includes("#")) return null;
  const host = u.hostname;
  let timeoutMs = RELAY_TIMEOUT_MS;
  if (host === "qt.gtimg.cn") {
    if (!/^\/q=[A-Za-z0-9_,]{1,1024}$/.test(u.pathname) || u.search) return null;
  } else {
    if (!PATHS[host]?.includes(u.pathname)) return null;
    if (u.pathname === "/appstock/app/day/query") timeoutMs = MINUTES_TIMEOUT_MS;
  }
  return { url: raw, timeoutMs, maxBytes: RELAY_MAX_BYTES };
}

export type RelayWord = "not-listed" | "timeout" | "too-large" | "unreachable";
export type RelayAnswer =
  | { kind: "upstream"; status: number; contentType?: string; location?: string; bytes: Uint8Array }
  | { kind: "refused"; word: RelayWord };
export type CnRelay = (url: string, headers: Record<string, string>) => Promise<RelayAnswer>;

function passedHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const name = k.toLowerCase();
    if (!(RELAY_HEADERS as readonly string[]).includes(name) || typeof v !== "string" || /[\r\n]/.test(v)) continue;
    out[name] = v.slice(0, HEADER_MAX);
  }
  return out;
}

export function createCnRelay(http: CnHttp, opts: { inFlight?: number } = {}): CnRelay {
  const guarded = cnHosts(http, RELAY_HOSTS);
  const cap = opts.inFlight ?? RELAY_IN_FLIGHT;
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = async (): Promise<void> => {
    if (active < cap) { active++; return; }
    await new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = (): void => {
    const next = waiting.shift();
    if (next) next(); else active--;
  };
  return async (url, headers) => {
    const target = relayTarget(url);
    if (!target) return { kind: "refused", word: "not-listed" };
    await acquire();
    try {
      const r = await guarded(target.url, { timeoutMs: target.timeoutMs, maxBytes: target.maxBytes, headers: passedHeaders(headers) });
      return { kind: "upstream", status: r.status, ...(r.contentType ? { contentType: r.contentType } : {}), ...(r.location ? { location: r.location } : {}), bytes: r.bytes };
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      return { kind: "refused", word: m === "timeout" ? "timeout" : m === "too-large" ? "too-large" : "unreachable" };
    } finally { release(); }
  };
}
