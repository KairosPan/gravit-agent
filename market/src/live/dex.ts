/** TRADING from the user's own wallet: token swaps on seven EVM chains, routed by LI.FI and sent by the WALLET — tokenised shares among
 * them: Robinhood's Stock Tokens, Ondo Stocks and xStocks.
 *
 * LI.FI (li.quest/v1) is a keyless aggregator: it finds a route across a chain's DEXes and answers one transaction for the wallet to send.
 * This process never signs and never sends a transaction. It asks LI.FI, checks what LI.FI answered, and hands the wallet, in order:
 *
 *   an approval        `approve(LI.FI's contract, exactly the amount sold)` on the token sold, when the wallet has not allowed enough
 *   the swap           the transaction LI.FI built, checked before anyone sees it: it goes to LI.FI's own contract, it pays THIS wallet, it
 *                      spends exactly what LI.FI quoted, and the least it pays is the least LI.FI quoted
 *
 *   markets            GET /v1/tokens (kept five minutes): a few well-known tokens first, then any token LI.FI verifies, found by symbol;
 *                      and the tokens an issuer stands behind (below), found by address
 *   a market           GET /v1/token: LI.FI's price in dollars, now
 *   a sell             GET /v1/quote with fromAmount: exactly this much of the token, for the chain's dollar
 *   a buy              GET /v1/quote/toAmount: this much of the token, for the dollars LI.FI works out
 *   the swap again     once the approval is on chain: a fresh quote, held to the same order (its size, side and worst price), the swap alone
 *   the hash sent      read back from the chain and held to the swap that was built (sender, contract, call, coin, chain) before it is followed
 *   what became of it  GET /v1/status by the hash the wallet sent; the chain's own receipt while LI.FI has not seen it
 *
 * A market order's worst price is kept on chain: the least a route pays (`toAmountMin`, enforced by LI.FI's contract) is held to it, and to
 * 2% from LI.FI's price, whichever is tighter. A DEX has no price grid, so nothing is rounded.
 *
 * Every market is a token against the chain's dollar: USDC on six chains (`WETH/USDC@Base`), and USDG on Robinhood Chain, where LI.FI lists
 * no USDC and Robinhood pairs its Stock Tokens with Paxos's USDG (`NVDA/USDG@Robinhood Chain`). A swap is one transaction: it goes through
 * whole or reverts. There is no book, no limit order, and nothing to call back once the wallet has sent it.
 *
 * TOKENS AN ISSUER STANDS BEHIND (category RWA, with the issuer's name and its own eligibility words). A symbol proves nothing — LI.FI's
 * list holds a "NET" and a "BULL" on Robinhood Chain that are not Robinhood's — so each is recognised by what its issuer publishes, and
 * confirmed with the issuer again before an order is built (kept a minute):
 *
 *   Robinhood Stock Tokens  on Robinhood Chain: an address on Robinhood's own list (api.robinhood.com/rhj/assets, robinhood.ts), whether or
 *                           not LI.FI's list carries it (LI.FI routes them by address; Robinhood names it among their aggregators)
 *   Ondo Stocks             on Ethereum and BNB Chain: the best known from Ondo's own list of its tokens, and any LI.FI verifies under
 *                           Ondo's `<TICKER>on` symbols; confirmed by Ondo's GMTokenManager (`gmTokenAccepted`) and the token's pause
 *                           manager (`isTokenPaused`), both read from the chain
 *   xStocks                 on Ethereum, BNB Chain, Arbitrum and Optimism: the best known from xStocks' own list, and any LI.FI verifies
 *                           as an "xStock"; confirmed by xStocks' keyless GET api.xstocks.fi/api/v2/public/assets/{symbol}
 *   OUSG, BUIDL             shown, never swapped: their contracts move them only between wallets the issuer has approved, so a swap
 *                           cannot deliver them, and the account refuses with the issuer's rule (E_VENUE_TRANSFER_RESTRICTED)
 *
 * Ondo and xStocks also issue on Solana: a wallet here is an EVM address, so those are not offered. Every issuer above excludes US persons
 * (and other places); the account does not know where its owner lives, so the issuer's words go with each market, the owner reads them
 * before signing, and a refusal by an issuer's contract (a sanctions list, a blocklist, a pause) is reported as the issuer's own rule.
 *
 * LI.FI's terms (2025-09-04) exclude sanctioned parties and places, and US persons: the market note says so, and a refusal by LI.FI on
 * those grounds is reported as LI.FI's own rule.
 */
