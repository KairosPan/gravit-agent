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
import { ladderHtml } from '../../client/js/render/lunhui/ladder.js';
import { stockLink, linkNames, count, fix2, signedPct, yuan } from '../../client/js/render/lunhui/block.js';
import { yesterdayHtml } from '../../client/js/render/lunhui/yesterday.js';
import { signalsHtml } from '../../client/js/render/lunhui/signals.js';

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
  for (const s of ['↑ 567 up · 10.5%', '34 unchanged', '↓ 4,774 down · 88.8%', 'Limit-up', '41', 'Limit-down', '22', 'Turnover', '¥1.46万亿']) assert.ok(t.includes(s), s);
  assert.equal(readout(html), 'Up/down ratio 0.12 · about 1 riser for every 8 fallers');
  // the digest's turnover grammar from 1e8 (亿), plus the face's own 万 tier from 1e4, whole yuan below
  const tile = turnover => text(breadthHtml({ ...VIEW_1027, breadth: { ...VIEW_1027.breadth, turnover } }, { kind: 'breadth' }, {}, ID)).match(/Turnover(¥[^A-Z↑↓]*?)Up\/down/)?.[1];
  assert.equal(tile(35_012_000_000), '¥350.12亿');
  assert.equal(tile(98_765_432), '¥9876.54万');
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
  assert.equal(readout(dflt), 'Bucket −4: 1,023 stocks · 19.0% of 5,375', 'the bucket with the most stocks');
  assert.match(dflt, /data-value="-4" aria-pressed="true"/);
  assert.match(dflt, /height:100\.0%/, 'the largest bucket is full height');
  assert.match(dflt, /height:2\.2%/, '22 of 1023');
  const picked = breadthHtml(VIEW_1027, { kind: 'breadth' }, { breadth: 'dist', bucket: -4 }, ID);
  assert.equal(readout(picked), 'Bucket −4: 1,023 stocks · 19.0% of 5,375');
  assert.equal(readout(breadthHtml(VIEW_1027, { kind: 'breadth' }, { breadth: 'dist', bucket: -11 }, ID)), 'Limit-down: 22 stocks · 0.4% of 5,375');
  assert.equal(readout(breadthHtml(VIEW_1027, { kind: 'breadth' }, { breadth: 'dist', bucket: 11 }, ID)), 'Limit-up: 41 stocks · 0.8% of 5,375');
  assert.equal(readout(breadthHtml(VIEW_1027, { kind: 'breadth' }, { breadth: 'dist', bucket: 0 }, ID)), 'Unchanged: 34 stocks · 0.6% of 5,375');
  assert.equal(readout(breadthHtml(VIEW_1027, { kind: 'breadth' }, { breadth: 'dist', bucket: 3 }, ID)), 'Bucket +3: 77 stocks · 1.4% of 5,375');
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

