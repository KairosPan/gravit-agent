/** A-share quotes from Tencent's public quote host (qt.gtimg.cn), parsed: the half of the face's quote-snapshots.ts that reads a reply.
 * One GET carries the session's two codes first (cn-session.ts), then the quotes':
 * https://qt.gtimg.cn/q=marketStat,sh000001,sh600519,sz300750,bj920185 */
import { sessionFromReply, type CnSession } from "./cn-session.ts";

export const QUOTE_TIMEOUT_MS = 7_000, QUOTE_RESPONSE_LIMIT = 1024 * 1024;

export interface CnQuote {
  symbol: string; name: string | null; price: number | null; prevClose: number | null; volume: number | null; asOf: string | null;
  open: number | null; high: number | null; low: number | null; turnover: number | null; turnoverRate: number | null; marketCap: number | null;
  peTtm: number | null; limitUp: number | null; limitDown: number | null; amplitude: number | null;
}

function number(value: unknown, positive = false): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && (positive ? parsed > 0 : parsed >= 0) ? parsed : null;
}
/** Tencent's time is `YYYYMMDDHHMMSS`, Beijing local; anything else is no time,
 * and receipt time never fills it. */
function tencentTimestamp(value: string | undefined): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const local = `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
  const time = Date.parse(local);
  // Date.parse rolls an impossible date over; the round trip refuses it.
  return Number.isFinite(time) && new Date(time + 8 * 3_600_000).toISOString().slice(0, 19) === local.slice(0, 19) ? local : null;
}
/** The session's cumulative volume in shares. Field 6 counts lots of 100 on most
 * boards and shares on STAR (measured 2026-10-30), so the reply's own turnover
 * (field 37, in 10,000 CNY) decides: the unit whose volume at the last price
 * comes within 2× of it. A reply no unit fits leaves the volume unknown, never
 * wrong by a factor of 100. */
function volumeShares(fields: string[], price: number | null): number | null {
  const raw = number(fields[6]);
  if (raw === 0) return 0;
  const turnover = number(fields[37], true);
  if (raw === null || price === null || turnover === null) return null;
  for (const shares of [raw * 100, raw]) {
    const ratio = turnover * 10_000 / (shares * price);
    if (ratio >= 0.5 && ratio <= 2) return shares;
  }
  return null;
}
/** A finite number of either sign (a loss-making share's P/E), or null. */
function signed(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
/** A figure Tencent gives in units of `scale` yuan (10,000 for turnover, 1e8 for market cap), in yuan. */
function scaled(value: unknown, scale: number): number | null {
  const parsed = number(value);
  return parsed === null ? null : Math.round(parsed * scale);
}

/** The exchange prefix Tencent files a six-digit A-share code under, or null. */
export function tencentCode(symbol: string): string | null {
  return /^6\d{5}$/.test(symbol) ? `sh${symbol}` : /^[03]\d{5}$/.test(symbol) ? `sz${symbol}` : /^[489]\d{5}$/.test(symbol) ? `bj${symbol}` : null;
}

/** A reply's bytes as text. GBK, decoded before the split: a GBK trail byte can read as "~" in any other decoding. */
export function decodeGbk(bytes: Uint8Array): string {
  return new TextDecoder("gbk").decode(bytes);
}

/** The session and the asked symbols' quotes from a decoded reply. A symbol with no row, a row for another code, or one under 38 fields is absent. */
export function parseTencentQuotes(text: string, symbols: readonly string[], nowMs: number): { session: CnSession; quotes: Map<string, CnQuote> } {
  const session = sessionFromReply(text, nowMs);
  const rows = new Map<string, string[]>();
  for (const [, code, value] of text.matchAll(/v_(\w+)="([^"]*)";/g)) {
    const fields = value!.split("~");
    if (/^(?:sh|sz|bj)\d{6}$/.test(code!) && fields.length > 37 && fields[2] === code!.slice(2)) rows.set(code!, fields);
  }
  const quotes = new Map<string, CnQuote>();
  for (const symbol of symbols) {
    const code = tencentCode(symbol), fields = code ? rows.get(code) : undefined;
    if (!fields) continue;
    const price = number(fields[3], true), asOf = tencentTimestamp(fields[30]);
    quotes.set(symbol, {
      symbol, name: fields[1]?.trim() || null, price, prevClose: number(fields[4], true),
      volume: asOf ? volumeShares(fields, price) : null, asOf,
      open: number(fields[5], true), high: number(fields[33], true), low: number(fields[34], true),
      turnover: scaled(fields[37], 10_000), turnoverRate: number(fields[38]), marketCap: scaled(fields[45], 1e8),
      peTtm: signed(fields[39]), limitUp: number(fields[47], true), limitDown: number(fields[48], true), amplitude: number(fields[43]),
    });
  }
  return { session, quotes };
}
