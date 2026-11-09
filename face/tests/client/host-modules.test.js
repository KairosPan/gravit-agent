// A Lunhui module page's host layer (module cards spec §5.3): the latest run's artifact, read through the channel
// overview of the run's channel, one read per page, only the latest-started landing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startModules } from '../../client/js/host/modules.js';
import { modulesListing, MARKET_RUN, S01_RUN } from './helpers/inventory.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const latestRun = (run, artifacts) => ({ ok: true, body: { latestRun: { run, artifacts } } });
const themeJson = { module: 'theme', status: 'NOT_EVALUABLE' };

function rig({ listing = modulesListing(), post = () => latestRun(MARKET_RUN, { theme: { headline: {}, json: themeJson } }) } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const posted = [];
  const listed = { count: 0 };
  const postJson = async (path, body) => { posted.push([path, body]); const a = await post(body); if (a instanceof Error) throw a; return a; };
  const readListing = async () => { listed.count++; return listing; };
  const modules = startModules({ store, postJson, readListing });
  return { store, modules, posted, listed, d: () => store.get().discover };
}

test("latestArtifact: reads the listing, posts the overview of the latest run's channel, keeps the json when the runs match", async () => {
  const r = rig();
  await r.modules.latestArtifact('theme');
  assert.equal(r.listed.count, 1);
  assert.deepEqual(r.posted, [['/data/channels/overview', { workspaceId: 'ws-cn-market' }]]);
  assert.deepEqual(r.d().artifacts.theme, { status: 'ready', run: MARKET_RUN, json: themeJson });
  const s = rig({ post: () => latestRun(S01_RUN, { leader: { headline: {}, json: { module: 'leader' } } }) });
  await s.modules.latestArtifact('leader');
  assert.deepEqual(s.posted, [['/data/channels/overview', { workspaceId: 'ws-lunhui-s01-repair' }]], "a strategy module reads its newest strategy run's channel");
  assert.deepEqual(s.d().artifacts.leader, { status: 'ready', run: S01_RUN, json: { module: 'leader' } });
});

test("latestArtifact: another run as the overview's latest → json null; a failed post → failed; no run → nothing posted", async () => {
  const other = rig({ post: () => latestRun('20261027T000000Z-00000000', { theme: { headline: {}, json: themeJson } }) });
  await other.modules.latestArtifact('theme');
  assert.deepEqual(other.d().artifacts.theme, { status: 'ready', run: MARKET_RUN, json: null });
  const missing = rig({ post: () => latestRun(MARKET_RUN, {}) });
  await missing.modules.latestArtifact('theme');
  assert.deepEqual(missing.d().artifacts.theme, { status: 'ready', run: MARKET_RUN, json: null }, 'the run without the module');
  const bare = rig({ post: () => ({ ok: true, body: {} }) });
  await bare.modules.latestArtifact('theme');
  assert.equal(bare.d().artifacts.theme.json, null, 'an overview with no latestRun');
  const failed = rig({ post: () => Object.assign(new Error('HTTP 500'), { status: 500 }) });
  await failed.modules.latestArtifact('theme');
  assert.deepEqual(failed.d().artifacts.theme, { status: 'failed', run: null, json: null });
  const none = rig({ listing: { ok: true, mounted: true, channels: [] } });
  await none.modules.latestArtifact('theme');
  assert.deepEqual(none.posted, []);
  assert.equal(none.d().artifacts.theme, undefined);
  const unread = rig({ listing: null });
  await unread.modules.latestArtifact('theme');
  assert.deepEqual(unread.posted, [], 'a listing that could not be read');
  const unknown = rig();
  await unknown.modules.latestArtifact('nope');
  assert.deepEqual(unknown.posted, []);
});

