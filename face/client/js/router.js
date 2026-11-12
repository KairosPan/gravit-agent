// face/client/js/router.js — hash routes: #/messages · #/task/<id> · #/history[/<id>] · #/strategy/<name> · #/markets[/<id>] ·
// #/trade[/<id>] · #/account/<tab> · #/discover[/<shelf>] · #/plugin/<id> · #/module/<name>. A market id is the Account's key
// (coin:BTC, event:predict:…) or the face's (us:AAPL, crypto:BTC/USD, cn:600519): everything after #/markets/, so a coin keeps
// its slash, written back raw; Trade's market to open (an Account key), a plugin's id, a module's name, a task's or a history
// session's id and a strategy's name read the same way. Two old forms still parse, for settle to place (app.js): #/messages/<id>
// (Messages with the id it named) and #/channel/<workspaceId> (Messages carrying the workspace). A stock's page at an event
// (spec 2026-11-12 §4.3) is #/markets/stock:<SYM>?at=<YYYY-MM-DD>&view=<view id>&case=<case id>: the id is what comes before
// the `?`, and the query its `event` when the id is a stock's and `at` a real day — any other market's query is dropped.
const TABS = ['portfolio', 'money', 'venues', 'agents', 'cards', 'rules', 'identity'];

function restOf(path) {
  const at = path.indexOf('/');
  if (at < 0 || at === path.length - 1) return null;
  const raw = path.slice(at + 1);
  try { return decodeURIComponent(raw); } catch { return raw; }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDay = v => DAY_RE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
const named = v => (typeof v === 'string' && v !== '' ? v : null);

// a markets path's id and, for a stock with a real `at`, its event; the id decoded as restOf decodes it
function marketsOf(path) {
  const q = path.indexOf('?');
  const id = restOf(q < 0 ? path : path.slice(0, q));
  if (q < 0 || typeof id !== 'string' || !id.startsWith('stock:')) return { screen: 'markets', id };
  const params = new URLSearchParams(path.slice(q + 1));
  const at = params.get('at') ?? '';
  if (!isDay(at)) return { screen: 'markets', id };
  const view = named(params.get('view')), kase = named(params.get('case'));
  return { screen: 'markets', id, event: { at, ...(view ? { view } : {}), ...(kase ? { case: kase } : {}) } };
}

/** A stock page's event as its hash's query, in the order at, view, case; nothing for any other route. */
function eventQuery(route) {
  const ev = route.screen === 'markets' && typeof route.id === 'string' && route.id.startsWith('stock:') ? route.event : null;
  if (!ev || !isDay(ev.at ?? '')) return '';
  const e = encodeURIComponent;
  return `?at=${ev.at}${named(ev.view) ? `&view=${e(ev.view)}` : ''}${named(ev.case) ? `&case=${e(ev.case)}` : ''}`;
}

export function parseHash(hash) {
  const path = (hash ?? '').replace(/^#\/?/, '');
  const [screen, a] = path.split('/').filter(Boolean);
  switch (screen) {
    case 'discover': return { screen: 'discover', id: a ?? null };
    case 'plugin': return { screen: 'plugin', id: restOf(path) };
    case 'module': return { screen: 'module', id: restOf(path) };
    case 'task': return { screen: 'task', id: restOf(path) };
    case 'history': return { screen: 'history', id: restOf(path) };
    case 'strategy': return { screen: 'strategy', id: restOf(path) };
    case 'channel': { const ws = restOf(path); return ws ? { screen: 'messages', id: null, channel: ws } : { screen: 'messages', id: null }; }
    case 'account': return { screen: 'account', tab: TABS.includes(a) ? a : 'portfolio' };
    case 'markets': return marketsOf(path);
    case 'trade': return { screen: 'trade', id: restOf(path) };
    case 'messages': return { screen: 'messages', id: a ?? null };
    default: return { screen: 'messages', id: null };
  }
}

export function toHash(route) {
  if (route.screen === 'account') return `#/account/${route.tab ?? 'portfolio'}`;
  // an old channel link waiting for the channels keeps its hash
  if (route.screen === 'messages' && route.channel) return `#/channel/${route.channel}`;
  return route.id ? `#/${route.screen}/${route.id}${eventQuery(route)}` : `#/${route.screen}`;
}
