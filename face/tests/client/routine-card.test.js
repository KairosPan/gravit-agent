// The routine card (desk-page plan 3 Task 3, spec 2026-11-14 §6.5): an ok routine_propose result lifted into a message of its
// own, u<callId>, drawn from the call's own arguments and the result's when line, its state from the proposal the routines read
// holds by id - seven chips, the keys only while pending, the settled lines; a proposal the read does not hold drawn Closed
// with no keys (Review Focus 3); the turn's closing words after an ok proposal not drawn (Review Focus 5); the two answers
// posted from the routines poll, which runs on Messages too; and the card under ZH.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapFrame } from '../../client/js/wire/mapper.js';
import { rememberCall, toMessages, routineLift, routineClosings, PROPOSE_TOOL } from '../../client/js/host/kinds.js';
import { routineCardOf } from '../../client/js/host/desk-page-view.js';
import { renderMessage, renderThread } from '../../client/js/render/thread.js';
import { createStore } from '../../client/js/store.js';
import { reducers, reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startDeskRoutines } from '../../client/js/host/desk-routines.js';
import { withTable } from '../../client/js/i18n/words.js';
import { ZH } from '../../client/js/i18n/zh.js';
import { deskRoutines } from './helpers/desk-news.js';

const P = 'p-0a1b2c3d';
const NOW_ISO = '2026-11-14T13:00:00.000Z'; // Fri Nov 14, 08:00 New York
const ARGS = {
  name: 'Idea <screening>', schedule: { days: 'trading', every: 30, from: '08:30', to: '16:00' },
  instruction: 'Read quotes & news.\nScreen for <b>ideas</b>.\nPlace no orders.', note: 'No economic calendar is connected.',
};
const RESULT = { ok: true, proposal: P, when: 'Trading days, every 30 min, 08:30–16:00 ET · 16 runs a day', runsPerDay: 16 };

const callFrame = (callId, name, args) => ({ type: 'session/event', sessionId: 's1', event: { type: 'tool/call', seq: 40, time: 1, data: { turn: 4, step: 1, callId, name, arguments: JSON.stringify(args) } } });
const resultFrame = (callId, text, isError = false) => ({ type: 'session/event', sessionId: 's1', event: { type: 'tool/result', seq: 41, time: 2, surfaceOp: 'append', data: { turn: 4, step: 1, message: { id: 'm-41', role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text }], isError } } } });
const lifted = (callId, args, result, isError = false) => {
  const calls = new Map();
  rememberCall(calls, callFrame(callId, PROPOSE_TOOL, args));
  return toMessages(mapFrame(resultFrame(callId, typeof result === 'string' ? result : JSON.stringify(result), isError)), calls, 1000);
};
const card = (over = {}) => ({ id: 'uc1', seq: 41, at: 1000, from: 'gravit', ...routineLift(PROPOSE_TOOL, ARGS, JSON.stringify(RESULT), false, 'c1'), ...over });
const proposal = (over = {}) => ({ id: P, name: 'Idea <screening>', when: RESULT.when, instruction: ARGS.instruction, state: 'pending', current: false, proposedAt: '2026-11-14T12:59:00.000Z', ...over });
const read = (...proposals) => deskRoutines({ proposals });
const stateWith = data => R.deskRoutinesLoaded(emptyState(), { data, at: Date.parse(NOW_ISO) });
const conv = (messages = []) => ({ id: 's1', title: 'T', kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: true, updatedAt: 5, created: null, messages, loaded: true, preview: null, usage: null, thinking: null, lastSeen: 0 });
const NEXT_TODAY = { date: '2026-11-14', slot: '08:30', at: '2026-11-14T13:30:00.000Z' };
const NEXT_LATER = { date: '2026-11-17', slot: '08:30', at: '2026-11-17T13:30:00.000Z' };

test('an ok routine_propose result lifts the card u<callId>: the name, instruction, note and replaces from the call, the proposal and when from the result', () => {
  const out = lifted('c1', { ...ARGS, replaces: 'r-idea' }, { ...RESULT, replaces: 'r-idea' });
  assert.deepEqual(out.map(m => m.kind), ['tool', 'routine']);
  const [, m] = out;
  assert.equal(m.id, 'uc1'); assert.equal(m.from, 'gravit'); assert.equal(m.text, 'Idea <screening>');
  assert.deepEqual(m.data, { callId: 'c1', proposal: P, name: 'Idea <screening>', when: RESULT.when, instruction: ARGS.instruction, note: ARGS.note, replaces: 'r-idea' });
  const bare = routineLift(PROPOSE_TOOL, { name: 'N', instruction: 'I' }, JSON.stringify(RESULT), false, 'c2');
  assert.deepEqual(bare.data, { callId: 'c2', proposal: P, name: 'N', when: RESULT.when, instruction: 'I' }, 'no note, no replaces');
});

