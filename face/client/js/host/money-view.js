// face/client/js/host/money-view.js — the Money tab's pure rules (plan 4b Task 2), the Account page's own ported, each cited
// (account/src/portfolio/public/ui/core.js and money.js): which account is served from the network the Account runs on, which
// moves money and which gives an address to send to; the Account's published lists (its dollars, the chains money moves on, the
// chains a bridge joins) with the page's own fallbacks; the Receive rows, one account × one network each; and Move's sources,
// kinds and destinations. Every word is the Account page's. No DOM, no store.
import { pageOk, writesOn } from './account-view.js';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = v => (typeof v === 'string' ? v : '');

// core.js:266-267 — the lists the page keeps for an Account that does not publish its own yet
const DOLLARS_KNOWN = ['USD', 'USDC', 'USDC.E', 'USDT', 'USDT0', 'USD₮0', 'USD₮', 'FDUSD', 'PYUSD', 'DAI', 'TUSD', 'USDP', 'PUSD', 'USDG'];
const NETWORKS_KNOWN = ['Arbitrum', 'Base', 'Ethereum', 'Optimism', 'Polygon', 'BNB Chain'];
// money.js:211 — the EVM networks a wallet's one address is said on first
const RCV_EVM = ['Base', 'Arbitrum', 'Optimism', 'Polygon', 'Ethereum'];

// the page's venues as it lists them (its own records, every field the rules read)
const venuesOfPage = page => (pageOk(page) ? records(page.venues) : []);
// core.js:254 — a venue the Account is connected to
const connected = page => venuesOfPage(page).filter(v => v.live === true);
const listed = (page, key) => (isRecord(page) && Array.isArray(page[key]) && page[key].length ? page[key] : null);

/** core.js:268 — the dollar stablecoins the Account publishes, upper-cased; the page's own list where it publishes none. */
export function dollarsOf(page) {
  const l = listed(page, 'dollars');
  return l ? l.map(x => String(x).toUpperCase()) : [...DOLLARS_KNOWN];
}
const isDollar = (page, asset) => dollarsOf(page).includes(String(asset ?? '').toUpperCase());

/** core.js:270 — the chains money moves on, as the Account publishes them; the page's own six where it publishes none. */
export function networksOf(page) {
  const l = listed(page, 'networks');
  return l ? l.map(String) : [...NETWORKS_KNOWN];
}

/** core.js:271 — the chains a bridge joins, as the Account publishes them; else the chains money moves on. */
export function bridgeChainsOf(page) {
  const l = listed(page, 'bridgeChains');
  return l ? l.map(String) : networksOf(page);
}

/** core.js:1281 — a connected venue serves the network the Account runs on now (one marked `notServed` is offered for nothing
 *  from here until a check of this network finds it answering). */
export const servedHere = v => !(isRecord(v) && v.notServed);
// core.js:1277 — an address watched, never proven the owner's
const watched = v => !!v.address && !v.proven;

/** core.js:1300 — money can move from this venue: the Account takes writes, the venue's key or wallet says what moves, it is not
 *  read-only, not a watched address, served here, and it withdraws, moves between two ledgers, swaps or sends. */
export function canMove(v, page) {
  if (!isRecord(v) || !writesOn(page) || !isRecord(v.liveCan) || v.readOnlyBecause || watched(v) || !servedHere(v)) return false;
  const c = v.liveCan;
  return c.withdraw !== false || ((Array.isArray(c.ledgers) ? c.ledgers : []).length > 1 && c.transfer !== false) || c.swap !== false || !!c.send;
}

/** money.js:200 — this account gives an address to send to: a wallet proven the owner's (or one whose key the Account holds), or
 *  a venue whose key or sign-in gives deposit addresses; a watched address gives none, nor a venue the Account only reads. */
export function canReceive(v) {
  if (!isRecord(v) || !servedHere(v)) return false;
  return v.address ? !!v.proven : isRecord(v.liveCan) && v.liveCan.receive !== false && !v.readOnlyBecause;
}

