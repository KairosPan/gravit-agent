// The Gravit box's page tag in the thread (plan 2, Task 3; spec 2026-11-16-gravit-box-design.md 6.7): an operator's message
// that opens with the tag is drawn as their words alone, under Asked from <the page in words>; the preview and the turn rail
// show the words alone too. Read from the message's text alone, so it holds with an empty store after a reload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapFrame } from '../../client/js/wire/mapper.js';
import { toMessages } from '../../client/js/host/kinds.js';
import { renderThread } from '../../client/js/render/thread.js';
import { railView } from '../../client/js/host/turns-view.js';
import { emptyState } from '../../client/js/data/empty.js';
import { withTable } from '../../client/js/i18n/words.js';
import { ZH } from '../../client/js/i18n/zh.js';

const NOW = new Date(2026, 10, 16, 10, 0).getTime();
const frame = (text, seq = 7) => ({ type: 'session/event', sessionId: 's1', event: { type: 'user/message', seq, time: 1, surfaceOp: 'append', data: { id: `m${seq}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } } } });
const mapped = text => toMessages(mapFrame(frame(text)), new Map(), NOW);
const convWith = messages => ({ id: 's1', title: 'T', kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: true, updatedAt: 5, created: null, messages, loaded: true, preview: null, usage: null, thinking: null, lastSeen: 0 });
const stateWith = () => emptyState();

test('a tagged message is drawn without its tag, under "Asked from …"', () => {
  const [msg] = mapped('[on screen · Markets · stock:NVDA]\nwhy is it down');
  assert.equal(msg.from, 'you'); assert.equal(msg.kind, 'text');
  assert.equal(msg.text, 'why is it down');
  assert.deepEqual(msg.data.onScreen, { page: 'Markets', id: 'stock:NVDA', at: null });
  const h = renderThread(convWith([msg]), stateWith(), NOW, {});
  assert.match(h, /class="you-from"[\s\S]*Asked from Markets · NVDA/);
  assert.match(h, /class="you-from"><svg/, 'the screen icon first');
  assert.doesNotMatch(h, /\[on screen/);
});

test('the caption comes from the text alone', () => {
  const [msg] = mapped('[on screen · Strategy · beta]\nhow is it doing');
  assert.match(renderThread(convWith([msg]), emptyState(), NOW, {}), /Asked from Strategy · beta/);
});

test('the caption is in the operator language', () => {
  const [msg] = mapped('[on screen · Desk]\nwhy');
  withTable(ZH, () => assert.match(renderThread(convWith([msg]), emptyState(), NOW, {}), /class="you-from"[\s\S]*从 [^<]+ 问的/));
});

test('a follow-up tag is drawn as before', () => {
  const [msg] = mapped('[follow-up · task w1 · CEO analogs]\nand the median?');
  assert.equal(msg.text, '[follow-up · task w1 · CEO analogs]\nand the median?');
  assert.equal(msg.data.onScreen, undefined);
  assert.doesNotMatch(renderThread(convWith([msg]), emptyState(), NOW, {}), /you-from/);
});

test('a text whose first line only looks like a tag stays as written', () => {
  const [msg] = mapped('[on screen · Nowhere]\nhi');
  assert.equal(msg.text, '[on screen · Nowhere]\nhi');
  assert.equal(msg.data.onScreen, undefined);
});

test('the turn rail shows the question without the tag', () => {
  // dsh's outline collapses whitespace and caps the prompt at 50 characters, so the tag and the words arrive on one line
  const v = railView({ id: 'conv', outline: [{ turn: 1, seq: 1, prompt: '[on screen · Desk] why', response: '' }] });
  assert.equal(v.ticks[0].prompt, 'why');
  const id = railView({ id: 'conv', outline: [{ turn: 1, seq: 1, prompt: '[on screen · Markets · stock:NVDA] and t…', response: '' }] });
  assert.equal(id.ticks[0].prompt, 'and t…');
  const clipped = railView({ id: 'conv', outline: [{ turn: 1, seq: 1, prompt: '[on screen · Markets · stock:NVDA · at 2026-…', response: '' }] });
  assert.equal(clipped.ticks[0].prompt, '');
  const twoLine = railView({ id: 'conv', outline: [{ turn: 1, seq: 1, prompt: '[on screen · Desk]\nwhy', response: '' }] });
  assert.equal(twoLine.ticks[0].prompt, 'why');
  const fake = railView({ id: 'conv', outline: [{ turn: 1, seq: 1, prompt: '[on screen · Nowhere] hi', response: '' }] });
  assert.equal(fake.ticks[0].prompt, '[on screen · Nowhere] hi');
  const plain = railView({ id: 'conv', outline: [{ turn: 1, seq: 1, prompt: 'plain', response: '' }] });
  assert.equal(plain.ticks[0].prompt, 'plain');
});