test('a refused proposal, a result that is not ok, one with no proposal id, or another tool lifts nothing', () => {
  assert.deepEqual(lifted('c3', ARGS, 'Error: routine_propose runs only in a turn the operator opened', true).map(m => m.kind), ['tool']);
  assert.deepEqual(lifted('c4', ARGS, { ok: false }).map(m => m.kind), ['tool']);
  assert.deepEqual(lifted('c5', ARGS, 'not json').map(m => m.kind), ['tool']);
  assert.deepEqual(lifted('c6', ARGS, { ok: true, when: 'x' }).map(m => m.kind), ['tool']);
  assert.equal(routineLift('routine_list', ARGS, JSON.stringify(RESULT), false, 'c7'), null);
  assert.equal(routineLift(PROPOSE_TOOL, ARGS, JSON.stringify(RESULT), true, 'c7'), null);
});

test('the card in each of its seven chips, from the proposal the read holds by id', () => {
  const now = NOW_ISO;
  const of = (p, m = card()) => routineCardOf(m, read(p), { now });
  const pending = of(proposal());
  assert.deepEqual([pending.chip, pending.keys, pending.line], ['new', true, undefined]);
  assert.equal(pending.name, 'Idea <screening>'); assert.equal(pending.when, RESULT.when); assert.equal(pending.instruction, ARGS.instruction); assert.equal(pending.note, ARGS.note);
  const change = of(proposal({ replaces: 'r-idea', replacesName: 'Idea screening' }), card({ data: { ...card().data, replaces: 'r-idea' } }));
  assert.deepEqual([change.chip, change.keys, change.line], ['change', true, { kind: 'replaces', name: 'Idea screening' }]);
  const added = of(proposal({ state: 'confirmed', current: true, routine: 'r-idea', next: NEXT_TODAY }));
  assert.deepEqual([added.chip, added.keys, added.line, added.desk], ['added', false, { kind: 'first', day: 'Today', time: '08:30' }, true]);
  const later = of(proposal({ state: 'confirmed', current: true, routine: 'r-idea', next: NEXT_LATER }), card({ data: { ...card().data, replaces: 'r-idea' } }));
  assert.deepEqual(later.line, { kind: 'next', day: 'Nov 17', time: '08:30' }, 'a change confirmed: its next run, on another day by its date');
  const noNext = of(proposal({ state: 'confirmed', current: true, routine: 'r-idea' }));
  assert.deepEqual([noNext.chip, noNext.line, noNext.desk], ['added', undefined, true], 'a paused routine has no next run: View on Desk alone');
  assert.deepEqual([of(proposal({ state: 'confirmed', current: false })).chip, of(proposal({ state: 'confirmed', current: false })).keys], ['replaced', false]);
  assert.equal(of(proposal({ state: 'superseded' })).chip, 'replaced');
  const dismissed = of(proposal({ state: 'dismissed' }));
  assert.deepEqual([dismissed.chip, dismissed.keys, dismissed.line], ['dismissed', false, { kind: 'notAdded' }]);
  assert.deepEqual([of(proposal({ state: 'expired' })).chip, of(proposal({ state: 'expired' })).keys], ['expired', false]);
});

test('Review Focus 3: a read that cannot load, or a proposal the read does not hold, is Closed, from the call, with no keys', () => {
  for (const data of [{ ok: false }, deskRoutines({ load: { ok: false, error: 'x' }, proposals: [] }), read(proposal({ id: 'p-ffffffff' })), deskRoutines()]) {
    const c = routineCardOf(card(), data, { now: NOW_ISO });
    assert.deepEqual([c.chip, c.keys, c.line], ['closed', false, undefined]);
    assert.equal(c.name, 'Idea <screening>'); assert.equal(c.instruction, ARGS.instruction);
  }
  const html = renderMessage(card(), conv(), stateWith(deskRoutines()));
  assert.match(html, /<span class="chip grey">Closed<\/span>/);
  assert.doesNotMatch(html, /data-action="routine(Yes|No)"/);
});

