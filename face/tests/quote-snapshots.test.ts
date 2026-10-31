import test from "node:test";
import assert from "node:assert/strict";
import { createQuoteSnapshots, QUOTE_RESPONSE_LIMIT, type QuoteFetch } from "../src/quote-snapshots.ts";
import type { QuoteIdentity } from "../src/quote-types.ts";
const cn: QuoteIdentity = { id: "cn:603986", market: "cn", symbol: "603986" };
const id = (symbol: string): QuoteIdentity => ({ id: `cn:${symbol}`, market: "cn", symbol });

/** One Tencent quote line, `v_<code>="…";`, its 88 fields joined by `~`: the indices the adapter reads
 * from `at`, every other field empty. */
function line(code: string, at: Record<number, string>): string {
  return `v_${code}="${Array.from({ length: 88 }, (_, i) => at[i] ?? "").join("~")}";\n`;
}
const quoted = (code: string, extra: Record<number, string> = {}) =>
  line(code, { 0: "1", 1: "NAME", 2: code.slice(2), 3: "165.50", 4: "160.00", 6: "0", 30: "20260915150003", 37: "0", ...extra });
const reply = (...lines: string[]) => new Response(lines.join(""));

test("the snapshots read Tencent alone: one request, exchange prefixes, no credential", async () => {
  const seen: { url: URL; options: RequestInit }[] = [];
  const result = await createQuoteSnapshots({ fetcher: async (url, options) => {
    seen.push({ url, options });
    return reply(quoted("sh603986"), quoted("sz300750"), quoted("bj920185"));
  } }).load([cn, id("300750"), id("920185"), cn]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.url.href, "https://qt.gtimg.cn/q=marketStat,sh000001,sh603986,sz300750,bj920185");
  assert.equal(seen[0]!.options.method ?? "GET", "GET");
  assert.equal(seen[0]!.options.body, undefined);
  assert.deepEqual([...new Headers(seen[0]!.options.headers).keys()], [], "no token, key or vendor header");
  assert.deepEqual(result.providers.map((provider) => [provider.id, provider.market, provider.source, provider.feed]), [["tencent", "cn", "腾讯", "snapshot"]]);
  assert.deepEqual(result.updates.map((update) => update.id), [cn.id, "cn:300750", "cn:920185"]);
});

test("a quote carries the last price, the previous close and the provider's Beijing time", async () => {
  const result = await createQuoteSnapshots({ fetcher: async () => reply(quoted("sh603986")) }).load([cn]);
  const update = result.updates[0]!;
  assert.equal(update.price, 165.5);
  assert.equal(update.prev_close, 160);
  assert.equal(Date.parse(update.as_of!), Date.parse("2026-09-15T07:00:03Z"));
  assert.equal(update.source, "腾讯");
  assert.equal(update.feed, "snapshot");
  assert.equal(update.basis, "previous_close");
  // no marketStat in the reply: the Beijing clock decides, never "unknown"
  assert.ok(["open", "midday", "closed"].includes(update.market_status!));
  assert.equal(update.message, "");
  assert.equal(result.providers[0]!.status, "connected");
});

test("volume is in shares: lots on most boards, shares on STAR, unknown when the turnover fits neither", async () => {
  // Measured 2026-10-30: field 6 is lots of 100 for 600519, 000001, 300750 and 920045, shares for 688981;
  // field 37 is the turnover in 10,000 CNY, which decides.
  const result = await createQuoteSnapshots({ fetcher: async () => reply(
    quoted("sh600519", { 3: "1392.05", 6: "59927", 37: "825738" }),
    quoted("sh688981", { 3: "98.60", 6: "29998989", 37: "295750" }),
    quoted("sz000001", { 3: "11.64", 6: "1864245", 37: "1" }),
    quoted("sz300750", { 3: "232.92", 6: "0", 37: "0" }),
    quoted("bj920045", { 3: "407.10", 6: "21775", 37: "" }),
  ) }).load([id("600519"), id("688981"), id("000001"), id("300750"), id("920045")]);
  const byId = Object.fromEntries(result.updates.map((update) => [update.id, update]));
  assert.equal(byId["cn:600519"]!.volume, 5_992_700);
  assert.equal(byId["cn:688981"]!.volume, 29_998_989);
  assert.equal(byId["cn:000001"]!.volume, null, "a turnover no unit fits leaves the volume unknown");
  assert.equal(byId["cn:300750"]!.volume, 0, "no trade yet is zero in any unit");
  assert.equal(byId["cn:920045"]!.volume, null, "no turnover, no unit");
  assert.equal(byId["cn:600519"]!.volume_as_of, byId["cn:600519"]!.as_of);
  assert.equal(byId["cn:000001"]!.volume_as_of, null);
});

