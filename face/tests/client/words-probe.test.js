// The words probe (plan 6, Task 10): the scanner reads the sources, the probe reads what the screens draw. Under a table whose
// every value is its English wrapped in ⟦…⟧, every state of the corpus is drawn; what is left once the ⟦…⟧ runs are cut —
// in the text and in the attributes a reader meets — must be words the corpus' own states and inputs hold (the operator's,
// Gravit's, a venue's, a ticker), never the face's: a word the face draws from outside the table is reported.
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

// what a reader meets in a page: its text, and the values of aria-label, title, placeholder and alt; the runs are cut before
// the tags go, so a table word holding markup (a rawHtml param) is cut whole
function readable(html) {
  const { out, open } = cut(decode(html.replace(/<style[\s\S]*?<\/style>/g, '')));
  const parts = [];
  for (const m of out.matchAll(/<[^>]*>/g)) for (const a of m[0].matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"]*)"/g)) parts.push(a[1]);
  parts.push(...out.replace(/<[^>]*>/g, '\n').split('\n'));
  return { parts: parts.filter(p => p.trim()), open };
}

const wordsOf = text => text.match(WORD) ?? [];
// a data word as the screens may draw it: as it is, upper-cased (a file's extension), its first letter capitalized (the
// Account's whose), its first four letters (a market's badge)
const drawnAs = w => [w, w.toUpperCase(), w[0].toUpperCase() + w.slice(1), ...(w.length > 4 ? [w.slice(0, 4)] : [])];

test('no English is drawn outside the table', () => {
  const { pages, known } = withTable(PROBE, () => ({
    pages: corpus(),
    known: new Set([...corpusStrings(), ...KEPT].flatMap(s => wordsOf(cut(s).out)).flatMap(drawnAs)),
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
  assert.equal(withTable(PROBE, () => fmtDate(old)), `${PROBE['time.month.mar']} 3`, "a month is the table's");
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
