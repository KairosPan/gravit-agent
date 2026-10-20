// face/client/js/app.js — the client's boot on the face (spec 2026-10-19 §5): the store, the host layer, the renderers,
// and the page's own bookkeeping (what was typed, where the thread stood, who had focus) across every render.
import { createStore } from './store.js';
import { reducers } from './reducers/index.js';
import { emptyState } from './data/empty.js';
import { parseHash, toHash } from './router.js';
import { renderRail } from './render/rail.js';
import { renderMessagesScreen, currentConversation } from './render/messages.js';
import { renderMarketsScreen } from './render/markets.js';
import { renderSettings, renderAccountScreen } from './render/account.js';
import { setMarkdown } from './render/thread.js';
import { renderMarkdown } from './wire/markdown.js';
import { call as wireCall, openMux as wireOpenMux } from './wire/api.js';
import { mapFrame } from './wire/mapper.js';
import { startLive } from './host/live.js';
import { makeActions } from './host/actions.js';
import { startMarkets } from './host/markets.js';
import { startAccount } from './host/account.js';
import { startChannels } from './host/channels.js';
import { renderChannelScreen } from './render/channel.js';
import { startDiscover } from './host/discover.js';
import { renderDiscover, renderPlugin } from './render/discover.js';
import { statementOf, csvOf } from './host/account-view.js';
import { canonicalId, assetFor } from './host/market-view.js';
import { createLiveQuotes } from './wire/market-quotes.js';
import { firstOpen } from './host/sessions.js';
import { createSymbolSearch } from './wire/market-search.js';

export const PREFS_KEY = 'gravit-ui.prefs';
// how long a press may hold renders: a click lands well inside it, and a release that never arrives cannot freeze the page
export const POINTER_HOLD_MS = 1000;

// Gravit's words as the thread draws them: DOM-built markdown (wire/markdown.js returns {node, doc}), serialized for
// the string renderers
export const gravitMarkdown = text => renderMarkdown(text).node.outerHTML;

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

// Messages (with a channel's page), Markets, Discover (with an item's page) and Account are served; every other screen the
// router knows folds to Messages
const SCREENS = new Set(['messages', 'channel', 'markets', 'discover', 'plugin', 'account']);
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

// where focus was, as something a re-render can find again: the id first, else the control's data attributes
function focusKey(el) {
  if (!el || el.tagName === 'BODY') return null;
  if (el.id) return { id: el.id };
  const data = el.dataset ?? {};
  if (!data.action) return null;
  const sel = `[data-action="${data.action}"]` + Object.entries(data).filter(([k]) => k !== 'action').map(([k, v]) => `[data-${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}="${v}"]`).join('');
  return { sel };
}
const overlayOf = s => (s.detailsOpen || s.settingsOpen || s.account.statementOpen ? 'drawer' : null);
const drawerOf = s => (s.detailsOpen ? 'details' : s.settingsOpen ? 'settings' : s.account.statementOpen ? 'statement' : null);
const editorOf = e => (e ? [e.kind, e.convId, e.id].join('|') : null);
const screenOf = s => `${s.route.screen}/${s.route.id ?? ''}`;

