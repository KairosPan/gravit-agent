// The run sheet's pure view (module cards spec §4 G5, G11–G16, G18, §5.4–§5.5, Appendix B): each card's
// preselections, its Where, On, Cites, Stocks and source line, the greying and its reasons, the title and the Chinese
// message — from /data/modules.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSheet, sheetOf, stocksOf, titleOf, messageOf } from '../../client/js/host/run-sheet-view.js';
import { modulesListing, MARKET_RUN, S01_RUN } from './helpers/inventory.js';

const l = modulesListing();
// a local 14:00 on 2026-10-28, so the browser's date is 10-28 in any zone
const fixed = new Date(2026, 9, 28, 14, 0).getTime();
const channelOf = (listing, name) => listing.channels.find(c => c.channel === name);
const runOf = (listing, name) => channelOf(listing, name).runs[0];
const ok = (headline, marketRun = null) => ({ status: 'OK', missingSources: [], headline, marketRun });
const marketRun = (run, extra = {}) => ({
  run, session: `${run.slice(0, 4)}-${run.slice(4, 6)}-${run.slice(6, 8)}`, asOf: null, openedAt: null,
  sealedAt: '2026-10-29T02:00:00.000Z', frozen: ['index', 'limit-up', 'boards'], artifacts: {}, ...extra,
});

test('newSheet: the preselections per card', () => {
  assert.deepEqual(newSheet(l, 'theme'), { module: 'theme', where: 'cn-market', on: 'new', run: MARKET_RUN, cites: null, stocks: '', note: '', said: null }, 'theme.json is there, so New run');
  assert.equal(newSheet(l, 'sentiment').on, 'new');
  assert.deepEqual(newSheet(l, 'leader'), { module: 'leader', where: 'lunhui-s01-repair', on: 'new', run: S01_RUN, cites: MARKET_RUN, stocks: '', note: '', said: null });
  assert.equal(newSheet(l, 'mode').on, null, 'mode is already registered: nothing selectable');
  assert.equal(newSheet(l, 'mode').run, S01_RUN);
  assert.equal(newSheet(l, 'counterevidence').where, 'lunhui-s01-repair', 'the newest review run is the strategy\'s');
  assert.equal(newSheet(l, 'nope'), null);
});

test('newSheet: no run anywhere — the first strategy for Leader and Mode, cn-market for Counterevidence, run null', () => {
  const e = modulesListing();
  for (const c of e.channels) c.runs = [];
  assert.deepEqual(newSheet(e, 'leader'), { module: 'leader', where: 'lunhui-s01-repair', on: 'new', run: null, cites: null, stocks: '', note: '', said: null });
  assert.equal(newSheet(e, 'mode').where, 'lunhui-s01-repair');
  assert.equal(newSheet(e, 'mode').on, null);
  assert.equal(newSheet(e, 'counterevidence').where, 'cn-market');
  assert.equal(newSheet(e, 'environment').on, 'new', 'a market card with no run offers New run alone');
});

test('sheetOf: a market card — Where fixed, Latest run greyed with its reason, New run preselected with the whole-set line', () => {
  const v = sheetOf(l, newSheet(l, 'theme'), fixed);
  assert.equal(v.title, 'Run Theme');
  assert.deepEqual(v.where, { options: [{ value: 'cn-market', label: 'cn-market' }], value: 'cn-market', fixed: true });
  assert.deepEqual(v.on.options.map(o => [o.id, o.enabled, o.reason]), [['latest', false, 'theme already there'], ['new', true, null]]);
  assert.equal(v.on.options[0].label, `Latest run · ${MARKET_RUN} · session 2026-10-28`);
  assert.equal(v.on.options[0].detail, 'frozen: index · limit-up');
  assert.equal(v.on.options[1].label, 'New run');
  assert.equal(v.on.options[1].detail, 'Gravit freezes index · limit-up · boards, then the CN market analyst writes Theme alone; the other two market modules stay not run on that run until run from their cards');
  assert.equal(v.on.value, 'new');
  assert.equal(v.source, 'boards missing in the last run', 'the fixture run froze no boards');
  assert.equal(v.cites, null); assert.equal(v.stocks, null);
  assert.equal(v.note.value, '');
  assert.equal(v.via, 'Gravit in cn-market → CN market analyst, theme alone');
  assert.equal(v.writes, 'theme.json · a conversation "Theme · 10-28"');
  assert.equal(v.canRun, true);
  assert.equal(v.blocker, null);
  assert.equal(sheetOf(l, newSheet(l, 'environment'), fixed).source, null, 'the source line is Theme\'s alone');
});

