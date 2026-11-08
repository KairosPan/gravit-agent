// face/tests/watch.test.ts
/** The watch row (src/watch.ts) over fakes: one MarketQuoteSource over two tables, one per market, recording each
 * snapshot's ids and answering from the table the test edits; a WallClock; a fake XNYS calendar (2026-11-30 14:30Z-
 * 21:00Z) and a fake XSHG one (2026-11-30 and 2026-12-01, 01:30Z-07:00Z, by the Beijing date); a deliver recording
 * { text, opts } and resolving { sent: ["telegram:<100 + n>"] }; a post resolving { opened: true, sessionId: "s" }; fixtures under
 * face/tests/tmp/watch-<pid>/. Offline: the EDGAR fetch is a fake, and no test reaches the Account or SEC. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALERTS_FILE, deskDir, FILINGS_FILE, readEvents, WATCH_LEASE_FILE, writeMute, writeOff, type BudgetState,
} from "../src/desk.ts";
import { alertText } from "../src/alert-text.ts";
import type { DeliverResult, PostResult } from "../src/desk-conversation.ts";
import type { EdgarFetch } from "../src/edgar.ts";
import { bjDate } from "../src/et.ts";
import { HttpError } from "../src/http.ts";
import { deskCalendars, type DeskCalendars, type MarketCalendar, type MarketSession } from "../src/market-clock.ts";
import type { MarketQuote, MarketQuoteIdentity, MarketQuotePayload, MarketQuoteSource } from "../src/market-quotes.ts";
import type { Market } from "../src/symbols.ts";
import type { AlertHit } from "../src/watch-eval.ts";
import {
  cutAt, installWatch, isAnnotatedRecord, LEASE_STALE_MS, MARKS_MAX, pidAlive, WATCH_CN_MAX, WATCH_US_MAX, type WatchHandle,
} from "../src/watch.ts";
import { fakeCalendar, WallClock } from "./desk-fakes.ts";

const TMP = join(dirname(fileURLToPath(import.meta.url)), "tmp", `watch-${process.pid}`);
after(async () => { await rm(TMP, { recursive: true, force: true }); });

const US_1130: MarketSession = { date: "2026-11-30", open: "2026-11-30T14:30:00Z", close: "2026-11-30T21:00:00Z", early: false };
const cnSession = (date: string): MarketSession => ({ date, open: `${date}T01:30:00Z`, close: `${date}T07:00:00Z`, early: false });

/* ---------- the source ---------- */

type Row = { price: number | null; asOf: string; prev?: number; phase?: "trading" | "midday" | "closed"; feed?: string } | { unavailable: string };

/** One source over two tables; each snapshot's ids and time recorded. */
class FakeSource implements MarketQuoteSource {
  readonly tables: Record<Market, Map<string, Row>> = { us: new Map(), cn: new Map() };
  readonly calls: { at: number; ids: string[] }[] = [];
  reject: Partial<Record<Market, Error>> = {};
  hold: Promise<void> | undefined;
  unavailable: string | undefined;
  constructor(private readonly now: () => number) {}

  async snapshot(assets: MarketQuoteIdentity[]): Promise<MarketQuotePayload> {
    this.calls.push({ at: this.now(), ids: assets.map((a) => a.id) });
    if (this.hold !== undefined) await this.hold;
    const market = assets[0]?.market;
    const rejection = market === undefined ? undefined : this.reject[market];
    if (rejection !== undefined) throw rejection;
    return { ok: true, generated_at: new Date(this.now()).toISOString(), quotes: assets.map((a) => quoteOf(a, this.tables[a.market].get(a.symbol))), providers: [] };
  }

  callsFor(m: Market): { at: number; ids: string[] }[] {
    return this.calls.filter((c) => c.ids.every((id) => id.startsWith(`${m}:`)));
  }
}

function quoteOf(a: MarketQuoteIdentity, row: Row | undefined): MarketQuote {
  const base: MarketQuote = {
    ...a, price: null, prev_close: null, change: null, change_pct: null, volume: null, as_of: null, received_at: null, volume_as_of: null, source: "market",
    feed: a.market === "us" ? "robinhood" : "tencent", basis: "previous_close", quote_status: "unavailable", market_status: "unknown",
    message: a.market === "us" ? `the Market read lists no US share ${a.symbol}` : `no A-share quote for ${a.symbol}`,
  };
  if (row === undefined) return base;
  if ("unavailable" in row) return { ...base, message: row.unavailable };
  const prev = row.prev ?? null;
  return {
    ...base, price: row.price, prev_close: prev, change: prev !== null && row.price !== null ? row.price - prev : null, as_of: row.asOf, received_at: row.asOf,
    feed: row.feed ?? base.feed, quote_status: "live", message: "", market_status: a.market === "cn" ? (row.phase === "trading" || row.phase === undefined ? "open" : "closed") : "unknown",
    ...(a.market === "cn" ? { cn: { phase: row.phase ?? "trading", lastSession: null } } : {}),
  };
}

/* ---------- the fixture ---------- */

let cases = 0;
interface Harness {
  wall: WallClock;
  watch: WatchHandle;
  source: FakeSource;
  sent: { text: string; opts: { kind: string; replyTo?: string } }[];
  posts: Parameters<NonNullable<HarnessOpts["post"]>>[0][];
  logs: string[];
  home: string;
  root: string;
  calendars: DeskCalendars & { us: MarketCalendar & { asked?: string[] }; cn: MarketCalendar & { asked?: string[] } };
  budgetCalls: () => number;
  lines: (pattern: RegExp) => string[];
  alertRecords: () => Promise<Record<string, unknown>[]>;
}
interface HarnessOpts {
  start: string;
  files?: Record<string, string>;
  home?: string;
  root?: string;
  source?: FakeSource;
  wall?: WallClock;
  deliver?: (text: string, n: number) => DeliverResult | Promise<DeliverResult>;
  post?: (input: { text: string; source: unknown; message: unknown; replyTo?: string }) => PostResult | Promise<PostResult>;
  budget?: BudgetState;
  edgar?: { fetch: EdgarFetch; userAgent: string };
  calendars?: Partial<DeskCalendars>;
  pid?: number;
  alive?: (pid: number) => boolean;
}

async function harness(o: HarnessOpts): Promise<Harness> {
  const base = join(TMP, `case-${++cases}`);
  const root = o.root ?? join(base, "repo");
  const home = o.home ?? join(base, "home");
  for (const [file, text] of Object.entries(o.files ?? {})) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  await mkdir(root, { recursive: true });
  const wall = o.wall ?? new WallClock(o.start);
  const source = o.source ?? new FakeSource(() => wall.now());
  const sent: Harness["sent"] = [];
  const posts: Harness["posts"] = [];
  const logs: string[] = [];
  let n = 0;
  let budgetCalls = 0;
  const calendars = {
    us: o.calendars?.us ?? fakeCalendar({ "2026-11-30": US_1130, "2026-12-01": "closed" }),
    cn: o.calendars?.cn ?? fakeCalendar({ "2026-11-30": cnSession("2026-11-30"), "2026-12-01": cnSession("2026-12-01"), "2026-12-02": cnSession("2026-12-02") }, "fake XSHG", (t) => bjDate(new Date(t))),
  };
  const watch = installWatch({
    home, root, quotes: source, calendars, clock: wall,
    deliver: async (text, opts) => {
      sent.push({ text, opts });
      const k = n++;
      return o.deliver === undefined ? { sent: [`telegram:${100 + k}`] } : o.deliver(text, k);
    },
    post: async (input) => {
      posts.push(input);
      return o.post === undefined ? { opened: true, sessionId: "s" } : o.post(input);
    },
    budget: async () => {
      budgetCalls += 1;
      return o.budget ?? { used: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, total: 0 }, spent: false };
    },
    ...(o.edgar === undefined ? {} : { edgar: o.edgar }),
    pid: o.pid ?? 4242,
    alive: o.alive ?? ((p) => p === (o.pid ?? 4242)),
    log: (line) => { logs.push(line); },
  });
  return {
    wall, watch, source, sent, posts, logs, home, root, calendars,
    budgetCalls: () => budgetCalls,
    lines: (pattern) => sent.map((s) => s.text).filter((t) => pattern.test(t)),
    alertRecords: async () => {
      try {
        return (await readFile(join(deskDir(home), ALERTS_FILE), "utf8")).split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Record<string, unknown>);
      } catch {
        return [];
      }
    },
  };
}

async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 5_000): Promise<void> {
  const limit = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > limit) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 5));
  }
}

/** A level as levels.yml writes it. */
function level(symbol: string, kind: string, price: number, when: "cross_up" | "cross_down", extra = ""): string {
  const quoted = /^\d{6}$/.test(symbol) ? `"${symbol}"` : symbol;
  return `- symbol: ${quoted}\n  kind: ${kind}\n  price: ${price}\n  when: ${when}\n  plan: plan for ${symbol}\n  expires: 2027-12-31\n${extra}`;
}
const us = (price: number | null, asOf: string, prev?: number): Row => ({ price, asOf, ...(prev === undefined ? {} : { prev }) });
const cn = (price: number, asOf: string, phase: "trading" | "midday" | "closed" = "trading", prev?: number): Row => ({ price, asOf, phase, ...(prev === undefined ? {} : { prev }) });
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

/* ---------- the US crossing and the A-share crossing ---------- */

test("a US crossing is recorded, sent with its feed's stamp and the plan, and one annotation post replies to it", async () => {
  const h = await harness({
    start: "2026-11-30T15:20:45Z",
    files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down"), "desk/holdings.yml": "- symbol: NVDA\n  qty: 100\n  avg_cost: 120.5\n" },
  });
  h.source.tables.us.set("NVDA", us(171, "2026-11-30T15:20:44Z", 174.05));
  await h.wall.advance(0);
  await until("the first poll", () => h.source.calls.length === 1);
  h.source.tables.us.set("NVDA", us(169.82, "2026-11-30T15:21:03Z", 174.05));
  await h.wall.advance(20_000);
  await until("the alert", () => h.sent.length === 1);
  const text = h.sent[0].text;
  assert.ok(text.startsWith("NVDA 169.82 · ROBINHOOD 10:21:03 ET"), text);
  assert.match(text, /plan: plan for NVDA/);
  assert.match(text, /held 100 @ 120\.50/);
  assert.ok(text.endsWith("annotation follows"), text);
  await until("the post", () => h.posts.length === 1);
  assert.deepEqual(h.posts[0].source, { kind: "alert", symbol: "NVDA", rule: "stop" });
  assert.equal(h.posts[0].replyTo, "telegram:100");
  await until("the records", async () => (await h.alertRecords()).some((r) => r.kind === "annotation"));
  const records = await h.alertRecords();
  const alert = records.find((r) => r.kind === "alert");
  assert.equal(alert?.decision, "send");
  assert.equal(alert?.symbol, "NVDA");
  const delivered = records.find((r) => r.kind === "delivered") as { latency: { tradeMs: number } } | undefined;
  assert.equal(delivered?.latency.tradeMs, Date.parse("2026-11-30T15:21:05Z") - Date.parse("2026-11-30T15:21:03Z"));
  assert.equal(h.watch.status().recent[0].latencyMs, 2_000);
  assert.equal(h.watch.status().recent[0].feed, "robinhood");
  await h.watch.dispose();
});

