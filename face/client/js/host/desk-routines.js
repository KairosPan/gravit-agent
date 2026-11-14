// face/client/js/host/desk-routines.js — the Desk page's routines (desk-page plan 2 Task 7, spec 2026-11-14 §6.7): GET
// /data/desk/routines into the store's deskPage slice, at once (unless read within the poll already) and every
// DESK_ROUTINES_POLL_MS while the Desk is on screen in a visible tab, one read in flight at a time; and the column's three
// acts - a routine's switch, its Test and its Delete - each a POST to src/routine-routes.ts, the routines read again after
// it answers. A refused act is one line under its row: the desk paused, the cap spent, else the request failed. A Test reads
// Running… from the click until a read made after the face queued it holds no test of that routine, queued or under way.
// And the routine card's two answers (plan 3 Task 3): confirm and dismiss a proposal, the routines read again after it
// answers, a refusal kept by the proposal's id (`limit`, else `failed`) for the card to word; the poll runs while the Desk or
// Messages, where the cards are, is on screen. Nothing here touches the DOM.
import { said } from '../i18n/words.js';

export const DESK_ROUTINES_POLL_MS = 15_000;

const ROUTINES = '/data/desk/routines';
const SWITCH = '/data/desk/routines/switch';
const TEST = '/data/desk/routines/test';
const DELETE = '/data/desk/routines/delete';
const CONFIRM = '/data/desk/routines/confirm';
const DISMISS = '/data/desk/routines/dismiss';
const messageOf = err => (err instanceof Error ? err.said ?? err.message : err == null ? said('desk.requestFailed') : String(err));
// a call made now, at once, its throw a rejection
const attempt = fn => { try { return Promise.resolve(fn()); } catch (err) { return Promise.reject(err); } };
// a refused act's line: the route's code (on the body getJson keeps, or the code postJson throws with) as the column's words
function refusedOf(err) {
  const code = err?.body?.error ?? err?.code;
  if (code === 'paused') return said('desk.routines.refusedPaused');
  if (code === 'cap') return said('desk.routines.refusedCap');
  return said('desk.requestFailed');
}
// whether a routines body holds a test of `id` queued or under way (a test run's key is `<routine>:test:<ISO time>`)
const testing = (data, id) => {
  const mine = key => typeof key === 'string' && key.startsWith(`${id}:test:`);
  return mine(data?.running) || (Array.isArray(data?.queued) && data.queued.some(mine));
};

