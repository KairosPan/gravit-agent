// The Account host layer (spec 2026-10-22 §6.2): the Account's reads through the face's proxy — the page (/data/account),
// holdings?cost=1 and its paper lens, the leading history curve, the statement and the agents — their cadence and the
// stream's account events, into the store against a recording getJson, recorded timers and the stand-in's fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startAccount, ACCOUNT_POLL_MS, ACCOUNT_POLL_STREAM_MS } from '../../client/js/host/account.js';
import { renderAccountScreen } from '../../client/js/render/account.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
// a fixture of the stand-in's answers, parsed afresh for every call so no test sees another's copy
const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
// the stand-in's page: real money $29,138.10 (totalUsd) beside two paper venues
const page = (over = {}) => ({ ...fx('account'), ...over });
// the same page without its paper venues: no paper lens to follow
const noPaper = (over = {}) => page({ venues: fx('account').venues.filter(v => v.paper !== true), ...over });
// the app's getJson on a status that is not OK: an Error with the status and, where the app attaches it, the parsed body
const rejected = (path, status, body) => Object.assign(new Error(`${path}: HTTP ${status}`), { status }, body === undefined ? {} : { body });
// answers handed out one a read, in order
const inTurn = answers => () => { const next = answers.shift(); return next instanceof Error ? Promise.reject(next) : Promise.resolve(next); };
// the Portfolio's leading figure as drawn: [its label, its amount]
const leadOf = html => html.match(/<div class="label">([^<]*)<\/div><div class="networth">([^<]*)<\/div>/)?.slice(1) ?? null;

