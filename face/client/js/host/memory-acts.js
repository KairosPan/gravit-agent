// face/client/js/host/memory-acts.js — the owner's acts on the Memory screen (memory owner acts plan Task 4): arm, retire or
// discard a lesson; accept, edit or reject a proposal; void a decision, each signed by this page as an `attest` and done by the
// face only on the Account's yes (src/memory-acts.ts). open asks the face's prepare (`POST /data/memory/prepare`) what the act
// acts on and the attest to sign: for an act that takes no words the draft goes to the Account's prepare through the owner
// device at once, and the drawer is ready; for a worded act the drawer waits for the owner's words and, ACT_QUIET_MS after the
// last keystroke, asks the face's prepare again with them, trimmed, then the Account's. go signs the Account's preparation
// through the owner device (host/owner.js sign) and posts `{ act, subject, words, envelope }` to `POST /data/memory/act`, the
// same trimmed words the preparation was asked with; done, it calls afterDone(act), which reads the lessons, the waiting and
// the decisions again, as does a refusal that says it changed while it was shown. The page computes no digest and holds no
// key: the draft is the face's, what to sign the Account's, the signature the owner device's. One act at a time; an answer
// for an act closed, or for words typed since, changes nothing. And the acts a row's state allows, as the face's prepare
// allows them, for the keys the tabs draw. Nothing here touches the DOM.
import { refusalOf } from './owner-view.js';
import { decisionMarks } from './memory-page-view.js';
import { isId, MEMORY_ACTS, WORDED_ACTS } from '../reducers/memory-page.js';

export { MEMORY_ACTS, WORDED_ACTS };
/** How long the owner's words stay unchanged before they are prepared. */
export const ACT_QUIET_MS = 300;

const PREPARE = '/data/memory/prepare', ACT = '/data/memory/act';
// the face's sentence for an act whose content changed between what was shown and the Account's yes (src/memory-acts.ts)
const CHANGED = 'it changed while it was shown: nothing was done'; // en-kept: the face's refusal, matched as the route words it
// each act's subject's shape, as the face's prepare checks it
const LESSON = /^[a-z0-9][a-z0-9-]{1,39}$/, PROPOSAL = /^p-\d{8}-[0-9a-f]{8}$/, DECISION = /^d-\d{8}-[0-9a-f]{8}$/;
const SUBJECT = { arm: LESSON, retire: LESSON, discard: LESSON, accept: PROPOSAL, edit: PROPOSAL, reject: PROPOSAL, void: DECISION };
// the lesson states a card that parses is armed from
const ARMABLE = ['changed', 'broken', 'unarmed', 'retired'];

/** Whether `act` is one of the screen's acts and `subject` a plain id of that act's shape. */
export const actFits = (act, subject) => MEMORY_ACTS.includes(act) && isId(subject) && SUBJECT[act].test(subject);

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fitting = (acts, subject) => acts.filter(act => actFits(act, subject));

/** The acts a lesson row's state allows: arm a card whose file parses and that is neither armed nor refused; retire an armed,
 *  changed or broken one; discard a changed one. */
export function lessonActs(row) {
  if (!isObject(row)) return [];
  const parses = isObject(row.file) && isObject(row.file.card) && row.file.fault === undefined;
  const acts = [];
  if (parses && ARMABLE.includes(row.state)) acts.push('arm');
  if (row.state === 'armed' || row.state === 'changed' || row.state === 'broken') acts.push('retire');
  if (row.state === 'changed') acts.push('discard');
  return fitting(acts, row.id);
}

/** The acts a proposal waiting allows: accept and reject it, and edit it unless it proposes a retirement. */
export const proposalActs = p => (isObject(p) ? fitting(p.what === 'retire' ? ['accept', 'reject'] : ['accept', 'reject', 'edit'], p.id) : []);

/** The act a decision row allows: void it while it is not void. */
export const decisionActs = row => (isObject(row?.view) && !decisionMarks(row.view).includes('void') ? fitting(['void'], row.view.line?.id) : []);

// an answer of the face's or the Account's taken: a 200 whose body is not a refusal
const okAt = r => r?.status === 200 && isObject(r.body) && r.body.ok !== false;

