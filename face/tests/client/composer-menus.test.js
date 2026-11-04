import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HIDDEN_COMMANDS, CONVERSATION_ITEMS, rankByLetters, slashItems, atItems, conversationChoices, flatItems, moveActive, chipOf,
} from '../../client/js/composer/menus.js';

const names = items => items.map(i => i.name);
const cmd = (name, input) => ({ name, description: name + ' d', ...(input ? { input: { hint: 'h' } } : {}) });

test('letters in order, case-insensitive, prefix matches first', () => {
  const items = [{ n: 'plan' }, { n: 'Goal' }, { n: 'toggle-log' }];
  assert.deepEqual(rankByLetters(items, 'gl', i => i.n).map(i => i.n), ['Goal', 'toggle-log']);
  assert.deepEqual(rankByLetters(items, 'xz', i => i.n), []);
  assert.equal(rankByLetters(items, '', i => i.n).length, 3);
  assert.deepEqual(HIDDEN_COMMANDS, ['plan', 'permission', 'feedback']);
});

test('the slash menu hides plan, permission and feedback, and lists an argument command only at the start', () => {
  const commands = [cmd('plan'), cmd('permission'), cmd('feedback'), cmd('compact'), cmd('goal', true)];
  const mid = slashItems({ commands, skills: [], query: '', atStart: false });
  assert.deepEqual(names(mid[0].items), ['compact']);
  const start = slashItems({ commands, skills: [], query: '', atStart: true });
  assert.deepEqual(names(start[0].items), ['compact', 'goal']);
  assert.equal(start[0].items[1].takesArgs, true);
  assert.equal(start[0].items[1].hint, 'h');
});

test('a cold conversation with nothing read for its preset has no Commands group, and Skills still draw', () => {
  const g = slashItems({ commands: null, skills: [{ name: 'style', description: 'd' }], query: '', atStart: true });
  assert.equal(g.length, 1);
  assert.equal(g[0].label, 'Skills');
  assert.equal(g[0].items[0].kind, 'skill');
});

test("a command's title is its name capitalized", () => {
  const g = slashItems({ commands: [cmd('compact')], skills: [], query: '', atStart: true });
  assert.equal(g[0].items[0].title, 'Compact');
  assert.equal(g[0].items[0].kind, 'command');
});

test('headings hide while a query is typed in the slash menu, and stay in the @ menu', () => {
  const commands = [cmd('compact')], skills = [{ name: 'compare', description: '' }];
  const q = slashItems({ commands, skills, query: 'comp', atStart: true });
  assert.equal(q.length, 2);
  assert.ok(q.every(g => g.label === undefined));
  assert.deepEqual(slashItems({ commands, skills, query: '', atStart: true }).map(g => g.label), ['Commands', 'Skills']);
  assert.deepEqual(slashItems({ commands, skills, query: 'zzz', atStart: true }), []);
  const at = atItems({ bots: [], files: [{ path: 'a.md', kind: 'file' }], conversations: [], query: 'a' });
  assert.equal(at[0].label, 'Files and folders');
});

test('the @ groups in order, bots only in a room, a folder walk shows the files alone under its crumb', () => {
  const bots = [{ id: 'news-scout', name: 'News Scout', description: 'd' }];
  const files = [{ path: 'strategies/a.md', kind: 'file' }, { path: 'strategies/sub', kind: 'directory' }];
  const conversations = [{ id: 's1', title: 'Hello', archived: false, updatedAt: 0 }];
  const g = atItems({ bots, files, conversations, query: '' });
  assert.deepEqual(g.map(x => x.label), ['Bots in this room', 'Files and folders', 'Conversations']);
  assert.deepEqual(atItems({ bots: [], files, conversations, query: '' }).map(x => x.label), ['Files and folders', 'Conversations']);
  const f = g[1].items;
  assert.deepEqual(f[0], { kind: 'file', path: 'strategies/a.md', dir: false, name: 'a.md', folder: 'strategies' });
  assert.equal(f[1].dir, true);
  assert.equal(f[1].name, 'sub');
  const walk = atItems({ bots, files, conversations, query: 'strategies/su' });
  assert.equal(walk.length, 1);
  assert.equal(walk[0].crumb, 'strategies/');
  assert.equal(walk[0].items.length, 2);
  assert.equal(atItems({ bots, files: [{ path: 'top.md', kind: 'file' }], conversations: [], query: '' })[1].items[0].folder, '');
  assert.equal(atItems({ bots, files: [], conversations: [], query: 'news' })[0].items[0].id, 'news-scout');
});

test('conversations: the current one, archived ones and those beyond eight left out; the channel\'s own first', () => {
  const now = 30;
  const mk = (id, ws, t, archived) => ({ id, title: 't' + id, workspaceId: ws, updatedAt: t, archived });
  const list = [mk('cur', 'w1', 99), mk('arch', 'w1', 98, true), mk('o1', 'w2', 50), mk('o2', 'w2', 70), mk('m1', 'w1', 10), mk('m2', 'w1', 20)];
  const out = conversationChoices(list, { exceptId: 'cur', workspaceId: 'w1', now });
  assert.deepEqual(out.map(i => i.id), ['m2', 'm1', 'o2', 'o1']);
  assert.equal(out[0].kind, 'conversation');
  assert.equal(out[0].age, 'Just now');
  const many = Array.from({ length: 12 }, (_, i) => mk('c' + i, 'w', i));
  const g = atItems({ bots: [], files: [], conversations: conversationChoices(many, { exceptId: null, workspaceId: 'w', now }), query: '' });
  assert.equal(CONVERSATION_ITEMS, 8);
  assert.equal(g[0].items.length, 8);
});

test('the active row wraps both ways', () => {
  const menu = { kind: '/', from: 0, query: '', active: 0, groups: [{ items: [{ n: 1 }, { n: 2 }] }, { items: [{ n: 3 }] }] };
  assert.equal(flatItems(menu).length, 3);
  assert.equal(moveActive(menu, -1).active, 2);
  assert.equal(moveActive({ ...menu, active: 2 }, 1).active, 0);
  assert.equal(moveActive(menu, 1).active, 1);
  assert.equal(moveActive({ ...menu, groups: [] }, 1).active, 0);
});

test('chips: a bot by its name, a folder with a slash, a conversation by its title', () => {
  assert.deepEqual(chipOf({ kind: 'bot', id: 'b', name: 'News', description: '' }), { kind: 'bot', id: 'b', label: 'News' });
  assert.deepEqual(chipOf({ kind: 'file', path: 'a/b.md', dir: false, name: 'b.md', folder: 'a' }), { kind: 'file', path: 'a/b.md', dir: false, label: 'b.md' });
  assert.equal(chipOf({ kind: 'file', path: 'a/sub', dir: true, name: 'sub', folder: 'a' }).label, 'sub/');
  assert.deepEqual(chipOf({ kind: 'conversation', id: 's', title: '估值', age: 'x' }), { kind: 'conversation', id: 's', label: '估值' });
});
