// gravit-ui/js/i18n/words.js — the face's own words, read from the active table (spec §5.10): t for plain text, th for HTML
// text (the value verbatim, each param escaped unless rawHtml), tn and thn a plural's form by its count. A key the active
// table lacks reads from EN, and one EN lacks reads as itself. Renders run many times a second while a turn streams: a value
// with no {param} is returned as it is, and one with params costs one replace.
import { esc } from '../html.js';
import { EN } from './en.js';

const PARAM = /\{(\w+)\}/g;
const RAW = new WeakSet();
let active = EN;
let epoch = 0;

const valueOf = key => (Object.hasOwn(active, key) ? active[key] : Object.hasOwn(EN, key) ? EN[key] : key);
const formOf = (v, n) => (typeof v === 'string' ? v : n === 1 ? v.one : v.other);
const plainParam = v => String(v);
const htmlParam = v => (RAW.has(v) ? v.html : esc(v));

function fill(value, params, put) {
  if (!value.includes('{')) return value;
  return value.replace(PARAM, (whole, name) => (params && Object.hasOwn(params, name) ? put(params[name]) : whole));
}

export function t(key, params) {
  return fill(formOf(valueOf(key), null), params, plainParam);
}

export function th(key, params) {
  return fill(formOf(valueOf(key), null), params, htmlParam);
}

export function tn(key, n, params) {
  return fill(formOf(valueOf(key), n), { n: String(n), ...params }, plainParam);
}

export function thn(key, n, params) {
  return fill(formOf(valueOf(key), n), { n: String(n), ...params }, htmlParam);
}

// markup a th or thn param inserts verbatim: the caller built it from escaped parts
export function rawHtml(markup) {
  const raw = Object.freeze({ html: String(markup) });
  RAW.add(raw);
  return raw;
}

// fn() read under another table (its missing keys from EN), then the table before; for tests, and for plan 7's switch
export function withTable(table, fn) {
  const before = active;
  active = table;
  epoch += 1;
  try {
    return fn();
  } finally {
    active = before;
    epoch += 1;
  }
}

// changes whenever the active table does: a memoized renderer keys on it
export function wordsEpoch() {
  return epoch;
}
