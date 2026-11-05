// The page's keys (spec 2026-11-03 §5.12): one table, its General rows matched on the key's code and the modifier flags,
// ⌘ as Meta on a Mac and Ctrl elsewhere, never while an IME composes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHORTCUTS, chordOf, chordLabel, shortcut, shortcutWords } from '../../client/js/keys.js';
import { EN } from '../../client/js/i18n/en.js';

const GENERAL = { newConversation: ['KeyN', 'alt'], searchConversations: ['KeyK', 'alt'], settings: ['Comma', 'alt'], shortcuts: ['Slash', ''] };
const press = (code, { alt = false, meta = false, ctrl = false, shift = false, ...over } = {}) =>
  ({ code, key: '?', altKey: alt, metaKey: meta, ctrlKey: ctrl, shiftKey: shift, ...over });

test('each general key matches on its code with ⌘ as Meta on a Mac and Ctrl elsewhere', () => {
  for (const [id, [code, alt]] of Object.entries(GENERAL)) {
    assert.equal(chordOf(press(code, { alt: alt === 'alt', meta: true }), true), id, `${id} on a Mac`);
    assert.equal(chordOf(press(code, { alt: alt === 'alt', ctrl: true }), false), id, `${id} elsewhere`);
  }
  assert.equal(chordOf(press('KeyJ', { alt: true, meta: true }), true), null, 'another code is no key');
});

test('⌥ turning the key into another character still matches', () => {
  assert.equal(chordOf(press('KeyN', { alt: true, meta: true, key: 'ñ' }), true), 'newConversation');
  assert.equal(chordOf(press('Comma', { alt: true, meta: true, key: '≤' }), true), 'settings');
  assert.equal(chordOf(press('KeyM', { alt: true, meta: true, key: 'n' }), true), null, 'a key reading n on another place is not ⌥⌘N');
});

test("Shift, the other platform's ⌘ or a missing ⌥ is not the key", () => {
  assert.equal(chordOf(press('KeyN', { alt: true, meta: true, shift: true }), true), null, 'Shift');
  assert.equal(chordOf(press('KeyN', { alt: true, ctrl: true }), true), null, 'Ctrl+Alt on a Mac');
  assert.equal(chordOf(press('KeyN', { alt: true, meta: true }), false), null, 'Meta+Alt off a Mac');
  assert.equal(chordOf(press('KeyN', { alt: true, meta: true, ctrl: true }), true), null, 'both');
  assert.equal(chordOf(press('KeyN', { meta: true }), true), null, 'no ⌥');
  assert.equal(chordOf(press('Comma', { meta: true }), true), null, '⌘, is the browser’s');
  assert.equal(chordOf(press('Slash', { alt: true, meta: true }), true), null, '⌥⌘/ is not ⌘/');
  assert.equal(chordOf(press('Slash', { meta: true, shift: true }), true), null, '⇧⌘/ is not ⌘/');
});

test('nothing matches while an IME composes', () => {
  assert.equal(chordOf(press('KeyN', { alt: true, meta: true, isComposing: true }), true), null);
  assert.equal(chordOf(press('KeyN', { alt: true, meta: true, keyCode: 229 }), true), null);
  assert.equal(chordOf(press('Slash', { ctrl: true, keyCode: 229 }), false), null);
});

test('a row marked unbound is never matched', () => {
  assert.ok(SHORTCUTS.every(x => x.bound === true), 'every row bound until the drill finds otherwise');
  assert.ok(Object.isFrozen(SHORTCUTS) && Object.isFrozen(shortcut('settings')), 'the table is frozen');
  const table = SHORTCUTS.map(r => (r.id === 'settings' ? { ...r, bound: false } : r));
  assert.equal(chordOf(press('Comma', { alt: true, meta: true }), true, table), null);
  assert.equal(chordOf(press('KeyN', { alt: true, meta: true }), true, table), 'newConversation', 'the others still match');
});

