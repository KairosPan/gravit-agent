// face/client/js/host/sheet-money.js — the Money tab's signed sheet (plan 4b Task 2): Move, the Account's own `liveMove` draft with
// the fields its own page signs it with (the retired page at 9614314c, ui/money.js openLiveMove, :59-183), nothing added and
// nothing renamed. Its fields follow the account it moves from and the kind of move: `refieldsOf` rebuilds them as either
// changes, keeping every value whose field survives. The seed is the page's at the press (`moveSeedOf`): every source with what
// it offers, so the sheet never reads the page again. host/sheet-view.js delegates the kind here; the sheet engine
// (host/sheet.js) prepares the draft and What you sign shows it. No clock. No DOM, no store.
import { moveSourcesOf, moveKindsOf, moveDestinationsOf, moveAssetsOf, networksOf, bridgeChainsOf, pageVenueOf, earnListOf, earnRate } from './money-view.js';
import { pageOk } from './account-view.js';
import { t, sayOf } from '../i18n/words.js';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = v => (typeof v === 'string' ? v : '');
const figure = v => (typeof v === 'number' && Number.isFinite(v) ? String(v) : str(v));
const opts = list => list.map(x => ({ value: x, label: x }));

/** The Money tab's sheet kinds: Move, and Earn (plan 4b Task 3); and the agent wallet Agents opens (plan 4b Task 5). */
export const MONEY_KINDS = ['move', 'earn', 'subWallet'];

/** The move sheet's seed from the page as it stands: the preset (`from`, `to`, `kind`, `amount` — a Top up's `to` an agent
 *  wallet's venue, its `amount` the ask's), the cap on each move, and every source money moves from with its kinds, its
 *  destinations (the not-served apart), its ledgers, its assets and the chains (money.js:63-77). */
export function moveSeedOf(page, preset = {}) {
  const p = isRecord(preset) ? preset : {};
  const sources = moveSourcesOf(page).map(src => {
    const v = pageVenueOf(page, src.id);
    const d = moveDestinationsOf(page, v);
    const { assets, toAssets } = moveAssetsOf(page, v);
    return {
      id: src.id, name: src.name, proven: str(v?.proven), kinds: moveKindsOf(v), dests: d.to, notServed: d.notServed,
      ledgers: (Array.isArray(v?.liveCan?.ledgers) ? v.liveCan.ledgers : []).map(String), assets, toAssets,
      networks: networksOf(page), chains: bridgeChainsOf(page),
    };
  });
  const cap = pageOk(page) ? page.connectLive?.writes?.capUsd : null;
  return {
    from: str(p.from), to: str(p.to), kind: str(p.kind), amount: figure(p.amount), sources,
    capUsd: typeof cap === 'number' && Number.isFinite(cap) ? cap : null,
  };
}

// the field's value from the form: the sheet's fields, or a plain { name: value }
function valueOf(fields, name) {
  const v = Array.isArray(fields) ? fields.find(f => isRecord(f) && f.name === name)?.value : isRecord(fields) ? fields[name] : undefined;
  return typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}
const has = (fields, name) => Array.isArray(fields) ? fields.some(f => isRecord(f) && f.name === name) : isRecord(fields) && Object.hasOwn(fields, name);

const sourcesOf = seed => records(seed?.sources);
const sourceOf = (seed, id) => sourcesOf(seed).find(s => s.id === id) ?? null;

// a select over options, the value given when it is one of them, else `fallback` when it is, else the first (as a browser's own
// select starts on its first option)
function select(name, label, options, value, fallback) {
  const live = options.filter(o => o.disabled !== true);
  const pick = [value, fallback].find(x => typeof x === 'string' && live.some(o => o.value === x)) ?? live[0]?.value ?? '';
  return { name, label, type: 'select', options, value: pick };
}
const amountField = (placeholder, value) => ({ name: 'amount', label: t('sheet.field.amount'), type: 'number', placeholder, value: typeof value === 'string' ? value : '' });

