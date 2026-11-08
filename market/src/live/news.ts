/** THE MARKET'S HEADLINES: a US share's recent headlines, keyless, from Nasdaq's per-symbol RSS (www.nasdaq.com/feed/rssoutbound?symbol=),
 * each with its time, its outlet, its title and its nasdaq.com article URL — what the face hands the desk when a move alert asks why the
 * share moved (spec 2026-11-07-why-it-moved-design.md §5.5). Not Yahoo's (404 and 429 without a key), not Google News' (its links are
 * wrappers). Read by GET /api/news (reads.ts); a refusal of the feed is its symbol's `unavailable` there, never the whole answer's.
 *
 * The feed is read as text, whole up to NEWS_MAX_BYTES — not through types.ts realHttp, which cuts an answer at 2,000 characters and reads
 * only JSON — over https from the fixed public hosts alone (public-markets.ts PUBLIC_HOSTS), with Nasdaq's browser user-agent, within
 * NEWS_TIMEOUT_MS, paced on the process's `nasdaq-www` line (history.ts HOST_LIMITS). A market wrap that names many tickers is not the
 * symbol's news unless the symbol leads its list. The parser is hand-written: a handful of tags, the five XML entities and CDATA. */
import type { Refusal } from "../core/errors.ts";
import { unaddressed } from "../refuse.ts";
import { hostLane } from "./history.ts";
import { fixedHosts, PUBLIC_HOSTS, publicNo, type PublicDeps } from "./public-markets.ts";
import { retryAfterMs, unreachable, type Http, type HttpReply } from "./types.ts";
import { NASDAQ_UA } from "./us-quotes.ts";

/** one headline: `time` ISO 8601 UTC, as the feed's pubDate gave it */
export interface Headline {
  time: string;
  outlet: string;
  title: string;
  url: string;
}
export interface NewsSource {
  /** the symbol's headlines, newest first, or the feed's refusal */
  headlines(symbol: string): Promise<Headline[] | Refusal>;
}

export const NEWS_URL = "https://www.nasdaq.com/feed/rssoutbound?symbol=";
/** the most of a feed read (a recorded feed is about 15 KB) */
export const NEWS_MAX_BYTES = 524_288;
export const NEWS_TIMEOUT_MS = 6_000;
/** how long a symbol's headlines are kept (reads.ts) */
export const NEWS_KEEP_MS = 60_000;
/** an item naming more distinct tickers than this is a market wrap: the symbol's own only when it leads the list */
export const WRAP_TICKERS = 5;
export const NEWS_ID = "nasdaq-news";
export const NEWS_NAME = "Nasdaq's news feed";

/** a feed, as text: one GET, no redirect followed (a redirect answers with its host, as types.ts realHttp does), the body read up to
 * NEWS_MAX_BYTES and the rest not taken, the timeout covering the body too */
export const newsHttp: Http = async (url, init = {}) => {
  const r = await fetch(url, { method: "GET", ...(init.headers ? { headers: init.headers } : {}), signal: AbortSignal.timeout(init.timeoutMs ?? NEWS_TIMEOUT_MS), redirect: "manual" });
  const wait = retryAfterMs(r.headers.get("retry-after"));
  if (r.status >= 300 && r.status < 400) {
    await r.body?.cancel().catch(() => undefined);
    let host: string | undefined;
    try {
      host = unaddressed(new URL(r.headers.get("location") ?? "", url).host);
    } catch {
      host = undefined;
    }
    return { status: r.status, body: undefined, text: "", ...(host ? { location: host } : {}), ...(wait ? { retryAfterMs: wait } : {}) };
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = r.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      if (size >= NEWS_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  }
  const all = new Uint8Array(Math.min(size, NEWS_MAX_BYTES));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.min(c.byteLength, all.byteLength - at));
    all.set(part, at);
    at += part.byteLength;
    if (at >= all.byteLength) break;
  }
  return { status: r.status, body: undefined, text: new TextDecoder().decode(all), ...(wait ? { retryAfterMs: wait } : {}) };
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
/** an element's text: CDATA taken as it is, the rest with the five entities (and numeric references) decoded; whitespace folded */
function textOf(raw: string): string {
  const parts = raw.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/);
  const out = parts
    .map((p) =>
      p.startsWith("<![CDATA[")
        ? p.slice(9, -3)
        : p.replace(/&(amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-f]{1,6});/gi, (m, e: string) => {
            const k = e.toLowerCase();
            if (k.startsWith("#x")) return safeChar(parseInt(k.slice(2), 16), m);
            if (k.startsWith("#")) return safeChar(parseInt(k.slice(1), 10), m);
            return ENTITIES[k] ?? m;
          }),
    )
    .join("");
  return out.replace(/\s+/g, " ").trim();
}
const safeChar = (n: number, m: string): string => (Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m);

