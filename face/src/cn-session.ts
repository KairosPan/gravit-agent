/** The A-share session: trading, the midday break or closed. Tencent's quote
 * host says open or closed (`q=marketStat`, its SH and SZ entries); the
 * Beijing clock says lunch, and decides alone when Tencent's word does not
 * parse. The last session's date is 上证指数's last trade (`sh000001`, field
 * 30). Measured 2026-10-31: only the closed form (`SH_close_已休市`); the
 * token between the underscores is read, never the Chinese words.
 */
import type { QuoteFetch } from "./quote-snapshots.ts";

export type CnPhase = "trading" | "midday" | "closed";
export interface CnSession { phase: CnPhase; lastSession: string | null }

/** The codes a qt.gtimg.cn request carries for the session, ahead of any quote's. */
export const SESSION_CODES = ["marketStat", "sh000001"] as const;

/** Kept here, not imported from quote-snapshots.ts, which imports this module; a test pins them to its own. */
export const SESSION_RESPONSE_LIMIT = 1024 * 1024;
export const SESSION_TIMEOUT_MS = 7_000;

const clock = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** Tencent's word on the A-share market: SH's token, else SZ's — `open` or `closed`, else null. */
export function parseMarketStat(text: string): "open" | "closed" | null {
  const stat = /v_marketStat="([^"]*)"/.exec(text)?.[1];
  if (stat === undefined) return null;
  for (const market of ["SH", "SZ"]) {
    const token = new RegExp(`(?:^|\\|)${market}_([a-z]+)_`).exec(stat)?.[1];
    if (token === "open") return "open";
    if (token === "close") return "closed";
  }
  return null;
}

/** A Tencent time (`YYYYMMDDHHMMSS`, Beijing) to its date, `YYYY-MM-DD`; anything else is null. */
export function beijingDate(tencentTime: string | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})\d{6}$/.exec(tencentTime ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** The session's phase at `nowMs`, from Tencent's word and the Beijing clock. */
export function cnPhase(nowMs: number, stat: "open" | "closed" | null, lastSession: string | null): CnPhase {
  const parts = Object.fromEntries(clock.formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = !["Sat", "Sun"].includes(parts.weekday!);
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const lunch = weekday && minute >= 690 && minute < 780;
  if (stat === "open") return lunch ? "midday" : "trading";
  if (stat === "closed") return lunch && lastSession === today ? "midday" : "closed";
  if (!weekday) return "closed";
  if (lunch) return "midday";
  return (minute >= 570 && minute < 690) || (minute >= 780 && minute < 900) ? "trading" : "closed";
}

/** The session from a decoded qt reply holding `v_marketStat` and `v_sh000001`. */
export function sessionFromReply(text: string, nowMs: number): CnSession {
  const index = /v_sh000001="([^"]*)"/.exec(text)?.[1]?.split("~");
  const lastSession = beijingDate(index?.[30]);
  return { phase: cnPhase(nowMs, parseMarketStat(text), lastSession), lastSession };
}

/** One GET for the session alone; any failure is the Beijing clock's word with no last session. */
export async function readCnSession(fetcher: QuoteFetch, nowMs: number, signal?: AbortSignal): Promise<CnSession> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
  try {
    const response = await fetcher(new URL(`https://qt.gtimg.cn/q=${SESSION_CODES.join(",")}`),
      { method: "GET", redirect: "error", signal: controller.signal });
    if (!response.ok) throw new Error("http");
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > SESSION_RESPONSE_LIMIT) throw new Error("payload");
    return sessionFromReply(new TextDecoder("gbk").decode(body), nowMs);
  } catch {
    return { phase: cnPhase(nowMs, null, null), lastSession: null };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
