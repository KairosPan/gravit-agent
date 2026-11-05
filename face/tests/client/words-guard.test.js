// The words guard (plan 6, D35): the face's words live in the table (client/js/i18n/en.js), so an English literal left in a
// client source is a word not yet moved. KEPT_FILES are the files whose English is not the face's words; PENDING the files the
// words tasks still have to move, each task taking its files off the list (and lowering PENDING_MAX) until Task 10 deletes it.
// A literal deliberately kept in place carries `// en-kept: <reason>` on its own line; EN_KEPT counts the markers, so a task
// that adds one says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { englishLiterals, wordsCalls, wordsBindings } from './helpers/words-scan.js';

const ROOT = fileURLToPath(new URL('../../client/js/', import.meta.url));
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []);
const FILES = walk(ROOT).map(f => relative(ROOT, f).split('\\').join('/')).sort();
const source = file => readFileSync(join(ROOT, file), 'utf8');

const KEPT_FILES = {
  'i18n/en.js': 'the English table itself',
  'wire/api.js': 'transport errors, read by code',
  'wire/markdown.js': "Gravit's words",
};

const PENDING = [
  'app.js', 'host/channels.js', 'host/desk-view.js', 'host/desk.js',
  'host/discover-view.js', 'host/discover.js', 'host/explore-join.js',
  'host/lunhui.js', 'host/market-depth-view.js', 'host/market-view.js', 'host/markets.js', 'host/modules-view.js',
  'host/run-sheet-view.js', 'host/run-sheet.js',
  'host/runs-view.js', 'host/trade-view.js',
  'render/channel.js', 'render/chart.js', 'render/desk.js', 'render/discover.js',
  'render/lunhui/breadth.js', 'render/lunhui/composed.js', 'render/lunhui/footer.js', 'render/lunhui/indices.js',
  'render/lunhui/intraday.js', 'render/lunhui/ladder.js', 'render/lunhui/notes.js', 'render/lunhui/signals.js',
  'render/lunhui/sources.js', 'render/lunhui/stock.js', 'render/lunhui/verdicts.js', 'render/lunhui/yesterday.js',
  'render/markets.js', 'render/modules.js', 'render/run-sheet.js', 'render/trade.js',
  'wire/botSettings.js', 'wire/market-model.js', 'wire/member-traces.js', 'wire/room.js', 'wire/subagents.js',
];

// the most files PENDING may hold, and the en-kept markers under client/js: each words task lowers the first and states the
// second
const PENDING_MAX = 41;
const EN_KEPT = 20;

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

test('no client file outside PENDING and KEPT_FILES has an English literal', () => {
  const found = FILES.filter(f => !(f in KEPT_FILES) && !PENDING.includes(f))
    .flatMap(f => englishLiterals(source(f), f).map(l => `${f}:${l.line} ${l.text}`));
  assert.deepEqual(found, [], 'move these into client/js/i18n/en.js, or mark a deliberate one // en-kept: <reason>');
});

test('every PENDING file still has one (a moved file must leave the list)', () => {
  assert.deepEqual([...PENDING].sort(), PENDING, 'PENDING is sorted');
  for (const f of PENDING) assert.ok(FILES.includes(f), `${f} exists`);
  assert.deepEqual(PENDING.filter(f => englishLiterals(source(f), f).length === 0), [], 'these files hold no English literal now: take them off PENDING');
  for (const f of Object.keys(KEPT_FILES)) assert.ok(FILES.includes(f), `${f} exists`);
});

test('PENDING stays under its ceiling, and the en-kept markers are the ones counted', () => {
  assert.ok(PENDING.length <= PENDING_MAX, `PENDING holds ${PENDING.length} files, at most ${PENDING_MAX}`);
  const markers = FILES.reduce((n, f) => n + (source(f).match(/\/\/\s*en-kept:/g) ?? []).length, 0);
  assert.equal(markers, EN_KEPT, 'en-kept markers under client/js: a task that adds or removes one updates EN_KEPT');
});

test('no client file binds a words name of its own beside the words it imports', () => {
  assert.deepEqual(FILES.flatMap(f => wordsBindings(source(f), f).map(b => `${f}:${b.line} ${b.name} ${b.why}`)), []);
});

test('no words call has a computed key or runs at module top level', () => {
  const bad = FILES.flatMap(f => wordsCalls(source(f), f).filter(c => c.key === null || c.topLevel).map(c => `${f}:${c.line} ${c.fn}(${c.key === null ? 'computed' : `'${c.key}'`})${c.topLevel ? ' at top level' : ''}`));
  assert.deepEqual(bad, []);
});