// ── Receive (money.js:195-235) ──

// money.js:197 — the networks an address can be asked for: the chains money moves on and the chains a bridge joins
const receiveNetworks = page => (listed(page, 'networks') ? [...new Set([...networksOf(page), ...bridgeChainsOf(page)])] : [...NETWORKS_KNOWN, 'Robinhood Chain']);
// money.js:202 — what one might send there: the dollars first, then what the Account already holds there
const receiveAssets = v => [...new Set(['USDC', 'USDT', 'ETH', ...records(v.holdings).filter(h => h.class !== 'cash').map(h => String(h.asset).toUpperCase())])]
  .filter(a => /^[A-Z0-9.]{1,15}$/.test(a));
// money.js:204-209 — the asset an exchange row starts on: the dollar the venue holds most of, else the first it could receive
function rcvDefaultAsset(page, v) {
  const list = receiveAssets(v);
  const held = records(v.holdings).filter(h => h.amount > 0 && h.class !== 'cash' && isDollar(page, h.asset)).sort((a, b) => (b.usd || 0) - (a.usd || 0))[0];
  const a = held ? String(held.asset).toUpperCase() : '';
  return a && list.includes(a) ? a : list[0];
}
// money.js:212 — the five said first, then the others the Account publishes
const rcvEvmNetworks = page => { const all = receiveNetworks(page); return [...RCV_EVM.filter(n => all.includes(n)), ...all.filter(n => !RCV_EVM.includes(n))]; };
// money.js:214 — a Polymarket wallet lives on Polygon and takes pUSD alone
const rcvPolymarket = v => str(v.connector) === 'live:polymarket' || /^polymarket(-[0-9a-f]+)?$/.test(str(v.id));

/** money.js:216-233 — the Receive rows, one account × one network each, over the connected accounts that give an address: a
 *  wallet one row over every EVM network (its address is the same on each; a Polymarket wallet `Polygon · PUSD`), an exchange a
 *  row a network with its asset chip. Each `{ id, venue, venueName, network, networks, asset, assets, chip, kind }`. */
export function receiveRowsOf(page) {
  const rows = [];
  for (const v of connected(page).filter(canReceive)) {
    const base = { venue: str(v.id), venueName: str(v.name) || str(v.id) };
    if (v.address) {
      if (rcvPolymarket(v)) rows.push({ id: `${v.id}|Polygon`, ...base, network: 'Polygon', networks: ['Polygon'], asset: 'PUSD', assets: ['PUSD'], chip: false, kind: 'wallet' });
      else {
        const nets = rcvEvmNetworks(page);
        rows.push({ id: `${v.id}|evm`, ...base, network: nets.includes('Base') ? 'Base' : nets[0] || 'Base', networks: nets, asset: 'USDC', assets: ['USDC'], chip: false, kind: 'wallet' });
      }
      continue;
    }
    for (const n of receiveNetworks(page)) {
      rows.push({ id: `${v.id}|${n}`, ...base, network: n, networks: [n], asset: rcvDefaultAsset(page, v), assets: receiveAssets(v), chip: true, kind: 'exchange' });
    }
  }
  return rows;
}

/** money.js:235 — a row's network words: one network, or every EVM network with the same address. */
export const receiveNetworkWords = row => (row.networks.length > 1 ? `All EVM networks: ${row.networks.join(', ')}` : row.network);

// ── Move (money.js:59-191) ──

/** The venues money moves from (`canMove`), the agent wallets (`agent-*`) among them — moved from, they are taken back. Each
 *  `{ id, name, usd, agent }`. */
export function moveSourcesOf(page) {
  return connected(page).filter(v => canMove(v, page)).map(v => ({
    id: str(v.id), name: str(v.name) || str(v.id), usd: typeof v.usd === 'number' ? v.usd : null, agent: str(v.id).startsWith('agent-'),
  }));
}

/** money.js:65 — the kinds of move this venue offers, each `{ value, label }`: a withdrawal where it withdraws and does not send;
 *  a send from a wallet; across chains from a wallet proven the owner's; between its own ledgers where it has two; a stablecoin
 *  swap where it swaps and does not send. */
