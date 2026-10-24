// face/client/js/host/owner.js — the owner device (spec 2026-10-22 §6.3, plan 2): this page as an owner device of the
// Account, the Account's own owner.js under the face's names (docs/research/2026-10-22-account-owner-path-map.md §1–§2) —
// the key from the injected store (made and kept when there is none), paired at /data/account/pair, the standing read off
// every /data/account page, prepare at /data/account/prepare, the signed envelope to /data/account/exchange, sign-out and
// sign-in. Everything goes through the face's proxy, never to the Account directly. The host draws nothing and owns no
// words for the screen: it dispatches ownerStanding, ownerRefusal and ownerBusy and hands every answer back as it came.
// No key material, code or envelope is logged or kept beyond the call.
import { kidOf, publicJwkOf, signPrepared, makeKey } from '../wire/owner-key.js';
import { pageOk } from './account-view.js';

const PAIR = '/data/account/pair', PREPARE = '/data/account/prepare', EXCHANGE = '/data/account/exchange';
// the Account's pair roles under the face's names
const ROLE_OF = new Map([['owner', 'signs'], ['pending', 'pending'], ['needs-code', 'needs-code']]);
const NO_ANSWER = 'The account did not answer. Try again.';
// the Account's own sentence for a page that does not sign (owner.js signOut)
const NOT_SIGNING = 'This browser does not sign for the account.';
const ANOTHER_KEY = 'The account named another key';

// the Account's `why`: its refusal's sentence, else its error, else a result's message
const whyOf = r => r?.body?.refusal?.message || r?.body?.error || r?.body?.result?.message || '';
const refused = error => ({ status: 0, body: { ok: false, error } });
const clear = () => {};

/** A POST through the face's proxy that never throws: `{ status, body }`, the body parsed or `{}`, a thrown fetch as the
 *  refusal `The account did not answer. Try again.` (status 0). @param {typeof fetch} fetch */
export function postVia(fetch) {
  return async (path, body) => {
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    } catch {
      return { status: 0, body: { ok: false, error: NO_ANSWER } };
    }
  };
}

export function startOwner({ store, post, subtle, keys, flag, label = 'Gravit face' }) {
  let closed = false;
  let flight = null;   // the pairing in the air: a plain ready() joins it, one with a code runs after it
  let asked = false;   // the first page has asked the door once for a page that never paired
  let busyCount = 0;

  const stand = (role, kid) => { if (!closed) store.dispatch('ownerStanding', { role, kid }); };
  const say = message => { if (!closed) store.dispatch('ownerRefusal', message); };
  function busy(step) {
    const was = busyCount > 0;
    busyCount += step;
    if (!closed && was !== busyCount > 0) store.dispatch('ownerBusy', busyCount > 0);
  }

  async function pairNow(code) {
    if (closed) return;
    if (!subtle) { stand('none', ''); return; }
    if (flag.get() && !code) { stand('signed-out', ''); return; }
    if (code) flag.set(false);
    busy(1);
    try {
      let jwk, kid;
      try {
        let pair = await keys.get();
        if (!pair) { pair = await makeKey(subtle); await keys.put(pair); }
        jwk = await publicJwkOf(subtle, pair);
        kid = await kidOf(subtle, jwk);
      } catch {
        stand('none', '');
        return;
      }
      const r = await post(PAIR, { jwk, label, ...(code ? { code } : {}) });
      const role = r.status === 200 && r.body?.ok !== false ? ROLE_OF.get(r.body?.role) : undefined;
      if (!role) { say(whyOf(r)); return; }
      if (r.body.kid !== kid) { stand('none', ''); say(ANOTHER_KEY); return; }
      stand(role, kid);
      say(null);
    } finally {
      busy(-1);
    }
  }

  /** Pair this page's key (made and kept when there is none); a code clears the sign-out flag. Signed out and no code: the
   *  role is `signed-out` and nothing is made or sent. A refusal is the Account's words, the role as it was. */
  function ready(code) {
    if (closed) return Promise.resolve();
    if (!code && flight) return flight;
    const run = (flight ?? Promise.resolve()).then(() => pairNow(code));
    flight = run;
    run.then(() => { if (flight === run) flight = null; }, clear);
    return run;
  }

  /** The standing off a page the face recognises: this key among the owners signs, among the pending devices waits; in
   *  neither after it signed or waited, the service restarted and it pairs again. A page that never paired asks the door
   *  once, unless signed out. */
  function standing(page) {
    if (closed || !pageOk(page)) return Promise.resolve();
    const { role, kid } = store.get().owner;
    if (kid) {
      const owners = Array.isArray(page.signers.owners) ? page.signers.owners : [];
      const waiting = Array.isArray(page.signers.pendingDevices) ? page.signers.pendingDevices : [];
      if (owners.some(o => o?.id === `device:${kid}`)) stand('signs', kid);
      else if (waiting.some(d => d?.kid === kid)) stand('pending', kid);
      else if (role === 'signs' || role === 'pending') return ready();
      return Promise.resolve();
    }
    if (role === 'unknown' && !asked && !flag.get()) {
      asked = true;
      return ready();
    }
    return Promise.resolve();
  }

  /** The Account's preparation of a draft, unsigned, as it came. */
  const prepare = draft => post(PREPARE, { draft });

  /** The envelope for a preparation: exactly the action, its nonce and this key's signature over the shown fields. A bad
   *  signature on a page that signs reads the standing again and keeps the Account's words. */
  async function submit(prepared) {
    const { role, kid } = store.get().owner;
    if (role !== 'signs' || !kid || !subtle) return refused(NOT_SIGNING);
    let signature;
    try {
      const pair = await keys.get();
      if (!pair?.privateKey) return refused(NOT_SIGNING);
      signature = await signPrepared(subtle, pair.privateKey, kid, prepared);
    } catch {
      return refused(NOT_SIGNING);
    }
    const r = await post(EXCHANGE, { action: prepared.action, nonce: prepared.action.nonce, signature });
    if (!closed && r?.body?.refusal?.code === 'E_ACCOUNT_BAD_SIGNATURE' && store.get().owner.role === 'signs') {
      await ready();
      say(whyOf(r));
    }
    return r;
  }

  /** Prepare, then sign only a preparation that came back with fields to show; anything else is handed back unsigned. */
  async function act(draft) {
    const p = await prepare(draft);
    if (p.status === 200 && p.body?.ok !== false && Array.isArray(p.body?.shown)) return submit(p.body);
    return p;
  }

  /** Sign this page out: only a page that signs. Once the Account took it, the flag is set and the key deleted; a refusal
   *  or no answer leaves the key and the role as they were. */
  async function signOut() {
    const { role, kid } = store.get().owner;
    if (role !== 'signs' || !kid) return refused(NOT_SIGNING);
    busy(1);
    try {
      const r = await act({ type: 'signOut', device: `device:${kid}` });
      if (r.status === 200 && r.body?.ok !== false) {
        flag.set(true);
        stand('signed-out', '');
        try { await keys.remove(); } catch { /* the Account dropped the device: a key left behind signs for nothing */ }
      }
      return r;
    } finally {
      busy(-1);
    }
  }

  /** Sign in again: the flag off, a new key paired (the code when no device signs, else a wait). */
  function signIn() {
    flag.set(false);
    return ready();
  }

  function close() {
    closed = true;
  }

  return { ready, standing, prepare, submit, act, signOut, signIn, close };
}
