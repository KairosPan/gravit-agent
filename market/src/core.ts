/** THE MARKET'S CORE: what the market's routes answer from — the keyless public sources (each read through the market's own read cache,
 * read-cache.ts keptSource), the stream hub (the venues' streams joined with the US shares' background reader), China, a coin's price,
 * Hong Kong, Korea and Taiwan's shares and the world's cash indices, the option chains (crypto: Deribit and OKX; US: Nasdaq), Ornn's compute indices, Nasdaq's headlines, Lunhui's relay and iFinD client, and the AKShare sidecar. `createMarketCore` takes each as it is handed (a test's fakes; absent: none);
 * `realMarketCore` is the main's, built over the real network. It holds no wallet, no home and no key, and writes nothing to disk. */
import { createAkshare, akshareCommand, type Akshare } from "./live/akshare.ts";
import { chinaSource, type ChinaSource } from "./live/china.ts";
import { cnHosts, realCnHttp } from "./live/cn-http.ts";
import { localHosts } from "./live/local-http.ts";
import { createIfind, IFIND_HOST, type CnIfind } from "./live/cn-ifind.ts";
import { eastmoney } from "./live/eastmoney.ts";
import { hongKongSource } from "./live/hongkong.ts";
import { koreaSource } from "./live/korea.ts";
import { quoteWord, type LocalSource } from "./live/local.ts";
import { cryptoOptions } from "./live/options-crypto.ts";
import { ornnSource, type OrnnSource } from "./live/ornn.ts";
import { usOptions, type UsQuote } from "./live/options-us.ts";
import { taiwanSource } from "./live/taiwan.ts";
import { worldIndices } from "./live/world-indices.ts";
import { createWencai, wencaiPerDay, type CnWencai } from "./live/cn-wencai.ts";
import { createCnRelay, type CnRelay } from "./live/cn-relay.ts";
import { historyKeep, pageWeight } from "./live/history.ts";
import { nasdaqNews, type NewsSource } from "./live/news.ts";
import { publicPrices, type Price } from "./live/prices.ts";
import { publicSources, type PublicSource } from "./live/public-markets.ts";
import { joinHubs, StreamHub, type HubVenue, type MarketHub } from "./live/stream-hub.ts";
import type { Candle, CandlePage } from "./live/trade.ts";
import { HISTORY_KEPT, HISTORY_KEPT_BARS, isBan, keptSource, notServedBy, ReadCache, thrownBy } from "./read-cache.ts";
import { isRefusal } from "./core/errors.ts";

/** the world's cash indices (world-indices.ts): a region's levels, an index's quote and history */
export type WorldIndices = ReturnType<typeof worldIndices>;
/** the option chains (options-crypto.ts, options-us.ts): each list's summaries, a chain, the source's status */
export type CryptoOptions = ReturnType<typeof cryptoOptions>;
export type UsOptions = ReturnType<typeof usOptions>;
/** how long the US option list's price of an underlying (the US stocks line's, PublicSource.line) is kept: the list asks it for every row
 * on every read, and the line's own keep (LINE_KEEP_MS) is seconds */
export const OPTION_QUOTE_KEEP_MS = 20_000;

export interface MarketCoreOptions {
  /** the keyless public sources (absent: none — only the main builds publicSources()) */
  sources?: PublicSource[] | undefined;
  /** the stream hub (absent: none) */
  hub?: MarketHub | undefined;
  china?: ChinaSource | undefined;
  /** Hong Kong (Tencent), Korea (Naver), Taiwan (TWSE) and the world's cash indices, each read of its own like China (absent: none — that
   * region's reads refuse) */
  hk?: LocalSource | undefined;
  kr?: LocalSource | undefined;
  tw?: LocalSource | undefined;
  indices?: WorldIndices | undefined;
  /** the crypto option chains (absent: none — their reads refuse) */
  cryptoOptions?: CryptoOptions | undefined;
  /** the US option chains, or how to make them over the US stocks line's quote (stocksQuote), which only the core can give (absent: none) */
  usOptions?: UsOptions | ((quote: UsQuote) => UsOptions) | undefined;
  /** a US share's headlines (absent: none — GET /api/news refuses) */
  news?: NewsSource | undefined;
  /** Ornn's compute price indices, GPU rental and token prices (absent: none — Compute's indices refuse; its events still answer) */
  ornn?: OrnnSource | undefined;
  /** a coin's price in dollars (absent: none, every asset undefined) */
  price?: Price | undefined;
  /** Lunhui's reach behind /api/cn/* (absent: both routes answer `off`) */
  cn?: { relay: CnRelay; ifind: CnIfind; wencai?: CnWencai } | undefined;
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
  readonly hk: LocalSource | undefined;
  readonly kr: LocalSource | undefined;
  readonly tw: LocalSource | undefined;
  readonly indices: WorldIndices | undefined;
  readonly cryptoOptions: CryptoOptions | undefined;
  readonly usOptions: UsOptions | undefined;
  readonly news: NewsSource | undefined;
  readonly ornn: OrnnSource | undefined;
  readonly price: Price;
  readonly cn: MarketCoreOptions["cn"];
  readonly akshare: Akshare | undefined;
  /** the read cache the sources are kept through: the public reads (reads.ts) keep their own answers (explore, a book, trades) in it too, so a
   * source held back there is held back for every read of it, as the account's one cache does */
  readonly cache: ReadCache;
  /** the real clock the reads are timed by (MarketCoreOptions.clock, else Date.now) */
  now(): number;
  /** the hub closed, then the AKShare child ended — the child ended even when the hub's close throws */
  close(): Promise<void>;
}