export function moveKindsOf(v) {
  if (!isRecord(v) || !isRecord(v.liveCan)) return [];
  const c = v.liveCan;
  const ledgers = Array.isArray(c.ledgers) ? c.ledgers : [];
  return [
    ...(c.withdraw !== false && !c.send ? [{ value: 'withdraw', label: 'Withdraw to another account of yours' }] : []),
    ...(c.send ? [{ value: 'send', label: 'Send from this wallet' }] : []),
    ...(c.send === 'wallet' && v.proven ? [{ value: 'bridge', label: 'Across chains' }] : []),
    ...(ledgers.length > 1 && c.transfer !== false ? [{ value: 'transfer', label: 'Between its own ledgers' }] : []),
    ...(c.swap !== false && !c.send ? [{ value: 'swap', label: 'Swap stablecoins' }] : []),
  ];
}

// money.js:8-14 — the chain an agent wallet's money and gas sit on: the first chain money moves on with a dollar on it, else with
// anything on it; '' when it holds nothing yet
function fundedChainOf(page, v) {
  const nets = networksOf(page);
  const rows = records(v?.holdings).filter(h => h.amount > 0 && nets.includes(String(h.note ?? '')));
  const dollars = rows.filter(h => isDollar(page, h.asset));
  return str((dollars[0] || rows[0] || {}).note);
}

/** money.js:69-70 — where money from this venue can go: the other connected accounts that receive and serve the network the
 *  Account runs on now (`to`, each `{ id, name, address, proven, watched, funded }` — `funded` the chain an agent wallet holds
 *  money on); the ones that would but are not served here named apart (`notServed`, `{ id, name }`). */
export function moveDestinationsOf(page, v) {
  const from = isRecord(v) ? str(v.id) : '';
  const takes = venuesOfPage(page).filter(x => str(x.id) !== from && x.watchOnly && isRecord(x.liveCan) && x.liveCan.receive && !x.readOnlyBecause);
  return {
    to: takes.filter(servedHere).map(x => ({
      id: str(x.id), name: str(x.name) || str(x.id), address: str(x.address), proven: str(x.proven), watched: watched(x), funded: fundedChainOf(page, x),
    })),
    notServed: takes.filter(x => !servedHere(x)).map(x => ({ id: str(x.id), name: str(x.name) || str(x.id) })),
  };
}

/** money.js:72-74 — what can leave this venue (the dollars it holds, of those the Account knows; else the first two it knows
 *  but USD), and what it can become (any of them but USD). */
export function moveAssetsOf(page, v) {
  const held = [...new Set(records(v?.holdings).filter(h => h.amount > 0 && isDollar(page, h.asset)).map(h => String(h.asset).toUpperCase()))];
  const toAssets = dollarsOf(page).filter(a => a !== 'USD');
  return { assets: held.length ? held : toAssets.slice(0, 2), toAssets };
}

/** A page's venue by id (its own record), or null. */
export const pageVenueOf = (page, id) => venuesOfPage(page).find(v => v.id === id) ?? null;

// ── Earn (earn.js:9-52) ──

/** earn.js:42 — a yield as the venue states it: `5.20% APY`, or a range `4.00%–6.00% APR`; none stated: ''. */
export function earnRate(x) {
  if (!isRecord(x) || typeof x.apy !== 'number' || !Number.isFinite(x.apy)) return '';
  const high = typeof x.apyHigh === 'number' && Number.isFinite(x.apyHigh) ? `–${(x.apyHigh * 100).toFixed(2)}%` : '';
  return `${(x.apy * 100).toFixed(2)}%${high} ${(str(x.rateKind) || 'apy').toUpperCase()}`;
}