test('sources: a stand-in boards row reads via iFinD with Eastmoney\'s code; Eastmoney and older rows as before', () => {
  const rowFor = extra => {
    const sources = VIEW_1027.sources.map(s => (s.source === 'boards' ? { ...s, frozen: true, refusals: [], missingIn: [], ...extra } : s));
    const html = sourcesHtml({ ...VIEW_1027, sources }, { kind: 'sources' });
    return text([...html.matchAll(/<div class="lh-src">([\s\S]*?)<\/div>/g)].map(x => x[1])[2]);
  };
  assert.equal(rowFor({ provider: '同花顺问财', fallbackFrom: 'UPSTREAM_INVALID' }), 'boards✓ via iFinDEastmoney UPSTREAM_INVALID');
  assert.equal(rowFor({ provider: '同花顺问财', fallbackFrom: null }), 'boards✓ via iFinD');
  assert.equal(rowFor({ provider: '东方财富', fallbackFrom: null }), 'boards✓ frozen');
  assert.equal(rowFor({}), 'boards✓ frozen');
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

test('the ladder: rungs top down, the gap rung stressed, promotions with meters, misses with today’s change', async () => {
  const { ladderHtml } = await import('../../client/js/render/lunhui/ladder.js');
  const html = ladderHtml(VIEW_1027, { kind: 'ladder' }, {}, ID);
  assert.deepEqual([...html.matchAll(/data-field="rung" data-value="(\d+)"/g)].map(x => x[1]), ['5', '4', '3', '2', '1']);
  assert.equal(text(html.match(/<div class="lh-label">[^]*?<\/div>/)[0]), 'Limit-up ladder · height 5 · 41 sealed');
  const rows = html.split('<div class="lh-rung').slice(1);
  const rung = n => rows.find(r => r.includes(`data-value="${n}"`));
  assert.ok(rung(3).startsWith(' stress'));
  assert.match(text(rung(3)), /gap · none of 8 sealed/);
  assert.match(text(rung(3)), /2→3 0\/8/);
  assert.match(rung(3), /width:0%/);
  assert.ok(!rung(4).startsWith(' stress'));
  assert.match(text(rung(4)), /样本600014 −9\.91%/);
  assert.match(text(rung(4)), /broke 1/);
  assert.match(text(rung(1)), /1st try 29\/53/);
  assert.match(rung(1), /width:55%/);
});

test('the ladder readout follows the focus, the picked rung and the first boards', async () => {
  const { ladderHtml } = await import('../../client/js/render/lunhui/ladder.js');
  assert.match(readout(ladderHtml(VIEW_1027, { kind: 'ladder' }, {}, ID)), /^4→5 · 1 of 1 /);
  const focused = ladderHtml(VIEW_1027, { kind: 'ladder', focus: { rung: 3 } }, {}, ID);
  assert.match(readout(focused), /^2→3 · 0 of 8 · missed: 样本000022 \+1\.00%/);
  assert.match(readout(focused), / · broke: 样本000021$/);
  assert.match(focused, /aria-pressed="true"[^>]*>3</);
  assert.equal(readout(ladderHtml(VIEW_1027, { kind: 'ladder' }, { rung: 1 }, ID)), 'First boards · 29 of 53 tries sealed · 24 broke');
  assert.match(readout(ladderHtml(VIEW_1027, { kind: 'ladder', focus: { rung: 3 } }, { rung: 4 }, ID)), /^3→4 · 3 of 6 · missed: 样本600014 −9\.91%/);
});

test('the ladder escapes names and answers an unfrozen ladder', async () => {
  const { ladderHtml } = await import('../../client/js/render/lunhui/ladder.js');
  const view = { ladder: { height: 2, rungs: [{ n: 2, sealed: [{ name: '<b>x</b>', firstSeal: '09:30', breaks: 2 }], from: 1, promoted: 1, missed: [], broke: [], gap: false }], firstTries: { sealed: 0, tries: 0 }, unavailable: null } };
  const html = ladderHtml(view, { kind: 'ladder' }, {}, ID);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(text(html), /09:30 broke 2/);
  assert.match(ladderHtml({ ladder: { unavailable: 'limit-up not frozen' } }, { kind: 'ladder' }, {}, ID), /not frozen/);
});

test('the ladder prints a near-zero change as 0.00% and colours it neutral', async () => {
  const { ladderHtml } = await import('../../client/js/render/lunhui/ladder.js');
  const st = pct => ({ name: 'N', pct });
  const view = { ladder: { height: 2, rungs: [{ n: 2, sealed: [], from: 3, promoted: 0, missed: [st(-0.004), st(0.004)], broke: [], gap: false }], firstTries: { sealed: 0, tries: 0 }, unavailable: null } };
  const html = ladderHtml(view, { kind: 'ladder' }, {}, ID);
  assert.doesNotMatch(html, /−0\.00|\+0\.00/);
  assert.equal([...html.matchAll(/class="lh-lpct flat">0\.00%</g)].length, 2);
  assert.match(readout(html), /missed: N 0\.00%, N 0\.00%/);
});

test('the ladder: a gap on the first rung says no first boards, never a blank count', async () => {
  const { ladderHtml } = await import('../../client/js/render/lunhui/ladder.js');
  const view = { ladder: { height: 2, rungs: [
    { n: 2, sealed: [{ name: 'A' }], from: 3, promoted: 1, missed: [], broke: [], gap: false },
    { n: 1, sealed: [], from: null, promoted: null, missed: [], broke: [], gap: true },
  ], firstTries: { sealed: 0, tries: 4 }, unavailable: null } };
  const html = ladderHtml(view, { kind: 'ladder' }, {}, ID);
  const first = html.split('<div class="lh-rung').slice(1).find(r => r.includes('data-value="1"'));
  assert.match(text(first), /gap · no first boards/);
  assert.doesNotMatch(text(html), /none of\s+sealed|none of null/);
});

test('the ladder prints its counts with thousands separators, like its label', async () => {
  const { ladderHtml } = await import('../../client/js/render/lunhui/ladder.js');
  const view = { ladder: { height: 2, rungs: [
    { n: 2, sealed: [{ name: 'A' }], from: 1200, promoted: 1001, missed: [], broke: [], gap: false },
    { n: 1, sealed: [], from: null, promoted: null, missed: [], broke: [], gap: false },
  ], firstTries: { sealed: 1234, tries: 5678 }, unavailable: null } };
  assert.equal(readout(ladderHtml(view, { kind: 'ladder' }, { rung: 1 }, ID)), 'First boards · 1,234 of 5,678 tries sealed · 0 broke');
  assert.match(readout(ladderHtml(view, { kind: 'ladder' }, { rung: 2 }, ID)), /^1→2 · 1,001 of 1,200 · /);
});

// plan 3, task 2: stock names are links to an open stock
test('a ladder chip is a stock link', () => {
  const r5 = VIEW_1027.ladder.rungs.find(r => r.n === 5);
  const html = ladderHtml(VIEW_1027, { kind: 'ladder' }, {}, ID, 'K');
  const chip = html.match(/<span class="lh-chip">([\s\S]*?)<\/span>/)[1];
  assert.match(html, /data-action="lunhuiStock"/);
  assert.ok(html.includes(`data-code="${r5.sealed[0].code}"`), 'the rung\'s code');
  assert.match(html, /data-key="K"/);
  assert.ok(chip.includes(`data-code="${r5.sealed[0].code}"`));
  assert.ok(chip.includes(`>${r5.sealed[0].name}</button>`));
});

test('stockLink draws a button with every value escaped, and the name alone without a code', () => {
  assert.equal(stockLink({ code: '600838', name: '上海<九百>' }, 'a/"b"'),
    '<button type="button" class="lh-stock" data-action="lunhuiStock" data-key="a/&quot;b&quot;" data-code="600838">上海&lt;九百&gt;</button>');
  assert.equal(stockLink({ name: 'A&B' }, 'K'), 'A&amp;B');
});

test('linkNames links the longest name once and never inside a link', () => {
  const view = { stocks: { 600838: { name: '上海九百' }, 600001: { name: '九百' } } };
  const a = '<a href="https://x/上海九百">上海九百</a>';
  const input = `<p>上海九百涨停，见 ${a}</p>`;
  const out = linkNames(input, view, 'K');
  assert.equal(out.split('class="lh-stock"').length - 1, 1, 'exactly one link');
  assert.ok(out.indexOf('lh-stock') < out.indexOf('<a '), 'before the <a>');
  assert.ok(out.includes(a), 'the <a> is unchanged');
  assert.equal(out, `<p>${stockLink({ code: '600838', name: '上海九百' }, 'K')}涨停，见 ${a}</p>`, 'otherwise byte-identical');
  assert.equal(linkNames(input, { stocks: {} }, 'K'), input);
  assert.equal(linkNames(input, {}, 'K'), input);
  // a name in an attribute stays as it is; an escaped name matches its escaped text; one character is never a name
  const attr = '<p title="九百">x</p>';
  assert.equal(linkNames(attr, view, 'K'), attr);
  assert.equal(linkNames('<p>A&amp;B up, 九 down</p>', { stocks: { 1: { name: 'A&B' }, 2: { name: '九' } } }, 'K'),
    `<p>${stockLink({ code: '1', name: 'A&B' }, 'K')} up, 九 down</p>`);
  // an entity is never split by a name inside it
  assert.equal(linkNames('<p>it&#39;s</p>', { stocks: { 3: { name: '39' } } }, 'K'), '<p>it&#39;s</p>');
});

test("a name not in the view's stocks stays text", () => {
  const html = '<p>贵州茅台走强</p>';
  assert.equal(linkNames(html, VIEW_1027, 'K'), html);
  const ladder = ladderHtml({ ...VIEW_1027, stocks: {} }, { kind: 'ladder' }, {}, ID, 'K');
  assert.doesNotMatch(ladder, /lh-stock/, 'a rung name whose code the view does not hold is text');
});

const yNames = html => [...html.matchAll(/data-code="(\d+)"/g)].map(m => m[1]);

test('yesterday sorts by change by default and by boards on the switch', () => {
  const rows = VIEW_1027.yesterday.rows;
  const byPct = [...rows].sort((a, b) => a.pct - b.pct || 0);
  const dflt = yesterdayHtml(VIEW_1027, { kind: 'yesterday' }, {}, ID, 'K');
  assert.equal(yNames(dflt)[0], byPct[0].code);
  assert.equal(yNames(dflt).length, rows.length);
  assert.match(dflt, /data-value="pct" data-id="c1-p7" data-field="ysort"/);
  assert.match(dflt, /data-value="boards" data-id="c1-p7" data-field="ysort"/);
  const boards = yesterdayHtml(VIEW_1027, { kind: 'yesterday' }, { ysort: 'boards' }, ID, 'K');
  const top = Math.max(...rows.map(r => r.yesterdayBoards));
  const first = rows.filter(r => r.yesterdayBoards === top).sort((a, b) => a.pct - b.pct)[0];
  assert.equal(yNames(boards)[0], first.code);
  const order = yNames(boards).map(c => rows.find(r => r.code === c));
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1].yesterdayBoards >= order[i].yesterdayBoards);
});

