// face/client/js/host/sheet-view.js — every owner sheet's pure shape (spec 2026-10-22 §6.3–§6.4, plan 2 Task 4): its fields, its
// title and go word, and its draft from the fields — the Account's own field set for its type, nothing added and nothing renamed
// (docs/research/2026-10-22-account-owner-path-map.md §1.4–§1.5, §3.8–§3.10, §3.12, §3.14, §3.15, §3.17, §4.3) — or, while the
// form is not complete, the words for what is missing; and the connect sheet's check (what to ask, its words). The sheet engine
// (host/sheet.js) prepares the draft, the renderer draws the fields; the Account judges everything else in its own words. `now` is the caller's clock in milliseconds; `validUntil`
// values are numbers (the Account's u64 fields), the dollar amounts strings as typed. No DOM, no store.
import { pageOk, venuesOf, keyfileWords, paperBooksOf } from './account-view.js';
import { tradeFieldsOf, tradeDraftOf } from './trade-view.js';
import { MARKET_KINDS, marketTitleOf, marketGoOf, marketFieldsOf, marketDraftOf } from './sheet-market.js';
import { RULES_KINDS, rulesTitleOf, rulesGoOf, rulesFieldsOf, rulesDraftOf } from './sheet-rules.js';
import { MONEY_KINDS, moneyTitleOf, moneyGoOf, moneyFieldsOf, moneyRefieldsOf, moneyDraftOf } from './sheet-money.js';

const DAY = 86_400_000;
const ZERO = '0x0000000000000000000000000000000000000000';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// a plain decimal, as the Account takes its amounts
const AMOUNT = /^\d+(\.\d+)?$/;
const DAYS = ['1', '7', '30', '90'].map(d => ({ value: d, label: d === '1' ? '1 day' : `${d} days` }));

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = v => (typeof v === 'string' ? v : '');

/** Every sheet kind. `order` is the Trade ticket's: its fields and draft are the trade view's, from `seed.ticket`. `close`,
 *  `amend` and `leverage` are the Market half's: everything about them is host/sheet-market.js's. `beast`, `cap`, `session` and
 *  `leverageCap` are the Rules tab's: host/sheet-rules.js's. `move` and `earn` are the Money tab's: host/sheet-money.js's (plan 4b Tasks 2-3). */
export const SHEET_KINDS = ['letIn', 'limit', 'endLimit', 'revoke', 'connect', 'paper', 'topUp', 'resetPaper', 'disconnect',
  'approveCard', 'declineAsk', 'letDevice', 'signOut', 'order', 'reopen', ...MARKET_KINDS, ...RULES_KINDS, ...MONEY_KINDS];
const isMarket = kind => MARKET_KINDS.includes(kind);
const isRules = kind => RULES_KINDS.includes(kind);
const isMoney = kind => MONEY_KINDS.includes(kind);

const GO = new Map([
  ['letIn', 'Let it in'], ['limit', 'Give the limit'], ['endLimit', 'End the limit'], ['revoke', 'Revoke'], ['connect', 'Connect'],
  ['paper', 'Open the account'], ['topUp', 'Top up'], ['resetPaper', 'Start over'], ['disconnect', 'Disconnect'], ['approveCard', 'Approve'],
  ['declineAsk', 'Decline'], ['letDevice', 'Let it sign'], ['signOut', 'Sign out'], ['order', 'Sign and place'],
  ['reopen', 'Sign and reopen'],
]);

/** The sheet's go key: a card's is `Reject` when the seed's decision is to reject; an earn's by the side its fields picked. */
export function goWord(kind, seed, fields) {
  if (kind === 'approveCard' && seed?.decision === 'reject') return 'Reject';
  if (isMarket(kind)) return marketGoOf(kind, seed);
  if (isRules(kind)) return rulesGoOf(kind, seed);
  if (isMoney(kind)) return moneyGoOf(kind, seed, fields);
  return GO.get(kind) ?? '';
}

