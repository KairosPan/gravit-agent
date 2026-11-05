// face/client/js/host/explore-halves.js — one explore question asked of both upstreams (plan A2 Task 6), shared by the Markets
// host (host/markets.js) and Trade's (host/trade.js): the market's /data/market/explore and the account's
// /data/account/connected/explore, each its own flight of the host's, with the same query; each half's latest body kept for
// the kind, and their join (host/explore-join.js) landed over the page's venues and the venues read. The rule of a landing:
// - a half that answers lands the join at once, beside the other's latest body;
// - a half that failed (or answered no explore) waits for the other's answer to this ask: both failed is `failed`, with the
//   market's sentence, the last rows kept; the other answering lands it alone;
// - a new query for a kind, or the kind dropped, forgets what was kept: what is in the air for it lands nowhere.
// The host owns the flights (`fly`, `drop`, `kinds`: its one-flight-per-kind table); this owns the halves. No DOM.
import { venuesOf } from './account-view.js';
import { joinExplore } from './explore-join.js';
import { isSaid } from '../i18n/words.js';

export const MARKET_EXPLORE = '/data/market/explore';
export const CONNECTED_EXPLORE = '/data/account/connected/explore';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
// a said (the face's words in a refusal body, postVia's no-answer among them) passes as it is
const words = v => (isSaid(v) ? v : typeof v === 'string' && v.trim() !== '' ? v : null);
const messageOf = body => words(body?.refusal?.message) ?? words(body?.error);
const answered = body => body?.ok === true && Array.isArray(body.items);

/** What the join reads beside the halves, from the store's state: the page's venues and the venues read's rows. */
export function joinOptsOf(state) {
  const a = state?.account;
  const here = a?.venuesHere?.data;
  return { venues: venuesOf(a?.data), here: isRecord(here) && Array.isArray(here.venues) ? here.venues.filter(isRecord) : [] };
}

/** The question a query asks, as the join orders and cuts by it: its tab, search, sort and limit. */
export function orderOf(query) {
  const p = new URLSearchParams(query);
  const limit = Number(p.get('limit'));
  return { tab: p.get('tab') ?? '', q: p.get('q') ?? '', sort: p.get('sort') ?? '', ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}) };
}

/** The halves of a host's explore reads.
 * @param {{store: {get: () => any}, fly: Function, drop: (kind: string) => void, kinds: Map<string, {flight: unknown, path: string|null}>,
 *   now?: () => number, onMarket?: (body: any) => void}} deps `onMarket` is told every market half that answers
 */
export function exploreHalves({ store, fly, drop, kinds, now = Date.now, onMarket = () => {} }) {
  const halves = new Map();   // kind → { query, market, connected, said, landed: { market, connected } }
  const joinOf = kept => joinExplore(kept.market, kept.connected, { ...joinOptsOf(store.get()), ...orderOf(kept.query), now: now() });

  /** The kind's two halves dropped: what is in the air lands nowhere, and what was kept goes. */
  function forget(kind) {
    drop(`${kind}:market`);
    drop(`${kind}:account`);
    halves.delete(kind);
  }
  /** Ask `query` of both halves for `kind`; `land(join, kept)` on every landing that has rows, `failed(sentence)` when both failed. */
  function read(kind, query, { land, failed, loading = null }) {
    if (halves.has(kind) && halves.get(kind).query !== query) forget(kind);
    const kept = halves.get(kind) ?? { query, market: undefined, connected: undefined, said: null, landed: { market: true, connected: true } };
    halves.set(kind, kept);
    const ask = (half, flight, path) => {
      const k = kinds.get(flight);
      if (!(k && k.flight !== null && k.path === path)) kept.landed[half] = false;
      return path;
    };
    const landHalf = half => (body, refused) => {
      if (halves.get(kind) !== kept) return;
      const ok = !refused && answered(body);
      kept[half] = ok ? body : null;
      kept.landed[half] = true;
      if (half === 'market') kept.said = ok ? null : messageOf(body);
      if (half === 'market' && ok) onMarket(body);
      if (!ok && !kept.landed[half === 'market' ? 'connected' : 'market']) return;
      const data = joinOf(kept);
      if (data) land(data, kept);
      else if (kept.market === null && kept.connected === null) failed(kept.said);
    };
    fly(`${kind}:market`, ask('market', `${kind}:market`, `${MARKET_EXPLORE}?${query}`), landHalf('market'), loading);
    fly(`${kind}:account`, ask('connected', `${kind}:account`, `${CONNECTED_EXPLORE}?${query}`), landHalf('connected'));
  }
  return {
    read,
    forget,
    /** Each kind kept and its join made again now (the venues read landed, say); null where neither half answers. */
    rejoin: () => [...halves].map(([kind, kept]) => [kind, joinOf(kept)]),
    /** The market halves kept, every one. */
    markets: () => [...halves.values()].map(k => k.market).filter(isRecord),
  };
}
