// The 中文 review dump (plan 7 Task 11) — a script, not a test:
//   npx tsx tests/client/zh-review.js --out <dir>
// writes <dir>/zh-review.tsv (key, en, zh, states, fix — one row per EN key in en.js's order, the fix column empty for the
// operator; a tab, a newline and a backslash in a cell written \t, \n and \\), <dir>/zh-review.html (the glossary, then a
// section per area, each key with its English, its Chinese and the corpus states that draw it) and <dir>/states/<name>.zh.html
// and .en.html (each state drawn under each table, styled by the face's own CSS). A key's states are found by drawing the
// corpus under a marker table: each value ⟦<index>⟧ followed by its params, so a table word put into another is found too.
process.env.TZ = 'America/New_York';
const { writeFileSync, mkdirSync, readFileSync } = await import('node:fs');
const { join, resolve } = await import('node:path');
const { fileURLToPath, pathToFileURL } = await import('node:url');
const { EN } = await import('../../client/js/i18n/en.js');
const { ZH } = await import('../../client/js/i18n/zh.js');
const { setTable } = await import('../../client/js/i18n/words.js');
const { goldenEntries } = await import('./helpers/screens.js');
const { AREAS, params, forms } = await import('./helpers/words-table.js');

const KEYS = Object.keys(EN);
const GLOSSARY = JSON.parse(readFileSync(new URL('./fixtures/zh-glossary.json', import.meta.url), 'utf8'));
const CSS = ['tokens.css', 'app.css'].map(f => pathToFileURL(fileURLToPath(new URL(`../../client/css/${f}`, import.meta.url))).href);

const markerTable = () => Object.freeze(Object.fromEntries(KEYS.map((key, i) =>
  [key, [`⟦${i}⟧`, ...[...new Set(forms(EN[key]).flatMap(params))].map(p => `{${p}}`)].join(' ')])));

// the corpus drawn under a table, the table set for the whole read (the host corpus awaits) and EN after
async function entriesUnder(table) {
  setTable(table);
  try {
    return await goldenEntries();
  } finally {
    setTable(EN);
  }
}

const enOf = v => (typeof v === 'string' ? v : `${v.one} | ${v.other}`);

/** One row per EN key, in en.js's order: { key, en, zh, states } — states the corpus names whose page draws the key. */
export async function reviewRows() {
  const by = KEYS.map(() => []);
  for (const [name, html] of await entriesUnder(markerTable())) {
    for (const i of new Set([...html.matchAll(/⟦(\d+)⟧/g)].map(m => Number(m[1])))) by[i].push(name);
  }
  return KEYS.map((key, i) => ({ key, en: enOf(EN[key]), zh: typeof ZH[key] === 'string' ? ZH[key] : '', states: by[i] }));
}

export const encodeCell = v => String(v).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n');
export const decodeCell = v => String(v).replace(/\\(\\|t|n)/g, (_, c) => (c === 't' ? '\t' : c === 'n' ? '\n' : '\\'));

const HEADER = ['key', 'en', 'zh', 'states', 'fix'];
export const tsvOf = rows => [HEADER.join('\t'), ...rows.map(r =>
  [r.key, r.en, r.zh, r.states.length ? r.states.join(' ') : '—', r.fix ?? ''].map(encodeCell).join('\t'))].join('\n') + '\n';

