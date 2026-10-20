// face/client/js/reducers/messages.js — the conversation side on the host (spec 2026-10-19 §5, §7): routes, the draft, Details.
// What the host says about a conversation lives in reducers/host.js; what the operator does with the page lives here.
import { nextId } from '../ids.js';
import { byId } from '../data/plugins.js';
import { canonicalId } from '../host/market-view.js';

// one drawer at a time: an opener first closes whatever else was open, with any editor or confirm in it
export const closeOverlays = s => ({
  ...s, detailsOpen: false, settingsOpen: false, edit: null, confirm: null,
  account: { ...s.account, panel: null, panelError: null },
  discover: { ...s.discover, create: null },
});
const upd = (state, id, fn) => ({ ...state, conversations: state.conversations.map(c => (c.id === id ? fn(c) : c)) });

// kept for the later stages' screens (Discover's teaching conversation, Markets' cancel line) until they move to the host
export function stampMessage(state, msg, at) {
  const { id, counters } = nextId(state.counters ?? {}, 'msg');
  return { state: { ...state, counters }, msg: { ...msg, id, at } };
}

// the channel a new conversation goes to by default: the root (the workbench), else the first listed
const defaultWhere = s => s.channels?.find(c => c.isRoot)?.workspaceId ?? s.channels?.[0]?.workspaceId ?? null;

export const reducers = {
  nav(state, route) {
    // a missing id, or new without a draft, opens the first conversation
    if (route.screen === 'messages' && !(route.id === 'new' && state.draft) && !state.conversations.some(c => c.id === route.id)) {
      route = { screen: 'messages', id: state.conversations[0]?.id ?? null };
    }
    // a plugin that is not in the shop opens Discover
    if (route.screen === 'plugin' && !byId(route.id, state.plugins.uploaded)) route = { screen: 'discover', id: null };
    // a market id is the face's (us:AAPL, crypto:BTC/USD, cn:600519), canonicalised; one that is not opens Markets
    if (route.screen === 'markets' && route.id) route = { screen: 'markets', id: canonicalId(route.id) };
    // a letter that is not in the mailbox opens the inbox
    if (route.screen === 'mail' && route.id && !state.mail.items.some(m => m.id === route.id)) route = { screen: 'mail', id: null };
    let s = { ...state, route, detailsOpen: false, settingsOpen: false, edit: null, confirm: null };
    if (route.screen === 'mail' && route.id) s.mail = { ...s.mail, items: s.mail.items.map(m => (m.id === route.id && !m.read ? { ...m, read: true } : m)) };
    // the first level's Messages key returns to the conversation you last had open
    if (route.screen === 'messages' && route.id && route.id !== 'new') s.lastConv = route.id;
    // an Account panel belongs to Account
    if (route.screen !== 'account' && s.account.panel) s.account = { ...s.account, panel: null, panelError: null };
    // a plugin page goes back to the Discover view it was opened from; opened from outside Discover, to Discover itself
    if (route.screen === 'discover') s.lastDiscover = route;
    else if (route.screen === 'plugin' && state.route.screen !== 'discover' && state.route.screen !== 'plugin') s.lastDiscover = { screen: 'discover', id: null };
    if (route.screen !== 'discover' && s.discover.create) s = { ...s, discover: { ...s.discover, create: null } };
    if (route.screen !== 'discover' && route.screen !== 'plugin' && s.discover.toast) s = { ...s, discover: { ...s.discover, toast: null } };
    // opening a conversation reads it: the dot goes until the host moves it again
    if (route.screen === 'messages' && route.id && route.id !== 'new') {
      const c = s.conversations.find(x => x.id === route.id);
      if (c && (c.lastSeen ?? 0) < (c.updatedAt ?? 0)) {
        s = upd(s, c.id, x => ({ ...x, lastSeen: x.updatedAt }));
        s.lastSeen = { ...(s.lastSeen ?? {}), [c.id]: c.updatedAt };
      }
    }
    if (!(route.screen === 'messages' && route.id === 'new')) s.draft = null;
    return s;
  },
  toggleRail: s => ({ ...s, railCollapsed: !s.railCollapsed }),
  setTheme: (s, theme) => ({ ...s, theme }),

  // the new-message screen: a title and where the session goes (a channel), then the first words send it
  startDraft(s) {
    return { ...closeOverlays(s), draft: { title: '', where: defaultWhere(s) }, route: { screen: 'messages', id: 'new' } };
  },
  cancelDraft: s => ({ ...s, draft: null, route: { screen: 'messages', id: s.conversations[0]?.id ?? null } }),
  setDraftTitle: (s, title) => (s.draft ? { ...s, draft: { ...s.draft, title } } : s),
  setDraftWhere: (s, where) => (s.draft ? { ...s, draft: { ...s.draft, where: where || null } } : s),

  // the optimistic half of Change words; the host's title projection confirms it
  rename(s, { convId, title }) {
    const t = (title ?? '').trim();
    if (!t) return s;
    return upd(s, convId, c => ({ ...c, title: t }));
  },

  // kept for the later stages' screens: a line the page itself adds to a conversation
  append(state, { convId, msg, at }) {
    if (!state.conversations.some(c => c.id === convId)) return state;
    const st = stampMessage(state, msg, at);
    return upd(st.state, convId, c => ({ ...c, messages: [...c.messages, st.msg] }));
  },

  toggleDetails: s => (s.detailsOpen ? { ...s, detailsOpen: false, edit: null, confirm: null } : { ...closeOverlays(s), detailsOpen: true }),
};
