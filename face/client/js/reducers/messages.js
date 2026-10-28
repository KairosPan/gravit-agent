// face/client/js/reducers/messages.js — the conversation side on the host (spec 2026-10-19 §5, §7): routes, the draft, Details.
// What the host says about a conversation lives in reducers/host.js; what the operator does with the page lives here.
import { canonicalId, isAccountKey } from '../host/market-view.js';
import { firstOpen } from '../host/sessions.js';
import { ARCHIVED_KEY } from '../wire/grouping.js';

// one drawer at a time: an opener first closes whatever else was open, with any editor or confirm in it
export const closeOverlays = s => ({
  ...s, detailsOpen: false, settingsOpen: false, edit: null, confirm: null,
  account: { ...s.account, statementOpen: false, detailsVenue: null },
});
const upd = (state, id, fn) => ({ ...state, conversations: state.conversations.map(c => (c.id === id ? fn(c) : c)) });

// the channel a new conversation goes to by default: the root (the workbench), else the first listed
const defaultWhere = s => s.channels?.find(c => c.isRoot)?.workspaceId ?? s.channels?.[0]?.workspaceId ?? null;

export const reducers = {
  nav(state, route) {
    // a missing id, or new without a draft, opens the first open conversation (an archived one opens by its id alone)
    if (route.screen === 'messages' && !(route.id === 'new' && state.draft) && !state.conversations.some(c => c.id === route.id)) {
      route = { screen: 'messages', id: firstOpen(state.conversations)?.id ?? null };
    }
    // a market id is the Account's key as it is (coin:BTC, event:predict:…), or the face's (us:AAPL, crypto:BTC/USD, cn:600519)
    // canonicalised; one that is neither opens Markets
    if (route.screen === 'markets' && route.id) route = { screen: 'markets', id: isAccountKey(route.id) ? route.id : canonicalId(route.id) };
    let s = { ...state, route, detailsOpen: false, settingsOpen: false, edit: null, confirm: null };
    // the first level's Messages key returns to the conversation you last had open
    if (route.screen === 'messages' && route.id && route.id !== 'new') s.lastConv = route.id;
    // the Statement and a venue's Details belong to Account
    if (route.screen !== 'account' && (s.account.statementOpen || s.account.detailsVenue)) s.account = { ...s.account, statementOpen: false, detailsVenue: null };
    // a plugin or module page goes back to the Discover view it was opened from; opened from outside Discover, to Discover itself
    const page = r => r === 'plugin' || r === 'module';
    if (route.screen === 'discover') s.lastDiscover = route;
    else if (page(route.screen) && state.route.screen !== 'discover' && !page(state.route.screen)) s.lastDiscover = { screen: 'discover', id: null };
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
  // a list group folds or opens; Archived starts folded (host/list-view.js)
  toggleGroup(s, key) {
    if (typeof key !== 'string' || key === '') return s;
    const was = typeof s.collapsed?.[key] === 'boolean' ? s.collapsed[key] : key === ARCHIVED_KEY;
    return { ...s, collapsed: { ...(s.collapsed ?? {}), [key]: !was } };
  },
  setTheme: (s, theme) => ({ ...s, theme }),

  // the new-message screen: a title and where the session goes (a channel — the one New round names, else the
  // default), then the first words send it
  startDraft(s, { where } = {}) {
    const known = typeof where === 'string' && (s.channels ?? []).some(c => c.workspaceId === where);
    return { ...closeOverlays(s), draft: { title: '', where: known ? where : defaultWhere(s) }, route: { screen: 'messages', id: 'new' } };
  },
  cancelDraft: s => ({ ...s, draft: null, route: { screen: 'messages', id: firstOpen(s.conversations)?.id ?? null } }),
  setDraftTitle: (s, title) => (s.draft ? { ...s, draft: { ...s.draft, title } } : s),
  setDraftWhere: (s, where) => (s.draft ? { ...s, draft: { ...s.draft, where: where || null } } : s),

  // the optimistic half of Change words; the host's title projection confirms it
  rename(s, { convId, title }) {
    const t = (title ?? '').trim();
    if (!t) return s;
    return upd(s, convId, c => ({ ...c, title: t }));
  },

  toggleDetails: s => (s.detailsOpen ? { ...s, detailsOpen: false, edit: null, confirm: null } : { ...closeOverlays(s), detailsOpen: true }),
};
