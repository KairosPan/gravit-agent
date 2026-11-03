/** THE MARKET'S CORE: what the market's routes answer from — the keyless public sources (each read through the market's own read cache,
 * read-cache.ts keptSource), the stream hub (the venues' streams joined with the US shares' background reader), China, a coin's price,
 * Lunhui's relay and iFinD client, and the AKShare sidecar. `createMarketCore` takes each as it is handed (a test's fakes; absent: none);
 * `realMarketCore` is the main's, built over the real network. It holds no wallet, no home and no key, and writes nothing to disk. */
import { createAkshare, akshareCommand, type Akshare } from "./live/akshare.ts";
import { chinaSource, type ChinaSource } from "./live/china.ts";
import { cnHosts, realCnHttp } from "./live/cn-http.ts";
import { createIfind, IFIND_HOST, type CnIfind } from "./live/cn-ifind.ts";
import { createCnRelay, type CnRelay } from "./live/cn-relay.ts";
import { historyKeep, pageWeight } from "./live/history.ts";
import { publicPrices, type Price } from "./live/prices.ts";
import { publicSources, type PublicSource } from "./live/public-markets.ts";
import { joinHubs, StreamHub, type HubVenue, type MarketHub } from "./live/stream-hub.ts";
import type { Candle, CandlePage } from "./live/trade.ts";
import { HISTORY_KEPT, HISTORY_KEPT_BARS, isBan, keptSource, notServedBy, ReadCache } from "./read-cache.ts";

export interface MarketCoreOptions {
  /** the keyless public sources (absent: none — only the main builds publicSources()) */
  sources?: PublicSource[] | undefined;
  /** the stream hub (absent: none) */
  hub?: MarketHub | undefined;
  china?: ChinaSource | undefined;
  /** a coin's price in dollars (absent: none, every asset undefined) */
  price?: Price | undefined;
  /** Lunhui's reach behind /api/cn/* (absent: both routes answer `off`) */
  cn?: { relay: CnRelay; ifind: CnIfind } | undefined;
  /** the AKShare sidecar behind /api/akshare/* (absent: both routes answer `off`) */
  akshare?: Akshare | undefined;
  clock?: (() => number) | undefined;
}

export interface MarketCore {
  /** every source, each wrapped once by keptSource */
  sources(): PublicSource[];
  source(id: string): PublicSource | undefined;
  readonly hub: MarketHub | undefined;
  readonly china: ChinaSource | undefined;
  readonly price: Price;
  readonly cn: MarketCoreOptions["cn"];
  readonly akshare: Akshare | undefined;
  /** the hub closed, then the AKShare child ended — the child ended even when the hub's close throws */
  close(): Promise<void>;
}

const noPrice: Price = () => Promise.resolve(undefined);

/** the core over a read cache made beforehand (realMarketCore's hub asks it whether a venue's REST answers) */
function coreOver(cache: ReadCache, o: MarketCoreOptions): MarketCore {
  const histories = historyKeep<Candle[] | CandlePage>({ entries: HISTORY_KEPT, most: HISTORY_KEPT_BARS, weigh: pageWeight, ...(o.clock ? { clock: o.clock } : {}) });
  const kept = (o.sources ?? []).map((s) => keptSource(cache, s, histories));
  const byId = new Map(kept.map((s) => [s.id, s]));
  let closing: Promise<void> | undefined;
  return {
    sources: () => kept,
    source: (id) => byId.get(id),
    hub: o.hub,
    china: o.china,
    price: o.price ?? noPrice,
    cn: o.cn,
    akshare: o.akshare,
    close() {
      closing ??= (async () => {
        try {
          o.hub?.close();
        } finally {
          await o.akshare?.close();
        }
      })();
      return closing;
    },
  };
}

export function createMarketCore(o: MarketCoreOptions): MarketCore {
  return coreOver(new ReadCache(), o);
}

/** WHETHER A VENUE'S REST ANSWERS THIS NETWORK, as the hub asks before it streams the venue (service.ts restAnswers): its listing answered
 * in this run, through the market's own read cache, and no refusal that is the venue's rule for this network — its place rule, the server
 * in front of it, a ban — holds it back now. A REST read that merely timed out or was told to wait does not close a stream; Hyperliquid's
 * REST is either of its two listings */
export function restAnswers(cache: ReadCache, venue: HubVenue): boolean {
  const ids = venue === "hyperliquid" ? ["hyperliquid", "hyperliquid-preipo"] : [venue];
  return ids.some((id) => {
    const ns = `public:${id}`;
    const held = cache.heldOf(ns);
    if (held && (notServedBy(held) !== undefined || isBan(held))) return false;
    return !!cache.healthOf(ns)?.lastOkAt;
  });
}

/** THE MAIN'S CORE, over the real network: every keyless source, the venues' streams joined with each source's own background reader
 * (the US stocks line's), Tencent's China, the exchanges' prices, Lunhui's relay and iFinD (its token from this process's environment),
 * and the AKShare sidecar (MARKET_AKSHARE_BIN), started on first use. No socket opens and no child starts until something is asked */
export function realMarketCore(): MarketCore {
  const cache = new ReadCache();
  const sources = publicSources();
  const feeds = sources.flatMap((x) => (x.feed ? [x.feed] : []));
  const hub = joinHubs(new StreamHub({ answers: (v) => restAnswers(cache, v) }), ...feeds);
  return coreOver(cache, {
    sources,
    hub,
    china: chinaSource(),
    price: publicPrices(),
    cn: { relay: createCnRelay(realCnHttp), ifind: createIfind({ env: () => process.env, http: cnHosts(realCnHttp, [IFIND_HOST]) }) },
    akshare: createAkshare({ command: akshareCommand() }),
  });
}