/** the first `<tag …>…</tag>` in an item, as text; nothing when it is not there */
function field(item: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(item);
  if (!m) return undefined;
  const t = textOf(m[1]!);
  return t === "" ? undefined : t;
}

/** an absolute http(s) URL, or nothing */
function urlOf(v: string | undefined): string | undefined {
  if (!v) return undefined;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Nasdaq's RSS for `symbol`, as headlines newest first: each <item> with its <pubDate> (RFC 822, to ISO UTC), <dc:creator> (the outlet),
 * <title> and <link>; an item missing any of the four, or with a date or link that does not read, is skipped. An item whose
 * <nasdaq:tickers> names more than WRAP_TICKERS distinct tickers is a market wrap, kept only when `symbol` leads the list. One URL once */
export function parseNasdaqRss(xml: string, symbol: string): Headline[] {
  const sym = symbol.trim().toUpperCase();
  const out: Array<Headline & { ms: number }> = [];
  const seen = new Set<string>();
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const body = m[1]!;
    const title = field(body, "title");
    const url = urlOf(field(body, "link"));
    const outlet = field(body, "dc:creator");
    const date = field(body, "pubDate");
    const ms = date ? Date.parse(date) : NaN;
    if (!title || !url || !outlet || !Number.isFinite(ms)) continue;
    const tickers = (field(body, "nasdaq:tickers") ?? "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
    if (new Set(tickers).size > WRAP_TICKERS && tickers[0] !== sym) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ time: new Date(ms).toISOString(), outlet, title, url, ms });
  }
  return out.sort((a, b) => b.ms - a.ms).map(({ ms: _ms, ...h }) => h);
}

/** a body that is an RSS feed (not a page, not JSON) */
const isRss = (text: string): boolean => /<rss[\s>]/i.test(text.slice(0, 4_000)) && /<channel[\s>]/i.test(text);

/** NASDAQ'S HEADLINES, over `deps.http` (the network: newsHttp) through the fixed-host guard, paced on the `nasdaq-www` line. A non-200,
 * a redirect or a body that is not RSS is the feed's refusal, in publicNo's words; a request that throws, unreachable's */
export function nasdaqNews(deps: PublicDeps = {}): NewsSource {
  const http = fixedHosts(deps.http ?? newsHttp, PUBLIC_HOSTS, Math.min(deps.timeoutMs ?? NEWS_TIMEOUT_MS, NEWS_TIMEOUT_MS));
  const pace = deps.pace ?? hostLane;
  return {
    async headlines(symbol) {
      let r: HttpReply;
      try {
        await pace("nasdaq-www");
        r = await http(`${NEWS_URL}${encodeURIComponent(symbol)}`, { headers: { accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8", "user-agent": NASDAQ_UA } });
      } catch (err) {
        return unreachable(NEWS_ID, NEWS_NAME, err);
      }
      if (r.status === 200 && isRss(r.text)) return parseNasdaqRss(r.text, symbol);
      return publicNo(NEWS_ID, NEWS_NAME, r);
    },
  };
}
