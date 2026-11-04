// The conversation search's pure view (plan 2 Task 1): the title matches at once, the content items after them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEARCH_ITEMS, titleMatches, mergeResults, highlightRuns, searchPhase, moreThanTwenty } from '../../client/js/host/search-view.js';

const conv = (id, over = {}) => ({ id, title: id, kind: 'gravit', members: ['gravit'], channel: null, preset: 'gravit', archived: false, updatedAt: 1, messages: [], ...over });
const channels = [{ workspaceId: 'w1', name: 'alpha', title: 'Alpha Desk Notes' }, { workspaceId: 'w2', name: 'beta' }];
const inCh = (id, w, name, over = {}) => conv(id, { channel: { workspaceId: w, name }, ...over });

test('a title matches at once, case-insensitive, by title or channel label, newest first', () => {
  const cs = [
    conv('a', { title: 'NVDA thesis', updatedAt: 1 }),
    conv('b', { title: 'other', channel: { workspaceId: 'w1', name: 'alpha' }, updatedAt: 3 }),
    conv('c', { title: 'nvda again', updatedAt: 2 }),
    conv('d', { title: 'nothing', updatedAt: 9 }),
  ];
  assert.deepEqual(titleMatches(cs, channels, 'NvDa').map(x => x.id), ['c', 'a']);
  assert.deepEqual(titleMatches(cs, channels, 'desk notes').map(x => x.id), ['b']);
  assert.equal(titleMatches(cs, channels, 'desk notes')[0].channelLabel, 'Alpha Desk Notes');
  assert.deepEqual(titleMatches(cs, channels, '  '), []);
  assert.equal(titleMatches([conv('n', { title: 'zz' })], channels, 'zz')[0].channelLabel, 'No channel');
  assert.equal(titleMatches([conv('k', { title: 'zz', preset: 'gravit-desk' })], channels, 'zz')[0].channelLabel, 'Desk');
});

test('content items join after the title matches, without repeating one', () => {
  const conversations = [conv('a', { title: 'hit' }), conv('b', { title: 'plain', updatedAt: 5 }), conv('c', { title: 'x', archived: 'face' })];
  const titles = titleMatches(conversations, channels, 'hit');
  const content = [{ sessionId: 'a', snippet: 's-a', match: [0, 1], at: 1 }, { sessionId: 'b', snippet: 'say hit', match: [4, 7], at: 5 }, { sessionId: 'c', snippet: 'c hit', match: [2, 5], at: 4 }];
  const m = mergeResults({ titles, content, conversations, channels });
  assert.deepEqual(m.map(x => x.id), ['a', 'b', 'c']);
  assert.deepEqual(m[0].match, [0, 1]); // a title match with a content hit takes the hit's snippet
  assert.equal(m[0].snippet, 's-a');
  assert.equal(m[1].snippet, 'say hit'); assert.equal(m[1].title, 'plain');
  assert.equal(m[2].archived, 'face');
});

test('an item the list does not know is dropped', () => {
  const conversations = [conv('a')];
  const m = mergeResults({ titles: [], content: [{ sessionId: 'ghost', snippet: 's', match: [0, 1], at: 1 }, { sessionId: 'a', snippet: 't', match: null, at: 1 }], conversations, channels });
  assert.deepEqual(m.map(x => x.id), ['a']);
});

test('twenty at most, and more-than-twenty when hasMore or the merge overflowed', () => {
  const conversations = Array.from({ length: 25 }, (_, i) => conv(`c${i}`, { title: 'q', updatedAt: i }));
  const titles = titleMatches(conversations, channels, 'q');
  const merged = mergeResults({ titles, content: [], conversations, channels });
  assert.equal(SEARCH_ITEMS, 20);
  assert.equal(merged.length, 20);
  assert.equal(moreThanTwenty(merged, false), true);
  const few = mergeResults({ titles: titles.slice(0, 3), content: [], conversations, channels });
  assert.equal(moreThanTwenty(few, false), false);
  assert.equal(moreThanTwenty(few, true), true);
});

test('a title match with no content hit shows its preview as the snippet', () => {
  const read = conv('a', { title: 'hit', preview: 'the read line' });
  const spoken = conv('b', { title: 'hit', messages: [{ from: 'system', text: 'sys' }, { from: 'gravit', text: 'last words' }, { from: 'gravit', kind: 'tool', text: 'tool' }] });
  const conversations = [read, spoken];
  const m = mergeResults({ titles: titleMatches(conversations, channels, 'hit'), content: [], conversations, channels });
  assert.equal(m.find(x => x.id === 'a').snippet, 'the read line');
  assert.equal(m.find(x => x.id === 'b').snippet, 'last words');
  assert.equal(m[0].match, null);
});

test('highlight runs mark exactly the match, and a bad match marks nothing', () => {
  assert.deepEqual(highlightRuns('say hit now', [4, 7]), [{ text: 'say ', mark: false }, { text: 'hit', mark: true }, { text: ' now', mark: false }]);
  assert.deepEqual(highlightRuns('hit', [0, 3]), [{ text: 'hit', mark: true }]);
  for (const bad of [null, undefined, [3, 3], [5, 2], [0, 99], [-1, 2], 'x', [1]]) assert.deepEqual(highlightRuns('abc', bad), [{ text: 'abc', mark: false }]);
  assert.deepEqual(highlightRuns('', null), []);
});

test('the phase: idle with no query, searching while content loads with no title hit, results, empty, failed keeps the title matches', () => {
  const one = [{ id: 'a' }];
  assert.equal(searchPhase({ query: ' ', titles: [], contentPhase: 'idle', merged: [] }), 'idle');
  assert.equal(searchPhase({ query: 'q', titles: [], contentPhase: 'loading', merged: [] }), 'searching');
  assert.equal(searchPhase({ query: 'q', titles: one, contentPhase: 'loading', merged: one }), 'results');
  assert.equal(searchPhase({ query: 'q', titles: [], contentPhase: 'done', merged: [] }), 'empty');
  assert.equal(searchPhase({ query: 'q', titles: [], contentPhase: 'done', merged: one }), 'results');
  assert.equal(searchPhase({ query: 'q', titles: [], contentPhase: 'failed', merged: [] }), 'failed');
  assert.equal(searchPhase({ query: 'q', titles: one, contentPhase: 'failed', merged: one }), 'results');
});

test('exactly twenty is not more; twenty-one is', () => {
  const mk = n => Array.from({ length: n }, (_, i) => conv(`c${i}`, { title: 'q', updatedAt: i }));
  for (const [n, more] of [[20, false], [21, true]]) {
    const conversations = mk(n);
    const merged = mergeResults({ titles: titleMatches(conversations, channels, 'q'), content: [], conversations, channels });
    assert.equal(merged.length, 20);
    assert.equal(moreThanTwenty(merged, false), more);
  }
});

test('a channel the registry does not hold reads by the conversation\'s own channel name', () => {
  const c = inCh('a', 'w9', 'orphan', { title: 'zz' });
  assert.equal(titleMatches([c], channels, 'zz')[0].channelLabel, 'orphan');
});

test('a title match filters on the title and the label before it builds an item: a non-match is never read for its line', () => {
  let read = 0;
  const quiet = conv('q', { title: 'nothing' });
  Object.defineProperty(quiet, 'messages', { get() { read++; return []; } });
  assert.deepEqual(titleMatches([conv('a', { title: 'hit' }), quiet], channels, 'hit').map(x => x.id), ['a']);
  assert.equal(read, 0, 'the non-match was not mapped through its preview line');
});
