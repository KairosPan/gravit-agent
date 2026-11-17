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
  assert.match(html, /At the terminal, in face\//);
  assert.match(html, /<code class="mp-command">npx --no gravit-memory retire no-chasing --reason &quot;…&quot; --home \/srv\/owner\/memory<\/code>/);
});

test("an armed card's checks: each as fact, operator and value, computed or not, the card's own definition and the face's beside it", () => {
  const html = draw(memoryLessons({ lessons: [armedLesson()] }));
  assert.match(html, /the face checks:/);
  assert.ok(html.includes('<li class="mp-check"><code class="mp-fact">change_5d_pct &gt; 8</code><span class="chip ok">computed</span>' +
    '<span class="mp-def"><span class="mp-def-who">the card defines it:</span> How far the name ran in five sessions, in percent.</span>' +
    '<span class="mp-def"><span class="mp-def-who">the face computes it:</span> The last price in the Market&#39;s quote over the close 5 full sessions'), html);
  assert.match(html, /<li class="mp-check"><code class="mp-fact">sector == semis<\/code><span class="chip grey">not computed<\/span><span class="mp-def"><span class="mp-def-who">the card defines it:<\/span> The sector the owner files the name under\.<\/span><\/li>/);
  assert.equal(count(html, 'the face computes it:'), 1, 'the face\'s definition for the fact it computes alone');
});

test("every state with a card draws its checks; a fact the card defines and does not check by its name; a list's values joined", () => {
  const checks = [
    { fact: 'session', op: 'in', value: ['open', 'pre'], own: 'The part of the day.', definition: null, face: false },
    { fact: 'held', op: '==', value: true, own: 'Whether it is held.', definition: 'Whether the venue holds it.', face: true },
    { fact: 'mood', own: 'The tape.', definition: null, face: false },
  ];
  for (const row of [changedLesson({ checks }), unarmedLesson({ checks }), retiredLesson({ checks }), brokenLesson({ checks })]) {
    const html = draw(memoryLessons({ lessons: [row] }));
    assert.match(html, /<code class="mp-fact">session in open, pre<\/code>/, row.state);
    assert.match(html, /<code class="mp-fact">held == true<\/code><span class="chip ok">computed<\/span>/, row.state);
    assert.match(html, /<code class="mp-fact">mood<\/code><span class="chip grey">not computed<\/span><span class="mp-def"><span class="mp-def-who">the card defines it:<\/span> The tape\.<\/span><\/li>/, row.state);
  }
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
  assert.match(html, /<p class="mp-fault">card size-cap has no front matter: it starts with a line of three dashes, then YAML, then another\.<\/p>/);
  assert.equal(count(html, 'has no front matter'), 1, 'a file fault the row repeats is drawn once');
  assert.match(html, /<span class="chip down">Broken<\/span>/);
  assert.match(html, /<p class="mp-fault">Its armed copy is missing\.<\/p>/);
});

test("a broken card's line and words are its file's, under Now; its arm and retire commands", () => {
  const html = draw(memoryLessons({ lessons: [brokenLesson()] }));
  assert.match(html, /<div class="mp-diff-head">Now<\/div><div class="mp-line">caveat · careful hold<\/div><div class="mp-words">“Hold no size through a print”<\/div>/);
  assert.match(html, /npx --no gravit-memory arm earnings-hold --home/);
  assert.match(html, /npx --no gravit-memory retire earnings-hold --reason/);
  assert.doesNotMatch(draw(memoryLessons({ lessons: [armedLesson()] })), /mp-diff-head/, 'an armed card is not headed Now');
});