export function boot(win, host = {}) {
  const doc = win.document;
  const storage = (() => { try { return win.localStorage; } catch { return null; } })();
  const store = makeStore(storage);
  const timers = new Timers();
  const root = doc.getElementById('app');
  const now = () => Date.now();
  const call = host.call ?? wireCall;
  const getJson = host.getJson ?? (path => win.fetch(path).then(r => (r.ok ? r.json() : Promise.reject(Object.assign(new Error(`${path}: HTTP ${r.status}`), { status: r.status })))));
  const postJson = host.postJson ?? postJsonVia((path, init) => win.fetch(path, init));
  // Gravit's markdown is DOM-built (wire/markdown.js); a test hands in its own or none
  if (host.markdown !== undefined) setMarkdown(host.markdown);
  else if (typeof document !== 'undefined') setMarkdown(gravitMarkdown);
  // the paper account: read at boot, on entering Account, on Refresh, and right after a fill
  const account = startAccount({ store, getJson, call, now });
  void account.load();
  const live = startLive({ store, openMux: host.openMux ?? wireOpenMux, call, mapFrame, getJson, timers, now, onReceipt: () => { void account.load({ fresh: true }); } });
  // answers go through the live layer, which settles the gate it delivered once the answer wins
  const actions = makeActions({ store, call, answerGate: (eventId, value) => live.answer(eventId, value), postJson });
  // Markets: the face's live quotes and symbol search (a test hands in its own), the watchlist in this browser's storage
  const markets = startMarkets({
    store,
    createLiveQuotes: host.createLiveQuotes ?? (onUpdate => createLiveQuotes(onUpdate, {
      fetcher: (...a) => win.fetch(...a),
      createEventSource: typeof win.EventSource === 'function' ? url => new win.EventSource(url) : null,
    })),
    createSymbolSearch: host.createSymbolSearch ?? (onUpdate => createSymbolSearch(onUpdate, { fetcher: (...a) => win.fetch(...a) })),
    storage, getJson, win,
  });
  // a channel's page: its overview read on entering it
  const channels = startChannels({ store, postJson, getJson, refresh: () => live.refresh(), now });
  // Discover: the face's inventory, read on entering it; a page's own reads (the Gravit item, a skill) on opening it
  const discover = startDiscover({ store, getJson, postJson, call, now });
  // the quotes run only while Markets is on screen in a visible tab
  const showMarkets = () => markets.show(store.get().route.screen === 'markets' && !doc.hidden);

  let composerText = '';
  let composing = false;
  let pressed = false;   // a primary press is down: a render now would replace the element the click is aimed at
  let pending = false;
  let openedId = null;   // the conversation the live layer was told to open
  let barsFor = null;    // the market page whose daily bars were last asked for
  let was = null;        // the route follow() last settled: entering Account reads it, entering Venues describes
  let wanted = null;     // a deep link the list has not answered yet
  let last = { overlay: null, opener: null, screen: null, drawer: null, thread: null, editor: null, confirm: null };
  let confirmFrom = null;

  function applyTheme(theme) {
    if (theme === 'cream' || theme === 'black') doc.documentElement.dataset.theme = theme; else delete doc.documentElement.dataset.theme;
  }
  function find(key) {
    if (!key) return null;
    return key.id ? doc.getElementById(key.id) : root.querySelector(key.sel);
  }

  function render() {
    const s = store.get();
    // what the person had: focus and caret, typed text, picked radios, and where each scrolling box stood
    const active = doc.activeElement;
    const activeKey = focusKey(active);
    const caret = active && typeof active.selectionStart === 'number' && active.id ? [active.selectionStart, active.selectionEnd] : null;
    const typed = new Map([...root.querySelectorAll('input[id]:not([type=radio]):not([type=checkbox]):not([type=file]), textarea[id], select[id]')].map(el => [el.id, el.value]));
    const ticked = [...root.querySelectorAll('input[id]')].filter(el => (el.type === 'radio' || el.type === 'checkbox') && el.checked).map(el => el.id);
    const thread0 = doc.getElementById('thread');
    const threadAt = thread0 ? { top: thread0.scrollTop, bottom: thread0.scrollHeight - thread0.scrollTop - thread0.clientHeight < 40 } : null;
    const scrolls = { main: root.querySelector('main')?.scrollTop, rows: root.querySelector('.rail-rows')?.scrollTop, drawer: root.querySelector('.drawer-body')?.scrollTop };

    const screen = s.route.screen === 'markets' ? renderMarketsScreen(s, now()) : s.route.screen === 'account' ? renderAccountScreen(s, now())
      : s.route.screen === 'channel' ? renderChannelScreen(s, now()) : s.route.screen === 'discover' ? renderDiscover(s)
      : s.route.screen === 'plugin' ? renderPlugin(s) : renderMessagesScreen(s, now());
    root.innerHTML = renderRail(s, now()) + (s.settingsOpen ? screen.replace(/<\/main>$/, renderSettings(s) + '</main>') : screen);

    const sameEditor = editorOf(s.edit) === last.editor;
    for (const [id, value] of typed) {
      const el = doc.getElementById(id);
      // an editor's box (edit-*) keeps what was typed only while the same editor stays open
      // Where's channel is the store's (draft.where), never the box's: New channel… must not stick in it
      if (el && id !== 'say' && id !== 'nm-where' && (sameEditor || !id.startsWith('edit-'))) el.value = value;
    }
    // a pick on a question card is the person's own until they press Answer: it lives in the DOM, not the store
    for (const id of ticked) {
      const el = doc.getElementById(id);
      if (el) el.checked = true;
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

    // focus: back on the same control; into a drawer that just opened; back to its opener when it closes
    const overlay = overlayOf(s);
    let opener = last.opener;
    let target = find(activeKey);
    if (overlay && overlay !== last.overlay) {
      opener = activeKey;
      target = root.querySelector('.drawer .close-key');
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
      target = overlay === 'drawer' ? root.querySelector('.drawer .close-key') : say;
    }
    if (target) {
      target.focus();
      if (caret && target === find(activeKey) && typeof target.setSelectionRange === 'function') target.setSelectionRange(caret[0], caret[1]);
    }
    last = { overlay, opener, screen: screenOf(s), drawer: drawerOf(s), thread: threadSig, editor: editorOf(s.edit), confirm: s.confirm };
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
    // a market page reads its daily bars once per opening (crypto and cn have none to read)
    if (r.screen === 'markets' && r.id) { if (r.id !== barsFor) { barsFor = r.id; void markets.bars(r.id); } } else barsFor = null;
    if (r.screen === 'account' && was?.screen !== 'account') void account.load();
    if (r.screen === 'account' && r.tab === 'venues' && !(was?.screen === 'account' && was.tab === 'venues')) void account.describe();
    if (r.screen === 'channel' && !(was?.screen === 'channel' && was.id === r.id)) void channels.overview(r.id);
    const inDiscover = route => route?.screen === 'discover' || route?.screen === 'plugin';
    if (inDiscover(r) && !inDiscover(was)) void discover.load();
    if (r.screen === 'plugin' && !(was?.screen === 'plugin' && was.id === r.id)) {
      if (r.id === 'agent:gravit') void discover.gravit();
      else if (typeof r.id === 'string' && r.id.startsWith('skill:')) void discover.skill(r.id.slice('skill:'.length));
    }
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
      : (data.allBots ?? []).map(b => ({ value: b.id, label: b.name }));
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
    const sent = await actions.send(text);
    if (!sent) { composerText = text; render(); return; }
    if (sent.sent === 'prompt' || sent.sent === 'say') live.promote(sent.sessionId);
    render();
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
    // Account: Refresh (and Retry), the Statement, its CSV
    refreshAccount: () => {
      void account.load({ fresh: true });
      const r = store.get().route;
      if (r.screen === 'account' && r.tab === 'venues') void account.describe();
    },
    openStatement: () => {
      if (store.get().route.screen !== 'account') go({ screen: 'account', tab: 'portfolio' });
      store.dispatch('openStatement');
    },
    closeStatement: () => store.dispatch('closeStatement'),
    exportStatement: () => {
      const csv = csvOf(statementOf(store.get().account.data));
      const url = win.URL.createObjectURL(new win.Blob([csv], { type: 'text/csv' }));
      const a = doc.createElement('a');
      a.href = url;
      a.download = 'statement.csv';
      a.click();
      timers.after(0, () => win.URL.revokeObjectURL(url));
    },
    // Markets: the tabs, the sort, Clear, the star, a row's page
    mkTab: el => store.dispatch('setMarketsTab', el.dataset.value),
    mkSort: el => store.dispatch('setMarketsSort', el.dataset.value),
    // the render keeps what an input holds, so Clear empties the box before the query
    mkClear: () => {
      const box = doc.getElementById('mq');
      if (box) box.value = '';
      store.dispatch('setMarketsQuery', '');
      markets.search('');
      doc.getElementById('mq')?.focus?.();
    },
    toggleWatch: el => {
      const id = canonicalId(el.dataset.id);
      if (store.get().markets.watchlist.some(a => a.id === id)) markets.unwatch(id); else markets.watch(id);
    },
    openMarket: el => go({ screen: 'markets', id: el.dataset.id }),
    // a new message in the root channel with the market named in the composer: the operator says what to look for
    handToGravit: el => {
      const s = store.get();
      const asset = assetFor(s.markets, s.account?.data, el.dataset.id);
      if (!asset) return;
      store.dispatch('startDraft', { now: now() });
      composerText = `Look at ${asset.symbol}${asset.name && asset.name !== asset.symbol ? ` (${asset.name})` : ''}`;
      go({ screen: 'messages', id: 'new' });
      render();
      doc.getElementById('say')?.focus();
    },
  };

  root.addEventListener('click', ev => {
    const el = ev.target.closest('[data-action]');
    if (!el || el.tagName === 'FORM' || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    const fn = act[el.dataset.action];
    if (!fn) return;
    if (el.tagName === 'A' && el.dataset.action !== 'open') return;
    if (el.tagName === 'A') ev.preventDefault();
    fn(el);
  });

  root.addEventListener('submit', ev => {
    const form = ev.target.closest('form[data-action]');
    if (!form) return;
    ev.preventDefault();
    if (form.dataset.action === 'send') void sendNow();
  });

  // typing: the composer keeps its words outside the store; the title and the Markets search go through it
  function typed(el) {
    if (el.id === 'say') composerText = el.value;
    else if (el.dataset?.action === 'draftTitle') store.dispatch('setDraftTitle', el.value);
    else if (el.dataset?.action === 'mkQuery') { store.dispatch('setMarketsQuery', el.value); markets.search(el.value); }
    else if (el.dataset?.action === 'dq') store.dispatch('setDiscoverQuery', el.value);
  }
  root.addEventListener('input', ev => { if (!ev.isComposing && !composing) typed(ev.target); });
  root.addEventListener('change', ev => {
    const el = ev.target;
    if (el.tagName === 'SELECT' && el.dataset?.action === 'draftWhere') {
      if (el.value === '__new') store.dispatch('startEdit', { kind: 'newChannel' }); else store.dispatch('setDraftWhere', el.value);
    }
    if (el.type === 'checkbox' && el.name === 'roster') store.dispatch('toggleRosterTick', { value: el.value, on: el.checked === true });
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
      if (s.detailsOpen) store.dispatch('toggleDetails');
      else if (s.settingsOpen) store.dispatch('closeSettings');
      else if (s.account.statementOpen) store.dispatch('closeStatement');
      return;
    }
    const a = doc.activeElement;
    if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229 && store.get().edit && a?.closest?.('.inline-edit') && a.tagName !== 'BUTTON') { ev.preventDefault(); commitEdit(); }
  });

  win.addEventListener('hashchange', follow);
  doc.addEventListener('visibilitychange', showMarkets);
  store.subscribe((s, type) => {
    requestRender();
    if (type !== 'hostList') return;
    // the list answered a deep link, or there was no conversation on screen: open one
    if (wanted && s.conversations.some(c => c.id === wanted)) { const id = wanted; wanted = null; go({ screen: 'messages', id }); }
    // the conversation on screen left the list (deleted here or in another tab)
    else if (s.route.screen === 'messages' && s.route.id && s.route.id !== 'new' && !s.conversations.some(c => c.id === s.route.id)) go({ screen: 'messages', id: firstOpen(s.conversations)?.id ?? null });
    else if (s.route.screen === 'messages' && s.route.id === null && firstOpen(s.conversations)) go({ screen: 'messages', id: firstOpen(s.conversations).id });
  });
  applyTheme(store.get().theme);
  if (!win.location.hash) win.history.replaceState(null, '', toHash(store.get().route));
  follow();
  render();
  return Object.assign(store, { timers, live, actions, markets, channels, discover });
}

if (typeof window !== 'undefined' && window.document) boot(window);
