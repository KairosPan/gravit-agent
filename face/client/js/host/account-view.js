// face/client/js/host/account-view.js — the Account screen's pure views (spec 2026-10-22 §6.2) over the Account's own payloads
// as the face proxies them — the page (/data/account), holdings?cost=1 and its paper lens, history, statement and agents, and
// the connect sheet's reads (venues, paper/books, keyfile) — each
// taking the route's body as the store keeps it and answering its empty shape for a body it does not recognise; and the seat
// box's words over /data/seat.json (spec 2026-10-20 §6.3). An amount that does not parse is null, never NaN and never 0; a time
// stays the Account's ISO string, its words the renderer's. No DOM.
import { number } from '../wire/account-model.js';
import { fmtDate } from '../time.js';
import { HOST_NAME } from '../wire/speaker.js';
import { t, tn } from '../i18n/words.js';

// ── The seat box, and the Account's words it shares with the views below ──

const isNum = v => typeof v === 'number' && Number.isFinite(v);
// whole dollars where they are whole: "$100", "$1,000", "$56.17"
const dollars = n => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
// a list as the Account sends it, an entry that is not an object left out
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
// a string as the Account sends it, or nothing
const str = v => (typeof v === 'string' ? v : '');
const EMPTY_SEAT = { service: '', mode: '', writes: '', seat: '', limits: [], venues: [], cards: '', url: '' };
// the Account's mode and its writes (`connectLive.writes`) as its page words them: the seat box's and the head's alike
const modeWords = mode => (mode === 'guard' ? t('account.mode.guard') : mode === 'open' ? t('account.mode.beast') : '');
const writesWords = w => (w && typeof w === 'object' ? (w.on === true ? (isNum(w.capUsd) ? t('account.writes.onCap', { cap: dollars(w.capUsd) }) : t('account.writes.on')) : t('account.writes.readOnly')) : '');
// one limit in one line, `trade · paper-1 · $100 an order · $850 of $1,000 left · expired`: the seat's (its perOrderUsd) and
// an Account agent's (its perPaymentUsd) alike. An amount that is not there is no clause, never $0; a word that is not a string, none.
// a limit's scope, the Account's code worded; a code with no word is drawn as it came
function limitScopeWord(scope) {
  switch (scope) {
    case 'trade': return t('account.limitScope.trade');
    case 'venues': return t('account.limitScope.venues');
    case 'payees': return t('account.limitScope.payees');
    case 'earn': return t('account.limitScope.earn');
    default: return scope;
  }
}
const limitWords = (l, perOrderUsd) => {
  const budget = number(l.budgetUsd), left = number(l.leftUsd);
  return [ // words-order: a limit's clauses under the visual separator
    limitScopeWord(str(l.scope)),
    (Array.isArray(l.allow) ? l.allow : []).map(str).filter(Boolean).join(t('common.list.sep')),
    isNum(perOrderUsd) ? t('account.limit.perOrder', { amount: dollars(perOrderUsd) }) : '',
    budget !== null && left !== null ? t('account.limit.left', { left: dollars(left), budget: dollars(budget) }) : '',
    l.expired === true ? t('account.limit.expired') : '',
  ].filter(Boolean).join(' · ');
};

/** The Account seat's standing (/data/seat.json; spec 2026-10-20 §6.3) in the words the Venues box draws: the service, the
 *  Account's own mode and writes, the seat's standing, each limit, the venues with the paper ones marked, the cards waiting.
 *  Nothing read, or a view that is not one, is all blanks; a service not reachable is that line and nothing else. */
