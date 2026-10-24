// face/client/js/router.js — hash routes: #/messages/<id> · #/markets[/<id>] · #/trade[/<id>] · #/account/<tab> ·
// #/discover[/<shelf>] · #/plugin/<id> · #/channel/<workspaceId>. A market id is the Account's key (coin:BTC,
// event:predict:…) or the face's (us:AAPL, crypto:BTC/USD, cn:600519): everything after #/markets/, so a coin keeps its
// slash, written back raw; Trade's market to open (an Account key), a plugin's and a channel's id read the same way.
const TABS = ['portfolio', 'venues', 'agents', 'cards'];

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
    case 'channel': return { screen: 'channel', id: restOf(path) };
    case 'account': return { screen: 'account', tab: TABS.includes(a) ? a : 'portfolio' };
    case 'markets': return { screen: 'markets', id: restOf(path) };
    case 'trade': return { screen: 'trade', id: restOf(path) };
    case 'messages': return { screen: 'messages', id: a ?? null };
    default: return { screen: 'messages', id: null };
  }
}

export function toHash(route) {
  if (route.screen === 'account') return `#/account/${route.tab ?? 'portfolio'}`;
  return route.id ? `#/${route.screen}/${route.id}` : `#/${route.screen}`;
}
