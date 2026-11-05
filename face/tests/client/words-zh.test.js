// The Chinese table (client/js/i18n/zh.js) against its checks (plan 7 Task 7): the grammar it shares with EN, its params, the
// Latin it may hold, the glossary it is written against (tests/client/fixtures/zh-glossary.json: the register, the terms, the
// names kept in Latin) and the register's punctuation and spacing. Each check is a pure function over (table, EN, glossary)
// that returns its offenders; a test runs it over ZH — empty until Task 8, so every check passes, and from Task 8 each bites —
// and over a small bad table of its own, which must produce exactly the offence, so a check that has gone quiet is found.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '../../client/js/i18n/en.js';
import { ZH } from '../../client/js/i18n/zh.js';
import { KEY_NAMES } from './helpers/words-scan.js';
import { KEY, ENTITY, ROOT, params, forms, ampKeys, ampReaders } from './helpers/words-table.js';

const GLOSSARY = JSON.parse(readFileSync(new URL('./fixtures/zh-glossary.json', import.meta.url), 'utf8'));

// ── the checks ──

const strings = table => Object.entries(table).filter(([, v]) => typeof v === 'string');
const set = names => [...new Set(names)].sort();
const listOf = names => (names.length ? names.map(p => `{${p}}`).join(' ') : 'none');
const quote = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HAN = '\\p{Script=Han}';

// the table's own grammar: frozen, a key EN has, a value a non-empty string — no plural object, Chinese has one form
function grammarOffenders(table, en) {
  const out = Object.isFrozen(table) ? [] : ['table: not frozen'];
  for (const [key, v] of Object.entries(table)) {
    if (!Object.hasOwn(en, key)) out.push(`${key}: not a key of EN`);
    else if (v && typeof v === 'object') out.push(`${key}: a plural object, ZH has one form`);
    else if (typeof v !== 'string' || !v.trim()) out.push(`${key}: not a non-empty string`);
  }
  return out;
}

