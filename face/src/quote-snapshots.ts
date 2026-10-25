/** On-demand A-share quote snapshots from iFinD; no instrument directory or
 * on-disk market cache. Official schema:
 * quantapi.10jqka.com.cn/gwstatic/static/ds_web/quantapi-web/help-center/manual.html
 */
import type { ProviderState, QuoteIdentity, QuoteUpdate, SnapshotResult, SnapshotSource } from "./quote-types.ts";

export type QuoteFetch = (url: URL, options: RequestInit) => Promise<Response>;
export interface QuoteSnapshotOptions {
  fetcher?: QuoteFetch;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  timeoutMs?: number;
}
export const QUOTE_RESPONSE_LIMIT = 1024 * 1024;
export const QUOTE_TIMEOUT_MS = 7_000;
const IFIND_ROOT = "https://quantapi.51ifind.com/api/v1/";
class ProviderError extends Error {
  constructor(readonly kind: "http" | "payload" | "timeout" | "abort", readonly status = 0) { super(kind); }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function number(value: unknown, positive = false): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && (positive ? parsed > 0 : parsed >= 0) ? parsed : null;
}
function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? value : null;
}
function field(row: Record<string, unknown>, key: string): unknown {
  const value = row[key];
  return Array.isArray(value) ? value[0] : value;
}
/** iFinD mainland timestamps are Beijing local time. A date alone is never
 * promoted to a live timestamp, and receipt time never fills missing dates. */
function ifindTimestamp(row: Record<string, unknown>, table: Record<string, unknown>): string | null {
  const day = String(field(table, "tradeDate") ?? "").replace(/-/g, "");
  let time = String(field(table, "tradeTime") ?? "");
  if (/^\d{1,6}$/.test(time)) time = time.padStart(6, "0").replace(/(\d{2})(\d{2})(\d{2})/, "$1:$2:$3");
  let local = /^\d{8}$/.test(day) && /^\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(time)
    ? `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${time}` : null;
  if (!local) {
    const supplied = field(row, "time") ?? field(table, "time");
    const absolute = timestamp(supplied);
    if (absolute) return absolute;
    if (typeof supplied === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(supplied)) local = supplied.replace(" ", "T");
  }
  return local ? timestamp(`${local}+08:00`) : null;
}
function blank(asset: QuoteIdentity, source: string, feed: string, message: string): QuoteUpdate {
  return { id: asset.id, source, feed, basis: "previous_close", message };
}
function state(status: ProviderState["status"], message: string): ProviderState {
  return { id: "ifind", market: "cn", status, source: "iFinD", feed: "realtime", transport: "poll", message };
}
function failureMessage(provider: string, error: unknown): string {
  if (error instanceof ProviderError) {
    if (error.status === 401 || error.status === 403) return `${provider} 凭据或行情权限不可用`;
    if (error.status === 429) return `${provider} 行情请求达到限额，稍后重试`;
    if (error.kind === "timeout") return `${provider} 行情请求超时，稍后重试`;
  }
  // Never echo a vendor response, URL, thrown diagnostic, or credential.
  return `${provider} 行情暂不可用，稍后重试`;
}

