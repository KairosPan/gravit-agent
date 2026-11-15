// visible(): a character that hides or reorders text (a control, a bidi mark or override, a zero-width space, a byte-order
// mark) is written as its six-character escape, so words the memory hands back read as they are on the card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { visible } from '../../client/js/visible.js';

test('a newline, U+202E, U+200B, U+FEFF and U+2066 each become their \\uXXXX text; a tab is left alone', () => {
  assert.equal(visible('a\nb'), 'a\\u000ab');
  assert.equal(visible('a\tb'), 'a\tb');
  assert.equal(visible('a\u202eb'), 'a\\u202eb');
  assert.equal(visible('a\u200bb'), 'a\\u200bb');
  assert.equal(visible('\ufeffa'), '\\ufeffa');
  assert.equal(visible('a\u2066b'), 'a\\u2066b');
});

test('every code point of the set is escaped, its neighbours are not', () => {
  const hidden = [[0x00, 0x08], [0x0a, 0x1f], [0x7f, 0x9f], [0x61c, 0x61c], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff]];
  for (const [from, to] of hidden) {
    for (let c = from; c <= to; c++) assert.equal(visible(String.fromCharCode(c)), `\\u${c.toString(16).padStart(4, '0')}`, c.toString(16));
  }
  for (const c of [0x09, 0x20, 0x7e, 0xa0, 0x61b, 0x61d, 0x200a, 0x2010, 0x2027, 0x202f, 0x205f, 0x206a, 0xfefe, 0xff01]) {
    assert.equal(visible(String.fromCharCode(c)), String.fromCharCode(c), c.toString(16));
  }
});

test('plain Chinese and English text is unchanged; anything not a string reads as text', () => {
  assert.equal(visible('Do not add to a loser'), 'Do not add to a loser');
  assert.equal(visible('不要在亏损的仓位上加仓'), '不要在亏损的仓位上加仓');
  assert.equal(visible(''), '');
  assert.equal(visible(null), '');
  assert.equal(visible(undefined), '');
  assert.equal(visible(12), '12');
});
