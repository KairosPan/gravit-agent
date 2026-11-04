// The composer's draft model (plan 3, task 1): runs of text and chips, the trigger rule, the serializer. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSessionReferenceMention, parseSessionReferenceText, encodeSessionReferenceUri } from '@deepseek-ai/dsh-session-reference';
import {
  emptyDraft, textDraft, normalize, lengthOf, isBlank, plainText, hasChip, replaceRange, triggerAt,
  sessionUri, filePathFor, serialize, serialContext, sessionRefRuns,
} from '../../client/js/composer/draft.js';

const t = text => [{ type: 'text', text }];
const T = text => ({ type: 'text', text });
const bot = (id, label = id) => ({ type: 'chip', chip: { kind: 'bot', id, label } });
const file = (path, dir = false) => ({ type: 'chip', chip: { kind: 'file', path, dir, label: path.split('/').pop() } });
const conv = (id, label) => ({ type: 'chip', chip: { kind: 'conversation', id, label } });

test('runs normalize, and the caret counts a chip as one', () => {
  assert.deepEqual(emptyDraft(), { runs: [] });
  assert.deepEqual(textDraft(''), { runs: [] });
  assert.deepEqual(textDraft('hi'), { runs: [T('hi')] });
  assert.deepEqual(normalize([T('a'), T(''), T('b'), bot('x'), T(''), T('c'), T('d')]), [T('ab'), bot('x'), T('cd')]);
  assert.equal(lengthOf([T('ab'), bot('x'), T('😀')]), 2 + 1 + 2);
  assert.equal(plainText([T('hi '), bot('news', 'News Scout'), T(' ok')]), 'hi News Scout ok');
  assert.equal(hasChip([T('a'), bot('x')], 'bot'), true);
  assert.equal(hasChip([T('a'), bot('x')], 'file'), false);
  assert.equal(hasChip([T('a')], 'bot'), false);
});

test('a blank draft is whitespace with no chip', () => {
  assert.equal(isBlank([]), true);
  assert.equal(isBlank(t(' \n\t')), true);
  assert.equal(isBlank(t(' a ')), false);
  assert.equal(isBlank([bot('x')]), false);
});

test("replaceRange swaps the trigger's token for a chip and a space, and never splits a chip", () => {
  const out = replaceRange(t('see @st now'), 4, 7, [bot('strat'), T(' ')]);
  assert.deepEqual(out, [T('see '), bot('strat'), T('  now')]);
  // a range over a chip removes it whole
  const r = [T('ab'), bot('x'), T('cd')];
  assert.deepEqual(replaceRange(r, 1, 4, 'Z'), [T('aZd')]);
  assert.deepEqual(replaceRange(r, 2, 3, ''), [T('abcd')]);
  // an edge at a chip's boundary leaves the chip whole
  assert.deepEqual(replaceRange(r, 0, 2, 'q'), [T('q'), bot('x'), T('cd')]);
  assert.deepEqual(replaceRange(r, 3, 4, 'q'), [T('ab'), bot('x'), T('qd')]);
  // an insert at a point in the middle of text splits the text
  assert.deepEqual(replaceRange(t('abcd'), 2, 2, [bot('x')]), [T('ab'), bot('x'), T('cd')]);
  // from > to swaps
  assert.deepEqual(replaceRange(t('abcd'), 3, 1, ''), [T('ad')]);
});

test('the trigger: / at the start, after a space, after punctuation, not after a letter; @ at the start or after a space, not in an e-mail; nothing after whitespace', () => {
  assert.deepEqual(triggerAt(t('/com'), 4), { kind: '/', from: 0, query: 'com', atStart: true });
  assert.deepEqual(triggerAt(t('see (/go'), 8), { kind: '/', from: 5, query: 'go', atStart: false });
  assert.deepEqual(triggerAt(t('see /go'), 7), { kind: '/', from: 4, query: 'go', atStart: false });
  assert.equal(triggerAt(t('and/or'), 6), null);
  assert.equal(triggerAt(t('a@b.c'), 5), null);
  assert.deepEqual(triggerAt(t('@strategies/cn'), 14), { kind: '@', from: 0, query: 'strategies/cn', atStart: true });
  assert.equal(triggerAt(t('@strategies/cn'), 15), null); // past the end of the text: no token
  assert.equal(triggerAt(t('/goal '), 6), null);
  assert.deepEqual(triggerAt(t('hi @n'), 5), { kind: '@', from: 3, query: 'n', atStart: false });
  assert.deepEqual(triggerAt(t('@'), 1), { kind: '@', from: 0, query: '', atStart: true });
  // the caret in the middle: only the text before it counts
  assert.deepEqual(triggerAt(t('/compact now'), 4), { kind: '/', from: 0, query: 'com', atStart: true });
  // a chip ends the token like whitespace; from counts the chip as one unit
  assert.deepEqual(triggerAt([bot('x'), T('@a')], 3), { kind: '@', from: 1, query: 'a', atStart: false });
  assert.equal(triggerAt([T('@a'), bot('x'), T('b')], 4), null);
  assert.equal(triggerAt([T('@a'), bot('x')], 3), null);
  assert.equal(triggerAt([], 0), null);
});