test('before the first routines read has answered, the card draws no chip and no keys, from the call', () => {
  for (const data of [null, undefined]) {
    const c = routineCardOf(card(), data, { now: NOW_ISO });
    assert.deepEqual([c.chip, c.keys, c.line], [null, false, undefined]);
    assert.equal(c.name, 'Idea <screening>'); assert.equal(c.instruction, ARGS.instruction);
  }
  for (const state of [emptyState(), R.deskRoutinesFailed(emptyState(), { at: Date.parse(NOW_ISO), message: 'HTTP 502' })]) {
    const html = renderMessage(card(), conv(), state);
    assert.match(html, /Idea &lt;screening&gt;/);
    assert.doesNotMatch(html, /class="chip/, 'no chip, not Closed');
    assert.doesNotMatch(html, /data-action="routine(Yes|No)"/);
  }
});

test('a refused confirm keeps the keys: the limit line for limit, the request failed for any other', () => {
  const limit = routineCardOf(card(), read(proposal()), { now: NOW_ISO, refused: 'limit' });
  assert.deepEqual([limit.chip, limit.keys, limit.line], ['new', true, { kind: 'limit' }]);
  const failed = routineCardOf(card(), read(proposal()), { now: NOW_ISO, refused: 'failed' });
  assert.deepEqual([failed.keys, failed.line], [true, { kind: 'failed' }]);
  assert.equal(routineCardOf(card(), read(proposal({ state: 'dismissed' })), { now: NOW_ISO, refused: 'limit' }).line.kind, 'notAdded', 'settled: the said line goes');
  const html = renderMessage(card(), conv(), R.deskProposalSaid(stateWith(read(proposal())), { proposal: P, said: 'limit' }));
  assert.match(html, /20 routines already: delete one on Desk first/);
  assert.match(html, /data-action="routineYes"/);
});

test('the card drawn: the name and chip, the when line with the clock, the instruction escaped with its line breaks, the note, Add to Routines? and ✗ ✓', () => {
  const html = renderMessage(card(), conv(), stateWith(read(proposal())));
  assert.match(html, /^<div class="msg left">/);
  assert.match(html, /<div class="card orange"><div class="card-head"><div class="card-title">Idea &lt;screening&gt;<\/div><span class="chip grey">New routine<\/span><\/div>/);
  assert.match(html, /<div class="rt-when"><svg[^>]*>.*?<\/svg><span>Trading days, every 30 min, 08:30–16:00 ET · 16 runs a day<\/span><\/div>/);
  assert.match(html, /<p class="rt-text">Read quotes &amp; news\.\nScreen for &lt;b&gt;ideas&lt;\/b&gt;\.\nPlace no orders\.<\/p>/);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /<div class="dim">No economic calendar is connected\.<\/div>/);
  assert.match(html, /<div class="rt-ask"><span class="rt-q">Add to Routines\?<\/span><div class="keys right">/);
  assert.match(html, /<button type="button" class="key no" aria-label="Dismiss" title="Dismiss" data-action="routineNo" data-proposal="p-0a1b2c3d">/);
  assert.match(html, /<button type="button" class="key yes" aria-label="Add to Routines" title="Add to Routines" data-action="routineYes" data-proposal="p-0a1b2c3d">/);
  assert.ok(html.indexOf('routineNo') < html.indexOf('routineYes'), '✗ then ✓');
});

test('the settled lines: First run with View on Desk, Next run for a change, Not added, Replaces while a change waits', () => {
  const added = renderMessage(card(), conv(), stateWith(read(proposal({ state: 'confirmed', current: true, routine: 'r-idea', next: NEXT_TODAY }))));
  assert.match(added, /<span class="chip up">Added to Routines<\/span>/);
  assert.match(added, /<div class="rt-done"><span class="dim">First run Today at 08:30 ET<\/span><a href="#\/desk">View on Desk<\/a><\/div>/);
  assert.doesNotMatch(added, /rt-ask|routineYes/);
  const change = card({ data: { ...card().data, replaces: 'r-idea' } });
  assert.match(renderMessage(change, conv(), stateWith(read(proposal({ state: 'confirmed', current: true, routine: 'r-idea', next: NEXT_LATER })))), /Next run Nov 17 at 08:30 ET/);
  const waiting = renderMessage(change, conv(), stateWith(read(proposal({ replaces: 'r-idea', replacesName: 'Idea <old>' }))));
  assert.match(waiting, /<span class="chip grey">Change<\/span>/);
  assert.match(waiting, /<div class="dim">Replaces the current version of Idea &lt;old&gt;<\/div>/);
  const dismissed = renderMessage(card(), conv(), stateWith(read(proposal({ state: 'dismissed' }))));
  assert.match(dismissed, /<span class="chip grey">Dismissed<\/span>/);
  assert.match(dismissed, /<div class="dim">Not added\. Nothing will run\.<\/div>/);
  for (const [p, word] of [[proposal({ state: 'superseded' }), 'Replaced'], [proposal({ state: 'confirmed', current: false }), 'Replaced'], [proposal({ state: 'expired' }), 'Expired']]) {
    const html = renderMessage(card(), conv(), stateWith(read(p)));
    assert.match(html, new RegExp(`<span class="chip grey">${word}</span>`));
    assert.doesNotMatch(html, /rt-ask|rt-done/);
  }
});

