// The six Lunhui modules' static table and its pure view (module cards spec §5.1, §5.3, Appendix A): the chips, the
// latest run each card reads, the shelf's six items, the page's rows and boxes — from /data/modules.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODULES, MODULE_NAMES, moduleOf, latestOf, headlineWords, chipOf, researchItems, runsOf, pageOf,
} from '../../client/js/host/modules-view.js';
import { modulesListing, MARKET_RUN, S01_RUN } from './helpers/inventory.js';

const channelOf = (l, name) => l.channels.find(c => c.channel === name);
const ok = (headline, marketRun = null) => ({ status: 'OK', missingSources: [], headline, marketRun });

test('MODULES: six, in the chain order, each with its file, tools and headline fields', () => {
  assert.deepEqual(MODULES.map(m => m.name), ['environment', 'sentiment', 'theme', 'leader', 'mode', 'counterevidence']);
  assert.deepEqual(MODULES.map(m => m.channels), ['market', 'market', 'market', 'strategy', 'strategy', 'either']);
  assert.deepEqual(moduleOf('theme').tools, ['lunhui_read_theme_context', 'lunhui_submit_theme']);
  assert.equal(moduleOf('nope'), null);
  assert.equal(MODULES.filter(m => m.legend).map(m => m.name).join(','), 'sentiment,leader,mode,counterevidence');
  assert.ok(Object.isFrozen(MODULES));
  assert.deepEqual([...MODULE_NAMES], MODULES.map(m => m.name));
  assert.deepEqual(MODULES.map(m => m.file), MODULES.map(m => `${m.name}.json`));
  assert.ok(MODULES.every(m => m.route === 'deepseek-official/deepseek-flash'));
});

test('MODULES: the legends — the seven labels, the six flags, the eight preconditions, ten rulings then five kinds', () => {
  const rows = name => moduleOf(name).legend.rows;
  assert.equal(moduleOf('sentiment').legend.title, "The text's stages beside the seven labels");
  assert.deepEqual(rows('sentiment').map(r => r.label), ['CHAOS', 'IGNITION', 'EXPANSION', 'CLIMAX', 'RETREAT', 'REPAIR', 'UNKNOWN']);
  assert.match(rows('sentiment')[0].text, /P0161/);
  assert.equal(moduleOf('leader').legend.title, 'The flags, as the contract words them');
  assert.deepEqual(rows('leader').map(r => r.label), ['ACCELERATING', 'DIVERGENCE', 'BROKEN_STREAK', 'HIGH_POSITION', 'FIRST_BOARD', 'NONE']);
  assert.equal(moduleOf('mode').legend.title, 'The preconditions, as the contract names them');
  assert.deepEqual(rows('mode').map(r => r.label), [
    'theme_gate', 'candidate_before_divergence', 'theme_not_falsified', 'negative_tail_not_widening', 'minute_confirmation',
    'old_theme_retreat', 'catalyst', 'candidates_pooled',
  ]);
  assert.equal(moduleOf('counterevidence').legend.title, 'The ten rulings and the five kinds');
  assert.equal(rows('counterevidence').length, 15);
  assert.deepEqual(rows('counterevidence').slice(10).map(r => r.label), ['CONTRADICTS', 'MISSING_EVIDENCE', 'STALE', 'RULING_CONFLICT', 'OVERREACH']);
  assert.equal(rows('counterevidence')[0].text, 'P0016 vs P0574, P0782, P0855');
  for (const m of MODULES.filter(x => x.legend)) {
    for (const r of m.legend.rows) assert.ok(r.label && r.text, `${m.name} ${r.label}`);
  }
});

test('chipOf: the fixture day — the six chips of spec §5.1', () => {
  const l = modulesListing();
  assert.deepEqual(chipOf(l, 'environment'), { text: 'WEAK · STABLE', tone: 'ok' });
  assert.deepEqual(chipOf(l, 'sentiment'), { text: 'IGNITION · POSITIVE · NONE', tone: 'ok' });
  assert.deepEqual(chipOf(l, 'theme'), { text: 'not evaluable · boards', tone: 'warn' });
  assert.deepEqual(chipOf(l, 'leader'), { text: 'lunhui-s01-repair · no candidate', tone: 'grey' });
  assert.deepEqual(chipOf(l, 'mode'), { text: 'lunhui-s01-repair · WAIT', tone: 'grey' });
  assert.deepEqual(chipOf(l, 'counterevidence'), { text: 'lunhui-s01-repair · 5 items', tone: 'ok' }, 'the strategy run is newer than the market run');
});