function markupOffenders(table) {
  return strings(table).flatMap(([key, v]) => [...(/[<>"]/.test(v) ? [`${key}: <, > or "`] : []), ...(ENTITY.test(v) ? [`${key}: an entity`] : [])]);
}

// a value holding & is read by t or tn only: the call sites that read such a key of the table otherwise (readers: the scan of
// the client's sources, replaceable for a test)
const ampOffenders = (table, readers = ampReaders) => readers(ampKeys(table));

// ZH's params per key are EN's, a plural's {n} included: the names of both of EN's forms together, as a set
function paramOffenders(table, en) {
  return strings(table).filter(([key]) => Object.hasOwn(en, key)).flatMap(([key, v]) => {
    const want = set(forms(en[key]).flatMap(params));
    const got = set(params(v));
    return want.join() === got.join() ? [] : [`${key}: ZH ${listOf(got)} vs EN ${listOf(want)}`];
  });
}

// a kept string out of a text (case-sensitive, never a piece of a longer word), longest first: `npm run desk` is one name
const keepByLength = keep => [...keep].sort((a, b) => b.length - a.length).map(k => new RegExp(`(?<![A-Za-z0-9])${quote(k)}(?![A-Za-z0-9])`, 'g'));
const without = (text, patterns, fill) => patterns.reduce((s, re) => s.replace(re, m => fill(m)), text);

// the Latin ZH holds that is no kept name, no {param} and no key name
function latinOffenders(table, glossary) {
  const patterns = keepByLength(glossary.keep);
  return strings(table).flatMap(([key, v]) => {
    const rest = without(v.replace(/\{\w+\}/g, ' '), patterns, () => ' ');
    return [...rest.matchAll(/[A-Za-z]{2,}/g)].map(m => m[0]).filter(w => !KEY_NAMES.has(w)).map(w => `${key}: Latin '${w}'`);
  });
}

// the terms an EN value holds: `en` at word edges, case-insensitive, with an optional plural s; a {param} is no word, a kept
// string holds no term (`npm run desk` is no desk), and a longer term takes its words from a shorter (standing order, not order)
const termPattern = en => new RegExp(`(?<![A-Za-z0-9])${quote(en)}s?(?![A-Za-z0-9])`, 'gi');
function termsIn(text, glossary) {
  let rest = without(text.replace(/\{\w+\}/g, '\u0002'), keepByLength(glossary.keep), m => '\u0001'.repeat(m.length));
  const found = [];
  for (const term of [...glossary.terms].sort((a, b) => b.en.length - a.en.length)) {
    if (!termPattern(term.en).test(rest)) continue;
    found.push(term);
    rest = rest.replace(termPattern(term.en), m => '\u0001'.repeat(m.length));
  }
  return found;
}

// for every term, every key ZH has whose EN value holds `en` has a ZH value holding `zh`, unless the term's except names the key
function heldOffenders(table, en, glossary) {
  return strings(table).filter(([key]) => Object.hasOwn(en, key)).flatMap(([key, v]) => termsIn(forms(en[key]).join('\n'), glossary)
    .filter(term => !Object.hasOwn(term.except ?? {}, key) && !v.includes(term.zh))
    .map(term => `${key}: no '${term.zh}' for ${term.en}`));
}

// a term is a word of Chinese; a name in keep is not
const keptTermOffenders = glossary => glossary.terms.filter(term => glossary.keep.includes(term.zh)).map(term => `${term.en}: zh '${term.zh}' is in keep`);

// an except that names a key EN lacks, or whose EN value no longer holds the term, is stale: drop it
function exceptOffenders(en, glossary) {
  return glossary.terms.flatMap(term => Object.keys(term.except ?? {}).flatMap(key => {
    if (!Object.hasOwn(en, key)) return [`${term.en}: except ${key}: not a key of EN`];
    return termsIn(forms(en[key]).join('\n'), glossary).includes(term) ? [] : [`${term.en}: except ${key}: its EN value does not hold the term`];
  }));
}

// the register: ASCII , : ? ! never between two Chinese characters; no 。 closing a value whose EN closes with no full stop;
// one space at a Chinese character's border with Latin, a digit or a {param}, none between two Chinese characters. Chinese is
// the Han script: a full-width mark is not, so a bracket or ，next to Latin takes no space
function punctuationOffenders(table, en) {
  const ascii = new RegExp(`${HAN}\\s*([,:?!])\\s*${HAN}`, 'u');
  const gap = new RegExp(`${HAN}\\s+${HAN}`, 'u');
  const borders = [['Latin', '[A-Za-z]'], ['a digit', '[0-9]'], ['a {param}', '[{}]']];
  return strings(table).flatMap(([key, v]) => {
    const out = [];
    const mark = v.match(ascii);
    if (mark) out.push(`${key}: ASCII "${mark[1]}" between Chinese characters`);
    if (v.trimEnd().endsWith('。') && Object.hasOwn(en, key) && !forms(en[key]).some(s => s.trimEnd().endsWith('.'))) out.push(`${key}: ends in 。 where EN has no full stop`);
    for (const [what, edge] of borders) {
      const touching = new RegExp(`${HAN}${edge}|${edge}${HAN}`, 'u');
      const hit = what === 'a {param}' ? new RegExp(`${HAN}\\{|\\}${HAN}`, 'u') : touching;
      if (hit.test(v)) out.push(`${key}: no space between a Chinese character and ${what}`);
    }
    if (gap.test(v)) out.push(`${key}: a space between two Chinese characters`);
    return out;
  });
}

// a term's en nothing uses is dropped
const usedOffenders = (en, glossary) => {
  const used = new Set(Object.values(en).flatMap(v => termsIn(forms(v).join('\n'), glossary)));
  return glossary.terms.filter(term => !used.has(term)).map(term => term.en);
};

// the register addresses the user as 你, never 您
const registerOffenders = table => strings(table).filter(([, v]) => v.includes('您')).map(([key]) => `${key}: 您, the register says 你`);

// what guardFirstDone and guardFirstRefused read: the sentence's end, of the trimmed words (sheet-view.js ENDED)
const ends = (s, marks) => marks.test(s.trim());
function guardEndOffenders(table, en, keys) {
  return keys.filter(key => typeof table[key] === 'string' && Object.hasOwn(en, key)).flatMap(key => {
    const zh = ends(table[key], /[.!?。！？]$/);
    const english = ends(forms(en[key]).at(-1), /[.!?]$/);
    if (zh === english) return [];
    return [`${key}: ${english ? 'EN ends a sentence, ZH does not' : 'ZH ends a sentence, EN does not'}`];
  });
}

// ── the keys whose value can end a Guard line ──

// guardFirstDone and guardFirstRefused (host/sheet-view.js) put the Account's words into `Not signed out: {words}{stop} Guard is
// on.` and `{said}{stop} Guard is on.`, and stopAfter reads their end (ENDED, `[.!?。！？]$`, on the trimmed words as they read
// now): a full stop follows words that end none, so a value ending in a sentence's end in one table and not in the other puts a
// stop where none is wanted, or none where one is. These are the keys whose value can be those words: host/sheet.js passes
// guardFirstDone saidOf(r.body) — `owner.done`, and an order's `owner.order.said` ({id} · {status}) ending in the status
// `owner.order.open|filled|canceled`, the Account's own summary being the Account's — and guardFirstRefused refusalOf(r).message
// — `owner.refused` when the Account gave none, `owner.notSigning` (host/owner.js submit, a page that does not sign) and
// `account.noAnswer` (host/owner.js postVia, no answer, through the Account's `error`) — and guardFirstRefused itself reads
// `sheet.guard.noAnswer` when the words are empty. host/app.js beforeSign's `sheet.signOut.refused` goes to the sheet whole,
// through neither.
const GUARD_ENDS = ['owner.done', 'owner.order.said', 'owner.order.open', 'owner.order.filled', 'owner.order.canceled', 'owner.refused',
  'owner.notSigning', 'account.noAnswer', 'sheet.guard.noAnswer'];

// ── the tests ──

const BAD = Object.freeze({ 'common.save': '保存', 'common.cancel': 'Cancel' });
const unfrozen = table => ({ ...table });
const bad = table => Object.freeze(table);

test('the glossary is well formed: a register, notes, terms with a zh and a note, a keep list', () => {
  assert.equal(typeof GLOSSARY.register, 'string');
  assert.ok(GLOSSARY.register.includes('你') && !/[^不]您/.test(GLOSSARY.register.replace('never 您', '')), 'the register says 你 and never 您');
  assert.ok(Array.isArray(GLOSSARY.notes) && GLOSSARY.notes.every(n => typeof n === 'string' && n));
  assert.ok(GLOSSARY.terms.length > 50);
  for (const term of GLOSSARY.terms) {
    assert.ok(typeof term.en === 'string' && term.en.trim() === term.en && term.en, `en: ${term.en}`);
    assert.match(term.zh, /\p{Script=Han}|…/u, `zh of ${term.en}`);
    assert.ok(typeof term.note === 'string' && term.note, `note of ${term.en}`);
    for (const [key, why] of Object.entries(term.except ?? {})) assert.ok(typeof why === 'string' && why, `${term.en} except ${key}: its reason`);
  }
  assert.equal(new Set(GLOSSARY.terms.map(t => t.en)).size, GLOSSARY.terms.length, 'one term per en');
  assert.ok(GLOSSARY.keep.every(k => typeof k === 'string' && k) && new Set(GLOSSARY.keep).size === GLOSSARY.keep.length);
  for (const name of ['Gravit', 'token']) assert.ok(GLOSSARY.keep.includes(name), name);
  for (const name of ['Account', 'Lunhui']) assert.ok(!GLOSSARY.keep.includes(name) && GLOSSARY.terms.some(t => t.en === name), `${name} is a term, not a kept name`);
});

test('ZH follows the grammar: frozen, keys in EN, values non-empty strings', () => {
  assert.deepEqual(grammarOffenders(ZH, EN), []);
  assert.deepEqual(grammarOffenders(unfrozen({ 'common.save': '保存' }), EN), ['table: not frozen']);
  assert.deepEqual(grammarOffenders(bad({ 'common.nope': '无' }), EN), ['common.nope: not a key of EN']);
  assert.deepEqual(grammarOffenders(bad({ 'common.save': '' }), EN), ['common.save: not a non-empty string']);
  assert.deepEqual(grammarOffenders(bad({ 'common.save': '   ' }), EN), ['common.save: not a non-empty string']);
  assert.deepEqual(grammarOffenders(bad({ 'common.save': 7 }), EN), ['common.save: not a non-empty string']);
  assert.deepEqual(grammarOffenders(bad({ 'time.ago.days': { one: '{n} 天前', other: '{n} 天前' } }), EN), ['time.ago.days: a plural object, ZH has one form']);
  assert.deepEqual(grammarOffenders(bad({ 'common.save': '保存', 'time.ago.days': '{n} 天前' }), EN), []);
  assert.ok(Object.keys(EN).every(k => KEY.test(k)), 'the grammar helper is the one EN is held to');
});

test('no ZH value holds <, > or ", nor an entity', () => {
  assert.deepEqual(markupOffenders(ZH), []);
  assert.deepEqual(markupOffenders(bad({ 'common.save': '<b>保存</b>' })), ['common.save: <, > or "']);
  assert.deepEqual(markupOffenders(bad({ 'common.save': '保存"好"' })), ['common.save: <, > or "']);
  assert.deepEqual(markupOffenders(bad({ 'common.save': '保存 &amp; 关闭' })), ['common.save: an entity']);
  assert.deepEqual(markupOffenders(bad({ 'common.save': '保存 &#38; 关闭' })), ['common.save: an entity']);
  assert.deepEqual(markupOffenders(bad({ 'account.pnl': '盈亏 P&L', 'common.save': '保存' })), [], 'an & that starts no entity is a word');
});

test('a ZH value holding & is read only by t or tn', () => {
  assert.deepEqual(ampOffenders(ZH), []);
  // EN's P&L is read by t; a table that put & into a key a th reads is found at the call site
  const readers = keys => keys.has('account.pnl') ? ["render/account.js:1 th('account.pnl')"] : [];
  assert.deepEqual(ampOffenders(bad({ 'account.pnl': '盈亏 & 亏损' }), readers), ["render/account.js:1 th('account.pnl')"]);
  assert.deepEqual(ampOffenders(bad({ 'account.pnl': '盈亏' }), readers), []);
  assert.deepEqual(ampOffenders(bad({ 'account.pnl': '盈亏 & 亏损' })), [], 'the real call sites read account.pnl with t');
  const real = ampOffenders(bad({ 'nav.markets': '市场 & 行情' }));
  assert.ok(real.length > 0 && real.every(site => site.endsWith("th('nav.markets')")), 'the scan reads the real call sites: th reads nav.markets');
  assert.ok(ampKeys(EN).has('account.pnl') && ampReaders(ampKeys(EN)).length === 0);
});

test('each ZH value carries exactly its EN key\'s params', () => {
  assert.deepEqual(paramOffenders(ZH, EN), []);
  assert.deepEqual(paramOffenders(bad({ 'time.date': '{day} {month}', 'time.dayClock': '{day} {clock}' }), EN), []);
  assert.deepEqual(paramOffenders(bad({ 'time.date': '{month} 月' }), EN), ['time.date: ZH {month} vs EN {day} {month}']);
  assert.deepEqual(paramOffenders(bad({ 'time.date': '{month} {day} {year}' }), EN), ['time.date: ZH {day} {month} {year} vs EN {day} {month}']);
  assert.deepEqual(paramOffenders(bad({ 'common.save': '保存 {n}' }), EN), ['common.save: ZH {n} vs EN none']);
  assert.deepEqual(paramOffenders(bad({ 'time.ago.days': '{n} 天前' }), EN), [], 'a plural: ZH carries {n}');
  assert.deepEqual(paramOffenders(bad({ 'time.ago.days': '前天' }), EN), ['time.ago.days: ZH none vs EN {n}']);
  assert.deepEqual(paramOffenders(bad({ 'time.date': '{day} {day} {month}' }), EN), [], 'a param twice is the same param');
});

test('ZH holds no Latin word but a kept name, a param or a key name', () => {
  assert.deepEqual(latinOffenders(ZH, GLOSSARY), []);
  const glossary = { keep: ['Gravit', 'ET', 'tok/s', 'Noto Sans SC', 'xoxb-', 'token'] };
  assert.deepEqual(latinOffenders(bad({ 'a.b': 'Gravit 正在运行 {n} tok/s，{name}' }), glossary), []);
  assert.deepEqual(latinOffenders(bad({ 'a.b': '打开 Noto Sans SC，粘贴 token（xoxb-…）' }), glossary), []);
  assert.deepEqual(latinOffenders(bad({ 'a.b': '按 Enter 或 Esc' }), glossary), [], 'a key name');
  assert.deepEqual(latinOffenders(bad({ 'a.b': '纽约时间 {from}–{to} ET' }), glossary), []);
  assert.deepEqual(latinOffenders(bad({ 'a.b': '已连接 Telegram' }), glossary), ["a.b: Latin 'Telegram'"]);
  assert.deepEqual(latinOffenders(bad({ 'a.b': '打开 gravit' }), glossary), ["a.b: Latin 'gravit'"], 'a kept name is case-sensitive');
  assert.deepEqual(latinOffenders(bad({ 'a.b': '共 {n} 个 ETH' }), glossary), ["a.b: Latin 'ETH'"], 'a kept name is not a piece of a longer word');
  assert.deepEqual(latinOffenders(bad({ 'a.b': '发送 Tokens' }), glossary), ["a.b: Latin 'Tokens'"]);
  assert.deepEqual(latinOffenders(bad({ 'a.b': '一个 URL 和一个 ID' }), glossary), ["a.b: Latin 'URL'", "a.b: Latin 'ID'"]);
  assert.deepEqual(latinOffenders(bad({ 'a.b': '读取 {name} 与 a、b、c' }), glossary), [], 'a param name and single letters are not words');
});

test('the glossary is held: a key whose EN holds a term has the term\'s zh, unless the term excepts the key', () => {
  assert.deepEqual(heldOffenders(ZH, EN, GLOSSARY), []);
  const glossary = {
    keep: ['npm run desk'],
    terms: [{ en: 'conversation', zh: '对话' }, { en: 'Account', zh: '账户' }, { en: 'standing order', zh: '常设指令' }, { en: 'order', zh: '订单' },
      { en: 'limit', zh: '额度', except: { 'account.orderType.limit': 'the order type' } }, { en: 'desk', zh: '值守台' }],
  };
  const en = { 'search.count': { one: '{n} conversation', other: '{n} conversations' }, 'nav.account': 'Account', 'desk.tab.standingOrders': 'Standing orders',
    'account.orders.title': 'Open orders', 'account.orderType.limit': 'limit', 'rules.limits': 'Limits', 'desk.off.line': 'desk: off (npm run desk -- resume)' };
  const ok = Object.freeze({ 'search.count': '{n} 个对话', 'nav.account': '账户', 'desk.tab.standingOrders': '常设指令', 'account.orders.title': '未成交订单',
    'account.orderType.limit': '限价', 'rules.limits': '额度', 'desk.off.line': '值守台：已暂停（npm run desk -- resume）' });
  assert.deepEqual(heldOffenders(ok, en, glossary), []);
  assert.deepEqual(heldOffenders(bad({ ...ok, 'search.count': '{n} 个会话' }), en, glossary), ["search.count: no '对话' for conversation"]);
  assert.deepEqual(heldOffenders(bad({ ...ok, 'nav.account': '帐号' }), en, glossary), ["nav.account: no '账户' for Account"]);
  assert.deepEqual(heldOffenders(bad({ ...ok, 'account.orders.title': '未成交单' }), en, glossary), ["account.orders.title: no '订单' for order"]);
  assert.deepEqual(heldOffenders(bad({ ...ok, 'rules.limits': '限价' }), en, glossary), ["rules.limits: no '额度' for limit"]);
  assert.deepEqual(heldOffenders(bad({ ...ok, 'desk.off.line': '已暂停（npm run desk -- resume）' }), en, glossary), ["desk.off.line: no '值守台' for desk"]);
  assert.deepEqual(heldOffenders(bad({ 'desk.arm': '输入 npm run desk -- arm' }), { 'desk.arm': 'Type npm run desk -- arm' }, glossary), [], 'a term inside a kept string is not the term');
  assert.deepEqual(heldOffenders(bad({ 'desk.tab.standingOrders': '订单' }), en, glossary), ["desk.tab.standingOrders: no '常设指令' for standing order"], 'the longer term masks the shorter');
  assert.deepEqual(heldOffenders(bad({ 'account.orderType.limit': '额度' }), en, glossary), [], 'an excepted key is not held to the term');
  assert.deepEqual(heldOffenders(bad({}), en, glossary), [], 'a key ZH lacks is not held');
});

test('no term\'s zh is in keep, and each term\'s except names a key whose EN holds the term', () => {
  assert.deepEqual(keptTermOffenders(GLOSSARY), []);
  assert.deepEqual(exceptOffenders(EN, GLOSSARY), []);
  assert.deepEqual(keptTermOffenders({ keep: ['Gravit', 'token', 'Account'], terms: [{ en: 'Account', zh: 'Account' }, { en: 'tokens', zh: 'token' }, { en: 'Run', zh: '运行' }] }), ['Account: zh \'Account\' is in keep', 'tokens: zh \'token\' is in keep']);
  const glossary = { keep: [], terms: [{ en: 'limit', zh: '额度', except: { 'account.orderType.limit': 'the order type', 'common.save': 'stale', 'common.gone': 'no such key' } }] };
  assert.deepEqual(exceptOffenders({ 'account.orderType.limit': 'limit', 'common.save': 'Save' }, glossary),
    ['limit: except common.save: its EN value does not hold the term', 'limit: except common.gone: not a key of EN']);
});

test('ZH\'s punctuation and spacing are the register\'s', () => {
  assert.deepEqual(punctuationOffenders(ZH, EN), []);
  const en = { 'a.b': 'Gravit is running', 'a.c': 'Gravit is running.', 'a.d': { one: '{n} task', other: '{n} tasks.' } };
  const ok = Object.freeze({ 'a.b': 'Gravit 正在运行', 'a.c': 'Gravit 正在运行。', 'a.d': '{n} 个任务' });
  assert.deepEqual(punctuationOffenders(ok, en), []);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '已连接，Telegram：已开启（ET）；打开 {name}…' }), en), [], 'full-width marks next to Latin take no space');
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '已连接, 请重试' }), en), ['a.b: ASCII "," between Chinese characters']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '已连接:请重试' }), en), ['a.b: ASCII ":" between Chinese characters']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '确定吗?请稍候' }), en), ['a.b: ASCII "?" between Chinese characters']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '好!请稍候' }), en), ['a.b: ASCII "!" between Chinese characters']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '已连接 Telegram: 正常' }), en), [], 'an ASCII mark after Latin is the register\'s');
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '正在运行。' }), en), ['a.b: ends in 。 where EN has no full stop']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.c': '正在运行。', 'a.d': '{n} 个任务。' }), en), [], 'EN ends in a full stop (a plural\'s either form)');
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': 'Gravit正在运行' }), en), ['a.b: no space between a Chinese character and Latin']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '正在运行Gravit' }), en), ['a.b: no space between a Chinese character and Latin']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '第3轮' }), en), ['a.b: no space between a Chinese character and a digit']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '3个任务' }), en), ['a.b: no space between a Chinese character and a digit']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '{n}个任务' }), en), ['a.b: no space between a Chinese character and a {param}']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '共{n}' }), en), ['a.b: no space between a Chinese character and a {param}']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '正在 运行' }), en), ['a.b: a space between two Chinese characters']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '第 3 轮，共 {n} 个' }), en), []);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '已连接（{name}）' }), en), [], 'a bracket is not Chinese script');
});

