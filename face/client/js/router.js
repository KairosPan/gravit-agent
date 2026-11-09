// face/client/js/router.js — hash routes: #/messages · #/task/<id> · #/history[/<id>] · #/strategy/<name> · #/markets[/<id>] ·
// #/trade[/<id>] · #/account/<tab> · #/discover[/<shelf>] · #/plugin/<id> · #/module/<name>. A market id is the Account's key
// (coin:BTC, event:predict:…) or the face's (us:AAPL, crypto:BTC/USD, cn:600519): everything after #/markets/, so a coin keeps
// its slash, written back raw; Trade's market to open (an Account key), a plugin's id, a module's name, a task's or a history
// session's id and a strategy's name read the same way. Two old forms still parse, for settle to place (app.js): #/messages/<id>
// (Messages with the id it named) and #/channel/<workspaceId> (Messages carrying the workspace).
const TABS = ['portfolio', 'money', 'venues', 'agents', 'cards', 'rules', 'identity'];

function restOf(path) {
  const at = path.indexOf('/');
  if (at < 0 || at === path.length - 1) return null;
  const raw = path.slice(at + 1);
  try { return decodeURIComponent(raw); } catch { return raw; }
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
    case 'markets': return { screen: 'markets', id: restOf(path) };
    case 'trade': return { screen: 'trade', id: restOf(path) };
    case 'messages': return { screen: 'messages', id: a ?? null };
    default: return { screen: 'messages', id: null };
  }
}

export function toHash(route) {
  if (route.screen === 'account') return `#/account/${route.tab ?? 'portfolio'}`;
  // an old channel link waiting for the channels keeps its hash
  if (route.screen === 'messages' && route.channel) return `#/channel/${route.channel}`;
  return route.id ? `#/${route.screen}/${route.id}` : `#/${route.screen}`;
}