test('a bot chip is @id; a file chip relative under the cwd, . for the cwd, absolute outside it, quoted with a space', () => {
  const ctx = { repoRoot: '/r', cwd: '/r/strategies/cn-market' };
  assert.equal(filePathFor('strategies/cn-market/thesis.md', ctx), 'thesis.md');
  assert.equal(filePathFor('strategies/cn-market', ctx), '.');
  assert.equal(filePathFor('desk/levels.yml', ctx), '/r/desk/levels.yml');
  assert.equal(filePathFor('strategies/cn-market-2/x.md', ctx), '/r/strategies/cn-market-2/x.md');
  assert.equal(filePathFor('desk/levels.yml', { repoRoot: '/r', cwd: null }), '/r/desk/levels.yml');
  const s = runs => serialize(runs, ctx);
  assert.equal(s([bot('news-scout', 'News Scout')]), '@news-scout');
  assert.equal(s([file('strategies/cn-market/thesis.md')]), '@thesis.md');
  assert.equal(s([file('strategies/cn-market', true)]), '@.');
  assert.equal(s([file('desk/levels.yml')]), '@/r/desk/levels.yml');
  assert.equal(s([file('docs/a b.md')]), '@"/r/docs/a b.md"');
  assert.equal(s([T('look at '), file('strategies/cn-market/a b.md'), T(' now')]), 'look at @"a b.md" now');
  assert.equal(serialize([file('desk/levels.yml')], { repoRoot: '/r', cwd: null }), '@/r/desk/levels.yml');
});

test("a conversation chip is exactly dsh's mention", () => {
  const ids = ['s1', 'session-6f1c0a9e-3b7d-4c52-9d1e-aa00bb11cc22'];
  const labels = ['估值 [v2] a\\b', 'T', ']'];
  for (const sessionId of ids) for (const label of labels) {
    const out = serialize([conv(sessionId, label)], { repoRoot: null, cwd: null });
    assert.equal(out, formatSessionReferenceMention({ sessionId, label }));
    const back = parseSessionReferenceText(out);
    assert.deepEqual(back.references, [{ sessionId, label }]);
    assert.equal(sessionUri(sessionId), encodeSessionReferenceUri(sessionId));
  }
  assert.ok(formatSessionReferenceMention({ sessionId: 's1', label: 'T' }).endsWith(`(${sessionUri('s1')})`));
});

test("the bubble's runs: a mention becomes a ref with its unescaped label, a malformed one stays text", () => {
  const m = formatSessionReferenceMention({ sessionId: 's1', label: '估值 [v2] a\\b' });
  assert.deepEqual(sessionRefRuns(`see ${m} please`), [T('see '), { type: 'ref', label: '估值 [v2] a\\b' }, T(' please')]);
  assert.deepEqual(sessionRefRuns('plain'), [T('plain')]);
  assert.deepEqual(sessionRefRuns(''), []);
  const bad = '@[x](dsh-session:!!!)';
  assert.deepEqual(sessionRefRuns(`a ${bad} b`), [T(`a ${bad} b`)]);
  const nonCanon = '@[x](dsh-session:czE=)'; // base64url payload with padding is not canonical
  assert.deepEqual(sessionRefRuns(nonCanon), [T(nonCanon)]);
  const two = sessionRefRuns(`${m}${formatSessionReferenceMention({ sessionId: 's2', label: 'B' })}`);
  assert.deepEqual(two, [{ type: 'ref', label: '估值 [v2] a\\b' }, { type: 'ref', label: 'B' }]);
});

test('serialContext reads the root channel and the conversation\'s channel, null when missing', () => {
  const channels = [{ workspaceId: 'w0', dir: '/r', isRoot: true }, { workspaceId: 'w1', dir: '/r/strategies/a', isRoot: false }];
  assert.deepEqual(serialContext({ channels, workspaceId: 'w1' }), { repoRoot: '/r', cwd: '/r/strategies/a' });
  assert.deepEqual(serialContext({ channels, workspaceId: null }), { repoRoot: '/r', cwd: null });
  assert.deepEqual(serialContext({ channels, workspaceId: 'zz' }), { repoRoot: '/r', cwd: null });
  assert.deepEqual(serialContext({ channels: [], workspaceId: 'w1' }), { repoRoot: null, cwd: null });
  assert.deepEqual(serialContext({ channels: undefined, workspaceId: 'w1' }), { repoRoot: null, cwd: null });
});
