// Discover's host layer (spec 2026-10-19 §7 Stage 3): the four listings each alone, the Gravit item's three reads, a
// skill's content, and the agent writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startDiscover, GRAVIT_KEYS } from '../../client/js/host/discover.js';

function rig({ json = {}, calls: answers = {}, posts = {} } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const reads = [];
  const getJson = async path => { reads.push(path); const a = typeof json[path] === 'function' ? json[path]() : json[path]; if (a instanceof Error) throw a; return a; };
  const called = [];
  const call = async (endpoint, args) => { called.push([endpoint, args]); const a = answers[endpoint]; if (a instanceof Error) throw a; return a; };
  const posted = [];
  const postJson = async (path, body) => { posted.push([path, body]); const a = typeof posts[path] === 'function' ? posts[path](body) : posts[path]; if (a instanceof Error) throw a; return a ?? { ok: true }; };
  let t = 0;
  const discover = startDiscover({ store, getJson, postJson, call, now: () => ++t });
  return { store, discover, reads, called, posted, d: () => store.get().discover };
}
const ok = { '/data/plugins.json': { ok: true, mcp: [], agentTools: [], rows: [] }, '/data/bots.json': { ok: true, bots: [] }, '/data/agents.json': { ok: true, main: {}, local: [], candidates: [] }, '/data/memory.json': { ok: true, groups: [] } };

test('load reads the four listings once each; one failing marks only its shelf and keeps its data', async () => {
  const r = rig({ json: { ...ok } });
  await Promise.all([r.discover.load(), r.discover.load()]);
  assert.deepEqual(r.reads.sort(), ['/data/agents.json', '/data/bots.json', '/data/memory.json', '/data/plugins.json']);
  for (const s of ['plugins', 'bots', 'agents', 'memory']) assert.equal(r.d().shelves[s].status, 'ready', s);
  const one = rig({ json: { ...ok, '/data/bots.json': new Error('HTTP 500') } });
  await one.discover.load();
  assert.equal(one.d().shelves.bots.status, 'failed');
  assert.equal(one.d().shelves.plugins.status, 'ready');
  let fail = false;
  const keep = rig({ json: { ...ok, '/data/bots.json': () => (fail ? new Error('HTTP 500') : { ok: true, bots: [{ id: 'b', name: 'B' }] }) } });
  await keep.discover.load();
  fail = true;
  await keep.discover.load();
  assert.equal(keep.d().shelves.bots.status, 'failed');
  assert.deepEqual(keep.d().shelves.bots.data.bots, [{ id: 'b', name: 'B' }], 'the last good listing stays');
});