export function createQuoteSnapshots(options: QuoteSnapshotOptions = {}): SnapshotSource {
  const fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? QUOTE_TIMEOUT_MS;
  let token: { value: string; until: number } | null = null;
  let tokenFlight: Promise<string> | null = null;

  async function request(url: URL, init: RequestInit, outer?: AbortSignal): Promise<unknown> {
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
      const response = await fetcher(url, { ...init, redirect: "error", signal: controller.signal });
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
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
      catch { throw new ProviderError("payload"); }
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
    return { updates: assets.map((asset) => blank(asset, provider.source, provider.feed, provider.message)), providers: [provider] };
  }

  async function accessToken(signal?: AbortSignal): Promise<string> {
    if (env.IFIND_ACCESS_TOKEN?.trim()) return env.IFIND_ACCESS_TOKEN.trim();
    if (token && token.until > now()) return token.value;
    if (tokenFlight) return tokenFlight;
    tokenFlight = request(new URL(`${IFIND_ROOT}get_access_token`), { method: "POST", headers: {
      "Content-Type": "application/json", refresh_token: env.IFIND_REFRESH_TOKEN!.trim(),
    } }, signal).then((payload) => {
      if (!object(payload) || payload.errorcode !== 0 || !object(payload.data) || typeof payload.data.access_token !== "string" || !payload.data.access_token.trim()) throw new ProviderError("payload");
      const value = payload.data.access_token.trim();
      // Fetch the currently valid token hourly; never rotate/invalidate tokens.
      token = { value, until: now() + 3_600_000 };
      return value;
    }).finally(() => { tokenFlight = null; });
    return tokenFlight;
  }

  async function ifind(assets: QuoteIdentity[], signal?: AbortSignal): Promise<SnapshotResult> {
    if (!env.IFIND_ACCESS_TOKEN?.trim() && !env.IFIND_REFRESH_TOKEN?.trim()) return unavailable(assets,
      state("unconfigured", "A 股实时行情待开通 iFinD 账号并配置接口凭据"));
    const codes = new Map(assets.map((asset) => [asset.id, /^[6]\d{5}$/.test(asset.symbol) ? `${asset.symbol}.SH`
      : /^[03]\d{5}$/.test(asset.symbol) ? `${asset.symbol}.SZ` : /^[489]\d{5}$/.test(asset.symbol) ? `${asset.symbol}.BJ` : null]));
    const supported = [...codes.values()].filter((value): value is string => value !== null);
    if (!supported.length) return unavailable(assets, state("limited", "iFinD 暂不支持这些证券代码"));
    try {
      const access = await accessToken(signal);
      const payload = await request(new URL(`${IFIND_ROOT}real_time_quotation`), { method: "POST",
        headers: { "Content-Type": "application/json", access_token: access, ifindlang: "cn" },
        body: JSON.stringify({ codes: supported.join(","), indicators: "latest,preClose,tradeDate,tradeTime" }),
      }, signal);
      if (!object(payload) || payload.errorcode !== 0 || !Array.isArray(payload.tables)) {
        token = null;
        throw new ProviderError("payload");
      }
      const rows = new Map<string, Record<string, unknown>>();
      for (const row of payload.tables) if (object(row) && typeof row.thscode === "string") rows.set(row.thscode.toUpperCase(), row);
      const updates = assets.map((asset): QuoteUpdate => {
        const code = codes.get(asset.id), row = code ? rows.get(code) : null;
        if (!row) return blank(asset, "iFinD", "realtime", code ? "该标的暂无 iFinD 行情" : "iFinD 暂不支持该证券代码");
        const table = object(row.table) ? row.table : row;
        const asOf = ifindTimestamp(row, table), price = number(field(table, "latest"), true);
        return { id: asset.id, source: "iFinD", feed: "realtime", basis: "previous_close", price,
          prev_close: number(field(table, "preClose"), true),
          // Public iFinD docs do not establish the volume unit. Enable only
          // after credentialed validation confirms shares versus lots.
          volume: null, volume_as_of: null, as_of: asOf, market_status: "unknown",
          message: price === null ? "该标的暂无成交价" : !asOf ? "行情时间缺失" : "" };
      });
      const missing = updates.some((update) => !update.price || !update.as_of);
      return { updates, providers: [state(missing ? "limited" : "connected", missing ? "部分 A 股标的暂无完整行情" : "iFinD 实时行情")] };
    } catch (error) { return unavailable(assets, state("error", failureMessage("iFinD", error))); }
  }

  return { async load(assets, signal) {
    const unique = [...new Map(assets.map((asset) => [asset.id, asset])).values()];
    return unique.length ? ifind(unique, signal) : { updates: [], providers: [] };
  } };
}