export function seatWords(data) {
  if (!data || data.ok !== true) return EMPTY_SEAT;
  const url = typeof data.url === 'string' ? data.url : '';
  let host = url;
  try { host = new URL(url).host; } catch { /* a bare address stays as it is */ }
  if (data.reachable !== true) return { ...EMPTY_SEAT, service: data.error === 'disabled' ? t('account.seat.disabled', { host }) : t('account.seat.unreachable', { host }), url };
  const mode = modeWords(data.mode);
  const writes = writesWords(data.writes);
  const s = data.seat && typeof data.seat === 'object' ? data.seat : {};
  const name = typeof s.name === 'string' && s.name ? s.name : HOST_NAME;
  const seat = s.status === 'admitted' ? (isNum(s.validUntil) ? t('account.seat.admittedUntil', { name, date: fmtDate(s.validUntil) }) : t('account.seat.admitted', { name }))
    : s.status === 'knocking' ? t('account.seat.knocking', { name })
      : s.status === 'expired' ? t('account.seat.expired', { name })
        : s.status === 'revoked' ? t('account.seat.revoked', { name })
          : s.status === 'unknown' ? t('account.seat.unknown', { name })
            : t('account.seat.absent', { name });
  const limits = (Array.isArray(s.limits) ? s.limits : []).map(l => limitWords(l, l.perOrderUsd));
  const venues = (Array.isArray(data.venues) ? data.venues : []).map(v => ({
    id: typeof v.id === 'string' ? v.id : '',
    name: typeof v.name === 'string' && v.name ? v.name : (typeof v.id === 'string' ? v.id : ''),
    paper: v.paper === true,
    usd: isNum(v.usd) ? dollars(v.usd) : '',
    note: typeof v.notServed === 'string' && v.notServed ? v.notServed : (v.stale === true ? t('account.venue.stale') : ''),
  }));
  const n = Array.isArray(data.cards) ? data.cards.length : 0;
  const cards = n === 0 ? '' : tn('account.seat.cards', n);
  return { service: t('account.seat.reachable', { host }), mode, writes, seat, limits, venues, cards, url };
}

// ── The Account's own payloads (spec 2026-10-22 §6.2), each as its /data/account… route answers it ──

// a read's list: only an answer (`ok: true`) carries one
const listOf = (body, key) => (body?.ok === true ? records(body[key]) : []);
// an ISO time as a number to compare, null when it is not one
const stamp = at => { const ms = typeof at === 'string' ? Date.parse(at) : NaN; return Number.isFinite(ms) ? ms : null; };
// one agent's address and another, in any case (seat.ts compares them so)
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a !== '' && a.toLowerCase() === b.toLowerCase();
// the largest value first, an unpriced row last; the newest first, a time that does not parse last; a tie keeps the Account's order
const largestFirst = (a, b) => (a.usd === b.usd ? 0 : a.usd === null ? 1 : b.usd === null ? -1 : b.usd - a.usd);
const newestFirst = (a, b) => { const ta = stamp(a.at), tb = stamp(b.at); return ta === tb ? 0 : ta === null ? 1 : tb === null ? -1 : tb - ta; };

/** True when the body is the Account's read as /data/account serves it: an answer with its venues, cards and orders, its
 *  signers and connectLive. The page views below answer their empty shapes for anything else. */
export function pageOk(page) {
  return Boolean(page?.ok === true && Array.isArray(page.venues) && Array.isArray(page.cards) && Array.isArray(page.orders) && page.signers && page.connectLive);
}

/** Whether the Account takes writes now (its page's `connectLive.writes.on`): a read-only Account, or a page the face does not
 *  recognise, offers no key that would write. */
export function writesOn(page) {
  return pageOk(page) && page.connectLive.writes?.on === true;
}

/** The head's two chips: the Account's mode (`Guard`, `Beast`) and its writes (`Trading on · $250 a move`, `Read-only`). */
export function headOf(page) {
  if (!pageOk(page)) return { mode: '', writes: '' };
  return { mode: modeWords(page.mode), writes: writesWords(page.connectLive.writes) };
}

/** The Portfolio's two figures, each labelled. Real money — the page's `totalUsd`: the venues that are not paper, in flight and
 *  held; the holdings read repeats it — leads, unless it is zero or does not parse while a paper venue is connected and the
 *  paper lens (`holdings?cost=1&paper=1`) has a total: then Paper leads, and real money, when there is a figure, is second. */
