// face/client/js/router.js — hash routes: #/messages · #/task/<id> · #/history[/<id>] · #/strategy/<name> · #/desk · #/markets[/<id>] ·
// #/trade[/<id>] · #/account/<tab> · #/memory/<tab> · #/discover[/<shelf>] · #/plugin/<id> · #/module/<name>. A market id is the Account's key
// (coin:BTC, event:predict:…) or the face's (us:AAPL, crypto:BTC/USD, cn:600519): everything after #/markets/, so a coin keeps
// its slash, written back raw; Trade's market to open (an Account key), a plugin's id, a module's name, a task's or a history
// session's id and a strategy's name read the same way. Two old forms still parse, for settle to place (app.js): #/messages/<id>
// (Messages with the id it named) and #/channel/<workspaceId> (Messages carrying the workspace). A stock's page at an event
// (spec 2026-11-12 §4.3) is #/markets/stock:<SYM>?at=<YYYY-MM-DD>&view=<view id>&case=<case id>: the id is what comes before
// the `?`, and the query its `event` when the id is a stock's and `at` a real day — any other market's query is dropped. Its
// `after` (event analog redesign §4.5), the sessions drawn after day 0, is kept only from 61 to 250: 60 is the page's own.
const TABS = ['portfolio', 'money', 'venues', 'agents', 'cards', 'rules', 'identity'];
/** The Memory screen's tabs, in the order drawn; the first is the one an address with no tab, or an unknown one, opens. */
export const MEMORY_TABS = Object.freeze(['lessons', 'decisions', 'waiting', 'health']);

function restOf(path) {
  const at = path.indexOf('/');
  if (at < 0 || at === path.length - 1) return null;
  const raw = path.slice(at + 1);
  try { return decodeURIComponent(raw); } catch { return raw; }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDay = v => DAY_RE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
const named = v => (typeof v === 'string' && v !== '' ? v : null);
// an `after` the page keeps: a whole number from 61 to 250, else none (60, the page's own, is never written)
const afterOf = v => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,3}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n > 60 && n <= 250 ? n : null;
};

// a markets path's id and, for a stock with a real `at`, its event; the id decoded as restOf decodes it
function marketsOf(path) {
  const q = path.indexOf('?');
  const id = restOf(q < 0 ? path : path.slice(0, q));
  if (q < 0 || typeof id !== 'string' || !id.startsWith('stock:')) return { screen: 'markets', id };
  const params = new URLSearchParams(path.slice(q + 1));
  const at = params.get('at') ?? '';
  if (!isDay(at)) return { screen: 'markets', id };
  const view = named(params.get('view')), kase = named(params.get('case')), after = afterOf(params.get('after'));
  return { screen: 'markets', id, event: { at, ...(view ? { view } : {}), ...(kase ? { case: kase } : {}), ...(after !== null ? { after } : {}) } };
}

/** A stock page's event as its hash's query, in the order at, view, case, after; nothing for any other route. */
function eventQuery(route) {
  const ev = route.screen === 'markets' && typeof route.id === 'string' && route.id.startsWith('stock:') ? route.event : null;
  if (!ev || !isDay(ev.at ?? '')) return '';
  const e = encodeURIComponent;
  const after = afterOf(ev.after);
  return `?at=${ev.at}${named(ev.view) ? `&view=${e(ev.view)}` : ''}${named(ev.case) ? `&case=${e(ev.case)}` : ''}${after !== null ? `&after=${after}` : ''}`;
}

export function parseHash(hash) {
  const path = (hash ?? '').replace(/^#\/?/, '');
  const [screen, a] = path.split('/').filter(Boolean);
  switch (screen) {
    case 'desk': return { screen: 'desk', id: null };
    case 'discover': return { screen: 'discover', id: a ?? null };
    case 'plugin': return { screen: 'plugin', id: restOf(path) };
    case 'module': return { screen: 'module', id: restOf(path) };
    case 'task': return { screen: 'task', id: restOf(path) };
    case 'history': return { screen: 'history', id: restOf(path) };
    case 'strategy': return { screen: 'strategy', id: restOf(path) };
    case 'channel': { const ws = restOf(path); return ws ? { screen: 'messages', id: null, channel: ws } : { screen: 'messages', id: null }; }
    case 'account': return { screen: 'account', tab: TABS.includes(a) ? a : 'portfolio' };
    case 'memory': return { screen: 'memory', tab: MEMORY_TABS.includes(a) ? a : MEMORY_TABS[0] };
    case 'markets': return marketsOf(path);
    case 'trade': return { screen: 'trade', id: restOf(path) };
    case 'messages': return { screen: 'messages', id: a ?? null };
    default: return { screen: 'messages', id: null };
  }
}

export function toHash(route) {
  if (route.screen === 'account') return `#/account/${route.tab ?? 'portfolio'}`;
  if (route.screen === 'memory') return `#/memory/${MEMORY_TABS.includes(route.tab) ? route.tab : MEMORY_TABS[0]}`;
  // an old channel link waiting for the channels keeps its hash
  if (route.screen === 'messages' && route.channel) return `#/channel/${route.channel}`;
  return route.id ? `#/${route.screen}/${route.id}${eventQuery(route)}` : `#/${route.screen}`;
}
