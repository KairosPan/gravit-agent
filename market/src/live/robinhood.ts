/** Robinhood, through the interfaces Robinhood itself publishes (docs.robinhood.com and Robinhood's support pages, read 2026-10-05).
 *
 *   Robinhood stocks   agent.robinhood.com/mcp/trading — Robinhood's own MCP server, behind Robinhood's own sign-in (signin.ts). It gives
 *                      an agent read access to every Robinhood account and lets it trade only in a separate Agentic account. Reading calls
 *                      three of its tools — get_accounts, get_portfolio, get_equity_positions — and never review_equity_order,
 *                      place_equity_order or cancel_equity_order. An order the account places (the owner signed it, or an agent asked inside
 *                      its limit: market, limit, stop or stop-limit) calls get_equity_quotes, get_equity_tradability, place_equity_order,
 *                      get_equity_orders and cancel_equity_order, in the Agentic account and no other; what that account holds is read with
 *                      get_equity_positions and priced with get_equity_quotes.
 *   Robinhood Crypto   trading.robinhood.com/api/v2/crypto/ — an API key and an Ed25519 signature over api key + timestamp (seconds) + path
 *                      (with its query) + method + body, made with the private key the user created, whose public half Robinhood holds.
 *                      It reads accounts, holdings and the best bid and ask, and places (market, limit, stop and stop-limit), follows and
 *                      cancels orders (v2: the fee-tier orders).
 *   Stock Tokens       api.robinhood.com/rhj/assets and /rhj/prices/{symbol} — no key: each token's contract on Robinhood Chain (4663),
 *                      and its bid in dollars per token. A wallet's tokens are read from the chain (address.ts), and traded from a proven
 *                      wallet against USDG on Robinhood Chain through LI.FI (dex.ts), which Robinhood names among the aggregators that
 *                      quote them (docs.robinhood.com/chain/building-with-stock-tokens). This list is what makes a token on that chain a
 *                      Stock Token: an address it does not name is not one, whatever its symbol.
 *
 * None of the three moves money in or out: Robinhood's deposits and withdrawals are made in Robinhood's own app. An order moves money
 * between what the user holds at Robinhood: dollars into BTC, shares into dollars.
 */
// Trimmed copy of account/src/portfolio/live/robinhood.ts at 20ead850 (account split, plan A1): the market's own from here.
import { getAddress, isAddress, type Hex } from "viem";
import { no } from "../refuse.ts";
import { CHAIN_BY_ID, type ChainName } from "./chain.ts";
import { notTheApi, notTheApiWords, venueSaidNo, type Http } from "./types.ts";

// ---- Stock Tokens --------------------------------------------------------------------------

const RHJ = "https://api.robinhood.com/rhj";

export interface StockToken {
  symbol: string;
  name: string;
  chain: ChainName;
  address: Hex;
  /** as Robinhood's list says (`tokenDecimals`); a swap still reads them from the token itself */
  decimals?: number | undefined;
}

/** Who issues the Stock Tokens and whom they are not for, in the issuer's own words (docs.robinhood.com/chain/stock-tokens, read
 * 2026-10-06). The account knows nothing of where its owner lives: these words go with every Stock Token market, so the owner reads them
 * before signing, and the account never looks for a way around them */
export const STOCK_TOKEN_ISSUER = "Robinhood Assets (Jersey) Limited";
export const STOCK_TOKEN_TERMS =
  "Robinhood: Stock Tokens “may not be offered, sold, or delivered, directly or indirectly, in the United States or to, or for the account or benefit of, U.S. persons”, and are restricted in other places, Canada, the United Kingdom and Switzerland among them";

/** the token list changes slowly: asked again after ten minutes, kept per network so a test's stand-in is never handed another's list */
const lists = new WeakMap<Http, { at: number; tokens: StockToken[] }>();

/** every active Stock Token, on the chains this account reads */
export async function stockTokens(http: Http, now: number): Promise<StockToken[]> {
  const kept = lists.get(http);
  if (kept && now - kept.at < 10 * 60_000) return kept.tokens;
  const r = await http(`${RHJ}/assets`, { headers: { accept: "application/json" } });
  if (r.status !== 200) throw venueSaidNo("robinhood", "Robinhood's Stock Token list", r.status, r.text, [], r);
  // a 200 that is not the list (a page in its place, an empty body, no `assets`): no answer, and nothing kept — an empty list kept for ten
  // minutes would say the wallet holds no Stock Tokens
  const assets = r.body && typeof r.body === "object" ? (r.body as { assets?: unknown }).assets : undefined;
  if (!Array.isArray(assets)) throw no("E_VENUE_UNREACHABLE", { venue: "robinhood", message: notTheApi(r) ? notTheApiWords("Robinhood's Stock Token list") : "Robinhood's Stock Token list answered without its list: try again shortly", native: { status: r.status } });
  const tokens: StockToken[] = [];
  for (const a of assets as Array<Record<string, unknown>>) {
    if (a.status !== "ASSET_STATUS_ACTIVE" || typeof a.tokenSymbol !== "string") continue;
    for (const d of (Array.isArray(a.deployments) ? a.deployments : []) as Array<Record<string, unknown>>) {
      const chain = CHAIN_BY_ID.get(Number(d.chainId));
      if (chain && typeof d.contractAddress === "string" && isAddress(d.contractAddress, { strict: false })) tokens.push({ symbol: a.tokenSymbol, name: String(a.tokenName ?? a.tokenSymbol), chain, address: getAddress(d.contractAddress), ...(Number.isInteger(a.tokenDecimals) ? { decimals: Number(a.tokenDecimals) } : {}) });
    }
  }
  lists.set(http, { at: now, tokens });
  return tokens;
}
