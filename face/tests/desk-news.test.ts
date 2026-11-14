// face/tests/desk-news.test.ts
import test, { after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALERTS_FILE, EVENTS_FILE, deskDir } from "../src/desk.ts";
import { buildNews, deskNews, registerDeskNewsRoute } from "../src/desk-news.ts";
import type { MarketWatchStatus, WatchStatus } from "../src/watch.ts";
import { recorder } from "./route-recorder.ts";

/** Every harness home made with {@link home}, removed once the file's tests are done. */
const homes: string[] = [];
afterAll(() => Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));
const home = async (): Promise<string> => {
  const made = await mkdtemp(join(tmpdir(), "face-desk-news-"));
  homes.push(made);
  return made;
};

/** Write `lines` as a desk JSONL file, each a JSON line, or a raw string as it is. */
async function ledger(h: string, file: string, lines: (object | string)[]): Promise<void> {
  await mkdir(deskDir(h), { recursive: true });
  await writeFile(join(deskDir(h), file), lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l) + "\n")).join(""));
}

/** 15:00 New York on Friday 2026-11-13. */
const FRIDAY = Date.parse("2026-11-13T20:00:00.000Z");

let seq = 0;
/** One `alert` line: a US move on `symbol` at `t`, sent. */
const alert = (symbol: string, t: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({
  t, kind: "alert", id: `a${++seq}`, pass: `p${seq}`, date: t.slice(0, 10), key: `${symbol}:move`, market: "us", symbol, label: `watch-${symbol.toLowerCase()}`,
  trigger: { type: "move", rule: `watch-${symbol.toLowerCase()}`, pct: 5 }, gap: false,
  quote: { market: "us", price: 10, asOf: t, feed: "f", status: "ok", prevClose: 11, chgPct: -8.1, receivedAt: t },
  holding: null, plan: null, source: { file: "desk/rules.yml", index: 0 }, decision: "send", annotate: true, ...more,
});
const delivered = (id: string, delivery: object): Record<string, unknown> =>
  ({ t: "2026-11-13T19:00:00.000Z", kind: "delivered", id, delivery, latency: { tradeMs: null, receivedMs: null } });

const quiet = (): MarketWatchStatus["today"] => ({ sent: 0, suppressed: { cooldown: 0, cap: 0, muted: 0, off: 0, window: 0 }, repeats: 0 });
const watchStatus = (over: Partial<WatchStatus> = {}): WatchStatus => ({
  state: "watching",
  markets: { us: { state: "polling", watched: 3, notWatched: [], today: quiet() }, cn: { state: "off", watched: 0, notWatched: [], today: quiet() } },
  files: [], near: [], marks: [], pending: 0, recent: [],
  filings: { state: "polling", symbols: 3, aShares: 0, seeded: 3 },
  rules: [], levels: 2,
  ...over,
});

test("groups the day's alerts by symbol, latest first, with nth and earlier rows", () => {
  const records = [
    alert("CRWV", "2026-11-13T14:40:00.000Z"),
    alert("QQQ", "2026-11-13T15:00:00.000Z"),
    alert("CRWV", "2026-11-13T15:30:00.000Z"),
    alert("CRWV", "2026-11-13T16:10:00.000Z"),
    alert("QQQ", "2026-11-13T17:00:00.000Z"),
    alert("CRWV", "2026-11-13T18:20:00.000Z"),
  ];
  const news = buildNews({ records, fetches: [], now: FRIDAY });
  assert.equal(news.date, "2026-11-13");
  assert.equal(news.today, true);
  assert.equal(news.alerts.total, 6);
  assert.deepEqual(news.alerts.groups.map((g) => [g.symbol, g.count]), [["CRWV", 4], ["QQQ", 2]]);
  const crwv = news.alerts.groups[0]!;
  assert.equal(crwv.latest.nth, 4);
  assert.equal(crwv.latest.t, "2026-11-13T18:20:00.000Z");
  assert.equal(crwv.latest.kind, "move");
  assert.equal(crwv.latest.movePct, -8.1);
  assert.equal(crwv.latest.delivery, "pending");
  assert.deepEqual(crwv.earlier.map((a) => [a.nth, a.t]), [
    [3, "2026-11-13T16:10:00.000Z"], [2, "2026-11-13T15:30:00.000Z"], [1, "2026-11-13T14:40:00.000Z"],
  ]);
  assert.deepEqual(news.reports, { total: 0, groups: [] });
  assert.deepEqual(news.rules, [], "no watch, no rules");
  assert.equal(news.levels, 0);
  assert.deepEqual(news.sources.map((s) => [s.id, s.state]), [["quotes", "off"], ["headlines", "off"], ["filings", "off"]]);
});

test("a reason is joined by pass, its headline by symbol, its pages by session", () => {
  const text = "共同原因\nCRWV 盘中 -8.1% · 再融资\n媒体解读 · 公司没发公告\n…\n来源：a b";
  const records = [
    alert("CRWV", "2026-11-13T15:00:00.000Z", { pass: "pass-1" }),
    alert("INTC", "2026-11-13T15:00:01.000Z", { pass: "pass-1" }),
    alert("AMD", "2026-11-13T15:10:00.000Z", { pass: "pass-2" }),
    { t: "2026-11-13T15:00:02.000Z", kind: "annotation", pass: "pass-1", alerts: ["a", "b"], result: "opened", sessionId: "s-1" },
    { t: "2026-11-13T15:03:00.000Z", kind: "annotated", pass: "pass-1", sessionId: "s-1", outcome: "ended", sent: ["telegram:9"], text },
  ];
  const fetches = [{ sessionId: "s-1" }, { sessionId: "s-1" }, { sessionId: "s-other" }, { sessionId: "s-1" }];
  const news = buildNews({ records, fetches, now: FRIDAY });
  const of = (symbol: string) => news.alerts.groups.find((g) => g.symbol === symbol)!.latest;
  const crwv = of("CRWV").reason!;
  assert.ok(crwv.headline.startsWith("CRWV"));
  assert.equal(crwv.label, "媒体解读 · 公司没发公告");
  assert.equal(crwv.pages, 3);
  assert.equal(crwv.sessionId, "s-1");
  assert.equal(crwv.outcome, "ended");
  assert.equal(crwv.text, text);
  assert.equal(of("INTC").reason!.headline, "共同原因");
  assert.equal(of("INTC").reason!.pages, 3);
  assert.equal(of("AMD").reason, undefined, "a pass with no annotated line has no reason");
});

test("held-back and undelivered alerts are rows with their word", () => {
  const held = alert("AAA", "2026-11-13T15:00:00.000Z", { decision: "suppressed", suppressed: "cooldown" });
  const lost = alert("BBB", "2026-11-13T15:01:00.000Z");
  const none = alert("CCC", "2026-11-13T15:02:00.000Z");
  const sent = alert("DDD", "2026-11-13T15:03:00.000Z");
  const queued = alert("EEE", "2026-11-13T15:04:00.000Z");
  const records = [held, lost, none, sent, queued,
    delivered(lost.id as string, { undelivered: "account down" }),
    delivered(sent.id as string, { sent: ["telegram:1"] }),
    delivered(queued.id as string, { queued: true }),
    { t: "2026-11-13T15:05:00.000Z", kind: "batch", id: "b1", date: "2026-11-13", alerts: [held.id] },
  ];
  const news = buildNews({ records, fetches: [], now: FRIDAY });
  const row = (symbol: string) => news.alerts.groups.find((g) => g.symbol === symbol)!.latest;
  assert.equal(row("AAA").delivery, "held");
  assert.equal(row("AAA").held, "cooldown");
  assert.equal(row("BBB").delivery, "undelivered");
  assert.equal(row("BBB").held, undefined);
  assert.equal(row("CCC").delivery, "pending");
  assert.equal(row("DDD").delivery, "sent");
  assert.equal(row("EEE").delivery, "queued");
  assert.equal(news.alerts.total, 5);
});

test("with no alert today the last day stands in", () => {
  const records = [alert("CRWV", "2026-11-12T15:00:00.000Z"), alert("CRWV", "2026-11-13T15:00:00.000Z"), alert("QQQ", "2026-11-13T16:00:00.000Z")];
  const saturday = Date.parse("2026-11-14T16:00:00.000Z");
  const news = buildNews({ records, fetches: [], now: saturday });
  assert.equal(news.date, "2026-11-13");
  assert.equal(news.today, false);
  assert.equal(news.alerts.total, 2);

  const empty = buildNews({ records: [], fetches: [], now: saturday });
  assert.equal(empty.date, "2026-11-14");
  assert.equal(empty.today, true);
  assert.deepEqual(empty.alerts, { total: 0, groups: [] });
});

test("an alert's day is its New York date, not its UTC one", () => {
  /* 02:00Z on the 14th is 21:00 on the 13th in New York */
  const news = buildNews({ records: [alert("CRWV", "2026-11-14T02:00:00.000Z")], fetches: [], now: Date.parse("2026-11-14T03:00:00.000Z") });
  assert.equal(news.date, "2026-11-13");
  assert.equal(news.today, true);
  assert.equal(news.alerts.total, 1);
});

test("a broken line is skipped", async () => {
  const h = await home();
  await ledger(h, ALERTS_FILE, [alert("CRWV", "2026-11-13T15:00:00.000Z"), "null\n", "{\"kind\":\"alert\",\"t\":\"2026-11-13T15:00:00.000Z\",\"symbol\":7}\n", "{\"kind\":\"alert\""]);
  const news = await deskNews({ home: h, now: () => FRIDAY });
  assert.equal(news.alerts.total, 1);
  assert.equal(news.alerts.groups[0]!.symbol, "CRWV");
});

test("deskNews reads the ledgers, re-reading alerts.jsonl when it changes, and counts a reason's pages from every desk-fetch", async () => {
  const h = await home();
  const text = "CRWV 再融资\n媒体解读\n来源";
  await ledger(h, ALERTS_FILE, [
    alert("CRWV", "2026-11-13T15:00:00.000Z", { pass: "pq" }),
    { t: "2026-11-13T15:03:00.000Z", kind: "annotated", pass: "pq", sessionId: "s-q", outcome: "ended", sent: [], text },
  ]);
  await ledger(h, EVENTS_FILE, [
    { t: "2026-11-12T15:01:00.000Z", kind: "desk-fetch", sessionId: "s-q", url: "https://a.example" },
    { t: "2026-11-13T15:01:00.000Z", kind: "desk-fetch", sessionId: "s-q", url: "https://b.example" },
    { t: "2026-11-13T15:02:00.000Z", kind: "desk-fetch", sessionId: "s-z", url: "https://c.example" },
  ]);
  const first = await deskNews({ home: h, now: () => FRIDAY });
  assert.equal(first.alerts.groups[0]!.latest.reason!.pages, 2);
  assert.equal(first.alerts.groups[0]!.latest.reason!.label, "媒体解读");
  await writeFile(join(deskDir(h), ALERTS_FILE), JSON.stringify(alert("QQQ", "2026-11-13T16:00:00.000Z")) + "\n", { flag: "a" });
  const second = await deskNews({ home: h, now: () => FRIDAY });
  assert.equal(second.alerts.total, 2);
  assert.equal(second.alerts.groups[0]!.symbol, "QQQ");
});

test("rules carry today's count", () => {
  const watch = watchStatus({
    rules: [
      { id: "watch-crwv", kind: "move_pct", pct: 5, symbols: ["CRWV"], holdings: false, levels: false },
      { id: "filings", kind: "filing", forms: ["8-K"], symbols: [], holdings: true, levels: false },
    ],
    levels: 7,
  });
  const records = [
    alert("CRWV", "2026-11-12T15:00:00.000Z"),
    alert("CRWV", "2026-11-13T15:00:00.000Z"),
    alert("CRWV", "2026-11-13T16:00:00.000Z", { decision: "suppressed", suppressed: "cap" }),
    alert("CRWV", "2026-11-13T17:00:00.000Z", { trigger: { type: "level", kind: "watch", price: 9, when: "cross_down" }, label: "watch-crwv", quote: null }),
    alert("NVDA", "2026-11-13T17:30:00.000Z", { pass: "", trigger: { type: "filing", rule: "filings", form: "8-K", accession: "x", accepted: null, filingDate: "2026-11-13", items: null, url: "u" }, label: "8-K", quote: null }),
  ];
  const news = buildNews({ records, fetches: [], watch, now: FRIDAY });
  assert.deepEqual(news.rules, [
    { id: "watch-crwv", kind: "move_pct", pct: 5, symbols: ["CRWV"], holdings: false, levels: false, alertsToday: 3 },
    { id: "filings", kind: "filing", forms: ["8-K"], symbols: [], holdings: true, levels: false, alertsToday: 1 },
  ]);
  assert.equal(news.levels, 7);
  const nvda = news.alerts.groups.find((g) => g.symbol === "NVDA")!.latest;
  assert.equal(nvda.kind, "filing");
  assert.equal(nvda.movePct, null);
  assert.equal(nvda.reason, undefined);
  const level = news.alerts.groups.find((g) => g.symbol === "CRWV")!.latest;
  assert.equal(level.kind, "level");
  assert.equal(level.movePct, null);
});

test("sources follow the watch's markets and its filings", () => {
  const sources = (watch: WatchStatus) => buildNews({ records: [], fetches: [], watch, now: FRIDAY }).sources;
  assert.deepEqual(sources(watchStatus()), [{ id: "quotes", state: "ok" }, { id: "headlines", state: "ok" }, { id: "filings", state: "ok" }]);
  const broken = watchStatus({
    markets: { us: { state: "polling", watched: 3, notWatched: [], lastError: "market down", today: quiet() }, cn: { state: "off", watched: 0, notWatched: [], today: quiet() } },
    filings: { state: "refused-today", symbols: 3, aShares: 0, seeded: 3, lastError: "SEC 403" },
  });
  assert.deepEqual(sources(broken), [
    { id: "quotes", state: "unavailable", reason: "market down" }, { id: "headlines", state: "unavailable", reason: "market down" },
    { id: "filings", state: "unavailable", reason: "SEC 403" },
  ]);
  const off = watchStatus({
    markets: { us: { state: "off", watched: 0, notWatched: [], today: quiet() }, cn: { state: "off", watched: 0, notWatched: [], today: quiet() } },
    filings: { state: "off", symbols: 0, aShares: 0, seeded: 0 },
  });
  assert.deepEqual(sources(off).map((s) => s.state), ["off", "off", "off"]);
});

test("a reason's text comes back byte for byte: the server never escapes", () => {
  const text = "<script>x</script> & more";
  const records = [
    alert("CRWV", "2026-11-13T15:00:00.000Z", { pass: "px" }),
    { t: "2026-11-13T15:03:00.000Z", kind: "annotated", pass: "px", sessionId: "s-x", outcome: "ended", sent: [], text },
  ];
  const reason = buildNews({ records, fetches: [], now: FRIDAY }).alerts.groups[0]!.latest.reason!;
  assert.equal(reason.text, text);
  assert.equal(reason.headline, text);
  assert.equal(reason.label, null);
});

test("GET /data/desk/news is fenced", async () => {
  const h = await home();
  await ledger(h, ALERTS_FILE, [alert("CRWV", "2026-11-13T15:00:00.000Z")]);
  const rec = recorder();
  registerDeskNewsRoute(rec, { home: h, watch: () => watchStatus({ levels: 4 }), now: () => FRIDAY });
  assert.deepEqual(rec.paths(), ["/data/desk/news"]);
  const ok = JSON.parse(await rec.call("/data/desk/news")) as { status: number; body: { ok: boolean; alerts: { total: number }; levels: number; date: string } };
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.alerts.total, 1);
  assert.equal(ok.body.levels, 4);
  assert.equal(ok.body.date, "2026-11-13");
  const forged = JSON.parse(await rec.call("/data/desk/news", { host: "evil.example.com" })) as { status: number; body: unknown };
  assert.equal(forged.status, 403);
  assert.deepEqual(forged.body, { ok: false, error: "forbidden" });
});
