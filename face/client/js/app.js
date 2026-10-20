// face/client/js/app.js — the client's boot on the face (spec 2026-10-19 §5): the store, the host layer, the renderers,
// and the page's own bookkeeping (what was typed, where the thread stood, who had focus) across every render.
import { createStore } from './store.js';
import { reducers } from './reducers/index.js';
import { emptyState } from './data/empty.js';
import { parseHash, toHash } from './router.js';
import { renderRail } from './render/rail.js';
import { renderMessagesScreen, currentConversation } from './render/messages.js';
import { renderSettings } from './render/account.js';
import { setMarkdown } from './render/thread.js';
import { renderMarkdown } from './wire/markdown.js';
import { call as wireCall, openMux as wireOpenMux } from './wire/api.js';
import { mapFrame } from './wire/mapper.js';
import { startLive } from './host/live.js';
import { makeActions } from './host/actions.js';

export const PREFS_KEY = 'gravit-ui.prefs';
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

// per-viewer conveniences only: the theme, the rail's fold, the last conversation, what was seen, the watchlist
export function readPrefs(storage) {
  try {
    const raw = storage?.getItem(PREFS_KEY);
    const p = raw ? JSON.parse(raw) : null;
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
}
export const prefsOf = s => ({ theme: s.theme, railCollapsed: s.railCollapsed, lastConv: s.lastConv, lastSeen: s.lastSeen, watch: s.markets.watch });
export function initialState(storage, now = Date.now()) {
  const p = readPrefs(storage);
  const s = emptyState(now);
  return {
    ...s,
    theme: THEMES.includes(p.theme) ? p.theme : s.theme,
    railCollapsed: p.railCollapsed === true,
    lastConv: typeof p.lastConv === 'string' ? p.lastConv : null,
    lastSeen: p.lastSeen && typeof p.lastSeen === 'object' && !Array.isArray(p.lastSeen) ? p.lastSeen : {},
    markets: { ...s.markets, watch: Array.isArray(p.watch) ? p.watch : [] },
  };
}
// the store never loads a saved state (the host is the state); it writes the prefs on every change
export function makeStore(storage, now = Date.now()) {
  return createStore({ initial: initialState(storage, now), reducers, storage, key: PREFS_KEY, accept: () => false, persist: prefsOf });
}

// stage 1 serves Messages; every other screen the router knows folds to it
const SCREENS = new Set(['messages']);
export const routeOf = hash => { const r = parseHash(hash); return SCREENS.has(r.screen) ? r : { screen: 'messages', id: null }; };
// route by the address bar; a normalised route says which hash the bar should show instead
export function settle(store, hash) {
  const next = store.dispatch('nav', routeOf(hash)).route;
  const h = toHash(next);
  return h !== hash ? h : null;
}

// the question card's inputs → the batch the host wants: every question answered exactly once
export function answersFrom(root, questions) {
  const answers = (Array.isArray(questions) ? questions : []).map((q, i) => {
    const id = String(q?.id ?? i);
    const name = `q-${id}`;
    const selected = [...(root.querySelectorAll(`input[name="${name}"]`) ?? [])].filter(el => el.checked).map(el => String(el.value));
    const custom = root.querySelector(`input[name="${name}-custom"]`)?.value?.trim();
    return { id, selected, ...(custom ? { custom } : {}) };
  });
  return { answers };
}

// where focus was, as something a re-render can find again: the id first, else the control's data attributes
function focusKey(el) {
  if (!el || el.tagName === 'BODY') return null;
  if (el.id) return { id: el.id };
  const data = el.dataset ?? {};
  if (!data.action) return null;
  const sel = `[data-action="${data.action}"]` + Object.entries(data).filter(([k]) => k !== 'action').map(([k, v]) => `[data-${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}="${v}"]`).join('');
  return { sel };
}
const overlayOf = s => (s.detailsOpen || s.settingsOpen ? 'drawer' : null);
const drawerOf = s => (s.detailsOpen ? 'details' : s.settingsOpen ? 'settings' : null);
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
  const postJson = host.postJson ?? ((path, body) => win.fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()));
  // Gravit's markdown is DOM-built (wire/markdown.js); a test hands in its own or none
  if (host.markdown !== undefined) setMarkdown(host.markdown);
  else if (typeof document !== 'undefined') setMarkdown(text => renderMarkdown(text).outerHTML);
  const live = startLive({ store, openMux: host.openMux ?? wireOpenMux, call, mapFrame, getJson, timers, now });
  const actions = makeActions({ store, call, answerGate: (eventId, value) => live.mux.answer(eventId, value), postJson });

  let composerText = '';
  let composing = false;
  let pending = false;
  let openedId = null;   // the conversation the live layer was told to open
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
    const thread0 = doc.getElementById('thread');
    const threadAt = thread0 ? { top: thread0.scrollTop, bottom: thread0.scrollHeight - thread0.scrollTop - thread0.clientHeight < 40 } : null;
    const scrolls = { main: root.querySelector('main')?.scrollTop, rows: root.querySelector('.rail-rows')?.scrollTop, drawer: root.querySelector('.drawer-body')?.scrollTop };

    const screen = renderMessagesScreen(s, now());
    root.innerHTML = renderRail(s, now()) + (s.settingsOpen ? screen.replace(/<\/main>$/, renderSettings(s) + '</main>') : screen);

    const sameEditor = editorOf(s.edit) === last.editor;
    for (const [id, value] of typed) {
      const el = doc.getElementById(id);
      // an editor's box (edit-*) keeps what was typed only while the same editor stays open
      if (el && id !== 'say' && (sameEditor || !id.startsWith('edit-'))) el.value = value;
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
    // the thread stays where the person was reading, unless it is another conversation, it gained a message, or they were at the bottom
    const open = s.route.screen === 'messages' ? currentConversation(s) : null;
    const threadSig = open ? `${open.id}:${open.messages.length}:${open.thinking ? 1 : 0}` : null;
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

  // while an IME composes (pinyin), a render would replace the input and lose the composition: hold it until compositionend
  function requestRender() {
    if (composing) { pending = true; return; }
    render();
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
    // a deep link the list does not carry yet waits for it
    if (asked.screen === 'messages' && asked.id && asked.id !== 'new' && !store.get().conversations.some(c => c.id === asked.id)) wanted = asked.id;
    if (r.screen === 'messages' && r.id && r.id !== 'new' && r.id !== openedId) {
      openedId = r.id;
      live.open(r.id);
    }
  }

  // commit the open editor with what its inputs hold; a rename also reaches the host
  function commitEdit() {
    const e = store.get().edit;
    const values = Object.fromEntries([...root.querySelectorAll('.inline-edit [name]')].map(el => [el.name, el.value]));
    store.dispatch('commitEdit', { values });
    if (e?.kind === 'rename' && store.get().edit === null) void actions.rename(e.convId, values.title);
  }

  // the second press of a two-step confirm
  function confirmYes() {
    const c = store.get().confirm;
    if (!c) return;
    store.dispatch('cancelConfirm');
    if (c.action === 'stopGravit') void actions.stop(c.id);
    else if (c.action === 'forgetAll') store.dispatch('forgetAll');
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
    cancelDraft: () => { store.dispatch('cancelDraft'); go(store.get().route); },
    toggleRail: () => store.dispatch('toggleRail'),
    // inline editors (they replaced prompt): a button starts one, ✓ or Enter commits it, × or Escape cancels it
    changeWords: el => store.dispatch('startEdit', { kind: 'rename', convId: el.dataset.conv }),
    editMemory: el => store.dispatch('startEdit', { kind: 'memory', id: el.dataset.id }),
    commitEdit: () => commitEdit(),
    cancelEdit: () => store.dispatch('cancelEdit'),
    // two-step confirms (they replaced confirm): the first press asks in place, the second acts
    stopGravit: el => store.dispatch('askConfirm', { action: 'stopGravit', id: el.dataset.conv }),
    forgetAll: () => store.dispatch('askConfirm', { action: 'forgetAll' }),
    confirmYes: () => confirmYes(),
    cancelConfirm: () => store.dispatch('cancelConfirm'),
    suggest: el => { composerText = el.dataset.text; render(); doc.getElementById('say')?.focus(); },
    // the gates: a card's ✗ / ✓, a question card's Answer
    answer: el => { void actions.answer(el.dataset.msg, el.dataset.value); },
    answerQuestion: el => {
      const conv = store.get().conversations.find(c => c.id === el.dataset.conv);
      const m = conv?.messages.find(x => x.id === el.dataset.msg);
      if (m) void actions.answer(m.id, answersFrom(root, m.data?.questions));
    },
    toggleDetails: () => store.dispatch('toggleDetails'),
    openSettings: () => store.dispatch('openSettings'),
    closeSettings: () => store.dispatch('closeSettings'),
    setTheme: el => { const t = el.dataset.value.toLowerCase(); store.dispatch('setTheme', t); applyTheme(t); },
    forgetMemory: el => store.dispatch('forgetMemory', el.dataset.id),
    memorySwitch: el => store.dispatch('setMemorySwitch', { key: el.dataset.key, value: el.getAttribute('aria-checked') !== 'true' }),
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
    else if (form.dataset.action === 'addMemory') {
      const f = new win.FormData(form);
      form.reset?.();
      store.dispatch('addMemory', { text: f.get('text'), now: now() });
    }
  });

  // typing: the composer keeps its words outside the store; the title goes through it
  function typed(el) {
    if (el.id === 'say') composerText = el.value;
    else if (el.dataset?.action === 'draftTitle') store.dispatch('setDraftTitle', el.value);
  }
  root.addEventListener('input', ev => { if (!ev.isComposing && !composing) typed(ev.target); });
  root.addEventListener('change', ev => {
    const el = ev.target;
    if (el.tagName === 'SELECT' && el.dataset?.action === 'draftWhere') store.dispatch('setDraftWhere', el.value);
  });
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
      return;
    }
    const a = doc.activeElement;
    if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229 && store.get().edit && a?.closest?.('.inline-edit') && a.tagName !== 'BUTTON') { ev.preventDefault(); commitEdit(); }
  });

  win.addEventListener('hashchange', follow);
  store.subscribe((s, type) => {
    requestRender();
    if (type !== 'hostList') return;
    // the list answered a deep link, or there was no conversation on screen: open one
    if (wanted && s.conversations.some(c => c.id === wanted)) { const id = wanted; wanted = null; go({ screen: 'messages', id }); }
    else if (s.route.screen === 'messages' && s.route.id === null && s.conversations.length) go({ screen: 'messages', id: s.conversations[0].id });
  });
  applyTheme(store.get().theme);
  if (!win.location.hash) win.history.replaceState(null, '', toHash(store.get().route));
  follow();
  render();
  return Object.assign(store, { timers, live, actions });
}

if (typeof window !== 'undefined' && window.document) boot(window);
