// The status lines the host layer writes read the words table (plan 6 Task 5): each line, as the store holds it, in its
// exact bytes — plain text, a param put in as it is (never escaped here: renderStatus escapes once) — so a th() stored in
// the state, escaped again at the render, shows.
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

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const conv = (id, over = {}) => ({ id, title: 'T', kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: true, updatedAt: 5, created: null, messages: [], loaded: true, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const err = over => Object.assign(new Error('boom'), over);

function actionsRig(answers = {}, convs = [conv('s1')]) {
  const store = createStore({ initial: emptyState(), reducers });
  store.dispatch('hostList', { conversations: convs });
  store.dispatch('nav', { screen: 'messages', id: 's1' });
  const call = async endpoint => { const a = answers[endpoint]; if (a instanceof Error) throw a; return typeof a === 'function' ? a() : a; };
  const postJson = async () => { throw err({ code: 'face/<refused>' }); };
  const actions = makeActions({ store, call, answerGate: async () => { throw err({ code: 'gate/gone' }); }, postJson, requestId: () => 'r', timeZone: () => 'UTC' });
  return { store, actions, line: () => store.get().status.line };
}

test('the boot line, and a failure line: its verb, then the code, the HTTP status or the message; a 401 as notSignedIn', () => {
  assert.equal(emptyState().status.line, 'connecting…');
  assert.equal(notSignedIn(), 'Not signed in — open the URL gravit-face printed');
  assert.equal(failLine({ status: 401 }, 'fork'), 'Not signed in — open the URL gravit-face printed');
  assert.equal(failLine({ code: 'a/<b>' }, 'fork'), 'fork: a/<b>');
  assert.equal(failLine({ status: 502 }, 'fork'), 'fork: HTTP 502');
  assert.equal(failLine({ message: "can't & won't" }, 'fork'), "fork: can't & won't");
  assert.equal(failLine({}, 'fork'), 'fork: failed');
  assert.equal(renderStatus({ line: failLine({ code: 'a/<b>' }, 'fork') }), '<div class="status-line" role="status">fork: a/&lt;b&gt;</div>', 'escaped once, at the render');
});

test("the actions' lines, each verb in its words", async () => {
  const r = actionsRig({
    'session/cancel': err({ code: 'x/1' }), 'session/rename': err({ code: 'x/2' }), 'session/fork': () => ({}), 'commands/execute': () => undefined,
    'session/prompt': err({ code: 'x/3' }), 'session/create': () => ({}), 'subagents/interruptByParent': () => ({ accepted: false }),
    'workspace/pinSession': () => ({}),
  });
  await r.actions.stop('s1'); assert.equal(r.line(), 'stop: x/1');
  await r.actions.rename('s1', 'New'); assert.equal(r.line(), 'rename: x/2');
  await r.actions.fork('s1'); assert.equal(r.line(), 'fork: session/fork returned no sessionId');
  await r.actions.runCommand('s1', '/<b>'); assert.equal(r.line(), 'no command claimed /<b>');
  await r.actions.send('hello'); assert.equal(r.line(), 'send: x/3');
  await r.actions.newConversation({ text: 'hi' }); assert.equal(r.line(), 'new message: session/create returned no sessionId');
  await r.actions.stopChild('s1', 'c1', 'x'); assert.equal(r.line(), 'stop: refused');
  await r.actions.pin('s1'); assert.equal(r.line(), 'Pin failed. Try again later.');
  await r.actions.archive('s1', true); assert.equal(r.line(), 'archive: face/<refused>');
  await r.actions.archive('s1', false); assert.equal(r.line(), 'un-archive: face/<refused>');
  await r.actions.remove('s1'); assert.equal(r.line(), 'delete: face/<refused>');
  await r.actions.answer('ev', 'rejected'); assert.equal(r.line(), 'answer: gate/gone');
  assert.deepEqual(await r.actions.talkTo({ id: 'b', homeCwd: '/b' }), { error: 'talk to: session/create returned no sessionId' });

  const ok = actionsRig({ 'session/cancel': () => ({}), 'subagents/interruptByParent': () => ({}) });
  await ok.actions.stop('s1'); assert.equal(ok.line(), 'Stopped. A paused goal resumes with /goal resume');
  await ok.actions.stopChild('s1', 'c1', ''); assert.equal(ok.line(), 'Stopping the child');
  await ok.actions.stopChild('s1', 'c1', '<Scout>'); assert.equal(ok.line(), 'Stopping <Scout>');

  const busy = actionsRig({}, [conv('s1', { running: true })]);
  await busy.actions.archive('s1', true); assert.equal(busy.line(), 'Stop Gravit first');
  const waiting = actionsRig({}, [conv('s1', { messages: [{ id: 'q', kind: 'question', from: 'gravit', text: '', data: { questions: [] } }] })]);
  await waiting.actions.archive('s1', true); assert.equal(waiting.line(), 'Answer the waiting card first');
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
  assert.equal(r.line(), 'Reconnecting… (socket <closed>)');
  r.streams.find(s => s.name === 'session/control').cbs.onError({});
  assert.equal(r.line(), 'live session state unavailable: error');
  r.opts().onReady({});
  await settle();
  assert.equal(r.line(), 'the host answered without a session list');

  const down = liveRig({ call: async endpoint => { if (endpoint === 'session/list') throw Object.assign(new Error('x'), { status: 503 }); } });
  down.opts().onReady({});
  await settle();
  assert.equal(down.line(), 'list: HTTP 503');

  const rows = [{ sessionId: 's1', updatedAt: 5, agentAvailable: false, running: false, blank: false }];
  const cold = liveRig({ call: async endpoint => (endpoint === 'session/list' ? { items: rows } : endpoint === 'session/projections' ? { values: {} } : undefined) });
  cold.opts().onReady({});
  await settle();
  cold.store.dispatch('nav', { screen: 'messages', id: 's1' });
  cold.opts().onEvent('api-session/error', ['s1', '']);
  assert.equal(cold.line(), 'the agent failed');
});

test('a trace the loader could not read, with no words of its own', async () => {
  const store = createStore({ initial: emptyState(), reducers });
  const room = conv('room', { kind: 'group', members: ['gravit', 'b'], memberSessions: ['m1'] });
  store.dispatch('hostList', { conversations: [room] });
  store.dispatch('hostEvent', { convId: 'room', message: { id: 'e9', seq: 9, at: 1, from: 'b', kind: 'text', text: 'Hold', data: { memberSessionId: 'm1', memberTurn: 3 } } });
  const traces = startTraces({ store, call: async () => ({}), loadMemberTrace: async () => { throw {}; }, now: () => 5 });
  await traces.open('room', 'e9');
  assert.equal(store.get().traces.room.e9.line, 'The trace could not be read.');
});

test("the jobs' chip and end lines, the pills, and the composer's file lines", () => {
  assert.equal(chipText([{}], []), '1 job running');
  assert.equal(chipText([], [{}, {}]), '2 jobs finished');
  assert.equal(endLine({ status: 'completed', detail: 'exit code: 0' }), 'exit 0');
  assert.equal(endLine({ status: 'completed' }), 'exit');
  assert.equal(endLine({ status: 'killed', detail: 'signal: TERM' }), 'signal TERM');
  assert.equal(endLine({ status: 'killed' }), 'killed');
  assert.equal(endLine({ status: 'failed' }), 'failed');
  assert.deepEqual(pillsText({ turns: 1, steps: 2, speed: 38, tokens: 182_000, cache: 0.63 }), ['1 turn · 2 steps · 38 tok/s', '182k tokens · cache 63%']);
  const big = { key: 'a', name: 'a<b>.png', bytes: DEFAULT_LIMITS.maxImageBytes + 1, mediaType: 'image/png' };
  assert.equal(admit([], [big]).refusal, 'a<b>.png is over 20 MB');
  assert.equal(limitsLine(DEFAULT_LIMITS), 'Images: up to 20 a message, 20 MB each');
  assert.equal(modelRefusalLine('<Scout>'), "<Scout>'s model takes no images. Remove the image, or run <Scout> on a model that does.");
  assert.equal(attachmentsLine([{ type: 'image' }, { type: 'file' }]), 'image, file');
  assert.equal(extOf('README'), 'FILE');
});

// app.js on a fake window: one live conversation, its mux and its uploads recorded for the test to answer
async function appRig() {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const streams = [];
  let opts = null;
  const mux = { stream(name, args, cbs) { const st = { name, args, cbs }; streams.push(st); return { cancel() {} }; }, answer: async () => {}, close() {} };
  const rows = [{ sessionId: 's1', updatedAt: 5, agentAvailable: true, running: false, blank: false }];
  const call = async endpoint => (endpoint === 'session/list' ? { items: rows } : endpoint === 'session/projections' ? { asOfSeq: 20, values: {} } : endpoint === 'session/page' ? { records: [] } : undefined);
  const getJson = async path => (path === '/data/channels.json' ? { ok: true, root: '/r', channels: [], ungrouped: [], archived: [], presets: {} } : { ok: true, archived: [], deleted: [], bots: [] });
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
      assert.equal(note.textContent, line);
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
    assert.equal(store.get().status.line, 'upload a&b.csv: the upload failed');
    assert.match(f.html(), /role="status">upload a&amp;b\.csv: the upload failed</);
  } finally {
    store.timers.clear();
  }
});

