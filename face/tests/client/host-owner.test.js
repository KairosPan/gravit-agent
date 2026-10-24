// The owner device (spec 2026-10-22 §6.3, plan 2 task 3): host/owner.js over Node's own WebCrypto, against a fake door that
// answers as the Account does (the owner-path map §1.2–§1.5, §2.4–§2.7) — pair with the first-device rule and the printed
// code, prepare's generic branch, and an exchange that verifies every envelope with node:crypto exactly as the Account's
// es256Verify does: ieee-p1363 over the bytes the door rebuilds from its own `shown`, against the paired JWK.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startOwner, postVia } from '../../client/js/host/owner.js';
import { memoryKeys } from '../../client/js/wire/key-store.js';

const subtle = globalThis.crypto.subtle;
const CODE = 'K7QX-M2PA';
const NONCE = 1761100000000;
const NO_ANSWER = { status: 0, body: { ok: false, error: 'The account did not answer. Try again.' } };
const NOT_SIGNING = { status: 0, body: { ok: false, error: 'This browser does not sign for the account.' } };
const WATCH = { type: 'setWatch', venue: 'ex', symbol: 'BTC/USDT', on: 'true' };
const tick = () => new Promise(r => setTimeout(r, 0));

// the stand-in's page, its signers as each test names them
const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
const pageWith = (owners, pendingDevices = []) => ({ ...fx('account'), signers: { owners, threshold: 1, pendingDevices } });
const ownerRow = kid => ({ id: `device:${kid}`, kind: 'device', label: 'Gravit face' });

// ---- the fake door: the Account's own rules, written here independently of the client's modules ----
const DOMAIN = { name: 'AgentAccountSignTransaction', version: '1', chainId: 424242 };
const LIVE_TYPES = new Set(['liveMove', 'liveOrder', 'liveCancel', 'liveAmend', 'liveClose', 'liveLeverage', 'liveEarn']);
const OWNER_FIELDS = {
  setWatch: ['AccountTransaction:SetWatch', ['venue', 'symbol', 'on']],
  signOut: ['AccountDevice:SignOut', ['device']],
};
const sortKeys = v => (Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, sortKeys(v[k])]))
  : v);