test('sheetOf: a market card whose latest run lacks the artifact offers Latest run enabled', () => {
  const x = modulesListing();
  delete runOf(x, 'cn-market').artifacts.sentiment;
  const s = newSheet(x, 'sentiment');
  assert.equal(s.on, 'latest');
  const v = sheetOf(x, s, fixed);
  assert.deepEqual(v.on.options.map(o => [o.id, o.enabled, o.reason]), [['latest', true, null], ['new', true, null]]);
  assert.equal(v.canRun, true);
});

test('sheetOf: a market card on a channel with no run — Latest run absent, an open run labelled by its opened date', () => {
  const x = modulesListing();
  channelOf(x, 'cn-market').runs = [];
  assert.deepEqual(sheetOf(x, newSheet(x, 'environment'), fixed).on.options.map(o => o.id), ['new']);
  assert.equal(sheetOf(x, newSheet(x, 'theme'), fixed).source, null, 'no runs, no source line');
  const y = modulesListing();
  Object.assign(runOf(y, 'cn-market'), { session: null, sealedAt: null, openedAt: '2026-10-29T01:00:00.000Z', artifacts: {} });
  assert.equal(sheetOf(y, newSheet(y, 'environment'), fixed).on.options[0].label, `Latest run · ${MARKET_RUN} · session 2026-10-29`);
});

test('sheetOf: Latest run no longer the latest — greyed and blocked until On is chosen again', () => {
  const x = modulesListing();
  delete runOf(x, 'cn-market').artifacts.sentiment;
  const s = newSheet(x, 'sentiment');
  assert.equal(s.run, MARKET_RUN);
  channelOf(x, 'cn-market').runs.unshift(marketRun('20261029T020000Z-aaaaaaaa'));
  const v = sheetOf(x, s, fixed);
  assert.deepEqual(v.on.options.map(o => [o.id, o.enabled, o.reason]), [['latest', false, 'run no longer the latest'], ['new', true, null]]);
  assert.equal(v.canRun, false);
  assert.equal(v.blocker, 'run no longer the latest');
  const restamped = { ...s, run: '20261029T020000Z-aaaaaaaa' };
  assert.equal(sheetOf(x, restamped, fixed).canRun, true);
  assert.equal(sheetOf(x, { ...s, on: 'new' }, fixed).on.options[0].enabled, true, 'only a chosen Latest run goes stale');
});

test('sheetOf: Leader — Where the strategies, Cites the two newest sealed market runs with the theme line, Stocks optional', () => {
  const v = sheetOf(l, newSheet(l, 'leader'), fixed);
  assert.deepEqual(v.where.options.map(o => o.value), ['lunhui-s01-repair', 'lunhui-s02-rotation']);
  assert.equal(v.where.fixed, false);
  assert.deepEqual(v.on.options.map(o => [o.id, o.enabled, o.reason]), [['latest', false, 'leader already there'], ['new', true, null]]);
  assert.equal(v.on.options[1].detail, 'Gravit freezes quotes for the stocks, which opens the run');
  assert.equal(v.cites.readOnly, false);
  assert.deepEqual(v.cites.options.map(o => o.value), [MARKET_RUN]);
  assert.equal(v.cites.options[0].label, `${MARKET_RUN} · session 2026-10-28 · frozen: index · limit-up · theme not evaluable`);
  assert.equal(v.cites.value, MARKET_RUN);
  assert.equal(v.cites.line, 'theme not evaluable: the pick comes from the limit-up pool alone');
  assert.equal(v.cites.options[0].warning, null, 'sentiment and theme are both there');
  assert.equal(v.stocks.value, '');
  assert.equal(v.stocks.error, null);
  assert.match(v.stocks.hint, /^optional · 1–4 main-board codes, sh60… or sz00…; empty: Gravit picks/);
  assert.equal(v.source, null);
  assert.equal(v.via, 'Gravit in lunhui-s01-repair → CN stock analyst, leader alone');
  assert.equal(v.canRun, true);
});

