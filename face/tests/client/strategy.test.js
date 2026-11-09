// A strategy's page (one-entry plan 2; the channel page before it, spec 2026-10-19 §7 Stage 3 "Channels"): the status
// headline, the thesis, the latest backtest, the backtests, the journal, the files and the rosters from
// /data/channels/overview, then the strategy's tasks and the paper positions of the venue its status.yaml names; every
// Gravit-written string is text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStrategyScreen } from '../../client/js/render/strategy.js';
import { createStore } from '../../client/js/store.js';
import { startChannels } from '../../client/js/host/channels.js';
import { setMarkdown } from '../../client/js/render/thread.js';
import { renderMarkdown } from '../../client/js/wire/markdown.js';
import { withMiniDocument } from './helpers/mini-dom.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { withTable } from '../../client/js/i18n/words.js';

const NOW = new Date(2026, 9, 20, 10, 0).getTime();
const alpha = { workspaceId: 'w1', name: 'alpha', title: 'Alpha', dir: '/r/strategies/alpha', isRoot: false, missingDir: false, sessionIds: [] };
export const overview = (over = {}) => ({
  ok: true, channel: alpha,
  status: { status: 'researching', one_line: 'Momentum holds after costs', next: 'Rerun with 2024 data', numbers: { sharpe: '1.4', trades: '212' } },
  body: {
    thesis: { markdown: '# Alpha\n\nBuy **strength**.', isTemplate: false },
    journal: [{ date: '2026-10-19', text: 'Ran the screen' }, { date: '2026-10-18', text: 'Started' }],
    backtests: [{ file: 'bt-2026-10-19.json', bytes: 2048 }],
    latest: { file: 'bt-2026-10-19.json', json: { sharpe: 1.4123456, trades: 212, window: '2024-06..2026-07', rows: [1, 2] } },
    files: [{ name: 'notes.md', bytes: 512, mtime: '2026-10-19T09:00:00.000Z' }],
  },
  agents: ['codex'], bots: ['buffett'],
  allBots: [{ id: 'buffett', name: 'Buffett Type', listed: true }, { id: 'drill-bear', name: 'Bear', listed: true }],
  ...over,
});
// a strategy's page, by its name (#/strategy/<name>); the page reads its channel by the workspace the name has
const listedOn = (name = 'alpha') => R.nav(R.hostList(emptyState(), { conversations: [], channels: [alpha] }), { screen: 'strategy', id: name });
const on = (data, status = 'ready') => {
  const s = listedOn();
  if (status === 'loading') return R.channelLoading(s, { workspaceId: 'w1' });
  if (status === 'failed') return R.channelFailed(R.channelLoading(s, { workspaceId: 'w1' }), { workspaceId: 'w1', at: NOW });
  return R.channelLoaded(s, { workspaceId: 'w1', data, at: NOW });
};

test('the page draws the status headline, thesis, latest backtest, backtests, journal, files and rosters', () => {
  setMarkdown(null);
  const h = renderStrategyScreen(on(overview()), NOW);
  assert.match(h, /<main class="main chan strat">/);
  assert.match(h, /<h1 class="head-title">Alpha<\/h1>/);
  assert.match(h, /class="chip[^"]*">researching</);
  assert.match(h, /Momentum holds after costs/);
  assert.match(h, /Next: Rerun with 2024 data/);
  assert.match(h, />sharpe<[\s\S]*?>1\.4</);
  assert.match(h, />Thesis</); assert.match(h, /Buy \*\*strength\*\*/, 'with no markdown renderer set, the text escaped');
  assert.match(h, />Latest backtest</); assert.match(h, /bt-2026-10-19\.json/);
  assert.match(h, />trades<[\s\S]*?>212</); assert.match(h, />sharpe<[\s\S]*?>1\.4123</);
  assert.doesNotMatch(h, />rows</, 'only scalar fields');
  assert.match(h, />Backtests</); assert.match(h, /2\.0 KB/);
  assert.match(h, />Journal</); assert.match(h, /2026-10-19[\s\S]*?Ran the screen[\s\S]*?2026-10-18[\s\S]*?Started/);
  assert.match(h, />Files</); assert.match(h, /notes\.md/); assert.match(h, /512 B/);
  assert.match(h, />Agents<[\s\S]*?codex/); assert.match(h, />Bots<[\s\S]*?Buffett Type/);
  assert.doesNotMatch(h, /data-action="newRound"/, 'no New round: the one conversation takes every new word');
});

