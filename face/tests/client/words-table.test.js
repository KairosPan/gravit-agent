// The English table (client/js/i18n/en.js) against its grammar (plan 6): keys `<area>.<part>.<name>` in lower camel, values
// plain words (no markup, no entity), a plural's two forms alike in their params, and every key used by some client file and
// every key a file uses present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EN } from '../../client/js/i18n/en.js';
import { wordsCalls } from './helpers/words-scan.js';

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

test('no value holds <, > or ", nor an entity', () => {
  for (const [key, v] of Object.entries(EN)) for (const s of forms(v)) assert.doesNotMatch(s, /[<>"]|&[#A-Za-z]/, key);
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