test('sheetOf: Leader Cites — the two newest sealed, an open run left out, the theme words and the warnings', () => {
  const x = modulesListing();
  const runs = channelOf(x, 'cn-market').runs;
  runs.unshift(
    marketRun('20261030T020000Z-cccccccc', { sealedAt: null }),
    marketRun('20261029T020000Z-bbbbbbbb', { artifacts: { sentiment: ok({}), theme: ok({ mainline_candidates: [{}], theme_stage: 'FERMENT', rotation: 'NONE' }) } }),
  );
  runs.push(marketRun('20261027T020000Z-oooooooo', { artifacts: { sentiment: ok({}), theme: ok({}) } }));
  const s = newSheet(x, 'leader');
  assert.equal(s.cites, '20261029T020000Z-bbbbbbbb', 'the newest sealed market run');
  const v = sheetOf(x, s, fixed);
  assert.deepEqual(v.cites.options.map(o => o.value), ['20261029T020000Z-bbbbbbbb', MARKET_RUN]);
  assert.match(v.cites.options[0].label, / · theme 1 candidate · FERMENT · NONE$/);
  assert.equal(v.cites.line, null, 'the chosen cite has an OK theme');
  assert.equal(v.cites.options[0].warning, null);
  const y = modulesListing();
  channelOf(y, 'cn-market').runs.unshift(marketRun('20261029T020000Z-bbbbbbbb'));
  const w = sheetOf(y, newSheet(y, 'leader'), fixed);
  assert.match(w.cites.options[0].label, / · theme not run$/);
  assert.equal(w.cites.options[0].warning, 'Mode and Counterevidence on this cite would be not evaluable');
  assert.equal(w.cites.line, null);
  const none = { ...newSheet(x, 'leader'), cites: null };
  assert.equal(sheetOf(x, none, fixed).canRun, false);
  assert.equal(sheetOf(x, none, fixed).blocker, 'choose a market run to cite');
});

test('sheetOf: Leader Stocks — a bad code blocks the run with its error', () => {
  const v = sheetOf(l, { ...newSheet(l, 'leader'), stocks: 'sh600000 sz300750' }, fixed);
  assert.equal(v.stocks.error, 'not a main-board code: sz300750');
  assert.equal(v.canRun, false);
  assert.equal(v.blocker, 'not a main-board code: sz300750');
});

test('sheetOf: a channel with no runs — Leader New run alone; Mode and Counterevidence grey with no run yet', () => {
  const s = { ...newSheet(l, 'leader'), where: 'lunhui-s02-rotation', run: null };
  assert.deepEqual(sheetOf(l, s, fixed).on.options.map(o => o.id), ['new']);
  assert.equal(sheetOf(l, s, fixed).canRun, true);
  const m = { ...newSheet(l, 'mode'), where: 'lunhui-s02-rotation', on: null, run: null };
  assert.deepEqual(sheetOf(l, m, fixed).on.options.map(o => [o.id, o.enabled, o.reason]), [['latest', false, 'no run yet']]);
  assert.equal(sheetOf(l, m, fixed).canRun, false);
  assert.equal(sheetOf(l, m, fixed).blocker, 'choose a run');
  const c = { ...newSheet(l, 'counterevidence'), where: 'lunhui-s02-rotation', on: 'latest', run: null };
  assert.deepEqual(sheetOf(l, c, fixed).on.options.map(o => [o.id, o.enabled, o.reason]), [['latest', false, 'no run yet']]);
  assert.equal(sheetOf(l, c, fixed).blocker, 'no run yet');
});

