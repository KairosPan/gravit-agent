// face/client/js/host/sheet-money.js — the Money tab's signed sheet (plan 4b Task 2): Move, the Account's own `liveMove` draft with
// the fields its own page signs it with (account/src/portfolio/public/ui/money.js openLiveMove, :59-183), nothing added and
// nothing renamed. Its fields follow the account it moves from and the kind of move: `refieldsOf` rebuilds them as either
// changes, keeping every value whose field survives. The seed is the page's at the press (`moveSeedOf`): every source with what
// it offers, so the sheet never reads the page again. host/sheet-view.js delegates the kind here; the sheet engine
// (host/sheet.js) prepares the draft and What you sign shows it. No clock. No DOM, no store.
import { moveSourcesOf, moveKindsOf, moveDestinationsOf, moveAssetsOf, networksOf, bridgeChainsOf, pageVenueOf, earnListOf, earnRate } from './money-view.js';
import { pageOk } from './account-view.js';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = v => (typeof v === 'string' ? v : '');
const figure = v => (typeof v === 'number' && Number.isFinite(v) ? String(v) : str(v));
const opts = list => list.map(x => ({ value: x, label: x }));

/** The Money tab's sheet kinds: Move, and Earn (plan 4b Task 3). */
export const MONEY_KINDS = ['move', 'earn'];

const FILL_IN = 'Fill it in to see where it goes and what it costs.';
const CONNECT_FIRST = 'Connect where it should go first.';

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
const amountField = (placeholder, value) => ({ name: 'amount', label: 'Amount', type: 'number', placeholder, value: typeof value === 'string' ? value : '' });

// the destinations a withdrawal or a send offers (money.js:85): each by name, a watched address named so and not offered
const destOptions = src => records(src.dests).map(d => ({ value: d.id, label: `${d.name}${d.address ? (d.proven ? '' : ' · watched') : ''}`, ...(d.address && !d.proven ? { disabled: true } : {}) }));
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
  const fromField = select('from', 'From', sources.map(s => ({ value: s.id, label: s.name })), values.from);
  const src = sourceOf(seed, fromField.value);
  if (!src) return [fromField];
  const kinds = records(src.kinds).map(k => ({ value: str(k.value), label: str(k.label) }));
  const kindField = select('kind', 'What', kinds, values.kind);
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
      select('fromLedger', 'From', ledgers, values.fromLedger),
      select('toLedger', 'To', ledgers, values.toLedger, src.ledgers?.[1]),
      select('asset', 'Currency', assets, values.asset),
      amountField('50', values.amount),
    ];
  } else if (k === 'swap') {
    const asset = select('asset', 'Sell', assets, values.asset);
    rest = [asset, select('toAsset', 'Buy', toAssets, values.toAsset, (src.toAssets ?? []).find(a => a !== asset.value)), amountField('50', values.amount)];
  } else if (k === 'bridge') {
    const to = [{ value: src.id, label: 'This wallet, on the other chain' }, ...records(src.dests).filter(d => !d.address || d.proven).map(d => ({ value: d.id, label: d.name }))];
    const asset = select('asset', 'Send', assets, values.asset);
    const toField = select('to', 'To', to, values.to);
    rest = [
      toField,
      followTo(select('network', 'From chain', chains, values.network, src.chains?.[0]), src, toField.value, values.followed),
      select('toLedger', 'To chain', chains, values.toLedger, src.chains?.[1] ?? src.chains?.[0]),
      asset,
      select('toAsset', 'Arrives as', toAssets, values.toAsset, firstAsset),
      amountField('25', values.amount),
    ];
  } else if (k) {
    // a withdrawal or a send: where it goes (none to offer: no field, and the draft says to connect one first), the network,
    // the currency
    const dests = destOptions(src);
    // every destination watched: still listed, each disabled, as the page lists them — so the operator sees why none is picked
    const to = dests.length ? [select('to', 'To', dests, values.to)] : [];
    const network = followTo(select('network', 'Network', nets, values.network), src, to[0]?.value ?? '', values.followed);
    rest = [...to, network, select('asset', 'Currency', assets, values.asset), amountField('25', values.amount)];
  } else rest = [];
  return [fromField, kindField, ...rest];
}

/** The sheet's fields from the seed: its source (the preset's, else the first), its kind (the preset's where offered, else the
 *  first), `to` the preset's where it is offered, the amount the preset's. */
export function moneyFieldsOf(kind, seed) {
  if (kind === 'earn') return earnFieldsOf(seed);
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
  if (kind === 'earn') return 'Earn';
  if (kind !== 'move') return '';
  const id = (fields !== undefined ? valueOf(fields, 'from') : '') || str(seed?.from);
  const src = sourceOf(seed, id) ?? sourcesOf(seed)[0];
  return src ? `Move money · ${src.name}` : 'Move money';
}

