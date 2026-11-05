// gravit-ui/js/keys.js — the page's keys in one table (spec 2026-11-03 §5.12): what each does (a words key), its names on a
// Mac and elsewhere, and for a General key the place it is matched on. A key is matched on KeyboardEvent.code and the
// modifier flags, never on key: on a Mac ⌥ turns key into another character (⌥N is a dead key). "⌘" is Meta on a Mac and
// Ctrl elsewhere. No General key fires while an IME composes. dsh's rename (⌥⌘G), fork (⇧⌘F), archive (⌥⌘A) and Escape
// twice are not bound this round (D33); a row the browser does not let the page take is marked bound: false, and the
// sheet lists only bound rows. The names are the keys' own and stay as written; what a row does goes through the words.
import { t } from './i18n/words.js';

const row = r => Object.freeze({ bound: true, ...r });

export const SHORTCUTS = Object.freeze([
  row({ id: 'newConversation', section: 'general', words: 'shortcuts.newConversation', mac: '⌥⌘N', other: 'Ctrl+Alt+N', code: 'KeyN', mods: 'alt-cmd' }), // en-kept: key names
  row({ id: 'searchConversations', section: 'general', words: 'shortcuts.searchConversations', mac: '⌥⌘K', other: 'Ctrl+Alt+K', code: 'KeyK', mods: 'alt-cmd' }), // en-kept: key names
  row({ id: 'settings', section: 'general', words: 'shortcuts.settings', mac: '⌥⌘,', other: 'Ctrl+Alt+,', code: 'Comma', mods: 'alt-cmd' }), // en-kept: key names
  row({ id: 'shortcuts', section: 'general', words: 'shortcuts.shortcuts', mac: '⌘/', other: 'Ctrl+/', code: 'Slash', mods: 'cmd' }), // en-kept: key names
  row({ id: 'send', section: 'composer', words: 'shortcuts.send', mac: 'Enter', other: 'Enter' }), // en-kept: key names
  row({ id: 'newLine', section: 'composer', words: 'shortcuts.newLine', mac: '⇧Enter', other: 'Shift+Enter' }), // en-kept: key names
  row({ id: 'commands', section: 'composer', words: 'shortcuts.commands', mac: '/', other: '/' }), // en-kept: key names
  row({ id: 'references', section: 'composer', words: 'shortcuts.references', mac: '@', other: '@' }), // en-kept: key names
  row({ id: 'close', section: 'composer', words: 'shortcuts.close', mac: 'Esc', other: 'Esc' }), // en-kept: key names
]);

const BY_ID = Object.freeze(Object.fromEntries(SHORTCUTS.map(r => [r.id, r])));
export const shortcut = id => BY_ID[id] ?? null;

// what a row does, in the active table: each key literal, read when asked (never at import)
const WORDS = {
  'shortcuts.newConversation': () => t('shortcuts.newConversation'),
  'shortcuts.searchConversations': () => t('shortcuts.searchConversations'),
  'shortcuts.settings': () => t('shortcuts.settings'),
  'shortcuts.shortcuts': () => t('shortcuts.shortcuts'),
  'shortcuts.send': () => t('shortcuts.send'),
  'shortcuts.newLine': () => t('shortcuts.newLine'),
  'shortcuts.commands': () => t('shortcuts.commands'),
  'shortcuts.references': () => t('shortcuts.references'),
  'shortcuts.close': () => t('shortcuts.close'),
};
export const shortcutWords = r => WORDS[r.words]();

// ⌘ is Meta on a Mac and Ctrl elsewhere, and the other one is not held
const cmdHeld = (ev, mac) => (mac ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey);
const MODS = {
  'alt-cmd': (ev, mac) => ev.altKey && !ev.shiftKey && cmdHeld(ev, mac),
  cmd: (ev, mac) => !ev.altKey && !ev.shiftKey && cmdHeld(ev, mac),
};

// the General row a keydown is, by its id, or null: never while an IME composes, and never a row marked unbound (the table
// is the page's own; a test hands another)
export function chordOf(ev, mac, table = SHORTCUTS) {
  if (!ev || ev.isComposing || ev.keyCode === 229) return null;
  for (const r of table) {
    if (r.section === 'general' && r.bound && r.code === ev.code && MODS[r.mods]?.(ev, mac)) return r.id;
  }
  return null;
}

export const chordLabel = (r, mac) => (mac ? r.mac : r.other);
