// Account › Identity's Connect Telegram (plan B1b Task 2, spec §5.2–§5.3): host/identity.js over a recorded door and a fake clock.
// The token travels once, from sheet 1's field to the token route, beside the fingerprint made here; the field is cleared and the
// store never holds it. Sheet 2 reads the pending connection every 1.5 s until the bot hears someone; sheet 3's Not me waits again
// and This is me opens sheet 4, the owner sheet, seeded from the pending connection. Closing drops the pending connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { ACT, postAct } from '../../client/js/host/act.js';
import { startIdentity, fingerprintOf, copyManifest, PENDING_POLL_MS, TOKEN_PATHS } from '../../client/js/host/identity.js';
const TOKEN_PATH = TOKEN_PATHS.telegram;
import { renderConnectDrawer } from '../../client/js/render/identity.js';
import { spoken } from './helpers/spoken.js';

const TOKEN = '7000000001:AAFakeTokenForTestsOnly_abcdefghijklmn';
const START = Date.parse('2026-11-04T15:00:00.000Z');
const NO_PENDING = 'This connection is gone: it expired or was closed. Start again.';
const ALL_TELEGRAM = 'chat=telegram;alerts=telegram;brief=telegram;cards=telegram;fills=telegram';
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };
const sha256hex = (saltHex, token) => createHash('sha256').update(Buffer.from(saltHex, 'hex')).update(Buffer.from(token, 'utf8')).digest('hex');

const PENDING = {
  id: '0123456789abcdef0123456789abcdef', network: 'telegram', bot: { id: '777', username: 'gravit_desk_bot', name: 'Gravit' },
  link: 'https://t.me/gravit_desk_bot', qr: 'data:image/svg+xml;base64,PHN2Zy8+', expiresAt: '2026-11-04T15:10:00.000Z', state: 'waiting',
};
const HEARD = { ...PENDING, state: 'heard', sender: { id: '555000123', name: 'Pan', handle: '@pan', masked: '…123', text: '/start' } };

function fakeTimers(clock) {
  const pending = new Map();
  let next = 1;
  return {
    pending,
    schedule: (fn, ms) => { const h = next++; pending.set(h, { fn, at: clock.t + ms, ms }); return h; },
    cancelTimer: h => { pending.delete(h); },
    async advance(ms) {
      const end = clock.t + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        clock.t = due[1].at;
        due[1].fn();
        await settle();
      }
      clock.t = end;
    },
  };
}

// the door the host posts through ({status, body}, as host/owner.js postVia answers) and the reads it makes
const EMPTY_READ = { ok: true, networks: [], routing: { chat: [], alerts: [], brief: [], cards: [], fills: [] }, quiet: null, strangers: [] };
function rig({ tokenAnswer = { status: 200, body: { ok: true, pending: PENDING } }, reads = [], read = EMPTY_READ, actAnswer = { status: 200, body: { ok: true } }, role = 'signs' } = {}) {
  const clock = { t: START };
  const timers = fakeTimers(clock);
  const store = createStore({ initial: emptyState(START), reducers });
  store.dispatch('ownerStanding', { role, kid: 'a5048199a8081854' });
  store.dispatch('identityLoaded', read);
  const posts = [];
  const gets = [];
  const answers = { notMe: [] };
  const post = async (path, body) => {
    posts.push({ path, body });
    if (path === ACT) return typeof actAnswer === 'function' ? actAnswer(body) : actAnswer;
    if (path === TOKEN_PATH || path === TOKEN_PATHS.slack || path === TOKEN_PATHS.imessage) return tokenAnswer;
    if (path.endsWith('/not-me')) return answers.notMe.shift() ?? { status: 200, body: { ok: true, pending: PENDING } };
    return { status: 200, body: { ok: true } };
  };
  const getJson = async path => {
    gets.push(path);
    // Identity's own read, again after an act: the read the rig began with
    if (/^\/data\/account\/identity(\?|$)/.test(path)) return read;
    const r = reads.length ? reads.shift() : { ok: true, pending: PENDING };
    if (r instanceof Error) throw r;
    return r;
  };
  const identity = startIdentity({
    store, getJson, post, subtle: webcrypto.subtle, schedule: timers.schedule, cancelTimer: timers.cancelTimer, now: () => clock.t,
  });
  return { clock, timers, store, posts, gets, answers, identity };
}
const acts = posts => posts.filter(p => p.path === ACT).map(p => p.body.action);
const field = (value = TOKEN) => ({ value });
const drops = posts => posts.filter(p => p.path === '/data/account/identity/pending/drop');

test('fingerprintOf: 16 random bytes of salt as 32 lower-case hex, keyHash the SHA-256 of the salt bytes then the token', async () => {
  const fp = await fingerprintOf(webcrypto.subtle, TOKEN);
  assert.match(fp.salt, /^[0-9a-f]{32}$/);
  assert.match(fp.keyHash, /^[0-9a-f]{64}$/);
  assert.equal(fp.keyHash, sha256hex(fp.salt, TOKEN));
  const fixed = await fingerprintOf(webcrypto.subtle, TOKEN, n => new Uint8Array(n).fill(0xab));
  assert.equal(fixed.salt, 'ab'.repeat(16));
  assert.notEqual((await fingerprintOf(webcrypto.subtle, TOKEN)).salt, fp.salt, 'a fresh salt each time');
});

test('Next hashes the token in the browser, posts it once, clears the field, and keeps no token in the store', async () => {
  const r = rig();
  r.identity.openConnect();
  const input = field();
  await r.identity.next(input);
  const sent = r.posts.filter(p => p.path === TOKEN_PATH);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].path, '/data/account/identity/telegram/token');
  assert.deepEqual(Object.keys(sent[0].body).sort(), ['keyHash', 'salt', 'token']);
  assert.equal(sent[0].body.token, TOKEN);
  assert.equal(sent[0].body.keyHash, sha256hex(sent[0].body.salt, TOKEN));
  assert.equal(input.value, '');
  const c = r.store.get().identity.connect;
  assert.equal(c.step, 2);
  assert.deepEqual(c.fp, { salt: sent[0].body.salt, keyHash: sent[0].body.keyHash });
  assert.ok(!JSON.stringify(r.store.get()).includes(TOKEN), 'no token in the store');
  assert.ok(!renderConnectDrawer(r.store.get()).includes(TOKEN), 'none drawn');
  // no other request ever carries it
  assert.equal(r.posts.filter(p => JSON.stringify(p.body).includes(TOKEN)).length, 1);
});