/** The sheet's title, naming what the seed names — a move's, the source its fields have picked. */
export function titleOf(kind, seed, fields) {
  if (isMarket(kind)) return marketTitleOf(kind, seed);
  if (isRules(kind)) return rulesTitleOf(kind, seed);
  if (isMoney(kind)) return moneyTitleOf(kind, seed, fields);
  const s = isRecord(seed) ? seed : {};
  const place = str(s.name) || str(s.venue);
  switch (kind) {
    case 'letIn': return `Let ${str(s.name) || 'a key'} in`;
    case 'limit': return `Give ${str(s.name) || 'the agent'} a limit`;
    case 'endLimit': return str(s.name) ? `End ${s.name}'s trading limit` : 'End the trading limit';
    case 'revoke': return `Revoke ${str(s.name) || 'the key'}`;
    case 'connect': return 'Connect an account';
    case 'paper': return 'Open a paper account';
    case 'topUp': return `Top up ${place || 'the paper account'}`;
    case 'resetPaper': return `Start ${place || 'the paper account'} over`;
    case 'disconnect': return `Disconnect ${place || 'the venue'}`;
    case 'approveCard': return s.decision === 'reject' ? 'Reject the card' : 'Approve the card';
    case 'declineAsk': return 'Decline the ask';
    case 'letDevice': return str(s.kid) ? `Let ${s.kid} sign` : 'Let a browser sign';
    case 'signOut': return 'Sign this page out';
    case 'order': return 'Place an order';
    case 'reopen': return `Reopen ${place || 'the venue'} to agents`;
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

/** A limit sheet's seed for an agent, from the page: the venues it may name (`{ id, name, paper }`, paper first) and its standing
 *  trade limit (`current: { allow, perPayment, budget }`, the page's `spend` row of `scope: 'trade'` at its address, in any case,
 *  not expired), or null. Give a limit and a granted ask open on the same shape, so a new limit starts from the standing one —
 *  one standing approval per agent and scope, a new one replacing it. */
export function limitSeedOf(page, address, name) {
  const seed = { address: str(address), name: str(name), venues: [], current: null };
  if (!pageOk(page)) return seed;
  const venues = venuesOf(page).map(v => ({ id: v.id, name: v.name, paper: v.paper }));
  seed.venues = [...venues.filter(v => v.paper), ...venues.filter(v => !v.paper)];
  const row = records(page.spend).find(r => r.scope === 'trade' && r.expired !== true && sameAddress(r.agent, address));
  if (row) seed.current = { allow: listOf(row.allow), perPayment: dollarsText(row.perPaymentUsd), budget: dollarsText(row.budgetUsd) };
  return seed;
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
      { name: 'address', label: 'Key address', type: 'text', placeholder: '0x…', value: str(s.address) },
      { name: 'name', label: 'Name', type: 'text', placeholder: 'Claude Code', value: str(s.name) },
      { name: 'days', label: 'Good for', type: 'seg', options: DAYS, value: '30' },
    ];
    case 'limit': {
      // the standing limit's venues with the asked one ticked; its amounts, the asked budget over its own, the per-order
      // amount never above the budget
      const options = venueOptions(s);
      const known = new Set(options.map(o => o.value));
      const current = isRecord(s.current) ? s.current : null;
      const allow = [...new Set([...listOf(current?.allow), ...listOf(s.asked)].filter(id => known.has(id)))];
      const budget = str(s.budget) || str(current?.budget);
      const standing = str(current?.perPayment);
      const perPayment = standing && AMOUNT.test(budget) && Number(standing) > Number(budget) ? budget : standing;
      return [
        { name: 'allow', label: 'Venues', type: 'pick', options, value: allow },
        { name: 'perPayment', label: 'Per order, in dollars', type: 'number', placeholder: '100', value: perPayment },
        { name: 'budget', label: 'Budget, in dollars', type: 'number', placeholder: '1000', value: budget },
        { name: 'days', label: 'Good for', type: 'seg', options: DAYS, value: '30' },
      ];
    }
    case 'connect': {
      const options = connectOptions(s);
      const picked = options.find(o => o.connector === s.connector);
      const pick = { name: 'connector', label: 'What to connect', type: 'select', options: options.map(o => ({ value: o.connector, label: str(o.label) || o.connector })), value: picked ? picked.connector : '' };
      // by what the option needs (the Account's connect.js openConnect): an address and the name it is shown as; a sign-in at
      // the venue, whose state lands in the hidden credentialRef once it is ready; a command line on this machine, nothing
      switch (picked?.needs) {
        case 'address': return [
          pick,
          { name: 'ref', label: 'Address', type: 'text', placeholder: '0x…', value: str(s.ref) },
          { name: 'label', label: 'Shown as', type: 'text', value: str(s.label) },
        ];
        case 'sign-in': return [pick, { name: 'credentialRef', label: '', type: 'hidden', value: '' }];
        case 'cli': return [pick];
        default: break;
      }
      const exchanges = exchangesOf(s);
      return [
        pick,
        ...(exchanges.length ? [{ name: 'exchange', label: 'Exchange', type: 'select', options: exchanges.map(x => ({ value: x, label: x })), value: exchanges.includes(s.exchange) ? s.exchange : '' }] : []),
        { name: 'venue', label: 'Venue id', type: 'text', placeholder: 'okx', value: str(s.venue) },
        { name: 'label', label: 'Name', type: 'text', placeholder: 'My exchange account', value: str(s.label) },
        { name: 'credentialRef', label: 'Key file', type: 'text', placeholder: str(picked?.defaultRef) || 'credentials/<venue>/api-key.json', value: str(s.credentialRef) },
      ];
    }
    case 'paper': return [
      { name: 'book', label: 'Paper book', type: 'select', options: [{ value: '', label: 'A new paper account' }, ...paperBooks(s).map(b => ({ value: b.venue, label: str(b.name) || b.venue }))], value: '' },
      { name: 'label', label: 'Name', type: 'text', placeholder: 'Momentum', value: '' },
      { name: 'usd', label: 'Paper dollars to start with', type: 'number', placeholder: '10000', value: '' },
    ];
    case 'topUp': return [{ name: 'usd', label: 'Paper dollars to add', type: 'number', placeholder: '1000', value: str(s.usd) }];
    case 'resetPaper': return [{ name: 'usd', label: 'Start again with, in dollars', type: 'number', placeholder: '10000', value: str(s.usd) }];
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
  return fields;
}

// what a connect option needs, as its fields are shaped: a key file (or nothing picked yet), an address, a sign-in, a command line
const shapeOf = option => (option && ['address', 'sign-in', 'cli'].includes(option.needs) ? option.needs : 'key-file');
// a connect sheet's fields after the connector changed to an option of another shape: that shape's fields, the connector and the
// name kept (a key file's path, a typed address and a sign-in's state never carried to another kind)
function connectRefieldsOf(fields, seed) {
  const options = connectOptions(seed);
  const connector = text(fields, 'connector');
  const picked = options.find(o => o.connector === connector);
  const names = new Set((Array.isArray(fields) ? fields : []).map(f => f?.name));
  const shape = names.has('ref') ? 'address' : names.has('venue') ? 'key-file' : names.has('credentialRef') ? 'sign-in' : 'cli';
  if (shapeOf(picked) === shape) return fields;
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
const amountMissing = (v, blank) => (v === '' ? blank : AMOUNT.test(v) && Number(v) > 0 ? null : 'Type an amount in dollars, more than zero');
const daysOf = fields => { const d = text(fields, 'days'); return DAYS.some(o => o.value === d) ? Number(d) : null; };
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
      if (!address) return "Type the key's address";
      if (!ADDRESS.test(address)) return 'An address is 0x and 40 hex digits';
      if (!name) return 'Type a name';
      if (days === null) return 'Pick how long';
      return { type: 'approveAgent', agentAddress: address.toLowerCase(), agentName: name, validUntil: now + days * DAY };
    }
    case 'limit': {
      const agent = str(s.address);
      if (!agent) return 'No agent to give a limit to';
      const picked = new Set(listOf(valueOf(fields, 'allow')));
      const allow = venueOptions(s).map(o => o.value).filter(id => picked.has(id));
      if (allow.length === 0) return 'Pick at least one venue';
      const perPayment = amount(fields, 'perPayment'), budget = amount(fields, 'budget');
      const missing = amountMissing(perPayment, 'Type an amount') ?? amountMissing(budget, 'Type a budget');
      if (missing) return missing;
      if (Number(perPayment) > Number(budget)) return 'The amount per order is more than the budget';
      const days = daysOf(fields);
      if (days === null) return 'Pick how long';
      return { type: 'approveSpend', agent, scope: 'trade', allow: allow.join(','), perPayment, budget, windowHours: 0, validUntil: now + days * DAY };
    }
    case 'endLimit': {
      const agent = str(s.address), allow = listOf(s.allow).join(',');
      if (!agent || !allow) return 'No limit to end';
      return { type: 'approveSpend', agent, scope: 'trade', allow, perPayment: '0', budget: '0', windowHours: 0, validUntil: now + DAY };
    }
    case 'revoke':
      if (!str(s.name)) return 'No key to revoke';
      return { type: 'approveAgent', agentAddress: ZERO, agentName: s.name, validUntil: 0 };
    case 'connect': {
      const option = connectOptions(s).find(o => o.connector === text(fields, 'connector'));
      if (!option) return 'Pick what to connect';
      const kind = str(option.kind);
      if (option.needs === 'address') {
        const ref = text(fields, 'ref');
        if (!ADDRESS.test(ref)) return 'An address is 0x and 40 hex digits';
        // the venue id the Account's page gives it (connect.js venueId): the kind, or a second one numbered by its address
        const venue = records(s.venues).some(v => v.id === kind) ? `${kind}-${ref.slice(2, 8).toLowerCase()}` : kind;
        return { type: 'connectVenue', venue, connector: option.connector, label: text(fields, 'label'), credentialRef: ref };
      }
      if (option.needs === 'sign-in') {
        const state = text(fields, 'credentialRef');
        if (!state) return `Sign in at ${whoOf(option)} first`;
        return { type: 'connectVenue', venue: kind, connector: option.connector, label: '', credentialRef: state };
      }
      if (option.needs === 'cli') return { type: 'connectVenue', venue: kind, connector: option.connector, label: '', credentialRef: '' };
      let connector = option.connector, exchange = '';
      if (needsExchange(option)) {
        exchange = text(fields, 'exchange');
        if (!listOf(option.venues).includes(exchange)) return 'Pick the exchange';
        connector = `live:exchange:${exchange}`;
      }
      // an exchange account's venue id is the exchange's unless another is typed
      const venue = text(fields, 'venue') || exchange, label = text(fields, 'label');
      if (!venue) return 'Type a venue id';
      if (!label) return 'Type a name';
      const credentialRef = text(fields, 'credentialRef') || str(option.defaultRef).replaceAll('<venue>', venue);
      if (!credentialRef) return "Type the key file's path";
      return { type: 'connectVenue', venue, connector, label, credentialRef };
    }
    case 'paper': {
      const book = text(fields, 'book'), label = text(fields, 'label');
      if (book) {
        const kept = paperBooks(s).find(b => b.venue === book);
        if (!kept) return 'Pick a kept paper book';
        // '' continues the kept book as it was
        return { type: 'connectVenue', venue: kept.venue, connector: 'live:paper', label: label || str(kept.name) || kept.venue, credentialRef: '' };
      }
      if (!label) return 'Type a name';
      const id = slug(label);
      if (!id) return 'Type a name with a letter or a digit';
      const usd = amount(fields, 'usd');
      const missing = amountMissing(usd, 'Type an amount');
      if (missing) return missing;
      // never an id already in use — on the page, or a kept book (a sum there would be refused): -2, -3… as the Account does
      const used = new Set([...paperBooks(s).map(b => b.venue), ...records(s.venues).map(v => str(v.id))]);
      let venue = `paper-${id}`;
      for (let n = 2; used.has(venue); n++) venue = `paper-${id}-${n}`;
      return { type: 'connectVenue', venue, connector: 'live:paper', label, credentialRef: usd };
    }
    case 'topUp':
    case 'resetPaper': {
      if (!str(s.venue)) return 'No paper account named';
      const usd = amount(fields, 'usd');
      const missing = amountMissing(usd, 'Type an amount');
      if (missing) return missing;
      return { type: kind === 'topUp' ? 'topUpPaper' : 'resetPaper', venue: s.venue, usd };
    }
    case 'disconnect':
      if (!str(s.venue)) return 'No venue to disconnect';
      return { type: 'disconnectVenue', venue: s.venue };
    case 'approveCard':
      if (!str(s.card) || !str(s.hash)) return 'No card to answer';
      if (s.decision !== 'approve' && s.decision !== 'reject') return 'Approve or reject';
      return { type: 'approveCard', card: s.card, action: s.hash, decision: s.decision };
    case 'declineAsk':
      if (!str(s.ask)) return 'No ask to decline';
      return { type: 'answerAsk', ask: s.ask, decision: 'decline' };
    case 'letDevice': {
      if (!str(s.kid)) return 'No browser to let in';
      const owners = (Array.isArray(s.owners) ? s.owners : []).map(o => (isRecord(o) ? str(o.id) : str(o))).filter(Boolean);
      // the list REPLACES the owners: without them it would drop every device that signs, this page's own among them
      if (owners.length === 0) return 'No owner device to sign with';
      // the Account's rule: a sorted list without repeats; every device signs alone
      const authorizedUsers = [...new Set([...owners, `device:${s.kid}`])].sort();
      return { type: 'convertToMultiSigUser', signers: JSON.stringify({ authorizedUsers, threshold: 1 }) };
    }
    case 'signOut':
      if (!str(s.kid)) return 'This page does not sign for the account';
      return { type: 'signOut', device: `device:${s.kid}` };
    // the liveOrder draft from the Trade ticket (host/trade-view.js): no clock — its deadline is the Account's prepare's
    case 'order': return tradeDraftOf(fields, s.ticket);
    // a venue closed to agents opened to them again: widening what they may do is signed (portfolio.js pfAgentsSwitch)
    case 'reopen':
      if (!str(s.venue)) return 'No venue to reopen';
      return { type: 'setPolicy', change: 'restore', value: s.venue };
    default: return 'Nothing to sign here';
  }
}

