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
  const r = { sources: [], posts: [], events: [] };
  r.stream = createMarketStream({
    createEventSource: url => { const s = new FakeSource(url); r.sources.push(s); return s; },
    fetcher: async (path, init) => { r.posts.push({ path, body: JSON.parse(init.body) }); return { status: 200 }; },
    schedule: () => ({}), cancelTimer: () => {},
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
  assert.deepEqual(r.posts.at(-1).body.markets, []);
});

test('takes snapshot, quote, trades, book and hb, and no wallet event', () => {
  const r = rig();
  r.stream.open();
  const s = r.sources[0];
  assert.deepEqual([...s.listeners.keys()].sort(), ['book', 'hb', 'quote', 'snapshot', 'trades']);
  for (const type of ['order', 'fill', 'position', 'balance', 'paper', 'statement', 'card', 'desk']) assert.equal(s.listeners.has(type), false, type);
  s.fire('quote', { venue: 'kraken', symbol: 'BTC/USD', last: 1 }, '3');
  s.fire('fill', { venue: 'x' }, '4');
  assert.deepEqual(r.events.map(e => e.type), ['quote']);
});
