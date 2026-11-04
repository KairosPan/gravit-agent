// The stylesheet against the screens stage 1 draws: every class has a rule, no colour by hex, the layout rules the design fixed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { renderRail } from '../../client/js/render/rail.js';
import { renderRunSheet } from '../../client/js/render/run-sheet.js';
import { setMarkdown } from '../../client/js/render/thread.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { renderMarkdown } from '../../client/js/wire/markdown.js';
import { withMiniDocument } from './helpers/mini-dom.js';
import { NOW, conv, corpus, composerPieces, discoverStates, searchStates, screenOf } from './helpers/screens.js';

const css = await readFile(new URL('../../client/css/app.css', import.meta.url), 'utf8');
// every state's page and the composer's pieces, as one string (helpers/screens.js)
const corpusHtml = () => corpus().map(([, html]) => html).join('');
const composerHtml = () => composerPieces().map(([, html]) => html).join('');

test('every class the screens emit has a rule in app.css, and app.css names no colour by hex', () => {
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b/, 'colours come from tokens.css');
  setMarkdown(null);
  const html = corpusHtml();
  for (const c of ['composer-menu', 'composer-box', 'cmenu', 'cmenu-group', 'cmenu-crumb', 'cmenu-row', 'active', 'cmenu-icon', 'cmenu-title', 'cmenu-name', 'cmenu-desc', 'cmenu-foot', 'ref-chip', 'ref-chip-label', 'secret', 'revealed', 'secret-raw', 'secret-mask', 'secret-eye', 'thread-box', 'turn-rail', 'turn-mark', 'turn-row', 'turn-tick', 'loaded', 'pulse', 'turn-card', 'turn-card-head', 'turn-card-prompt', 'turn-card-reply', 'earlier-key', 'thread-foot', 'stats-pill', 'jobs-chip', 'jobs-dot', 'live', 'job', 'job-details', 'job-dot', 'job-cmd', 'job-meta', 'job-out', 'job-note', 'job-end', 'job-copy', 'jobs-finished', 'mkts', 'mk-tab', 'mk-star', 'mk-name', 'mk-tag', 'mk-q', 'mk-clear', 'mk-note', 'mk-empty', 'mk-st', 'page-back', 'mk-chart', 'mk-axis', 'mk-facts', 'mk-big', 'mk-basis', 'mk-asof', 'mk-d-acts', 'mk-line', 'mk-h3', 'mk-book', 'mk-on', 'mk-outs', 'mk-out', 'acct', 'networth', 'acct-figures', 'acct-second', 'acct-t', 'acct-shown', 'order-row', 'acct-note', 'activity-row', 'venue', 'account-line', 'pair-box', 'sheet', 'sheet-quote', 'sheet-left', 'sheet-check', 'stale', 'trade', 'tp-head', 'tk-seg', 'tk-pick', 'tk-row', 'tk-open', 'tk-said', 'tk-panel', 'tk-picked', 'tk-out', 'mk-yes', 'mk-no', 'tk-at', 'tk-side', 'tk-quote', 'tk-left', 'tk-msg', 'tk-go', 'tk-hand', 'research', 'pcard-meta', 'pcard-foot', 'pcard-link', 'mod-tags', 'mod-boxes', 'mod-runs-wrap', 'mod-runs', 'mod-legend', 'composed', 'notes', 'notes-body', 'lh-answer', 'lh-summary', 'lh-block', 'lh-skel', 'lh-title', 'lh-error', 'lh-label', 'lh-readout', 'lh-tiles', 'lh-tile', 'lh-tile-chal', 'lh-lines', 'lh-line', 'stress', 'lh-id', 'lh-split', 'lh-split-up', 'lh-split-down', 'lh-stats', 'lh-dist', 'lh-bucket', 'lh-bucket-bar', 'lh-srcs', 'lh-src', 'lh-src-miss', 'lh-foot', 'lh-choices', 'lh-choice', 'lh-open-run', 'lh-ix-rows', 'lh-ix', 'lh-ix-name', 'lh-ix-last', 'lh-ix-pct', 'lh-spark', 'lh-spark-mid', 'lh-spark-line', 'lh-chart', 'lh-band', 'lh-tick', 'lh-grid', 'lh-mid', 'lh-axis', 'lh-bar', 'lh-path', 'lh-mark-dot', 'lh-mark', 'lh-cur', 'lh-dot', 'lh-minute', 'lh-stock', 'stock', 'with-stock', 'lh-stk-head', 'lh-stk-sub', 'lh-stk-pool', 'lh-stk-price', 'lh-stk-tag', 'lh-stk-from', 'lh-stk-note', 'lh-stk-cite', 'lh-limit', 'lh-seal']) assert.match(html, new RegExp(`class="[^"]*\\b${c}\\b`), `a screen emits ${c}`);
  const classes = new Set(html.match(/class="([^"]+)"/g).flatMap(x => x.slice(7, -1).split(/\s+/)));
  const missing = [...classes].filter(c => c && !new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css));
  assert.deepEqual(missing, [], 'classes without a rule');
  assert.match(css, /--rail/);
  assert.match(css, /\.key\.yes[^{]*\{[^}]*color: var\(--up\)/);
  assert.match(css, /\.key\.no[^{]*\{[^}]*color: var\(--down\)/);
});