// ── the Account's lines the host writes (plan 6 Task 6) ──

const refuses = message => Object.assign(new Error(message), { code: 4001 });
const wallet = (answers, name = 'A&B <W>') => ({ id: 'w', name, icon: '', provider: fakeProvider({ answers }) });
const rejects = async (p, message) => assert.equal(await p.then(() => 'resolved', e => e.message), message);

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
  assert.equal(noKey(), 'Nothing was sent: this one carries no id the Account can send for. Refresh and try again.');
  assert.equal((await run().payment({}, null, [])).said, noKey());
  assert.equal((await run().payment(PAY, null, [])).said, 'p<1> has nothing for your wallet to send');
  const TX = { chainIdHex: '0x2105', from: ADDRESS, to: ADDRESS, data: '0x', value: '0x0' };
  const sent = await run(async () => ({ status: 409, body: { error: "<no> & won't" } })).payment(PAY, TX, []);
  assert.match(sent.said, /^<no> & won't\. Your wallet sent 0x\w{6}…\w{4}: Report again reports that same transaction, it does not send another$/);
  const silent = await run(async () => ({ status: 500, body: {} })).payment(PAY, TX, []);
  assert.match(silent.said, /^the account could not take the transaction\. Your wallet sent /);
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
  assert.equal(sr.get().account.receive['v|USDC|Base'].message, 'The account answered for another account or network: nothing is shown. Read again.');
  const RH = { connector: 'live:rh', kind: 'robinhood', label: 'Robinhood' };
  await account.signIn(RH);
  assert.equal(sr.get().account.signIn.message, 'The sign-in could not start.');
  started = { status: 200, body: { url: 'https://rh.example/o', state: 's1' } };
  await account.signIn(RH);
  assert.equal(sr.get().account.signIn.message, 'The sign-in did not finish.');
  account.close();
});

