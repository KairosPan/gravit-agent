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
import { startSheet } from '../../client/js/host/sheet.js';
import { startIdentity, fingerprintOf, PENDING_POLL_MS, TOKEN_PATH } from '../../client/js/host/identity.js';
import { renderConnectDrawer } from '../../client/js/render/identity.js';
import { renderSheet } from '../../client/js/render/owner.js';

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
function rig({ tokenAnswer = { status: 200, body: { ok: true, pending: PENDING } }, reads = [] } = {}) {
  const clock = { t: START };
  const timers = fakeTimers(clock);
  const store = createStore({ initial: emptyState(START), reducers });
  store.dispatch('ownerStanding', { role: 'signs', kid: 'a5048199a8081854' });
  store.dispatch('identityLoaded', { ok: true, networks: [], routing: { chat: [], alerts: [], brief: [], cards: [], fills: [] }, quiet: null, strangers: [] });
  const posts = [];
  const gets = [];
  const opened = [];
  const answers = { notMe: [] };
  const post = async (path, body) => {
    posts.push({ path, body });
    if (path === TOKEN_PATH) return tokenAnswer;
    if (path.endsWith('/not-me')) return answers.notMe.shift() ?? { status: 200, body: { ok: true, pending: PENDING } };
    return { status: 200, body: { ok: true } };
  };
  const getJson = async path => {
    gets.push(path);
    const r = reads.length ? reads.shift() : { ok: true, pending: PENDING };
    if (r instanceof Error) throw r;
    return r;
  };
  const identity = startIdentity({
    store, getJson, post, subtle: webcrypto.subtle, schedule: timers.schedule, cancelTimer: timers.cancelTimer, now: () => clock.t,
    openSheet: (kind, seed) => { opened.push({ kind, seed }); },
  });
  return { clock, timers, store, posts, gets, opened, answers, identity };
}
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
  assert.equal(r3.store.get().identity.connect.error, 'Paste the token from BotFather first.');
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
  assert.match(html, /Connect Telegram · 2 of 4 · Say hi/);
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
  assert.match(r2.store.get().identity.connect.error, /expired/);
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
  assert.match(html, /Connect Telegram · 3 of 4 · Is this you\?/);
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

test('This is me opens sheet 4, the owner sheet, seeded from the pending and the routing', async () => {
  const r = rig({ reads: [{ ok: true, pending: HEARD }] });
  r.identity.openConnect();
  await r.identity.next(field());
  await r.timers.advance(PENDING_POLL_MS);
  const { fp } = r.store.get().identity.connect;
  r.identity.thisIsMe();
  assert.equal(r.opened.length, 1);
  assert.deepEqual(r.opened[0], {
    kind: 'connectNetwork',
    seed: { pending: PENDING.id, botId: '777', speaksAs: '@gravit_desk_bot', operatorId: '555000123', talksOnlyWith: '@pan', routing: ALL_TELEGRAM, keyHash: fp.keyHash, salt: fp.salt },
  });
  // the drawer closed without dropping: the sheet and the drawer never show at once
  assert.equal(r.store.get().identity.connect, null);
  assert.equal(drops(r.posts).length, 0);
  assert.ok(!JSON.stringify(r.opened).includes(TOKEN));
  // a sender with no handle is talked with by their masked id
  const r2 = rig({ reads: [{ ok: true, pending: { ...HEARD, sender: { ...HEARD.sender, handle: '' } } }] });
  r2.identity.openConnect();
  await r2.identity.next(field());
  await r2.timers.advance(PENDING_POLL_MS);
  r2.identity.thisIsMe();
  assert.equal(r2.opened[0].seed.talksOnlyWith, '…123');
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
  // sheet 4: the owner sheet's Cancel drops it too, a done sheet does not
  const r5 = rig();
  r5.store.dispatch('sheetOpen', { kind: 'connectNetwork', seed: { pending: PENDING.id }, fields: [] });
  r5.store.dispatch('sheetClose');
  assert.deepEqual(drops(r5.posts).map(p => p.body), [{ id: PENDING.id }]);
  r5.store.dispatch('sheetOpen', { kind: 'connectNetwork', seed: { pending: 'feedfacefeedfacefeedfacefeedface' }, fields: [] });
  r5.store.dispatch('sheetDone', { said: 'Telegram connected' });
  r5.store.dispatch('sheetClose');
  assert.equal(drops(r5.posts).length, 1);
});

test("an expired pending at Sign shows the account's words and Start again", async () => {
  const r = rig({ reads: [{ ok: true, pending: HEARD }] });
  // the owner sheet engine over a door whose sign answers the account's refusal: the pending connection is gone
  const prepared = draft => ({ status: 200, body: { ok: true, action: { ...draft, nonce: START }, shown: Object.entries(draft).map(([name, value]) => ({ name, value: String(value) })), quote: null } });
  const owner = { prepare: async draft => prepared(draft), submit: async () => ({ status: 409, body: { ok: false, refusal: { ok: false, code: 'E_ACCOUNT_BAD_ACTION', layer: 'account', message: NO_PENDING } } }) };
  const after = [];
  const sheet = startSheet({ store: r.store, owner, schedule: r.timers.schedule, cancelTimer: r.timers.cancelTimer, now: () => r.clock.t, afterAction: k => after.push(k) });
  const identity = startIdentity({
    store: r.store, getJson: async () => ({ ok: true, pending: HEARD }), post: async (path, body) => { r.posts.push({ path, body }); return { status: 200, body: { ok: true, pending: PENDING } }; },
    subtle: webcrypto.subtle, schedule: r.timers.schedule, cancelTimer: r.timers.cancelTimer, now: () => r.clock.t, openSheet: (k, seed) => sheet.open(k, seed),
  });
  identity.openConnect();
  await identity.next(field());
  await r.timers.advance(PENDING_POLL_MS);
  await identity.thisIsMe();
  await settle();
  assert.equal(r.store.get().sheet.kind, 'connectNetwork');
  assert.equal(r.store.get().sheet.status, 'ready');
  await sheet.submit();
  const s = r.store.get();
  assert.equal(s.sheet.status, 'refused');
  const html = renderSheet(s, r.clock.t);
  assert.ok(html.includes(NO_PENDING), 'the account\'s words');
  assert.match(html, /data-action="identityStartAgain">Start again</);
  assert.deepEqual(after, [], 'nothing taken');
  // Start again: the sheet closed (its pending dropped), sheet 1 again
  sheet.close();
  identity.startAgain();
  assert.equal(r.store.get().sheet, null);
  assert.equal(r.store.get().identity.connect.step, 1);
  assert.ok(drops(r.posts).some(p => p.body.id === PENDING.id));
});
