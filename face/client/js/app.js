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
import { isMentionText } from './wire/room.js';
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
import { makeEditor } from './composer/dom.js';
import { textDraft, isBlank, lengthOf, normalize, replaceRange, serialize, serialContext, triggerAt, hasChip } from './composer/draft.js';
import { flatItems, slashItems, atItems, conversationChoices, moveActive, chipOf } from './composer/menus.js';
import { renderMenu, menuAria, filesRail, dropOverlay, lightboxHtml } from './composer/view.js';
import { thumbsNeeded, railHtml } from './render/thread.js';
import { railView, activeTurn, clockText } from './host/turns-view.js';
import { startJobs } from './host/jobs.js';
import { jobsView, isLive } from './host/jobs-view.js';
import { admit, blocking, hasImage, contentParts, encodeBase64, modelRefusalLine, isImageSrc } from './composer/files.js';
import { senderName } from './render/rail.js';
import { startAttachments } from './host/attachments.js';
import { startComposerReads } from './host/composer.js';
import { startOwner, postVia } from './host/owner.js';
import { startSheet, PREPARE_QUIET_MS } from './host/sheet.js';
import { moveSeedOf, earnSeedOf, earnSaidOf, subWalletSeedOf } from './host/sheet-money.js';
import { startSellMany } from './host/sell-many.js';
import { limitSeedOf, grantOf, keyfileAskOf, reachAskOf, letDeviceSeedOf, paperSeedOf, signOutSeedOf, connectOptionOf, isWalletOption } from './host/sheet-view.js';
import { startTrade } from './host/trade.js';
import { startSearch } from './host/search.js';
import { tradeableOf } from './host/trade-view.js';
import { indexedDbKeys, memoryKeys, signedOutFlag } from './wire/key-store.js';
import { firstOpen } from './host/sessions.js';
import { createAccountStream } from './wire/account-stream.js';
import { discoverWallets, proveWallet } from './wire/wallet.js';
import { startWalletSend, settleWalletFlight } from './host/wallet-send.js';

export const PREFS_KEY = 'gravit-ui.prefs';
// how long a press may hold renders: a click lands well inside it, and a release that never arrives cannot freeze the page
export const POINTER_HOLD_MS = 1000;
// how long the Markets search box must be quiet before its reads go: one read for a word typed, not one a keystroke
export const SEARCH_QUIET_MS = 300;
// how long after the last dragover the drop overlay goes: dragover fires all the while files are over the page, so its
// silence is the leave (a dragleave flickers between the page's own elements, and may never come)
export const DROP_QUIET_MS = 300;

// Gravit's words as the thread draws them: DOM-built markdown (wire/markdown.js returns {node, doc}), serialized for
// the string renderers
export const gravitMarkdown = text => renderMarkdown(text).node.outerHTML;

// a Mac names its keys ⌥⌘ (the list's search is ⌥⌘K there, Ctrl+Alt+K elsewhere): the platform the browser reports
export const isMac = win => /mac/i.test(String(win?.navigator?.userAgentData?.platform ?? win?.navigator?.platform ?? ''));

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
// the job open in Details still drawn: Details open, its row among the running or the finished not cleared
const jobShown = s => {
  if (!s.detailsOpen) return false;
  const v = jobsView(s.jobs, s.jobs.convId);
  return [...v.running, ...v.finished].some(j => j.id === s.jobs.open);
};
// the owner sheet is a drawer of any screen, over the one open (the order sheet is Trade's ticket, not a drawer)
const sheetUp = s => Boolean(s.sheet) && s.sheet.kind !== 'order';
// a history image's thumb as landed (a blob: URL, null for one the host could not give), undefined while it reads — by the
// store's own key alone, so an id like `constructor` reads nothing of Object.prototype
const thumbOf = (s, id) => (typeof id === 'string' && s.thumbs && Object.hasOwn(s.thumbs, id) ? s.thumbs[id] : undefined);
// the lightbox over the page: open on Messages on a thumb that is an image's URL (isImageSrc; the host's thumbs are blob: URLs)
const lightboxOf = s => {
  if (!s.lightbox || s.route.screen !== 'messages') return null;
  const src = thumbOf(s, s.lightbox.attachmentId);
  return isImageSrc(src) ? { src, name: s.lightbox.name } : null;
};
// a module card's Run sheet is a drawer of any screen too, drawn after the owner sheet
const overlayOf = s => (sheetUp(s) ? 'sheet' : s.sellMany || s.runSheet || s.lunhui?.stock || s.detailsOpen || s.settingsOpen || s.account.statementOpen || s.account.detailsVenue ? 'drawer' : null);
const drawerOf = s => (sheetUp(s) ? `sheet:${s.sheet.kind}` : s.sellMany ? 'sellMany' : s.runSheet ? `run:${s.runSheet.module}` : s.lunhui?.stock ? `stock:${s.lunhui.stock.code}` : s.detailsOpen ? 'details' : s.settingsOpen ? 'settings' : s.account.statementOpen ? 'statement'
  : s.account.detailsVenue ? `venue:${s.account.detailsVenue}` : null);
