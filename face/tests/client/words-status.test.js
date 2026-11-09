// The status lines the host layer writes read the words table (plan 6 Task 5): each line, as the store holds it, in its
// exact bytes — plain text, a param put in as it is (never escaped here: renderStatus escapes once) — so a th() stored in
// the state, escaped again at the render, shows. Since plan 7 Task 2 a line the store keeps is a said, read when drawn: each
// case reads it through sayOf, and its probe twin reads it under a table whose every value is its English wrapped in ⟦…⟧ —
// so a line written before a switch follows it. A line that came from the Account, dsh or a wallet reads as it came.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { mapFrame } from '../../client/js/wire/mapper.js';
import { makeActions, notSignedIn, failLine } from '../../client/js/host/actions.js';
import { startLive } from '../../client/js/host/live.js';
import { startTraces } from '../../client/js/host/traces.js';
import { chipText, endLine } from '../../client/js/host/jobs-view.js';
import { pillsText } from '../../client/js/host/turns-view.js';
import { admit, limitsLine, modelRefusalLine, attachmentsLine, extOf, DEFAULT_LIMITS } from '../../client/js/composer/files.js';
import { renderStatus } from '../../client/js/render/messages.js';
import { boot } from '../../client/js/app.js';
import { fakeWindow } from './helpers/fake-dom.js';
import { valueEditor } from './helpers/value-editor.js';
import { proveWallet, walletFor, switchChain, sendTxs, mined } from '../../client/js/wire/wallet.js';
import { startWalletSend, noKey } from '../../client/js/host/wallet-send.js';
import { startAccount } from '../../client/js/host/account.js';
import { startSellMany, smLegWords } from '../../client/js/host/sell-many.js';
import { startIdentity, CONNECT_WORDS } from '../../client/js/host/identity.js';
import { identityOf } from '../../client/js/host/identity-view.js';
import { fakeProvider, ADDRESS } from './helpers/fake-wallet.js';
import { draftOf, guardFirstDone, guardFirstRefused, grantOf } from '../../client/js/host/sheet-view.js';
import { refusalOf, saidOf, goodForWords } from '../../client/js/host/owner-view.js';
import { postVia, startOwner } from '../../client/js/host/owner.js';
import { startSheet } from '../../client/js/host/sheet.js';
import { earnSaidOf, moveSaysOf } from '../../client/js/host/sheet-money.js';
import { marketDraftOf } from '../../client/js/host/sheet-market.js';
import { identityLinesOf } from '../../client/js/host/sheet-identity.js';
import { startDesk } from '../../client/js/host/desk.js';
import { accountDown, marketDown } from '../../client/js/host/explore-join.js';
import { accountDownWord } from '../../client/js/host/markets.js';
import { notAnsweringWord } from '../../client/js/host/market-view.js';
import { tradeDraftOf, fillWords } from '../../client/js/host/trade-view.js';
import { startChannels } from '../../client/js/host/channels.js';
import { startDiscover } from '../../client/js/host/discover.js';
import { startRunSheet } from '../../client/js/host/run-sheet.js';
import { ensureViews } from '../../client/js/host/lunhui.js';
import { modulesListing } from './helpers/inventory.js';
import { exploreHalves } from '../../client/js/host/explore-halves.js';
import { said } from '../../client/js/i18n/words.js';
import { sayOf, withTable } from '../../client/js/i18n/words.js';
import { EN } from '../../client/js/i18n/en.js';
import { spoken } from './helpers/spoken.js';

