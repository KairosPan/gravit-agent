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

// the Latin ZH holds that is no kept name and no {param}. There is no key-name allowance: EN's values draw `Ctrl` only (kept by
// name) and use Delete, End and Home as plain words, so a ZH value holding one of them is English left in
function latinOffenders(table, glossary) {
  const patterns = keepByLength(glossary.keep);
  return strings(table).flatMap(([key, v]) => {
    const rest = without(v.replace(/\{\w+\}/g, ' '), patterns, () => ' ');
    return [...rest.matchAll(/[A-Za-z]{2,}/g)].map(m => m[0]).map(w => `${key}: Latin '${w}'`);
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

// an except of a term is `{ why, zh }` (the key reads another sense, and its value holds that word instead) or a plain reason
// (another sense with no one word); either way the term's own zh is not wanted there
const exceptOf = (term, key) => {
  const ex = term.except?.[key];
  return ex === undefined ? null : typeof ex === 'string' ? { why: ex } : ex;
};

// for every term, every key ZH has whose EN value holds `en` has a ZH value holding `zh`, unless the term's except names the key:
// then the value holds the word the except names, if it names one
function heldOffenders(table, en, glossary) {
  return strings(table).filter(([key]) => Object.hasOwn(en, key)).flatMap(([key, v]) => termsIn(forms(en[key]).join('\n'), glossary).flatMap(term => {
    const ex = exceptOf(term, key);
    if (!ex) return v.includes(term.zh) ? [] : [`${key}: no '${term.zh}' for ${term.en}`];
    return !ex.zh || v.includes(ex.zh) ? [] : [`${key}: no '${ex.zh}' for ${term.en} (${ex.why})`];
  }));
}

// a term is a word of Chinese; a name in keep is not
const keptTermOffenders = glossary => glossary.terms.filter(term => glossary.keep.includes(term.zh)).map(term => `${term.en}: zh '${term.zh}' is in keep`);

// an except that names a key EN lacks, or whose EN value no longer holds the term, is stale: drop it; one has a reason, and a
// word it names is Chinese and not the term's own
function exceptOffenders(en, glossary) {
  return glossary.terms.flatMap(term => Object.keys(term.except ?? {}).flatMap(key => {
    const at = `${term.en}: except ${key}`;
    if (!Object.hasOwn(en, key)) return [`${at}: not a key of EN`];
    const ex = exceptOf(term, key);
    if (typeof ex.why !== 'string' || !ex.why) return [`${at}: no reason`];
    if (ex.zh !== undefined && !/\p{Script=Han}/u.test(ex.zh)) return [`${at}: zh is no Chinese`];
    if (ex.zh === term.zh) return [`${at}: zh is the term's own`];
    return termsIn(forms(en[key]).join('\n'), glossary).includes(term) ? [] : [`${at}: its EN value does not hold the term`];
  }));
}

// the register. Chinese is the Han script; a full-width mark is not Han. Exactly:
//  - ASCII , : ? ! (a ! that starts a word is a command's, a . that ends a sentence) after a Han character, a space between allowed, anywhere in the value: refused.
//    After Latin, a digit or a } they are the register's (`Telegram: 正常`, `{why}: 请重试`);
//  - ASCII ( ) ; and ... (a ; is judged here only) on either side of a Han character, a space between allowed: refused; … is the register's;
//  - an ASCII space beside a full-width mark: refused (`已连接 ，Telegram`);
//  - 。 closing a value whose EN closes with no full stop: refused;
//  - a Han character touching an ASCII run with no space — Latin, a digit, a {param}, or any other ASCII graphic (a path, a
//    command, a flag, a %: `~/.dsh`, `/newbot`, `!status`, `{n}%`) — refused, and two Han characters with a space between them;
//    an ASCII mark is judged by the first two rules where they apply (`中.yml` is left as it is);
//  - two spaces anywhere, and a visual separator between two Han characters spaced on one side only. One space on each side of
//    one (`账户 › 卡片`, `买入 / 卖出`) is the register's where EN spaces it: the two-Han rule is for adjacent Han only.
const FULL_WIDTH = '，、。：；？！（）「」『』《》【】“”‘’';
const SEPARATORS = '·›—–|/→×';
function punctuationOffenders(table, en) {
  const after = new RegExp(`${HAN}\\s*([,:?]|!(?![A-Za-z0-9])|\\.(?![A-Za-z0-9.]))`, 'u');
  const beside = new RegExp(`${HAN}\\s*(\\.\\.\\.|[();])|(\\.\\.\\.|[();])\\s*${HAN}`, 'u');
  const spaced = new RegExp(`[ \\t][${FULL_WIDTH}]|[${FULL_WIDTH}][ \\t]`, 'u');
  const gap = new RegExp(`${HAN}\\s+${HAN}`, 'u');
  const lopsided = new RegExp(`${HAN}[ \\t][${SEPARATORS}]${HAN}|${HAN}[${SEPARATORS}][ \\t]${HAN}`, 'u');
  const OTHER = '[\\x21-\\x7e]';
  const borders = [['Latin', `${HAN}[A-Za-z]|[A-Za-z]${HAN}`], ['a digit', `${HAN}[0-9]|[0-9]${HAN}`], ['a {param}', `${HAN}\\{|\\}${HAN}`],
    // a Han character followed by any other ASCII graphic that is no mark of the first two rules; or such a graphic before one that
    // is not itself after a Han character (that is the first rule's)
    ['ASCII text', `${HAN}(?![A-Za-z0-9{,:?.()\\s;]|!(?![A-Za-z0-9]))${OTHER}|(?<![\\p{Script=Han}\\s])(?![A-Za-z0-9{}();.])${OTHER}${HAN}`]];
  return strings(table).flatMap(([key, v]) => {
    const out = [];
    const mark = v.match(after);
    if (mark) out.push(`${key}: ASCII "${mark[1]}" after a Chinese character`);
    const next = v.match(beside);
    if (next) out.push(`${key}: ASCII "${next[1] ?? next[2]}" next to a Chinese character`);
    // a Chinese date writes its units unspaced (time.date): `{month}月{day}日` is read here as one {param}, so it still takes its
    // space from the Chinese around it. A Guard line's {stop} (sheet.guard.done|refused), which follows another {param}, is sheet.guard.stop, 。 or nothing
    // after words that end in one (stopAfter): it is read as the 。 it is, so the sentence after it takes no space
    const dated = v.replace(/\{month\}月\{day\}日/g, '{date}').replace(/\}\{stop\}/g, '}。');
    if (spaced.test(dated)) out.push(`${key}: a space beside a full-width mark`);
    if (/[ \t]{2}/.test(v)) out.push(`${key}: two spaces`);
    if (lopsided.test(v)) out.push(`${key}: a separator between Chinese characters spaced on one side`);
    if (v.trimEnd().endsWith('。') && Object.hasOwn(en, key) && !forms(en[key]).some(s => s.trimEnd().endsWith('.'))) out.push(`${key}: ends in 。 where EN has no full stop`);
    for (const [what, pattern] of borders) if (new RegExp(pattern, 'u').test(dated)) out.push(`${key}: no space between a Chinese character and ${what}`);
    if (gap.test(dated)) out.push(`${key}: a space between two Chinese characters`);
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

// sheet.guard.stop is the full stop Guard's lines put after words that end none (sheet-view.js stopAfter): `。` in ZH, which is
// what a Chinese sentence ends in, and which stopAfter's ENDED then reads as ended
const guardStopOffenders = table => (typeof table['sheet.guard.stop'] === 'string' && table['sheet.guard.stop'] !== '。' ? [`sheet.guard.stop: '${table['sheet.guard.stop']}', not 。`] : []);

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

// every EN key has a ZH value (D35), but in an area a later batch of Task 8 writes; and every such area still lacks one, so the
// list cannot outlive its batch. Each batch removes its areas; the last deletes the list
const PENDING_AREAS = ['account', 'money', 'venues', 'agents', 'cards', 'rules', 'identity', 'markets', 'trade', 'desk', 'discover', 'channel', 'modules', 'runSheet', 'lunhui'];
const areaOf = key => key.split('.')[0];
function completeOffenders(table, en, pending) {
  const keys = Object.keys(en);
  const missing = keys.filter(key => !pending.includes(areaOf(key)) && typeof table[key] !== 'string').map(key => `${key}: no ZH value`);
  const done = pending.filter(area => keys.filter(key => areaOf(key) === area).every(key => typeof table[key] === 'string')).map(area => `${area}: pending, but every key has a ZH value`);
  return [...missing, ...done];
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
    for (const [key, ex] of Object.entries(term.except ?? {})) {
      const why = typeof ex === 'string' ? ex : ex?.why;
      assert.ok(typeof why === 'string' && why, `${term.en} except ${key}: its reason`);
      if (typeof ex !== 'string') assert.match(ex.zh, /\p{Script=Han}/u, `${term.en} except ${key}: the word it holds instead`);
    }
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

test('ZH holds no Latin word but a kept name or a param', () => {
  assert.deepEqual(latinOffenders(ZH, GLOSSARY), []);
  const glossary = { keep: ['Gravit', 'ET', 'tok/s', 'Noto Sans SC', 'xoxb-', 'token'] };
  assert.deepEqual(latinOffenders(bad({ 'a.b': 'Gravit 正在运行 {n} tok/s，{name}' }), glossary), []);
  assert.deepEqual(latinOffenders(bad({ 'a.b': '打开 Noto Sans SC，粘贴 token（xoxb-…）' }), glossary), []);
  // no English key name or word passes for a key: EN draws none of Enter, Esc... in its values, and Delete, End, Home are words
  assert.deepEqual(latinOffenders(bad({ 'a.b': '按 Enter 或 Esc' }), glossary), ["a.b: Latin 'Enter'", "a.b: Latin 'Esc'"]);
  assert.deepEqual(latinOffenders(bad({ 'details.delete': '删除 Delete' }), glossary), ["details.delete: Latin 'Delete'"]);
  assert.deepEqual(latinOffenders(bad({ 'agents.endLimit': 'End 额度…' }), glossary), ["agents.endLimit: Latin 'End'"]);
  assert.deepEqual(latinOffenders(bad({ 'discover.key.home': 'Home' }), glossary), ["discover.key.home: Latin 'Home'"]);
  assert.deepEqual(latinOffenders(bad({ 'shortcuts.note': '⌘ 是 Ctrl' }), { keep: ['Ctrl'] }), [], 'Ctrl is in EN\'s values, so it is kept by name');
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
      { en: 'limit', zh: '额度', except: { 'account.orderType.limit': { why: 'the order type', zh: '限价' }, 'rules.noWord': 'a sense with no single word' } }, { en: 'desk', zh: '值守台' }],
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
  assert.deepEqual(heldOffenders(bad({ 'account.orderType.limit': '额度' }), en, glossary), ["account.orderType.limit: no '限价' for limit (the order type)"], 'an excepted key is held to the word the except names');
  assert.deepEqual(heldOffenders(bad({ 'account.orderType.limit': '限价' }), en, glossary), [], 'and not to the term');
  assert.deepEqual(heldOffenders(bad({ 'account.orderType.limit': '额度' }), { 'account.orderType.limit': 'limit' }, { ...glossary, terms: [{ en: 'limit', zh: '额度', except: { 'account.orderType.limit': 'a plain reason' } }] }), [], 'a plain reason names no word');
  assert.deepEqual(heldOffenders(bad({}), en, glossary), [], 'a key ZH lacks is not held');
});

test('no term\'s zh is in keep, and each term\'s except names a key whose EN holds the term', () => {
  assert.deepEqual(keptTermOffenders(GLOSSARY), []);
  assert.deepEqual(exceptOffenders(EN, GLOSSARY), []);
  assert.deepEqual(keptTermOffenders({ keep: ['Gravit', 'token', 'Account'], terms: [{ en: 'Account', zh: 'Account' }, { en: 'tokens', zh: 'token' }, { en: 'Run', zh: '运行' }] }), ['Account: zh \'Account\' is in keep', 'tokens: zh \'token\' is in keep']);
  const glossary = { keep: [], terms: [{ en: 'limit', zh: '额度', except: { 'account.orderType.limit': { why: 'the order type', zh: '限价' }, 'common.save': 'stale', 'common.gone': 'no such key' } }] };
  assert.deepEqual(exceptOffenders({ 'account.orderType.limit': 'limit', 'common.save': 'Save' }, glossary),
    ['limit: except common.save: its EN value does not hold the term', 'limit: except common.gone: not a key of EN']);
  const shaped = except => exceptOffenders({ 'account.orderType.limit': 'limit' }, { keep: [], terms: [{ en: 'limit', zh: '额度', except }] });
  assert.deepEqual(shaped({ 'account.orderType.limit': { why: 'r', zh: '限价' } }), []);
  assert.deepEqual(shaped({ 'account.orderType.limit': { why: '', zh: '限价' } }), ['limit: except account.orderType.limit: no reason']);
  assert.deepEqual(shaped({ 'account.orderType.limit': { why: 'r', zh: 'limit' } }), ['limit: except account.orderType.limit: zh is no Chinese']);
  assert.deepEqual(shaped({ 'account.orderType.limit': { why: 'r', zh: '额度' } }), ['limit: except account.orderType.limit: zh is the term\'s own']);
  assert.deepEqual(shaped({ 'account.orderType.limit': { zh: '限价' } }), ['limit: except account.orderType.limit: no reason']);
  assert.deepEqual(shaped({ 'account.orderType.limit': '' }), ['limit: except account.orderType.limit: no reason']);
});

test('ZH\'s punctuation and spacing are the register\'s', () => {
  assert.deepEqual(punctuationOffenders(ZH, EN), []);
  const en = { 'a.b': 'Gravit is running', 'a.c': 'Gravit is running.', 'a.d': { one: '{n} task', other: '{n} tasks.' } };
  const ok = Object.freeze({ 'a.b': 'Gravit 正在运行', 'a.c': 'Gravit 正在运行。', 'a.d': '{n} 个任务' });
  assert.deepEqual(punctuationOffenders(ok, en), []);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '已连接，Telegram：已开启（ET）；打开 {name}…' }), en), [], 'full-width marks next to Latin take no space');
  // ASCII , : ? ! after a Chinese character (a space between allowed), wherever in the value: Chinese marks are full-width
  const after = (value, mark) => assert.deepEqual(punctuationOffenders(bad({ 'a.b': value }), en), [`a.b: ASCII "${mark}" after a Chinese character`], value);
  after('已连接, 请重试', ',');
  after('已连接:请重试', ':');
  after('确定吗?请稍候', '?');
  after('好!请稍候', '!');
  after('无法读取: {why}', ':');
  after('未退出登录: {words}', ':');
  after('名称:', ':');
  after('确定吗?', '?');
  after('已连接: Telegram', ':');
  after('已连接 : Telegram', ':');
  // after Latin, a digit or a } an ASCII mark is the register's (ASCII around Latin and numbers), and takes its space after it
  for (const ok of ['已连接 Telegram: 正常', '共 {n}: 正常', '轮 3: 已完成', '{why}: 请重试', '是 Telegram?', '已连接 Telegram, 正常'])
    assert.deepEqual(punctuationOffenders(bad({ 'a.b': ok }), en), [], ok);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '已连接 Telegram:正常' }), en), ['a.b: no space between a Chinese character and ASCII text'], 'an ASCII mark after Latin takes its space before Chinese');
  // ASCII ( ) ; and ... next to Chinese, on either side, are refused; … is the register's
  const beside = (value, mark) => assert.deepEqual(punctuationOffenders(bad({ 'a.b': value }), en), [`a.b: ASCII "${mark}" next to a Chinese character`], value);
  beside('已连接(Telegram)', '(');
  beside('(Telegram) 已连接', ')');
  beside('Telegram; 已连接', ';');
  beside('请先登录; 然后重试', ';');
  beside('加载中...', '...');
  beside('...已连接', '...');
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '加载中…' }), en), []);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '已连接 Telegram (ET)' }), en), [], 'brackets between Latin and a number only');
  // a space beside a full-width mark is refused, in front, behind, inside a pair
  const spaced = value => assert.deepEqual(punctuationOffenders(bad({ 'a.b': value }), en), ['a.b: a space beside a full-width mark'], value);
  spaced('已连接 ，Telegram');
  spaced('已连接， Telegram');
  spaced('已连接（ Telegram）');
  spaced('已连接（Telegram ）');
  spaced('已连接：Telegram ；已开启');
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '已连接（Telegram），已开启：{n} 个' }), en), []);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '正在运行。' }), en), ['a.b: ends in 。 where EN has no full stop']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.c': '正在运行。', 'a.d': '{n} 个任务。' }), en), [], 'EN ends in a full stop (a plural\'s either form)');
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': 'Gravit正在运行' }), en), ['a.b: no space between a Chinese character and Latin']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '正在运行Gravit' }), en), ['a.b: no space between a Chinese character and Latin']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '第3轮' }), en), ['a.b: no space between a Chinese character and a digit']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '3个任务' }), en), ['a.b: no space between a Chinese character and a digit']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '{n}个任务' }), en), ['a.b: no space between a Chinese character and a {param}']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '共{n}' }), en), ['a.b: no space between a Chinese character and a {param}']);
  // decision: time.date's month and day take their units unspaced, as a Chinese date is written; that one shape only, and it
  // borders what is around it as a {param} does
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '{month}月{day}日' }), en), []);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '截至 {month}月{day}日 收盘' }), en), []);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '截至{month}月{day}日' }), en), ['a.b: no space between a Chinese character and a {param}']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '{month}月' }), en), ['a.b: no space between a Chinese character and a {param}']);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '{n}月{day}日' }), en), ['a.b: no space between a Chinese character and a {param}']);
  // decision: a Guard line's {stop} is a full stop (sheet.guard.stop, 。), so the Chinese after it takes no space
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '{said}{stop}守卫已开启' }), en), []);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '未退出登录：{words}{stop}守卫已开启' }), en), []);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '{said}{stop} 守卫已开启' }), en), ['a.b: a space beside a full-width mark']);
  // a {stop} that follows no {param} is a price (thread.seat.stopLimit), no full stop: it is read as a {param}
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '止损 {stop} 限价 {limit}' }), en), []);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '{said}守卫已开启' }), en), ['a.b: no space between a Chinese character and a {param}']);
  // an ASCII run that is no letter, digit or {param} at its edge — a path, a command, a flag, a percent — is as much a run
  const other = value => assert.deepEqual(punctuationOffenders(bad({ 'a.b': value }), en), ['a.b: no space between a Chinese character and ASCII text'], value);
  other('打开~/.dsh');
  other('输入/newbot 发送');
  other('占 {n}%的任务');
  other('版本-1');
  // decision: a ! that starts a word (a command: !status) is no mark, so it is a run like ~/ or /: it takes its space
  other('输入!status 命令');
  after('输入!', '!');
  after('输入! status', '!');
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '打开 ~/.dsh 目录' }), en), []);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '输入 /newbot 发送，或 !status' }), en), []);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '占 {n}% 的任务' }), en), []);
  assert.deepEqual(punctuationOffenders(bad({ 'a.b': '正在 运行' }), en), ['a.b: a space between two Chinese characters']);
  // a visual separator between Chinese words takes one space on each side, as EN spaces it: the two-Han rule is for adjacent Han
  for (const ok of ['账户 › 卡片', '账户 · 钱包', '买入 / 卖出', '已生成卡片 · {id} · 请在账户 › 卡片中处理', '平仓 — 全部', '1 – 3 天', '买入 | 卖出', '买 → 卖', '2 × 3'])
    assert.deepEqual(punctuationOffenders(bad({ 'a.b': ok }), en), [], ok);
  for (const [value, why] of [['账户  ›  卡片', 'two spaces'], ['账户 ›  卡片', 'two spaces'], ['账户 ›卡片', 'a separator between Chinese characters spaced on one side'],
    ['买入 /卖出', 'a separator between Chinese characters spaced on one side'], ['账户 › ，卡片', 'a space beside a full-width mark'],
    ['账户 卡片', 'a space between two Chinese characters'], ['共 {n}  个', 'two spaces']])
    assert.deepEqual(punctuationOffenders(bad({ 'a.b': value }), en), [`a.b: ${why}`], value);
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