// the destinations a withdrawal or a send offers (money.js:85): each by name, a watched address named so and not offered
const destOptions = src => records(src.dests).map(d => ({ value: d.id, label: d.address && !d.proven ? t('sheet.move.watched', { name: d.name }) : `${d.name}`, ...(d.address && !d.proven ? { disabled: true } : {}) }));
// money.js:154-158 — money to an agent wallet starts on the chain that wallet already holds money or gas on
const fundedAt = (src, to) => str(records(src.dests).find(d => d.id === to)?.funded);

// money.js:154-158, :164-166 — on every change of destination the network follows it: to the chain that destination (an agent
// wallet) already holds money or gas on, where it is one the field offers; a destination holding nothing leaves the network as
// picked. The network field records the destination it last followed (`followed`), so a rebuild tells a new destination from the
// same one, and the operator's own pick of network stands until the destination changes again
function followTo(network, src, to, followed) {
  const funded = to ? fundedAt(src, to) : '';
  const moved = to !== (typeof followed === 'string' ? followed : null);
  const value = moved && funded && network.options.some(o => o.value === funded && o.disabled !== true) ? funded : network.value;
  return { ...network, value, followed: to };
}

/** The fields for a source and a kind (money.js:79-85, the `What` select first after `From`), each value the one given in
 *  `values` where its field still takes it, else the page's own start. */
function build(seed, values) {
  const sources = sourcesOf(seed);
  const fromField = select('from', t('sheet.move.from'), sources.map(s => ({ value: s.id, label: s.name })), values.from);
  const src = sourceOf(seed, fromField.value);
  if (!src) return [fromField];
  const kinds = records(src.kinds).map(k => ({ value: str(k.value), label: str(k.label) }));
  const kindField = select('kind', t('sheet.move.what'), kinds, values.kind);
  const k = kindField.value;
  const ledgers = opts(src.ledgers ?? []);
  const assets = opts(src.assets ?? []);
  const toAssets = opts(src.toAssets ?? []);
  const nets = opts(src.networks ?? []);
  const chains = opts(src.chains ?? []);
  const firstAsset = src.assets?.[0];
  let rest;
  if (k === 'transfer') {
    rest = [
      select('fromLedger', t('sheet.move.from'), ledgers, values.fromLedger),
      select('toLedger', t('sheet.move.to'), ledgers, values.toLedger, src.ledgers?.[1]),
      select('asset', t('sheet.move.currency'), assets, values.asset),
      amountField('50', values.amount),
    ];
  } else if (k === 'swap') {
    const asset = select('asset', t('sheet.move.sell'), assets, values.asset);
    rest = [asset, select('toAsset', t('sheet.move.buy'), toAssets, values.toAsset, (src.toAssets ?? []).find(a => a !== asset.value)), amountField('50', values.amount)];
  } else if (k === 'bridge') {
    const to = [{ value: src.id, label: t('sheet.move.thisWallet') }, ...records(src.dests).filter(d => !d.address || d.proven).map(d => ({ value: d.id, label: d.name }))];
    const asset = select('asset', t('sheet.move.send'), assets, values.asset);
    const toField = select('to', t('sheet.move.to'), to, values.to);
    rest = [
      toField,
      followTo(select('network', t('sheet.move.fromChain'), chains, values.network, src.chains?.[0]), src, toField.value, values.followed),
      select('toLedger', t('sheet.move.toChain'), chains, values.toLedger, src.chains?.[1] ?? src.chains?.[0]),
      asset,
      select('toAsset', t('sheet.move.arrivesAs'), toAssets, values.toAsset, firstAsset),
      amountField('25', values.amount),
    ];
  } else if (k) {
    // a withdrawal or a send: where it goes (none to offer: no field, and the draft says to connect one first), the network,
    // the currency
    const dests = destOptions(src);
    // every destination watched: still listed, each disabled, as the page lists them — so the operator sees why none is picked
    const to = dests.length ? [select('to', t('sheet.move.to'), dests, values.to)] : [];
    const network = followTo(select('network', t('sheet.move.network'), nets, values.network), src, to[0]?.value ?? '', values.followed);
    rest = [...to, network, select('asset', t('sheet.move.currency'), assets, values.asset), amountField('25', values.amount)];
  } else rest = [];
  return [fromField, kindField, ...rest];
}

