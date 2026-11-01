/** A-share ranking from Tencent's board-rank host, parsed: the parsing half of the face's cn-rank.ts.
 * `volume` is one call by turnover; `movers` is two by change, the gainers and the losers merged by the size of the move.
 * The routes, the cache and the fence stay behind; the Account makes the instrument key. */

export type ChinaSort = "volume" | "movers";
/** One ranked share; `turnover` in yuan. */
export interface RankRow { symbol: string; name: string; price: number | null; changePct: number | null; turnover: number | null }

export const RANK_ROWS = 20, RANK_BODY_LIMIT = 256 * 1024;
const RANK_URL = "https://proxy.finance.qq.com/cgi/cgi-bin/rank/hs/getBoardRankList";

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
function figure(value: unknown, positive = false): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && (!positive || n > 0) ? n : null;
}

/** Tencent's ranking JSON to its total and its A-share rows; a body of any other shape throws. */
export function parseTencentRank(body: string): { total: number; rows: RankRow[] } {
  const value: unknown = JSON.parse(body);
  if (!isRecord(value) || value.code !== 0 || !isRecord(value.data)) throw new Error("invalid ranking");
  const { total, rank_list: list } = value.data;
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0 || !Array.isArray(list)) throw new Error("invalid ranking");
  const rows: RankRow[] = [];
  for (const row of list) {
    if (!isRecord(row)) continue;
    const code = typeof row.code === "string" ? /^(?:sh|sz|bj)(\d{6})$/.exec(row.code) : null;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!code || !name) continue;
    const turnover = figure(row.turnover);
    rows.push({ symbol: code[1]!, name, price: figure(row.zxj, true), changePct: figure(row.zdf),
      turnover: turnover === null ? null : Math.round(turnover * 10_000) });
  }
  return { total, rows };
}

/** The gainers and the losers as one list: by the size of the move, largest first, then by turnover; each symbol once. */
export function mergeMovers(gainers: RankRow[], losers: RankRow[], limit = RANK_ROWS): RankRow[] {
  const seen = new Set<string>();
  const all = [...gainers, ...losers].filter((i) => !seen.has(i.symbol) && seen.add(i.symbol));
  const size = (i: RankRow) => (i.changePct === null ? -1 : Math.abs(i.changePct));
  return all.sort((a, b) => size(b) - size(a) || (b.turnover ?? -1) - (a.turnover ?? -1)).slice(0, limit);
}

export function rankUrl(sortType: "turnover" | "priceRatio", direct: "down" | "up", count: number): string {
  return `${RANK_URL}?_appver=11.17.0&board_code=aStock&sort_type=${sortType}&direct=${direct}&offset=0&count=${count}`;
}