export function worthOf(page, holdingsBody, paperBody) {
  if (!pageOk(page)) return { lead: { label: t('account.worth.net'), usd: null }, second: null, paperLeads: false };
  const real = number(page.totalUsd);
  const paperTotal = number(paperBody?.totalUsd);
  const hasPaper = page.venues.some(v => v?.paper === true);
  const paperLeads = (real === null || real === 0) && hasPaper && paperTotal !== null;
  if (paperLeads) return { lead: { label: t('account.worth.paper'), usd: paperTotal }, second: real === null ? null : { label: t('account.worth.net'), usd: real }, paperLeads };
  return { lead: { label: t('account.worth.net'), usd: real }, second: hasPaper && paperTotal !== null ? { label: t('account.worth.paper'), usd: paperTotal } : null, paperLeads };
}

/** The change line for the range, from `history` (or `history?paper=1`): `changeUsd`, `changePct` — the Account's percent, 0.72
 *  being 0.72 % — whether the curve is partial, its first point's time, and the paper curve's own two: what it made since its
 *  start (`sinceStartUsd`) and whether it was rebuilt from the book. A body that is not one is all nulls. */
export function changeOf(historyBody) {
  const h = isRecord(historyBody) ? historyBody : {};
  return {
    usd: number(h.changeUsd), pct: number(h.changePct), partial: h.partial === true, first: typeof h.first === 'string' ? h.first : null,
    sinceStartUsd: number(h.sinceStartUsd), rebuilt: h.rebuilt === true,
  };
}

/** The Assets table from `holdings?cost=1`'s rows: each asset across its venues (`changePct24h` the Account's percent), the
 *  largest value first. */
export function assetsOf(holdingsBody) {
  return listOf(holdingsBody, 'rows').map(row => ({
    key: str(row.key), asset: str(row.asset), cls: str(row.class),
    amount: number(row.amount), usd: number(row.usd), price: number(row.price), changePct24h: number(row.changePct24h),
    venues: records(row.venues).map(v => ({ venue: str(v.venue), venueName: str(v.venueName), amount: number(v.amount), usd: number(v.usd), stale: v.stale === true, product: str(v.product) })),
    // an Earning row's product, where the row names it (holdings: one row a product, `earn:<venue>:<product>`)
    earn: isRecord(row.earn) ? { venue: str(row.earn.venue), product: str(row.earn.product) } : null,
  })).sort(largestFirst);
}

/** The Positions table from the same read's `positions` (the paper lens's are its own), in the Account's order. */
export function positionsOf(holdingsBody) {
  return listOf(holdingsBody, 'positions').map(p => ({
    venue: str(p.venue), venueName: str(p.venueName), symbol: str(p.symbol), name: str(p.name), side: str(p.side),
    qty: number(p.qty), entryPrice: number(p.entryPrice), markPrice: number(p.markPrice), usd: number(p.usd), unrealizedUsd: number(p.unrealizedUsd),
    paper: p.paper === true, kind: str(p.kind), leverage: number(p.leverage),
  }));
}

const OPEN = new Set(['open', 'partial', 'pending']);

/** The page's orders still working — open, partial or pending — newest first as the Account sends them, each with whose it
 *  is: You for the owner's; an agent's is `Agent · <name>`, the name the page's keys give the order's agent address, else
 *  An agent (an order carries the address, never the name) — and `mine`, true for the owner's, the flag a caller sorts on. */
export function openOrdersOf(page) {
  return pageOk(page) ? orderRowsOf(page.orders, page.keys) : [];
}

/** The orders still working of a list as the Account sends its orders (the page's, an asset read's), each worded as
 *  openOrdersOf words it, `keys` (the page's) naming an agent's address. */
