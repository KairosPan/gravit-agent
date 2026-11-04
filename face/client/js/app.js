// face/client/js/app.js — the client's boot on the face (spec 2026-10-19 §5): the store, the host layer, the renderers,
// and the page's own bookkeeping (what was typed, where the thread stood, who had focus) across every render.
import { createStore } from './store.js';
import { reducers } from './reducers/index.js';
import { emptyState } from './data/empty.js';
import { parseHash, toHash } from './router.js';
import { renderRail } from './render/rail.js';
import { renderMessagesScreen, currentConversation } from './render/messages.js';
import { renderMarketsScreen } from './render/markets.js';
import { renderSettings, renderAccountScreen, renderSellMany } from './render/account.js';
import { renderSheet } from './render/owner.js';
import { renderTradeScreen } from './render/trade.js';
import { setMarkdown } from './render/markdown.js';
import { renderMarkdown } from './wire/markdown.js';
import { call as wireCall, openMux as wireOpenMux } from './wire/api.js';
import { mapFrame } from './wire/mapper.js';
import { startLive } from './host/live.js';
import { makeActions } from './host/actions.js';
import { startMarkets } from './host/markets.js';
import { startDesk } from './host/desk.js';
import { startAccount } from './host/account.js';
import { startSeat } from './host/seat.js';
import { startChannels } from './host/channels.js';
import { renderChannelScreen } from './render/channel.js';
import { startDiscover } from './host/discover.js';
import { renderDiscover, renderPlugin } from './render/discover.js';
import { startModules } from './host/modules.js';
import { renderModule } from './render/modules.js';
import { startRunSheet } from './host/run-sheet.js';
import { renderRunSheet } from './render/run-sheet.js';
import { itemById } from './host/discover-view.js';
import { startTraces } from './host/traces.js';
import { wantedViews, ensureViews, minuteAt, applyCursor, cursorFor, reapplyCursors, marketKey, stockCode } from './host/lunhui.js';
import { stockDrawerHtml, askText } from './render/lunhui/stock.js';
import { loadMemberTrace } from './wire/member-traces.js';
import { isHostPreset } from './wire/speaker.js';
import { statementLinesOf, statementCsvOf, connectOptionsOf, asksOf, pageOk, writesOn, venuesOf } from './host/account-view.js';
import { rulesOf } from './host/rules-view.js';
import { isAccountKey, handWordsOf, watchedOf } from './host/market-view.js';
import { isCnKey } from './wire/china.js';
import { startOwner, postVia } from './host/owner.js';
import { startSheet, PREPARE_QUIET_MS } from './host/sheet.js';
import { startIdentity } from './host/identity.js';
import { identityOf, routingOf, formatRouting } from './host/identity-view.js';
import { renderConnectDrawer } from './render/identity.js';
import { moveSeedOf, earnSeedOf, earnSaidOf, subWalletSeedOf } from './host/sheet-money.js';
import { startSellMany } from './host/sell-many.js';
import { limitSeedOf, grantOf, keyfileAskOf, reachAskOf, letDeviceSeedOf, paperSeedOf, signOutSeedOf, connectOptionOf, isWalletOption } from './host/sheet-view.js';
import { startTrade } from './host/trade.js';
import { tradeableOf } from './host/trade-view.js';
import { indexedDbKeys, memoryKeys, signedOutFlag } from './wire/key-store.js';
import { firstOpen } from './host/sessions.js';
import { createAccountStream } from './wire/account-stream.js';
import { createMarketStream } from './wire/market-stream.js';
import { discoverWallets, proveWallet } from './wire/wallet.js';
import { startWalletSend, settleWalletFlight } from './host/wallet-send.js';

export const PREFS_KEY = 'gravit-ui.prefs';
// how long a press may hold renders: a click lands well inside it, and a release that never arrives cannot freeze the page
export const POINTER_HOLD_MS = 1000;
// how long the Markets search box must be quiet before its reads go: one read for a word typed, not one a keystroke
export const SEARCH_QUIET_MS = 300;

// Gravit's words as the thread draws them: DOM-built markdown (wire/markdown.js returns {node, doc}), serialized for
// the string renderers
export const gravitMarkdown = text => renderMarkdown(text).node.outerHTML;

// a /data read: an answer is its JSON; any other status rejects with the status and, when it parses, the body the face sent —
// the Account's refusal rides on it (`error.body`), for the hosts to read its sentence from
export function getJsonVia(fetch) {
  return async path => {
    const r = await fetch(path);
    if (r.ok) return r.json();
    let body;
    try { body = await r.json(); } catch { /* not JSON: the status speaks */ }
    throw Object.assign(new Error(`${path}: HTTP ${r.status}`), { status: r.status }, body === undefined ? {} : { body });
  };
}

// a /data POST as the old page's panelData read it: a failed status or the route's own {ok:false, error} rejects,
// the route's words riding as the code the status line reads; only {ok:true, …} resolves
export function postJsonVia(fetch) {
  return async (path, body) => {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let parsed = null;
    try { parsed = await r.json(); } catch { /* not JSON: the status speaks */ }
    if (!r.ok || parsed?.ok !== true) {
      const words = typeof parsed?.error === 'string' && parsed.error !== '' ? parsed.error : `HTTP ${r.status}`;
      throw Object.assign(new Error(words), { status: r.status, code: words });
    }
    return parsed;
  };
}
const THEMES = ['cream', 'black', 'system'];

// timers that a reset can clear together
export class Timers {
  constructor() { this.pending = new Set(); }
  after(ms, fn) {
    const id = setTimeout(() => { this.pending.delete(id); fn(); }, ms);
    this.pending.add(id);
    return id;
  }
  cancel(id) {
    clearTimeout(id);
    this.pending.delete(id);
  }
  clear() {
    for (const id of this.pending) clearTimeout(id);
    this.pending.clear();
  }
}