test("the list's search: the box a pill, the results' lines, the match in the warn colours", () => {
  const html = searchStates(R.nav(R.hostList(emptyState(), { conversations: [conv('s1'), conv('old', { title: 'T old', archived: 'face' })] }), { screen: 'messages', id: 's1' })).map(st => renderRail(st, NOW)).join('');
  for (const c of ['conv-search', 'conv-search-key', 'conv-results', 'conv-results-count', 'conv-hit', 'conv-hit archived', 'conv-hit-line', 'conv-hit-channel', 'conv-results-state', 'sk']) assert.ok(html.includes(`class="${c}"`), c);
  assert.match(html, /<mark>T<\/mark>/);
  assert.match(css, /\.conv-search\s*\{[^}]*height: 36px[^}]*border-radius: var\(--radius-pill\)/);
  assert.match(css, /\.conv-hit-line mark\s*\{[^}]*background: var\(--warn-fill\)[^}]*color: var\(--warn-text\)/);
  assert.match(css, /\.conv-hit\.archived\s*\{[^}]*opacity/);
});

test("the Research shelf's cards: a column, the meta and the foot, the chip tones, a dim card", () => {
  const html = discoverStates().map(st => screenOf(st, NOW)).join('');
  for (const c of ['pcard research', 'pcard-meta', 'pcard-foot', 'chip ok', 'chip warn', 'chip grey', 'chip live']) assert.ok(html.includes(`class="${c}`), c);
  assert.match(css, /\.chip\.live\s*\{[^}]*background: var\(--surface-2\)[^}]*color: var\(--text\)/);
  assert.match(css, /\.pcard\.research\s*\{[^}]*flex-direction: column[^}]*gap: 12px/);
  assert.match(css, /\.pcard-meta\s*\{[^}]*font-size: 12px/);
  assert.match(css, /\.pcard-foot\s*\{[^}]*display: flex/);
  assert.match(css, /\.chip\.ok\s*\{\s*background: var\(--up-fill\); color: var\(--up\)/);
  assert.match(css, /\.chip\.warn\s*\{\s*background: var\(--warn-fill\); color: var\(--warn-text\)/);
  assert.match(css, /\.pcard\.dim\s*\{\s*opacity: \.55/);
});

test("a module card's Run sheet: the drawer, the On options open and greyed", () => {
  const html = discoverStates().map(st => renderRunSheet(st, NOW)).join('');
  for (const c of ['drawer sheet run-sheet', 'opt on', 'opt off', 'field-error']) assert.ok(html.includes(`class="${c}"`), c);
  assert.match(css, /\.run-sheet [^{]*\{[^}]*border-top/);
  assert.match(css, /\.opt\s*\{[^}]*display: grid/);
  assert.match(css, /\.opt\.off\s*\{[^}]*color: var\(--dim\)/);
});

test('every class app.css styles is emitted by some screen: no rule outlives the screen it styled', () => {
  setMarkdown(null);
  const sample = '# H1\n\n## H\n\n### H3\n\n#### H4\n\n**b** `c` [l](https://x.test)\n\n- a\n\n> q\n\n---\n\n```\nx\n```\n\n| s | c |\n|---|---|\n| A | +1% |\n| B | -1% |';
  const page = readFileSync(new URL('../../client/index.html', import.meta.url), 'utf8');
  const html = page + corpusHtml() +
    withMiniDocument(() => renderMarkdown(sample).node.outerHTML);
  const emitted = new Set(html.match(/class="([^"]+)"/g).flatMap(x => x.slice(7, -1).split(/\s+/)));
  const styled = new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]));
  assert.deepEqual([...styled].filter(c => !emitted.has(c)).sort(), [], 'rules for classes no screen emits');
});