// Trimmed copy of account/src/portfolio/live/dex.ts at 20ead850 (account split, plan A1): the market's own from here.
import { getAddress, type Hex } from "viem";
import { CHAINS, type ChainName } from "./chain.ts";
import { STOCK_TOKEN_ISSUER, STOCK_TOKEN_TERMS } from "./robinhood.ts";

// ---- the issuers ---------------------------------------------------------------------------------------------------------------------

type IssuerId = "robinhood" | "ondo" | "xstocks" | "ousg" | "buidl";

interface Issuer {
  /** what one of its tokens is called, in a market's name and a holding's line */
  kind: string;
  /** who issues it */
  issuer: string;
  /** the chains this wallet can swap it on */
  chains: ChainName[];
  /** whom it is not for, in the issuer's own words; for a restricted token, the rule that keeps it from being swapped */
  terms: string;
  /** its contract moves it only between wallets the issuer approved: no swap can deliver it, so none is built */
  restricted?: true | undefined;
}

/** Each issuer's own words, read 2026-10-06: docs.robinhood.com/chain/stock-tokens; docs.ondo.finance/ondo-stocks/eligibility and
 * /secondary-market-restrictions, and the token contract's own compliance check (its errors are UserSanctioned and UserBlocked);
 * docs.xstocks.fi; docs.ondo.finance/addresses (OUSG's OndoIDRegistry). BUIDL's whitelist is enforced by its contract, as Securitize
 * describes the fund */
const ISSUERS: Record<IssuerId, Issuer> = {
  robinhood: { kind: "Robinhood Stock Token", issuer: STOCK_TOKEN_ISSUER, chains: ["Robinhood Chain"], terms: STOCK_TOKEN_TERMS },
  ondo: {
    kind: "Ondo Stock",
    issuer: "Ondo Global Markets",
    chains: ["Ethereum", "BNB Chain"],
    terms: "Ondo: U.S. persons, and anyone in a jurisdiction Ondo prohibits (the United States and Canada among them), are “prohibited from subscribing for, acquiring or redeeming Ondo Stocks”; buying one on a secondary market represents that you are not one of them, redeeming it at Ondo needs Ondo's own KYC, and the token checks Ondo's sanctions list and blocklist on every transfer",
  },
  xstocks: { kind: "xStock", issuer: "Backed (xStocks)", chains: ["Ethereum", "BNB Chain", "Arbitrum", "Optimism"], terms: "xStocks: “not intended for distribution in the United States, to any US person, or in any other prohibited jurisdiction”" },
  ousg: {
    kind: "Ondo fund token",
    issuer: "Ondo Finance",
    chains: ["Ethereum", "Polygon"],
    terms: "OUSG moves only between addresses registered in Ondo's OndoIDRegistry: it is subscribed and redeemed at Ondo, after Ondo's own checks, and a swap cannot deliver it to a wallet Ondo has not registered",
    restricted: true,
  },
  buidl: {
    kind: "BlackRock fund token",
    issuer: "BlackRock, through Securitize",
    chains: ["Ethereum", "Polygon"],
    terms: "BUIDL moves only between wallets Securitize has approved for the fund: a swap cannot deliver it to a wallet that is not approved",
    restricted: true,
  },
};

interface Known {
  issuer: "ondo" | "xstocks";
  chain: ChainName;
  symbol: string;
  /** the share it tracks, in words */
  underlying: string;
  address: Hex;
}

/** The best-known tokenised shares, from each issuer's own list, read 2026-10-06: Ondo's spreadsheet of its tokens (linked from
 * docs.ondo.finance/addresses; each one below answered `gmTokenAccepted` true on Ondo's GMTokenManager that day) and xStocks' GET
 * /public/assets/{symbol} (an xStock has one address on every chain). They are listed even where LI.FI's token list leaves them out (it
 * lists no NVDAon on Ethereum, and routes it), read in every wallet (issuedHoldings), and confirmed with the issuer again before an order */
