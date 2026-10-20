// face/client/js/router.js — hash routes: #/messages/<id> · #/markets[/<id>] · #/account/<tab> · #/mail[/<letter>] ·
// #/discover[/<shelf>] · #/plugin/<id>. A market id is the face's (us:AAPL, crypto:BTC/USD, cn:600519): everything after
// #/markets/, so a coin keeps its slash, written back raw.
const TABS = ['portfolio', 'venues'];

function marketId(path) {
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
    case 'plugin': return { screen: 'plugin', id: a ?? null };
    case 'account': return { screen: 'account', tab: TABS.includes(a) ? a : 'portfolio' };
    case 'markets': return { screen: 'markets', id: marketId(path) };
    case 'messages': return { screen: 'messages', id: a ?? null };
    case 'mail': return { screen: 'mail', id: a ?? null };
    default: return { screen: 'messages', id: null };
  }
}

export function toHash(route) {
  if (route.screen === 'account') return `#/account/${route.tab ?? 'portfolio'}`;
  return route.id ? `#/${route.screen}/${route.id}` : `#/${route.screen}`;
}
