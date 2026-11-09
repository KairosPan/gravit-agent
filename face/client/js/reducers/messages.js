// face/client/js/reducers/messages.js — the conversation side on the host (spec 2026-10-19 §5, §7): routes, Details.
// What the host says about a conversation lives in reducers/host.js; what the operator does with the page lives here.
import { canonicalId, isAccountKey } from '../host/market-view.js';
import { onScreenId } from '../host/sessions.js';
import { ARCHIVED_KEY } from '../wire/grouping.js';
import { sizeOf, cleanFont } from '../prefs.js';

// one drawer at a time: an opener first closes whatever else was open, with any editor or confirm in it
// the stock drawer closed, on a state that has the composed answers' slice
const stockClosed = s => (s.lunhui?.stock ? { lunhui: { ...s.lunhui, stock: null } } : {});
export const closeOverlays = s => ({
  ...s, detailsOpen: false, settingsOpen: false, edit: null, confirm: null, runSheet: null, lightbox: null, shortcuts: null,
  account: { ...s.account, statementOpen: false, detailsVenue: null },
  ...stockClosed(s),
});
const upd = (state, id, fn) => ({ ...state, conversations: state.conversations.map(c => (c.id === id ? fn(c) : c)) });

const MESSAGES = { screen: 'messages', id: null };
// where a route lands (plan 2 of one entry). Messages is the conversation and carries no id. An old #/messages/<id> link lands
// on Messages (the conversation's id), the task's page (a task's) or history (any other id) once the tasks are read, and
// waits while they load; new (New message's, retired) is Messages. An old #/channel/<workspaceId> link lands on its strategy's
// page once the channels are read, the root or an id no channel has on Messages. A task page for a session the list knows
// that is no task is history; a task or strategy page with no id is Messages. Every other route is as it was asked
export function landingOf(state, route) {
  const tasks = state.tasks ?? { status: 'loading', conversation: null, items: [] };
  const loading = tasks.status === 'loading';
  const isTask = id => tasks.items.some(t => t.id === id);
  if (route.screen === 'messages' && route.channel) {
    const channels = state.channels ?? [];
    if (channels.length === 0) return route;
    const ch = channels.find(c => c.workspaceId === route.channel);
    return ch && !ch.isRoot && ch.name ? { screen: 'strategy', id: ch.name } : MESSAGES;
  }
  if (route.screen === 'messages' && route.id) {
    if (route.id === 'new') return MESSAGES;
    if (loading) return route;
    if (route.id === tasks.conversation) return MESSAGES;
    return isTask(route.id) ? { screen: 'task', id: route.id } : { screen: 'history', id: route.id };
  }
  if ((route.screen === 'task' || route.screen === 'strategy') && !route.id) return MESSAGES;
  if (route.screen === 'task' && !loading && !isTask(route.id) && state.conversations.some(c => c.id === route.id)) return { screen: 'history', id: route.id };
  return route;
}
export const reducers = {
  nav(state, route) {
    route = landingOf(state, route);
    // a market id is the Account's key as it is (coin:BTC, event:predict:…), or an A share's or an old face id (cn:600519 from
    // cn:sh600519, us:AAPL, crypto:BTC/USD) canonicalised; one that is neither opens Markets
    if (route.screen === 'markets' && route.id) route = { screen: 'markets', id: !String(route.id).startsWith('cn:') && isAccountKey(route.id) ? route.id : canonicalId(route.id) };
    // (and the lightbox: an image belongs to the conversation it was opened in; and the shortcut sheet)
    const changedRoute = state.route.screen !== route.screen || state.route.id !== route.id;
    let s = { ...state, route, listOpen: changedRoute ? false : state.listOpen, detailsOpen: false, settingsOpen: false, edit: null, confirm: null, lightbox: null, shortcuts: null, ...stockClosed(state) };
    // the Statement and a venue's Details belong to Account
    if (route.screen !== 'account' && (s.account.statementOpen || s.account.detailsVenue)) s.account = { ...s.account, statementOpen: false, detailsVenue: null };
    // a Receive address read on the Money tab is drawn only while the tab stays on screen: leaving it forgets every one
    const onMoney = r => r?.screen === 'account' && r.tab === 'money';
    if (onMoney(state.route) && !onMoney(route) && s.account.receive && Object.keys(s.account.receive).length) s.account = { ...s.account, receive: {} };
    // a plugin or module page goes back to the Discover view it was opened from; opened from outside Discover, to Discover itself
    const page = r => r === 'plugin' || r === 'module';
    if (route.screen === 'discover') s.lastDiscover = route;
    else if (page(route.screen) && state.route.screen !== 'discover' && !page(state.route.screen)) s.lastDiscover = { screen: 'discover', id: null };
    // opening a conversation reads it: the dot goes until the host moves it again
    const seen = onScreenId(s);
    if (seen) {
      const c = s.conversations.find(x => x.id === seen);
      if (c && (c.lastSeen ?? 0) < (c.updatedAt ?? 0)) {
        s = upd(s, c.id, x => ({ ...x, lastSeen: x.updatedAt }));
        s.lastSeen = { ...(s.lastSeen ?? {}), [c.id]: c.updatedAt };
      }
    }
    return s;
  },
  toggleRail: s => ({ ...s, railCollapsed: !s.railCollapsed }),
  toggleList: s => ({ ...s, listOpen: !s.listOpen }),
  setListOpen: (s, open) => (s.listOpen === !!open ? s : { ...s, listOpen: !!open }),
  // a list group folds or opens; Archived starts folded (host/list-view.js)
  toggleGroup(s, key) {
    if (typeof key !== 'string' || key === '') return s;
    const was = typeof s.collapsed?.[key] === 'boolean' ? s.collapsed[key] : key === ARCHIVED_KEY;
    return { ...s, collapsed: { ...(s.collapsed ?? {}), [key]: !was } };
  },
  setTheme: (s, theme) => ({ ...s, theme }),
  setLang: (s, lang) => ({ ...s, lang: lang === 'zh' ? 'zh' : 'en' }),
  // a size or a font from Settings, kept in range or cleaned to a family name (js/prefs.js); any other name is not a pref
  setPref(s, { name, value } = {}) {
    if (name === 'textSize' || name === 'codeSize') return { ...s, [name]: sizeOf(name, value) };
    if (name === 'textFont' || name === 'codeFont') return { ...s, [name]: cleanFont(value) };
    return s;
  },

  toggleDetails: s => (s.detailsOpen ? { ...s, detailsOpen: false, edit: null, confirm: null } : { ...closeOverlays(s), detailsOpen: true }),
};
