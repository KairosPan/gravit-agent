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