const noPrice: Price = () => Promise.resolve(undefined);

/** A US UNDERLYING'S PRICE AND DAY CHANGE as the market's public US stocks line gives them (the source whose kind is "stocks", by its own
 * line: PublicSource.line), kept OPTION_QUOTE_KEEP_MS in the read cache, with the line's own words for its source and delay. No line, no
 * price, or a refusal (an answer the line cannot give now): null, and the option row lists without a price */
function stocksQuote(cache: ReadCache, sources: () => PublicSource[]): UsQuote {
  return async (ticker) => {
    const src = sources().find((s) => s.kind === "stocks" && s.line);
    if (!src) return null;
    const t = ticker.trim().toUpperCase();
    const got = await cache.get(`option-quote|${src.id}|${t}`, OPTION_QUOTE_KEEP_MS, () => src.line!(t).catch((err: unknown) => thrownBy(src.id, src.name, err)));
    if (!got || isRefusal(got) || typeof got.price !== "number" || !Number.isFinite(got.price)) return null;
    const delay = typeof got.delayMs === "number" ? Math.round(got.delayMs / 60_000) : undefined;
    return {
      price: got.price,
      ...(typeof got.changePct24h === "number" && Number.isFinite(got.changePct24h) ? { changePct: got.changePct24h } : {}),
      quoteFrom: got.quoteFrom ?? quoteWord(src.name, delay),
    };
  };
}

/** the core over a read cache made beforehand (realMarketCore's hub asks it whether a venue's REST answers) */
function coreOver(cache: ReadCache, o: MarketCoreOptions): MarketCore {
  const histories = historyKeep<Candle[] | CandlePage>({ entries: HISTORY_KEPT, most: HISTORY_KEPT_BARS, weigh: pageWeight, ...(o.clock ? { clock: o.clock } : {}) });
  const kept = (o.sources ?? []).map((s) => keptSource(cache, s, histories));
  const byId = new Map(kept.map((s) => [s.id, s]));
  const us = typeof o.usOptions === "function" ? o.usOptions(stocksQuote(cache, () => kept)) : o.usOptions;
  let closing: Promise<void> | undefined;
  return {
    sources: () => kept,
    source: (id) => byId.get(id),
    hub: o.hub,
    china: o.china,
    hk: o.hk,
    kr: o.kr,
    tw: o.tw,
    indices: o.indices,
    cryptoOptions: o.cryptoOptions,
    usOptions: us,
    news: o.news,
    ornn: o.ornn,
    price: o.price ?? noPrice,
    cn: o.cn,
    akshare: o.akshare,
    cache,
    now: o.clock ?? Date.now,
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
 * REST is any of its native, trade.xyz or legacy pre-IPO listings */
export function restAnswers(cache: ReadCache, venue: HubVenue): boolean {
  const ids = venue === "hyperliquid" ? ["hyperliquid", "trade-xyz", "hyperliquid-preipo"] : [venue];
  return ids.some((id) => {
    const ns = `public:${id}`;
    const held = cache.heldOf(ns);
    if (held && (notServedBy(held) !== undefined || isBan(held))) return false;
    return !!cache.healthOf(ns)?.lastOkAt;
  });
}

/** THE MAIN'S CORE, over the real network: every keyless source, the venues' streams joined with each source's own background reader
 * (the US stocks line's), Tencent's China, Hong Kong, Korea, Taiwan and the world's indices (one Eastmoney client between Hong Kong's backup
 * and the indices', and one polite guard over the other local hosts, so a pause of a host holds for every source that asks it), the option
 * chains and Ornn's compute indices over that same guard (Deribit, OKX, Nasdaq, Ornn; the US list priced by the US stocks line), the exchanges' prices, Lunhui's relay and iFinD (its token from this process's environment),
 * and the AKShare sidecar (MARKET_AKSHARE_BIN), started on first use. No socket opens and no child starts until something is asked */
export function realMarketCore(): MarketCore {
  const cache = new ReadCache();
  const sources = publicSources();
  const feeds = sources.flatMap((x) => (x.feed ? [x.feed] : []));
  const hub = joinHubs(new StreamHub({ answers: (v) => restAnswers(cache, v) }), ...feeds);
  const em = eastmoney();
  // one polite guard over Tencent's, Naver's, TWSE's, the option venues' and Ornn's hosts: a host that pauses for one source is paused for every source that asks it
  const local = localHosts(realCnHttp);
  const ifind = createIfind({ env: () => process.env, http: cnHosts(realCnHttp, [IFIND_HOST]) });
  return coreOver(cache, {
    sources,
    hub,
    china: chinaSource(),
    hk: hongKongSource({ http: local, eastmoney: em }),
    kr: koreaSource({ http: local }),
    tw: taiwanSource({ http: local }),
    indices: worldIndices({ http: local, eastmoney: em }),
    cryptoOptions: cryptoOptions({ http: local }),
    usOptions: (quote) => usOptions({ http: local, quote }),
    news: nasdaqNews(),
    ornn: ornnSource({ http: local }),
    price: publicPrices(),
    cn: { relay: createCnRelay(realCnHttp), ifind, wencai: createWencai({ picker: ifind, configured: () => ifind.configured(), perDay: wencaiPerDay(process.env) }) },
    akshare: createAkshare({ command: akshareCommand() }),
  });
}