test("an A-share crossing is sent with the TENCENT stamp; the US poll is not asked outside its window", async () => {
  const h = await harness({
    start: "2026-12-01T01:25:00Z",
    files: { "desk/levels.yml": level("600519", "watch", 1400, "cross_down") + level("NVDA", "stop", 170, "cross_down") },
  });
  h.source.tables.cn.set("600519", cn(1405, "2026-12-01T01:24:58Z"));
  await h.wall.advance(0);
  await until("the first cn poll", () => h.source.calls.length === 1);
  assert.equal(h.source.calls[0].at, Date.parse("2026-12-01T01:25:00Z"), "polled at once: its window opened at 01:20Z");
  await h.wall.advance(10_000);
  assert.equal(h.source.calls.length, 2, "and every 10 s");
  assert.equal(h.watch.status().markets.us.state, "after-close", "the 2026-11-30 US session has closed");
  h.wall.set("2026-12-01T02:03:00Z");
  h.source.tables.cn.set("600519", cn(1401, "2026-12-01T02:02:59Z"));
  await h.wall.advance(10_000);
  h.source.tables.cn.set("600519", cn(1398.5, "2026-12-01T02:03:12Z"));
  await h.wall.advance(10_000);
  await until("the alert", () => h.sent.length === 1);
  assert.ok(h.sent[0].text.startsWith("600519 1398.5 · TENCENT 10:03:12 Beijing"), h.sent[0].text);
  for (const call of h.source.calls) assert.deepEqual(call.ids, ["cn:600519"], "each poll one snapshot over the cn ids alone");
  await h.watch.dispose();
});