test("yesterday's readout and tiles read the view's numbers", () => {
  const y = VIEW_1027.yesterday;
  const html = yesterdayHtml(VIEW_1027, { kind: 'yesterday', title: 'T' }, {}, ID, 'K');
  const below = `${fix2(y.belowMinus5Share * 100)}%`;
  assert.equal(readout(html), `${count(y.count)} limit-ups yesterday · median ${signedPct(y.median)} · ${below} below −5%`);
  assert.ok(text(html).includes(`Yesterday's limit-ups · ${count(y.count)}`));
  assert.ok(text(html).includes(`Median${signedPct(y.median)}`));
  assert.ok(text(html).includes(`Below −5%${below}`));
  assert.match(html, /lh-title/);
  const r = y.rows.find(x => x.pct === -10.02);
  assert.ok(text(html).includes(`${r.yesterdayBoards}b`));
  assert.ok(html.includes('style="width:100.0%"'), 'the largest move fills its bar');
});

test("yesterday's names are stock links", () => {
  const html = yesterdayHtml(VIEW_1027, { kind: 'yesterday' }, {}, ID, 'K');
  const r = VIEW_1027.yesterday.rows[0];
  assert.ok(html.includes(stockLink({ code: r.code, name: r.name }, 'K')));
  const bare = yesterdayHtml({ ...VIEW_1027, stocks: {} }, { kind: 'yesterday' }, {}, ID, 'K');
  assert.doesNotMatch(bare, /lh-stock/);
  assert.ok(text(bare).includes(r.name));
});

