// The English table (client/js/i18n/en.js) against its grammar (plan 6): keys `<area>.<part>.<name>` in lower camel, values
// plain words (no markup, no entity), a plural's two forms alike in their params, and every key used by some client file and
// every key a file uses present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EN } from '../../client/js/i18n/en.js';
import { wordsCalls, casedWords } from './helpers/words-scan.js';

const AREAS = ['common', 'time', 'status', 'nav', 'list', 'search', 'thread', 'composer', 'details', 'jobs', 'settings', 'shortcuts', 'owner',
  'sheet', 'account', 'money', 'venues', 'agents', 'cards', 'rules', 'identity', 'markets', 'trade', 'desk', 'discover', 'channel', 'modules',
  'runSheet', 'lunhui'];
const KEY = new RegExp(`^(?:${AREAS.join('|')})(?:\\.[a-z][a-zA-Z0-9]*){1,2}$`);
const ROOT = fileURLToPath(new URL('../../client/js/', import.meta.url));
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []);
const params = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
const forms = v => typeof v === 'string' ? [v] : [v.one, v.other];

test('every key follows the grammar and every value is a string or {one, other}', () => {
  assert.ok(Object.isFrozen(EN));
  for (const [key, v] of Object.entries(EN)) {
    assert.match(key, KEY, key);
    const plural = v && typeof v === 'object' && Object.keys(v).sort().join() === 'one,other';
    assert.ok((typeof v === 'string' && v !== '') || (plural && typeof v.one === 'string' && v.one && typeof v.other === 'string' && v.other), key);
  }
});

// an ampersand that starts no entity (P&L) is a word; one that would read as an entity in HTML (&amp; &#38;) is not
const ENTITY = /&(#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/;
test('no value holds <, > or ", nor an entity', () => {
  for (const [key, v] of Object.entries(EN)) for (const s of forms(v)) {
    assert.doesNotMatch(s, /[<>"]/, key);
    assert.doesNotMatch(s, ENTITY, key);
  }
});

// th and thn put a value into HTML verbatim: a value holding & is read by t or tn, inside esc, so its & is escaped
test('a value holding & is read only by t or tn', () => {
  const amp = new Set(Object.entries(EN).filter(([, v]) => forms(v).some(s => s.includes('&'))).map(([k]) => k));
  assert.ok(amp.has('account.pnl'), 'P&L is in the table');
  const bad = walk(ROOT).flatMap(f => wordsCalls(readFileSync(f, 'utf8'), f).filter(c => amp.has(c.key) && c.fn !== 't' && c.fn !== 'tn').map(c => `${relative(ROOT, f)}:${c.line} ${c.fn}('${c.key}')`));
  assert.deepEqual(bad, []);
});

test('casedWords finds a words call upper- or lower-cased, directly, by a piece of it or by a name it was assigned to', () => {
  const lines = src => casedWords(src, 'snippet.js').map(c => c.line);
  for (const src of ["const a = () => t('a.b').toUpperCase();", "const a = () => (t('a.b')).toLowerCase();", "const a = () => t('a.b')[0].toUpperCase();",
    "const a = () => t('a.b').charAt(0).toUpperCase();", "const a = () => { const w = t('a.b'); return w.toUpperCase(); };",
    "const a = () => { const w = tn('a.b', 2); return () => w.slice(1).toLocaleUpperCase(); };"]) {
    assert.deepEqual(lines(src), [1], src);
  }
  for (const src of ["const a = x => x.toUpperCase();", "const a = () => { const w = t('a.b'); }; const b = w => w.toUpperCase();", "const a = s => s.code.toLowerCase();"]) {
    assert.deepEqual(lines(src), [], src);
  }
});

test("no words call's result is upper- or lower-cased", () => {
  assert.deepEqual(walk(ROOT).flatMap(f => casedWords(readFileSync(f, 'utf8'), f).map(c => `${relative(ROOT, f)}:${c.line} ${c.text}`)), [],
    'a word drawn in another case is its own key');
});

// two keys may hold one sentence only for two meanings, each named here: a table may word them apart. A sentence of fewer
// than four words (Refused, Order) is a word's own business
const SAME_WORDS = {
  'venues.signIn.unfinished sheet.signIn.failed': "a venue's sign-in the Account said did not finish; the sign-in sheet's own line when it failed",
  'venues.openPaper sheet.title.paper': "the Venues tab's key; the sheet's title it opens",
  'money.earn.none sheet.earn.nothingIn': "Earn's box with nothing earning; the Earn sheet's Take out with nothing in",
  'sheet.quote.fillIn trade.quote.fillIn': "an owner sheet's quote not yet asked; Trade's ticket's quote not yet asked",
  'sheet.missing.cents trade.missing.cents': "a market sheet's stop or limit price out of range; Trade's ticket's price out of range",
  'channel.notListed discover.bot.notListed': 'a channel created and not yet listed; a bot created and not yet listed',
};
test('no two keys hold the same sentence of four words or more unless listed', () => {
  const by = new Map();
  for (const [key, v] of Object.entries(EN)) for (const s of new Set(forms(v))) {
    if (s.trim().split(/\s+/).length < 4) continue;
    by.set(s, [...(by.get(s) ?? []), key]);
  }
  const same = [...by.values()].filter(keys => keys.length > 1).map(keys => keys.join(' '));
  assert.deepEqual(same.filter(pair => !Object.hasOwn(SAME_WORDS, pair)), [], 'merge the keys, or list the pair with its two meanings');
  assert.deepEqual(Object.keys(SAME_WORDS).filter(pair => !same.includes(pair)), [], 'a listed pair no longer the same: drop it');
});

test('a plural\'s two forms carry the same named params, and other holds {n}', () => {
  for (const [key, v] of Object.entries(EN)) {
    if (typeof v === 'string') continue;
    assert.deepEqual([...new Set(params(v.one))].filter(p => p !== 'n').sort(), [...new Set(params(v.other))].filter(p => p !== 'n').sort(), key);
    assert.ok(params(v.other).includes('n'), `${key}: other holds {n}`);
  }
});

test('every key a client file uses exists in EN, and every EN key is used by some file', () => {
  const used = new Set();
  const missing = [];
  for (const f of walk(ROOT)) {
    for (const c of wordsCalls(readFileSync(f, 'utf8'), f)) {
      if (c.key === null) continue;
      used.add(c.key);
      if (!Object.hasOwn(EN, c.key)) missing.push(`${relative(ROOT, f)}:${c.line} ${c.key}`);
    }
  }
  assert.deepEqual(missing, [], 'keys used but not in EN');
  assert.deepEqual(Object.keys(EN).filter(k => !used.has(k)), [], 'EN keys no file uses');
});
