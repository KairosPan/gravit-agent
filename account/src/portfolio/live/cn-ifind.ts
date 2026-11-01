/** The iFinD client (QuantAPI `smart_stock_picking`), moved from Lunhui's wencai.mjs: the token handling and nothing else. The token comes from the
 * Account process's environment only, is held in this instance's memory, and appears in no answer. The reply is handed back as it came (status and
 * bytes unchanged, whatever its errorcode); only a failure to ask at all is a refusal, in a word that carries no token. */
import type { CnHttp } from "./cn-http.js";

export const IFIND_HOST = "quantapi.51ifind.com";
export const IFIND_DEADLINE_MS = 15_000, IFIND_MAX_BYTES = 4 * 1024 * 1024, TOKEN_TTL_MS = 6 * 24 * 3600 * 1000;
/** the boards stand-in's one query (wencai.mjs), its date the only part that varies */
export const IFIND_QUERY = /^A股 \d{4}年\d{2}月\d{2}日涨跌幅 成交额 主力资金流向 所属概念$/;

export type IfindWord = "unconfigured" | "credential" | "timeout" | "too-large" | "unreachable";
export type IfindAnswer =
  | { kind: "upstream"; status: number; contentType?: string; bytes: Uint8Array }
  | { kind: "refused"; word: IfindWord };
export interface CnIfind { configured(): boolean; ask(query: string): Promise<IfindAnswer> }

const BASE = `https://${IFIND_HOST}/api/v1`;

class Refusal extends Error { constructor(readonly word: IfindWord) { super(word); } }

function parse(bytes: Uint8Array): Record<string, any> | null {
  try {
    const v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

export function createIfind(opts: { env: () => Record<string, string | undefined>; http: CnHttp; now?: () => number }): CnIfind {
  const now = opts.now ?? Date.now;
  let cached: { value: string; until: number } | null = null;
  const creds = () => { const e = opts.env(); return { direct: e.IFIND_ACCESS_TOKEN || "", refresh: e.IFIND_REFRESH_TOKEN || "" }; };

  return {
    configured() { const { direct, refresh } = creds(); return Boolean(direct || refresh); },
    async ask(query) {
      const { direct, refresh } = creds();
      if (!direct && !refresh) return { kind: "refused", word: "unconfigured" };
      const began = now();
      const call = async (path: string, headers: Record<string, string>, body: unknown) => {
        const left = IFIND_DEADLINE_MS - (now() - began);
        if (left <= 0) throw new Refusal("timeout");
        try {
          return await opts.http(`${BASE}/${path}`, {
            timeoutMs: Math.max(1, left), maxBytes: IFIND_MAX_BYTES, body: JSON.stringify(body),
            headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
          });
        } catch (e) {
          const m = e instanceof Error ? e.message : "";
          throw new Refusal(m === "timeout" ? "timeout" : m === "too-large" ? "too-large" : "unreachable");
        }
      };
      const exchange = async (): Promise<string> => {
        const r = await call("get_access_token", { refresh_token: refresh }, {});
        const j = parse(r.bytes);
        const token = j?.data?.access_token;
        if (r.status !== 200 || j?.errorcode !== 0 || typeof token !== "string" || !token) throw new Refusal("credential");
        cached = { value: token, until: now() + TOKEN_TTL_MS };
        return token;
      };
      try {
        // Only a token from the cache may be stale: it alone earns one re-exchange and one more query.
        let fromCache = !direct && cached !== null && cached.until > now();
        let token = direct || (fromCache ? cached!.value : await exchange());
        for (;;) {
          const r = await call("smart_stock_picking", { access_token: token }, { searchstring: query, searchtype: "stock" });
          const ok = r.status === 200 && parse(r.bytes)?.errorcode === 0;
          if (ok || !fromCache) return { kind: "upstream", status: r.status, ...(r.contentType ? { contentType: r.contentType } : {}), bytes: r.bytes };
          fromCache = false;
          cached = null;
          token = await exchange();
        }
      } catch (e) {
        if (e instanceof Refusal) return { kind: "refused", word: e.word };
        throw e;
      }
    },
  };
}
