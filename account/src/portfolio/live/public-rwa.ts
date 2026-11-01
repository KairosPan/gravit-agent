/** TOKENISED SHARES WITHOUT A KEY, priced where they trade: so the Markets screen's RWAs tab — and a paper account — show Ondo Stocks and
 * xStocks beside Robinhood's Stock Tokens before any wallet or exchange is connected. Each token carries its issuer's own name and its own
 * words on whom it is not for (dex.ts ISSUER_TERMS), as the wallet's rows do; the account does not know where its owner lives.
 *
 *   xStocks at Gate     Backed's xStocks trade as spot pairs at Gate (AAPLX_USDT; 34 of the best-known were listed there on 2026-10-13, read
 *                       keyless from this machine): GET api.gateio.ws/api/v4/spot/tickers?currency_pair=<TICKER>X_USDT — [{currency_pair,
 *                       last, highest_bid, lowest_ask, change_percentage, quote_volume (USDT, carried as dollars as every exchange's quote
 *                       volume is), high_24h, low_24h}], 260 bytes; a pair Gate does not list answers HTTP 400 {"label": "INVALID_CURRENCY"},
 *                       read as "not at Gate". Whether the token trades now is xStocks' own word: GET api.xstocks.fi/api/v2/public/assets/
 *                       <SYMBOL>x — {name, symbol, underlyingSymbol, isTradingHalted, trading: {tradingHoursMode (TwentyFourFive), openNow,
 *                       currentPeriod (market | extended | overnight | closed), nextChangeAt}}, 5.7 KB, kept ten minutes; a symbol that is
 *                       not an xStock answers 404 and is not listed, so a Gate pair that only ends in X (TRX, GMX) is never taken for one.
 *                       Named as the exchange library names Gate's pair (AAPLX/USDT), so a key connected at Gate trades the same market;
 *                       the row is the wallet's xStock row (rwa:AAPLX, explore.ts)
 *   Ondo Stocks         Ondo Global Markets' tokens (NVDAon …) trade on chain, against USDC, from a connected wallet (dex.ts). Their price
 *                       here is LI.FI's, keyless: GET li.quest/v1/token?chain=<id>&token=<address> — {symbol, name, priceUSD, volumeUSD24H},
 *                       520 bytes, kept a minute, the Ethereum token first and BNB Chain's where that gives no price. The ten best-known,
 *                       from Ondo's own list (dex.ts KNOWN). Read-only: an Ondo Stock trades from a connected wallet, so the line offers
 *                       the wallet connection and no exchange
 *
 * Every GET goes through the fixed-host guard (public-markets.ts PUBLIC_HOSTS); a venue's 451, 429, edge page or silence is its answer for
 * its whole listing, held back as any public source's is (holdBackMs). */
import { isRefusal, type Refusal } from "../../core/errors.ts";
import { RWA_CATEGORY } from "./categories.ts";
import type { ChainName } from "./chain.ts";
import { chainIdOf, ISSUER_TERMS, knownIssued } from "./dex.ts";
import { fin, fixedHosts, has, keeper, LIST_MS, nonNeg, pos, PUBLIC_HOSTS, publicNo, readAtOf, readLike, rec, str, type Listing, type PublicDeps, type PublicSource } from "./public-markets.ts";
import type { MarketSession } from "./trade.ts";
import { realHttp, unreachable, type Http, type HttpReply } from "./types.ts";

const GATE = "https://api.gateio.ws/api/v4";
const XSTOCKS = "https://api.xstocks.fi/api/v2";
const LIFI = "https://li.quest/v1";
/** the xStocks shown before anything is typed: the best-known of the pairs Gate listed on 2026-10-13, by the share's ticker */
export const XSTOCKS_SHOWN: readonly string[] = ["NVDA", "AAPL", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "SPY", "QQQ", "COIN", "MSTR", "NFLX", "HOOD", "CRCL", "LLY", "TQQQ", "GLD", "WMT", "MCD", "ABBV", "VTI", "CSCO", "UNH", "CRWD"];
export const XSTOCKS_ID = "xstocks";
export const ONDO_STOCKS_ID = "ondo-stocks";
export const ONDO_STOCKS_READ_ONLY = "LI.FI's price of Ondo's token: an Ondo Stock trades from a connected wallet, on Ethereum or BNB Chain";
const PRICE_MS = 60_000;
const TIMEOUT_MS = 8_000;
/** a share's ticker as typed: letters, at most six */
const TICKER = /^[A-Z]{1,6}$/;

interface GateTicker {
  last?: number | undefined;
  bid?: number | undefined;
  ask?: number | undefined;
  changePct?: number | undefined;
  quoteVolume?: number | undefined;
}
interface XState {
  name: string;
  underlying: string;
  halted: boolean;
  openNow: boolean;
  period?: string | undefined;
  nextChangeAt?: string | undefined;
}