const KNOWN: Known[] = [
  ...(
    [
      ["NVDAon", "NVIDIA", "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE", "0xa9ee28c80f960b889dfbd1902055218cba016f75"],
      ["TSLAon", "Tesla", "0xf6b1117ec07684D3958caD8BEb1b302bfD21103f", "0x2494b603319d4d9f9715c9f4496d9e0364b59d93"],
      ["AAPLon", "Apple", "0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c", "0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4"],
      ["MSFTon", "Microsoft", "0xB812837b81a3a6b81d7CD74CfB19A7f2784555E5", "0x6bfe75d1ad432050ea973c3a3dcd88f02e2444c3"],
      ["AMZNon", "Amazon", "0xbb8774FB97436d23d74C1b882E8E9A69322cFD31", "0x4553cfe1c09f37f38b12dc509f676964e392f8fc"],
      ["GOOGLon", "Alphabet Class A", "0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc", "0x091fc7778e6932d4009b087b191d1ee3bac5729a"],
      ["METAon", "Meta Platforms", "0x59644165402b611b350645555B50Afb581C71EB2", "0xd7df5863a3e742f0c767768cdfcb63f09e0422f6"],
      ["SPYon", "SPDR S&P 500 ETF", "0xFeDC5f4a6c38211c1338aa411018DFAf26612c08", "0x6a708ead771238919d85930b5a0f10454e1c331a"],
      ["QQQon", "Invesco QQQ", "0x0e397938C1Aa0680954093495B70A9F5e2249aBa", "0x0cde6936d305d5b34667fc46425e852efd73559a"],
      ["COINon", "Coinbase", "0xF042cfa86cf1D598a75Bdb55c3507a1F39f9493b", "0xf8589b526fdd65f7f301c605a6e04f0f1b4b3620"],
    ] as const
  ).flatMap(([symbol, underlying, eth, bnb]): Known[] => [
    { issuer: "ondo", chain: "Ethereum", symbol, underlying, address: getAddress(eth) },
    { issuer: "ondo", chain: "BNB Chain", symbol, underlying, address: getAddress(bnb) },
  ]),
  ...(
    [
      ["NVDAx", "NVIDIA", "0xc845b2894dbddd03858fd2d643b4ef725fe0849d"],
      ["TSLAx", "Tesla", "0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0"],
      ["AAPLx", "Apple", "0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a"],
      ["MSFTx", "Microsoft", "0x5621737f42dae558b81269fcb9e9e70c19aa6b35"],
      ["AMZNx", "Amazon.com", "0x3557ba345b01efa20a1bddc61f573bfd87195081"],
      ["GOOGLx", "Alphabet", "0xe92f673ca36c5e2efd2de7628f815f84807e803f"],
      ["METAx", "Meta", "0x96702be57cd9777f835117a809c7124fe4ec989a"],
      ["SPYx", "SP500", "0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48"],
      ["QQQx", "Nasdaq", "0xa753a7395cae905cd615da0b82a53e0560f250af"],
      ["COINx", "Coinbase", "0x364f210f430ec2448fc68a49203040f6124096f0"],
    ] as const
  ).flatMap(([symbol, underlying, address]): Known[] => (["Ethereum", "BNB Chain"] as const).map((chain) => ({ issuer: "xstocks", chain, symbol, underlying, address: getAddress(address) }))),
];

/** the best-known tokenised shares an issuer stands behind (KNOWN), for the keyless RWA listings (public-rwa.ts): read-only */
export type IssuedToken = Readonly<Known>;
export const knownIssued = (): readonly IssuedToken[] => KNOWN;
/** each issuer's name and its own words on whom its tokens are not for, as the keyless listings carry them */
export const ISSUER_TERMS: Readonly<Record<"ondo" | "xstocks", { kind: string; issuer: string; terms: string }>> = { ondo: { kind: ISSUERS.ondo.kind, issuer: ISSUERS.ondo.issuer, terms: ISSUERS.ondo.terms }, xstocks: { kind: ISSUERS.xstocks.kind, issuer: ISSUERS.xstocks.issuer, terms: ISSUERS.xstocks.terms } };

const chainId = (c: ChainName): number => CHAINS[c].chain.id;
/** a chain's id, as LI.FI and the wallet name it (Ethereum 1, BNB Chain 56) */
export const chainIdOf = (c: ChainName): number => chainId(c);
