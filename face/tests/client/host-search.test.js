// The list's content search layer (host/search.js): debounce, stale answers, blank box, failures, encoding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startSearch, SEARCH_CONTENT_MS } from '../../client/js/host/search.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function rig(getJson) {
  const store = createStore({ initial: emptyState(), reducers });
  const calls = [];
  const timers = {
    list: [], n: 0,
    after(ms, fn) { const id = ++this.n; this.list.push({ id, ms, fn }); return id; },
    cancel(id) { this.list = this.list.filter(t => t.id !== id); },
    fire() { const t = this.list.shift(); t?.fn(); },
  };
  const search = startSearch({ store, getJson: p => { calls.push(p); return getJson(p); }, timers });
  return { store, calls, timers, search };
}
const ok = items => ({ ok: true, items, hasMore: false, indexed: 1 });

test('typing waits 250 ms of quiet before reading', async () => {
  const r = rig(async () => ok([]));
  r.search.type('a'); r.search.type('ab');
  assert.equal(r.store.get().search.query, 'ab');
  assert.equal(r.timers.list.length, 1);
  assert.equal(r.timers.list[0].ms, SEARCH_CONTENT_MS);
  assert.equal(SEARCH_CONTENT_MS, 250);
  assert.deepEqual(r.calls, []);
  r.timers.fire(); await settle();
  assert.deepEqual(r.calls, ['/data/search?q=ab']);
  assert.equal(r.store.get().search.contentPhase, 'done');
});

test('an answer for an older query is dropped', async () => {
  const first = deferred();
  const r = rig(p => (p.endsWith('=a') ? first.promise : Promise.resolve(ok([{ id: 'b' }]))));
  r.search.type('a'); r.timers.fire();
  r.search.type('b'); r.timers.fire(); await settle();
  first.resolve(ok([{ id: 'a' }])); await settle();
  const s = r.store.get().search;
  assert.equal(s.query, 'b');
  assert.deepEqual(s.content, [{ id: 'b' }]);
});

test('a blank box clears at once and reads nothing', async () => {
  const r = rig(async () => ok([]));
  r.search.type('abc');
  r.search.type('   ');
  assert.equal(r.timers.list.length, 0);
  assert.equal(r.store.get().search.contentPhase, 'idle');
  r.search.type('x'); r.search.clear();
  assert.equal(r.timers.list.length, 0);
  assert.equal(r.store.get().search.query, '');
  assert.deepEqual(r.calls, []);
});

test('a failed read keeps the query and marks the content failed', async () => {
  for (const g of [async () => { throw Object.assign(new Error('HTTP 500'), { status: 500 }); }, async () => ({ ok: false, error: 'x' })]) {
    const r = rig(g);
    r.search.type('abc'); r.timers.fire(); await settle();
    const s = r.store.get().search;
    assert.equal(s.query, 'abc');
    assert.equal(s.contentPhase, 'failed');
  }
});

test('the query is sent encoded', async () => {
  const r = rig(async () => ok([]));
  r.search.type('茅台'); r.timers.fire(); await settle();
  assert.deepEqual(r.calls, ['/data/search?q=%E8%8C%85%E5%8F%B0']);
});