test("an unknown code reads no quote and limits the provider", async () => {
  const result = await createQuoteSnapshots({ fetcher: async () => reply(quoted("sh603986"), 'v_pv_none_match="1";\n') })
    .load([cn, id("920999")]);
  assert.equal(result.updates[0]!.price, 165.5);
  assert.equal(result.updates[1]!.price, undefined);
  assert.match(result.updates[1]!.message!, /暂无/);
  assert.equal(result.providers[0]!.status, "limited");
});

test("a missing or malformed event time stays missing", async () => {
  // Date.parse rolls 02-31 over to 03-03 and 24:00 to the next midnight; the round trip refuses both.
  for (const time of ["", "20260915", "2026-09-15 15:00:03", "20261345150003", "20260231150003", "20260915240000"]) {
    const result = await createQuoteSnapshots({ fetcher: async () => reply(quoted("sh603986", { 30: time })) }).load([cn]);
    assert.equal(result.updates[0]!.as_of, null, time);
    assert.equal(result.updates[0]!.volume_as_of, null, time);
    assert.equal(result.providers[0]!.status, "limited", time);
  }
});

test("a reply line for another code, or one too short to read, is no quote for the asked code", async () => {
  const result = await createQuoteSnapshots({ fetcher: async () => reply(
    line("sh603986", { 2: "600000", 3: "165.50", 4: "160.00", 30: "20260915150003" }),
    'v_sz300750="1~NAME~300750~232.92";\n',
  ) }).load([cn, id("300750")]);
  assert.deepEqual(result.updates.map((update) => update.price), [undefined, undefined]);
  assert.equal(result.providers[0]!.status, "limited");
});

test("a code Tencent cannot quote is never requested", async () => {
  const urls: string[] = [];
  const fetcher: QuoteFetch = async (url) => { urls.push(url.href); return reply(quoted("sh603986")); };
  const none = await createQuoteSnapshots({ fetcher }).load([id("123456")]);
  assert.deepEqual(urls, []);
  assert.equal(none.providers[0]!.status, "limited");
  const mixed = await createQuoteSnapshots({ fetcher }).load([cn, id("123456")]);
  assert.deepEqual(urls, ["https://qt.gtimg.cn/q=marketStat,sh000001,sh603986"]);
  assert.match(mixed.updates[1]!.message!, /不支持/);
});

test("GBK names decode before the fields split, so a trail byte that reads as ~ moves no field", async () => {
  // 0x81 0x7E is one GBK character whose second byte is ASCII "~"; decoded as UTF-8 it would add a field.
  const before = Buffer.from('v_sh603986="1~');
  const after = Buffer.from(quoted("sh603986").slice('v_sh603986="1~NAME'.length));
  const result = await createQuoteSnapshots({ fetcher: async () => new Response(Buffer.concat([before, Buffer.from([0xc3, 0xa9, 0x81, 0x7e]), after])) })
    .load([cn]);
  assert.equal(result.updates[0]!.price, 165.5);
  assert.equal(Date.parse(result.updates[0]!.as_of!), Date.parse("2026-09-15T07:00:03Z"));
});

test("a failed request is an error that never echoes the vendor's reply", async () => {
  for (const response of [() => new Response("upstream says private-detail", { status: 502 }), () => new Response("<html>private-detail</html>"), () => new Response("")]) {
    const result = await createQuoteSnapshots({ fetcher: async () => response() }).load([cn]);
    assert.equal(result.providers[0]!.status, "error");
    assert.equal(result.updates[0]!.price, undefined);
    assert.equal(JSON.stringify(result).includes("private-detail"), false);
  }
  const limited = await createQuoteSnapshots({ fetcher: async () => new Response("private-detail", { status: 429 }) }).load([cn]);
  assert.equal(limited.providers[0]!.status, "error");
  assert.match(limited.providers[0]!.message, /频繁/);
  assert.equal(JSON.stringify(limited).includes("private-detail"), false);
});

