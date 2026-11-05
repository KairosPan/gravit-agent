// gravit-ui/js/i18n/words.js — the face's own words, read from the active table (spec §5.10): t for plain text, th for HTML
// text (the value verbatim, each param escaped unless rawHtml), tn and thn a plural's form by its count. A key the active
// table lacks reads from EN, and one EN lacks reads as itself. A {name} with no such param stays as written; a param whose
// value is null or undefined reads as nothing, in t as in th. tn and thn read the count as a number (the string '1' is
// one), and {n} is String(n) unless params.n is given. Renders run many times a second while a turn streams: a value with
// no {param} is returned as it is, and one with params costs one replace. A line the store keeps is said (or saidn): its key
// and params, read with sayOf when drawn, so it follows a switch of the table; a said put in as a param is read so too.
import { esc } from '../html.js';
import { EN } from './en.js';

const PARAM = /\{(\w+)\}/g;
const RAW = new WeakSet();
const SAID = new WeakSet();
let active = EN;
let epoch = 0;

const valueOf = key => (Object.hasOwn(active, key) ? active[key] : Object.hasOwn(EN, key) ? EN[key] : key);
const formOf = (v, n) => (typeof v === 'string' ? v : Number(n) === 1 ? v.one : v.other);
// a param that is a said (a kept line put into another) reads in the table that stands
const plainParam = v => (v == null ? '' : SAID.has(v) ? sayOf(v) : String(v));
const htmlParam = v => (RAW.has(v) ? v.html : esc(SAID.has(v) ? sayOf(v) : v));

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

// a line the store keeps (a status line, a sheet's refusal, a field's error): its key and params, read with t (or tn, for
// saidn) when it is drawn, so a line written before a switch of the table reads in the table that stands. A said is a
// value, not a read: a reducer may build one. Its params are copied; a param that is itself a said is read when drawn too
// (t, th, tn and thn read it so)
const keep = line => {
  const kept = Object.freeze(line);
  SAID.add(kept);
  return kept;
};
const copied = params => (params == null ? undefined : Object.freeze({ ...params }));

export function said(key, params) {
  return keep({ key, params: copied(params) });
}

export function saidn(key, n, params) {
  return keep({ key, n, params: copied(params) });
}

export function isSaid(v) {
  return typeof v === 'object' && v !== null && SAID.has(v);
}

// a line a reducer keeps: a string (the empty one only when allowed) or a said. A reducer tests with it and reads no table
export function isLine(v, { empty = false } = {}) {
  return (typeof v === 'string' && (empty || v !== '')) || isSaid(v);
}

// an Error that carries the face's words: its message read now (for a log), its said read when the line it ends in is
// drawn — a catch that writes the line takes err.said before err.message
export function saidError(key, params) {
  return Object.assign(new Error(t(key, params)), { said: said(key, params) });
}

// what a kept line reads now: a string as it is (the Account's or dsh's words, drawn as they came), a said in the table
// that stands, anything else as nothing
export function sayOf(v) {
  if (typeof v === 'string') return v;
  if (!isSaid(v)) return '';
  return !Object.hasOwn(v, 'n') ? t(v.key, v.params) : tn(v.key, v.n, v.params);
}

// the table the words read from (its missing keys from EN): plan 7's switch. The epoch moves only when the table does, so a
// memo keyed on it survives a choice of the language already shown. A table is an object of keys; anything else is refused
export function setTable(table) {
  if (table === null || typeof table !== 'object') throw new TypeError('setTable(object)');
  if (table === active) return;
  active = table;
  epoch += 1;
}

// fn() read under another table, then the table before — synchronous only: a fn that returns a Promise has its awaited part
// read under whatever table stands by then. For tests
export function withTable(table, fn) {
  const before = active;
  setTable(table);
  try {
    return fn();
  } finally {
    setTable(before);
  }
}

// changes whenever the active table does: a memoized renderer keys on it
export function wordsEpoch() {
  return epoch;
}