test('yesterday the run did not freeze, or with no names, says so', () => {
  const gone = yesterdayHtml({ ...VIEW_1027, yesterday: { unavailable: 'x' } }, { kind: 'yesterday' }, {}, ID, 'K');
  assert.ok(text(gone).includes("Yesterday's limit-ups were not frozen for this run."));
  const none = yesterdayHtml({ ...VIEW_1027, yesterday: { ...VIEW_1027.yesterday, rows: [] } }, { kind: 'yesterday' }, {}, ID, 'K');
  assert.ok(text(none).includes('No name at two boards or more yesterday.'));
});

test('signals splits its measures by side, in order, written as the digest writes them', () => {
  const s = VIEW_1027.signals;
  const html = signalsHtml(VIEW_1027, { kind: 'signals' }, {}, ID);
  assert.ok(text(html).includes('Sentiment signals'));
  assert.match(html, /chip grey|chip up|chip down|chip warn/);
  assert.ok(text(html).includes(`${s.state}money effect ${s.moneyEffect}`));
  assert.ok(text(html).includes(s.conflict));
  const cols = html.split('<div class="lh-sig-col">').slice(1);
  assert.equal(cols.length, 2);
  assert.ok(text(cols[0]).startsWith('Contraction'));
  assert.ok(text(cols[1]).startsWith('Relay'));
  assert.equal(text(cols[0]), 'ContractionBreak ratio0.41Limit-downs22Yesterday below −5%0.16');
  assert.equal(text(cols[1].split('<div class="lh-lines">')[0]), 'RelaySeal ratio0.59Yesterday median0.82Highest streak5');
});

