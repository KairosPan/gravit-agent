// The Memory screen's Lessons tab (memory screen plan Task 3, render/memory-lessons.js) over states built with the real
// reducers: each card with its id, its state, its line, when it was armed, its words, its record and what the face checks;
// a changed card's two texts with the differing lines marked; the cases of a card that applies; the owner's chain broken;
// no card; a text cut by the face; text from the memory made visible and escaped, and an id off the plain shape keyless.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { renderMemoryScreen } from '../../client/js/render/memory-page.js';
import { lessonsHtml } from '../../client/js/render/memory-lessons.js';
import { withTable } from '../../client/js/i18n/words.js';
import { ZH } from '../../client/js/i18n/zh.js';
import {
  memoryLessons, armedLesson, changedLesson, unarmedLesson, retiredLesson, refusedLesson, brokenLesson, lessonCard, lessonText, memoryReseal,
} from './helpers/memory-page.js';

const NOW = Date.parse('2026-11-16T15:00:00.000Z');
const on = R.nav(emptyState(), { screen: 'memory', tab: 'lessons' });
const loaded = data => R.memoryPageLoaded(on, { read: 'lessons', data, at: NOW });
const page = st => st.memoryPage;
const draw = (data, st = loaded(data)) => lessonsHtml(page(st).lessons.data, page(st), NOW);
const count = (html, needle) => html.split(needle).length - 1;
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('an armed card: its id, its state, its line, when it was armed, its words in quotes, its counts and its retire command', () => {
  const html = draw(memoryLessons({ lessons: [armedLesson()] }));
  const words = text(html);
  assert.match(html, /<span class="mp-id">no-chasing<\/span>/);
  assert.match(html, /<span class="chip ok">Armed<\/span>/);
  assert.ok(words.includes('caveat · dont buy, add · US'), words);
  assert.ok(words.includes('armed Nov 14'));
  assert.ok(words.includes('“Do not chase a name up eight percent in five sessions”'));
  assert.ok(words.includes('fired 6 · followed 4 · overridden 1'));
  assert.ok(words.includes('no decision 1'));
  assert.match(html, /At the terminal/);
  assert.match(html, /<code class="mp-command">npx --no gravit-memory retire no-chasing --reason &quot;…&quot; --home \/srv\/owner\/memory<\/code>/);
});

test("an armed card's checks: the face checks:, change_5d_pct computed by the face, sector not", () => {
  const html = draw(memoryLessons({ lessons: [armedLesson()] }));
  assert.match(html, /the face checks:/);
  assert.match(html, /<li class="mp-check"><code class="mp-fact">change_5d_pct<\/code><span class="chip ok">computed<\/span>/);
  assert.match(html, /<li class="mp-check"><code class="mp-fact">sector<\/code><span class="chip grey">not computed<\/span>/);
  assert.match(html, /The sector the owner files the name under\./);
});

test('a changed card: Changed since armed, its key See the change; the diff closed shows no text', () => {
  const html = draw(memoryLessons({ lessons: [changedLesson()] }));
  assert.match(html, /Changed since armed/);
  assert.match(html, /<button type="button" class="btn-sm" data-action="memoryPageDiff" data-id="trim-into-strength">See the change<\/button>/);
  assert.doesNotMatch(html, /mp-diff/);
  assert.match(html, /npx --no gravit-memory arm trim-into-strength --home/);
  assert.match(html, /npx --no gravit-memory review --home/);
});

