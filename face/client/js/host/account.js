// face/client/js/host/account.js — the Account screen's impure half (spec 2026-10-22 §6.2): the Account's reads through the
// face's proxy into the store's account slice — the page (/data/account), holdings?cost=1 and its paper lens, the leading
// history curve, the statement and the agents — and the connect sheet's reads (where this account can connect, the kept paper
// books, a key file's check, a venue's reach), each kind one flight at a time; the page at the Account's own cadence (every
// 20 s on screen, 80 s while the stream is open); and the stream's account events as the reads they name, past the face's
// cache; and Guard (plan 4a Task 5) and Close to agents (plan 4b Task 4), the Account's unsigned switches, posted through the
// face's proxy; and a venue's own sign-in for the connect sheet, its tab and its status poll; and Account › Identity's read (plan
// B1b), at the page's cadence while that tab is on screen. The views over what lands are account-view.js's and identity-view.js's.
import { pageOk, worthOf, venuesOf } from './account-view.js';
import { refusedAt } from './owner-view.js';
import { said, isSaid } from '../i18n/words.js';

export const ACCOUNT_POLL_MS = 20_000, ACCOUNT_POLL_STREAM_MS = 80_000;
/** A venue's sign-in is asked how it stands this often, for at most this long (the Account's connect.js). */
export const SIGNIN_POLL_MS = 1_500, SIGNIN_WITHIN_MS = 15 * 60_000;

// the stream's events that move money, an order or a position: the holdings and the page are read again
const MOVES = new Set(['order', 'fill', 'paper', 'balance', 'position']);

// the Account's sentence when it refuses (`refusal.message`), else its error words — only when they are text
// a said (the face's words in a refusal body, postVia's no-answer among them) passes as it is
const words = v => (isSaid(v) ? v : typeof v === 'string' && v.trim() !== '' ? v : null);
// a query value as given, or nothing
const str = v => (typeof v === 'string' ? v.trim() : '');
const messageOf = body => words(body?.refusal?.message) ?? words(body?.error);
// a page the face recognises that names a paper venue, whose lens (holdings?cost=1&paper=1) is worth reading: the venues of a
// page it does not recognise lead no read, as they choose no curve (worthOf reads no such page either)
const hasPaper = page => pageOk(page) && page.venues.some(v => v?.paper === true);
// a read past the face's cache: the face's own flag, never forwarded
const freshOf = path => `${path}${path.includes('?') ? '&' : '?'}fresh=1`;
const nothing = () => {};
const GUARD = '/data/account/guard';
const guardSaid = () => said('account.guard.said');
const noAnswer = () => said('account.noAnswer');
const receiveElsewhere = () => said('money.receive.elsewhere');
// no door handed in: nothing answers
const noDoor = async () => ({ status: 0, body: { ok: false, error: noAnswer() } });

// a venue's sign-in page, as the Account answers it: a web address, nothing else
const webUrl = v => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : '');
// who a sign-in option signs in at (sheet-view.js whoOf)
const whoOf = option => (typeof option?.label === 'string' ? option.label.split(' · ')[0] : '') || str(option?.kind);
const noTab = () => null;

