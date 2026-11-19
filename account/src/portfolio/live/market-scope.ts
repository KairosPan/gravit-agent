/** Markets' three browsing scopes. Filter venues before reading them, and a Hyperliquid venue's contracts before the aggregator
 * requests their day figures or ranks them. The optional trader scope reaches the full namespace, beyond its small start-from list. */
import { isRefusal, type Refusal } from "../../core/errors.ts";
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

/** a source's connection, or the wallet a MetaMask connection is */
const connects = (s: PublicSource, connector: string | undefined): boolean => connector === s.connector || (s.connector === "live:wallet" && connector === "live:metamask");

/** the answers of one trader asked once per listed source, joined: a symbol once, in the order asked; refused only when every one refused */
function joined(got: Array<Market[] | Refusal>, keep: (m: Market) => boolean): Market[] | Refusal {
  const answered = got.filter((g): g is Market[] => !isRefusal(g));
  if (!answered.length) return got.find(isRefusal)!;
  const seen = new Set<string>();
  return answered.flat().filter((m) => keep(m) && !seen.has(m.symbol) && (seen.add(m.symbol), true));
}

/** THE VENUES A MARKETS QUESTION READS, scoped and narrowed to a list of sources before their stats and the limit: a venue is kept when it is
 * paper, its id is a listed source's, or its connection is one (a MetaMask connection is the wallet's); a line counts when its venue's id
 * is listed or it is one of a listed source's (marketInSource). The trader seam takes one source, so a venue is asked once per listed source
 * it speaks for (paper: every one) and the answers joined */
export function scopedExploreVenues(venues: ExploreVenue[], scope?: MarketScope, sources: readonly PublicSource[] = []): ExploreVenue[] {
  const listed = sources.length > 0;
  if (!scope && !listed) return venues;
  return venues.flatMap((v) => {
    const hl = /^live:hyperliquid(?:-trade|-paper)?$/.test(v.connector ?? "");
    const paper = v.connector === "live:paper";
    const byId = sources.some((s) => s.id === v.id);
    const mine = paper ? sources : sources.filter((s) => connects(s, v.connector));
    if (listed && !paper && !byId && !mine.length) return [];
    if (scope && !hl && !paper && scope !== "more") return [];
    if (!listed && !hl && !paper) return [v];
    const keep = (m: Market): boolean => (!scope || paper || !hl || marketInScope(m, scope)) && (!listed || byId || sources.some((s) => marketInSource(m, s)));
    const asked = mine.map((s) => s.id);
    const events = mine.filter((s) => s.kind === "events");
    const trader = Object.assign(Object.create(v.trader) as LiveTrader, {
      markets: async (q: string) => {
        if (!asked.length) {
          const got = await v.trader.markets(q, scope);
          return isRefusal(got) ? got : got.filter(keep);
        }
        return joined(await Promise.all(asked.map((id) => v.trader.markets(q, scope, id))), keep);
      },
      ...(listed ? {
        events: events.length && v.trader.events ? async (o: Parameters<NonNullable<LiveTrader["events"]>>[0]) => {
          const ids = paper ? events.map((s) => s.id) : [undefined];
          return joined(await Promise.all(ids.map((id) => v.trader.events!(o, id))), keep);
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