test("signals draws the reviewer's challenges against sentiment, escaped", () => {
  const view = { ...VIEW_1027, signals: { ...VIEW_1027.signals, challenges: [{ id: 'x9', against: 'sentiment', kind: 'K', text: 'a <b>bold</b> claim' }] } };
  const html = signalsHtml(view, { kind: 'signals' }, {}, ID);
  assert.ok(html.includes('&lt;b&gt;bold&lt;/b&gt;'));
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /lh-line stress/);
  assert.ok(text(html).includes('x9'));
  const three = signalsHtml(VIEW_1027, { kind: 'signals' }, {}, ID);
  assert.equal(three.split('lh-line stress').length - 1, VIEW_1027.signals.challenges.length);
});

test('signals without sentiment says so', () => {
  const html = signalsHtml({ ...VIEW_1027, signals: null }, { kind: 'signals' }, {}, ID);
  assert.ok(text(html).includes('Sentiment was not read in this run.'));
});

test('composed draws yesterday and signals, with skeletons while loading', () => {
  const m = { id: 'p8', kind: 'composed', text: 'x', data: { blocks: [{ kind: 'yesterday' }, { kind: 'signals' }] } };
  const loaded = text(composedHtml(m, { status: 'loaded', view: VIEW_1027 }, {}, { id: 'c1' }));
  assert.ok(loaded.includes("Yesterday's limit-ups") && loaded.includes('Sentiment signals'));
  const loading = text(composedHtml(m, { status: 'loading' }, {}, { id: 'c1' }));
  assert.ok(loading.includes('Drawing yesterday…') && loading.includes('Drawing the signals…'));
});

