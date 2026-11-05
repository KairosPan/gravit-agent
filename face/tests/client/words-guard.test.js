// The words guard (plan 6, D35): the face's words live in the table (client/js/i18n/en.js), so an English literal left in a
// client source is a word not moved. KEPT_FILES are the files whose English is not the face's words; every other client file
// holds none. A literal deliberately kept in place carries `// en-kept: <reason>` on its own line; EN_KEPT counts the markers,
// so a change that adds one says so. What the scanner cannot see in a source, words-probe.test.js finds on the screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { englishLiterals, wordsCalls, wordsBindings, storedWords, assembled } from './helpers/words-scan.js';

const ROOT = fileURLToPath(new URL('../../client/js/', import.meta.url));
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []);
const FILES = walk(ROOT).map(f => relative(ROOT, f).split('\\').join('/')).sort();
const source = file => readFileSync(join(ROOT, file), 'utf8');

const KEPT_FILES = {
  'i18n/en.js': 'the English table itself',
  'wire/api.js': 'transport errors, read by code',
  'wire/markdown.js': "Gravit's words",
};

// the en-kept markers under client/js
const EN_KEPT = 61;

const texts = src => englishLiterals(src, 'snippet.js').map(l => l.text);

test('a capitalized word and a phrase are found; an identifier, a class list, a selector and a key name are not', () => {
  assert.deepEqual(texts("const a = 'Close';"), ['Close']);
  assert.deepEqual(texts("const a = 'Not signed in';"), ['Not signed in']);
  for (const quiet of ["'seg-item pressed'", "'#say'", "'Escape'", "'BUTTON'", "'content-type'"]) assert.deepEqual(texts(`const a = ${quiet};`), [], quiet);
});

test("a template's text and its aria-label are found, its tags and attribute names are not", () => {
  assert.deepEqual(texts('const a = `<div class="dsec-label">Theme</div>`;'), ['Theme']);
  assert.deepEqual(texts('const a = `<b aria-label="Copy">`;'), ['Copy']);
  assert.deepEqual(texts('const a = x => `<div class="${x}">${x}</div>`;'), []);
  assert.deepEqual(texts('const a = x => `<button type="button" data-x="${x}" aria-label="Close">×</button>`;'), ['Close']);
});

test("a words call's key, an import, a property name and a class list are not reported", () => {
  assert.deepEqual(texts("import { t } from 'Some Module';\nconst a = () => t('Close', { n: 1 });"), []);
  assert.deepEqual(texts("const a = { 'Not signed in': 1, 'aria-label': 2 };"), []);
  assert.deepEqual(texts("const a = () => import('Some Module');"), []);
  assert.deepEqual(texts("const a = () => th('Close the drawer');"), []);
  assert.deepEqual(texts("const a = attrs({ class: 'input small', 'aria-label': 'Not signed in' });"), ['Not signed in'], "an attrs class list is no phrase, its aria-label is");
  assert.deepEqual(texts("const a = cls('drawer sheet', x && 'with stock');"), []);
  assert.deepEqual(texts("const a = attrs({ href: u, rel: 'noopener noreferrer' });"), [], "an attrs rel is a token list");
});

test('en-kept exempts its own line only', () => {
  assert.deepEqual(texts("const a = 'Tencent'; // en-kept: a provider's name"), []);
  assert.deepEqual(texts("// en-kept: a provider's name\nconst a = 'Tencent';"), ['Tencent'], 'a marker alone on the line before covers nothing');
  assert.deepEqual(texts("const b = 1; // en-kept: not here\nconst a = 'Tencent';"), ['Tencent']);
  assert.deepEqual(texts("const a = x => `Ask ${x}\n  now`; // en-kept: a test"), ['Ask'], "the marker on a template's later line covers that line alone");
});

test('a contraction, an acronym-led phrase and OK are found', () => {
  for (const src of ["const a = x => `Can't run · ${x}`;", `const a = "Couldn't read";`, `const a = "Don't sign";`, "const a = 'MCP server';", "const a = 'CLI agent';", "const a = 'OK';"]) {
    assert.equal(texts(src).length, 1, src);
  }
});