test('sheetOf: Mode — Latest run only, its three reasons, the read-only cite', () => {
  const v = sheetOf(l, newSheet(l, 'mode'), fixed);
  assert.deepEqual(v.on.options.map(o => [o.id, o.enabled, o.reason]), [['latest', false, 'mode already registered on this run']]);
  assert.deepEqual(v.where.options.map(o => o.value), ['lunhui-s01-repair', 'lunhui-s02-rotation']);

  const x = modulesListing();
  delete runOf(x, 'lunhui-s01-repair').artifacts.mode;
  const s = newSheet(x, 'mode');
  assert.equal(s.on, 'latest');
  const w = sheetOf(x, s, fixed);
  assert.deepEqual(w.on.options.map(o => [o.id, o.enabled, o.reason]), [['latest', true, null]]);
  assert.deepEqual(w.cites, { readOnly: true, options: [{ value: MARKET_RUN, label: `${MARKET_RUN} · the run's leader cites it`, warning: null }], value: MARKET_RUN, line: null });
  assert.equal(w.stocks, null);
  assert.equal(w.via, 'Gravit in lunhui-s01-repair → CN stock analyst, mode alone');
  assert.equal(w.canRun, true);

  const y = modulesListing();
  delete runOf(y, 'lunhui-s01-repair').artifacts.mode;
  delete runOf(y, 'lunhui-s01-repair').artifacts.counterevidence;
  assert.deepEqual(sheetOf(y, { ...newSheet(y, 'mode'), on: 'latest' }, fixed).on.options.map(o => [o.id, o.enabled, o.reason]),
    [['latest', false, 'needs Leader, then Counterevidence, on this run']]);

  const z = modulesListing();
  delete runOf(z, 'lunhui-s01-repair').artifacts.mode;
  runOf(z, 'lunhui-s01-repair').artifacts.leader.marketRun = null;
  const u = sheetOf(z, newSheet(z, 'mode'), fixed);
  assert.deepEqual(u.cites, { readOnly: true, options: [], value: null, line: null });
  assert.equal(u.blocker, "the run's leader names no market run");
  assert.equal(u.canRun, false);
});

