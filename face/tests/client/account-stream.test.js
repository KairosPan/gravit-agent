// The Account's push channel in the browser (spec 2026-10-22 §5.1, §6.1–6.2): wire/account-stream.js driven through a
// fake EventSource, recorded timers run one by handle and a recording fetcher — the client id, resume, follows, stale
// and dead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STREAM_CLIENT } from '../../src/account-proxy.ts';
import { createAccountStream, mintClientId, STALE_MS, DEAD_MS, RETRY_MS, FOLLOW_LIMIT } from '../../client/js/wire/account-stream.js';

const BASE = 'http://127.0.0.1:3090';
const FOLLOW_PATH = '/data/account/stream/markets';
const TYPES = ['snapshot', 'order', 'fill', 'position', 'balance', 'paper', 'statement', 'card', 'desk', 'quote', 'trades', 'book', 'hb'];
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const query = url => new URL(url, BASE).searchParams;

// an EventSource the test drives: a frame goes to the listeners of its type, and lastEventId persists from frame to
// frame as the browser's does (a frame without an id line carries the newest id seen); a closed source still delivers,
// so what is tested is the client's own guard
class FakeSource {
  constructor(url) {
    this.url = url; this.readyState = 0; this.closed = false; this.listeners = new Map();
    this.onopen = null; this.onerror = null; this.lastEventId = '';
  }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  close() { this.closed = true; this.readyState = 2; }
  open() { this.readyState = 1; this.onopen?.({ type: 'open' }); }
  error(readyState) { this.readyState = readyState; this.onerror?.({ type: 'error' }); }
  fire(type, data, lastEventId) {
    if (lastEventId !== undefined) this.lastEventId = lastEventId;
    const event = { type, data: typeof data === 'string' ? data : JSON.stringify(data), lastEventId: this.lastEventId };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

// the captured stream's frames as the browser reads them: the id, event and data fields of each blank-line block (one
// data line each, as the Account writes them); a comment (": hb …") or the retry field dispatches nothing
function framesOf(text) {
  return text.split(/\n{2,}/).map(block => {
    const frame = {};
    for (const line of block.split('\n')) {
      const colon = line.indexOf(':');
      if (colon > 0) frame[line.slice(0, colon)] = line.slice(colon + 1).replace(/^ /, '');
    }
    return frame;
  }).filter(frame => frame.event !== undefined && frame.data !== undefined);
}

// the stream over the fakes: a timer is { fn, ms, handle }, kept until run or cancelled; the fetcher records each POST
// and answers r.reply (an answer, a promise of one, or an Error it throws); r.refuse() makes the next source throw
function rig({ reply = { status: 200 } } = {}) {
  const timers = new Map();
  let serial = 0;
  let refusals = 0;
  const r = {
    sources: [], posts: [], events: [], cancelled: [], asked: [], reply,
    refuse() { refusals += 1; },
    source: () => r.sources.at(-1),
    pending: ms => [...timers.values()].filter(timer => ms === undefined || timer.ms === ms),
    delays: () => [...timers.values()].map(timer => timer.ms).sort((a, b) => a - b),
    run(timer) {
      assert.ok(timer && timers.has(timer.handle), 'the timer is pending');
      timers.delete(timer.handle);
      timer.fn();
    },
  };
  r.stream = createAccountStream({
    createEventSource: url => {
      if (refusals > 0) { refusals -= 1; throw new Error('no EventSource here'); }
      const source = new FakeSource(url);
      r.sources.push(source);
      return source;
    },
    fetcher: (path, init) => {
      r.posts.push({ path, init, body: JSON.parse(init.body) });
      if (r.reply instanceof Error) throw r.reply;
      return Promise.resolve(r.reply);
    },
    schedule: (fn, ms) => { const timer = { fn, ms, handle: ++serial }; timers.set(timer.handle, timer); return timer.handle; },
    cancelTimer: handle => { r.cancelled.push(handle); timers.delete(handle); },
    now: () => 0,
    random: length => { r.asked.push(length); return Uint8Array.from({ length }, (_, i) => i * 17); },
  }, event => r.events.push(event));
  return r;
}

test('mintClientId is face- and 24 hex from the random bytes', () => {
  const asked = [];
  const id = mintClientId(length => { asked.push(length); return Uint8Array.from([0x00, 0x01, 0x0f, 0x10, 0x7f, 0x80, 0xab, 0xcd, 0xef, 0xf0, 0xfe, 0xff]); });
  assert.deepEqual(asked, [12]);
  assert.equal(id, 'face-00010f107f80abcdeff0feff');
  assert.match(id, /^face-[0-9a-f]{24}$/);
  assert.match(id, STREAM_CLIENT, "the face's stream route takes it as a client");
  // the stream mints once, at creation, and keeps the tab's id across a reopen
  const r = rig();
  assert.equal(r.stream.clientId, 'face-00112233445566778899aabb');
  r.stream.open(); r.stream.close(); r.stream.open();
  assert.deepEqual(r.asked, [12]);
  assert.deepEqual(r.sources.map(source => query(source.url).get('client')), [r.stream.clientId, r.stream.clientId]);
});

test('open connects with the client id and no since; a frame id becomes lastId; a reopen carries since', () => {
  const r = rig();
  assert.equal(r.stream.status(), 'idle');
  assert.equal(r.stream.lastId(), null);
  r.stream.open();
  assert.equal(r.sources.length, 1);
  assert.equal(r.sources[0].url, `/data/account/stream?client=${r.stream.clientId}`, 'no since before any frame');
  assert.equal(r.stream.status(), 'connecting');
  r.stream.open();
  assert.equal(r.sources.length, 1, 'open on an open stream is a no-op');
  r.sources[0].open();
  assert.equal(r.stream.status(), 'open');
  r.sources[0].fire('hb', { at: 1 });
  assert.equal(r.stream.lastId(), null, 'a frame without an id leaves the resume point unknown');
  r.sources[0].fire('order', { id: 'ord-0010' }, '4dababf8.7');
  assert.equal(r.stream.lastId(), '4dababf8.7');
  r.sources[0].fire('hb', { at: 2 });
  assert.equal(r.stream.lastId(), '4dababf8.7', 'an hb carries the newest id and moves nothing');
  r.stream.close();
  assert.equal(r.stream.lastId(), '4dababf8.7', 'a close forgets nothing');
  r.stream.open();
  assert.equal(r.sources.length, 2);
  assert.equal(r.sources[1].url, `/data/account/stream?client=${r.stream.clientId}&since=4dababf8.7`);
  assert.ok([...r.sources[1].listeners.values()].every(listeners => listeners.length === 1), 'a reopen registers each listener once');
  // an id with query characters in it travels escaped
  r.sources[1].open();
  r.sources[1].fire('fill', { id: 'fill-1' }, 'run+2&x.8');
  r.stream.close(); r.stream.open();
  assert.equal(query(r.sources[2].url).get('since'), 'run+2&x.8');
});

test('a named event reaches onEvent with its id and parsed data; a snapshot is delivered as an event', () => {
  const r = rig();
  r.stream.open();
  const source = r.source();
  assert.deepEqual([...source.listeners.keys()].sort(), [...TYPES].sort(), "one listener for each of the Account's named frames and hb");
  assert.ok([...source.listeners.values()].every(listeners => listeners.length === 1));
  source.open();
  source.fire('hb', { at: 1792654560000 });
  assert.deepEqual(r.events, [{ type: 'hb', id: undefined, data: { at: 1792654560000 } }], 'no id seen yet: id is undefined');
  // the captured stream, replayed as the browser dispatches it: the snapshot is an event like any other
  r.events.length = 0;
  for (const frame of framesOf(readFileSync(new URL('../fixtures/account/stream-frames.txt', import.meta.url), 'utf8'))) source.fire(frame.event, frame.data, frame.id);
  assert.deepEqual(r.events.map(event => [event.type, event.id]), [['snapshot', '4dababf8.0'], ['statement', '4dababf8.1'], ['hb', '4dababf8.1']]);
  const [snapshot, statement, hb] = r.events;
  assert.ok(Array.isArray(snapshot.data.orders) && snapshot.data.orders.length > 0, "the snapshot's data arrives parsed");
  assert.equal(snapshot.data.at, '4dababf8.0');
  assert.equal(statement.data.line.type, 'earn');
  assert.deepEqual(hb.data, { at: 1792654561925 });
  assert.equal(r.stream.lastId(), '4dababf8.1');
  // every named frame, hand-built
  r.events.length = 0;
  TYPES.forEach((type, i) => source.fire(type, { n: i }, `4dababf8.${10 + i}`));
  assert.deepEqual(r.events, TYPES.map((type, i) => ({ type, id: `4dababf8.${10 + i}`, data: { n: i } })));
  // a frame whose data does not parse is dropped; its id is still the resume point
  source.fire('card', '{"id":"card-0001"', '4dababf8.30');
  assert.equal(r.events.length, TYPES.length);
  assert.equal(r.stream.lastId(), '4dababf8.30');
});

test('silence for STALE_MS is stale; for DEAD_MS the source is closed and reopened after RETRY_MS[0], then [1]', () => {
  const r = rig();
  r.stream.open();
  assert.deepEqual(r.delays(), [STALE_MS, DEAD_MS], 'the clocks run from open: a connect that hangs dies too');
  const first = r.source();
  first.open();
  first.fire('order', { id: 'ord-0001' }, '4dababf8.3');
  const before = r.pending();
  first.fire('hb', { at: 1 });
  assert.ok(before.every(timer => r.cancelled.includes(timer.handle)), 'a frame restarts both clocks');
  assert.deepEqual(r.delays(), [STALE_MS, DEAD_MS]);
  r.run(r.pending(STALE_MS)[0]);
  assert.equal(r.stream.status(), 'stale');
  first.fire('hb', { at: 2 });
  assert.equal(r.stream.status(), 'open', 'a frame ends the silence');
  r.run(r.pending(STALE_MS)[0]);
  r.run(r.pending(DEAD_MS)[0]);
  assert.equal(first.closed, true);
  assert.equal(r.stream.status(), 'closed', 'closed while waiting to reopen');
  assert.deepEqual(r.delays(), [RETRY_MS[0]], 'only the reopen is pending');
  r.stream.open();
  assert.equal(r.sources.length, 1, 'open while a reopen is pending is a no-op');
  r.run(r.pending(RETRY_MS[0])[0]);
  assert.equal(r.sources.length, 2);
  assert.equal(query(r.source().url).get('since'), '4dababf8.3', 'the reopen resumes from the last id');
  assert.equal(r.stream.status(), 'connecting');
  r.run(r.pending(STALE_MS)[0]);
  assert.equal(r.stream.status(), 'connecting', 'a source that never opened is connecting, not stale');
  r.run(r.pending(DEAD_MS)[0]);
  assert.equal(r.sources[1].closed, true);
  assert.deepEqual(r.delays(), [RETRY_MS[1]], 'a second dead source in a row waits longer');
  r.run(r.pending()[0]);
  // the face refusing the stream (its 400 or 503: the browser's CLOSED) is a failure too, after an open as well (an
  // open without a frame does not start the delays over), and so is a source that cannot be made
  const third = r.source();
  third.open();
  third.error(0);
  third.error(2);
  assert.deepEqual(r.delays(), [RETRY_MS[2]]);
  r.refuse();
  r.run(r.pending()[0]);
  assert.equal(r.sources.length, 3, 'no source was made');
  assert.equal(r.stream.status(), 'closed');
  assert.deepEqual(r.delays(), [RETRY_MS[3]]);
  r.run(r.pending()[0]);
  // the browser's own reconnect (CONNECTING) is left to it
  const fourth = r.source();
  fourth.open();
  fourth.error(0);
  assert.equal(fourth.closed, false);
  assert.equal(r.stream.status(), 'connecting');
  assert.deepEqual(r.delays(), [STALE_MS, DEAD_MS], 'no reopen of ours is scheduled');
  fourth.open();
  assert.equal(r.stream.status(), 'open');
  // the first frame after a reopen starts the delays over; past the last one they hold at it
  fourth.fire('hb', { at: 3 });
  r.run(r.pending(DEAD_MS)[0]);
  const delays = [];
  for (let i = 0; i < RETRY_MS.length + 1; i += 1) {
    const [reopen] = r.pending();
    delays.push(reopen.ms);
    r.run(reopen);
    r.source().error(2);
  }
  assert.deepEqual(delays, [...RETRY_MS, RETRY_MS.at(-1)]);
});

test('follow posts the set with a rising n on open and on change, drops past 16, and retells once after a failed post', async () => {
  const r = rig();
  r.stream.follow(['okx:BTC-USDT', '~kalshi:KXHIGHNY-25OCT23']);
  r.stream.open();
  r.stream.follow(['okx:BTC-USDT', '~kalshi:KXHIGHNY-25OCT23', 'coinbase:ETH-USD']);
  await settle();
  assert.equal(r.posts.length, 0, 'nothing is told before the stream opens');
  r.source().open();
  await settle();
  assert.equal(r.posts.length, 1);
  assert.equal(r.posts[0].path, FOLLOW_PATH, 'the bare path: the face answers 400 to any query name');
  assert.equal(r.posts[0].init.method, 'POST');
  assert.deepEqual(r.posts[0].init.headers, { 'content-type': 'application/json' }, 'declared JSON: the face answers 415 to anything else');
  assert.deepEqual(r.posts[0].body, { client: r.stream.clientId, markets: ['okx:BTC-USDT', '~kalshi:KXHIGHNY-25OCT23', 'coinbase:ETH-USD'], n: 1 });
  assert.equal(r.pending(1000).length, 0, 'a 2xx needs no retell');
  // the same set again, reordered or repeated, is not news
  r.stream.follow(['coinbase:ETH-USD', 'okx:BTC-USDT', '~kalshi:KXHIGHNY-25OCT23', 'okx:BTC-USDT']);
  await settle();
  assert.equal(r.posts.length, 1);
  // a change is told with the next n; past FOLLOW_LIMIT the extra is dropped
  r.stream.follow(['okx:BTC-USDT']);
  const many = Array.from({ length: FOLLOW_LIMIT + 4 }, (_, i) => `okx:C${i}-USDT`);
  r.stream.follow([many[0], ...many]);
  await settle();
  assert.deepEqual(r.posts.slice(1).map(post => post.body), [
    { client: r.stream.clientId, markets: ['okx:BTC-USDT'], n: 2 },
    { client: r.stream.clientId, markets: many.slice(0, FOLLOW_LIMIT), n: 3 },
  ]);
  // a POST the face did not take (not 2xx) is told once more a second later, and no more
  r.reply = { status: 503 };
  r.stream.follow(['okx:BTC-USDT']);
  await settle();
  assert.equal(r.posts.length, 4);
  r.run(r.pending(1000)[0]);
  await settle();
  assert.deepEqual(r.posts[4].body, { client: r.stream.clientId, markets: ['okx:BTC-USDT'], n: 5 });
  assert.equal(r.pending(1000).length, 0, 'one retell only');
  // a fetcher that throws did not take it either; a later follow starts the rule again
  r.reply = new Error('offline');
  r.stream.follow(['okx:ETH-USDT']);
  await settle();
  assert.equal(r.posts.length, 6);
  r.reply = { status: 200 };
  r.run(r.pending(1000)[0]);
  await settle();
  assert.deepEqual(r.posts[6].body, { client: r.stream.clientId, markets: ['okx:ETH-USDT'], n: 7 });
  assert.equal(r.pending(1000).length, 0);
  // every open tells the set again: the browser's own reconnect, and a fresh source after a close
  r.source().error(0);
  r.stream.follow(['okx:SOL-USDT']);
  await settle();
  assert.equal(r.posts.length, 7, 'a change while reconnecting is kept, not told');
  r.source().open();
  r.stream.close(); r.stream.open(); r.source().open();
  await settle();
  assert.deepEqual(r.posts.slice(7).map(post => [post.body.markets, post.body.n]), [[['okx:SOL-USDT'], 8], [['okx:SOL-USDT'], 9]]);
  assert.ok(r.posts.every(post => post.path === FOLLOW_PATH && post.init.headers['content-type'] === 'application/json'));
});

test('close cancels every timer and closes the source', async () => {
  const r = rig({ reply: { status: 500 } });
  r.stream.follow(['okx:BTC-USDT']);
  r.stream.open();
  const first = r.source();
  first.open();
  first.fire('order', { id: 'ord-0001' }, '4dababf8.4');
  await settle();
  assert.deepEqual(r.delays(), [1000, STALE_MS, DEAD_MS], 'a retell and both clocks are pending');
  r.stream.close();
  assert.equal(first.closed, true);
  assert.equal(r.stream.status(), 'closed');
  assert.deepEqual(r.pending(), [], 'no timer survives a close');
  // a closed source's late frames and errors reach nothing
  first.fire('fill', { id: 'fill-1' }, '4dababf8.5');
  first.error(2);
  assert.deepEqual(r.events.map(event => event.type), ['order']);
  assert.equal(r.stream.lastId(), '4dababf8.4');
  assert.deepEqual(r.pending(), []);
  // a POST in flight when the stream closes: its late refusal schedules nothing
  r.stream.open();
  r.source().open();
  await settle();
  assert.deepEqual(r.delays(), [1000, STALE_MS, DEAD_MS]);
  const late = deferred();
  r.reply = late.promise;
  r.stream.follow(['okx:ETH-USDT']);
  assert.deepEqual(r.delays(), [STALE_MS, DEAD_MS], 'a newer POST replaces the pending retell');
  r.stream.close();
  assert.deepEqual(r.pending(), []);
  late.resolve({ status: 500 });
  await settle();
  assert.deepEqual(r.pending(), []);
  // a close while a reopen is pending cancels the reopen
  r.reply = { status: 200 };
  r.stream.open();
  r.source().error(2);
  assert.deepEqual(r.delays(), [RETRY_MS[0]]);
  r.stream.close();
  assert.deepEqual(r.pending(), []);
  assert.equal(r.sources.length, 3);
  // nothing is forgotten: the next open resumes from the last id and tells the set
  r.stream.open();
  assert.equal(query(r.source().url).get('since'), '4dababf8.4');
  r.source().open();
  await settle();
  assert.deepEqual(r.posts.at(-1).body.markets, ['okx:ETH-USDT']);
});