test("timeouts cover ignored cancellation and stalled response bodies", async () => {
  const handlers: QuoteFetch[] = [async () => new Promise<Response>(() => {}), async () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode('v_sh603986="1~'));
  } }))];
  for (const fetcher of handlers) {
    const result = await createQuoteSnapshots({ timeoutMs: 15, fetcher }).load([cn]);
    assert.equal(result.providers[0]!.status, "error");
    assert.match(result.updates[0]!.message!, /超时/);
  }
});

test("oversized replies never become quotes", async () => {
  const responses = [() => new Response("x", { headers: { "Content-Length": String(QUOTE_RESPONSE_LIMIT + 1) } }),
    () => new Response(quoted("sh603986") + "x".repeat(QUOTE_RESPONSE_LIMIT))];
  for (const response of responses) {
    const result = await createQuoteSnapshots({ fetcher: async () => response() }).load([cn]);
    assert.equal(result.updates[0]!.price, undefined);
    assert.equal(result.providers[0]!.status, "error");
  }
});

test("an aborted load makes no request", async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const result = await createQuoteSnapshots({ fetcher: async () => { calls++; return reply(); } }).load([cn], controller.signal);
  assert.equal(calls, 0);
  assert.equal(result.providers[0]!.status, "error");
});

test("a quote carries the page's facts, in yuan and percent", async () => {
  const moutai = line("sh600519", { 1: "@NAME@", 2: "600519", 3: "1392.05", 4: "1354.00", 5: "1363.00", 6: "59927",
    30: "20261030161455", 33: "1393.37", 34: "1352.98", 37: "825738", 38: "0.48", 39: "21.18", 43: "2.98", 45: "17401.76",
    47: "1489.40", 48: "1218.60" });
  // the reply is GBK, as Tencent's is: 贵州茅台 is B9F3 D6DD C3A9 CCA8
  const [head, tail] = moutai.split("@NAME@");
  const gbk = Buffer.concat([Buffer.from(head!), Buffer.from([0xb9, 0xf3, 0xd6, 0xdd, 0xc3, 0xa9, 0xcc, 0xa8]), Buffer.from(tail!)]);
  const [u] = (await createQuoteSnapshots({ fetcher: async () => new Response(gbk) }).load([id("600519")])).updates;
  assert.deepEqual([u!.name, u!.open, u!.high, u!.low, u!.turnover, u!.turnover_rate, u!.market_cap, u!.pe_ttm, u!.limit_up, u!.limit_down, u!.amplitude],
    ["贵州茅台", 1363, 1393.37, 1352.98, 8_257_380_000, 0.48, 1_740_176_000_000, 21.18, 1489.4, 1218.6, 2.98]);
});

test("a negative P/E is kept", async () => {
  const [u] = (await createQuoteSnapshots({ fetcher: async () => reply(quoted("sh603986", { 39: "-12.50" })) }).load([cn])).updates;
  assert.equal(u!.pe_ttm, -12.5);
});

test("the market status comes from the same reply: closed, open, midday", async () => {
  const stat = (token: string) => `v_marketStat="2026-10-30 10:00:00|SH_${token}_x|SZ_${token}_x";\n`;
  const index = line("sh000001", { 2: "000001", 30: "20261030113000" });
  const at = (now: number, token: string) => createQuoteSnapshots({ now: () => now, fetcher: async () => reply(stat(token), index, quoted("sh603986")) }).load([cn]);
  assert.equal((await at(Date.parse("2026-10-31T02:00:00Z"), "close")).updates[0]!.market_status, "closed");
  assert.equal((await at(Date.parse("2026-10-30T02:00:00Z"), "open")).updates[0]!.market_status, "open");
  assert.equal((await at(Date.parse("2026-10-30T04:00:00Z"), "close")).updates[0]!.market_status, "midday");
});

test("a quote carries the session's last trading day from the same reply", async () => {
  const stat = 'v_marketStat="2026-10-31 10:00:00|SH_close_x|SZ_close_x";\n';
  const index = line("sh000001", { 2: "000001", 30: "20261030161400" });
  const [u] = (await createQuoteSnapshots({ now: () => Date.parse("2026-10-31T02:00:00Z"), fetcher: async () => reply(stat, index, quoted("sh603986")) }).load([cn])).updates;
  assert.equal(u!.last_session, "2026-10-30");
});