test('chipOf: headlines with content — candidates, flags, a frozen card, one item', () => {
  const l = modulesListing();
  const market = channelOf(l, 'cn-market').runs[0].artifacts;
  market.theme = ok({ mainline_candidates: [{}, {}], theme_stage: 'FERMENT', rotation: 'ROTATING' });
  const s01 = channelOf(l, 'lunhui-s01-repair').runs[0].artifacts;
  s01.leader = ok({ leader_candidates: [{}, {}], top_pattern_flags: ['HIGH_POSITION', 'DIVERGENCE'] }, MARKET_RUN);
  s01.mode = ok({ mode: 'S01', expectation: {} }, MARKET_RUN);
  s01.counterevidence = ok({ items: [{}] }, MARKET_RUN);
  assert.equal(chipOf(l, 'theme').text, '2 candidates · FERMENT · ROTATING');
  assert.deepEqual(chipOf(l, 'leader'), { text: 'lunhui-s01-repair · 2 candidates · HIGH_POSITION', tone: 'ok' });
  assert.deepEqual(chipOf(l, 'mode'), { text: 'lunhui-s01-repair · S01 · card frozen', tone: 'ok' });
  assert.equal(chipOf(l, 'counterevidence').text, 'lunhui-s01-repair · 1 item');
});

test('chipOf: not run, no run yet, an empty listing, rows not mounted', () => {
  const l = modulesListing();
  delete channelOf(l, 'cn-market').runs[0].artifacts.sentiment;
  assert.deepEqual(chipOf(l, 'sentiment'), { text: 'not run', tone: 'grey' });
  channelOf(l, 'cn-market').runs = [];
  assert.deepEqual(chipOf(l, 'environment'), { text: 'no run yet', tone: 'grey' });
  assert.deepEqual(chipOf({ ok: true, mounted: true, channels: [] }, 'leader'), { text: 'no run yet', tone: 'grey' });
  assert.deepEqual(chipOf(null, 'environment'), { text: 'no run yet', tone: 'grey' });
  const n = modulesListing();
  channelOf(n, 'cn-market').runs[0].artifacts.theme.missingSources = [];
  assert.deepEqual(chipOf(n, 'theme'), { text: 'not evaluable', tone: 'warn' });
  assert.deepEqual(chipOf(modulesListing(), 'environment', false), { text: 'WEAK · STABLE', tone: 'grey' });
  assert.equal(researchItems(modulesListing(), false)[0].dim, true);
  assert.equal(researchItems(modulesListing(), true)[0].dim, false);
});

test('latestOf: a strategy card reads the newest run across strategies, an either card across all channels', () => {
  const l = modulesListing();
  assert.deepEqual(latestOf(l, 'environment'), {
    channel: 'cn-market', workspaceId: 'ws-cn-market', run: MARKET_RUN, session: '2026-10-28',
    openedAt: '2026-10-28T02:09:53.000Z', sealedAt: '2026-10-28T02:10:02.000Z',
    artifact: { status: 'OK', missingSources: [], headline: { index_state: 'WEAK', liquidity_state: 'STABLE', cycle_anchor: '低位反抽' }, marketRun: null },
  });
  assert.equal(latestOf(l, 'leader').run, S01_RUN);
  assert.equal(latestOf(l, 'counterevidence').channel, 'lunhui-s01-repair');
  const newer = '20261029T010000Z-aaaaaaaa';
  channelOf(l, 'lunhui-s02-rotation').runs = [{
    run: newer, session: '2026-10-29', asOf: null, openedAt: '2026-10-29T01:00:00.000Z', sealedAt: '2026-10-29T01:00:09.000Z', frozen: ['quotes'],
    artifacts: { leader: ok({ leader_candidates: [{}], top_pattern_flags: ['FIRST_BOARD'] }, MARKET_RUN) },
  }];
  const leader = latestOf(l, 'leader');
  assert.equal(leader.channel, 'lunhui-s02-rotation');
  assert.equal(leader.workspaceId, 'ws-lunhui-s02-rotation');
  assert.equal(leader.run, newer);
  assert.equal(leader.artifact.marketRun, MARKET_RUN);
  const ce = latestOf(l, 'counterevidence');
  assert.equal(ce.channel, 'lunhui-s02-rotation', 'the newest run across all channels');
  assert.equal(ce.artifact, null, "s02's run lacks a counterevidence artifact");
  assert.deepEqual(chipOf(l, 'counterevidence'), { text: 'not run', tone: 'grey' });
  assert.equal(runsOf(l, 'counterevidence')[0].channel, 'lunhui-s01-repair', "the page's rows skip a run without the artifact");
  assert.equal(latestOf(null, 'leader'), null);
  assert.equal(latestOf(l, 'nope'), null);
});