const upper = v => String(v ?? '').toUpperCase();
// earn.js:12-15 — what is ready at a product's venue in its asset, to put in: not what is on its way, nor what is already in an
// earn product there
function earnReady(page, p) {
  const v = pageVenueOf(page, p.venue);
  return records(v?.holdings).filter(h => upper(h.asset) === upper(p.asset) && !h.inTransit && h.class !== 'earn')
    .reduce((s, h) => s + (typeof h.amount === 'number' && Number.isFinite(h.amount) ? h.amount : 0), 0);
}

/** earn.js:11-38, :203-213 — the products Earn lists for a side, from the Account's earn read and its page. Only venues served on
 *  the network the Account runs on now are offered (a read's place refusal, or a venue marked `notServed`). To put money in
 *  (`supply`): the products that take money now, those whose asset is ready at their venue first, then the rest that take money,
 *  then the closed ones (each with its `why`); to take it out (`withdraw`): the products something is in. Each product is the
 *  Account's own, with `held` (the position in it, or null) and `ready` (what is ready at its venue in its asset). Beside them:
 *  `away` (the venues not served here, each once, with their words), `failed` (the reads that failed, each once, in their words)
 *  and `refusing` (a venue whose key can't put money to earn, with its words). */
export function earnListOf(earnBody, page, side) {
  const body = isRecord(earnBody) && earnBody.ok !== false ? earnBody : {};
  const missing = records(body.missing);
  const awayMiss = m => m.code === 'E_VENUE_GEOBLOCKED' || !servedHere(pageVenueOf(page, m.venue));
  const awayRead = new Set(missing.filter(awayMiss).map(m => str(m.venue)));
  const here = id => !awayRead.has(id) && servedHere(pageVenueOf(page, id));
  const products = records(body.products).filter(p => here(str(p.venue)));
  const positions = records(body.positions).filter(h => here(str(h.venue)));
  const heldIn = p => positions.find(h => h.venue === p.venue && h.product === p.id) ?? null;
  const row = p => ({ ...p, held: heldIn(p), ready: earnReady(page, p) });
  let list;
  if (side === 'withdraw') list = products.filter(p => { const h = heldIn(p); return !!h && h.amount > 0; });
  else {
    const open = products.filter(p => p.canSupply === true);
    const ready = new Set(open.filter(p => earnReady(page, p) > 0));
    list = [...open.filter(p => ready.has(p)), ...open.filter(p => !ready.has(p)), ...products.filter(p => p.canSupply !== true)];
  }
  // earn.js:31-38 — the venues not served here, each once: the read's, then a connected venue that earns and is marked so
  const away = new Map();
  for (const m of missing) if (awayMiss(m) && !away.has(str(m.venue))) away.set(str(m.venue), { venue: str(m.venue), venueName: str(m.venueName) || str(m.venue), why: str(m.why) });
  for (const v of venuesOfPage(page)) {
    if (v.live === true && v.earn && !servedHere(v) && !away.has(str(v.id))) away.set(str(v.id), { venue: str(v.id), venueName: str(v.name) || str(v.id), why: str(v.notServed?.said) || (typeof v.notServed === 'string' ? v.notServed : '') });
  }
  const seen = new Set(away.keys());
  const failed = missing.filter(m => !seen.has(str(m.venue)) && seen.add(str(m.venue))).map(m => ({ venue: str(m.venue), venueName: str(m.venueName) || str(m.venue), why: str(m.why) }));
  // earn.js:78 — a venue whose key may not put money to earn, in its words
  const refusing = records(body.venues).filter(v => v.can === false && !away.has(str(v.venue)))
    .map(v => ({ venue: str(v.venue), venueName: str(v.venueName) || str(v.venue), why: str(v.whyNot) || "this key can't put money to earn" }));
  return { products: list.map(row), away: [...away.values()], failed, refusing };
}

/** portfolio.js:668 — money can be taken out of an earn product at this venue from here: the Account takes writes, the venue is
 *  connected, earns, its key may, and it is served here. (Only a page that signs draws the key.) */
export function earnOutAt(page, venue) {
  const v = connected(page).find(x => x.id === venue);
  return writesOn(page) && !!v && isRecord(v.earn) && v.earn.can !== false && servedHere(v);
}
