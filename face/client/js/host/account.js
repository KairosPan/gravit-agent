// face/client/js/host/account.js — the Account screen's impure half (spec 2026-10-22 §6.2): the Account's reads through the
// face's proxy into the store's account slice — the page (/data/account), holdings?cost=1 and its paper lens, the leading
// history curve, the statement and the agents — each kind one flight at a time; the page at the Account's own cadence (every
// 20 s on screen, 80 s while the stream is open); and the stream's account events as the reads they name, past the face's
// cache. The views over what lands are account-view.js's.
import { pageOk, worthOf } from './account-view.js';

export const ACCOUNT_POLL_MS = 20_000, ACCOUNT_POLL_STREAM_MS = 80_000;

// the stream's events that move money, an order or a position: the holdings and the page are read again
const MOVES = new Set(['order', 'fill', 'paper', 'balance', 'position']);

// the Account's sentence when it refuses (`refusal.message`), else its error words — only when they are text
const words = v => (typeof v === 'string' && v.trim() !== '' ? v : null);
const messageOf = body => words(body?.refusal?.message) ?? words(body?.error);
// a page the face recognises that names a paper venue, whose lens (holdings?cost=1&paper=1) is worth reading: the venues of a
// page it does not recognise lead no read, as they choose no curve (worthOf reads no such page either)
const hasPaper = page => pageOk(page) && page.venues.some(v => v?.paper === true);
// a read past the face's cache: the face's own flag, never forwarded
const freshOf = path => `${path}${path.includes('?') ? '&' : '?'}fresh=1`;
const nothing = () => {};

export function startAccount({ store, getJson, now = Date.now, schedule, cancelTimer, streamOpen = () => false }) {
  let closed = false;
  let timer = null;
  let holdingsDue = 0;       // loadAll calls whose holdings read is still to come: a page landing leaves the paper lens to them
  const kinds = new Map();   // a kind of read → the flight in the air: { flight, path, fresh, seq }

  // One flight per kind, the face's proxy's own rule: a plain ask joins the flight in the air when it is the same read, and a
  // fresh ask (past the face's cache) joins only a fresh one; otherwise a fresh ask behind a plain read of the same path runs
  // once that one settles — one trailing read, never a pile. Only the latest-started read of a kind lands, so the answer to a
  // read a fresh ask overtook is never drawn, and nothing is read or lands after close(). `land(body, refused)` takes the
  // answer, or for a rejection the body the app's getJson carries on it (`error.body`, when it does).
  function fly(kind, path, { fresh = false, loading, land }) {
    if (closed) return Promise.resolve();
    let k = kinds.get(kind);
    if (!k) { k = { flight: null, path: null, fresh: false, seq: 0 }; kinds.set(kind, k); }
    const same = k.flight !== null && k.path === path;
    if (same && (!fresh || k.fresh)) return k.flight;
    const mine = ++k.seq;
    store.dispatch(loading);
    // the read starts on a later microtask, so the flight is set before anything can settle it
    const ahead = same ? k.flight.then(nothing, nothing) : Promise.resolve();
    const current = ahead
      .then(() => (closed ? undefined : getJson(fresh ? freshOf(path) : path)))
      .then(body => { if (!closed && mine === k.seq) land(body, false); },
        error => { if (!closed && mine === k.seq) land(error?.body, true); })
      .finally(() => { if (k.flight === current) { k.flight = null; k.path = null; k.fresh = false; } });
    k.flight = current;
    k.path = path;
    k.fresh = fresh;
    return current;
  }

  // a read beside the page: an answer (`ok: true`) lands as its data; anything else is a failure that keeps the last data,
  // carrying the Account's sentence when it gave one
  const landing = (loaded, failed) => (body, refused) => {
    if (!refused && body?.ok === true) store.dispatch(loaded, { data: body, at: now() });
    else store.dispatch(failed, { at: now(), message: messageOf(body) });
  };

  /** The page, `?fresh=1` past the face's cache. Any 2xx answer that is not a refusal lands as the page — one the face does not
   *  recognise (`pageOk` refuses it: the Account moved its API) too, so the screen says `Account unreadable` and draws no
   *  figure from it, rather than an outage. A refusal (an `ok: false` body, on a 200 or not), any other non-2xx, an empty 2xx
   *  body or a rejection without one is a failure carrying the Account's sentence when it gave one; the last page stays. A
   *  recognised page naming a paper venue whose lens was never read reads the holdings at once, unless a loadAll is about
   *  to, and the leading curve after them (the lens may have made Paper the lead); an unrecognised page leads no read. */
  function load({ fresh = false } = {}) {
    return fly('page', '/data/account', {
      fresh,
      loading: 'accountLoading',
      land: (body, refused) => {
        if (!refused && body && body.ok !== false) {
          store.dispatch('accountLoaded', { data: body, at: now() });
          if (holdingsDue === 0 && hasPaper(body) && store.get().account.paper.data === null) void loadHoldings().then(() => loadHistory());
        } else store.dispatch('accountFailed', { at: now(), message: messageOf(body) });
      },
    });
  }

  /** holdings?cost=1 and, while the page — one the face recognises — names a paper venue, its paper lens beside it, in
   *  parallel; `fresh` past the face's cache (`&fresh=1`), as the stream's events ask. */
  function loadHoldings({ fresh = false } = {}) {
    return Promise.all([
      fly('holdings', '/data/account/holdings?cost=1', { fresh, loading: 'holdingsLoading', land: landing('holdingsLoaded', 'holdingsFailed') }),
      hasPaper(store.get().account.data)
        ? fly('paper', '/data/account/holdings?cost=1&paper=1', { fresh, loading: 'paperLoading', land: landing('paperLoaded', 'paperFailed') })
        : null,
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

  /** The statement; `fresh` past the face's cache, as the stream's statement event asks. */
  const loadStatement = ({ fresh = false } = {}) =>
    fly('statement', '/data/account/statement', { fresh, loading: 'statementLoading', land: landing('statementLoaded', 'statementFailed') });
  const loadAgents = () => fly('agents', '/data/account/agents', { loading: 'agentsLoading', land: landing('agentsLoaded', 'agentsFailed') });

  /** Every read again (the stream's snapshot), the page, the holdings and the statement past the face's cache. The paper
   *  lens is chosen from the page and the leading curve from the paper total, so the holdings follow the page and the
   *  history follows the holdings; the statement and the agents go at once. */
  function loadAll() {
    holdingsDue += 1;
    const holdings = () => { holdingsDue -= 1; return loadHoldings({ fresh: true }); };
    return Promise.all([
      load({ fresh: true }).then(holdings, holdings).then(() => loadHistory()),
      loadStatement({ fresh: true }),
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

  /** A stream event ({ type, id, data }) as the reads it names, past the face's cache: a plain read in the air never
   *  answers it, and a burst joins the fresh reads in the air. */
  function onStreamEvent(ev) {
    const type = ev?.type;
    if (MOVES.has(type)) { void loadHoldings({ fresh: true }); void load({ fresh: true }); }
    else if (type === 'statement') void loadStatement({ fresh: true });
    else if (type === 'card') void load({ fresh: true });
    else if (type === 'snapshot') void loadAll();
  }

  function close() {
    closed = true;
    poll(false);
  }

  return { load, loadHoldings, loadHistory, loadStatement, loadAgents, loadAll, poll, onStreamEvent, close };
}