test('the layout: one screen tall, the thread scrolls under a pinned composer, the drawer is fixed', () => {
  const rule = sel => css.match(new RegExp(`^${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`, 'm'))?.[1] ?? '';
  assert.match(rule('.main'), /(?:^|;)\s*height: 100vh/, 'a real height, not a minimum');
  assert.match(rule('.thread'), /overflow-y: auto/);
  assert.match(rule('.thread'), /flex: 1/);
  assert.match(rule('.thread'), /position: relative/, "the marks' offset parent");
  assert.match(rule('.thread-box'), /flex: 1 1 auto; min-height: 0; position: relative; display: flex; flex-direction: column/, "the box takes the thread's place");
  assert.match(rule('.drawer'), /position: fixed/);
  assert.match(rule('.turn-mark'), /height: 0; margin-bottom: -6px/, "a mark takes back the thread's gap");
  assert.match(rule('.turn-rail'), /position: absolute; top: 0; bottom: 0; right: 0; width: 28px/);
  assert.match(rule('.turn-rail:empty'), /display: none/);
  assert.match(rule('.turn-row'), /flex: 0 1 10px; min-height: 3px/);
  assert.match(rule('.turn-tick::before'), /height: 2px; width: 40%/);
  assert.match(rule('.turn-tick.loaded::before'), /width: 60%/);
  assert.match(rule('.turn-tick.active::before'), /width: 100%; background: var\(--primary\)/);
  assert.match(rule('.turn-tick.pulse::before'), /animation: turn-pulse/);
  assert.match(rule('.turn-card'), /max-width: 300px; max-height: 100px[^}]*background: var\(--surface\); border: 1px solid var\(--border\)/);
  assert.match(rule('.turn-card-head'), /text-transform: uppercase/);
  assert.match(css, /\.earlier-key\[aria-disabled="true"\] \{ cursor: default; \}/);
  assert.match(rule('.status-line'), /text-align: center/);
});

// a narrow window scrolls the page, not the thread: the main must grow to its content (the desktop's zero flex basis kept
// it one screen tall, so the thread spilled out past a composer stranded mid-page), and the composer sticks to the bottom
test("background jobs: the chip's dot, the command one mono line, the output a mono block that scrolls", () => {
  const rule = sel => css.match(new RegExp(`^${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`, 'm'))?.[1] ?? '';
  assert.match(rule('.jobs-dot, .job-dot'), /background: var\(--dim\)/);
  assert.match(rule('.jobs-dot.live, .job-dot.live'), /background: var\(--up\)/);
  assert.match(rule('.job-cmd'), /font-family: var\(--font-mono\)/);
  assert.match(rule('.job-cmd'), /white-space: nowrap; overflow: hidden; text-overflow: ellipsis/);
  const out = rule('.job-out');
  for (const want of [/font: 12px\/1.5 var\(--font-mono\)/, /white-space: pre-wrap/, /max-height: 320px/, /overflow: auto/, /background: var\(--surface-2\)/]) assert.match(out, want);
  assert.match(rule('.job-out:empty, .job-note:empty'), /display: none/);
});

test('the narrow layout: the main grows with the page and the composer stays pinned to the bottom', () => {
  const narrow = css.match(/@media \(max-width: 860px\) \{\n([\s\S]*?)\n\}/)?.[1] ?? '';
  const rule = sel => narrow.match(new RegExp(`^\\s*${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`, 'm'))?.[1] ?? '';
  assert.match(rule('.main'), /flex: none/, 'no zero basis: the main is as tall as what it holds');
  assert.match(rule('.thread'), /overflow-y: visible/, 'the page scrolls, not the thread');
  assert.match(rule('.thread-box'), /display: block/, 'the box no longer holds the thread to a screen');
  assert.match(rule('.turn-rail'), /display: none/, 'no rail on a narrow window');
  assert.match(rule('.composer'), /position: sticky/);
  assert.match(rule('.composer'), /bottom: 0/);
  assert.match(rule('.composer'), /background: var\(--bg\)/, 'the thread does not show through it');
});

