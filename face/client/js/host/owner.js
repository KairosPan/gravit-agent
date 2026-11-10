// face/client/js/host/owner.js — the owner device (spec 2026-10-22 §6.3, plan 2): this page as an owner device of the
// Account, the Account's own owner.js under the face's names (docs/research/2026-10-22-account-owner-path-map.md §1–§2) —
// the key from the injected store (made and kept when there is none), paired at /data/account/pair, the standing read off
// every /data/account read, prepare at /data/account/prepare, the signed envelope to /data/account/exchange, sign-out and
// sign-in. Everything goes through the face's proxy, never to the Account directly. The host draws nothing and owns no
// words for the screen: it dispatches ownerStanding, ownerRefusal and ownerBusy and hands every answer back as it came.
// No key material, code or envelope is logged or kept beyond the call.
import { kidOf, publicJwkOf, signPrepared, makeKey } from '../wire/owner-key.js';
import { pageOk } from './account-view.js';
import { whyOf, refusedAt } from './owner-view.js';
import { said } from '../i18n/words.js';
import { postAct } from './act.js';

const PAIR = '/data/account/pair', PREPARE = '/data/account/prepare', EXCHANGE = '/data/account/exchange';
// the Account's pair roles under the face's names
const ROLE_OF = new Map([['owner', 'signs'], ['pending', 'pending'], ['asked', 'asked'], ['needs-code', 'needs-code']]);
// the Account's refusal of a code that names Get a code as the answer (none live — a restart voids them — or too many wrong
// tries): the code box is no use any more, the page is back to waiting with its key
const ASK_AGAIN = /\bGet a code\b/;
const noAnswer = () => said('account.noAnswer');
// owner.notSigning: the line for a page asked to sign that does not sign (owner.js signOut)
const notSigning = () => said('owner.notSigning');
const anotherKey = () => said('owner.anotherKey');

const refused = error => ({ status: 0, body: { ok: false, error } });
const isObject = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
// an exchange the Account took: a 2xx that its refusedAt does not call refused (a result that is a refusal is one)
const taken = r => r.status >= 200 && r.status < 300 && !refusedAt(r);

/** A POST through the face's proxy that never throws: `{ status, body }`, the body parsed when it is an object, else `{}`;
 *  a thrown fetch as the refusal `The account did not answer. Try again.` (status 0). @param {typeof fetch} fetch */
export function postVia(fetch) {
  return async (path, body) => {
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
      const parsed = await r.json().catch(() => ({}));
      return { status: r.status, body: isObject(parsed) ? parsed : {} };
    } catch {
      return { status: 0, body: { ok: false, error: noAnswer() } };
    }
  };
}

