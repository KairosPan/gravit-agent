/** A-share discovery through Tencent's smartbox, parsed: the parsing half of the face's symbol-search.ts.
 * Suggestions identify instruments and carry no quote. The routes, the caches and the fence stay behind. */

export const SEARCH_TIMEOUT_MS = 6_000, SEARCH_RESPONSE_LIMIT = 256 * 1024, SEARCH_RESULTS = 30;
export interface CnHit { symbol: string; name: string; exchange: "SH" | "SZ" | "BJ" }

/** The kinds Tencent files an A share under: `GP-A`, and `GP-A-KCB` on the STAR
 * Market, its CDRs among them. An index (`ZS`), a fund (`ETF`, `LOF`, `KJ`) and
 * a B share (`GP-B`) are none: their codes collide with an A share's
 * (`sh000001`, the index, beside `sz000001`) or are no code the quote wire files. */
const A_SHARE_KINDS = new Set(["GP-A", "GP-A-KCB"]);

/** The smartbox reply's bytes are GB18030. */
export function decodeSmartbox(bytes: Uint8Array): string {
  return new TextDecoder("gb18030").decode(bytes);
}

/** Tencent's smartbox returns a JavaScript string assignment, not executable
 * data. Parse the quoted string as JSON; never evaluate vendor JavaScript. */
export function parseTencentSearch(body: string): { hits: CnHit[]; truncated: boolean } {
  const match = /^\s*v_hint\s*=\s*("(?:[^"\\]|\\.)*")\s*;?\s*$/s.exec(body);
  if (!match) throw new Error("invalid provider response");
  const value: unknown = JSON.parse(match[1]!);
  if (typeof value !== "string") throw new Error("invalid provider response");
  // Tencent explicitly uses "N" for a successful query with no suggestions.
  const rows = value && value !== "N" ? value.split("^").filter(Boolean) : [];
  const hits = new Map<string, CnHit>();
  for (const row of rows) {
    if (row.split("~").length < 5) throw new Error("invalid provider response");
    const [venue, symbol, name, , kind] = row.split("~");
    if (!venue || !["sh", "sz", "bj"].includes(venue) || !A_SHARE_KINDS.has(kind ?? "")
      || !symbol || !/^\d{6}$/.test(symbol) || !name?.trim()) continue;
    hits.set(symbol, { symbol, name: name.trim(), exchange: venue.toUpperCase() as CnHit["exchange"] });
  }
  return { hits: [...hits.values()], truncated: rows.length >= 10 };
}

export function searchUrl(q: string): string {
  const url = new URL("https://smartbox.gtimg.cn/s3/");
  url.searchParams.set("q", q);
  url.searchParams.set("t", "all");
  return url.href;
}