test('Details never covers the conversation: it makes room, folding the list away on a medium window', () => {
  assert.match(css, /\.main\.with-drawer > \.head, \.main\.with-drawer > \.thread-box, \.main\.with-drawer > \.composer \{ margin-right: 400px; \}/);
  assert.match(css, /\.main\.with-drawer\.with-stock > \.head, \.main\.with-drawer\.with-stock > \.thread-box, \.main\.with-drawer\.with-stock > \.composer \{ margin-right: 460px; \}/);
  assert.match(css, /@media \(min-width: 861px\) and \(max-width: 1399px\) \{\s*\.list:has\(~ \.main\.with-drawer\) \{ display: none; \}/);
});

test('a long tool description is clamped to two lines, and the page keys keep a gap', () => {
  const rule = sel => css.match(new RegExp(`^${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`, 'm'))?.[1] ?? '';
  assert.match(rule('.tool-desc'), /-webkit-line-clamp: 2/);
  assert.match(rule('.plug-key'), /gap: 8px/);
});

test('the question card and the thinking row have their rules', () => {
  for (const sel of ['.question .q', '.opt', '.thinking span', '.cut', '.status-line.bad']) {
    assert.ok(new RegExp(sel.replace(/[.]/g, '\\.') + '\\s*\\{').test(css), sel);
  }
});

test('every token app.css reads is declared: a var(--x) nobody defines falls back to inherit and the rule silently does nothing', async () => {
  const tokens = await readFile(new URL('../../client/css/tokens.css', import.meta.url), 'utf8');
  const declared = new Set((tokens + css).match(/--[\w-]+(?=\s*:)/g));
  const read = new Set(css.match(/var\(\s*(--[\w-]+)/g).map(x => x.replace(/var\(\s*/, '')));
  assert.deepEqual([...read].filter(t => !declared.has(t)), [], 'tokens read but never declared');
});

test("Gravit's markdown has its rules: every class markdown.js emits, and links in an answer that look like links", () => {
  const sample = '## Breadth\n\n**NVDA** leads; see [the filing](https://www.sec.gov/x) and `ADV`.\n\n- one\n  - two\n\n1. first\n\n> a quote\n\n---\n\n```\nzstd -dc log\n```\n\n| sym | chg |\n|---|---|\n| NVDA | +3.1% |\n| AMD | -1.2% |';
  const html = withMiniDocument(() => renderMarkdown(sample).node.outerHTML);
  const classes = new Set(html.match(/class="([^"]+)"/g).flatMap(x => x.slice(7, -1).split(/\s+/)));
  for (const c of ['md', 'md-h', 'md-h2', 'md-code', 'md-list', 'md-quote', 'md-hr', 'md-fence', 'md-tablewrap', 'viz-table', 'num', 'up', 'down']) assert.ok(classes.has(c), `the sample emits ${c}`);
  const missing = [...classes].filter(c => !new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css));
  assert.deepEqual(missing, [], 'markdown classes without a rule');
  assert.match(css, /\.md a\s*\{[^}]*color: var\(--[\w-]+\)/, 'a link in an answer carries a colour of its own');
  assert.match(css, /\.md-tablewrap\s*\{[^}]*overflow-x: auto/, 'a wide table scrolls inside the bubble');
});

test('app.css is well formed: braces never close more than they opened, so no rule is swallowed', () => {
  let depth = 0;
  for (const ch of css) {
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; assert.ok(depth >= 0, 'a } without its {'); }
  }
  assert.equal(depth, 0);
});

test('the equity blue goes by Linqi\'s own name: no --blue, which his tokens use for the orange RWA colour', async () => {
  const tokens = await readFile(new URL('../../client/css/tokens.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /var\(--blue\)/);
  assert.match(tokens, /--alloc-equity/);
  assert.match(tokens, /--on-equity/);
});

test("the composer's chip reads the pale blue tokens, declared in each theme block; the box, the editor's growth, the menu above", async () => {
  const tokens = await readFile(new URL('../../client/css/tokens.css', import.meta.url), 'utf8');
  const chipRule = css.match(/^\.ref-chip \{([^}]*)\}/m)?.[1] ?? '';
  for (const d of ['display: inline-flex', 'background: var(--ref-fill)', 'color: var(--ref-text)', 'border-radius: var(--radius-pill)']) assert.ok(chipRule.includes(d), `.ref-chip ${d}`);
  const blocks = [tokens.match(/:root\[data-theme="cream"\] \{([^}]*)\}/)?.[1], tokens.match(/:root\[data-theme="black"\] \{([^}]*)\}/)?.[1], tokens.match(/:root:not\(\[data-theme\]\) \{([^}]*)\}/)?.[1]];
  for (const [i, b] of blocks.entries()) {
    assert.ok(b, `theme block ${i}`);
    assert.match(b, /--ref-fill: #[0-9a-f]{6}/, `--ref-fill in block ${i}`);
    assert.match(b, /--ref-text: #[0-9a-f]{6}/, `--ref-text in block ${i}`);
  }
  assert.match(blocks[0], /--ref-fill: #eef1fb; --ref-text: #3b5bdb/);
  for (const b of blocks.slice(1)) assert.match(b, /--ref-fill: #1e2541; --ref-text: #9db0ff/);
  assert.match(css, /\.composer \{[^}]*position: relative/);
  assert.match(css, /\.composer-box \{[^}]*flex-direction: column[^}]*border-radius: var\(--radius-l\)/);
  // the input row never wraps: a long line grows the editor, it never drops it below the paperclip or Send below it
  const row = css.match(/^\.composer-row \{([^}]*)\}/m)?.[1] ?? '';
  for (const d of ['display: flex', 'flex-wrap: nowrap', 'align-items: flex-end']) assert.ok(row.includes(d), `.composer-row ${d}`);
  assert.doesNotMatch(css.match(/^\.composer-box \{([^}]*)\}/m)?.[1] ?? '', /flex-wrap: wrap/);
  assert.match(css, /\.composer-input \{[^}]*flex: 1 1 0[;][^}]*min-width: 0/);
  assert.match(css, /\.composer-input \{[^}]*max-height: calc\(8 \* 1\.45em\)[^}]*overflow-y: auto[^}]*white-space: pre-wrap[^}]*overflow-wrap: anywhere/);
  assert.match(css, /\.composer-input:empty::before \{[^}]*content: attr\(data-placeholder\)[^}]*color: var\(--dim\)/);
  assert.match(css, /\.composer-menu \{[^}]*position: absolute[^}]*width: min\(520px, 100%\)/);
  assert.match(css, /\.cmenu \{[^}]*max-height: 400px[^}]*overflow-y: auto/);
  assert.match(css, /\.cmenu-name \{[^}]*font-family: var\(--font-mono\)[^}]*color: var\(--dim\)/);
  assert.match(css, /\.cmenu-row\.active \{[^}]*background: var\(--surface-2\)/);
  assert.doesNotMatch(css, /composer-pill/);
});

