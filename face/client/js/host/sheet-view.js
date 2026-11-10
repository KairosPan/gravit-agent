// face/client/js/host/sheet-view.js — every owner sheet's pure shape (spec 2026-10-22 §6.3–§6.4, plan 2 Task 4): its fields, its
// title and go word, and its draft from the fields — the Account's own field set for its type, nothing added and nothing renamed
// (docs/research/2026-10-22-account-owner-path-map.md §1.4–§1.5, §3.8–§3.10, §3.12, §3.14, §3.15, §3.17, §4.3) — or, while the
// form is not complete, the words for what is missing; and the connect sheet's check (what to ask, its words). The sheet engine
// (host/sheet.js) prepares the draft, the renderer draws the fields; the Account judges everything else in its own words. `now` is the caller's clock in milliseconds; `validUntil`
// values are numbers (the Account's u64 fields), the dollar amounts strings as typed. No DOM, no store.
import { pageOk, venuesOf, keyfileWords, paperBooksOf, writesOn, walletsOf, connectOptionsOf } from './account-view.js';
import { tradeFieldsOf, tradeDraftOf } from './trade-view.js';
import { MARKET_KINDS, marketTitleOf, marketGoOf, marketFieldsOf, marketDraftOf } from './sheet-market.js';
import { RULES_KINDS, rulesTitleOf, rulesGoOf, rulesFieldsOf, rulesDraftOf } from './sheet-rules.js';
import { MONEY_KINDS, moneyTitleOf, moneyGoOf, moneyFieldsOf, moneyRefieldsOf, moneyDraftOf, moveSeedOf, subWalletSeedOf } from './sheet-money.js';
import { canMove, servedHere, moveSourcesOf } from './money-view.js';
import { t, tn, said, sayOf } from '../i18n/words.js';

const DAY = 86_400_000;
const ZERO = '0x0000000000000000000000000000000000000000';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// a plain decimal, as the Account takes its amounts
const AMOUNT = /^\d+(\.\d+)?$/;
const DAY_VALUES = ['1', '7', '30', '90'];
// how long a key or a limit is good for, its words read at the call
const dayOptions = () => DAY_VALUES.map(d => ({ value: d, label: tn('sheet.days', Number(d)) }));

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = v => (typeof v === 'string' ? v : '');

/** Every sheet kind. `order` is the Trade ticket's: its fields and draft are the trade view's, from `seed.ticket`. `close`,
 *  `amend` and `leverage` are the Market half's: everything about them is host/sheet-market.js's. `beast`, `cap`, `session` and
 *  `leverageCap` are the Rules tab's: host/sheet-rules.js's. `move` and `earn` are the Money tab's: host/sheet-money.js's (plan 4b Tasks 2-3). Account › Identity's acts are no sheet
 *  since sign-only-money: unsigned, host/identity.js's. */
export const SHEET_KINDS = ['letIn', 'limit', 'endLimit', 'revoke', 'connect', 'paper', 'topUp', 'resetPaper', 'disconnect',
  'approveCard', 'declineAsk', 'letDevice', 'signOut', 'order', 'reopen', ...MARKET_KINDS, ...RULES_KINDS, ...MONEY_KINDS];
/** The kinds that take no signature (sign-only-money §4.4, §5.3): their draft goes to the account's unsigned door as it stands —
 *  nothing prepared, no What you sign (host/sheet.js). Opening a paper account alone; top-up, reset and disconnect stay signed. */
export const UNSIGNED_KINDS = ['paper'];
const isMarket = kind => MARKET_KINDS.includes(kind);
const isRules = kind => RULES_KINDS.includes(kind);
const isMoney = kind => MONEY_KINDS.includes(kind);

// the go key of a kind of this module's own
function goOf(kind) {
  switch (kind) {
    case 'letIn': return t('sheet.go.letIn');
    case 'limit': return t('sheet.go.limit');
    case 'endLimit': return t('sheet.go.endLimit');
    case 'revoke': return t('sheet.go.revoke');
    case 'connect': return t('sheet.go.connect');
    case 'paper': return t('sheet.go.paper');
    case 'topUp': return t('sheet.go.topUp');
    case 'resetPaper': return t('sheet.go.resetPaper');
    case 'disconnect': return t('sheet.go.disconnect');
    case 'approveCard': return t('sheet.go.approve');
    case 'declineAsk': return t('sheet.go.decline');
    case 'letDevice': return t('sheet.go.letDevice');
    case 'signOut': return t('sheet.go.signOut');
    case 'order': return t('sheet.go.order');
    case 'reopen': return t('sheet.go.reopen');
    default: return '';
  }
}

/** The sheet's go key: a card's is `Reject` when the seed's decision is to reject; an earn's by the side its fields picked. */
export function goWord(kind, seed, fields) {
  if (kind === 'approveCard' && seed?.decision === 'reject') return t('sheet.go.reject');
  if (isMarket(kind)) return marketGoOf(kind, seed);
  if (isRules(kind)) return rulesGoOf(kind, seed);
  if (isMoney(kind)) return moneyGoOf(kind, seed, fields);
  return goOf(kind);
}

