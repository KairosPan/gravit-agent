// The Memory screen's frame drawn (memory screen plan Task 2) over states built with the real reducers: the head, the four
// tabs as links with the open one pressed and the waiting count in the third, Loading before a read, a memory not connected
// (its words as given, made visible and escaped, and the command), a failed read over the data it kept, and one with nothing
// kept; and the words under ZH.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { renderMemoryScreen } from '../../client/js/render/memory-page.js';
import { withTable } from '../../client/js/i18n/words.js';
import { ZH } from '../../client/js/i18n/zh.js';
import { memoryLessons, memoryNotConnected, memoryWaiting, memoryProposals } from './helpers/memory-page.js';

const NOW = Date.parse('2026-11-16T15:00:00.000Z');
const on = (tab = 'lessons') => R.nav(emptyState(), { screen: 'memory', tab });
const loaded = (s, read, data) => R.memoryPageLoaded(s, { read, data, at: NOW });
const draw = s => renderMemoryScreen(s, NOW);
const count = (html, needle) => html.split(needle).length - 1;

test('the head reads Memory; the four tabs are links, the open one pressed', () => {
  const html = draw(on('decisions'));
  assert.match(html, /<h1 class="head-title">Memory<\/h1>/);
  const links = [...html.matchAll(/<a class="seg-item[^"]*"[^>]*href="([^"]+)">([^<]+)<\/a>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(links, [['#/memory/lessons', 'Lessons'], ['#/memory/decisions', 'Decisions'], ['#/memory/waiting', 'Waiting'], ['#/memory/health', 'Health']]);
  assert.match(html, /<a class="seg-item pressed" aria-current="page" href="#\/memory\/decisions">/);
  assert.equal(count(html, 'pressed'), 1);
  assert.match(html, /<\/main>$/, 'ends in </main>, for the drawers spliced in before it');
});

test('with two proposals waiting the third tab reads Waiting · 2; none, or a memory not connected, reads Waiting', () => {
  assert.match(draw(loaded(on(), 'waiting', memoryWaiting({ proposals: memoryProposals() }))), />Waiting · 2<\/a>/);
  assert.match(draw(loaded(on(), 'waiting', memoryWaiting())), />Waiting<\/a>/);
  assert.match(draw(loaded(on(), 'waiting', memoryNotConnected())), />Waiting<\/a>/);
});

test('before a read: Loading…; read: one line naming the tab', () => {
  assert.match(draw(on()), /<p class="mp-dim">Loading…<\/p>/);
  const html = draw(loaded(on(), 'lessons', memoryLessons()));
  assert.match(html, /<p class="mp-body">Lessons<\/p>/);
  assert.doesNotMatch(html, /Loading/);
  assert.match(draw(loaded(on('health'), 'health', { ok: true, connected: true })), /<p class="mp-body">Health<\/p>/);
});

test("not connected: its words as given, made visible and escaped, the command in a code, and no tab body", () => {
  const say = 'no <b>memory</b> here\u202e: run init';
  const html = draw(loaded(on(), 'lessons', memoryNotConnected({ say, command: 'npx --no gravit-memory init --home "/a b"' })));
  assert.match(html, /<p class="mp-say">no &lt;b&gt;memory&lt;\/b&gt; here\\u202e: run init<\/p>/);
  assert.match(html, /<code class="mp-command">npx --no gravit-memory init --home &quot;\/a b&quot;<\/code>/);
  assert.doesNotMatch(html, /mp-body/);
  assert.doesNotMatch(html, /\u202e/, 'the mark drawn as its escape');
});

test('a failed read with data kept: one dim line with its words above the body as it was; with nothing kept: Unavailable', () => {
  const kept = R.memoryPageFailed(loaded(on(), 'lessons', memoryLessons()), { read: 'lessons', at: NOW, message: 'the memory did not answer in time' });
  const html = draw(kept);
  assert.match(html, /<div class="mp-page"><p class="mp-dim">the memory did not answer in time<\/p><p class="mp-body">Lessons<\/p><\/div>/);
  assert.equal(count(html, 'mp-dim'), 1);
  const none = draw(R.memoryPageFailed(on(), { read: 'lessons', at: NOW, message: 'the memory could not be read' }));
  assert.match(none, /<p class="mp-dim">the memory could not be read<\/p><p class="mp-dim">Unavailable<\/p>/);
  assert.doesNotMatch(none, /mp-body/);
  assert.match(draw(R.memoryPageFailed(on(), { read: 'lessons', at: NOW })), /<div class="mp-page"><p class="mp-dim">Unavailable<\/p><\/div>/, 'no words: Unavailable alone');
  assert.match(html, /<\/main>$/);
});

test('the frame under ZH', () => {
  const html = withTable(ZH, () => draw(loaded(on('waiting'), 'waiting', memoryWaiting({ proposals: memoryProposals() }))));
  for (const word of ['记忆', '教训', '决策', '待处理 · 2', '健康']) assert.ok(html.includes(word), word);
  assert.ok(withTable(ZH, () => draw(on())).includes('加载中…'));
});