test('headlineWords: malformed headlines read as empty counts and names, never undefined', () => {
  assert.equal(headlineWords('theme', { mainline_candidates: 'x' }), '0 candidates');
  assert.equal(headlineWords('counterevidence', {}), '0 items');
  assert.equal(headlineWords('leader', { leader_candidates: [{}], top_pattern_flags: [] }), '1 candidate');
  assert.equal(headlineWords('leader', {}), 'no candidate');
  assert.equal(headlineWords('mode', { mode: 7 }), 'Mode');
  assert.equal(headlineWords('mode', { mode: 'WAIT', expectation: [] }), 'WAIT');
  assert.equal(headlineWords('environment', {}), 'Environment');
  assert.equal(headlineWords('environment', null), 'Environment');
  assert.equal(headlineWords('sentiment', { state: 'CHAOS' }), 'CHAOS');
  assert.doesNotMatch(headlineWords('sentiment', { state: 'CHAOS' }), /undefined/);
});

test('researchItems: six items, ids, lines, meta and marks; an empty listing: six cards, every chip no run yet', () => {
  const items = researchItems(modulesListing(), true);
  assert.deepEqual(items.map(i => i.id), ['module:environment', 'module:sentiment', 'module:theme', 'module:leader', 'module:mode', 'module:counterevidence']);
  assert.deepEqual(items.map(i => i.meta), ['CN market analyst · cn-market', 'CN market analyst · cn-market', 'CN market analyst · cn-market', 'CN stock analyst · a strategy', 'CN stock analyst · a strategy', 'CN reviewer · cn-market or a strategy']);
  assert.deepEqual(items[0].mark, { type: 'glyph', icon: 'layers' });
  assert.equal(items[0].shelf, 'research');
  assert.equal(items[0].kind, 'Module');
  assert.equal(items[0].name, 'Environment');
  assert.equal(items[0].line, '环境与大周期 · index · liquidity · cycle anchor');
  assert.equal(items[0].source, MODULES[0]);
  assert.deepEqual(items[2].chip, { text: 'not evaluable · boards', tone: 'warn' });
  assert.ok(researchItems(null, true).every(i => i.chip.text === 'no run yet'));
  assert.equal(researchItems(null, true).length, 6);
});

test('runsOf and pageOf: the rows across channels newest first, the three boxes', () => {
  const rows = runsOf(modulesListing(), 'counterevidence');
  assert.deepEqual(rows.map(r => [r.channel, r.words]), [['lunhui-s01-repair', '5 items'], ['cn-market', '4 items']]);
  assert.deepEqual(rows[1], {
    channel: 'cn-market', workspaceId: 'ws-cn-market', run: MARKET_RUN, session: '2026-10-28',
    openedAt: '2026-10-28T02:09:53.000Z', sealedAt: '2026-10-28T02:10:02.000Z', status: 'OK', words: '4 items',
  });
  const page = pageOf(modulesListing(), 'theme', true);
  assert.equal(page.module, moduleOf('theme'));
  assert.deepEqual(page.chip, { text: 'not evaluable · boards', tone: 'warn' });
  assert.equal(page.latest.run, MARKET_RUN);
  assert.deepEqual(page.kv.reads, [['Freezes', 'boards and limit-up freezes'], ['Artifacts', 'no artifact'], ['Channel', 'cn-market']]);
  assert.deepEqual(page.kv.writes, [['File', 'theme.json'], ['Headline', 'mainline_candidates · theme_stage · rotation'], ['Under', 'strategies/cn-market/analysis/<run>/']]);
  assert.deepEqual(page.kv.runsOn, [['Role', 'CN market analyst'], ['Route', 'deepseek-official/deepseek-flash'], ['Budget', '10 calls per run · one artifact per run']]);
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0].status, 'NOT_EVALUABLE');
  assert.equal(page.rows[0].words, 'not evaluable · boards');
  assert.equal(pageOf(modulesListing(), 'leader', true).kv.writes[2][1], 'strategies/a strategy/analysis/<run>/');
});

test('runsOf: at most 24 rows, newest first by run id', () => {
  const l = modulesListing();
  const runs = Array.from({ length: 30 }, (_, i) => ({
    run: `202610${String(i + 1).padStart(2, '0')}T000000Z-00000000`, session: null, asOf: null, openedAt: null, sealedAt: null, frozen: [],
    artifacts: { environment: ok({ index_state: 'WEAK' }) },
  }));
  channelOf(l, 'cn-market').runs = runs.slice().reverse();
  const rows = runsOf(l, 'environment');
  assert.equal(rows.length, 24);
  assert.equal(rows[0].run, '20261030T000000Z-00000000');
  assert.deepEqual(runsOf(null, 'environment'), []);
});