test('latestArtifact: only the latest-started read lands', async () => {
  const answers = [];
  const r = rig({ post: () => new Promise(resolve => answers.push(resolve)) });
  const first = r.modules.latestArtifact('theme');
  await tick();
  const second = r.modules.latestArtifact('theme');
  await tick();
  assert.equal(answers.length, 2);
  answers[1](latestRun(MARKET_RUN, { theme: { headline: {}, json: { module: 'theme', n: 2 } } }));
  await second;
  answers[0](latestRun(MARKET_RUN, { theme: { headline: {}, json: { module: 'theme', n: 1 } } }));
  await first;
  assert.deepEqual(r.d().artifacts.theme, { status: 'ready', run: MARKET_RUN, json: { module: 'theme', n: 2 } });
  // a failure of the earlier read lands nothing either
  const f = rig({ post: () => new Promise((resolve, reject) => answers.push([resolve, reject])) });
  answers.length = 0;
  const a = f.modules.latestArtifact('theme');
  await tick();
  const b = f.modules.latestArtifact('theme');
  await tick();
  answers[1][0](latestRun(MARKET_RUN, { theme: { headline: {}, json: themeJson } }));
  await b;
  answers[0][1](new Error('HTTP 500'));
  await a;
  assert.equal(f.d().artifacts.theme.status, 'ready');
  // each module reads alone: one module's read does not cut another's
  const two = rig({ post: () => latestRun(MARKET_RUN, { theme: { headline: {}, json: themeJson }, sentiment: { headline: {}, json: { module: 'sentiment' } } }) });
  await Promise.all([two.modules.latestArtifact('theme'), two.modules.latestArtifact('sentiment')]);
  assert.equal(two.d().artifacts.theme.status, 'ready');
  assert.deepEqual(two.d().artifacts.sentiment.json, { module: 'sentiment' });
});