/** The sheet's fields from the seed: its source (the preset's, else the first), its kind (the preset's where offered, else the
 *  first), `to` the preset's where it is offered, the amount the preset's. */
export function moneyFieldsOf(kind, seed) {
  if (kind === 'earn') return earnFieldsOf(seed);
  if (kind === 'subWallet') return subWalletFieldsOf(seed);
  if (kind !== 'move') return [];
  const s = isRecord(seed) ? seed : {};
  const amount = Number(s.amount) > 0 ? str(s.amount) : '';
  return build(s, { from: str(s.from), kind: str(s.kind), to: str(s.to), amount });
}

/** The fields again after a change: rebuilt for the source and the kind now picked, every value kept whose field survives and
 *  still takes it — so a kind or a source left behind takes its fields with it, and they never reach the draft. */
export function moneyRefieldsOf(kind, fields, seed) {
  if (kind === 'earn' && Array.isArray(fields)) return earnRefieldsOf(fields, seed);
  if (kind !== 'move' || !Array.isArray(fields)) return fields;
  const values = Object.fromEntries(fields.filter(f => isRecord(f) && typeof f.name === 'string').map(f => [f.name, typeof f.value === 'string' ? f.value : '']));
  // the destination the network last followed travels with the network field
  const followed = fields.find(f => isRecord(f) && f.name === 'network')?.followed;
  return build(isRecord(seed) ? seed : {}, { ...values, ...(typeof followed === 'string' ? { followed } : {}) });
}

/** The sheet's title: the source picked. */
export function moneyTitleOf(kind, seed, fields) {
  if (kind === 'earn') return t('sheet.title.earn');
  if (kind === 'subWallet') return t('sheet.title.subWallet');
  if (kind !== 'move') return '';
  const id = (fields !== undefined ? valueOf(fields, 'from') : '') || str(seed?.from);
  const src = sourceOf(seed, id) ?? sourcesOf(seed)[0];
  return src ? t('sheet.title.move', { name: src.name }) : t('sheet.title.moveAny');
}

/** The sheet's go key: an earn's by the side its fields picked (earn.js:83). */
export function moneyGoOf(kind, seed, fields) {
  if (kind === 'move') return t('sheet.go.move');
  if (kind === 'subWallet') return t('sheet.go.subWallet');
  if (kind !== 'earn') return '';
  return earnSideOf(seed, fields) === 'withdraw' ? t('sheet.go.takeOut') : t('sheet.go.putIn');
}

/** money.js:86-100 — the Account's `liveMove` from the fields, or, while it is not filled in, the page's words for it. Only the
 *  fields the sheet has now are read: a field the kind does not have is ''. */
export function moneyDraftOf(kind, fields, seed) {
  if (kind === 'earn') return earnDraftOf(fields, seed);
  if (kind === 'subWallet') return subWalletDraftOf(fields, seed);
  if (kind !== 'move') return t('sheet.nothingToSign');
  const from = valueOf(fields, 'from');
  const src = sourceOf(seed, from);
  if (!src) return t('sheet.move.noSource');
  const k = valueOf(fields, 'kind');
  if (!records(src.kinds).some(x => x.value === k)) return t('sheet.move.pickKind');
  const f = name => (has(fields, name) ? valueOf(fields, name) : '');
  const same = k === 'transfer' || k === 'swap';
  const d = {
    type: 'liveMove', kind: k, from: src.id, to: same ? src.id : f('to'), fromLedger: f('fromLedger'), toLedger: f('toLedger'),
    asset: f('asset') || 'USDC', toAsset: k === 'swap' || k === 'bridge' ? f('toAsset') || f('asset') : f('asset') || 'USDC',
    network: same ? '' : f('network'), amount: f('amount'),
  };
  if (!(Number(d.amount) > 0)) return t('sheet.move.fillIn');
  if (!same && !d.to) return t('sheet.move.connectFirst');
  return d;
}