/** The sheet's go key: an earn's by the side its fields picked (earn.js:83). */
export function moneyGoOf(kind, seed, fields) {
  if (kind === 'move') return 'Sign and move';
  if (kind !== 'earn') return '';
  return earnSideOf(seed, fields) === 'withdraw' ? 'Sign and take out' : 'Sign and put in';
}

/** money.js:86-100 — the Account's `liveMove` from the fields, or, while it is not filled in, the page's words for it. Only the
 *  fields the sheet has now are read: a field the kind does not have is ''. */
export function moneyDraftOf(kind, fields, seed) {
  if (kind === 'earn') return earnDraftOf(fields, seed);
  if (kind !== 'move') return 'Nothing to sign here';
  const from = valueOf(fields, 'from');
  const src = sourceOf(seed, from);
  if (!src) return 'No account to move money from';
  const k = valueOf(fields, 'kind');
  if (!records(src.kinds).some(x => x.value === k)) return 'Pick what to move';
  const f = name => (has(fields, name) ? valueOf(fields, name) : '');
  const same = k === 'transfer' || k === 'swap';
  const d = {
    type: 'liveMove', kind: k, from: src.id, to: same ? src.id : f('to'), fromLedger: f('fromLedger'), toLedger: f('toLedger'),
    asset: f('asset') || 'USDC', toAsset: k === 'swap' || k === 'bridge' ? f('toAsset') || f('asset') : f('asset') || 'USDC',
    network: same ? '' : f('network'), amount: f('amount'),
  };
  if (!(Number(d.amount) > 0)) return FILL_IN;
  if (!same && !d.to) return CONNECT_FIRST;
  return d;
}

/** The lines under the move sheet's fields (money.js:85, :94): the cap on each move, and the accounts it would go to that are
 *  not served on this network now. */
export function moveHintsOf(sheet) {
  if (!isRecord(sheet) || sheet.kind !== 'move') return [];
  const seed = isRecord(sheet.seed) ? sheet.seed : {};
  const cap = typeof seed.capUsd === 'number' ? `Only to your own accounts. Up to $${seed.capUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a move.` : 'Only to your own accounts.';
  const src = sourceOf(seed, valueOf(sheet.fields, 'from'));
  const k = valueOf(sheet.fields, 'kind');
  const away = src && k !== 'transfer' && k !== 'swap' && k !== 'bridge' ? records(src.notServed).map(x => str(x.name)).filter(Boolean) : [];
  return [cap, away.length ? `Not served on this network now: ${away.join(', ')}.` : ''].filter(Boolean);
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
const eta = sec => { const s = num(sec); return s < 90 ? `~${Math.max(1, Math.round(s))} s` : s < 5400 ? `~${Math.round(s / 60)} min` : `~${Math.round(s / 3600)} h`; };

/** The move sheet's routes line, for a bridge's preparation the sheet shows (`routes` the account slice's, asked for the
 *  sheet's own `asked`): `Finding the routes…` while asked; the chosen route (`Via <tool> · at least <$> <toAsset> arrives ·
 *  <eta> · network fee about <$> in your wallet`) and the others (`Other routes: <tool> fee <$>, <eta>; …`); else the
 *  Account's words, else `No route answered.` Any other sheet, or a preparation not a bridge's: null. */
export function routesWordsOf(sheet, routes) {
  if (!isRecord(sheet) || sheet.kind !== 'move' || sheet.status !== 'ready') return null;
  const a = sheet.prepared?.action;
  if (!isRecord(a) || a.kind !== 'bridge') return null;
  if (!isRecord(routes) || routes.asked !== sheet.asked || routes.status === 'asking' || routes.status === 'idle') return { lead: 'Finding the routes…', others: '' };
  if (routes.status !== 'ready') return { lead: str(routes.message) || 'No route answered.', others: '' };
  const list = records(routes.data?.routes);
  const best = list[0];
  if (!best) return { lead: 'No route answered.', others: '' };
  const lead = [`Via ${str(best.tool)}`, `at least ${dollars(best.receiveUsd)} ${str(a.toAsset)} arrives`, eta(best.etaSec),
    ...(num(best.gasUsd) ? [`network fee about ${fine(best.gasUsd)} in your wallet`] : [])].join(' · ');
  const others = list.length > 1 ? `Other routes: ${list.slice(1).map(x => `${str(x.tool)} fee ${fine(x.feeUsd)}, ${eta(x.etaSec)}`).join('; ')}` : '';
  return { lead, others };
}

/** money.js:119-121 — the page's lines under a move's quote, for the preparation shown: where it goes (an address the Account
 *  holds the key of, one the owner's wallet signed for, or a venue's deposit address checked again), a bridge's `Your wallet
 *  sends it; it lands on <chain> when the bridge delivers.`, and `Can't be undone.` Nothing prepared, or another sheet: []. */
export function moveSaysOf(sheet) {
  if (!isRecord(sheet) || sheet.kind !== 'move' || !isRecord(sheet.prepared?.action)) return [];
  const a = sheet.prepared.action;
  const src = sourceOf(sheet.seed, str(a.from));
  const to = src ? records(src.dests).find(d => d.id === a.to) : null;
  if (a.kind === 'bridge') return [`Your wallet sends it; it lands on ${str(a.toLedger)} when the bridge delivers. Can't be undone.`];
  const lines = [];
  if (str(a.toAddress)) {
    const name = str(to?.name) || str(a.to);
    lines.push(to?.address ? (/holds its key/.test(str(to.proven)) ? "The agent wallet's own address: this account holds its key." : 'The address your wallet signed for.')
      : `${name}'s deposit address, checked again before sending.`);
  }
  lines.push("Can't be undone.");
  return lines;
}

// ── Earn (plan 4b Task 3; account/src/portfolio/public/ui/earn.js openEarn, :40-196) ──

const SIDES = [{ value: 'supply', label: 'Put in' }, { value: 'withdraw', label: 'Take out' }];
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
const productLabel = (p, side) => [p.name, p.venueName, p.asset, p.rate].filter(Boolean).join(' · ') + (side === 'supply' && !p.canSupply ? ` · Closed${p.why ? `: ${p.why}` : ''}` : '');

// the fields for a side, each value the one given where its field still takes it: an amount typed for one asset is not carried
// to a product in another (earn.js:93-97) — the amount field records the asset it was typed for
function earnBuild(seed, values) {
  const side = sideWord(values.side);
  const list = earnListFor(seed, side);
  const product = select('product', 'Product', list.map(p => ({ value: p.key, label: productLabel(p, side), ...(side === 'supply' && !p.canSupply ? { disabled: true } : {}) })), values.product);
  const p = list.find(x => x.key === product.value);
  const asset = str(p?.asset);
  const kept = typeof values.amountAsset !== 'string' || values.amountAsset === asset ? values.amount : '';
  const amount = { ...amountField('25', kept), label: asset ? `Amount (${asset})` : 'Amount', asset };
  const all = side === 'withdraw' ? [{ name: 'all', label: 'All of it', type: 'check', value: values.all === true || values.all === 'true' }] : [];
  return [{ name: 'side', label: 'Put in or take out', type: 'seg', options: SIDES, value: side }, product, amount, ...all];
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
  if (!p) return list.length ? 'Pick a product' : side === 'supply' ? 'No product takes money from here right now.' : 'Nothing is earning to take out.';
  const typed = valueOf(fields, 'amount');
  const ticked = has(fields, 'all') && (Array.isArray(fields) ? fields.find(x => x?.name === 'all')?.value : fields.all);
  const all = side === 'withdraw' && (ticked === true || ticked === 'true' || typed.toLowerCase() === 'all');
  if (!all && !(Number(typed) > 0)) return side === 'withdraw' ? 'Type an amount, or take all of it.' : 'Type an amount.';
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
    side === 'withdraw' ? `${qty(p.held?.amount ?? 0)} ${p.asset} in it` : `${qty(p.ready)} ${p.asset} at ${p.venueName}`,
    p.lands ? `Money taken out lands in ${p.lands}.` : '',
    p.minAmount ? `At least ${qty(p.minAmount)} ${p.asset}.` : '',
  ].filter(Boolean);
}