export function startOwner({ store, post, subtle, keys, flag, label = 'Gravit face' }) { // en-kept: the device's label at the Account, the product's name
  let closed = false;
  let flight = null;        // the pairing in the air: a plain ready() joins it, one with a code (or a sign-in) runs after it
  let asked = false;        // a page that never paired has asked the door, and that ask is still standing
  let busyCount = 0;
  let generation = 0;       // moved by a sign-out and a sign-in: a pair answer from before either is dropped
  let signingOut = false;   // a sign-out in the air: nothing pairs until it is answered

  const stand = (role, kid) => { if (!closed) store.dispatch('ownerStanding', { role, kid }); };
  const say = message => { if (!closed) store.dispatch('ownerRefusal', message); };
  function busy(step) {
    const was = busyCount > 0;
    busyCount += step;
    if (!closed && was !== busyCount > 0) store.dispatch('ownerBusy', busyCount > 0);
  }

  async function pairNow(code, ask = false) {
    if (closed || signingOut) return;
    const mine = generation;
    const current = () => !closed && mine === generation;
    if (!subtle) { stand('none', ''); return; }
    if (flag.get() && !code) { stand('signed-out', ''); return; }
    if (code) flag.set(false);
    // busy counts before it dispatches, so the count is always given back, even when a subscriber threw
    try {
      busy(1);
      let jwk, kid;
      try {
        let pair = await keys.get();
        if (!pair) { pair = await makeKey(subtle); await keys.put(pair); }
        jwk = await publicJwkOf(subtle, pair);
        kid = await kidOf(subtle, jwk);
      } catch {
        if (current()) stand('none', '');
        return;
      }
      if (!current()) return;
      const r = await post(PAIR, { jwk, label, ...(code ? { code } : {}), ...(ask ? { ask: true } : {}) });
      if (!current()) return;
      let role = r.status === 200 && r.body?.ok !== false ? ROLE_OF.get(r.body?.role) : undefined;
      if (!role) {
        const why = whyOf(r);
        // a code the Account has no live one for: Get a code again
        if (code && store.get().owner.role === 'asked' && store.get().owner.kid === kid && ASK_AGAIN.test(why)) stand('pending', kid);
        say(why);
        return;
      }
      if (r.body.kid !== kid) { stand('none', ''); say(anotherKey()); return; }
      // a plain knock answers `pending` for a browser whose code is still live: the box it asked for stays
      if (role === 'pending' && !ask && store.get().owner.role === 'asked' && store.get().owner.kid === kid) role = 'asked';
      stand(role, kid);
      say(null);
    } finally {
      busy(-1);
    }
  }

  // one pairing at a time: `join` lets a plain ask share the one in the air; otherwise it runs after it, whatever it did
  function request(code, join, ask = false) {
    if (closed) return Promise.resolve();
    if (join && flight) return flight;
    const run = (flight ?? Promise.resolve()).catch(() => {}).then(() => pairNow(code, ask));
    flight = run;
    const done = () => { if (flight === run) flight = null; };
    run.then(done, done);
    return run;
  }

  /** Pair this page's key (made and kept when there is none); a code clears the sign-out flag. Signed out and no code: the
   *  role is `signed-out` and nothing is made or sent. A refusal is the Account's words, the role as it was. */
  const ready = code => request(code, !code);

  /** Get a code (sign-only-money §4.5): a waiting browser asks the Account to print a code for it in its terminal — the pair
   *  route with `ask`, never a code. Answered `asked`, the page shows the code box; a refusal is the Account's words, the role
   *  as it was. Signed out: nothing is sent. */
  const askCode = () => request(undefined, false, true);

  /** The standing off a page the face recognises: this key among the owners signs, among the pending devices waits; in
   *  neither after it signed or waited, the service restarted and it pairs again — never while a sign-out is in the air. A
   *  page that never paired asks the door, once while that ask stands; one refused or unanswered lets the next page ask. */
  function standing(page) {
    if (closed || !pageOk(page)) return Promise.resolve();
    const { role, kid } = store.get().owner;
    if (kid) {
      const owners = Array.isArray(page.signers.owners) ? page.signers.owners : [];
      const waiting = Array.isArray(page.signers.pendingDevices) ? page.signers.pendingDevices : [];
      if (owners.some(o => o?.id === `device:${kid}`)) stand('signs', kid);
      // still waiting: a browser that asked keeps its code box (the page does not say whether its code is live)
      else if (waiting.some(d => d?.kid === kid)) stand(role === 'asked' ? 'asked' : 'pending', kid);
      else if ((role === 'signs' || role === 'pending' || role === 'asked') && !signingOut) {
        // not waiting any more: no code it asked for can be live, so the box goes with it
        if (role === 'asked') stand('pending', kid);
        return ready();
      }
      return Promise.resolve();
    }
    if (role === 'unknown' && !asked && !flag.get()) {
      asked = true;
      const rearm = () => { if (store.get().owner.role === 'unknown') asked = false; };
      return ready().then(rearm, e => { rearm(); throw e; });
    }
    return Promise.resolve();
  }

  /** The Account's preparation of a draft, unsigned, as it came. */
  const prepare = draft => post(PREPARE, { draft });

  /** The envelope for a preparation: exactly the action, its nonce and this key's signature over the shown fields. The
   *  door's bad signature (a 401) on a page that signs reads the standing again and keeps the Account's words; an exchange
   *  the Account takes clears them. This page's own sign-out (Settings › Devices' sheet signs it here) pairs nothing while
   *  it is in the air and, taken, ends the device as signOut() does: the flag set, the key deleted. */
  async function submit(prepared) {
    const { role, kid } = store.get().owner;
    if (role !== 'signs' || !kid || !subtle) return refused(notSigning());
    if (!isObject(prepared?.action) || !Array.isArray(prepared?.shown)) return refused(notSigning());
    const leaving = prepared.action.type === 'signOut' && prepared.action.device === `device:${kid}`;
    if (leaving) { generation += 1; signingOut = true; }
    try {
      let signature;
      try {
        const pair = await keys.get();
        if (!pair?.privateKey) return refused(notSigning());
        signature = await signPrepared(subtle, pair.privateKey, kid, prepared);
      } catch {
        return refused(notSigning());
      }
      const r = await post(EXCHANGE, { action: prepared.action, nonce: prepared.action.nonce, signature });
      if (closed) return r;
      if (leaving && taken(r)) {
        flag.set(true);
        stand('signed-out', '');
        try { await keys.remove(); } catch { /* the Account dropped the device: a key left behind signs for nothing */ }
      } else if (r.status === 401 && r.body?.refusal?.code === 'E_ACCOUNT_BAD_SIGNATURE' && store.get().owner.role === 'signs') {
        await ready();
        say(whyOf(r));
      } else if (taken(r) && store.get().owner.refusal !== null) say(null);
      return r;
    } finally {
      if (leaving) signingOut = false;
    }
  }

  /** An action the account takes unsigned (sign-only-money §5.3: opening a paper account), posted once to its unsigned door
   *  (host/act.js): `{ ok: true, body }` taken, else `{ ok: false, said }` in the account's words. No key, from any page. */
  const unsigned = action => postAct(post, action);

  /** Prepare, then sign only a preparation that came back with fields to show; anything else is handed back unsigned. */
  async function act(draft) {
    const p = await prepare(draft);
    if (p.status === 200 && p.body?.ok !== false && Array.isArray(p.body?.shown)) return submit(p.body);
    return p;
  }

  /** Sign this page out: only a page that signs. Nothing pairs while it is in the air, and a pair answer from before it is
   *  dropped. Once the Account took it, the flag is set and the key deleted; a refusal or no answer leaves the key and the
   *  role as they were. */
  async function signOut() {
    const { role, kid } = store.get().owner;
    if (role !== 'signs' || !kid) return refused(notSigning());
    generation += 1;
    signingOut = true;
    try {
      busy(1);
      const r = await act({ type: 'signOut', device: `device:${kid}` });
      // taken as submit takes it: a 200 that is a refusal leaves the device as it was
      if (taken(r)) {
        flag.set(true);
        stand('signed-out', '');
        try { await keys.remove(); } catch { /* the Account dropped the device: a key left behind signs for nothing */ }
      }
      return r;
    } finally {
      signingOut = false;
      busy(-1);
    }
  }

  /** Sign in again: the flag off, a new key paired (the code when no device signs, else a wait) — never an answer to a
   *  pairing from before. */
  function signIn() {
    flag.set(false);
    generation += 1;
    return request(undefined, false);
  }

  function close() {
    closed = true;
  }

  return { ready, askCode, standing, prepare, submit, act, unsigned, signOut, signIn, close };
}
