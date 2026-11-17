// The words probe (plan 6, Task 10): the scanner reads the sources, the probe reads what the screens draw. Under a table whose
// every value is its English wrapped in ⟦…⟧, every state of the corpus is drawn; what is left once the ⟦…⟧ runs are cut —
// in the text and in the attributes a reader meets — must be words the corpus' own states and inputs hold (the operator's,
// gravit's, a venue's, a ticker), never the face's: a word the face draws from outside the table is reported.
// The known words come from the corpus' content fields only (helpers/screens.js corpusStrings), never from its codes, and
// from the literals the sources keep on screen on purpose (en-kept, the off-screen ones left out). An accepted limit: a word
// the fixtures' own prose happens to hold (closed, filled, Paper, in a venue's note or an Account sentence) is known, so the
// face drawing that same word from outside the table would pass; a sentinel test below holds the codes' words out. An ability's
// declared text (its blurb, its about's lines, its asks, its limits) and its parts' names (its tools', skills', rows' and roles')
// add no known word: a run drawn that is one of them whole passes as it is (helpers/screens.js abilityRuns), so a code word it
// holds (an ask about a trial that just failed, a row's tool) stays unknown.
process.env.TZ = 'America/New_York';
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { EN } = await import('../../client/js/i18n/en.js');
const { withTable } = await import('../../client/js/i18n/words.js');
const { corpus, corpusStrings, abilityRuns, everyState, NOW } = await import('./helpers/screens.js');
const { renderAccountScreen } = await import('../../client/js/render/account.js');
const { fmtDate } = await import('../../client/js/time.js');
const { CANDLE_RANGES } = await import('../../client/js/host/market-view.js');
const { keptLiterals, KEY_NAMES } = await import('./helpers/words-scan.js');
const { ZH } = await import('../../client/js/i18n/zh.js');
const { readFileSync, readdirSync } = await import('node:fs');
const { join } = await import('node:path');
const { fileURLToPath } = await import('node:url');

const ROOT = fileURLToPath(new URL('../../client/js/', import.meta.url));
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []);
// the literals the sources keep in place, each on a line marked en-kept (a provider's, a network's or a key's name)
const KEPT = walk(ROOT).filter(f => !f.endsWith('/i18n/en.js')).flatMap(f => keptLiterals(readFileSync(f, 'utf8'), f));