test('sheet.guard.stop, the stop after words that end none, is 。 in ZH', () => {
  assert.deepEqual(guardStopOffenders(ZH), []);
  assert.deepEqual(guardStopOffenders(bad({ 'sheet.guard.stop': '。' })), []);
  assert.deepEqual(guardStopOffenders(bad({ 'sheet.guard.stop': '.' })), ["sheet.guard.stop: '.', not 。"]);
  assert.deepEqual(guardStopOffenders(bad({ 'sheet.guard.stop': '。 ' })), ["sheet.guard.stop: '。 ', not 。"]);
  assert.deepEqual(guardStopOffenders(bad({ 'common.save': '保存' })), [], 'a table without the key reads it from EN');
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

test('every EN key has a ZH value', () => {
  assert.deepEqual(completeOffenders(ZH, EN, PENDING_AREAS), []);
  assert.ok(PENDING_AREAS.every(area => Object.keys(EN).some(key => areaOf(key) === area)), 'PENDING_AREAS names areas of EN');
  const en = { 'a.b': 'Save', 'a.c': 'Cancel', 'd.e': 'Open', 'f.g': 'Close' };
  assert.deepEqual(completeOffenders(bad({ 'a.b': '保存', 'a.c': '取消', 'd.e': '打开' }), en, ['f']), []);
  assert.deepEqual(completeOffenders(bad({ 'a.b': '保存', 'd.e': '打开' }), en, ['f']), ['a.c: no ZH value']);
  assert.deepEqual(completeOffenders(bad({ 'a.b': '保存', 'a.c': '取消', 'd.e': '打开', 'f.g': '关闭' }), en, ['f']), ['f: pending, but every key has a ZH value']);
});