test("Connect Telegram's lines, and a connected network's trouble, each in its words", async () => {
  const sr = createStore({ initial: emptyState(), reducers });
  const id = startIdentity({ store: sr, getJson: async () => ({}), post: async () => ({ status: 200, body: {} }), subtle: null, schedule: () => 0, cancelTimer: () => {}, openSheet: () => {} });
  id.openConnect();
  await id.next({ value: 'tok' });
  assert.equal(sr.get().identity.connect.error, 'This browser cannot fingerprint the token on this page: open the face at its 127.0.0.1 address.');
  assert.deepEqual(Object.values(CONNECT_WORDS).map(f => f()), ['Paste the token from BotFather first.', 'This browser cannot fingerprint the token on this page: open the face at its 127.0.0.1 address.',
    'The account refused the token.', 'This connection waited ten minutes and expired: nothing was kept. Start again.', 'The account did not say who wrote: start again.']);
  const problem = n => identityOf({ ok: true, networks: [{ network: 'telegram', state: 'connected', ...n }] }).networks.telegram.problem;
  assert.equal(problem({ pollFailing: {} }), 'Not hearing Telegram.');
  assert.equal(problem({ pollFailing: { reason: '<502> & down' } }), 'Not hearing Telegram: <502> & down.');
  assert.equal(problem({ conflictAt: 'x' }), "Another program reads this bot's messages (since x): stop it, or Gravit hears nothing.");
});

test("Sell many's line for a read that failed in no words of the Account's", async () => {
  const sr = createStore({ initial: emptyState(), reducers });
  const sm = startSellMany({ store: sr, getJson: async () => { throw new Error('x'); }, owner: {} });
  await sm.open('');
  assert.equal(sr.get().sellMany.message, 'What is held could not be read.');
});