test('sheetOf: Counterevidence — cn-market reviews line and names the modules not run; a strategy warns when mode is there', () => {
  const where = sheetOf(l, newSheet(l, 'counterevidence'), fixed).where;
  assert.deepEqual(where.options.map(o => o.value), ['cn-market', 'lunhui-s01-repair', 'lunhui-s02-rotation']);
  assert.equal(where.fixed, false);

  const market = sheetOf(l, { ...newSheet(l, 'counterevidence'), where: 'cn-market', run: MARKET_RUN }, fixed);
  assert.deepEqual(market.on.options.map(o => [o.id, o.enabled, o.reason]), [['latest', false, 'review already there']]);
  assert.equal(market.cites, null);
  assert.equal(market.via, 'Gravit in cn-market → CN reviewer, counterevidence alone');

  const x = modulesListing();
  delete runOf(x, 'cn-market').artifacts.counterevidence;
  delete runOf(x, 'cn-market').artifacts.theme;
  const v = sheetOf(x, { ...newSheet(x, 'counterevidence'), where: 'cn-market', on: 'latest', run: MARKET_RUN }, fixed);
  assert.deepEqual(v.on.options.map(o => [o.id, o.enabled, o.reason]), [['latest', true, null]]);
  assert.equal(v.on.options[0].detail, 'reviews: environment · sentiment — Theme not run on this run');
  assert.equal(v.canRun, true);

  const y = modulesListing();
  runOf(y, 'cn-market').artifacts = {};
  const e = sheetOf(y, { ...newSheet(y, 'counterevidence'), where: 'cn-market', on: 'latest', run: MARKET_RUN }, fixed);
  assert.deepEqual(e.on.options.map(o => [o.id, o.enabled, o.reason]), [['latest', false, 'no market artifact yet on this run']]);

  const strat = sheetOf(l, newSheet(l, 'counterevidence'), fixed);
  assert.deepEqual(strat.on.options.map(o => [o.id, o.enabled, o.reason]), [['latest', false, 'review already there']]);
  assert.equal(strat.cites.readOnly, true);
  assert.equal(strat.cites.value, MARKET_RUN);

  const z = modulesListing();
  delete runOf(z, 'lunhui-s01-repair').artifacts.counterevidence;
  const s = newSheet(z, 'counterevidence');
  assert.equal(s.on, 'latest');
  const w = sheetOf(z, s, fixed);
  assert.equal(w.on.options[0].enabled, true);
  assert.match(w.on.options[0].detail, /warning: mode already registered on this run — this review would go unanswered/);
  assert.equal(w.canRun, true);
  const n = modulesListing();
  delete runOf(n, 'lunhui-s01-repair').artifacts.counterevidence;
  delete runOf(n, 'lunhui-s01-repair').artifacts.mode;
  assert.doesNotMatch(sheetOf(n, newSheet(n, 'counterevidence'), fixed).on.options[0].detail, /warning/);
});

test('sheetOf: the Theme source line — all the last runs, some of them, none', () => {
  const x = modulesListing();
  channelOf(x, 'cn-market').runs.unshift(marketRun('20261029T020000Z-bbbbbbbb', { frozen: ['index', 'limit-up'] }));
  assert.equal(sheetOf(x, newSheet(x, 'theme'), fixed).source, 'boards missing in the last 2 runs');
  const y = modulesListing();
  channelOf(y, 'cn-market').runs.unshift(marketRun('20261029T020000Z-bbbbbbbb'));
  assert.equal(sheetOf(y, newSheet(y, 'theme'), fixed).source, 'boards missing in 1 of the last 2 runs');
  const z = modulesListing();
  runOf(z, 'cn-market').frozen = ['index', 'limit-up', 'boards'];
  assert.equal(sheetOf(z, newSheet(z, 'theme'), fixed).source, null);
});

test('stocksOf: normalises, folds duplicates, names the first offender, caps at four', () => {
  assert.deepEqual(stocksOf('SH600000，sz000001 sh600000'), { codes: ['sh600000', 'sz000001'], error: null });
  assert.deepEqual(stocksOf('sz300750'), { codes: [], error: 'not a main-board code: sz300750' });
  assert.deepEqual(stocksOf('600000'), { codes: [], error: 'not a main-board code: 600000' });
  assert.deepEqual(stocksOf('sh600000、sh600001、sh600002、sh600003、sh600004').error, 'at most 4 codes');
  assert.deepEqual(stocksOf('sh600000,sh600001, sh600002 sh600003'), { codes: ['sh600000', 'sh600001', 'sh600002', 'sh600003'], error: null });
  assert.deepEqual(stocksOf('  '), { codes: [], error: null });
});

test('titleOf: the run\'s session for a latest run, the browser\'s date for a new one', () => {
  assert.equal(titleOf(l, { ...newSheet(l, 'leader'), on: 'latest' }, fixed), 'Leader · 10-28');
  assert.equal(titleOf(l, newSheet(l, 'theme'), new Date(2026, 9, 29, 3, 0)), 'Theme · 10-29');
  const y = modulesListing();
  Object.assign(runOf(y, 'cn-market'), { session: null, sealedAt: null, openedAt: '2026-10-30T01:00:00.000Z' });
  assert.equal(titleOf(y, { ...newSheet(y, 'environment'), on: 'latest' }, fixed), 'Environment · 10-30', 'an open run by its opened date');
});

