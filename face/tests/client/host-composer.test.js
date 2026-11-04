// The composer menus' reads (host/composer.js): commands kept by preset (D13), skills, files, the room's roster.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startComposerReads, presetKey } from '../../client/js/host/composer.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function rig({ call, getJson, postJson } = {}) {
  const calls = [];
  const reads = startComposerReads({
    call: async (method, params) => { calls.push({ via: 'call', method, params }); return call ? call(method, params) : null; },
    getJson: async path => { calls.push({ via: 'get', path }); return getJson ? getJson(path) : null; },
    postJson: async (path, body) => { calls.push({ via: 'post', path, body }); return postJson ? postJson(path, body) : null; },
  });
  return { reads, calls };
}

const COMPACT = [{ name: 'compact', description: 'Compact the conversation' }];

test('presetKey is the conversation\'s preset, or gravit', () => {
  assert.equal(presetKey({ preset: 'news-scout' }), 'news-scout');
  assert.equal(presetKey({ id: 's1' }), 'gravit');
  assert.equal(presetKey(null), 'gravit');
});

test('commands are read on a live conversation and kept by preset; a cold one gets the kept rows and calls nothing', async () => {
  const r = rig({ call: () => COMPACT });
  const rows = await r.reads.commands({ id: 's1', live: true });
  assert.deepEqual(rows, COMPACT);
  assert.deepEqual(r.calls, [{ via: 'call', method: 'commands/list', params: { agentId: 's1' } }]);
  r.calls.length = 0;
  const cold = await r.reads.commands({ id: 's2', live: false });
  assert.deepEqual(cold, COMPACT, 'the same preset (gravit) shares the kept rows');
  assert.deepEqual(r.calls, [], 'a cold conversation calls nothing');
  assert.deepEqual(r.reads.keptCommands({ id: 's9', preset: 'gravit' }), COMPACT);
});

test('a cold conversation of a preset never read has no commands', async () => {
  const r = rig({ call: () => COMPACT });
  await r.reads.commands({ id: 's1', live: true });
  r.calls.length = 0;
  assert.equal(await r.reads.commands({ id: 'b1', live: false, preset: 'news-scout' }), null);
  assert.equal(r.reads.keptCommands({ id: 'b1', preset: 'news-scout' }), null);
  assert.deepEqual(r.calls, []);
});

test('a failed commands read keeps the rows it had', async () => {
  let answer = () => COMPACT;
  const r = rig({ call: () => answer() });
  await r.reads.commands({ id: 's1', live: true });
  answer = () => { throw Object.assign(new Error('gone'), { code: 'gateway/lookup-not-found' }); };
  assert.deepEqual(await r.reads.commands({ id: 's1', live: true }), COMPACT);
  answer = () => ({ not: 'an array' });
  assert.deepEqual(await r.reads.commands({ id: 's1', live: true }), COMPACT);
  assert.deepEqual(r.reads.keptCommands({ id: 's1' }), COMPACT);
});

test('skills are read cold, and a throw is none', async () => {
  let answer = () => ({ skills: [{ name: 'lunhui', description: 'A-share run', modelInvocable: true }] });
  const r = rig({ call: () => answer() });
  assert.equal(r.reads.keptSkills('s1'), null);
  const skills = await r.reads.skills('s1');
  assert.deepEqual(skills, [{ name: 'lunhui', description: 'A-share run', modelInvocable: true }]);
  assert.deepEqual(r.calls, [{ via: 'call', method: 'skills/list', params: { request: { sessionId: 's1' } } }]);
  assert.deepEqual(r.reads.keptSkills('s1'), skills);
  answer = () => { throw new Error('boom'); };
  assert.deepEqual(await r.reads.skills('s2'), []);
  assert.deepEqual(r.reads.keptSkills('s2'), []);
});

test('the files read sends q and dir encoded, and only the latest call answers', async () => {
  const pending = [];
  const r = rig({ getJson: () => { const d = deferred(); pending.push(d); return d.promise; } });
  const first = r.reads.files('茅台');
  const second = r.reads.files('stra', 'strategies/a b');
  await new Promise(res => setTimeout(res, 0));
  assert.deepEqual(r.calls.map(c => c.path), ['/data/files?q=%E8%8C%85%E5%8F%B0', '/data/files?q=stra&dir=strategies%2Fa%20b']);
  pending[1].resolve({ ok: true, items: [{ path: 'strategies/a b/x.md', kind: 'file' }], truncated: false });
  pending[0].resolve({ ok: true, items: [{ path: 'old.md', kind: 'file' }], truncated: true });
  assert.deepEqual(await second, { items: [{ path: 'strategies/a b/x.md', kind: 'file' }], truncated: false });
  assert.equal(await first, null, 'a superseded call answers null');
});

test('a failed files read answers null', async () => {
  const r = rig({ getJson: () => { throw Object.assign(new Error('HTTP 400'), { status: 400 }); } });
  assert.equal(await r.reads.files(''), null);
  assert.deepEqual(r.calls.map(c => c.path), ['/data/files?q=']);
  const r2 = rig({ getJson: () => ({ ok: false }) });
  assert.equal(await r2.reads.files('x'), null);
});

test('the roster is the room state\'s, and none on a throw', async () => {
  let answer = () => ({ ok: true, roster: [{ id: 'news-scout', name: 'News Scout' }], members: [], caps: {} });
  const r = rig({ postJson: () => answer() });
  assert.deepEqual(await r.reads.roster('s1'), [{ id: 'news-scout', name: 'News Scout' }]);
  assert.deepEqual(r.calls, [{ via: 'post', path: '/data/rooms/state', body: { sessionId: 's1' } }]);
  answer = () => { throw new Error('not a room'); };
  assert.deepEqual(await r.reads.roster('s1'), []);
});