test("a Sell many leg in words: a close of all of it, a market sale with the Account's note", () => {
  const item = { asset: 'BTC', held: 0.5, usd: 100, venueName: 'A&B' };
  assert.deepEqual(smLegWords({ item, prepared: { action: { type: 'liveClose', qty: '' } } }), { head: 'Close all 0.5 · BTC', usd: '≈ $100.00', path: 'A&B · at market, it only shrinks the position' });
  const sale = { item, prepared: { action: { type: 'liveOrder' }, quote: { order: { words: 'Sell 0.5 BTC', notionalUsd: 50, note: '<thin> book' } } } };
  assert.deepEqual(smLegWords(sale), { head: 'Sell 0.5 BTC', usd: '≈ $50.00', path: 'A&B · at market · <thin> book' });
});

test("the owner sheets' lines as the sheet holds them: a sign-out's Guard, what is missing, what was asked, what was said", () => {
  assert.equal(guardFirstDone("<a> & b's"), "<a> & b's. Guard is on.");
  assert.equal(guardFirstDone(''), 'Guard is on.');
  assert.equal(guardFirstRefused("<no> & won't"), "Not signed out: <no> & won't. Guard is on.");
  assert.equal(guardFirstRefused(''), 'Not signed out: the account did not answer. Guard is on.');
  const signIn = { options: [{ connector: 'live:x', kind: 'x', needs: 'sign-in', label: "A&B's <x> · more" }] };
  assert.equal(draftOf('connect', { connector: 'live:x', credentialRef: '' }, signIn, 0), "Sign in at A&B's <x> first");
  assert.equal(marketDraftOf('leverage', { leverage: '9' }, { venue: 'v', symbol: 's', maxLeverage: 3 }), 'Leverage is at most 3x here');
  const page = { ok: true, venues: [], cards: [], orders: [], keys: [], signers: { owners: [] }, connectLive: { writes: { capUsd: 1 } } };
  assert.equal(grantOf({ kind: 'letIn', agent: '0xa', agentName: "<A&B's>", text: "<hi> & 'bye'" }, page).seed.askedWords, "<A&B's> asked: “<hi> & 'bye'”");
  assert.equal(grantOf({ kind: 'letIn', agent: '0xa', text: '<hi>' }, page).seed.askedWords, 'An agent asked: “<hi>”');
  assert.equal(earnSaidOf({ result: { earn: { kind: 'withdraw', all: true, asset: '<U&T>', productName: "it's", status: 'done', note: 'n' } } }), "Taking out all <U&T> · it's: done · n");
  assert.equal(earnSaidOf({ result: { earn: { kind: 'supply', amount: '5', asset: 'U', productName: 'P', status: '<queued>' } } }), 'Putting in 5 U · P: <queued>');
  const move = { kind: 'move', prepared: { action: { kind: 'withdraw', from: 'a', to: 'b', toAddress: '0x1' } }, seed: { sources: [{ id: 'a', dests: [{ id: 'b', name: "<B&C's>" }] }] } };
  assert.deepEqual(moveSaysOf(move), ["<B&C's>'s deposit address, checked again before sending.", "Can't be undone."]);
  assert.deepEqual(identityLinesOf('block', { masked: "<x&y's>" }), ["Messages from <x&y's> are dropped and no longer counted."]);
});