test("dsh's rename, fork and archive chords are not in the table", () => {
  const labels = SHORTCUTS.flatMap(r => [r.mac, r.other]);
  for (const k of ['⌥⌘G', '⇧⌘F', '⌥⌘A', 'Ctrl+Alt+G', 'Ctrl+Shift+F', 'Ctrl+Alt+A']) assert.ok(!labels.includes(k), k);
  for (const code of ['KeyG', 'KeyF', 'KeyA']) assert.ok(!SHORTCUTS.some(r => r.code === code), code);
  for (const code of ['KeyG', 'KeyF', 'KeyA']) {
    assert.equal(chordOf(press(code, { alt: true, meta: true }), true), null);
    assert.equal(chordOf(press(code, { shift: true, meta: true }), true), null);
  }
});

test('the table: its sections, its labels by platform, and words from EN', () => {
  assert.deepEqual(SHORTCUTS.filter(r => r.section === 'general').map(r => r.id), ['newConversation', 'searchConversations', 'settings', 'shortcuts']);
  assert.deepEqual(SHORTCUTS.filter(r => r.section === 'composer').map(r => r.id), ['send', 'newLine', 'commands', 'references', 'close']);
  assert.deepEqual(SHORTCUTS.map(r => chordLabel(r, true)), ['⌥⌘N', '⌥⌘K', '⌥⌘,', '⌘/', 'Enter', '⇧Enter', '/', '@', 'Esc']);
  assert.deepEqual(SHORTCUTS.map(r => chordLabel(r, false)), ['Ctrl+Alt+N', 'Ctrl+Alt+K', 'Ctrl+Alt+,', 'Ctrl+/', 'Enter', 'Shift+Enter', '/', '@', 'Esc']);
  for (const r of SHORTCUTS) {
    assert.ok(Object.hasOwn(EN, r.words), `${r.id}: ${r.words} is an EN key`);
    assert.equal(shortcutWords(r), EN[r.words]);
  }
  assert.deepEqual(SHORTCUTS.map(shortcutWords), ['New conversation', 'Search conversations', 'Settings', 'This sheet', 'Send', 'New line',
    'Commands and skills', 'Files, conversations, bots', 'Close a menu, sheet or drawer']);
});

test('off a Mac AltGr (Ctrl+Alt with AltGraph held) is a character, never a key; on a Mac AltGraph is not looked at', () => {
  const altGr = { getModifierState: k => k === 'AltGraph' };
  assert.equal(chordOf(press('KeyN', { alt: true, ctrl: true, key: 'ń', ...altGr }), false), null, 'AltGr+N on a Polish layout');
  assert.equal(chordOf(press('KeyK', { alt: true, ctrl: true, ...altGr }), false), null, 'AltGr+K');
  assert.equal(chordOf(press('Comma', { alt: true, ctrl: true, ...altGr }), false), null, 'AltGr+,');
  assert.equal(chordOf(press('KeyN', { alt: true, ctrl: true, getModifierState: () => false }), false), 'newConversation', 'Ctrl+Alt without AltGraph');
  assert.equal(chordOf(press('KeyN', { alt: true, meta: true, ...altGr }), true), 'newConversation', 'a Mac');
});

test('the two punctuation keys also match on the character, for layouts that put it elsewhere', () => {
  assert.equal(chordOf(press('Digit7', { ctrl: true, key: '/' }), false), 'shortcuts', 'a / on another place');
  assert.equal(chordOf(press('KeyM', { meta: true, key: '/' }), true), 'shortcuts');
  assert.equal(chordOf(press('KeyM', { alt: true, ctrl: true, key: ',' }), false), 'settings', 'AZERTY , (KeyM)');
  assert.equal(chordOf(press('KeyM', { alt: true, meta: true, key: ',' }), true), 'settings');
  assert.equal(chordOf(press('Digit7', { ctrl: true, shift: true, key: '/' }), false), null, 'the same mods only');
  assert.equal(chordOf(press('KeyM', { meta: true, key: ',' }), true), null, '⌘, stays the browser’s');
  assert.equal(chordOf(press('KeyX', { alt: true, meta: true, key: 'n' }), true), null, 'a letter row matches on its code alone');
});