test("a card's record: seen and backfilled beside no decision when above zero; none at zero", () => {
  const seen = draw(memoryLessons({ lessons: [armedLesson({ record: { owner: { fired: 6, followed: 0, overridden: 0, seen: 5, backfilled: 1, no_decision: 0 } } })] }));
  assert.ok(text(seen).includes('fired 6 · followed 0 · overridden 0 · seen 5 · backfilled 1 · no decision 0'), text(seen));
  const plain = text(draw(memoryLessons({ lessons: [armedLesson({ record: { owner: { fired: 2, followed: 1, overridden: 1, seen: 0, backfilled: 0, no_decision: 0 } } })] })));
  assert.ok(plain.includes('fired 2 · followed 1 · overridden 1 · no decision 0'), plain);
  assert.doesNotMatch(plain, /seen|backfilled/);
});

test('a horizon of one session reads in the singular, a median and a list of cases alike', () => {
  const one = { k: 1, change_pct: 2 };
  const record = { owner: { fired: 1, followed: 1, overridden: 1, seen: 0, backfilled: 0, no_decision: 0 },
    followed: [{ decision: 'd-1', date: '2026-11-03', symbol: 'NVDA', action: 'pass', figures: [one] }], overridden: [{ decision: 'd-2', date: '2026-11-04', symbol: 'AMD', action: 'buy', figures: [one] }],
    medians: { followed: { 1: 2 }, overridden: {} } };
  const html = text(draw(null, R.memoryPageToggle(loaded(memoryLessons({ lessons: [armedLesson({ record })] })), { id: 'no-chasing' })));
  assert.ok(html.includes('median +2.00% over 1 session '), html);
  assert.ok(html.includes('over 1 session '));
  assert.doesNotMatch(html, /1 sessions/);
});

test('a lesson named constructor: its cases and its change open on the first press, as any other', () => {
  const row = armedLesson({ id: 'constructor' });
  const st = R.memoryPageToggle(loaded(memoryLessons({ lessons: [row] })), { id: 'constructor' });
  assert.equal(Object.hasOwn(st.memoryPage.open, 'constructor') && st.memoryPage.open.constructor, true);
  assert.match(draw(null, st), /<div class="mp-cases">/);
  assert.doesNotMatch(draw(null, loaded(memoryLessons({ lessons: [row] }))), /mp-cases/, 'closed until pressed, the prototype read as unset');
  const changed = changedLesson({ id: 'constructor' });
  const shown = R.memoryPageDiff(loaded(memoryLessons({ lessons: [changed] })), { id: 'constructor' });
  assert.match(draw(null, shown), /<div class="mp-diff">/);
  assert.doesNotMatch(draw(null, R.memoryPageDiff(shown, { id: 'constructor' })), /<div class="mp-diff">/);
});

