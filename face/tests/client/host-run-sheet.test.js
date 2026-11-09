// A module card's Run sheet from the host (module cards spec §4 G6, §5.4–§5.5): open from the listing, every field
// recomputed against the listing as it stands, Run as one message to Gravit's one conversation (one-entry plan 2) asking for
// a task under the Run's title, and nothing sent while the sheet cannot run or the conversation is not known.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startRunSheet } from '../../client/js/host/run-sheet.js';
import { newSheet, sheetOf } from '../../client/js/host/run-sheet-view.js';
import { modulesListing, MARKET_RUN, S01_RUN } from './helpers/inventory.js';
import { spoken } from './helpers/spoken.js';
import { setTable } from '../../client/js/i18n/words.js';
import { EN } from '../../client/js/i18n/en.js';

// a local 14:00 on 2026-10-28, so the browser's date is 10-28 in any zone
const NOW = new Date(2026, 9, 28, 14, 0).getTime();
const NEWER = '20261029T020000Z-aaaaaaaa';
const THEME_NEW = '请只跑 Lunhui 的 theme 模块：频道 cn-market，开新运行——先按 lunhui:run 第 1 步冻结整套（index、limit-up、boards），再只写 theme。';
const FAILED = "Couldn't send to Gravit's conversation";
const CONV = 'c-gravit';
const ask = (title, text) => `请为此开一个任务，标题恰为「${title}」：\n${text}`;
const channelOf = (listing, name) => listing.channels.find(c => c.channel === name);

// the conversation as /data/tasks names it (null: off or not known); `answer` is send's: a receipt, or null when it failed
function rig({ listing = modulesListing(), answer = 'ok', conversation = CONV } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  if (conversation) store.dispatch('tasksLoaded', { conversation, tasks: [], at: NOW });
  const sent = [];
  const went = [];
  const r = { listing, reads: 0 };
  const actions = { send: async (text, opts) => { sent.push({ text, ...opts }); return answer === 'ok' ? { sent: 'prompt', sessionId: opts.sessionId } : answer; } };
  const readListing = async () => { r.reads++; return r.listing; };
  const runSheet = startRunSheet({ store, actions, readListing, go: route => { went.push(route); }, now: () => NOW });
  return Object.assign(r, { store, runSheet, sent, went, actions, sheet: () => store.get().runSheet });
}

test("open: reads the listing and opens the module's sheet with its preselections; an unknown module says so", async () => {
  const r = rig();
  await r.runSheet.open('theme');
  assert.deepEqual(r.sheet(), newSheet(modulesListing(), 'theme'));
  assert.equal(r.sheet().on, 'new');
  r.runSheet.close();
  assert.equal(r.sheet(), null);
  await r.runSheet.open('nope');
  assert.equal(spoken(r.store.get().discover.status.line), 'Not a module');
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

test("Run prompts the conversation with the module's message and creates no session", async () => {
  const r = rig();
  await r.runSheet.open('theme');
  assert.equal(r.sheet().on, 'new');
  await r.runSheet.run();
  // the one send there is: to the conversation, the task's title on the first line — actions has no session/create to call
  assert.deepEqual(r.sent, [{ text: ask('Theme · 10-28', THEME_NEW), sessionId: CONV }]);
  assert.deepEqual(r.store.get().moduleRuns, { theme: { title: 'Theme · 10-28', startedAt: NOW } });
  assert.equal(r.sheet(), null);
  assert.deepEqual(r.went, [{ screen: 'messages' }], 'Messages, where the conversation is: no session id to open');
  // a Leader in its strategy, with its codes and a note on the last line
  const l = rig();
  await l.runSheet.open('leader');
  await l.runSheet.field('stocks', 'SH600000, sz000001');
  await l.runSheet.field('note', '  看量能  ');
  await l.runSheet.run();
  assert.deepEqual(l.sent, [{
    sessionId: CONV,
    text: ask('Leader · 10-28', `请只跑 Lunhui 的 leader 模块：策略 lunhui-s01-repair，开新运行，引用 cn-market 运行 ${MARKET_RUN}；股票 sh600000、sz000001。\n备注：看量能`),
  }]);
});

test('Run with the conversation unknown is refused with a line', async () => {
  for (const conversation of [null, 'off']) {
    const r = rig({ conversation: null });
    if (conversation === 'off') r.store.dispatch('tasksOff', { at: NOW });
    await r.runSheet.open('theme');
    await r.runSheet.run();
    assert.deepEqual(r.sent, [], 'nothing sent');
    assert.equal(spoken(r.sheet().said), "Gravit's conversation is not known yet — open Messages");
    assert.equal(r.sheet().module, 'theme', 'the sheet stays');
    assert.deepEqual(r.store.get().moduleRuns, {});
    assert.deepEqual(r.went, []);
  }
});

test('run: a failed send keeps the sheet with the line and writes no record', async () => {
  const r = rig({ answer: null });
  await r.runSheet.open('theme');
  await r.runSheet.run();
  assert.equal(r.sent.length, 1);
  assert.equal(spoken(r.sheet().said), FAILED);
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
  assert.equal(spoken(r.sheet().said), sheetOf(r.listing, r.sheet(), NOW).blocker);
  assert.equal(spoken(r.sheet().said), 'choose a run');
  const s = rig();
  await s.runSheet.open('leader');
  await s.runSheet.field('stocks', 'sz300750');
  await s.runSheet.run();
  assert.deepEqual(s.sent, []);
  assert.equal(spoken(s.sheet().said), 'not a main-board code: sz300750');
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
  assert.equal(spoken(r.sheet().said), 'run no longer the latest');
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
    actions: { send: (text, opts) => { r.sent.push({ text, ...opts }); return new Promise(res => { release = () => res({ sent: 'prompt', sessionId: opts.sessionId }); }); } },
  });
  await r.runSheet.open('theme');
  const first = r.runSheet.run();
  await new Promise(res => setTimeout(res, 0));
  await r.runSheet.run();
  release();
  await first;
  assert.equal(r.sent.length, 1);
  assert.equal(r.store.get().moduleRuns.theme.title, 'Theme · 10-28');
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
    store: r.store, actions: r.actions, readListing: async () => r.listing, now: () => NOW,
    go: async () => { throw new Error('list: HTTP 500'); },
  });
  await r.runSheet.open('theme');
  await assert.doesNotReject(r.runSheet.run());
  assert.equal(r.store.get().moduleRuns.theme.title, 'Theme · 10-28');
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
    assert.equal(spoken(r.sheet().said), 'the modules listing could not be read', module);
    await r.runSheet.run();
    assert.deepEqual(r.sent, []);
    assert.equal(spoken(r.sheet().said), 'the modules listing could not be read', module);
  }
});

// plan 7 task 3: a Run's title is the table's at its creation, sent and kept as a string; a switch back re-folds nothing
test('a Run sent under another table is titled in it and keeps that title after a switch back', async () => {
  const r = rig();
  await r.runSheet.open('theme');
  try {
    setTable({ ...EN, 'modules.theme.title': '题材' });
    await r.runSheet.run();
  } finally {
    setTable(EN);
  }
  assert.match(r.sent[0].text, /^请为此开一个任务，标题恰为「题材 · 10-28」：\n/);
  assert.deepEqual(r.store.get().moduleRuns, { theme: { title: '题材 · 10-28', startedAt: NOW } });
  assert.equal(typeof r.store.get().moduleRuns.theme.title, 'string', 'a string, never a said: it is persisted');
  assert.equal(JSON.parse(JSON.stringify(r.store.get().moduleRuns)).theme.title, '题材 · 10-28');
});
