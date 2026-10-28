// A module card's Run sheet from the host (module cards spec §4 G6, §5.4–§5.5): open from the listing, every field
// recomputed against the listing as it stands, Run as one new conversation in the chosen channel, and nothing sent
// while the sheet cannot run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startRunSheet } from '../../client/js/host/run-sheet.js';
import { newSheet, sheetOf } from '../../client/js/host/run-sheet-view.js';
import { modulesListing, MARKET_RUN, S01_RUN } from './helpers/inventory.js';

// a local 14:00 on 2026-10-28, so the browser's date is 10-28 in any zone
const NOW = new Date(2026, 9, 28, 14, 0).getTime();
const NEWER = '20261029T020000Z-aaaaaaaa';
const THEME_NEW = '请只跑 Lunhui 的 theme 模块：频道 cn-market，开新运行——先按 lunhui:run 第 1 步冻结整套（index、limit-up、boards），再只写 theme。';
const FAILED = "Couldn't send — the conversation may exist untitled in the channel";
const channelOf = (listing, name) => listing.channels.find(c => c.channel === name);

function rig({ listing = modulesListing(), answer = 's-run' } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const sent = [];
  const went = [];
  const r = { listing, reads: 0 };
  const actions = { newConversation: async args => { sent.push(args); return answer; } };
  const readListing = async () => { r.reads++; return r.listing; };
  const runSheet = startRunSheet({ store, actions, readListing, go: route => { went.push(route); }, now: () => NOW });
  return Object.assign(r, { store, runSheet, sent, went, sheet: () => store.get().runSheet });
}

test("open: reads the listing and opens the module's sheet with its preselections; an unknown module says so", async () => {
  const r = rig();
  await r.runSheet.open('theme');
  assert.deepEqual(r.sheet(), newSheet(modulesListing(), 'theme'));
  assert.equal(r.sheet().on, 'new');
  r.runSheet.close();
  assert.equal(r.sheet(), null);
  await r.runSheet.open('nope');
  assert.equal(r.store.get().discover.status.line, 'Not a module');
  assert.equal(r.sheet(), null);
});

test('field: where resets on and cites for the new channel, stocks and note stay', async () => {
  const r = rig();
  await r.runSheet.open('leader');
  assert.equal(r.sheet().where, 'lunhui-s01-repair');
  assert.equal(r.sheet().run, S01_RUN);
  await r.runSheet.field('stocks', 'sh600000');
  await r.runSheet.field('note', '只看主板');
  await r.runSheet.field('cites', null);
  assert.equal(r.sheet().cites, null);
  await r.runSheet.field('where', 'lunhui-s02-rotation');
  assert.deepEqual(r.sheet(), {
    module: 'leader', where: 'lunhui-s02-rotation', on: 'new', run: null, cites: MARKET_RUN, stocks: 'sh600000', note: '只看主板', said: null,
  });
  // On chosen again stamps the channel's newest run as it stands; the other fields set themselves alone
  await r.runSheet.field('where', 'lunhui-s01-repair');
  assert.equal(r.sheet().run, S01_RUN);
  await r.runSheet.field('on', 'latest');
  assert.equal(r.sheet().on, 'latest');
  assert.equal(r.sheet().run, S01_RUN);
  await r.runSheet.field('stocks', 'sz000001');
  assert.equal(r.sheet().stocks, 'sz000001');
  assert.equal(r.sheet().where, 'lunhui-s01-repair');
  await r.runSheet.field('bogus', 'x');
  assert.equal(r.sheet().bogus, undefined, 'a name the sheet has not is ignored');
});

test("run: sends one conversation with the title, the channel's workspaceId and the message, records the run, closes, navigates", async () => {
  const r = rig();
  await r.runSheet.open('theme');
  assert.equal(r.sheet().on, 'new');
  await r.runSheet.run();
  assert.deepEqual(r.sent, [{ title: 'Theme · 10-28', workspaceId: 'ws-cn-market', text: THEME_NEW }]);
  assert.deepEqual(r.store.get().moduleRuns, { theme: { sessionId: 's-run', title: 'Theme · 10-28', startedAt: NOW } });
  assert.equal(r.sheet(), null);
  assert.deepEqual(r.went, [{ screen: 'messages', id: 's-run' }]);
  // a Leader in its strategy, with its codes and a note on the last line
  const l = rig();
  await l.runSheet.open('leader');
  await l.runSheet.field('stocks', 'SH600000, sz000001');
  await l.runSheet.field('note', '  看量能  ');
  await l.runSheet.run();
  assert.deepEqual(l.sent, [{
    title: 'Leader · 10-28', workspaceId: 'ws-lunhui-s01-repair',
    text: `请只跑 Lunhui 的 leader 模块：策略 lunhui-s01-repair，开新运行，引用 cn-market 运行 ${MARKET_RUN}；股票 sh600000、sz000001。\n备注：看量能`,
  }]);
});

test('run: a failed send keeps the sheet with the line and writes no record', async () => {
  const r = rig({ answer: null });
  await r.runSheet.open('theme');
  await r.runSheet.run();
  assert.equal(r.sent.length, 1);
  assert.equal(r.sheet().said, FAILED);
  assert.equal(r.sheet().module, 'theme');
  assert.deepEqual(r.store.get().moduleRuns, {});
  assert.deepEqual(r.went, []);
  // a field changed clears the line
  await r.runSheet.field('note', 'x');
  assert.equal(r.sheet().said, null);
});