test("a card armed in another year carries its year; one with no words draws no empty quotes", () => {
  assert.ok(text(draw(memoryLessons({ lessons: [armedLesson({ armedAt: '2025-03-04T12:00:00.000Z' })] }))).includes('armed Mar 4, 2025'));
  const card = lessonCard('no-chasing', { words: '' });
  assert.doesNotMatch(draw(memoryLessons({ lessons: [armedLesson({ armed: lessonText(card), file: lessonText(card) })] })), /“”/);
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

test("the owner's chain broken: one line at the top and the reseal command under At the terminal, in face/", () => {
  const html = draw(memoryLessons({ ownerChainBroken: true, reseal: memoryReseal, lessons: [armedLesson()] }));
  assert.ok(html.indexOf("No lesson is applied until the owner&#39;s chain is resealed") < html.indexOf('no-chasing'));
  assert.equal(count(html, 'resealed'), 1);
  assert.match(html, /<div class="mp-dim">At the terminal, in face\/<\/div><code class="mp-command">npx --no gravit-memory reseal --home \/srv\/owner\/memory<\/code>/);
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

test('the screen draws the lessons body for the Lessons tab, wrapped in mp-body; another tab draws its own', () => {
  const html = renderMemoryScreen(loaded(memoryLessons({ lessons: [armedLesson()] })), NOW);
  assert.match(html, /<div class="mp-body mp-lessons">/);
  assert.match(html, /no-chasing/);
  const health = renderMemoryScreen(R.memoryPageLoaded(R.nav(emptyState(), { screen: 'memory', tab: 'health' }), { read: 'health', data: { ok: true, connected: true }, at: NOW }), NOW);
  assert.match(health, /<div class="mp-body mp-health">/);
  assert.doesNotMatch(health, /mp-lessons/);
});

// the owner's acts (memory owner acts plan Task 4): while the page signs, each act a card's state allows is a key, and its
// terminal command is not drawn; for any other role the commands stand
const signing = st => R.ownerStanding(st, { role: 'signs', kid: 'k1' });
const keyOf = (act, id, word) => `<button type="button" class="btn-sm" data-action="memoryActOpen" data-act="${act}" data-subject="${id}">${word}</button>`;
test('while the page signs, a card carries the keys its state allows in place of their commands', () => {
  const lessons = [armedLesson(), changedLesson(), unarmedLesson(), retiredLesson(), refusedLesson(), brokenLesson()];
  const st = signing(loaded(memoryLessons({ lessons })));
  const html = renderMemoryScreen(st, NOW);
  const cards = [...html.matchAll(/<article class="mp-lesson">[\s\S]*?<\/article>/g)].map(m => m[0]);
  const [armed, changed, unarmed, retired, refused, broken] = cards;
  assert.ok(armed.includes(keyOf('retire', 'no-chasing', 'Retire…')));
  assert.doesNotMatch(armed, /data-act="arm"|data-act="discard"|mp-command|At the terminal/);
  for (const [act, word] of [['arm', 'Arm…'], ['retire', 'Retire…'], ['discard', 'Discard…']]) assert.ok(changed.includes(keyOf(act, 'trim-into-strength', word)), act);
  assert.doesNotMatch(changed, /mp-command|At the terminal/, "a changed card's review is its Discard…");
  assert.ok(unarmed.includes(keyOf('arm', 'add-below-stop', 'Arm…')));
  assert.ok(retired.includes(keyOf('arm', 'gap-fade', 'Arm…')));
  assert.doesNotMatch(refused, /memoryActOpen/);
  assert.ok(broken.includes(keyOf('arm', 'earnings-hold', 'Arm…')) && broken.includes(keyOf('retire', 'earnings-hold', 'Retire…')));
  assert.doesNotMatch(broken, /mp-command/);
  assert.doesNotMatch(html, /does not sign for the account/);
});

test('for any role but signs the keys are absent and the commands drawn; a role that is not unknown says the browser does not sign', () => {
  for (const role of ['unknown', 'pending', 'asked', 'needs-code', 'signed-out', 'none']) {
    const st = R.ownerStanding(loaded(memoryLessons({ lessons: [armedLesson(), changedLesson()] })), { role, kid: '' });
    const html = renderMemoryScreen(st, NOW);
    assert.doesNotMatch(html, /memoryActOpen/, role);
    assert.match(html, /<code class="mp-command">npx --no gravit-memory retire no-chasing/, role);
    assert.match(html, /<code class="mp-command">npx --no gravit-memory arm trim-into-strength/, role);
    const line = /<\/header><p class="mp-signs"><a class="mp-signs-link" href="#\/account\/portfolio">This browser does not sign for the account<\/a><\/p>/;
    if (role === 'unknown') assert.doesNotMatch(html, /mp-signs/, 'the Account has not answered: no line');
    else assert.match(html, line, role);
  }
});

test('the Lessons tab under ZH', () => {
  const st = R.memoryPageToggle(loaded(memoryLessons({ ownerChainBroken: true, reseal: memoryReseal, lessons: [armedLesson(), changedLesson(), unarmedLesson()] })), { id: 'no-chasing' });
  const html = withTable(ZH, () => draw(null, st));
  for (const word of ['已启用', '启用后已改动', '未启用', '终端', '查看改动', '个案', '遵守', '推翻', '核对的事实：', '本服务计算']) assert.ok(html.includes(word), word);
  assert.match(withTable(ZH, () => draw(memoryLessons())), /还没有教训/);
});