export function startMemoryActs({ store, owner, post, schedule, cancelTimer, afterDone = () => {} }) {
  let opened = 0;      // moved by open and close: an answer for an act before either changes nothing
  let asked = 0;       // moved by each ask and by words typed: an answer for an ask before changes nothing
  let timer = null;    // the quiet after the last keystroke
  let ready = null;    // the preparation go signs, with the trimmed words it was asked with
  let going = false;   // a go in the air

  const slot = () => store.get().memoryPage?.act ?? null;
  const stopTimer = () => { if (timer !== null) { cancelTimer(timer); timer = null; } };
  const mark = () => ({ opened, asked });
  const current = m => m.opened === opened && m.asked === asked;
  const refuse = (m, message) => { if (current(m)) store.dispatch('memoryActRefused', { message }); };
  // the trimmed words of the open act, '' for an act that takes none
  const wordsOf = a => (WORDED_ACTS.includes(a.act) ? String(a.words ?? '').trim() : '');

  // the face's prepare for the open act, with `words` when there are any; then, with a draft, the Account's
  async function ask(m, a, words) {
    let r;
    try { r = await post(PREPARE, words ? { act: a.act, subject: a.subject, words } : { act: a.act, subject: a.subject }); } catch { r = null; }
    if (!current(m)) return;
    if (!okAt(r) || !isObject(r.body.show)) { refuse(m, refusalOf(r).message); return; }
    store.dispatch('memoryActShown', { show: r.body.show });
    const draft = r.body.draft;
    if (!isObject(draft)) {
      // a worded act with no words yet waits for them; words typed while it was read are prepared now
      if (!WORDED_ACTS.includes(a.act)) refuse(m, refusalOf(null).message);
      else if (wordsOf(slot() ?? a)) prepareWords();
      return;
    }
    store.dispatch('memoryActPreparing');
    let p;
    try { p = await owner.prepare(draft); } catch { p = null; }
    if (!current(m)) return;
    if (!okAt(p) || !Array.isArray(p.body.shown)) { refuse(m, refusalOf(p).message); return; }
    ready = { words, prepared: p.body };
    store.dispatch('memoryActPrepared', { prepared: p.body });
  }

  // the open act's words, trimmed, asked once they are not empty
  function prepareWords() {
    timer = null;
    const a = slot();
    if (!a || !WORDED_ACTS.includes(a.act)) return;
    const words = wordsOf(a);
    if (!words) return;
    asked += 1;
    ready = null;
    store.dispatch('memoryActPreparing');
    void ask(mark(), a, words);
  }

  return {
    /** Open an act on a subject: only an act of the screen's list on a subject of that act's shape. */
    open(act, subject) {
      if (!actFits(act, subject)) return;
      opened += 1;
      asked += 1;
      stopTimer();
      ready = null;
      going = false;
      store.dispatch('memoryActOpen', { act, subject });
      const a = slot();
      if (a) void ask(mark(), a, '');
    },
    /** The owner's words as typed: kept as they are, prepared ACT_QUIET_MS after the last keystroke; nothing while it signs. */
    words(text) {
      const a = slot();
      if (!a || !WORDED_ACTS.includes(a.act) || a.status === 'signing' || a.status === 'done') return;
      const reading = a.status === 'reading';
      store.dispatch('memoryActWords', { words: String(text ?? '') });
      ready = null;
      stopTimer();
      // the first read still out: it prepares them when it lands
      if (reading) return;
      asked += 1;
      timer = schedule(prepareWords, ACT_QUIET_MS);
    },
    /** Sign what is prepared and post the act: once, and only while it is ready. */
    async go() {
      const a = slot();
      if (going || !a || a.status !== 'ready' || !ready) return;
      going = true;
      const m = mark();
      const { words, prepared } = ready;
      store.dispatch('memoryActSigning');
      try {
        let signed;
        try { signed = await owner.sign(prepared); } catch { signed = null; }
        if (!current(m)) return;
        if (!signed?.ok) { refuse(m, signed?.said ?? refusalOf(null).message); return; }
        let r;
        try { r = await post(ACT, { act: a.act, subject: a.subject, ...(WORDED_ACTS.includes(a.act) ? { words } : {}), envelope: signed.envelope }); } catch { r = null; }
        if (!current(m)) return;
        if (okAt(r) && r.body.ok === true) {
          ready = null;
          store.dispatch('memoryActDone', { done: r.body });
          afterDone(a.act);
          return;
        }
        const why = refusalOf(r);
        refuse(m, why.message);
        if (r?.body?.error === CHANGED) afterDone(a.act);
        // the door did not take the signature (the device may be dropped): the page learns its standing again, as the owner
        // device's submit does, after the refusal is drawn and outside the drawer's flow
        if (why.standing && store.get().owner?.role === 'signs') void Promise.resolve(owner.ready?.()).catch(() => {});
      } finally {
        if (current(m)) going = false;
      }
    },
    /** Close the act: its slot emptied, and nothing in the air changes anything after. */
    close() {
      opened += 1;
      asked += 1;
      stopTimer();
      ready = null;
      going = false;
      if (slot()) store.dispatch('memoryActClose');
    },
  };
}