// Review Focus 5: the reply is the card alone
const you = (id, seq, text = 'Screen every 30 minutes') => ({ id, seq, at: 1000, from: 'you', kind: 'text', text, data: {} });
const words = (id, seq, text) => ({ id, seq, at: 1000, from: 'gravit', kind: 'text', text, data: { markdown: true } });
const row = (id, seq, isError = false) => ({ id: `t${id}`, seq, at: 1000, from: 'gravit', kind: 'tool', text: '', data: { callId: id, result: '', isError } });
test("Review Focus 5: the turn's closing words after an ok proposal are not drawn; before it, after a refused one, or once another call follows, they are", () => {
  const ok = [you('e1', 1), words('e2', 2, 'Drafting it now.'), row('c1', 3), card({ seq: 3 }), words('e4', 4, "I've drafted the routine."), words('e5', 5, 'Confirm it above.')];
  assert.deepEqual([...routineClosings(ok)], ['e4', 'e5']);
  const html = renderThread(conv(ok), stateWith(read(proposal())), 1000);
  assert.match(html, /Drafting it now\./, 'the words before the call stay');
  assert.match(html, /New routine/);
  assert.doesNotMatch(html, /drafted the routine|Confirm it above/);
  const refused = [you('e1', 1), row('c1', 2, true), words('e3', 3, 'The schedule was refused; say a time.')];
  assert.deepEqual([...routineClosings(refused)], []);
  assert.match(renderThread(conv(refused), emptyState(), 1000), /The schedule was refused/);
  const more = [you('e1', 1), row('c1', 2), card({ seq: 2 }), words('e3', 3, 'Checking the list.'), row('c2', 4), words('e5', 5, 'Done, with a list.')];
  assert.deepEqual([...routineClosings(more)], [], 'the proposal was not the last call');
  const next = [...ok, you('e6', 6, 'And a recap?'), words('e7', 7, 'Which time?')];
  assert.deepEqual([...routineClosings(next)], ['e4', 'e5'], "the next turn's words are drawn");
  assert.match(renderThread(conv(next), emptyState(), 1000), /Which time\?/);
});

// the two answers, through the routines poll
const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
function rig() {
  const store = createStore({ initial: emptyState(), reducers });
  const reads = [];
  const posted = [];
  const answers = { routines: read(proposal()), post: { ok: true } };
  const getJson = path => { reads.push(path); return Promise.resolve(answers.routines); };
  const postJson = (path, body) => {
    posted.push([path, body]);
    const a = typeof answers.post === 'function' ? answers.post(path, body) : answers.post;
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  };
  const dr = startDeskRoutines({ store, getJson, postJson, schedule: () => 1, cancelTimer: () => {}, now: () => 1000 });
  return { store, dr, reads, posted, answers };
}

test('✓ posts { proposal } to confirm and reads again, the card settling on the read; ✗ posts to dismiss', async () => {
  const r = rig();
  r.answers.routines = read(proposal({ state: 'confirmed', current: true, routine: 'r-idea', next: NEXT_TODAY }));
  await r.dr.confirm(P);
  await settle();
  assert.deepEqual(r.posted, [['/data/desk/routines/confirm', { proposal: P }]]);
  assert.deepEqual(r.reads, ['/data/desk/routines']);
  assert.equal(routineCardOf(card(), r.store.get().deskPage.routines.data, { now: NOW_ISO }).chip, 'added');
  r.answers.routines = read(proposal({ state: 'dismissed' }));
  await r.dr.dismiss(P);
  await settle();
  assert.deepEqual(r.posted.at(-1), ['/data/desk/routines/dismiss', { proposal: P }]);
  assert.equal(r.reads.length, 2);
  await r.dr.confirm('');
  assert.equal(r.posted.length, 2, 'no proposal, no post');
});