/** The lines under the move sheet's fields (money.js:85, :94): the cap on each move, and the accounts it would go to that are
 *  not served on this network now. */
export function moveHintsOf(sheet) {
  if (!isRecord(sheet) || sheet.kind !== 'move') return [];
  const seed = isRecord(sheet.seed) ? sheet.seed : {};
  const cap = typeof seed.capUsd === 'number'
    ? t('sheet.move.capped', { cap: `$${seed.capUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }) : t('sheet.move.own');
  const src = sourceOf(seed, valueOf(sheet.fields, 'from'));
  const k = valueOf(sheet.fields, 'kind');
  const away = src && k !== 'transfer' && k !== 'swap' && k !== 'bridge' ? records(src.notServed).map(x => str(x.name)).filter(Boolean) : [];
  return [cap, away.length ? t('money.notServed', { venues: away.join(', ') }) : ''].filter(Boolean);
}

// ── a bridge's routes (money.js:91, :105-118) ──

// core.js:142 money — dollars to the cent; core.js:149 fine — a cent or less shown as it was
const num = v => (v === undefined || v === null || v === '' ? 0 : Number(v));
const dollars = n => { const v = num(n); return Number.isFinite(v) ? `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'; };
function fine(n) {
  const v = num(n);
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (!a || a >= 0.01) return dollars(v);
  const digits = a < 1e-6 ? Number(a.toPrecision(2)).toLocaleString('en-US', { maximumFractionDigits: 12 }) : a.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `${v < 0 ? '-' : ''}$${digits}`;
}
// money.js:91 — a route's time in the page's words
const eta = sec => {
  const s = num(sec);
  return s < 90 ? t('sheet.eta.seconds', { n: Math.max(1, Math.round(s)) }) : s < 5400 ? t('sheet.eta.minutes', { n: Math.round(s / 60) }) : t('sheet.eta.hours', { n: Math.round(s / 3600) });
};

/** The move sheet's routes line, for a bridge's preparation the sheet shows (`routes` the account slice's, asked for the
 *  sheet's own `asked`): `Finding the routes…` while asked; the chosen route (`Via <tool> · at least <$> <toAsset> arrives ·
 *  <eta> · network fee about <$> in your wallet`, `chosen` set) and the others (`Other routes: <tool> fee <$>, <eta>; …`);
 *  else the Account's words, else `No route answered.` Any other sheet, or a preparation not a bridge's: null. */
export function routesWordsOf(sheet, routes) {
  if (!isRecord(sheet) || sheet.kind !== 'move' || sheet.status !== 'ready') return null;
  const a = sheet.prepared?.action;
  if (!isRecord(a) || a.kind !== 'bridge') return null;
  if (!isRecord(routes) || routes.asked !== sheet.asked || routes.status === 'asking' || routes.status === 'idle') return { lead: t('sheet.routes.finding'), others: '' };
  if (routes.status !== 'ready') return { lead: sayOf(routes.message) || t('sheet.routes.none'), others: '' };
  const list = records(routes.data?.routes);
  const best = list[0];
  if (!best) return { lead: t('sheet.routes.none'), others: '' };
  const lead = [t('sheet.routes.via', { tool: str(best.tool) }), t('sheet.routes.arrives', { usd: dollars(best.receiveUsd), asset: str(a.toAsset) }), eta(best.etaSec),
    ...(num(best.gasUsd) ? [t('sheet.routes.gas', { usd: fine(best.gasUsd) })] : [])].join(' · ');
  const others = list.length > 1 ? t('sheet.routes.others', { routes: list.slice(1).map(x => t('sheet.routes.other', { tool: str(x.tool), fee: fine(x.feeUsd), eta: eta(x.etaSec) })).join('; ') }) : '';
  return { lead, others, chosen: true };
}

/** money.js:119-121 — the page's lines under a move's quote, for the preparation shown: where it goes (an address the Account
 *  holds the key of, one the owner's wallet signed for, or a venue's deposit address checked again), a bridge's `Your wallet
 *  sends it; it lands on <chain> when the bridge delivers.`, and `Can't be undone.` Nothing prepared, or another sheet: []. */
export function moveSaysOf(sheet) {
  if (!isRecord(sheet) || sheet.kind !== 'move' || !isRecord(sheet.prepared?.action)) return [];
  const a = sheet.prepared.action;
  const src = sourceOf(sheet.seed, str(a.from));
  const to = src ? records(src.dests).find(d => d.id === a.to) : null;
  if (a.kind === 'bridge') return [t('sheet.move.bridge', { chain: str(a.toLedger) })];
  const lines = [];
  if (str(a.toAddress)) {
    const name = str(to?.name) || str(a.to);
    lines.push(to?.address ? (/holds its key/.test(str(to.proven)) ? t('sheet.move.ownKey') : t('sheet.move.signedFor'))
      : t('sheet.move.deposit', { name }));
  }
  lines.push(t('sheet.move.final'));
  return lines;
}

// ── Earn (plan 4b Task 3; the retired page at 9614314c, ui/earn.js openEarn, :40-196) ──

const sides = () => [{ value: 'supply', label: t('sheet.earn.putIn') }, { value: 'withdraw', label: t('sheet.earn.takeOut') }];
const sideWord = v => (v === 'withdraw' ? 'withdraw' : 'supply');
const productKey = p => `${str(p?.venue)}|${str(p?.id)}`;
// a product as the sheet keeps it: what its fields, its draft and its lines read, nothing else
const earnProduct = p => ({
  key: productKey(p), venue: str(p.venue), venueName: str(p.venueName) || str(p.venue), id: str(p.id), name: str(p.name) || str(p.id),
  asset: str(p.asset), rate: earnRate(p), canSupply: p.canSupply === true, why: str(p.why), lands: str(p.lands),
  minAmount: typeof p.minAmount === 'number' ? p.minAmount : null,
  held: isRecord(p.held) && typeof p.held.amount === 'number' ? { amount: p.held.amount, asset: str(p.held.asset) || str(p.asset) } : null,
  ready: typeof p.ready === 'number' ? p.ready : 0,
});

/** The Earn sheet's seed from the Account's earn read and its page, at the press: the preset (`venue` — the sheet then offers
 *  that venue's products alone, earn.js:60 — `side`, `product` — the product's id at that venue), and the products each side
 *  lists (earnListOf, its order), so the sheet never reads the page again. */
export function earnSeedOf(earnBody, page, preset = {}) {
  const p = isRecord(preset) ? preset : {};
  const venue = str(p.venue);
  const listOf = side => earnListOf(earnBody, page, side).products.filter(x => !venue || x.venue === venue).map(earnProduct);
  return { venue, side: sideWord(p.side), product: venue && str(p.product) ? `${venue}|${str(p.product)}` : '', supply: listOf('supply'), withdraw: listOf('withdraw') };
}

const earnSideOf = (seed, fields) => sideWord((fields !== undefined ? valueOf(fields, 'side') : '') || str(seed?.side));
const earnListFor = (seed, side) => records(seed?.[side]);
const productLabel = (p, side) => [p.name, p.venueName, p.asset, p.rate].filter(Boolean).join(' · ')
  + (side === 'supply' && !p.canSupply ? ` · ${p.why ? t('sheet.earn.closedWhy', { why: p.why }) : t('sheet.earn.closed')}` : '');

// the fields for a side, each value the one given where its field still takes it: an amount typed for one asset is not carried
// to a product in another (earn.js:93-97) — the amount field records the asset it was typed for
function earnBuild(seed, values) {
  const side = sideWord(values.side);
  const list = earnListFor(seed, side);
  const product = select('product', t('sheet.earn.product'), list.map(p => ({ value: p.key, label: productLabel(p, side), ...(side === 'supply' && !p.canSupply ? { disabled: true } : {}) })), values.product);
  const p = list.find(x => x.key === product.value);
  const asset = str(p?.asset);
  const kept = typeof values.amountAsset !== 'string' || values.amountAsset === asset ? values.amount : '';
  const amount = { ...amountField('25', kept), label: asset ? t('sheet.earn.amountIn', { asset }) : t('sheet.field.amount'), asset };
  const all = side === 'withdraw' ? [{ name: 'all', label: t('sheet.earn.all'), type: 'check', value: values.all === true || values.all === 'true' }] : [];
  return [{ name: 'side', label: t('sheet.earn.side'), type: 'seg', options: sides(), value: side }, product, amount, ...all];
}

function earnFieldsOf(seed) {
  const s = isRecord(seed) ? seed : {};
  return earnBuild(s, { side: str(s.side), product: str(s.product) });
}

function earnRefieldsOf(fields, seed) {
  const f = name => fields.find(x => isRecord(x) && x.name === name);
  const values = Object.fromEntries(fields.filter(x => isRecord(x) && typeof x.name === 'string').map(x => [x.name, x.value]));
  return earnBuild(isRecord(seed) ? seed : {}, { ...values, amount: typeof values.amount === 'string' ? values.amount : '', amountAsset: f('amount')?.asset });
}

/** The product the fields picked, or null. */
export function earnPickedOf(sheet) {
  if (!isRecord(sheet) || sheet.kind !== 'earn') return null;
  const side = earnSideOf(sheet.seed, sheet.fields);
  return earnListFor(sheet.seed, side).find(p => p.key === valueOf(sheet.fields, 'product')) ?? null;
}

// earn.js:40, :136-139 — the Account's liveEarn: the product's own asset, the amount typed, or `all` of it out (the box ticked, or
// the word typed)
function earnDraftOf(fields, seed) {
  const side = earnSideOf(seed, fields);
  const list = earnListFor(seed, side);
  const p = list.find(x => x.key === valueOf(fields, 'product'));
  if (!p) return list.length ? t('sheet.earn.pickProduct') : side === 'supply' ? t('sheet.earn.noProduct') : t('sheet.earn.nothingIn');
  const typed = valueOf(fields, 'amount');
  const ticked = has(fields, 'all') && (Array.isArray(fields) ? fields.find(x => x?.name === 'all')?.value : fields.all);
  const all = side === 'withdraw' && (ticked === true || ticked === 'true' || typed.toLowerCase() === 'all');
  if (!all && !(Number(typed) > 0)) return side === 'withdraw' ? t('sheet.earn.amountOrAll') : t('sheet.earn.amount');
  return { type: 'liveEarn', venue: p.venue, kind: side, product: p.id, asset: p.asset, amount: all ? 'all' : typed };
}

const qty = n => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) >= 1000 ? 2 : 8 }) : '—');