/** earn.js:145-146 — the lines under an earn's quote, from the preparation shown (`quote.earn`): about what it is worth, its yield,
 *  lock, protocol and chain, where it lands taken out, what is in it now, the Account's note. Nothing prepared: []. */
export function earnSaysOf(sheet) {
  if (!isRecord(sheet) || sheet.kind !== 'earn') return [];
  const x = sheet.prepared?.quote?.earn;
  if (!isRecord(x)) return [];
  const usd = typeof x.usd === 'number' ? `≈ ${dollars(x.usd)}` : '';
  const lock = x.lockDays ? `locked ${x.lockDays} days after you ask for it back` : x.lockDays === 0 ? 'out at once' : '';
  const held = isRecord(x.held) ? `In it now: ${qty(x.held.amount)} ${str(x.held.asset)}${typeof x.held.usd === 'number' ? ` (${dollars(x.held.usd)})` : ''}` : '';
  return [usd, [earnRate(x), lock, str(x.protocol), str(x.chain)].filter(Boolean).join(' · '), str(x.lands) ? `Taken out, it lands in ${x.lands}` : '', held, str(x.note)].filter(Boolean);
}

/** earn.js:186 — what a taken earn said: `Taking out all USDT · USDT · Flexible: done`; another answer: ''. */
export function earnSaidOf(body) {
  const e = body?.result?.earn;
  if (!isRecord(e)) return '';
  const status = str(e.status);
  return `${e.kind === 'withdraw' ? 'Taking out' : 'Putting in'} ${e.all ? 'all' : qty(Number(e.amount))} ${str(e.asset)} · ${str(e.productName)}: ${status === 'done' ? 'done' : status}${str(e.note) ? ` · ${e.note}` : ''}`;
}