const wrap = v => `⟦${v}⟧`;
const PROBE = Object.freeze(Object.fromEntries(Object.entries(EN).map(([k, v]) => [k, typeof v === 'string' ? wrap(v) : { one: wrap(v.one), other: wrap(v.other) }])));

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = s => s.replace(/&(?:amp|lt|gt|quot|#39);/g, e => ENTITIES[e]);
const WORD = /[A-Za-z]{2,}/g;

// a text with its ⟦…⟧ runs cut (a run may hold another: a table word put into a table word), each run a space, so the words
// a table separator (common.list.sep) stands between stay two; and whether every ⟦ closed
function cut(text) {
  let depth = 0, out = '';
  for (const ch of text) {
    if (ch === '⟦') { if (depth === 0) out += ' '; depth += 1; }
    else if (ch === '⟧') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return { out, open: depth };
}

// what a reader meets in a page: its text, and the values of the attributes a reader or a screen reader meets (an input's or
// a button's value among them); the runs are cut before the tags go, so a table word holding markup (a rawHtml param) is cut
// whole
const READ = /\s(?:aria-label|aria-placeholder|aria-roledescription|aria-valuetext|title|placeholder|alt)="([^"]*)"/g;
function readable(html) {
  const { out, open } = cut(decode(html.replace(/<style[\s\S]*?<\/style>/g, '')));
  const parts = [];
  for (const m of out.matchAll(/<[^>]*>/g)) {
    for (const a of m[0].matchAll(READ)) parts.push(a[1]);
    if (/^<(?:input|button)\b/i.test(m[0]) && !/\stype="(?:checkbox|radio|hidden)"/.test(m[0])) for (const a of m[0].matchAll(/\svalue="([^"]*)"/g)) parts.push(a[1]);
  }
  parts.push(...out.replace(/<[^>]*>/g, '\n').split('\n'));
  return { parts: parts.filter(p => p.trim()), open };
}

const wordsOf = text => text.match(WORD) ?? [];
// a content string's words as the screens draw them: as they are, and for the fields a screen reshapes, as it reshapes them —
// a file name's extension upper-cased (composer/files.js extOf), the Account's whose with its first letter capitalized
// (render/account.js), a market's name, category or symbol cut to its first word's four letters (render/markets.js badge)
function drawnWords({ text, key }) {
  const plain = cut(text).out;
  const words = wordsOf(plain);
  if (key === 'name' || key === 'file' || key === 'path') { const ext = plain.match(/\.([A-Za-z0-9]+)$/)?.[1]; if (ext) words.push(ext.toUpperCase()); }
  if (key === 'whose') words.push(...wordsOf(plain).map(w => w[0].toUpperCase() + w.slice(1)));
  if (key === 'watch') words.push(...wordsOf(plain.slice(plain.lastIndexOf(':') + 1).slice(0, 4))); // a starred market's key: its symbol's badge
  if (key === 'name' || key === 'category' || key === 'symbol') { const badge = plain.trim().split(/\s+/)[0].slice(0, 4); words.push(...wordsOf(badge)); }
  return words;
}
const knownWords = () => new Set([...corpusStrings().flatMap(drawnWords), ...KEPT.flatMap(s => wordsOf(s))]);
// a run's words no known set holds: none when the run is, whole, one of an ability's declared lines (abilityRuns)
const strayWords = (p, known, runs) => (runs.has(p.trim()) ? [] : wordsOf(p).filter(w => !known.has(w)));

test('no English is drawn outside the table', () => {
  const { pages, known } = withTable(PROBE, () => ({
    pages: corpus(),
    known: knownWords(),
  }));
  const runs = abilityRuns();
  const report = [];
  for (const [name, html] of pages) {
    const { parts, open } = readable(html);
    if (open) report.push(`${name}: a ⟦ left open`);
    const stray = [...new Set(parts.flatMap(p => strayWords(p, known, runs).map(w => `${w} (in "${p.trim().slice(0, 60)}")`)))];
    for (const s of stray) report.push(`${name}: ${s}`);
  }
  assert.deepEqual(report, [], 'move these into client/js/i18n/en.js (a word the corpus holds as a code is no excuse: it is drawn as a word)');
});

// the probe's own check: the corpus holds these words as codes (a status, a screen, a phase, a run's state) or as the face's
// words, so the known set must not hold them — were it to, a screen drawing one from outside the table would pass. Three of
// them are also in the Account's own sentences in the fixtures (a venue's via `… · live · …` and watchOnly `Live · read-only`,
// `the public markets`): those may be known from that prose alone, never from a code (the header's accepted limit)
test('the known words hold no code word and no face word', () => {
  const contributors = withTable(PROBE, () => {
    const by = new Map();
    for (const entry of corpusStrings()) for (const w of drawnWords(entry)) by.set(w, (by.get(w) ?? new Set()).add(entry.key));
    for (const s of KEPT) for (const w of wordsOf(s)) by.set(w, (by.get(w) ?? new Set()).add('en-kept'));
    return by;
  });
  for (const w of ['failed', 'Failed', 'running', 'killed', 'Loading', 'Messages', 'Pending', 'Researching']) {
    assert.ok(!contributors.has(w), `${w} is not a known word (known from ${[...(contributors.get(w) ?? [])].join(', ')})`);
  }
  const ACCOUNT_PROSE = new Set(['via', 'watchOnly', 'what', 'label']);
  for (const w of ['live', 'Live', 'Markets']) {
    const from = [...(contributors.get(w) ?? [])];
    // the page tag's kept page names (host/page-tag.js) hold Markets as a code the router reads, never drawn as a word
    const kept = w === 'Markets' ? ['en-kept'] : [];
    assert.deepEqual(from.filter(k => !ACCOUNT_PROSE.has(k) && !kept.includes(k)), [], `${w} is known only from the Account's prose (known from ${from.join(', ')})`);
  }
});

// the event analog's shipped ask holds a code word (a trial that just failed): drawn whole it passes, and its words are known
// to no other run
test("an ability's declared line passes whole and lends its words to no other run", async () => {
  const { abilitiesListing } = await import('./helpers/inventory.js');
  const ask = abilitiesListing().abilities[0].asks.find(a => /\bfailed\b/.test(a));
  assert.ok(ask, 'a shipped ask holds failed');
  const known = withTable(PROBE, () => knownWords());
  const runs = abilityRuns();
  assert.ok(runs.has(ask));
  assert.deepEqual(strayWords(ask, known, runs), []);
  assert.deepEqual(strayWords(' failed ', known, runs), ['failed'], 'the word drawn alone is stray');
  assert.ok(strayWords(`${ask} Again`, known, runs).includes('failed'), 'a run that is no declared line whole is read word by word');
});

// an ability's blurb and its parts' names (its tools' and skills' names, its rows' and roles' ids) are declared too, each drawn
// whole: they pass as runs and lend no word, so a word only they hold (tool, views, rivals) drawn anywhere else is stray
test("an ability's blurb and its parts' names pass whole and lend no word", async () => {
  const { abilitiesListing } = await import('./helpers/inventory.js');
  const known = withTable(PROBE, () => knownWords());
  const runs = abilityRuns();
  for (const a of abilitiesListing().abilities) {
    const skills = a.skills.map(k => k.name);
    const declared = [a.blurb, a.zh.blurb, ...a.tools.map(x => x.name), ...skills, ...skills.map(k => `${k} ›`), ...a.rows.map(r => r.id), ...a.roles.map(r => r.id)];
    for (const run of declared) assert.ok(runs.has(run), `${run} is a run`);
  }
  for (const w of ['Under', 'bad', 'logic', 'past', 'points', 'rivals', 'analog', 'guide', 'reader', 'service', 'tool', 'views']) {
    assert.ok(!known.has(w), `${w} is not a known word`);
  }
  assert.deepEqual(strayWords('tool views', known, runs), ['tool', 'views'], 'the words drawn outside a declared run are stray');
});

test('a word table read after import follows the table (the Account tabs, the history ranges, the months)', () => {
  const st = everyState().find(s => s.route.screen === 'account' && s.account?.history);
  assert.ok(st, 'the corpus holds an Account state with its history');
  const html = withTable(PROBE, () => renderAccountScreen(st, NOW));
  for (const key of ['account.tab.portfolio', 'account.tab.money', 'account.tab.venues', 'account.tab.agents', 'account.tab.rules']) {
    assert.ok(html.includes(`>${PROBE[key]}<`), `the tab ${key} is drawn from the table`);
  }
  for (const key of ['account.range.day', 'account.range.week', 'account.range.month', 'account.range.all']) {
    assert.ok(html.includes(`>${PROBE[key]}<`), `the range ${key} is drawn from the table`);
  }
  const old = new Date(2026, 2, 3, 9, 0).getTime();
  assert.equal(withTable(PROBE, () => fmtDate(old)), PROBE['time.date'].replace('{month}', PROBE['time.month.mar']).replace('{day}', '3'), "a month and the date's order are the table's");
});

// a seg's value is a key the face reads (a theme, a tab, a range), never the word it draws: a word as the value would change
// with the table. The one exception is a value that is the Account's own code, drawn as it is in English (a history range)
test('no seg draws a label of the table as its value', () => {
  const words = new Set(Object.values(EN).filter(v => typeof v === 'string'));
  const ACCOUNT_CODES = new Set(CANDLE_RANGES);
  const bad = [];
  const langs = new Set();
  for (const [name, html] of corpus()) {
    for (const m of html.matchAll(/<button\b[^>]*class="seg-item[^"]*"[^>]*>([^<]*)<\/button>/g)) {
      const value = m[0].match(/data-value="([^"]*)"/)?.[1];
      const label = decode(m[1]);
      if (words.has(label) && decode(value ?? '') === label && !ACCOUNT_CODES.has(label)) bad.push(`${name}: ${label}`);
      if (/data-action="setLang"/.test(m[0])) langs.add(`${value}=${label}`);
    }
  }
  assert.deepEqual([...new Set(bad)], []);
  // the Language seg (plan 7 Task 9): its values the codes, its labels each language's own name
  assert.deepEqual([...langs].sort(), ['en=English', 'zh=中文']);
});

// the Chinese probe (plan 7 Task 10): under ZH every state of the corpus is drawn, and every Latin word a reader meets must be
// content (the corpus' own strings), a literal kept on purpose (en-kept), a name the glossary keeps, or a key's name — a word
// of the face's own English is reported (a code drawn raw inside a table word, a word left outside the table)
const GLOSSARY = JSON.parse(readFileSync(new URL('./fixtures/zh-glossary.json', import.meta.url), 'utf8'));
test('no English is drawn under ZH outside content', () => {
  const { pages, known } = withTable(ZH, () => ({ pages: corpus(), known: knownWords() }));
  for (const s of GLOSSARY.keep) for (const w of wordsOf(s)) known.add(w);
  for (const k of KEY_NAMES) known.add(k);
  const runs = abilityRuns();
  const report = [];
  for (const [name, html] of pages) {
    const { parts } = readable(html);
    const stray = [...new Set(parts.flatMap(p => strayWords(p, known, runs).map(w => `${w} (in "${p.trim().slice(0, 60)}")`)))];
    for (const s of stray) report.push(`${name}: ${s}`);
  }
  assert.deepEqual(report, [], 'word these through the table, in en.js and zh.js at once (a code worded by a key, an unknown one drawn as it came)');
});