test('Next twice posts the token once', async () => {
  let release;
  const held = new Promise(res => { release = res; });
  const r = rig({ tokenAnswer: held });
  r.identity.openConnect();
  const input = field();
  const first = r.identity.next(input);
  await settle();
  assert.equal(r.store.get().identity.connect.busy, true);
  input.value = TOKEN;   // typed again while the first is in the air
  await r.identity.next(input);
  release({ status: 200, body: { ok: true, pending: PENDING } });
  await first;
  assert.equal(r.posts.filter(p => p.path === TOKEN_PATH).length, 1);
  assert.equal(input.value, TOKEN, 'the second press did not touch the field');
  assert.equal(r.store.get().identity.connect.step, 2);
});

test('a token the account refuses shows its sentence on sheet 1 and stays there', async () => {
  const words = 'Telegram does not know this token: nothing was kept. Copy it from BotFather again.';
  const r = rig({ tokenAnswer: { status: 409, body: { ok: false, error: words } } });
  r.identity.openConnect();
  const input = field();
  await r.identity.next(input);
  const c = r.store.get().identity.connect;
  assert.equal(c.step, 1);
  assert.equal(c.error, words);
  assert.equal(c.busy, false);
  assert.equal(c.pending, null);
  assert.equal(input.value, '');
  assert.match(renderConnectDrawer(r.store.get()), new RegExp(words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(r.timers.pending.size, 0, 'nothing polled');
  // a refusal whose words carried the token is never drawn with it
  const r2 = rig({ tokenAnswer: { status: 400, body: { ok: false, error: `bad ${TOKEN}` } } });
  r2.identity.openConnect();
  await r2.identity.next(field());
  assert.ok(!JSON.stringify(r2.store.get()).includes(TOKEN));
  // an empty field posts nothing
  const r3 = rig();
  r3.identity.openConnect();
  await r3.identity.next(field('  '));
  assert.equal(r3.posts.length, 0);
  assert.equal(spoken(r3.store.get().identity.connect.error), 'Paste the token from BotFather first.');
});

test('sheet 2: Say hi with the t.me link, the QR as an img, the expiry, and its steps; it moves to 3 when the pending is heard', async () => {
  const r = rig({ reads: [{ ok: true, pending: PENDING }, { ok: true, pending: { ...PENDING, state: 'conflict' } }, { ok: true, pending: HEARD }] });
  r.identity.openConnect();
  await r.identity.next(field());
  assert.equal(r.gets.length, 0);
  assert.deepEqual([...r.timers.pending.values()].map(t => t.ms), [PENDING_POLL_MS]);
  assert.equal(PENDING_POLL_MS, 1500);
  await r.timers.advance(1499);
  assert.equal(r.gets.length, 0);
  await r.timers.advance(1);
  assert.equal(r.gets.length, 1);
  assert.ok(r.gets[0].startsWith(`/data/account/identity/pending?id=${PENDING.id}`), r.gets[0]);
  assert.match(r.gets[0], /[?&]fresh=1\b/);
  const html = renderConnectDrawer(r.store.get());
  assert.match(html, /Connect Telegram · 2 of 3 · Say hi/);
  assert.match(html, /<a href="https:\/\/t\.me\/gravit_desk_bot" target="_blank" rel="noopener noreferrer">t\.me\/gravit_desk_bot<\/a>/);
  assert.match(html, /<img class="identity-qr" src="data:image\/svg\+xml;base64,PHN2Zy8\+" alt="QR code for t\.me\/gravit_desk_bot"/);
  assert.match(html, /This connection waits until 10:10 ET; after that, start again\./);
  // the conflict is said, and the sheet keeps waiting
  await r.timers.advance(PENDING_POLL_MS);
  assert.match(renderConnectDrawer(r.store.get()), /Another program reads this bot&#39;s messages/);
  assert.equal(r.store.get().identity.connect.step, 2);
  await r.timers.advance(PENDING_POLL_MS);
  assert.equal(r.store.get().identity.connect.step, 3);
  assert.equal(r.timers.pending.size, 0, 'no poll once heard');
  // a qr without the prefix draws no img
  const odd = { ...r.store.get(), identity: { ...r.store.get().identity, connect: { ...r.store.get().identity.connect, step: 2, pending: { ...PENDING, qr: '<svg onload="x()"/>' } } } };
  assert.doesNotMatch(renderConnectDrawer(odd), /<img/);
  assert.doesNotMatch(renderConnectDrawer(odd), /<svg/);
  // a link that is not the bot's t.me page is no link (and no QR beside it)
  const elsewhere = { ...odd, identity: { ...odd.identity, connect: { ...odd.identity.connect, pending: { ...PENDING, link: 'https://evil.test/x' } } } };
  assert.doesNotMatch(renderConnectDrawer(elsewhere), /<a |<img/);
});

test('sheet 2: a pending connection gone or expired says so with Start again', async () => {
  const gone = Object.assign(new Error('HTTP 404'), { status: 404, body: { ok: false, error: NO_PENDING } });
  const r = rig({ reads: [gone] });
  r.identity.openConnect();
  await r.identity.next(field());
  await r.timers.advance(PENDING_POLL_MS);
  const c = r.store.get().identity.connect;
  assert.equal(c.step, 2);
  assert.equal(c.error, NO_PENDING);
  assert.match(renderConnectDrawer(r.store.get()), /data-action="identityStartAgain">Start again</);
  assert.equal(r.timers.pending.size, 0);
  const r2 = rig({ reads: [{ ok: true, pending: { ...PENDING, state: 'expired' } }] });
  r2.identity.openConnect();
  await r2.identity.next(field());
  await r2.timers.advance(PENDING_POLL_MS);
  assert.match(spoken(r2.store.get().identity.connect.error), /expired/);
  r2.identity.startAgain();
  assert.equal(r2.store.get().identity.connect.step, 1);
  assert.equal(drops(r2.posts).length, 1);
});

test('sheet 3: Is this you? with name, handle, masked id and message; Not me posts not-me and goes back to 2', async () => {
  const r = rig({ reads: [{ ok: true, pending: HEARD }, { ok: true, pending: HEARD }] });
  r.identity.openConnect();
  await r.identity.next(field());
  await r.timers.advance(PENDING_POLL_MS);
  const html = renderConnectDrawer(r.store.get());
  assert.match(html, /Connect Telegram · 3 of 3 · Is this you\?/);
  for (const line of ['Name: Pan', 'Handle: @pan', 'Telegram id: …123', 'Message: /start']) assert.ok(html.includes(line), line);
  assert.ok(!html.includes('555000123'), 'the full id is never drawn');
  for (const k of ['identityBack', 'identityClose', 'identityNotMe', 'identityThisIsMe']) assert.match(html, new RegExp(`data-action="${k}"`), k);
  r.answers.notMe.push({ status: 200, body: { ok: true, pending: PENDING } });
  await r.identity.notMe();
  assert.deepEqual(r.posts.at(-1), { path: '/data/account/identity/pending/not-me', body: { id: PENDING.id } });
  assert.equal(r.store.get().identity.connect.step, 2);
  assert.equal(r.store.get().identity.connect.pending.sender, undefined);
  assert.equal(r.timers.pending.size, 1, 'waiting again');
  // Back from 3 waits on sheet 2 again; Back from 2 drops the pending connection and returns to 1
  await r.timers.advance(PENDING_POLL_MS);
  assert.equal(r.store.get().identity.connect.step, 3);
  r.identity.back();
  assert.equal(r.store.get().identity.connect.step, 2);
  assert.equal(drops(r.posts).length, 0);
  r.identity.back();
  assert.equal(r.store.get().identity.connect.step, 1);
  assert.equal(r.store.get().identity.connect.pending, null);
  assert.equal(r.store.get().identity.connect.fp, null);
  assert.deepEqual(drops(r.posts).map(p => p.body), [{ id: PENDING.id }]);
  assert.equal(r.timers.pending.size, 0);
});

test('This is me connects: connectNetwork goes to /data/account/act, the drawer closes, Identity reloads', async () => {
  const r = rig({ reads: [{ ok: true, pending: HEARD }] });
  r.identity.openConnect();
  await r.identity.next(field());
  await r.timers.advance(PENDING_POLL_MS);
  const { fp } = r.store.get().identity.connect;
  const before = r.gets.length;
  await r.identity.thisIsMe();
  await settle();
  assert.deepEqual(acts(r.posts), [{
    type: 'connectNetwork', network: 'telegram', pending: PENDING.id, botId: '777', speaksAs: '@gravit_desk_bot', operatorId: '555000123', talksOnlyWith: '@pan', routing: ALL_TELEGRAM, keyHash: fp.keyHash, salt: fp.salt,
  }]);
  // no sheet opened, the drawer closed without dropping (the account keeps the connection), Identity read again past the cache
  assert.equal(r.store.get().sheet ?? null, null);
  assert.equal(r.store.get().identity.connect, null);
  assert.equal(drops(r.posts).length, 0);
  assert.ok(r.gets.slice(before).includes('/data/account/identity?fresh=1'));
  assert.equal(r.timers.pending.size, 0, 'no poll left');
  assert.ok(!JSON.stringify(r.posts.filter(p => p.path === ACT)).includes(TOKEN));
  // a sender with no handle is talked with by their masked id
  const r2 = rig({ reads: [{ ok: true, pending: { ...HEARD, sender: { ...HEARD.sender, handle: '' } } }] });
  r2.identity.openConnect();
  await r2.identity.next(field());
  await r2.timers.advance(PENDING_POLL_MS);
  await r2.identity.thisIsMe();
  assert.equal(acts(r2.posts)[0].talksOnlyWith, '…123');
});

test('This is me connects on a page that does not sign too', async () => {
  const r = rig({ role: 'none', reads: [{ ok: true, pending: HEARD }] });
  r.identity.openConnect();
  await r.identity.next(field());
  await r.timers.advance(PENDING_POLL_MS);
  await r.identity.thisIsMe();
  assert.equal(acts(r.posts).length, 1);
  assert.equal(r.store.get().identity.connect, null);
});

test("This is me refused: sheet 3 stays with the account's words and Start again", async () => {
  const actAnswer = { status: 409, body: { ok: false, refusal: { ok: false, code: 'E_ACCOUNT_BAD_ACTION', layer: 'account', message: NO_PENDING } } };
  const r = rig({ reads: [{ ok: true, pending: HEARD }], actAnswer });
  r.identity.openConnect();
  await r.identity.next(field());
  await r.timers.advance(PENDING_POLL_MS);
  const gets = r.gets.length;
  await r.identity.thisIsMe();
  const c = r.store.get().identity.connect;
  assert.equal(c.step, 3);
  assert.equal(c.busy, false);
  assert.equal(c.error, NO_PENDING);
  assert.equal(r.gets.length, gets, 'nothing read again');
  assert.equal(r.timers.pending.size, 0, 'sheet 3 does not poll');
  const html = renderConnectDrawer(r.store.get());
  assert.ok(html.includes(NO_PENDING), "the account's words");
  assert.match(html, /data-action="identityStartAgain">Start again</);
  // Start again: the pending connection dropped, sheet 1 again
  r.identity.startAgain();
  assert.equal(r.store.get().identity.connect.step, 1);
  assert.deepEqual(drops(r.posts).map(p => p.body), [{ id: PENDING.id }]);
  // a door that does not answer says so on sheet 3 too
  const r2 = rig({ reads: [{ ok: true, pending: HEARD }], actAnswer: () => { throw new Error('down'); } });
  r2.identity.openConnect();
  await r2.identity.next(field());
  await r2.timers.advance(PENDING_POLL_MS);
  await r2.identity.thisIsMe();
  assert.match(renderConnectDrawer(r2.store.get()), /The account did not answer\. Try again\./);
});

test('This is me twice posts connectNetwork once', async () => {
  let release;
  const held = new Promise(res => { release = res; });
  const r = rig({ reads: [{ ok: true, pending: HEARD }], actAnswer: () => held });
  r.identity.openConnect();
  await r.identity.next(field());
  await r.timers.advance(PENDING_POLL_MS);
  const going = r.identity.thisIsMe();
  await settle();
  assert.equal(r.store.get().identity.connect.busy, true);
  await r.identity.thisIsMe();
  release({ status: 200, body: { ok: true } });
  await going;
  assert.equal(acts(r.posts).length, 1);
});

test('This is me in the air: Cancel and × are held, closing does nothing; a connect taken after the drawer went still reads Identity again', async () => {
  let release;
  const held = new Promise(res => { release = res; });
  const r = rig({ reads: [{ ok: true, pending: HEARD }], actAnswer: () => held });
  r.identity.openConnect();
  await r.identity.next(field());
  await r.timers.advance(PENDING_POLL_MS);
  const going = r.identity.thisIsMe();
  await settle();
  const html = renderConnectDrawer(r.store.get());
  assert.match(html, /data-action="identityClose" disabled>Cancel</, 'Cancel held');
  assert.match(html, /class="close-key" data-action="identityClose"[^>]* disabled>×</, '× held');
  // Cancel, × or Escape while it is in the air: nothing closes, nothing is dropped
  r.identity.close();
  assert.equal(r.store.get().identity.connect?.step, 3);
  assert.equal(drops(r.posts).length, 0);
  const before = r.gets.length;
  release({ status: 200, body: { ok: true } });
  await going;
  await settle();
  assert.equal(r.store.get().identity.connect, null);
  assert.ok(r.gets.slice(before).includes('/data/account/identity?fresh=1'));

  // the drawer gone some other way meanwhile (another connect opened over it): the account bound the phone, so Identity is read again
  let release2;
  const held2 = new Promise(res => { release2 = res; });
  const s = rig({ reads: [{ ok: true, pending: HEARD }], actAnswer: () => held2 });
  s.identity.openConnect();
  await s.identity.next(field());
  await s.timers.advance(PENDING_POLL_MS);
  const going2 = s.identity.thisIsMe();
  await settle();
  s.store.dispatch('identityConnectClose');
  const before2 = s.gets.length;
  release2({ status: 200, body: { ok: true } });
  await going2;
  await settle();
  assert.ok(s.gets.slice(before2).includes('/data/account/identity?fresh=1'), 'a stale connect that was taken reads Identity again');
  // and a stale one refused reads nothing
  let release3;
  const held3 = new Promise(res => { release3 = res; });
  const u = rig({ reads: [{ ok: true, pending: HEARD }], actAnswer: () => held3 });
  u.identity.openConnect();
  await u.identity.next(field());
  await u.timers.advance(PENDING_POLL_MS);
  const going3 = u.identity.thisIsMe();
  await settle();
  u.store.dispatch('identityConnectClose');
  const before3 = u.gets.length;
  release3({ status: 409, body: { ok: false, refusal: { ok: false, code: 'E_ACCOUNT_BAD_ACTION', layer: 'account', message: NO_PENDING } } });
  await going3;
  await settle();
  assert.equal(u.gets.length, before3);
});

test('postAct: the action under ACT; taken is ok with the body, refused or unanswered the words', async () => {
  const seen = [];
  assert.deepEqual(await postAct(async (path, body) => { seen.push({ path, body }); return { status: 200, body: { ok: true, kind: 'result' } }; }, { type: 'blockSender' }), { ok: true, body: { ok: true, kind: 'result' } });
  assert.deepEqual(seen, [{ path: '/data/account/act', body: { action: { type: 'blockSender' } } }]);
  assert.deepEqual(await postAct(async () => ({ status: 409, body: { ok: false, refusal: { message: 'signed acts go through the owner door' } } }), {}), { ok: false, said: 'signed acts go through the owner door' });
  const none = await postAct(async () => { throw new Error('x'); }, {});
  assert.equal(none.ok, false);
  assert.equal(spoken(none.said), 'The account did not answer. Try again.');
  assert.equal(spoken((await postAct(async () => ({ status: 500, body: {} }), {})).said), 'Refused');
});

test('disconnect, block and saveRouting post their actions unsigned and read Identity again; a refusal is said where pressed', async () => {
  const read = { ...ALL_TELEGRAM_READ, quiet: { from: '23:00', to: '07:00', zone: 'America/New_York' } };
  const r = rig({ role: 'none', read });
  assert.equal(await r.identity.disconnect('telegram'), true);
  assert.equal(await r.identity.block('telegram', '0123456789ab', '…789'), true);
  assert.equal(await r.identity.saveRouting({ chat: ['telegram'], alerts: [], brief: ['telegram'], cards: [], fills: [] }, '23:00', '07:00'), true);
  assert.deepEqual(acts(r.posts), [
    { type: 'disconnectNetwork', network: 'telegram' },
    { type: 'blockSender', network: 'telegram', sender: '0123456789ab', masked: '…789' },
    { type: 'setRouting', routing: 'chat=telegram;alerts=;brief=telegram;cards=;fills=', quietFrom: '23:00', quietTo: '07:00' },
  ]);
  assert.equal(r.gets.filter(g => g === '/data/account/identity?fresh=1').length, 3);
  // quiet hours' Save: off is both ends empty; taken, the editor closes
  r.store.dispatch('identityQuietEdit', true);
  assert.equal(await r.identity.saveRouting(read.routing, '', '', 'quiet'), true);
  assert.deepEqual(acts(r.posts).at(-1), { type: 'setRouting', routing: ALL_TELEGRAM, quietFrom: '', quietTo: '' });
  assert.equal(r.store.get().identity.quietEdit, false);
  // what cannot be sent is said and never posted: the same as now, one clock missing, both ends equal
  const n = acts(r.posts).length;
  assert.equal(await r.identity.saveRouting(read.routing, '23:00', '07:00'), false);
  assert.deepEqual(r.store.get().identity.said, { at: 'grid', words: 'That is how it is now' });
  assert.equal(await r.identity.saveRouting(read.routing, '23:00', '', 'quiet'), false);
  assert.deepEqual(r.store.get().identity.said, { at: 'quiet', words: 'Pick when quiet hours start and end, or tick Off' });
  assert.equal(await r.identity.saveRouting(read.routing, '06:00', '06:00', 'quiet'), false);
  assert.equal(r.store.get().identity.said.words, 'Quiet hours start and end at different times');
  assert.equal(await r.identity.disconnect('fax'), false);
  assert.equal(acts(r.posts).length, n);
  // the account's refusal, where it was pressed; a taken act clears it
  const r2 = rig({ read, actAnswer: { status: 409, body: { ok: false, refusal: { message: 'Telegram is not connected' } } } });
  assert.equal(await r2.identity.disconnect('telegram'), false);
  assert.deepEqual(r2.store.get().identity.said, { at: 'networks', words: 'Telegram is not connected' });
  assert.equal(await r2.identity.block('telegram', 'ab', '…b'), false);
  assert.deepEqual(r2.store.get().identity.said, { at: 'strangers', words: 'Telegram is not connected' });
});

test('closing any of sheets 1 to 3 drops the pending connection', async () => {
  // sheet 1: nothing pending, nothing dropped
  const r1 = rig();
  r1.identity.openConnect();
  r1.identity.close();
  assert.equal(r1.store.get().identity.connect, null);
  assert.equal(drops(r1.posts).length, 0);
  // sheet 2
  const r2 = rig();
  r2.identity.openConnect();
  await r2.identity.next(field());
  r2.identity.close();
  assert.equal(r2.store.get().identity.connect, null);
  assert.deepEqual(drops(r2.posts).map(p => p.body), [{ id: PENDING.id }]);
  assert.equal(r2.timers.pending.size, 0, 'no poll left');
  // sheet 3
  const r3 = rig({ reads: [{ ok: true, pending: HEARD }] });
  r3.identity.openConnect();
  await r3.identity.next(field());
  await r3.timers.advance(PENDING_POLL_MS);
  assert.equal(r3.store.get().identity.connect.step, 3);
  r3.identity.close();
  assert.deepEqual(drops(r3.posts).map(p => p.body), [{ id: PENDING.id }]);
  // closed while the token is in the air: the pending connection it makes is dropped as it lands
  let release;
  const held = new Promise(res => { release = res; });
  const r4 = rig({ tokenAnswer: held });
  r4.identity.openConnect();
  const going = r4.identity.next(field());
  await settle();
  r4.identity.close();
  release({ status: 200, body: { ok: true, pending: PENDING } });
  await going;
  await settle();
  assert.equal(r4.store.get().identity.connect, null);
  assert.deepEqual(drops(r4.posts).map(p => p.body), [{ id: PENDING.id }]);
  assert.equal(r4.timers.pending.size, 0);
});

// ── carried into Task 3: sheet 2 cannot poll forever, and a silent account is said ──

test('sheet 2: an expiresAt that cannot be read counts as expired once the ten minutes are up, and the poll stops', async () => {
  const odd = { ok: true, pending: { ...PENDING, expiresAt: 'soon' } };
  const r = rig({ reads: Array.from({ length: 600 }, () => odd) });
  r.identity.openConnect();
  await r.identity.next(field());
  await r.timers.advance(9 * 60_000);
  assert.equal(r.store.get().identity.connect.error, null, 'still waiting inside the ten minutes');
  assert.equal(r.timers.pending.size, 1);
  await r.timers.advance(60_000 + PENDING_POLL_MS);
  assert.match(spoken(r.store.get().identity.connect.error), /expired/);
  assert.equal(r.timers.pending.size, 0, 'no poll after the window');
  const gets = r.gets.length;
  await r.timers.advance(10 * PENDING_POLL_MS);
  assert.equal(r.gets.length, gets);
  assert.match(renderConnectDrawer(r.store.get()), /data-action="identityStartAgain">Start again</);
  // the same with an account that never answers at all
  const down = new Error('fetch failed');
  const r2 = rig({ reads: Array.from({ length: 600 }, () => down) });
  r2.identity.openConnect();
  await r2.identity.next({ value: TOKEN });
  r2.store.dispatch('identityConnectSet', { pending: { ...r2.store.get().identity.connect.pending, expiresAt: '' } });
  await r2.timers.advance(10 * 60_000 + PENDING_POLL_MS);
  assert.match(spoken(r2.store.get().identity.connect.error), /expired/);
  assert.equal(r2.timers.pending.size, 0);
});

test('sheet 2: an account that stops answering is said in a plain line, gone once it answers again', async () => {
  const down = Object.assign(new Error('HTTP 503'), { status: 503, body: { ok: false, error: 'The account did not answer.' } });
  const r = rig({ reads: [down, new Error('fetch failed'), { ok: true, pending: PENDING }] });
  r.identity.openConnect();
  await r.identity.next(field());
  assert.doesNotMatch(renderConnectDrawer(r.store.get()), /not answering/);
  await r.timers.advance(PENDING_POLL_MS);
  assert.equal(r.store.get().identity.connect.silent, true);
  assert.match(renderConnectDrawer(r.store.get()), /The account is not answering: this sheet keeps asking\./);
  assert.equal(r.store.get().identity.connect.error, null, 'not an error: it keeps waiting');
  assert.equal(r.timers.pending.size, 1);
  await r.timers.advance(PENDING_POLL_MS);
  assert.match(renderConnectDrawer(r.store.get()), /not answering/);
  await r.timers.advance(PENDING_POLL_MS);
  assert.equal(r.store.get().identity.connect.silent, false);
  assert.doesNotMatch(renderConnectDrawer(r.store.get()), /not answering/);
});

// ── plan B2 Task 7: Install app… for Slack, two tokens sent once ──

// made-up tokens of Slack's shapes, joined at run time so that no literal in the tree is scanner-shaped (rules: no token anywhere)
const APP = ['xa', 'pp-1-A0FAKE0001-1234567-', 'ab'.repeat(32)].join('');
const BOT = ['xo', 'xb-', '1111111-2222222-', 'FakeBotTokenForTestsOnly00'].join('');
const sha256pair = (saltHex, app, bot) => createHash('sha256').update(Buffer.from(saltHex, 'hex')).update(Buffer.from(`${app}\u0000${bot}`, 'utf8')).digest('hex');
const SLACK_PENDING = {
  id: 'fedcba9876543210fedcba9876543210', network: 'slack', bot: { id: 'T0FAKE001:U0BOT0001', username: 'gravit', name: 'Gravit', workspace: 'Fake Co' },
  workspace: 'Fake Co', link: 'https://slack.com/app_redirect?app=A0FAKE0001&team=T0FAKE001', qr: 'data:image/svg+xml;base64,PHN2Zy8+',
  expiresAt: '2026-11-04T15:10:00.000Z', state: 'waiting',
};
const SLACK_HEARD = { ...SLACK_PENDING, state: 'heard', sender: { id: 'T0FAKE001:U0OPER7QK', name: 'Pan', handle: '@pan', userId: 'U0OPER7QK', masked: '…7QK', text: 'hi' } };
const ALL_TELEGRAM_READ = { ...EMPTY_READ, networks: [{ network: 'telegram', state: 'connected', speaksAs: '@gravit_desk_bot', talksOnlyWith: '@pan' }], routing: { chat: ['telegram'], alerts: ['telegram'], brief: ['telegram'], cards: ['telegram'], fills: ['telegram'] } };
const slackRig = (over = {}) => rig({ tokenAnswer: { status: 200, body: { ok: true, pending: SLACK_PENDING } }, ...over });

test('Install app… opens the drawer for Slack; Connect… for Telegram', () => {
  const r = slackRig();
  r.identity.openConnect('slack');
  assert.equal(r.store.get().identity.connect.network, 'slack');
  assert.equal(r.store.get().identity.connect.step, 1);
  r.identity.openConnect();
  assert.equal(r.store.get().identity.connect.network, 'telegram');
  r.identity.openConnect('fax');
  assert.equal(r.store.get().identity.connect.network, 'telegram', 'a network the tab does not know is Telegram');
});

test('Next hashes the pair in the browser, posts it once, clears both fields, and keeps no token in the store', async () => {
  const r = slackRig();
  r.identity.openConnect('slack');
  const app = field(APP), bot = field(BOT);
  await r.identity.next(app, bot);
  const sent = r.posts.filter(p => JSON.stringify(p.body).includes(BOT));
  assert.equal(sent.length, 1, 'one request carries the tokens');
  assert.equal(sent[0].path, '/data/account/identity/slack/token');
  assert.deepEqual(Object.keys(sent[0].body).sort(), ['appToken', 'botToken', 'keyHash', 'salt']);
  assert.equal(sent[0].body.appToken, APP);
  assert.equal(sent[0].body.botToken, BOT);
  assert.match(sent[0].body.salt, /^[0-9a-f]{32}$/);
  assert.equal(sent[0].body.keyHash, sha256pair(sent[0].body.salt, APP, BOT));
  assert.equal(app.value, '');
  assert.equal(bot.value, '');
  assert.equal(r.posts.filter(p => p.path === TOKEN_PATH).length, 0, 'never Telegram\'s route');
  const c = r.store.get().identity.connect;
  assert.equal(c.step, 2);
  assert.deepEqual(c.fp, { salt: sent[0].body.salt, keyHash: sent[0].body.keyHash });
  const all = JSON.stringify(r.store.get());
  assert.ok(!all.includes(APP) && !all.includes(BOT), 'no token in the store');
  assert.ok(!renderConnectDrawer(r.store.get()).includes(BOT));
  // a refusal whose words carried either token is never drawn with it
  for (const leak of [APP, BOT]) {
    const r2 = slackRig({ tokenAnswer: { status: 400, body: { ok: false, error: `bad ${leak}` } } });
    r2.identity.openConnect('slack');
    await r2.identity.next(field(APP), field(BOT));
    assert.ok(!JSON.stringify(r2.store.get()).includes(leak));
    assert.equal(spoken(r2.store.get().identity.connect.error), 'The account refused the tokens.');
  }
});

test('Next with one field empty posts nothing and says which is missing', async () => {
  const cases = [['', BOT, 'Paste the app-level token (xapp-…) first.'], [APP, ' ', 'Paste the bot token (xoxb-…) first.'], ['', '', 'Paste both tokens first.']];
  for (const [a, b, words] of cases) {
    const r = slackRig();
    r.identity.openConnect('slack');
    const app = field(a), bot = field(b);
    await r.identity.next(app, bot);
    assert.equal(r.posts.length, 0, words);
    assert.equal(spoken(r.store.get().identity.connect.error), words);
    assert.equal(r.store.get().identity.connect.step, 1);
    assert.equal(app.value, '');
    assert.equal(bot.value, '');
  }
  // no second field at all: the bot token is missing
  const r = slackRig();
  r.identity.openConnect('slack');
  await r.identity.next(field(APP));
  assert.equal(r.posts.length, 0);
  assert.equal(spoken(r.store.get().identity.connect.error), 'Paste the bot token (xoxb-…) first.');
});

test('sheet 2: Say hi with the app_redirect link, its QR, the workspace and the expiry; sheet 3 and Not me as Telegram\'s', async () => {
  const r = slackRig({ reads: [{ ok: true, pending: SLACK_PENDING }, { ok: true, pending: SLACK_HEARD }] });
  r.identity.openConnect('slack');
  await r.identity.next(field(APP), field(BOT));
  await r.timers.advance(PENDING_POLL_MS);
  assert.ok(r.gets[0].startsWith(`/data/account/identity/pending?id=${SLACK_PENDING.id}`));
  const two = renderConnectDrawer(r.store.get());
  assert.match(two, /<h2>Connect Slack · 2 of 3 · Say hi<\/h2>/);
  assert.match(two, /<a href="https:\/\/slack\.com\/app_redirect\?app=A0FAKE0001&amp;team=T0FAKE001" target="_blank" rel="noopener noreferrer">Open Gravit in Fake Co<\/a>/);
  assert.match(two, /<img class="identity-qr" src="data:image\/svg\+xml;base64,PHN2Zy8\+" alt="QR code for Gravit&#39;s app in Fake Co"/);
  assert.match(two, /Workspace: Fake Co/);
  assert.match(two, /This connection waits until 10:10 ET; after that, start again\./);
  // a link that is not Slack's app_redirect is no link and no QR
  const odd = s => ({ ...r.store.get(), identity: { ...r.store.get().identity, connect: { ...r.store.get().identity.connect, pending: { ...SLACK_PENDING, ...s } } } });
  for (const link of ['https://evil.test/app_redirect?app=A0FAKE0001&team=T0FAKE001', 'https://slack.com/app_redirect?app=A0FAKE0001&team=T0FAKE001&x=1', 'https://t.me/gravit_desk_bot']) {
    assert.doesNotMatch(renderConnectDrawer(odd({ link })), /<a |<img/, link);
  }
  // the conflict in Slack's words
  assert.match(renderConnectDrawer(odd({ state: 'conflict' })), /Another program holds this app&#39;s connection to Slack: stop it, and this sheet goes on\./);
  await r.timers.advance(PENDING_POLL_MS);
  const three = renderConnectDrawer(r.store.get());
  assert.match(three, /<h2>Connect Slack · 3 of 3 · Is this you\?<\/h2>/);
  for (const line of ['Name: Pan', 'Handle: @pan', 'Slack id: U0OPER7QK', 'Message: hi']) assert.ok(three.includes(line), line);
  assert.ok(!three.includes('Telegram'), 'no Telegram words on Slack\'s sheet');
  r.answers.notMe.push({ status: 200, body: { ok: true, pending: SLACK_PENDING } });
  await r.identity.notMe();
  assert.deepEqual(r.posts.at(-1), { path: '/data/account/identity/pending/not-me', body: { id: SLACK_PENDING.id } });
  assert.equal(r.store.get().identity.connect.step, 2);
  assert.equal(r.store.get().identity.connect.network, 'slack');
});

test('This is me connects Slack, with Slack ticked in all five rows on top of the routing now', async () => {
  const r = slackRig({ read: ALL_TELEGRAM_READ, reads: [{ ok: true, pending: SLACK_HEARD }] });
  r.identity.openConnect('slack');
  await r.identity.next(field(APP), field(BOT));
  await r.timers.advance(PENDING_POLL_MS);
  const { fp } = r.store.get().identity.connect;
  await r.identity.thisIsMe();
  assert.deepEqual(acts(r.posts), [{
    type: 'connectNetwork', network: 'slack', pending: SLACK_PENDING.id, botId: 'T0FAKE001:U0BOT0001', speaksAs: '@gravit', operatorId: 'T0FAKE001:U0OPER7QK', talksOnlyWith: '@pan',
    routing: 'chat=slack,telegram;alerts=slack,telegram;brief=slack,telegram;cards=slack,telegram;fills=slack,telegram', keyHash: fp.keyHash, salt: fp.salt,
  }]);
  assert.equal(r.store.get().identity.connect, null);
  assert.ok(!JSON.stringify(acts(r.posts)).includes(BOT));
});

test('the manifest\'s Copy writes it to the clipboard, and selects the text when the clipboard is refused', async () => {
  const written = [];
  let selected = 0;
  assert.equal(await copyManifest('{"a":1}', { writeText: async t => { written.push(t); } }, () => { selected += 1; }), true);
  assert.deepEqual(written, ['{"a":1}']);
  assert.equal(selected, 0);
  assert.equal(await copyManifest('{"a":1}', { writeText: async () => { throw new Error('denied'); } }, () => { selected += 1; }), false);
  assert.equal(selected, 1);
  assert.equal(await copyManifest('{"a":1}', undefined, () => { selected += 1; }), false);
  assert.equal(selected, 2);
  assert.equal(await copyManifest('', { writeText: async t => { written.push(t); } }, () => {}), false, 'no manifest, nothing copied');
  assert.equal(written.length, 1);
});

// ── the iMessage plan: Connect iMessage through Photon ──

// a made-up project secret, of no real secret's shape
const SECRET = 'fake-photon-secret-for-tests-only-0123456789';
const PROJECT = 'prj_1';
const IM_PENDING = {
  id: 'aaaabbbbccccddddaaaabbbbccccdddd', network: 'imessage', bot: { id: `${PROJECT}:+14155550123`, username: '+14155550123', name: 'iMessage' },
  link: 'sms:+14155550123', qr: 'data:image/svg+xml;base64,PHN2Zy8+', expiresAt: '2026-11-04T15:10:00.000Z', state: 'waiting',
};
const IM_HEARD = { ...IM_PENDING, state: 'heard', sender: { id: '+14155550100', name: '+14155550100', handle: '+14155550100', masked: '…100', text: 'hi' } };
const imRig = (over = {}) => rig({ tokenAnswer: { status: 200, body: { ok: true, pending: IM_PENDING } }, ...over });
const imFields = (phone = '+1 (415) 555-0100') => [field(PROJECT), field(SECRET), field(phone)];

test("iMessage's Next posts the five fields once to TOKEN_PATHS.imessage and clears the secret", async () => {
  const r = imRig();
  r.identity.openConnect('imessage');
  assert.equal(r.store.get().identity.connect.network, 'imessage');
  const [project, secretField, phone] = imFields();
  await r.identity.next(project, secretField, phone);
  const posted = r.posts.filter(p => p.path.endsWith('/token'));
  assert.equal(posted.length, 1);
  assert.equal(posted[0].path, '/data/account/identity/imessage/token');
  assert.deepEqual(Object.keys(posted[0].body).sort(), ['keyHash', 'phone', 'projectId', 'projectSecret', 'salt']);
  assert.equal(posted[0].body.projectId, PROJECT);
  assert.equal(posted[0].body.projectSecret, SECRET);
  assert.equal(posted[0].body.phone, '+14155550100', 'spaces, dashes and parentheses removed');
  assert.equal(secretField.value, '');
  assert.equal(project.value, PROJECT, 'the project ID is no secret: its field keeps it');
  const c = r.store.get().identity.connect;
  assert.equal(c.step, 2);
  assert.deepEqual(c.fp, { salt: posted[0].body.salt, keyHash: posted[0].body.keyHash });
  assert.ok(!JSON.stringify(r.store.get()).includes(SECRET), 'no secret in the store');
  assert.ok(!renderConnectDrawer(r.store.get()).includes(SECRET), 'none drawn');
  // a second Next does nothing: the drawer is past sheet 1
  await r.identity.next(...imFields());
  assert.equal(r.posts.filter(p => p.path.endsWith('/token')).length, 1);
  // a refusal whose words carried the secret is never drawn with it
  const r2 = imRig({ tokenAnswer: { status: 400, body: { ok: false, error: `bad ${SECRET}` } } });
  r2.identity.openConnect('imessage');
  await r2.identity.next(...imFields());
  assert.ok(!JSON.stringify(r2.store.get()).includes(SECRET));
  assert.equal(spoken(r2.store.get().identity.connect.error), 'The account refused the project.');
  assert.equal(r2.store.get().identity.connect.step, 1);
});

test('the iMessage fingerprint is over projectId, NUL, secret', async () => {
  const r = imRig();
  r.identity.openConnect('imessage');
  await r.identity.next(...imFields());
  const body = r.posts.find(p => p.path === TOKEN_PATHS.imessage).body;
  const fixed = n => new Uint8Array(n).fill(0xab);
  const want = await fingerprintOf(webcrypto.subtle, `${PROJECT}\u0000${SECRET}`, fixed);
  assert.equal(body.keyHash, sha256hex(body.salt, `${PROJECT}\u0000${SECRET}`));
  assert.equal(want.keyHash, sha256hex('ab'.repeat(16), `${PROJECT}\u0000${SECRET}`));
  assert.notEqual(body.keyHash, sha256hex(body.salt, `${PROJECT}${SECRET}`), 'the NUL is in the join');
});

test('a number without its country code is refused before anything is sent', async () => {
  for (const [project, secret, phone] of [[PROJECT, SECRET, '415 555 0100'], [PROJECT, SECRET, '+0 415 555 0100'], [PROJECT, SECRET, '+1415'], [PROJECT, SECRET, ''], ['', SECRET, '+14155550100'], [PROJECT, '', '+14155550100']]) {
    const r = imRig();
    r.identity.openConnect('imessage');
    const secretField = field(secret);
    await r.identity.next(field(project), secretField, field(phone));
    assert.equal(r.posts.length, 0, `${project}|${phone}`);
    assert.equal(spoken(r.store.get().identity.connect.error), 'Fill in all three: the project ID, the project secret, and your number written +, the country code, then the number (+14155550100).');
    assert.equal(r.store.get().identity.connect.step, 1);
    assert.equal(secretField.value, '', 'the secret is cleared even so');
  }
});

test('sheet 2 shows the number, the sms: link and the other-sender hint; sheet 3 the number heard and the text', async () => {
  const strangerHeard = { masked: '…com', at: '2026-11-04T15:01:00.000Z' };
  const r = imRig({ reads: [{ ok: true, pending: { ...IM_PENDING, strangerHeard } }, { ok: true, pending: IM_HEARD }] });
  r.identity.openConnect('imessage');
  await r.identity.next(...imFields());
  await r.timers.advance(PENDING_POLL_MS);
  const html = renderConnectDrawer(r.store.get());
  assert.match(html, /<h2>Connect iMessage · 2 of 3 · Say hi<\/h2>/);
  assert.match(html, /<a href="sms:\+14155550123" target="_blank" rel="noopener noreferrer">Text hi to \+14155550123<\/a>/);
  assert.match(html, /sms:\+14155550123/);
  assert.match(html, /<img class="identity-qr" src="data:image\/svg\+xml;base64,PHN2Zy8\+" alt="QR code for a message to \+14155550123"/);
  assert.match(html, /…com/);
  assert.match(html, /Settings › Messages › Send &amp; Receive/);
  assert.doesNotMatch(renderConnectDrawer({ ...r.store.get(), identity: { ...r.store.get().identity, connect: { ...r.store.get().identity.connect, pending: IM_PENDING } } }), /another address/, 'no stranger heard, no hint');
  // a link that is not an sms: to an E.164 number is no link and no QR
  for (const link of ['sms:4155550123', 'sms:+14155550123?body=x', 'https://t.me/gravit_desk_bot']) {
    const odd = { ...r.store.get(), identity: { ...r.store.get().identity, connect: { ...r.store.get().identity.connect, pending: { ...IM_PENDING, link } } } };
    assert.doesNotMatch(renderConnectDrawer(odd), /<a |<img/, link);
  }
  await r.timers.advance(PENDING_POLL_MS);
  const three = renderConnectDrawer(r.store.get());
  assert.match(three, /<h2>Connect iMessage · 3 of 3 · Is this you\?<\/h2>/);
  for (const line of ['Number: +14155550100', 'Message: hi']) assert.ok(three.includes(line), line);
  assert.doesNotMatch(three, /Telegram|Slack|Name:/);
});

test('thisIsMe sends speaksAs and talksOnlyWith without @ for iMessage', async () => {
  const r = imRig({ read: ALL_TELEGRAM_READ, reads: [{ ok: true, pending: IM_HEARD }] });
  r.identity.openConnect('imessage');
  await r.identity.next(...imFields());
  await r.timers.advance(PENDING_POLL_MS);
  const { fp } = r.store.get().identity.connect;
  await r.identity.thisIsMe();
  assert.deepEqual(acts(r.posts), [{
    type: 'connectNetwork', network: 'imessage', pending: IM_PENDING.id, botId: `${PROJECT}:+14155550123`, speaksAs: '+14155550123', operatorId: '+14155550100', talksOnlyWith: '+14155550100',
    routing: 'chat=imessage,telegram;alerts=imessage,telegram;brief=imessage,telegram;cards=imessage,telegram;fills=imessage,telegram', keyHash: fp.keyHash, salt: fp.salt,
  }]);
  assert.ok(!JSON.stringify(acts(r.posts)).includes(SECRET));
});
