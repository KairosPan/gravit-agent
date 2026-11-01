import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";

/** THE ACCOUNT'S PUSH CHANNEL, the page's end (ui/stream.js; feat/paper-live p1), run as the page runs it — a plain script in one global
 * scope — over a stand-in for the browser: a stand-in EventSource the test opens, fails and speaks through, timers the test fires by hand,
 * a clock it moves, and a tab it hides and shows. Without EventSource (as in every other page test) nothing is opened and the page goes on
 * by its polls; with one: one stream a tab, its events handed to whoever listens, a heartbeat that only keeps it alive, the tab hidden and
 * shown (opened again from the last id heard), a stream the browser gave up on opened again here (later each time), a silent one found
 * stale and then opened again, and the dot in the trading area's foot saying how it stands. */
const PUBLIC = fileURLToPath(new URL("../../src/portfolio/public/", import.meta.url));

/** a browser's EventSource as the stream uses one: the test opens it (open), speaks through it (say), and fails it (fail: closed, or
 * connecting again as a browser does by itself) */
class FakeES {
  static all: FakeES[] = [];
  readyState = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly heard = new Map<string, Array<(e: { data: string; lastEventId: string }) => void>>();
  constructor(readonly url: string) {
    FakeES.all.push(this);
  }
  addEventListener(type: string, fn: (e: { data: string; lastEventId: string }) => void) {
    this.heard.set(type, [...(this.heard.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  say(type: string, data: unknown, id = "") {
    for (const fn of this.heard.get(type) ?? []) fn({ data: typeof data === "string" ? data : JSON.stringify(data), lastEventId: id });
  }
  fail(closed: boolean) {
    this.readyState = closed ? 2 : 0;
    this.onerror?.();
  }
}

/** `posted`: what the page posts (the markets it follows) is kept — and answered as `reply` says (a promise the test settles, or a value),
 * or never */
function page({ eventSource = true, posted, reply }: { eventSource?: boolean; posted?: Array<{ url: string; body: unknown }>; reply?: () => unknown } = {}) {
  FakeES.all = [];
  let now = 1_791_484_300_000;
  const timers: Array<{ fn: () => void; ms: number; every: boolean; gone: boolean }> = [];
  const heard: Record<string, Array<() => void>> = {};
  const dots = [{ dataset: {} as Record<string, string>, textContent: "", title: "", setAttribute(k: string, v: string) {
    (this as unknown as Record<string, string>)[k] = v;
  } }];
  const doc = { hidden: false, addEventListener: (type: string, fn: () => void) => void (heard[type] ||= []).push(fn), querySelectorAll: (sel: string) => (sel === "[data-st-dot]" ? dots : []) };
  const RealDate = Date;
  class Clock extends RealDate {
    static override now() {
      return now;
    }
  }
  const sandbox: Record<string, unknown> = {
    document: doc,
    // a listener's fault is said on the console: kept quiet here
    console: { ...console, error() {} },
    Date: Clock,
    encodeURIComponent,
    setTimeout: (fn: () => void, ms: number) => timers.push({ fn, ms, every: false, gone: false }),
    clearTimeout: (id: number) => void (timers[id - 1] && (timers[id - 1]!.gone = true)),
    setInterval: (fn: () => void, ms: number) => timers.push({ fn, ms, every: true, gone: false }),
    clearInterval: (id: number) => void (timers[id - 1] && (timers[id - 1]!.gone = true)),
    ...(eventSource ? { EventSource: FakeES } : {}),
    // what the page posts (the markets it follows), kept; answered as the test says, else never
    ...(posted ? { fetch: (url: string, init: { body: string }) => (posted.push({ url, body: JSON.parse(init.body) }), reply ? reply() : new Promise(() => {})) } : {}),
  };
  const ctx = createContext(sandbox);
  new Script(readFileSync(join(PUBLIC, "ui/stream.js"), "utf8"), { filename: "/ui/stream.js" }).runInContext(ctx);
  const run = <T = unknown>(code: string): T => runInContext(code, ctx) as T;
  return {
    run,
    out: <T = unknown>(code: string): T => JSON.parse(run<string>(`JSON.stringify(${code})`)) as T,
    es: () => FakeES.all.at(-1)!,
    all: () => FakeES.all,
    dot: () => dots[0]!,
    advance: (ms: number) => void (now += ms),
    /** the timers waiting now (each a one-shot not yet run, or an interval not cleared) */
    waiting: () => timers.filter((t) => !t.gone),
    /** one-shot timers run (and gone); intervals ticked once */
    fire: () => {
      for (const t of timers.filter((x) => !x.gone)) {
        if (!t.every) t.gone = true;
        t.fn();
      }
    },
    tab: (hidden: boolean) => {
      doc.hidden = hidden;
      for (const fn of heard.visibilitychange ?? []) fn();
    },
  };
}

describe("ui/stream.js", () => {
  it("without EventSource opens nothing: the health is down, the dot says the page reads the account by its polls, and listeners are still taken", () => {
    const p = page({ eventSource: false });
    p.run("var GOT = []; stOn('order', (d) => GOT.push(d)); stStart(); stDot()");
    expect(p.run("stHealth()")).toBe("down");
    expect(p.dot().textContent).toBe("Polling");
    expect(p.dot().title).toBe("This browser has no event streams: the page reads the account every few seconds instead.");
    expect(p.waiting()).toEqual([]);
  });

  it("opens one stream a tab once started, connected when it opens; hands each event to its listeners and to \"*\", parsed, and keeps its id; a heartbeat only keeps it alive; a listener that throws stops no other", () => {
    const p = page();
    p.run("var GOT = []; var ALL = []; stOn('fill', (d, t) => GOT.push([t, d])); stOn('*', (d, t) => ALL.push(t)); stOn('health', (h) => ALL.push('health:' + h))");
    expect(p.all()).toHaveLength(0);
    p.run("stStart(); stStart()");
    // the tab names itself on its stream (feat/paper-live p2: the markets it follows are this name's)
    expect(p.all().map((e) => e.url)).toEqual([expect.stringMatching(/^\/api\/account\/stream\?client=tab-[a-z0-9]+$/)]);
    expect(p.run("stHealth()")).toBe("down");
    p.es().open();
    expect(p.run("stHealth()")).toBe("connected");
    expect(p.dot()).toMatchObject({ textContent: "Live", dataset: { st: "connected" } });
    p.run("stOn('fill', () => { throw new Error('a broken listener') })");
    p.es().say("fill", { qty: 0.01, price: 60010 }, "ab12cd34.7");
    p.es().say("order", { id: "ord-0001" }, "ab12cd34.8");
    p.es().say("hb", { at: 1 });
    // a frame that is not JSON is no event
    p.es().say("order", "not json", "ab12cd34.9");
    expect(p.out("GOT")).toEqual([["fill", { qty: 0.01, price: 60010 }]]);
    expect(p.out("ALL")).toEqual(["health:connected", "fill", "order"]);
    expect(p.run("STREAM.lastId")).toBe("ab12cd34.9");
    // every event the account sends is heard by name (a browser hands a named event only to a listener for that name)
    expect([...p.es().heard.keys()].sort()).toEqual(["balance", "book", "card", "desk", "fill", "hb", "order", "paper", "position", "quote", "snapshot", "statement", "trades"]);
  });

  it("closes the stream while the tab is hidden, and opens it again when it shows, naming the last id it heard", () => {
    const p = page();
    p.run("stStart()");
    p.es().open();
    p.es().say("order", { id: "ord-0001" }, "ab12cd34.12");
    const first = p.es();
    p.tab(true);
    expect([first.closed, p.run("stHealth()")]).toEqual([true, "down"]);
    expect(p.dot().title).toContain("The tab is hidden");
    // nothing heard after it was let go is handed on
    p.run("var GOT = []; stOn('order', (d) => GOT.push(d))");
    first.say("order", { id: "late" }, "ab12cd34.13");
    expect(p.out("GOT")).toEqual([]);
    p.tab(false);
    expect(p.all()).toHaveLength(2);
    expect(p.es().url).toMatch(/^\/api\/account\/stream\?since=ab12cd34\.12&client=tab-[a-z0-9]+$/);
    p.es().open();
    expect(p.run("stHealth()")).toBe("connected");
  });

  it("leaves a drop the browser asks again for by itself to the browser; opens one it gave up on (a 503) again here — after a second, then 2, 5, 10 and 30 — and back to a second once one opens", () => {
    const p = page();
    p.run("stStart()");
    p.es().open();
    p.es().fail(false);
    expect([p.run("stHealth()"), p.all().length]).toEqual(["down", 1]);
    p.es().open();
    expect(p.run("stHealth()")).toBe("connected");
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      p.es().fail(true);
      expect(p.run("stHealth()")).toBe("down");
      const retry = p.waiting().filter((t) => !t.every);
      expect(retry).toHaveLength(1);
      waits.push(retry[0]!.ms);
      p.fire();
    }
    expect(waits).toEqual([1_000, 2_000, 5_000, 10_000, 30_000, 30_000]);
    expect(p.all()).toHaveLength(7);
    p.es().open();
    p.es().fail(true);
    expect(p.waiting().filter((t) => !t.every)[0]!.ms).toBe(1_000);
  });

  it("finds a stream that says nothing stale after 20 seconds (a heartbeat comes every 15), and after 45 lets it go and opens another from the last id it heard", () => {
    const p = page();
    p.run("stStart()");
    p.es().open();
    p.es().say("paper", { venue: "paper-1" }, "ab12cd34.3");
    p.advance(15_000);
    p.fire();
    expect(p.run("stHealth()")).toBe("connected");
    p.advance(6_000);
    p.fire();
    expect(p.run("stHealth()")).toBe("stale");
    expect(p.dot()).toMatchObject({ textContent: "Quiet", dataset: { st: "stale" } });
    // a heartbeat: alive again
    p.es().say("hb", { at: 2 });
    expect(p.run("stHealth()")).toBe("connected");
    p.advance(46_000);
    const silent = p.es();
    p.fire();
    expect(silent.closed).toBe(true);
    expect(p.all()).toHaveLength(2);
    expect(p.es().url).toMatch(/^\/api\/account\/stream\?since=ab12cd34\.3&client=tab-[a-z0-9]+$/);
  });

  it("says which markets the tab shows (stFollow) once its stream is open — under the tab's own name — again on each stream it opens, and only when they change", () => {
    const posted: Array<{ url: string; body: unknown }> = [];
    const p = page({ posted });
    p.run("stStart()");
    // nothing is open yet: kept, said once it opens
    p.run("stFollow(['paper-1:BTC/USD', 'paper-1:BTC/USD', 'no-colon'])");
    expect(posted).toEqual([]);
    p.es().open();
    const client = p.run<string>("ST_CLIENT");
    expect(client).toMatch(/^tab-[a-z0-9]+$/);
    expect(p.es().url).toContain(`client=${client}`);
    // each telling numbered, one more than the last (the account takes the latest it has heard)
    expect(posted).toEqual([{ url: "/api/account/stream/markets", body: { client, markets: ["paper-1:BTC/USD"], n: 1 } }]);
    // the same again: nothing new; another market: said
    p.run("stFollow(['paper-1:BTC/USD'])");
    p.run("stFollow(['paper-1:ETH-PERP'])");
    expect(posted.map((x) => (x.body as { markets: string[] }).markets)).toEqual([["paper-1:BTC/USD"], ["paper-1:ETH-PERP"]]);
    // the tab hidden and shown: a new stream, the same name, its markets said again
    p.tab(true);
    p.tab(false);
    p.es().open();
    expect(posted.at(-1)).toEqual({ url: "/api/account/stream/markets", body: { client, markets: ["paper-1:ETH-PERP"], n: 3 } });
    // none shown any more
    p.run("stFollow([])");
    expect(posted.at(-1)!.body).toEqual({ client, markets: [], n: 4 });
    // and a stream that opens while it shows none says so too: the account may have carried the last stream's markets over to it
    p.es().fail(false);
    p.es().open();
    expect(posted.at(-1)!.body).toEqual({ client, markets: [], n: 5 });
  });

  it("says a telling the account did not take once more a second later — only while that stream is open and nothing newer was said — and never again after that", async () => {
    const posted: Array<{ url: string; body: unknown }> = [];
    let answer: () => unknown = () => Promise.reject(new Error("the account is not answering"));
    const p = page({ posted, reply: () => answer() });
    const flush = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };
    p.run("stStart()");
    p.es().open();
    // the telling as the stream opened was not taken either — but a newer one was said at once after it: only that one is said again
    p.run("stFollow(['paper-1:BTC/USD'])");
    await flush();
    const again = () => p.waiting().filter((t) => !t.every && t.ms === 1_000);
    expect(again()).toHaveLength(1);
    // the second try refused too (a 404: the account does not know the stream yet): not said a third time
    answer = () => ({ ok: false, status: 404 });
    p.fire();
    expect(posted.map((x) => (x.body as { n: number }).n)).toEqual([1, 2, 3]);
    expect(posted.at(-1)!.body).toMatchObject({ markets: ["paper-1:BTC/USD"] });
    await flush();
    expect(again()).toHaveLength(0);
    // a refused telling with a newer one said meanwhile is not said again: the newer stands, and is the one said again
    answer = () => Promise.reject(new Error("no answer"));
    p.run("stFollow(['paper-1:ETH/USD'])");
    p.run("stFollow(['paper-1:SOL/USD'])");
    await flush();
    expect(again()).toHaveLength(1);
    p.fire();
    expect((posted.at(-1)!.body as { markets: string[] }).markets).toEqual(["paper-1:SOL/USD"]);
    expect(posted).toHaveLength(6);
    await flush();
    // one the account took: nothing more
    answer = () => ({ ok: true, status: 200 });
    p.run("stFollow(['paper-1:XRP/USD'])");
    await flush();
    expect(again()).toHaveLength(0);
    // and one refused on a stream that has dropped since is not said again on it (the next stream says the list as it opens)
    answer = () => Promise.reject(new Error("no answer"));
    p.run("stFollow(['paper-1:ADA/USD'])");
    p.es().fail(false);
    await flush();
    expect(again()).toHaveLength(0);
  });
});

describe("ui/stream.js: the markets' pushed prices (feat/paper-live p2b)", () => {
  it("follows the markets shown whole and, with a ~ before each, the ones whose price alone is shown — none twice, none of its own making, sixteen in all", () => {
    const posted: Array<{ url: string; body: unknown }> = [];
    const p = page({ posted });
    p.run("stStart()");
    p.es().open();
    const client = p.run<string>("ST_CLIENT");
    p.run("stFollow(['paper-1:BTC/USD'], ['paper-1:ETH-PERP', 'paper-1:BTC/USD', '~paper-1:SOL/USD', 'no-colon', 'paper-1:ETH-PERP'])");
    expect(posted.at(-1)).toEqual({ url: "/api/account/stream/markets", body: { client, markets: ["paper-1:BTC/USD", "~paper-1:ETH-PERP"], n: 2 } });
    // the price-only ones go first past the cap
    p.run(`stFollow(['a:X'], ${JSON.stringify(Array.from({ length: 20 }, (_, i) => `b:M${i}`))})`);
    const markets = (posted.at(-1)!.body as { markets: string[] }).markets;
    expect(markets).toHaveLength(16);
    expect(markets[0]).toBe("a:X");
    expect(markets.slice(1).every((k) => k.startsWith("~b:"))).toBe(true);
  });

  it("keeps each followed market's latest pushed quote (stQuoteOf) — never an older seq over a newer, never one it does not follow, none while the stream is not connected, none after a snapshot or once unfollowed", () => {
    const p = page();
    p.run("stStart()");
    p.es().open();
    p.run("stFollow(['paper-1:BTC/USD'], ['paper-1:ETH-PERP'])");
    const q = (seq: number, bid: number, more: Record<string, unknown> = {}) => ({ key: "paper-1:BTC/USD", venue: "paper-1", symbol: "BTC/USD", bid, ask: bid + 1, last: bid + 0.5, at: "2026-10-16T12:00:00.000Z", seenAt: "2026-10-16T12:00:00.100Z", from: "Kraken · live", live: true, seq, ...more });
    p.es().say("quote", q(10, 60000), "r1.1");
    p.es().say("quote", q(9, 59000), "r1.2");
    expect(p.out("stQuoteOf('paper-1', 'BTC/USD')")).toMatchObject({ bid: 60000, seq: 10, gotAt: 1_791_484_300_000 });
    // the same message said again as the market stopped being live: kept (its word on being live is news)
    p.es().say("quote", q(10, 60000, { live: false }), "r1.3");
    expect(p.out("stQuoteOf('paper-1', 'BTC/USD').live")).toBe(false);
    // a market's price alone (followed with ~): kept under its own market
    p.es().say("quote", { key: "~paper-1:ETH-PERP", venue: "paper-1", symbol: "ETH-PERP", mark: 2500, at: "2026-10-16T12:00:00.000Z", live: true, seq: 11 }, "r1.4");
    expect(p.out("stQuoteOf('paper-1', 'ETH-PERP').mark")).toBe(2500);
    // a market it does not follow is not kept
    p.es().say("quote", { venue: "paper-1", symbol: "DOGE/USD", last: 0.1, live: true, seq: 12 }, "r1.5");
    expect(p.run("stQuoteOf('paper-1', 'DOGE/USD')")).toBeNull();
    // the stream not connected: no quote is anyone's to show — and what it pushed before it dropped is let go, so the stream the browser
    // opens again shows none until it pushes one itself (the account says each market again as that stream follows it)
    p.es().fail(false);
    expect(p.run("stQuoteOf('paper-1', 'ETH-PERP')")).toBeNull();
    p.es().open();
    expect(p.run("stQuoteOf('paper-1', 'ETH-PERP')")).toBeNull();
    expect(p.run("stQuoteOf('paper-1', 'BTC/USD')")).toBeNull();
    p.es().say("quote", { key: "~paper-1:ETH-PERP", venue: "paper-1", symbol: "ETH-PERP", mark: 2510, at: "2026-10-16T12:00:01.000Z", live: true, seq: 13 }, "r1.6");
    expect(p.out("stQuoteOf('paper-1', 'ETH-PERP').mark")).toBe(2510);
    // a stream the browser gave up on likewise
    p.es().fail(true);
    p.fire();
    p.es().open();
    expect(p.run("stQuoteOf('paper-1', 'ETH-PERP')")).toBeNull();
    p.es().say("quote", { key: "~paper-1:ETH-PERP", venue: "paper-1", symbol: "ETH-PERP", mark: 2500, at: "2026-10-16T12:00:02.000Z", live: true, seq: 14 }, "r1.7");
    expect(p.out("stQuoteOf('paper-1', 'ETH-PERP').mark")).toBe(2500);
    // unfollowed: gone; a snapshot (the account started again): every quote gone
    p.run("stFollow(['paper-1:BTC/USD'])");
    expect(p.run("stQuoteOf('paper-1', 'ETH-PERP')")).toBeNull();
    p.es().say("snapshot", { orders: [] }, "r2.0");
    expect(p.run("stQuoteOf('paper-1', 'BTC/USD')")).toBeNull();
    // a price, as the account prices one from its stream: a perpetual's middle, else its mark, else its last; a coin's last, else its middle
    expect(p.run("stPrice({ bid: 100, ask: 102, mark: 105, last: 99 }, true)")).toBe(101);
    expect(p.run("stPrice({ mark: 105, last: 99 }, true)")).toBe(105);
    expect(p.run("stPrice({ bid: 100, ask: 102, last: 99 }, false)")).toBe(99);
    expect(p.run("stPrice({ bid: 100, ask: 102 }, false)")).toBe(101);
    expect(p.run("stPrice({ bid: 103, ask: 102 }, false)")).toBeUndefined();
  });

  it("measures how long a pushed quote takes from its venue's own moment of its best bid and ask to the screen — once for each such moment, never a market's first, never a quote with no such moment, the last 64, the middle and the 95th — and logs nothing; the dot says it on hover", () => {
    const p = page();
    p.run("stStart()");
    p.es().open();
    // whatever the page would say on its console, kept: nothing is
    p.run("globalThis.__L = []; for (const k of ['log', 'info', 'debug', 'warn', 'error']) console[k] = (...a) => __L.push(a)");
    expect(p.run("stLag()")).toBeNull();
    const ago = (ms: number) => new Date(1_791_484_300_000 - ms).toISOString();
    const drawn = (q: Record<string, unknown>) => p.run(`stDrawn(${JSON.stringify({ venue: "paper-1", symbol: "BTC/USD", ...q })})`);
    // the market's first quote on the stream is the stream's word on it as it stands (its best bid and ask may be long settled): not counted
    drawn({ priceAt: ago(30_000), at: ago(10), seq: 1 });
    expect(p.run("stLag()")).toBeNull();
    // a quote whose venue stamped no moment on its best bid and ask (its `at` this machine's own then): not counted
    drawn({ at: ago(5), seq: 2 });
    expect(p.run("stLag()")).toBeNull();
    // each new moment of them, as each quote carrying it is drawn: oldest of the hundred first, each a millisecond newer
    for (let i = 0; i < 100; i++) drawn({ priceAt: ago(300 - i), at: ago(10), seq: 3 + i });
    // the same moment drawn again (the bar and the chart both), or a quote a mark or a trade sent with the same best bid and ask: counted once
    drawn({ priceAt: ago(201), at: ago(1), seq: 200 });
    // and one older than the last counted: never
    drawn({ priceAt: ago(250), seq: 201 });
    const lag = p.out<{ n: number; p50: number; p95: number; last: number }>("stLag()");
    expect(lag.n).toBe(64);
    expect(lag.last).toBe(201);
    expect(lag.p50).toBe(233);
    expect(lag.p95).toBe(261);
    // a clock a little behind the venue's never says less than nothing
    drawn({ symbol: "ETH/USD", priceAt: ago(1000), seq: 1 });
    drawn({ symbol: "ETH/USD", priceAt: ago(-40), seq: 2 });
    expect(p.out<{ last: number }>("stLag()").last).toBe(0);
    // the stream drops: each market's next quote is its first again
    p.es().fail(false);
    p.es().open();
    drawn({ priceAt: ago(20), seq: 300 });
    expect(p.out<{ last: number }>("stLag()").last).toBe(0);
    drawn({ priceAt: ago(15), seq: 301 });
    expect(p.out<{ last: number }>("stLag()").last).toBe(15);
    expect(p.run("__L.length")).toBe(0);
    p.run("stDot()");
    expect(p.dot().title).toMatch(/^Account updates arrive as they happen: orders, fills, positions, balances\. The prices pushed reach this screen about \d+ ms after their venue's own moment \(the middle of the last 64; 95 in 100 within \d+ ms\)\.$/);
  });
});