test("a confirm refused for the limit says limit on the card's proposal; any other refusal says failed; the next answer clears it", async () => {
  const r = rig();
  r.answers.post = Object.assign(new Error('limit'), { status: 409, code: 'limit' });
  await r.dr.confirm(P);
  await settle();
  assert.deepEqual(r.store.get().deskPage.pSaid, { [P]: 'limit' });
  assert.deepEqual(r.reads, [], 'refused: nothing to read again');
  r.answers.post = Object.assign(new Error('HTTP 502'), { status: 502, code: 'HTTP 502' });
  await r.dr.dismiss(P);
  assert.deepEqual(r.store.get().deskPage.pSaid, { [P]: 'failed' });
  r.answers.post = { ok: true };
  await r.dr.confirm(P);
  assert.deepEqual(r.store.get().deskPage.pSaid, {});
});

test('ZH: the card reads 例行任务', () => {
  withTable(ZH, () => {
    const html = renderMessage(card(), conv(), stateWith(read(proposal())));
    assert.match(html, /例行任务/);
    assert.doesNotMatch(html, /Add to Routines|New routine/);
    assert.match(renderMessage(card(), conv(), stateWith(read(proposal({ state: 'confirmed', current: true, routine: 'r-idea', next: NEXT_TODAY })))), /值守台/);
  });
});

// fix round 1: one answer in flight per card, its keys hidden meanwhile; only the bare tool name lifts; a proposal whose name
// or instruction is not the call's is not this card's
test('two confirms, or ✓ then ✗, before the first answer settles post once; the keys are hidden until the read after it settles', async () => {
  const r = rig();
  let release;
  r.answers.post = () => new Promise(res => { release = () => res({ ok: true }); });
  const first = r.dr.confirm(P);
  void r.dr.confirm(P);
  void r.dr.dismiss(P);
  assert.deepEqual(r.posted, [['/data/desk/routines/confirm', { proposal: P }]], 'one post for one proposal');
  assert.deepEqual(r.store.get().deskPage.pBusy, { [P]: true });
  const busy = renderMessage(card(), conv(), { ...r.store.get(), deskPage: { ...r.store.get().deskPage, routines: { status: 'ready', data: read(proposal()), at: Date.parse(NOW_ISO) } } });
  assert.doesNotMatch(busy, /data-action="routine(Yes|No)"/, 'no keys while the answer is in flight');
  assert.equal(routineCardOf(card(), read(proposal()), { now: NOW_ISO, busy: true }).keys, false);
  release();
  await first;
  await settle();
  assert.deepEqual(r.store.get().deskPage.pBusy, {});
  assert.deepEqual(r.reads, ['/data/desk/routines'], 'read again before the keys return');
  r.answers.post = { ok: true };
  await r.dr.dismiss(P);
  assert.equal(r.posted.length, 2, 'settled: a new answer posts');
});

test('only the bare routine_propose lifts a card: a foreign server tool of that name lifts nothing', () => {
  assert.equal(routineLift('mcp__x__routine_propose', ARGS, JSON.stringify(RESULT), false, 'c8'), null);
  const calls = new Map();
  rememberCall(calls, callFrame('c8', 'mcp__x__routine_propose', ARGS));
  assert.deepEqual(toMessages(mapFrame(resultFrame('c8', JSON.stringify(RESULT))), calls, 1000).map(m => m.kind), ['tool']);
});

test("a proposal whose name or instruction (trimmed) is not the call's draws the card Closed with no keys", () => {
  const of = p => routineCardOf(card(), read(p), { now: NOW_ISO });
  assert.equal(of(proposal({ name: '  Idea <screening> ', instruction: `${ARGS.instruction}\n` })).chip, 'new', 'trimmed alike');
  for (const p of [proposal({ name: 'Other' }), proposal({ instruction: 'Buy everything.' }), proposal({ state: 'confirmed', current: true, instruction: 'x', next: NEXT_TODAY })]) {
    const c = of(p);
    assert.deepEqual([c.chip, c.keys, c.line], ['closed', false, undefined]);
  }
});
