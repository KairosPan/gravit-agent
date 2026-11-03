/** Reading an address from the chains it can hold dollars on, and Robinhood Chain, where Robinhood's Stock Tokens live.
 *
 * Seven EVM chains, each through a public JSON-RPC endpoint (the ones the `viem` library ships as defaults; `PORTFOLIO_RPC_<CHAIN>` puts
 * your own in its place — public endpoints are rate-limited, and whoever runs one sees the address asked about and the machine asking).
 * A token's decimals are read from the token itself rather than assumed: the same dollar is 6 decimals on one chain and 18 on another.
 * A chain that does not answer is left out and named, so one slow endpoint does not blank the wallet — and an endpoint that refuses this
 * network (a 429, a 403 edge page, a 451) is a chain that did not answer, never a wallet that holds nothing. A wait an endpoint asks for
 * (its Retry-After) is kept here as a hold, not slept through inside a read: one per-IP 429 saying "an hour" does not stall the wallet.
 *
 * The reader only reads (`eth_call`, `eth_getBalance`, a transaction and its receipt by hash). The one thing that SENDS is `publicSender`:
 * a dollar transfer from an agent wallet the account holds the key of (account/keystore.ts), and nothing else.
 */
// Trimmed copy of account/src/portfolio/live/chain.ts at 20ead850 (account split, plan A1): the market's own from here.
import { type Chain } from "viem";

import { arbitrum, base, bsc, mainnet, optimism, polygon, robinhood } from "viem/chains";

export type ChainName = "Ethereum" | "Optimism" | "BNB Chain" | "Polygon" | "Base" | "Arbitrum" | "Robinhood Chain";

export const CHAINS: Record<ChainName, { chain: Chain; coin: string; env: string }> = {
  Ethereum: { chain: mainnet, coin: "ETH", env: "PORTFOLIO_RPC_ETHEREUM" },
  Optimism: { chain: optimism, coin: "ETH", env: "PORTFOLIO_RPC_OPTIMISM" },
  "BNB Chain": { chain: bsc, coin: "BNB", env: "PORTFOLIO_RPC_BNB" },
  Polygon: { chain: polygon, coin: "POL", env: "PORTFOLIO_RPC_POLYGON" },
  Base: { chain: base, coin: "ETH", env: "PORTFOLIO_RPC_BASE" },
  Arbitrum: { chain: arbitrum, coin: "ETH", env: "PORTFOLIO_RPC_ARBITRUM" },
  // Robinhood's own Arbitrum-stack chain (4663), where its Stock Tokens live: they are read here, and traded from the wallet against USDG
  // through LI.FI (dex.ts). No dollar in the table above runs on it, so the account's own payments do not
  "Robinhood Chain": { chain: robinhood, coin: "ETH", env: "PORTFOLIO_RPC_ROBINHOOD" },
};
export const CHAIN_BY_ID = new Map<number, ChainName>(Object.entries(CHAINS).map(([name, c]) => [c.chain.id, name as ChainName]));