test('a changed card with its diff open: the two texts side by side under Armed and Now, the differing lines marked', () => {
  const st = R.memoryPageDiff(loaded(memoryLessons({ lessons: [changedLesson()] })), { id: 'trim-into-strength' });
  const html = draw(null, st);
  assert.match(html, /<div class="mp-diff">/);
  assert.match(html, /<div class="mp-diff-head">Armed<\/div>/);
  assert.match(html, /<div class="mp-diff-head">Now<\/div>/);
  assert.match(html, /<span class="mp-ln armed">Trim a third into a gap up<\/span>/);
  assert.match(html, /<span class="mp-ln file">Trim a half into a gap up<\/span>/);
  assert.match(html, /<span class="mp-ln">id: trim-into-strength<\/span>/);
  assert.ok(html.indexOf('Armed</div>') < html.indexOf('Now</div>'));
  assert.match(html, />Hide the change<\/button>/);
});

test("an unarmed card: Not armed, its file's text, its arm command; a retired card: Retired", () => {
  const html = draw(memoryLessons({ lessons: [unarmedLesson(), retiredLesson()] }));
  assert.match(html, /<span class="chip grey">Not armed<\/span>/);
  assert.match(html, /<pre class="mp-text">---\nid: add-below-stop\n[^<]*Never add below the stop\n<\/pre>/);
  assert.match(html, /<code class="mp-command">npx --no gravit-memory arm add-below-stop --home \/srv\/owner\/memory<\/code>/);
  assert.match(html, /<span class="chip grey">Retired<\/span>/);
  assert.ok(text(html).includes('careful short'), 'a card with no scope has no scope on its line');
});

test('a refused card and a broken one: the state, and the fault as given', () => {
  const html = draw(memoryLessons({ lessons: [refusedLesson(), brokenLesson()] }));
  assert.match(html, /<span class="chip down">Refused<\/span>/);
  assert.match(html, /<p class="mp-fault">card size-cap cannot be armed: its words are empty<\/p>/);
  assert.equal(count(html, 'its words are empty'), 1, 'a file fault the row repeats is drawn once');
  assert.match(html, /<span class="chip down">Broken<\/span>/);
  assert.match(html, /<p class="mp-fault">card earnings-hold cannot be read: lessons\/earnings-hold\.md is a directory, not a card file\.<\/p>/);
});

test('a card that applies with cases: a key opens them; open, each case and a median by horizon', () => {
  const closed = loaded(memoryLessons({ lessons: [armedLesson()] }));
  const shut = draw(null, closed);
  assert.match(shut, /<button type="button" class="btn-sm" data-action="memoryPageToggle" data-id="no-chasing">Cases<\/button>/);
  assert.doesNotMatch(shut, /mp-cases/);
  const html = draw(null, R.memoryPageToggle(closed, { id: 'no-chasing' }));
  assert.match(html, />Hide cases<\/button>/);
  const words = text(html);
  assert.ok(words.includes('median +3.20% over 5 sessions'), words);
  for (const part of ['2026-11-03', 'NVDA', 'pass', '-1.50%', '2026-11-07', 'SMCI', 'buy', '-4.10%']) assert.ok(words.includes(part), part);
  assert.ok(words.includes('Followed') && words.includes('Overridden'));
  assert.ok(words.includes('over 20 sessions'));
});

test("the owner's chain broken: one line at the top and the reseal command", () => {
  const html = draw(memoryLessons({ ownerChainBroken: true, reseal: memoryReseal, lessons: [armedLesson()] }));
  assert.ok(html.indexOf("No lesson is applied until the owner&#39;s chain is resealed") < html.indexOf('no-chasing'));
  assert.equal(count(html, 'resealed'), 1);
  assert.match(html, /<code class="mp-command">npx --no gravit-memory reseal --home \/srv\/owner\/memory<\/code>/);
  assert.doesNotMatch(draw(memoryLessons({ lessons: [armedLesson()] })), /resealed/);
});

test('no card at all: No lesson yet', () => {
  assert.match(draw(memoryLessons()), /<p class="mp-dim">No lesson yet<\/p>/);
});