test("a template's lone word or count and word outside a tag is found; a URL, a key, a unit and a tag are not", () => {
  for (const src of ['const a = n => `${n} running`;', 'const a = p => `cache ${p}%`;', 'const a = n => `${n} tokens`;', 'const a = n => `(${n} more)`;', 'const a = x => `<p>${x} left</p>`;']) {
    assert.equal(texts(src).length, 1, src);
  }
  for (const src of ['const a = id => `#/markets/${id}`;', 'const a = w => `${w}px`;', 'const a = (x, y) => `translate(${x}px, ${y}px)`;', 'const a = r => `cn-market/${r}/`;',
    'const a = f => `edit-${f.name}`;', 'const a = (x, y) => `<div class="${x} wide">${y}</div>`;', 'const a = w => `width:${w}%`;', 'const a = s => `HTTP ${s}`;', 'const a = n => `running`;']) {
    assert.deepEqual(texts(src), [], src);
  }
});

test("a lax word touching an interpolation with no space between is part of a name, not a word", () => {
  for (const src of ['const a = c => `<p>sz${c}</p>`;', 'const a = c => `<p>${c}sz</p>`;', 'const a = (a, b) => `<p>${a}ab${b}</p>`;']) assert.deepEqual(texts(src), [], src);
  for (const src of ['const a = c => `<p>sz ${c}</p>`;', 'const a = c => `<p>${c} sz</p>`;', 'const a = c => `<p>left sz${c}</p>`;']) assert.equal(texts(src).length, 1, src);
});

test('a read attribute cut by an interpolation, aria-description, value and a single-quoted attribute are read', () => {
  for (const src of ['const a = x => `<b title="Remove ${x} now">`;', 'const a = r => `<b aria-label="Remove ${esc(r.name)}">`;', 'const a = x => `<b aria-description="Shown first">${x}</b>`;',
    'const a = x => `<button value="Send">${x}</button>`;', "const a = x => `<b title='Copy'>${x}</b>`;"]) {
    assert.ok(texts(src).length >= 1, src);
  }
  assert.deepEqual(texts('const a = x => `<b title="${x}" value="${x}">`;'), []);
  assert.deepEqual(texts('const a = x => `<input value="on" ${x}>`;'), [], 'an attribute value is held to the plain rule');
});

test('wordsCalls finds a literal key, a computed key and a call at module top level', () => {
  const calls = wordsCalls("const A = t('top');\nexport function f(k) { return th('in') + tn(k, 2) + thn(`x`, 1); }", 'snippet.js');
  assert.deepEqual(calls, [
    { line: 1, fn: 't', key: 'top', topLevel: true },
    { line: 2, fn: 'th', key: 'in', topLevel: false },
    { line: 2, fn: 'tn', key: null, topLevel: false },
    { line: 2, fn: 'thn', key: 'x', topLevel: false },
  ]);
  assert.deepEqual(wordsCalls("const f = () => t('a');\nclass C { m() { return t('b'); } }", 'snippet.js').map(c => c.topLevel), [false, false]);
  assert.deepEqual(wordsCalls("const A = (() => t('a'))();\nconst B = (function () { return t('b'); })();\nconst C = (() => () => t('c'))();", 'snippet.js').map(c => c.topLevel), [true, true, false], 'an IIFE runs at import');
});

test('a file that imports the words binds no local t, th, tn or thn, and imports them by name', () => {
  const imp = "import { t, th } from '../i18n/words.js';\n";
  assert.deepEqual(wordsBindings(imp + "export const f = () => t('a');", 'x.js'), []);
  assert.deepEqual(wordsBindings("const t = 1; const f = th => th;", 'x.js'), [], 'a file that does not import the words binds what it likes');
  const why = src => wordsBindings(src, 'x.js').map(b => `${b.line} ${b.name} ${b.why}`);
  assert.deepEqual(why(imp + "const f = ms => { const t = ms / 1000; return t; };\nconst g = items.map(t => t.id);\nfunction tn() {}\nconst { th: x, thn } = o;"),
    ['2 t local binding', '3 t local binding', '4 tn local binding', '5 thn local binding']);
  assert.deepEqual(why("import * as words from './i18n/words.js';"), ['1 words namespace import']);
  assert.deepEqual(why("import { t as tr } from './i18n/words.js';"), ['1 tr aliased import']);
  assert.deepEqual(why("import words from './i18n/words.js';"), ['1 words default import']);
});

