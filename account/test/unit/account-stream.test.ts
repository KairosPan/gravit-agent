import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { request, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import type { Outcome } from "../../src/portfolio/account/exchange.ts";
import { signAgent, signOwner, simKey, type AgentAction, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { ACCOUNT_EVENTS, AccountStream, COALESCE_MS, STREAM_ID } from "../../src/portfolio/account/stream.ts";
import { register, type LiveDeps } from "../../src/portfolio/live/index.ts";
import type { Listing, PublicSource } from "../../src/portfolio/live/public-markets.ts";
import type { LiveTrader, Market, OrderState } from "../../src/portfolio/live/trade.ts";
import { startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";
import { HUB_URLS, joinHubs, StreamHub, type MarketHub, type WebSocketLike } from "../../src/portfolio/live/stream-hub.ts";
import { usClock, usSessionFull } from "../../src/portfolio/account/calendar.ts";
import { CBOE_DELAY_MS, CBOE_FROM } from "../../src/portfolio/live/public-stocks.ts";
import { ROBINHOOD_FROM, ROBINHOOD_PRICES, usQuote, UsQuoteFeed } from "../../src/portfolio/live/us-quotes.ts";

/** THE ACCOUNT'S PUSH CHANNEL (account/stream.ts, GET /api/account/stream; feat/paper-live p1). The bus on its own, over a stand-in for a
 * page's socket: nothing kept before a page listens, a snapshot to start, the account events at once with ids that rise, a resume from the
 * ring (or a snapshot past it, from another run, or for an id that is none), the market's events coalesced per market and never resumed, a
 * slow page held to the latest of each market and a bounded list of account events — sent in the order they were emitted — the heartbeat,
 * the room, and end(). Then the route on a real server, behind the same guard as every route: what a paper account's book tells reaching
 * the page as it happens (the owner's own order, a background look's fill), a page that comes back resuming where it stopped, 503 past the
 * room, and close() ending every stream so the server (and vitest) is never held open. Nothing leaves the process. */

/** a page's socket as the bus writes to it: what was written, whether it takes the next frame at once (accept: false makes the page slow
 * until "drain"), and its end */
class FakeRes extends EventEmitter {
  head: { status: number; headers: Record<string, string> } | undefined;
  readonly chunks: string[] = [];
  ended = false;
  accept = true;
  writeHead(status: number, headers: Record<string, string>): this {
    this.head = { status, headers };
    return this;
  }
  write(text: string): boolean {
    this.chunks.push(text);
    return this.accept;
  }
  end(): void {
    this.ended = true;
    this.emit("close");
  }
  get text(): string {
    return this.chunks.join("");
  }
}
const fakeReq = () => ({ socket: { setNoDelay() {} } }) as unknown as IncomingMessage;
/** a page's stream; `client` its own name, and `follows` the markets it shows (their quote, book and trades reach it only then) */
const attach = (s: AccountStream, last = "", client = "", follows: string[] = []) => {
  const res = new FakeRes();
  s.attach(fakeReq(), res as unknown as ServerResponse, last, client);
  if (follows.length) s.follow(client, follows);
  return res;
};

interface Frame {
  id?: string;
  event?: string;
  data?: unknown;
  retry?: number;
  comment?: string;
}
/** the frames in what was written, each block a frame (only whole ones: a block still being written is not one yet) */
function framesOf(text: string): Frame[] {
  const blocks = text.split("\n\n");
  blocks.pop();
  return blocks.filter(Boolean).map((block) => {
    const f: Frame = {};
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) {
        f.comment = line.slice(1).trim();
        continue;
      }
      const i = line.indexOf(": ");
      const k = line.slice(0, i);
      const v = line.slice(i + 2);
      if (k === "id") f.id = v;
      else if (k === "event") f.event = v;
      else if (k === "data") f.data = JSON.parse(v);
      else if (k === "retry") f.retry = Number(v);
    }
    return f;
  });
}
const seqOf = (f: Frame) => Number(STREAM_ID.exec(f.id ?? "")?.[2] ?? NaN);
const events = (r: FakeRes) => framesOf(r.text).filter((f) => f.event && f.event !== "hb");

afterEach(() => {
  vi.useRealTimers();
});

describe("the bus (account/stream.ts)", () => {
  it("keeps nothing before a page listens; a page's first stream is told to come back after a second and sent a snapshot under the seq the account stands at; then each account event at once, its id one more than the last", () => {
    const s = new AccountStream({ snapshot: () => ({ orders: [{ id: "ord-0001" }], paper: [] }), heartbeatMs: 0 });
    expect(ACCOUNT_EVENTS).toEqual(["order", "fill", "position", "balance", "paper", "statement", "card", "desk"]);
    expect(COALESCE_MS).toEqual({ quote: 100, trades: 100, book: 250 });
    s.emit("order", { id: "before anyone listened" });
    const a = attach(s);
    expect(a.head).toEqual({ status: 200, headers: expect.objectContaining({ "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" }) });
    const first = framesOf(a.text);
    expect(first[0]).toEqual({ retry: 1000 });
    expect(first[1]).toEqual({ id: `${s.run}.0`, event: "snapshot", data: { orders: [{ id: "ord-0001" }], paper: [], at: `${s.run}.0` } });
    expect(first).toHaveLength(2);
    s.emit("order", { id: "ord-0002" });
    s.emit("fill", { qty: 1 });
    // the desk is an account event: at once, and kept for a resume
    s.emit("desk", { seq: 7 });
    expect(events(a).slice(1).map((f) => [f.id, f.event, f.data])).toEqual([
      [`${s.run}.1`, "order", { id: "ord-0002" }],
      [`${s.run}.2`, "fill", { qty: 1 }],
      [`${s.run}.3`, "desk", { seq: 7 }],
    ]);
    expect(s.at).toBe(`${s.run}.3`);
    // the run is this process's own: lower-case hex, so an id from another run never matches it
    expect(s.run).toMatch(/^[0-9a-f]{8}$/);
  });

  it("a page that comes back is sent the account events after the one it heard, from the ring; an id the ring no longer reaches, one from another run, one from the future, or none: a snapshot", () => {
    const s = new AccountStream({ ringSize: 3, heartbeatMs: 0, snapshot: () => ({ orders: [] }) });
    attach(s);
    for (let i = 1; i <= 5; i++) s.emit("order", { n: i });
    const resumed = (last: string) => events(attach(s, last)).map((f) => (f.event === "snapshot" ? "snapshot" : (f.data as { n: number }).n));
    // the ring keeps the last three (3, 4, 5): from 4, only 5; from 2, every one it keeps
    expect(resumed(`${s.run}.4`)).toEqual([5]);
    expect(resumed(`${s.run}.2`)).toEqual([3, 4, 5]);
    expect(resumed(`${s.run}.5`)).toEqual([]);
    // from 1: event 2 is gone from the ring, so the page would miss it: a snapshot instead
    expect(resumed(`${s.run}.1`)).toEqual(["snapshot"]);
    expect(resumed("deadbeef.4")).toEqual(["snapshot"]);
    expect(resumed(`${s.run}.9`)).toEqual(["snapshot"]);
    expect(resumed("")).toEqual(["snapshot"]);
    // the snapshot stands at the seq the account stands at: a page resuming from it misses nothing after it
    const snap = events(attach(s, ""))[0]!;
    expect(snap.id).toBe(`${s.run}.5`);
  });

  it("coalesces a market's quotes to one a window — the first at once, the latest of the window at its end — each market apart, the book over 250 ms; never delays an account event, and never keeps a market's event for a resume", () => {
    vi.useFakeTimers();
    const s = new AccountStream({ heartbeatMs: 0 });
    const a = attach(s, "", "page-a-0001", ["kraken:BTC/USD", "kraken:ETH/USD"]);
    s.emit("quote", { p: 1 }, "kraken:BTC/USD");
    s.emit("quote", { p: 2 }, "kraken:BTC/USD");
    s.emit("quote", { p: 3 }, "kraken:BTC/USD");
    s.emit("quote", { p: 9 }, "kraken:ETH/USD");
    s.emit("order", { id: "ord-0001" });
    expect(events(a).slice(1).map((f) => [f.event, f.data])).toEqual([["quote", { p: 1 }], ["quote", { p: 9 }], ["order", { id: "ord-0001" }]]);
    vi.advanceTimersByTime(99);
    expect(events(a)).toHaveLength(4);
    vi.advanceTimersByTime(1);
    expect(events(a).slice(4).map((f) => [f.event, f.data])).toEqual([["quote", { p: 3 }]]);
    // the book's window is 250 ms
    s.emit("book", { b: 1 }, "kraken:BTC/USD");
    s.emit("book", { b: 2 }, "kraken:BTC/USD");
    vi.advanceTimersByTime(200);
    expect(events(a).filter((f) => f.event === "book").map((f) => f.data)).toEqual([{ b: 1 }]);
    vi.advanceTimersByTime(50);
    expect(events(a).filter((f) => f.event === "book").map((f) => f.data)).toEqual([{ b: 1 }, { b: 2 }]);
    // every id on the wire rises
    const ids = events(a).slice(1).map(seqOf);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    // a resume from the first id replays the account event alone: the market is read afresh
    const back = events(attach(s, `${s.run}.0`));
    expect(back.map((f) => f.event)).toEqual(["order"]);
  });

  it("a slow page is sent nothing until its socket drains, then what waited in the order it was emitted — the latest of each market among its account events, ids rising — and a snapshot when more waited than it keeps", () => {
    vi.useFakeTimers();
    const s = new AccountStream({ heartbeatMs: 0, maxBacklog: 2, snapshot: () => ({ orders: ["as now"] }) });
    const a = attach(s, "", "page-a-0001", ["kraken:BTC/USD"]);
    a.accept = false;
    s.emit("order", { id: "A" });
    const written = a.chunks.length;
    s.emit("quote", { q: 1 }, "kraken:BTC/USD");
    s.emit("order", { id: "B" });
    vi.advanceTimersByTime(100);
    s.emit("quote", { q: 2 }, "kraken:BTC/USD");
    s.emit("fill", { id: "C" });
    expect(a.chunks.length).toBe(written);
    a.accept = true;
    a.emit("drain");
    const after = framesOf(a.chunks.slice(written).join(""));
    // the first quote was let go for the second; B, the latest quote and C go out as they were emitted
    expect(after.map((f) => [f.event, f.data])).toEqual([["order", { id: "B" }], ["quote", { q: 2 }], ["fill", { id: "C" }]]);
    const ids = after.map(seqOf);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    // slow again, and more account events wait than the page may have waiting: they are let go, and it is sent a snapshot when it drains —
    // the snapshot alone, not the market's latest before it (a quote waited too)
    a.accept = false;
    s.emit("order", { id: "D" });
    const before = a.chunks.length;
    for (const id of ["E", "F", "G"]) s.emit("order", { id });
    vi.advanceTimersByTime(100);
    s.emit("quote", { q: 3 }, "kraken:BTC/USD");
    a.accept = true;
    a.emit("drain");
    const caught = framesOf(a.chunks.slice(before).join(""));
    expect(caught.map((f) => f.event)).toEqual(["snapshot"]);
    expect(caught[0]!.data).toEqual({ orders: ["as now"], at: s.at });
    expect(caught[0]!.id).toBe(s.at);
  });

  it("after an overflow the first frame a page hears on drain is the snapshot: a page whose stream drops right after it resumes from an id past nothing it missed — never from a market's frame past account events it was never sent", () => {
    vi.useFakeTimers();
    const s = new AccountStream({ heartbeatMs: 0, maxBacklog: 2, snapshot: () => ({ orders: ["as now"] }) });
    const a = attach(s, "", "page-a-0001", ["kraken:BTC/USD"]);
    a.accept = false;
    s.emit("order", { id: "lost-1" });
    for (const id of ["lost-2", "lost-3", "lost-4"]) s.emit("order", { id });
    vi.advanceTimersByTime(100);
    s.emit("quote", { q: 1 }, "kraken:BTC/USD");
    const before = a.chunks.length;
    a.accept = true;
    a.emit("drain");
    // the stream drops after the first frame written on drain: the page resumes from that frame's id
    const first = framesOf(a.chunks.slice(before).join(""))[0]!;
    expect(first.event).toBe("snapshot");
    const back = attach(s, first.id!);
    // nothing after the snapshot yet, and nothing it stands for is missing: the page read the account afresh with it
    expect(events(back)).toEqual([]);
    // what is emitted after it reaches the page that came back
    s.emit("order", { id: "after" });
    expect(events(back).map((f) => f.data)).toEqual([{ id: "after" }]);
  });

  it("sends a market's quote, book and trades only to the pages that follow it, tells the service what each page follows (and nothing once it goes), and carries a tab's markets over when it comes back under its own name", () => {
    vi.useFakeTimers();
    const told: Array<[string, string[]]> = [];
    const s = new AccountStream({ heartbeatMs: 0, onFollow: (client, keys) => told.push([client, keys]) });
    const a = attach(s, "", "page-a-0001");
    const b = attach(s, "", "page-b-0001");
    // a page with no name of its own is sent the account's events only
    const anon = attach(s);
    expect(s.follow("page-a-0001", ["paper-1:BTC/USD", "paper-1:BTC/USD", "no-colon", "x".repeat(200) + ":y"])).toEqual(["paper-1:BTC/USD"]);
    expect(s.follow("page-b-0001", ["paper-1:ETH/USD"])).toEqual(["paper-1:ETH/USD"]);
    expect(s.follow("nobody-0001", ["paper-1:BTC/USD"])).toBeUndefined();
    expect(told).toEqual([["page-a-0001", ["paper-1:BTC/USD"]], ["page-b-0001", ["paper-1:ETH/USD"]]]);
    // the same markets again: nothing new to tell
    s.follow("page-a-0001", ["paper-1:BTC/USD"]);
    expect(told).toHaveLength(2);
    s.emit("quote", { p: 1 }, "paper-1:BTC/USD");
    s.emit("book", { b: 1 }, "paper-1:ETH/USD");
    // a market nobody follows: nothing, not even a timer
    s.emit("trades", { t: 1 }, "paper-1:SOL/USD");
    s.emit("order", { id: "ord-0001" });
    expect(events(a).slice(1).map((f) => f.event)).toEqual(["quote", "order"]);
    expect(events(b).slice(1).map((f) => f.event)).toEqual(["book", "order"]);
    expect(events(anon).slice(1).map((f) => f.event)).toEqual(["order"]);
    expect([s.followed("paper-1:BTC/USD"), s.followed("paper-1:SOL/USD"), vi.getTimerCount()]).toEqual([true, false, 0]);
    expect(Object.fromEntries(s.following())).toEqual({ "paper-1:BTC/USD": 1, "paper-1:ETH/USD": 1 });
    // page A's tab comes back (its old stream not yet let go): the old one ends, and what it followed carries over without a word
    const a2 = attach(s, "", "page-a-0001");
    expect(a.ended).toBe(true);
    expect(told).toHaveLength(2);
    vi.advanceTimersByTime(100);
    s.emit("quote", { p: 2 }, "paper-1:BTC/USD");
    expect(events(a2).filter((f) => f.event === "quote").map((f) => f.data)).toEqual([{ p: 2 }]);
    // page B goes away: the service is told it follows nothing
    b.emit("close");
    expect(told.at(-1)).toEqual(["page-b-0001", []]);
    s.end();
    expect(told.at(-1)).toEqual(["page-a-0001", []]);
  });

  it("takes the latest telling of what a page follows however the tellings overtake each other (their numbers), and has the markets a tab carried over when it came back said to it again at once, after its stream's head (feat/paper-live p2b)", () => {
    vi.useFakeTimers();
    const told: Array<[string, string[]]> = [];
    const again: Array<[string, string[]]> = [];
    let s!: AccountStream;
    s = new AccountStream({ heartbeatMs: 0, onFollow: (client, keys) => told.push([client, keys]), onAgain: (client, keys) => {
      again.push([client, keys]);
      // the service says each market again as it stands now (service.ts pageAgain)
      for (const k of keys) s.emit("quote", { key: k, again: true }, k);
    } });
    const a = attach(s, "", "page-a-0001");
    // two said back to back, the later arriving first: the later stands, and the earlier is let be when it lands
    expect(s.follow("page-a-0001", ["paper-1:BTC/USD", "~paper-1:ETH/USD"], 3)).toEqual(["paper-1:BTC/USD", "~paper-1:ETH/USD"]);
    expect(s.follow("page-a-0001", ["paper-1:SOL/USD"], 2)).toEqual(["paper-1:BTC/USD", "~paper-1:ETH/USD"]);
    expect(s.follow("page-a-0001", ["paper-1:SOL/USD"], 3)).toEqual(["paper-1:BTC/USD", "~paper-1:ETH/USD"]);
    expect(told).toEqual([["page-a-0001", ["paper-1:BTC/USD", "~paper-1:ETH/USD"]]]);
    expect(again).toEqual([]);
    // the tab comes back under its name before its old stream was let go: what it followed carries over, its number with it — and those
    // markets are said to it again at once, after the new stream's head (the page let go of what its old stream pushed)
    const a2 = attach(s, "", "page-a-0001");
    expect(a.ended).toBe(true);
    expect(again).toEqual([["page-a-0001", ["paper-1:BTC/USD", "~paper-1:ETH/USD"]]]);
    expect(events(a2).map((f) => [f.event, (f.data as { key?: string }).key])).toEqual([["snapshot", undefined], ["quote", "paper-1:BTC/USD"], ["quote", "~paper-1:ETH/USD"]]);
    expect(told).toHaveLength(1);
    // a telling sent on the old stream still on its way is let be; the page's own on the new one is taken
    expect(s.follow("page-a-0001", ["paper-1:SOL/USD"], 2)).toEqual(["paper-1:BTC/USD", "~paper-1:ETH/USD"]);
    expect(s.follow("page-a-0001", [], 4)).toEqual([]);
    expect(told.at(-1)).toEqual(["page-a-0001", []]);
    // a tab that comes back following nothing has nothing said again; a page that names no number for its telling is taken as it comes
    attach(s, "", "page-a-0001");
    expect(again).toHaveLength(1);
    expect(s.follow("page-a-0001", ["paper-1:BTC/USD"])).toEqual(["paper-1:BTC/USD"]);
    s.end();
  });

  it("beats every heartbeat to each page that is not slow — a comment and an hb event with no id — and lets go of its clock with the last page; end() ends every stream and lets go of every timer", () => {
    vi.useFakeTimers();
    const s = new AccountStream({ heartbeatMs: 15_000, maxClients: 2 });
    const a = attach(s, "", "page-a-0001", ["x:y"]);
    const b = attach(s);
    expect([s.listening, s.room()]).toEqual([2, false]);
    b.accept = false;
    s.emit("order", { id: "ord-0001" });
    const bWas = b.chunks.length;
    vi.advanceTimersByTime(15_000);
    const beat = framesOf(a.text).filter((f) => f.event === "hb");
    expect(beat).toHaveLength(1);
    expect(beat[0]).toEqual({ comment: expect.stringMatching(/^hb \d+$/), event: "hb", data: { at: expect.any(Number) } });
    expect(beat[0]!.id).toBeUndefined();
    // the slow page is not beaten while it has not drained
    expect(b.chunks.length).toBe(bWas);
    // a page that goes away is let go at once; there is room again
    b.emit("close");
    expect([s.listening, s.room()]).toEqual([1, true]);
    // a market's event waiting for its window's end, then end(): every stream ended, nothing left on the clock
    s.emit("quote", { p: 1 }, "x:y");
    s.emit("quote", { p: 2 }, "x:y");
    s.end();
    expect([a.ended, s.listening, vi.getTimerCount()]).toEqual([true, 0, 0]);
  });
});

// ---- the route, on a real server ---------------------------------------------------------------------------------------------------

type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const START = Date.parse("2026-10-14T15:00:00Z");
const REAL = Date.parse("2026-10-14T15:00:00Z");
const owner = simKey("owner");
const homes: string[] = [];
const servers: PortfolioServerHandle[] = [];
afterAll(async () => {
  for (const s of servers) await s.close().catch(() => undefined);
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

/** a real account with a paper account on a stand-in public source (Kraken's BTC/USD, priced as the test says: the one listing object, moved in place, as a kept read holds it), served on 127.0.0.1 */
async function boot(o: { streams?: MarketHub; sources?: PublicSource[] } = {}) {
  const home = mkdtempSync(join(tmpdir(), "account-stream-"));
  homes.push(home);
  const btc: Listing = { symbol: "BTC/USD", name: "BTC market", kind: "spot", base: "BTC", quote: "USD", price: 60000, bid: 59990, ask: 60010, open: true, types: [], volumeUsd24h: 2e9 };
  const kraken: PublicSource = { id: "kraken", name: "Kraken", kind: "exchange", connectTo: "kraken", connector: "live:exchange:kraken", listings: async (q) => [btc].filter((m) => !q.q || m.base.includes(q.q.toUpperCase())) };
  const liveDeps: Partial<LiveDeps> = { clock: () => REAL, http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined };
  const svc = await PortfolioService.create({ home, now: () => new Date(START).toISOString(), venues: "frontline", real: true, liveDeps, publicMarkets: [kraken, ...(o.sources ?? [])], liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date(START).toISOString() }] }, ...(o.streams ? { streams: o.streams } : {}) });
  let n = 0;
  const own = async (a: NoNonce<OwnerAction>): Promise<Outcome | Refusal> => svc.exchange(await signOwner(owner, { ...a, nonce: START + ++n } as OwnerAction));
  const r = await own({ type: "connectVenue", venue: "paper-1", connector: "live:paper", label: "", credentialRef: "" });
  if (isRefusal(r)) throw new Error(r.message);
  /** what the page does: prepare, then sign exactly what came back */
  const order = async (draft: Record<string, unknown>) => {
    const p = await svc.account!.prepare({ type: "liveOrder", venue: "paper-1", ...draft });
    if (isRefusal(p)) throw new Error(p.message);
    const { nonce: _n, ...rest } = p.action as Extract<OwnerAction, { type: "liveOrder" }>;
    const done = await own(rest as NoNonce<OwnerAction>);
    if (isRefusal(done) || done.kind !== "order") throw new Error(`expected an order, got ${isRefusal(done) ? done.message : done.kind}`);
    return done.order;
  };
  const srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
  servers.push(srv);
  const reprice = (price: number) => Object.assign(btc, { price, bid: price - 10, ask: price + 10 });
  return { svc, srv, own, order, reprice, home };
}