/** The TSV back as rows: { key, en, zh, states, fix }, every cell decoded; a row of another width stops the read. */
export function parseTsv(text) {
  const lines = String(text).split('\n').filter(l => l !== '');
  if (lines[0] !== HEADER.join('\t')) throw new Error(`not a review TSV: the header is not ${HEADER.join(' | ')}`);
  return lines.slice(1).map((line, i) => {
    const cells = line.split('\t');
    if (cells.length !== HEADER.length) throw new Error(`row ${i + 2}: ${cells.length} cells, not ${HEADER.length}`);
    const [key, en, zh, states, fix] = cells.map(decodeCell);
    return { key, en, zh, states: states === '—' || states === '' ? [] : states.split(' '), fix };
  });
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const STATES_SHOWN = 6;
const stateLinks = states => states.slice(0, STATES_SHOWN).map(n => `<a href="states/${esc(n)}.zh.html">${esc(n)}</a> <a class="en" href="states/${esc(n)}.en.html">en</a>`).join(' · ')
  + (states.length > STATES_SHOWN ? ` · +${states.length - STATES_SHOWN}` : '') || '<span class="none">— host code only</span>';

function reviewHtml(rows) {
  const glossary = `<section><h2>Glossary</h2><p class="lead">${esc(GLOSSARY.register)}</p><table><thead><tr><th>en</th><th>zh</th><th>note</th></tr></thead><tbody>` +
    GLOSSARY.terms.map(t => `<tr><td>${esc(t.en)}</td><td class="zh">${esc(t.zh)}</td><td>${esc(t.note ?? '')}${t.except ? ` <span class="none">(${Object.keys(t.except).length} except)</span>` : ''}</td></tr>`).join('') +
    `</tbody></table><p class="lead">Kept in Latin: ${GLOSSARY.keep.map(esc).join(' · ')}</p></section>`;
  const areas = AREAS.map(area => {
    const own = rows.filter(r => r.key.split('.')[0] === area);
    return `<section id="${esc(area)}"><h2>${esc(area)} <span class="none">${own.length}</span></h2><table><thead><tr><th>key</th><th>English</th><th>中文</th><th>states</th></tr></thead><tbody>` +
      own.map(r => `<tr id="${esc(r.key)}"><td class="key">${esc(r.key)}</td><td>${esc(r.en)}</td><td class="zh">${esc(r.zh)}</td><td class="states">${stateLinks(r.states)}</td></tr>`).join('') +
      '</tbody></table></section>';
  }).join('');
  const nav = AREAS.map(a => `<a href="#${esc(a)}">${esc(a)}</a>`).join(' ');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>中文 review · ${rows.length} keys</title><style>
:root{color-scheme:light dark;--bg:#faf7f0;--fg:#1d1b16;--dim:#7a7468;--line:#e4ddcf;--zh:#0b5d3b}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#ececec;--dim:#8d8d8d;--line:#2a2a2a;--zh:#7bd7a8}}
body{margin:0;padding:24px 32px;background:var(--bg);color:var(--fg);font:14px/1.5 "Noto Sans SC","PingFang SC",system-ui,sans-serif}
h1{font-size:20px}h2{font-size:16px;margin:28px 0 8px}nav{position:sticky;top:0;background:var(--bg);padding:6px 0;border-bottom:1px solid var(--line)}
nav a{margin-right:8px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}
th{color:var(--dim);font-weight:600}.key{font:12px/1.4 "IBM Plex Mono",ui-monospace,monospace;color:var(--dim);white-space:nowrap}.zh{color:var(--zh)}
.states{font-size:12px;max-width:340px}.none,.lead{color:var(--dim)}a{color:inherit}a.en{color:var(--dim)}
</style></head><body><h1>中文 review · ${rows.length} keys</h1><p class="lead">Correct a key in zh-review.tsv's fix column (one row per key; \\t and \\n for a tab and a newline), or say it in chat: key → words.</p><nav>${nav}</nav>${glossary}${areas}</body></html>\n`;
}

const statePage = (name, html, lang) => `<!doctype html><html lang="${lang === 'zh' ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><title>${esc(name)} · ${lang}</title>` +
  CSS.map(href => `<link rel="stylesheet" href="${esc(href)}">`).join('') + `</head><body><div id="app" class="app">${html}</div></body></html>\n`;

/** Write the dump into dir: the TSV, the page and every state under each table; returns the rows. */
export async function writeReview(dir) {
  const out = resolve(dir);
  mkdirSync(join(out, 'states'), { recursive: true });
  const rows = await reviewRows();
  writeFileSync(join(out, 'zh-review.tsv'), tsvOf(rows));
  writeFileSync(join(out, 'zh-review.html'), reviewHtml(rows));
  for (const [lang, table] of [['zh', ZH], ['en', EN]]) {
    for (const [name, html] of await entriesUnder(table)) writeFileSync(join(out, 'states', `${name}.${lang}.html`), statePage(name, html, lang));
  }
  return rows;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--out');
  if (at < 0 || !process.argv[at + 1]) {
    console.error('usage: npx tsx tests/client/zh-review.js --out <dir>');
    process.exit(2);
  }
  const rows = await writeReview(process.argv[at + 1]);
  const drawn = rows.filter(r => r.states.length).length;
  console.log(`wrote ${rows.length} keys (${drawn} drawn by a corpus state, ${rows.length - drawn} by host code only) into ${resolve(process.argv[at + 1])}`);
}