test("the composer's attachments: the note, the rail, the image square, the card and its failed tone, the remove key on hover, the overlay, the lightbox", () => {
  const html = composerHtml();
  for (const c of ['composer-note', 'composer-files', 'attach-key', 'attach-image', 'attach-remove', 'file-card', 'file-card uploading', 'file-card failed', 'file-icon', 'file-name', 'file-meta', 'file-retry', 'drop-overlay', 'drop-card', 'drop-title', 'drop-sub', 'lightbox', 'lightbox-img', 'close-key lightbox-close']) assert.ok(html.includes(`class="${c}"`), c);
  assert.match(css, /\.composer-note \{[^}]*color: var\(--down\)[^}]*background: var\(--down-fill\)/);
  assert.match(css, /\.composer-note:empty \{[^}]*display: none/);
  assert.match(css, /\.composer-files \{[^}]*display: flex[^}]*flex-wrap: wrap[^}]*gap:/);
  assert.match(css, /\.composer-files:empty \{[^}]*display: none/);
  assert.match(css, /\.attach-image \{[^}]*width: 64px[^}]*height: 64px[^}]*border-radius: var\(--radius-s\)/);
  assert.match(css, /\.attach-image img \{[^}]*object-fit: cover/);
  assert.match(css, /\.file-card \{[^}]*width: 240px[^}]*height: 64px/);
  assert.match(css, /\.file-card\.failed \{[^}]*background: var\(--down-fill\)[^}]*border-color: var\(--down-edge\)/);
  assert.match(css, /\.attach-remove \{[^}]*opacity: 0/);
  assert.match(css, /\.file-card \{[^}]*padding: 0 28px 0 12px/, 'the remove key never covers the name');
  assert.match(css, /@media \(hover: none\) \{\s*\.attach-remove \{ opacity: 1; \}\s*\}/, 'a touch screen shows the remove key');
  assert.match(css, /\.attach-image:hover \.attach-remove, \.attach-image:focus-within \.attach-remove, \.file-card:hover \.attach-remove, \.file-card:focus-within \.attach-remove \{[^}]*opacity: 1/);
  assert.match(css, /\.drop-overlay \{[^}]*position: fixed[^}]*inset: 0[^}]*background: color-mix\(in srgb, var\(--bg\)/);
  assert.match(css, /\.lightbox \{[^}]*position: fixed[^}]*inset: 0/);
  assert.match(css, /\.lightbox-img \{[^}]*max-width: 92vw[^}]*max-height: 88vh/);
});