test("each market polls at its cadence, never two in flight, and only inside its window", async () => {
  const h = await harness({ start: "2026-11-30T08:59:00Z", files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") } });
  h.source.tables.us.set("NVDA", us(171, "2026-11-30T08:59:00Z"));
  await h.wall.advance(0);
  await h.wall.advance(55_000);
  assert.equal(h.source.calls.length, 0, "no us poll before 09:00Z, 04:00 ET");
  await h.wall.advance(5_000);
  assert.deepEqual(h.source.calls.map((c) => c.at), [Date.parse("2026-11-30T09:00:00Z")]);
  await h.wall.advance(20_000);
  assert.equal(h.source.calls.length, 2);
  let release!: () => void;
  h.source.hold = new Promise<void>((done) => { release = done; });
  await h.wall.advance(20_000);
  assert.equal(h.source.calls.length, 3, "the third poll hangs");
  await h.wall.advance(30_000);
  assert.equal(h.source.calls.length, 3, "no second poll while one is in flight");
  h.source.hold = undefined;
  release();
  await h.wall.advance(5_000);
  assert.equal(h.source.calls.length, 4, "the next tick after it settles polls");
  h.wall.set("2026-12-01T01:00:00Z");
  const before = h.source.calls.length;
  await h.wall.advance(60_000);
  assert.equal(h.source.calls.length, before, "nothing from 01:00Z, 20:00 ET");
  assert.equal(h.watch.status().markets.us.state, "after-close");
  await h.watch.dispose();

  const c = await harness({ start: "2026-12-01T01:19:00Z", files: { "desk/levels.yml": level("600519", "watch", 1400, "cross_down") } });
  c.source.tables.cn.set("600519", cn(1405, "2026-12-01T01:19:00Z"));
  await c.wall.advance(0);
  await c.wall.advance(55_000);
  assert.equal(c.source.calls.length, 0);
  await c.wall.advance(5_000);
  await c.wall.advance(10_000);
  assert.deepEqual(c.source.calls.map((x) => x.at), [Date.parse("2026-12-01T01:20:00Z"), Date.parse("2026-12-01T01:20:10Z")]);
  await c.watch.dispose();
});

/* ---------- the US window, the reference close and the ledger's five days (why-it-moved task 8) ---------- */

const US_1029: MarketSession = { date: "2026-10-29", open: "2026-10-29T13:30:00Z", close: "2026-10-29T20:00:00Z", early: false };
const US_1030: MarketSession = { date: "2026-10-30", open: "2026-10-30T13:30:00Z", close: "2026-10-30T20:00:00Z", early: false };
const US_1102: MarketSession = { date: "2026-11-02", open: "2026-11-02T14:30:00Z", close: "2026-11-02T21:00:00Z", early: false };
const US_1127: MarketSession = { date: "2026-11-27", open: "2026-11-27T14:30:00Z", close: "2026-11-27T18:00:00Z", early: true };
/** The week daylight saving ends (Sunday 2026-11-01). */
const dstWeek = (): MarketCalendar & { asked: string[] } =>
  fakeCalendar({ "2026-10-29": US_1029, "2026-10-30": US_1030, "2026-10-31": "closed", "2026-11-01": "closed", "2026-11-02": US_1102 });
const INTC_RULE = "- id: watch-intc\n  kind: move_pct\n  symbols: [INTC]\n  move_pct: 5\n  cooldown: 1440m\n";

/** The times of a harness's US polls, as ISO text. */
const usPolls = (h: Harness): string[] => h.source.callsFor("us").map((c) => new Date(c.at).toISOString().replace(".000Z", "Z"));

test("the US watch polls from 04:00 ET to 20:00 ET on a session day, and to 17:00 ET on an early close", async () => {
  const h = await harness({ start: "2026-11-30T08:59:40Z", files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") } });
  h.source.tables.us.set("NVDA", us(171, "2026-11-30T08:59:40Z"));
  await h.wall.advance(0);
  await h.wall.advance(15_000);
  assert.deepEqual(usPolls(h), [], "nothing before 04:00 ET");
  assert.equal(h.watch.status().markets.us.state, "waiting");
  await h.wall.advance(5_000);
  assert.deepEqual(usPolls(h), ["2026-11-30T09:00:00Z"]);
  assert.equal(h.watch.status().markets.us.state, "polling");
  h.wall.set("2026-12-01T00:59:40Z");
  const before = usPolls(h).length;
  await h.wall.advance(0);
  assert.equal(usPolls(h).length, before + 1, "19:59:40 ET still polls");
  await h.wall.advance(20_000);
  assert.equal(usPolls(h).length, before + 1, "none at 20:00 ET");
  assert.equal(h.watch.status().markets.us.state, "after-close");
  await h.watch.dispose();

  const early = await harness({
    start: "2026-11-27T21:59:40Z", files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") },
    calendars: { us: fakeCalendar({ "2026-11-25": { date: "2026-11-25", open: "2026-11-25T14:30:00Z", close: "2026-11-25T21:00:00Z", early: false }, "2026-11-26": "closed", "2026-11-27": US_1127 }) },
  });
  early.source.tables.us.set("NVDA", us(171, "2026-11-27T21:59:40Z"));
  await early.wall.advance(0);
  assert.deepEqual(usPolls(early), ["2026-11-27T21:59:40Z"], "16:59:40 ET on an early close polls");
  await early.wall.advance(20_000);
  assert.deepEqual(usPolls(early), ["2026-11-27T21:59:40Z"], "none at 17:00 ET");
  assert.equal(early.watch.status().markets.us.state, "after-close");
  await early.watch.dispose();
});

test("in the week daylight saving ends, the first US poll is 08:00Z on Friday 2026-10-30 and 09:00Z on Monday 2026-11-02", async () => {
  const fri = await harness({ start: "2026-10-30T07:59:40Z", files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") }, calendars: { us: dstWeek() } });
  fri.source.tables.us.set("NVDA", us(171, "2026-10-30T07:59:40Z"));
  await fri.wall.advance(0);
  await fri.wall.advance(15_000);
  assert.deepEqual(usPolls(fri), []);
  await fri.wall.advance(5_000);
  assert.deepEqual(usPolls(fri), ["2026-10-30T08:00:00Z"]);
  await fri.watch.dispose();

  const mon = await harness({ start: "2026-11-02T08:59:40Z", files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") }, calendars: { us: dstWeek() } });
  mon.source.tables.us.set("NVDA", us(171, "2026-11-02T08:59:40Z"));
  await mon.wall.advance(0);
  await mon.wall.advance(15_000);
  assert.deepEqual(usPolls(mon), [], "08:00Z on Monday is 03:00 ET");
  await mon.wall.advance(5_000);
  assert.deepEqual(usPolls(mon), ["2026-11-02T09:00:00Z"]);
  await mon.watch.dispose();
});

test("a restart at Monday 04:00 remembers Friday's after-hours alert and stays quiet", async () => {
  const files = { "desk/rules.yml": INTC_RULE };
  const fri = await harness({ start: "2026-10-30T20:05:00Z", files, calendars: { us: dstWeek() } });
  fri.source.tables.us.set("INTC", us(70, "2026-10-30T20:04:59Z", 92.07));
  await fri.wall.advance(0);
  await until("the first poll", () => fri.source.calls.length === 1);
  fri.source.tables.us.set("INTC", us(69.5, "2026-10-30T20:05:19Z", 92.07));
  await fri.wall.advance(20_000);
  await until("the after-hours alert", () => fri.sent.length === 1);
  const lines = fri.sent[0].text.split("\n");
  assert.equal(lines.at(-2), "after hours: -24.51% from today's close 92.07");
  assert.equal(lines.at(-1), "reason follows", "a sent US move whose rule annotates is told a reason follows");
  await until("the record", async () => (await fri.alertRecords()).some((r) => r.kind === "alert"));
  const rec = (await fri.alertRecords()).find((r) => r.kind === "alert");
  assert.deepEqual([rec?.date, rec?.ref, rec?.phase, rec?.onePrint], ["2026-10-30", "2026-10-30", "after", undefined]);
  await fri.watch.dispose();

  const wall = new WallClock("2026-11-02T08:59:55Z");
  const source = new FakeSource(() => wall.now());
  source.tables.us.set("INTC", us(68, "2026-11-02T09:00:00Z", 92.07));
  const mon = await harness({ start: "", wall, source, home: fri.home, root: fri.root, calendars: { us: dstWeek() }, pid: 4343 });
  await wall.advance(0);
  await wall.advance(5_000);
  await until("the first Monday poll", () => source.calls.length === 1);
  assert.equal(source.calls[0].at, Date.parse("2026-11-02T09:00:00Z"));
  for (let i = 1; i <= 8; i++) {
    source.tables.us.set("INTC", us(68 - i / 10, `2026-11-02T09:00:${String(i * 5).padStart(2, "0")}Z`, 92.07));
    await wall.advance(20_000);
  }
  await until("the eighth Monday poll", () => source.calls.length >= 9);
  assert.equal(mon.sent.length, 0, "the pre-market measures from Friday's close, which already alerted");
  assert.equal((await mon.alertRecords()).filter((r) => r.kind === "alert").length, 1);
  await mon.watch.dispose();
});

test("a restart in the regular session remembers a lone pre-market print's alert, and counts its repeat today", async () => {
  const files = { "desk/rules.yml": INTC_RULE };
  const pre = await harness({ start: "2026-10-30T11:00:00Z", files, calendars: { us: dstWeek() } });
  pre.source.tables.us.set("INTC", us(69.05, "2026-10-30T10:59:58Z", 92.07));
  await pre.wall.advance(0);
  await until("the first poll", () => pre.source.calls.length === 1);
  for (let i = 0; i < 6; i++) await pre.wall.advance(20_000);
  await until("the lone print's alert", () => pre.sent.length === 1);
  assert.deepEqual(pre.sent[0].text.split("\n").slice(-3), [
    "pre-market: -25.00% from the 2026-10-29 close 92.07",
    "one print: no second print within 2 minutes",
    "reason follows",
  ]);
  await until("the record", async () => (await pre.alertRecords()).some((r) => r.kind === "alert"));
  const rec = (await pre.alertRecords()).find((r) => r.kind === "alert");
  assert.deepEqual([rec?.date, rec?.ref, rec?.phase, rec?.onePrint], ["2026-10-30", "2026-10-29", "pre", true]);
  await pre.watch.dispose();

  const wall = new WallClock("2026-10-30T14:00:00Z");
  const source = new FakeSource(() => wall.now());
  source.tables.us.set("INTC", us(90, "2026-10-30T13:59:59Z", 92.07));
  const reg = await harness({ start: "", wall, source, home: pre.home, root: pre.root, calendars: { us: dstWeek() }, pid: 4343 });
  await wall.advance(0);
  await until("the first poll", () => source.calls.length === 1);
  source.tables.us.set("INTC", us(86, "2026-10-30T14:00:19Z", 92.07));
  await wall.advance(20_000);
  await until("the second poll", () => source.calls.length === 2);
  await wall.advance(0);
  assert.equal(reg.sent.length, 0, "the session's crossing measures from the 2026-10-29 close, inside the pre-market alert's cooldown");
  assert.equal(reg.watch.status().markets.us.today.repeats, 1, "a repeat judged on today's date counts today, whatever its reference");
  await reg.watch.dispose();
});

test("a closed XSHG day polls no A share; past the table the watch says so once and judges on the Market's phase", async () => {
  const closed = await harness({
    start: "2026-12-01T02:00:00Z", files: { "desk/levels.yml": level("600519", "watch", 1400, "cross_down") },
    calendars: { cn: fakeCalendar({ "2026-12-01": "closed" }, "fake XSHG", (t) => bjDate(new Date(t))) },
  });
  await closed.wall.advance(0);
  await closed.wall.advance(20_000);
  assert.equal(closed.source.calls.length, 0);
  assert.equal(closed.watch.status().markets.cn.state, "closed");
  await closed.watch.dispose();

  const past = await harness({
    start: "2027-01-04T01:25:00Z", files: { "desk/levels.yml": level("600519", "watch", 1400, "cross_down") },
    calendars: { cn: deskCalendars().cn },
  });
  past.source.tables.cn.set("600519", cn(1405, "2027-01-04T01:24:59Z"));
  await past.wall.advance(0);
  await past.wall.advance(20_000);
  const cnStatus = past.watch.status().markets.cn;
  assert.equal(cnStatus.state, "polling");
  assert.equal(cnStatus.uncovered, true);
  assert.deepEqual(cnStatus.session, { date: "2027-01-04", open: "2027-01-04T01:30:00Z", close: "2027-01-04T07:00:00Z" });
  assert.ok(past.source.calls.length >= 2);
  await until("the line", () => past.sent.length >= 1);
  assert.deepEqual(past.lines(/A-share calendar/), [
    "the A-share calendar ends 2026-12-31; the watch judges A shares on the Beijing bands, the close print and the Market's phase for whether the day trades, until face/src/xshg-clock.ts is extended",
  ]);
  await past.watch.dispose();
});

/* ---------- blind, said once ---------- */

test("the Market's read busy or unreachable sends one line per session date per market and judges nothing", async () => {
  const h = await harness({ start: "2026-11-30T14:25:00Z", files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") } });
  h.source.reject.us = new HttpError(429, "busy: the Market read refused for now; try again shortly");
  await h.wall.advance(0);
  await h.wall.advance(40_000);
  await until("the line", () => h.sent.length === 1);
  assert.equal(h.watch.status().markets.us.lastError, "busy");
  assert.deepEqual(h.sent.map((s) => s.text), ["the watch has no US prices today: busy"]);
  assert.ok(h.source.calls.length >= 2);
  assert.deepEqual(await h.alertRecords(), [], "nothing judged");
  h.source.unavailable = "no quote source is wired: this face has no Market read to ask";
  const asked = h.source.calls.length;
  await h.wall.advance(40_000);
  assert.equal(h.source.calls.length, asked, "an unavailable source is asked nothing");
  assert.deepEqual([h.watch.status().markets.us.state, h.watch.status().markets.cn.state], ["off", "off"]);
  await h.watch.dispose();

  const c = await harness({ start: "2026-12-01T01:19:30Z", files: { "desk/levels.yml": level("600519", "watch", 1400, "cross_down") } });
  c.source.reject.cn = new Error("the Account is not reachable");
  await c.wall.advance(0);
  await c.wall.advance(60_000);
  c.wall.set("2026-12-01T05:30:00Z"); // 00:30 ET on 2026-12-01: the same Beijing session
  await c.wall.advance(30_000);
  await until("the line", () => c.sent.length >= 1);
  await c.wall.advance(0);
  assert.deepEqual(c.sent.map((s) => s.text), ["the watch has no A-share prices today: the Account is not reachable"]);
  await c.watch.dispose();
});

test("a poll whose every A-share quote is refused sends noPrices once", async () => {
  const h = await harness({ start: "2026-12-01T02:00:00Z", files: { "desk/levels.yml": level("600519", "watch", 1400, "cross_down") } });
  h.source.tables.cn.set("600519", { unavailable: "the Market read refused: the account layer is not mounted" });
  await h.wall.advance(0);
  await h.wall.advance(20_000);
  await until("three polls", () => h.source.calls.length >= 3);
  await until("the line", () => h.sent.length >= 1);
  assert.equal(h.watch.status().markets.cn.lastError, "the Market read refused: the account layer is not mounted");
  assert.deepEqual(h.sent.map((s) => s.text), ["the watch has no A-share prices today: the Market read refused: the account layer is not mounted"]);
  await h.watch.dispose();
});

test("a watched symbol unpriced on every poll of a session sends one line per (symbol, reason) per session date", async () => {
  const h = await harness({
    start: "2026-12-01T02:00:00Z",
    files: { "desk/levels.yml": level("600519", "watch", 1400, "cross_down") + level("699999", "watch", 10, "cross_down") },
  });
  h.source.tables.cn.set("600519", cn(1405, "2026-12-01T01:59:59Z"));
  const line = "the watch has no price for 699999 this session: no A-share quote for 699999";
  await h.wall.advance(0);
  await h.wall.advance(10_000);
  await h.wall.advance(0);
  assert.equal(h.source.calls.length, 2);
  assert.deepEqual(h.lines(/no price for/), [], "no line after two polls");
  await h.wall.advance(10_000);
  await until("the line", () => h.lines(/no price for/).length === 1);
  h.source.tables.cn.set("699999", { unavailable: "the Market read lists no A share 699999" });
  await h.wall.advance(10_000);
  await h.wall.advance(0);
  assert.deepEqual(h.lines(/no price for/), [line], "none after the fourth, though its reason changed");
  h.wall.set("2026-12-02T02:00:00Z");
  await h.wall.advance(30_000);
  await until("the next session's line", () => h.lines(/no price for/).length === 2);
  await h.watch.dispose();
});

test("an alert sent while the outlet queues records latency null and posts its annotation without replyTo", async () => {
  const h = await harness({ start: "2026-11-30T15:20:45Z", files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") }, deliver: () => ({ queued: true }) });
  h.source.tables.us.set("NVDA", us(171, "2026-11-30T15:20:44Z"));
  await h.wall.advance(0);
  h.source.tables.us.set("NVDA", us(169.82, "2026-11-30T15:21:03Z"));
  await h.wall.advance(20_000);
  await until("the post", () => h.posts.length === 1);
  assert.equal("replyTo" in h.posts[0], false);
  await until("the delivered record", async () => (await h.alertRecords()).some((r) => r.kind === "delivered"));
  const delivered = (await h.alertRecords()).find((r) => r.kind === "delivered");
  assert.deepEqual(delivered?.latency, { tradeMs: null, receivedMs: null });
  assert.equal(h.watch.status().recent[0].latencyMs, null);
  assert.equal(h.watch.status().recent[0].outcome, "queued");
  await h.watch.dispose();
});

test("a symbol cap per market: past 40 US symbols the rest are named once", async () => {
  const names = Array.from({ length: 45 }, (_, i) => `A${i}`);
  const h = await harness({
    start: "2026-11-30T15:00:00Z",
    files: {
      "desk/levels.yml": names.slice(0, 40).map((s) => level(s, "watch", 10, "cross_down")).join(""),
      "strategies/demo/levels.yml": names.slice(40).map((s) => level(s, "watch", 10, "cross_down")).join(""),
    },
  });
  for (const s of names) h.source.tables.us.set(s, us(20, "2026-11-30T14:59:59Z"));
  await h.wall.advance(0);
  await h.wall.advance(20_000);
  await until("the line", () => h.lines(/covers/).length === 1);
  await h.wall.advance(20_000);
  assert.deepEqual(h.lines(/covers/), [`the watch covers ${WATCH_US_MAX} US symbols; not watched: A40, A41, A42, A43, A44`]);
  assert.equal(h.source.calls[0].ids.length, WATCH_US_MAX);
  const status = h.watch.status().markets.us;
  assert.deepEqual([status.watched, status.notWatched], [40, ["A40", "A41", "A42", "A43", "A44"]]);
  assert.equal(WATCH_CN_MAX, 60);
  await h.watch.dispose();
});

/* ---------- the burst, the slow post, the restart ---------- */

test("a 09:30 burst records twelve, sends six, posts one annotation and batches six at 10:00", async () => {
  const names = Array.from({ length: 12 }, (_, i) => `B${i}`);
  const h = await harness({ start: "2026-11-30T14:30:05Z", files: { "desk/levels.yml": names.map((s) => level(s, "stop", 100, "cross_down")).join("") } });
  for (const s of names) h.source.tables.us.set(s, us(90, "2026-11-30T14:30:01Z"));
  await h.wall.advance(0);
  await until("six alerts", () => h.sent.length === 6);
  await until("twelve records", async () => (await h.alertRecords()).filter((r) => r.kind === "alert").length === 12);
  const alerts = (await h.alertRecords()).filter((r) => r.kind === "alert");
  assert.deepEqual(alerts.map((r) => r.decision), [...Array(6).fill("send"), ...Array(6).fill("suppressed")]);
  assert.deepEqual(alerts.slice(6).map((r) => r.suppressed), Array(6).fill("cap"));
  assert.deepEqual(h.sent.map((s) => s.text.split(" ")[0]), names.slice(0, 6), "the six sent in order");
  await until("the post", () => h.posts.length === 1);
  assert.deepEqual(h.posts[0].source, { kind: "alerts", count: 6 });
  assert.equal(h.posts[0].replyTo, "telegram:100");
  assert.equal(h.watch.status().pending, 6);
  h.wall.set("2026-11-30T14:59:58Z");
  await h.wall.advance(5_000);
  await until("the batch", () => h.sent.length === 7);
  assert.equal(h.sent[6].text, "6 more alerts suppressed: B6 stop 09:30 ET, B7 stop 09:30 ET, B8 stop 09:30 ET, B9 stop 09:30 ET, B10 stop 09:30 ET, B11 stop 09:30 ET");
  assert.deepEqual(h.sent[6].opts, { kind: "alert" }, "a batch of levels goes as alert");
  assert.equal(h.watch.status().pending, 0);
  await until("the batch record", async () => (await h.alertRecords()).some((r) => r.kind === "batch"));
  await h.watch.dispose();
});

test("an annotation post that hangs 5 s does not delay the next pass's alert", async () => {
  let release!: () => void;
  const hang = new Promise<void>((done) => { release = done; });
  const h = await harness({
    start: "2026-11-30T15:20:45Z",
    files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") + level("AMD", "stop", 100, "cross_down") },
    post: async () => { await hang; return { opened: true, sessionId: "s" }; },
  });
  h.source.tables.us.set("NVDA", us(171, "2026-11-30T15:20:44Z"));
  h.source.tables.us.set("AMD", us(101, "2026-11-30T15:20:44Z"));
  await h.wall.advance(0);
  h.source.tables.us.set("NVDA", us(169, "2026-11-30T15:21:00Z"));
  await h.wall.advance(20_000);
  await until("the first post", () => h.posts.length === 1);
  h.source.tables.us.set("AMD", us(99, "2026-11-30T15:21:20Z"));
  await h.wall.advance(20_000);
  await until("the second alert", () => h.sent.length === 2);
  assert.ok(h.sent[1].text.startsWith("AMD 99"), "delivered while the first post still hangs");
  assert.equal(h.posts.length, 1);
  release();
  await until("the second post", () => h.posts.length === 2);
  await h.watch.dispose();
});

test("a restart over the same ledger fires no second gap and keeps the cooldown and the hour's count", async () => {
  const names = Array.from({ length: 7 }, (_, i) => `C${i}`);
  const files = { "desk/levels.yml": names.map((s) => level(s, "stop", 100, "cross_down")).join("") };
  const first = await harness({ start: "2026-11-30T15:00:00Z", files });
  for (const s of names.slice(0, 6)) first.source.tables.us.set(s, us(99, "2026-11-30T14:59:59Z"));
  first.source.tables.us.set("C6", us(101, "2026-11-30T14:59:59Z"));
  await first.wall.advance(0);
  await until("six alerts", () => first.sent.length === 6);
  await first.watch.dispose();

  const wall = new WallClock("2026-11-30T15:05:00Z");
  const source = new FakeSource(() => wall.now());
  for (const s of names.slice(0, 6)) source.tables.us.set(s, us(99, "2026-11-30T15:04:59Z"));
  source.tables.us.set("C0", us(101, "2026-11-30T15:04:59Z"));
  source.tables.us.set("C6", us(99, "2026-11-30T15:04:59Z"));
  const second = await harness({ start: "", wall, source, home: first.home, root: first.root, pid: 4343 });
  await wall.advance(0);
  await until("the first poll", () => source.calls.length === 1);
  await until("C6's record", async () => (await second.alertRecords()).filter((r) => r.kind === "alert").length === 7);
  const c6 = (await second.alertRecords()).filter((r) => r.kind === "alert").at(-1);
  assert.deepEqual([c6?.symbol, c6?.decision, c6?.suppressed], ["C6", "suppressed", "cap"], "the hour's six sends were rebuilt");
  source.tables.us.set("C0", us(99, "2026-11-30T15:05:19Z"));
  await wall.advance(20_000);
  await until("the second poll", () => source.calls.length === 2);
  await wall.advance(0);
  assert.equal(second.sent.length, 0, "no second gap, and C0's crossing is inside its cooldown");
  assert.equal(second.watch.status().markets.us.today.repeats, 1);
  assert.equal(second.watch.status().pending, 1);
  await second.watch.dispose();
});

/* ---------- the orphans: a send a restart caught before its delivered record (spec §16 H2) ---------- */

const NVDA_KEY = "level:desk/levels.yml:NVDA:stop:170:cross_down";
/** An `alert` record decided `send` at `t`, as the watch appends one before it delivers. */
function orphan(id: string, t: string): Record<string, unknown> {
  return {
    t, kind: "alert", id, pass: "p-000000000001", date: "2026-11-30", key: NVDA_KEY, market: "us", symbol: "NVDA", label: "stop",
    trigger: { type: "level", kind: "stop", price: 170, when: "cross_down" }, gap: false,
    quote: { market: "us", price: 169.5, asOf: t, feed: "robinhood", status: "live", prevClose: null, chgPct: null, receivedAt: t },
    holding: null, plan: "plan for NVDA", source: { file: "desk/levels.yml", index: 0 }, decision: "send", annotate: true,
  };
}
/** A harness at 15:20:45Z over a home whose ledger holds `lines`, NVDA priced above its stop so no pass fires. */
async function overLedger(lines: Record<string, unknown>[], o: Partial<HarnessOpts> = {}): Promise<Harness> {
  const home = join(TMP, `case-${++cases}`, "home");
  await mkdir(deskDir(home), { recursive: true });
  await writeFile(join(deskDir(home), ALERTS_FILE), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
  const h = await harness({ start: "2026-11-30T15:20:45Z", files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") }, home, ...o });
  h.source.tables.us.set("NVDA", us(175, "2026-11-30T15:20:44Z"));
  return h;
}
const deliveredOf = async (h: Harness, id: string): Promise<Record<string, unknown>[]> =>
  (await h.alertRecords()).filter((r) => r.kind === "delivered" && r.id === id);

test("an orphan younger than ten minutes is delivered once at the first read, recorded replayed, with no annotation post", async () => {
  const h = await overLedger([orphan("a-young", "2026-11-30T15:16:45.000Z")]);
  await h.wall.advance(0);
  await until("the replay's record", async () => (await deliveredOf(h, "a-young")).length === 1);
  assert.equal(h.sent.length, 1);
  const [first, ...rest] = h.sent[0].text.split("\n");
  assert.equal(first, "late: the face restarted before this alert was sent (raised 10:16 ET)");
  assert.ok(rest[0].startsWith("NVDA 169.5 · ROBINHOOD"), rest[0]);
  assert.ok(!h.sent[0].text.includes("annotation follows"));
  assert.deepEqual(h.sent[0].opts, { kind: "alert" }, "a late level goes as alert");
  const [d] = await deliveredOf(h, "a-young");
  assert.deepEqual([d.delivery, d.latency, d.replayed], [{ sent: ["telegram:100"] }, { tradeMs: null, receivedMs: null }, true]);
  await h.wall.advance(20_000);
  await until("the second poll", () => h.source.calls.length === 2);
  await h.wall.advance(0);
  assert.deepEqual(h.posts, [], "no annotation post follows a replay");
  assert.equal(h.budgetCalls(), 0);
  assert.deepEqual(h.watch.status().recent.map((r) => [r.id, r.outcome]), [["a-young", "sent"]]);
  await h.watch.dispose();
});

test("noteAnnotated appends the lane's annotated record to alerts.jsonl, and a later read takes it back with the rest", async () => {
  const note = {
    t: "2026-11-30T15:20:50.000Z", kind: "annotated" as const, pass: "p-000000000001", sessionId: "session-annotation-1",
    outcome: "ended" as const, sent: ["telegram:101"], text: "Stop met: 169.50 < 170 (ROBINHOOD 10:16:45 ET).",
  };
  const h = await overLedger([orphan("a-old", "2026-11-30T14:50:45.000Z")]);
  await h.wall.advance(0);
  await until("the orphan's record", async () => (await deliveredOf(h, "a-old")).length === 1);
  h.watch.noteAnnotated(note);
  await until("the annotated record", async () => (await h.alertRecords()).some((r) => r.kind === "annotated"));
  assert.deepEqual((await h.alertRecords()).filter((r) => r.kind === "annotated"), [note], "as reported, one line");
  assert.deepEqual(h.watch.status().recent.map((r) => r.id), ["a-old"], "the alerts the status lists are unchanged");
  await h.watch.dispose();
  assert.equal(isAnnotatedRecord(note), true);
  assert.equal(isAnnotatedRecord({ ...note, sent: [101] }), true, "an older record's number");
  assert.equal(isAnnotatedRecord({ ...note, sent: ["101"] }), false, "a message id names its network");

  /* the next face reads the ledger with the annotated line in it: no ledger error, and nothing replayed again */
  const again = await harness({ start: "2026-11-30T15:21:00Z", files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") }, home: h.home });
  again.source.tables.us.set("NVDA", us(175, "2026-11-30T15:20:59Z"));
  await again.wall.advance(0);
  await until("the first poll", () => again.source.calls.length === 1);
  assert.equal(again.watch.status().ledgerError, undefined);
  assert.deepEqual(again.sent, []);
  await again.watch.dispose();
});

/* ---------- a reply keeps its alert (spec §16 H1b) ---------- */

const PASS = "p-000000000001";
/** A delivered record for `id`, its send gone out as the message ids `sent`. */
const deliveredLine = (id: string, t: string, sent: number[]): Record<string, unknown> =>
  ({ t, kind: "delivered", id, delivery: { sent }, latency: { tradeMs: 2_000, receivedMs: 1_000 } });
/** The pass's annotation post, opened, listing `alerts`. */
const annotationLine = (alerts: string[], t: string): Record<string, unknown> =>
  ({ t, kind: "annotation", pass: PASS, alerts, result: "opened", sessionId: "session-annotation-1" });
/** The lane's record of the pass's check, its reply gone out as `sent`. */
const annotatedLine = (t: string, sent: number[], text: string): Record<string, unknown> =>
  ({ t, kind: "annotated", pass: PASS, sessionId: "session-annotation-1", outcome: "ended", sent, text });
/** The watch's ledger once read: the first poll has run. */
async function read(h: Harness): Promise<void> {
  await h.wall.advance(0);
  await until("the first poll", () => h.source.calls.length === 1);
}

test("a reply to an alert's message carries that alert's text", async () => {
  const hit = orphan("a-1", "2026-11-30T15:16:45.000Z");
  const plain = orphan("a-2", "2026-11-30T15:17:45.000Z");
  const h = await overLedger([
    hit, deliveredLine("a-1", "2026-11-30T15:16:46.000Z", [555]),
    { ...plain, pass: "p-000000000002" }, deliveredLine("a-2", "2026-11-30T15:17:46.000Z", [556, 557]),
    annotationLine(["a-1"], "2026-11-30T15:16:47.000Z"),
    annotatedLine("2026-11-30T15:17:30.000Z", [560], "Stop met: 169.50 < 170."),
  ]);
  await read(h);
  const now = h.wall.now();
  assert.equal(h.watch.contextFor("telegram:555"), `${alertText(hit as unknown as AlertHit, now, "none")}\n\nannotation:\nStop met: 169.50 < 170.`,
    "the alert, as sent with no note, and its pass's annotation");
  const unannotated = alertText({ ...plain, pass: "p-000000000002" } as unknown as AlertHit, now, "none");
  assert.equal(h.watch.contextFor("telegram:557"), unannotated, "any part of the send, and no annotation when none names its pass");
  assert.ok(!unannotated.includes("annotation follows"));
  await h.watch.dispose();
});

test("a reply to an annotation's message carries its alerts and the annotation", async () => {
  const one = orphan("a-1", "2026-11-30T15:16:45.000Z");
  const two = { ...orphan("a-2", "2026-11-30T15:16:45.000Z"), symbol: "AMD", label: "watch" };
  const h = await overLedger([
    one, two,
    deliveredLine("a-1", "2026-11-30T15:16:46.000Z", [555]), deliveredLine("a-2", "2026-11-30T15:16:46.000Z", [556]),
    annotationLine(["a-1", "a-2"], "2026-11-30T15:16:47.000Z"),
    annotatedLine("2026-11-30T15:17:30.000Z", [560, 561], "Both met."),
  ]);
  await read(h);
  const now = h.wall.now();
  const expected = [one, two].map((a) => alertText(a as unknown as AlertHit, now, "none")).join("\n\n") + "\n\nannotation:\nBoth met.";
  assert.equal(h.watch.contextFor("telegram:560"), expected);
  assert.equal(h.watch.contextFor("telegram:561"), expected, "any part of the reply");
  h.watch.noteAnnotated({ t: "2026-11-30T15:20:46.000Z", kind: "annotated", pass: PASS, sessionId: "s2", outcome: "ended", sent: ["telegram:600"], text: "x".repeat(5_000) });
  const long = h.watch.contextFor("telegram:600");
  assert.equal(long?.length, 4_000, "cut at 4,000 characters");
  assert.ok(long?.startsWith(expected.slice(0, expected.indexOf("annotation:"))), long?.slice(0, 80));
  await h.watch.dispose();
});

test("a reply to a message the watch does not know carries nothing", async () => {
  const h = await overLedger([
    /* older than the watch's memory: let go at the first read */
    orphan("a-old", "2026-11-28T15:00:00.000Z"), deliveredLine("a-old", "2026-11-28T15:00:01.000Z", [400]),
    orphan("a-1", "2026-11-30T15:16:45.000Z"), deliveredLine("a-1", "2026-11-30T15:16:46.000Z", [555]),
  ]);
  await read(h);
  assert.equal(h.watch.contextFor("telegram:999"), undefined, "no record sent it");
  assert.equal(h.watch.contextFor("telegram:400"), undefined, "past the 48 hours the watch keeps");
  assert.ok(h.watch.contextFor("telegram:555") !== undefined);
  await h.watch.dispose();
});

test("a malformed ledger line costs only its own context: the reply resolves from the good records, or carries nothing", async () => {
  const good = orphan("a-1", "2026-11-30T15:16:45.000Z");
  /* passes the rebuild's check, but alertText cannot read it: no trigger, no quote */
  const { trigger: _t, quote: _q, ...bad } = orphan("a-bad", "2026-11-30T15:17:45.000Z");
  const h = await overLedger([
    good, deliveredLine("a-1", "2026-11-30T15:16:46.000Z", [555]),
    bad, deliveredLine("a-bad", "2026-11-30T15:17:46.000Z", [556]),
    /* newer, and sent as 555 as well: tried first, skipped */
    deliveredLine("a-bad", "2026-11-30T15:18:46.000Z", [555]),
    { t: "2026-11-30T15:18:47.000Z", kind: "delivered", id: "a-1", delivery: { sent: "555" }, latency: {} },
    annotationLine(["a-1", "a-bad"], "2026-11-30T15:18:48.000Z"),
    annotatedLine("2026-11-30T15:19:30.000Z", [560], "One met."),
  ]);
  await read(h);
  const now = h.wall.now();
  const goodText = alertText(good as unknown as AlertHit, now, "none");
  assert.equal(h.watch.contextFor("telegram:555"), `${goodText}\n\nannotation:\nOne met.`, "the good alert's send");
  assert.equal(h.watch.contextFor("telegram:556"), undefined, "the bad alert's own send carries nothing, and does not throw");
  assert.equal(h.watch.contextFor("telegram:560"), `${goodText}\n\nannotation:\nOne met.`, "the annotation names the good alert alone");
  await h.watch.dispose();
});

test("contextFor reads a string id, and an older record's number as telegram:<n>", async () => {
  const older = orphan("a-1", "2026-11-30T15:16:45.000Z");
  const newer = { ...orphan("a-2", "2026-11-30T15:17:45.000Z"), pass: "p-000000000002", symbol: "AMD" };
  const h = await overLedger([
    older, deliveredLine("a-1", "2026-11-30T15:16:46.000Z", [41]),
    newer, { t: "2026-11-30T15:17:46.000Z", kind: "delivered", id: "a-2", delivery: { sent: ["telegram:42"] }, latency: { tradeMs: 2_000, receivedMs: 1_000 } },
  ]);
  await read(h);
  const now = h.wall.now();
  assert.equal(h.watch.contextFor("telegram:41"), alertText(older as unknown as AlertHit, now, "none"), "an older record's number");
  assert.equal(h.watch.contextFor("telegram:42"), alertText(newer as unknown as AlertHit, now, "none"), "a string id");
  assert.equal(h.watch.contextFor("slack:41"), undefined, "an id names its network");
  assert.equal(h.watch.contextFor("41"), undefined, "a bare number is no id");
  await h.watch.dispose();
});

test("a batch that carries an urgent rule's hit goes as urgent, and so does a late replay of one", async () => {
  const names = Array.from({ length: 7 }, (_, i) => `R${i}`);
  /* L0 and R0-R4 are plain levels, six sends that fill the hour's cap; R5 and R6 the urgent rule's, held for the batch */
  const h = await harness({
    start: "2026-11-30T14:30:05Z",
    files: {
      "desk/levels.yml": ["L0", ...names.slice(0, 5)].map((x) => level(x, "stop", 100, "cross_down")).join(""),
      "desk/rules.yml": `- id: loud\n  kind: move_pct\n  symbols: [${names.slice(5).join(", ")}]\n  move_pct: 4\n  urgent: true\n`,
    },
  });
  for (const x of ["L0", ...names.slice(0, 5)]) h.source.tables.us.set(x, us(90, "2026-11-30T14:30:01Z"));
  for (const x of names.slice(5)) h.source.tables.us.set(x, us(90, "2026-11-30T14:30:01Z", 100));
  await h.wall.advance(0);
  await until("eight records", async () => (await h.alertRecords()).filter((r) => r.kind === "alert").length === 8);
  const alerts = (await h.alertRecords()).filter((r) => r.kind === "alert");
  const capped = alerts.filter((r) => r.suppressed === "cap");
  assert.ok(capped.some((r) => r.urgent === true), `an urgent hit is held for the batch; saw ${JSON.stringify(alerts.map((r) => [r.symbol, r.decision, r.urgent]))}`);
  const before = h.sent.length;
  h.wall.set("2026-11-30T14:59:58Z");
  await h.wall.advance(5_000);
  await until("the batch", () => h.sent.length === before + 1);
  assert.match(h.sent[before].text, /more alerts? suppressed/);
  assert.deepEqual(h.sent[before].opts, { kind: "urgent" }, "the batch carries an urgent hit");
  await h.watch.dispose();

  const late = await overLedger([{ ...orphan("a-loud", "2026-11-30T15:16:45.000Z"), urgent: true }]);
  await late.wall.advance(0);
  await until("the replay's record", async () => (await deliveredOf(late, "a-loud")).length === 1);
  assert.equal(late.sent.length, 1);
  assert.match(late.sent[0].text, /^late: /);
  assert.deepEqual(late.sent[0].opts, { kind: "urgent" }, "a late replay of an urgent hit goes as urgent");
  await late.watch.dispose();
});

test("an A-share move says annotation follows with a plan, and nothing follows without one", async () => {
  const h = await harness({
    start: "2026-12-01T02:03:00Z",
    files: { "desk/rules.yml": "- id: cn-plan\n  kind: move_pct\n  symbols: [\"600519\"]\n  move_pct: 4\n  plan: trim a third\n- id: cn-bare\n  kind: move_pct\n  symbols: [\"000001\"]\n  move_pct: 4\n" },
  });
  h.source.tables.cn.set("600519", cn(1400, "2026-12-01T02:02:58Z", "trading", 1400));
  h.source.tables.cn.set("000001", cn(10, "2026-12-01T02:02:58Z", "trading", 10));
  await h.wall.advance(0);
  await until("the first poll", () => h.source.calls.length === 1);
  h.source.tables.cn.set("600519", cn(1330, "2026-12-01T02:03:08Z", "trading", 1400));
  h.source.tables.cn.set("000001", cn(9.5, "2026-12-01T02:03:08Z", "trading", 10));
  await h.wall.advance(10_000);
  await until("two alerts", () => h.sent.length === 2);
  const last = (symbol: string): string | undefined => h.sent.find((x) => x.text.startsWith(`${symbol} `))?.text.split("\n").at(-1);
  assert.equal(last("600519"), "annotation follows");
  assert.equal(last("000001"), "day: -5.00% from the previous close 10");
  await h.watch.dispose();
});

test("a rule marked urgent sends urgent; a level and an unmarked rule send alert", async () => {
  const h = await harness({
    start: "2026-11-30T15:20:45Z",
    files: {
      "desk/levels.yml": level("NVDA", "stop", 170, "cross_down"),
      "desk/rules.yml": "- id: amd-move\n  kind: move_pct\n  symbols: [AMD]\n  move_pct: 4\n  urgent: true\n- id: intc-move\n  kind: move_pct\n  symbols: [INTC]\n  move_pct: 4\n",
    },
  });
  h.source.tables.us.set("NVDA", us(171, "2026-11-30T15:20:44Z", 172));
  h.source.tables.us.set("AMD", us(100, "2026-11-30T15:20:44Z", 100));
  h.source.tables.us.set("INTC", us(20, "2026-11-30T15:20:44Z", 20));
  await h.wall.advance(0);
  await until("the first poll", () => h.source.calls.length === 1);
  h.source.tables.us.set("NVDA", us(169, "2026-11-30T15:21:03Z", 172));
  h.source.tables.us.set("AMD", us(90, "2026-11-30T15:21:03Z", 100));
  h.source.tables.us.set("INTC", us(18, "2026-11-30T15:21:03Z", 20));
  await h.wall.advance(20_000);
  await until("three alerts", () => h.sent.length === 3);
  const kindOf = (symbol: string): string | undefined => h.sent.find((x) => x.text.startsWith(`${symbol} `))?.opts.kind;
  assert.deepEqual([kindOf("NVDA"), kindOf("AMD"), kindOf("INTC")], ["alert", "urgent", "alert"]);
  await until("three alert records", async () => (await h.alertRecords()).filter((r) => r.kind === "alert").length === 3);
  const alerts = (await h.alertRecords()).filter((r) => r.kind === "alert");
  assert.deepEqual(alerts.map((r) => [r.symbol, r.urgent]).sort(), [["AMD", true], ["INTC", undefined], ["NVDA", undefined]]);
  await h.watch.dispose();
});

test("the context's cut never splits a surrogate pair", () => {
  assert.equal(cutAt("abc", 4_000), "abc");
  assert.equal(cutAt("ab😀", 3), "ab", "the pair at the edge goes whole");
  assert.equal(cutAt("ab😀c", 4), "ab😀");
  assert.equal(cutAt("abcd", 3), "abc");
});

test("an orphan older than ten minutes is one line and a delivered record 'lost to a restart'", async () => {
  const h = await overLedger([orphan("a-old", "2026-11-30T14:50:45.000Z"), orphan("a-young", "2026-11-30T15:15:45.000Z")]);
  await h.wall.advance(0);
  await until("both records", async () => (await deliveredOf(h, "a-old")).length === 1 && (await deliveredOf(h, "a-young")).length === 1);
  assert.equal(h.sent.length, 2);
  assert.ok(h.sent[0].text.startsWith("late: the face restarted before this alert was sent (raised 10:15 ET)"), "the replay first");
  assert.equal(h.sent[1].text, "1 alert raised before a restart was never sent: NVDA stop 09:50 ET");
  const [d] = await deliveredOf(h, "a-old");
  assert.deepEqual(d.delivery, { undelivered: "lost to a restart" });
  assert.equal(d.replayed, undefined);
  assert.deepEqual(h.watch.status().recent.map((r) => [r.id, r.outcome]), [["a-young", "sent"], ["a-old", "undelivered"]]);
  await h.watch.dispose();
});

test("a replay while OFF is in force records deliver's answer and sends nothing else", async () => {
  const h = await overLedger([orphan("a-young", "2026-11-30T15:16:45.000Z")], { deliver: () => ({ undelivered: "paused" }) });
  await writeOff(h.home, { by: "terminal" }, () => h.wall.now());
  await h.wall.advance(0);
  await until("the replay's record", async () => (await deliveredOf(h, "a-young")).length === 1);
  const [d] = await deliveredOf(h, "a-young");
  assert.deepEqual([d.delivery, d.replayed], [{ undelivered: "paused" }, true]);
  await h.wall.advance(20_000);
  await until("the second poll", () => h.source.calls.length === 2);
  await h.wall.advance(0);
  assert.equal(h.sent.length, 1, "the held replay is the only text");
  assert.deepEqual(h.posts, []);
  await h.watch.dispose();
});

test("a later ledger read in the same run replays nothing", async () => {
  const h = await overLedger([orphan("a-young", "2026-11-30T15:16:45.000Z"), orphan("a-old", "2026-11-30T14:50:45.000Z")]);
  await h.wall.advance(0);
  await until("both records", async () => (await deliveredOf(h, "a-old")).length === 1 && (await deliveredOf(h, "a-young")).length === 1);
  for (let i = 2; i <= 4; i++) {
    await h.wall.advance(20_000);
    await until(`poll ${i}`, () => h.source.calls.length === i);
  }
  await h.wall.advance(0);
  assert.equal(h.sent.length, 2);
  assert.equal((await h.alertRecords()).filter((r) => r.kind === "delivered").length, 2);
  await h.watch.dispose();

  /* a restart over the same ledger: each orphan now has its delivered record */
  const again = await harness({ start: "2026-11-30T15:22:45Z", home: h.home, root: h.root, pid: 4343 });
  again.source.tables.us.set("NVDA", us(175, "2026-11-30T15:22:44Z"));
  await again.wall.advance(0);
  await until("the first poll", () => again.source.calls.length === 1);
  await again.wall.advance(0);
  assert.equal(again.sent.length, 0);
  assert.equal((await again.alertRecords()).filter((r) => r.kind === "delivered").length, 2);
  await again.watch.dispose();
});

/* ---------- the lease ---------- */

test("a stale lease is taken over: its pid gone, EPERM, or its beat two minutes old", async () => {
  assert.equal(pidAlive(1, () => { throw Object.assign(new Error("kill EPERM"), { code: "EPERM" }); }), false);
  assert.equal(pidAlive(1, () => { throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" }); }), false);
  assert.equal(pidAlive(1, () => true), true);
  for (const [label, lease, alive] of [
    ["pid gone", { pid: 999, beatAgo: 0 }, (p: number) => p === 4242],
    ["beat two minutes old", { pid: 999, beatAgo: LEASE_STALE_MS }, () => true],
  ] as const) {
    const h = await harness({ start: "2026-11-30T15:00:00Z", files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") }, alive });
    await mkdir(deskDir(h.home), { recursive: true });
    const beat = new Date(Date.parse("2026-11-30T15:00:00Z") - lease.beatAgo).toISOString();
    await writeFile(join(deskDir(h.home), WATCH_LEASE_FILE), JSON.stringify({ pid: lease.pid, since: beat, beat }));
    await h.wall.advance(0);
    assert.equal(h.watch.status().state, "watching", label);
    const held = JSON.parse(await readFile(join(deskDir(h.home), WATCH_LEASE_FILE), "utf8")) as { pid: number };
    assert.equal(held.pid, 4242, label);
    await h.watch.dispose();
    await assert.rejects(readFile(join(deskDir(h.home), WATCH_LEASE_FILE)), "released at dispose");
  }
});

test("a second watch on the same home stays off while the first face beats, and says so once", async () => {
  const files = { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") };
  const first = await harness({ start: "2026-11-30T15:00:00Z", files, pid: 11, alive: () => true });
  await first.wall.advance(0);
  assert.equal(first.watch.status().state, "watching");
  const second = await harness({ start: "", wall: first.wall, home: first.home, root: first.root, pid: 12, alive: () => true });
  await first.wall.advance(60_000);
  await until("the line", () => second.sent.length === 1);
  await first.wall.advance(60_000);
  const status = second.watch.status();
  assert.equal(status.state, "held-elsewhere");
  assert.equal(status.holder?.pid, 11);
  assert.deepEqual(second.sent.map((s) => s.text), ["this face does not watch: another face (pid 11) holds the watch on this home"]);
  assert.deepEqual(second.logs.filter((l) => l.includes("another face")), ["gravit-face: desk: another face (pid 11) runs the watch on this home; this one does not"]);
  assert.equal(second.source.calls.length, 0);
  const lease = JSON.parse(await readFile(join(deskDir(first.home), WATCH_LEASE_FILE), "utf8")) as { pid: number; beat: string };
  assert.equal(lease.pid, 11);
  assert.ok(Date.parse(lease.beat) >= Date.parse("2026-11-30T15:01:30Z"), "the first face beats");
  await second.watch.dispose();
  await first.watch.dispose();
});

test("two watches started together over a stale lease: one holds it, the other says held-elsewhere once", async () => {
  const files = { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") };
  const a = await harness({ start: "2026-11-30T15:00:00Z", files, pid: 11, alive: (p) => p === 11 || p === 12 });
  await mkdir(deskDir(a.home), { recursive: true });
  await writeFile(join(deskDir(a.home), WATCH_LEASE_FILE), JSON.stringify({ pid: 7, since: "2026-11-30T14:00:00Z", beat: "2026-11-30T14:59:50Z" }));
  const b = await harness({ start: "", wall: a.wall, home: a.home, root: a.root, pid: 12, alive: (p) => p === 11 || p === 12 });
  await Promise.all([a.watch.tick(), b.watch.tick()]);
  const states = [a.watch.status().state, b.watch.status().state].sort();
  assert.deepEqual(states, ["held-elsewhere", "watching"]);
  const loser = a.watch.status().state === "held-elsewhere" ? a : b;
  await Promise.all([a.watch.tick(), b.watch.tick()]);
  await until("the line", () => loser.sent.length === 1);
  await a.wall.advance(120_000);
  await Promise.all([a.watch.tick(), b.watch.tick()]);
  await a.wall.advance(0);
  assert.equal(loser.sent.length, 1, "no second held-elsewhere line");
  assert.match(loser.sent[0].text, /^this face does not watch: another face \(pid 1[12]\) holds the watch on this home$/);
  await a.watch.dispose();
  await b.watch.dispose();
});

/* ---------- the files ---------- */

test("levels.yml edited while the face runs is reloaded on the next tick; a broken edit keeps the last good load with one line", async () => {
  const four = ["NVDA", "AMD", "AAPL", "MSFT"].map((s) => level(s, "stop", 100, "cross_down")).join("");
  const h = await harness({ start: "2026-11-30T08:00:00Z", files: { "desk/levels.yml": four } });
  await h.wall.advance(0);
  assert.equal(h.sent.length, 0, "the boot's load is the baseline");
  assert.equal(h.watch.status().files.find((f) => f.file === "desk/levels.yml")?.entries, 4);
  const edited = ["NVDA", "AMD", "AAPL", "MSFT"].map((s) => level(s, "stop", 90, "cross_down")).join("");
  const path = join(h.root, "desk", "levels.yml");
  await writeFile(path, edited);
  await utimes(path, new Date(), new Date(Date.now() + 10_000));
  await h.wall.advance(5_000);
  await until("the changed line", () => h.sent.length === 1);
  assert.equal(h.sent[0].text, `desk/levels.yml changed (sha256 ${sha(edited).slice(0, 8)}): 4 loaded`);

  await writeFile(path, "- symbol: NVDA\n\tkind: stop\n");
  await utimes(path, new Date(), new Date(Date.now() + 20_000));
  await h.wall.advance(5_000);
  await h.wall.advance(5_000);
  await until("the refused line", () => h.sent.length === 2);
  assert.match(h.sent[1].text, /^desk\/levels\.yml is refused, so the watch keeps its last good load: /);
  const file = h.watch.status().files.find((f) => f.file === "desk/levels.yml");
  assert.equal(file?.entries, 4, "the last good load is kept");
  assert.ok(file?.error !== undefined);

  const demo = level("TSLA", "target", 400, "cross_up");
  await mkdir(join(h.root, "strategies", "demo"), { recursive: true });
  await writeFile(join(h.root, "strategies", "demo", "levels.yml"), demo);
  await h.wall.advance(5_000);
  await until("the strategy's line", () => h.sent.length === 3);
  assert.equal(h.sent[2].text, `strategies/demo/levels.yml changed (sha256 ${sha(demo).slice(0, 8)}): 1 loaded`);
  await h.watch.dispose();
  const loads = (await readEvents(h.home)).events.filter((e) => e.kind === "watch-load");
  assert.deepEqual(loads.map((e) => e.kind === "watch-load" && [e.file, e.loaded, e.error !== undefined]), [
    ["desk/levels.yml", 4, false], ["desk/levels.yml", 4, true], ["strategies/demo/levels.yml", 1, false],
  ]);
});

test("nothing to watch: no calendar ask, no poll, no line", async () => {
  const h = await harness({ start: "2026-11-30T15:00:00Z", files: { "desk/README.md": "nothing here\n" } });
  await h.wall.advance(0);
  await h.wall.advance(60_000);
  assert.equal(h.watch.status().state, "idle");
  assert.deepEqual([h.calendars.us.asked, h.calendars.cn.asked], [[], []]);
  assert.equal(h.source.calls.length, 0);
  assert.equal(h.sent.length, 0);
  assert.equal(await h.watch.stateText(), undefined);
  await h.watch.dispose();
});

/* ---------- the gates ---------- */

test("OFF and MUTE record suppressed and send nothing; a tick lifts an expired mute", async () => {
  const h = await harness({ start: "2026-11-30T15:20:45Z", files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") + level("AMD", "stop", 100, "cross_down") } });
  await writeOff(h.home, { by: "terminal" }, () => h.wall.now());
  h.source.tables.us.set("NVDA", us(169, "2026-11-30T15:20:44Z"));
  h.source.tables.us.set("AMD", us(101, "2026-11-30T15:20:44Z"));
  await h.wall.advance(0);
  await until("NVDA's record", async () => (await h.alertRecords()).some((r) => r.kind === "alert"));
  assert.equal((await h.alertRecords())[0].suppressed, "off");
  await rm(join(deskDir(h.home), "OFF"));
  await writeMute(h.home, { by: "telegram", until: Date.parse("2026-11-30T15:30:00Z") }, () => h.wall.now());
  h.source.tables.us.set("AMD", us(99, "2026-11-30T15:21:04Z"));
  await h.wall.advance(20_000);
  await until("AMD's record", async () => (await h.alertRecords()).filter((r) => r.kind === "alert").length === 2);
  assert.equal((await h.alertRecords()).filter((r) => r.kind === "alert")[1].suppressed, "muted");
  assert.equal(h.watch.status().muted?.by, "telegram");
  assert.equal(h.sent.length, 0);
  h.wall.set("2026-11-30T15:30:00Z");
  await h.wall.advance(5_000);
  await assert.rejects(readFile(join(deskDir(h.home), "MUTE")), "the expired mute is lifted");
  assert.ok((await readEvents(h.home)).events.some((e) => e.kind === "mute-cleared" && e.by === "expiry"));
  assert.equal(h.watch.status().muted, undefined);
  await h.watch.dispose();
});

test("a spent budget: the alert says so and is sent, and nothing is posted; a pass with no hit reads no budget", async () => {
  const h = await harness({
    start: "2026-11-30T15:20:45Z", files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") },
    budget: { dailyTokens: 10, used: { uncachedInputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, total: 10 }, spent: true },
  });
  h.source.tables.us.set("NVDA", us(171, "2026-11-30T15:20:44Z"));
  await h.wall.advance(0);
  await h.wall.advance(20_000);
  assert.equal(h.budgetCalls(), 0, "no hit, no budget read");
  h.source.tables.us.set("NVDA", us(169, "2026-11-30T15:21:20Z"));
  await h.wall.advance(20_000);
  await until("the alert", () => h.sent.length === 1);
  assert.ok(h.sent[0].text.endsWith("no annotation: the desk's token budget for today is spent"));
  assert.equal(h.budgetCalls(), 1);
  await h.wall.advance(5_000);
  assert.equal(h.posts.length, 0);
  await h.watch.dispose();
});

test("a refused annotation post sends its line once a day as a reply", async () => {
  const line = "the desk could not open a turn: the desk agent is busy";
  const h = await harness({
    start: "2026-11-30T15:20:45Z", files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") + level("AMD", "stop", 100, "cross_down") },
    post: () => ({ refused: "error", line }),
  });
  h.source.tables.us.set("NVDA", us(171, "2026-11-30T15:20:44Z"));
  h.source.tables.us.set("AMD", us(101, "2026-11-30T15:20:44Z"));
  await h.wall.advance(0);
  h.source.tables.us.set("NVDA", us(169, "2026-11-30T15:21:00Z"));
  await h.wall.advance(20_000);
  await until("the line", () => h.sent.length === 2);
  assert.deepEqual(h.sent[1], { text: line, opts: { kind: "alert", replyTo: "telegram:100" } });
  h.source.tables.us.set("AMD", us(99, "2026-11-30T15:21:20Z"));
  await h.wall.advance(20_000);
  await until("the second post", () => h.posts.length === 2);
  await until("its record", async () => (await h.alertRecords()).filter((r) => r.kind === "annotation").length === 2);
  await h.wall.advance(0);
  assert.equal(h.sent.length, 3, "the second alert, and no second line");
  const annotations = (await h.alertRecords()).filter((r) => r.kind === "annotation");
  assert.deepEqual(annotations.map((r) => [r.result, r.reason]), [["refused", "error"], ["refused", "error"]]);
  await h.watch.dispose();
});

/* ---------- the filings ---------- */

/** A fake SEC: NVDA's CIK, and its submissions from `filings`; `refuse` answers 403 to the submissions. */
function fakeSec(): { fetch: EdgarFetch; urls: string[]; filings: { accession: string; accepted: string; form?: string }[]; refuse: boolean } {
  const sec = {
    urls: [] as string[],
    filings: [] as { accession: string; accepted: string; form?: string }[],
    refuse: false,
    fetch: (async (url: string) => {
      sec.urls.push(url);
      if (url.endsWith("company_tickers.json")) return new Response(JSON.stringify({ 0: { cik_str: 1045810, ticker: "NVDA", title: "NVIDIA CORP" } }));
      if (sec.refuse) return new Response("no", { status: 403 });
      const f = sec.filings;
      return new Response(JSON.stringify({
        filings: {
          recent: {
            form: f.map((x) => x.form ?? "8-K"), filingDate: f.map((x) => x.accepted.slice(0, 10)), accessionNumber: f.map((x) => x.accession),
            acceptanceDateTime: f.map((x) => x.accepted), items: f.map(() => "2.02"), primaryDocument: f.map(() => "doc.htm"),
          },
        },
      }));
    }) as EdgarFetch,
  };
  return sec;
}

test("filings: no contact says so once; seeded silently; a new 8-K today alerts; one at 06:30 is suppressed window; all refused off until tomorrow", async () => {
  const files = {
    "desk/holdings.yml": "- symbol: NVDA\n  qty: 10\n  avg_cost: 100\n- symbol: \"600519\"\n  qty: 100\n  avg_cost: 1400\n",
    "desk/rules.yml": "- id: filing\n  kind: filing\n  symbols: holdings\n  forms: [8-K]\n",
  };
  const none = await harness({ start: "2026-11-30T14:00:00Z", files });
  await none.wall.advance(0);
  await none.wall.advance(10_000);
  await until("the line", () => none.sent.length === 1);
  assert.deepEqual(none.sent.map((s) => s.text), ["the watch's filings are off: set ALPHA_EDGAR_USER_AGENT to a contact email (SEC asks for one)"]);
  assert.deepEqual([none.watch.status().filings.state, none.watch.status().filings.symbols, none.watch.status().filings.aShares], ["no-contact", 1, 1]);
  await none.watch.dispose();

  const sec = fakeSec();
  sec.filings.push({ accession: "0001045810-26-000001", accepted: "2026-11-20T16:05:00.000Z" });
  const h = await harness({ start: "2026-11-30T14:00:00Z", files, edgar: { fetch: sec.fetch, userAgent: "ops@example.com" } });
  await h.wall.advance(0);
  await until("the seed", async () => {
    try {
      return (await readFile(join(deskDir(h.home), FILINGS_FILE), "utf8")).includes("seeded");
    } catch {
      return false;
    }
  });
  assert.equal(h.sent.length, 0, "seeded silently");
  assert.ok(sec.urls.every((u) => !u.includes("600519")), "an A share is never fetched");
  await until("the poll's end", () => h.watch.status().filings.seeded === 1 || h.watch.status().filings.lastPollAt !== undefined);
  sec.filings.unshift(
    { accession: "0001045810-26-000002", accepted: "2026-11-30T10:05:12.000Z" },
    { accession: "0001045810-26-000003", accepted: "2026-11-30T06:30:00.000Z" },
  );
  await h.wall.advance(300_000);
  await until("the alert", () => h.sent.length === 1, 10_000);
  assert.ok(h.sent[0].text.startsWith("NVDA 8-K · accepted 10:05:12 ET · filed 2026-11-30"), h.sent[0].text);
  await until("both records", async () => (await h.alertRecords()).filter((r) => r.kind === "alert").length === 2);
  const alerts = (await h.alertRecords()).filter((r) => r.kind === "alert");
  assert.deepEqual(alerts.map((r) => [r.decision, r.suppressed]), [["send", undefined], ["suppressed", "window"]]);

  sec.refuse = true;
  await h.wall.advance(300_000);
  await until("the refused line", () => h.sent.length === 2, 10_000);
  assert.equal(h.sent[1].text, "the watch's filings are off until tomorrow: SEC refused every request (refused: HTTP 403); check ALPHA_EDGAR_USER_AGENT");
  assert.equal(h.watch.status().filings.state, "refused-today");
  const asked = sec.urls.length;
  await h.wall.advance(600_000);
  assert.equal(sec.urls.length, asked, "no poll until tomorrow");
  await h.watch.dispose();
});

/* ---------- the ledger, the state, the marks ---------- */

test("an unreadable alerts.jsonl judges nothing and says why once", async () => {
  const h = await harness({ start: "2026-11-30T15:00:00Z", files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") } });
  await mkdir(join(deskDir(h.home), ALERTS_FILE), { recursive: true });
  h.source.tables.us.set("NVDA", us(169, "2026-11-30T14:59:59Z"));
  await h.wall.advance(0);
  await h.wall.advance(20_000);
  await until("the line", () => h.sent.length === 1);
  assert.deepEqual(h.sent.map((s) => s.text), [`the alert ledger ${join(deskDir(h.home), ALERTS_FILE)} cannot be read (EISDIR), so the watch sends nothing until it can`]);
  assert.equal(h.watch.status().ledgerError, "EISDIR");
  assert.equal(h.source.calls.length, 0, "nothing judged");
  await rm(join(deskDir(h.home), ALERTS_FILE), { recursive: true });
  await h.wall.advance(5_000);
  await until("the alert", () => h.sent.length === 2);
  assert.equal(h.watch.status().ledgerError, undefined);
  await h.watch.dispose();
});

test("stateText lists both markets' holdings, the levels within 2% and today's counts; a source slower than 3 s gives the counts without its prices", async () => {
  const h = await harness({
    start: "2026-11-30T08:00:00Z",
    files: {
      "desk/holdings.yml": "- symbol: NVDA\n  qty: 10\n  avg_cost: 100\n- symbol: \"600519\"\n  qty: 100\n  avg_cost: 1400\n",
      "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") + level("600519", "watch", 1400, "cross_down"),
    },
  });
  h.source.tables.us.set("NVDA", us(171, "2026-11-30T07:59:00Z", 170));
  h.source.tables.cn.set("600519", cn(1500, "2026-11-30T07:00:00Z", "closed"));
  await h.wall.advance(0);
  const view = JSON.parse((await h.watch.stateText()) ?? "null") as {
    holdings: { symbol: string; last: number | null; at: string | null }[]; near: { symbol: string; distancePct: number }[]; alerts: unknown; prices?: string;
  };
  assert.deepEqual(view.holdings.map((x) => [x.symbol, x.last]), [["NVDA", 171], ["600519", 1500]]);
  assert.equal(view.holdings[0].at, "ROBINHOOD 02:59:00 ET");
  assert.deepEqual(view.near.map((x) => [x.symbol, x.distancePct]), [["NVDA", -0.58]]);
  assert.deepEqual(view.alerts, { sent: 0, suppressed: 0 });
  assert.equal(view.prices, undefined);
  assert.equal(h.source.calls.length, 2, "one snapshot per market");

  h.source.hold = new Promise<void>(() => {});
  const late = h.watch.stateText();
  await h.wall.advance(3_000);
  const slow = JSON.parse((await late) ?? "null") as typeof view;
  assert.deepEqual(slow.holdings.map((x) => x.last), [null, null]);
  assert.equal(slow.prices, "US unavailable: it did not answer in 3 s; A-share unavailable: it did not answer in 3 s");
  assert.deepEqual(slow.alerts, { sent: 0, suppressed: 0 });
  h.source.hold = undefined;
  await h.watch.dispose();
});

test("status carries marks nearest first, at most 100, for the Markets rows", async () => {
  const names = Array.from({ length: 105 }, (_, i) => `M${i}`);
  const files: Record<string, string> = {};
  for (const [i, file] of ["desk/levels.yml", "strategies/a/levels.yml", "strategies/b/levels.yml"].entries()) {
    files[file] = names.slice(i * 40, i * 40 + 40).map((s, j) => level(s, "watch", 100 + (i * 40 + j) * 0.5, "cross_up")).join("");
  }
  const h = await harness({ start: "2026-11-30T15:00:00Z", files });
  for (const s of names) h.source.tables.us.set(s, us(100, "2026-11-30T14:59:59Z"));
  await h.wall.advance(0);
  await until("the poll", () => h.source.calls.length === 1);
  await h.wall.advance(0);
  const marks = h.watch.status().marks;
  assert.equal(marks.length, MARKS_MAX);
  assert.deepEqual([marks[0].symbol, marks[0].distancePct], ["M0", 0]);
  const priced = marks.filter((m) => m.distancePct !== null);
  assert.equal(priced.length, WATCH_US_MAX, "only the polled symbols are priced");
  for (let i = 1; i < priced.length; i++) assert.ok(Math.abs(priced[i].distancePct ?? 0) >= Math.abs(priced[i - 1].distancePct ?? 0));
  assert.ok(marks.slice(priced.length).every((m) => m.distancePct === null), "the unpriced last");
  await h.watch.dispose();
});

/* ---------- the T9 review's hardening round ---------- */

test("a face held elsewhere with nothing to watch sends no line; once the book names something it says so once", async () => {
  const first = await harness({ start: "2026-11-30T15:00:00Z", files: { "desk/README.md": "empty\n" }, pid: 11, alive: () => true });
  await first.wall.advance(0);
  const second = await harness({ start: "", wall: first.wall, home: first.home, root: first.root, pid: 12, alive: () => true });
  await first.wall.advance(30_000);
  assert.equal(second.watch.status().state, "held-elsewhere");
  assert.equal(second.sent.length, 0, "nothing to watch: no line");
  await writeFile(join(first.root, "desk", "levels.yml"), level("NVDA", "stop", 170, "cross_down"));
  await first.wall.advance(5_000);
  await until("the line", () => second.sent.length === 1);
  await first.wall.advance(30_000);
  assert.deepEqual(second.sent.map((x) => x.text), ["this face does not watch: another face (pid 11) holds the watch on this home"]);
  await second.watch.dispose();
  await first.watch.dispose();
});

test("an A-share calendar that fails inside the table is one log line", async () => {
  const h = await harness({
    start: "2026-12-01T02:00:00Z", files: { "desk/levels.yml": level("600519", "watch", 1400, "cross_down") },
    calendars: { cn: fakeCalendar({}, "fake XSHG", (t) => bjDate(new Date(t))) },
  });
  await h.wall.advance(0);
  await h.wall.advance(20_000);
  assert.equal(h.watch.status().markets.cn.state, "no-calendar");
  assert.deepEqual(h.logs.filter((l) => l.includes("cn calendar")), ["gravit-face: desk: watch cn calendar: 2026-12-01: the fake calendar has no 2026-12-01"]);
  assert.deepEqual(h.sent, [], "no phone line: the table has no A-share calendar row");
  await h.watch.dispose();
});

test("the desk state asks each market at most its watch cap, a symbol past it priced from its last poll or counted", async () => {
  const names = Array.from({ length: 45 }, (_, i) => `A${i}`);
  const h = await harness({
    start: "2026-11-30T08:00:00Z",
    files: {
      "desk/levels.yml": names.slice(0, 40).map((x) => level(x, "watch", 10, "cross_down")).join(""),
      "strategies/demo/levels.yml": names.slice(40).map((x) => level(x, "watch", 10, "cross_down")).join(""),
    },
  });
  for (const x of names) h.source.tables.us.set(x, us(20, "2026-11-30T07:59:00Z"));
  await h.wall.advance(0);
  const view = JSON.parse((await h.watch.stateText()) ?? "null") as { prices?: string };
  assert.deepEqual(h.source.calls.map((c) => c.ids.length), [WATCH_US_MAX]);
  assert.equal(view.prices, "5 US symbols past the cap of 40 not priced");
  await h.watch.dispose();
});

/** Holdings NVDA, a filing rule on holdings, SEC listing NVDA. */
const FILING_FILES = {
  "desk/holdings.yml": "- symbol: NVDA\n  qty: 10\n  avg_cost: 100\n",
  "desk/rules.yml": "- id: filing\n  kind: filing\n  symbols: holdings\n  forms: [8-K]\n",
};
const decisions = async (h: Harness): Promise<unknown[][]> =>
  (await h.alertRecords()).filter((r) => r.kind === "alert").map((r) => [r.decision, r.suppressed]);

test("a filing suppressed window starts no cooldown, live or rebuilt from the ledger", async () => {
  const sec = fakeSec();
  const live = await harness({ start: "2026-11-30T14:00:00Z", files: FILING_FILES, edgar: { fetch: sec.fetch, userAgent: "ops@example.com" } });
  await live.wall.advance(0);
  await until("the seed", async () => {
    try {
      return (await readFile(join(deskDir(live.home), FILINGS_FILE), "utf8")).includes("seeded");
    } catch {
      return false;
    }
  }, 10_000);
  sec.filings.push({ accession: "0001045810-26-000010", accepted: "2026-11-30T06:50:00.000Z" }, { accession: "0001045810-26-000011", accepted: "2026-11-30T07:10:00.000Z" });
  await live.wall.advance(300_000);
  await until("both records", async () => (await decisions(live)).length === 2, 10_000);
  assert.deepEqual(await decisions(live), [["suppressed", "window"], ["send", undefined]]);
  await live.watch.dispose();

  const sec2 = fakeSec();
  sec2.filings.push({ accession: "0001045810-26-000011", accepted: "2026-11-30T07:10:00.000Z" });
  const base = join(TMP, `case-${++cases}`);
  const home = join(base, "home");
  await mkdir(deskDir(home), { recursive: true });
  await writeFile(join(deskDir(home), FILINGS_FILE), `${JSON.stringify({ t: "2026-11-30T13:50:00.000Z", kind: "seeded", symbol: "NVDA", accessions: [] })}\n`);
  await writeFile(join(deskDir(home), ALERTS_FILE), `${JSON.stringify({
    t: "2026-11-30T13:55:00.000Z", kind: "alert", id: "a-000000000001", pass: "p-000000000001", date: "2026-11-30", key: "filing:filing:NVDA", market: "us",
    symbol: "NVDA", label: "8-K", gap: false, quote: null, holding: null, plan: null, source: { file: "desk/rules.yml", index: 0 },
    decision: "suppressed", suppressed: "window", annotate: false,
    trigger: { type: "filing", rule: "filing", form: "8-K", accession: "0001045810-26-000010", accepted: null, filingDate: "2026-11-30", items: null, url: "u" },
  })}\n`);
  const rebuilt = await harness({ start: "2026-11-30T14:00:00Z", files: FILING_FILES, home, edgar: { fetch: sec2.fetch, userAgent: "ops@example.com" } });
  await rebuilt.wall.advance(0);
  await until("the alert", () => rebuilt.sent.length === 1, 10_000);
  assert.ok(rebuilt.sent[0].text.startsWith("NVDA 8-K · accepted 07:10:00 ET"));
  await rebuilt.watch.dispose();
});

test("no deliver goes out once dispose has begun", async () => {
  let release!: (r: DeliverResult) => void;
  const names = ["D0", "D1"];
  const h = await harness({
    start: "2026-11-30T15:00:00Z", files: { "desk/levels.yml": names.map((x) => level(x, "stop", 100, "cross_down")).join("") },
    deliver: (_text, n) => (n === 0 ? new Promise<DeliverResult>((done) => { release = done; }) : { sent: [`telegram:${100 + n}`] }),
  });
  for (const x of names) h.source.tables.us.set(x, us(90, "2026-11-30T14:59:59Z"));
  await h.wall.advance(0);
  await until("the first send", () => h.sent.length === 1);
  const disposed = h.watch.dispose();
  release({ sent: ["telegram:100"] });
  await disposed;
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(h.sent.length, 1, "the second alert is not delivered after dispose began");
  assert.deepEqual(h.posts, []);
  /* the send cut off by dispose is recorded undelivered, so it is not pending forever */
  const records = await h.alertRecords();
  const ids = Object.fromEntries(records.filter((r) => r.kind === "alert").map((r) => [r.symbol, r.id]));
  const deliveredOf = (id: unknown): unknown => records.find((r) => r.kind === "delivered" && r.id === id)?.delivery;
  assert.deepEqual(deliveredOf(ids.D0), { sent: ["telegram:100"] });
  assert.deepEqual(deliveredOf(ids.D1), { undelivered: "the face shut down" });
  assert.deepEqual(h.watch.status().recent.map((r) => [r.symbol, r.outcome]).sort(), [["D0", "sent"], ["D1", "undelivered"]]);
});

test("dispose waits at most 2 s for a hanging post, then releases the lease", async () => {
  const h = await harness({
    start: "2026-11-30T15:20:45Z", files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") },
    post: () => new Promise<PostResult>(() => {}),
  });
  h.source.tables.us.set("NVDA", us(169, "2026-11-30T15:20:44Z"));
  await h.wall.advance(0);
  await until("the post", () => h.posts.length === 1);
  const started = Date.now();
  const keep = setInterval(() => {}, 100); // the bound's own timer is unref'd: hold the loop open while it runs
  await h.watch.dispose();
  clearInterval(keep);
  const took = Date.now() - started;
  assert.ok(took >= 1_900 && took < 4_000, `dispose took ${took} ms`);
  assert.equal(h.watch.status().state, "stopped");
  await assert.rejects(readFile(join(deskDir(h.home), WATCH_LEASE_FILE)));
});

test("filings past 60 symbols poll the first 60 and name the rest once", async () => {
  const names = Array.from({ length: 61 }, (_, i) => `F${String(i).padStart(2, "0")}`);
  const sec = fakeSec();
  const h = await harness({
    start: "2026-11-30T14:00:00Z",
    files: {
      "desk/levels.yml": names.slice(0, 40).map((x) => level(x, "watch", 10, "cross_down")).join(""),
      "strategies/demo/levels.yml": names.slice(40).map((x) => level(x, "watch", 10, "cross_down")).join(""),
      "desk/rules.yml": "- id: filing\n  kind: filing\n  symbols: levels\n  forms: [8-K]\n",
    },
    edgar: { fetch: sec.fetch, userAgent: "ops@example.com" },
  });
  await h.wall.advance(0);
  await h.wall.advance(10_000);
  await until("the line", () => h.lines(/filings cover/).length === 1);
  await h.wall.advance(10_000);
  assert.deepEqual(h.lines(/filings cover/), ["the watch's filings cover 60 symbols; not polled: F60"]);
  assert.equal(h.watch.status().filings.symbols, 60);
  await h.watch.dispose();
});

test("a filings poll still running at 120 s is aborted", async () => {
  const fetch: EdgarFetch = (_url, init) => new Promise<Response>((_done, fail) => {
    init.signal.addEventListener("abort", () => { fail(init.signal.reason); });
  });
  const h = await harness({ start: "2026-11-30T14:00:00Z", files: FILING_FILES, edgar: { fetch, userAgent: "ops@example.com" } });
  await h.wall.advance(0);
  await h.wall.advance(119_000);
  assert.equal(h.watch.status().filings.lastError, undefined, "still under way");
  await h.wall.advance(1_000);
  await until("the abort", () => h.watch.status().filings.lastError !== undefined);
  assert.equal(h.watch.status().filings.lastError, "NVDA: the filings poll ran past 120 s");
  assert.equal(h.watch.status().filings.seeded, 0, "a failed symbol is not seeded");
  await h.watch.dispose();
});

test("a level that expires at the ET date change is refused with its line", async () => {
  const text = "- symbol: NVDA\n  kind: stop\n  price: 170\n  when: cross_down\n  plan: sell half\n  expires: 2026-11-30\n";
  const h = await harness({ start: "2026-12-01T01:30:00Z", files: { "desk/levels.yml": text } });
  await h.wall.advance(0);
  assert.equal(h.watch.status().files.find((f) => f.file === "desk/levels.yml")?.entries, 1);
  assert.equal(h.sent.length, 0);
  h.wall.set("2026-12-01T05:01:00Z");
  await h.wall.advance(5_000);
  await until("the line", () => h.sent.length === 1);
  assert.match(h.sent[0].text, /^desk\/levels\.yml: 0 loaded, 1 refused - #1 NVDA: .*2026-11-30/);
  assert.equal(h.watch.status().state, "idle", "nothing left to watch");
  await h.watch.dispose();
});

test("an edited plan keeps its level's cooldown", async () => {
  const h = await harness({ start: "2026-11-30T15:20:45Z", files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") } });
  h.source.tables.us.set("NVDA", us(171, "2026-11-30T15:20:44Z"));
  await h.wall.advance(0);
  h.source.tables.us.set("NVDA", us(169, "2026-11-30T15:21:00Z"));
  await h.wall.advance(20_000);
  await until("the alert", () => h.sent.length === 1);
  const path = join(h.root, "desk", "levels.yml");
  await writeFile(path, level("NVDA", "stop", 170, "cross_down").replace("plan for NVDA", "sell all of it"));
  await utimes(path, new Date(), new Date(Date.now() + 10_000));
  h.source.tables.us.set("NVDA", us(171, "2026-11-30T15:21:20Z"));
  await h.wall.advance(20_000);
  h.source.tables.us.set("NVDA", us(169, "2026-11-30T15:21:40Z"));
  await h.wall.advance(20_000);
  await until("the changed line", () => h.lines(/changed/).length === 1);
  await h.wall.advance(0);
  assert.equal(h.lines(/^NVDA/).length, 1, "the second crossing is inside the cooldown");
  assert.equal(h.watch.status().markets.us.today.repeats, 1);
  await h.watch.dispose();
});

/* ---------- the final review's fix wave ---------- */

/** chmod cannot shut root out, so the unwritable case is skipped when the suite runs as root. */
const AS_ROOT = process.getuid?.() === 0 ? "root writes past a mode of 500" : false;

test("a lease that cannot be written: the watch is off today, says so once, and polls nothing", { skip: AS_ROOT }, async () => {
  const home = join(TMP, "lease-unwritable", "home");
  await mkdir(deskDir(home), { recursive: true });
  await chmod(deskDir(home), 0o500);
  try {
    const h = await harness({ start: "2026-11-30T15:20:45Z", home, files: { "desk/levels.yml": level("NVDA", "stop", 170, "cross_down") } });
    h.source.tables.us.set("NVDA", us(169, "2026-11-30T15:20:44Z"));
    await h.wall.advance(0);
    await until("the line", () => h.sent.length === 1);
    await h.wall.advance(20_000);
    await h.wall.advance(20_000);
    assert.deepEqual(h.sent.map((x) => x.text), ["the watch is off today: its lease cannot be written (EACCES)"]);
    const status = h.watch.status();
    assert.equal(status.state, "lease-failed");
    assert.equal(status.leaseError, "EACCES");
    assert.equal(h.source.calls.length, 0, "no poll");
    assert.deepEqual(h.calendars.us.asked ?? [], []);
    await chmod(deskDir(home), 0o700);
    await h.wall.advance(20_000);
    await until("watching", () => h.watch.status().state === "watching");
    assert.equal(h.watch.status().leaseError, undefined);
    await h.watch.dispose();
  } finally {
    await chmod(deskDir(home), 0o700).catch(() => {});
  }
});

test("an idle watch still lifts an expired mute, and its status shows the mute until then", async () => {
  const h = await harness({ start: "2026-11-30T15:00:00Z", files: { "desk/README.md": "nothing here\n" } });
  await writeMute(h.home, { by: "telegram", until: Date.parse("2026-11-30T15:10:00Z") }, () => h.wall.now());
  await h.wall.advance(0);
  assert.equal(h.watch.status().state, "idle");
  assert.equal(h.watch.status().muted?.by, "telegram");
  h.wall.set("2026-11-30T15:10:00Z");
  await h.wall.advance(5_000);
  await assert.rejects(readFile(join(deskDir(h.home), "MUTE")), "the expired mute is lifted");
  assert.ok((await readEvents(h.home)).events.some((e) => e.kind === "mute-cleared" && e.by === "expiry"));
  assert.equal(h.watch.status().muted, undefined);
  assert.equal(h.sent.length, 0);
  await h.watch.dispose();
});