interface Sse {
  status: number;
  headers: IncomingHttpHeaders;
  text(): string;
  frames(): Frame[];
  ended(): boolean;
  /** waits until what came satisfies `ok` (or the stream ended, or `ms` passed: then it throws, saying what came) */
  until(ok: (frames: Frame[]) => boolean, ms?: number): Promise<Frame[]>;
  close(): void;
}
/** a GET of the stream as a browser's EventSource sends it, read as it comes */
function listen(url: string, o: { path?: string; headers?: Record<string, string> } = {}): Promise<Sse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request({ host: u.hostname, port: u.port, path: o.path ?? "/api/account/stream", headers: { accept: "text/event-stream", ...(o.headers ?? {}) } }, (res) => {
      let text = "";
      let ended = false;
      const waiting: Array<() => void> = [];
      const wake = () => {
        for (const w of waiting.splice(0)) w();
      };
      res.setEncoding("utf8");
      res.on("data", (c: string) => {
        text += c;
        wake();
      });
      res.on("end", () => {
        ended = true;
        wake();
      });
      res.on("close", () => {
        ended = true;
        wake();
      });
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        text: () => text,
        frames: () => framesOf(text),
        ended: () => ended,
        async until(ok, ms = 4_000) {
          const t0 = Date.now();
          while (!ok(framesOf(text))) {
            if (ended || Date.now() - t0 > ms) throw new Error(`the stream did not say it: ${ended ? "it ended" : "timed out"} after ${JSON.stringify(framesOf(text).map((f) => f.event))}`);
            await new Promise<void>((go) => {
              waiting.push(go);
              setTimeout(go, 50);
            });
          }
          return framesOf(text);
        },
        close: () => req.destroy(),
      });
    });
    req.on("error", reject);
    req.end();
  });
}
const named = (frames: Frame[], event: string) => frames.filter((f) => f.event === event);