/** The sheet's title, naming what the seed names — a move's, the source its fields have picked. */
export function titleOf(kind, seed, fields) {
  if (isMarket(kind)) return marketTitleOf(kind, seed);
  if (isRules(kind)) return rulesTitleOf(kind, seed);
  if (isMoney(kind)) return moneyTitleOf(kind, seed, fields);
  const s = isRecord(seed) ? seed : {};
  const place = str(s.name) || str(s.venue);
  switch (kind) {
    case 'letIn': return str(s.name) ? t('sheet.title.letIn', { name: s.name }) : t('sheet.title.letInAny');
    case 'limit': return str(s.name) ? t('sheet.title.limit', { name: s.name }) : t('sheet.title.limitAny');
    case 'endLimit': {
      const limit = scopeOf(s.scope).limit;
      return str(s.name) ? t('sheet.title.endLimit', { name: s.name, limit }) : t('sheet.title.endLimitAny', { limit });
    }
    case 'revoke': return str(s.name) ? t('sheet.title.revoke', { name: s.name }) : t('sheet.title.revokeAny');
    case 'connect': return t('sheet.title.connect');
    case 'paper': return t('sheet.title.paper');
    case 'topUp': return place ? t('sheet.title.topUp', { place }) : t('sheet.title.topUpAny');
    case 'resetPaper': return place ? t('sheet.title.resetPaper', { place }) : t('sheet.title.resetPaperAny');
    case 'disconnect': return place ? t('sheet.title.disconnect', { place }) : t('sheet.title.disconnectAny');
    case 'approveCard': return s.decision === 'reject' ? t('sheet.title.reject') : t('sheet.title.approve');
    case 'declineAsk': return t('sheet.title.declineAsk');
    case 'letDevice': return str(s.kid) ? t('sheet.title.letDevice', { kid: s.kid }) : t('sheet.title.letDeviceAny');
    case 'signOut': return t('sheet.title.signOut');
    case 'order': return t('sheet.title.order');
    case 'reopen': return place ? t('sheet.title.reopen', { place }) : t('sheet.title.reopenAny');
    default: return '';
  }
}

// ── the fields ──