export function startAccount({ store, getJson, post = noDoor, now = Date.now, schedule, cancelTimer, streamOpen = () => false, onPage = nothing, openTab = noTab }) {
  let closed = false;
  let timer = null;
  let holdingsDue = 0;       // loadAll calls whose holdings read is still to come: a page landing leaves the paper lens to them
  const kinds = new Map();   // a kind of read → the flight in the air: { flight, path, fresh, seq }

  // One flight per kind, the face's proxy's own rule: a plain ask joins the flight in the air when it is the same read, and a
  // fresh ask (past the face's cache) joins only a fresh one; otherwise a fresh ask behind a plain read of the same path runs
  // once that one settles — one trailing read, never a pile. Only the latest-started read of a kind lands, so the answer to a
  // read a fresh ask overtook is never drawn, and nothing is read or lands after close(). `land(body, refused)` takes the
  // answer, or for a rejection the body the app's getJson carries on it (`error.body`, when it does).
  function fly(kind, path, { fresh = false, loading, asking, land }) {
    if (closed) return Promise.resolve();
    let k = kinds.get(kind);
    if (!k) { k = { flight: null, path: null, fresh: false, seq: 0 }; kinds.set(kind, k); }
    const same = k.flight !== null && k.path === path;
    if (same && (!fresh || k.fresh)) return k.flight;
    const mine = ++k.seq;
    store.dispatch(loading, asking);
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
   *  body or a rejection without one is a failure carrying the Account's sentence when it gave one; the last page stays. An
   *  unrecognised page leads no read. A recognised page naming a paper venue reads the holdings at once — unless a loadAll is
   *  about to — and the leading curve after them (the lens may have made Paper the lead) when the lens was never read, or
   *  when the page before it was one the face did not recognise: under that page no lens was read, whatever moved the money,
   *  and any curve read was chosen without the page. After such a page the holdings are read past the face's cache, which
   *  may still keep the lens from before it. Every page that lands, recognised or not, is handed to `onPage` after the slice
   *  has it (the owner device reads its standing off it). */
  function load({ fresh = false } = {}) {
    return fly('page', '/data/account', {
      fresh,
      loading: 'accountLoading',
      land: (body, refused) => {
        if (!refused && body && body.ok !== false) {
          const held = store.get().account.data;
          const afterUnread = held != null && !pageOk(held);
          store.dispatch('accountLoaded', { data: body, at: now() });
          // a fresh page may name an account connected again, or another key: the Receive addresses read before it are not drawn
          if (fresh) store.dispatch('receiveClear');
          if (holdingsDue === 0 && hasPaper(body) && (afterUnread || store.get().account.paper.data === null)) {
            void loadHoldings({ fresh: afterUnread }).then(() => loadHistory());
          }
          onPage(body);
        } else store.dispatch('accountFailed', { at: now(), message: messageOf(body) });
      },
    });
  }

  /** holdings?cost=1 and, while the page — one the face recognises — names a paper venue, its paper lens beside it, in
   *  parallel; `fresh` past the face's cache (`&fresh=1`), as the stream's events ask, and the page landing after one the
   *  face did not recognise. */
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

  /** Account › Identity (plan B1b Task 1): the account's identity read (`/data/account/identity`) into `state.identity` — on
   *  entering the tab, at the page's cadence while it is on screen, and past the face's cache (`fresh`) after an identity sheet is
   *  done, the proxy's short cache not being cleared by a write. Any 2xx answer that is not a refusal lands (one the face does not
   *  recognise too, so the tab says it is unreadable); anything else is the account not answering, in its words when it gave some,
   *  and keeps no connection drawn. */
  const loadIdentity = ({ fresh = false } = {}) => fly('identity', '/data/account/identity', {
    fresh,
    loading: 'identityLoading',
    land: (body, refused) => {
      if (!refused && body && body.ok !== false) store.dispatch('identityLoaded', body);
      else store.dispatch('identityFailed', messageOf(body));
    },
  });
  const identityShown = () => { const r = store.get().route; return r?.screen === 'account' && r.tab === 'identity'; };

  // ── the connect sheet's reads (plan 2 Task 8); none goes past the face's cache, as the proxy lists no fresh for them ──

  /** Where this account can connect (`/data/account/venues`): every venue it knows with its verdict, judged from the network
   *  the Account runs on. A cold read can take the Account ~25 s; the proxy keeps the answer a minute. */
  const loadVenuesHere = () =>
    fly('venuesHere', '/data/account/venues', { loading: 'venuesHereLoading', land: landing('venuesHereLoaded', 'venuesHereFailed') });

  /** The paper books kept on the Account's disk and not connected (`/data/account/paper/books`). */
  const loadPaperBooks = () =>
    fly('paperBooks', '/data/account/paper/books', { loading: 'paperBooksLoading', land: landing('paperBooksLoaded', 'paperBooksFailed') });

  /** A key file's check (`/data/account/keyfile`): whether the file for a connector kind and a venue is there and has the
   *  fields the kind needs — field names only, never a value. Only what is given is asked (a blank path is the Account's
   *  default for the venue; `exchange` names an exchange account's exchange); what was asked lands in the slice as the
   *  check starts, and only the latest check lands. */
  function checkKeyfile({ kind, venue, ref, exchange } = {}) {
    const asked = { kind: str(kind), venue: str(venue), ref: str(ref), exchange: str(exchange) };
    const query = new URLSearchParams(Object.entries(asked).filter(([, v]) => v !== '')).toString();
    return fly('keyfile', `/data/account/keyfile${query ? `?${query}` : ''}`, {
      loading: 'keyfileLoading', asking: asked, land: landing('keyfileLoaded', 'keyfileFailed'),
    });
  }

  /** Whether a venue answers from where the Account runs (`/data/account/connect/reach?connector=`), before a key is made:
   *  one connector, or several comma-joined. */
  const reach = connector =>
    fly('reach', `/data/account/connect/reach?connector=${encodeURIComponent(str(connector))}`, { loading: 'reachLoading', land: landing('reachLoaded', 'reachFailed') });

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
    if (identityShown()) void loadIdentity();
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

  /** Guard: one POST to the face's proxy (`/data/account/guard`, `{}` — the proxy sends the Account its fixed `{"mode":"guard"}`),
   *  never signed: tightening is the Account's safer direction. One in the air at a time — a second press while it is joins
   *  it. Said done only when the Account took it (a 2xx its own refused test passes); a refusal is the Account's words (`refusal.message`,
   *  else `error`, else no answer). Then the page is read past the face's cache, so the mode drawn is the page's. `post` is the
   *  owner door's (host/owner.js postVia: `{ status, body }`, never throwing). Resolves `{ taken, message }` — the Account's words
   *  when it did not take it — for a caller that waits on it (the sign-out's Guard first, plan 4b Task 6). */
  let guarding = null;
  function guard() {
    if (closed) return Promise.resolve({ taken: false, message: noAnswer() });
    if (guarding) return guarding;
    store.dispatch('guardAsking');
    const current = (async () => {
      let r;
      try { r = await post(GUARD, {}); } catch { r = { status: 0, body: {} }; }
      if (closed) return { taken: false, message: noAnswer() };
      // taken only on a 2xx its refused test does not call refused (the owner device's own `taken`)
      const taken = r?.status >= 200 && r.status < 300 && !refusedAt(r);
      const message = taken ? null : messageOf(r?.body) ?? noAnswer();
      if (taken) store.dispatch('guardSaid', guardSaid()); else store.dispatch('guardRefused', message);
      await load({ fresh: true });
      return { taken, message };
    })().finally(() => { if (guarding === current) guarding = null; });
    guarding = current;
    return current;
  }

  // ── the Money tab (plan 4b Task 2) ──

  /** A Receive row's address (`/data/account/receive?venue=&asset=&network=`), the Account's answer landing under the row's key
   *  (`<venue>|<asset>|<network>`) in `account.receive` — the address, its memo, whose it is and the Account's note, or its
   *  refusal in its words. One read per key: a second press while one is in the air joins it. */
  function receive({ venue, asset, network } = {}) {
    const q = { venue: str(venue), asset: str(asset), network: str(network) };
    if (!q.venue || !q.asset || !q.network) return Promise.resolve();
    const key = `${q.venue}|${q.asset}|${q.network}`;
    return fly(`receive:${key}`, `/data/account/receive?${new URLSearchParams(q).toString()}`, {
      loading: 'receiveLoading', asking: key,
      land: (body, refused) => {
        // the answer names the account, asset and network it is for (service.ts receive): one for another is never drawn here
        const named = (k, v) => typeof body?.[k] !== 'string' || body[k].toLowerCase() === v.toLowerCase();
        if (!refused && body?.ok === true && !(named('venue', q.venue) && named('asset', q.asset) && named('network', q.network))) {
          store.dispatch('receiveFailed', { key, at: now(), message: receiveElsewhere() });
        } else if (!refused && body?.ok === true && typeof body.address === 'string' && body.address !== '') store.dispatch('receiveLoaded', { key, data: body, at: now() });
        else store.dispatch('receiveFailed', { key, at: now(), message: messageOf(body) });
      },
    });
  }

  /** A bridge's routes (`POST /data/account/bridge-routes`, `{ draft }`), read after its preparation lands, beside the quote the
   *  Account signs for: the chosen one first. Only the latest ask lands in `account.routes` — `asked` the draft it was asked
   *  for, as the sheet's own `asked` reads, so the sheet draws them only beside that preparation. A failure is said, and stops
   *  nothing. `post` is the owner door's (`{ status, body }`, never throwing). */
  let routesSeq = 0;
  async function bridgeRoutes(draft) {
    if (closed || draft === null || typeof draft !== 'object') return;
    const mine = ++routesSeq;
    const asked = JSON.stringify(draft);
    store.dispatch('routesAsking', asked);
    let r;
    try { r = await post('/data/account/bridge-routes', { draft }); } catch { r = { status: 0, body: {} }; }
    if (closed || mine !== routesSeq) return;
    if (r?.status >= 200 && r.status < 300 && !refusedAt(r) && Array.isArray(r.body?.routes)) store.dispatch('routesLanded', { asked, data: r.body });
    else store.dispatch('routesFailed', { asked, message: messageOf(r?.body) });
  }

  /** Earn (plan 4b Task 3): the products the connected venues offer and what is in them (`/data/account/earn`), into
   *  `account.earn` — read on entering Money and, past the face's cache, after every taken earn. A refusal keeps the last answer
   *  and carries the Account's words. */
  const loadEarn = ({ fresh = false } = {}) =>
    fly('earn', '/data/account/earn', { fresh, loading: 'earnLoading', land: landing('earnLoaded', 'earnFailed') });

  // ── Venues (plan 4b Task 4) ──

  /** Close to agents: one POST to the face's proxy (`/data/account/revoke`, `{ account: venue }`), never signed — agents keep
   *  their reads and place or move nothing there, the Account's safer direction (portfolio.js pfAgentsSwitch). One in the air
   *  per venue: a second press while it is joins it. Said in the Account's own sentence when the Account took it, else the
   *  Account's words; then the page is read past the face's cache, so the row drawn is the page's. */
  const closing = new Map();
  function revoke(venue) {
    const id = str(venue);
    if (closed || !id) return Promise.resolve();
    if (closing.has(id)) return closing.get(id);
    store.dispatch('closing', { venue: id, status: 'asking' });
    const current = (async () => {
      let r;
      try { r = await post('/data/account/revoke', { account: id }); } catch { r = { status: 0, body: {} }; }
      if (closed) return;
      if (!(r?.status >= 200 && r.status < 300) || refusedAt(r)) store.dispatch('closing', { venue: id, status: 'refused', message: messageOf(r?.body) ?? noAnswer() });
      else {
        const name = venuesOf(store.get().account.data).find(v => v.id === id)?.name || id;
        store.dispatch('closing', { venue: id, status: 'said', said: said('venues.closed', { name }) });
      }
      await load({ fresh: true });
    })().finally(() => { if (closing.get(id) === current) closing.delete(id); });
    closing.set(id, current);
    return current;
  }

  /** A venue's own sign-in (OAuth) for the connect sheet's sign-in option, as the Account's connect.js runs it: a tab opened at
   *  once — inside the operator's press, so no popup blocker stops it — its opener cleared; `POST /data/account/signin/start`
   *  `{ connector: option.kind }`; the tab sent to the venue's page the answer names (no tab: the slice keeps the address, and
   *  the sheet draws the link); then `/data/account/signin/status?state=` every SIGNIN_POLL_MS for at most SIGNIN_WITHIN_MS,
   *  only while `alive()` (the sheet it was started from, on this option) — `ready` lands the state through `onReady(state)`,
   *  `failed` the Account's words; an answer the face re-served as stale, an `unknown`, or no answer is not the final status:
   *  the poll goes on. A second start supersedes the first's poll, and clears the state a first one kept in the sheet's hidden
   *  `credentialRef` before it asks. */
  let signInSeq = 0;
  let signInTimer = null;
  function stopSignIn() { if (signInTimer !== null) { cancelTimer(signInTimer); signInTimer = null; } }
  async function signIn(option, { alive = () => true, onReady = nothing } = {}) {
    if (closed || !option || typeof option.connector !== 'string') return;
    const mine = ++signInSeq;
    stopSignIn();
    let tab = null;
    try { tab = openTab('about:blank', '_blank') ?? null; } catch { tab = null; }
    try { if (tab) tab.opener = null; } catch { /* a tab that will not say */ }
    const connector = option.connector;
    // and while the slice still names this sign-in: a sheet opened or closed, or the connector changed, forgets it (reducers/owner.js)
    const live = () => !closed && mine === signInSeq && alive() && store.get().account.signIn?.connector === connector;
    store.dispatch('signIn', { status: 'starting', connector, url: '', tab: tab !== null, state: '', message: null });
    // a state an earlier sign-in kept in the sheet's hidden field is not this one's: cleared before the Account is asked
    if (alive()) store.dispatch('sheetField', { name: 'credentialRef', value: '' });
    let r;
    try { r = await post('/data/account/signin/start', { connector: str(option.kind) }); } catch { r = { status: 0, body: {} }; }
    const url = webUrl(r?.body?.url), state = str(r?.body?.state);
    if (!live()) { try { tab?.close?.(); } catch { /* gone already */ } return; }
    if (!(r?.status >= 200 && r.status < 300) || refusedAt(r) || !url || !state) {
      try { tab?.close?.(); } catch { /* gone already */ }
      store.dispatch('signIn', { status: 'failed', message: messageOf(r?.body) ?? said('venues.signIn.noStart') });
      return;
    }
    let sent = false;
    try { if (tab) { tab.location.href = url; sent = true; } } catch { sent = false; }
    store.dispatch('signIn', { status: 'waiting', url, tab: sent, state });
    const until = now() + SIGNIN_WITHIN_MS;
    const ask = async () => {
      signInTimer = null;
      if (!live()) return;
      let st = null;
      try { st = await getJson(`/data/account/signin/status?state=${encodeURIComponent(state)}`); } catch { st = null; }
      if (!live()) return;
      // a status the face re-served from before (`stale`) says nothing of now: unknown, as no answer is
      const known = st?.ok === true && st.stale !== true ? st.status : 'unknown';
      if (known === 'ready') {
        store.dispatch('signIn', { status: 'ready', message: null });
        onReady(state);
        return;
      }
      if (known === 'failed') { store.dispatch('signIn', { status: 'failed', message: words(st.error) ?? said('venues.signIn.unfinished') }); return; }
      if (now() >= until) { store.dispatch('signIn', { status: 'expired' }); return; }
      signInTimer = schedule(() => { void ask(); }, SIGNIN_POLL_MS);
    };
    await ask();
  }

  function close() {
    closed = true;
    poll(false);
    stopSignIn();
  }

  return { load, loadIdentity, guard, revoke, signIn, receive, bridgeRoutes, loadEarn, loadHoldings, loadHistory, loadStatement, loadAgents, loadAll, loadVenuesHere, loadPaperBooks, checkKeyfile, reach, poll, onStreamEvent, close };
}