test('gravit reads the host, the model catalog and the three keys, each alone', async () => {
  const r = rig({
    json: { '/data/host.json': { ok: true, cwd: '/r', home: '/h', attachedSessions: 2, version: '0.2.0-rc.2' } },
    calls: { 'session/modelCatalog': new Error('catalog down'), 'credentials/describe': { DEEPSEEK_API_KEY: { configured: true }, APCA_API_KEY_ID: { configured: false } } },
  });
  await r.discover.gravit();
  const g = r.d().gravit;
  assert.equal(g.host.cwd, '/r'); assert.equal(g.model, false, 'a failed read is false');
  assert.equal(g.keys.DEEPSEEK_API_KEY.configured, true);
  assert.deepEqual(r.called.find(c => c[0] === 'credentials/describe')[1], { refs: GRAVIT_KEYS });
  assert.deepEqual(GRAVIT_KEYS, ['DEEPSEEK_API_KEY', 'APCA_API_KEY_ID', 'APCA_API_SECRET_KEY']);
  const m = rig({ json: { '/data/host.json': new Error('x') }, calls: { 'session/modelCatalog': { default: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' } }, 'credentials/describe': {} } });
  await m.discover.gravit();
  assert.deepEqual(m.d().gravit.model, { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' });
  assert.equal(m.d().gravit.host, false);
});

test('skill reads its content once', async () => {
  const r = rig({ posts: { '/data/memory/skill': body => ({ ok: true, name: body.name, description: 'd', group: 'mechanics', path: '/p', content: '# Rules' }) } });
  await Promise.all([r.discover.skill('rules'), r.discover.skill('rules')]);
  await r.discover.skill('rules');
  assert.deepEqual(r.posted, [['/data/memory/skill', { name: 'rules' }]]);
  assert.equal(r.d().skills.rules.status, 'ready'); assert.equal(r.d().skills.rules.detail.content, '# Rules');
  const bad = rig({ posts: { '/data/memory/skill': new Error('skill not found') } });
  await bad.discover.skill('nope');
  assert.equal(bad.d().skills.nope.status, 'failed');
});

test("connect posts the bin and re-reads the agents; a 404 puts its words on Discover's line", async () => {
  let n = 0;
  const r = rig({ json: { ...ok, '/data/agents.json': () => ({ ok: true, main: {}, local: n++ ? [{ bin: 'codex', found: true }] : [], candidates: [] }) } });
  await r.discover.load();
  assert.equal(await r.discover.connect('codex'), true);
  assert.deepEqual(r.posted, [['/data/agents/connect', { bin: 'codex' }]]);
  assert.deepEqual(r.d().shelves.agents.data.local, [{ bin: 'codex', found: true }]);
  const no = rig({ posts: { '/data/agents/connect': Object.assign(new Error('binary did not answer on this machine'), { status: 404, code: 'binary did not answer on this machine' }) } });
  assert.equal(await no.discover.connect('ghost'), false);
  assert.deepEqual(no.d().status, { line: 'connect: binary did not answer on this machine', bad: true });
  const rescan = rig({ posts: { '/data/agents/rescan': { ok: true, main: {}, local: [], candidates: [{ bin: 'claude', version: '2.1' }] } } });
  assert.equal(await rescan.discover.rescan(), true);
  assert.deepEqual(rescan.d().shelves.agents.data.candidates, [{ bin: 'claude', version: '2.1' }], 'rescan answers the listing itself');
  assert.deepEqual(rescan.posted, [['/data/agents/rescan', {}]]);
});

const bot = { id: 'buffett', name: 'Buffett Type', description: 'Buys cheap', model: 'deepseek/deepseek-chat', soul: '# B', revision: 'r1', homeCwd: '/r/bots/buffett/home' };
const fields = (over = {}) => ({ name: ' Buffett Type ', description: 'Buys cheaper', model: '', soul: '# B2', ...over });

test('saveBot posts the revision-checked payload and re-reads the bots', async () => {
  const r = rig({ json: { ...ok } });
  assert.equal(await r.discover.saveBot(bot, fields()), 'saved');
  assert.deepEqual(r.posted, [['/data/bots/settings', { id: 'buffett', revision: 'r1', name: 'Buffett Type', description: 'Buys cheaper', model: null, soul: '# B2' }]]);
  assert.ok(r.reads.includes('/data/bots.json'), 'the bots are read again');
  assert.equal(await r.discover.saveBot(bot, fields({ model: 'not a route' })), 'failed');
  assert.match(r.d().status.line, /provider\/model/);
  assert.equal(r.posted.length, 1, 'a bad model route is refused before the post');
});

test('a stale revision reads stale and the line says Changed elsewhere', async () => {
  const words = 'bot settings changed since this view was loaded; reload before saving';
  const r = rig({ json: { ...ok }, posts: { '/data/bots/settings': Object.assign(new Error(words), { status: 409, code: words }) } });
  assert.equal(await r.discover.saveBot(bot, fields()), 'stale');
  assert.deepEqual(r.d().status, { line: 'Changed elsewhere — reloaded', bad: true });
  assert.ok(r.reads.includes('/data/bots.json'));
  const other = rig({ posts: { '/data/bots/settings': Object.assign(new Error('bot already exists'), { status: 409, code: 'bot already exists' }) } });
  assert.equal(await other.discover.saveBot(bot, fields()), 'failed', 'another 409 is a plain refusal');
  assert.deepEqual(other.d().status, { line: 'save: bot already exists', bad: true });
});

test('a saved-but 500 counts as saved', async () => {
  const words = 'bots/buffett was saved, but the running face could not re-declare it';
  const r = rig({ json: { ...ok }, posts: { '/data/bots/settings': Object.assign(new Error(words), { status: 500, code: words }) } });
  assert.equal(await r.discover.saveBot(bot, fields()), 'saved');
  assert.deepEqual(r.d().status, { line: words, bad: true });
});

test('createBot omits blank fields; a name with no ASCII needs an id before any post', async () => {
  // the face answers {ok, bot: <the row>} (src/bots.ts declared())
  const r = rig({ json: { ...ok }, posts: { '/data/bots': body => ({ ok: true, bot: { id: body.id ?? 'macro-bot', name: body.name, listed: false } }) } });
  assert.equal(await r.discover.createBot({ name: ' Macro Bot ', id: '', description: '', model: '', soul: '  ' }), 'macro-bot');
  assert.deepEqual(r.posted, [['/data/bots', { name: 'Macro Bot' }]]);
  assert.ok(r.reads.includes('/data/bots.json'), 'an unlisted new bot sends the face back to the listing');
  assert.deepEqual(await r.discover.createBot({ name: '宏观派', id: '', description: '', model: '', soul: '' }), { error: 'Give it an id: a-z, 0-9, -' });
  assert.equal(await r.discover.createBot({ name: '宏观派', id: 'macro', description: 'Top down', model: 'deepseek/deepseek-chat', soul: '# M' }), 'macro');
  assert.deepEqual(r.posted[1], ['/data/bots', { name: '宏观派', id: 'macro', description: 'Top down', model: 'deepseek/deepseek-chat', soul: '# M' }]);
  assert.deepEqual(await r.discover.createBot({ name: '', id: '', description: '', model: '', soul: '' }), { error: 'Give it a name' });
  const taken = rig({ posts: { '/data/bots': Object.assign(new Error('bot already exists'), { status: 409, code: 'bot already exists' }) } });
  assert.deepEqual(await taken.discover.createBot({ name: 'Macro', id: '', description: '', model: '', soul: '' }), { error: 'bot already exists' });
});

test('modelChoices reads the catalog once into the store', async () => {
  const r = rig({ calls: { 'session/modelCatalog': { groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'Chat' }] }] } } });
  await r.discover.modelChoices();
  await r.discover.modelChoices();
  assert.deepEqual(r.d().models, [{ value: 'deepseek/deepseek-chat', label: 'DeepSeek · Chat' }]);
  assert.equal(r.called.filter(c => c[0] === 'session/modelCatalog').length, 1);
});