test('a text cut by the face: the line Cut at 16,384 characters', () => {
  const card = lessonCard('long-one');
  const html = draw(memoryLessons({ lessons: [unarmedLesson({ id: 'long-one', file: lessonText(card, { cut: true }) })] }));
  assert.match(html, /<p class="mp-dim">Cut at 16,384 characters<\/p>/);
  assert.doesNotMatch(draw(memoryLessons({ lessons: [unarmedLesson()] })), /Cut at/);
});

test('words holding a direction mark, a line break and markup: drawn visible and as text; an id with a space has no key', () => {
  const words = 'buy <i>now</i>\u202e\nthen';
  const card = lessonCard('a b', { words });
  const row = armedLesson({ id: 'a b', armed: lessonText(card), file: lessonText(card), fault: 'bad\u202e<b>x</b>', commands: { retire: 'npx --no gravit-memory retire "a\u202eb"' } });
  const html = draw(memoryLessons({ lessons: [row] }));
  assert.ok(html.includes('“buy &lt;i&gt;now&lt;/i&gt;\\u202e\\u000athen”'), 'the mark and the break as their escapes, the markup as text');
  assert.ok(html.includes('bad\\u202e&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(html.includes('retire &quot;a\\u202eb&quot;'));
  assert.doesNotMatch(html, /\u202e/, 'the raw mark is nowhere');
  assert.doesNotMatch(html, /<i>|<b>/);
  assert.match(html, /<span class="mp-id">a b<\/span>/);
  assert.doesNotMatch(html, /data-action/, 'no key for an id off the plain shape');
  assert.doesNotMatch(html, /data-id/);
});

test("a text's lines are each made visible; a changed card's diff lines too", () => {
  const was = lessonCard('trim-into-strength', { words: 'one\u202e' });
  const now = lessonCard('trim-into-strength', { words: 'two\u200b' });
  const row = changedLesson({ armed: lessonText(was), file: lessonText(now) });
  const html = draw(null, R.memoryPageDiff(loaded(memoryLessons({ lessons: [row] })), { id: 'trim-into-strength' }));
  assert.ok(html.includes('one\\u202e') && html.includes('two\\u200b'));
  assert.doesNotMatch(html, /[\u202e\u200b]/);
  const plain = draw(memoryLessons({ lessons: [unarmedLesson({ file: lessonText(lessonCard('add-below-stop', { words: 'x\u2028y' })) })] }));
  assert.ok(plain.includes('x\\u2028y'));
});

test("the reducers keep a key's id to the plain shape", () => {
  const st = loaded(memoryLessons());
  assert.equal(R.memoryPageToggle(st, { id: 'a b' }), st);
  assert.equal(R.memoryPageDiff(st, { id: '<x>' }), st);
  assert.notEqual(R.memoryPageToggle(st, { id: 'no-chasing' }), st);
});

test('the screen draws the lessons body for the Lessons tab, wrapped in mp-body; the other tabs keep their line', () => {
  const html = renderMemoryScreen(loaded(memoryLessons({ lessons: [armedLesson()] })), NOW);
  assert.match(html, /<div class="mp-body mp-lessons">/);
  assert.match(html, /no-chasing/);
  const health = renderMemoryScreen(R.memoryPageLoaded(R.nav(emptyState(), { screen: 'memory', tab: 'health' }), { read: 'health', data: { ok: true, connected: true }, at: NOW }), NOW);
  assert.match(health, /<p class="mp-body">Health<\/p>/);
});

test('the Lessons tab under ZH', () => {
  const st = R.memoryPageToggle(loaded(memoryLessons({ ownerChainBroken: true, reseal: memoryReseal, lessons: [armedLesson(), changedLesson(), unarmedLesson()] })), { id: 'no-chasing' });
  const html = withTable(ZH, () => draw(null, st));
  for (const word of ['已启用', '启用后已改动', '未启用', '终端', '查看改动', '个案', '遵守', '推翻', '核对的事实：', '本服务计算']) assert.ok(html.includes(word), word);
  assert.match(withTable(ZH, () => draw(memoryLessons())), /还没有教训/);
});