describe("GET /api/account/stream", () => {
  it("is behind the same guard as every route: another site's page, a host name that is not this server's, a cross-site fetch or a navigation is turned away before a stream opens", async () => {
    const { srv, svc } = await boot();
    for (const headers of [{ origin: "https://evil.example" }, { host: "evil.example" }, { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }]) {
      const r = await listen(srv.url, { headers });
      expect(r.status, JSON.stringify(headers)).toBe(403);
      expect(r.headers["content-type"]).toMatch(/^application\/json/);
      r.close();
    }
    // another site navigating a tab of its own here (window.open, then its location) holds no stream and follows no market — nor does the
    // address bar: the page opens its stream as an EventSource, never as a page
    for (const headers of [{ "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }, { "sec-fetch-site": "none", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }]) {
      const r = await listen(srv.url, { headers, path: "/api/account/stream?client=tab-navigated-1&markets=paper-1:BTC/USD" });
      expect(r.status, JSON.stringify(headers)).toBe(403);
      r.close();
    }
    expect(svc.stream.listening).toBe(0);
    // a query given twice is a malformed request
    const twice = await listen(srv.url, { path: "/api/account/stream?since=a.1&since=b.2" });
    expect(twice.status).toBe(400);
    twice.close();
  });

  it("tells a page what its paper account's book does as it happens — the owner's own order, a background look's fill — in the shapes the page reads; a page that comes back resumes after the last id it heard", async () => {
    const { svc, srv, order, reprice } = await boot();
    const page = await listen(srv.url);
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(page.headers["cache-control"]).toBe("no-store");
    const start = await page.until((f) => named(f, "snapshot").length === 1);
    expect(start[0]).toEqual({ retry: 1000 });
    expect(named(start, "snapshot")[0]!.data).toMatchObject({ orders: [], paper: [expect.objectContaining({ venue: "paper-1", cashUsd: 10000 })] });
    // the owner's market buy: its state, its fill, the holding, the cash, the book, the statement — told before the door has answered
    const bought = await order({ symbol: "BTC/USD", side: "buy", orderType: "market", qty: "0.01" });
    const got = await page.until((f) => named(f, "fill").length === 1 && named(f, "statement").length > 0 && named(f, "order").some((o) => (o.data as { id?: string }).id === bought.id));
    const fill = named(got, "fill")[0]!.data as Record<string, unknown>;
    expect(fill).toMatchObject({ venue: "paper-1", venueName: "Paper account", paper: true, symbol: "BTC/USD", side: "buy", qty: 0.01, price: 60010, clientId: bought.clientId, filledQty: 0.01 });
    const orders = named(got, "order").map((f) => f.data as Record<string, unknown>);
    expect(orders.find((o) => o.id === bought.id)).toMatchObject({ venue: "paper-1", clientId: bought.clientId, status: "filled", filledQty: 0.01, paper: true });
    const position = named(got, "position")[0]!.data as { venue: string; symbol: string; position: Record<string, unknown> };
    expect(position).toMatchObject({ venue: "paper-1", symbol: "BTC/USD", position: { venue: "paper-1", venueName: "Paper account", paper: true, symbol: "BTC/USD", side: "long", qty: 0.01 } });
    // the pushed row is the row the positions route lists
    const listed = (await fetch(`${srv.url}/api/account/positions`).then((r) => r.json())) as { positions: Array<Record<string, unknown>> };
    const row = listed.positions.find((p) => p.symbol === "BTC/USD")!;
    for (const k of ["venue", "venueName", "paper", "symbol", "name", "kind", "side", "qty", "entryPrice", "costUsd"]) expect(position.position[k], k).toEqual(row[k]);
    expect(named(got, "balance")[0]!.data).toMatchObject({ venue: "paper-1", paper: true, cashUsd: expect.any(Number) });
    expect(named(got, "paper").at(-1)!.data).toMatchObject({ venue: "paper-1", holdings: 1 });
    // every id rises, from the snapshot's on
    const ids = got.filter((f) => f.id).map(seqOf);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    const heard = got.filter((f) => f.id).at(-1)!.id!;
    page.close();

    // while no page listens: a resting limit, and the price comes to it — a background look's fill
    const resting = await order({ symbol: "BTC/USD", side: "buy", orderType: "limit", qty: "0.01", limitPrice: "59000" });
    expect(resting.status).toBe("open");
    reprice(58900);
    expect(await svc.lookAtPaper()).toEqual(["paper-1"]);

    // the page comes back naming the last id it heard (as a browser does by itself): what came meanwhile, and no snapshot
    const back = await listen(srv.url, { headers: { "last-event-id": heard } });
    const caught = await back.until((f) => named(f, "fill").length === 1);
    expect(named(caught, "snapshot")).toEqual([]);
    expect(named(caught, "fill")[0]!.data).toMatchObject({ venue: "paper-1", price: 59000, qty: 0.01, order: resting.id, by: "owner" });
    expect(named(caught, "order").some((o) => (o.data as { id?: string; status?: string }).id === resting.id && (o.data as { status?: string }).status === "filled")).toBe(true);
    back.close();
    // a new stream with ?since= resumes the same way; an id from another run, or one that is no id, is a snapshot
    const since = await listen(srv.url, { path: `/api/account/stream?since=${encodeURIComponent(heard)}` });
    expect(named(await since.until((f) => named(f, "fill").length === 1), "snapshot")).toEqual([]);
    since.close();
    for (const last of ["deadbeef.3", "../../etc", `${svc.stream.run}.999999`]) {
      const fresh = await listen(srv.url, { headers: { "last-event-id": last } });
      const f = await fresh.until((x) => named(x, "snapshot").length === 1);
      expect(named(f, "fill")).toEqual([]);
      fresh.close();
    }
  });

  it("stops listening to a paper account's book when it is disconnected, and hears the new connection's once it is connected again", async () => {
    const { svc, own } = await boot();
    const unlisten = (svc as unknown as { paperUnlisten: Map<string, () => void> }).paperUnlisten;
    expect([...unlisten.keys()]).toEqual(["paper-1"]);
    expect(await own({ type: "disconnectVenue", venue: "paper-1" })).toMatchObject({ kind: "account" });
    expect(unlisten.size).toBe(0);
    expect(await own({ type: "connectVenue", venue: "paper-1", connector: "live:paper", label: "", credentialRef: "" })).toMatchObject({ kind: "account" });
    expect([...unlisten.keys()]).toEqual(["paper-1"]);
  });

  it("answers 503 in words past the bus's room, and the server's close() ends every open stream — the server closes, the page's stream ends", async () => {
    const { svc, srv } = await boot();
    // a bus with room for one page, in place of the service's own
    (svc as unknown as { stream: AccountStream }).stream = new AccountStream({ maxClients: 1 });
    const one = await listen(srv.url);
    expect(one.status).toBe(200);
    await one.until((f) => named(f, "snapshot").length === 1);
    const two = await listen(srv.url);
    expect(two.status).toBe(503);
    await two.until(() => two.ended());
    expect((JSON.parse(two.text()) as { error: string }).error).toContain("pages listening already");
    two.close();
    await srv.close();
    await one.until(() => one.ended());
    expect(one.ended()).toBe(true);
  });
});

// ---- the account's door, told as it follows a venue that does not tell its own book --------------------------------------------------------

/** a venue the account follows by asking: a limit rests until the test fills it (in parts, at the prices it says), a market order fills
 * at once. `paper` makes it a venue's own paper account (as Alpaca's paper account and Hyperliquid's testnet are): paper, but not a book the
 * account keeps, so its fills are told from the door */
const ETH: Market = { symbol: "ETH/USD", name: "ETH / USD", kind: "spot", base: "ETH", quote: "USD", price: 2450, bid: 2449.5, ask: 2450.5, minQty: 0.001, qtyStep: 0.001, priceStep: 0.01, open: true, types: ["market", "limit"], volumeUsd24h: 1e9 };
const DOOR: { states: Map<string, OrderState> } = { states: new Map() };
const doorTrader = (): LiveTrader => {
  let n = 0;
  return {
    can: true,
    what: "spot",
    async markets() {
      return [{ ...ETH }];
    },
    async market() {
      return { ...ETH };
    },
    async place(o) {
      const ref = `x-${++n}`;
      const st: OrderState = o.type === "market" ? { ref, status: "filled", filledQty: o.qty, avgPrice: 2450.5, feeUsd: 0.1, native: {} } : { ref, status: "open", filledQty: 0, native: {} };
      DOOR.states.set(ref, st);
      return { ...st };
    },
    async cancel(ref) {
      return { ...DOOR.states.get(ref)!, status: "canceled" };
    },
    async status(ref) {
      return { ...DOOR.states.get(ref)! };
    },
    async positions() {
      return [];
    },
  };
};
for (const [kind, label, paper] of [["standin-door-real", "Exchange", false], ["standin-door-venue-paper", "Broker paper", true]] as const)
  register({ kind, label, needs: "key-file", example: "", venues: [], async open(req) {
    return { source: { name: req.label || label, kind: "cex", reference: "standin", via: "a stand-in", probe: { can: ["read", "trade"], note: "" }, read: async () => [{ asset: "USD", amount: 5000, usd: 5000, class: "cash" }], trader: doorTrader(), readOnlyBecause: "a stand-in moves no money", ...(paper ? { paper: true } : {}) } as never, first: [{ asset: "USD", amount: 5000, usd: 5000, class: "cash" }], summary: "connected" };
  } });

const ok = (o: Outcome | Refusal) => {
  if (isRefusal(o)) throw new Error(o.message);
  return o;
};

describe("the account's door while a page listens (service.ts watchDoor, toldFill)", () => {
  it("looks by itself only while a page listens and something is under way at a venue whose book the account does not keep; each order that filled more is told as a fill of its own — what it added, at its own price — and a venue's own paper account's too; what waits for the owner without a card is told as well", async () => {
    const home = mkdtempSync(join(tmpdir(), "account-door-"));
    homes.push(home);
    const svc = await PortfolioService.create({ home, now: () => new Date(START).toISOString(), venues: "frontline", real: true, liveDeps: { clock: () => REAL, http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined }, publicMarkets: [], liveWrites: { capUsd: 5000, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date(START).toISOString() }] } });
    let n = 0;
    const own = async (a: NoNonce<OwnerAction>): Promise<Outcome | Refusal> => svc.exchange(await signOwner(owner, { ...a, nonce: START + ++n } as OwnerAction));
    for (const [venue, connector] of [["ex", "live:standin-door-real"], ["bp", "live:standin-door-venue-paper"]] as const) {
      const r = await own({ type: "connectVenue", venue, connector, label: "", credentialRef: "" });
      if (isRefusal(r)) throw new Error(r.message);
    }
    const place = async (venue: string, draft: Record<string, unknown>) => {
      const p = await svc.account!.prepare({ type: "liveOrder", venue, symbol: "ETH/USD", side: "buy", ...draft });
      if (isRefusal(p)) throw new Error(p.message);
      const { nonce: _n, ...rest } = p.action as Extract<OwnerAction, { type: "liveOrder" }>;
      const done = await own(rest as NoNonce<OwnerAction>);
      if (isRefusal(done) || done.kind !== "order") throw new Error(`expected an order, got ${isRefusal(done) ? done.message : done.kind}`);
      return done.order;
    };
    // nothing under way, and no page listening: the door does not look
    expect(await svc.lookAtDoor()).toBe("");
    const page = attach(svc.stream);
    expect(await svc.lookAtDoor()).toBe("");
    const fills = () => events(page).filter((f) => f.event === "fill").map((f) => f.data as Record<string, unknown>);
    // a resting limit at the real venue: under way, so the door looks — and finds nothing new yet
    const resting = await place("ex", { orderType: "limit", qty: "0.5", limitPrice: "2451" });
    expect(resting.status).toBe("open");
    expect(fills()).toEqual([]);
    expect(await svc.lookAtDoor()).toBe("full");
    expect(fills()).toEqual([]);
    // it fills 0.2 at 2,450.5, then 0.5 in all at an average of 2,451: each told as it is found, what it added at its own price
    Object.assign(DOOR.states.get(resting.ref)!, { status: "partial", filledQty: 0.2, avgPrice: 2450.5 });
    svc.account!.trade.dueNow("ex");
    expect(await svc.lookAtDoor()).toBe("full");
    Object.assign(DOOR.states.get(resting.ref)!, { status: "filled", filledQty: 0.5, avgPrice: 2451 });
    svc.account!.trade.dueNow("ex");
    expect(await svc.lookAtDoor()).toBe("full");
    expect(fills()).toEqual([
      expect.objectContaining({ venue: "ex", clientId: resting.clientId, order: resting.id, by: "owner", side: "buy", symbol: "ETH/USD", qty: 0.2, price: 2450.5, filledQty: 0.2 }),
      expect.objectContaining({ venue: "ex", clientId: resting.clientId, order: resting.id, qty: 0.3, price: 2451.3333, filledQty: 0.5 }),
    ]);
    expect(fills().some((f) => f.avg)).toBe(false);
    // done: nothing under way at the real venue now, and the door rests again
    expect(await svc.lookAtDoor()).toBe("");
    // a market order at a venue's own paper account fills as it is placed: told at once, in the same call, before its answer — paper
    const before = fills().length;
    const quick = await place("bp", { orderType: "market", qty: "0.1" });
    expect(quick.status).toBe("filled");
    expect(fills().slice(before)).toEqual([expect.objectContaining({ venue: "bp", paper: true, clientId: quick.clientId, qty: 0.1, price: 2450.5, filledQty: 0.1 })]);
    // (the account's own paper book tells its own fill as it is written, paperSaid, and the door tells none of it: "tells a page what its
    // paper account's book does" above hears exactly one fill for the owner's market buy there)

    // what waits for the owner without a card is told too, so the page reads its counts: an agent knocking to be let in — once while the
    // list of them stands as it is, again when it changes — and an agent's ask once it is let in
    const cards = () => events(page).filter((f) => f.event === "card").map((f) => (f.data as { waits?: string }).waits);
    const bot = simKey("agent:door-bot");
    const knock = async (text: string) => svc.exchange(await signAgent(bot, { type: "agentAsk", kind: "letIn", venue: "", usd: "", text, nonce: START + ++n } as AgentAction));
    expect(isRefusal(await knock("Door bot"))).toBe(true);
    expect(cards()).toEqual(["letIn"]);
    expect(isRefusal(await knock("Door bot"))).toBe(true);
    expect(cards()).toEqual(["letIn"]);
    expect(isRefusal(await knock("Door bot two"))).toBe(true);
    expect(cards()).toEqual(["letIn", "letIn"]);
    ok(await own({ type: "approveAgent", agentAddress: bot.address, agentName: "Door bot", validUntil: START + 7 * 86_400_000 }));
    const asked = await svc.exchange(await signAgent(bot, { type: "agentAsk", kind: "limit", venue: "ex", usd: "50", text: "a limit to trade ETH", nonce: START + ++n } as AgentAction));
    expect(isRefusal(asked)).toBe(false);
    expect(cards().filter((w) => w === "ask")).toHaveLength(1);
    page.end();
  });
});

