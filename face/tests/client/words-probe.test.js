// The words probe (plan 6, Task 10): the scanner reads the sources, the probe reads what the screens draw. Under a table whose
// every value is its English wrapped in ⟦…⟧, every state of the corpus is drawn; what is left once the ⟦…⟧ runs are cut —
// in the text and in the attributes a reader meets — must be words the corpus' own states and inputs hold (the operator's,
// Gravit's, a venue's, a ticker), never the face's: a word the face draws from outside the table is reported.
// The known words come from the corpus' content fields only (helpers/screens.js corpusStrings), never from its codes, and
// from the literals the sources keep on screen on purpose (en-kept, the off-screen ones left out). An accepted limit: a word
// the fixtures' own prose happens to hold (closed, filled, Paper, in a venue's note or an Account sentence) is known, so the
// face drawing that same word from outside the table would pass; a sentinel test below holds the codes' words out.
process.env.TZ = 'America/New_York';
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { EN } = await import('../../client/js/i18n/en.js');
const { withTable } = await import('../../client/js/i18n/words.js');
const { corpus, corpusStrings, everyState, NOW } = await import('./helpers/screens.js');
const { renderAccountScreen } = await import('../../client/js/render/account.js');
const { fmtDate } = await import('../../client/js/time.js');
const { CANDLE_RANGES } = await import('../../client/js/host/market-view.js');
const { keptLiterals } = await import('./helpers/words-scan.js');
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

// a text with its ⟦…⟧ runs cut (a run may hold another: a table word put into a table word), and whether every ⟦ closed
function cut(text) {
  let depth = 0, out = '';
  for (const ch of text) {
    if (ch === '⟦') depth += 1;
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

test('no English is drawn outside the table', () => {
  const { pages, known } = withTable(PROBE, () => ({
    pages: corpus(),
    known: knownWords(),
  }));
  const report = [];
  for (const [name, html] of pages) {
    const { parts, open } = readable(html);
    if (open) report.push(`${name}: a ⟦ left open`);
    const stray = [...new Set(parts.flatMap(p => wordsOf(p).filter(w => !known.has(w)).map(w => `${w} (in "${p.trim().slice(0, 60)}")`)))];
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
    assert.deepEqual(from.filter(k => !ACCOUNT_PROSE.has(k)), [], `${w} is known only from the Account's prose (known from ${from.join(', ')})`);
  }
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
  for (const [name, html] of corpus()) {
    for (const m of html.matchAll(/<button\b[^>]*class="seg-item[^"]*"[^>]*>([^<]*)<\/button>/g)) {
      const value = m[0].match(/data-value="([^"]*)"/)?.[1];
      const label = decode(m[1]);
      if (words.has(label) && decode(value ?? '') === label && !ACCOUNT_CODES.has(label)) bad.push(`${name}: ${label}`);
    }
  }
  assert.deepEqual([...new Set(bad)], []);
});