/** earn.js:135, :139 — the lines under the Earn sheet's fields for the product picked: what is in it (Take out) or ready at its
 *  venue (Put in), where money taken out lands, the least that goes in. */
export function earnHintsOf(sheet) {
  const p = earnPickedOf(sheet);
  if (!p) return [];
  const side = earnSideOf(sheet.seed, sheet.fields);
  return [
    side === 'withdraw' ? t('sheet.earn.inIt', { qty: qty(p.held?.amount ?? 0), asset: p.asset }) : t('sheet.earn.readyAt', { qty: qty(p.ready), asset: p.asset, venue: p.venueName }),
    p.lands ? t('sheet.earn.lands', { where: p.lands }) : '',
    p.minAmount ? t('sheet.earn.least', { qty: qty(p.minAmount), asset: p.asset }) : '',
  ].filter(Boolean);
}

/** earn.js:145-146 — the lines under an earn's quote, from the preparation shown (`quote.earn`): about what it is worth, its yield,
 *  lock, protocol and chain, where it lands taken out, what is in it now, the Account's note. Nothing prepared: []. */
export function earnSaysOf(sheet) {
  if (!isRecord(sheet) || sheet.kind !== 'earn') return [];
  const x = sheet.prepared?.quote?.earn;
  if (!isRecord(x)) return [];
  const usd = typeof x.usd === 'number' ? `≈ ${dollars(x.usd)}` : '';
  const lock = x.lockDays ? t('sheet.earn.locked', { days: x.lockDays }) : x.lockDays === 0 ? t('sheet.earn.atOnce') : '';
  const held = !isRecord(x.held) ? ''
    : typeof x.held.usd === 'number' ? t('sheet.earn.heldUsd', { qty: qty(x.held.amount), asset: str(x.held.asset), usd: dollars(x.held.usd) })
      : t('sheet.earn.held', { qty: qty(x.held.amount), asset: str(x.held.asset) });
  return [usd, [earnRate(x), lock, str(x.protocol), str(x.chain)].filter(Boolean).join(' · '), str(x.lands) ? t('sheet.earn.landsOut', { where: x.lands }) : '', held, str(x.note)].filter(Boolean);
}