test("the owner device's lines as the store holds them: a refusal, what was said, the countdown, no answer", async () => {
  assert.equal(refusalOf({ status: 500, body: {} }).message, 'Refused');
  assert.equal(refusalOf({ status: 409, body: { ok: false, error: "<no> & won't" } }).message, "<no> & won't");
  assert.equal(saidOf({ kind: 'order', order: { id: 'o<1>', status: 'open' } }), 'o<1> · open on the book');
  assert.equal(saidOf({ kind: 'order', order: { id: 'o', status: '<held>' } }), 'o · <held>');
  assert.equal(saidOf({ kind: 'result' }), 'Done');
  assert.equal(goodForWords(61_000), 'Your signature is good for 1:01 more.');
  assert.deepEqual(await postVia(async () => { throw new Error('x'); })('/p', {}), { status: 0, body: { ok: false, error: 'The account did not answer. Try again.' } });
  const sr = createStore({ initial: emptyState(), reducers });
  const owner = startOwner({ store: sr, post: async () => ({ status: 0, body: {} }), subtle: {}, keys: { get: async () => null }, flag: { get: () => false, set: () => {} } });
  assert.deepEqual(await owner.submit({ action: {}, shown: [] }), { status: 0, body: { ok: false, error: 'This browser does not sign for the account.' } });
  sr.dispatch('sheetOpen', { kind: 'signOut', seed: { kid: 'k', mode: 'open', others: 0 }, fields: [{ name: 'guard', value: true }] });
  sr.dispatch('sheetRefused', {});
  assert.equal(sr.get().sheet.message, 'Refused');
  // a beforeSign that fails with no words of its own: the sheet's own
  const prepared = { action: { type: 'signOut', device: 'device:k' }, shown: [] };
  const sheet = startSheet({ store: sr, owner: { prepare: async () => ({ status: 200, body: prepared }), submit: async () => ({ status: 200, body: {} }) },
    schedule: () => 0, cancelTimer: () => {}, now: () => 0, afterAction: () => {}, beforeSign: () => Promise.reject(undefined) });
  await sheet.open('signOut', { kid: 'k', mode: 'open', others: 0 }, [{ name: 'guard', value: true }]);
  await sheet.submit();
  assert.equal(sr.get().sheet.message, 'no answer');
});

test("Markets', Trade's and the desk's host lines as the store holds them: the desk's failures, the halves down, a draft's missing words, a fill", async () => {
  // the desk's reads and its Pause (host/desk.js): a body that is no status, a read that throws nothing, a refused pause
  const ds = createStore({ initial: emptyState(), reducers });
  const answers = { status: { ok: false }, pause: new Error("<no> & won't") };
  const desk = startDesk({ store: ds, getJson: async () => answers.status, postJson: async () => { throw answers.pause; }, schedule: () => 0, cancelTimer: () => {}, now: () => 0 });
  desk.show(true);
  await settle();
  assert.equal(ds.get().desk.message, 'not a desk status');
  await desk.pause();
  assert.equal(ds.get().desk.message, "Pause failed: <no> & won't");
  const dn = startDesk({ store: ds, getJson: () => Promise.reject(undefined), postJson: async () => ({}), schedule: () => 0, cancelTimer: () => {}, now: () => 1e9 });
  dn.show(true);
  await settle();
  assert.equal(ds.get().desk.message, 'request failed');
  desk.dispose(); dn.dispose();
  // the halves down (host/explore-join.js), the Account down at a connected line and China not answering (host/markets.js)
  assert.deepEqual(accountDown(), { venue: 'account', venueName: 'the Account', why: 'The Account is not answering: the venues connected are not listed' });
  assert.deepEqual(marketDown(), { venue: 'market', venueName: 'the market', why: 'The market is not answering: public markets are not listed' });
  assert.equal(accountDownWord(), 'The Account is not answering');
  assert.equal(notAnsweringWord(), 'The market is not answering · China as last read');
  // the order sheet's missing words (host/trade-view.js tradeDraftOf), kept as the sheet's words
  const ticket = { legs: [{ venue: 'v', symbol: 'S', able: true, session: null }], event: false, outcomes: [] };
  assert.equal(tradeDraftOf({}, null), 'Pick where');
  assert.equal(tradeDraftOf({ venue: 'v', amount: '' }, ticket), 'Type an amount');
  assert.equal(tradeDraftOf({ venue: 'v', amount: '1', orderType: 'limit', limit: 'x' }, ticket), 'Type the limit price');
  assert.equal(tradeDraftOf({ venue: 'v', amount: '1', orderType: 'limit', limit: '120' }, { ...ticket, event: true, outcomes: [{ at: [{ venue: 'v', symbol: 'Y' }] }] }), 'A price in cents is between 0 and 100');
  // a fill, as Trade's said line holds it (host/trade.js): the Account's names put in as they are
  assert.equal(fillWords({ type: 'fill', data: { side: 'buy', qty: 2, kind: 'event', name: "<Fed & co's>", price: 0.62, avg: true, venueName: 'V<1>', paper: true } }),
    "Bought 2 contracts · <Fed & co's> @ 62¢ avg · V<1> · Paper account");
  assert.equal(fillWords({ data: { side: 'sell', kind: 'event', symbol: 'X' } }), 'Sold contracts · X');
});