/** a venue's WebSocket as the hub opens one, the venue's side spoken by the test (Kraken's v2 shapes) */
class VenueWs implements WebSocketLike {
  static all: VenueWs[] = [];
  readyState = 0;
  readonly sent: string[] = [];
  private readonly on = new Map<string, Array<(ev: { data?: unknown }) => void>>();
  constructor(readonly url: string) {
    VenueWs.all.push(this);
  }
  addEventListener(type: string, fn: (ev: { data?: unknown }) => void): void {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    for (const fn of this.on.get("close") ?? []) fn({});
  }
  open(): void {
    this.readyState = 1;
    for (const fn of this.on.get("open") ?? []) fn({});
  }
  say(msg: unknown): void {
    for (const fn of this.on.get("message") ?? []) fn({ data: JSON.stringify(msg) });
  }
}
const post = (url: string, path: string, body: unknown): Promise<{ status: number; body: unknown }> =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request({ host: u.hostname, port: u.port, path, method: "POST", headers: { "content-type": "application/json" } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
const until = async (ok: () => boolean, ms = 4_000): Promise<void> => {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((go) => setTimeout(go, 20));
  }
};

describe("the markets a page shows, on its stream (feat/paper-live p2a)", () => {
  it("a page that names itself and follows a paper account's market gets its quote, book and trades as the venue's own stream moves — the market streamed from its own listing source while a page shows it; a page that follows nothing, or stopped following it, hears none", async () => {
    VenueWs.all = [];
    const hub = new StreamHub({ WebSocket: VenueWs });
    try {
      const { srv } = await boot({ streams: hub });
      const client = "page-test-0001";
      const page = await listen(srv.url, { path: `/api/account/stream?client=${client}&markets=${encodeURIComponent("paper-1:BTC/USD")}` });
      const other = await listen(srv.url);
      expect(page.status).toBe(200);
      // the paper account prices BTC/USD at Kraken (its listing source): the service holds Kraken's stream of it, its book too
      await until(() => VenueWs.all.some((w) => w.url === HUB_URLS.kraken));
      const kr = VenueWs.all.find((w) => w.url === HUB_URLS.kraken)!;
      kr.open();
      await until(() => kr.sent.some((m) => m.includes('"channel":"book"')));
      expect(kr.sent.map((m) => JSON.parse(m))).toEqual(expect.arrayContaining([{ method: "subscribe", params: { channel: "ticker", symbol: ["BTC/USD"], event_trigger: "bbo" } }, { method: "subscribe", params: { channel: "book", symbol: ["BTC/USD"], depth: 10 } }]));
      kr.say({ channel: "ticker", type: "snapshot", data: [{ symbol: "BTC/USD", bid: 60001, bid_qty: 1, ask: 60002, ask_qty: 2, last: 60001.5 }] });
      kr.say({ channel: "book", type: "snapshot", data: [{ symbol: "BTC/USD", bids: [{ price: 60001, qty: 1 }], asks: [{ price: 60002, qty: 2 }], timestamp: new Date().toISOString() }] });
      kr.say({ channel: "trade", type: "update", data: [{ symbol: "BTC/USD", side: "buy", price: 60002, qty: 0.5, trade_id: 7, timestamp: new Date().toISOString() }] });
      const got = await page.until((f) => named(f, "quote").some((q) => (q.data as { live?: boolean }).live === true) && named(f, "book").some((b) => (b.data as { bids?: unknown[] }).bids?.length === 1) && named(f, "trades").some((t) => (t.data as { trades?: unknown[] }).trades?.length === 1));
      expect(named(got, "quote").at(-1)!.data).toMatchObject({ key: "paper-1:BTC/USD", venue: "paper-1", symbol: "BTC/USD", source: "kraken", bid: 60001, ask: 60002, bidSz: 1, askSz: 2, last: 60002, from: "Kraken · live", live: true });
      expect(named(got, "book").at(-1)!.data).toMatchObject({ key: "paper-1:BTC/USD", bids: [[60001, 1]], asks: [[60002, 2]], from: "Kraken · live", depth: "full" });
      expect(named(got, "trades").at(-1)!.data).toMatchObject({ key: "paper-1:BTC/USD", trades: [{ price: 60002, size: 0.5, side: "buy" }] });
      // a market's event is never kept for a resume: no id below the account's own
      expect(named(other.frames(), "quote")).toEqual([]);
      // the page follows nothing now: no more of that market reaches it
      expect(await post(srv.url, "/api/account/stream/markets", { client, markets: [] })).toEqual({ status: 200, body: { ok: true, following: [] } });
      const heard = named(page.frames(), "quote").length;
      await new Promise((go) => setTimeout(go, 150));
      kr.say({ channel: "ticker", type: "update", data: [{ symbol: "BTC/USD", bid: 60100, bid_qty: 1, ask: 60101, ask_qty: 2, last: 60100 }] });
      await new Promise((go) => setTimeout(go, 150));
      expect(named(page.frames(), "quote")).toHaveLength(heard);
      // a page that names no stream it holds, or names itself wrongly, is told so
      expect((await post(srv.url, "/api/account/stream/markets", { client: "nobody-here-0001", markets: [] })).status).toBe(404);
      expect((await post(srv.url, "/api/account/stream/markets", { client: "x", markets: [] })).status).toBe(400);
      page.close();
      other.close();
    } finally {
      hub.close();
    }
  });

  it("A HYPERLIQUID PERPETUAL a page follows at a paper account is pushed what Hyperliquid's own bar shows — its mark, its oracle, its funding, its open interest, its day's dollars traded, the price 24 hours ago and its premium — as Hyperliquid's stream says them", async () => {
    VenueWs.all = [];
    const hub = new StreamHub({ WebSocket: VenueWs });
    const perp: Listing = { symbol: "BTC-PERP", name: "BTC perpetual on Hyperliquid", kind: "perp", base: "BTC", quote: "USDC", price: 82383.5, open: true, types: [], maxLeverage: 40 };
    const hl: PublicSource = { id: "hyperliquid", name: "Hyperliquid", kind: "exchange", connectTo: "hyperliquid-trade", connector: "live:hyperliquid-trade", listings: async (q) => [perp].filter((m) => !q.q || m.base.includes(q.q.toUpperCase())) };
    try {
      const { srv } = await boot({ streams: hub, sources: [hl] });
      const page = await listen(srv.url, { path: `/api/account/stream?client=page-test-0007&markets=${encodeURIComponent("paper-1:BTC-PERP")}` });
      expect(page.status).toBe(200);
      await until(() => VenueWs.all.some((w) => w.url === HUB_URLS.hyperliquid));
      const ws = VenueWs.all.find((w) => w.url === HUB_URLS.hyperliquid)!;
      ws.open();
      await until(() => ws.sent.some((m) => m.includes('"activeAssetCtx"')));
      ws.say({ channel: "bbo", data: { coin: "BTC", time: Date.now(), bbo: [{ px: "82383.0", sz: "5.2", n: 20 }, { px: "82384.0", sz: "1.1", n: 3 }] } });
      ws.say({ channel: "activeAssetCtx", data: { coin: "BTC", ctx: { funding: "0.0000125", openInterest: "40687.01858", prevDayPx: "82033.0", dayNtlVlm: "2599518859.45", premium: "-0.0003749322", oraclePx: "82414.9", markPx: "82384.0", midPx: "82383.5" } } });
      const got = await page.until((f) => named(f, "quote").some((q) => (q.data as { oracle?: number }).oracle !== undefined));
      expect(named(got, "quote").at(-1)!.data).toMatchObject({ key: "paper-1:BTC-PERP", venue: "paper-1", symbol: "BTC-PERP", source: "hyperliquid", bid: 82383, ask: 82384, mark: 82384, oracle: 82414.9, funding: 0.0000125, openInterest: 40687.01858, volumeUsd24h: 2599518859.45, prevDayPx: 82033, premium: -0.0003749322, from: "Hyperliquid · live", live: true });
      page.close();
    } finally {
      hub.close();
    }
  });

  it("a tab that comes back on a new stream before its old one was let go is sent its markets again at once — with no word from the venue and nothing asked — and a telling that arrives after a later one is let be (feat/paper-live p2b)", async () => {
    VenueWs.all = [];
    const hub = new StreamHub({ WebSocket: VenueWs });
    try {
      const { srv } = await boot({ streams: hub });
      const client = "page-test-0003";
      const first = await listen(srv.url, { path: `/api/account/stream?client=${client}&markets=${encodeURIComponent("paper-1:BTC/USD")}` });
      await until(() => VenueWs.all.some((w) => w.url === HUB_URLS.kraken));
      const kr = VenueWs.all.find((w) => w.url === HUB_URLS.kraken)!;
      kr.open();
      await until(() => kr.sent.some((m) => m.includes('"channel":"ticker"')));
      kr.say({ channel: "ticker", type: "snapshot", data: [{ symbol: "BTC/USD", bid: 60001, bid_qty: 1, ask: 60002, ask_qty: 2, last: 60001.5, timestamp: new Date().toISOString() }] });
      await first.until((f) => named(f, "quote").some((q) => (q.data as { live?: boolean }).live === true));
      // the same tab's new stream, its old one still open here (a network that dropped the page's side only): the market said again on it
      const back = await listen(srv.url, { path: `/api/account/stream?client=${client}` });
      const got = await back.until((f) => named(f, "quote").some((q) => (q.data as { live?: boolean }).live === true));
      expect(named(got, "quote").at(-1)!.data).toMatchObject({ key: "paper-1:BTC/USD", bid: 60001, ask: 60002, priceAt: expect.any(String), live: true });
      await until(() => first.ended());
      // the page's tellings, numbered: the later stands, one that arrives after it is let be
      expect(await post(srv.url, "/api/account/stream/markets", { client, markets: [], n: 7 })).toEqual({ status: 200, body: { ok: true, following: [] } });
      expect(await post(srv.url, "/api/account/stream/markets", { client, markets: ["paper-1:BTC/USD"], n: 6 })).toEqual({ status: 200, body: { ok: true, following: [] } });
      expect((await post(srv.url, "/api/account/stream/markets", { client, markets: [], n: "8" })).status).toBe(400);
      back.close();
    } finally {
      hub.close();
    }
  });

  it("a page that follows a market for its price alone (a key with ~: a position's mark, feat/paper-live p2b) has it streamed without its book, and is sent its quote only — under that key, with the market's own venue — never its book or its trades", async () => {
    VenueWs.all = [];
    const hub = new StreamHub({ WebSocket: VenueWs });
    try {
      const { srv } = await boot({ streams: hub });
      const client = "page-test-0002";
      const page = await listen(srv.url, { path: `/api/account/stream?client=${client}&markets=${encodeURIComponent("~paper-1:BTC/USD")}` });
      expect(page.status).toBe(200);
      await until(() => VenueWs.all.some((w) => w.url === HUB_URLS.kraken));
      const kr = VenueWs.all.find((w) => w.url === HUB_URLS.kraken)!;
      kr.open();
      await until(() => kr.sent.some((m) => m.includes('"channel":"ticker"')));
      kr.say({ channel: "ticker", type: "snapshot", data: [{ symbol: "BTC/USD", bid: 60001, bid_qty: 1, ask: 60002, ask_qty: 2, last: 60001.5 }] });
      kr.say({ channel: "trade", type: "update", data: [{ symbol: "BTC/USD", side: "buy", price: 60002, qty: 0.5, trade_id: 8, timestamp: new Date().toISOString() }] });
      const got = await page.until((f) => named(f, "quote").some((q) => (q.data as { live?: boolean }).live === true));
      expect(named(got, "quote").at(-1)!.data).toMatchObject({ key: "~paper-1:BTC/USD", venue: "paper-1", symbol: "BTC/USD", source: "kraken", bid: 60001, ask: 60002, live: true });
      // its book is never subscribed, and neither its book nor its trades reach the page
      await new Promise((go) => setTimeout(go, 250));
      expect(kr.sent.some((m) => m.includes('"channel":"book"'))).toBe(false);
      expect(named(page.frames(), "book")).toEqual([]);
      expect(named(page.frames(), "trades")).toEqual([]);
      // shown whole now: its book is held as well
      expect(await post(srv.url, "/api/account/stream/markets", { client, markets: ["paper-1:BTC/USD"] })).toEqual({ status: 200, body: { ok: true, following: ["paper-1:BTC/USD"] } });
      await until(() => kr.sent.some((m) => m.includes('"channel":"book"')));
      page.close();
    } finally {
      hub.close();
    }
  });
  it("A US SHARE a page follows at a paper account is pushed its real-time quote as the background reader reads it (feat/paper-live phase 3) — Robinhood's, with its own stamp, its source and how often it is written, the same quote event as a coin's — its price alone: never a book or trades", async () => {
    VenueWs.all = [];
    // the US line's clock: Wednesday 14 October 2026 from 11:00 New York (the regular session), moving with the test; Robinhood writes a new
    // answer at each read here, AAPL's book a cent higher each time
    const t0 = Date.now();
    const clock = () => REAL + (Date.now() - t0);
    let writes = 0;
    const http = async (url: string) => {
      if (url !== ROBINHOOD_PRICES) return { status: 200, body: { data: null }, text: "" };
      const k = writes++;
      return { status: 200, text: "", body: { quotes: [{ tokenSymbol: "AAPL", bid: (340 + k * 0.01).toFixed(2), ask: (340.04 + k * 0.01).toFixed(2), currency: "USD", isTradingHalt: false, generatedAt: new Date(clock() - 300).toISOString() }] } };
    };
    const quotes = usQuote({ pace: async () => undefined, http, clock });
    const feed = new UsQuoteFeed({ source: "cboe", quotes, listed: () => true, clock });
    const delayed = (): Listing => ({ symbol: "AAPL", name: "Apple Inc", kind: "stock", base: "AAPL", quote: "USD", price: 338, bid: 337.98, ask: 338.02, open: true, types: [], quoteAt: new Date(clock() - CBOE_DELAY_MS).toISOString(), delayMs: CBOE_DELAY_MS, quoteFrom: CBOE_FROM, session: usSessionFull(clock(), false), venueName: "US stocks" });
    const cboe: PublicSource = { id: "cboe", name: "US stocks", kind: "stocks", connectTo: "alpaca", connector: "live:alpaca", sessions: usClock, listings: async () => [delayed()], line: async (sym) => (sym === "AAPL" ? delayed() : null) };
    // Robinhood's answer read twice already (a listing's reads): AAPL's book has been seen to move
    await quotes.robinhood.read();
    await quotes.robinhood.read();
    const hub = joinHubs(new StreamHub({ WebSocket: VenueWs }), feed);
    try {
      const { srv } = await boot({ streams: hub, sources: [cboe] });
      const page = await listen(srv.url, { path: `/api/account/stream?client=page-test-0004&markets=${encodeURIComponent("paper-1:AAPL")}` });
      expect(page.status).toBe(200);
      const got = await page.until((f) => named(f, "quote").some((q) => (q.data as { live?: boolean }).live === true));
      const q = named(got, "quote").at(-1)!.data as Record<string, unknown>;
      expect(q).toMatchObject({ key: "paper-1:AAPL", venue: "paper-1", symbol: "AAPL", source: "cboe", from: ROBINHOOD_FROM, delayMs: 0, everyMs: 15_000, live: true });
      expect([q.bid, q.ask, q.last]).toEqual([expect.any(Number), expect.any(Number), undefined]);
      // its age is its own: the write it stood in, stamped by Robinhood — not the moment it was read or pushed
      expect(q.seenAt).toBe(q.at);
      expect(q.priceAt).toBe(q.at);
      expect(clock() - Date.parse(String(q.at))).toBeLessThan(5_000);
      // its price alone: no book, no trades — and no venue's socket opened for it
      await new Promise((go) => setTimeout(go, 250));
      expect(named(page.frames(), "book")).toEqual([]);
      expect(named(page.frames(), "trades")).toEqual([]);
      expect(VenueWs.all).toEqual([]);
      expect(feed.status()).toEqual([{ symbol: "AAPL", live: true, from: ROBINHOOD_FROM }]);
      page.close();
    } finally {
      hub.close();
    }
  });
});
