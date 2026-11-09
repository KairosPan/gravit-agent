// What the two words tables (client/js/i18n/en.js and zh.js) share under test (plan 7): the key grammar, the value helpers, the
// entity test, and the scan for a words call that reads a value holding `&` with th or thn. words-table.test.js holds EN to
// them, words-zh.test.js holds ZH.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wordsCalls } from './words-scan.js';

export const AREAS = ['common', 'time', 'status', 'nav', 'list', 'search', 'thread', 'composer', 'details', 'jobs', 'settings', 'shortcuts', 'owner',
  'sheet', 'account', 'money', 'venues', 'agents', 'cards', 'rules', 'identity', 'markets', 'trade', 'desk', 'discover', 'channel', 'modules',
  'runSheet', 'lunhui', 'tasks', 'history'];
export const KEY = new RegExp(`^(?:${AREAS.join('|')})(?:\\.[a-z][a-zA-Z0-9]*){1,2}$`);
export const ROOT = fileURLToPath(new URL('../../../client/js/', import.meta.url));
export const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []);
// an ampersand that starts no entity (P&L) is a word; one that would read as an entity in HTML (&amp; &#38;) is not
export const ENTITY = /&(#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/;
// a {name} param, in order of appearance
export const params = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
// a value's forms: the string, or a plural's two
export const forms = v => typeof v === 'string' ? [v] : [v.one, v.other];

// the keys of `table` whose value holds a `&`
export const ampKeys = table => new Set(Object.entries(table).filter(([, v]) => forms(v).some(s => typeof s === 'string' && s.includes('&'))).map(([k]) => k));

// th and thn put a value into HTML verbatim: a value holding & is read by t or tn, inside esc, so its & is escaped. The call
// sites under client/js that read one of `keys` with anything but t or tn, as `file:line fn('key')`
export function ampReaders(keys) {
  return walk(ROOT).flatMap(f => wordsCalls(readFileSync(f, 'utf8'), f)
    .filter(c => keys.has(c.key) && c.fn !== 't' && c.fn !== 'tn')
    .map(c => `${relative(ROOT, f)}:${c.line} ${c.fn}('${c.key}')`));
}
