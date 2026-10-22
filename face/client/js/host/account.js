// face/client/js/host/account.js — the Account screen's impure half (spec 2026-10-22 §6.2): the Account's reads through the
// face's proxy into the store's account slice — the page (/data/account), holdings?cost=1 and its paper lens, the leading
// history curve, the statement and the agents — each kind one flight at a time; the page at the Account's own cadence (every
// 20 s on screen, 80 s while the stream is open); and the stream's account events as the reads they name. The views over
// what lands are account-view.js's.
import { pageOk, worthOf } from './account-view.js';

export const ACCOUNT_POLL_MS = 20_000, ACCOUNT_POLL_STREAM_MS = 80_000;

// the stream's events that move money, an order or a position: the holdings and the page are read again
const MOVES = new Set(['order', 'fill', 'paper', 'balance', 'position']);

// the Account's sentence when it refuses (`refusal.message`), else its error words — only when they are text
const words = v => (typeof v === 'string' && v.trim() !== '' ? v : null);
const messageOf = body => words(body?.refusal?.message) ?? words(body?.error);

export function startAccount({ store, getJson, now = Date.now, schedule, cancelTimer, streamOpen = () => false }) {
  let closed = false;
  let timer = null;
  const kinds = new Map();   // a kind of read → the flight in the air: { flight, path, fresh, seq }

  // One flight per kind: an ask joins the flight in the air when that flight reads the same path, and a plain ask joins a
  // fresh one too (fresh: past the face's cache, `?fresh=1`); only the latest-started read of a kind lands — a fresh one
  // must not be overwritten by an older plain one — and nothing lands after close(). `land(body, refused)` takes the
  // answer, or for a rejection the body the app's getJson carries on it (`error.body`, when it does).
  function fly(kind, path, { fresh = false, loading, land }) {
    if (closed) return Promise.resolve();
    let k = kinds.get(kind);
    if (!k) { k = { flight: null, path: null, fresh: false, seq: 0 }; kinds.set(kind, k); }
    if (k.flight && (k.path === path || (k.fresh && !fresh))) return k.flight;
    const mine = ++k.seq;
    store.dispatch(loading);
    // the read starts on the next microtask, so the flight is set before anything can settle it
    const current = Promise.resolve()
      .then(() => getJson(path))
      .then(body => { if (!closed && mine === k.seq) land(body, false); },
        error => { if (!closed && mine === k.seq) land(error?.body, true); })
      .finally(() => { if (k.flight === current) { k.flight = null; k.path = null; k.fresh = false; } });
    k.flight = current;
    k.path = path;
    k.fresh = fresh;
    return current;
  }

  // a read beside the page: an answer (`ok: true`) lands as its data; anything else is a failure that keeps the last data
  const landing = (loaded, failed) => (body, refused) => {
    if (!refused && body?.ok === true) store.dispatch(loaded, { data: body, at: now() });
    else store.dispatch(failed, { at: now() });
  };

  /** The page, `?fresh=1` past the face's cache. A body that is not the page — a refusal, an `ok: false` on a 200, an API the
   *  face does not recognise — is a failure carrying the Account's sentence when it gave one; the last page stays. */
  function load({ fresh = false } = {}) {
    return fly('page', fresh ? '/data/account?fresh=1' : '/data/account', {
      fresh,
      loading: 'accountLoading',
      land: (body, refused) => {
        if (!refused && pageOk(body)) store.dispatch('accountLoaded', { data: body, at: now() });
        else store.dispatch('accountFailed', { at: now(), message: messageOf(body) });
      },
    });
  }

  /** holdings?cost=1 and, while the page names a paper venue, its paper lens beside it, in parallel. */
  function loadHoldings() {
    const venues = store.get().account.data?.venues;
    const paper = Array.isArray(venues) && venues.some(v => v?.paper === true);
    return Promise.all([
      fly('holdings', '/data/account/holdings?cost=1', { loading: 'holdingsLoading', land: landing('holdingsLoaded', 'holdingsFailed') }),
      paper ? fly('paper', '/data/account/holdings?cost=1&paper=1', { loading: 'paperLoading', land: landing('paperLoaded', 'paperFailed') }) : null,
    ]);
  }

  /** The curve for the range (the slice's when none is given, or one it does not know): Paper's (`&paper=1`) when Paper
   *  leads as worthOf reads the page and the two holdings reads at the call, else real money's — one read, the leading
   *  one. A read for a range the screen has left when it lands is dropped. */
  function loadHistory(range) {
    if (closed) return Promise.resolve();
    if (range !== undefined) store.dispatch('setHistoryRange', range);
    const a = store.get().account;
    const r = a.history.range;
    const paper = worthOf(a.data, a.holdings.data, a.paper.data).paperLeads;
    const land = landing('historyLoaded', 'historyFailed');
    return fly('history', `/data/account/history?range=${encodeURIComponent(r)}${paper ? '&paper=1' : ''}`, {
      loading: 'historyLoading',
      land: (body, refused) => { if (store.get().account.history.range === r) land(body, refused); },
    });
  }

  const loadStatement = () => fly('statement', '/data/account/statement', { loading: 'statementLoading', land: landing('statementLoaded', 'statementFailed') });
  const loadAgents = () => fly('agents', '/data/account/agents', { loading: 'agentsLoading', land: landing('agentsLoaded', 'agentsFailed') });

  /** Every read again (the stream's snapshot). The paper lens is chosen from the page and the leading curve from the paper
   *  total, so the holdings follow the page and the history follows the holdings; the statement and the agents go at once. */
  function loadAll() {
    return Promise.all([
      load({ fresh: true }).then(() => loadHoldings()).then(() => loadHistory()),
      loadStatement(),
      loadAgents(),
    ]);
  }

  // the page every ACCOUNT_POLL_MS, ACCOUNT_POLL_STREAM_MS while the stream is open: decided as each interval is scheduled
  function arm() { timer = schedule(beat, streamOpen() ? ACCOUNT_POLL_STREAM_MS : ACCOUNT_POLL_MS); }
  function beat() {
    timer = null;
    if (closed) return;
    void load();
    arm();
  }
  function poll(on) {
    if (on && !closed) { if (timer === null) arm(); return; }
    if (timer !== null) { cancelTimer(timer); timer = null; }
  }

  /** A stream event ({ type, id, data }) as the reads it names; a burst joins the reads in the air. */
  function onStreamEvent(ev) {
    const type = ev?.type;
    if (MOVES.has(type)) { void loadHoldings(); void load({ fresh: true }); }
    else if (type === 'statement') void loadStatement();
    else if (type === 'card') void load({ fresh: true });
    else if (type === 'snapshot') void loadAll();
  }

  function close() {
    closed = true;
    poll(false);
  }

  return { load, loadHoldings, loadHistory, loadStatement, loadAgents, loadAll, poll, onStreamEvent, close };
}