/** xStocks at Gate's spot tickers, with xStocks' own trading state, keyless (see the top of this file) */
export function xstocksPublic(deps: PublicDeps = {}): PublicSource {
  const id = XSTOCKS_ID;
  const name = "xStocks at Gate";
  const clock = deps.clock ?? Date.now;
  const http = fixedHosts(deps.http ?? realHttp, PUBLIC_HOSTS, deps.timeoutMs ?? TIMEOUT_MS);
  const tickers = keeper<GateTicker | null>(clock, PRICE_MS);
  const states = keeper<XState | null>(clock, LIST_MS);
  const ask = async (url: string): Promise<HttpReply | Refusal> => {
    try {
      return await http(url);
    } catch (err) {
      return unreachable(id, name, err);
    }
  };
  /** Gate's ticker for the pair; null where Gate lists no such pair */
  const ticker = (t: string): Promise<GateTicker | null | Refusal> =>
    tickers(t, async () => {
      const r = await ask(`${GATE}/spot/tickers?currency_pair=${encodeURIComponent(`${t}X_USDT`)}`);
      if (isRefusal(r)) return r;
      if (r.status === 400 && /INVALID_CURRENCY/i.test(r.text)) return null;
      if (r.status !== 200 || !Array.isArray(r.body)) return publicNo("gate", "Gate", r);
      const x = rec(r.body[0]);
      if (str(x.currency_pair)?.toUpperCase() !== `${t}X_USDT`) return null;
      return { last: pos(x.last), bid: pos(x.highest_bid), ask: pos(x.lowest_ask), changePct: fin(x.change_percentage), quoteVolume: nonNeg(x.quote_volume) };
    });
  /** xStocks' own record of the token; null where it issues no such token */
  const state = (t: string): Promise<XState | null | Refusal> =>
    states(t, async () => {
      const r = await ask(`${XSTOCKS}/public/assets/${encodeURIComponent(`${t}x`)}`);
      if (isRefusal(r)) return r;
      if (r.status === 404) return null;
      if (r.status !== 200 || r.body === undefined) return publicNo(id, "xStocks", r);
      const a = rec(r.body);
      if (str(a.symbol)?.toUpperCase() !== `${t}X`) return null;
      const tr = rec(a.trading);
      return { name: str(a.name) ?? `${t}x`, underlying: str(a.underlyingSymbol) ?? t, halted: a.isTradingHalted === true || tr.isTradingHalted === true, openNow: tr.openNow === true, period: str(tr.currentPeriod), nextChangeAt: str(tr.nextChangeAt) };
    });
  let shown: { of: number; total: number } | undefined;
  return {
    id,
    name,
    kind: "tokens",
    connectTo: "gate",
    connector: "live:exchange:gate",
    reset: () => {
      tickers.clear();
      states.clear();
    },
    async listings(o) {
      const Q = (o.q ?? "").trim().toUpperCase().replace(/X?(\/|_)?USDT?$/, "").replace(/X$/, "");
      const limit = Math.max(1, o.limit);
      let pool = (Q ? XSTOCKS_SHOWN.filter((t) => t.startsWith(Q)) : [...XSTOCKS_SHOWN]).slice(0, limit);
      // a ticker typed whole that the list does not carry is still asked for: xStocks says whether it issues one, Gate whether it lists it
      if (Q && !pool.length && TICKER.test(Q)) pool = [Q];
      const got = new Map<string, { t: GateTicker; s: XState }>();
      let refused: Refusal | undefined;
      // twelve at a time, Gate and xStocks asked together: the first read of the list stays inside the Markets read's four seconds
      // (xStocks answers in a second or two); the answers are kept, so the next reads ask nothing
      for (let i = 0; i < pool.length; i += 12)
        await Promise.all(
          pool.slice(i, i + 12).map(async (t) => {
            const [tk, st] = await Promise.all([ticker(t), state(t)]);
            if (isRefusal(tk)) refused ??= tk;
            else if (isRefusal(st)) refused ??= st;
            else if (tk && st) got.set(t, { t: tk, s: st });
          }),
        );
      if (!got.size && refused) return refused;
      const out: Listing[] = [];
      for (const t of pool) {
        const x = got.get(t);
        if (!x) continue;
        const closed = x.s.halted || !x.s.openNow;
        const session: MarketSession = { open: x.s.openNow && !x.s.halted, ...(x.s.nextChangeAt ? (x.s.openNow ? { closesAt: x.s.nextChangeAt } : { opensAt: x.s.nextChangeAt }) : {}) };
        out.push({
          symbol: `${t}X/USDT`,
          name: x.s.name,
          kind: "token",
          base: `${t}X`,
          quote: "USDT",
          ...(x.t.last !== undefined ? { price: x.t.last } : {}),
          ...(x.t.bid !== undefined ? { bid: x.t.bid } : {}),
          ...(x.t.ask !== undefined ? { ask: x.t.ask } : {}),
          open: !closed,
          types: [],
          session,
          ...(closed ? { note: x.s.halted ? "xStocks has halted trading in it" : `xStocks: out of its trading hours now${x.s.period ? ` (${x.s.period})` : ""}${x.s.nextChangeAt ? `, open again at ${x.s.nextChangeAt}` : ""}` } : {}),
          ...(x.t.changePct !== undefined ? { changePct24h: x.t.changePct } : {}),
          ...(x.t.quoteVolume !== undefined ? { volumeUsd24h: x.t.quoteVolume } : {}),
          category: RWA_CATEGORY,
          issuer: ISSUER_TERMS.xstocks.issuer,
          eligibility: ISSUER_TERMS.xstocks.terms,
        });
        // as old as Gate's ticker it is priced from (public-markets.ts readLike)
        readLike(out[out.length - 1], x.t);
      }
      if (!Q) shown = { of: out.length, total: XSTOCKS_SHOWN.length };
      return out;
    },
    notes: (o) => (o.q?.trim() ? ["xStocks: any xStock Gate lists, by the share's ticker; xStocks' own word on whether it trades now."] : [`xStocks at Gate: ${shown?.of ?? XSTOCKS_SHOWN.length} of the best-known, at Gate's own spot prices · search for the rest by ticker.`]),
  };
}