// the venues a limit may name: the seed's, each once, paper first, never `*`
function venueOptions(seed) {
  const seen = new Set();
  const rows = records(seed?.venues).filter(v => {
    const id = str(v.id);
    if (!id || id === '*' || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map(v => ({ value: v.id, label: str(v.name) || v.id, paper: v.paper === true }));
  return [...rows.filter(o => o.paper), ...rows.filter(o => !o.paper)];
}

// the connectors this sheet connects: every option the seed gives but the paper account, which is its own sheet
const connectOptions = seed => records(seed?.options).filter(o => str(o.connector) && o.connector !== 'live:paper' && o.kind !== 'paper');
const paperBooks = seed => records(seed?.books).filter(b => str(b.venue));
const listOf = v => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : []).filter(x => typeof x === 'string' && x);
// an exchange account signs `live:exchange:<exchange id>` (the Account's connect.js): its bare option needs the exchange picked
const needsExchange = o => o.kind === 'exchange' && !o.connector.startsWith('live:exchange:');
const exchangesOf = seed => [...new Set(connectOptions(seed).filter(needsExchange).flatMap(o => listOf(o.venues)))];
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a !== '' && a.toLowerCase() === b.toLowerCase();
// a dollar figure of the Account's as the string a field holds
const dollarsText = v => (typeof v === 'number' && Number.isFinite(v) ? String(v) : str(v));

// ── the kinds of limit (portfolio.js:1186-1200 pfLimitForm, agents-mount.js:193-196) ──

// the kinds of limit, in their order
const SCOPES = ['trade', 'venues', 'earn', 'payees'];
// each kind's words, read at the call: what it may do, its amount's field (an order, a move, each time, a payment), the limit's
// name, and an amount over the budget
const SCOPE_WORDS = {
  trade: () => ({ label: t('sheet.scope.trade'), perField: t('sheet.scopePer.trade'), limit: t('sheet.scopeLimit.trade'), over: t('sheet.scopeOver.trade') }),
  venues: () => ({ label: t('sheet.scope.venues'), perField: t('sheet.scopePer.venues'), limit: t('sheet.scopeLimit.venues'), over: t('sheet.scopeOver.venues') }),
  earn: () => ({ label: t('sheet.scope.earn'), perField: t('sheet.scopePer.earn'), limit: t('sheet.scopeLimit.earn'), over: t('sheet.scopeOver.earn') }),
  payees: () => ({ label: t('sheet.scope.payees'), perField: t('sheet.scopePer.payees'), limit: t('sheet.scopeLimit.payees'), over: t('sheet.scopeOver.payees') }),
};
/** The kinds of limit an agent is given, in the retired page's words: what it may do, the field for one of its amounts (an
 *  order, a move, each time, a payment), the limit's name, and the words for an amount over the budget. */
export const limitScopes = () => SCOPES.map(value => ({ value, ...SCOPE_WORDS[value]() }));
const scopeOf = v => { const value = SCOPES.includes(v) ? v : 'trade'; return { value, ...SCOPE_WORDS[value]() }; };
// core.js:254 — the venues the Account is connected to, as its page lists them
const connectedOf = page => records(page.venues).filter(v => v.live === true && str(v.id) && v.id !== '*');
// core.js:1277, :1299 — an order can be placed there: the Account takes writes, the venue trades, its key may (or has not said),
// it is not a watched address, it is served here
const canTrade = (v, page) => writesOn(page) && isRecord(v.trade) && v.trade.can !== false && !(v.address && !v.proven) && servedHere(v);
// portfolio.js:1196 — the venues each kind of limit may name: where it trades; where money moves, and the agent wallets (money
// moves into them); where earn takes money and is served here. A payees limit names hosts, no venue
function scopeVenues(page, scope) {
  const L = connectedOf(page);
  if (scope === 'trade') return L.filter(v => canTrade(v, page));
  if (scope === 'venues') return [...L.filter(v => canMove(v, page)), ...L.filter(v => v.id.startsWith('agent-') && !canMove(v, page))];
  if (scope === 'earn') return L.filter(v => isRecord(v.earn) && v.earn.can !== false && servedHere(v));
  return [];
}
const venueRow = v => ({ id: v.id, name: str(v.name), paper: v.paper === true });
const paperFirst = list => [...list.filter(v => v.paper), ...list.filter(v => !v.paper)];

/** A limit sheet's seed for an agent, from the page: the kinds of limit the page can serve (`scopes`, each `{ value, label,
 *  venues }` — the venues `{ id, name, paper }`, paper first, by portfolio.js:1196's rule for that kind; a payees limit, which
 *  names hosts, always), the agent's standing limit of each (`standing[scope]: { allow, perPayment, budget }`, the page's
 *  `spend` row of that scope at its address, in any case, not expired), and the kind asked (`scope`: the one given where the
 *  page serves it, else the first it does) with its venues and its standing limit (`venues`, `current`, or null). Give a limit
 *  and a granted ask open on the same shape, so a new limit starts from the standing one — one standing approval per agent and
 *  scope, a new one replacing it. */
export function limitSeedOf(page, address, name, scope = 'trade') {
  const seed = { address: str(address), name: str(name), scope: str(scope) || 'trade', scopes: [], standing: {}, venues: [], current: null };
  if (!pageOk(page)) return seed;
  seed.scopes = limitScopes().map(x => ({ value: x.value, label: x.label, venues: paperFirst(scopeVenues(page, x.value).map(venueRow)) }))
    .filter(x => x.value === 'payees' || x.venues.length);
  for (const x of seed.scopes) {
    const row = records(page.spend).find(r => r.scope === x.value && r.expired !== true && sameAddress(r.agent, address));
    if (row) seed.standing[x.value] = { allow: listOf(row.allow), perPayment: dollarsText(row.perPaymentUsd), budget: dollarsText(row.budgetUsd) };
  }
  if (!seed.scopes.some(x => x.value === seed.scope)) seed.scope = seed.scopes[0]?.value ?? seed.scope;
  seed.venues = seed.scopes.find(x => x.value === seed.scope)?.venues ?? [];
  seed.current = seed.standing[seed.scope] ?? null;
  return seed;
}

// the kinds of limit a seed offers: its own, or — a seed with none (a trade limit's, as the sheet was first seeded) — trading
// over its venues
function scopesOfSeed(s) {
  const list = records(s.scopes).filter(x => SCOPES.includes(x.value));
  return list.length ? list : [{ value: 'trade', label: scopeOf('trade').label, venues: records(s.venues) }];
}
// the standing limit of a kind: the seed's, or its `current` for the kind it was seeded on
const standingOf = (s, scope) => (isRecord(s.standing?.[scope]) ? s.standing[scope]
  : (str(s.scope) || 'trade') === scope && isRecord(s.current) ? s.current : null);

// a limit's fields for a kind: the kind, where (the venues to tick, or for a payees limit the hosts and Any payee, as
// agents-mount.js:193-196), then the amounts and how long. `values` keeps what the form holds across a change of kind; without
// them, the standing limit of the kind with the asked venue ticked, the asked budget over its own, the amount per order never
// above the budget. The where-field records the kind it was built for, so a change of kind is told from any other change
function limitFields(s, scope, values = null) {
  const scopes = scopesOfSeed(s);
  const kind = scopeOf(scope);
  const current = standingOf(s, scope);
  const head = { name: 'scope', label: t('sheet.field.for'), type: 'seg', options: scopes.map(x => ({ value: x.value, label: str(x.label) || scopeOf(x.value).label })), value: scope };
  let where;
  if (scope === 'payees') {
    const allow = listOf(current?.allow);
    where = [
      { name: 'payees', label: t('sheet.field.mayPay'), type: 'text', placeholder: 'api.example.com, data.example.com', value: allow.includes('*') ? '' : allow.join(', '), scope },
      { name: 'anyPayee', label: t('sheet.field.anyPayee'), type: 'check', value: allow.includes('*') },
    ];
  } else {
    const options = venueOptions({ venues: scopes.find(x => x.value === scope)?.venues });
    const known = new Set(options.map(o => o.value));
    const asked = values ? [] : listOf(s.asked);
    where = [{ name: 'allow', label: t('sheet.field.venues'), type: 'pick', options, value: [...new Set([...listOf(current?.allow), ...asked].filter(id => known.has(id)))], scope }];
  }
  let perPayment, budget, days = '30';
  if (values) ({ perPayment, budget, days } = values);
  else {
    budget = str(s.budget) || str(current?.budget);
    const standing = str(current?.perPayment);
    perPayment = standing && AMOUNT.test(budget) && Number(standing) > Number(budget) ? budget : standing;
  }
  return [
    head, ...where,
    { name: 'perPayment', label: kind.perField, type: 'number', placeholder: '100', value: perPayment },
    { name: 'budget', label: t('sheet.field.budget'), type: 'number', placeholder: '1000', value: budget },
    { name: 'days', label: t('sheet.field.goodFor'), type: 'seg', options: dayOptions(), value: DAY_VALUES.includes(days) ? days : '30' },
  ];
}
// a limit's fields after one changed: the kind changed — the pick swapped for that kind's (its standing limit's), the amounts
// and how long kept; any other change, the fields as they are
function limitRefieldsOf(fields, seed) {
  if (!Array.isArray(fields)) return fields;
  const s = isRecord(seed) ? seed : {};
  const scope = text(fields, 'scope');
  const built = fields.find(f => isRecord(f) && (f.name === 'allow' || f.name === 'payees'))?.scope;
  if (!scopesOfSeed(s).some(x => x.value === scope) || built === scope) return fields;
  return limitFields(s, scope, { perPayment: amount(fields, 'perPayment'), budget: amount(fields, 'budget'), days: text(fields, 'days') });
}

/** Let it sign's seed: the owners the new list keeps — the page's (`signers.owners`), and this page's own `device:<kid>`, which
 *  signs from its pairing whether or not the page read names it yet (the list REPLACES the owners) — once each, and the waiting
 *  key's `kid`. */
export function letDeviceSeedOf(page, owner, kid) {
  const owners = pageOk(page) ? records(page.signers.owners).map(o => str(o.id)).filter(Boolean) : [];
  const mine = str(owner?.kid);
  return { owners: [...new Set([...owners, ...(mine ? [`device:${mine}`] : [])])], kid: str(kid) };
}

/** The paper sheet's seed: the kept paper books from their read (`/data/account/paper/books`, paperBooksOf) and the page's
 *  venue ids, so a new paper account's id is never one in use. */
export function paperSeedOf(page, books) {
  return { books: paperBooksOf(books), venues: venuesOf(page).map(v => ({ id: v.id })) };
}

/** The sheet's fields, each `{ name, label, type, options?, placeholder?, value }` — `options` as `{ value, label }`, a `pick`'s
 *  value a list, the rest strings — filled from the seed where it says. */
export function fieldsOf(kind, seed) {
  if (isMarket(kind)) return marketFieldsOf(kind, seed);
  if (isRules(kind)) return rulesFieldsOf(kind, seed);
  if (isMoney(kind)) return moneyFieldsOf(kind, seed);
  const s = isRecord(seed) ? seed : {};
  switch (kind) {
    case 'letIn': return [
      { name: 'address', label: t('sheet.field.keyAddress'), type: 'text', placeholder: '0x…', value: str(s.address) },
      { name: 'name', label: t('sheet.field.name'), type: 'text', placeholder: 'Claude Code', value: str(s.name) }, // en-kept: an agent's name, the placeholder
      { name: 'days', label: t('sheet.field.goodFor'), type: 'seg', options: dayOptions(), value: '30' },
    ];
    case 'limit': {
      const scopes = scopesOfSeed(s);
      return limitFields(s, scopes.some(x => x.value === s.scope) ? s.scope : scopes[0].value);
    }
    case 'connect': {
      const options = connectOptions(s);
      const picked = options.find(o => o.connector === s.connector);
      // `builtFor`: the option these fields were built for, so a change of connector is seen (connectRefieldsOf)
      const pick = { name: 'connector', label: t('sheet.field.whatToConnect'), type: 'select', options: options.map(o => ({ value: o.connector, label: str(o.label) || o.connector })), value: picked ? picked.connector : '', builtFor: picked ? picked.connector : '' };
      // by what the option needs (the Account's connect.js openConnect): an address and the name it is shown as; a sign-in at
      // the venue, whose state lands in the hidden credentialRef once it is ready; a command line on this machine, nothing
      switch (picked?.needs) {
        case 'address': return [
          pick,
          { name: 'ref', label: t('sheet.field.address'), type: 'text', placeholder: '0x…', value: str(s.ref) },
          { name: 'label', label: t('sheet.field.shownAs'), type: 'text', value: str(s.label) },
        ];
        case 'sign-in': return [pick, { name: 'credentialRef', label: '', type: 'hidden', value: '' }];
        case 'cli': return [pick];
        default: break;
      }
      const exchanges = exchangesOf(s);
      return [
        pick,
        ...(exchanges.length ? [{ name: 'exchange', label: t('sheet.field.exchange'), type: 'select', options: exchanges.map(x => ({ value: x, label: x })), value: exchanges.includes(s.exchange) ? s.exchange : '' }] : []),
        { name: 'venue', label: t('sheet.field.venueId'), type: 'text', placeholder: 'okx', value: str(s.venue) },
        { name: 'label', label: t('sheet.field.name'), type: 'text', placeholder: t('sheet.field.exchangeName'), value: str(s.label) },
        { name: 'credentialRef', label: t('sheet.field.keyFile'), type: 'text', placeholder: str(picked?.defaultRef) || 'credentials/<venue>/api-key.json', value: str(s.credentialRef) },
      ];
    }
    case 'paper': return [
      { name: 'book', label: t('sheet.field.paperBook'), type: 'select', options: [{ value: '', label: t('sheet.field.newPaper') }, ...paperBooks(s).map(b => ({ value: b.venue, label: str(b.name) || b.venue }))], value: '' },
      { name: 'label', label: t('sheet.field.name'), type: 'text', placeholder: t('sheet.field.paperName'), value: '' },
      { name: 'usd', label: t('sheet.field.paperUsd'), type: 'number', placeholder: '10000', value: '' },
    ];
    // Beast in force: switching to Guard first is offered, ticked for the last device (agents-mount.js signOutAsk)
    case 'signOut': return s.mode === 'open'
      ? [{ name: 'guard', label: t('sheet.field.guardFirst'), type: 'check', value: othersOf(s) === 0 }]
      : [];
    case 'topUp': return [{ name: 'usd', label: t('sheet.field.addUsd'), type: 'number', placeholder: '1000', value: str(s.usd) }];
    case 'resetPaper': return [{ name: 'usd', label: t('sheet.field.againUsd'), type: 'number', placeholder: '10000', value: str(s.usd) }];
    // the Trade ticket's, from the ticket view the trade host seeds it with (`seed.ticket`, host/trade-view.js ticketOf)
    case 'order': return tradeFieldsOf(s.ticket);
    default: return [];
  }
}

/** The fields after one changed (reducers/owner.js sheetField): a kind whose fields follow a field — a move's follow the account
 *  it moves from and the kind of move — rebuilt, every value kept whose field survives; every other kind's as they are. */
export function refieldsOf(kind, fields, seed) {
  if (isMoney(kind)) return moneyRefieldsOf(kind, fields, seed);
  if (kind === 'connect') return connectRefieldsOf(fields, seed);
  if (kind === 'limit') return limitRefieldsOf(fields, seed);
  return fields;
}

// a connect sheet's fields after the connector changed — to any other option, of whatever shape: that option's fields, the
// connector and the name kept (a key file's path, a typed or wallet-proven address and a sign-in's state never carried to another
// option, even one of the same shape); the connector as it was built for: the fields as they are
function connectRefieldsOf(fields, seed) {
  const connector = text(fields, 'connector');
  const pick = (Array.isArray(fields) ? fields : []).find(f => f?.name === 'connector');
  if (pick && str(pick.builtFor) === connector) return fields;
  return fieldsOf('connect', { ...(isRecord(seed) ? seed : {}), connector, label: text(fields, 'label') });
}

// ── the drafts ──

// a field's value from the form: the sheet's fields, or a plain { name: value }
function valueOf(fields, name) {
  if (Array.isArray(fields)) return fields.find(f => isRecord(f) && f.name === name)?.value;
  return isRecord(fields) ? fields[name] : undefined;
}
const text = (fields, name) => { const v = valueOf(fields, name); return typeof v === 'string' ? v.trim() : ''; };
const amount = (fields, name) => { const v = valueOf(fields, name); return typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''; };
// what is wrong with an amount, or null: blank is the sheet's own words; otherwise a plain decimal above zero
const amountMissing = (v, blank) => (v === '' ? blank : AMOUNT.test(v) && Number(v) > 0 ? null : t('sheet.missing.dollars'));
const daysOf = fields => { const d = text(fields, 'days'); return DAY_VALUES.includes(d) ? Number(d) : null; };
const slug = v => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** The Account's draft for the sheet, from its fields and its seed — or, while something is missing, the words for it. */
export function draftOf(kind, fields, seed, now) {
  if (isMarket(kind)) return marketDraftOf(kind, fields, seed);
  if (isRules(kind)) return rulesDraftOf(kind, fields, seed);
  if (isMoney(kind)) return moneyDraftOf(kind, fields, seed);
  const s = isRecord(seed) ? seed : {};
  switch (kind) {
    case 'letIn': {
      const address = text(fields, 'address'), name = text(fields, 'name'), days = daysOf(fields);
      if (!address) return t('sheet.missing.keyAddress');
      if (!ADDRESS.test(address)) return t('sheet.missing.address');
      if (!name) return t('sheet.missing.name');
      if (days === null) return t('sheet.missing.howLong');
      return { type: 'approveAgent', agentAddress: address.toLowerCase(), agentName: name, validUntil: now + days * DAY };
    }
    case 'limit': {
      const agent = str(s.address);
      if (!agent) return t('sheet.missing.noAgent');
      const scope = text(fields, 'scope');
      const offered = scopesOfSeed(s).find(x => x.value === scope);
      if (!offered) return t('sheet.missing.scope');
      let allow;
      if (scope === 'payees') {
        // agents-mount.js:193 — the hosts it may pay, lower-cased, or any payee
        const any = valueOf(fields, 'anyPayee');
        allow = any === true || any === 'true' ? '*' : text(fields, 'payees').split(',').map(x => x.trim().toLowerCase()).filter(Boolean).join(',');
        if (!allow) return t('sheet.missing.payees');
      } else {
        // only the venues this kind may name, in their order, never *
        const picked = new Set(listOf(valueOf(fields, 'allow')));
        allow = venueOptions({ venues: offered.venues }).map(o => o.value).filter(id => picked.has(id)).join(',');
        if (!allow) return t('sheet.missing.venues');
      }
      const perPayment = amount(fields, 'perPayment'), budget = amount(fields, 'budget');
      const missing = amountMissing(perPayment, t('sheet.missing.amount')) ?? amountMissing(budget, t('sheet.missing.budget'));
      if (missing) return missing;
      if (Number(perPayment) > Number(budget)) return scopeOf(scope).over;
      const days = daysOf(fields);
      if (days === null) return t('sheet.missing.howLong');
      return { type: 'approveSpend', agent, scope, allow, perPayment, budget, windowHours: 0, validUntil: now + days * DAY };
    }
    // agents-mount.js:123 — the end of one limit: the same agent, kind and places, a budget of nothing
    case 'endLimit': {
      const agent = str(s.address), allow = listOf(s.allow).join(',');
      if (!agent || !allow) return t('sheet.missing.noLimit');
      // a kind it does not know is refused, never ended as another; none named is a trading limit
      const scope = s.scope === undefined || s.scope === '' ? 'trade' : s.scope;
      if (!SCOPES.includes(scope)) return t('sheet.missing.noLimitKind');
      return { type: 'approveSpend', agent, scope, allow, perPayment: '0', budget: '0', windowHours: 0, validUntil: now + DAY };
    }
    case 'revoke':
      if (!str(s.name)) return t('sheet.missing.noKey');
      return { type: 'approveAgent', agentAddress: ZERO, agentName: s.name, validUntil: 0 };
    case 'connect': {
      const option = connectOptions(s).find(o => o.connector === text(fields, 'connector'));
      if (!option) return t('sheet.missing.connector');
      const kind = str(option.kind);
      if (option.needs === 'address') {
        const ref = text(fields, 'ref');
        if (!ADDRESS.test(ref)) return t('sheet.missing.address');
        // the venue id the retired page gives it (connect.js venueId): the kind, or a second one numbered by its address
        const venue = records(s.venues).some(v => v.id === kind) ? `${kind}-${ref.slice(2, 8).toLowerCase()}` : kind;
        return { type: 'connectVenue', venue, connector: option.connector, label: text(fields, 'label'), credentialRef: ref };
      }
      if (option.needs === 'sign-in') {
        const state = text(fields, 'credentialRef');
        if (!state) return t('sheet.missing.signIn', { who: whoOf(option) });
        return { type: 'connectVenue', venue: kind, connector: option.connector, label: '', credentialRef: state };
      }
      if (option.needs === 'cli') return { type: 'connectVenue', venue: kind, connector: option.connector, label: '', credentialRef: '' };
      let connector = option.connector, exchange = '';
      if (needsExchange(option)) {
        exchange = text(fields, 'exchange');
        if (!listOf(option.venues).includes(exchange)) return t('sheet.missing.exchange');
        connector = `live:exchange:${exchange}`;
      }
      // an exchange account's venue id is the exchange's unless another is typed
      const venue = text(fields, 'venue') || exchange, label = text(fields, 'label');
      if (!venue) return t('sheet.missing.venueId');
      if (!label) return t('sheet.missing.name');
      const credentialRef = text(fields, 'credentialRef') || str(option.defaultRef).replaceAll('<venue>', venue);
      if (!credentialRef) return t('sheet.missing.keyFile');
      return { type: 'connectVenue', venue, connector, label, credentialRef };
    }
    case 'paper': {
      const book = text(fields, 'book'), label = text(fields, 'label');
      if (book) {
        const kept = paperBooks(s).find(b => b.venue === book);
        if (!kept) return t('sheet.missing.paperBook');
        // '' continues the kept book as it was
        return { type: 'connectVenue', venue: kept.venue, connector: 'live:paper', label: label || str(kept.name) || kept.venue, credentialRef: '' };
      }
      if (!label) return t('sheet.missing.name');
      const id = slug(label);
      if (!id) return t('sheet.missing.nameChar');
      const usd = amount(fields, 'usd');
      const missing = amountMissing(usd, t('sheet.missing.amount'));
      if (missing) return missing;
      // never an id already in use — on the page, or a kept book (a sum there would be refused): -2, -3… as the Account does
      const used = new Set([...paperBooks(s).map(b => b.venue), ...records(s.venues).map(v => str(v.id))]);
      let venue = `paper-${id}`;
      for (let n = 2; used.has(venue); n++) venue = `paper-${id}-${n}`;
      return { type: 'connectVenue', venue, connector: 'live:paper', label, credentialRef: usd };
    }
    case 'topUp':
    case 'resetPaper': {
      if (!str(s.venue)) return t('sheet.missing.noPaper');
      const usd = amount(fields, 'usd');
      const missing = amountMissing(usd, t('sheet.missing.amount'));
      if (missing) return missing;
      return { type: kind === 'topUp' ? 'topUpPaper' : 'resetPaper', venue: s.venue, usd };
    }
    case 'disconnect':
      if (!str(s.venue)) return t('sheet.missing.noVenue');
      return { type: 'disconnectVenue', venue: s.venue };
    case 'approveCard':
      if (!str(s.card) || !str(s.hash)) return t('sheet.missing.noCard');
      if (s.decision !== 'approve' && s.decision !== 'reject') return t('sheet.missing.decision');
      return { type: 'approveCard', card: s.card, action: s.hash, decision: s.decision };
    case 'declineAsk':
      if (!str(s.ask)) return t('sheet.missing.noAsk');
      return { type: 'answerAsk', ask: s.ask, decision: 'decline' };
    case 'letDevice': {
      if (!str(s.kid)) return t('sheet.missing.noBrowser');
      const owners = (Array.isArray(s.owners) ? s.owners : []).map(o => (isRecord(o) ? str(o.id) : str(o))).filter(Boolean);
      // the list REPLACES the owners: without them it would drop every device that signs, this page's own among them
      if (owners.length === 0) return t('sheet.missing.noOwner');
      // the Account's rule: a sorted list without repeats; every device signs alone
      const authorizedUsers = [...new Set([...owners, `device:${s.kid}`])].sort();
      return { type: 'convertToMultiSigUser', signers: JSON.stringify({ authorizedUsers, threshold: 1 }) };
    }
    case 'signOut':
      if (!str(s.kid)) return t('sheet.missing.notSigning');
      return { type: 'signOut', device: `device:${s.kid}` };
    // the liveOrder draft from the Trade ticket (host/trade-view.js): no clock — its deadline is the Account's prepare's
    case 'order': return tradeDraftOf(fields, s.ticket);
    // a venue closed to agents opened to them again: widening what they may do is signed (portfolio.js pfAgentsSwitch)
    case 'reopen':
      if (!str(s.venue)) return t('sheet.missing.noReopen');
      return { type: 'setPolicy', change: 'restore', value: s.venue };
    default: return t('sheet.nothingToSign');
  }
}

// ── Settings › Devices' sign-out (plan 4b Task 6, agents-mount.js signOutAsk) ──

// the owners on the page other than this page's device, as the seed counts them
const othersOf = s => (Number.isInteger(s?.others) && s.others >= 0 ? s.others : 0);

/** The sign-out sheet's seed: this page's key id, the mode in force (`open` is Beast) and how many owners other than this
 *  page's device sign for the account (the page's `signers.owners`, any kind). */
export function signOutSeedOf(page, owner) {
  const kid = str(owner?.kid);
  if (!pageOk(page)) return { kid, mode: '', others: 0 };
  const mine = kid ? `device:${kid}` : null;
  const mode = page.mode === 'open' || page.mode === 'guard' ? page.mode : '';
  return { kid, mode, others: records(page.signers?.owners).filter(o => str(o.id) !== mine).length };
}

/** The line under the sign-out's fields: who keeps signing — the other devices, or none until one pairs again (agents-mount.js
 *  signOutAsk's words). Another sheet: ''. */
export function signOutLineOf(sheet) {
  if (!isRecord(sheet) || sheet.kind !== 'signOut') return '';
  const n = othersOf(sheet.seed);
  if (n > 0) return tn('sheet.signOut.others', n);
  return t('sheet.signOut.last');
}

/** The sheet asks Guard before it signs (the engine's `beforeSign`): a sign-out in Beast with its Guard box ticked. */
export function guardFirstOf(sheet) {
  if (!isRecord(sheet) || sheet.kind !== 'signOut' || sheet.seed?.mode !== 'open') return false;
  const f = (Array.isArray(sheet.fields) ? sheet.fields : []).find(x => isRecord(x) && x.name === 'guard');
  return f?.value === true || f?.value === 'true';
}
// a kept line put into another: a string trimmed, a said as it is (read when drawn); and the stop it needs after it, a said
// too — none when the words already end a sentence, as they read now
const ENDED = /[.!?。！？]$/;
const innerOf = words => (typeof words === 'string' ? words.trim() : words);
const stopAfter = words => (ENDED.test(sayOf(words).trim()) ? '' : said('sheet.guard.stop'));
/** A sign-out signed after a taken Guard: what it said, ending `Guard is on.` */
export const guardFirstDone = words => (sayOf(words).trim() ? said('sheet.guard.done', { said: innerOf(words), stop: stopAfter(words) }) : said('sheet.guard.on'));
/** A sign-out refused after a taken Guard (Guard stays, and says so): the Account's words. */
export const guardFirstRefused = words => {
  const w = sayOf(words).trim() ? innerOf(words) : said('sheet.guard.noAnswer');
  return said('sheet.guard.refused', { words: w, stop: stopAfter(w) });
};

// ── granting an agent's ask (plan 4b Task 6, portfolio.js pfGrant) ──

/** The kinds of ask an agent sends (sign.ts agentAsk) that the face grants: each answered by a sheet. */
export const GRANT_KINDS = ['limit', 'venue', 'letIn', 'topup', 'session', 'leverage', 'mode'];
// the ask's agent among the keys standing on the page (let in, `status` ok): the only agent an agent wallet is made for
const standingKey = (page, agent) => pageOk(page) && records(page.keys).some(k => k.status === 'ok' && sameAddress(str(k.address), agent));
// the agent's wallet on the page, by its address
const walletOfAsk = (page, ask) => walletsOf(page).find(w => sameAddress(w.agent, str(ask.agent))) ?? null;

/** The ask is one this face grants (Cards draws its Grant key), as the retired page's pfGrantable judges it: a venue on a page
 *  that connects; a limit, a session or leverage only for an Account that takes writes (the last two on a page with its dial);
 *  a top-up for one that takes writes, into the agent's wallet from an account money moves from that is not an agent wallet,
 *  or — with no wallet — an agent wallet for a key standing on the page (never another agent's); the mode only while Beast is
 *  not in force; a knocking key always. A venue ask's sheet may still wait for where the account can connect to be read
 *  (`grantOf` with `venuesHere`). */
export function grantsAsk(ask, page) {
  if (!isRecord(ask) || !GRANT_KINDS.includes(ask.kind) || !pageOk(page)) return false;
  switch (ask.kind) {
    case 'venue': return isRecord(page.connectLive);
    case 'limit': return writesOn(page);
    case 'topup':
      if (!writesOn(page)) return false;
      return walletOfAsk(page, ask)
        ? moveSourcesOf(page).some(x => !x.agent)
        : standingKey(page, str(ask.agent));
    case 'session':
    case 'leverage': return writesOn(page) && isRecord(page.dial);
    case 'mode': return page.mode !== 'open';
    default: return true;
  }
}

// the line under a granting sheet's title: the ask in the Account's words
const askedWordsOf = ask => (!str(ask.text) ? '' : str(ask.agentName) ? said('sheet.asked.named', { name: ask.agentName, text: ask.text }) : said('sheet.asked.agent', { text: ask.text }));
// the name an agent wallet is first given: the agent's, letters and digits, at most 16 (portfolio.js pfWalletForm)
const walletNameOf = name => str(name).replace(/[^A-Za-z0-9]/g, '').slice(0, 16) || 'agent';
// the connect option a venue is reached through: one of its kind, else the exchange account that lists it (portfolio.js
// pfConnectVenue); none: every way of connecting
function connectPresetOf(options, venue) {
  const byKind = options.find(o => o.kind === venue);
  if (byKind) return { connector: byKind.connector };
  const ex = options.find(o => o.kind === 'exchange' && listOf(o.venues).includes(venue));
  if (!ex) return { connector: '' };
  return needsExchange(ex) ? { connector: ex.connector, exchange: venue } : { connector: ex.connector };
}

/** The sheet that grants an agent's ask (the page's `asks`), seeded from it and the page, its title line under it the ask
 *  (`askedWords`, `<agentName> asked: “<text>”`): a bigger limit → `limit` (`limitSeedOf`, the asked venue ticked and the asked
 *  dollars as the budget); a venue → the same when it is on the page, else `connect` on the option it is reached through —
 *  `venuesHere` the Venues read of where the account can connect, the sheet null until it has landed; a knocking key → `letIn`
 *  at the ask's own address (never a name's); a top-up → `move` into the agent's wallet, matched by the agent's address, with
 *  the ask's dollars, or with none an agent wallet (`subWallet`) for it; a session → `session`; leverage → `leverageCap`; the
 *  mode → `beast`. An ask this page does not grant (`grantsAsk`): null. */
export function grantOf(ask, page, venuesHere = null) {
  if (!grantsAsk(ask, page)) return null;
  const askedWords = askedWordsOf(ask);
  const dial = pageOk(page) && isRecord(page.dial) ? page.dial : {};
  switch (ask.kind) {
    case 'venue':
      if (!venuesOf(page).some(v => v.id === str(ask.venue))) {
        if (venuesHere === null || venuesHere === undefined) return null;
        const options = connectOptionsOf(page, venuesHere);
        return { kind: 'connect', seed: { options, venues: venuesOf(page).map(v => ({ id: v.id })), ...connectPresetOf(options, str(ask.venue)), askedWords } };
      }
    // falls through: a venue on the page is ticked on the agent's trading limit
    case 'limit':
      return { kind: 'limit', seed: { ...limitSeedOf(page, ask.agent, ask.agentName), asked: str(ask.venue), budget: str(ask.usd), askedWords } };
    case 'letIn':
      return { kind: 'letIn', seed: { address: str(ask.agent), name: str(ask.agentName) || str(ask.text), askedWords } };
    case 'topup': {
      const wallet = walletOfAsk(page, ask);
      if (wallet) {
        const from = moveSourcesOf(page).find(x => !x.agent)?.id ?? '';
        return { kind: 'move', seed: { ...moveSeedOf(page, { from, to: wallet.venue, amount: str(ask.usd) }), askedWords } };
      }
      const float = Number(ask.usd) > 0 ? str(ask.usd) : '50';
      return { kind: 'subWallet', seed: { ...subWalletSeedOf(page, { agent: str(ask.agent), name: walletNameOf(ask.agentName), float }), askedWords } };
    }
    case 'session':
      return { kind: 'session', seed: { ended: dial.sessionEnded === true, askedWords } };
    case 'leverage':
      return { kind: 'leverageCap', seed: { max: dial.maxLeverage, askedWords } };
    case 'mode':
      return { kind: 'beast', seed: { askedWords } };
    default:
      return null;
  }
}

// ── the connect sheet's check (plan 2 Task 8) ──

// the option the open connect sheet has picked, or nothing
const pickedOption = sheet => (isRecord(sheet) && sheet.kind === 'connect'
  ? connectOptions(sheet.seed).find(o => o.connector === text(sheet.fields, 'connector')) ?? null : null);
/** The option the open connect sheet has picked (its seed's, as connectOptionsOf gave it), or null: what the renderer draws a
 *  wallet's tiles or a sign-in's key for. */
export const connectOptionOf = sheet => pickedOption(sheet);
/** Who a sign-in option signs in at: its label's first part (`Robinhood` of `Robinhood · investing accounts…`). */
export const whoOf = option => str(option?.label).split(' · ')[0] || str(option?.kind);
/** A browser wallet's tiles go with this option: the Account's own wallet kind, read by an address. */
export const isWalletOption = option => isRecord(option) && option.kind === 'wallet' && option.needs === 'address';
// an exchange account's exchange, when the one picked is the option's
const exchangeOf = (sheet, option) => { const x = text(sheet.fields, 'exchange'); return listOf(option.venues).includes(x) ? x : ''; };
// the reach's states in words, where the venue gives none of its own
function reachWords(state) {
  switch (state) {
    case 'location': return t('sheet.reach.location');
    case 'close-only': return t('sheet.reach.closeOnly');
    case 'setup': return t('sheet.reach.setup');
    case 'closed': return t('sheet.reach.closed');
    case 'unreachable': return t('sheet.reach.unreachable');
    default: return '';
  }
}
const sameAsk = (a, b) => isRecord(a) && isRecord(b) && ['kind', 'venue', 'ref', 'exchange'].every(k => a[k] === b[k]);

/** The key file the open connect sheet would connect with, as host/account.js's `checkKeyfile` asks it: the picked option's
 *  kind, the venue (an exchange account's is its exchange unless another is typed), the path as typed (blank: the Account's
 *  default for the venue) and the exchange. Nothing to check — no key-file option picked, no venue yet: null. */
export function keyfileAskOf(sheet) {
  const option = pickedOption(sheet);
  if (!option || option.needs !== 'key-file') return null;
  const exchange = needsExchange(option) ? exchangeOf(sheet, option) : '';
  const venue = text(sheet.fields, 'venue') || exchange;
  if (!venue || !str(option.kind)) return null;
  return { kind: option.kind, venue, ref: text(sheet.fields, 'credentialRef'), exchange };
}

/** The connector whose reach the open connect sheet asks (`reach(connector)`): the picked option's; an exchange account's
 *  `live:exchange:<exchange>` once its exchange is picked. Nothing picked: null. */
export function reachAskOf(sheet) {
  const option = pickedOption(sheet);
  if (!option) return null;
  if (!needsExchange(option)) return option.connector;
  const exchange = exchangeOf(sheet, option);
  return exchange ? `live:exchange:${exchange}` : null;
}

// a browser wallet's part of the check (the account slice's `connectWallet`): looking, none, asked, signed — only while the
// address it signed for is the one in the form — or its refusal (the wallet's words, or the Account's)
function walletWords(sheet, w) {
  if (!isRecord(w)) return '';
  if (w.status === 'none') return t('sheet.wallet.none');
  if (w.status === 'asking') return str(w.wallet) ? t('sheet.wallet.asking', { wallet: w.wallet }) : t('sheet.wallet.askingAny');
  if (w.status === 'refused') return sayOf(w.message);
  if (w.status === 'proven' && str(w.address) && text(sheet.fields, 'ref').toLowerCase() === w.address.toLowerCase()) {
    return str(w.wallet) ? t('sheet.wallet.proven', { wallet: w.wallet, address: short(w.address) }) : t('sheet.wallet.provenAny', { address: short(w.address) });
  }
  return '';
}
// a sign-in's part (the account slice's `signIn`), only for the option it was started for
function signInWords(option, si) {
  if (!isRecord(si) || si.connector !== option.connector) return '';
  const who = whoOf(option);
  switch (si.status) {
    case 'starting': return t('sheet.signIn.starting', { who });
    // with no tab of its own, the renderer draws the link to the venue's page in its place
    case 'waiting': return si.tab === false ? '' : t('sheet.signIn.waiting', { who });
    case 'ready': return t('sheet.signIn.ready');
    case 'expired': return t('sheet.signIn.expired');
    case 'failed': return sayOf(si.message) || t('sheet.signIn.failed');
    default: return '';
  }
}
// a long hex address as the retired page shortens it (core.js short)
const short = a => (/^0x[0-9a-fA-F]{16,}$/.test(a) ? `${a.slice(0, 8)}…${a.slice(-4)}` : a);

/** The connect sheet's check, one line from the Account's own words: the venue's words when it is not connectable here, a
 *  reach that does not answer from here (its words, or the state's); then by what the option needs — a browser wallet's words
 *  (`more.wallet`, the slice's `connectWallet`) for the wallet kind, the option's own example for another address and for a
 *  command line (what to run on this machine), a sign-in's words (`more.signIn`), and the key file's check —
 *  `Key file found: <path>`, `Missing: a, b`, else the Account's sentence — only when it was asked for the form as it stands
 *  (`keyfileAskOf`), each sentence once. `keyfile` and `reach` are the account slice's reads. Another sheet, or nothing picked: ''. */
export function connectCheckOf(sheet, keyfile, reach, more = {}) {
  const option = pickedOption(sheet);
  if (!option) return '';
  const parts = [];
  if (option.needs === 'cli' || (option.needs === 'address' && !isWalletOption(option))) parts.push(str(option.example));
  if (option.verdict && option.verdict !== 'connectable' && str(option.said)) parts.push(option.said);
  const connector = reachAskOf(sheet);
  const r = connector && reach?.data?.ok === true ? records(reach.data.reach).find(e => e.connector === connector) : null;
  if (r && r.state !== 'ok') parts.push(str(r.said) || reachWords(r.state));
  if (isWalletOption(option)) parts.push(walletWords(sheet, more?.wallet));
  if (option.needs === 'sign-in') parts.push(signInWords(option, more?.signIn));
  const ask = keyfileAskOf(sheet);
  if (ask && sameAsk(keyfile?.asked, ask)) {
    if (keyfile.status === 'loading') parts.push(t('sheet.keyfile.checking'));
    else if (keyfile.status === 'error') parts.push(str(keyfile.message));
    else if (keyfile.status === 'ready') {
      const w = keyfileWords(keyfile.data);
      parts.push(w.ready ? (w.path ? t('sheet.keyfile.foundAt', { path: w.path }) : t('sheet.keyfile.found')) : w.missing.length ? t('sheet.keyfile.missing', { fields: w.missing.join(t('common.list.sep')) }) : w.message);
    }
  }
  // one sentence once: a venue that did not answer here says so, and a sign-in it refused may say the same
  return [...new Set(parts.filter(Boolean))].join(' · ');
}