/** The sheet that grants an agent's ask (the page's `asks`), seeded from it and the page: a bigger limit or a venue → `limit`
 *  (`limitSeedOf` — the page's venues and the agent's standing trade limit — with the asked venue ticked and the asked dollars
 *  as the budget), a knocking key → `letIn`, a top-up → `topUp`. A session, leverage or the mode is granted on the Account
 *  page: null. */
export function grantOf(ask, page) {
  if (!isRecord(ask)) return null;
  switch (ask.kind) {
    case 'limit':
    case 'venue':
      return { kind: 'limit', seed: { ...limitSeedOf(page, ask.agent, ask.agentName), asked: str(ask.venue), budget: str(ask.usd) } };
    case 'letIn':
      return { kind: 'letIn', seed: { address: str(ask.agent), name: str(ask.agentName) || str(ask.text) } };
    case 'topup':
      return { kind: 'topUp', seed: { venue: str(ask.venue), usd: str(ask.usd) } };
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
const REACH_WORDS = { location: 'Not served from here', 'close-only': 'Close only from here', setup: 'Being set up', closed: 'Closed', unreachable: 'Did not answer' };
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
  if (w.status === 'none') return 'No browser wallet answered on this page. Type the address to watch it.';
  if (w.status === 'asking') return `Waiting for ${str(w.wallet) || 'the wallet'}…`;
  if (w.status === 'refused') return str(w.message);
  if (w.status === 'proven' && str(w.address) && text(sheet.fields, 'ref').toLowerCase() === w.address.toLowerCase()) return `${str(w.wallet) || 'The wallet'} signed: ${short(w.address)} is yours.`;
  return '';
}
// a sign-in's part (the account slice's `signIn`), only for the option it was started for
function signInWords(option, si) {
  if (!isRecord(si) || si.connector !== option.connector) return '';
  const who = whoOf(option);
  switch (si.status) {
    case 'starting': return `Asking ${who} where to sign in…`;
    // with no tab of its own, the renderer draws the link to the venue's page in its place
    case 'waiting': return si.tab === false ? '' : `Sign in on ${who}'s page, then come back.`;
    case 'ready': return 'Signed in. Connect it.';
    case 'expired': return 'The sign-in ran out: start again.';
    case 'failed': return str(si.message) || 'The sign-in did not finish.';
    default: return '';
  }
}
// a long hex address as the Account's page shortens it (core.js short)
const short = a => (/^0x[0-9a-fA-F]{16,}$/.test(a) ? `${a.slice(0, 8)}…${a.slice(-4)}` : a);

/** The connect sheet's check, one line from the Account's own words: the venue's words when it is not connectable here, a
 *  reach that does not answer from here (its words, or the state's); then by what the option needs — a browser wallet's words
 *  (`more.wallet`, the slice's `connectWallet`) for the wallet kind, the option's own example for another address and for a
 *  command line (what to run on this machine), a sign-in's words (`more.signIn`), and the key file's check —
 *  `Key file found: <path>`, `Missing: a, b`, else the Account's sentence — only when it was asked for the form as it stands
 *  (`keyfileAskOf`). `keyfile` and `reach` are the account slice's reads. Another sheet, or nothing picked: ''. */
export function connectCheckOf(sheet, keyfile, reach, more = {}) {
  const option = pickedOption(sheet);
  if (!option) return '';
  const parts = [];
  if (option.needs === 'cli' || (option.needs === 'address' && !isWalletOption(option))) parts.push(str(option.example));
  if (option.verdict && option.verdict !== 'connectable' && str(option.said)) parts.push(option.said);
  const connector = reachAskOf(sheet);
  const r = connector && reach?.data?.ok === true ? records(reach.data.reach).find(e => e.connector === connector) : null;
  if (r && r.state !== 'ok') parts.push(str(r.said) || (Object.hasOwn(REACH_WORDS, r.state) ? REACH_WORDS[r.state] : ''));
  if (isWalletOption(option)) parts.push(walletWords(sheet, more?.wallet));
  if (option.needs === 'sign-in') parts.push(signInWords(option, more?.signIn));
  const ask = keyfileAskOf(sheet);
  if (ask && sameAsk(keyfile?.asked, ask)) {
    if (keyfile.status === 'loading') parts.push('Checking the key file…');
    else if (keyfile.status === 'error') parts.push(str(keyfile.message));
    else if (keyfile.status === 'ready') {
      const w = keyfileWords(keyfile.data);
      parts.push(w.ready ? (w.path ? `Key file found: ${w.path}` : 'Key file found') : w.missing.length ? `Missing: ${w.missing.join(', ')}` : w.message);
    }
  }
  return parts.filter(Boolean).join(' · ');
}
