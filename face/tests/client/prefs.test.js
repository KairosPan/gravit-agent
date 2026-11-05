// The text and code sizes and the two fonts (plan 6 Task 13): the ranges, a typed family cleaned to a name, the custom
// properties they set, and index.html's inline script, which sets the same before the first paint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIZES, sizeOf, cleanFont, cssOf, applyPrefs } from '../../client/js/prefs.js';

const HOSTILE = 'Inter"; } body { display:none';

test('sizes clamp to their ranges and take the base for a non-number', () => {
  assert.deepEqual(SIZES, { textSize: { min: 12, max: 20, base: 15 }, codeSize: { min: 10, max: 16, base: 12 } });
  assert.equal(sizeOf('textSize', 16), 16);
  assert.equal(sizeOf('textSize', 11), 12);
  assert.equal(sizeOf('textSize', 99), 20);
  assert.equal(sizeOf('textSize', 16.6), 17, 'a whole px');
  assert.equal(sizeOf('codeSize', 9), 10);
  assert.equal(sizeOf('codeSize', 17), 16);
  for (const v of ['16', null, undefined, NaN, Infinity, {}, [], true]) {
    assert.equal(sizeOf('textSize', v), 15, String(v));
    assert.equal(sizeOf('codeSize', v), 12, String(v));
  }
});

test('a font is cleaned: quotes, semicolons, braces and newlines go, 64 characters at most', () => {
  const clean = cleanFont(HOSTILE);
  assert.equal(clean, 'Inter body display none');
  assert.doesNotMatch(clean, /["';{}:]/);
  assert.equal(cleanFont('  JetBrains   Mono\n'), 'JetBrains Mono');
  assert.equal(cleanFont('Noto_Sans-SC 2.0'), 'Noto_Sans-SC 2.0');
  assert.equal(cleanFont('思源黑体'), '思源黑体', 'letters of any script');
  assert.equal(cleanFont('a\\b</style>c'), 'a b style c');
  assert.equal(cleanFont('x'.repeat(80)).length, 64);
  assert.equal(cleanFont(`${'x'.repeat(63)} y`), 'x'.repeat(63), 'trimmed after the cut');
  for (const v of [null, undefined, 3, {}]) assert.equal(cleanFont(v), '');
  // a combining accent is a mark, not a letter: composed first, an NFD é stays é and not 'e '
  assert.equal(cleanFont('Condense\u0301'), 'Condens\u00e9');
  assert.equal(cleanFont('Condense\u0301 Pro'), 'Condens\u00e9 Pro');
});

test('cssOf is all null at the defaults', () => {
  const none = { '--fs': null, '--fm': null, '--font-sans': null, '--font-mono': null };
  assert.deepEqual(cssOf({ textSize: 15, codeSize: 12, textFont: '', codeFont: '' }), none);
  assert.deepEqual(cssOf({}), none);
  assert.deepEqual(cssOf({ textSize: 16, codeSize: 16, textFont: 'Inter', codeFont: HOSTILE }), {
    '--fs': String(16 / 15), '--fm': String(16 / 12),
    '--font-sans': '"Inter", var(--font-sans-base)', '--font-mono': '"Inter body display none", var(--font-mono-base)',
  });
});

const recording = () => {
  const props = new Map();
  return { props, setProperty: (k, v) => props.set(k, v), removeProperty: k => { props.delete(k); } };
};

test('applyPrefs sets each value and removes each default', () => {
  const style = recording();
  const el = { style };
  applyPrefs(el, { textSize: 20, textFont: 'Inter' });
  assert.deepEqual(Object.fromEntries(style.props), { '--fs': String(20 / 15), '--font-sans': '"Inter", var(--font-sans-base)' });
  applyPrefs(el, { textSize: 15, codeSize: 10 });
  assert.deepEqual(Object.fromEntries(style.props), { '--fm': String(10 / 12) });
  applyPrefs({}, { textSize: 20 });   // an element with no style: nothing to set
});

test('the inline script in index.html sets the same properties as applyPrefs', () => {
  const page = readFileSync(new URL('../../client/index.html', import.meta.url), 'utf8');
  const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'an inline script in the head');
  const run = saved => {
    const style = recording();
    const documentElement = { dataset: {}, style };
    const localStorage = { getItem: k => (k === 'gravit-ui.prefs' && saved !== undefined ? JSON.stringify(saved) : null) };
    new Function('localStorage', 'document', script)(localStorage, { documentElement });
    return { css: Object.fromEntries(style.props), theme: documentElement.dataset.theme };
  };
  const viaModule = prefs => { const style = recording(); applyPrefs({ style }, prefs); return Object.fromEntries(style.props); };
  const cases = [
    undefined, {}, { textSize: 15, codeSize: 12, textFont: '', codeFont: '' },
    { textSize: 20, codeSize: 16 }, { textSize: 12, codeSize: 10 }, { textSize: 99, codeSize: -4 }, { textSize: '18' },
    { textFont: 'Inter', codeFont: 'JetBrains Mono' }, { textFont: HOSTILE, codeFont: `${HOSTILE}\n}` },
    { theme: 'black', textSize: 17, textFont: 'x'.repeat(90) }, { textFont: 'Condense\u0301', codeFont: 'Condense\u0301 Mono' },
  ];
  for (const saved of cases) {
    const got = run(saved);
    assert.deepEqual(got.css, viaModule(saved ?? {}), JSON.stringify(saved));
    for (const v of Object.values(got.css)) assert.doesNotMatch(v.replace(/^"[^"]*", var\(--font-(?:sans|mono)-base\)$/, ''), /[";{}]/);
  }
  assert.equal(run({ theme: 'black' }).theme, 'black', 'the theme still comes first');
  assert.equal(run({ theme: 'nope' }).theme, undefined);
  assert.deepEqual(run(null).css, {}, 'a saved null reads as nothing');
});