test("a channel's, Discover's, the Run sheet's and the run view's host lines as the store or the editor holds them", async () => {
  const odd = Object.assign(new Error("<no> & won't"), {});
  // a channel's writes (host/channels.js): the name rule, a channel made but not listed, six bots, a refusal in its words
  // or in none
  const cs = createStore({ initial: emptyState(), reducers });
  const channels = startChannels({ store: cs, postJson: async path => { if (path === '/data/channels') return { dir: 'nowhere' }; throw path === '/data/channels/agents' ? odd : {}; }, getJson: async () => ({}), refresh: async () => {} });
  assert.deepEqual(await channels.create('_template'), { error: 'Letters, digits, - or _' });
  assert.deepEqual(await channels.create('alpha'), { error: 'Created, not listed yet' });
  assert.deepEqual(await channels.setBots('w', ['a', 'b', 'c', 'd', 'e', 'f', 'g']), { error: 'At most six bots' });
  assert.deepEqual(await channels.setAgents('w', ['codex']), { error: "<no> & won't" });
  assert.deepEqual(await channels.setBots('w', ['a']), { error: 'failed' });
  // Discover's line (host/discover.js): an agent write refused, in its words or none; a save refused; a new bot's refusals
  const ds = createStore({ initial: emptyState(), reducers });
  const discover = startDiscover({ store: ds, getJson: async () => ({ ok: true, bots: [], local: [] }), call: async () => ({}), postJson: async path => {
    if (path === '/data/agents/connect') throw odd;
    if (path === '/data/bots') return { ok: true };
    throw {};
  } });
  await discover.connect('codex');
  assert.deepEqual(ds.get().discover.status, { line: "connect: <no> & won't", bad: true });
  await discover.rescan();
  assert.deepEqual(ds.get().discover.status, { line: 'rescan: failed', bad: true });
  await discover.disconnect('codex');
  assert.deepEqual(ds.get().discover.status, { line: 'disconnect: failed', bad: true });
  await discover.saveBot({ id: 'b', revision: 'r' }, { name: 'B', description: '', model: '', soul: '' });
  assert.deepEqual(ds.get().discover.status, { line: 'save: failed', bad: true });
  assert.deepEqual(await discover.createBot({ name: ' ', id: '' }), { error: 'Give it a name' });
  assert.deepEqual(await discover.createBot({ name: 'Bot', id: '' }), { error: 'Created, not listed yet' });
  // the Run sheet's lines (host/run-sheet.js): no such module, the listing unread
  const rs = createStore({ initial: emptyState(), reducers });
  const unread = startRunSheet({ store: rs, actions: { newConversation: async () => null }, readListing: async () => null, go: () => {}, now: () => 0 });
  await unread.open('nope');
  assert.deepEqual(rs.get().discover.status, { line: 'Not a module', bad: true });
  await unread.open('theme');
  assert.equal(rs.get().runSheet.said, 'the modules listing could not be read');
  const listed = startRunSheet({ store: rs, actions: { newConversation: async () => null }, readListing: async () => modulesListing(), go: () => {}, now: () => 0 });
  await listed.open('theme');
  await listed.run();
  assert.equal(rs.get().runSheet.said, "Couldn't send — the conversation may exist untitled in the channel");
  // the run view's failure words (host/lunhui.js), as the slice holds them: an answer with no view, a read failed in no words
  const RUN = '20261027T201627Z-6937d208';
  const msg = id => ({ id, seq: 1, at: 1, from: 'gravit', kind: 'composed', text: 's', data: { strategy: 'cn-market', run: RUN, blocks: [], choices: [], modules: [id] } });
  const conv = { id: 'c1', title: 'c1', kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: true, updatedAt: 5, created: null, messages: [msg('a'), msg('b'), msg('c')], loaded: true, preview: null, usage: null, thinking: null, lastSeen: 0 };
  const ls = createStore({ initial: { ...emptyState(), route: { screen: 'messages', id: 'c1' }, conversations: [conv] }, reducers });
  await ensureViews(ls, async path => { if (path.endsWith('=a')) return { ok: true }; if (path.endsWith('=b')) throw undefined; throw odd; });
  const errors = Object.values(ls.get().lunhui.views).map(v => v.error);
  assert.deepEqual(errors, ['the answer held no view', 'the view could not be read', "<no> & won't"]);
});