/** earn.js:186 — what a taken earn said: `Taking out all USDT · USDT · Flexible: done`; another answer: ''. */
export function earnSaidOf(body) {
  const e = body?.result?.earn;
  if (!isRecord(e)) return '';
  const status = str(e.status);
  const words = { amount: e.all ? t('sheet.earn.saidAll') : qty(Number(e.amount)), asset: str(e.asset), product: str(e.productName), status: status === 'done' ? t('sheet.earn.saidDone') : status };
  return `${e.kind === 'withdraw' ? t('sheet.earn.saidOut', words) : t('sheet.earn.saidIn', words)}${str(e.note) ? ` · ${e.note}` : ''}`;
}

// ── An agent wallet (plan 4b Task 5; the retired page at 9614314c, ui/portfolio.js pfWalletForm, :1263-1279, and money.js
// renderWallets, :381-389) ──

// portfolio.js:1270 — a wallet's name: a letter or a digit, then letters, digits, spaces, _ and -, up to 16 in all
const WALLET_NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,15}$/;
// the keys an agent wallet can be made for: the ones let in and standing (money.js:381, `status === 'ok'`), each by its address
const walletKeysOf = seed => records(seed?.keys).filter(k => k.status === 'ok' && str(k.address));

/** The agent wallet sheet's seed from the page at the press: the preset (`agent` — its address —, `name`, `float`) and the keys
 *  let in (the page's `keys`: `{ address, name, status }`), so the sheet never reads the page again. */
