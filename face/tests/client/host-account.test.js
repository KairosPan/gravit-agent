// The Account host layer (spec 2026-10-22 §6.2): the Account's reads through the face's proxy — the page (/data/account),
// holdings?cost=1 and its paper lens, the leading history curve, the statement and the agents — their cadence and the
// stream's account events, into the store against a recording getJson, recorded timers and the stand-in's fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startAccount, ACCOUNT_POLL_MS, ACCOUNT_POLL_STREAM_MS, SIGNIN_POLL_MS, SIGNIN_WITHIN_MS } from '../../client/js/host/account.js';
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
function rig({ json = {}, onPage, post, openTab } = {}) {
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
    // the rig's clock moved on by `ms`
    clock: ms => { t += ms; },
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
    ...(onPage ? { onPage } : {}),
    ...(post ? { post } : {}),
    ...(openTab ? { openTab } : {}),
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

// plan 2 Task 13: the owner device reads its standing off every page that lands — the hook hears each one, recognised or not,
// after the slice has it, and never a refusal or an empty body
test('onPage hears every page that lands, recognised or not, never a refusal or an empty body', async () => {
  const moved = { ...noPaper(), venues: undefined };
  const heard = [];
  const r = rig({
    json: {
      '/data/account': inTurn([
        noPaper(),
        moved,
        rejected('/data/account', 409, { ok: false, refusal: { code: 'E_ACCOUNT_LOCKED', message: 'Locked.' } }),
        { ok: false, error: 'no' },
        '',
      ]),
    },
    onPage: body => heard.push([body, r.a().data === body]),
  });
  for (let i = 0; i < 5; i++) await r.account.load({ fresh: i > 0 });
  assert.equal(heard.length, 2);
  assert.equal(heard[0][0].totalUsd, 29138.1);
  assert.equal(heard[1][0], moved, 'an unrecognised page too');
  assert.deepEqual(heard.map(([, landed]) => landed), [true, true], 'heard after the slice has it');
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

// the Venues' keys (plan 2 Task 8): where this account can connect, the kept paper books, a key file's check and a venue's
// reach — each one flight at a time into its slice, keeping the Account's sentence when it refuses
test('loadVenuesHere, loadPaperBooks, checkKeyfile and reach land their answers in their slices', async () => {
  const keyfilePath = '/data/account/keyfile?kind=alpaca-paper&venue=alpaca-paper&ref=credentials%2Falpaca-paper%2Fapi-key.json';
  const reachPath = '/data/account/connect/reach?connector=live%3Aalpaca-paper';
  const reachBody = { ok: true, reach: [{ connector: 'live:alpaca-paper', state: 'ok', at: '2026-10-24T15:00:00.000Z' }] };
  const r = rig({ json: { '/data/account/venues': fx('venues'), '/data/account/paper/books': fx('paper-books'), [keyfilePath]: fx('keyfile'), [reachPath]: reachBody } });
  for (const key of ['venuesHere', 'paperBooks', 'reach']) assert.deepEqual(r.a()[key], { status: 'idle', data: null, at: null, message: null }, key);
  assert.deepEqual(r.a().keyfile, { status: 'idle', data: null, at: null, message: null, asked: null });

  const venues = r.account.loadVenuesHere();
  assert.equal(r.account.loadVenuesHere(), venues, 'a second caller joins the flight');
  assert.equal(r.a().venuesHere.status, 'loading');
  await venues;
  assert.equal(r.a().venuesHere.status, 'ready');
  assert.deepEqual(r.a().venuesHere.data, fx('venues'));
  await r.account.loadPaperBooks();
  assert.deepEqual([r.a().paperBooks.status, r.a().paperBooks.data], ['ready', fx('paper-books')]);
  // the key file's check records what it asked, so the sheet draws its words only for the form it was asked for
  const asked = { kind: 'alpaca-paper', venue: 'alpaca-paper', ref: 'credentials/alpaca-paper/api-key.json' };
  const check = r.account.checkKeyfile(asked);
  assert.deepEqual(r.a().keyfile.asked, { ...asked, exchange: '' }, 'asked as soon as the check starts');
  assert.equal(r.a().keyfile.status, 'loading');
  await check;
  assert.deepEqual([r.a().keyfile.status, r.a().keyfile.data], ['ready', fx('keyfile')]);
  await r.account.reach('live:alpaca-paper');
  assert.deepEqual([r.a().reach.status, r.a().reach.data], ['ready', reachBody]);
  assert.deepEqual(r.reads, ['/data/account/venues', '/data/account/paper/books', keyfilePath, reachPath]);
  // none of them asks past the face's cache: venues and books carry no fresh, and the proxy refuses a name it does not list
  assert.ok(r.reads.every(p => !p.includes('fresh')));
});

test("checkKeyfile asks only what it is given — a blank path is the Account's default — and with the exchange for an exchange account", async () => {
  const r = rig({ json: { '/data/account/keyfile': fx('keyfile') } });
  await r.account.checkKeyfile({ kind: 'alpaca-paper', venue: 'alpaca-paper', ref: '' });
  await r.account.checkKeyfile({ kind: 'exchange', venue: 'okx', ref: 'credentials/okx/key.json', exchange: 'okx' });
  await r.account.checkKeyfile({ kind: 'kalshi', venue: 7, ref: null });
  assert.deepEqual(r.reads, [
    '/data/account/keyfile?kind=alpaca-paper&venue=alpaca-paper',
    '/data/account/keyfile?kind=exchange&venue=okx&ref=credentials%2Fokx%2Fkey.json&exchange=okx',
    '/data/account/keyfile?kind=kalshi',
  ]);
  assert.deepEqual(r.a().keyfile.asked, { kind: 'kalshi', venue: '', ref: '', exchange: '' });
  // a later check overtakes one in the air: only the latest lands, under what it asked
  const release = {};
  const slow = rig({ json: { '/data/account/keyfile': path => new Promise(res => { release[path] = res; }) } });
  const first = slow.account.checkKeyfile({ kind: 'alpaca', venue: 'a1' });
  const second = slow.account.checkKeyfile({ kind: 'alpaca', venue: 'a2' });
  await tick();
  release['/data/account/keyfile?kind=alpaca&venue=a2']({ ok: true, ready: true, path: '/h/a2.json', fields: [], message: '' });
  await second;
  release['/data/account/keyfile?kind=alpaca&venue=a1']({ ok: true, ready: true, path: '/h/a1.json', fields: [], message: '' });
  await first;
  assert.equal(slow.a().keyfile.data.path, '/h/a2.json');
  assert.equal(slow.a().keyfile.asked.venue, 'a2');
});

test("a refused venues, books, key-file or reach read keeps its last answer and the Account's sentence", async () => {
  const refusal = message => rejected('/data/account/x', 400, { ok: false, refusal: { code: 'E_ACCOUNT_BAD_REQUEST', message } });
  const r = rig({
    json: {
      '/data/account/venues': inTurn([fx('venues'), refusal('the venues are being probed')]),
      '/data/account/paper/books': inTurn([fx('paper-books'), { ok: false, error: 'the paper books are unreadable' }]),
      '/data/account/keyfile': inTurn([fx('keyfile'), refusal('a robinhood connection does not read a key file')]),
      '/data/account/connect/reach': inTurn([{ ok: true, reach: [] }, rejected('/data/account/connect/reach', 400, { ok: false, error: 'connector is a comma-separated list of 1 to 24 connections, like live:exchange:okx,live:kalshi' })]),
    },
  });
  for (const [key, ask] of [['venuesHere', () => r.account.loadVenuesHere()], ['paperBooks', () => r.account.loadPaperBooks()],
    ['keyfile', () => r.account.checkKeyfile({ kind: 'robinhood', venue: 'rh' })], ['reach', () => r.account.reach('live:robinhood')]]) {
    await ask();
    const data = r.a()[key].data;
    await ask();
    assert.equal(r.a()[key].status, 'error', key);
    assert.equal(r.a()[key].data, data, `${key}: the last answer stays`);
  }
  assert.equal(r.a().venuesHere.message, 'the venues are being probed');
  assert.equal(r.a().paperBooks.message, 'the paper books are unreadable');
  assert.equal(r.a().keyfile.message, 'a robinhood connection does not read a key file');
  assert.equal(r.a().reach.message, 'connector is a comma-separated list of 1 to 24 connections, like live:exchange:okx,live:kalshi');
  // an answer clears the sentence; unreachable carries none
  const again = rig({ json: { '/data/account/venues': inTurn([refusal('probing'), fx('venues'), rejected('/data/account/venues', 503, { ok: false, unreachable: 'timeout' })]) } });
  await again.account.loadVenuesHere();
  assert.equal(again.a().venuesHere.message, 'probing');
  await again.account.loadVenuesHere();
  assert.equal(again.a().venuesHere.message, null);
  await again.account.loadVenuesHere();
  assert.deepEqual([again.a().venuesHere.status, again.a().venuesHere.message], ['error', null]);
});

// ── Guard: one unsigned click (plan 4a Task 5) ──

test('guard posts once while one is in the air, says the Account\'s words, and reads the page fresh', async () => {
  const posts = [];
  let release;
  const post = (path, body) => { posts.push([path, body]); return new Promise(res => { release = res; }); };
  const r = rig({ json: { '/data/account': noPaper({ mode: 'guard' }) }, post });
  const one = r.account.guard();
  const two = r.account.guard();
  assert.equal(two, one, 'a second press while one is in the air joins it');
  assert.equal(r.a().guard.status, 'asking');
  await tick();
  assert.deepEqual(posts, [['/data/account/guard', {}]], 'one POST, an empty body');
  release({ status: 200, body: { ok: true, mode: 'guard' } });
  await one;
  await settle();
  assert.equal(r.a().guard.status, 'said');
  assert.equal(r.a().guard.said, 'Guard: what agents ask for waits for you on a card.');
  assert.deepEqual(r.reads, ['/data/account?fresh=1'], 'the page read past the face\'s cache');
  assert.equal(r.a().data.mode, 'guard');
  // once settled, the next press posts again
  const three = r.account.guard();
  assert.notEqual(three, one);
  await tick();
  assert.equal(posts.length, 2);
  release({ status: 200, body: { ok: true, mode: 'guard' } });
  await three;
});

test('a refused guard says the refusal and leaves the mode drawn as the page has it', async () => {
  const answers = [
    { status: 409, body: { ok: false, refusal: { code: 'E_ACCOUNT_X', message: 'The account would not switch now.' } } },
    { status: 503, body: { ok: false, unreachable: 'ECONNREFUSED', error: 'unreachable' } },
    { status: 0, body: {} },
  ];
  const post = async () => answers.shift();
  const r = rig({ json: { '/data/account': noPaper({ mode: 'open' }) }, post });
  await r.account.guard();
  await settle();
  assert.equal(r.a().guard.status, 'refused');
  assert.equal(r.a().guard.message, 'The account would not switch now.');
  assert.equal(r.a().data.mode, 'open', 'the page as read: still Beast');
  assert.deepEqual(r.reads, ['/data/account?fresh=1']);
  const html = renderAccountScreen({ ...r.store.get(), route: { screen: 'account', tab: 'rules' } }, Date.now());
  assert.match(html, /The account would not switch now\./);
  assert.match(html, /aria-pressed="true"[^>]*>Beast</, 'Beast drawn pressed');
  await r.account.guard();
  assert.equal(r.a().guard.message, 'unreachable', 'else its error');
  await r.account.guard();
  assert.equal(r.a().guard.message, 'The account did not answer. Try again.', 'else the fixed words');
  // a post that throws is no answer
  const r2 = rig({ json: { '/data/account': noPaper() }, post: async () => { throw new Error('boom'); } });
  await r2.account.guard();
  assert.equal(r2.a().guard.message, 'The account did not answer. Try again.');
});

// ── the Money tab (plan 4b Task 2) ──

const ADDRESS = { ok: true, venue: 'okx', venueName: 'OKX', asset: 'USDT', network: 'Base', address: '0x2222222222222222222222222222222222222222', tag: '1234', whose: "OKX's own deposit address", note: 'checked a minute ago' };

test('receive reads one row once while it is in the air', async () => {
  let release;
  const r = rig({ json: { '/data/account/receive': () => new Promise(res => { release = res; }) } });
  const row = { venue: 'okx', asset: 'USDT', network: 'Base' };
  const first = r.account.receive(row);
  assert.equal(r.account.receive({ ...row }), first, 'a second press joins the read in the air');
  await settle();
  assert.equal(r.account.receive({ ...row }), first, 'and a third, still in the air');
  await settle();
  assert.deepEqual(r.reads, ['/data/account/receive?venue=okx&asset=USDT&network=Base']);
  assert.equal(r.a().receive['okx|USDT|Base'].status, 'loading');
  release(ADDRESS);
  await first;
  assert.deepEqual(r.a().receive['okx|USDT|Base'], { status: 'ready', data: ADDRESS, at: r.a().receive['okx|USDT|Base'].at, message: null });
  // another row is its own read
  void r.account.receive({ venue: 'okx', asset: 'USDC', network: 'Base' });
  await settle();
  assert.equal(r.reads.length, 2);
  release({ ...ADDRESS, asset: 'USDC' });
  await settle();
  assert.equal(r.a().receive['okx|USDC|Base'].data.asset, 'USDC');
  assert.equal(r.a().receive['okx|USDT|Base'].data.asset, 'USDT', 'each row under its own key');
  // a row with a part missing reads nothing
  await r.account.receive({ venue: 'okx', asset: '', network: 'Base' });
  assert.equal(r.reads.length, 2);
});

test("a refused receive lands the Account's words under its row", async () => {
  const refusal = { ok: false, refusal: { ok: false, code: 'E_LIVE_NO_DEPOSIT', layer: 'live', message: 'OKX gives no USDT address on Robinhood Chain' } };
  const r = rig({ json: { '/data/account/receive': rejected('/data/account/receive', 409, refusal) } });
  await r.account.receive({ venue: 'okx', asset: 'USDT', network: 'Robinhood Chain' });
  const got = r.a().receive['okx|USDT|Robinhood Chain'];
  assert.equal(got.status, 'error');
  assert.equal(got.message, 'OKX gives no USDT address on Robinhood Chain');
});

test('bridgeRoutes lands only for the latest preparation', async () => {
  const answers = [];
  const posted = [];
  const post = (path, body) => { posted.push([path, body]); return new Promise(res => answers.push(res)); };
  const r = rig({ post });
  const one = { type: 'liveMove', kind: 'bridge', from: 'w', amount: '10' };
  const two = { ...one, amount: '20' };
  const a = r.account.bridgeRoutes(one);
  assert.deepEqual(r.a().routes, { asked: JSON.stringify(one), status: 'asking', data: null, message: null });
  const b = r.account.bridgeRoutes(two);
  assert.deepEqual(posted, [['/data/account/bridge-routes', { draft: one }], ['/data/account/bridge-routes', { draft: two }]]);
  answers[1]({ status: 200, body: { ok: true, routes: [{ tool: 'across' }] } });
  await b;
  answers[0]({ status: 200, body: { ok: true, routes: [{ tool: 'stale' }] } });
  await a;
  assert.equal(r.a().routes.asked, JSON.stringify(two));
  assert.deepEqual(r.a().routes.data.routes, [{ tool: 'across' }], 'the older answer is dropped');
  // a refusal is the Account's words
  const c = r.account.bridgeRoutes(one);
  answers[2]({ status: 409, body: { ok: false, refusal: { message: 'no bridge joins these chains' } } });
  await c;
  assert.deepEqual(r.a().routes, { asked: JSON.stringify(one), status: 'error', data: null, message: 'no bridge joins these chains' });
});

test("an answer for another account, asset or network is never landed as the row's address", async () => {
  const r = rig({ json: { '/data/account/receive': { ...ADDRESS, network: 'Arbitrum' } } });
  await r.account.receive({ venue: 'okx', asset: 'USDT', network: 'Base' });
  const got = r.a().receive['okx|USDT|Base'];
  assert.equal(got.status, 'error');
  assert.equal(got.data, null);
  assert.match(got.message, /another account or network/);
  // an answer with no address is no address
  const e = rig({ json: { '/data/account/receive': { ok: true, venue: 'okx', asset: 'USDT', network: 'Base' } } });
  await e.account.receive({ venue: 'okx', asset: 'USDT', network: 'Base' });
  assert.equal(e.a().receive['okx|USDT|Base'].status, 'error');
});

test('a fresh page forgets every Receive address read; a plain one keeps them', async () => {
  const r = rig({ json: { '/data/account': page(), '/data/account/receive': ADDRESS } });
  await r.account.receive({ venue: 'okx', asset: 'USDT', network: 'Base' });
  await r.account.load();
  assert.equal(r.a().receive['okx|USDT|Base'].status, 'ready', 'the poll keeps it');
  await r.account.load({ fresh: true });
  assert.deepEqual(r.a().receive, {}, 'after a move, a stream event or Refresh: forgotten');
});

// ── Venues: Close to agents and a venue's sign-in (plan 4b Task 4) ──

test('revoke posts once per venue while in the air and reads the page fresh', async () => {
  const posts = [];
  const release = {};
  const post = (path, body) => { posts.push([path, body]); return new Promise(res => { release[body.account] = res; }); };
  const r = rig({ json: { '/data/account': noPaper() }, post });
  await r.account.load();
  r.reads.length = 0;
  const one = r.account.revoke('ex');
  assert.equal(r.account.revoke('ex'), one, 'a second press on the same venue joins the first');
  const other = r.account.revoke('broker');
  assert.notEqual(other, one, 'another venue goes on its own');
  assert.deepEqual([r.a().closing.ex.status, r.a().closing.broker.status], ['asking', 'asking']);
  await tick();
  assert.deepEqual(posts, [['/data/account/revoke', { account: 'ex' }], ['/data/account/revoke', { account: 'broker' }]], 'one POST a venue, never signed');
  release.ex({ status: 200, body: { ok: true } });
  await one;
  await settle();
  assert.deepEqual(r.a().closing.ex, { status: 'said', said: 'Stand-in Exchange is closed to agents: they keep reading it, and place or move nothing there. Reopening it is signed.', message: null });
  assert.deepEqual(r.reads, ['/data/account?fresh=1'], "the page read past the face's cache");
  // the Account's refusal in its words
  release.broker({ status: 404, body: { ok: false, refusal: { code: 'E_ACCOUNT_UNKNOWN_VENUE', message: 'no account "broker" here' } } });
  await other;
  assert.deepEqual(r.a().closing.broker, { status: 'refused', said: null, message: 'no account "broker" here' });
  // settled: the next press posts again
  const again = r.account.revoke('ex');
  await tick();
  assert.equal(posts.length, 3);
  release.ex({ status: 200, body: { ok: true } });
  await again;
  assert.equal(await r.account.revoke(''), undefined, 'no venue: nothing posted');
  assert.equal(posts.length, 3);
});

const RH = { connector: 'live:robinhood', kind: 'robinhood', label: "Robinhood · investing accounts, through Robinhood's own sign-in", needs: 'sign-in' };
// a tab as the window opens it: its opener, where it was sent, whether it was closed
const fakeTab = () => ({ opener: {}, location: { href: 'about:blank' }, closed: false, close() { this.closed = true; } });

test('signIn starts, sends the tab to the venue, polls the status and stops when the sheet closes', async () => {
  const opened = [];
  const tab = fakeTab();
  const openTab = (url, target) => { opened.push([url, target]); return tab; };
  const posts = [];
  const post = async (path, body) => { posts.push([path, body]); return { status: 200, body: { ok: true, url: 'https://robinhood.example/oauth?state=st-9', state: 'st-9' } }; };
  const statuses = [{ ok: true, status: 'pending' }, { ok: true, status: 'ready', stale: true }, { ok: true, status: 'unknown' }, { ok: true, status: 'pending' }];
  const r = rig({ json: { '/data/account/signin/status': () => Promise.resolve(statuses.shift()) }, post, openTab });
  let open = true;
  const ready = [];
  const going = r.account.signIn(RH, { alive: () => open, onReady: s => ready.push(s) });
  assert.deepEqual(opened, [['about:blank', '_blank']], 'the tab opened at once, inside the press');
  assert.equal(tab.opener, null, 'its opener cleared');
  assert.equal(r.a().signIn.status, 'starting');
  await going;
  assert.deepEqual(posts, [['/data/account/signin/start', { connector: 'robinhood' }]]);
  assert.equal(tab.location.href, 'https://robinhood.example/oauth?state=st-9', "sent to the venue's page");
  assert.deepEqual([r.a().signIn.status, r.a().signIn.tab, r.a().signIn.state], ['waiting', true, 'st-9']);
  assert.deepEqual(r.reads, ['/data/account/signin/status?state=st-9']);
  // every 1.5 s; a ready the face re-served as stale, or an unknown, is not the final status
  for (let i = 0; i < 2; i++) {
    const [t] = r.pending();
    assert.equal(t.ms, SIGNIN_POLL_MS);
    r.run(t);
    await settle();
  }
  assert.equal(r.a().signIn.status, 'waiting', 'a stale ready is unknown: still waiting');
  assert.deepEqual(ready, []);
  assert.equal(r.reads.length, 3);
  // the sheet closed: the next beat reads nothing and schedules nothing
  open = false;
  r.run(r.pending()[0]);
  await settle();
  assert.equal(r.reads.length, 3, 'nothing read once the sheet is gone');
  assert.deepEqual(r.pending(), []);

  // started again: a ready lands its state, and the poll ends
  const answers = [{ ok: true, status: 'ready' }];
  const r2 = rig({ json: { '/data/account/signin/status': () => Promise.resolve(answers.shift()) }, post, openTab: () => fakeTab() });
  const got = [];
  await r2.account.signIn(RH, { onReady: s => got.push(s) });
  assert.deepEqual(got, ['st-9']);
  assert.equal(r2.a().signIn.status, 'ready');
  assert.deepEqual(r2.pending(), [], 'ready: no more asking');

  // no tab (a blocker): the address kept for the link; a failed status says the Account's words
  const r3 = rig({ json: { '/data/account/signin/status': { ok: true, status: 'failed', error: 'access_denied' } }, post, openTab: () => null });
  await r3.account.signIn(RH);
  assert.equal(r3.a().signIn.tab, false);
  assert.equal(r3.a().signIn.url, 'https://robinhood.example/oauth?state=st-9');
  assert.deepEqual([r3.a().signIn.status, r3.a().signIn.message], ['failed', 'access_denied']);
  // a start the Account refuses closes the tab and says its words
  const t4 = fakeTab();
  const r4 = rig({ post: async () => ({ status: 400, body: { ok: false, error: 'there is no sign-in for "robinhood"' } }), openTab: () => t4 });
  await r4.account.signIn(RH);
  assert.equal(t4.closed, true);
  assert.deepEqual([r4.a().signIn.status, r4.a().signIn.message], ['failed', 'there is no sign-in for "robinhood"']);
  assert.deepEqual(r4.reads, []);
});

test('the sign-in runs out after 15 minutes', async () => {
  const post = async () => ({ status: 200, body: { ok: true, url: 'https://robinhood.example/oauth', state: 'st-1' } });
  const r = rig({ json: { '/data/account/signin/status': { ok: true, status: 'pending' } }, post, openTab: () => fakeTab() });
  // the rig's clock moves one millisecond a call: a beat that jumps it past the window
  await r.account.signIn(RH);
  assert.equal(SIGNIN_WITHIN_MS, 15 * 60_000);
  let beats = 0;
  while (r.pending().length && beats < 5) {
    if (beats === 2) r.clock(SIGNIN_WITHIN_MS);
    r.run(r.pending()[0]);
    await settle();
    beats += 1;
  }
  assert.equal(r.a().signIn.status, 'expired');
  assert.deepEqual(r.pending(), [], 'run out: no more asking');
  assert.equal(beats, 3, 'it ran out on the beat after the window passed');
});