const wrap = v => `⟦${v}⟧`;
const PROBE = Object.freeze(Object.fromEntries(Object.entries(EN).map(([k, v]) => [k, typeof v === 'string' ? wrap(v) : { one: wrap(v.one), other: wrap(v.other) }])));
const unwrap = v => (typeof v === 'string' ? v.replace(/[⟦⟧]/g, '') : Array.isArray(v) ? v.map(unwrap) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrap(x)])) : v);
// a line the face keeps: its English now, and under the probe the probe's words — read from the table that stands when drawn
function follows(line, english, msg) {
  assert.deepEqual(spoken(line), english, msg);
  const probe = withTable(PROBE, () => spoken(line));
  assert.ok(String(JSON.stringify(probe)).includes('⟦'), `read in the table that stands when drawn: ${JSON.stringify(english)}`);
  assert.deepEqual(unwrap(probe), english, msg);
}
// the Account's, dsh's or a wallet's words, kept as they came: the same under any table
function asCame(line, text, msg) {
  assert.deepEqual(spoken(line), text, msg);
  assert.deepEqual(withTable(PROBE, () => spoken(line)), text, msg);
}

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const conv = (id, over = {}) => ({ id, title: 'T', kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: true, updatedAt: 5, created: null, messages: [], loaded: true, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const err = over => Object.assign(new Error('boom'), over);

function actionsRig(answers = {}, convs = [conv('s1')]) {
  const store = createStore({ initial: emptyState(), reducers });
  store.dispatch('hostList', { conversations: convs });
  store.dispatch('tasksLoaded', { conversation: 's1', tasks: [], at: 1 });
  store.dispatch('nav', { screen: 'messages', id: null });
  const call = async endpoint => { const a = answers[endpoint]; if (a instanceof Error) throw a; return typeof a === 'function' ? a() : a; };
  const postJson = async () => { throw err({ code: 'face/<refused>' }); };
  const actions = makeActions({ store, call, answerGate: async () => { throw err({ code: 'gate/gone' }); }, postJson, requestId: () => 'r', timeZone: () => 'UTC' });
  return { store, actions, line: () => store.get().status.line };
}

test('the tasks lines, each in its words', () => {
  follows(said('tasks.stop.gone'), 'That task has already ended');
  follows(said('tasks.stop.failed'), 'Could not stop the task');
  follows(said('tasks.resume.failed'), 'Could not continue the task');
});

test('the boot line, and a failure line: its verb, then the code, the HTTP status or the message; a 401 as notSignedIn', () => {
  follows(emptyState().status.line, 'connecting…');
  follows(notSignedIn(), 'Not signed in — open the URL gravit-face printed');
  follows(failLine({ status: 401 }, 'fork'), 'Not signed in — open the URL gravit-face printed');
  follows(failLine({ code: 'a/<b>' }, 'fork'), 'fork: a/<b>');
  follows(failLine({ status: 502 }, 'fork'), 'fork: HTTP 502');
  follows(failLine({ message: "can't & won't" }, 'fork'), "fork: can't & won't");
  follows(failLine({}, 'fork'), 'fork: failed');
  assert.deepEqual(renderStatus({ line: failLine({ code: 'a/<b>' }, 'fork') }), '<div class="status-line" role="status">fork: a/&lt;b&gt;</div>', 'escaped once, at the render');
});

test("the actions' lines, each verb in its words", async () => {
  const r = actionsRig({
    'session/cancel': err({ code: 'x/1' }), 'session/rename': err({ code: 'x/2' }), 'session/fork': () => ({}), 'commands/execute': () => undefined,
    'session/prompt': err({ code: 'x/3' }), 'session/create': () => ({}), 'subagents/interruptByParent': () => ({ accepted: false }),
    'workspace/pinSession': () => ({}),
  });
  await r.actions.stop('s1'); follows(r.line(), 'stop: x/1');
  await r.actions.rename('s1', 'New'); follows(r.line(), 'rename: x/2');
  await r.actions.fork('s1'); follows(r.line(), 'fork: session/fork returned no sessionId');
  await r.actions.runCommand('s1', '/<b>'); follows(r.line(), 'no command claimed /<b>');
  await r.actions.send('hello', { sessionId: 's1' }); follows(r.line(), 'send: x/3');
  await r.actions.newConversation({ text: 'hi' }); follows(r.line(), 'new message: session/create returned no sessionId');
  await r.actions.stopChild('s1', 'c1', 'x'); follows(r.line(), 'stop: refused');
  await r.actions.pin('s1'); follows(r.line(), 'Pin failed. Try again later.');
  await r.actions.archive('s1', true); follows(r.line(), 'archive: face/<refused>');
  await r.actions.archive('s1', false); follows(r.line(), 'un-archive: face/<refused>');
  await r.actions.remove('s1'); follows(r.line(), 'delete: face/<refused>');
  await r.actions.answer('ev', 'rejected'); follows(r.line(), 'answer: gate/gone');
  follows(await r.actions.talkTo({ id: 'b', homeCwd: '/b' }), { error: 'talk to: session/create returned no sessionId' });

  const ok = actionsRig({ 'session/cancel': () => ({}), 'subagents/interruptByParent': () => ({}) });
  await ok.actions.stop('s1'); follows(ok.line(), 'Stopped. A paused goal resumes with /goal resume');
  await ok.actions.stopChild('s1', 'c1', ''); follows(ok.line(), 'Stopping the child');
  await ok.actions.stopChild('s1', 'c1', '<Scout>'); follows(ok.line(), 'Stopping <Scout>');

  const busy = actionsRig({}, [conv('s1', { running: true })]);
  await busy.actions.archive('s1', true); follows(busy.line(), 'Stop Gravit first');
  const waiting = actionsRig({}, [conv('s1', { messages: [{ id: 'q', kind: 'question', from: 'gravit', text: '', data: { questions: [] } }] })]);
  await waiting.actions.archive('s1', true); follows(waiting.line(), 'Answer the waiting card first');
});

test("a command's own result and a desk refusal in the desk's words read as they came under any table", async () => {
  const r = actionsRig({ 'commands/execute': () => ({ result: { kind: 'ok', text: "goal <set> & kept" } }) });
  await r.actions.runCommand('s1', '/goal');
  asCame(r.line(), "goal <set> & kept");
  const ds = createStore({ initial: emptyState(), reducers });
  const desk = startDesk({ store: ds, getJson: async () => ({ ok: false, error: "<desk> & down" }), postJson: async () => ({}), schedule: () => 0, cancelTimer: () => {}, now: () => 0 });
  desk.show(true);
  await settle();
  asCame(ds.get().desk.message, "<desk> & down");
  desk.dispose();
});

function liveRig({ list = { items: [] }, call: answer } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const streams = [];
  let opts = null;
  const mux = { stream(name, args, cbs) { streams.push({ name, cbs }); return { cancel() {} }; }, answer: async () => {}, close() {} };
  const call = async (endpoint, args) => (answer ? answer(endpoint, args) : endpoint === 'session/list' ? list : undefined);
  const getJson = async () => ({});
  const timers = { after() { return {}; }, cancel() {} };
  startLive({ store, openMux: o => { opts = o; return mux; }, call, mapFrame, getJson, timers, now: () => 1 });
  return { store, streams, opts: () => opts, line: () => store.get().status.line };
}

test("the live layer's lines", async () => {
  const r = liveRig({ list: { items: null } });
  r.opts().onDown('socket <closed>');
  follows(r.line(), 'Reconnecting… (socket <closed>)');
  r.streams.find(s => s.name === 'session/control').cbs.onError({});
  follows(r.line(), 'live session state unavailable: error');
  r.opts().onReady({});
  await settle();
  follows(r.line(), 'the host answered without a session list');

  const down = liveRig({ call: async endpoint => { if (endpoint === 'session/list') throw Object.assign(new Error('x'), { status: 503 }); } });
  down.opts().onReady({});
  await settle();
  follows(down.line(), 'list: HTTP 503');

  const rows = [{ sessionId: 's1', updatedAt: 5, agentAvailable: false, running: false, blank: false }];
  const cold = liveRig({ call: async endpoint => (endpoint === 'session/list' ? { items: rows } : endpoint === 'session/projections' ? { values: {} } : undefined) });
  cold.opts().onReady({});
  await settle();
  cold.store.dispatch('tasksLoaded', { conversation: 's1', tasks: [], at: 1 });
  cold.store.dispatch('nav', { screen: 'messages', id: null });
  cold.opts().onEvent('api-session/error', ['s1', '']);
  follows(cold.line(), 'the agent failed');
});

test('a trace the loader could not read, with no words of its own', async () => {
  const store = createStore({ initial: emptyState(), reducers });
  const room = conv('room', { kind: 'group', members: ['gravit', 'b'], memberSessions: ['m1'] });
  store.dispatch('hostList', { conversations: [room] });
  store.dispatch('hostEvent', { convId: 'room', message: { id: 'e9', seq: 9, at: 1, from: 'b', kind: 'text', text: 'Hold', data: { memberSessionId: 'm1', memberTurn: 3 } } });
  const traces = startTraces({ store, call: async () => ({}), loadMemberTrace: async () => { throw {}; }, now: () => 5 });
  await traces.open('room', 'e9');
  follows(store.get().traces.room.e9.line, 'The trace could not be read.');
});

test("the jobs' chip and end lines, the pills, and the composer's file lines", () => {
  assert.deepEqual(chipText([{}], []), '1 job running');
  assert.deepEqual(chipText([], [{}, {}]), '2 jobs finished');
  assert.deepEqual(endLine({ status: 'completed', detail: 'exit code: 0' }), 'exit 0');
  assert.deepEqual(endLine({ status: 'completed' }), 'exit');
  assert.deepEqual(endLine({ status: 'killed', detail: 'signal: TERM' }), 'signal TERM');
  assert.deepEqual(endLine({ status: 'killed' }), 'killed');
  assert.deepEqual(endLine({ status: 'failed' }), 'failed');
  assert.deepEqual(pillsText({ turns: 1, steps: 2, speed: 38, tokens: 182_000, cache: 0.63 }), ['1 turn · 2 steps · 38 tok/s', '182k tokens · cache 63%']);
  const big = { key: 'a', name: 'a<b>.png', bytes: DEFAULT_LIMITS.maxImageBytes + 1, mediaType: 'image/png' };
  follows(admit([], [big]).refusal, 'a<b>.png is over 20 MB');
  assert.deepEqual(limitsLine(DEFAULT_LIMITS), 'Images: up to 20 a message, 20 MB each');
  follows(modelRefusalLine('<Scout>'), "<Scout>'s model takes no images. Remove the image, or run <Scout> on a model that does.");
  assert.deepEqual(attachmentsLine([{ type: 'image' }, { type: 'file' }]), 'image, file');
  assert.deepEqual(extOf('README'), 'FILE');
});

// app.js on a fake window: one live conversation, its mux and its uploads recorded for the test to answer
async function appRig() {
  const f = fakeWindow({ hash: '#/messages' });
  const streams = [];
  let opts = null;
  const mux = { stream(name, args, cbs) { const st = { name, args, cbs }; streams.push(st); return { cancel() {} }; }, answer: async () => {}, close() {} };
  const rows = [{ sessionId: 's1', updatedAt: 5, agentAvailable: true, running: false, blank: false }];
  const call = async endpoint => (endpoint === 'session/list' ? { items: rows } : endpoint === 'session/projections' ? { asOfSeq: 20, values: {} } : endpoint === 'session/page' ? { records: [] } : undefined);
  const getJson = async path => (path === '/data/channels.json' ? { ok: true, root: '/r', channels: [], ungrouped: [], archived: [], presets: {} } : path === '/data/tasks' ? { ok: true, conversation: 's1', tasks: [] } : { ok: true, archived: [], deleted: [], bots: [] });
  const uploads = [];
  const attachments = {
    limits: () => DEFAULT_LIMITS, readLimits: async () => true, thumb: async () => {},
    upload(id, file) { const u = {}; u.done = new Promise((resolve, reject) => { u.fail = reject; }); uploads.push(u); return { done: u.done, abort() {} }; },
  };
  const store = boot(f.win, { editor: valueEditor, attachments, openMux: o => { opts = o; return mux; }, call, getJson, postJson: async () => ({ ok: true }), markdown: null, now: () => 1 });
  await settle();
  opts.onReady({});
  await settle();
  return { f, store, streams, uploads };
}

test("app.js's job note: a follow refused with no code, and one the host ended while the job runs", async () => {
  for (const [end, line] of [[st => st.cbs.onError({}), 'output unavailable: error'], [st => st.cbs.onEnd(), 'output ended']]) {
    const { f, store, streams } = await appRig();
    try {
      streams.filter(st => st.name === 'job/list').at(-1).cbs.onItem({ type: 'rows', jobs: [{ id: 'j1', kind: 'bash', label: 'run', owner: 's1', status: 'running', startedAt: 0, output: { total: 0, earliest: 0 } }] });
      store.dispatch('toggleDetails');
      await settle();
      const note = f.withId('jobnote-j1', { presentIf: /id="jobnote-j1"/ });
      f.click({ tagName: 'SUMMARY', dataset: { action: 'openJob', job: 'j1' }, parentElement: { tagName: 'DETAILS', open: false } });
      await settle();
      end(streams.filter(st => st.name === 'job/follow').at(-1));
      assert.deepEqual(note.textContent, line);
    } finally {
      store.timers.clear();
    }
  }
});

test("app.js's upload line: a failure with no words of its own names the file", async () => {
  const { f, store, uploads } = await appRig();
  try {
    const input = f.withId('attach-input', { tagName: 'INPUT', type: 'file' });
    input.files = [{ name: 'a&b.csv', size: 10, type: 'text/csv', arrayBuffer: async () => new ArrayBuffer(0) }];
    f.fire('root', 'change', { target: input });
    uploads[0].fail(new Error(''));
    await settle();
    follows(store.get().status.line, 'upload a&b.csv: the upload failed');
    assert.match(f.html(), /role="status">upload a&amp;b\.csv: the upload failed</);
  } finally {
    store.timers.clear();
  }
});

// ── the Account's lines the host writes (plan 6 Task 6) ──

const refuses = message => Object.assign(new Error(message), { code: 4001 });
const wallet = (answers, name = 'A&B <W>') => ({ id: 'w', name, icon: '', provider: fakeProvider({ answers }) });
const rejects = async (p, message) => assert.deepEqual(await p.then(() => 'resolved', e => e.message), message);

test("the wallet module's refusals, in its words or the wallet's, each param as given", async () => {
  await rejects(proveWallet(wallet({ eth_requestAccounts: () => [] }), async () => ({})), 'the wallet gave no address');
  await rejects(proveWallet(wallet({ eth_requestAccounts: () => { throw {}; } }), async () => ({})), 'the wallet refused');
  await rejects(proveWallet(wallet({}), async () => ({ status: 500, body: {} })), 'no sentence to sign');
  const post = async path => (path.endsWith('/challenge') ? { status: 200, body: { message: 'sign me' } } : { status: 409, body: {} });
  await rejects(proveWallet(wallet({}), post), 'the signature did not check');
  await rejects(walletFor([wallet({ eth_accounts: () => [], eth_requestAccounts: () => [] })], ADDRESS), `No wallet on this page holds ${ADDRESS.slice(0, 8)}…${ADDRESS.slice(-4)}`);
  await rejects(switchChain(wallet({ wallet_switchEthereumChain: () => { throw refuses("<no> & won't"); } }), '0x2105'), "A&B <W> did not switch to the right network: <no> & won't");
  const unknown = () => { throw Object.assign(new Error('unknown'), { code: 4902 }); };
  await rejects(switchChain(wallet({ wallet_switchEthereumChain: unknown, wallet_addEthereumChain: () => { throw refuses('<no>'); } }), '0x1237'), 'A&B <W> did not add Robinhood Chain: <no>');
  await rejects(sendTxs(wallet({}), []), 'nothing for the wallet to send');
  const hash = '0x' + 'ab'.repeat(32);
  await rejects(mined(wallet({ eth_getTransactionReceipt: () => ({ blockNumber: '0x1', status: '0x0' }) }), hash), `transaction 0xababab…abab failed on chain`);
  await rejects(mined(wallet({ eth_getTransactionReceipt: () => null }), hash, { schedule: fn => fn(), everyMs: 1, withinMs: 1 }), 'transaction 0xababab…abab is not on chain yet: try again in a minute');
});

test("the wallet send's lines: no key, nothing to send, a report the Account did not take", async () => {
  const PAY = { id: 'p<1>', at: 'x', status: 'authorized' };
  const store = { s: emptyState(), get() { return this.s; }, dispatch() {} };
  const page = { ok: true, payments: [PAY], orders: [] };
  const run = (post = async () => ({ status: 200, body: { ok: true } })) => startWalletSend({ store, post, getJson: async () => page, getWallets: async () => [wallet({})], schedule: fn => fn() });
  follows(noKey(), 'Nothing was sent: this one carries no id the Account can send for. Refresh and try again.');
  follows((await run().payment({}, null, [])).said, sayOf(noKey()));
  follows((await run().payment(PAY, null, [])).said, 'p<1> has nothing for your wallet to send');
  const TX = { chainIdHex: '0x2105', from: ADDRESS, to: ADDRESS, data: '0x', value: '0x0' };
  const sent = await run(async () => ({ status: 409, body: { error: "<no> & won't" } })).payment(PAY, TX, []);
  assert.match(sayOf(sent.said), /^<no> & won't\. Your wallet sent 0x\w{6}…\w{4}: Report again reports that same transaction, it does not send another$/);
  const silent = await run(async () => ({ status: 500, body: {} })).payment(PAY, TX, []);
  assert.match(sayOf(silent.said), /^the account could not take the transaction\. Your wallet sent /);
});

test("the Account's own lines: an address for another account, a sign-in that did not start or finish", async () => {
  const sr = createStore({ initial: emptyState(), reducers });
  const answers = { receive: { ok: true, venue: 'other', address: '0x1' }, status: { ok: true, status: 'failed' } };
  let started = { status: 500, body: {} };
  const account = startAccount({
    store: sr, getJson: async path => (path.startsWith('/data/account/receive') ? answers.receive : answers.status), post: async () => started,
    now: () => 1, schedule: () => 0, cancelTimer: () => {}, openTab: () => null,
  });
  await account.receive({ venue: 'v', asset: 'USDC', network: 'Base' });
  follows(sr.get().account.receive['v|USDC|Base'].message, 'The account answered for another account or network: nothing is shown. Read again.');
  const RH = { connector: 'live:rh', kind: 'robinhood', label: 'Robinhood' };
  await account.signIn(RH);
  follows(sr.get().account.signIn.message, 'The sign-in could not start.');
  started = { status: 200, body: { url: 'https://rh.example/o', state: 's1' } };
  await account.signIn(RH);
  follows(sr.get().account.signIn.message, 'The sign-in did not finish.');
  account.close();
});

test("Connect Telegram's lines, and a connected network's trouble, each in its words", async () => {
  const sr = createStore({ initial: emptyState(), reducers });
  const id = startIdentity({ store: sr, getJson: async () => ({}), post: async () => ({ status: 200, body: {} }), subtle: null, schedule: () => 0, cancelTimer: () => {}, openSheet: () => {} });
  id.openConnect();
  await id.next({ value: 'tok' });
  follows(sr.get().identity.connect.error, 'This browser cannot fingerprint the token on this page: open the face at its 127.0.0.1 address.');
  follows(Object.values(CONNECT_WORDS).map(f => f()), ['Paste the token from BotFather first.', 'This browser cannot fingerprint the token on this page: open the face at its 127.0.0.1 address.',
    'The account refused the token.', 'The account refused the tokens.', 'Paste the app-level token (xapp-…) first.', 'Paste the bot token (xoxb-…) first.', 'Paste both tokens first.',
    'This connection waited ten minutes and expired: nothing was kept. Start again.', 'The account did not say who wrote: start again.']);
  const problem = n => identityOf({ ok: true, networks: [{ network: 'telegram', state: 'connected', ...n }] }).networks.telegram.problem;
  assert.deepEqual(problem({ pollFailing: {} }), 'Not hearing Telegram.');
  assert.deepEqual(problem({ pollFailing: { reason: '<502> & down' } }), 'Not hearing Telegram: <502> & down.');
  assert.deepEqual(problem({ conflictAt: 'x' }), "Another program reads this bot's messages (since x): stop it, or Gravit hears nothing.");
  const slack = n => identityOf({ ok: true, networks: [{ network: 'slack', state: 'connected', ...n }] }).networks.slack.problem;
  assert.deepEqual(slack({ pollFailing: { since: 'y', reason: 'socket closed' } }), 'Not hearing Slack since y: socket closed.');
  assert.deepEqual(slack({ conflictAt: 'x' }), "Another program holds this app's connection to Slack (since x): stop it, or Gravit hears nothing.");
  assert.equal(slack({ blocked: true }), undefined, 'blocked is Telegram\'s alone');
});

test("Sell many's line for a read that failed in no words of the Account's", async () => {
  const sr = createStore({ initial: emptyState(), reducers });
  const sm = startSellMany({ store: sr, getJson: async () => { throw new Error('x'); }, owner: {} });
  await sm.open('');
  follows(sr.get().sellMany.message, 'What is held could not be read.');
});

test("a Sell many leg in words: a close of all of it, a market sale with the Account's note", () => {
  const item = { asset: 'BTC', held: 0.5, usd: 100, venueName: 'A&B' };
  assert.deepEqual(smLegWords({ item, prepared: { action: { type: 'liveClose', qty: '' } } }), { head: 'Close all 0.5 · BTC', usd: '≈ $100.00', path: 'A&B · at market, it only shrinks the position' });
  const sale = { item, prepared: { action: { type: 'liveOrder' }, quote: { order: { words: 'Sell 0.5 BTC', notionalUsd: 50, note: '<thin> book' } } } };
  assert.deepEqual(smLegWords(sale), { head: 'Sell 0.5 BTC', usd: '≈ $50.00', path: 'A&B · at market · <thin> book' });
});

test("the owner sheets' lines as the sheet holds them: a sign-out's Guard, what is missing, what was asked, what was said", () => {
  follows(guardFirstDone("<a> & b's"), "<a> & b's. Guard is on.");
  follows(guardFirstDone(''), 'Guard is on.');
  follows(guardFirstRefused("<no> & won't"), "Not signed out: <no> & won't. Guard is on.");
  follows(guardFirstRefused(''), 'Not signed out: the account did not answer. Guard is on.');
  const signIn = { options: [{ connector: 'live:x', kind: 'x', needs: 'sign-in', label: "A&B's <x> · more" }] };
  assert.deepEqual(draftOf('connect', { connector: 'live:x', credentialRef: '' }, signIn, 0), "Sign in at A&B's <x> first");
  assert.deepEqual(marketDraftOf('leverage', { leverage: '9' }, { venue: 'v', symbol: 's', maxLeverage: 3 }), 'Leverage is at most 3x here');
  const page = { ok: true, venues: [], cards: [], orders: [], keys: [], signers: { owners: [] }, connectLive: { writes: { capUsd: 1 } } };
  follows(grantOf({ kind: 'letIn', agent: '0xa', agentName: "<A&B's>", text: "<hi> & 'bye'" }, page).seed.askedWords, "<A&B's> asked: “<hi> & 'bye'”");
  follows(grantOf({ kind: 'letIn', agent: '0xa', text: '<hi>' }, page).seed.askedWords, 'An agent asked: “<hi>”');
  follows(earnSaidOf({ result: { earn: { kind: 'withdraw', all: true, asset: '<U&T>', productName: "it's", status: 'done', note: 'n' } } }), "Taking out all <U&T> · it's: done · n");
  follows(earnSaidOf({ result: { earn: { kind: 'supply', amount: '5', asset: 'U', productName: 'P', status: '<queued>' } } }), 'Putting in 5 U · P: <queued>');
  const move = { kind: 'move', prepared: { action: { kind: 'withdraw', from: 'a', to: 'b', toAddress: '0x1' } }, seed: { sources: [{ id: 'a', dests: [{ id: 'b', name: "<B&C's>" }] }] } };
  assert.deepEqual(moveSaysOf(move), ["<B&C's>'s deposit address, checked again before sending.", "Can't be undone."]);
  assert.deepEqual(identityLinesOf('block', { masked: "<x&y's>" }), ["Messages from <x&y's> are dropped and no longer counted."]);
});

test("the owner device's lines as the store holds them: a refusal, what was said, the countdown, no answer", async () => {
  follows(refusalOf({ status: 500, body: {} }).message, 'Refused');
  asCame(refusalOf({ status: 409, body: { ok: false, error: "<no> & won't" } }).message, "<no> & won't");
  follows(saidOf({ kind: 'order', order: { id: 'o<1>', status: 'open' } }), 'o<1> · open on the book');
  follows(saidOf({ kind: 'order', order: { id: 'o', status: '<held>' } }), 'o · <held>');
  follows(saidOf({ kind: 'result' }), 'Done');
  assert.deepEqual(goodForWords(61_000), 'Your signature is good for 1:01 more.');
  follows(await postVia(async () => { throw new Error('x'); })('/p', {}), { status: 0, body: { ok: false, error: 'The account did not answer. Try again.' } });
  const sr = createStore({ initial: emptyState(), reducers });
  const owner = startOwner({ store: sr, post: async () => ({ status: 0, body: {} }), subtle: {}, keys: { get: async () => null }, flag: { get: () => false, set: () => {} } });
  follows(await owner.submit({ action: {}, shown: [] }), { status: 0, body: { ok: false, error: 'This browser does not sign for the account.' } });
  sr.dispatch('sheetOpen', { kind: 'signOut', seed: { kid: 'k', mode: 'open', others: 0 }, fields: [{ name: 'guard', value: true }] });
  sr.dispatch('sheetRefused', {});
  follows(sr.get().sheet.message, 'Refused');
  // a beforeSign that fails with no words of its own: the sheet's own
  const prepared = { action: { type: 'signOut', device: 'device:k' }, shown: [] };
  const sheet = startSheet({ store: sr, owner: { prepare: async () => ({ status: 200, body: prepared }), submit: async () => ({ status: 200, body: {} }) },
    schedule: () => 0, cancelTimer: () => {}, now: () => 0, afterAction: () => {}, beforeSign: () => Promise.reject(undefined) });
  await sheet.open('signOut', { kid: 'k', mode: 'open', others: 0 }, [{ name: 'guard', value: true }]);
  await sheet.submit();
  follows(sr.get().sheet.message, 'no answer');
});

test("Markets', Trade's and the desk's host lines as the store holds them: the desk's failures, the halves down, a draft's missing words, a fill", async () => {
  // the desk's reads and its Pause (host/desk.js): a body that is no status, a read that throws nothing, a refused pause
  const ds = createStore({ initial: emptyState(), reducers });
  const answers = { status: { ok: false }, pause: new Error("<no> & won't") };
  const desk = startDesk({ store: ds, getJson: async () => answers.status, postJson: async () => { throw answers.pause; }, schedule: () => 0, cancelTimer: () => {}, now: () => 0 });
  desk.show(true);
  await settle();
  follows(ds.get().desk.message, 'not a desk status');
  await desk.pause();
  follows(ds.get().desk.message, "Pause failed: <no> & won't");
  const dn = startDesk({ store: ds, getJson: () => Promise.reject(undefined), postJson: async () => ({}), schedule: () => 0, cancelTimer: () => {}, now: () => 1e9 });
  dn.show(true);
  await settle();
  follows(ds.get().desk.message, 'request failed');
  desk.dispose(); dn.dispose();
  // the halves down (host/explore-join.js), the Account down at a connected line and China not answering (host/markets.js)
  follows(accountDown(), { venue: 'account', venueName: 'the Account', why: 'The Account is not answering: the venues connected are not listed' });
  follows(marketDown(), { venue: 'market', venueName: 'the market', why: 'The market is not answering: public markets are not listed' });
  follows(accountDownWord(), 'The Account is not answering');
  assert.deepEqual(notAnsweringWord(), 'The market is not answering · China as last read');
  // the order sheet's missing words (host/trade-view.js tradeDraftOf), kept as the sheet's words
  const ticket = { legs: [{ venue: 'v', symbol: 'S', able: true, session: null }], event: false, outcomes: [] };
  assert.deepEqual(tradeDraftOf({}, null), 'Pick where');
  assert.deepEqual(tradeDraftOf({ venue: 'v', amount: '' }, ticket), 'Type an amount');
  assert.deepEqual(tradeDraftOf({ venue: 'v', amount: '1', orderType: 'limit', limit: 'x' }, ticket), 'Type the limit price');
  assert.deepEqual(tradeDraftOf({ venue: 'v', amount: '1', orderType: 'limit', limit: '120' }, { ...ticket, event: true, outcomes: [{ at: [{ venue: 'v', symbol: 'Y' }] }] }), 'A price in cents is between 0 and 100');
  // a fill, as Trade's said line holds it (host/trade.js): the Account's names put in as they are
  follows(fillWords({ type: 'fill', data: { side: 'buy', qty: 2, kind: 'event', name: "<Fed & co's>", price: 0.62, avg: true, venueName: 'V<1>', paper: true } }),
    "Bought 2 contracts · <Fed & co's> @ 62¢ avg · V<1> · Paper account");
  follows(fillWords({ data: { side: 'sell', kind: 'event', symbol: 'X' } }), 'Sold contracts · X');
});

test("a channel's, Discover's, the Run sheet's and the run view's host lines as the store or the editor holds them", async () => {
  const odd = Object.assign(new Error("<no> & won't"), {});
  // a channel's writes (host/channels.js): the name rule, a channel made but not listed, six bots, a refusal in its words
  // or in none
  const cs = createStore({ initial: emptyState(), reducers });
  const channels = startChannels({ store: cs, postJson: async path => { if (path === '/data/channels') return { dir: 'nowhere' }; throw path === '/data/channels/agents' ? odd : {}; }, getJson: async () => ({}), refresh: async () => {} });
  follows(await channels.create('_template'), { error: 'Letters, digits, - or _' });
  follows(await channels.create('alpha'), { error: 'Created, not listed yet' });
  follows(await channels.setBots('w', ['a', 'b', 'c', 'd', 'e', 'f', 'g']), { error: 'At most six bots' });
  asCame(await channels.setAgents('w', ['codex']), { error: "<no> & won't" });
  follows(await channels.setBots('w', ['a']), { error: 'failed' });
  // Discover's line (host/discover.js): an agent write refused, in its words or none; a save refused; a new bot's refusals
  const ds = createStore({ initial: emptyState(), reducers });
  const discover = startDiscover({ store: ds, getJson: async () => ({ ok: true, bots: [], local: [] }), call: async () => ({}), postJson: async path => {
    if (path === '/data/agents/connect') throw odd;
    if (path === '/data/bots') return { ok: true };
    throw {};
  } });
  await discover.connect('codex');
  follows(ds.get().discover.status, { line: "connect: <no> & won't", bad: true });
  await discover.rescan();
  follows(ds.get().discover.status, { line: 'rescan: failed', bad: true });
  await discover.disconnect('codex');
  follows(ds.get().discover.status, { line: 'disconnect: failed', bad: true });
  await discover.saveBot({ id: 'b', revision: 'r' }, { name: 'B', description: '', model: '', soul: '' });
  follows(ds.get().discover.status, { line: 'save: failed', bad: true });
  follows(await discover.createBot({ name: ' ', id: '' }), { error: 'Give it a name' });
  follows(await discover.createBot({ name: 'Bot', id: '' }), { error: 'Created, not listed yet' });
  // the Run sheet's lines (host/run-sheet.js): no such module, the listing unread
  const rs = createStore({ initial: emptyState(), reducers });
  const unread = startRunSheet({ store: rs, actions: { newConversation: async () => null }, readListing: async () => null, go: () => {}, now: () => 0 });
  await unread.open('nope');
  follows(rs.get().discover.status, { line: 'Not a module', bad: true });
  await unread.open('theme');
  follows(rs.get().runSheet.said, 'the modules listing could not be read');
  const listed = startRunSheet({ store: rs, actions: { newConversation: async () => null }, readListing: async () => modulesListing(), go: () => {}, now: () => 0 });
  await listed.open('theme');
  await listed.run();
  follows(rs.get().runSheet.said, "Couldn't send — the conversation may exist untitled in the channel");
  // the run view's failure words (host/lunhui.js), as the slice holds them: an answer with no view, a read failed in no words
  const RUN = '20261027T201627Z-6937d208';
  const msg = id => ({ id, seq: 1, at: 1, from: 'gravit', kind: 'composed', text: 's', data: { strategy: 'cn-market', run: RUN, blocks: [], choices: [], modules: [id] } });
  const conv = { id: 'c1', title: 'c1', kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: true, updatedAt: 5, created: null, messages: [msg('a'), msg('b'), msg('c')], loaded: true, preview: null, usage: null, thinking: null, lastSeen: 0 };
  const ls = createStore({ initial: { ...emptyState(), tasks: { ...emptyState().tasks, status: 'ready', conversation: 'c1' }, conversations: [conv] }, reducers });
  await ensureViews(ls, async path => { if (path.endsWith('=a')) return { ok: true }; if (path.endsWith('=b')) throw undefined; throw odd; });
  const errors = Object.values(ls.get().lunhui.views).map(v => v.error);
  follows(errors, ['the answer held no view', 'the view could not be read', "<no> & won't"]);
});

// the lines the last pending files (Task 10) write, as they leave the wire modules: plain text, each param as it came
test("the round's end line, a trace's refusals and the model route's refusal read the table, their params as they came", async () => {
  const { roundEndLine } = await import('../../client/js/wire/room.js');
  const { loadMemberTrace } = await import('../../client/js/wire/member-traces.js');
  const { normalizeBotModel } = await import('../../client/js/wire/botSettings.js');
  const turns = [{ bot: 'a', name: 'A<&\'>', state: 'answered' }, { bot: 'b', name: 'B', state: 'timed-out' }, { bot: 'c', state: 'failed' }];
  assert.deepEqual(roundEndLine({ round: 3, outcome: 'capped', turns }), "round 3 · capped - the bot-message cap was reached · answered: A<&'> · failed: c · timed out: B");
  assert.deepEqual(roundEndLine({ round: 1, outcome: 'superseded', turns: [{ bot: 'p', name: 'P', state: 'passed' }] }), 'round 1 · superseded by a new operator message · passed: P');
  assert.deepEqual(roundEndLine({ turns: [] }), 'round ? · ended');
  assert.deepEqual(roundEndLine({ round: 2, outcome: 'settled', turns: [] }), 'round 2 · settled', "an outcome the face has no words for is dsh's");
  await assert.rejects(loadMemberTrace(async () => null, { sessionId: '', turn: 1 }), { message: 'This answer recorded no member turn.' });
  await assert.rejects(loadMemberTrace(async () => null, { sessionId: 'm1', turn: 1 }), { message: 'The member session does not exist.' });
  assert.throws(() => normalizeBotModel('a/b/c'), { message: 'Use provider/model (one slash, no spaces), or leave the model empty to inherit the default.' });
});

// a fetch that throws: postVia answers its refusal body with the face's no-answer words, a said (plan 7 Task 2's fix round).
// Every reader of a refusal body passes it on, so the line is the one it always was, and it follows a switch of the table
const NO_ANSWER = 'The account did not answer. Try again.';
const viaFetch = (answer = () => new Error('offline')) => postVia(async (path, init) => {
  const a = answer(path, JSON.parse(init.body));
  if (a instanceof Error) throw a;
  return { status: a.status, json: async () => a.body };
});

test("a throwing fetch: the Account's bridge routes and a sign-in's start keep the no-answer line", async () => {
  const sr = createStore({ initial: emptyState(), reducers });
  const account = startAccount({ store: sr, getJson: async () => ({}), post: viaFetch(), now: () => 1, schedule: () => 0, cancelTimer: () => {}, openTab: () => null });
  await account.bridgeRoutes({ kind: 'bridge' });
  follows(sr.get().account.routes.message, NO_ANSWER);
  await account.signIn({ connector: 'live:rh', kind: 'robinhood', label: 'Robinhood' });
  follows(sr.get().account.signIn.message, NO_ANSWER);
  account.close();
});

test("a throwing fetch: a wallet's proof says the Account did not answer, not that the sentence or signature failed", async () => {
  const challenge = viaFetch();
  const first = await proveWallet(wallet({}), challenge).then(() => null, e => e);
  assert.equal(first.message, NO_ANSWER);
  follows(first.said, NO_ANSWER);
  const prove = viaFetch(path => (path.endsWith('/challenge') ? { status: 200, body: { message: 'sign me' } } : new Error('offline')));
  const second = await proveWallet(wallet({}), prove).then(() => null, e => e);
  assert.equal(second.message, NO_ANSWER);
  follows(second.said, NO_ANSWER);
});

test("a throwing fetch: a DEX order's swap built again says the Account did not answer", async () => {
  const TXS = ['approve', 'swap'].map(what => ({ chainId: 8453, chainIdHex: '0x2105', from: ADDRESS, to: '0x' + '34'.repeat(20), data: '0xabcd', value: '0x0', what }));
  const ORDER = { id: 'ord-0031', clientId: 'c0ffee00c0ffee00c0ffee00c0ffee00', venue: 'dex', status: 'pending', walletTxs: TXS };
  const store = { s: emptyState(), get() { return this.s; }, dispatch() {} };
  const post = viaFetch(path => (path === '/data/account/live/order-requote' ? new Error('offline') : { status: 200, body: { ok: true } }));
  const ws = startWalletSend({ store, post, getJson: async () => ({ ok: true, orders: [ORDER] }), getWallets: async () => [{ id: 'fake', name: 'Fake Wallet', icon: '', provider: fakeProvider() }], schedule: fn => fn() });
  const out = await ws.order(ORDER);
  assert.equal(out.status, 'refused');
  follows(out.said, NO_ANSWER);
});

test("an explore half refused in the face's words (a said) keeps them for the line both halves failing leave", () => {
  const lands = [];
  const halves = exploreHalves({ store: { get: () => emptyState() }, kinds: new Map(), drop: () => {},
    fly: (kind, path, land) => land({ ok: false, error: said('markets.accountDown') }, true) });
  halves.read('all', 'limit=200', { land: () => {}, failed: why => lands.push(why) });
  assert.equal(lands.length, 1);
  follows(lands[0], 'The Account is not answering');
});
