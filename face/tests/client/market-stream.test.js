// The market's push channel in the browser (plan A2 Task 6): wire/market-stream.js, the Account stream's client on the
// market's paths — its source, its follows and the frames it takes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketStream } from '../../client/js/wire/market-stream.js';

class FakeSource {
  constructor(url) { this.url = url; this.readyState = 0; this.listeners = new Map(); this.onopen = null; this.onerror = null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  close() { this.readyState = 2; }
  open() { this.readyState = 1; this.onopen?.({ type: 'open' }); }
  fire(type, data, lastEventId = '') { for (const l of this.listeners.get(type) ?? []) l({ type, data: JSON.stringify(data), lastEventId }); }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function rig() {
  const r = { sources: [], posts: [], events: [], timers: new Map() };
  let serial = 0;
  r.stream = createMarketStream({
    createEventSource: url => { const s = new FakeSource(url); r.sources.push(s); return s; },
    fetcher: async (path, init) => { r.posts.push({ path, body: JSON.parse(init.body) }); return { status: 200 }; },
    schedule: (fn, ms) => { const id = ++serial; r.timers.set(id, { fn, ms }); return id; },
    cancelTimer: id => r.timers.delete(id),
    random: n => new Uint8Array(n).fill(7),
  }, ev => r.events.push(ev));
  return r;
}

test('opens /data/market/stream and posts its follows to /data/market/stream/markets', async () => {
  const r = rig();
  r.stream.follow(['kraken:BTC/USD']);
  r.stream.open();
  assert.equal(r.sources.length, 1);
  assert.match(r.sources[0].url, /^\/data\/market\/stream\?client=face-[0-9a-f]{24}$/);
  r.sources[0].open();
  await settle();
  assert.deepEqual(r.posts.map(p => [p.path, p.body.markets]), [['/data/market/stream/markets', ['kraken:BTC/USD']]]);
  r.stream.follow([]);
  await settle();
  assert.equal(r.sources[0].readyState, 2, 'leaving the public market releases its connection');
  assert.equal(r.timers.size, 0);
  assert.equal(r.posts.length, 1, 'closing a source needs no empty follow POST');
});

test('takes snapshot, quote, trades, book and hb, and no wallet event', () => {
  const r = rig();
  r.stream.follow(['kraken:BTC/USD']);
  r.stream.open();
  const s = r.sources[0];
  assert.deepEqual([...s.listeners.keys()].sort(), ['book', 'hb', 'quote', 'snapshot', 'trades']);
  for (const type of ['order', 'fill', 'position', 'balance', 'paper', 'statement', 'card', 'desk']) assert.equal(s.listeners.has(type), false, type);
  s.fire('quote', { venue: 'kraken', symbol: 'BTC/USD', last: 1 }, '3');
  s.fire('fill', { venue: 'x' }, '4');
  assert.deepEqual(r.events.map(e => e.type), ['quote']);
});

test('three visible idle pages consume no public SSE connections or retry timers', () => {
  const pages = [rig(), rig(), rig()];
  for (const r of pages) {
    r.stream.open();
    r.stream.open();
    r.stream.follow(['', '   ']);
    assert.equal(r.sources.length, 0);
    assert.equal(r.posts.length, 0);
    assert.equal(r.timers.size, 0);
  }
  pages[1].stream.follow(['hyperliquid:BTC-PERP', 'hyperliquid:BTC-PERP']);
  assert.deepEqual(pages.map(r => r.sources.length), [0, 1, 0], 'only the page that follows a market uses a connection');
  pages[1].stream.follow([]);
  assert.equal(pages[1].sources[0].readyState, 2);
  assert.equal(pages[1].timers.size, 0);
});

test('a public detail follows only while visible, resumes its cursor, and releases the connection when left', async () => {
  const r = rig();
  r.stream.open();
  r.stream.follow(['hyperliquid:BTC-PERP', 'hyperliquid:BTC-PERP', '']);
  const first = r.sources[0];
  first.open();
  await settle();
  assert.deepEqual(r.posts[0].body.markets, ['hyperliquid:BTC-PERP']);
  first.fire('quote', { venue: 'hyperliquid', symbol: 'BTC-PERP', last: 100 }, 'run.4');
  r.stream.close();
  assert.equal(first.readyState, 2);
  assert.equal(r.timers.size, 0);
  r.stream.follow(['trade-xyz:xyz:NVDA-PERP']);
  assert.equal(r.sources.length, 1, 'a follow change while hidden cannot reopen the transport');
  r.stream.open();
  assert.equal(r.sources.length, 2);
  const resumed = r.sources[1];
  assert.ok(resumed.url.endsWith('&since=run.4'));
  resumed.open();
  await settle();
  assert.deepEqual(r.posts.at(-1).body.markets, ['trade-xyz:xyz:NVDA-PERP']);
  r.stream.follow([]);
  assert.equal(resumed.readyState, 2);
  assert.equal(r.timers.size, 0);
  const received = r.events.length;
  resumed.fire('quote', { last: 2 }, 'run.5');
  assert.equal(r.events.length, received, 'a late frame from the closed detail cannot update the page');
  r.stream.follow(['hyperliquid:ETH-PERP']);
  assert.equal(r.sources.length, 3, 'a new detail reuses the visible intent without another open call');
  r.stream.follow([]);
  r.stream.close();
  r.stream.follow(['hyperliquid:BTC-PERP']);
  assert.equal(r.sources.length, 3, 'close cancels the visible intent even when there was no active detail');
});
