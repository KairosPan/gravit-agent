// Plan 2 of the Lunhui run view, task 5: the verdicts, breadth and sources blocks and the footer of a composed answer, on the
// synthetic sealed 10-27 run's view, and China time for every stamp whatever zone the browser runs in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chinaStamp } from '../../client/js/render/lunhui/time.js';
import { verdictsHtml } from '../../client/js/render/lunhui/verdicts.js';
import { breadthHtml } from '../../client/js/render/lunhui/breadth.js';
import { sourcesHtml } from '../../client/js/render/lunhui/sources.js';
import { footerHtml } from '../../client/js/render/lunhui/footer.js';
import { composedHtml } from '../../client/js/render/lunhui/composed.js';
import { VIEW_1027 } from './helpers/lunhui-view.js';

const ID = 'c1-p7';
const text = html => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const readout = html => text(html.match(/<div class="lh-readout"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '');

// Review Focus 5: the browser in New York still prints China time (the save-and-restore of gravit-plugin.test.ts)
test('chinaStamp prints China time with CST, whatever zone the process runs in', () => {
  const saved = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    assert.equal(new Date('2026-10-27T20:16:53.810Z').getHours(), 16, 'the process really is in New York');
    assert.equal(chinaStamp('2026-10-27T20:16:53.810Z'), '10-28 04:16 CST');
    assert.equal(chinaStamp('2026-10-27T15:59:00Z'), '10-27 23:59 CST');
    assert.equal(chinaStamp('not a date'), '—');
    assert.equal(chinaStamp(null), '—');
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});

test('the verdict tiles: one per module in the view order, state, detail and the reviewer count', () => {
  const html = verdictsHtml(VIEW_1027, { kind: 'verdicts' }, {}, ID);
  const tiles = [...html.matchAll(/<button[^>]*class="lh-tile[^"]*"[^>]*data-value="([^"]+)"[^>]*>/g)].map(x => x[1]);
  assert.deepEqual(tiles, ['environment', 'sentiment', 'theme']);
  for (const t of html.match(/<button[^>]*class="lh-tile[^"]*"[^>]*>/g)) {
    assert.match(t, /data-action="lunhuiUi"/);
    assert.match(t, new RegExp(`data-id="${ID}"`));
    assert.match(t, /data-field="tile"/);
    assert.match(t, /aria-expanded="false"/);
  }
  const env = html.slice(html.indexOf('data-value="environment"'), html.indexOf('data-value="sentiment"'));
  assert.match(text(env), /WEAK/);
  assert.match(text(env), /liquidity CONTRACTING/);
  assert.match(text(env), /2 challenged/);
  assert.match(text(html.slice(html.indexOf('data-value="sentiment"'))), /3 challenged/);
  assert.doesNotMatch(text(html.slice(html.indexOf('data-value="theme"'))), /challenged/, 'no items against theme, no count');
  assert.doesNotMatch(html, /缺少 boards 证据/, 'closed tiles show no lines');
});

test('the open tile draws its claims, then the reviewer items in the stress colour', () => {
  const theme = verdictsHtml(VIEW_1027, { kind: 'verdicts' }, { tile: 'theme' }, ID);
  assert.match(theme, /data-value="theme" aria-expanded="true"/);
  assert.match(theme, /<span class="lh-id">—<\/span>/);
  assert.match(theme, /缺少 boards 证据，无法评估。/);
  assert.match(theme, /板块冻结三次失败/);
  const env = verdictsHtml(VIEW_1027, { kind: 'verdicts' }, { tile: 'environment' }, ID);
  const lines = env.slice(env.indexOf('class="lh-lines"'));
  assert.ok(lines.indexOf('c4') < lines.indexOf('x1'), 'claims, then challenges');
  assert.match(lines, /<div class="lh-line stress"><span class="lh-id">x1<\/span>/);
  assert.match(lines, /<div class="lh-line stress"><span class="lh-id">x2<\/span>/);
  assert.doesNotMatch(lines, /x3/, 'only the items against this module');
});

test('breadth in Counts: the split bar, the counts row, the tiles and the ratio readout', () => {
  const html = breadthHtml(VIEW_1027, { kind: 'breadth' }, {}, ID);
  for (const g of ['flex-grow:567', 'flex-grow:34', 'flex-grow:4774']) assert.ok(html.includes(g), g);
  assert.ok(html.indexOf('flex-grow:567') < html.indexOf('flex-grow:34') && html.indexOf('flex-grow:34') < html.indexOf('flex-grow:4774'));
  const t = text(html);
  for (const s of ['↑ 567 up · 10.5%', '34 unchanged', '↓ 4774 down · 88.8%', 'Limit-up', '41', 'Limit-down', '22', 'Turnover', '¥1.46万亿']) assert.ok(t.includes(s), s);
  assert.equal(readout(html), 'Up/down ratio 0.12 · about 1 riser for every 8 fallers');
  // the digest's turnover grammar: 亿 from 1e8, whole yuan below
  const tile = turnover => text(breadthHtml({ ...VIEW_1027, breadth: { ...VIEW_1027.breadth, turnover } }, { kind: 'breadth' }, {}, ID)).match(/Turnover(¥[^A-Z↑↓]*?)Up\/down/)?.[1];
  assert.equal(tile(35_012_000_000), '¥350.12亿');
  assert.equal(tile(98_765_432), '¥98765432');
  assert.match(html, /<div class="lh-readout" role="status" aria-live="polite">/);
  // the switch: Counts pressed, By change not, both naming this answer and the breadth field
  assert.match(html, /<button[^>]*class="seg-item pressed"[^>]*data-action="lunhuiUi" data-value="counts" data-id="c1-p7" data-field="breadth">Counts<\/button>/);
  assert.match(html, /data-value="dist" data-id="c1-p7" data-field="breadth">By change<\/button>/);
  assert.doesNotMatch(html, /data-field="bucket"/, 'no buckets in Counts');
});

test('breadth by change: 23 buckets in proportion, the biggest picked by default, the readout names the bucket', () => {
  const dflt = breadthHtml(VIEW_1027, { kind: 'breadth' }, { breadth: 'dist' }, ID);
  const buckets = [...dflt.matchAll(/<button[^>]*data-field="bucket"[^>]*data-value="(-?\d+)"[^>]*>/g)].map(x => Number(x[1]));
  assert.equal(buckets.length, 23);
  assert.deepEqual(buckets, Array.from({ length: 23 }, (_, i) => i - 11));
  assert.equal(readout(dflt), 'Bucket −4: 1023 stocks · 19.0% of 5375', 'the bucket with the most stocks');
  assert.match(dflt, /data-value="-4" aria-pressed="true"/);
  assert.match(dflt, /height:100\.0%/, 'the largest bucket is full height');
  assert.match(dflt, /height:2\.2%/, '22 of 1023');
  const picked = breadthHtml(VIEW_1027, { kind: 'breadth' }, { breadth: 'dist', bucket: -4 }, ID);
  assert.equal(readout(picked), 'Bucket −4: 1023 stocks · 19.0% of 5375');
  assert.equal(readout(breadthHtml(VIEW_1027, { kind: 'breadth' }, { breadth: 'dist', bucket: -11 }, ID)), 'Limit-down: 22 stocks · 0.4% of 5375');
  assert.equal(readout(breadthHtml(VIEW_1027, { kind: 'breadth' }, { breadth: 'dist', bucket: 11 }, ID)), 'Limit-up: 41 stocks · 0.8% of 5375');
  assert.equal(readout(breadthHtml(VIEW_1027, { kind: 'breadth' }, { breadth: 'dist', bucket: 0 }, ID)), 'Unchanged: 34 stocks · 0.6% of 5375');
  assert.equal(readout(breadthHtml(VIEW_1027, { kind: 'breadth' }, { breadth: 'dist', bucket: 3 }, ID)), 'Bucket +3: 77 stocks · 1.4% of 5375');
  assert.doesNotMatch(dflt, /flex-grow/, 'no split bar by change');
});

test('breadth the run did not freeze is one line, never a throw', () => {
  const html = breadthHtml({ ...VIEW_1027, breadth: null }, { kind: 'breadth', title: '涨跌' }, {}, ID);
  assert.match(text(html), /Breadth was not frozen for this run/);
  assert.match(html, /涨跌/);
});

test('sources: one row each, frozen, refused with its codes counted, or not asked; the modules that missed it', () => {
  const html = sourcesHtml(VIEW_1027, { kind: 'sources' });
  const rows = [...html.matchAll(/<div class="lh-src">([\s\S]*?)<\/div>/g)].map(x => text(x[1]));
  assert.equal(rows.length, 4);
  assert.match(rows[0], /^index✓ frozen/);
  assert.match(rows[1], /^limit-up✓ frozen/);
  assert.match(rows[2], /^boards✗ UPSTREAM_TIMEOUT, UPSTREAM_INVALID ×2/);
  assert.match(rows[2], /missing in theme/);
  assert.match(rows[3], /^quotes—$/);
});

test('the footer: the sources asked, the frozen time in China time, the run', () => {
  const saved = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    assert.equal(text(footerHtml(VIEW_1027)), 'Evidence · index ✓ · limit-up ✓ · boards ✗ · frozen 10-28 04:16 CST · run 20261027T201627Z-6937d208');
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
  assert.equal(text(footerHtml({ run: 'r<1>' })), 'Evidence · frozen — · run r<1>');
  assert.doesNotMatch(footerHtml({ run: 'r<1>' }), /<1>/, 'the run is escaped');
});

test('each block draws block.title as its headline, escaped', () => {
  const title = '<script>alert(1)</script>';
  for (const [kind, draw] of [['verdicts', verdictsHtml], ['breadth', breadthHtml], ['sources', sourcesHtml]]) {
    const html = draw(VIEW_1027, { kind, title }, {}, ID);
    assert.doesNotMatch(html, /<script>/, kind);
    assert.ok(html.includes('<div class="lh-title">&lt;script&gt;alert(1)&lt;/script&gt;</div>'), kind);
  }
  assert.doesNotMatch(verdictsHtml(VIEW_1027, { kind: 'verdicts' }, {}, ID), /lh-title/, 'no title, no headline');
});

test('a loaded composed answer draws the four in the call order and the footer after the blocks', () => {
  const m = { id: 'p7', kind: 'composed', text: '弱势日', data: { strategy: 'cn-market', run: VIEW_1027.run, blocks: [{ kind: 'breadth', title: '近九成个股下跌' }, { kind: 'verdicts' }, { kind: 'sources' }], modules: [] } };
  const html = composedHtml(m, { status: 'loaded', view: VIEW_1027 }, { breadth: 'dist' }, { id: 'c1' });
  const at = s => html.indexOf(s);
  assert.ok(at('近九成个股下跌') < at('class="lh-tile') && at('class="lh-tile') < at('class="lh-src"') && at('class="lh-src"') < at('class="lh-foot"'));
  assert.match(html, /data-id="c1-p7"/);
  assert.match(html, /Bucket −4/, 'the answer’s picks reach its drawers');
  assert.match(html, /<div class="lh-foot">[^]*<\/div><\/div>$/, 'the footer closes the answer');
  // loading: skeletons, no footer yet
  assert.doesNotMatch(composedHtml(m, { status: 'loading' }, {}, { id: 'c1' }), /lh-foot/);
});