/** Ondo Stocks as LI.FI prices them, keyless (see the top of this file): read-only, traded from a connected wallet */
export function ondoStocksPublic(deps: PublicDeps = {}): PublicSource {
  const id = ONDO_STOCKS_ID;
  const name = "Ondo Global Markets";
  const clock = deps.clock ?? Date.now;
  const http = fixedHosts(deps.http ?? realHttp, PUBLIC_HOSTS, deps.timeoutMs ?? TIMEOUT_MS);
  const prices = keeper<{ price: number; volume?: number | undefined } | null>(clock, PRICE_MS);
  const ask = async (url: string): Promise<HttpReply | Refusal> => {
    try {
      return await http(url);
    } catch (err) {
      return unreachable(id, name, err);
    }
  };
  /** LI.FI's price of one token on one chain; null where it prices none */
  const price = (chain: ChainName, address: string): Promise<{ price: number; volume?: number | undefined } | null | Refusal> =>
    prices(`${chain}|${address}`, async () => {
      const r = await ask(`${LIFI}/token?chain=${chainIdOf(chain)}&token=${address}`);
      if (isRefusal(r)) return r;
      if (r.status === 404) return null;
      if (r.status !== 200 || r.body === undefined) return publicNo(id, "LI.FI", r);
      const t = rec(r.body);
      if (str(t.address)?.toLowerCase() !== address.toLowerCase()) return null;
      const p = pos(t.priceUSD);
      return p === undefined ? null : { price: p, volume: nonNeg(t.volumeUSD24H) };
    });
  // one row per token: its Ethereum address first (the BNB Chain one where that gives no price)
  const tokens = knownIssued().filter((k) => k.issuer === "ondo");
  const symbols = [...new Set(tokens.map((k) => k.symbol))];
  let shown: { of: number; total: number } | undefined;
  return {
    id,
    name,
    kind: "tokens",
    connectTo: "wallet",
    connector: "live:wallet",
    readOnly: ONDO_STOCKS_READ_ONLY,
    reset: () => {
      prices.clear();
    },
    async listings(o) {
      const Q = (o.q ?? "").trim().toUpperCase();
      const limit = Math.max(1, o.limit);
      const pool = (Q ? symbols.filter((s) => has(Q, s, tokens.find((k) => k.symbol === s)?.underlying)) : symbols).slice(0, limit);
      const got = new Map<string, { chain: ChainName; price: number; volume?: number | undefined; at?: number | undefined }>();
      let refused: Refusal | undefined;
      // one at a time, in the order of the list: a refusal from LI.FI ends the asking (it holds the source back as the keeper says)
      for (const s of pool) {
        for (const k of tokens.filter((x) => x.symbol === s).sort((a, b) => Number(b.chain === "Ethereum") - Number(a.chain === "Ethereum"))) {
          const p = await price(k.chain, k.address);
          if (isRefusal(p)) {
            refused ??= p;
            break;
          }
          if (p) {
            got.set(s, { chain: k.chain, ...p, at: readAtOf(p) });
            break;
          }
        }
        if (refused) break;
      }
      if (!got.size && refused) return refused;
      const out: Listing[] = [];
      for (const s of pool) {
        const x = got.get(s);
        if (!x) continue;
        const k = tokens.find((t) => t.symbol === s)!;
        out.push({
          symbol: `${s}/USDC@${x.chain}`,
          name: `${k.underlying} (${ISSUER_TERMS.ondo.kind})`,
          kind: "token",
          base: s,
          quote: "USDC",
          price: x.price,
          open: true,
          types: [],
          ...(x.volume !== undefined ? { volumeUsd24h: x.volume } : {}),
          category: RWA_CATEGORY,
          issuer: ISSUER_TERMS.ondo.issuer,
          eligibility: ISSUER_TERMS.ondo.terms,
        });
        // as old as LI.FI's price it is priced from (public-markets.ts readLike)
        readLike(out[out.length - 1], x.at);
      }
      if (!Q) shown = { of: out.length, total: symbols.length };
      return out;
    },
    notes: () => [`Ondo Stocks: ${shown?.of ?? symbols.length} of Ondo's best-known tokens, at LI.FI's price of each; traded from a connected wallet.`],
  };
}