export function startDeskRoutines({ store, getJson, postJson, schedule, cancelTimer, now = Date.now }) {
  let closed = false;
  let shown = false;
  let timer = null;
  let flight = null;
  let readAt = null;   // when the last read was asked: the Desk shown again within the poll reads at the poll's turn, not at once
  let reads = 0;       // the reads asked so far, so a Test is settled only by a read asked after the face queued it
  const tests = new Map();   // a routine's id -> the count of reads asked when its Test was queued

  function settle(data, seq) {
    for (const [id, after] of tests) {
      if (seq <= after || testing(data, id)) continue;
      tests.delete(id);
      store.dispatch('deskRoutineBusy', { id, what: null });
    }
  }
  function read() {
    if (closed) return Promise.resolve();
    if (flight) return flight;
    readAt = now();
    const seq = ++reads;
    const current = attempt(() => getJson(ROUTINES))
      .then(data => {
        if (closed) return;
        if (data && data.ok === true) {
          store.dispatch('deskRoutinesLoaded', { data, at: now() });
          settle(data, seq);
        } else store.dispatch('deskRoutinesFailed', { at: now(), message: typeof data?.error === 'string' ? data.error : said('desk.routines.notRoutines') });
      }, err => { if (!closed) store.dispatch('deskRoutinesFailed', { at: now(), message: messageOf(err) }); })
      .finally(() => { if (flight === current) flight = null; });
    flight = current;
    return current;
  }
  // a read asked after an act answered: one already in flight was asked before it, so a fresh one follows it
  const reread = () => (flight ? flight.then(read) : read());
  function arm(ms = DESK_ROUTINES_POLL_MS) {
    timer = schedule(() => { timer = null; if (closed || !shown) return; arm(); void read(); }, ms);
  }
  function stop() {
    if (timer !== null) { cancelTimer(timer); timer = null; }
  }
  // an act on `id`: its line cleared, the post, then the routines read again; a refusal says so under the row
  function act(id, path, body, { refused } = {}) {
    if (closed || typeof id !== 'string' || id === '') return Promise.resolve();
    store.dispatch('deskRoutineSaid', { id, message: null });
    return attempt(() => postJson(path, body))
      .then(answer => (closed ? undefined : answer), err => {
        if (closed) return undefined;
        refused?.();
        store.dispatch('deskRoutineSaid', { id, message: refusedOf(err) });
        return null;
      });
  }

  // a routine card's answer on `proposal`, one at a time (a second click, or ✗ after ✓, while one is in flight does nothing):
  // its keys hidden and its line cleared, the post, then the routines read again, the keys back only once that read settles;
  // a refusal is kept by the proposal's id - `limit` when the face holds twenty routines already, `failed` for any other
  const answering = new Set();
  const deleting = new Set();   // the ids whose Delete is in flight
  function respond(proposal, path) {
    if (closed || typeof proposal !== 'string' || proposal === '' || answering.has(proposal)) return Promise.resolve();
    answering.add(proposal);
    store.dispatch('deskProposalBusy', { proposal, busy: true });
    store.dispatch('deskProposalSaid', { proposal, said: null });
    return attempt(() => postJson(path, { proposal })).then(() => (closed ? undefined : reread()), err => {
      if (closed) return undefined;
      const code = err?.body?.error ?? err?.code;
      store.dispatch('deskProposalSaid', { proposal, said: code === 'limit' ? 'limit' : 'failed' });
      return undefined;
    }).finally(() => {
      answering.delete(proposal);
      if (!closed) store.dispatch('deskProposalBusy', { proposal, busy: false });
    });
  }

  return {
    /** The Desk or Messages on screen in a visible tab, or not: the routines are read at once on showing, then every
     *  DESK_ROUTINES_POLL_MS. */
    show(on) {
      if (closed) return;
      const next = Boolean(on);
      if (next === shown) return;
      shown = next;
      if (!shown) { stop(); return; }
      const since = readAt === null ? Infinity : now() - readAt;
      if (since < DESK_ROUTINES_POLL_MS) { arm(DESK_ROUTINES_POLL_MS - since); return; }
      arm();
      void read();
    },
    /** A routine's switch: POST { id, enabled }, then the routines read again. */
    switchOne(id, enabled) {
      return act(id, SWITCH, { id, enabled: enabled === true }).then(answer => (answer ? reread() : undefined));
    },
    /** A test run of `id`: Running… at once, the post, then reads until one asked after the face queued it holds no test of it. */
    test(id) {
      if (closed || typeof id !== 'string' || id === '' || store.get().deskPage.rBusy[id] === 'test') return Promise.resolve();
      store.dispatch('deskRoutineBusy', { id, what: 'test' });
      return act(id, TEST, { id }, { refused: () => store.dispatch('deskRoutineBusy', { id, what: null }) }).then(answer => {
        if (!answer) return undefined;
        tests.set(id, reads);
        return reread();
      });
    },
    /** Delete `id` (asked once more on the page first): the question closed, the post, then the routines read again; a
     *  second Delete of `id` while one is in flight does nothing. */
    remove(id) {
      if (closed || typeof id !== 'string' || id === '' || deleting.has(id)) return Promise.resolve();
      deleting.add(id);
      store.dispatch('deskRoutineAskOff');
      return act(id, DELETE, { id }).then(answer => (answer ? reread() : undefined)).finally(() => { deleting.delete(id); });
    },
    /** A routine card's ✓: POST { proposal } to confirm, then the routines read again, the card settling on that read. */
    confirm(proposal) {
      return respond(proposal, CONFIRM);
    },
    /** A routine card's ✗: POST { proposal } to dismiss, then the routines read again. */
    dismiss(proposal) {
      return respond(proposal, DISMISS);
    },
    dispose() {
      closed = true;
      shown = false;
      stop();
    },
  };
}