export function orderRowsOf(orders, keys) {
  const named = records(keys);
  const nameAt = address => str(named.find(k => sameAddress(k.address, address))?.name);
  return records(orders).filter(o => OPEN.has(o.status)).map(o => {
    const name = o.authority === 'owner' ? '' : nameAt(o.agent);
    return {
      id: str(o.id), venue: str(o.venue), venueName: str(o.venueName), symbol: str(o.symbol), side: str(o.side), type: str(o.type),
      qty: number(o.qty), filledQty: number(o.filledQty), limitPrice: number(o.limitPrice), status: o.status,
      kind: str(o.kind), stopPrice: number(o.stopPrice), base: str(o.base),
      who: o.authority === 'owner' ? t('agents.who.you') : name ? t('agents.who.named', { name }) : t('agents.who.unnamed'),
      // the owner's own order: what a market's page sorts by, never the word `who` says it in
      mine: o.authority === 'owner',
      paper: o.paper === true,
      // what keeps an order from being changed (the retired page's tkAmendable, and the Account's own refusal of a change not yet
      // confirmed): waiting for the wallet to send it, being canceled, not followed since a restart, a change the venue has not confirmed
      waitingForWallet: Boolean(o.walletTxs) && !str(o.ref), canceling: o.canceling === true, unfollowed: Boolean(o.unfollowed),
      changing: Boolean(o.changing), unconfirmed: Boolean(o.unconfirmed) && !str(o.ref),
    };
  });
}

/** The market service not answering, as the account's holdings say it (`marketOld`, plan A2): since when (the account's ISO
 *  time) and its one sentence — the prices on Portfolio are the last the market gave; null while the market answers, or for a
 *  body that says it in no shape the face recognises (a since that is no time, no words). */
export function marketOldOf(holdingsBody) {
  const old = isRecord(holdingsBody) ? holdingsBody.marketOld : undefined;
  if (!isRecord(old) || typeof old.since !== 'string' || Number.isNaN(Date.parse(old.since))) return null;
  const message = str(old.message).trim();
  return message ? { since: old.since, message } : null;
}

/** A read's `missing` — the venues it could not reach — one sentence a venue, `Stand-in Exchange did not answer`: a venue
 *  whose stats and positions both failed is named once. */
export function missingWords(missing) {
  const words = records(missing).filter(m => typeof m.venue === 'string' && m.venue)
    .map(m => t('venues.missing', { venue: typeof m.venueName === 'string' && m.venueName ? m.venueName : m.venue }));
  return [...new Set(words)];
}

/** The Statement drawer's lines from `statement`, newest first, each in the Account's words (`by`: You, an agent approved by
 *  you or inside its limit, the paper account). */
export function statementLinesOf(statementBody) {
  return listOf(statementBody, 'lines').map(l => ({
    key: str(l.key), at: str(l.at), type: str(l.type), kind: str(l.kind), description: str(l.description),
    amountUsd: number(l.amountUsd), feeUsd: number(l.feeUsd), status: str(l.status), by: str(l.by), paper: l.paper === true,
  })).sort(newestFirst);
}