test("the operator's attachments in the thread: the column, the right-aligned row, the lone image, the squares, loading", () => {
  const html = composerHtml();
  for (const c of ['you-body', 'you-files', 'you-image', 'you-image loading', 'you-thumb', 'you-thumb loading']) assert.ok(html.includes(`class="${c}"`), c);
  assert.match(css, /\.you-body \{[^}]*flex-direction: column[^}]*align-items: flex-end[^}]*max-width: 66%/);
  assert.match(css, /\.you-files \{[^}]*display: flex[^}]*justify-content: flex-end/);
  assert.match(css, /\.you-image img \{[^}]*max-width: 240px/);
  assert.match(css, /\.you-image img \{[^}]*max-height: 320px[^}]*object-fit: contain/, 'a tall screenshot draws no taller than 320px');
  assert.match(css, /\.you-thumb \{[^}]*width: 64px[^}]*height: 64px/);
  assert.match(css, /\.you-thumb img \{[^}]*object-fit: cover/);
});

test("the pin: the row's wrap, the key in the time's place, the glyph before the time", () => {
  const html = renderRail(R.hostPins(R.nav(R.hostList(emptyState(), { conversations: [conv('s1'), conv('s2')] }), { screen: 'messages', id: 's1' }), ['s1']), NOW);
  for (const c of ['row-wrap', 'pin-key', 'row-pin']) assert.ok(html.includes(`class="${c}"`), c);
  assert.match(css, /\.row-wrap\s*\{[^}]*position: relative/);
  assert.match(css, /\.row-wrap:hover \.pin-key[^{]*\{[^}]*opacity: 1/);
  assert.match(css, /\.row-wrap:focus-within \.pin-key/);
  assert.match(css, /\.row-pin\s*\{[^}]*color: var\(--dim\)/);
});

test('the time hides under the pin key only on a row that has one; the results cap like the rows on a narrow window', () => {
  assert.match(css, /\.row-wrap:has\(> \.pin-key\):hover \.row-time/);
  assert.doesNotMatch(css, /\.row-wrap:hover \.row-time/, 'an archived row, with no key, keeps its time on hover');
  const narrow = css.match(/@media \(max-width: 860px\) \{\n([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(narrow, /\.conv-results \{ max-height: 40vh; \}/);
});

test('a masked value: a mono box whose raw run lies transparent over its mask, the mask unselectable, the eye a 20 px key', () => {
  assert.match(css, /\.secret\s*\{[^}]*display: inline-block[^}]*position: relative[^}]*font-family: var\(--font-mono\)[^}]*white-space: pre-wrap/);
  assert.match(css, /\.secret\s*\{[^}]*background: var\(--surface-2\)[^}]*border-radius: var\(--radius-s\)/);
  assert.match(css, /\.secret-raw\s*\{[^}]*position: absolute[^}]*color: transparent/);
  assert.match(css, /\.secret-mask\s*\{[^}]*user-select: none/);
  assert.match(css, /\.secret-raw\s*\{[^}]*forced-color-adjust: none/);
  assert.match(css, /\.secret:not\(\.revealed\) \.secret-raw::selection\s*\{[^}]*color: transparent/);
  assert.match(css, /\.secret\.revealed \.secret-raw\s*\{[^}]*position: static[^}]*color: var\(--text\)/);
  assert.match(css, /\.secret-eye\s*\{[^}]*width: 20px[^}]*height: 20px/);
});