const kidOfJwk = jwk => createHash('sha256')
  .update(Buffer.concat([Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')])).digest('hex').slice(0, 16);
const plain = code => String(code ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const refusal = (status, code, message, extra = {}) => ({ status, body: { ok: false, refusal: { ok: false, code, layer: 'account', message, ...extra } } });

// the door's prepared form of an action: the type's fields then the nonce, every value a string
function preparedOf(action) {
  const [primaryType, fields] = OWNER_FIELDS[action.type];
  const shown = [...fields.map(name => ({ name, value: String(action[name] ?? '') })), { name: 'nonce', value: String(action.nonce) }];
  return { ok: true, action, primaryType, domain: DOMAIN, accountChain: LIVE_TYPES.has(action.type) ? 'Live · real money' : 'Simulation', shown };
}
const inputOf = prepared => {
  const message = { accountChain: prepared.accountChain };
  for (const f of prepared.shown) message[f.name] = f.value;
  return JSON.stringify(sortKeys({ domain: prepared.domain, primaryType: prepared.primaryType, message }));
};

/** owners and pending devices by kid → their JWK; `seedOwner` stands for a device already signing (the stand-in's seed key) */
function door({ seedOwner = false } = {}) {
  const d = {
    log: [], owners: new Map(), pending: new Map(), watch: [], canned: {},
    /** answer the next call to `path` with `answer` instead of the rules */
    once(path, answer) { (d.canned[path] ??= []).push(answer); },
    calls: path => d.log.filter(e => e.path === path),
  };
  if (seedOwner) d.owners.set('a5048199a8081854', null);
  function pair({ jwk, code }) {
    const kid = kidOfJwk(jwk);
    if (d.owners.has(kid)) return { status: 200, body: { ok: true, kid, role: 'owner' } };
    if (d.owners.size === 0) {
      if (!code) return { status: 200, body: { ok: true, kid, role: 'needs-code' } };
      if (plain(code) !== plain(CODE)) return refusal(400, 'E_ACCOUNT_OWNER_SURFACE', 'that is not the pairing code this server printed in its terminal (4 tries left)');
      d.owners.set(kid, jwk);
      return { status: 200, body: { ok: true, kid, role: 'owner' } };
    }
    d.pending.set(kid, jwk);
    return { status: 200, body: { ok: true, kid, role: 'pending' } };
  }
  function prepare({ draft }) {
    if (!draft || !OWNER_FIELDS[draft.type]) return refusal(409, 'E_ACCOUNT_BAD_ACTION', 'not an instruction this account knows');
    return { status: 200, body: preparedOf({ ...draft, nonce: NONCE }) };
  }
  function exchange({ action, nonce, signature }) {
    if (!action || !OWNER_FIELDS[action.type]) return refusal(409, 'E_ACCOUNT_BAD_ACTION', 'not an instruction this account knows');
    if (nonce !== action.nonce) return refusal(409, 'E_ACCOUNT_BAD_ACTION', "the envelope's nonce is the action's nonce");
    const jwk = d.owners.get(signature?.kid);
    const verified = Boolean(jwk) && verify('sha256', Buffer.from(inputOf(preparedOf(action))),
      { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(String(signature.es256), 'base64url'));
    if (!verified) return refusal(401, 'E_ACCOUNT_BAD_SIGNATURE', 'the signature does not match the instruction', { detail: { type: action.type } });
    if (action.type === 'signOut') {
      if (action.device !== `device:${signature.kid}`) return refusal(409, 'E_ACCOUNT_BAD_ACTION', 'a browser signs only itself out: this sign-out names another device');
      d.owners.delete(signature.kid);
      return { status: 200, body: { ok: true, kind: 'account', summary: `signed out: device ${signature.kid.slice(0, 8)} no longer signs for the account` } };
    }
    d.watch.push({ venue: action.venue, symbol: action.symbol });
    return { status: 200, body: { ok: true, kind: 'account', summary: `watching ${action.symbol} at ${action.venue}` } };
  }
  const rules = { '/data/account/pair': pair, '/data/account/prepare': prepare, '/data/account/exchange': exchange };
  // the body as the wire carries it: JSON text, parsed by the door
  d.post = async (path, body) => {
    const sent = JSON.parse(JSON.stringify(body));
    d.log.push({ path, body: sent });
    const canned = d.canned[path]?.shift();
    if (canned) return canned;
    return rules[path] ? rules[path](sent) : { status: 404, body: { ok: false, error: 'not found' } };
  };
  return d;
}

const memoryFlag = (on = false) => { let v = on; return { get: () => v, set: x => { v = x === true; } }; };

function rig({ d = door(), crypto = subtle, keys = memoryKeys(), flag = memoryFlag(), post } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const types = [];
  store.subscribe((_, type) => types.push(type));
  const owner = startOwner({ store, post: post ?? d.post, subtle: crypto, keys, flag, now: () => NONCE });
  return { store, owner, door: d, keys, flag, types, o: () => store.get().owner };
}

// a rig whose page already signs: paired with the printed code
async function signing(opts) {
  const r = rig(opts);
  await r.owner.ready(CODE);
  assert.equal(r.o().role, 'signs');
  return r;
}

test('a fresh page pairs with the code and signs', async () => {
  const r = rig();
  assert.deepEqual(r.o(), { role: 'unknown', kid: '', refusal: null, busy: false });
  await r.owner.ready();
  const [first] = r.door.calls('/data/account/pair');
  assert.deepEqual(Object.keys(first.body).sort(), ['jwk', 'label'], 'no code key without a code');
  assert.deepEqual(Object.keys(first.body.jwk).sort(), ['crv', 'kty', 'x', 'y'], 'only the public half');
  assert.equal(first.body.jwk.kty, 'EC');
  assert.equal(first.body.jwk.crv, 'P-256');
  assert.equal(first.body.label, 'Gravit face');
  const kid = kidOfJwk(first.body.jwk);
  assert.deepEqual(r.o(), { role: 'needs-code', kid, refusal: null, busy: false });

  // a wrong code is the Account's sentence, the role as it was
  await r.owner.ready('ZZZZ-ZZZZ');
  assert.equal(r.o().role, 'needs-code');
  assert.equal(r.o().refusal, 'that is not the pairing code this server printed in its terminal (4 tries left)');

  await r.owner.ready(CODE);
  const pairs = r.door.calls('/data/account/pair');
  assert.equal(pairs.length, 3);
  assert.equal(pairs[2].body.code, CODE);
  assert.deepEqual(pairs[2].body.jwk, first.body.jwk, 'the same key, kept');
  assert.deepEqual(r.o(), { role: 'signs', kid, refusal: null, busy: false }, 'a pair that lands clears the refusal');
  assert.ok(r.types.includes('ownerBusy'), 'busy while pairing');
  assert.ok((await r.keys.get())?.privateKey, 'the key is kept');

  // the Account's pair is idempotent for a device that signs
  await r.owner.ready();
  assert.deepEqual(r.o(), { role: 'signs', kid, refusal: null, busy: false });
});

test("the standing follows the page's signers", async () => {
  const r = rig({ d: door({ seedOwner: true }) });
  const seed = ownerRow('a5048199a8081854');
  // no kid yet and the role unknown: the first page pairs, once, however many pages land meanwhile
  const landing = r.owner.standing(pageWith([seed]));
  r.owner.standing(pageWith([seed]));
  await landing;
  await tick();
  assert.equal(r.door.calls('/data/account/pair').length, 1);
  const { kid } = r.o();
  assert.deepEqual([r.o().role, kid.length], ['pending', 16], 'an owner exists: this page waits');

  await r.owner.standing(pageWith([seed], [{ kid, at: '2026-10-23T12:00:00.000Z' }]));
  assert.equal(r.o().role, 'pending');
  // an owner let it in: the page lists it, and it signs without asking the door
  await r.owner.standing(pageWith([seed, ownerRow(kid)]));
  assert.deepEqual([r.o().role, r.o().kid], ['signs', kid]);
  assert.equal(r.door.calls('/data/account/pair').length, 1);

  // neither an owner nor pending after it signed (the service restarted): it pairs again
  await r.owner.standing(pageWith([seed]));
  assert.equal(r.door.calls('/data/account/pair').length, 2);
  assert.equal(r.o().role, 'pending', "the door's answer, as it stands now");

  // a page the face does not recognise changes nothing
  await r.owner.standing({ ok: true, venues: [] });
  await r.owner.standing(null);
  assert.equal(r.door.calls('/data/account/pair').length, 2);
});

test('an envelope the door verifies', async () => {
  const r = await signing();
  const answer = await r.owner.act(WATCH);
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body, { ok: true, kind: 'account', summary: 'watching BTC/USDT at ex' });
  assert.deepEqual(r.door.watch, [{ venue: 'ex', symbol: 'BTC/USDT' }]);

  const [prepared] = r.door.calls('/data/account/prepare');
  assert.deepEqual(prepared.body, { draft: WATCH });
  const [sent] = r.door.calls('/data/account/exchange');
  assert.deepEqual(Object.keys(sent.body).sort(), ['action', 'nonce', 'signature'], 'exactly the three');
  assert.deepEqual(sent.body.action, { ...WATCH, nonce: NONCE }, "prepare's action as it came");
  assert.equal(sent.body.nonce, sent.body.action.nonce);
  assert.deepEqual(Object.keys(sent.body.signature).sort(), ['es256', 'kid']);
  assert.equal(sent.body.signature.kid, r.o().kid);
  assert.equal(Buffer.from(sent.body.signature.es256, 'base64url').length, 64);
  assert.doesNotMatch(sent.body.signature.es256, /[+/=]/);

  // a field changed after the signature is the door's bad signature
  const pair = await r.keys.get();
  assert.ok(pair, 'the key is still kept');
  const tampered = await r.door.post('/data/account/exchange', { ...sent.body, action: { ...sent.body.action, symbol: 'ETH/USDT' } });
  assert.equal(tampered.status, 401);
  assert.equal(tampered.body.refusal.code, 'E_ACCOUNT_BAD_SIGNATURE');
});

test('a bad-signature answer re-reads the standing', async () => {
  const r = await signing();
  r.door.once('/data/account/exchange', refusal(401, 'E_ACCOUNT_BAD_SIGNATURE', 'the signature does not match the instruction'));
  const answer = await r.owner.act(WATCH);
  assert.equal(answer.status, 401, 'the answer handed back as it came');
  assert.equal(answer.body.refusal.code, 'E_ACCOUNT_BAD_SIGNATURE');
  assert.equal(r.door.calls('/data/account/pair').length, 2, 'the standing is read again');
  assert.equal(r.o().refusal, 'the signature does not match the instruction', 'and the line says so');
  assert.equal(r.o().role, 'signs', 'the door still knows this key');

  // a page that does not sign meets the same answer without asking the door again
  const p = rig({ d: door({ seedOwner: true }) });
  await p.owner.ready();
  assert.equal(p.o().role, 'pending');
  const refused = await p.owner.act(WATCH);
  assert.deepEqual(refused, NOT_SIGNING, 'a pending page signs nothing');
  assert.equal(p.door.calls('/data/account/exchange').length, 0);
});

test('a refusal at prepare is handed back unsigned', async () => {
  const r = await signing();
  const no = refusal(409, 'E_WALLET_LIVE_WRITES_OFF', 'this server is read-only: trading is off', { detail: { turnOn: 'npm run account' } });
  r.door.once('/data/account/prepare', no);
  assert.deepEqual(await r.owner.act(WATCH), no);
  // a 200 that is a refusal, or that carries nothing to show, is not signed either
  const off = { status: 200, body: { ok: false, error: 'not now' } };
  r.door.once('/data/account/prepare', off);
  assert.deepEqual(await r.owner.act(WATCH), off);
  const bare = { status: 200, body: { ok: true, action: { ...WATCH, nonce: NONCE } } };
  r.door.once('/data/account/prepare', bare);
  assert.deepEqual(await r.owner.act(WATCH), bare);
  assert.equal(r.door.calls('/data/account/exchange').length, 0, 'exchange never called');
  assert.equal(r.o().refusal, null, "a prepare's refusal is the caller's to draw");
});

test('sign-out deletes the key and sets the flag; sign-in makes a new key', async () => {
  const r = await signing();
  const before = r.o().kid;
  const oldKey = await r.keys.get();

  // a refusal at the door leaves the key and the role as they were
  r.door.once('/data/account/exchange', refusal(409, 'E_ACCOUNT_EXPIRED', 'signed 11 min ago: a sign-out is good for 10 minutes'));
  assert.equal((await r.owner.signOut()).status, 409);
  assert.equal(await r.keys.get(), oldKey);
  assert.deepEqual([r.o().role, r.o().kid, r.flag.get()], ['signs', before, false]);

  const out = await r.owner.signOut();
  assert.equal(out.status, 200);
  const sent = r.door.calls('/data/account/exchange').at(-1).body;
  assert.deepEqual(sent.action, { type: 'signOut', device: `device:${before}`, nonce: NONCE });
  assert.equal(r.door.owners.size, 0, 'the door took it');
  assert.equal(r.flag.get(), true);
  assert.deepEqual([r.o().role, r.o().kid], ['signed-out', '']);
  assert.equal(await r.keys.get(), undefined, 'the key is gone');

  // signed out: a plain ready makes and sends nothing, and there is nothing to sign out of
  const pairs = r.door.calls('/data/account/pair').length;
  await r.owner.ready();
  assert.equal(r.o().role, 'signed-out');
  assert.equal(await r.keys.get(), undefined);
  assert.deepEqual(await r.owner.signOut(), NOT_SIGNING);
  assert.equal(r.door.calls('/data/account/pair').length, pairs);

  await r.owner.signIn();
  assert.equal(r.flag.get(), false);
  const fresh = await r.keys.get();
  assert.ok(fresh && fresh !== oldKey, 'a new key');
  assert.equal(r.o().role, 'needs-code', 'the last device out: the next pairs with the code');
  assert.notEqual(r.o().kid, before);
  await r.owner.ready(CODE);
  assert.equal(r.o().role, 'signs');

  // a code typed while signed out clears the flag and pairs
  const s = await signing();
  await s.owner.signOut();
  await s.owner.ready(CODE);
  assert.deepEqual([s.flag.get(), s.o().role], [false, 'signs']);
});

test('no WebCrypto is none', async () => {
  const r = rig({ crypto: null });
  await r.owner.ready();
  assert.equal(r.o().role, 'none');
  await r.owner.standing(pageWith([]));
  assert.equal(r.o().role, 'none');
  assert.equal(r.door.calls('/data/account/pair').length, 0, 'nothing sent');

  // the pair threw: a key store that cannot open
  const broken = { get: () => Promise.reject(new Error('blocked')), put: async () => {}, remove: async () => {} };
  const b = rig({ keys: broken });
  await b.owner.ready();
  assert.deepEqual([b.o().role, b.o().kid, b.o().busy], ['none', '', false]);
  assert.equal(b.door.calls('/data/account/pair').length, 0);

  // the door names another key than this one
  const d = door();
  const other = { status: 200, body: { ok: true, kid: '0123456789abcdef', role: 'owner' } };
  d.once('/data/account/pair', other);
  const m = rig({ d });
  await m.owner.ready(CODE);
  assert.deepEqual(m.o(), { role: 'none', kid: '', refusal: 'The account named another key', busy: false });
});

test('a thrown post is a refusal in the same shape', async () => {
  const thrown = postVia(async () => { throw new TypeError('fetch failed'); });
  assert.deepEqual(await thrown('/data/account/pair', { label: 'x' }), NO_ANSWER);

  // the POST itself: JSON declared, the body as text, an unreadable answer as {}
  const seen = [];
  const fetchy = async (path, init) => { seen.push([path, init]); return { status: 502, json: () => Promise.reject(new SyntaxError('bad')) }; };
  assert.deepEqual(await postVia(fetchy)('/data/account/prepare', { draft: WATCH }), { status: 502, body: {} });
  assert.deepEqual(seen, [['/data/account/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft: WATCH }) }]]);
  const ok = async () => ({ status: 200, json: async () => ({ ok: true, kid: 'k', role: 'pending' }) });
  assert.deepEqual(await postVia(ok)('/data/account/pair'), { status: 200, body: { ok: true, kid: 'k', role: 'pending' } });

  // the device over it: the refusal's words on the slice, the role as it was; an act hands the same shape back
  const r = rig({ post: thrown });
  await r.owner.ready();
  assert.deepEqual([r.o().role, r.o().refusal, r.o().busy], ['unknown', 'The account did not answer. Try again.', false]);
  assert.deepEqual(await r.owner.act(WATCH), NO_ANSWER);
});