test('run: refused while the sheet cannot run', async () => {
  const r = rig();
  await r.runSheet.open('mode');
  assert.equal(r.sheet().on, null, 'mode is already registered on the fixture run');
  await r.runSheet.run();
  assert.deepEqual(r.sent, []);
  assert.equal(r.sheet().said, sheetOf(r.listing, r.sheet(), NOW).blocker);
  assert.equal(r.sheet().said, 'choose a run');
  const s = rig();
  await s.runSheet.open('leader');
  await s.runSheet.field('stocks', 'sz300750');
  await s.runSheet.run();
  assert.deepEqual(s.sent, []);
  assert.equal(s.sheet().said, 'not a main-board code: sz300750');
  assert.deepEqual(s.went, []);
});

test('the listing moves under an open sheet: a chosen latest run that is no longer the latest disables Run with its reason', async () => {
  const start = modulesListing();
  delete channelOf(start, 'cn-market').runs[0].artifacts.sentiment;
  const r = rig({ listing: start });
  await r.runSheet.open('sentiment');
  assert.equal(r.sheet().on, 'latest');
  assert.equal(r.sheet().run, MARKET_RUN);
  const moved = modulesListing();
  delete channelOf(moved, 'cn-market').runs[0].artifacts.sentiment;
  channelOf(moved, 'cn-market').runs.unshift({
    run: NEWER, session: '2026-10-29', asOf: null, openedAt: null, sealedAt: '2026-10-29T02:00:00.000Z', frozen: ['index', 'limit-up', 'boards'], artifacts: {},
  });
  r.listing = moved;
  const reads = r.reads;
  await r.runSheet.field('note', 'x');
  assert.equal(r.sheet().note, 'x');
  assert.equal(r.reads, reads, 'a note reads nothing: the sheet stands on the listing last read');
  assert.equal(r.sheet().run, MARKET_RUN, 'a note keeps the run the sheet was opened on');
  const v = sheetOf(moved, r.sheet(), NOW);
  assert.equal(v.canRun, false);
  assert.equal(v.blocker, 'run no longer the latest');
  await r.runSheet.run();
  assert.deepEqual(r.sent, [], 'nothing sent on a run that moved');
  assert.equal(r.sheet().said, 'run no longer the latest');
  // choosing Latest run again takes the newest
  await r.runSheet.field('on', 'latest');
  assert.equal(r.sheet().run, NEWER);
  assert.equal(sheetOf(moved, r.sheet(), NOW).canRun, true);
});

test('run: a second press while the first is in the air sends nothing more', async () => {
  const r = rig();
  let release;
  r.runSheet = startRunSheet({
    store: r.store, readListing: async () => r.listing, go: () => {}, now: () => NOW,
    actions: { newConversation: args => { r.sent.push(args); return new Promise(res => { release = () => res('s-run'); }); } },
  });
  await r.runSheet.open('theme');
  const first = r.runSheet.run();
  await new Promise(res => setTimeout(res, 0));
  await r.runSheet.run();
  release();
  await first;
  assert.equal(r.sent.length, 1);
  assert.equal(r.store.get().moduleRuns.theme.sessionId, 's-run');
});

test('field: where and on re-read the listing; stocks, note and cites stand on the one last read', async () => {
  const r = rig();
  await r.runSheet.open('leader');
  assert.equal(r.reads, 1, 'open reads');
  await r.runSheet.field('stocks', 'sh600000');
  await r.runSheet.field('note', 'x');
  await r.runSheet.field('cites', null);
  assert.equal(r.reads, 1, 'the own fields read nothing');
  assert.equal(r.sheet().stocks, 'sh600000');
  assert.equal(r.sheet().note, 'x');
  assert.equal(r.sheet().cites, null);
  await r.runSheet.field('on', 'latest');
  assert.equal(r.reads, 2, 'on reads');
  await r.runSheet.field('where', 'lunhui-s02-rotation');
  assert.equal(r.reads, 3, 'where reads');
  await r.runSheet.run();
  assert.equal(r.reads, 4, 'run reads');
});

test('run: a page move that fails after the record is written escapes nothing; the record and the closed sheet stand', async () => {
  const r = rig();
  r.runSheet = startRunSheet({
    store: r.store, actions: { newConversation: async args => { r.sent.push(args); return 's-run'; } }, readListing: async () => r.listing, now: () => NOW,
    go: async () => { throw new Error('list: HTTP 500'); },
  });
  await r.runSheet.open('theme');
  await assert.doesNotReject(r.runSheet.run());
  assert.equal(r.store.get().moduleRuns.theme.sessionId, 's-run');
  assert.equal(r.sheet(), null);
  // and the next Run is not held by the failed one
  await r.runSheet.open('theme');
  await r.runSheet.run();
  assert.equal(r.sent.length, 2);
});

test('the listing could not be read: the sheet opens saying so, and Run sends nothing', async () => {
  for (const module of ['theme', 'leader']) {
    const r = rig({ listing: null });
    await r.runSheet.open(module);
    assert.equal(r.sheet().module, module);
    assert.equal(r.sheet().said, 'the modules listing could not be read', module);
    await r.runSheet.run();
    assert.deepEqual(r.sent, []);
    assert.equal(r.sheet().said, 'the modules listing could not be read', module);
  }
  // a listing whose channel has no workspaceId: choose where to run
  const listing = modulesListing();
  delete channelOf(listing, 'cn-market').workspaceId;
  const w = rig({ listing });
  await w.runSheet.open('theme');
  assert.equal(w.sheet().said, null);
  await w.runSheet.run();
  assert.deepEqual(w.sent, []);
  assert.equal(w.sheet().said, 'choose where to run');
});