export function subWalletSeedOf(page, preset = {}) {
  const p = isRecord(preset) ? preset : {};
  const keys = pageOk(page) ? records(page.keys).map(k => ({ address: str(k.address), name: str(k.name), status: str(k.status) })) : [];
  return { agent: str(p.agent), name: str(p.name), float: figure(p.float), keys };
}

// portfolio.js:1266 — the name, the agent it pays for (the preset's where it is let in, else the first), how much it keeps at most
function subWalletFieldsOf(seed) {
  const s = isRecord(seed) ? seed : {};
  const keys = walletKeysOf(s);
  const asked = keys.find(k => k.address.toLowerCase() === str(s.agent).toLowerCase());
  return [
    { name: 'name', label: t('sheet.field.name'), type: 'text', placeholder: t('sheet.subWallet.example'), value: str(s.name) },
    { name: 'agent', label: t('sheet.subWallet.agent'), type: 'select', options: keys.map(k => ({ value: k.address, label: k.name || k.address })), value: asked ? asked.address : keys[0]?.address ?? '' },
    { name: 'float', label: t('sheet.subWallet.float'), type: 'number', placeholder: '50', value: str(s.float) },
  ];
}

// portfolio.js:1268-1275 — the Account's createSubAccount: the name as typed, the agent's address lower-cased, the float
function subWalletDraftOf(fields, seed) {
  const name = valueOf(fields, 'name');
  if (!WALLET_NAME.test(name)) return t('sheet.subWallet.badName');
  const agent = valueOf(fields, 'agent');
  if (!walletKeysOf(seed).some(k => k.address === agent)) return t('sheet.subWallet.pickAgent');
  const float = valueOf(fields, 'float');
  if (!(Number(float) > 0)) return t('sheet.subWallet.noFloat');
  return { type: 'createSubAccount', name, agent: agent.toLowerCase(), float };
}
