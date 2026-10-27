import { describe, expect, it } from "vitest";
import { ELBSTREAM_LOGOS, holdingIcon, iconOf, positionIcon, venueImage } from "../../src/portfolio/live/icons.ts";
import { STOCK_TOKEN_ISSUER } from "../../src/portfolio/live/robinhood.ts";

/** A market's icon (live/icons.ts): the address of the logo a page shows beside its name, from where its owner publishes it — Elbstream's
 * logos for coins and tickers, a company's own website icon, a venue's own picture for an event. Nothing is fetched here: these are words. */

describe("a market's icon", () => {
  it("a coin and a coin's perpetual: Elbstream's logo for the coin; a share or a fund: Elbstream's for the ticker", () => {
    expect(iconOf({ key: "coin:BTC", kind: "coin", base: "BTC" })).toBe(`${ELBSTREAM_LOGOS}/crypto/BTC`);
    expect(iconOf({ key: "perp:WLD", kind: "perp", base: "wld" })).toBe(`${ELBSTREAM_LOGOS}/crypto/WLD`);
    expect(iconOf({ key: "coin:1INCH", kind: "coin", base: "1INCH" })).toBe(`${ELBSTREAM_LOGOS}/crypto/1INCH`);
    expect(iconOf({ key: "stock:AAPL", kind: "stock", base: "AAPL" })).toBe(`${ELBSTREAM_LOGOS}/symbol/AAPL`);
    expect(iconOf({ key: "stock:SPY", kind: "stock", base: "SPY" })).toBe(`${ELBSTREAM_LOGOS}/symbol/SPY`);
    expect(iconOf({ key: "stock:BRK.B", kind: "stock", base: "BRK.B" })).toBe(`${ELBSTREAM_LOGOS}/symbol/BRK.B`);
  });

  it("a tokenised share is its share's, by its issuer; a fund's token its own coin's; any other token none", () => {
    // Ondo's tokens are the ticker and "on", xStocks' the ticker and "x", Robinhood's the ticker (explore.ts upper-cases a row's base)
    expect(iconOf({ key: "rwa:NVDAON", kind: "rwa", base: "NVDAON", issuer: "Ondo Global Markets" })).toBe(`${ELBSTREAM_LOGOS}/symbol/NVDA`);
    expect(iconOf({ key: "rwa:TSLAX", kind: "rwa", base: "TSLAX", issuer: "Backed (xStocks)" })).toBe(`${ELBSTREAM_LOGOS}/symbol/TSLA`);
    expect(iconOf({ key: "rwa:AAPL", kind: "rwa", base: "AAPL", issuer: STOCK_TOKEN_ISSUER })).toBe(`${ELBSTREAM_LOGOS}/symbol/AAPL`);
    // a fund's token (Ondo Finance's, BlackRock's) is not a share: its own coin logo
    expect(iconOf({ key: "rwa:OUSG", kind: "rwa", base: "OUSG", issuer: "Ondo Finance" })).toBe(`${ELBSTREAM_LOGOS}/crypto/OUSG`);
    expect(iconOf({ key: "rwa:BUIDL", kind: "rwa", base: "BUIDL", issuer: "BlackRock, through Securitize" })).toBe(`${ELBSTREAM_LOGOS}/crypto/BUIDL`);
    // a token whose issuer says nothing of shares or funds has none: Elbstream's crypto TSLA is FTX's tokenised Tesla, not Tesla
    expect(iconOf({ key: "rwa:TSLA", kind: "rwa", base: "TSLA" })).toBeUndefined();
    expect(iconOf({ key: "rwa:USDY", kind: "rwa", base: "USDY", issuer: "Stand-in Issuer (not a real issuer)" })).toBeUndefined();
  });

  it("a pre-IPO company: its own website's icon; a company the account does not know has none", () => {
    expect(iconOf({ key: "preipo:anthropic", kind: "perp", base: "ANTHROPIC", group: { id: "preipo:anthropic" } })).toBe("https://www.google.com/s2/favicons?domain=anthropic.com&sz=128");
    expect(iconOf({ key: "preipo:moonshot", kind: "perp", base: "MOONSHOT", group: { id: "preipo:moonshot" } })).toBe("https://www.google.com/s2/favicons?domain=kimi.com&sz=128");
    // a venue's own pre-IPO label for a company not in the table: not the coin of the same letters
    expect(iconOf({ key: "preipo:stripe", kind: "perp", base: "STRIPE", group: { id: "preipo:stripe" } })).toBeUndefined();
  });

  it("an event: the venue's own picture, from its own host over https; else Kalshi's for the series its ticker starts with; else none", () => {
    const pm = "https://polymarket-upload.s3.us-east-2.amazonaws.com/democrats+2028+donkey.png";
    expect(iconOf({ key: `pm:0x${"ab".repeat(32)}`, kind: "event" }, pm)).toBe(pm);
    expect(iconOf({ key: "kalshi:KXFEDDECISION-26OCT-H0", kind: "event" })).toBe("https://assets.kalshi.com/series-images-webp/KXFEDDECISION.webp");
    expect(iconOf({ key: "kalshi:KXIPOANTHROPIC-DATE-26DEC01", kind: "event" })).toBe("https://assets.kalshi.com/series-images-webp/KXIPOANTHROPIC.webp");
    // a picture from anywhere else, or not over https, is not shown: Kalshi's own still is, for a Kalshi market
    expect(iconOf({ key: "pm:0xcd", kind: "event" }, "https://tracker.example/pixel.png")).toBeUndefined();
    expect(iconOf({ key: "pm:0xcd", kind: "event" }, "http://polymarket-upload.s3.us-east-2.amazonaws.com/x.png")).toBeUndefined();
    expect(iconOf({ key: "kalshi:KXCPI-26SEP-T0.6", kind: "event" }, "https://tracker.example/pixel.png")).toBe("https://assets.kalshi.com/series-images-webp/KXCPI.webp");
    expect(iconOf({ key: "event:standin:SI-FEDCUT-DEC", kind: "event" })).toBeUndefined();
    expect(venueImage("not a url")).toBeUndefined();
  });

  it("a holding (Trade's You hold): by what its venue says it is — a coin, a share, a token by the issuer its line names, a fund's token, a Kalshi contract", () => {
    expect(holdingIcon({ asset: "BTC", class: "crypto" })).toBe(`${ELBSTREAM_LOGOS}/crypto/BTC`);
    expect(holdingIcon({ asset: "usdc", class: "stable" })).toBe(`${ELBSTREAM_LOGOS}/crypto/USDC`);
    expect(holdingIcon({ asset: "AAPL", class: "equity" })).toBe(`${ELBSTREAM_LOGOS}/symbol/AAPL`);
    // a wallet's token line says its kind (dex.ts, robinhood.ts); a paper account's the listing it was bought from (paper.ts)
    expect(holdingIcon({ asset: "NVDAon", class: "rwa", note: "Ethereum · Ondo Stock" })).toBe(`${ELBSTREAM_LOGOS}/symbol/NVDA`);
    expect(holdingIcon({ asset: "TSLAx", class: "rwa", note: "BNB Chain · xStock" })).toBe(`${ELBSTREAM_LOGOS}/symbol/TSLA`);
    expect(holdingIcon({ asset: "AMD", class: "rwa", note: "Robinhood Chain · Stock Token" })).toBe(`${ELBSTREAM_LOGOS}/symbol/AMD`);
    expect(holdingIcon({ asset: "AAPLX", class: "rwa", note: "paper · AAPLX/USDT from xStocks at Gate" })).toBe(`${ELBSTREAM_LOGOS}/symbol/AAPL`);
    expect(holdingIcon({ asset: "NVDAon", class: "rwa", note: "paper · NVDAon/USDC@Ethereum from Ondo Global Markets" })).toBe(`${ELBSTREAM_LOGOS}/symbol/NVDA`);
    expect(holdingIcon({ asset: "NVDA", class: "rwa", note: "paper · NVDA from Robinhood Stock Tokens" })).toBe(`${ELBSTREAM_LOGOS}/symbol/NVDA`);
    // a fund's token (address.ts reads OUSG, rOUSG, USDY; BUIDL) is a fund: its own coin logo
    expect(holdingIcon({ asset: "OUSG", class: "rwa", note: "Ethereum" })).toBe(`${ELBSTREAM_LOGOS}/crypto/OUSG`);
    expect(holdingIcon({ asset: "rOUSG", class: "rwa", note: "Ethereum" })).toBe(`${ELBSTREAM_LOGOS}/crypto/ROUSG`);
    // a token whose line names no issuer has none: a coin of the same letters is not it (Elbstream's crypto TSLA is FTX's)
    expect(holdingIcon({ asset: "TSLA", class: "rwa", note: "Ethereum" })).toBeUndefined();
    // a Kalshi contract: its series' picture, from the host Kalshi's own API names; another venue's event has none here (trade.js takes it
    // from a market row that lists it)
    expect(holdingIcon({ asset: "KXFEDDECISION-26OCT-H0:YES", class: "event" }, "live:kalshi")).toBe("https://assets.kalshi.com/series-images-webp/KXFEDDECISION.webp");
    expect(holdingIcon({ asset: "KXFEDDECISION-26OCT-H0:NO", class: "event" }, "live:paper")).toBe("https://assets.kalshi.com/series-images-webp/KXFEDDECISION.webp");
    // the same shape at another venue is that venue's own ticker, not Kalshi's
    expect(holdingIcon({ asset: "SI-FEDCUT-DEC:YES", class: "event" }, "live:standin-predict")).toBeUndefined();
    expect(holdingIcon({ asset: "KXFEDDECISION-26OCT-H0:YES", class: "event" })).toBeUndefined();
    expect(holdingIcon({ asset: "fed-decision-in-october:Yes", class: "event" }, "live:paper")).toBeUndefined();
    expect(holdingIcon({ asset: "aec-nfl-lac-ten-2025-11-02:YES", class: "event" }, "live:paper")).toBeUndefined();
    // cash, and anything that does not read as a symbol, has none
    expect(holdingIcon({ asset: "USD", class: "cash" })).toBeUndefined();
    expect(holdingIcon({ asset: "BTC/../x", class: "crypto" })).toBeUndefined();
    expect(holdingIcon({ asset: "AAPL?x=1", class: "equity" })).toBeUndefined();
  });

  it("an open position (Trade's You hold under Perps and Pre-IPO): a pre-IPO company's own icon, else the coin's; a HIP-3 market only a company's", () => {
    expect(positionIcon({ symbol: "BTC-PERP", kind: "perp" })).toBe(`${ELBSTREAM_LOGOS}/crypto/BTC`);
    expect(positionIcon({ symbol: "ETH/USDT:USDT", kind: "perp" })).toBe(`${ELBSTREAM_LOGOS}/crypto/ETH`);
    expect(positionIcon({ symbol: "SOL-USDT-SWAP", kind: "perp" })).toBe(`${ELBSTREAM_LOGOS}/crypto/SOL`);
    expect(positionIcon({ symbol: "BTC-26DEC26", kind: "future" })).toBe(`${ELBSTREAM_LOGOS}/crypto/BTC`);
    expect(positionIcon({ symbol: "io:ANTH-PERP", kind: "perp" })).toBe("https://www.google.com/s2/favicons?domain=anthropic.com&sz=128");
    expect(positionIcon({ symbol: "OPENAI-USDT-SWAP", kind: "perp" })).toBe("https://www.google.com/s2/favicons?domain=openai.com&sz=128");
    // a HIP-3 market's letters may be a share's, an index's or a metal's: never a coin's logo
    expect(positionIcon({ symbol: "xyz:GOLD", kind: "perp" })).toBeUndefined();
    expect(positionIcon({ symbol: "xyz:NVDA", kind: "perp" })).toBeUndefined();
    // a spot holding is not a position here; nothing that does not read as a symbol goes into an address
    expect(positionIcon({ symbol: "BTC/USD", kind: "spot" })).toBeUndefined();
    expect(positionIcon({ symbol: "../x-PERP", kind: "perp" })).toBeUndefined();
  });

  it("puts nothing into an address that does not read as a symbol", () => {
    expect(iconOf({ key: "coin:X", kind: "coin", base: "BTC/../../x" })).toBeUndefined();
    expect(iconOf({ key: "stock:X", kind: "stock", base: "AAPL?x=1" })).toBeUndefined();
    expect(iconOf({ key: "coin:X", kind: "coin", base: "" })).toBeUndefined();
    expect(iconOf({ key: "kalshi:../x", kind: "event" })).toBeUndefined();
  });
});
