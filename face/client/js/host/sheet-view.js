// face/client/js/host/sheet-view.js — every owner sheet's pure shape (spec 2026-10-22 §6.3–§6.4, plan 2 Task 4): its fields, its
// title and go word, and its draft from the fields — the Account's own field set for its type, nothing added and nothing renamed
// (docs/research/2026-10-22-account-owner-path-map.md §1.4–§1.5, §3.8–§3.10, §3.12, §3.14, §3.15, §3.17, §4.3) — or, while the
// form is not complete, the words for what is missing. The sheet engine (host/sheet.js) prepares the draft, the renderer draws
// the fields; the Account judges everything else in its own words. `now` is the caller's clock in milliseconds; `validUntil`
// values are numbers (the Account's u64 fields), the dollar amounts strings as typed. No DOM, no store.

const DAY = 86_400_000;
const ZERO = '0x0000000000000000000000000000000000000000';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// a plain decimal, as the Account takes its amounts
const AMOUNT = /^\d+(\.\d+)?$/;
const DAYS = ['1', '7', '30', '90'].map(d => ({ value: d, label: d === '1' ? '1 day' : `${d} days` }));

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = v => (typeof v === 'string' ? v : '');

/** Every sheet kind. `order` is the Trade ticket's: its fields and draft are the trade view's (Task 9). */
export const SHEET_KINDS = ['letIn', 'limit', 'endLimit', 'revoke', 'connect', 'paper', 'topUp', 'resetPaper', 'disconnect',
  'approveCard', 'declineAsk', 'letDevice', 'signOut', 'order'];

const GO = new Map([
  ['letIn', 'Let it in'], ['limit', 'Give the limit'], ['endLimit', 'End the limit'], ['revoke', 'Revoke'], ['connect', 'Connect'],
  ['paper', 'Open the account'], ['topUp', 'Top up'], ['resetPaper', 'Start over'], ['disconnect', 'Disconnect'], ['approveCard', 'Approve'],
  ['declineAsk', 'Decline'], ['letDevice', 'Let it sign'], ['signOut', 'Sign out'], ['order', 'Sign and place'],
]);

/** The sheet's go key: a card's is `Reject` when the seed's decision is to reject. */
export function goWord(kind, seed) {
  if (kind === 'approveCard' && seed?.decision === 'reject') return 'Reject';
  return GO.get(kind) ?? '';
}

/** The sheet's title, naming what the seed names. */
export function titleOf(kind, seed) {
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

/** The sheet's fields, each `{ name, label, type, options?, placeholder?, value }` — `options` as `{ value, label }`, a `pick`'s
 *  value a list, the rest strings — filled from the seed where it says. */
export function fieldsOf(kind, seed) {
  const s = isRecord(seed) ? seed : {};
  switch (kind) {
    case 'letIn': return [
      { name: 'address', label: 'Key address', type: 'text', placeholder: '0x…', value: str(s.address) },
      { name: 'name', label: 'Name', type: 'text', placeholder: 'Claude Code', value: str(s.name) },
      { name: 'days', label: 'Good for', type: 'seg', options: DAYS, value: '30' },
    ];
    case 'limit': {
      const options = venueOptions(s);
      const known = new Set(options.map(o => o.value));
      return [
        { name: 'allow', label: 'Venues', type: 'pick', options, value: [...new Set(listOf(s.allow).filter(id => known.has(id)))] },
        { name: 'perPayment', label: 'Per order, in dollars', type: 'number', placeholder: '100', value: str(s.perPayment) },
        { name: 'budget', label: 'Budget, in dollars', type: 'number', placeholder: '1000', value: str(s.budget) },
        { name: 'days', label: 'Good for', type: 'seg', options: DAYS, value: '30' },
      ];
    }
    case 'connect': {
      const options = connectOptions(s);
      const picked = options.find(o => o.connector === s.connector);
      return [
        { name: 'connector', label: 'What to connect', type: 'select', options: options.map(o => ({ value: o.connector, label: str(o.label) || o.connector })), value: picked ? picked.connector : '' },
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
    // Task 9: the `order` sheet's fields are the Trade ticket's (host/trade-view.js)
    default: return [];
  }
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
      if (option.needs !== 'key-file') return 'Connect on the Account page';
      const venue = text(fields, 'venue'), label = text(fields, 'label');
      if (!venue) return 'Type a venue id';
      if (!label) return 'Type a name';
      const credentialRef = text(fields, 'credentialRef') || str(option.defaultRef).replaceAll('<venue>', venue);
      if (!credentialRef) return "Type the key file's path";
      return { type: 'connectVenue', venue, connector: option.connector, label, credentialRef };
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
      return { type: 'connectVenue', venue: `paper-${id}`, connector: 'live:paper', label, credentialRef: usd };
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
      // the Account's rule: a sorted list without repeats; every device signs alone
      const authorizedUsers = [...new Set([...owners, `device:${s.kid}`])].sort();
      return { type: 'convertToMultiSigUser', signers: JSON.stringify({ authorizedUsers, threshold: 1 }) };
    }
    case 'signOut':
      if (!str(s.kid)) return 'This page does not sign for the account';
      return { type: 'signOut', device: `device:${s.kid}` };
    // Task 9: case 'order' delegates to tradeDraftOf (host/trade-view.js) — the liveOrder draft from the Trade ticket
    default: return 'Nothing to sign here';
  }
}

/** The sheet that grants an agent's ask (the page's `asks`), seeded from it: a bigger limit or a venue → `limit` (the venue
 *  picked, the dollars as the budget; the opener adds the page's venues), a knocking key → `letIn`, a top-up → `topUp`.
 *  A session, leverage or the mode is granted on the Account page: null. */
export function grantOf(ask) {
  if (!isRecord(ask)) return null;
  switch (ask.kind) {
    case 'limit':
    case 'venue':
      return { kind: 'limit', seed: { address: str(ask.agent), name: str(ask.agentName), allow: str(ask.venue) ? [ask.venue] : [], budget: str(ask.usd) } };
    case 'letIn':
      return { kind: 'letIn', seed: { address: str(ask.agent), name: str(ask.agentName) || str(ask.text) } };
    case 'topup':
      return { kind: 'topUp', seed: { venue: str(ask.venue), usd: str(ask.usd) } };
    default:
      return null;
  }
}