test('no client file outside KEPT_FILES has an English literal', () => {
  assert.ok(FILES.length > 100, `the walk finds the client's files (${FILES.length})`);
  for (const f of Object.keys(KEPT_FILES)) assert.ok(FILES.includes(f), `${f} exists`);
  const found = FILES.filter(f => !(f in KEPT_FILES))
    .flatMap(f => englishLiterals(source(f), f).map(l => `${f}:${l.line} ${l.text}`));
  assert.deepEqual(found, [], 'move these into client/js/i18n/en.js, or mark a deliberate one // en-kept: <reason>');
});

test('the en-kept markers are the ones counted', () => {
  const markers = FILES.reduce((n, f) => n + (source(f).match(/\/\/\s*en-kept:/g) ?? []).length, 0);
  assert.equal(markers, EN_KEPT, 'en-kept markers under client/js: a task that adds or removes one updates EN_KEPT');
});

test('no client file binds a words name of its own beside the words it imports', () => {
  assert.deepEqual(FILES.flatMap(f => wordsBindings(source(f), f).map(b => `${f}:${b.line} ${b.name} ${b.why}`)), []);
});

test('no words call has a computed key or runs at module top level', () => {
  // the words module itself reads a said's key and params, the one place a key is not a literal
  const bad = FILES.filter(f => f !== 'i18n/words.js').flatMap(f => wordsCalls(source(f), f).filter(c => c.key === null || c.topLevel).map(c => `${f}:${c.line} ${c.fn}(${c.key === null ? 'computed' : `'${c.key}'`})${c.topLevel ? ' at top level' : ''}`));
  assert.deepEqual(bad, []);
});

// a line the store keeps is a said, read when drawn (plan 7 Task 2): a t/th/tn/thn whose result is dispatched, assigned to a
// property or written in a reducer is read under the table standing then, and reads wrong after a switch
const stored = (src, file = 'host/x.js') => storedWords(src, file).map(s => `${s.line} ${s.fn}(${s.key}) ${s.why}`);

test('storedWords finds a words call dispatched, in an object a dispatch carries, assigned to a property or in a reducer', () => {
  assert.deepEqual(stored("const f = () => store.dispatch('hostStatus', { line: t('a.b'), bad: true });"), ['1 t(a.b) dispatched']);
  assert.deepEqual(stored("const f = () => dispatch('x', t('a.b'));"), ['1 t(a.b) dispatched']);
  assert.deepEqual(stored("const f = ok => store.dispatch('x', { at: { line: ok ? t('a.b') : x ?? tn('c.d', 2) } });"), ['1 t(a.b) dispatched', '1 tn(c.d) dispatched']);
  assert.deepEqual(stored("const f = e => store.dispatch('x', { line: `${t('a.b')}: ${e}` });"), ['1 t(a.b) dispatched']);
  assert.deepEqual(stored("const f = m => { m.error = e?.code ?? t('a.b'); };"), ['1 t(a.b) assigned to a property']);
  assert.deepEqual(stored("export const reducers = { x: s => ({ ...s, line: t('a.b') }) };", 'reducers/x.js'), ['1 t(a.b) in a reducer']);
  assert.deepEqual(stored("const f = () => store.dispatch('x', { line: t('a.b') }); // en-kept: no exemption"), ['1 t(a.b) dispatched'], 'en-kept exempts none');
});

test('storedWords passes a said, a draw and a words call whose result goes elsewhere', () => {
  for (const src of ["const f = () => store.dispatch('x', { line: said('a.b', { n: 1 }) });", "const f = () => `<p>${t('a.b')}</p>`;",
    "const f = () => { const w = t('a.b'); return w; };", "const f = () => say(t('a.b'));", "const f = () => store.dispatch('x', { list: rows.map(r => t('a.b')) });"]) {
    assert.deepEqual(stored(src), [], src);
  }
});