test('messageOf: Appendix B, slot by slot', () => {
  assert.equal(messageOf(l, { ...newSheet(l, 'theme'), on: 'new' }), '请只跑 Lunhui 的 theme 模块：频道 cn-market，开新运行——先按 lunhui:run 第 1 步冻结整套（index、limit-up、boards），再只写 theme。');
  assert.equal(messageOf(l, { ...newSheet(l, 'sentiment'), on: 'latest' }), `请只跑 Lunhui 的 sentiment 模块：频道 cn-market，运行 ${MARKET_RUN}（已有运行，不要再冻结）。`);
  assert.equal(messageOf(l, { ...newSheet(l, 'leader'), on: 'new', stocks: 'sh600000 sz000001' }), `请只跑 Lunhui 的 leader 模块：策略 lunhui-s01-repair，开新运行，引用 cn-market 运行 ${MARKET_RUN}；股票 sh600000、sz000001。`);
  assert.equal(messageOf(l, { ...newSheet(l, 'leader'), on: 'new' }), `请只跑 Lunhui 的 leader 模块：策略 lunhui-s01-repair，开新运行，引用 cn-market 运行 ${MARKET_RUN}；股票 由你从该市场运行的主线成分股与涨停池里选 1–4 只主板个股。`);
  assert.equal(messageOf(l, { ...newSheet(l, 'leader'), on: 'latest' }), `请只跑 Lunhui 的 leader 模块：策略 lunhui-s01-repair，运行 ${S01_RUN}（已有运行），引用 cn-market 运行 ${MARKET_RUN}。`);
  assert.equal(messageOf(l, { ...newSheet(l, 'counterevidence'), where: 'cn-market', on: 'latest' }), `请只跑 Lunhui 的 counterevidence 模块：频道 cn-market，运行 ${MARKET_RUN}（已有运行）。`);
  assert.equal(messageOf(l, { ...newSheet(l, 'counterevidence'), on: 'latest' }), `请只跑 Lunhui 的 counterevidence 模块：策略 lunhui-s01-repair，运行 ${S01_RUN}（已有运行），引用 cn-market 运行 ${MARKET_RUN}。`);
  assert.equal(messageOf(l, { ...newSheet(l, 'mode'), on: 'latest' }), `请只跑 Lunhui 的 mode 模块：策略 lunhui-s01-repair，运行 ${S01_RUN}（已有运行），引用 cn-market 运行 ${MARKET_RUN}。`);
  assert.equal(messageOf(l, { ...newSheet(l, 'theme'), on: 'new', note: ' boards 再失败就报 ' }), '请只跑 Lunhui 的 theme 模块：频道 cn-market，开新运行——先按 lunhui:run 第 1 步冻结整套（index、limit-up、boards），再只写 theme。\n备注：boards 再失败就报');
  assert.equal(messageOf(l, { ...newSheet(l, 'mode'), on: null }), null, 'no On, no message');
});

test('newSheet: a channel named takes the picks for that channel; a market card stays on cn-market', () => {
  assert.deepEqual(newSheet(l, 'leader', 'lunhui-s02-rotation'), { module: 'leader', where: 'lunhui-s02-rotation', on: 'new', run: null, cites: MARKET_RUN, stocks: '', note: '', said: null });
  assert.equal(newSheet(l, 'counterevidence', 'cn-market').where, 'cn-market');
  assert.equal(newSheet(l, 'counterevidence', 'cn-market').run, MARKET_RUN);
  assert.equal(newSheet(l, 'theme', 'lunhui-s01-repair').where, 'cn-market', 'Where is fixed on a market card');
  assert.deepEqual(newSheet(l, 'mode', undefined), newSheet(l, 'mode'));
});
