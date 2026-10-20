// The stylesheet against the screens stage 1 draws: every class has a rule, no colour by hex, the layout rules the design fixed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderRail } from '../../client/js/render/rail.js';
import { renderMessagesScreen } from '../../client/js/render/messages.js';
import { renderSettings } from '../../client/js/render/account.js';
import { setMarkdown } from '../../client/js/render/thread.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { MIN } from '../../client/js/time.js';

const NOW = new Date(2026, 9, 19, 14, 7).getTime();
const css = await readFile(new URL('../../client/css/app.css', import.meta.url), 'utf8');
const conv = (id, over = {}) => ({ id, title: 'T ' + id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, updatedAt: NOW - 5 * MIN, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const m = (id, over = {}) => ({ id, seq: 1, at: NOW, from: 'gravit', kind: 'text', text: 'hello', data: {}, ...over });
const KINDS = [
  m('e1', { from: 'you', text: 'hi' }), m('e2', { data: { markdown: true, interrupted: true } }), m('e3', { from: 'system', text: 'round 1' }),
  m('tc1', { kind: 'tool', text: 'bash', data: { callId: 'c1', title: 'ls', result: 'ok', isError: true } }),
  m('ev-1', { kind: 'card', text: 'Your call', data: { eventId: 'ev-1', sessionId: 's1', venue: 'Alpaca paper', line: 'PAPER order' } }),
  m('ev-2', { kind: 'approval', text: 'Run?', data: { eventId: 'ev-2', sessionId: 's1', toolName: 'bash', reason: 'audit', displayReason: 'Run?' } }),
  m('ev-3', { kind: 'question', text: '', data: { eventId: 'ev-3', sessionId: 's1', questions: [{ id: 'q1', question: 'Pin?', header: 'Gate', options: [{ label: 'Yes', description: 'd' }] }, { id: 'q2', question: 'More?' }] } }),
  m('ev-4', { kind: 'card', text: 'Done', answer: 'elsewhere', data: { eventId: 'ev-4', sessionId: 's1' } }),
  m('rc1', { kind: 'receipt', text: 'Order accepted', data: {} }), m('rc2', { kind: 'refusal', text: 'no', data: { code: 'E1' } }),
  m('e9', { from: 'buffett', text: '买', data: { name: '巴菲特型' } }),
];

// the states stage 1 can show: empty, a conversation with every kind, a group thinking, Details, Settings, a draft, a bad status, the rail folded
function everyState() {
  const base = R.hostList(emptyState(), { conversations: [conv('s1', { messages: KINDS, running: true, usage: { tokenUsage: { outputTokens: 1 }, contextPressure: 0.5 }, created: NOW }), conv('g', { kind: 'group', members: ['gravit', 'buffett'], thinking: 'text' })], channels: [{ workspaceId: 'w0', name: 'workbench', isRoot: true }], bots: [{ id: 'buffett', name: 'Buffett Type' }] });
  const open = R.nav(base, { screen: 'messages', id: 's1' });
  return [
    emptyState(), open, R.nav(base, { screen: 'messages', id: 'g' }), R.toggleDetails(open), R.askConfirm(R.toggleDetails(open), { action: 'stopGravit', id: 's1' }),
    R.startEdit(R.toggleDetails(open), { kind: 'rename', convId: 's1', error: 'Cannot be empty' }), R.openSettings(open), R.startDraft(open, { now: NOW }),
    R.hostStatus(open, { line: 'Reconnecting…', bad: true }), R.toggleRail(open),
  ];
}

test('every class the screens emit has a rule in app.css, and app.css names no colour by hex', () => {
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b/, 'colours come from tokens.css');
  setMarkdown(null);
  const html = everyState().map(st => renderRail(st, NOW) + renderMessagesScreen(st, NOW) + (st.settingsOpen ? renderSettings(st) : '')).join('');
  const classes = new Set(html.match(/class="([^"]+)"/g).flatMap(x => x.slice(7, -1).split(/\s+/)));
  const missing = [...classes].filter(c => c && !new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css));
  assert.deepEqual(missing, [], 'classes without a rule');
  assert.match(css, /--rail/);
  assert.match(css, /\.key\.yes[^{]*\{[^}]*color: var\(--up\)/);
  assert.match(css, /\.key\.no[^{]*\{[^}]*color: var\(--down\)/);
});

test('the layout: one screen tall, the thread scrolls under a pinned composer, the drawer is fixed', () => {
  const rule = sel => css.match(new RegExp(`^${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`, 'm'))?.[1] ?? '';
  assert.match(rule('.main'), /(?:^|;)\s*height: 100vh/, 'a real height, not a minimum');
  assert.match(rule('.thread'), /overflow-y: auto/);
  assert.match(rule('.thread'), /flex: 1/);
  assert.match(rule('.drawer'), /position: fixed/);
  assert.match(rule('.status-line'), /text-align: center/);
});

test('Details never covers the conversation: it makes room, folding the list away on a medium window', () => {
  assert.match(css, /\.main\.with-drawer > \.head, \.main\.with-drawer > \.thread, \.main\.with-drawer > \.composer \{ margin-right: 400px; \}/);
  assert.match(css, /@media \(min-width: 861px\) and \(max-width: 1399px\) \{\s*\.list:has\(~ \.main\.with-drawer\) \{ display: none; \}/);
});

test('the tool row, the question card and the thinking row have their rules', () => {
  for (const sel of ['.tool summary', '.tool pre', '.tool.danger', '.question .q', '.opt', '.thinking span', '.cut', '.status-line.bad']) {
    assert.ok(new RegExp(sel.replace(/[.]/g, '\\.') + '\\s*\\{').test(css), sel);
  }
});

test('app.css is well formed: braces never close more than they opened, so no rule is swallowed', () => {
  let depth = 0;
  for (const ch of css) {
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; assert.ok(depth >= 0, 'a } without its {'); }
  }
  assert.equal(depth, 0);
});

test('the equity blue goes by Linqi\'s own name: no --blue, which his tokens use for the orange RWA colour', async () => {
  const tokens = await readFile(new URL('../../client/css/tokens.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /var\(--blue\)/);
  assert.match(tokens, /--alloc-equity/);
  assert.match(tokens, /--on-equity/);
});
