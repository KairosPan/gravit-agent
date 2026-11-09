// The English table (client/js/i18n/en.js) against its grammar (plan 6): keys `<area>.<part>.<name>` in lower camel, values
// plain words (no markup, no entity), a plural's two forms alike in their params, and every key used by some client file and
// every key a file uses present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { EN } from '../../client/js/i18n/en.js';
import { wordsCalls, casedWords, wordsProps } from './helpers/words-scan.js';
import { KEY, ROOT, walk, ENTITY, params, forms, ampKeys, ampReaders } from './helpers/words-table.js';

test('every key follows the grammar and every value is a string or {one, other}', () => {
  assert.ok(Object.isFrozen(EN));
  for (const [key, v] of Object.entries(EN)) {
    assert.match(key, KEY, key);
    const plural = v && typeof v === 'object' && Object.keys(v).sort().join() === 'one,other';
    assert.ok((typeof v === 'string' && v !== '') || (plural && typeof v.one === 'string' && v.one && typeof v.other === 'string' && v.other), key);
  }
});

test('no value holds <, > or ", nor an entity', () => {
  for (const [key, v] of Object.entries(EN)) for (const s of forms(v)) {
    assert.doesNotMatch(s, /[<>"]/, key);
    assert.doesNotMatch(s, ENTITY, key);
  }
});

// th and thn put a value into HTML verbatim: a value holding & is read by t or tn, inside esc, so its & is escaped
test('a value holding & is read only by t or tn', () => {
  const amp = ampKeys(EN);
  assert.ok(amp.has('account.pnl'), 'P&L is in the table');
  assert.deepEqual(ampReaders(amp), []);
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

test('casedWords finds a property some source assigns a words call to, upper- or lower-cased in another source', () => {
  const props = new Set(["const item = () => ({ kind: t('x.y.z') });", "const p = {}; p.word = th('x.y.z');", 'const s = { symbol: code };', "const w = () => t('x.y', { what: t('x.z') });"]
    .flatMap(src => [...wordsProps(src, 'other.js')]));
  assert.deepEqual([...props].sort(), ['kind', 'word']);
  const lines = src => casedWords(src, 'snippet.js', { props }).map(c => c.line);
  for (const src of ['const a = item => item.kind.toUpperCase();', 'const a = p => p.word[0].toLowerCase();']) assert.deepEqual(lines(src), [1], src);
  for (const src of ['const a = p => p.symbol.toUpperCase();', 'const a = item => item.code.toLowerCase();']) assert.deepEqual(lines(src), [], src);
});

const CASE_PROPS = new Set(walk(ROOT).flatMap(f => [...wordsProps(readFileSync(f, 'utf8'), f)]));
test("no words call's result is upper- or lower-cased", () => {
  assert.deepEqual(walk(ROOT).flatMap(f => casedWords(readFileSync(f, 'utf8'), f, { props: CASE_PROPS }).map(c => `${relative(ROOT, f)}:${c.line} ${c.text}`)), [],
    'a word drawn in another case is its own key');
});

// two keys may hold one sentence only for two meanings, each named here: a table may word them apart. A sentence of fewer
// than four words (Refused, Order) is a word's own business. A pair is its two keys sorted, wherever they stand in the table
const SAME_WORDS = {
  'sheet.signIn.failed venues.signIn.unfinished': "the sign-in sheet's own line when it failed; a venue's sign-in the Account said did not finish",
  'sheet.title.paper venues.openPaper': "the sheet's title the Venues tab's key opens; the Venues tab's key",
  'money.earn.none sheet.earn.nothingIn': "Earn's box with nothing earning; the Earn sheet's Take out with nothing in",
  'sheet.quote.fillIn trade.quote.fillIn': "an owner sheet's quote not yet asked; Trade's ticket's quote not yet asked",
  'sheet.missing.cents trade.missing.cents': "a market sheet's stop or limit price out of range; Trade's ticket's price out of range",
};
test('no two keys hold the same sentence of four words or more unless listed', () => {
  const by = new Map();
  for (const [key, v] of Object.entries(EN)) for (const s of new Set(forms(v))) {
    if (s.trim().split(/\s+/).length < 4) continue;
    by.set(s, [...(by.get(s) ?? []), key]);
  }
  const same = [...by.values()].filter(keys => keys.length > 1).map(keys => [...keys].sort().join(' '));
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
