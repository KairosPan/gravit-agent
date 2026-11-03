/** THE LINK TO THE MARKET, HARDENED (plan A2 task 1): a hub stream that never sends its headers is dropped and tried again, a hold and its
 * release reach the market in the order they were asked, a market nobody holds or wants is forgotten, and the source list is asked again
 * within SOURCES_WAIT_MS of the first failure or of the hub stream dropping — never only at the next SOURCES_EVERY_MS. Fake timers, and a
 * fetch that stands in for the market. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { marketClient } from "../../src/portfolio/market/client.ts";
import { BACKOFF_MIN_MS, HUB_HEADERS_MS, RemoteHub } from "../../src/portfolio/market/hub.ts";
import { connectMarket, SOURCES_EVERY_MS, SOURCES_WAIT_MS, type MarketLink } from "../../src/portfolio/market/link.ts";

const URL0 = "http://market.test:4821";
const pathOf = (input: unknown): string => new URL(input instanceof Request ? input.url : String(input)).pathname;
const ok = (value: unknown) => new Response(JSON.stringify({ ok: true, value }), { status: 200, headers: { "content-type": "application/json" } });
/** a request that waits until its signal aborts, then fails as fetch does */
const hang = (init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const s = init?.signal;
    if (s?.aborted) return reject(s.reason);
    s?.addEventListener("abort", () => reject(s.reason ?? new Error("aborted")), { once: true });
  });
/** an open event stream, and the hand that writes to it or ends it */
function stream() {
  let c!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (ctrl) => void (c = ctrl) });
  const enc = new TextEncoder();
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    send: (e: unknown) => c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)),
    end: () => c.close(),
  };
}

const links: MarketLink[] = [];
const hubs: RemoteHub[] = [];
beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  for (const l of links.splice(0)) l.close();
  for (const h of hubs.splice(0)) h.close();
  vi.useRealTimers();
});

describe("the link to the market, hardened", () => {
  it("a hub whose stream sends no headers is dropped after HUB_HEADERS_MS and tried again", async () => {
    let hubCalls = 0;
    const http = vi.fn(async (input: unknown, init?: RequestInit) => {
      if (pathOf(input) === "/api/hub") {
        hubCalls++;
        return hang(init);
      }
      return ok(null);
    }) as unknown as typeof fetch;
    const hub = new RemoteHub(marketClient({ url: URL0, fetch: http }), { clientId: "hardening-1", fetch: http });
    hubs.push(hub);
    hub.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(hubCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(HUB_HEADERS_MS + BACKOFF_MIN_MS);
    expect(hubCalls).toBe(2);
    // the second try hangs too: once it is dropped, a poke opens the stream at once, not after the backoff
    await vi.advanceTimersByTimeAsync(HUB_HEADERS_MS);
    expect(hubCalls).toBe(2);
    expect(hub.downSince()).toBeDefined();
    hub.poke();
    await vi.advanceTimersByTimeAsync(0);
    expect(hubCalls).toBe(3);
  });

  it("a release posted after its hold reaches the market after it", async () => {
    const seen: boolean[] = [];
    let holds = 0;
    const http = vi.fn(async (input: unknown, init?: RequestInit) => {
      const p = pathOf(input);
      if (p === "/api/hub") return stream().response;
      if (p === "/api/hub/hold") {
        const body = JSON.parse(String(init?.body)) as { held: boolean };
        // the first hold is slow on its way: the release asked after it must still land after it
        if (holds++ === 0) await new Promise((go) => setTimeout(go, 50));
        seen.push(body.held);
        return ok(true);
      }
      return ok(null);
    }) as unknown as typeof fetch;
    const hub = new RemoteHub(marketClient({ url: URL0, fetch: http }), { clientId: "hardening-2", fetch: http });
    hubs.push(hub);
    hub.start();
    await vi.advanceTimersByTimeAsync(0);
    const release = hub.hold("coinbase", "BTC/USD");
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual([true, false]);
  });

  it("a market no hold and no want keeps is forgotten", async () => {
    const s = stream();
    const http = vi.fn(async (input: unknown) => (pathOf(input) === "/api/hub" ? s.response : ok(true))) as unknown as typeof fetch;
    const hub = new RemoteHub(marketClient({ url: URL0, fetch: http }), { clientId: "hardening-3", fetch: http });
    hubs.push(hub);
    hub.start();
    await vi.advanceTimersByTimeAsync(0);
    const release = hub.hold("coinbase", "BTC/USD");
    s.send({ t: "quote", source: "coinbase", symbol: "BTC/USD", quote: { bid: 1, ask: 2, at: Date.now(), seq: 1, live: true } });
    await vi.advanceTimersByTimeAsync(0);
    expect(hub.quote("coinbase", "BTC/USD")?.bid).toBe(1);
    expect(hub.mirrorCount()).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(60_001);
    expect(hub.mirrorCount()).toBe(0);
    expect(hub.quote("coinbase", "BTC/USD")).toBeUndefined();

    // a market still wanted is kept while its want lasts, and forgotten after
    const again = hub.hold("kraken", "ETH/USD");
    expect(hub.want("kraken", "ETH/USD")).toBe(true);
    s.send({ t: "quote", source: "kraken", symbol: "ETH/USD", quote: { bid: 3, ask: 4, at: Date.now(), seq: 2, live: true } });
    await vi.advanceTimersByTimeAsync(0);
    again();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(hub.mirrorCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(hub.mirrorCount()).toBe(0);
  });

  /** a market that answers its source list and keeps the hub stream open, until `down` says it does not answer */
  function market() {
    const st = { down: false, sources: [] as number[], hub: stream() };
    const http = vi.fn(async (input: unknown) => {
      const p = pathOf(input);
      if (p === "/api/hub") return st.hub.response;
      if (st.down) throw new TypeError("fetch failed");
      if (p === "/api/sources") {
        st.sources.push(Date.now());
        return ok([]);
      }
      return ok(null);
    }) as unknown as typeof fetch;
    const link = connectMarket({ url: URL0, fetch: http, clientId: "hardening-link" });
    links.push(link);
    return { st, link };
  }

  it("the source list is asked again within 5 s of the first failure, not 60 s", async () => {
    const { st, link } = market();
    link.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(st.sources.length).toBe(1);
    // the next ask is SOURCES_EVERY_MS away; a read fails now
    await vi.advanceTimersByTimeAsync(1_000);
    st.down = true;
    expect(link.client.staleSince()).toBeUndefined();
    await link.client.get("/api/hub/confirmed?x=1", 0);
    expect(link.client.staleSince()).toBeDefined();
    const failedAt = Date.now();
    st.down = false;
    await vi.advanceTimersByTimeAsync(SOURCES_WAIT_MS + 100);
    expect(st.sources.length).toBe(2);
    expect(st.sources[1]! - failedAt).toBeLessThanOrEqual(SOURCES_WAIT_MS + 100);
    expect(SOURCES_EVERY_MS).toBeGreaterThan(SOURCES_WAIT_MS + 100);
  });

  it("the source list is asked again within 5 s of the hub stream dropping", async () => {
    const { st, link } = market();
    link.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(st.sources.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    const old = st.hub;
    st.hub = stream();
    old.end();
    await vi.advanceTimersByTimeAsync(0);
    const droppedAt = Date.now();
    await vi.advanceTimersByTimeAsync(SOURCES_WAIT_MS + 100);
    expect(st.sources.length).toBe(2);
    expect(st.sources[1]! - droppedAt).toBeLessThanOrEqual(SOURCES_WAIT_MS + 100);
  });
});