// the host over a recording getJson — `json` answers a path by its exact text, else by the path without its fresh=1, else by
// the path without its query: a body, an Error it rejects with, or a function of the path returning a promise — and recorded
// timers ({ fn, ms, handle }, kept until run or cancelled); streamOpen answers r.streamIsOpen
function rig({ json = {} } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const reads = [];
  const getJson = path => {
    reads.push(path);
    const key = [path, path.replace(/[?&]fresh=1$/, ''), path.split('?')[0]].find(k => Object.hasOwn(json, k));
    const answer = key === undefined ? undefined : json[key];
    if (typeof answer === 'function') return answer(path);
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  const timers = new Map();
  let serial = 0;
  let t = 100;
  const r = {
    store, reads, cancelled: [], streamIsOpen: false,
    a: () => store.get().account,
    pending: () => [...timers.values()],
    run(timer) {
      assert.ok(timer && timers.has(timer.handle), 'the timer is pending');
      timers.delete(timer.handle);
      timer.fn();
    },
  };
  r.account = startAccount({
    store, getJson, now: () => ++t,
    schedule: (fn, ms) => { const timer = { fn, ms, handle: ++serial }; timers.set(timer.handle, timer); return timer.handle; },
    cancelTimer: handle => { r.cancelled.push(handle); timers.delete(handle); },
    streamOpen: () => r.streamIsOpen,
  });
  return r;
}

test('load reads /data/account once for two callers; fresh reads ?fresh=1 and does not join a plain flight', async () => {
  const release = {};
  const r = rig({ json: { '/data/account': path => new Promise(res => { release[path] = res; }) } });
  assert.equal(r.a().status, 'idle');
  const plain = r.account.load();
  assert.equal(r.account.load(), plain, 'a second caller joins the flight');
  assert.equal(r.a().status, 'loading');
  await tick();
  assert.deepEqual(r.reads, ['/data/account']);
  const fresh = r.account.load({ fresh: true });
  assert.notEqual(fresh, plain, 'a fresh ask does not join a plain flight');
  assert.equal(r.account.load({ fresh: true }), fresh, 'a second fresh ask shares the fresh flight');
  assert.equal(r.account.load(), fresh, 'and so does a plain one');
  await tick();
  assert.deepEqual(r.reads, ['/data/account'], 'the fresh read waits for the plain one in the air');
  release['/data/account'](noPaper({ totalUsd: 100 }));
  await plain;
  await tick();
  assert.equal(r.a().data, null, 'the plain answer a fresh ask overtook is never drawn');
  assert.equal(r.a().status, 'loading');
  assert.deepEqual(r.reads, ['/data/account', '/data/account?fresh=1'], 'then the fresh one, once it settled');
  release['/data/account?fresh=1'](noPaper({ totalUsd: 200 }));
  await fresh;
  assert.equal(r.a().status, 'ready');
  assert.equal(r.a().data.totalUsd, 200);
  assert.equal(typeof r.a().at, 'number');
  assert.equal(r.a().message, null);
  void r.account.load();
  await tick();
  assert.deepEqual(r.reads, ['/data/account', '/data/account?fresh=1', '/data/account'], 'a load after the flights landed reads again');
});

test('a 409 refusal keeps the last data and carries the Account message', async () => {
  const r = rig({
    json: {
      '/data/account': inTurn([
        noPaper(),
        rejected('/data/account', 409, { ok: false, refusal: { code: 'E_ACCOUNT_LOCKED', message: 'The Account is locked until its owner signs in.' } }),
        noPaper(),
        { ok: false, error: 'venues are still settling' },
        { ok: false, error: { code: 'E_ODD' } },
        rejected('/data/account', 503, { ok: false, unreachable: 'ECONNREFUSED' }),
        rejected('/data/account', 502),
      ]),
    },
  });
  await r.account.load();
  assert.equal(r.a().status, 'ready');
  const kept = r.a().data;
  await r.account.load();
  assert.equal(r.a().status, 'error');
  assert.equal(r.a().message, 'The Account is locked until its owner signs in.', "the refusal's sentence, from the rejection's body");
  assert.equal(r.a().data, kept, 'the last page stays');
  await r.account.load();
  assert.equal(r.a().status, 'ready');
  assert.equal(r.a().message, null, 'a page clears the sentence');
  await r.account.load();
  assert.equal(r.a().status, 'error', 'an ok:false body on a 200 is a failure');
  assert.equal(r.a().message, 'venues are still settling');
  assert.equal(r.a().data.ok, true, 'never the refusal as data');
  await r.account.load();
  assert.equal(r.a().message, null, 'words only when they are text');
  await r.account.load();
  assert.equal(r.a().status, 'error');
  assert.equal(r.a().message, null, 'unreachable carries no sentence');
  await r.account.load();
  assert.equal(r.a().status, 'error');
  assert.equal(r.a().message, null, 'a rejection without a body carries none');
  assert.ok(r.a().data.connectLive, 'the last page stays');
});

// an Account that moved its API answers a 200 the face does not recognise: that answer lands as the page, so the screen says
// Account unreadable and draws no figure from it — never an outage, never the last page's numbers passed off as current
test('an unrecognised page lands and reads unreadable', async () => {
  const moved = { ...noPaper(), venues: undefined };   // a 200 body without its venues
  const r = rig({
    json: {
      '/data/account': inTurn([
        noPaper(),
        moved,
        rejected('/data/account', 409, { ok: false, refusal: { code: 'E_ACCOUNT_LOCKED', message: 'The Account is locked until its owner signs in.' } }),
        noPaper({ totalUsd: 300 }),
        '',
      ]),
    },
  });
  const portfolio = () => renderAccountScreen({ ...r.store.get(), route: { screen: 'account', tab: 'portfolio' } }, Date.now());
  await r.account.load();
  assert.match(portfolio(), /\$29,138\.10/, 'the recognised page draws its figure');
  await r.account.load();
  assert.equal(r.a().status, 'ready', 'a 2xx answer that is no refusal lands, recognised or not');
  assert.equal(r.a().data, moved, 'the page as it came');
  assert.equal(r.a().message, null);
  assert.deepEqual(r.reads, ['/data/account', '/data/account'], 'no paper lens is read for a page that names no venue');
  assert.match(portfolio(), /Account unreadable/);
  assert.doesNotMatch(portfolio(), /\$29,138\.10|Account unavailable|Loading…/, 'never a number from it, never an outage');
  // a refusal after it: a failure with the Account's sentence, the unreadable page kept
  await r.account.load();
  assert.equal(r.a().status, 'error');
  assert.equal(r.a().message, 'The Account is locked until its owner signs in.');
  assert.equal(r.a().data, moved);
  // the Account back on its own shape: its page again
  await r.account.load();
  assert.equal(r.a().status, 'ready');
  assert.equal(r.a().data.totalUsd, 300);
  // an empty 2xx body is nothing to draw: a failure, the last page kept
  await r.account.load();
  assert.equal(r.a().status, 'error');
  assert.equal(r.a().data.totalUsd, 300);
});

// an unrecognised page that still names paper venues leads no read: no paper lens, and so no curve chosen without the page;
// the recognised page after it — real money at zero, paper venues — reads the lens and the curve it leads to, Paper's, so a
// Paper-led Portfolio never draws real money's change and curve under the Paper figure
test('an unrecognised page naming paper venues reads no lens; the recognised page after it reads the lens and the paper curve', async () => {
  const unrecognised = { ...page({ totalUsd: 0 }), connectLive: undefined };   // its paper venues kept
  const r = rig({
    json: {
      '/data/account': inTurn([unrecognised, page({ totalUsd: 0 })]),
      '/data/account/holdings?cost=1': fx('holdings'),
      '/data/account/holdings?cost=1&paper=1': fx('holdings-paper'),
      '/data/account/history': path => Promise.resolve(path.includes('&paper=1') ? fx('history-paper') : fx('history')),
    },
  });
  await r.account.load();
  await settle();
  assert.equal(r.a().data, unrecognised, 'the unrecognised page landed');
  assert.deepEqual(r.reads, ['/data/account'], 'no lens and no curve read for it');
  assert.equal(r.a().paper.data, null);
  await r.account.load();
  await settle();
  // after a page it did not recognise, the holdings past the face's cache
  assert.deepEqual(r.reads, ['/data/account', '/data/account', '/data/account/holdings?cost=1&fresh=1', '/data/account/holdings?cost=1&paper=1&fresh=1',
    '/data/account/history?range=1d&paper=1']);
  assert.equal(r.a().paper.status, 'ready');
  assert.equal(r.a().history.data.paper, true, "the paper book's curve");
  const html = renderAccountScreen({ ...r.store.get(), route: { screen: 'account', tab: 'portfolio' } }, Date.now());
  assert.match(html, /\$25,400\.00/, 'Paper leads');
  assert.match(html, /rebuilt/, "the paper curve's words");
  assert.doesNotMatch(html, /\+\$208\.78/, "never real money's change under the Paper figure");
  // a money event under an unrecognised page reads the real holdings alone, never the lens
  const under = rig({ json: { '/data/account': unrecognised, '/data/account/holdings?cost=1': fx('holdings') } });
  under.store.dispatch('accountLoaded', { data: unrecognised, at: 1 });
  under.account.onStreamEvent({ type: 'fill', id: '4dababf8.8', data: {} });
  await settle();
  assert.deepEqual([...under.reads].sort(), ['/data/account/holdings?cost=1&fresh=1', '/data/account?fresh=1'].sort());
});

// a warm session — the lens read under a recognised page — then a read under an unrecognised page that chose real money's
// curve without the page (a snapshot: the stream's first frame, on every reconnect), then the recognised page again: it reads
// the lens again and the paper curve after it, so Paper never keeps real money's change and curve under its figure
test('after an unrecognised page the recognised page reads the lens again, then the paper curve', async () => {
  const unrecognised = { ...page({ totalUsd: 0 }), connectLive: undefined };   // its paper venues kept
  const r = rig({
    json: {
      '/data/account': inTurn([page({ totalUsd: 0 }), unrecognised, page({ totalUsd: 0 }), page({ totalUsd: 0 })]),
      '/data/account/holdings?cost=1': fx('holdings'),
      '/data/account/holdings?cost=1&paper=1': fx('holdings-paper'),
      '/data/account/history': path => Promise.resolve(path.includes('&paper=1') ? fx('history-paper') : fx('history')),
      '/data/account/statement': fx('statement'),
      '/data/account/agents': fx('agents'),
    },
  });
  const portfolio = () => renderAccountScreen({ ...r.store.get(), route: { screen: 'account', tab: 'portfolio' } }, Date.now());
  await r.account.load();
  await settle();
  assert.equal(r.a().paper.data.totalUsd, 25400, 'warm: the lens read');
  assert.equal(r.a().history.data.paper, true, "and Paper's curve");
  // the snapshot's page answers unrecognised: its holdings read is real money's alone, and its curve real money's
  r.reads.length = 0;
  r.account.onStreamEvent({ type: 'snapshot', id: '4dababf8.0', data: {} });
  await settle();
  assert.equal(r.a().data, unrecognised);
  assert.deepEqual([...r.reads].sort(), ['/data/account/agents', '/data/account/history?range=1d', '/data/account/holdings?cost=1&fresh=1',
    '/data/account/statement?fresh=1', '/data/account?fresh=1']);
  assert.equal(r.a().history.data.paper, undefined, "real money's curve, chosen without the page");
  // the recognised page again, on the page's own beat: the lens again, past the face's cache, then the curve it leads to
  r.reads.length = 0;
  await r.account.load();
  await settle();
  assert.deepEqual(r.reads, ['/data/account', '/data/account/holdings?cost=1&fresh=1', '/data/account/holdings?cost=1&paper=1&fresh=1',
    '/data/account/history?range=1d&paper=1']);
  assert.equal(r.a().history.data.paper, true, "the paper book's curve again");
  const html = portfolio();
  assert.deepEqual(leadOf(html), ['Paper', '$25,400.00'], 'Paper leads');
  assert.match(html, /rebuilt/, "the paper curve's words");
  assert.doesNotMatch(html, /\+\$208\.78|\$28,948\.81/, "never real money's change or curve under the Paper figure");
  // once read again, a recognised page landing leaves the lens to its own reads
  r.reads.length = 0;
  await r.account.load();
  await settle();
  assert.equal(r.a().status, 'ready', 'a recognised page landed');
  assert.deepEqual(r.reads, ['/data/account']);
});

// a money event under an unrecognised page reads no lens; the recognised page after it — here the event's own page read, the
// Account back on its shape — reads the lens again past the face's cache, which keeps a holdings answer 8 s (ACCOUNT_TTL_MS)
// and so would hand back the lens from before the event; Paper draws the book after the event, never the one before as current
test('a money event under an unrecognised page: the recognised page after it reads the lens past the cache, the total after the event', async () => {
  const unrecognised = { ...page({ totalUsd: 0 }), connectLive: undefined };
  const r = rig({
    json: {
      '/data/account': inTurn([page({ totalUsd: 0 }), unrecognised, page({ totalUsd: 0 })]),
      '/data/account/holdings?cost=1': fx('holdings'),
      // the face's kept copy is the book from before the event; past the cache the Account answers the book after it
      '/data/account/holdings?cost=1&paper=1': fx('holdings-paper'),
      '/data/account/holdings?cost=1&paper=1&fresh=1': { ...fx('holdings-paper'), totalUsd: 26000 },
      '/data/account/history': path => Promise.resolve(path.includes('&paper=1') ? fx('history-paper') : fx('history')),
    },
  });
  const portfolio = () => renderAccountScreen({ ...r.store.get(), route: { screen: 'account', tab: 'portfolio' } }, Date.now());
  await r.account.load();
  await settle();
  assert.equal(r.a().paper.data.totalUsd, 25400, 'warm: the lens read');
  await r.account.load();
  await settle();
  assert.equal(r.a().data, unrecognised);
  // a paper event: the real holdings and the page past the cache, no lens under the unrecognised page; the page answers on
  // the Account's own shape again, and its landing reads the lens past the cache, then the curve
  r.reads.length = 0;
  r.account.onStreamEvent({ type: 'paper', id: '4dababf8.9', data: {} });
  await settle();
  assert.deepEqual([...r.reads].sort(), ['/data/account/history?range=1d&paper=1', '/data/account/holdings?cost=1&fresh=1',
    '/data/account/holdings?cost=1&paper=1&fresh=1', '/data/account?fresh=1']);
  assert.equal(r.a().paper.data.totalUsd, 26000, 'the paper book after the event');
  assert.deepEqual(leadOf(portfolio()), ['Paper', '$26,000.00'], 'Paper leads with the book after the event, never the one before it as current');
});

test('loadHoldings reads cost=1, and cost=1&paper=1 only when a paper venue is connected', async () => {
  const r = rig({
    json: {
      '/data/account/holdings?cost=1': fx('holdings'),
      '/data/account/holdings?cost=1&paper=1': inTurn([fx('holdings-paper'), rejected('/data/account/holdings', 503, { ok: false, unreachable: 'timeout' })]),
    },
  });
  // no page read yet: no paper venue known, real money's read alone
  await r.account.loadHoldings();
  assert.deepEqual(r.reads, ['/data/account/holdings?cost=1']);
  assert.equal(r.a().holdings.status, 'ready');
  assert.equal(r.a().holdings.data.totalUsd, 29138.1);
  assert.equal(typeof r.a().holdings.at, 'number');
  assert.equal(r.a().paper.status, 'idle');
  // the stand-in's page names two paper venues: both reads in parallel, each once for two callers
  r.store.dispatch('accountLoaded', { data: page(), at: 1 });
  r.reads.length = 0;
  const one = r.account.loadHoldings();
  const two = r.account.loadHoldings();
  assert.equal(r.a().holdings.status, 'loading');
  assert.equal(r.a().paper.status, 'loading');
  await Promise.all([one, two]);
  assert.deepEqual(r.reads, ['/data/account/holdings?cost=1', '/data/account/holdings?cost=1&paper=1']);
  assert.equal(r.a().paper.status, 'ready');
  assert.equal(r.a().paper.data.totalUsd, 25400);
  // the paper lens unreachable: an error, its last data kept
  await r.account.loadHoldings();
  assert.equal(r.a().paper.status, 'error');
  assert.equal(r.a().paper.data.totalUsd, 25400, 'the last paper lens stays');
  assert.equal(r.a().holdings.status, 'ready');
  // a page with no paper venue: the lens is not read
  r.store.dispatch('accountLoaded', { data: noPaper(), at: 1 });
  r.reads.length = 0;
  await r.account.loadHoldings();
  assert.deepEqual(r.reads, ['/data/account/holdings?cost=1']);
});

test('loadHistory reads the leading curve: paper=1 when paper leads', async () => {
  let hold = false;
  const held = [];
  const r = rig({
    json: {
      '/data/account/history': path => (hold ? new Promise(res => held.push(res))
        : Promise.resolve(path.includes('&paper=1') ? fx('history-paper') : fx('history'))),
    },
  });
  assert.equal(r.a().history.range, '1d');
  // nothing read yet: real money's curve for the slice's range
  await r.account.loadHistory();
  assert.deepEqual(r.reads, ['/data/account/history?range=1d']);
  assert.equal(r.a().history.status, 'ready');
  assert.equal(r.a().history.data.changeUsd, 208.78);
  // the stand-in: real money leads, the paper lens beside it — real money's curve, for the range asked
  r.store.dispatch('accountLoaded', { data: page(), at: 1 });
  r.store.dispatch('holdingsLoaded', { data: fx('holdings'), at: 1 });
  r.store.dispatch('paperLoaded', { data: fx('holdings-paper'), at: 1 });
  await r.account.loadHistory('1w');
  assert.equal(r.a().history.range, '1w');
  assert.equal(r.reads.at(-1), '/data/account/history?range=1w');
  // real money at zero, a paper venue and the paper total: Paper leads, and one read, its curve
  r.store.dispatch('accountLoaded', { data: page({ totalUsd: 0 }), at: 2 });
  r.reads.length = 0;
  await r.account.loadHistory();
  assert.deepEqual(r.reads, ['/data/account/history?range=1w&paper=1']);
  assert.equal(r.a().history.data.paper, true);
  assert.equal(r.a().history.data.rebuilt, true);
  // a range the slice does not know leaves its own
  r.reads.length = 0;
  await r.account.loadHistory('5y');
  assert.equal(r.a().history.range, '1w');
  assert.deepEqual(r.reads, ['/data/account/history?range=1w&paper=1']);
  // one read a range for two callers; a read for a range the screen has left when it lands is dropped
  hold = true;
  r.reads.length = 0;
  const month = r.account.loadHistory('1m');
  assert.equal(r.account.loadHistory('1m'), month);
  assert.equal(r.a().history.status, 'loading');
  r.store.dispatch('setHistoryRange', 'all');
  await tick();
  held.shift()({ ...fx('history-paper'), range: '1m', changeUsd: 12 });
  await month;
  assert.deepEqual(r.reads, ['/data/account/history?range=1m&paper=1']);
  assert.equal(r.a().history.data.range, '1w', "the month's curve never lands under All");
  const all = r.account.loadHistory();
  await tick();
  held.shift()({ ...fx('history-paper'), range: 'all' });
  await all;
  assert.equal(r.reads.at(-1), '/data/account/history?range=all&paper=1');
  assert.equal(r.a().history.status, 'ready');
  assert.equal(r.a().history.data.range, 'all');
  // a history read that fails keeps its last curve
  const failed = rig({ json: { '/data/account/history': inTurn([fx('history'), { ok: false, error: 'no source answered' }]) } });
  await failed.account.loadHistory();
  await failed.account.loadHistory();
  assert.equal(failed.a().history.status, 'error');
  assert.equal(failed.a().history.data.changeUsd, 208.78);
});

test('stream events: order and fill reload holdings and the page fresh; statement reloads the statement; a snapshot reloads everything', async () => {
  const r = rig({
    json: {
      '/data/account': page(),
      '/data/account/holdings?cost=1': fx('holdings'),
      '/data/account/holdings?cost=1&paper=1': fx('holdings-paper'),
      '/data/account/history': fx('history'),
      '/data/account/statement': fx('statement'),
      '/data/account/agents': fx('agents'),
    },
  });
  r.store.dispatch('accountLoaded', { data: page(), at: 1 });   // the page names its paper venues
  const after = async (...events) => {
    r.reads.length = 0;
    for (const ev of events) r.account.onStreamEvent(ev);
    await settle();
    return [...r.reads].sort();
  };
  // every read an event names goes past the face's cache
  const moved = ['/data/account/holdings?cost=1&fresh=1', '/data/account/holdings?cost=1&paper=1&fresh=1', '/data/account?fresh=1'].sort();
  for (const type of ['order', 'fill', 'paper', 'balance', 'position']) {
    assert.deepEqual(await after({ type, id: '4dababf8.2', data: {} }), moved, type);
  }
  assert.equal(r.a().holdings.status, 'ready');
  assert.equal(r.a().paper.status, 'ready');
  assert.deepEqual(await after({ type: 'statement', id: '4dababf8.3', data: { venue: 'ex' } }), ['/data/account/statement?fresh=1']);
  assert.equal(r.a().statement.status, 'ready');
  assert.deepEqual(await after({ type: 'card', id: '4dababf8.4', data: {} }), ['/data/account?fresh=1']);
  for (const type of ['desk', 'quote', 'trades', 'book', 'hb']) assert.deepEqual(await after({ type, id: undefined, data: {} }), [], type);
  assert.deepEqual(await after(null, {}), [], 'what is not an event is ignored');
  // a burst in one tick: the reads in the air are joined, one a kind
  const burst = Array.from({ length: 10 }, (_, i) => ({ type: i % 2 ? 'fill' : 'order', id: `4dababf8.${10 + i}`, data: {} }));
  assert.deepEqual(await after(...burst), moved, 'ten events in a tick: one read of each');
  // a snapshot: every account read again, the holdings and the statement past the cache
  assert.equal(r.a().agents.status, 'idle');
  assert.deepEqual(await after({ type: 'snapshot', id: '4dababf8.0', data: {} }),
    [...moved, '/data/account/history?range=1d', '/data/account/statement?fresh=1', '/data/account/agents'].sort());
  assert.equal(r.a().agents.status, 'ready');
  assert.equal(r.a().history.status, 'ready');
  assert.equal(r.a().status, 'ready');
  // the stream's first frame is a snapshot, often before anything is read: the holdings follow the page (the paper venue
  // is known from it) and the history follows the holdings (Paper leads only with its total); the page's landing leaves
  // the paper lens to the snapshot's own fresh read, so the holdings are read once each
  const cold = rig({
    json: {
      '/data/account': page({ totalUsd: 0 }),
      '/data/account/holdings?cost=1': fx('holdings'),
      '/data/account/holdings?cost=1&paper=1': fx('holdings-paper'),
      '/data/account/history': fx('history-paper'),
      '/data/account/statement': fx('statement'),
      '/data/account/agents': fx('agents'),
    },
  });
  cold.account.onStreamEvent({ type: 'snapshot', id: '4dababf8.0', data: {} });
  await settle();
  assert.deepEqual([...cold.reads].sort(),
    [...moved, '/data/account/history?range=1d&paper=1', '/data/account/statement?fresh=1', '/data/account/agents'].sort());
  assert.equal(cold.a().history.data.paper, true);
});

test('a money event while a plain holdings read is in the air: one fresh read once it settles, its answer the one kept', async () => {
  const release = [];
  const r = rig({ json: { '/data/account': noPaper(), '/data/account/holdings': () => new Promise(res => release.push(res)) } });
  const holdingsReads = () => r.reads.filter(path => path.startsWith('/data/account/holdings'));
  r.store.dispatch('accountLoaded', { data: noPaper(), at: 1 });
  const plain = r.account.loadHoldings();
  await tick();
  assert.deepEqual(holdingsReads(), ['/data/account/holdings?cost=1']);
  // a fill, then another and an order in the same tick: past the cache, but only once the read in the air settles
  r.account.onStreamEvent({ type: 'fill', id: '4dababf8.5', data: {} });
  r.account.onStreamEvent({ type: 'fill', id: '4dababf8.6', data: {} });
  r.account.onStreamEvent({ type: 'order', id: '4dababf8.7', data: {} });
  await tick();
  assert.deepEqual(holdingsReads(), ['/data/account/holdings?cost=1'], 'nothing more while the plain read is in the air');
  release.shift()({ ...fx('holdings'), totalUsd: 100 });   // the book from before the fill
  await plain;
  await tick();
  assert.deepEqual(holdingsReads(), ['/data/account/holdings?cost=1', '/data/account/holdings?cost=1&fresh=1'], 'then one trailing fresh read');
  assert.equal(r.a().holdings.data, null, 'the answer that began before the fill is never drawn');
  assert.equal(r.a().holdings.status, 'loading');
  release.shift()({ ...fx('holdings'), totalUsd: 200 });
  await settle();
  assert.equal(r.a().holdings.status, 'ready');
  assert.equal(r.a().holdings.data.totalUsd, 200, "the fresh read's answer is the one kept");
  assert.equal(holdingsReads().length, 2, 'two reads in all');
});

test('a page that names a paper venue whose lens was never read reads the holdings at once, then the leading curve', async () => {
  const r = rig({
    json: {
      '/data/account': inTurn([noPaper(), page({ totalUsd: 0 }), page({ totalUsd: 0 })]),
      '/data/account/holdings?cost=1': fx('holdings'),
      '/data/account/holdings?cost=1&paper=1': fx('holdings-paper'),
      '/data/account/history': path => Promise.resolve(path.includes('&paper=1') ? fx('history-paper') : fx('history')),
    },
  });
  await r.account.load();
  await settle();
  assert.deepEqual(r.reads, ['/data/account'], 'no paper venue: no lens to read');
  // a paper venue appears outside a snapshot: its lens follows without waiting for a money event, and the curve after the lens
  // — Paper's, which leads now that the lens has a total and real money is zero
  await r.account.load();
  await settle();
  assert.deepEqual(r.reads, ['/data/account', '/data/account', '/data/account/holdings?cost=1', '/data/account/holdings?cost=1&paper=1', '/data/account/history?range=1d&paper=1']);
  assert.equal(r.a().paper.status, 'ready');
  assert.equal(r.a().paper.data.totalUsd, 25400);
  assert.equal(r.a().history.data.paper, true, "the paper book's curve");
  // once the lens is read, a page landing leaves it to its own reads
  await r.account.load();
  await settle();
  assert.equal(r.reads.length, 6);
});

// the holdings and the statement keep the Account's sentence when they refuse (as the page does), from an ok:false body or the
// body a rejection carries
test("a refused holdings or statement read carries the Account's sentence; unreachable carries none", async () => {
  const r = rig({
    json: {
      '/data/account/holdings?cost=1': inTurn([fx('holdings'), rejected('/data/account/holdings', 409, { ok: false, refusal: { code: 'E_ACCOUNT_SETTLING', message: 'Venues are still settling.' } })]),
      '/data/account/statement': inTurn([{ ok: false, error: 'the statement is being rebuilt' }, rejected('/data/account/statement', 503, { ok: false, unreachable: 'timeout' })]),
    },
  });
  await r.account.loadHoldings();
  await r.account.loadHoldings();
  assert.equal(r.a().holdings.status, 'error');
  assert.equal(r.a().holdings.message, 'Venues are still settling.', "the refusal's sentence, from the rejection's body");
  assert.equal(r.a().holdings.data.totalUsd, 29138.1, 'the last holdings stay');
  await r.account.loadStatement();
  assert.equal(r.a().statement.status, 'error');
  assert.equal(r.a().statement.message, 'the statement is being rebuilt', 'an ok:false body on a 200');
  await r.account.loadStatement();
  assert.equal(r.a().statement.message, null, 'unreachable carries no sentence');
});

test('poll schedules every 20 s, 80 s while the stream is open; poll(false) cancels', async () => {
  assert.equal(ACCOUNT_POLL_MS, 20_000);
  assert.equal(ACCOUNT_POLL_STREAM_MS, 80_000);
  const release = [];
  const r = rig({ json: { '/data/account': () => new Promise(res => release.push(res)) } });
  r.account.poll(true);
  r.account.poll(true);
  assert.deepEqual(r.pending().map(timer => timer.ms), [ACCOUNT_POLL_MS], 'one timer however often poll(true) is called');
  assert.deepEqual(r.reads, [], 'the first read waits an interval');
  r.run(r.pending()[0]);
  await tick();
  assert.deepEqual(r.reads, ['/data/account'], 'a tick reads the page, plain');
  assert.deepEqual(r.pending().map(timer => timer.ms), [ACCOUNT_POLL_MS], 'and schedules the next');
  release.shift()(noPaper());
  await settle();
  assert.equal(r.a().status, 'ready');
  // the stream open: the next interval is 80 s, decided as each one is scheduled
  r.streamIsOpen = true;
  r.run(r.pending()[0]);
  assert.deepEqual(r.pending().map(timer => timer.ms), [ACCOUNT_POLL_STREAM_MS]);
  r.streamIsOpen = false;
  r.run(r.pending()[0]);
  assert.deepEqual(r.pending().map(timer => timer.ms), [ACCOUNT_POLL_MS], 'back to 20 s when the stream is not open');
  await tick();
  assert.equal(r.reads.length, 2, 'a tick while a read is in the air joins it');
  // poll(false) cancels the timer, once
  const [timer] = r.pending();
  r.account.poll(false);
  r.account.poll(false);
  assert.deepEqual(r.pending(), []);
  assert.deepEqual(r.cancelled, [timer.handle]);
  // close(): the timer cancelled, the read still in the air lands nothing, the fresh one queued behind it never starts, and
  // nothing is read or scheduled after
  r.account.poll(true);
  const [again] = r.pending();
  void r.account.load({ fresh: true });
  const before = r.store.get();
  r.account.close();
  assert.deepEqual(r.pending(), []);
  assert.deepEqual(r.cancelled, [timer.handle, again.handle]);
  release.shift()(noPaper({ totalUsd: 1 }));
  await settle();
  assert.equal(r.store.get(), before, 'a read landing after close() dispatches nothing');
  r.account.poll(true);
  void r.account.load({ fresh: true });
  r.account.onStreamEvent({ type: 'snapshot', id: '4dababf8.0', data: {} });
  await settle();
  assert.deepEqual(r.pending(), [], 'a closed host schedules nothing');
  assert.equal(r.reads.length, 2, 'and reads nothing');
  assert.equal(r.store.get(), before);
});
