/** CHINA AS THE ACCOUNT READS IT FROM THE MARKET (plan A1 task 4): a ChinaSource whose every read is the market's protocol (GET
 * /api/china/…, the market's protocol.ts), so service.ts's China tab, its hits in a search and an A share's quote and history read it as
 * they read Tencent in-process. Its status is the last the market sent beside an answer; while the market does not answer, it is
 * unavailable, in the account's one sentence for that (MARKET_DOWN). */
import { isRefusal, type Refusal } from "../../core/errors.ts";
import type { ExploreItem } from "../live/explore.ts";
import { MARKET_DOWN, type MarketClient } from "./client.ts";
import { readLike, type ChinaHistory, type ChinaMarket, type ChinaRange, type ChinaRead, type ChinaSort, type ChinaSource, type ChinaStatus } from "./shapes.ts";

/** how long each China read is kept here, ms: the market keeps Tencent's answers its own while (china.ts), this only shares a burst */
export const CHINA_KEEP = { rank: 2_000, search: 5_000, quotes: 2_000, history: 10_000 } as const;
/** the most symbols one quotes read takes (china.ts SEARCH_RESULTS) */
const QUOTES_MOST = 30;

const isStatus = (v: unknown): v is ChinaStatus => !!v && typeof v === "object" && ["live", "stale", "unavailable"].includes((v as ChinaStatus).state) && typeof (v as ChinaStatus).said === "string";

export function remoteChina(c: MarketClient): ChinaSource {
  let last: ChinaStatus | undefined;
  let asking: Promise<unknown> | undefined;
  /** the status the market sent, kept */
  const heard = (extra: Record<string, unknown>) => {
    if (isStatus(extra.status)) last = extra.status;
  };
  /** the status asked of the market alone (after a refusal, whose envelope's status the transport does not hand on, or before any read) */
  const ask = (): Promise<unknown> =>
    (asking ??= c
      .get<ChinaStatus>("/api/china/status", 0)
      .then((r) => {
        if (!isRefusal(r) && isStatus(r.value)) last = r.value;
      })
      .finally(() => (asking = undefined)));
  /** one read: its value, or its refusal — after which the market's status is asked, so status() says what the refusal was */
  const read = async <T>(path: string, ttlMs: number): Promise<T | Refusal> => {
    const r = await c.get<T>(path, ttlMs);
    if (isRefusal(r)) {
      if (c.staleSince() === undefined) await ask();
      return r;
    }
    heard(r.extra);
    return r.value;
  };
  return {
    rank: (sort: ChinaSort) => read<{ items: ExploreItem[]; read: ChinaRead }>(`/api/china/rank?sort=${encodeURIComponent(sort)}`, CHINA_KEEP.rank),
    search: (q: string) => read<ExploreItem[]>(`/api/china/search?q=${encodeURIComponent(q)}`, CHINA_KEEP.search),
    async quotes(symbols: readonly string[]): Promise<Map<string, ChinaMarket> | Refusal> {
      const asked = symbols.slice(0, QUOTES_MOST);
      if (!asked.length) return new Map();
      const r = await read<Array<[string, ChinaMarket]>>(`/api/china/quotes?symbols=${encodeURIComponent(asked.join(","))}`, CHINA_KEEP.quotes);
      return isRefusal(r) ? r : readLike(new Map(r), r);
    },
    history: (symbol: string, range: ChinaRange) => read<ChinaHistory>(`/api/china/history?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`, CHINA_KEEP.history),
    status(): ChinaStatus {
      if (c.staleSince() !== undefined) return { state: "unavailable", said: MARKET_DOWN };
      if (!last) {
        // nothing heard yet: asked now, and said as not answering until it is
        void ask();
        return { state: "unavailable", said: MARKET_DOWN };
      }
      return { ...last };
    },
  };
}