test('a template thesis reads No thesis yet', () => {
  const t = overview(); t.body = { ...t.body, thesis: { markdown: '# <strategy name>', isTemplate: true } };
  assert.match(renderStrategyScreen(on(t), NOW), />Thesis<[\s\S]*?No thesis yet/);
  const none = overview(); none.body = { ...none.body, thesis: null };
  assert.match(renderStrategyScreen(on(none), NOW), /No thesis yet/);
});

test('markup in every field stays text', () => {
  const bad = '<img src=x onerror=alert(1)>';
  const t = overview({ status: { status: bad, one_line: bad, next: bad, numbers: { [bad]: bad } }, agents: [bad], bots: ['evil'], allBots: [{ id: 'evil', name: bad }] });
  t.body = {
    thesis: { markdown: `# ${bad}\n\n${bad}`, isTemplate: false }, journal: [{ date: bad, text: bad }],
    backtests: [{ file: bad, bytes: 1 }], latest: { file: bad, json: { [bad]: bad } }, files: [{ name: bad, bytes: 1, mtime: '2026-10-19T09:00:00.000Z' }],
  };
  const h = withMiniDocument(() => {
    setMarkdown(text => renderMarkdown(text).node.outerHTML);
    try { return renderStrategyScreen(on(t), NOW); } finally { setMarkdown(null); }
  });
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('loading, unavailable with Retry, a stale page after a failed re-read, not found', () => {
  assert.match(renderStrategyScreen(on(null, 'loading'), NOW), /Loading…/);
  const failed = renderStrategyScreen(on(null, 'failed'), NOW);
  assert.match(failed, /Strategy unavailable/); assert.match(failed, /data-action="channelRetry" data-id="w1"/);
  const st = renderStrategyScreen(R.channelFailed(on(overview()), { workspaceId: 'w1', at: NOW + 60_000 }), NOW);
  assert.match(st, /Momentum holds after costs/, 'a failed re-read keeps the page');
  assert.match(st, /As of 10:00 · stale/); assert.match(st, /data-action="channelRetry"/);
  assert.match(renderStrategyScreen(listedOn('nope'), NOW), /Strategy not found/);
  const missing = R.channelFailed(on(null, 'loading'), { workspaceId: 'w1', at: NOW, missing: true });
  assert.match(renderStrategyScreen(missing, NOW), /Strategy not found/);
});

test('the roster editors tick what is rostered, offer the connected agents and every bot, and stop at six bots', () => {
  setMarkdown(null);
  const s = on(overview());
  const agents = R.startEdit(s, { kind: 'roster', which: 'agents', workspaceId: 'w1', choices: [{ value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude' }], ticked: ['codex'] });
  const a = renderStrategyScreen(agents, NOW);
  assert.match(a, /class="roster-edit"/);
  assert.match(a, /<input type="checkbox" id="roster-agents-0" name="roster" value="codex" checked>/);
  assert.match(a, /<input type="checkbox" id="roster-agents-1" name="roster" value="claude">/);
  assert.match(a, /data-action="commitEdit"/); assert.match(a, /data-action="cancelEdit"/);
  assert.doesNotMatch(a, /data-action="editRoster" data-which="agents"/, 'the Edit key gives way to the editor');
  assert.match(renderStrategyScreen(s, NOW), /data-action="editRoster" data-which="bots" data-id="w1"/);
  const six = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
  const choices = [...six, 'b7'].map(v => ({ value: v, label: v.toUpperCase() }));
  const full = R.startEdit(s, { kind: 'roster', which: 'bots', workspaceId: 'w1', choices, ticked: six });
  const b = renderStrategyScreen(full, NOW);
  assert.match(b, /value="b7" disabled>/, 'a seventh bot cannot be ticked while six are');
  assert.doesNotMatch(b, /value="b1" checked disabled/);
  assert.equal(R.toggleRosterTick(full, { value: 'b7', on: true }).edit.ticked.length, 6, 'nor added through the store');
  assert.deepEqual(R.toggleRosterTick(full, { value: 'b1', on: false }).edit.ticked, ['b2', 'b3', 'b4', 'b5', 'b6']);
  assert.match(renderStrategyScreen(R.editFailed(full, { error: 'roster write failed' }), NOW), /roster write failed/);
});

test('the strategy page draws the research runs after the latest backtest, every string escaped', () => {
  setMarkdown(null);
  const bad = '<script>alert(1)</script>';
  const run = '2026-10-24-0930-ab12';
  const t = overview();
  t.body = {
    ...t.body,
    runs: [
      { run, asOf: '2026-10-24', snapshotId: bad, sealed: true, kind: 'market', marketRun: null, bytes: 2048,
        artifacts: { sentiment: { accepted: true, status: null, contractVersion: '1', headline: { state: bad } }, theme: { accepted: true, status: 'NOT_EVALUABLE', contractVersion: '1', headline: {} } } },
      { run: bad, asOf: null, snapshotId: null, sealed: false, kind: null, artifacts: { mode: { accepted: true, status: null, contractVersion: '1', headline: {} } }, marketRun: null, bytes: 10 },
    ],
    runsOmitted: 2,
    latestRun: {
      run, asOf: '2026-10-24', session: '2026-10-23', snapshotId: bad, marketRun: 'cn-run-1',
      artifacts: {
        sentiment: { headline: { state: bad }, json: { state: bad } },
        theme: { headline: {}, json: { status: 'NOT_EVALUABLE' } },
        mode: { headline: { mode: 'WAIT', expectation: { [bad]: bad, horizon: 3 }, expectation_review: { previous_run: bad, grade: '弱于', evidence_ids: [] } }, json: { mode: bad } },
      },
    },
  };
  const h = renderStrategyScreen(on(t), NOW);
  assert.match(h, />Latest backtest<[\s\S]*>Research runs</, 'after the latest backtest');
  assert.match(h, /Research runs<[\s\S]*?2026-10-24-0930-ab12 · as of 2026-10-24 · session 2026-10-23 · snapshot &lt;script&gt;[\s\S]*?cn-market run cn-run-1/);
  assert.match(h, /class="chip grey">sentiment: &lt;script&gt;/);
  assert.match(h, /class="chip grey">theme: not evaluable</);
  assert.match(h, />horizon<[\s\S]*?>3</);
  assert.match(h, /class="chip grey">mode: WAIT</);
  assert.match(h, />3<[\s\S]*?<div class="dsec-line">review: 弱于 of &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/div>/, 'the review line after the card');
  assert.match(h, /<details class="acct-shown"><summary>mode<\/summary>[\s\S]*?\{&quot;mode&quot;:&quot;&lt;script&gt;/);
  assert.match(h, /as of 2026-10-24 · 2 artifacts: sentiment, theme · 2\.0 KB/);
  assert.match(h, /as of — · 1 artifact: mode · 10 B · unsealed/);
  assert.match(h, /older runs not listed: 2/);
  assert.doesNotMatch(h, /<script>/);
});

test('a strategy with no runs draws no research runs; runs without an artifact say so', () => {
  setMarkdown(null);
  assert.doesNotMatch(renderStrategyScreen(on(overview()), NOW), /Research runs/, 'no runs on the wire');
  const empty = overview(); empty.body = { ...empty.body, runs: [], runsOmitted: 0, latestRun: null };
  assert.doesNotMatch(renderStrategyScreen(on(empty), NOW), /Research runs/, 'an empty runs list');
  const t = overview();
  t.body = { ...t.body, runs: [{ run: 'r1', asOf: null, snapshotId: null, sealed: true, kind: 'market', artifacts: {}, marketRun: null, bytes: 0 }], runsOmitted: 0, latestRun: null };
  const h = renderStrategyScreen(on(t), NOW);
  assert.match(h, />Research runs<[\s\S]*?no sealed run with an artifact yet/); assert.match(h, /r1/); assert.match(h, /0 artifacts/);
  assert.doesNotMatch(h, /older runs not listed/);
});

test("a research run's artifacts are counted and named in the table's order, their separator the table's", () => {
  const o = overview();
  o.body = { ...o.body, runs: [{ run: 'r1', asOf: '2026-10-24', snapshotId: null, sealed: true, kind: 'market', marketRun: null, bytes: 2048,
    artifacts: { sentiment: { accepted: true, status: null, contractVersion: '1', headline: {} }, theme: { accepted: true, status: null, contractVersion: '1', headline: {} } } }] };
  const h = withTable({ 'channel.count.artifactsNamed': { one: '{names} ({n})', other: '{names} ({n})' }, 'common.list.sep': '、' }, () => renderStrategyScreen(on(o), NOW));
  assert.match(h, /as of 2026-10-24 · sentiment、theme \(2\) · 2\.0 KB/);
});

test('an unknown name is not found once the channels read has answered, even with none listed; before it, Loading…', () => {
  const waiting = R.nav(emptyState(), { screen: 'strategy', id: 'ghost' });
  assert.match(renderStrategyScreen(waiting, NOW), /Loading…/, 'the channels not read yet');
  assert.match(renderStrategyScreen(R.hostListFailed(waiting), NOW), /Strategy not found/, 'the list read failed');
  assert.match(renderStrategyScreen(R.hostList(waiting, { conversations: [], channels: [] }), NOW), /Strategy not found/, 'read, and empty');
});

// a store with the strategy page on screen and startChannels over it, `answer(path)` the Account's positions read
function positionsRig(answer, status = {}) {
  const store = createStore({ initial: listedOn(), reducers: R });
  const reads = [];
  const getJson = async path => { reads.push(path); return answer(path); };
  const postJson = async () => overview({ status: { status: 'researching', ...status } });
  const channels = startChannels({ store, postJson, getJson, now: () => NOW });
  return { store, reads, channels };
}
const POSITIONS = { ok: true, positions: [
  { venue: 'paper-us', venueName: 'Paper US', symbol: 'NVDA', name: 'NVIDIA', side: 'long', qty: 12, entryPrice: 120.5, markPrice: 131.25, usd: 1575, unrealizedUsd: 129, paper: true, kind: 'stock' },
  { venue: 'paper-us', symbol: '<b>X</b>', side: 'short', qty: '3', entryPrice: '10', markPrice: '12', unrealizedUsd: '-6', paper: true },
] };

test('no venue: the page says none is named and reads no positions', async () => {
  const r = positionsRig(() => POSITIONS);
  await r.channels.overview('w1');
  assert.deepEqual(r.reads, [], 'no positions read without a venue');
  const h = renderStrategyScreen(r.store.get(), NOW);
  assert.match(h, />Paper positions<[\s\S]*?No paper venue is named in status\.yaml/);
  assert.doesNotMatch(h, /acct-t/);
});

test("a venue: the page reads that venue's positions once and draws them", async () => {
  const r = positionsRig(() => POSITIONS, { venue: 'paper us' });
  await r.channels.overview('w1');
  await new Promise(res => setImmediate(res));
  assert.deepEqual(r.reads, ['/data/account/positions?venue=paper%20us'], 'that venue, once, never another');
  const p = r.store.get().channel.positions;
  assert.equal(p.status, 'ready'); assert.equal(p.venue, 'paper us'); assert.equal(p.rows.length, 2);
  const h = renderStrategyScreen(r.store.get(), NOW);
  assert.match(h, />Paper positions · paper us</);
  assert.match(h, />Symbol<[\s\S]*?>Side<[\s\S]*?>Quantity<[\s\S]*?>Entry<[\s\S]*?>Mark<[\s\S]*?>Unrealized P&amp;L</);
  assert.match(h, /<td>NVDA<\/td><td class="r">long<\/td><td class="r">12<\/td><td class="r">\$120\.50<\/td><td class="r">\$131\.25<\/td><td class="r"><span class="up">\+\$129\.00<\/span>/);
  assert.match(h, /&lt;b&gt;X&lt;\/b&gt;[\s\S]*?short[\s\S]*?<span class="down">-\$6\.00/);
  assert.doesNotMatch(h, /<b>X<\/b>/);
});

test("a venue whose positions the Account refuses draws the refusal as one line; with none open, a line says so", async () => {
  const refused = positionsRig(() => { throw Object.assign(new Error('HTTP 409'), { status: 409, body: { ok: false, refusal: { code: 'NO_VENUE', message: 'No venue <paper-x> here' } } }); }, { venue: 'paper-x' });
  await refused.channels.overview('w1');
  await new Promise(res => setImmediate(res));
  assert.match(renderStrategyScreen(refused.store.get(), NOW), /<div class="dsec-line">No venue &lt;paper-x&gt; here<\/div>/);
  const empty = positionsRig(() => ({ ok: true, positions: [] }), { venue: 'paper-us' });
  await empty.channels.overview('w1');
  await new Promise(res => setImmediate(res));
  assert.match(renderStrategyScreen(empty.store.get(), NOW), /No open positions/);
});

const taskOf = (id, over = {}) => ({ id, title: `Task ${id}`, origin: 'web', state: 'running', group: 'running', steps: ['read the tape'], startedAt: NOW - 120_000, lastEventAt: NOW, lastSeq: 1, ...over });

test("the strategy's tasks are listed with their lines", () => {
  setMarkdown(null);
  const tasks = [taskOf('t1', { strategy: 'alpha' }), taskOf('t2', { strategy: 'beta' }), taskOf('t3', { strategy: 'alpha', state: 'done', group: 'done' }), taskOf('t4')];
  const s = R.tasksLoaded(on(overview()), { conversation: 'c', tasks, at: NOW });
  const h = renderStrategyScreen(s, NOW, { open: new Set(['t3']) });
  assert.match(h, />Tasks<[\s\S]*?class="strat-tasks"/);
  assert.match(h, /<details class="task-line" data-task="t1">[\s\S]*?Task t1[\s\S]*?1 step · 2 min/);
  assert.match(h, /<details class="task-line" data-task="t3" open>/, 'a line the page holds open stays open');
  assert.ok(h.indexOf('data-task="t1"') < h.indexOf('data-task="t3"'), 'running before done, as the rail orders them');
  assert.doesNotMatch(h, /data-task="t2"|data-task="t4"/, "another strategy's task, or one with none, is not this one's");
  assert.match(renderStrategyScreen(R.tasksLoaded(on(overview()), { conversation: 'c', tasks: [taskOf('t2', { strategy: 'beta' })], at: NOW }), NOW), />Tasks<[\s\S]*?No tasks for this strategy/);
});

test("a strategy's scheduled lines are listed", () => {
  setMarkdown(null);
  const desk = { scheduled: [{ order: 'alpha-pre', strategy: 'alpha', enabled: true, expired: false }, { order: 'brief', enabled: true, expired: false }, { order: 'beta-pre', strategy: 'beta', enabled: true, expired: false }], lines: [] };
  const h = renderStrategyScreen(R.tasksLoaded(on(overview()), { conversation: 'c', tasks: [taskOf('t1', { strategy: 'alpha' })], desk, at: NOW }), NOW);
  assert.match(h, /class="strat-tasks"[\s\S]*?data-task="t1"[\s\S]*?data-task="order:alpha-pre"/);
  assert.doesNotMatch(h, /order:brief|order:beta-pre/);
  const only = renderStrategyScreen(R.tasksLoaded(on(overview()), { conversation: 'c', tasks: [], desk, at: NOW }), NOW);
  assert.match(only, /data-task="order:alpha-pre"/);
  assert.doesNotMatch(only, /No tasks for this strategy/);
});
