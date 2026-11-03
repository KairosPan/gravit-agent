/** A COIN'S PRICE AS THE ACCOUNT ASKS THE MARKET (plan A1 task 4): the market's GET /api/price, kept PRICE_KEEP_MS an asset. While the
 * market does not answer, the last price it gave for that asset stands (a valuation does not drop to nothing for a minute's restart); an
 * asset it never priced has none. */
import { isRefusal } from "../../core/errors.ts";
import type { MarketClient } from "./client.ts";
import type { Price } from "./shapes.ts";

export const PRICE_KEEP_MS = 10_000;
/** the most assets whose last price is remembered */
const PRICES_KEPT = 2_000;

export function remotePrice(c: MarketClient): Price {
  const last = new Map<string, number>();
  return async (asset: string) => {
    const r = await c.get<number | null>(`/api/price?asset=${encodeURIComponent(asset)}`, PRICE_KEEP_MS);
    if (isRefusal(r)) return last.get(asset);
    if (typeof r.value !== "number" || !Number.isFinite(r.value)) return undefined;
    if (!last.has(asset) && last.size >= PRICES_KEPT) last.delete(last.keys().next().value!);
    last.set(asset, r.value);
    return r.value;
  };
}
