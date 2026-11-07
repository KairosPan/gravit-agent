/** Markets' three browsing scopes. Filter venues before reading them, and a Hyperliquid venue's contracts before the aggregator
 * requests their day figures or ranks them. The optional trader scope reaches the full namespace, beyond its small start-from list. */
import { isRefusal } from "../../core/errors.ts";
import type { PublicSource } from "../market/shapes.ts";
import type { ExploreVenue } from "./explore.ts";
import { PRE_IPO_CATEGORY } from "./preipo.ts";
import { STOCK_TOKEN_ISSUER } from "./robinhood.ts";
import type { LiveTrader, Market, MarketScope, MarketStats } from "./trade.ts";

export function marketInScope(m: Market, scope: MarketScope): boolean {
  const dex = m.dex?.toLowerCase() ?? /^([a-z][a-z0-9]*):/i.exec(m.base ?? "")?.[1]?.toLowerCase() ?? /^([a-z][a-z0-9]*):/i.exec(m.symbol)?.[1]?.toLowerCase();
  const native = m.kind === "perp" && !dex;
  const xyz = m.kind === "perp" && dex === "xyz";
  return scope === "hyperliquid" ? native : scope === "xyz" ? xyz : !native && !xyz;
}

/** Match the selected public product, not every product exposed by its connection. Generic paper markets carry their actual source. */
export function marketInSource(m: Market, source: PublicSource): boolean {
  if (m.publicSource !== undefined) return m.publicSource === source.id;
  if (source.id === "hyperliquid") return marketInScope(m, "hyperliquid");
  if (source.id === "trade-xyz") return marketInScope(m, "xyz");
  if (source.id.endsWith("-preipo")) return m.kind === "perp" && m.category === PRE_IPO_CATEGORY && !!m.group?.id.startsWith("preipo:");
  if (source.kind === "stocks") return m.kind === "stock";
  if (source.kind === "events") return m.kind === "event";
  if (source.kind === "tokens") {
    const issuer = source.id === "robinhood-stock-tokens" ? STOCK_TOKEN_ISSUER : source.id === "ondo-stocks" ? "Ondo Global Markets" : source.id === "xstocks" ? "Backed (xStocks)" : undefined;
    return m.kind === "token" && issuer !== undefined && m.issuer === issuer;
  }
  // The ordinary public exchange ticker sources enumerate dollar spot pairs; their pre-IPO derivatives have separate source IDs.
  return m.kind === "spot" || m.kind === "crypto";
}

export function scopedExploreVenues(venues: ExploreVenue[], scope?: MarketScope, source?: PublicSource): ExploreVenue[] {
  if (!scope && !source) return venues;
  return venues.flatMap((v) => {
    const hl = /^live:hyperliquid(?:-trade|-paper)?$/.test(v.connector ?? "");
    const paper = v.connector === "live:paper";
    if (source && !paper && v.connector !== source.connector && !(source.connector === "live:wallet" && v.connector === "live:metamask")) return [];
    if (scope && !hl && !paper && scope !== "more") return [];
    if (!source && !hl && !paper) return [v];
    const keep = (m: Market): boolean => (!scope || paper || !hl || marketInScope(m, scope)) && (!source || marketInSource(m, source));
    const trader = Object.assign(Object.create(v.trader) as LiveTrader, {
      markets: async (q: string) => {
        const got = source ? await v.trader.markets(q, scope, source.id) : await v.trader.markets(q, scope);
        return isRefusal(got) ? got : got.filter(keep);
      },
      ...(source ? {
        events: source.kind === "events" && v.trader.events ? async (o: Parameters<NonNullable<LiveTrader["events"]>>[0]) => {
          const got = await v.trader.events!(o, paper ? source.id : undefined);
          return isRefusal(got) ? got : got.filter(keep);
        } : undefined,
      } : paper && scope && scope !== "more" ? { events: undefined } : {}),
      ...(v.trader.stats ? {
        // The connector bounds one stats request to forty markets; a scope is its full universe. Its context cache shares
        // each DEX's metadata read across these batches, while the aggregator still ranks every returned contract together.
        stats: async (symbols?: string[]) => {
          if (!symbols || symbols.length <= 40) return v.trader.stats!(symbols);
          const batches = Array.from({ length: Math.ceil(symbols.length / 40) }, (_, i) => symbols.slice(i * 40, (i + 1) * 40));
          const got = await Promise.all(batches.map((batch) => v.trader.stats!(batch)));
          const out = new Map<string, MarketStats>();
          let refused;
          for (const part of got) {
            if (isRefusal(part)) refused ??= part;
            else for (const [symbol, day] of part) out.set(symbol, day);
          }
          return !out.size && refused ? refused : out;
        },
      } : {}),
    });
    return [{ ...v, trader }];
  });
}