// one CSV field, RFC 4180
function field(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// a text cell a spreadsheet would run as a formula — led by =, +, -, @, a tab or a carriage return — is led by an apostrophe;
// a number (the amount, the fee) is a number and passes as it is
const inert = v => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

/** The statement's lines as RFC 4180 CSV, CRLF line ends, with the `by` column — the agents' names in it are theirs, so no text
 *  cell can run as a formula. */
export function statementCsvOf(rows) {
  const lines = ['date,type,kind,description,amount,fee,status,by'];
  for (const l of records(rows)) lines.push([l.at, l.type, l.kind, l.description, l.amountUsd, l.feeUsd, l.status, l.by].map(v => field(inert(v))).join(','));
  return lines.map(line => `${line}\r\n`).join('');
}

/** A venue's health from the page's `health[id]`: it answers when its last good read is newer than its last failure (or it
 *  never failed); it is not answering since a failure as new as that or newer; it is not read yet when neither is on record. */
function healthOf(h) {
  const okAt = stamp(h?.lastOkAt), failAt = stamp(h?.lastFailAt);
  if (okAt !== null && (failAt === null || okAt > failAt)) return { health: 'answers', healthWords: t('venues.health.answers'), since: null };
  if (failAt !== null) return { health: 'not-answering', healthWords: t('venues.health.notAnswering'), since: h.lastFailAt };
  return { health: 'not-read', healthWords: t('venues.health.notRead'), since: null };
}

/** What a venue does, in the words its row draws. `watchOnly` is not one of them: the Account sets it on every live connection
 *  (its simulated doors shut), so it is a Details fact. */
function doesOf(v) {
  const can = isRecord(v.liveCan) ? v.liveCan : {};
  return [
    v.trade?.can === true ? t('venues.does.trades') : '',
    can.transfer === true || can.withdraw === true ? t('venues.does.moves') : '',
    can.receive === true ? t('venues.does.receives') : '',
    v.earn?.can === true ? t('venues.does.earns') : '',
  ].filter(Boolean);
}

/** The Venues tab from the page's `venues`: each venue's connector, value, front line, health, what it does and what it trades
 *  (`trade.what`), the paper flag, whether it is closed to agents (`closedToAgents`, in the page's `dial.revoked`), when it was read (`stale` the Account's words where it says them), and the Details drawer's
 *  facts — the key file's path when it has one, never what is in it. */
export function venuesOf(page) {
  if (!pageOk(page)) return [];
  const health = isRecord(page.health) ? page.health : {};
  // the venues closed to agents (the page's dial.revoked): agents keep reading them, and place or move nothing there
  const revoked = new Set(isRecord(page.dial) && Array.isArray(page.dial.revoked) ? page.dial.revoked.filter(x => typeof x === 'string') : []);
  return records(page.venues).map(v => {
    const id = str(v.id);
    return {
      id, name: str(v.name), connector: str(v.connector), usd: number(v.usd), frontLine: str(v.frontLine),
      ...healthOf(Object.hasOwn(health, id) ? health[id] : undefined),
      does: doesOf(v), what: str(v.trade?.what), paper: v.paper === true, asOf: str(v.asOf), closedToAgents: id !== '' && revoked.has(id),
      tradeCan: { amend: v.trade?.amend === true, leverage: v.trade?.leverage === true, close: v.trade?.close === true },
      stale: typeof v.stale === 'string' ? v.stale : v.stale === true,
      details: {
        holdings: records(v.holdings).map(h => ({ asset: str(h.asset), amount: number(h.amount), usd: number(h.usd) })),
        noTradeBecause: str(v.noTradeBecause), restricted: str(v.restricted),
        notServed: str(v.notServed?.said), closeOnly: str(v.closeOnly?.said), watchOnly: str(v.watchOnly), keyFile: str(v.keyFile),
      },
    };
  });
}

const sameName = (a, b) => typeof a === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();
// an agent's cards waiting, and its orders still working (open, partial, pending: the rule of openOrdersOf)
const cardCount = a => records(a.cards).length;
const openCount = a => records(a.orders).filter(o => OPEN.has(o.status)).length;
// one limit as the Agents tab keys it: its id, scope and the ids it allows (End limit names them back to the Account), whether
// it has expired, and its words in one line
const limitOf = (l, perOrderUsd) => ({
  id: str(l.id), scope: str(l.scope), allow: (Array.isArray(l.allow) ? l.allow : []).filter(x => typeof x === 'string' && x !== ''),
  expired: l.expired === true, words: limitWords(l, perOrderUsd),
});
const agentRow = a => ({
  gravit: false, name: str(a.name), address: str(a.address), status: str(a.status), validUntil: str(a.validUntil),
  limits: records(a.limits).map(l => limitOf(l, l.perPaymentUsd)), cards: cardCount(a), orders: openCount(a),
});

/** The Agents tab. Gravit's row first whenever the seat view (/data/seat.json) has a standing to show: its standing and its
 *  limits in the seat box's words, and the counts the Account keeps for the seat's own agent — its cards waiting and its open
 *  orders, null while the Account's agents are not read. Then every other agent the Account lists (`agents`), each limit in
 *  the same words. The seat's own agent is the one at the seat view's address (in any case), or by name, in any case, only
 *  while the seat view carries no address (knocking: no key yet); it is left out of the list while Gravit's row stands, so
 *  Gravit is listed once, and a display name alone never hides a row an address could tell. With no seat view to stand on,
 *  the Account's list is the whole answer. The knocking keys are the page's (`requestsOf`). Every row carries its address
 *  and each limit as `{ id, scope, allow, expired, words }` — what the owner's keys name back. Gravit's row also carries the
 *  seat's status (`seatStatus`) and, while it knocks, the page's one request at the seat view's address, in any case
 *  (`request: { address, name }`); with no address on the seat view, or none or several requests there, null — a request is
 *  never bound to the seat by its name. */
export function agentsOf(agentsBody, seatView, page = null) {
  const w = seatWords(seatView);
  const read = agentsBody?.ok === true && Array.isArray(agentsBody.agents);
  const agents = read ? records(agentsBody.agents) : [];
  if (!w.seat) return agents.map(agentRow);
  const s = seatView.seat && typeof seatView.seat === 'object' ? seatView.seat : {};
  const name = typeof s.name === 'string' && s.name ? s.name : HOST_NAME;   // the name seatWords gives the seat
  const isSeat = typeof s.address === 'string' && s.address ? a => sameAddress(a.address, s.address) : a => sameName(a.name, name);
  const seats = agents.filter(isSeat);
  // the seat's knock is bound by the seat view's address alone, and only when exactly one request stands there: a name can be
  // anyone's, so a request that only shares the seat's name is never let in as Gravit
  const addr = str(s.address);
  const hits = s.status === 'knocking' && addr ? requestsOf(page).filter(r => sameAddress(r.address, addr)) : [];
  const knock = hits.length === 1 ? hits[0] : null;
  return [
    { gravit: true, name, address: addr, standing: w.seat, seatStatus: str(s.status),
      request: knock ? { address: knock.address, name: knock.name } : null,
      limits: records(s.limits).map(l => limitOf(l, l.perOrderUsd)),
      cards: read ? seats.reduce((n, a) => n + cardCount(a), 0) : null,
      orders: read ? seats.reduce((n, a) => n + openCount(a), 0) : null },
    ...agents.filter(a => !isSeat(a)).map(agentRow),
  ];
}

/** The Cards tab: the cards waiting for the owner (the page's `cards`), grouped by the agent that asked — by its address, in any
 *  case, when the card carries one, under the first name the group's cards give it; by the name the card gives otherwise — in
 *  the order the agents first appear; each card's id and hash (what its answer signs), reason, value and answer-by time, and
 *  What it asks — `shown`, every field the owner signs — as the Account sends it, a field that is not a string drawn as nothing. */
export function cardsOf(page) {
  if (!pageOk(page)) return [];
  const groups = new Map();
  for (const c of records(page.cards)) {
    const named = str(c.agentName);
    const key = typeof c.agent === 'string' && c.agent ? `agent:${c.agent.toLowerCase()}` : `name:${named || t('agents.who.unnamed')}`;
    const group = groups.get(key) ?? { agentName: '', cards: [] };
    if (!group.agentName) group.agentName = named;
    group.cards.push({
      id: str(c.id), hash: str(c.hash), reason: str(c.reason), usd: number(c.usd), expiresAt: str(c.expiresAt),
      shown: records(c.shown).map(f => ({ name: str(f.name), value: str(f.value) })),
    });
    groups.set(key, group);
  }
  return [...groups.values()].map(g => ({ agentName: g.agentName || t('agents.who.unnamed'), cards: g.cards }));
}

/** The agents' asks (the page's `asks`: a bigger budget, a venue, a session), in their words, each with what its grant is
 *  seeded from (`grantOf` in host/sheet-view.js reads a row as it reads the page's ask): the agent's address, the venue, the
 *  dollars as the Account sends them. */
export function asksOf(page) {
  if (!pageOk(page)) return [];
  return records(page.asks).map(a => ({
    id: str(a.id), agent: str(a.agent), agentName: str(a.agentName), kind: str(a.kind), venue: str(a.venue), usd: str(a.usd),
    text: str(a.text), expiresAt: str(a.expiresAt),
  }));
}

// core.js:621 — the retired page's slug, an agent wallet's venue id being `agent-<slug of its name>` (portfolio.js:23)
const slug = v => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** The agent wallets (the page's `subAccounts`): each its id, name, the agent it pays for (its address, and its name as the
 *  Account gives it), its own address, how much it keeps at most and holds (`capUsd`, `balanceUsd`; null when they do not
 *  parse), and the venue it is on the page as (`agent-<slug of its name>`, portfolio.js:23) — what Top up and Take back move to
 *  and from. */
export function walletsOf(page) {
  if (!pageOk(page)) return [];
  return records(page.subAccounts).filter(w => str(w.name)).map(w => ({
    id: str(w.id), name: w.name, agent: str(w.agent), agentName: str(w.agentName), address: str(w.address),
    capUsd: number(w.capUsd), balanceUsd: number(w.balanceUsd), venue: `agent-${slug(w.name)}`,
  }));
}

/** The keys knocking to be let in (the page's `requests`). */
export function requestsOf(page) {
  if (!pageOk(page)) return [];
  return records(page.requests).map(r => ({ address: str(r.address), name: str(r.name), at: str(r.at) }));
}

// ── the connect sheet's reads (plan 2 Task 8) ──

const strings = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x !== '') : []);

