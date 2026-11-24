/** THE US SYMBOL DIRECTORY: Nasdaq Trader's two files parsed by header name, kept twelve hours, a refusal asked again after ten minutes,
 * and the full text asked for with no user agent of ours. The fixtures are cut from the real files (test/fixtures/us-stocks/). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRefusal } from "../../src/core/errors.ts";
import { DIRECTORY_MS, DIRECTORY_RETRY_MS, displayName, NASDAQ_TRADER, parseDirectory, usDirectory } from "../../src/live/us-directory.ts";
import { fixedHosts, PUBLIC_HOSTS } from "../../src/live/public-markets.ts";
import type { Http, HttpReply } from "../../src/live/types.ts";

const fixture = (f: string) => readFileSync(new URL(`../fixtures/us-stocks/${f}`, import.meta.url), "latin1");
const NASDAQ_LISTED = fixture("nasdaqlisted.txt");
const OTHER_LISTED = fixture("otherlisted.txt");
const HOUR = 3_600_000;
const MIN = 60_000;

/** a stand-in network: the two files, and every request it was asked */
function standIn(status = 200) {
  const asked: Array<{ url: string; init: Parameters<Http>[1] }> = [];
  const http: Http = async (url, init) => {
    asked.push({ url, init });
    const text = status === 200 ? (url.endsWith("nasdaqlisted.txt") ? NASDAQ_LISTED : OTHER_LISTED) : "Service Unavailable";
    return { status, body: undefined, text } satisfies HttpReply;
  };
  return { http, asked };
}
const pace = async () => undefined;

describe("parseDirectory", () => {
  it("parses both files: CRLF, the creation-time line, test issues and $ preferreds left out, dotted classes kept", () => {
    expect(NASDAQ_LISTED).toContain("\r\n");
    const by = new Map(parseDirectory(NASDAQ_LISTED, OTHER_LISTED).map((e) => [e.symbol, e]));
    expect(by.has("ZZZTX")).toBe(false);
    expect(by.has("ABR$D")).toBe(false);
    expect(by.get("BRK.B")?.exchange).toBe("N");
    expect(by.get("BF.B")?.exchange).toBe("N");
    expect(by.get("AAPL")).toMatchObject({ exchange: "Q", etf: false, name: "Apple Inc." });
    expect(by.get("SPY")).toMatchObject({ etf: true, exchange: "P" });
    expect(by.get("QQQ")).toMatchObject({ etf: true, exchange: "Q" });
    // the closing line is not a row
    expect([...by.keys()].some((s) => s.startsWith("File"))).toBe(false);
  });

  it("keeps the first row of a symbol, and adds nothing from a file with no header", () => {
    const head = "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares\r\n";
    const both = parseDirectory(`${head}XX|First Inc. Common Stock|Q|N|N|100|N|N\r\n`, "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol\r\nXX|Second Inc.|N|XX|N|100|N|XX\r\n");
    expect(both).toEqual([{ symbol: "XX", name: "First Inc.", etf: false, exchange: "Q" }]);
    expect(parseDirectory("<html>blocked</html>", OTHER_LISTED).every((e) => e.exchange !== "Q")).toBe(true);
  });
});

describe("displayName", () => {
  it("trims the share-class boilerplate and keeps the class", () => {
    expect(displayName("Apple Inc. - Common Stock")).toBe("Apple Inc.");
    expect(displayName("Alcoa Corporation Common Stock ")).toBe("Alcoa Corporation");
    expect(displayName("State Street SPDR S&P 500 ETF Trust")).toBe("State Street SPDR S&P 500 ETF Trust");
    expect(displayName("Alphabet Inc. - Class A Common Stock")).toBe("Alphabet Inc. Class A");
  });
});

describe("usDirectory", () => {
  it("reads both files once, keeps them 12 h, asks again after", async () => {
    let now = 1_800_000_000_000;
    const { http, asked } = standIn();
    const dir = usDirectory({ http, pace, clock: () => now });
    expect(dir.now()).toBeUndefined();
    const first = await dir.entries();
    expect(isRefusal(first)).toBe(false);
    expect(asked.map((a) => a.url)).toEqual([`${NASDAQ_TRADER}/nasdaqlisted.txt`, `${NASDAQ_TRADER}/otherlisted.txt`]);
    expect(dir.now()?.get("AAPL")?.name).toBe("Apple Inc.");
    now += 11 * HOUR;
    await dir.entries();
    expect(asked).toHaveLength(2);
    now += HOUR + 1;
    expect(DIRECTORY_MS).toBe(12 * HOUR);
    await dir.entries();
    expect(asked).toHaveLength(4);
  });

  it("a refused file is the answer and is asked again no sooner than ten minutes", async () => {
    let now = 1_800_000_000_000;
    const { http, asked } = standIn(503);
    const dir = usDirectory({ http, pace, clock: () => now });
    const r = await dir.entries();
    expect(isRefusal(r)).toBe(true);
    const n = asked.length;
    expect(n).toBeGreaterThan(0);
    now += 9 * MIN;
    expect(isRefusal(await dir.entries())).toBe(true);
    expect(asked).toHaveLength(n);
    now += MIN;
    await dir.entries();
    expect(DIRECTORY_RETRY_MS).toBe(10 * MIN);
    expect(asked.length).toBeGreaterThan(n);
  });

  it("a pace that throws is a refusal, held ten minutes like any other, never a rejection kept twelve hours", async () => {
    let now = 1_800_000_000_000;
    let fail = true;
    const { http, asked } = standIn();
    const dir = usDirectory({ http, pace: async () => (fail ? Promise.reject(new Error("lane closed")) : undefined), clock: () => now });
    const r = await dir.entries();
    expect(isRefusal(r) ? r.code : r).toBe("E_VENUE_UNREACHABLE");
    expect(asked).toHaveLength(0);
    fail = false;
    now += DIRECTORY_RETRY_MS;
    expect(isRefusal(await dir.entries())).toBe(false);
  });

  it("a file without its header row is a refusal", async () => {
    const http: Http = async () => ({ status: 200, body: undefined, text: "just a page" });
    expect(isRefusal(await usDirectory({ http, pace, clock: () => 0 }).entries())).toBe(true);
  });

  it("asks with the full text and no user agent, each on the nasdaqtrader lane", async () => {
    const { http, asked } = standIn();
    const lanes: string[] = [];
    await usDirectory({ http, pace: async (host) => void lanes.push(host), clock: () => 0 }).entries();
    expect(lanes).toEqual(["nasdaqtrader", "nasdaqtrader"]);
    for (const a of asked) {
      expect(a.init?.maxText).toBeGreaterThanOrEqual(1_000_000);
      expect(Object.keys(a.init?.headers ?? {}).map((k) => k.toLowerCase())).not.toContain("user-agent");
    }
  });
});

describe("fixedHosts", () => {
  it("lets www.nasdaqtrader.com through and passes maxText", async () => {
    expect(PUBLIC_HOSTS).toContain("www.nasdaqtrader.com");
    const { http, asked } = standIn();
    const guarded = fixedHosts(http, PUBLIC_HOSTS, 5_000);
    await guarded(`${NASDAQ_TRADER}/nasdaqlisted.txt`, { maxText: 2_000_000 });
    expect(asked[0]?.init?.maxText).toBe(2_000_000);
    expect(Object.keys(asked[0]?.init?.headers ?? {})).not.toContain("user-agent");
  });
});
