// face/client/js/host/sheet-money.js — the Money tab's signed sheet (plan 4b Task 2): Move, the Account's own `liveMove` draft with
// the fields its own page signs it with (account/src/portfolio/public/ui/money.js openLiveMove, :59-183), nothing added and
// nothing renamed. Its fields follow the account it moves from and the kind of move: `refieldsOf` rebuilds them as either
// changes, keeping every value whose field survives. The seed is the page's at the press (`moveSeedOf`): every source with what
// it offers, so the sheet never reads the page again. host/sheet-view.js delegates the kind here; the sheet engine
// (host/sheet.js) prepares the draft and What you sign shows it. No clock. No DOM, no store.
import { moveSourcesOf, moveKindsOf, moveDestinationsOf, moveAssetsOf, networksOf, bridgeChainsOf, pageVenueOf } from './money-view.js';
import { pageOk } from './account-view.js';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = v => (typeof v === 'string' ? v : '');
const figure = v => (typeof v === 'number' && Number.isFinite(v) ? String(v) : str(v));
const opts = list => list.map(x => ({ value: x, label: x }));

/** The Money tab's sheet kinds. */
export const MONEY_KINDS = ['move'];

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
    rest = [
      select('to', 'To', to, values.to),
      select('network', 'From chain', chains, values.network, src.chains?.[0]),
      select('toLedger', 'To chain', chains, values.toLedger, src.chains?.[1] ?? src.chains?.[0]),
      asset,
      select('toAsset', 'Arrives as', toAssets, values.toAsset, firstAsset),
      amountField('25', values.amount),
    ];
  } else if (k) {
    // a withdrawal or a send: where it goes (none to offer: no field, and the draft says to connect one first), the network,
    // the currency
    const dests = destOptions(src);
    const to = dests.some(o => o.disabled !== true) ? [select('to', 'To', dests, values.to)] : [];
    const funded = to.length ? fundedAt(src, to[0].value) : '';
    rest = [...to, select('network', 'Network', nets, values.network, funded), select('asset', 'Currency', assets, values.asset), amountField('25', values.amount)];
  } else rest = [];
  return [fromField, kindField, ...rest];
}

/** The sheet's fields from the seed: its source (the preset's, else the first), its kind (the preset's where offered, else the
 *  first), `to` the preset's where it is offered, the amount the preset's. */
export function moneyFieldsOf(kind, seed) {
  if (kind !== 'move') return [];
  const s = isRecord(seed) ? seed : {};
  const amount = Number(s.amount) > 0 ? str(s.amount) : '';
  return build(s, { from: str(s.from), kind: str(s.kind), to: str(s.to), amount });
}

/** The fields again after a change: rebuilt for the source and the kind now picked, every value kept whose field survives and
 *  still takes it — so a kind or a source left behind takes its fields with it, and they never reach the draft. */
export function moneyRefieldsOf(kind, fields, seed) {
  if (kind !== 'move' || !Array.isArray(fields)) return fields;
  const values = Object.fromEntries(fields.filter(f => isRecord(f) && typeof f.name === 'string').map(f => [f.name, typeof f.value === 'string' ? f.value : '']));
  return build(isRecord(seed) ? seed : {}, values);
}

/** The sheet's title: the source picked. */
export function moneyTitleOf(kind, seed, fields) {
  if (kind !== 'move') return '';
  const id = (fields !== undefined ? valueOf(fields, 'from') : '') || str(seed?.from);
  const src = sourceOf(seed, id) ?? sourcesOf(seed)[0];
  return src ? `Move money · ${src.name}` : 'Move money';
}

/** The sheet's go key. */
export const moneyGoOf = kind => (kind === 'move' ? 'Sign and move' : '');

/** money.js:86-100 — the Account's `liveMove` from the fields, or, while it is not filled in, the page's words for it. Only the
 *  fields the sheet has now are read: a field the kind does not have is ''. */
export function moneyDraftOf(kind, fields, seed) {
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