// the editor an event landed in: #say itself, or a node inside it (a paste's target can be a line's block)
const sayOf = el => (el?.id === 'say' ? el : el?.closest?.('#say') ?? null);
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
  // the composer's editor (div#say, contenteditable): the only code that reads or writes its nodes
  const editor = host.editor ?? makeEditor(doc);
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
  const sellMany = startSellMany({ store, getJson, owner, sendOrder: o => sendFromWallet(walletSend.order(o)), afterAction, now });
  // a receipt reloads the Account's read past the cache, and one from the Account seat (every receipt the kind table
  // lifts today) the seat's standing too
  const live = startLive({ store, openMux: host.openMux ?? wireOpenMux, call, mapFrame, getJson, timers, now, atTail: id => atTail(id), onReceipt: m => { if (m?.data?.seat) void seat.load({ fresh: true }); void account.load({ fresh: true }); } });
  // answers go through the live layer, which settles the gate it delivered once the answer wins; a command opens a cold
  // conversation through it first
  // the open conversation's background jobs (spec §5.8): its job/list on the live layer's mux, re-opened on the app's
  // timers after a host end or refusal; the open job's output stays there and is written into its pre on each frame
  const jobs = host.jobs ?? startJobs({ store, mux: live.mux, call, timers, onOutput: () => writeOutput() });
  const actions = makeActions({ store, call, answerGate: (eventId, value) => live.answer(eventId, value), postJson, activate: id => live.activate(id) });
  // Markets: the Account's reads on the app's timers — the A shares' among them — a market's page followed on the stream; the
  // stars in this browser's storage
  const markets = startMarkets({ store, storage, getJson, win, now, stream, schedule, cancelTimer, owner, afterAction });
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
  // the list's search: the box's words in the store at once, the face's index read once the box is quiet
  const convSearch = startSearch({ store, getJson, timers });
  const mac = isMac(win);
  // a room member's trace, read without activating the member's session
  const traces = startTraces({ store, call, loadMemberTrace, now });
  // the quotes, and the desk's status, run only while Markets is on screen in a visible tab; Trade's picks only while Trade is
  const showMarkets = () => { const on = store.get().route.screen === 'markets' && !doc.hidden; markets.show(on); desk.show(on); };
  const showTrade = () => trade.show(store.get().route.screen === 'trade' && !doc.hidden);
  // the owner's keys act only for a page that signs (the renderers draw them for no other)
  const signs = () => store.get().owner.role === 'signs';

  // the composer's drafts (D8), in memory: one per conversation by its id, `new` for New message, `empty` with neither;
  // each its runs and its files (composer/files.js), the entry gone only when both are empty
  const drafts = new Map();
  const draftKey = s => (s.draft ? 'new' : currentConversation(s)?.id ?? 'empty');
  // Messages is the one screen with a composer (a conversation, New message, the empty state)
  const composerOn = s => s.route.screen === 'messages';
  // a conversation's draft, whose files upload to it as they are added; New message's (and the empty state's) wait (D10)
  const isConvKey = key => key !== 'new' && key !== 'empty';
  const runsOf = key => drafts.get(key)?.runs ?? [];
  const filesOf = key => drafts.get(key)?.files ?? [];
  const currentRuns = () => runsOf(draftKey(store.get()));
  const putDraft = (key, runs, files) => { if (runs.length || files.length) drafts.set(key, { runs, files }); else drafts.delete(key); };
  const setRuns = (runs, key = draftKey(store.get())) => putDraft(key, runs, filesOf(key));
  const setFiles = (files, key = draftKey(store.get())) => putDraft(key, runsOf(key), files);
  // the attachments' reads: the image limits, a file's upload to its session, a history thumb (a test hands in its own)
  const attachments = host.attachments ?? startAttachments({ call, store, win, now });
  let connected = false;   // the live layer's link as the store last said: a reconnect frees the thumb reads a fence stopped
  let limitsRead = false;   // the image limits, read on opening a conversation until a read succeeds
  let dropTimer = null;     // the drop overlay's watchdog
  // the line above the box by draft key: a refusal of the files added, cleared by the next add or remove under that key
  const notes = new Map();
  // the uploads in flight by draft key and file key, each its handle: a landing whose handle is gone (removed, retried)
  // takes nothing
  const uploads = new Map();
  const uploadKey = (key, fileKey) => `${key}\n${fileKey}`;
  let fileSeq = 0;
  // the conversations whose model refused an image (D19), until a reload: an image added there, or sent, draws the model
  // line at once and calls nothing
  const refusesImages = new Set();
  // the model line for a conversation: in a bot's own conversation the bot's name stands for Gravit
  const modelLineFor = id => {
    const s = store.get();
    const conv = s.conversations.find(c => c.id === id);
    return modelRefusalLine(conv?.kind === 'bot' && conv.preset ? senderName(conv.preset, s) : 'Gravit');
  };
  // the / and @ menus: the menu drawn under the editor (null when none shows), the trigger it stands on, and a sequence
  // that every tick and every close moves on, so a read's late answer draws only for the trigger it was asked for
  let menu = null;
  let menuSeq = 0;
  let menuTrig = null;     // {kind, from, query, atStart, key}: the token before the caret the menu follows
  let menuFiles = null;    // the files answer for menuTrig's query: {query, items}
  let dismissed = null;    // the trigger Esc closed: it stays closed until the token changes
  let menuSource = 0;      // moves on when a trigger opens anew (its kind, its place or its draft) and on every close: the
                           // commands, skills and roster are read once per source, and their answer draws while it stands
  const menuShowsRows = () => !!menu && flatItems(menu).length > 0;
  const composerReads = host.composerReads ?? startComposerReads({ call, getJson, postJson });
  let composing = false;
  let pressedItem = null;   // the menu row under the last press, as it read then (menuPick)
  let pressed = false;   // a primary press is down: a render now would replace the element the click is aimed at
  let pending = false;
  let openedId = null;   // the conversation the live layer was told to open
  let detailsAt = null;  // the Details section the next render scrolls into view (a pill names Usage), then cleared
  let was = null;        // the route follow() last settled: entering a screen, a tab or a market's page reads what it draws
  let wanted = null;     // a deep link the list has not answered yet
  let searchTimer = null;   // the Markets search waiting for the box to be quiet
  let tradeTimer = null;    // Trade's search, the same
  let ticketAsked = null;   // a market page's Buy or Sell on its way to Trade: the side follow() opens the ticket with
  let sheetOpens = 0;       // the sheets opened so far: a read a sheet waits on opens none over one opened since
  let sheetKind = null;     // the kind of the sheet open as the store last changed: which one a close closed
  let orderFields = null;   // the ticket's order sheet's fields as they last stood, for when another sheet took its place
  let lightFrom = null;     // the image key the lightbox opened from: focus goes back to it on closing
  // the operator's keys shown through their eye, as `<convId>|<msgId>|<n>` (render/thread.js): the page's, not the store's,
  // and forgotten once their conversation leaves the screen (D26)
  const revealed = new Set();
  let last = { lightbox: false, overlay: null, opener: null, under: null, screen: null, drawer: null, thread: null, start: null, anchor: null, editor: null, confirm: null, query: '', key: null };
  let confirmFrom = null;
  // the turn rail's page state (D22): the turn the view is on, the hovered or focused tick, the tick pulsing while its
  // pages load and the jump waiting for its mark; forgotten once the conversation leaves the screen
  const freshRail = () => ({ active: null, hover: null, pulse: null, jump: null });
  let rail = freshRail();
  let railSeen = null;      // the rail's inputs as last measured: the conversation, its outline, its window's start and more
  let railTimer = null;     // a scroll's measure, coalesced
  let railDrawing = false;  // the rail's own redraw takes its focused tick away and gives it back: no hover change meanwhile
  let refocusing = false;   // render() putting focus back where it was: not a person's focus, no card for it
  let clockTimer = null;    // the jobs' ticking clocks in Details, written each second without a render while one is drawn
  let railHeld = false;     // a rail redraw asked for while a press is down: drawn when it lets go
  let searchFocus = false;  // ⌥⌘K from a screen with no list: the box takes focus once Messages draws it
  let rowsAt = null;        // where the groups last stood: a query hides them, and they come back there when it clears (spec §5.1)

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
    // a menu stands on its own draft's trigger: another draft on screen (another conversation, New message) closes it
    if (menuTrig && menuTrig.key !== draftKey(s)) { forgetMenu(); dismissed = null; }
    // what the person had: focus and caret, typed text, picked radios, and where each scrolling box stood
    const active = doc.activeElement;
    const activeKey = focusKey(active);
    const caret = active && active.id !== 'say' && typeof active.selectionStart === 'number' && (active.id || active.name) ? [active.selectionStart, active.selectionEnd] : null;
    // the editor's selection while it has focus, and whose draft it showed: it comes back on that same draft; another
    // draft put on screen under the focus has its caret at the end
    const say0 = doc.getElementById('say');
    const saySel = say0 && active === say0 ? editor.selection(say0) : null;
    const key = draftKey(s);
    const sameKey = key === last.key;
    const typed = new Map([...root.querySelectorAll('input[id]:not([type=radio]):not([type=checkbox]):not([type=file]), textarea[id], select[id]')].map(el => [el.id, el.value]));
    const ticked = [...root.querySelectorAll('input[id]')].filter(el => (el.type === 'radio' || el.type === 'checkbox') && el.checked).map(el => el.id);
    const thread0 = doc.getElementById('thread');
    const threadAt = thread0 ? { top: thread0.scrollTop, height: thread0.scrollHeight, bottom: thread0.scrollHeight - thread0.scrollTop - thread0.clientHeight < 40 } : null;
    // the scroll keep's anchor: the message drawn first at the anchor seq last time, where it stood, and the document's
    // scroll (a narrow window scrolls the page, not the thread)
    const docAt = doc.scrollingElement?.scrollTop ?? null;
    const scrolls = { main: root.querySelector('main')?.scrollTop, rows: root.querySelector('.rail-rows')?.scrollTop, results: root.querySelector('.conv-results')?.scrollTop, drawer: root.querySelector('.drawer-body')?.scrollTop };
    if (scrolls.rows != null) rowsAt = scrolls.rows;
    // a disclosure the person opened (its Raw, a trace; tool calls are stored but not drawn) is the page's, not the store's: open again by its id
    // (a job's disclosure is the store's: open while it is the job open, never kept open by the page)
    const opened = [...root.querySelectorAll('details[id][open]')].map(el => el.id).filter(id => !id.startsWith('jobd-'));
    // the open job's output block: the node stays across renders (its text, up to 256K characters, is never rewritten
    // and laid out afresh by a render), its scroll put back once it is in place again
    const out0 = s.jobs.open !== null ? doc.getElementById(`jobout-${s.jobs.open}`) : null;
    const outTop = out0 ? out0.scrollTop : null;
    // the note above the box is a live region: the node stays across renders, so a new line in it is announced
    const note0 = doc.getElementById('composer-note');
    const noteText = notes.get(key) ?? '';
    // the conversation on screen: another one (or none) than at the last render masks every key again
    const open = s.route.screen === 'messages' ? currentConversation(s) : null;
    const threadSig = open ? open.id : null;
    const threadStart = open?.window?.start ?? null;
    // the anchor seq stays on the message it marked while earlier pages land above it (the start falls or holds); a new
    // conversation, or a start that rose (a window taken whole), anchors on the window's first message again
    const anchorSeq = threadStart === null ? null : threadSig === last.thread && last.anchor !== null && last.start !== null && threadStart <= last.start ? last.anchor : threadStart;
    // the anchor's place is read (a layout) only when earlier pages can have landed: the same conversation, its start fallen
    const prepended = threadAt !== null && threadSig !== null && threadSig === last.thread && threadStart !== null && last.start !== null && threadStart < last.start;
    const anchorAt = prepended ? root.querySelector('[data-anchor]')?.offsetTop ?? null : null;
    if (threadSig !== last.thread) { revealed.clear(); rail = freshRail(); }

    const screen = s.route.screen === 'markets' ? renderMarketsScreen(s, now()) : s.route.screen === 'account' ? renderAccountScreen(s, now())
      : s.route.screen === 'trade' ? renderTradeScreen(s, now())
      : s.route.screen === 'channel' ? renderChannelScreen(s, now()) : s.route.screen === 'discover' ? renderDiscover(s, now())
      : s.route.screen === 'plugin' ? renderPlugin(s) : s.route.screen === 'module' ? renderModule(s, now()) : renderMessagesScreen(s, now(), { menu, files: filesOf(key), note: noteText }, { revealed, anchor: anchorSeq, rail });
    // the drawers of any screen, inside its <main>: Settings, the stock drawer, the owner sheet over whatever is open, a module card's Run sheet
    const drawers = (s.settingsOpen ? renderSettings(s) : '') + stockDrawerHtml(s) + (s.sellMany ? renderSellMany(s) : '') + (sheetUp(s) ? renderSheet(s, now()) : '') + (s.runSheet ? renderRunSheet(s, now()) : '');
    // files dragged over a screen with a composer: the drop overlay over the page
    const overlayHtml = s.dropping && composerOn(s) ? dropOverlay(attachments.limits()) : '';
    // an operator image at full size, over everything (D34: Esc closes it after a menu)
    const lit = lightboxOf(s);
    const lightHtml = lit ? lightboxHtml(lit) : '';
    root.innerHTML = renderRail(s, now(), { mac }) + (drawers ? screen.replace(/<\/main>$/, drawers + '</main>') : screen) + overlayHtml + lightHtml;
    const note1 = doc.getElementById('composer-note');
    if (note0 && note1 && note0 !== note1 && typeof note1.replaceWith === 'function') note1.replaceWith(note0);
    // the open job's output in place before any scroll keep: drawn empty it is hidden, and the drawer's keep would be
    // clamped to a body ~320 px shorter. The kept node is put back; a pre drawn for the first time is filled
    const out1 = s.jobs.open !== null ? doc.getElementById(`jobout-${s.jobs.open}`) : null;
    const outKept = out0 !== null && out1 !== null;
    if (outKept && out0 !== out1 && typeof out1.replaceWith === 'function') out1.replaceWith(out0);
    if (outKept) out0.scrollTop = outTop;
    writeOutput(!outKept);
    const noteEl = doc.getElementById('composer-note');
    if (noteEl && noteEl.textContent !== noteText) noteEl.textContent = noteText;
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
    const endOf = saySel === null ? null : lengthOf(currentRuns());
    const keep = saySel === null ? null : sameKey ? saySel : [endOf, endOf];
    if (say) editor.write(say, currentRuns(), keep?.[0] ?? null, keep?.[1]);

    // scroll: the rows keep their place; the page keeps its place on the same screen; a drawer while it stays the same drawer
    const sameScreen = last.screen === screenOf(s);
    const rows = root.querySelector('.rail-rows');
    const rowsTop = scrolls.rows ?? rowsAt;
    if (rows && rowsTop != null) rows.scrollTop = rowsTop;
    // the results while the same query stands (a stream frame, a pin, a list refresh, the content answer); a new query starts at the top
    const hits = root.querySelector('.conv-results');
    const query = s.search?.query ?? '';
    if (hits && scrolls.results != null && query === last.query) hits.scrollTop = scrolls.results;
    const main = root.querySelector('main');
    if (main && sameScreen && scrolls.main != null) main.scrollTop = scrolls.main;
    const drawerBody = root.querySelector('.drawer-body');
    if (drawerBody && last.drawer && last.drawer === drawerOf(s) && scrolls.drawer != null) drawerBody.scrollTop = scrolls.drawer;
    // a section asked for (a pill's Usage): scrolled to after the drawer's own keep, once
    if (detailsAt !== null) {
      doc.getElementById(detailsAt)?.scrollIntoView?.({ block: 'start' });
      detailsAt = null;
    }
    // the thread stays where the person was reading while they read up, however much arrives; at the bottom, or on
    // another conversation, it follows the tail. Earlier pages landed above (the window's start below the one last drawn)
    // keep the words under the reader where they were, at the bottom too: the top moves down by how far the anchored
    // message moved (by what was added when no anchor was drawn), so a frame coalesced below with the page moves nothing
    const thread = doc.getElementById('thread');
    const sameThread = threadAt && threadSig === last.thread;
    const anchorNow = prepended ? root.querySelector('[data-anchor]')?.offsetTop ?? null : null;
    const added = !prepended ? 0 : anchorAt !== null && anchorNow !== null ? anchorNow - anchorAt : thread ? thread.scrollHeight - threadAt.height : 0;
    if (thread) thread.scrollTop = prepended ? threadAt.top + added : sameThread && !threadAt.bottom ? threadAt.top : thread.scrollHeight;
    // a thread that does not scroll (as tall as what it holds): the document carries the keep
    if (prepended && thread && docAt !== null && thread.scrollHeight <= thread.clientHeight) doc.scrollingElement.scrollTop = docAt + added;

    // focus: back on the same control; into a drawer (or the sheet) that just opened; back to its opener when it closes — a sheet
    // opened over a drawer keeps that drawer's opener under it, for when the drawer closes in its turn
    const overlay = overlayOf(s);
    let opener = last.opener;
    let under = last.under;
    let target = find(activeKey);
    // the lightbox first: its close key takes focus on opening and keeps it while it stands (it is the one key inside); on
    // closing, focus goes back to the image it opened from. The drawers under it keep their openers untouched
    const lightUp = lightHtml !== '';
    if (lightUp) {
      if (!last.lightbox && !lightFrom) lightFrom = activeKey;
      target = root.querySelector('.lightbox-close') ?? target;
    } else if (last.lightbox) {
      target = find(lightFrom) ?? (overlay ? root.querySelector(closeKeyOf(overlay)) : say) ?? target;
      lightFrom = null;
      // a drawer that went with it (nav closes both) leaves no opener behind
      if (!overlay) { opener = null; under = null; }
    } else if (overlay && overlay !== last.overlay && last.overlay !== 'sheet') {
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
    if (searchFocus && doc.getElementById('cq')) { target = doc.getElementById('cq'); searchFocus = false; }
    if (target) {
      // the same control focused again, or the composer after the earlier key went: never scrolled into view (the thread's
      // keep above stands)
      const still = target === find(activeKey) || (target === say && activeKey?.id?.startsWith('earlier-'));
      refocusing = true;
      try {
        if (still) target.focus({ preventScroll: true }); else target.focus();
      } finally {
        refocusing = false;
      }
      if (caret && target === find(activeKey) && typeof target.setSelectionRange === 'function') target.setSelectionRange(caret[0], caret[1]);
      // focus can move a contenteditable's caret: the editor's goes back where write put it
      if (target === say && keep !== null) editor.place(say, keep[0], keep[1]);
    }
    // the rail: a jump waiting for its mark scrolls to it once drawn; inputs changed (another conversation, its outline, its
    // window) measure the turn the view is on once
    railHeld = false;   // the page just drew the rail as it stands
    let railStale = false;
    if (rail.jump && rail.jump.conv === threadSig) {
      const mark = doc.getElementById(`tmark-${threadSig}-${rail.jump.turn}`);
      if (mark) {
        toMark(mark);
        rail.jump = null;
        rail.pulse = null;
        railStale = true;
      }
    }
    const inputs = open ? [open.id, open.outline, open.window?.start, open.window?.hasMore] : null;
    // (inputs that could not be measured, as under the draft screen, are not taken as seen: measured once they can be)
    if (inputs ? !railSeen || inputs.some((v, i) => !Object.is(v, railSeen[i])) : railSeen !== null) {
      const moved = measureRail();
      if (moved !== null || !inputs) railSeen = inputs;
      if (moved) railStale = false;
    }
    if (railStale) drawRail();
    last = { lightbox: lightUp, overlay, opener, under, screen: screenOf(s), drawer: drawerOf(s), thread: threadSig, start: threadStart, anchor: anchorSeq, editor: editorOf(s.edit), confirm: s.confirm, query, key };
    // the clocks ticking while a live job is drawn
    tickClocks(false);
    // a composed answer drawn without its run's view asks for it now that the page is whole (its dispatches render again)
    if (wantedViews(store.get()).length) void ensureViews(store, getJson);
    // the operator's images the thread drew still to read: each asked once (thumb keeps its own in-flight set), its answer
    // landing through the store (hostThumb), which draws it
    if (open) for (const t of thumbsNeeded(open, s.thumbs)) void attachments.thumb(t.sessionId, t.attachmentId);
  }

  // the open job's output into its pre by textContent, never through a render: on each frame, and once into a pre a render
  // drew for the first time (fill: false, a render that put its kept pre back, writes none); and the line under it once its
  // follow is over while the job runs on or the host refused it. A pre at its end follows the end; one the reader scrolled
  // up keeps its place
  function writeOutput(fill = true) {
    const s = store.get();
    const id = s.jobs.open;
    if (id === null) return;
    const out = jobs.outputOf(id);
    const pre = fill ? doc.getElementById(`jobout-${id}`) : null;
    if (pre) {
      const text = out?.text ?? '';
      const tail = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 24;
      if (pre.textContent !== text) pre.textContent = text;
      if (tail) pre.scrollTop = pre.scrollHeight;
    }
    const note = doc.getElementById(`jobnote-${id}`);
    if (note) {
      const row = s.jobs.rows.find(j => j.id === id);
      const line = out?.error !== undefined ? `output unavailable: ${out.error}` : out?.ended && isLive(row) ? 'output ended' : '';
      if (note.textContent !== line) note.textContent = line;
    }
  }
  // the clocks: each [data-job-clock] span's time to now, every second, never a render; the loop ends once none is drawn.
  // A render starts it (not ticking) when it drew one and none runs
  function tickClocks(tick = true) {
    if (!tick && clockTimer !== null) return;
    const spans = [...root.querySelectorAll('[data-job-clock]')];
    if (!spans.length) { clockTimer = null; return; }
    if (tick) for (const el of spans) {
      const text = clockText(now() - Number(el.dataset.jobClock));
      if (el.textContent !== text) el.textContent = text;
    }
    clockTimer = timers.after(1000, () => tickClocks(true));
  }

  // the turn rail alone, never the page (a scroll, a hover, a pulse): its focused tick keeps focus by its id
  const railConv = () => { const s = store.get(); return s.route.screen === 'messages' && !s.draft ? currentConversation(s) ?? null : null; };
  function drawRail() {
    if (pressed) { railHeld = true; return; }   // as a render is held: the press's click must find its element
    const el = doc.getElementById('turn-rail');
    if (!el) return;
    const focused = doc.activeElement?.id?.startsWith?.('turn-tick-') ? doc.activeElement.id : null;
    const conv = railConv();
    railDrawing = true;
    try {
      el.innerHTML = conv ? railHtml(conv, rail) : '';
      if (focused) doc.getElementById(focused)?.focus({ preventScroll: true });
    } finally {
      railDrawing = false;
    }
  }
  // the turn the view is on, from the marks' places in the thread; the rail redrawn when it moved (true then; null when
  // nothing could be measured: no thread, or no conversation on screen)
  function measureRail() {
    const thread = doc.getElementById('thread');
    if (!thread || !railConv()) return null;
    const marks = [...root.querySelectorAll('.turn-mark')].map(el => ({ turn: Number(el.dataset.turn), top: el.offsetTop }));
    const on = activeTurn(marks, thread.scrollTop);
    if (on === rail.active) return false;
    rail.active = on;
    drawRail();
    return true;
  }
  // a turn's mark at the top of the view, at once: a smooth scroll is cut short by the next render (its write replaces the
  // thread mid-glide, and the keep, finding it neither at the tail nor where the glide ends, may snap back to the tail)
  function toMark(mark) {
    mark.scrollIntoView?.({ block: 'start' });
  }
  // the reader at the tail of the conversation on screen (live.js drops earlier pages as a turn starts there): the thread's
  // own scroll, or the document's where the thread does not scroll (a narrow window)
  function atTail(id) {
    if (railConv()?.id !== id) return false;
    const thread = doc.getElementById('thread');
    if (!thread) return false;
    const el = thread.scrollHeight > thread.clientHeight ? thread : doc.scrollingElement;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }
  function hoverRail(turn) {
    if (railDrawing || turn === rail.hover) return;
    rail.hover = turn;
    drawRail();
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
    else if (railHeld) timers.after(0, () => { if (railHeld && !pressed) { railHeld = false; drawRail(); } });
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
    // ⌥⌘K's focus waits only for the list it was asked on: a route without one forgets it
    if (r.screen !== 'messages' && r.screen !== 'channel') searchFocus = false;
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
    // the jobs of the conversation on Messages; no screen else watches any
    jobs.watch(r.screen === 'messages' && r.id && r.id !== 'new' ? r.id : null);
    if (r.screen === 'messages' && r.id && r.id !== 'new' && r.id !== openedId) {
      openedId = r.id;
      live.open(r.id);
      if (!limitsRead) void attachments.readLimits(r.id).then(ok => { if (ok === true) limitsRead = true; });
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
  // Details open (never closed by this) at a section: the next render scrolls it into view; Details open already changes
  // no state, so a render is asked for to carry the scroll
  function openDetailsAt(section) {
    detailsAt = section;
    const before = store.get();
    if (store.dispatch('openDetails') === before) requestRender();
  }

  // Yes, stop: the job reads Stopping at once (no second Stop to send a second kill), focus on that Stopping; running
  // again if the host refused it
  async function stopJobNow(convId, id) {
    store.dispatch('markJob', { id, from: 'running', to: 'stopping' });
    if (!(await jobs.kill(convId, id))) store.dispatch('markJob', { id, from: 'stopping', to: 'running' });
  }

  function confirmYes() {
    const c = store.get().confirm;
    if (!c) return;
    // Stop's job marked stopping first: that drops the confirm, and focus goes back to the job's Stopping
    if (c.action === 'stopJob') { confirmFrom = { id: `job-stopping-${c.id}` }; void stopJobNow(c.conv, c.id); }
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

  // the draft on screen, serialized against its conversation's channel (or New message's Where), cleared as it goes; a
  // failure puts the whole draft, chips and files and all, back under the key it came from. Each refusal before the call
  // keeps the draft as it stands. restaged: this send follows the re-upload of a receipt the host dropped (D18)
  async function sendNow({ restaged = false } = {}) {
    const s = store.get();
    const key = draftKey(s);
    const runs = runsOf(key);
    const files = filesOf(key);
    if (isBlank(runs) && !files.length) return;
    const refuse = line => store.dispatch('hostStatus', { line, bad: true });
    // the empty state (no conversation, no New message) has nowhere to send: said, the draft kept as it stands
    if (key === 'empty') { refuse('Open a conversation first'); return; }
    // the room is a bot chip's, or an @ the operator typed (a chip reads as a space between words): a file or
    // conversation chip's @ never sends to it alone. Files go to Gravit alone (D20): a bot chip with them is refused, and
    // a typed @word beside them is a prompt
    const toBot = hasChip(runs, 'bot');
    if (files.length && toBot) { refuse("Files go to Gravit, not to a room's bots"); return; }
    const room = !files.length && (toBot || isMentionText(runs.map(r => (r.type === 'text' ? r.text : ' ')).join('')));
    // a room's bots cannot read a conversation chip (O9): a draft bound for the room with one is refused, kept as it stands
    const toRoom = toBot || (room && !s.draft && !!currentConversation(s)?.channel);
    if (toRoom && hasChip(runs, 'conversation')) { refuse("Conversations go to Gravit, not to a room's bots"); return; }
    // a file not up yet (one New message moved here, a receipt being staged again) uploads now and holds the send too
    const waiting = isConvKey(key) ? files.filter(f => f.kind === 'file' && f.status === 'ready') : [];
    for (const f of waiting) startUpload(key, f.key);
    const held = blocking(filesOf(key));
    if (held) { refuse(held === 'uploading' ? 'Files are still uploading' : 'A file did not upload. Retry it or remove it.'); if (waiting.length) render(); return; }
    if (isConvKey(key) && refusesImages.has(key) && hasImage(files)) { notes.set(key, modelLineFor(key)); render(); return; }
    const workspaceId = s.draft ? s.draft.where : currentConversation(s)?.channel?.workspaceId ?? null;
    const text = serialize(runs, serialContext({ channels: s.channels, workspaceId })).trim();
    // a / line with files: a command the kept rows know takes them only when its input says so (D12); a name the rows do
    // not know is the host's to judge
    if (!s.draft && files.length && text.startsWith('/')) {
      const name = text.slice(1).split(/\s/)[0];
      const row = (composerReads.keptCommands(currentConversation(s)) ?? []).find(r => r.name === name);
      if (row && row.input?.attachments !== true) { refuse(`/${name} takes no files`); return; }
    }
    // words and files added under the key while the send was on its way are kept, after the sent ones (A7)
    const back = () => {
      const since = runsOf(key);
      putDraft(key, isBlank(since) ? runs : normalize([...runs, { type: 'text', text: '\n' }, ...since]), [...files, ...filesOf(key)]);
      render();
    };
    const sentOff = to => { for (const f of files) if (f.url) win.URL.revokeObjectURL(f.url); notes.delete(to); };
    let reason;
    const attachmentRefused = r => { reason = r ?? ''; };
    // the draft clears before anything is awaited: a second Enter meanwhile finds it blank and sends nothing
    putDraft(key, [], []);
    forgetMenu();
    render();
    // the images' bytes; a failed read puts the draft back
    const data = new Map();
    for (const f of files) {
      if (f.kind !== 'image') continue;
      try { data.set(f.key, encodeBase64(new Uint8Array(await f.blob.arrayBuffer()))); } catch { back(); refuse(`send: ${f.name} could not be read`); return; }
    }
    // the draft left the screen during the read: it goes back under its key, unsent (the send goes to the screen's)
    if (data.size && draftKey(store.get()) !== key) { back(); return; }
    const parts = contentParts('', files, k => data.get(k));
    if (s.draft) {
      // New message: the draft moves to the conversation as it is made, its files upload there, then the first words
      const got = await actions.newConversationWith({
        title: s.draft.title, workspaceId: s.draft.where, text, attachmentRefused,
        onCreated: id => {
          putDraft(id, runs, files);
          if (notes.has(key)) { notes.set(id, notes.get(key)); notes.delete(key); }
        },
        prepare: async id => {
          const ups = await Promise.all(filesOf(id).filter(f => f.kind === 'file').map(f => startUpload(id, f.key)));
          if (!ups.every(Boolean)) return null;
          const staged = filesOf(id).filter(f => files.some(g => g.key === f.key));
          return contentParts('', staged, k => data.get(k));
        },
      });
      if (!got.id) { back(); return; }
      if (got.sent) { putDraft(got.id, [], filesOf(got.id).filter(f => !files.some(g => g.key === f.key))); sentOff(got.id); }
      else refused(got.id, reason);
      await live.refresh();
      go({ screen: 'messages', id: got.id });
      live.promote(got.id);
      return;
    }
    const sent = await sendText(text, { room, attachments: parts, attachmentRefused });
    if (sent) { sentOff(key); render(); return; }
    back();
    if (RESTAGED.has(reason) && !restaged) { void restage(key, reason); return; }
    refused(key, reason);
  }
  // the refusals that mean the host dropped a receipt: the prompt's, and a command's
  const RESTAGED = new Set(['FILE_NOT_STAGED', 'ATTACHMENT_NOT_FOUND']);
  // a refusal of a draft's attachments, its draft already back: an image on a text-only model marks the conversation and
  // draws the model line; any other reason is said on the status line
  function refused(key, reason) {
    if (reason === undefined) return;
    if (reason === 'MODEL_DOES_NOT_SUPPORT_IMAGES') { refusesImages.add(key); notes.set(key, modelLineFor(key)); }
    else store.dispatch('hostStatus', { line: `send: session/attachment-invalid${reason ? ` (${reason})` : ''}`, bad: true });
    render();
  }
  // a receipt the host dropped (the face restarted, the agent was disposed): every file up uploads again, once, and the
  // send runs once more while its draft is still on screen; a failed re-upload keeps the draft and says so
  // (a command says the second as ATTACHMENT_NOT_FOUND); off screen, the files are up and the send waits for the operator
  async function restage(key, reason) {
    const ups = filesOf(key).filter(f => f.kind === 'file' && f.status === 'up');
    const oks = await Promise.all(ups.map(f => startUpload(key, f.key)));
    render();
    if (!oks.every(Boolean)) { refused(key, reason); return; }
    if (draftKey(store.get()) === key) await sendNow({ restaged: true });
    else store.dispatch('hostStatus', { line: 'Files uploaded again; the message was not sent', bad: true });
  }
  // words put in the composer for the operator (a suggestion, Hand to Gravit): the draft on screen, after what it holds on
  // a new line, the caret after them
  function putWords(words) {
    const had = currentRuns();
    const runs = isBlank(had) ? textDraft(words).runs : normalize([...had, { type: 'text', text: `\n${words}` }]);
    setRuns(runs);
    forgetMenu();
    render();
    const say = doc.getElementById('say');
    if (say) { say.focus(); editor.place(say, lengthOf(runs)); }
  }
  // one message to the open conversation by the composer's own path (the composer, the stock drawer's Ask, a follow-up): what
  // actions.send answers, the conversation promoted to a follow when it prompted; the composer's words are never touched
  async function sendText(text, opts) {
    const sent = await actions.send(text, opts);
    if (sent && (sent.sent === 'prompt' || sent.sent === 'say')) live.promote(sent.sessionId);
    return sent;
  }

  // ---- the draft's files: added (picked, pasted, dropped), uploaded on a conversation, removed, retried ----
  // the record under its own key by its file key, patched; false when it is gone (removed meanwhile), and nothing changes
  function patchFile(key, fileKey, patch) {
    const files = filesOf(key);
    if (!files.some(f => f.key === fileKey)) return false;
    setFiles(files.map(f => (f.key === fileKey ? { ...f, ...patch } : f)), key);
    return true;
  }
  // the rail of the draft on screen into #composer-files alone: a progress tick's write, never a page render
  function drawFiles() {
    const slot = doc.getElementById('composer-files');
    if (slot) slot.innerHTML = filesRail(filesOf(draftKey(store.get())));
  }
  // a file (never an image: it goes inline when sent) uploading to the session its draft belongs to; its ticks and its
  // landing go to that draft whatever is on screen, the ticks drawn only while it is the draft on screen. The caller
  // renders. Answers whether the file landed up (false when it failed, or gave way to a removal or a retry)
  function startUpload(key, fileKey) {
    const rec = filesOf(key).find(f => f.key === fileKey);
    if (!rec || rec.kind !== 'file' || !isConvKey(key)) return Promise.resolve(false);
    patchFile(key, fileKey, { status: 'uploading', loaded: 0 });
    const k = uploadKey(key, fileKey);
    uploads.get(k)?.abort();   // one upload a file: one still in flight gives way
    let handle = null;
    const mine = () => handle !== null && uploads.get(k) === handle;
    handle = attachments.upload(key, rec.blob, loaded => {
      if (!mine() || !patchFile(key, fileKey, { loaded })) return;
      if (key === draftKey(store.get())) drawFiles();
    });
    uploads.set(k, handle);
    const land = patch => {
      if (!mine()) return false;
      uploads.delete(k);
      if (!patchFile(key, fileKey, patch)) return false;
      render();
      return patch.status === 'up';
    };
    // a failure keeps its reason (not signed in, the fence's hint), said on the status line
    return handle.done.then(receiptId => land({ status: 'up', loaded: rec.bytes, receiptId, sessionId: key }), err => {
      const error = String(err?.message || `upload ${rec.name}: the upload failed`);
      if (mine()) store.dispatch('hostStatus', { line: error, bad: true });
      land({ status: 'failed', error });
      return false;
    });
  }
  // Files (a FileList, or the list a paste or a drop holds) into a draft: each admitted by the session's image limits, an
  // image with its object URL; a refusal is the key's note. On a conversation each file uploads at once
  function addFiles(list, key = draftKey(store.get())) {
    const picked = Array.from(list ?? []).map(f => ({ key: `a${++fileSeq}`, name: f.name, bytes: f.size, mediaType: f.type, blob: f }));
    if (!picked.length) return;
    const had = filesOf(key);
    const { files, refusal } = admit(had, picked, attachments.limits());
    const added = files.slice(had.length).map(f => (f.kind === 'image' ? { ...f, url: win.URL.createObjectURL(f.blob) } : f));
    setFiles([...had, ...added], key);
    // an image added where the model refused one says so at once (D19)
    const line = refusal ?? (isConvKey(key) && refusesImages.has(key) && hasImage(added) ? modelLineFor(key) : null);
    if (line) notes.set(key, line); else notes.delete(key);
    for (const f of added) startUpload(key, f.key);
    render();
  }
  // a file taken out of the draft on screen: its upload aborted, its image's URL revoked
  function removeFile(fileKey) {
    const key = draftKey(store.get());
    const rec = filesOf(key).find(f => f.key === fileKey);
    if (!rec) return;
    const k = uploadKey(key, fileKey);
    const handle = uploads.get(k);
    uploads.delete(k);
    handle?.abort();
    if (rec.url) win.URL.revokeObjectURL(rec.url);
    const left = filesOf(key).filter(f => f.key !== fileKey);
    setFiles(left, key);
    // the model line stays while an image it speaks of remains
    if (refusesImages.has(key) && hasImage(left)) notes.set(key, modelLineFor(key)); else notes.delete(key);
    render();
  }
  // words into the editor as a paste or a drop puts them: plain text over [from, to], the caret after them; no render
  function insertWords(say, words, from, to) {
    const runs = replaceRange(editor.read(say), from, to, words);
    setRuns(runs);
    editor.write(say, runs, from + words.length);
    menuTick();
  }
  const atEnd = say => { const n = lengthOf(editor.read(say)); return [n, n]; };
  const hasFiles = dt => Array.from(dt?.types ?? []).includes('Files');
  // an image dragged out of the thread carries its src as text: a data: or blob: URL is never words for the draft
  const isDataUrl = words => /^\s*(data|blob):/i.test(words);
  function stopDropping() {
    if (dropTimer !== null) { timers.cancel(dropTimer); dropTimer = null; }
    store.dispatch('setDropping', false);
  }

  // ---- the / and @ menus: opened, filtered and moved in #composer-menu alone, never by a page render ----
  const sameTrig = (a, b) => !!a && !!b && a.kind === b.kind && a.from === b.from && a.query === b.query && a.key === b.key;
  // the conversation the composer writes to (none on New message), its channel, and that channel's folder relative to the
  // root (undefined with no root, or a conversation in no channel)
  function menuContext(s) {
    const conv = s.draft ? null : currentConversation(s);
    const workspaceId = s.draft ? s.draft.where : conv?.channel?.workspaceId ?? null;
    const { repoRoot, cwd } = serialContext({ channels: s.channels, workspaceId });
    const root = repoRoot == null ? null : repoRoot.replace(/\/+$/, '');
    const dir = cwd == null ? null : cwd.replace(/\/+$/, '');
    const cwdRel = root == null || dir == null ? undefined : dir === root ? '' : dir.startsWith(`${root}/`) ? dir.slice(root.length + 1) : undefined;
    return { conv, workspaceId, root, cwdRel };
  }
  // a room's bots as last read: its roster, each with the bots list's line
  const botsOf = (s, conv) => (conv?.channel ? composerReads.keptRoster(conv.id) ?? [] : [])
    .map(r => ({ id: r.id, name: r.name ?? r.id, description: (s.bots ?? []).find(b => b.id === r.id)?.description ?? '' }));
  // the menu for the standing trigger from what is kept now; null when its rows come to nothing. An answer's rebuild keeps
  // the active row where it stood
  function buildMenu(keepActive) {
    const trig = menuTrig;
    if (!trig) { menu = null; return; }
    const s = store.get();
    const { conv, workspaceId, root } = menuContext(s);
    const groups = trig.kind === '/'
      ? slashItems({ commands: composerReads.keptCommands(conv), skills: composerReads.keptSkills(conv?.id), query: trig.query, atStart: trig.atStart })
      : atItems({
        bots: botsOf(s, conv),
        files: root != null && menuFiles?.query === trig.query ? menuFiles.items : null,
        conversations: conversationChoices(s.conversations.map(c => ({ ...c, workspaceId: c.channel?.workspaceId ?? null })), { exceptId: conv?.id ?? null, workspaceId, now: now() }),
        query: trig.query,
      });
    const next = { kind: trig.kind, from: trig.from, query: trig.query, groups, active: 0 };
    const n = flatItems(next).length;
    if (!n) { menu = null; return; }
    if (keepActive && menu) next.active = Math.min(menu.active, n - 1);
    menu = next;
  }
  // the menu into its slot, and the editor's attributes in step with it; never a page render
  function drawMenu() {
    const slot = doc.getElementById('composer-menu');
    if (slot) slot.innerHTML = renderMenu(menu);
    const say = doc.getElementById('say');
    if (!say) return;
    for (const [name, value] of Object.entries(menuAria(menu))) {
      if (value == null) say.removeAttribute?.(name); else say.setAttribute(name, value);
    }
  }
  // the menu forgotten, its reads' answers with it; drawn only by the caller (closeMenu) or the next render
  function forgetMenu() {
    menuSeq++;
    menuSource++;
    menuTrig = null;
    menuFiles = null;
    menu = null;
  }
  function closeMenu() {
    const had = menu;
    forgetMenu();
    if (had) drawMenu();
  }
  // after every keystroke in the editor and a caret move: the token before the caret opens, filters or closes the menu. `/`
  // opens on a conversation only (D10); `@` anywhere. The kept rows draw at once, and each read's answer redraws only while
  // the trigger it was asked for still stands (Review Focus 3)
  function menuTick() {
    const s = store.get();
    const say = doc.getElementById('say');
    const caret = say ? editor.caret(say) : null;
    const t = caret == null ? null : triggerAt(currentRuns(), caret);
    const { conv, root, cwdRel } = menuContext(s);
    const trig = t && (t.kind === '@' || conv) ? { ...t, key: draftKey(s) } : null;
    if (!trig) { dismissed = null; closeMenu(); return; }
    if (sameTrig(trig, dismissed)) return;   // Esc closed this very token
    dismissed = null;
    if (sameTrig(trig, menuTrig)) return;
    // a letter added to the query is the same source: its lists stand and only the files are read again
    const fresh = !menuTrig || menuTrig.kind !== trig.kind || menuTrig.from !== trig.from || menuTrig.key !== trig.key;
    const seq = ++menuSeq;
    const source = fresh ? ++menuSource : menuSource;
    if (menuFiles?.query !== trig.query || fresh) menuFiles = null;
    menuTrig = trig;
    buildMenu(false);
    drawMenu();
    // a list's answer draws with the query as it reads now, while its source stands; a files answer only for its own query
    const redrawSource = () => { if (source === menuSource && menuTrig) { buildMenu(true); drawMenu(); } };
    if (trig.kind === '/') {
      if (fresh) {
        void composerReads.commands(conv).then(redrawSource);
        void composerReads.skills(conv.id).then(redrawSource);
      }
      return;
    }
    if (root != null) {
      void composerReads.files(trig.query, cwdRel).then(answer => {
        if (!answer || seq !== menuSeq || menuTrig?.query !== trig.query) return;
        menuFiles = { query: trig.query, items: answer.items };
        buildMenu(true);
        drawMenu();
      });
    }
    if (fresh && conv?.channel) void composerReads.roster(conv.id).then(redrawSource);
  }
  // a row chosen: a skill or an argument command becomes `/name `, a bot, file or conversation its chip and a space, the
  // caret after them; `walk` (Tab on a folder) makes the token `@<path>/` and the menu follows it in. A command that takes
  // no arguments runs at once: its token leaves the draft, the rest stays
  function chooseItem(item, walk = false) {
    const say = doc.getElementById('say');
    const trig = menuTrig;
    if (!say || !trig || !item) return;
    const to = trig.from + 1 + trig.query.length;
    if (item.kind === 'command' && !item.takesArgs) {
      const id = menuContext(store.get()).conv?.id;
      const runs = replaceRange(currentRuns(), trig.from, to, []);
      setRuns(runs);
      editor.write(say, runs, trig.from);
      closeMenu();
      if (id) void actions.runCommand(id, `/${item.name}`);
      return;
    }
    let insert, caret;
    if (walk) { insert = `@${String(item.path).replace(/\/+$/, '')}/`; caret = trig.from + insert.length; }
    else if (item.kind === 'command' || item.kind === 'skill') { insert = `/${item.name} `; caret = trig.from + insert.length; }
    else { insert = [{ type: 'chip', chip: chipOf(item) }, { type: 'text', text: ' ' }]; caret = trig.from + 2; }
    const runs = replaceRange(currentRuns(), trig.from, to, insert);
    setRuns(runs);
    editor.write(say, runs, caret);
    closeMenu();
    if (walk) menuTick();
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
    pin: el => { void actions.pin(el.dataset.conv); },
    unpin: el => { void actions.unpin(el.dataset.conv); },
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
    // a pointer on a menu row chooses it (the press kept the editor's focus): the row under the press, though an answer
    // that landed before the click redrew the rows
    menuPick: el => {
      const item = pressedItem ?? (menu ? flatItems(menu)[Number(el.dataset.index)] : null);
      pressedItem = null;
      if (menu) chooseItem(item);
    },
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
    suggest: el => putWords(el.dataset.text),
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
    // a figures pill: Details open (never closed by it) at Usage; Details open already changes no state, so a render is asked
    // for to carry the scroll
    openUsage: () => openDetailsAt('dsec-usage'),
    // the jobs chip: Details open at Background jobs, the same way
    openJobs: () => openDetailsAt('dsec-jobs'),
    // a job's summary: opening it follows its output, closing it lets the follow go (the page toggled the disclosure
    // first, so its state says which; a summary outside one toggles the store's)
    openJob: el => {
      const s = store.get();
      const id = el.dataset.job;
      const want = el.parentElement?.tagName === 'DETAILS' ? el.parentElement.open : s.jobs.open !== id;
      if (!want) {
        if (s.jobs.open === id) { jobs.unfollow(); store.dispatch('closeJob'); }
        return;
      }
      const job = s.jobs.rows.find(j => j.id === id);
      if (!job) return;
      jobs.follow(s.jobs.convId, job);
      store.dispatch('openJob', id);
    },
    // Stop on a running job, asked twice (D23); Clear the finished ones on screen, the page's own until it reloads
    stopJob: el => store.dispatch('askConfirm', { action: 'stopJob', id: el.dataset.job, conv: el.dataset.conv }),
    clearJobs: el => store.dispatch('clearJobs', el.dataset.conv),
    // a rail tick: its mark drawn, scrolled into view (a drawn mark wins over the tick's loaded flag: a page cuts at a
    // message group, so the window's oldest turn can read unloaded with its prompt drawn); else the pages back to its
    // turn/start, the tick pulsing until render() draws its mark and scrolls to it. An answer that leaves the jump
    // waiting (none drawn, or the read refused) ends it; another conversation opened meanwhile dropped it already
    jumpTurn: el => {
      const conv = railConv();
      if (!conv) return;
      const turn = Number(el.dataset.turn);
      const markOf = () => doc.getElementById(`tmark-${conv.id}-${turn}`);
      const mark = markOf();
      if (mark) { toMark(mark); return; }
      const tick = railView(conv).ticks.find(t => t.turn === turn);
      if (!tick || tick.loaded) return;
      const jump = { conv: conv.id, turn };
      rail.pulse = turn;
      rail.jump = jump;
      drawRail();
      // a read already under way (Earlier messages) answers without reaching the turn: read on from it once more. The
      // jump ends here only when the read failed or nothing more lies before; else the render that draws the mark ends it
      // (a render held by a press runs later, and still finds the jump)
      const ask = () => live.earlier(conv.id, { toSeq: tick.seq });
      const reached = () => (store.get().conversations.find(c => c.id === conv.id)?.window?.start ?? -Infinity) <= tick.seq;
      void ask().then(ok => (ok && rail.jump === jump && !markOf() && !reached() ? ask() : ok)).then(ok => {
        if (rail.jump !== jump) return;
        if (ok && (markOf() || pending || composing || pressed)) return;
        rail.jump = null;
        rail.pulse = null;
        drawRail();
      });
    },
    // earlier history of the conversation on screen, a page before its window (never activating it, PLAN D16)
    earlier: el => {
      const w = store.get().conversations.find(c => c.id === el.dataset.conv)?.window;
      if (w?.loading) return;   // Loading…: aria-disabled, still focusable
      void live.earlier(el.dataset.conv);
    },
    openSettings: () => store.dispatch('openSettings'),
    closeSettings: () => store.dispatch('closeSettings'),
    setTheme: el => { const t = el.dataset.value.toLowerCase(); store.dispatch('setTheme', t); applyTheme(t); },
    // Account: Refresh (and Retry) — the page and the seat past the face's cache, the holdings —, the curve's range, a venue's
    // Details, the Statement (its lines read on opening it), its CSV
    refreshAccount: () => {
      void account.load({ fresh: true });
      void account.loadHoldings();
      void seat.load({ fresh: true });
    },
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
      go({ screen: 'messages', id: 'new' });
      putWords(`Look at ${asset.symbol}${asset.name && asset.name !== asset.symbol ? ` (${asset.name})` : ''}`);
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
    // the composer's files: the paperclip opens the hidden input (its change adds them), a card's ✕ and a failed one's Retry
    attachFiles: () => { doc.getElementById('attach-input')?.click(); },
    attachRemove: el => removeFile(el.dataset.key),
    attachRetry: el => { const key = draftKey(store.get()); startUpload(key, el.dataset.key); render(); },
    // a history image opens at full size once its thumb landed (a loading frame, or one drawn as a card, opens nothing); the
    // backdrop and × close it, a click on the image itself is kept
    openImage: el => {
      const id = el.dataset.attachment;
      if (!isImageSrc(thumbOf(store.get(), id))) return;
      // focus returns to the key pressed, which a click need not have focused (Safari focuses no clicked button)
      lightFrom = focusKey(el);
      store.dispatch('openLightbox', { attachmentId: id, name: el.dataset.name ?? '' });
    },
    // a key's eye in the operator's bubble shows or hides it (display only); its id keeps the focus on it as its label flips
    // (a reveal is lost when an optimistic bubble is re-keyed to its seq id: D26 accepts it)
    toggleSecret: el => {
      const open = currentConversation(store.get());
      const id = el.dataset.secret ?? '';
      const cut = id.lastIndexOf('-');
      if (!open || cut < 0) return;
      const k = `${open.id}|${id.slice(0, cut)}|${id.slice(cut + 1)}`;
      if (revealed.has(k)) revealed.delete(k); else revealed.add(k);
      requestRender();
    },
    lightboxClose: () => store.dispatch('closeLightbox'),
    lightboxKeep: () => {},
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
      // (a job's summary runs on closing too: it lets the follow go)
      if (!el.parentElement.open && el.dataset.action !== 'openJob') return;
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
    if (sayOf(el)) { setRuns(editor.read(sayOf(el))); menuTick(); }
    else if (el.dataset?.action === 'draftTitle') store.dispatch('setDraftTitle', el.value);
    else if (el.dataset?.action === 'mkQuery') { store.dispatch('setMarketsQuery', el.value); searchSoon(el.value); }
    else if (el.dataset?.action === 'tradeQuery') tradeSoon(el.value);   // trade.query moves the query (the box keeps the words)
    else if (el.dataset?.action === 'dq') store.dispatch('setDiscoverQuery', el.value);
    else if (el.dataset?.action === 'convQuery') convSearch.type(el.value);
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
  // the turn rail: the thread's scroll (it does not bubble: caught on the way down) measures the turn the view is on, one
  // measure per 80 ms; a pointer or focus on a tick shows its card, leaving the rail hides it
  root.addEventListener('scroll', ev => {
    if (ev.target?.id !== 'thread' || railTimer !== null) return;
    railTimer = timers.after(80, () => { railTimer = null; measureRail(); });
  }, true);
  const tickOf = el => el?.closest?.('.turn-tick') ?? null;
  const inRail = el => Boolean(el?.closest?.('#turn-rail'));
  root.addEventListener('mouseover', ev => { const t = tickOf(ev.target); if (t) hoverRail(Number(t.dataset.turn)); });
  root.addEventListener('mouseout', ev => { if (tickOf(ev.target) && !inRail(ev.relatedTarget)) hoverRail(null); });
  root.addEventListener('focusin', ev => { const t = refocusing ? null : tickOf(ev.target); if (t) hoverRail(Number(t.dataset.turn)); });
  // (a focused tick a page write took out of the document fires a focusout too, in Chrome: not the focus leaving)
  root.addEventListener('focusout', ev => { if (!refocusing && ev.target?.isConnected !== false && tickOf(ev.target) && !inRail(ev.relatedTarget)) hoverRail(null); });
  root.addEventListener('change', ev => {
    const el = ev.target;
    if (el.tagName === 'SELECT' && el.dataset?.action === 'draftWhere') {
      if (el.value === '__new') store.dispatch('startEdit', { kind: 'newChannel' }); else store.dispatch('setDraftWhere', el.value);
    }
    if (el.type === 'checkbox' && el.name === 'roster') store.dispatch('toggleRosterTick', { value: el.value, on: el.checked === true });
    if (isField(el) && !typesWords(el)) changeField(el.name, fieldValueOf(el));
    if (el.dataset?.action === 'runSheetField' && !typesWords(el)) act.runSheetField(el);
    if (el.type === 'checkbox' && el.dataset?.action === 'sellManyPick') sellMany.toggle(el.value);
    // the files picked, then the input emptied, so the same file can be picked again
    if (el.id === 'attach-input') { const files = Array.from(el.files ?? []); el.value = ''; addFiles(files); }
  });
  let pressSeq = 0;   // a press's own timeout ends only that press, never a later one
  root.addEventListener('pointerdown', ev => {
    // a press in the menu never takes focus from the editor, so its caret and the token it stands on stay; the row pressed
    // is kept as the item it shows now, for its click
    if (ev.target?.closest?.('.cmenu')) ev.preventDefault?.();
    const row = ev.target?.closest?.('.cmenu-row');
    pressedItem = row && menu ? flatItems(menu)[Number(row.dataset.index)] ?? null : null;
    if (ev.button !== undefined && ev.button !== 0) return;
    pressed = true;
    const mine = ++pressSeq;
    timers.after(host.pointerHoldMs ?? POINTER_HOLD_MS, () => { if (mine === pressSeq) release(); });
  });
  doc.addEventListener('pointerup', release);
  doc.addEventListener('pointercancel', release);
  win.addEventListener('blur', release);
  // a paste in the editor is plain text over the selection, the page not rendered. Files join the draft unless the paste
  // is a rich copy (text/plain and text/html: cells, a document's lines), which also carries a picture of itself that is
  // not an attachment; a Finder file copy carries its name as text/plain alone, and attaches
  root.addEventListener('paste', ev => {
    const say = sayOf(ev.target);
    if (!say) return;
    ev.preventDefault();
    const words = (ev.clipboardData?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n');
    const files = Array.from(ev.clipboardData?.files ?? []);
    if (files.length && !(words && ev.clipboardData?.getData('text/html'))) { addFiles(files); return; }
    if (!words) return;
    const [from, to] = editor.selection(say) ?? atEnd(say);
    insertWords(say, words, from, to);
  });
  // drag and drop, on the document: no drag starts from the editor (a chip is never moved or copied by the browser); files
  // dragged over a screen with a composer show the overlay until the dragovers stop (DROP_QUIET_MS), and dropped join the
  // draft on screen; text dropped on the editor is its text/plain at the point (text/html is never read: no chip enters
  // from outside); any other drop (text into a search box, a sheet's field) is the browser's
  doc.addEventListener('dragstart', ev => { if (sayOf(ev.target)) ev.preventDefault(); });
  doc.addEventListener('dragover', ev => {
    if (hasFiles(ev.dataTransfer)) {
      ev.preventDefault();
      if (!composerOn(store.get())) return;
      store.dispatch('setDropping', true);
      if (dropTimer !== null) timers.cancel(dropTimer);
      dropTimer = timers.after(DROP_QUIET_MS, () => { dropTimer = null; store.dispatch('setDropping', false); });
    } else if (sayOf(ev.target)) ev.preventDefault();
  });
  doc.addEventListener('dragend', stopDropping);
  doc.addEventListener('drop', ev => {
    const dt = ev.dataTransfer;
    const files = Array.from(dt?.files ?? []);
    const say = sayOf(ev.target);
    if (files.length || hasFiles(dt) || say) ev.preventDefault();
    stopDropping();
    if (files.length) { if (composerOn(store.get())) addFiles(files); return; }
    if (!say) return;
    const words = (dt?.getData?.('text/plain') ?? '').replace(/\r\n?/g, '\n');
    if (!words || isDataUrl(words)) return;
    const at = editor.pointAt?.(say, ev.clientX, ev.clientY) ?? null;
    const [from, to] = at != null ? [at, at] : editor.selection(say) ?? atEnd(say);
    insertWords(say, words, from, to);
  });
  // a caret moved by a key: the token before it may open, follow or close the menu (a no-op while it stands where it was)
  const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
  root.addEventListener('keyup', ev => { if (CARET_KEYS.has(ev.key) && sayOf(ev.target) && !composing) menuTick(); });
  // a caret moved by the pointer, the same
  root.addEventListener('click', ev => { if (sayOf(ev.target) && !composing) menuTick(); });
  // the editor losing focus (a click in the thread, ⌥⌘K) closes the menu, so Esc is the drawers' again; focus moving into
  // the menu, or a render that gives the editor its focus back at once, keeps it
  root.addEventListener('focusout', ev => {
    if (!menuTrig || !sayOf(ev.target) || ev.relatedTarget?.closest?.('.cmenu')) return;
    queueMicrotask(() => {
      const a = doc.activeElement;
      if (sayOf(a) || a?.closest?.('.cmenu')) return;
      closeMenu();
    });
  });
  root.addEventListener('compositionstart', () => { composing = true; });
  root.addEventListener('compositionend', ev => {
    composing = false;
    const before = store.get();
    typed(ev.target);
    if (pending && store.get() === before) render();
    pending = false;
  });

  // ⌥⌘K (Ctrl+Alt+K off a Mac) focuses the list's search box from anywhere: matched on the key's place, since ⌥ changes the
  // character a Mac reports; off a screen with the list it goes to Messages first
  function focusSearch() {
    const s = store.get();
    // on a medium window Details or the stock drawer folds the list away (app.css): close each that is open first, and the
    // box takes focus once the list is drawn
    if ((s.detailsOpen || s.lunhui?.stock) && win.matchMedia?.('(min-width: 861px) and (max-width: 1399px)')?.matches) {
      searchFocus = true;
      if (s.lunhui?.stock) store.dispatch('lunhuiStockClose');
      if (store.get().detailsOpen) store.dispatch('toggleDetails');
      return;
    }
    const box = doc.getElementById('cq');
    if (box) { box.focus(); return; }
    const lastOpen = s.lastConv && s.conversations.some(c => c.id === s.lastConv && !c.archived) ? s.lastConv : null;
    searchFocus = true;
    go({ screen: 'messages', id: lastOpen ?? firstOpen(s.conversations)?.id ?? null });
  }
  doc.addEventListener('keydown', ev => {
    // while an IME composes (pinyin), its keys are the composition's: Esc dismisses the candidate, never the query
    const imeOpen = ev.isComposing || ev.keyCode === 229;
    if (!imeOpen && ev.code === 'KeyK' && ev.altKey && !ev.shiftKey && (mac ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey)) {
      ev.preventDefault();
      // over the lightbox the keys do nothing: the search box lies under it
      if (!lightboxOf(store.get())) focusSearch();
      return;
    }
    // while the lightbox stands, Tab and Shift+Tab stay on its one key
    if (ev.key === 'Tab' && lightboxOf(store.get())) {
      ev.preventDefault();
      root.querySelector('.lightbox-close')?.focus();
      return;
    }
    // while a menu shows rows its keys are its own, before the lightbox, the search box and today's Escape chain (D34): ↑ ↓ move, Enter
    // and Tab choose (Tab on a folder walks into it), Esc and Shift+Tab close it and keep the draft
    if (menuShowsRows() && sayOf(ev.target) && !imeOpen && !composing) {
      const k = ev.key;
      if (k === 'ArrowDown' || k === 'ArrowUp') { ev.preventDefault(); menu = moveActive(menu, k === 'ArrowDown' ? 1 : -1); drawMenu(); return; }
      if (k === 'Enter' || (k === 'Tab' && !ev.shiftKey)) {
        ev.preventDefault();
        const item = flatItems(menu)[menu.active];
        chooseItem(item, k === 'Tab' && item?.kind === 'file' && item.dir === true);
        return;
      }
      if (k === 'Escape' || k === 'Tab') { ev.preventDefault(); dismissed = menuTrig; closeMenu(); return; }
    }
    if (ev.key === 'Escape') {
      if (imeOpen) return;
      // a trigger standing with no rows drawn yet: Esc runs the chain below, and rows that land later open nothing
      if (menuTrig && sayOf(ev.target)) { dismissed = menuTrig; forgetMenu(); }
      const s = store.get();
      // the lightbox after a menu, before the search box (D34)
      if (s.lightbox) { store.dispatch('closeLightbox'); return; }
      // the search box while it has focus, before today's chain (spec D34): the first Esc clears the query, the next leaves the box
      const box = doc.activeElement;
      if (box && box.id === 'cq') {
        if (s.search.query !== '' || box.value !== '') { box.value = ''; convSearch.clear(); } else box.blur?.();
        return;
      }
      if (s.edit) { store.dispatch('cancelEdit'); return; }
      if (s.confirm) { store.dispatch('cancelConfirm'); return; }
      // a module card's Run sheet first, then the owner sheet over any drawer, then the stock drawer; Trade's ticket after every drawer
      if (s.runSheet) runSheet.close();
      else if (sheetUp(s)) sheet.close();
      else if (s.sellMany) sellMany.close();
      else if (s.lunhui?.stock) store.dispatch('lunhuiStockClose');
      else if (s.detailsOpen) store.dispatch('toggleDetails');
      else if (s.settingsOpen) store.dispatch('closeSettings');
      else if (s.account.statementOpen) store.dispatch('closeStatement');
      else if (s.account.detailsVenue) store.dispatch('closeVenueDetails');
      else if (s.route.screen === 'trade' && s.trade.ticket) trade.closeTicket();
      return;
    }
    // Enter in the editor sends; Shift+Enter is the browser's new line, an IME's Enter its composition's, and while a
    // menu shows rows Enter is the menu's (above)
    if (ev.key === 'Enter' && sayOf(ev.target) && !ev.shiftKey && !imeOpen && !composing && !menuShowsRows()) {
      ev.preventDefault();
      void sendNow();
      return;
    }
    const a = doc.activeElement;
    if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229 && store.get().edit && a?.closest?.('.inline-edit') && a.tagName !== 'BUTTON') { ev.preventDefault(); commitEdit(); }
  });

  // a hidden tab stops everything — the Markets polls and the face's wire, the Account's read, and its stream with the market a
  // page follows — and a visible one starts again what its screen reads
  win.addEventListener('hashchange', follow);
  doc.addEventListener('visibilitychange', () => {
    showMarkets();
    showTrade();
    showAccount();
    if (doc.hidden) stream.close(); else stream.open();
  });
  store.subscribe((s, type) => {
    // the live layer back (connected again after a drop, or for the first time): thumb reads a fence stopped go again
    const linked = s.status?.connected === true;
    if (linked && !connected) attachments.reconnected?.();
    connected = linked;
    // the job open in Details gone from what the page shows (its row left, Clear, Details closed): its follow goes too
    // a Stop asked on a job that no longer runs (it finished, or left the rows) goes, so Esc closes Details; the dispatches
    // render the page
    if (s.confirm?.action === 'stopJob' && !s.jobs.rows.some(j => j.id === s.confirm.id && j.status === 'running')) {
      store.dispatch('cancelConfirm');
    } else if (s.jobs.open !== null && !jobShown(s)) {
      jobs.unfollow();
      store.dispatch('closeJob');
    } else requestRender();
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
  if (!doc.hidden) stream.open();
  follow();
  render();
  return Object.assign(store, { timers, live, actions, markets, channels, discover, owner, sheet, trade, walletSend, sellMany });
}

if (typeof window !== 'undefined' && window.document) boot(window);