test('null numbers draw as a dash, never as zero', () => {
  const y = { count: null, median: null, belowMinus5Share: null, rows: [{ code: '600001', name: 'A', yesterdayBoards: 2, pct: null }, { code: '600011', name: 'B', yesterdayBoards: 2, pct: -3 }], unavailable: null };
  const html = yesterdayHtml({ ...VIEW_1027, yesterday: y }, { kind: 'yesterday' }, {}, ID, 'K');
  assert.equal(readout(html), '— limit-ups yesterday · median — · — below −5%');
  assert.ok(text(html).includes('Median—') && text(html).includes('Below −5%—'));
  assert.deepEqual(yNames(html), ['600011', '600001'], 'a null change sorts last');
  assert.equal(html.split('lh-ybar-fill').length - 1, 1, 'a null change has no bar');
  assert.ok(text(html).includes('2b—'));
  const s = { ...VIEW_1027.signals, measures: [{ measure: 'break_ratio', value: null, side: 'contraction' }, { measure: 'max_streak', value: NaN, side: 'relay' }] };
  const out = text(signalsHtml({ ...VIEW_1027, signals: s }, { kind: 'signals' }, {}, ID));
  assert.ok(out.includes('Break ratio—') && out.includes('Highest streak—'));
});

// plan 3, task 5: follow-ups and Open run
const choiceAnswer = choices => ({ id: 'p9', kind: 'composed', text: '弱势日', data: { strategy: 'cn-market', run: VIEW_1027.run, blocks: [{ kind: 'sources' }], choices } });
const CHANNELS = [{ name: 'cn-market', workspaceId: 'w-cn' }, { name: 'other', workspaceId: 'w-o' }];

test('choices draw after the blocks and before the footer, escaped, in the call\'s order', () => {
  const m = choiceAnswer([{ label: '再看 <b>龙头</b>' }, { label: 'Second & third' }]);
  const html = composedHtml(m, { status: 'loaded', view: VIEW_1027 }, {}, { id: 'c1' }, CHANNELS);
  const at = s => html.indexOf(s);
  assert.ok(at('class="lh-src"') < at('class="lh-choices"') && at('class="lh-choices"') < at('class="lh-foot"'));
  assert.ok(at('再看 &lt;b&gt;龙头&lt;/b&gt;') < at('Second &amp; third'));
  assert.doesNotMatch(html, /<b>龙头/);
  assert.match(html, /<button type="button" class="lh-choice" data-action="lunhuiChoice" data-key="[^"]+" data-label="Second &amp; third">Second &amp; third<\/button>/);
});

test('a stock choice carries its code; a plain one does not', () => {
  const html = composedHtml(choiceAnswer([{ label: '看上海九百', stock: 'sh600001' }, { label: 'plain' }, { label: 'bad', stock: 'nope' }]), { status: 'loaded', view: VIEW_1027 }, {}, { id: 'c1' }, CHANNELS);
  const btns = html.match(/<button[^>]*lunhuiChoice[^>]*>/g);
  assert.equal(btns.length, 3);
  assert.match(btns[0], /data-code="600001"/);
  assert.doesNotMatch(btns[1], /data-code/);
  assert.doesNotMatch(btns[2], /data-code/);
});

test('choices draw while the view is loading and after it failed', () => {
  const m = choiceAnswer([{ label: 'go on' }]);
  for (const entry of [{ status: 'loading' }, { status: 'failed', error: 'boom' }, undefined]) {
    const html = composedHtml(m, entry, {}, { id: 'c1' }, CHANNELS);
    assert.match(html, /class="lh-choices"[^]*go on/, String(entry?.status));
    assert.doesNotMatch(html, /lh-foot/);
  }
  assert.doesNotMatch(composedHtml(choiceAnswer([]), { status: 'loaded', view: VIEW_1027 }, {}, { id: 'c1' }, CHANNELS), /lh-choices/);
});

test('Open run appears only for a known channel', () => {
  const view = { ...VIEW_1027, strategy: 'cn-market' };
  assert.match(footerHtml(view, CHANNELS), /<button type="button" class="lh-open-run" data-action="lunhuiOpenRun" data-id="w-cn">Open run ›<\/button>/);
  assert.doesNotMatch(footerHtml(view, [{ name: 'other', workspaceId: 'w-o' }]), /lh-open-run/);
  assert.doesNotMatch(footerHtml(view), /lh-open-run/);
  assert.doesNotMatch(footerHtml(view, []), /lh-open-run/);
});

