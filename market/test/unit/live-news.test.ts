/** THE MARKET'S HEADLINE READ (live/news.ts): Nasdaq's per-symbol RSS, read without a key — parsed from the two feeds the probe recorded on
 * Saturday 2026-11-07 (INTC and CRWV, test/fixtures/news), and asked through a stand-in network that answers them, or refuses as Nasdaq
 * may (403, 429, a page that is not the feed). Nothing leaves the process. */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createMarketCore } from "../../src/core.ts";
import { isRefusal } from "../../src/core/errors.ts";
import { NEWS_MAX_BYTES, NEWS_URL, nasdaqNews, newsHttp, parseNasdaqRss, WRAP_TICKERS } from "../../src/live/news.ts";
import { PUBLIC_HOSTS } from "../../src/live/public-markets.ts";
import type { HttpReply } from "../../src/live/types.ts";
import { NASDAQ_UA } from "../../src/live/us-quotes.ts";
import { marketReads } from "../../src/reads.ts";
import { network } from "./live-public-markets-fixtures.ts";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/news/${name}`, import.meta.url), "utf8");
const INTC = fixture("nasdaq-rss-INTC.xml");
const CRWV = fixture("nasdaq-rss-CRWV.xml");
const rss = (text: string): HttpReply => ({ status: 200, body: undefined, text });
const noPace = async () => undefined;

/** one RSS item, its fields as given (a field left out is not written) */
function item(o: { title?: string | undefined; link?: string | undefined; date?: string | undefined; outlet?: string | undefined; tickers?: string | undefined }): string {
  return [
    "<item>",
    o.title !== undefined ? `<title>${o.title}</title>` : "",
    o.link !== undefined ? `<link>${o.link}</link>` : "",
    o.date !== undefined ? `<pubDate>${o.date}</pubDate>` : "",
    o.outlet !== undefined ? `<dc:creator>${o.outlet}</dc:creator>` : "",
    o.tickers !== undefined ? `<nasdaq:tickers>${o.tickers}</nasdaq:tickers>` : "",
    "</item>",
  ].join("\n");
}
const feed = (...items: string[]) => `<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>X Feed</title>${items.join("\n")}</channel></rss>`;
const base = { title: "A headline", link: "https://www.nasdaq.com/articles/a", date: "Fri, 06 Nov 2026 15:10:00 +0000", outlet: "Reuters" };

describe("Nasdaq's per-symbol RSS, parsed", () => {
  it("parseNasdaqRss reads the recorded INTC feed newest first, with exact times, outlets and nasdaq.com article URLs", () => {
    const got = parseNasdaqRss(INTC, "INTC");
    expect(got.length).toBeGreaterThan(5);
    // the feed's newest item (20:40:46, Barchart's market wrap naming 35 tickers, INTC not first) is a wrap and dropped: the newest kept is
    // the 16:51 one, its pubDate "Sat, 07 Nov 2026 16:51:00 +0000"
    expect(got[0]).toEqual({ time: "2026-11-07T16:51:00.000Z", outlet: "The Motley Fool", title: "AI Stocks Are Falling; Bitcoin Is Holding Ground. Here's What Could Come Next.", url: "https://www.nasdaq.com/articles/ai-stocks-are-falling-bitcoin-holding-ground-heres-what-could-come-next" });
    const times = got.map((h) => Date.parse(h.time));
    expect(times.every((t, i) => i === 0 || t <= times[i - 1]!)).toBe(true);
    for (const h of got) {
      expect(h.url.startsWith("https://www.nasdaq.com/")).toBe(true);
      expect(h.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
      expect(h.outlet.length).toBeGreaterThan(0);
      expect(h.title.length).toBeGreaterThan(0);
    }
    // CRWV's feed reads the same way
    const crwv = parseNasdaqRss(CRWV, "CRWV");
    expect(crwv.length).toBeGreaterThan(0);
    expect(crwv.every((h) => h.url.startsWith("https://www.nasdaq.com/"))).toBe(true);
  });

  it("a market wrap naming more than five tickers is dropped unless the symbol leads its ticker list", () => {
    expect(WRAP_TICKERS).toBe(5);
    const xml = feed(
      item({ ...base, title: "wrap", link: "https://www.nasdaq.com/articles/wrap", tickers: "SPY,QQQ,AAPL,MSFT,NVDA,INTC" }),
      item({ ...base, title: "leads", link: "https://www.nasdaq.com/articles/leads", tickers: "INTC,SPY,QQQ,AAPL,MSFT,NVDA" }),
      item({ ...base, title: "leads twice", link: "https://www.nasdaq.com/articles/leads-twice", tickers: "INTC,INTC,SPY,QQQ,AAPL,MSFT,NVDA" }),
      // five tickers, a repeat counted once: not a wrap
      item({ ...base, title: "five", link: "https://www.nasdaq.com/articles/five", tickers: "AMD,AMD,QCOM,INTC,NVDA,MU" }),
      item({ ...base, title: "no tickers", link: "https://www.nasdaq.com/articles/none" }),
    );
    expect(parseNasdaqRss(xml, "INTC").map((h) => h.title)).toEqual(["leads", "leads twice", "five", "no tickers"]);
    // the recorded wrap: Barchart's at 20:40:46 is not in INTC's answer, nor in CRWV's
    expect(parseNasdaqRss(INTC, "INTC").some((h) => h.title === "Stock Indexes Settle Mostly Higher as Chipmakers Rebound")).toBe(false);
  });

  it("an item missing its date, title, link or outlet is skipped; the five XML entities and CDATA are decoded", () => {
    const xml = feed(
      item({ ...base, title: "no date", date: undefined }),
      item({ ...base, title: "bad date", date: "sometime" }),
      item({ ...base, title: undefined }),
      item({ ...base, title: "no link", link: undefined }),
      item({ ...base, title: "not a URL", link: "/articles/relative" }),
      item({ ...base, title: "plain http", link: "http://www.nasdaq.com/articles/plain" }),
      item({ ...base, title: "off host", link: "https://www.marketbeat.com/instant-alerts/intc" }),
      item({ ...base, title: "no outlet", outlet: undefined }),
      item({ ...base, title: "AT&amp;T &lt;up&gt; on &quot;deal&quot; &apos;talks&apos;", link: "https://www.nasdaq.com/articles/att?a=1&amp;b=2", date: "Fri, 06 Nov 2026 16:00:00 +0000" }),
      item({ ...base, title: "<![CDATA[Q3 <beat> & raise]]>", outlet: "<![CDATA[Zacks & Co]]>", date: "Fri, 06 Nov 2026 17:00:00 +0000", link: "https://www.nasdaq.com/articles/cdata" }),
    );
    expect(parseNasdaqRss(xml, "T")).toEqual([
      { time: "2026-11-06T17:00:00.000Z", outlet: "Zacks & Co", title: "Q3 <beat> & raise", url: "https://www.nasdaq.com/articles/cdata" },
      { time: "2026-11-06T16:00:00.000Z", outlet: "Reuters", title: `AT&T <up> on "deal" 'talks'`, url: "https://www.nasdaq.com/articles/att?a=1&b=2" },
    ]);
  });
});

describe("the headline source, over the network", () => {
  it("asks Nasdaq's feed for the symbol with its user-agent, at a fixed host", async () => {
    expect(PUBLIC_HOSTS).toContain("www.nasdaq.com");
    const heads: Array<Record<string, string> | undefined> = [];
    const net = network([["rssoutbound?symbol=INTC", rss(INTC)]]);
    const http: typeof net.http = (url, init) => (heads.push(init?.headers), net.http(url, init));
    const got = await nasdaqNews({ http, pace: noPace }).headlines("INTC");
    expect(isRefusal(got)).toBe(false);
    expect(net.sent.map((s) => s.url)).toEqual([`${NEWS_URL}INTC`]);
    expect(heads[0]?.["user-agent"]).toBe(NASDAQ_UA);
  });

  it("a feed answering 403, 429 or an HTML page puts its symbol under unavailable with the reason, and the others answer", async () => {
    const page = '<!DOCTYPE html><html><head><title>Just a moment</title></head><body>checking</body></html>';
    const net = network([
      ["symbol=INTC", rss(INTC)],
      ["symbol=CRWV", rss(CRWV)],
      ["symbol=AAA", { status: 403, body: undefined, text: "Forbidden" }],
      ["symbol=BBB", { status: 429, body: undefined, text: "Too Many Requests", retryAfterMs: 30_000 }],
      ["symbol=CCC", { status: 200, body: undefined, text: page }],
    ]);
    const core = createMarketCore({ news: nasdaqNews({ http: net.http, pace: noPace }) });
    const got = await marketReads(core).news(["INTC", "AAA", "BBB", "CCC", "CRWV"]);
    if (isRefusal(got)) throw new Error(got.message);
    expect(Object.keys(got.news).sort()).toEqual(["CRWV", "INTC"]);
    expect(got.news.INTC!.length).toBeGreaterThan(0);
    expect(got.news.CRWV!.length).toBeGreaterThan(0);
    expect(Object.keys(got.unavailable ?? {}).sort()).toEqual(["AAA", "BBB", "CCC"]);
    expect(got.unavailable!.AAA).toMatch(/HTTP 403/);
    expect(got.unavailable!.BBB).toMatch(/rate|too many|wait/i);
    expect(got.unavailable!.CCC).toMatch(/page/);
    // a thrown network error is a reason too
    const dead = createMarketCore({ news: nasdaqNews({ http: async () => { throw Object.assign(new Error("getaddrinfo ENOTFOUND www.nasdaq.com"), { code: "ENOTFOUND" }); }, pace: noPace }) });
    const none = await marketReads(dead).news(["INTC"]);
    if (isRefusal(none)) throw new Error(none.message);
    expect(none.news).toEqual({});
    expect(none.unavailable!.INTC).toMatch(/could not be reached/);
  });

  it("keeps a symbol's headlines for a minute: a second ask within it sends nothing", async () => {
    const net = network([["symbol=INTC", rss(INTC)]]);
    const core = createMarketCore({ news: nasdaqNews({ http: net.http, pace: noPace }) });
    const reads = marketReads(core);
    await reads.news(["INTC"]);
    await reads.news(["INTC"], "2026-11-07T00:00:00Z");
    expect(net.sent.length).toBe(1);
  });
});

describe("the feed's own text read (newsHttp), against a loopback server", () => {
  it("reads the whole feed past 2,000 characters, stops at NEWS_MAX_BYTES, and answers a redirect with its host, not followed", async () => {
    const big = "x".repeat(NEWS_MAX_BYTES + 10_000);
    const srv = createServer((req, res) => {
      if (req.url === "/feed") return void res.end(INTC);
      if (req.url === "/big") return void res.end(big);
      res.writeHead(302, { location: "https://elsewhere.example/path?who=me" }).end();
    });
    await new Promise<void>((go) => srv.listen(0, "127.0.0.1", go));
    const at = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const whole = await newsHttp(`${at}/feed`);
      expect(whole.status).toBe(200);
      expect(whole.text).toBe(INTC);
      expect(parseNasdaqRss(whole.text, "INTC").length).toBeGreaterThan(5);
      expect((await newsHttp(`${at}/big`)).text.length).toBe(NEWS_MAX_BYTES);
      const moved = await newsHttp(`${at}/moved`);
      expect([moved.status, moved.location, moved.text]).toEqual([302, "elsewhere.example", ""]);
    } finally {
      await new Promise((go) => srv.close(go));
    }
  });
});