test("no words call's result is stored in state", () => {
  assert.deepEqual(FILES.flatMap(f => storedWords(source(f), f).map(s => `${f}:${s.line} ${s.fn}(${s.key}) ${s.why}`)), [],
    'keep these as said(key, params) and read them with sayOf where they are drawn');
});

// a reducer reads no table (plan 7 Task 2): Identity's reducers, over an answer whose connected networks have problem lines,
// run under a table that throws at any read
test("Identity's reducers read no table", async () => {
  const { reducers } = await import('../../client/js/reducers/index.js');
  const { emptyState } = await import('../../client/js/data/empty.js');
  const { withTable } = await import('../../client/js/i18n/words.js');
  const { connectedNetworks } = await import('../../client/js/host/identity-view.js');
  const read = { ok: true, routing: { brief: ['telegram'] }, networks: [{ network: 'telegram', state: 'connected', pollFailing: { reason: 'x' }, conflictAt: 'y' }, { network: 'slack', state: 'connected', blocked: true }, { network: 'imessage', state: 'connected' }] };
  assert.deepEqual([...connectedNetworks(read)], ['telegram', 'slack']);
  assert.deepEqual([...connectedNetworks({ ok: false, networks: read.networks })], []);
  const boom = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('a reducer read the table'); } });
  const base = { ...emptyState(), owner: { ...emptyState().owner, role: 'signs' }, identity: { ...emptyState().identity, draft: { brief: ['telegram', 'slack'] } } };
  withTable(boom, () => {
    const loaded = reducers.identityLoaded(base, read);
    const ticked = reducers.identityTick(loaded, { row: 'brief', network: 'slack', on: true });
    assert.ok(ticked.identity.data === read);
  });
});

// a sentence assembled in code order cannot be reordered by a table (plan 7 Tasks 4-5): each is one key whose value holds the
// joins as params; a join that is no sentence carries `// words-order: <reason>`
const joins = src => assembled(src, 'snippet.js').map(a => a.line);

test('assembled finds a words call beside another hole, in a join of an array literal and in a + chain', () => {
  for (const src of ["const a = x => `${t('a.b')} ${x}`;", "const a = x => `${x} · ${t('a.b')}`;", "const a = x => `${x}: ${esc(t('a.b'))}`;",
    "const a = (x, ok) => `${ok ? t('a.b') : t('a.c')} (${x})`;", "const a = x => [x, t('a.b')].filter(Boolean).join(' · ');",
    "const a = x => [t('a.b'), x].join(', ');", "const a = x => [t('a.b'), x].join();", "const a = x => t('a.b') + x;", "const a = x => x + ': ' + tn('a.b', 2);",
    "const a = x => `${sayOf(x)} ${x}`;", "const a = () => `${th('a.b')}${icon('x')}`;"]) {
    assert.deepEqual(joins(src), [1], src);
  }
});

test('assembled passes markup between holes, a call that draws markup, a join of markup, a literal concatenation and a marked join', () => {
  for (const src of ["const a = x => `<b>${t('a.b')}</b><i>${x}</i>`;", "const a = x => `${key('k', t('a.b'))}${key('j', x)}`;", "const a = x => `<b title=\"${t('a.b')}\">${x}</b>`;",
    "const a = x => [t('a.b'), x].map(w => `<li>${w}</li>`).join('');", "const a = () => '<p>' + t('a.b') + '</p>';", "const a = x => `${t('a.b', { x })}`;",
    "const a = x => [x, t('a.b')].join(' · '); // words-order: a list of codes", "const a = x => [x, y].join(' ');", "const a = x => [t('a.b'), x].join(sep);",
    "const a = x => `${x} ${y}`;"]) {
    assert.deepEqual(joins(src), [], src);
  }
});

test('no client file assembles a sentence', () => {
  const found = FILES.flatMap(f => assembled(source(f), f).map(a => `${f}:${a.line} ${a.text}`));
  assert.deepEqual(found, [], 'make each one key whose value holds the joins as params, or mark a join that is no sentence // words-order: <reason>');
});