// final-review fixes
test('linkNames leaves a name inside <code> or <pre> as it is', () => {
  const view = { stocks: { 600001: { name: '上海九百' } } };
  for (const html of ['<p><code class="md-code">上海九百</code></p>', '<pre class="md-fence"><code>上海九百 x</code></pre>', '<pre>上海九百</pre>']) {
    assert.equal(linkNames(html, view, 'K'), html);
  }
  assert.match(linkNames('<p><code>x</code> 上海九百</p>', view, 'K'), /<\/code> <button[^>]*data-code="600001">上海九百<\/button>/, 'after the code span it links again');
});

test("a yesterday row whose boards is null draws a dash, never a bare 'b'", () => {
  const y = { ...VIEW_1027.yesterday, rows: [{ code: '600011', name: 'B', yesterdayBoards: null, pct: -3 }] };
  const html = yesterdayHtml({ ...VIEW_1027, yesterday: y }, { kind: 'yesterday' }, {}, ID, 'K');
  assert.match(html, /<span class="lh-yb">—<\/span>/);
});

// the first live run (2026-10-31): a negative two-decimal figure reads with U+2212, never an ASCII hyphen or −0.00
test('fix2 writes a negative with U+2212 and a value that rounds to zero as 0.00', () => {
  assert.equal(fix2(-0.28), '−0.28');
  assert.equal(fix2(-0.004), '0.00');
  assert.equal(fix2(0.004), '0.00');
  assert.equal(fix2(3599.02), '3599.02');
  assert.equal(fix2(null), '—');
  assert.equal(fix2(NaN), '—');
  const s = { ...VIEW_1027.signals, measures: VIEW_1027.signals.measures.map(m => (m.measure === 'yesterday_return_median' ? { ...m, value: -0.28 } : m)) };
  const out = text(signalsHtml({ ...VIEW_1027, signals: s }, { kind: 'signals' }, {}, ID));
  assert.ok(out.includes('Yesterday median−0.28'), out);
  assert.ok(!out.includes('-0.28'));
});

// the face's amounts carry a 万 tier the digest does not (the drawer's seal funds read ¥57075239 on the first live run)
test('yuan: 万亿 from 1e12, 亿 from 1e8, 万 from 1e4, whole yuan below, a dash for none', () => {
  assert.equal(yuan(57075239), '¥5707.52万');
  assert.equal(yuan(98765432), '¥9876.54万');
  assert.equal(yuan(9999), '¥9999');
  assert.equal(yuan(10000), '¥1.00万');
  assert.equal(yuan(35_012_000_000), '¥350.12亿');
  assert.equal(yuan(1_460_000_000_000), '¥1.46万亿');
  assert.equal(yuan(null), '—');
  assert.equal(yuan(Infinity), '—');
});

test("the sources' codes and modules, a bucket's label and a rung's names are listed under the table's separator and order", async () => {
  const { withTable } = await import('../../client/js/i18n/words.js');
  withTable({ 'common.list.sep': '、', 'lunhui.breadth.bucketLabel': '{stocks} ({bucket})' }, () => {
    const rows = [...sourcesHtml(VIEW_1027, { kind: 'sources' }).matchAll(/<div class="lh-src">([\s\S]*?)<\/div>/g)].map(x => text(x[1]));
    assert.match(rows[2], /^boards✗ UPSTREAM_TIMEOUT、UPSTREAM_INVALID ×2/);
    assert.match(breadthHtml(VIEW_1027, { kind: 'breadth' }, { breadth: 'dist' }, ID), /aria-label="1,023 stocks \(Bucket −4\)"/);
    const focused = ladderHtml(VIEW_1027, { kind: 'ladder', focus: { rung: 3 } }, {}, ID);
    assert.match(readout(focused), /missed: 样本000022 \+1\.00%、/);
  });
});
