// The channel page (spec 2026-10-19 §7 Stage 3 "Channels"): the status headline, the thesis, the latest backtest, the
// backtests, the journal, the files and the rosters from /data/channels/overview; every Gravit-written string is text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderChannelScreen } from '../../client/js/render/channel.js';
import { setMarkdown } from '../../client/js/render/thread.js';
import { renderMarkdown } from '../../client/js/wire/markdown.js';
import { withMiniDocument } from './helpers/mini-dom.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';

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
const listedOn = (id = 'w1') => R.nav(R.hostList(emptyState(), { conversations: [], channels: [alpha] }), { screen: 'channel', id });
const on = (data, status = 'ready') => {
  const s = listedOn();
  if (status === 'loading') return R.channelLoading(s, { workspaceId: 'w1' });
  if (status === 'failed') return R.channelFailed(R.channelLoading(s, { workspaceId: 'w1' }), { workspaceId: 'w1', at: NOW });
  return R.channelLoaded(s, { workspaceId: 'w1', data, at: NOW });
};

test('the page draws the status headline, thesis, latest backtest, backtests, journal, files and rosters', () => {
  setMarkdown(null);
  const h = renderChannelScreen(on(overview()), NOW);
  assert.match(h, /<main class="main chan">/);
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
  assert.match(h, /data-action="newRound" data-id="w1"/);
});

test('a template thesis reads No thesis yet', () => {
  const t = overview(); t.body = { ...t.body, thesis: { markdown: '# <strategy name>', isTemplate: true } };
  assert.match(renderChannelScreen(on(t), NOW), />Thesis<[\s\S]*?No thesis yet/);
  const none = overview(); none.body = { ...none.body, thesis: null };
  assert.match(renderChannelScreen(on(none), NOW), /No thesis yet/);
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
    try { return renderChannelScreen(on(t), NOW); } finally { setMarkdown(null); }
  });
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('loading, unavailable with Retry, a stale page after a failed re-read, not found', () => {
  assert.match(renderChannelScreen(on(null, 'loading'), NOW), /Loading…/);
  const failed = renderChannelScreen(on(null, 'failed'), NOW);
  assert.match(failed, /Channel unavailable/); assert.match(failed, /data-action="channelRetry" data-id="w1"/);
  const st = renderChannelScreen(R.channelFailed(on(overview()), { workspaceId: 'w1', at: NOW + 60_000 }), NOW);
  assert.match(st, /Momentum holds after costs/, 'a failed re-read keeps the page');
  assert.match(st, /As of 10:00 · stale/); assert.match(st, /data-action="channelRetry"/);
  assert.match(renderChannelScreen(listedOn('w9'), NOW), /Channel not found/);
  const missing = R.channelFailed(on(null, 'loading'), { workspaceId: 'w1', at: NOW, missing: true });
  assert.match(renderChannelScreen(missing, NOW), /Channel not found/);
});

test('the roster editors tick what is rostered, offer the connected agents and every bot, and stop at six bots', () => {
  setMarkdown(null);
  const s = on(overview());
  const agents = R.startEdit(s, { kind: 'roster', which: 'agents', workspaceId: 'w1', choices: [{ value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude' }], ticked: ['codex'] });
  const a = renderChannelScreen(agents, NOW);
  assert.match(a, /class="roster-edit"/);
  assert.match(a, /<input type="checkbox" id="roster-agents-0" name="roster" value="codex" checked>/);
  assert.match(a, /<input type="checkbox" id="roster-agents-1" name="roster" value="claude">/);
  assert.match(a, /data-action="commitEdit"/); assert.match(a, /data-action="cancelEdit"/);
  assert.doesNotMatch(a, /data-action="editRoster" data-which="agents"/, 'the Edit key gives way to the editor');
  assert.match(renderChannelScreen(s, NOW), /data-action="editRoster" data-which="bots" data-id="w1"/);
  const six = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
  const choices = [...six, 'b7'].map(v => ({ value: v, label: v.toUpperCase() }));
  const full = R.startEdit(s, { kind: 'roster', which: 'bots', workspaceId: 'w1', choices, ticked: six });
  const b = renderChannelScreen(full, NOW);
  assert.match(b, /value="b7" disabled>/, 'a seventh bot cannot be ticked while six are');
  assert.doesNotMatch(b, /value="b1" checked disabled/);
  assert.equal(R.toggleRosterTick(full, { value: 'b7', on: true }).edit.ticked.length, 6, 'nor added through the store');
  assert.deepEqual(R.toggleRosterTick(full, { value: 'b1', on: false }).edit.ticked, ['b2', 'b3', 'b4', 'b5', 'b6']);
  assert.match(renderChannelScreen(R.editFailed(full, { error: 'roster write failed' }), NOW), /roster write failed/);
});

test('the channel page draws the research runs after the latest backtest, every string escaped', () => {
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
      run, asOf: '2026-10-24', snapshotId: bad, marketRun: 'cn-run-1',
      artifacts: {
        sentiment: { headline: { state: bad }, json: { state: bad } },
        theme: { headline: {}, json: { status: 'NOT_EVALUABLE' } },
        mode: { headline: { mode: 'WAIT', expectation: { [bad]: bad, horizon: 3 } }, json: { mode: bad } },
      },
    },
  };
  const h = renderChannelScreen(on(t), NOW);
  assert.match(h, />Latest backtest<[\s\S]*>Research runs</, 'after the latest backtest');
  assert.match(h, /Research runs<[\s\S]*?2026-10-24-0930-ab12 · as of 2026-10-24 · snapshot &lt;script&gt;[\s\S]*?cn-market run cn-run-1/);
  assert.match(h, /class="chip grey">sentiment: &lt;script&gt;/);
  assert.match(h, /class="chip grey">theme: not evaluable</);
  assert.match(h, />horizon<[\s\S]*?>3</);
  assert.match(h, /<details class="acct-shown"><summary>mode<\/summary>[\s\S]*?\{&quot;mode&quot;:&quot;&lt;script&gt;/);
  assert.match(h, /as of 2026-10-24 · 2 artifacts: sentiment, theme · 2\.0 KB/);
  assert.match(h, /as of — · 1 artifact: mode · 10 B · unsealed/);
  assert.match(h, /older runs not listed: 2/);
  assert.doesNotMatch(h, /<script>/);
});

test('a channel with no runs draws no research runs; runs without an artifact say so', () => {
  setMarkdown(null);
  assert.doesNotMatch(renderChannelScreen(on(overview()), NOW), /Research runs/, 'no runs on the wire');
  const empty = overview(); empty.body = { ...empty.body, runs: [], runsOmitted: 0, latestRun: null };
  assert.doesNotMatch(renderChannelScreen(on(empty), NOW), /Research runs/, 'an empty runs list');
  const t = overview();
  t.body = { ...t.body, runs: [{ run: 'r1', asOf: null, snapshotId: null, sealed: true, kind: 'market', artifacts: {}, marketRun: null, bytes: 0 }], runsOmitted: 0, latestRun: null };
  const h = renderChannelScreen(on(t), NOW);
  assert.match(h, />Research runs<[\s\S]*?no sealed run with an artifact yet/); assert.match(h, /r1/); assert.match(h, /0 artifacts/);
  assert.doesNotMatch(h, /older runs not listed/);
});