/** What the connect sheet offers (its seed's `options`): the page's `connectLive.options`, each with where this account can
 *  connect it — the verdict, the venue's own words when it is not connectable (`said`) and its group, from the venues read
 *  (`/data/account/venues`, joined by connector; an option it does not name, or a venues read not landed, keeps
 *  `verdict: null`). Every kind connects here — a key file, an address (a browser wallet's among them), a venue's sign-in, a
 *  command line — by what it `needs`. In the Account's order; the paper account among them (its own sheet leaves it out). */
export function connectOptionsOf(page, venuesHere) {
  if (!pageOk(page)) return [];
  const here = new Map(listOf(venuesHere, 'venues').filter(v => typeof v.connector === 'string').map(v => [v.connector, v]));
  return records(page.connectLive.options).filter(o => typeof o.connector === 'string' && o.connector !== '').map(o => {
    const v = here.get(o.connector);
    return {
      connector: o.connector, label: str(o.label), needs: str(o.needs), example: str(o.example), defaultRef: str(o.defaultRef),
      venues: strings(o.venues), kind: str(o.kind),
      verdict: v && typeof v.verdict === 'string' ? v.verdict : null, said: str(v?.said), group: str(v?.group),
    };
  });
}

/** The paper books kept on the Account's disk and not connected (`/data/account/paper/books`), each by its venue id — the
 *  paper sheet's seed `books`: a book without one is left out. Amounts and counts numeric, null when they do not parse. */
export function paperBooksOf(body) {
  return listOf(body, 'books').filter(b => typeof b.venue === 'string' && b.venue !== '').map(b => ({
    venue: b.venue, name: str(b.name), cashUsd: number(b.cashUsd), startCashUsd: number(b.startCashUsd), addedUsd: number(b.addedUsd),
    createdAt: str(b.createdAt), updatedAt: str(b.updatedAt), holdings: number(b.holdings), positions: number(b.positions), open: number(b.open),
  }));
}

/** A key file's check (`/data/account/keyfile`) in the words the connect sheet draws from: whether it is ready, the file's
 *  path, the field names it lacks, the Account's sentence — names and a path only, never what the file holds. */
export function keyfileWords(body) {
  if (body?.ok !== true) return { ready: false, path: '', missing: [], message: '' };
  return { ready: body.ready === true, path: str(body.path), missing: strings(body.missing), message: str(body.message) };
}
