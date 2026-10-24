// face/client/js/host/sheet.js — the owner sheet's engine (spec 2026-10-22 §6.3, plan 2 Task 5): every owner action is prepare →
// What you sign → sign, the Account's own `quoteDialog` (docs/research/2026-10-22-account-owner-path-map.md §3, §6 risk 6) over
// the owner device (host/owner.js) and the sheet's pure shape (host/sheet-view.js). A complete form is prepared at once, a change
// after a quiet spell; a press on a form that changed since the shown preparation prepares again instead of signing; a
// preparation with a `deadline` counts down every second and is prepared again at zero, and a press under thirty seconds prepares
// again and signs the fresh one. Only the latest ask lands. The engine draws nothing, knows no kind's fields, holds no key and
// logs nothing of a preparation or an answer.
import { draftOf, fieldsOf } from './sheet-view.js';
import { refusedAt, refusalOf, saidOf } from './owner-view.js';

/** A change is prepared after this long without another. */
export const PREPARE_QUIET_MS = 300;
/** A press with less than this left on the preparation's deadline prepares again before signing. */
export const RESIGN_UNDER_MS = 30_000;
/** A quote older than this is prepared again, quietly, when its market moved (the Trade ticket's, Task 9). */
export const FRESH_MS = 3_000;
const TICK_MS = 1_000;

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
// the preparation's deadline in milliseconds (the Account's u64), or null
const deadlineOf = action => {
  const d = typeof action?.deadline === 'string' && action.deadline !== '' ? Number(action.deadline) : action?.deadline;
  return Number.isFinite(d) ? d : null;
};

/** The form's draft as the sheet compares it, or null while it is incomplete: the draft read at the epoch, so a draft that reads
 *  the clock (a `validUntil`) is the same draft a minute on — only the form and the seed tell one apart. The renderer compares it
 *  to the sheet's `asked` to tell whether the shown preparation is still the form's. */
export function askedOf(s) {
  if (!s) return null;
  const draft = draftOf(s.kind, s.fields, s.seed, 0);
  return typeof draft === 'string' ? null : JSON.stringify(draft);
}

export function startSheet({ store, owner, schedule, cancelTimer, now, afterAction, onChange = () => {} }) {
  let seq = 0;            // the latest ask: an answer for an older one, or for a sheet since closed, is dropped
  let opened = 0;         // the open sheet's generation: a sign's answer lands only on the sheet it was pressed on
  let quietTimer = null;  // the change waiting for its quiet spell
  let tickTimer = null;   // the countdown's next second

  const current = () => store.get().sheet;
  const clearQuiet = () => { if (quietTimer !== null) { cancelTimer(quietTimer); quietTimer = null; } };
  const stopTick = () => { if (tickTimer !== null) { cancelTimer(tickTimer); tickTimer = null; } };

  // every second while a deadline is held: redraw the countdown, and at zero prepare again
  function tick() {
    tickTimer = null;
    const s = current();
    if (!s || s.deadline === null) return;
    if (s.deadline - now() <= 0) { prepareNow(); return; }
    store.dispatch('sheetTick');
    tickTimer = schedule(tick, TICK_MS);
  }
  function armTick() {
    stopTick();
    tickTimer = schedule(tick, TICK_MS);
  }

  /** Ask the Account to prepare the form as it stands — or, incomplete, say what is missing. A quiet ask keeps the shown
   *  preparation until the new one lands; a loud one shows the sheet asking. Resolves the preparation that landed, else null. */
  async function prepareNow({ quiet = false } = {}) {
    clearQuiet();
    const s = current();
    if (!s || s.status === 'signing') return null;
    const mine = ++seq;
    const draft = draftOf(s.kind, s.fields, s.seed, now());
    if (typeof draft === 'string') {
      stopTick();
      store.dispatch('sheetIncomplete', draft);
      return null;
    }
    const asked = askedOf(s);
    store.dispatch('sheetAsking', { quiet });
    if (current()?.deadline === null) stopTick();
    const r = await owner.prepare(draft);
    if (mine !== seq || !current()) return null;
    if (refusedAt(r) || !isRecord(r.body?.action) || !Array.isArray(r.body?.shown)) {
      stopTick();
      store.dispatch('sheetRefused', refusalOf(r));
      return null;
    }
    const deadline = deadlineOf(r.body.action);
    store.dispatch('sheetPrepared', { prepared: r.body, at: now(), asked, deadline });
    if (deadline !== null) armTick(); else stopTick();
    return r.body;
  }

  /** Open a sheet (closing the one open): its fields the sheet-view's for the seed unless given; prepared at once when the form
   *  is complete. */
  function open(kind, seed, fields) {
    if (current()) close();
    opened += 1;
    store.dispatch('sheetOpen', { kind, seed, fields: fields ?? fieldsOf(kind, seed) });
    return prepareNow();
  }

  /** A field changed: the form takes it at once, the ask waits for PREPARE_QUIET_MS without another change. */
  function change(name, value) {
    const s = current();
    if (!s) return;
    store.dispatch('sheetField', { name, value });
    clearQuiet();
    quietTimer = schedule(() => { quietTimer = null; prepareNow({ quiet: true }); }, PREPARE_QUIET_MS);
    onChange(s.kind, name, value);
  }

  /** The go key: sign the shown preparation — never one whose draft is not the form's now (that prepares again instead), never
   *  one with less than RESIGN_UNDER_MS left (that prepares again and signs the fresh one in the same press). */
  async function submit() {
    const s = current();
    if (!s || s.status === 'signing' || s.status === 'done') return;
    if (s.status !== 'ready' || askedOf(s) !== s.asked) { await prepareNow(); return; }
    let prepared = s.prepared;
    if (s.deadline !== null && s.deadline - now() < RESIGN_UNDER_MS) {
      prepared = await prepareNow();
      const t = current();
      // the fresh one, only while it is still the shown one and the form's
      if (!prepared || !t || t.status !== 'ready' || t.prepared !== prepared || askedOf(t) !== t.asked) return;
    }
    const mine = opened;
    seq += 1;   // an ask still in the air would land over the sign: dropped
    clearQuiet();
    store.dispatch('sheetSigning');
    const r = await owner.submit(prepared);
    const here = mine === opened && current() !== null;
    if (refusedAt(r)) {
      if (here) { stopTick(); store.dispatch('sheetRefused', refusalOf(r)); }
      return;
    }
    if (here) { stopTick(); store.dispatch('sheetDone', { said: saidOf(r.body) }); }
    // taken: the Account changed, whether or not the sheet is still open
    afterAction(s.kind, r.body);
  }

  /** The Prepare again key. */
  const again = () => prepareNow();

  /** Close the sheet: every timer cancelled, every answer in the air dropped. */
  function close() {
    clearQuiet();
    stopTick();
    seq += 1;
    opened += 1;
    if (current()) store.dispatch('sheetClose');
  }

  return { open, change, prepareNow, submit, again, close };
}