// ---- Running, then landed (spec §5.7, G10; one-entry plan 2): the tracker over moduleRuns and the tasks, and its storage mirror
const KEY = 'gravit-face.module-runs';
const T0 = new Date(2026, 9, 28, 14, 0).getTime();
const memoryStorage = (seed = {}) => { const m = new Map(Object.entries(seed)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
// a task as GET /data/tasks shows it (TaskView): its title, its rail group and when it started
const task = (id, title, group, startedAt = T0) => ({ id, title, origin: 'web', state: group === 'done' ? 'done' : group === 'you' ? 'waiting' : 'running', group, steps: [], startedAt, lastEventAt: startedAt, lastSeq: 1 });

function tracker({ storage = memoryStorage(), at = T0 } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const clock = { at };
  const held = [];
  const timers = { after: (ms, fn) => { held.push({ ms, fn }); return held.length; } };
  const refreshed = { count: 0 };
  const modules = startModules({
    store, postJson: async () => ({}), readListing: async () => modulesListing(),
    refreshListing: async () => { refreshed.count++; }, timers, storage, now: () => clock.at,
  });
  const tasks = items => store.dispatch('tasksLoaded', { conversation: 'c-gravit', tasks: items, at: clock.at });
  return { store, modules, clock, held, refreshed, storage, tasks, runs: () => store.get().moduleRuns };
}

test('trackRuns: the task of the Run\'s title that ends clears its record and re-reads the listing now and 5 s later', async () => {
  const t = tracker();
  t.modules.trackRuns();
  t.store.dispatch('moduleRunStarted', { module: 'theme', title: 'Theme · 10-28', startedAt: T0 - 120_000 });
  t.tasks([task('t-a', 'Theme · 10-28', 'running', T0 - 100_000)]);
  assert.deepEqual(Object.keys(t.runs()), ['theme'], 'running: kept');
  assert.equal(t.refreshed.count, 0);
  assert.equal(t.held.length, 0);
  t.tasks([task('t-a', 'Theme · 10-28', 'you', T0 - 100_000)]);
  assert.deepEqual(Object.keys(t.runs()), ['theme'], 'waiting on you: still not done, kept');
  t.tasks([task('t-a', 'Theme · 10-28', 'done', T0 - 100_000)]);
  assert.deepEqual(t.runs(), {}, 'done: cleared');
  assert.equal(t.refreshed.count, 1, 'the listing re-read at the flip');
  assert.deepEqual(t.held.map(h => h.ms), [5000]);
  t.held[0].fn();
  assert.equal(t.refreshed.count, 2, 'and once more 5 s later');
  // a change of something else now dispatches and re-reads nothing
  t.tasks([task('t-a', 'Theme · 10-28', 'done', T0 - 100_000), task('t-b', 'Other', 'running')]);
  assert.equal(t.refreshed.count, 2);
  assert.equal(t.held.length, 1);
  // a done task of the same title from before the Run is not its task: the record stands
  t.store.dispatch('moduleRunStarted', { module: 'theme', title: 'Theme · 10-28', startedAt: T0 - 10_000 });
  assert.deepEqual(Object.keys(t.runs()), ['theme'], 'the older done task is not this Run\'s');
  assert.equal(t.refreshed.count, 2);
});

test('trackRuns: stale records — no task after 60 s once the tasks answered, any record after 60 minutes', async () => {
  const t = tracker();
  t.modules.trackRuns();
  t.store.dispatch('moduleRunStarted', { module: 'theme', title: 'Theme · 10-28', startedAt: T0 - 120_000 });
  assert.deepEqual(Object.keys(t.runs()), ['theme'], 'before /data/tasks answers a missing task is not yet missing');
  t.tasks([task('t-x', 'Something else', 'running')]);
  assert.deepEqual(t.runs(), {}, 'the tasks answered without it: cleared');
  assert.equal(t.refreshed.count, 1);
  assert.equal(t.held.length, 0, 'a missing task re-reads once, no backstop');
  // a missing task under a minute old stays: Gravit has not started it yet
  t.store.dispatch('moduleRunStarted', { module: 'leader', title: 'Leader · 10-28', startedAt: T0 - 5_000 });
  assert.deepEqual(Object.keys(t.runs()), ['leader']);
  // any record older than 60 minutes goes, running or not, without a re-read
  t.store.dispatch('moduleRunStarted', { module: 'mode', title: 'Mode · 10-28', startedAt: T0 - 61 * 60_000 });
  assert.deepEqual(Object.keys(t.runs()), ['leader'], 'the hour-old record cleared');
  assert.equal(t.refreshed.count, 1);
  // past the minute with no task, the conversation off: cleared too
  const off = tracker();
  off.modules.trackRuns();
  off.store.dispatch('moduleRunStarted', { module: 'theme', title: 'Theme · 10-28', startedAt: T0 - 120_000 });
  off.store.dispatch('tasksOff', { at: T0 });
  assert.deepEqual(off.runs(), {});
});

test('the mirror: records are written to storage on change and read back at boot; a throwing storage changes nothing', async () => {
  const t = tracker();
  t.modules.trackRuns();
  assert.deepEqual(t.runs(), {});
  t.store.dispatch('moduleRunStarted', { module: 'theme', title: 'Theme · 10-28', startedAt: T0 });
  assert.deepEqual(JSON.parse(t.storage.getItem(KEY)), { theme: { title: 'Theme · 10-28', startedAt: T0 } });
  // another boot over the same storage reads the record back
  const again = tracker({ storage: t.storage });
  again.modules.trackRuns();
  assert.deepEqual(again.runs(), { theme: { title: 'Theme · 10-28', startedAt: T0 } });
  // a change of something else writes nothing
  let writes = 0;
  const counted = memoryStorage({ [KEY]: t.storage.getItem(KEY) });
  const set = counted.setItem;
  counted.setItem = (k, v) => { writes++; set(k, v); };
  const quiet = tracker({ storage: counted });
  quiet.modules.trackRuns();
  const before = writes;
  quiet.store.dispatch('hostStatus', { line: 'x' });
  assert.equal(writes, before, 'nothing written when moduleRuns did not change');
  quiet.store.dispatch('moduleRunCleared', { module: 'theme' });
  assert.equal(writes, before + 1);
  assert.deepEqual(JSON.parse(counted.getItem(KEY)), {});
  // garbage, a wrong shape, a throwing storage: {} and no throw, the store still updated
  for (const raw of ['{not json', '[1,2]', JSON.stringify({ theme: { title: 't' } }), JSON.stringify({ nope: { title: 't', startedAt: 1 } }), JSON.stringify({ theme: { title: 7, startedAt: 1 } })]) {
    const g = tracker({ storage: memoryStorage({ [KEY]: raw }) });
    g.modules.trackRuns();
    assert.deepEqual(g.runs(), {}, raw);
  }
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  const x = tracker({ storage: throwing });
  assert.doesNotThrow(() => x.modules.trackRuns());
  assert.doesNotThrow(() => x.store.dispatch('moduleRunStarted', { module: 'theme', title: 'Theme · 10-28', startedAt: T0 }));
  assert.equal(x.runs().theme.title, 'Theme · 10-28');
  // no storage at all: the page runs on memory alone
  const none = tracker({ storage: null });
  none.modules.trackRuns();
  none.store.dispatch('moduleRunStarted', { module: 'theme', title: 'Theme · 10-28', startedAt: T0 });
  assert.equal(none.runs().theme.title, 'Theme · 10-28');
  // a second trackRuns subscribes nothing more
  const twice = tracker();
  twice.modules.trackRuns();
  twice.modules.trackRuns();
  twice.store.dispatch('moduleRunStarted', { module: 'theme', title: 'Theme · 10-28', startedAt: T0 - 120_000 });
  twice.tasks([task('t-a', 'Theme · 10-28', 'done')]);
  assert.equal(twice.refreshed.count, 1, 'one tracker');
});