// per-viewer conveniences only: the theme, the rail's fold, the last conversation, what was seen (the watchlist keeps
// its own key, host/markets.js)
export function readPrefs(storage) {
  try {
    const raw = storage?.getItem(PREFS_KEY);
    const p = raw ? JSON.parse(raw) : null;
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
}
export const prefsOf = s => ({ theme: s.theme, railCollapsed: s.railCollapsed, lastConv: s.lastConv, lastSeen: s.lastSeen, collapsed: s.collapsed });
export function initialState(storage, now = Date.now()) {
  const p = readPrefs(storage);
  const s = emptyState(now);
  return {
    ...s,
    theme: THEMES.includes(p.theme) ? p.theme : s.theme,
    railCollapsed: p.railCollapsed === true,
    lastConv: typeof p.lastConv === 'string' ? p.lastConv : null,
    lastSeen: p.lastSeen && typeof p.lastSeen === 'object' && !Array.isArray(p.lastSeen) ? p.lastSeen : {},
    collapsed: p.collapsed && typeof p.collapsed === 'object' && !Array.isArray(p.collapsed)
      ? Object.fromEntries(Object.entries(p.collapsed).filter(([, v]) => typeof v === 'boolean')) : {},
  };
}
// the store never loads a saved state (the host is the state); it writes the prefs on every change
export function makeStore(storage, now = Date.now()) {
  return createStore({ initial: initialState(storage, now), reducers, storage, key: PREFS_KEY, accept: () => false, persist: prefsOf });
}

// Messages (with a channel's page), Markets, Trade, Discover (with an item's page) and Account are served; every other screen
// the router knows folds to Messages
const SCREENS = new Set(['messages', 'channel', 'markets', 'trade', 'discover', 'plugin', 'module', 'account']);
export const routeOf = hash => { const r = parseHash(hash); return SCREENS.has(r.screen) ? r : { screen: 'messages', id: null }; };
// route by the address bar; a normalised route says which hash the bar should show instead
export function settle(store, hash) {
  const next = store.dispatch('nav', routeOf(hash)).route;
  const h = toHash(next);
  return h !== hash ? h : null;
}

// one question card's inputs → the batch the host wants: every question answered exactly once. The inputs are named
// q-<gate>-<question> (render/thread.js), read from that card alone and matched by name, never by a selector built
// from the model's question id
export function answersFrom(card, questions, gateId) {
  const inputs = [...(card?.querySelectorAll?.('input') ?? [])];
  const answers = (Array.isArray(questions) ? questions : []).map((q, i) => {
    const id = String(q?.id ?? i);
    const name = `q-${gateId}-${id}`;
    const selected = inputs.filter(el => el.name === name && el.checked).map(el => String(el.value));
    const custom = inputs.find(el => el.name === `${name}-custom`)?.value?.trim();
    return { id, selected, ...(custom ? { custom } : {}) };
  });
  return { answers };
}
// a batch the host may take: every question has a pick or words of its own
export const complete = batch => batch.answers.every(a => a.selected.length > 0 || !!a.custom);

// where focus was, as something a re-render can find again: the id first, else the control's data attributes — and its name
// (a sheet's fields share their action), a box's value among the boxes of one name
const quoted = v => `"${String(v).replace(/["\\]/g, '\\$&')}"`;
function focusKey(el) {
  if (!el || el.tagName === 'BODY') return null;
  if (el.id) return { id: el.id };
  const data = el.dataset ?? {};
  if (!data.action) return null;
  const named = el.name ? `[name=${quoted(el.name)}]` + (el.type === 'checkbox' || el.type === 'radio' ? `[value=${quoted(el.value)}]` : '') : '';
  const sel = `[data-action=${quoted(data.action)}]` + named + Object.entries(data).filter(([k]) => k !== 'action').map(([k, v]) => `[data-${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}=${quoted(v)}]`).join('');
  return { sel };
}
// the owner sheet is a drawer of any screen, over the one open (the order sheet is Trade's ticket, not a drawer)
const sheetUp = s => Boolean(s.sheet) && s.sheet.kind !== 'order';
// a module card's Run sheet is a drawer of any screen too, drawn after the owner sheet
const overlayOf = s => (sheetUp(s) ? 'sheet' : s.identity?.connect || s.sellMany || s.runSheet || s.lunhui?.stock || s.detailsOpen || s.settingsOpen || s.account.statementOpen || s.account.detailsVenue ? 'drawer' : null);
const drawerOf = s => (sheetUp(s) ? `sheet:${s.sheet.kind}` : s.identity?.connect ? `identity:${s.identity.connect.step}` : s.sellMany ? 'sellMany' : s.runSheet ? `run:${s.runSheet.module}` : s.lunhui?.stock ? `stock:${s.lunhui.stock.code}` : s.detailsOpen ? 'details' : s.settingsOpen ? 'settings' : s.account.statementOpen ? 'statement'
  : s.account.detailsVenue ? `venue:${s.account.detailsVenue}` : null);
const closeKeyOf = overlay => (overlay === 'sheet' ? '.drawer.sheet .close-key' : '.drawer .close-key');
const editorOf = e => (e ? [e.kind, e.convId, e.id].join('|') : null);
const screenOf = s => `${s.route.screen}/${s.route.id ?? ''}`;

export function boot(win, host = {}) {
  const doc = win.document;
  const storage = (() => { try { return win.localStorage; } catch { return null; } })();
  const store = makeStore(storage);
  const timers = host.timers ?? new Timers();
  const root = doc.getElementById('app');
  const now = host.now ?? (() => Date.now());
  const call = host.call ?? wireCall;
  const getJson = host.getJson ?? getJsonVia(path => win.fetch(path));
  const postJson = host.postJson ?? postJsonVia((path, init) => win.fetch(path, init));
  const schedule = (fn, ms) => timers.after(ms, fn);
  const cancelTimer = id => timers.cancel(id);
  // Gravit's markdown is DOM-built (wire/markdown.js); a test hands in its own or none
  if (host.markdown !== undefined) setMarkdown(host.markdown);
  else if (typeof document !== 'undefined') setMarkdown(gravitMarkdown);
  // the Account's read is polled only while Account is on screen in a visible tab
  const accountShown = () => store.get().route.screen === 'account' && !doc.hidden;
  const showAccount = () => account.poll(accountShown());
  // the Account's push channel, one for this tab (wire/account-stream.js), open while the tab is visible: an event is the reads
  // it names, a snapshot drops the prices the stream kept, a quote is the price of the market a page follows, a card raised or
  // answered the seat box's cards; the stream opening, or no longer open, arms the page's interval again (a test hands in its own)
  let streamWasOpen = false;
  const stream = (host.createAccountStream ?? ((onEvent, onStatus) => createAccountStream({
    createEventSource: url => new win.EventSource(url),
    fetcher: (path, init) => win.fetch(path, init),
    schedule, cancelTimer,
    random: n => win.crypto.getRandomValues(new Uint8Array(n)),
    onStatus,
  }, onEvent)))(ev => {
    account.onStreamEvent(ev);
    if (ev.type === 'snapshot') store.dispatch('streamSnapshot');
    if (ev.type === 'quote') store.dispatch('streamQuote', { data: ev.data });
    // a quote for the ticket's line re-prepares it once the market moved; a fill is said on Trade
    if (ev.type === 'quote' || ev.type === 'fill') trade.onStreamEvent(ev);
    if (ev.type === 'card' && ev.data?.waits === undefined) void seat.load({ fresh: true });
  }, status => {
    if ((status === 'open') === streamWasOpen) return;
    streamWasOpen = status === 'open';
    if (accountShown()) { account.poll(false); account.poll(true); }
  });
  // the market's push channel beside it (wire/market-stream.js), open while the tab is visible: the public line a market's page
  // follows; a snapshot drops the prices a stream kept, a quote is the price of the market a page follows (a test hands in its own)
  const marketStream = (host.createMarketStream ?? (onEvent => createMarketStream({
    createEventSource: url => new win.EventSource(url),
    fetcher: (path, init) => win.fetch(path, init),
    schedule, cancelTimer,
    random: n => win.crypto.getRandomValues(new Uint8Array(n)),
  }, onEvent)))(ev => {
    if (ev.type === 'snapshot') store.dispatch('streamSnapshot');
    if (ev.type === 'quote') store.dispatch('streamQuote', { data: ev.data });
  });
  // this page as an owner device of the Account (spec 2026-10-22 §6.3): its key in this browser's IndexedDB (in memory where
  // there is none), every call through the face's proxy (a test hands in its own door); the standing read off every page that
  // lands — the first one pairs it once
  // the owner door: the owner device's calls, and the Rules tab's Guard (the Account's one unsigned switch), through the face's proxy
  const ownerPost = host.ownerPost ?? postVia((path, init) => win.fetch(path, init));
  const owner = startOwner({
    store,
    post: ownerPost,
    subtle: win.crypto?.subtle ?? null,
    keys: win.indexedDB ? indexedDbKeys(win.indexedDB) : memoryKeys(),
    flag: signedOutFlag(storage),
  });
  // the Account's read: read at boot, on entering Account, on Refresh, right after a receipt and on the stream's events; every
  // 20 s while Account is on screen in a visible tab, 80 s while the stream is open; Guard posted through the owner door
  // a venue's sign-in opens its tab through the window, inside the operator's press (host/account.js signIn)
  const account = startAccount({
    store, getJson, post: ownerPost, now, schedule, cancelTimer, streamOpen: () => stream.status() === 'open', onPage: body => { void owner.standing(body); markets.accountAnswered(body); },
    openTab: (url, target) => (typeof win.open === 'function' ? win.open(url, target) : null),
  });
  void account.load();
  // the Account seat's standing (spec 2026-10-20 §6.3): read on entering Venues or Agents, on Refresh, right after a seat receipt
  // and on a card's event
  const seat = startSeat({ store, getJson, now });
  // what an owner action changed, read as the retired page read it after one: the page, the holdings and the statement
  // past the face's cache, a market page's asset sheet (plan 4a Task 4), and the seat's standing after one about an agent's key
  // or limit; a done sheet then closes itself (the order sheet's words stay on the ticket)
  const SEAT_KINDS = new Set(['letIn', 'limit', 'endLimit', 'revoke']);
  // Account › Identity's signed sheets (plan B1b Tasks 2 and 3); its disconnect is disconnectNetwork, never the Venues' disconnect
  const IDENTITY_SHEET_KINDS = new Set(['connectNetwork', 'disconnectNetwork', 'routing', 'block']);
  function afterAction(kind, body) {
    // what the Account built for the operator's own wallet (a move out of a wallet, a DEX order) goes to that wallet at once:
    // it shows the transaction and sends it, and its hash is reported (the retired page's money.js done, trade.js placeOrder)
    const out = body?.kind === 'result' && body.result !== null && typeof body.result === 'object' ? body.result : null;
    if (out?.wallet && out.payment) sendFromWallet(walletSend.payment(out.payment, out.wallet, out.walletTxs));
    // an order placed from the ticket and waiting for the wallet; never a cancel's answer, whose order also has walletTxs
    else if (kind === 'order' && body?.kind === 'order' && body.order?.status === 'pending' && body.order.walletTxs && !body.order.ref) sendFromWallet(walletSend.order(body.order));
    void account.load({ fresh: true });
    void account.loadHoldings({ fresh: true });
    void account.loadStatement({ fresh: true });
    markets.afterAction();
    if (SEAT_KINDS.has(kind)) void seat.load({ fresh: true });
    // a taken earn (plan 4b Task 3): what it said on Money's Earn, and the earn read again past the cache (earn.js:186-194)
    if (kind === 'earn') { store.dispatch('earnSaid', earnSaidOf(body)); void account.loadEarn({ fresh: true }); }
    // a signed Beast: the Rules tab's last Guard line goes with the mode it spoke of
    if (kind === 'beast') store.dispatch('guardClear');
    // a venue reopened to agents: its Close to agents line goes with the state it spoke of
    if (kind === 'reopen') { const v = store.get().sheet?.seed?.venue; if (typeof v === 'string') store.dispatch('closingClear', v); }
    // an identity sheet done (plan B1b): Identity read again past the face's cache, which a write does not clear
    if (IDENTITY_SHEET_KINDS.has(kind)) void account.loadIdentity({ fresh: true });
    const s = store.get().sheet;
    if (kind !== 'order' && s?.kind === kind && s.status === 'done') sheet.close();
  }
  // the connect sheet's two checks, each asked when what it asks changed: the key file it would connect with, the venue's reach —
  // at once on opening, after the sheet's own quiet on a change (a newer change, or the sheet opened or closed, cancels it)
  let connectAsked = { keyfile: null, reach: null };
  let connectTimer = null;
  function stopConnectCheck() { if (connectTimer !== null) { cancelTimer(connectTimer); connectTimer = null; } }
  function checkConnectSoon() {
    stopConnectCheck();
    connectTimer = schedule(() => { connectTimer = null; checkConnect(); }, PREPARE_QUIET_MS);
  }
  function checkConnect() {
    const s = store.get().sheet;
    if (s?.kind !== 'connect') return;
    const file = keyfileAskOf(s);
    const fileKey = file ? JSON.stringify(file) : null;
    if (fileKey !== connectAsked.keyfile) { connectAsked.keyfile = fileKey; if (file) void account.checkKeyfile(file); }
    const connector = reachAskOf(s);
    if ((connector || null) !== connectAsked.reach) { connectAsked.reach = connector || null; if (connector) void account.reach(connector); }
  }
  // the operator's own browser wallet (wire/wallet.js): the wallets this browser announces, asked when one has to send; what
  // the Account built for it sent once and reported once (host/wallet-send.js) — the face holds no key, the wallet signs; its
  // last words said on Trade, and the Account read again past the cache
  const getWallets = host.getWallets ?? (() => discoverWallets(win));
  const walletSend = startWalletSend({ store, post: ownerPost, getJson, getWallets, schedule });
  // the connect sheet's browser wallets (plan 4b Task 4): found once per connect sheet when its wallet kind is picked, kept here
  // with their providers (never in the store); a tile's press has the wallet sign the Account's sentence for its address, which
  // fills the address — and the name, when none is typed — or says the wallet's or the Account's refusal
  let connectWallets = [];
  let walletsFor = null;   // the connect sheet's seed they were found for
  const sameConnect = (seed, connector) => {
    const t = store.get().sheet;
    return t?.kind === 'connect' && t.seed === seed && (connector === undefined || connectOptionOf(t)?.connector === connector);
  };
  // the connector changed: a wallet's proof (or its refusal) was for the option before, and is forgotten; the wallets found stay.
  // A proof still asking stays asking — the wallet's prompt is open, so no second one is asked until it settles (its answer
  // then lands only on the option it was asked on, proveConnectWallet)
  const foundStatus = () => (connectWallets.length ? 'found' : 'none');
  function connectorChanged() {
    const cw = store.get().account.connectWallet;
    if (['proven', 'refused'].includes(cw?.status)) {
      store.dispatch('connectWallet', { status: foundStatus(), wallet: '', address: '', message: null });
    }
  }
  async function findConnectWallets() {
    const s = store.get().sheet;
    if (s?.kind !== 'connect' || !isWalletOption(connectOptionOf(s)) || walletsFor === s.seed) return;
    const seed = s.seed;
    walletsFor = seed;
    connectWallets = [];
    store.dispatch('connectWallet', { status: 'finding', wallets: [] });
    let found = [];
    try { found = await getWallets(); } catch { found = []; }
    if (!sameConnect(seed)) return;
    connectWallets = (Array.isArray(found) ? found : []).filter(w => w && typeof w.id === 'string' && w.provider);
    store.dispatch('connectWallet', connectWallets.length
      ? { status: 'found', wallets: connectWallets.map(w => ({ id: w.id, name: typeof w.name === 'string' && w.name ? w.name : 'Browser wallet' })) }
      : { status: 'none', wallets: [] });
  }
  // a proof that settled after its option was left, on the same sheet: nothing landed, the prompt is closed
  function settledElsewhere(seed) {
    if (sameConnect(seed) && store.get().account.connectWallet.status === 'asking') {
      store.dispatch('connectWallet', { status: foundStatus(), wallet: '', address: '', message: null });
    }
  }
  async function proveConnectWallet(id) {
    const s = store.get().sheet;
    const w = connectWallets.find(x => x.id === id);
    if (s?.kind !== 'connect' || !w || store.get().account.connectWallet.status === 'asking') return;
    const seed = s.seed;
    const connector = connectOptionOf(s)?.connector;
    const name = typeof w.name === 'string' && w.name ? w.name : 'Browser wallet';
    store.dispatch('connectWallet', { status: 'asking', wallet: name, address: '', message: null });
    try {
      const proven = await proveWallet({ ...w, name }, ownerPost);
      // proven for the option it was asked on, and only landed there; settled on another option: the tiles free again
      if (!sameConnect(seed, connector)) { settledElsewhere(seed); return; }
      sheet.change('ref', proven.address);
      const label = (store.get().sheet.fields ?? []).find(f => f?.name === 'label');
      if (label && (typeof label.value !== 'string' || !label.value.trim())) sheet.change('label', name);
      store.dispatch('connectWallet', { status: 'proven', address: proven.address });
    } catch (err) {
      if (!sameConnect(seed, connector)) { settledElsewhere(seed); return; }
      store.dispatch('connectWallet', { status: 'refused', message: String(err?.message || err || 'the wallet refused').slice(0, 200) });
    }
  }
  // a wallet flight's words said under Trade and the Account read again once it settles — a rejected one too (host/wallet-send.js
  // settleWalletFlight)
  function sendFromWallet(flight) {
    void settleWalletFlight(flight, { say: said => store.dispatch('tradeSaid', said), reload: () => { void account.load({ fresh: true }); } });
  }
  // the owner sheet (prepare → What you sign → sign) over the owner device
  // a bridge's preparation, once it is the one the sheet shows, has its routes read beside it (the retired page's money.js show)
  const sheet = startSheet({
    store, owner, schedule, cancelTimer, now, afterAction,
    onChange: (kind, name) => { if (kind === 'connect') { checkConnectSoon(); if (name === 'connector') { connectorChanged(); void findConnectWallets(); } } },
    onPrepared: (kind, prepared, draft) => { if (kind === 'move' && prepared?.action?.kind === 'bridge') void account.bridgeRoutes(draft); },
    // a sign-out in Beast with Guard first ticked: Guard (unsigned) before the signature, and refused, nothing signed (plan 4b
    // Task 6, agents-mount.js signOutAsk)
    beforeSign: async () => {
      let r;
      try { r = await account.guard(); } catch { r = null; }
      return r?.taken === true ? null : `Not signed out: Guard was refused — ${r?.message || 'no answer'}`;
    },
  });
  // Sell many (plan 4b Task 3): up to ten holdings at market, each prepared and signed in turn over the owner device; a DEX
  // sale's send handed to sendFromWallet, which reads the Account again once the wallet answers; the Account read again once a
  // run ends
  // Account › Identity's Connect Telegram (plan B1b Task 2): sheets 1 to 3 its own drawer, sheet 4 the owner sheet's connectNetwork;
  // the token read from sheet 1's field at Next and posted once through the owner door, never kept
  const identity = startIdentity({
    store, getJson, post: ownerPost, subtle: win.crypto?.subtle ?? null, schedule, cancelTimer, now,
    openSheet: (kind, seed) => sheet.open(kind, seed), loadIdentity: o => account.loadIdentity(o),
    random: n => win.crypto.getRandomValues(new Uint8Array(n)),
  });
  const sellMany = startSellMany({ store, getJson, owner, sendOrder: o => sendFromWallet(walletSend.order(o)), afterAction, now });
  // a receipt reloads the Account's read past the cache, and one from the Account seat (every receipt the kind table
  // lifts today) the seat's standing too
  const live = startLive({ store, openMux: host.openMux ?? wireOpenMux, call, mapFrame, getJson, timers, now, onReceipt: m => { if (m?.data?.seat) void seat.load({ fresh: true }); void account.load({ fresh: true }); } });
  // answers go through the live layer, which settles the gate it delivered once the answer wins
  const actions = makeActions({ store, call, answerGate: (eventId, value) => live.answer(eventId, value), postJson });
  // Markets: the market's reads and the Account's connected ones on the app's timers — the A shares' among them — a market's page
  // followed on the stream its line is on; the stars in this browser's storage
  const markets = startMarkets({ store, storage, getJson, win, now, stream, marketStream, schedule, cancelTimer, owner, afterAction });
  // the desk's status beside the markets (plan 2026-11-01-desk-p3-watch Task 11): the Desk tab, and the level marks on the rows
  const desk = startDesk({ store, getJson, postJson, schedule, cancelTimer, now });
  // Trade: the kinds' picks on screen, a ticket's order sheet, its line on the stream, Under way's Cancel
  const trade = startTrade({ store, getJson, owner, sheet, stream, schedule, cancelTimer, now, afterAction });
  // a channel's page: its overview read on entering it
  const channels = startChannels({ store, postJson, getJson, refresh: () => live.refresh(), now });
  // Discover: the face's inventory, read on entering it; a page's own reads (the Gravit item, a skill) on opening it
  const discover = startDiscover({ store, getJson, postJson, call, now });
  // a Lunhui module's page: its latest artifact, through the overview of the run's channel the modules listing names
  const readListing = () => discover.read('modules').then(() => store.get().discover.shelves.modules.data);
  // and the Runs it sent: the listing read afresh when one ends, on the live layer's timers; mirrored in this browser
  const modules = startModules({ store, postJson, readListing, refreshListing: () => discover.read('modules', { fresh: true }), timers, storage, now });
  // a module card's Run sheet: Run is a new conversation in the chosen channel, opened as a new message's is — the list read
  // again first, so the row is there when the page moves to it, then followed
  const runSheet = startRunSheet({
    store, actions, readListing, now,
    go: async route => { await live.refresh(); go(route); live.promote(route.id); },
  });
  // a room member's trace, read without activating the member's session
  const traces = startTraces({ store, call, loadMemberTrace, now });
  // the quotes, and the desk's status, run only while Markets is on screen in a visible tab; Trade's picks only while Trade is
  const showMarkets = () => { const on = store.get().route.screen === 'markets' && !doc.hidden; markets.show(on); desk.show(on); };
  const showTrade = () => trade.show(store.get().route.screen === 'trade' && !doc.hidden);
  // the owner's keys act only for a page that signs (the renderers draw them for no other)
  const signs = () => store.get().owner.role === 'signs';

  let composerText = '';
  let composing = false;
  let pressed = false;   // a primary press is down: a render now would replace the element the click is aimed at
  let pending = false;
  let openedId = null;   // the conversation the live layer was told to open
  let was = null;        // the route follow() last settled: entering a screen, a tab or a market's page reads what it draws
  let wanted = null;     // a deep link the list has not answered yet
  let searchTimer = null;   // the Markets search waiting for the box to be quiet
  let tradeTimer = null;    // Trade's search, the same
  let ticketAsked = null;   // a market page's Buy or Sell on its way to Trade: the side follow() opens the ticket with
  let sheetOpens = 0;       // the sheets opened so far: a read a sheet waits on opens none over one opened since
  let sheetKind = null;     // the kind of the sheet open as the store last changed: which one a close closed
  let orderFields = null;   // the ticket's order sheet's fields as they last stood, for when another sheet took its place
  let last = { overlay: null, opener: null, under: null, screen: null, drawer: null, thread: null, editor: null, confirm: null };
  let confirmFrom = null;

  function applyTheme(theme) {
    if (theme === 'cream' || theme === 'black') doc.documentElement.dataset.theme = theme; else delete doc.documentElement.dataset.theme;
  }
  function find(key) {
    if (!key) return null;
    if (key.id) return doc.getElementById(key.id);
    try { return root.querySelector(key.sel); } catch { return null; }   // a selector the page cannot read finds nothing
  }

  function render() {
    const s = store.get();
    // what the person had: focus and caret, typed text, picked radios, and where each scrolling box stood
    const active = doc.activeElement;
    const activeKey = focusKey(active);
    const caret = active && typeof active.selectionStart === 'number' && (active.id || active.name) ? [active.selectionStart, active.selectionEnd] : null;
    const typed = new Map([...root.querySelectorAll('input[id]:not([type=radio]):not([type=checkbox]):not([type=file]), textarea[id], select[id]')].map(el => [el.id, el.value]));
    const ticked = [...root.querySelectorAll('input[id]')].filter(el => (el.type === 'radio' || el.type === 'checkbox') && el.checked).map(el => el.id);
    const thread0 = doc.getElementById('thread');
    const threadAt = thread0 ? { top: thread0.scrollTop, bottom: thread0.scrollHeight - thread0.scrollTop - thread0.clientHeight < 40 } : null;
    const scrolls = { main: root.querySelector('main')?.scrollTop, rows: root.querySelector('.rail-rows')?.scrollTop, drawer: root.querySelector('.drawer-body')?.scrollTop };
    // a disclosure the person opened (its Raw, a trace; tool calls are stored but not drawn) is the page's, not the store's: open again by its id
    const opened = [...root.querySelectorAll('details[id][open]')].map(el => el.id);

    const screen = s.route.screen === 'markets' ? renderMarketsScreen(s, now()) : s.route.screen === 'account' ? renderAccountScreen(s, now())
      : s.route.screen === 'trade' ? renderTradeScreen(s, now())
      : s.route.screen === 'channel' ? renderChannelScreen(s, now()) : s.route.screen === 'discover' ? renderDiscover(s, now())
      : s.route.screen === 'plugin' ? renderPlugin(s) : s.route.screen === 'module' ? renderModule(s, now()) : renderMessagesScreen(s, now());
    // the drawers of any screen, inside its <main>: Settings, the stock drawer, the owner sheet over whatever is open, a module card's Run sheet
    const drawers = (s.settingsOpen ? renderSettings(s) : '') + stockDrawerHtml(s) + (s.sellMany ? renderSellMany(s) : '') + (sheetUp(s) ? renderSheet(s, now()) : '') + (!sheetUp(s) && s.identity?.connect ? renderConnectDrawer(s) : '') + (s.runSheet ? renderRunSheet(s, now()) : '');
    root.innerHTML = renderRail(s, now()) + (drawers ? screen.replace(/<\/main>$/, drawers + '</main>') : screen);
    // the quotes poll asks for the rows the table drew, by id; a market's page, which draws none, for its own market (spec §6.1:
    // the page follows it on the stream and polls quotes for what the stream does not carry)
    if (s.route.screen === 'markets') {
      const drawn = [...root.querySelectorAll('tr[data-id]')].map(el => el.dataset.id);
      // (an A share's page reads its own quote by its route, beside the rows: it names none)
      markets.rowsInView(drawn.length === 0 && !isCnKey(s.route.id) && isAccountKey(s.route.id) ? [s.route.id] : drawn);
    }

    const sameEditor = editorOf(s.edit) === last.editor;
    for (const [id, value] of typed) {
      const el = doc.getElementById(id);
      // an editor's box (edit-*) keeps what was typed only while the same editor stays open
      // Where's channel is the store's (draft.where), never the box's: New channel… must not stick in it
      if (el && id !== 'say' && id !== 'nm-where' && (sameEditor || !id.startsWith('edit-'))) el.value = value;
    }
    // a minute slider the person moved: the redraw drew its cursor at the last minute, put it back at the slider's
    reapplyCursors(root, doc, s);
    // a pick on a question card is the person's own until they press Answer: it lives in the DOM, not the store
    for (const id of ticked) {
      const el = doc.getElementById(id);
      if (el) el.checked = true;
    }
    for (const id of opened) {
      const el = doc.getElementById(id);
      if (el) el.open = true;
    }
    const say = doc.getElementById('say');
    if (say) say.value = composerText;

    // scroll: the rows keep their place; the page keeps its place on the same screen; a drawer while it stays the same drawer
    const sameScreen = last.screen === screenOf(s);
    const rows = root.querySelector('.rail-rows');
    if (rows && scrolls.rows != null) rows.scrollTop = scrolls.rows;
    const main = root.querySelector('main');
    if (main && sameScreen && scrolls.main != null) main.scrollTop = scrolls.main;
    const drawerBody = root.querySelector('.drawer-body');
    if (drawerBody && last.drawer && last.drawer === drawerOf(s) && scrolls.drawer != null) drawerBody.scrollTop = scrolls.drawer;
    // the thread stays where the person was reading while they read up, however much arrives; at the bottom, or on
    // another conversation, it follows the tail
    const open = s.route.screen === 'messages' ? currentConversation(s) : null;
    const threadSig = open ? open.id : null;
    const thread = doc.getElementById('thread');
    if (thread) thread.scrollTop = threadAt && !threadAt.bottom && threadSig === last.thread ? threadAt.top : thread.scrollHeight;

    // focus: back on the same control; into a drawer (or the sheet) that just opened; back to its opener when it closes — a sheet
    // opened over a drawer keeps that drawer's opener under it, for when the drawer closes in its turn
    const overlay = overlayOf(s);
    let opener = last.opener;
    let under = last.under;
    let target = find(activeKey);
    if (overlay && overlay !== last.overlay && last.overlay !== 'sheet') {
      if (overlay === 'sheet') under = last.overlay ? opener : null;
      opener = activeKey;
      target = root.querySelector(closeKeyOf(overlay));
    } else if (last.overlay === 'sheet' && overlay !== 'sheet') {
      target = find(last.opener) ?? (overlay ? root.querySelector(closeKeyOf(overlay)) : target);
      opener = overlay ? under : null;
      under = null;
    } else if (!overlay && last.overlay) {
      target = find(last.opener) ?? target;
      opener = null;
    } else if (s.edit && editorOf(s.edit) !== last.editor) {
      target = root.querySelector('.inline-edit [name]') ?? target; // an editor that just opened takes focus
    } else if (s.confirm && s.confirm !== last.confirm) {
      confirmFrom = last.confirm ? confirmFrom : activeKey;
      target = root.querySelector('.confirm [data-action="confirmYes"]') ?? target; // a confirm that just asked takes focus
    } else if (!s.confirm && last.confirm && find(confirmFrom)) {
      target = find(confirmFrom); // No: back on the key that asked
    } else if (!target && activeKey) {
      // the pressed control went away (an answered card's keys): stay inside the drawer if one is up, else the composer
      target = overlay ? root.querySelector(closeKeyOf(overlay)) : say;
    }
    if (target) {
      target.focus();
      if (caret && target === find(activeKey) && typeof target.setSelectionRange === 'function') target.setSelectionRange(caret[0], caret[1]);
    }
    last = { overlay, opener, under, screen: screenOf(s), drawer: drawerOf(s), thread: threadSig, editor: editorOf(s.edit), confirm: s.confirm };
    // a composed answer drawn without its run's view asks for it now that the page is whole (its dispatches render again)
    if (wantedViews(store.get()).length) void ensureViews(store, getJson);
  }

  // while an IME composes (pinyin), a render would replace the input and lose the composition: hold it until
  // compositionend. While a press is down a render would replace the element under it, and the press's release would
  // fire no click (quotes re-render the page twice a second): hold it until the press ends, then render after the click
  function requestRender() {
    if (composing || pressed) { pending = true; return; }
    render();
  }
  function release() {
    if (!pressed) return;
    pressed = false;
    if (pending) timers.after(0, () => { if (!pending || composing || pressed) return; pending = false; render(); });
  }

  function go(route) {
    const h = toHash(route);
    if (win.location.hash !== h) win.location.hash = h; else store.dispatch('nav', route);
    follow();
  }

  // route by the address bar, then tell the live layer which conversation is on screen
  function follow() {
    const asked = routeOf(win.location.hash);
    const fixed = settle(store, win.location.hash);
    if (fixed) win.history.replaceState(null, '', fixed);
    const r = store.get().route;
    showMarkets();
    showAccount();
    // Account: its page on entering it — past the face's cache when it opens on Cards, whose cards are the page's — and each tab
    // what it draws on entering it: Portfolio the holdings, then the curve they lead to; Venues the seat box; Agents the
    // Account's agents beside Gravit's seat; Cards the page past the cache
    const tabIn = (route, tab) => route?.screen === 'account' && route.tab === tab;
    const entered = tab => tabIn(r, tab) && !tabIn(was, tab);
    if (r.screen === 'account' && was?.screen !== 'account') void account.load({ fresh: r.tab === 'cards' });
    else if (entered('cards')) void account.load({ fresh: true });
    if (entered('portfolio')) void account.loadHoldings().then(() => account.loadHistory());
    if (entered('venues') || entered('agents')) void seat.load();
    if (entered('agents')) void account.loadAgents();
    if (entered('money')) void account.loadEarn();
    // Identity (plan B1b): the account's identity read; then at the page's cadence while it is on screen
    if (entered('identity')) void account.loadIdentity();
    // Trade left: its ticket closes and lets its line go — before a market's page follows its own
    const inTrade = route => route?.screen === 'trade';
    if (!inTrade(r) && inTrade(was)) { stopTradeSearch(); trade.closeTicket(); }
    // a market's page (an Account key): its market followed on the stream with its candles and compare rows, its asset sheet,
    // book, latest trades and a perpetual's funding (host/markets.js), and the holdings and the statement's lines about it read;
    // leaving it lets the market go
    // an A share's page (a cn: id) too: its history at the Account's china venue, and nothing held or stated read for it
    const pageId = route => (route?.screen === 'markets' && (isCnKey(route.id) || isAccountKey(route.id)) ? route.id : null);
    if (pageId(r) !== pageId(was)) {
      markets.page(pageId(r));
      if (!isCnKey(pageId(r)) && isAccountKey(pageId(r))) { void account.loadHoldings(); void account.loadStatement(); }
    }
    // Trade entered on a market (#/trade/<id>), after a page left let its market go: the ticket on it — a buy, or the side a
    // market page's Buy or Sell asked for — unless one is open on it already
    if (inTrade(r) && r.id && !(inTrade(was) && was.id === r.id) && store.get().trade.ticket?.id !== r.id) {
      pickTicket(r.id, ticketAsked?.id === r.id ? { side: ticketAsked.side } : {});
    }
    showTrade();
    if (r.screen === 'channel' && !(was?.screen === 'channel' && was.id === r.id)) void channels.overview(r.id);
    const inDiscover = route => route?.screen === 'discover' || route?.screen === 'plugin' || route?.screen === 'module';
    if (inDiscover(r) && !inDiscover(was)) void discover.load();
    if (r.screen === 'plugin' && !(was?.screen === 'plugin' && was.id === r.id)) {
      if (r.id === 'agent:gravit') void discover.gravit();
      else if (typeof r.id === 'string' && r.id.startsWith('skill:')) void discover.skill(r.id.slice('skill:'.length));
    }
    if (r.screen === 'module' && !(was?.screen === 'module' && was.id === r.id)) void modules.latestArtifact(r.id);
    if (r.screen === 'discover' && r.id === 'create' && !(was?.screen === 'discover' && was.id === 'create')) void discover.modelChoices();
    was = r;
    // a deep link the list does not carry yet waits for it
    if (asked.screen === 'messages' && asked.id && asked.id !== 'new' && !store.get().conversations.some(c => c.id === asked.id)) wanted = asked.id;
    if (r.screen === 'messages' && r.id && r.id !== 'new' && r.id !== openedId) {
      openedId = r.id;
      live.open(r.id);
    } else if (r.screen === 'messages' && !r.id && openedId && !store.get().conversations.some(c => c.id === openedId)) {
      // the last open conversation went (deleted) and nothing took its place: stop reading it
      openedId = null;
      live.leave();
    }
  }

  // a bot from Discover's bots listing, by its id
  const botOf = id => itemById(store.get().discover, `bot:${id}`)?.source ?? null;
  async function talkToNow(id) {
    const bot = botOf(id);
    if (!bot) return;
    const r = await actions.talkTo(bot);
    if (r.error) { store.dispatch('discoverStatus', { line: r.error, bad: true }); return; }
    await live.refresh();
    go({ screen: 'messages', id: r.id });
  }
  // the editor's boxes are read by the ids the page drew them with: the bot's id and the revision it was drawn from
  async function saveBotNow(id) {
    const bot = botOf(id);
    if (!bot) return;
    const box = key => doc.getElementById(`bot-${bot.id}-${bot.revision ?? ''}-${key}`)?.value ?? '';
    const done = await discover.saveBot(bot, { name: box('name'), description: box('description'), model: box('model'), soul: box('soul') });
    if (done === 'saved' && store.get().edit?.kind === 'bot') store.dispatch('cancelEdit');
  }
  async function createBotNow() {
    const box = key => doc.getElementById(`nb-${key}`)?.value ?? '';
    const made = await discover.createBot({ name: box('name'), id: box('id'), description: box('description'), model: box('model'), soul: box('soul') });
    if (typeof made === 'string') { store.dispatch('discoverStatus', { line: null }); go({ screen: 'plugin', id: `bot:${made}` }); }
    else store.dispatch('discoverStatus', { line: made.error, bad: true });
  }

  // New channel… in Where: create it, then Where names it; a refusal stays in the editor
  async function commitNewChannel(name) {
    const made = await channels.create(name);
    if (made.error) { store.dispatch('editFailed', { error: made.error }); return; }
    store.dispatch('cancelEdit');
    store.dispatch('setDraftWhere', made.workspaceId);
  }
  // a channel's roster editor: what the store holds ticked goes to the face
  async function commitRoster(e) {
    const done = e.which === 'agents' ? await channels.setAgents(e.workspaceId, e.ticked) : await channels.setBots(e.workspaceId, e.ticked);
    if (done.error) store.dispatch('editFailed', { error: done.error });
    else if (store.get().edit?.kind === 'roster') store.dispatch('cancelEdit');
  }
  // the choices a roster editor offers: the connected agents, or every bot; a rostered one that is gone stays to untick
  async function editRoster(which, workspaceId) {
    const data = store.get().channel?.id === workspaceId ? store.get().channel.data : null;
    if (!data) return;
    const rostered = (which === 'agents' ? data.agents : data.bots) ?? [];
    const offered = which === 'agents'
      ? (await channels.agentChoices()).map(a => ({ value: a.bin, label: a.label }))
      : (data.allBots ?? []).filter(b => !isHostPreset(b.id)).map(b => ({ value: b.id, label: b.name })); // Gravit's own composition is no bot
    const choices = [...offered, ...rostered.filter(v => !offered.some(c => c.value === v)).map(v => ({ value: v, label: v }))];
    store.dispatch('startEdit', { kind: 'roster', which, workspaceId, choices, ticked: [...rostered] });
  }

  // commit the open editor with what its inputs hold; a rename also reaches the host
  function commitEdit() {
    const e = store.get().edit;
    if (e?.kind === 'roster') { void commitRoster(e); return; }
    const values = Object.fromEntries([...root.querySelectorAll('.inline-edit [name]')].map(el => [el.name, el.value]));
    if (e?.kind === 'newChannel') { void commitNewChannel(values.channel); return; }
    store.dispatch('commitEdit', { values });
    if (e?.kind === 'rename' && store.get().edit === null) void actions.rename(e.convId, values.title);
  }

  // the conversation on screen went away (archived or deleted): the first open one takes its place
  function leaveIfOpen(id) {
    const s = store.get();
    if (s.route.screen === 'messages' && s.route.id === id) go({ screen: 'messages', id: firstOpen(s.conversations)?.id ?? null });
  }
  async function archiveNow(id, archived) {
    if (!(await actions.archive(id, archived))) return;
    await live.refresh();
    if (archived) leaveIfOpen(id);
  }
  async function deleteNow(id) {
    if (!(await actions.remove(id))) return;
    await live.refresh();
    leaveIfOpen(id);
  }
  async function forkNow(id) {
    const child = await actions.fork(id);
    if (!child) return;
    await live.refresh();
    go({ screen: 'messages', id: child });
  }

  // the second press of a two-step confirm
  function confirmYes() {
    const c = store.get().confirm;
    if (!c) return;
    store.dispatch('cancelConfirm');
    if (c.action === 'stopGravit') void actions.stop(c.id);
    if (c.action === 'deleteConv') void deleteNow(c.id);
    if (c.action === 'stopChild') void actions.stopChild(c.parent, c.id, c.label);
    // Revoke… and Disconnect…, asked twice: then their sheet, on a page that signs
    if (c.action === 'revoke' && signs()) void sheet.open('revoke', { name: c.name, address: c.address });
    if (c.action === 'disconnect' && signs()) void sheet.open('disconnect', { venue: c.venue, name: c.name });
  }

  // the Markets search: the query moves with each keystroke (setMarketsQuery), its reads once the box has been quiet for
  // SEARCH_QUIET_MS; a blank box searches at once — nothing to read, and what was read goes
  function searchNow(q) {
    if (searchTimer !== null) { timers.cancel(searchTimer); searchTimer = null; }
    markets.search(q);
  }
  function searchSoon(q) {
    if (!String(q).trim()) { searchNow(q); return; }
    if (searchTimer !== null) timers.cancel(searchTimer);
    searchTimer = timers.after(SEARCH_QUIET_MS, () => { searchTimer = null; markets.search(q); });
  }
  // Trade's search, the same quiet: trade.query (the query and its read) once the box has been quiet, a blank box at once; a
  // search still waiting goes when Trade is left
  function stopTradeSearch() { if (tradeTimer !== null) { timers.cancel(tradeTimer); tradeTimer = null; } }
  function tradeSoon(q) {
    stopTradeSearch();
    if (!String(q).trim()) { trade.query(q); return; }
    tradeTimer = timers.after(SEARCH_QUIET_MS, () => { tradeTimer = null; trade.query(q); });
  }

  // a market's ticket, for a market the face's ticket trades: on a page that signs, with its order sheet; on one that does not,
  // the ticket alone, its panel saying why there is no form
  function pickTicket(id, opts = {}) {
    if (typeof id !== 'string' || !tradeableOf({ key: id })) return;
    if (signs()) void trade.pick(id, opts);
    else store.dispatch('ticketOpen', { id, ...opts });
  }
  // Trade's ticket without a sheet on a page that signs: its order sheet again — with the fields it had when another sheet took
  // its place, else opened as the ticket was
  function resumeTicket() {
    const s = store.get();
    if (!signs() || s.route.screen !== 'trade' || !s.trade.ticket || s.sheet) return;
    if (orderFields) { void trade.resume(orderFields); return; }
    const t = s.trade.ticket;
    void trade.pick(t.id, { side: t.side, venue: t.venue, outcome: t.outcome });
  }
  // a picker row's hand-on: its side, venue and outcome where it gives them
  const pickOf = d => ({
    ...(d.side ? { side: d.side } : {}), ...(d.venue ? { venue: d.venue } : {}),
    ...(d.outcome !== undefined && d.outcome !== '' ? { outcome: Number(d.outcome) } : {}),
  });

  // a field of the open sheet (the order sheet's from the ticket's keys) changed: the sheet takes it; the order sheet's venue or
  // outcome seeds the ticket again at the new line
  function changeField(name, value) {
    const kind = store.get().sheet?.kind;
    sheet.change(name, value);
    if (kind === 'order' && name === 'venue') void trade.venue(value);
    if (kind === 'order' && name === 'outcome') void trade.outcome(Number(value));
  }
  // what a field's control holds: a box ticked or not, or — one of a pick's boxes — the pick's values ticked, in its order
  function fieldValueOf(el) {
    if (el.type !== 'checkbox') return el.value;
    const fields = store.get().sheet?.fields;
    const f = Array.isArray(fields) ? fields.find(x => x?.name === el.name) : null;
    if (f?.type !== 'pick') return el.checked === true;
    const on = new Set(Array.isArray(f.value) ? f.value : []);
    if (el.checked) on.add(el.value); else on.delete(el.value);
    return (Array.isArray(f.options) ? f.options : []).map(o => o.value).filter(v => on.has(v));
  }

  // an owner key's sheet, its seed built from the store by kind and the key's data; only on a page that signs
  function openSheetFrom(el) {
    if (!signs()) return;
    const d = el.dataset;
    const page = store.get().account.data;
    switch (d.kind) {
      case 'letIn': void sheet.open('letIn', { address: d.address ?? '', name: d.name ?? '' }); break;
      // a limit of the kind the key names (plan 4b Task 5), trading where it names none
      case 'limit': void sheet.open('limit', limitSeedOf(page, d.address, d.name, d.scope || 'trade')); break;
      case 'endLimit': void sheet.open('endLimit', { ...limitSeedOf(page, d.address, d.name, d.scope || 'trade'), scope: d.scope || 'trade', allow: d.allow ?? '' }); break;
      case 'approveCard': void sheet.open('approveCard', { card: d.card ?? '', hash: d.hash ?? '', decision: d.decision ?? '' }); break;
      case 'declineAsk': void sheet.open('declineAsk', { ask: d.ask ?? '' }); break;
      case 'topUp': case 'resetPaper': void sheet.open(d.kind, { venue: d.venue ?? '', name: d.name ?? '' }); break;
      case 'connect': case 'paper': void openOnRead(d.kind); break;
      // a venue closed to agents opened again (plan 4b Task 4): signed
      case 'reopen': void sheet.open('reopen', { venue: d.venue ?? '', name: d.name ?? '' }); break;
      // the Market half's (plan 4a Task 3): the seed as the key drew it, its figures the strings drawn, the market's kind its
      // data-market-kind
      case 'close': void sheet.open('close', { venue: d.venue ?? '', symbol: d.symbol ?? '', name: d.name ?? '', side: d.side ?? '', qty: d.qty ?? '', kind: d.marketKind ?? '' }); break;
      case 'amend': void sheet.open('amend', {
        venue: d.venue ?? '', order: d.order ?? '', type: d.type ?? '', kind: d.marketKind ?? '', qty: d.qty ?? '',
        limitPrice: d.limitPrice ?? '', stopPrice: d.stopPrice ?? '', side: d.side ?? '', base: d.base ?? '',
      }); break;
      case 'leverage': void sheet.open('leverage', { venue: d.venue ?? '', venueName: d.venueName ?? '', symbol: d.symbol ?? '', name: d.name ?? '', leverage: d.leverage ?? '', maxLeverage: d.maxLeverage ?? '', marginModes: d.marginModes ?? '' }); break;
      // the Money tab's Move… (plan 4b Task 2): the page's sources as they stand, from the one pressed
      case 'move': if (writesOn(page)) void sheet.open('move', moveSeedOf(page, { from: d.from ?? '', to: d.to ?? '', kind: d.moveKind ?? '', amount: d.amount ?? '' })); break;
      // Earn's Put in… and Take out… (plan 4b Task 3): seeded from the earn read, read first when it never was
      case 'earn': if (writesOn(page)) void openEarn({ venue: d.venue ?? '', side: d.side ?? '', product: d.product ?? '' }); break;
      // Agents' Open an agent wallet… (plan 4b Task 5): the keys let in as the page stands
      case 'subWallet': if (writesOn(page)) void sheet.open('subWallet', subWalletSeedOf(page, { agent: d.agent ?? '', name: d.name ?? '', float: d.float ?? '' })); break;
      // the Rules tab's (plan 4a Task 5): each seeded from the page as it stands — the cap now, whether the session ended, their
      // leverage now; the three limits only for an Account that takes writes
      // Beast only while it is not in force: a signature that changes nothing is never asked
      case 'beast': if (rulesOf(page, now()).mode !== 'open') void sheet.open('beast', {}); break;
      case 'cap': case 'session': case 'leverageCap': {
        const r = rulesOf(page, now());
        if (!r.writes) break;
        if (d.kind === 'cap') void sheet.open('cap', { capUsd: r.cap?.usd ?? null });
        else if (d.kind === 'session' && r.session) void sheet.open('session', { ended: r.session.ended });
        else if (d.kind === 'leverageCap' && r.leverage) void sheet.open('leverageCap', { max: r.leverage.max });
        break;
      }
      // Account › Identity's (plan B1b Task 3), each seeded from the identity read as it stands: Disconnect… a network connected;
      // What reaches you where (Save… and Change…) the grid's unsaved ticks or the account's routing, the account's own string beside
      // them, and its quiet hours; Block a stranger by the reference and masked id its key carries
      case 'disconnectNetwork': case 'routing': {
        const data = store.get().identity?.data;
        const v = identityOf(data);
        if (!v.ok) break;
        if (d.kind === 'disconnectNetwork') {
          const network = d.network || 'telegram';
          if (v.networks[network]?.state === 'connected') void sheet.open('disconnectNetwork', { network });
        } else {
          const draft = store.get().identity.draft;
          void sheet.open('routing', { routing: draft ?? routingOf(data), quiet: v.quiet, saved: formatRouting(routingOf(data)) });
        }
        break;
      }
      case 'block': void sheet.open('block', { network: d.network ?? '', sender: d.sender ?? '', masked: d.masked ?? '' }); break;
      default: break;
    }
  }
  // the connect and paper sheets are seeded from a read beside the page (where this account can connect, the kept paper
  // books): at once with what was read, else once the read lands — when no other sheet was opened meanwhile and the page
  // still signs
  // the Earn sheet from the earn read as it stands; never read: read first, and opened only when no other sheet was opened
  // meanwhile and the page still signs
  async function openEarn(preset) {
    if (store.get().account.earn.data === null) {
      const opened = sheetOpens;
      await account.loadEarn();
      if (opened !== sheetOpens || !signs()) return;
    }
    const a = store.get().account;
    void sheet.open('earn', earnSeedOf(a.earn.data, a.data, preset));
  }
  // Cards' Grant: the sheet that grants the ask (host/sheet-view.js grantOf); a venue not on the page waits for where the account
  // can connect to be read, and opens only when no other sheet was opened meanwhile and the page still signs
  async function grantAsk(id) {
    const ask = () => asksOf(store.get().account.data).find(k => k.id === id);
    const grant = () => grantOf(ask(), store.get().account.data, store.get().account.venuesHere.data);
    store.dispatch('grantSaid', null);
    let g = grant();
    if (!g && ask()?.kind === 'venue' && store.get().account.venuesHere.data === null) {
      const opened = sheetOpens;
      await account.loadVenuesHere();
      if (opened !== sheetOpens || !signs()) return;
      g = grant();
      // the read failed: said, under the asks
      if (!g && store.get().account.venuesHere.data === null) {
        const why = store.get().account.venuesHere.message;
        store.dispatch('grantSaid', `Not opened: where this account can connect was not read${typeof why === 'string' && why ? ` — ${why}` : ''}. Try Grant again.`);
        return;
      }
    }
    if (!g) return;
    if (g.kind === 'connect') { connectAsked = { keyfile: null, reach: null }; store.dispatch('connectReset'); }
    void sheet.open(g.kind, g.seed);
    if (g.kind === 'connect') { checkConnect(); void findConnectWallets(); }
  }
  async function openOnRead(kind) {
    const slice = () => store.get().account[kind === 'connect' ? 'venuesHere' : 'paperBooks'];
    const read = kind === 'connect' ? account.loadVenuesHere() : account.loadPaperBooks();
    if (slice().data === null) {
      const opened = sheetOpens;
      await read;
      if (opened !== sheetOpens || !signs()) return;
    }
    const page = store.get().account.data;
    if (kind === 'paper') { void sheet.open('paper', paperSeedOf(page, slice().data)); return; }
    connectAsked = { keyfile: null, reach: null };
    store.dispatch('connectReset');
    // the page's venue ids beside the options: a second address of a kind already on the page is numbered by its address
    void sheet.open('connect', { options: connectOptionsOf(page, slice().data), venues: venuesOf(page).map(v => ({ id: v.id })) });
    checkConnect();
    void findConnectWallets();
  }

  async function sendNow() {
    const text = composerText.trim();
    if (!text) return;
    const s = store.get();
    composerText = '';
    if (s.draft) {
      const id = await actions.newConversation({ title: s.draft.title, workspaceId: s.draft.where, text });
      if (!id) { composerText = text; render(); return; }
      await live.refresh();
      go({ screen: 'messages', id });
      live.promote(id);
      return;
    }
    const sent = await sendText(text);
    if (!sent) { composerText = text; render(); return; }
    render();
  }
  // one message to the open conversation by the composer's own path (the composer, the stock drawer's Ask, a follow-up): what
  // actions.send answers, the conversation promoted to a follow when it prompted; the composer's words are never touched
  async function sendText(text) {
    const sent = await actions.send(text);
    if (sent && (sent.sent === 'prompt' || sent.sent === 'say')) live.promote(sent.sessionId);
    return sent;
  }

  const act = {
    open: el => go({ screen: 'messages', id: el.dataset.id }),
    startDraft: () => { store.dispatch('startDraft', { now: now() }); go({ screen: 'messages', id: 'new' }); },
    // a channel's page: New round is a new message in that channel; Retry reads it again
    newRound: el => { store.dispatch('startDraft', { now: now(), where: el.dataset.id }); go({ screen: 'messages', id: 'new' }); },
    channelRetry: el => { void channels.overview(el.dataset.id); },
    editRoster: el => { void editRoster(el.dataset.which, el.dataset.id); },
    // Discover: a shelf read again, the CLI agents' three writes
    shelfRetry: el => { void discover.read(el.dataset.shelf, { fresh: true }); },
    connectAgent: el => { void discover.connect(el.dataset.bin); },
    disconnectAgent: el => { void discover.disconnect(el.dataset.bin); },
    rescanAgents: () => { void discover.rescan(); },
    // a module's Run: its sheet, its fields (a box's words as typed, a pick as changed), Cancel, and Run itself
    runModule: el => { void runSheet.open(el.dataset.module); },
    runSheetField: el => { void runSheet.field(el.name, el.value); },
    runSheetCancel: () => runSheet.close(),
    runSheetRun: () => { void runSheet.run(); },
    // a bot: Talk to opens its conversation, Edit opens its editor (the model routes read for it)
    talkTo: el => { void talkToNow(el.dataset.id); },
    editBot: el => { store.dispatch('startEdit', { kind: 'bot', id: el.dataset.id }); void discover.modelChoices(); },
    cancelDraft: () => { store.dispatch('cancelDraft'); go(store.get().route); },
    toggleRail: () => store.dispatch('toggleRail'),
    toggleGroup: el => store.dispatch('toggleGroup', el.dataset.key),
    // inline editors (they replaced prompt): a button starts one, ✓ or Enter commits it, × or Escape cancels it
    changeWords: el => store.dispatch('startEdit', { kind: 'rename', convId: el.dataset.conv }),
    commitEdit: () => commitEdit(),
    cancelEdit: () => store.dispatch('cancelEdit'),
    // two-step confirms (they replaced confirm): the first press asks in place, the second acts
    stopGravit: el => store.dispatch('askConfirm', { action: 'stopGravit', id: el.dataset.conv }),
    // the row actions: Fork opens the new conversation; Archive and Delete leave the screen when it was this one
    fork: el => { void forkNow(el.dataset.conv); },
    archive: el => { void archiveNow(el.dataset.conv, true); },
    unarchive: el => { void archiveNow(el.dataset.conv, false); },
    deleteConv: el => store.dispatch('askConfirm', { action: 'deleteConv', id: el.dataset.conv }),
    // the research surfaces: a child stopped by its parent (asked twice), a member's trace read on opening
    stopChild: el => store.dispatch('askConfirm', { action: 'stopChild', id: el.dataset.child, parent: el.dataset.parent, label: el.dataset.label }),
    openTrace: el => { void traces.open(el.dataset.conv, el.dataset.msg); },
    // a composed answer's view that could not be read: forget it, and the render asks again
    lunhuiRetry: el => { store.dispatch('lunhuiRetry', el.dataset.key); },
    // a stock name in a composed answer opens the stock drawer on that answer's view
    lunhuiStock: el => { store.dispatch('lunhuiStockOpen', { key: el.dataset.key, code: el.dataset.code }); },
    // the stock drawer's keys: Close; Ask Gravit about it (one message, the open stock's words); its page on Markets
    // a follow-up: a stock opens its drawer, anything else is one message through the composer's path
    lunhuiChoice: el => {
      if (el.dataset.code) store.dispatch('lunhuiStockOpen', { key: el.dataset.key, code: el.dataset.code });
      else if (el.dataset.label) void sendText(el.dataset.label);
    },
    lunhuiOpenRun: el => go({ screen: 'channel', id: el.dataset.id }),
    lunhuiStockClose: () => store.dispatch('lunhuiStockClose'),
    lunhuiAsk: () => { const text = askText(store.get()); if (text) void sendText(text); },
    lunhuiMarkets: () => { const code = stockCode(store.get().lunhui?.stock?.code); if (code) go({ screen: 'markets', id: marketKey(code) }); },
    // a composed answer's picks, by the answer's id: a verdict tile (pressed again, it closes), Counts or By change, a bucket
    lunhuiUi: el => {
      const { id, field, value } = el.dataset;
      let v = field === 'bucket' || field === 'rung' ? Number(value) : value;
      if (field === 'tile' && store.get().lunhui?.ui?.[id]?.tile === v) v = null;
      store.dispatch('lunhuiUi', { id, patch: { [field]: v } });
    },
    confirmYes: () => confirmYes(),
    cancelConfirm: () => store.dispatch('cancelConfirm'),
    suggest: el => { composerText = el.dataset.text; render(); doc.getElementById('say')?.focus(); },
    // the gates: a card's ✗ / ✓, a question card's Answer
    answer: el => { void actions.answer(el.dataset.msg, el.dataset.value); },
    // the batch is read from the pressed card alone; one with a question left blank is refused before it can settle the gate
    answerQuestion: el => {
      const conv = store.get().conversations.find(c => c.id === el.dataset.conv);
      const m = conv?.messages.find(x => x.id === el.dataset.msg);
      if (!m) return;
      const batch = answersFrom(el.closest?.('[data-gate]') ?? root, m.data?.questions, m.id);
      if (!complete(batch)) { store.dispatch('hostStatus', { line: 'Answer every question first', bad: true }); return; }
      void actions.answer(m.id, batch);
    },
    toggleDetails: () => store.dispatch('toggleDetails'),
    openSettings: () => store.dispatch('openSettings'),
    closeSettings: () => store.dispatch('closeSettings'),
    setTheme: el => { const t = el.dataset.value.toLowerCase(); store.dispatch('setTheme', t); applyTheme(t); },
    // Account: Refresh (and Retry) — the page and the seat past the face's cache, the holdings —, the curve's range, a venue's
    // Details, the Statement (its lines read on opening it), its CSV
    refreshAccount: () => {
      void account.load({ fresh: true });
      void account.loadHoldings();
      void seat.load({ fresh: true });
      if (store.get().route.tab === 'identity') void account.loadIdentity({ fresh: true });
    },
    // Account › Identity (plan B1b): Retry reads it past the face's cache; Details opens or shuts the connection's line
    refreshIdentity: () => { void account.loadIdentity({ fresh: true }); },
    identityDetails: () => store.dispatch('identityDetails'),
    // Connect Telegram (plan B1b Task 2): the drawer's keys; Next hands the host the field itself, never its value
    identityConnect: () => { if (signs()) identity.openConnect(); },
    identityNext: () => { void identity.next(root.querySelector('#identity-token')); },
    identityPaste: () => {
      const read = win.navigator?.clipboard?.readText;
      if (typeof read !== 'function') return;
      read.call(win.navigator.clipboard).then(text => {
        const el = root.querySelector('#identity-token');
        if (el && typeof text === 'string') el.value = text.trim();
      }, () => { /* the browser said no: nothing pasted */ });
    },
    identityClose: () => identity.close(),
    identityBack: () => identity.back(),
    identityNotMe: () => { void identity.notMe(); },
    identityThisIsMe: () => { if (signs()) void identity.thisIsMe(); },
    identityStartAgain: () => { if (store.get().sheet?.kind === 'connectNetwork') sheet.close(); identity.startAgain(); },
    setHistoryRange: el => { void account.loadHistory(el.dataset.value); },
    openVenueDetails: el => store.dispatch('openVenueDetails', el.dataset.id),
    closeVenueDetails: () => store.dispatch('closeVenueDetails'),
    openStatement: () => {
      if (store.get().route.screen !== 'account') go({ screen: 'account', tab: 'portfolio' });
      store.dispatch('openStatement');
      void account.loadStatement();
    },
    closeStatement: () => store.dispatch('closeStatement'),
    exportStatement: () => {
      const csv = statementCsvOf(statementLinesOf(store.get().account.statement.data));
      const url = win.URL.createObjectURL(new win.Blob([csv], { type: 'text/csv' }));
      const a = doc.createElement('a');
      a.href = url;
      a.download = 'statement.csv';
      a.click();
      timers.after(0, () => win.URL.revokeObjectURL(url));
    },
    // Markets: the tabs, the sort, Clear, the star, Remove, a row's page, a page's range
    mkTab: el => store.dispatch('setMarketsTab', el.dataset.value),
    mkSort: el => store.dispatch('setMarketsSort', el.dataset.value),
    // the Desk tab's one control: Pause (no Resume: a terminal resumes)
    deskPause: () => { void desk.pause(); },
    // the render keeps what an input holds, so Clear empties the box before the query; a search still waiting goes with it
    mkClear: () => {
      const box = doc.getElementById('mq');
      if (box) box.value = '';
      store.dispatch('setMarketsQuery', '');
      searchNow('');
      doc.getElementById('mq')?.focus?.();
    },
    // the star, on or off as it is drawn: an Account key in the Account's own list (signed, on a page that signs) or store, a cn
    // id on the face's list
    toggleWatch: el => {
      const id = el.dataset.id;
      const s = store.get();
      if (watchedOf(s.markets, id, s.account.data)) markets.unwatch(id); else markets.watch(id);
    },
    // an old star the Account does not list, taken off
    removeAsked: el => markets.unwatch(el.dataset.id),
    openMarket: el => go({ screen: 'markets', id: el.dataset.id }),
    setRange: el => markets.range(el.dataset.id, el.dataset.value),
    // a new message in the root channel with the market named in the composer: the operator says what to look for
    handToGravit: el => {
      const s = store.get();
      const asset = handWordsOf(s.markets, s.account, el.dataset.id, now());
      if (!asset) return;
      store.dispatch('startDraft', { now: now() });
      composerText = `Look at ${asset.symbol}${asset.name && asset.name !== asset.symbol ? ` (${asset.name})` : ''}`;
      go({ screen: 'messages', id: 'new' });
      render();
      doc.getElementById('say')?.focus();
    },
    // the owner device: the pair box's code, Sign in, and — on a page that signs — Settings › Devices' Sign out and Let it sign
    pairDevice: () => { void owner.ready(doc.getElementById('pair-code')?.value?.trim() || undefined); },
    signIn: () => { void owner.signIn(); },
    signOut: () => { if (signs()) void sheet.open('signOut', signOutSeedOf(store.get().account.data, store.get().owner)); },
    letDevice: el => {
      if (!signs()) return;
      const s = store.get();
      void sheet.open('letDevice', letDeviceSeedOf(s.account.data, s.owner, el.dataset.kid));
    },
    // the owner's keys on Account: each its sheet; Revoke… and Disconnect… ask in place first; Grant the sheet that grants the ask
    openSheet: el => openSheetFrom(el),
    // the Money tab's Show address (a read, on any page that reads the Account) and Copy
    showAddress: el => { void account.receive({ venue: el.dataset.venue, asset: el.dataset.asset, network: el.dataset.network }); },
    copyText: el => {
      try { void Promise.resolve(win.navigator?.clipboard?.writeText?.(el.dataset.text ?? '')).catch(() => {}); } catch { /* no clipboard here */ }
    },
    // Sell many (plan 4b Task 3): opened from the Portfolio's Assets on a page that signs for an Account that takes writes
    openSellMany: () => { if (signs() && writesOn(store.get().account.data)) void sellMany.open(); },
    sellManyReview: () => { void sellMany.review(); },
    sellManyRun: () => { if (signs()) void sellMany.run(); },
    sellManyBack: () => sellMany.back(),
    sellManyClose: () => sellMany.close(),
    // the Rules tab's Guard: one unsigned click, on any page that reads the Account (one in the air at a time)
    setGuard: () => { if (pageOk(store.get().account.data)) void account.guard(); },
    // a venue's Close to agents: one unsigned click, on any page that reads the Account (one in the air per venue)
    closeToAgents: el => { if (pageOk(store.get().account.data) && el.dataset.venue) void account.revoke(el.dataset.venue); },
    // the connect sheet's wallet tile and a venue's Sign in at …: each inside the operator's press (the wallet's prompt, the tab)
    connectWallet: el => { if (signs()) void proveConnectWallet(el.dataset.wallet); },
    connectSignIn: () => {
      if (!signs()) return;
      const s = store.get().sheet;
      const option = connectOptionOf(s);
      if (option?.needs !== 'sign-in') return;
      const seed = s.seed;
      void account.signIn(option, {
        alive: () => sameConnect(seed) && connectOptionOf(store.get().sheet)?.connector === option.connector,
        onReady: state => sheet.change('credentialRef', state),
      });
    },
    askRevoke: el => { if (signs()) store.dispatch('askConfirm', { action: 'revoke', name: el.dataset.name ?? '', address: el.dataset.address ?? '' }); },
    askDisconnect: el => { if (signs()) store.dispatch('askConfirm', { action: 'disconnect', venue: el.dataset.venue ?? '', name: el.dataset.name ?? '' }); },
    grant: el => { if (signs()) void grantAsk(el.dataset.ask); },
    // the sheet: a seg's pick, named by its field (its boxes and fields answer through input and change), Sign, Prepare again,
    // Cancel
    sheetField: el => changeField(el.name, el.dataset.value),
    sheetSubmit: () => { void sheet.submit(); },
    sheetAgain: () => { void sheet.again(); },
    sheetClose: () => sheet.close(),
    // Trade: a kind, a picker row, a market page's Buy or Sell (Trade on that market, the ticket on the side pressed), the
    // ticket's keys, Under way's Cancel
    tradeKind: el => trade.kind(el.dataset.value),
    pickMarket: el => pickTicket(el.dataset.id, pickOf(el.dataset)),
    openTicket: el => {
      const id = el.dataset.id;
      const side = el.dataset.side === 'sell' ? 'sell' : 'buy';
      ticketAsked = { id, side };
      try { go({ screen: 'trade', id }); } finally { ticketAsked = null; }
      const t = store.get().trade.ticket;
      if (t?.id !== id || t.side !== side) pickTicket(id, { side });
    },
    ticketVenue: el => changeField('venue', el.dataset.venue),
    ticketSide: el => changeField('side', el.dataset.value),
    ticketOutcome: el => changeField('outcome', el.dataset.value),
    closeTicket: () => trade.closeTicket(),
    // What you sign is the <details>' own: the click toggles it, and the render keeps it open by its id
    toggleSigns: () => {},
    cancelOrder: el => { if (signs()) void trade.cancel(el.dataset.venue, el.dataset.order); },
    // Under way's Send from wallet…: a DEX order or a payment waiting for the operator's wallet, as the page last read it (the
    // host asks the Account again before the wallet is asked); Report again reports the hash the wallet sent, never sends again
    sendFromWallet: el => {
      if (!signs()) return;
      const page = store.get().account.data;
      const listOf = k => (Array.isArray(page?.[k]) ? page[k] : []);
      if (el.dataset.order) {
        const o = listOf('orders').find(x => x?.id === el.dataset.order);
        if (o) sendFromWallet(walletSend.order(o));
      } else if (el.dataset.payment) {
        const p = listOf('payments').find(x => x?.id === el.dataset.payment);
        const nat = p?.legs?.[0]?.native;
        if (nat?.walletTx) sendFromWallet(walletSend.payment(p, nat.walletTx, nat.walletTxs));
      }
    },
    reportAgain: el => { if (signs() && el.dataset.key) sendFromWallet(walletSend.reportAgain(el.dataset.key)); },
  };

  root.addEventListener('click', ev => {
    const el = ev.target.closest('[data-action]');
    if (!el || el.tagName === 'FORM' || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    const fn = act[el.dataset.action];
    if (!fn) return;
    if (el.tagName === 'A' && el.dataset.action !== 'open') return;
    if (el.tagName === 'A') ev.preventDefault();
    // a disclosure's own key (Trace): its action re-renders the page before the browser would toggle the <details>, so
    // the page toggles it first, where the render's keep-open pass finds it; the action runs on opening only
    if (el.tagName === 'SUMMARY' && el.parentElement?.tagName === 'DETAILS') {
      ev.preventDefault();
      el.parentElement.open = !el.parentElement.open;
      if (!el.parentElement.open) return;
    }
    fn(el);
  });

  root.addEventListener('submit', ev => {
    const form = ev.target.closest('form[data-action]');
    if (!form) return;
    ev.preventDefault();
    if (form.dataset.action === 'send') void sendNow();
    else if (form.dataset.action === 'saveBot') void saveBotNow(form.dataset.id);
    else if (form.dataset.action === 'createBot') void createBotNow();
    else if (form.dataset.action === 'placeOrder') void sheet.submit();
    // Enter in the pair box: the same as Pair, and held as Pair is while a pairing is in the air
    else if (form.dataset.action === 'pairDevice') { if (store.get().owner?.busy !== true) act.pairDevice(); }
  });

  // a sheet's or the ticket's field: its words as typed, its box or its pick as changed
  const isField = el => el.dataset?.action === 'sheetField' || el.dataset?.action === 'ticketField';
  const typesWords = el => el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio');
  // typing: the composer keeps its words outside the store; the title, the searches and the fields go through it
  function typed(el) {
    if (el.id === 'say') composerText = el.value;
    else if (el.dataset?.action === 'draftTitle') store.dispatch('setDraftTitle', el.value);
    else if (el.dataset?.action === 'mkQuery') { store.dispatch('setMarketsQuery', el.value); searchSoon(el.value); }
    else if (el.dataset?.action === 'tradeQuery') tradeSoon(el.value);   // trade.query moves the query (the box keeps the words)
    else if (el.dataset?.action === 'dq') store.dispatch('setDiscoverQuery', el.value);
    else if (isField(el) && typesWords(el)) changeField(el.name, el.value);
    else if (el.dataset?.action === 'runSheetField' && typesWords(el)) act.runSheetField(el);
    else if (el.dataset?.action === 'sellManyQty') sellMany.setQty(el.dataset.index, el.value);
    else if (el.dataset?.action === 'lunhuiMinute') moveCursor(el, Number(el.value));
  }
  // an indices chart's cursor, from its slider or the pointer over the chart: patched in place, never through the store
  function moveCursor(el, minute) {
    applyCursor(doc, el.dataset.id, cursorFor(store.get(), el, minute));
  }
  root.addEventListener('pointermove', ev => {
    const el = ev.target?.closest?.('[data-action="lunhuiHover"]');
    if (!el || typeof el.getBoundingClientRect !== 'function') return;
    moveCursor(el, minuteAt(ev.clientX, el.getBoundingClientRect(), Number(el.dataset.last)));
  }, { passive: true });
  root.addEventListener('input', ev => { if (!ev.isComposing && !composing) typed(ev.target); });
  root.addEventListener('change', ev => {
    const el = ev.target;
    if (el.tagName === 'SELECT' && el.dataset?.action === 'draftWhere') {
      if (el.value === '__new') store.dispatch('startEdit', { kind: 'newChannel' }); else store.dispatch('setDraftWhere', el.value);
    }
    if (el.type === 'checkbox' && el.name === 'roster') store.dispatch('toggleRosterTick', { value: el.value, on: el.checked === true });
    if (isField(el) && !typesWords(el)) changeField(el.name, fieldValueOf(el));
    if (el.dataset?.action === 'runSheetField' && !typesWords(el)) act.runSheetField(el);
    if (el.type === 'checkbox' && el.dataset?.action === 'sellManyPick') sellMany.toggle(el.value);
    // a tick on Identity's grid: the draft routing, on a page that signs (the reducer checks again)
    if (el.type === 'checkbox' && el.dataset?.action === 'identityTick' && signs()) {
      store.dispatch('identityTick', { row: el.dataset.row, network: el.dataset.network, on: el.checked === true });
    }
  });
  let pressSeq = 0;   // a press's own timeout ends only that press, never a later one
  root.addEventListener('pointerdown', ev => {
    if (ev.button !== undefined && ev.button !== 0) return;
    pressed = true;
    const mine = ++pressSeq;
    timers.after(host.pointerHoldMs ?? POINTER_HOLD_MS, () => { if (mine === pressSeq) release(); });
  });
  doc.addEventListener('pointerup', release);
  doc.addEventListener('pointercancel', release);
  win.addEventListener('blur', release);
  root.addEventListener('compositionstart', () => { composing = true; });
  root.addEventListener('compositionend', ev => {
    composing = false;
    const before = store.get();
    typed(ev.target);
    if (pending && store.get() === before) render();
    pending = false;
  });

  doc.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      const s = store.get();
      if (s.edit) { store.dispatch('cancelEdit'); return; }
      if (s.confirm) { store.dispatch('cancelConfirm'); return; }
      // a module card's Run sheet first, then the owner sheet over any drawer, then the stock drawer; Trade's ticket after every drawer
      if (s.runSheet) runSheet.close();
      else if (sheetUp(s)) sheet.close();
      else if (s.identity?.connect) identity.close();
      else if (s.sellMany) sellMany.close();
      else if (s.lunhui?.stock) store.dispatch('lunhuiStockClose');
      else if (s.detailsOpen) store.dispatch('toggleDetails');
      else if (s.settingsOpen) store.dispatch('closeSettings');
      else if (s.account.statementOpen) store.dispatch('closeStatement');
      else if (s.account.detailsVenue) store.dispatch('closeVenueDetails');
      else if (s.route.screen === 'trade' && s.trade.ticket) trade.closeTicket();
      return;
    }
    const a = doc.activeElement;
    // Enter in Connect Telegram's token field is Next: the field has no form (no login for the browser to offer to keep)
    if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229 && a?.id === 'identity-token') { ev.preventDefault(); act.identityNext(); return; }
    if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229 && store.get().edit && a?.closest?.('.inline-edit') && a.tagName !== 'BUTTON') { ev.preventDefault(); commitEdit(); }
  });

  // a hidden tab stops everything — the Markets polls and the face's wire, the Account's read, and both streams with the market a
  // page follows — and a visible one starts again what its screen reads
  win.addEventListener('hashchange', follow);
  doc.addEventListener('visibilitychange', () => {
    showMarkets();
    showTrade();
    showAccount();
    if (doc.hidden) { stream.close(); marketStream.close(); } else { stream.open(); marketStream.open(); }
  });
  store.subscribe((s, type) => {
    requestRender();
    if (type === 'sheetOpen' || type === 'sheetClose') stopConnectCheck();
    if (type === 'sheetOpen') sheetOpens += 1;
    // the order sheet's fields as they stand, kept while another sheet takes its place; a ticket opened or closed forgets them
    if (s.sheet?.kind === 'order') orderFields = s.sheet.fields;
    if (type === 'ticketOpen' || type === 'ticketClose') orderFields = null;
    // Trade's ticket left without its order sheet on a page that signs — a deep link that landed before the pairing, or a sheet
    // of Settings › Devices that took the order sheet's place and closed — seeds its order sheet again, with every field it
    // had; a tick later, never inside the sheet engine's own close
    const otherClosed = type === 'sheetClose' && sheetKind !== 'order';
    sheetKind = s.sheet?.kind ?? null;
    if (type === 'ownerStanding' || otherClosed) schedule(resumeTicket, 0);
    if (type !== 'hostList') return;
    // the list answered a deep link, or there was no conversation on screen: open one
    if (wanted && s.conversations.some(c => c.id === wanted)) { const id = wanted; wanted = null; go({ screen: 'messages', id }); }
    // the conversation on screen left the list (deleted here or in another tab)
    else if (s.route.screen === 'messages' && s.route.id && s.route.id !== 'new' && !s.conversations.some(c => c.id === s.route.id)) go({ screen: 'messages', id: firstOpen(s.conversations)?.id ?? null });
    else if (s.route.screen === 'messages' && s.route.id === null && firstOpen(s.conversations)) go({ screen: 'messages', id: firstOpen(s.conversations).id });
  });
  // a module's Run reads Running while its conversation runs, and settles on the listing when it stops
  modules.trackRuns();
  applyTheme(store.get().theme);
  if (!win.location.hash) win.history.replaceState(null, '', toHash(store.get().route));
  if (!doc.hidden) { stream.open(); marketStream.open(); }
  follow();
  render();
  return Object.assign(store, { timers, live, actions, markets, channels, discover, owner, sheet, trade, walletSend, sellMany, identity });
}

if (typeof window !== 'undefined' && window.document) boot(window);
