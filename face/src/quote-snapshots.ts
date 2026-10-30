/** On-demand A-share quote snapshots from Tencent's public quote host, the one
 * the Lunhui quotes freeze already reads; no credential, no instrument
 * directory, no on-disk market cache. One GET per load:
 * https://qt.gtimg.cn/q=sh600519,sz300750,bj920185
 */
import type { ProviderState, QuoteIdentity, QuoteUpdate, SnapshotResult, SnapshotSource } from "./quote-types.ts";

export type QuoteFetch = (url: URL, options: RequestInit) => Promise<Response>;
export interface QuoteSnapshotOptions {
  fetcher?: QuoteFetch;
  timeoutMs?: number;
}
export const QUOTE_RESPONSE_LIMIT = 1024 * 1024;
export const QUOTE_TIMEOUT_MS = 7_000;
const TENCENT_QUOTES = "https://qt.gtimg.cn/q=";
const SOURCE = "腾讯";
const FEED = "snapshot";
class ProviderError extends Error {
  constructor(readonly kind: "http" | "payload" | "timeout" | "abort", readonly status = 0) { super(kind); }
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
/** The exchange prefix Tencent files a six-digit A-share code under, or null. */
function tencentCode(symbol: string): string | null {
  return /^6\d{5}$/.test(symbol) ? `sh${symbol}` : /^[03]\d{5}$/.test(symbol) ? `sz${symbol}` : /^[489]\d{5}$/.test(symbol) ? `bj${symbol}` : null;
}
function blank(asset: QuoteIdentity, message: string): QuoteUpdate {
  return { id: asset.id, source: SOURCE, feed: FEED, basis: "previous_close", message };
}
function state(status: ProviderState["status"], message: string): ProviderState {
  return { id: "tencent", market: "cn", status, source: SOURCE, feed: FEED, transport: "poll", message };
}
function failureMessage(error: unknown): string {
  if (error instanceof ProviderError) {
    if (error.status === 429) return "腾讯行情请求过于频繁，稍后重试";
    if (error.kind === "timeout") return "腾讯行情请求超时，稍后重试";
  }
  // Never echo a vendor response, URL or thrown diagnostic.
  return "腾讯行情暂不可用，稍后重试";
}

export function createQuoteSnapshots(options: QuoteSnapshotOptions = {}): SnapshotSource {
  const fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? QUOTE_TIMEOUT_MS;

  async function request(url: URL, outer?: AbortSignal): Promise<Buffer> {
    if (outer?.aborted) throw new ProviderError("abort");
    const controller = new AbortController();
    let rejectAbort!: (reason: unknown) => void;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const abort = (error: ProviderError) => { controller.abort(); rejectAbort(error); };
    const onAbort = () => abort(new ProviderError("abort"));
    outer?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => abort(new ProviderError("timeout")), timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const work = (async () => {
      const response = await fetcher(url, { method: "GET", redirect: "error", signal: controller.signal });
      if (controller.signal.aborted) { void response.body?.cancel(); throw new ProviderError("abort"); }
      if (!response.ok) { void response.body?.cancel(); throw new ProviderError("http", response.status); }
      if (!response.body || Number(response.headers.get("content-length")) > QUOTE_RESPONSE_LIMIT) {
        void response.body?.cancel(); throw new ProviderError("payload");
      }
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > QUOTE_RESPONSE_LIMIT) throw new ProviderError("payload");
        chunks.push(part.value);
      }
      return Buffer.concat(chunks);
    })();
    try { return await Promise.race([work, aborted]); }
    finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
      controller.abort();
      void reader?.cancel().catch(() => {});
    }
  }

  function unavailable(assets: QuoteIdentity[], provider: ProviderState): SnapshotResult {
    return { updates: assets.map((asset) => blank(asset, provider.message)), providers: [provider] };
  }

  async function tencent(assets: QuoteIdentity[], signal?: AbortSignal): Promise<SnapshotResult> {
    const codes = new Map(assets.map((asset) => [asset.id, tencentCode(asset.symbol)]));
    const supported = [...codes.values()].filter((value): value is string => value !== null);
    if (!supported.length) return unavailable(assets, state("limited", "腾讯行情不支持这些证券代码"));
    try {
      const body = await request(new URL(`${TENCENT_QUOTES}${supported.join(",")}`), signal);
      // GBK, decoded before the split: a GBK trail byte can read as "~" in any other decoding.
      const text = new TextDecoder("gbk").decode(body);
      const assignments = [...text.matchAll(/v_(\w+)="([^"]*)";/g)];
      // An unknown code answers `v_pv_none_match="1";`, so even a reply with no quote assigns something.
      if (!assignments.length) throw new ProviderError("payload");
      const rows = new Map<string, string[]>();
      for (const [, code, value] of assignments) {
        const fields = value!.split("~");
        if (/^(?:sh|sz|bj)\d{6}$/.test(code!) && fields.length > 37 && fields[2] === code!.slice(2)) rows.set(code!, fields);
      }
      const updates = assets.map((asset): QuoteUpdate => {
        const code = codes.get(asset.id), fields = code ? rows.get(code) : undefined;
        if (!fields) return blank(asset, code ? "该标的暂无腾讯行情" : "腾讯行情不支持该证券代码");
        const price = number(fields[3], true), asOf = tencentTimestamp(fields[30]);
        const volume = asOf ? volumeShares(fields, price) : null;
        return { id: asset.id, source: SOURCE, feed: FEED, basis: "previous_close", price,
          prev_close: number(fields[4], true), volume, volume_as_of: volume === null ? null : asOf,
          as_of: asOf, market_status: "unknown",
          message: price === null ? "该标的暂无成交价" : !asOf ? "行情时间缺失" : "" };
      });
      const missing = updates.some((update) => !update.price || !update.as_of);
      return { updates, providers: [state(missing ? "limited" : "connected", missing ? "部分 A 股标的暂无完整行情" : "腾讯行情")] };
    } catch (error) { return unavailable(assets, state("error", failureMessage(error))); }
  }

  return { async load(assets, signal) {
    const unique = [...new Map(assets.map((asset) => [asset.id, asset])).values()];
    return unique.length ? tencent(unique, signal) : { updates: [], providers: [] };
  } };
}