test('every glossary term is used: its en is in some EN value', () => {
  assert.deepEqual(usedOffenders(EN, GLOSSARY), []);
  const glossary = { keep: ['Bot User OAuth Token'], terms: [{ en: 'bot', zh: '机器人' }, { en: 'market order', zh: '市价单' }, { en: 'Account', zh: '账户' }, { en: 'order', zh: '订单' }, { en: 'standing order', zh: '常设指令' }] };
  assert.deepEqual(usedOffenders({ 'a.b': 'Bots in this room', 'a.c': 'Open orders', 'a.d': 'Account' }, glossary), ['market order', 'standing order']);
  assert.deepEqual(usedOffenders({ 'a.b': 'Paste the Bot User OAuth Token', 'a.c': 'Standing orders' }, glossary), ['bot', 'market order', 'Account', 'order'], 'a kept name holds no term; a longer term masks the shorter');
});

test('ZH never addresses the user as 您', () => {
  assert.deepEqual(registerOffenders(ZH), []);
  assert.deepEqual(registerOffenders(bad({ 'a.b': '请您重试', 'a.c': '请你重试' })), ['a.b: 您, the register says 你']);
});

test('the keys whose value can end a Guard line end a sentence in ZH exactly when they do in EN', () => {
  assert.deepEqual(guardEndOffenders(ZH, EN, GUARD_ENDS), []);
  assert.ok(GUARD_ENDS.every(k => Object.hasOwn(EN, k)), 'GUARD_ENDS names keys of EN');
  assert.ok(GUARD_ENDS.includes('sheet.guard.noAnswer') && GUARD_ENDS.includes('account.noAnswer'));
  // the end the face reads is the one in sheet-view.js stopAfter
  assert.match(readFileSync(join(ROOT, 'host/sheet-view.js'), 'utf8'), /const ENDED = \/\[\.!\?。！？\]\$\/;\nconst innerOf = [^\n]*\nconst stopAfter = words => \(ENDED\.test\(sayOf\(words\)\.trim\(\)\)/);
  // EN: account.noAnswer ends in a full stop, owner.done and sheet.guard.noAnswer end in none
  assert.deepEqual(GUARD_ENDS.filter(k => /[.!?]$/.test(EN[k].trim())), ['owner.notSigning', 'account.noAnswer']);
  const ok = Object.freeze({ 'account.noAnswer': '账户没有回应，请重试。', 'owner.done': '完成', 'sheet.guard.noAnswer': '账户没有回应' });
  assert.deepEqual(guardEndOffenders(ok, EN, GUARD_ENDS), []);
  assert.deepEqual(guardEndOffenders(bad({ ...ok, 'account.noAnswer': '账户没有回应，请重试' }), EN, GUARD_ENDS), ['account.noAnswer: EN ends a sentence, ZH does not']);
  assert.deepEqual(guardEndOffenders(bad({ ...ok, 'account.noAnswer': '账户没有回应，请重试！' }), EN, GUARD_ENDS), []);
  assert.deepEqual(guardEndOffenders(bad({ ...ok, 'account.noAnswer': '账户没有回应，请重试？ ' }), EN, GUARD_ENDS), [], 'the end is read trimmed, as stopAfter reads it');
  assert.deepEqual(guardEndOffenders(bad({ ...ok, 'owner.done': '完成。' }), EN, GUARD_ENDS), ['owner.done: ZH ends a sentence, EN does not']);
  assert.deepEqual(guardEndOffenders(bad({ ...ok, 'sheet.guard.noAnswer': '账户没有回应.' }), EN, GUARD_ENDS), ['sheet.guard.noAnswer: ZH ends a sentence, EN does not']);
  assert.deepEqual(guardEndOffenders(bad({ 'owner.order.said': '{id} · {status}。' }), EN, GUARD_ENDS), ['owner.order.said: ZH ends a sentence, EN does not']);
  assert.deepEqual(guardEndOffenders(bad({ 'common.save': '保存。' }), EN, GUARD_ENDS), [], 'a key outside the list is not read');
});
