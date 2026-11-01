// The Account screen's pure views (spec 2026-10-22 §6.2) over the Account's own payloads as the face proxies them — the page
// (/data/account), holdings?cost=1 and its paper lens, history, statement and agents, read from the stand-in's fixtures
// (tests/fixtures/account/) — and the seat box's words over /data/seat.json (spec 2026-10-20 §6.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  seatWords,
  pageOk, headOf, worthOf, changeOf, assetsOf, positionsOf, openOrdersOf, orderRowsOf, missingWords, statementLinesOf, statementCsvOf,
  venuesOf, agentsOf, cardsOf, asksOf, requestsOf, connectOptionsOf, paperBooksOf, keyfileWords, writesOn, walletsOf,
} from '../../client/js/host/account-view.js';
import { grantOf, fieldsOf, draftOf, keyfileAskOf, reachAskOf, connectCheckOf } from '../../client/js/host/sheet-view.js';

// a fixture of the stand-in's answers, parsed afresh for every call so no test sees another's copy
const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));

// spec 2026-10-20 §6.3: the Account seat's standing (/data/seat.json) in the words the Venues box draws
const seatView = (over = {}) => ({
  ok: true, url: 'http://127.0.0.1:4820', reachable: true, asOf: '2026-10-19T18:40:00.000Z', mode: 'guard', writes: { on: true, capUsd: 100 }, cardMinutes: 30,
  seat: { name: 'Gravit', status: 'admitted', address: '0xab12', validUntil: new Date(2026, 10, 19).getTime(), limits: [{ scope: 'trade', allow: ['paper-1'], perOrderUsd: 100, budgetUsd: 1000, spentUsd: 100, reservedUsd: 50, leftUsd: 850, validUntil: 1, expired: false }] },
  venues: [{ id: 'paper-1', name: 'Paper account · paper', paper: true, usd: 10000 }, { id: 'okx', name: 'OKX', paper: false, usd: 0, stale: true, notServed: 'OKX does not serve this location' }],
  cards: [{ id: 'card-7', usd: 56 }, { id: 'card-9', usd: 12 }], others: 1, ...over,
});

test('seatWords: nothing read, not reachable, and every standing in its words', () => {
  assert.deepEqual(seatWords(null), { service: '', mode: '', writes: '', seat: '', limits: [], venues: [], cards: '', url: '' });
  const off = seatWords({ ok: true, url: 'http://127.0.0.1:4820', reachable: false, error: 'ECONNREFUSED' });
  assert.equal(off.service, '127.0.0.1:4820 · not reachable'); assert.equal(off.seat, ''); assert.equal(off.mode, ''); assert.equal(off.url, 'http://127.0.0.1:4820');
  const on = seatWords(seatView());
  assert.equal(on.service, '127.0.0.1:4820 · reachable'); assert.equal(on.mode, 'Guard'); assert.equal(on.writes, 'Trading on · $100 a move');
  assert.equal(on.seat, 'Gravit · admitted until Nov 19');
  assert.deepEqual(on.limits, ['trade · paper-1 · $100 an order · $850 of $1,000 left']);
  assert.deepEqual(on.venues, [{ id: 'paper-1', name: 'Paper account · paper', paper: true, usd: '$10,000', note: '' }, { id: 'okx', name: 'OKX', paper: false, usd: '$0', note: 'OKX does not serve this location' }]);
  assert.equal(on.cards, '2 cards waiting'); assert.equal(on.url, 'http://127.0.0.1:4820');
  const standing = status => seatWords(seatView({ seat: { name: 'Gravit', status, limits: [] } })).seat;
  assert.equal(standing('knocking'), 'Gravit · knocking — let it in under Account › Agents');
  assert.equal(standing('absent'), 'Gravit · not on the account');
  assert.equal(standing('expired'), 'Gravit · expired');
  assert.equal(standing('revoked'), 'Gravit · revoked');
  assert.equal(standing('unknown'), 'Gravit · on the account · standing unknown');
  assert.equal(seatWords(seatView({ cards: [{ id: 'c', usd: 1 }] })).cards, '1 card waiting');
  assert.equal(seatWords(seatView({ cards: [] })).cards, '');
  assert.equal(seatWords(seatView({ mode: 'open' })).mode, 'Beast');
  assert.equal(seatWords(seatView({ writes: { on: false, capUsd: null } })).writes, 'Read-only');
  const lim = l => seatWords(seatView({ seat: { name: 'Gravit', status: 'admitted', limits: [l] } })).limits[0];
  assert.equal(lim({ scope: 'trade', allow: ['paper-1'], perOrderUsd: 100, budgetUsd: 1000, spentUsd: 0, reservedUsd: 0, leftUsd: 1000, validUntil: 1, expired: true }), 'trade · paper-1 · $100 an order · $1,000 of $1,000 left · expired');
  assert.equal(lim({ scope: 'trade', allow: ['paper-1', 'ex'], perOrderUsd: 100, budgetUsd: null, spentUsd: 0, reservedUsd: 0, leftUsd: null, validUntil: null, expired: false }), 'trade · paper-1, ex · $100 an order');
  assert.deepEqual(seatWords(seatView({ venues: [{ id: 'v', name: '', paper: false, usd: null, stale: true }] })).venues, [{ id: 'v', name: 'v', paper: false, usd: '', note: 'stale' }]);
});

test('seatWords: a disabled seat row says so, and nothing else', () => {
  const off = seatWords({ ok: true, url: 'http://127.0.0.1:4820', reachable: false, error: 'disabled' });
  assert.equal(off.service, '127.0.0.1:4820 · seat disabled'); assert.equal(off.seat, ''); assert.deepEqual(off.venues, []); assert.equal(off.url, 'http://127.0.0.1:4820');
});

// ── the Account's own payloads (spec 2026-10-22 §6.2), over the stand-in's fixtures ──

test('pageOk: the fixture is a page; a body missing venues, cards, signers or connectLive is not', () => {
  const page = fx('account');
  assert.equal(pageOk(page), true);
  for (const key of ['venues', 'cards', 'orders', 'signers', 'connectLive']) {
    const { [key]: _gone, ...rest } = page;
    assert.equal(pageOk(rest), false, `without ${key}`);
  }
  assert.equal(pageOk({ ...page, venues: {} }), false, 'venues that are not a list');
  assert.equal(pageOk({ ...page, ok: false }), false);
  assert.equal(pageOk({ ...page, ok: 'true' }), false);
  assert.equal(pageOk({ ok: false, refusal: { code: 'E_ACCOUNT_BAD_ACTION', message: 'no' } }), false);
  assert.equal(pageOk(null), false); assert.equal(pageOk(undefined), false); assert.equal(pageOk('page'), false);
});

test('writesOn: on for a page whose writes are on; off for a read-only page and one the face does not recognise', () => {
  const page = fx('account');
  assert.equal(writesOn(page), true);
  assert.equal(writesOn({ ...page, connectLive: { ...page.connectLive, writes: { on: false } } }), false, 'read-only');
  assert.equal(writesOn({ ...page, connectLive: {} }), false, 'no writes said');
  assert.equal(writesOn({ ok: true, connectLive: { writes: { on: true } } }), false, 'unrecognised');
  assert.equal(writesOn(null), false);
});

test('headOf: guard + writes on → Guard, Trading on · $250 a move; open → Beast; writes off → Read-only', () => {
  const page = fx('account');   // the stand-in: mode guard, connectLive.writes { on: true, capUsd: 250 }
  assert.deepEqual(headOf(page), { mode: 'Guard', writes: 'Trading on · $250 a move' });
  assert.equal(headOf({ ...page, mode: 'open' }).mode, 'Beast');
  assert.equal(headOf({ ...page, mode: 'beast' }).mode, '', 'only the wire values');
  const writes = w => headOf({ ...page, connectLive: { ...page.connectLive, writes: w } }).writes;
  assert.equal(writes({ on: false, capUsd: 250, turnOn: 'npm run account' }), 'Read-only');
  assert.equal(writes({ on: true, capUsd: 1000, turnOn: 'npm run account' }), 'Trading on · $1,000 a move');
  assert.equal(writes({ on: true, capUsd: 'n/a' }), 'Trading on');
  assert.equal(writes(undefined), '');
  assert.deepEqual(headOf({ ...page, mode: undefined, connectLive: { home: '/x', options: [] } }), { mode: '', writes: '' });
});

test('worthOf: real money leads when totalUsd > 0; with totalUsd 0 and a paper venue, Paper leads and real is second', () => {
  const page = fx('account'), holdings = fx('holdings'), paper = fx('holdings-paper');   // 29,138.10 real; 25,400 paper
  assert.deepEqual(worthOf(page, holdings, paper), { lead: { label: 'Net worth', usd: 29138.1 }, second: { label: 'Paper', usd: 25400 }, paperLeads: false });
  const zero = { ...page, totalUsd: 0 };
  assert.deepEqual(worthOf(zero, holdings, paper), { lead: { label: 'Paper', usd: 25400 }, second: { label: 'Net worth', usd: 0 }, paperLeads: true });
  assert.deepEqual(worthOf({ ...page, totalUsd: 'n/a' }, holdings, paper), { lead: { label: 'Paper', usd: 25400 }, second: null, paperLeads: true }, 'a real total that does not parse is no figure');
  assert.deepEqual(worthOf(zero, holdings, null), { lead: { label: 'Net worth', usd: 0 }, second: null, paperLeads: false }, 'the paper lens not read yet');
  assert.deepEqual(worthOf(zero, holdings, { ok: true, paper: true, rows: [] }), { lead: { label: 'Net worth', usd: 0 }, second: null, paperLeads: false }, 'a paper lens without a total');
  const realOnly = page.venues.filter(v => v.paper !== true);
  assert.deepEqual(worthOf({ ...zero, venues: realOnly }, holdings, paper), { lead: { label: 'Net worth', usd: 0 }, second: null, paperLeads: false }, 'no paper venue connected');
  assert.deepEqual(worthOf({ ...page, venues: realOnly }, holdings, paper), { lead: { label: 'Net worth', usd: 29138.1 }, second: null, paperLeads: false });
});

test('changeOf: usd, pct, partial, first; nulls when the history is missing', () => {
  assert.deepEqual(changeOf(fx('history')), { usd: 208.78, pct: 0.72, partial: false, first: '2026-10-15T07:35:46.850Z', sinceStartUsd: null, rebuilt: false });
  assert.deepEqual(changeOf(fx('history-paper')), { usd: 0, pct: 0, partial: false, first: '2026-10-22T07:35:46.786Z', sinceStartUsd: null, rebuilt: true },
    'a flat curve is 0, not nothing; the paper curve says it was rebuilt from the book');
  assert.equal(changeOf({ ...fx('history'), partial: true }).partial, true);
  assert.equal(changeOf({ ...fx('history-paper'), startUsd: 25000, sinceStartUsd: 400 }).sinceStartUsd, 400);
  const none = { usd: null, pct: null, partial: false, first: null, sinceStartUsd: null, rebuilt: false };
  assert.deepEqual(changeOf(null), none); assert.deepEqual(changeOf(undefined), none); assert.deepEqual(changeOf('history'), none);
  assert.deepEqual(changeOf({ ok: true, changeUsd: 'n/a', changePct: Infinity, partial: 'yes', first: 7, sinceStartUsd: 'n/a', rebuilt: 'yes' }), none);
});

test('assetsOf and positionsOf: the fixture rows in order, amounts numeric, a row without usd is null', () => {
  const holdings = fx('holdings');
  const assets = assetsOf(holdings);
  assert.deepEqual(assets.map(a => a.key), ['crypto:BTC', 'stable:USDT', 'crypto:ETH', 'crypto:SOL', 'cash:USD', 'rwa:USDY', 'stable:USDC', 'equity:AAPL', 'equity:NVDA', 'earn:ex:flex:USDT']);
  assert.deepEqual(assets[0], {
    key: 'crypto:BTC', asset: 'BTC', cls: 'crypto', amount: 0.124, usd: 7747.4, price: 62479.03226, changePct24h: 2.3,
    venues: [{ venue: 'ex', venueName: 'Stand-in Exchange', amount: 0.12, usd: 7497.6, stale: false, product: '' }, { venue: 'wallet', venueName: 'Stand-in Wallet', amount: 0.004, usd: 249.8, stale: false, product: '' }],
    earn: null,
  });
  assert.equal(assets[1].changePct24h, null, 'USDT carries no 24h change');
  assert.equal(assets[9].cls, 'earn');
  assert.deepEqual(assets[9].earn, { venue: 'ex', product: 'flex:USDT' }, 'an Earning row names its product (plan 4b Task 3)');
  const hand = assetsOf({ ok: true, rows: [
    { key: 'a', asset: 'A', class: 'crypto', amount: 1, usd: 5, venues: [{ venue: 'ex', venueName: 'Ex', amount: 1, usd: 5, stale: true }] },
    { key: 'b', asset: 'B', class: 'crypto', amount: 2, venues: [] },
    { key: 'c', asset: 'C', class: 'equity', amount: '3', usd: '10', price: 'n/a' },
    { key: 'd', asset: 'D', class: 'rwa', amount: 4, usd: 'n/a' },
  ] });
  assert.deepEqual(hand.map(a => [a.key, a.usd]), [['c', 10], ['a', 5], ['b', null], ['d', null]], 'largest first, the unpriced last');
  assert.equal(hand[0].amount, 3); assert.equal(hand[0].price, null); assert.deepEqual(hand[0].venues, []);
  assert.equal(hand[1].venues[0].stale, true);

  const positions = positionsOf(holdings);
  assert.deepEqual(positions.map(p => p.symbol), ['BTC/USDT:USDT', 'ETH/USDT:USDT', 'SI-FEDCUT-DEC:YES']);
  assert.deepEqual(positions[0], { venue: 'ex', venueName: 'Stand-in Exchange', symbol: 'BTC/USDT:USDT', name: 'BTC perpetual', side: 'long', qty: 0.01, entryPrice: 60520, markPrice: 62498.8, usd: 624.99, unrealizedUsd: 19.79, paper: false, kind: 'perp', leverage: 3 });
  assert.equal(positions[2].unrealizedUsd, -0.5);
  assert.deepEqual(positionsOf(fx('holdings-paper')), []);
  assert.deepEqual(positionsOf({ ok: true, positions: [{ venue: 'paper-1', symbol: 'ETH/USD:USD', side: 'short', qty: 2, paper: true }] }), [
    { venue: 'paper-1', venueName: '', symbol: 'ETH/USD:USD', name: '', side: 'short', qty: 2, entryPrice: null, markPrice: null, usd: null, unrealizedUsd: null, paper: true, kind: '', leverage: null },
  ]);

  // the same read's third list, `missing`: the venues it could not reach, one sentence a venue
  assert.deepEqual(missingWords(holdings.missing), []);
  assert.deepEqual(missingWords([
    { venue: 'ex', venueName: 'Stand-in Exchange', why: 'no answer in 4 s', part: 'stats' },
    { venue: 'ex', venueName: 'Stand-in Exchange', why: 'no answer in 4 s', part: 'positions' },
    { venue: 'kalshi', why: 'E_VENUE_GEOBLOCKED' },
    { venueName: 'No id' }, { venue: '' }, null,
  ]), ['Stand-in Exchange did not answer', 'kalshi did not answer']);
});

test('openOrdersOf: only open, partial and pending; who is You or the agent name', () => {
  const page = fx('account');
  const open = openOrdersOf(page);
  assert.deepEqual(open.map(o => [o.id, o.status, o.who]), [
    ['ord-0010', 'open', 'Agent · Claude Code'], ['ord-0009', 'pending', 'You'], ['ord-0004', 'open', 'You'], ['ord-0003', 'open', 'You'], ['ord-0002', 'open', 'You'],
  ], "an agent's order is named through the page's keys by its agent address");
  assert.deepEqual(open[1], { id: 'ord-0009', venue: 'broker', venueName: 'Stand-in Broker', symbol: 'SPY', side: 'buy', type: 'limit', qty: 0.25, filledQty: 0, limitPrice: 660.07, status: 'pending', kind: 'stock', stopPrice: null, base: 'SPY', who: 'You', paper: false, waitingForWallet: false, canceling: false, unfollowed: false, changing: false, unconfirmed: false });
  assert.equal(open[2].type, 'stop'); assert.equal(open[2].limitPrice, null, 'a stop carries no limit price');
  assert.deepEqual([open[2].kind, open[2].stopPrice, open[2].base], ['spot', 137.83, 'SOL'], "a stop's own price, the market's kind and base");
  const hand = openOrdersOf({ ...page,
    keys: [...page.keys, { address: '0xAB12', name: 'Gravit', status: 'ok' }, { address: '0xc0de', name: '', status: 'ok' }],
    orders: [
      { id: 'p1', status: 'partial', authority: 'agent', agent: '0xab12', venue: 'paper-1', qty: 2, filledQty: '0.5', paper: true },
      { id: 'p2', status: 'open', authority: 'agent', agent: '0xdead', agentName: 'Claude Code' },
      { id: 'p3', status: 'pending', authority: 'agent', agent: '0xC0DE' },
      { id: 'p4', status: 'open', authority: 'owner', agent: '0xab12' },
      { id: 'p5', status: 'open' },
      ...['filled', 'canceled', 'rejected', 'expired', 'waiting for wallet', undefined].map((status, i) => ({ id: `x${i}`, status, authority: 'owner' })),
    ] });
  // the key at the order's address in any case names it; no key, or a nameless one, is An agent (an order's own agentName is not taken)
  assert.deepEqual(hand.map(o => [o.kind, o.stopPrice, o.base]).slice(0, 2), [['', null, ''], ['', null, '']], 'absent ones blank or null');
  assert.deepEqual(hand.map(o => [o.id, o.who, o.paper, o.filledQty]), [
    ['p1', 'Agent · Gravit', true, 0.5], ['p2', 'An agent', false, null], ['p3', 'An agent', false, null], ['p4', 'You', false, null], ['p5', 'An agent', false, null],
  ]);
});

test("orderRowsOf carries what keeps an order from being changed: waiting for a wallet, canceling, unfollowed, a change unconfirmed", () => {
  const flags = o => { const [r] = orderRowsOf([{ id: 'o', status: 'open', authority: 'owner', ...o }], []); return [r.waitingForWallet, r.canceling, r.unfollowed, r.changing, r.unconfirmed]; };
  assert.deepEqual(flags({}), [false, false, false, false, false]);
  assert.deepEqual(flags({ walletTxs: [{ to: '0x1' }] }), [true, false, false, false, false], 'transactions and no ref: the wallet has not sent it');
  assert.deepEqual(flags({ walletTxs: [{ to: '0x1' }], ref: 'v-1' }), [false, false, false, false, false], 'sent, so followed');
  assert.deepEqual(flags({ canceling: true }), [false, true, false, false, false]);
  assert.deepEqual(flags({ unfollowed: true }), [false, false, true, false, false]);
  assert.deepEqual(flags({ changing: { qty: 2 } }), [false, false, false, true, false]);
  assert.deepEqual(flags({ unconfirmed: true }), [false, false, false, false, true], 'not yet found at the venue');
  assert.deepEqual(flags({ unconfirmed: true, ref: 'v-1' }), [false, false, false, false, false], 'found: it has a ref');
  assert.deepEqual(flags({ canceling: 'yes', unfollowed: 0 }), [false, false, false, false, false], 'only what the Account says plainly');
});

test('statementLinesOf and statementCsvOf: newest first; the CSV header and a quoted description', () => {
  const statement = fx('statement');
  const keys = statement.lines.map(l => l.key);
  const lines = statementLinesOf(statement);
  assert.deepEqual(lines.map(l => l.key), keys, 'the Account sends them newest first');
  assert.deepEqual(statementLinesOf({ ok: true, lines: [...statement.lines].reverse() }).map(l => l.key), keys, 'and they are drawn so whatever the order');
  assert.deepEqual(lines[0], { key: 'order:d22725bed586b5e46850da6bd3208923', at: '2026-10-22T07:35:46.827Z', type: 'trade', kind: 'buy', description: 'Buy 0.707 SOL · SOL / USDT · limit 141.44', amountUsd: 0, feeUsd: null, status: 'open', by: 'Claude Code, inside its limit', paper: false });
  const filled = lines.find(l => l.key === 'order:726571125e42799be6620d52189cd5c5');
  assert.equal(filled.amountUsd, -49.17); assert.equal(filled.feeUsd, 0.1475);
  const odd = statementLinesOf({ ok: true, lines: [{ key: 'late', at: 'not a time', paper: true }, ...statement.lines.slice(0, 2)] });
  assert.deepEqual(odd.map(l => l.key), [keys[0], keys[1], 'late'], 'a time that does not parse sorts last');
  assert.equal(odd[2].paper, true); assert.equal(odd[2].amountUsd, null);

  const header = 'date,type,kind,description,amount,fee,status,by\r\n';
  assert.equal(statementCsvOf(lines.slice(0, 2)), header +
    '2026-10-22T07:35:46.827Z,trade,buy,Buy 0.707 SOL · SOL / USDT · limit 141.44,0,,open,"Claude Code, inside its limit"\r\n' +
    '2026-10-22T07:35:46.821Z,earn,supply,Supply 150 USDT · USDT · Flexible (stand-in) · 4.6% APY,150,,pending,You\r\n');
  const csv = statementCsvOf(lines).split('\r\n');
  assert.equal(csv.length, 14, 'the header, the twelve lines and the end of the last');
  assert.ok(csv.includes('2026-10-22T07:35:46.806Z,trade,buy,"Buy 0.001 BTC · BTC / USDT · limit 59,352.9",0,,canceled,You'), 'a price grouped with a comma is quoted');
  assert.equal(statementCsvOf([{ at: '2026-10-22T07:00:00.000Z', type: 'trade', kind: 'buy', description: 'Buy 1 "BRK.B"', amountUsd: -500, feeUsd: null, status: 'filled', by: 'You' }]),
    `${header}2026-10-22T07:00:00.000Z,trade,buy,"Buy 1 ""BRK.B""",-500,,filled,You\r\n`);
  assert.equal(statementCsvOf([]), header);

  // a text cell a spreadsheet would run as a formula is led by an apostrophe, then quoted as any other; the amounts stay numbers
  assert.equal(statementCsvOf([{ at: '2026-10-22T07:00:00.000Z', type: 'transfer', kind: 'pay', description: '-5 USDC withheld · fee', amountUsd: -49.17, feeUsd: 0.5, status: 'settled',
    by: '=HYPERLINK("https://example.com","Claude Code"), inside its limit' }]),
  `${header}2026-10-22T07:00:00.000Z,transfer,pay,'-5 USDC withheld · fee,-49.17,0.5,settled,"'=HYPERLINK(""https://example.com"",""Claude Code""), inside its limit"\r\n`);
  for (const [text, cell] of [['+1', "'+1"], ['@SUM(A1)', "'@SUM(A1)"], ['\tx', "'\tx"], ['\rx', `"'\rx"`], ['a-b', 'a-b']]) {
    assert.equal(statementCsvOf([{ status: text }]), `${header},,,,,,${cell},\r\n`, JSON.stringify(text));
  }
});

test('venuesOf marks a venue in dial.revoked', () => {
  const page = fx('account');
  assert.ok(venuesOf(page).every(v => v.closedToAgents === false), 'none closed on the stand-in');
  const closed = venuesOf({ ...page, dial: { ...page.dial, revoked: ['ex', 7, 'gone'] } });
  assert.deepEqual(closed.filter(v => v.closedToAgents).map(v => v.id), ['ex'], 'only a venue on the page, by its id');
  assert.ok(venuesOf({ ...page, dial: undefined }).every(v => v.closedToAgents === false), 'no dial: none closed');
  assert.ok(venuesOf({ ...page, dial: { revoked: 'ex' } }).every(v => v.closedToAgents === false), 'a list only');
});

test('venuesOf: health from lastOkAt/lastFailAt; does words; the paper flag; details without a key value', () => {
  const page = fx('account');
  const venues = venuesOf(page);
  assert.deepEqual(venues.map(v => [v.id, v.health, v.paper]), [
    ['broker', 'not-read', false], ['ex', 'answers', false], ['paper', 'not-read', true], ['paper-momentum', 'not-read', true],
    ['agent-claude-code', 'not-read', false], ['wallet', 'not-read', false], ['predict', 'not-read', false],
  ]);
  const { details, ...ex } = venues[1];
  assert.deepEqual(ex, { id: 'ex', name: 'Stand-in Exchange', connector: 'live:standin-exchange', usd: 21638.93, frontLine: 'Exchange', health: 'answers', healthWords: 'Answers', since: null, does: ['Trades', 'Moves money', 'Earns'], what: 'spot and perpetuals', paper: false, asOf: '2026-10-22T07:35:46.781Z', closedToAgents: false, stale: false, tradeCan: { amend: true, leverage: true, close: false } });
  assert.equal(details.holdings.length, 7);
  assert.deepEqual(details.holdings[0], { asset: 'BTC', amount: 0.12, usd: 7497.6 });
  assert.deepEqual({ ...details, holdings: [] }, { holdings: [], noTradeBecause: '', restricted: '', notServed: '', closeOnly: '', watchOnly: 'Live · read-only', keyFile: '' });
  assert.equal(venues[0].healthWords, 'Not read yet');
  // what the venue's trading does beyond an order: each flag the Account's own, true only when it says true
  assert.deepEqual(venues.map(v => v.tradeCan), [
    { amend: false, leverage: false, close: false }, { amend: true, leverage: true, close: false }, { amend: true, leverage: true, close: false },
    { amend: true, leverage: true, close: true }, { amend: false, leverage: false, close: false }, { amend: false, leverage: false, close: false },
    { amend: true, leverage: false, close: false },
  ]);
  // what each does, and what it trades; watchOnly — "Live · read-only", on every live connection — is a Details fact, not a thing it does
  assert.deepEqual(venues.map(v => v.does), [['Trades'], ['Trades', 'Moves money', 'Earns'], ['Trades'], ['Trades'], ['Receives'], ['Trades'], ['Trades']]);
  assert.deepEqual(venues.map(v => v.what), ['US stocks and ETFs', 'spot and perpetuals', 'perpetuals',
    'paper trading in the public markets: US stocks, coins, perpetuals with leverage, tokenised shares, event contracts', '', 'tokens, swapped from this wallet', 'event contracts']);
  assert.equal(venues[4].details.noTradeBecause, 'An agent wallet pays for things; agents trade at the venues it funds.');

  // health: the newer of the last good read and the last failure
  const health = h => venuesOf({ ...page, health: { broker: h } })[0];
  const failed = health({ lastOkAt: '2026-10-22T07:00:00.000Z', lastFailAt: '2026-10-22T07:30:00.000Z', code: 'E_VENUE_TIMEOUT', message: 'no answer' });
  assert.deepEqual([failed.health, failed.healthWords, failed.since], ['not-answering', 'Not answering', '2026-10-22T07:30:00.000Z']);
  assert.equal(health({ lastOkAt: '2026-10-22T07:30:00.000Z', lastFailAt: '2026-10-22T07:00:00.000Z' }).health, 'answers');
  assert.equal(health({ lastFailAt: '2026-10-22T07:00:00.000Z' }).health, 'not-answering');
  assert.equal(health({ lastOkAt: '2026-10-22T07:00:00.000Z', lastFailAt: '2026-10-22T07:00:00.000Z' }).health, 'not-answering', 'a failure as new as the last good read');
  assert.equal(health({ lastOkAt: 'garbled' }).health, 'not-read');
  assert.equal(health({ ms: 12 }).since, null);

  // stale in the Account's words where it says them; the details' facts; a key file is its path, never what is in it
  const hand = venuesOf({ ...page, venues: [
    { id: 'kalshi', name: 'Kalshi', usd: 'n/a', stale: 'the venue said 429', keyFile: 'credentials/kalshi/api-key.json', restricted: 'not for US persons',
      notServed: { said: 'Kalshi does not serve this location' }, closeOnly: { said: 'sells and closes only' }, trade: { can: 'unknown' }, earn: { can: false } },
    { id: 'okx', name: 'OKX', stale: true, keyFile: { apiKey: 'SECRET-KEY', secret: 'SECRET-VALUE' }, liveCan: { withdraw: true } },
  ] });
  assert.equal(hand[0].usd, null); assert.equal(hand[0].stale, 'the venue said 429'); assert.deepEqual(hand[0].does, []);
  assert.deepEqual(hand[0].details, { holdings: [], noTradeBecause: '', restricted: 'not for US persons', notServed: 'Kalshi does not serve this location', closeOnly: 'sells and closes only', watchOnly: '', keyFile: 'credentials/kalshi/api-key.json' });
  assert.equal(hand[1].stale, true); assert.deepEqual(hand[1].does, ['Moves money']); assert.equal(hand[1].details.keyFile, '');
  assert.ok(!JSON.stringify(hand).includes('SECRET'), 'no key value travels');
});

test('agentsOf: Gravit first from the seat view, then the Account agents with their limit words', () => {
  const agents = fx('agents');
  // Gravit's row: the seat view's standing and limits; the counts are the Account's for the seat's agent — null while its agents are not read
  const gravit = (cards, orders) => ({ gravit: true, name: 'Gravit', address: '0xab12', standing: 'Gravit · admitted until Nov 19', seatStatus: 'admitted', request: null,
    limits: [{ id: '', scope: 'trade', allow: ['paper-1'], expired: false, words: 'trade · paper-1 · $100 an order · $850 of $1,000 left' }], cards, orders });
  const claude = { gravit: false, name: 'Claude Code', address: '0x3a087530887bd175ccc38828ee3776e5b6ea1ac6', status: 'ok', validUntil: '2026-11-21T07:35:46.778Z', limits: [
    { id: 'spend-0001', scope: 'trade', allow: ['ex', 'predict', 'wallet'], expired: false, words: 'trade · ex, predict, wallet · $150 an order · $380.01 of $600 left' },
    { id: 'spend-0003', scope: 'venues', allow: ['ex', 'agent-claude-code'], expired: false, words: 'venues · ex, agent-claude-code · $50 an order · $200 of $200 left' },
    { id: 'spend-0004', scope: 'payees', allow: ['api.example.com'], expired: false, words: 'payees · api.example.com · $2 an order · $20 of $20 left' },
  ], cards: 1, orders: 1 };
  assert.deepEqual(agentsOf(agents, seatView()), [gravit(0, 0), claude], 'the stand-in lists no agent at the seat address');

  // the Account's own row for the seat is the agent at the seat view's address, in any case: left out, its cards and its open orders
  // counted on Gravit's row; while the seat view carries an address, a name alone hides nothing
  const seatAgent = { address: '0xAB12', name: 'Gravit', status: 'ok', limits: [], cards: [{ id: 'card-7' }, { id: 'card-9' }],
    orders: ['open', 'filled', 'partial', 'canceled', 'pending'].map((status, i) => ({ id: `g${i}`, status })) };
  const more = { ...agents, agents: [...agents.agents, seatAgent,
    { address: '0x01d', name: ' gravit ', status: 'expired', limits: [], cards: [], orders: [{ id: 'old', status: 'open' }] },
    { address: '0x9a5', name: 'Gravitas', status: 'ok', validUntil: '2026-11-01T00:00:00.000Z', limits: [{ scope: 'trade', allow: ['ex'], perPaymentUsd: 100, budgetUsd: 1000, leftUsd: 1000, expired: true }], cards: [], orders: [] },
  ] };
  const listed = agentsOf(more, seatView());
  assert.deepEqual(listed.map(a => [a.name, a.gravit, a.cards, a.orders]), [['Gravit', true, 2, 3], ['Claude Code', false, 1, 1], [' gravit ', false, 0, 1], ['Gravitas', false, 0, 0]]);
  assert.deepEqual(listed[3].limits, [{ id: '', scope: 'trade', allow: ['ex'], expired: true, words: 'trade · ex · $100 an order · $1,000 of $1,000 left · expired' }]);
  // with no address on the seat view (knocking: no key yet), the seat's agents are found by name, in any case, and all counted
  const knocking = agentsOf(more, seatView({ seat: { name: 'Gravit', status: 'knocking', limits: [] } }));
  assert.deepEqual(knocking.map(a => [a.name, a.gravit, a.cards, a.orders]), [['Gravit', true, 2, 4], ['Claude Code', false, 1, 1], ['Gravitas', false, 0, 0]]);
  assert.equal(knocking[0].standing, 'Gravit · knocking — let it in under Account › Agents');
  // the seat's name is the seat view's
  const scout = agentsOf({ ...agents, agents: [{ name: 'SCOUT', status: 'ok' }, { name: 'Gravit', status: 'ok' }] }, seatView({ seat: { name: 'Scout', status: 'admitted', limits: [] } }));
  assert.deepEqual(scout.map(a => [a.name, a.gravit, a.standing ?? a.status]), [['Scout', true, 'Scout · admitted'], ['Gravit', false, 'ok']]);

  // a limit: an amount that is not there is no clause, never $0; a scope or an allowed id that is not a string is no word
  const probe = agentsOf({ ok: true, agents: [{ name: 'Probe', status: 'ok', limits: [
    { scope: 'trade', allow: ['ex'], perPaymentUsd: 100, budgetUsd: 1000 },
    { scope: 'trade', allow: ['ex'], perPaymentUsd: 100, budgetUsd: '1000', leftUsd: '250.5' },
    { scope: 5, allow: ['ex', 7, null, 'wallet'], perPaymentUsd: 10, budgetUsd: 20, leftUsd: 20 },
  ] }] }, null);
  assert.deepEqual(probe[0].limits.map(l => l.words), ['trade · ex · $100 an order', 'trade · ex · $100 an order · $250.5 of $1,000 left', 'ex, wallet · $10 an order · $20 of $20 left']);
  assert.deepEqual(probe[0].limits[2], { id: '', scope: '', allow: ['ex', 'wallet'], expired: false, words: 'ex, wallet · $10 an order · $20 of $20 left' }, 'a scope or an id that is not a string is blank');
  const seatLimit = { scope: 'trade', allow: ['paper-1'], perOrderUsd: 100, budgetUsd: 1000, spentUsd: 0, reservedUsd: 0, leftUsd: null, validUntil: null, expired: false };
  assert.deepEqual(agentsOf({ ok: true, agents: [] }, seatView({ seat: { name: 'Gravit', status: 'admitted', address: '0xab12', limits: [seatLimit] } }))[0].limits.map(l => l.words),
    ['trade · paper-1 · $100 an order'], 'the seat box words its limits the same way');

  // no seat view to stand on: the Account's list is the whole answer; no agents read: Gravit's row alone, its counts unknown
  const unreachable = { ok: true, url: 'http://127.0.0.1:4820', reachable: false, error: 'ECONNREFUSED' };
  assert.deepEqual(agentsOf(more, unreachable).map(a => [a.name, a.gravit]), [['Claude Code', false], ['Gravit', false], [' gravit ', false], ['Gravitas', false]]);
  assert.deepEqual(agentsOf(agents, null), [claude]);
  assert.deepEqual(agentsOf({ ok: true }, seatView()), [gravit(null, null)]);
  assert.deepEqual(agentsOf({ ok: false, error: 'no' }, null), []);
});

// plan 4b Task 5: the agent wallets, and Gravit's row while its seat knocks
test("walletsOf names each wallet's venue as the Account does", () => {
  const page = fx('account');
  assert.deepEqual(walletsOf(page), [{ id: 'sub-0002', name: 'Claude Code', agent: '0x3a087530887bd175ccc38828ee3776e5b6ea1ac6', agentName: 'Claude Code',
    address: '0x7f89224d3ad6cacd933242ba0c07e1187e3467c2', capUsd: 100, balanceUsd: 47.37, venue: 'agent-claude-code' }]);
  assert.ok(page.venues.some(v => v.id === walletsOf(page)[0].venue), 'the venue the page lists the wallet as');
  // core.js:621's slug: lower-cased, every run of other characters one dash, none at either end, 40 at most
  const named = name => walletsOf({ ...page, subAccounts: [{ name, agent: '0xa', address: '0xb', capUsd: '50', balanceUsd: 'n/a' }] })[0];
  assert.equal(named(' Research_2 -- Bot ').venue, 'agent-research-2-bot');
  assert.equal(named('x'.repeat(50)).venue, `agent-${'x'.repeat(40)}`);
  assert.deepEqual([named('a').capUsd, named('a').balanceUsd, named('a').agentName, named('a').id], [50, null, '', '']);
  // a wallet with no name is not one; a page that is not one has none
  assert.deepEqual(walletsOf({ ...page, subAccounts: [{ agent: '0xa' }, 7] }), []);
  assert.deepEqual(walletsOf({ ok: true, subAccounts: page.subAccounts }), []);
});

test("Gravit's row carries the knocking request's address", () => {
  const page = { ...fx('account'), requests: [{ address: '0xFEED', name: 'Someone', at: '2026-10-22T07:30:00.000Z' }, { address: '0xab34', name: 'gravit', at: '' }] };
  const knockingAt = address => seatView({ seat: { name: 'Gravit', status: 'knocking', ...(address ? { address } : {}), limits: [] } });
  const pick = r => [r.address, r.request];
  // the seat view's address and exactly one request there, in any case: bound, whatever name the request gives
  const [row] = agentsOf(fx('agents'), knockingAt('0xfeed'), page);
  assert.deepEqual([row.gravit, row.seatStatus, ...pick(row)], [true, 'knocking', '0xfeed', { address: '0xFEED', name: 'Someone' }]);
  // no address on the seat view: a request named as the seat is not bound, and the row has no address of its own
  assert.deepEqual(pick(agentsOf(fx('agents'), knockingAt(), page)[0]), ['', null]);
  // two requests named "gravit", no address: not bound
  const twins = { ...page, requests: [{ address: '0x01', name: 'gravit', at: '' }, { address: '0x02', name: 'Gravit', at: '' }] };
  assert.deepEqual(pick(agentsOf(fx('agents'), knockingAt(), twins)[0]), ['', null]);
  // two requests at the seat's address: not bound; none there, or no page read: not bound
  const doubled = { ...page, requests: [{ address: '0xfeed', name: 'a', at: '' }, { address: '0xFEED', name: 'b', at: '' }] };
  assert.equal(agentsOf(fx('agents'), knockingAt('0xfeed'), doubled)[0].request, null);
  assert.equal(agentsOf(fx('agents'), knockingAt('0x99'), page)[0].request, null);
  assert.equal(agentsOf(fx('agents'), knockingAt('0xfeed'))[0].request, null);
  // admitted: the seat view's address, no request bound
  const admitted = agentsOf(fx('agents'), seatView(), { ...page, requests: [{ address: '0xab12', name: 'Gravit', at: '' }] })[0];
  assert.deepEqual([admitted.seatStatus, ...pick(admitted)], ['admitted', '0xab12', null]);
});

test('cardsOf, asksOf, requestsOf: grouped by agent; shown verbatim', () => {
  const page = fx('account');
  const [group, ...others] = cardsOf(page);
  assert.deepEqual(others, []);
  assert.equal(group.agentName, 'Claude Code');
  assert.deepEqual(group.cards, [{ id: 'card-0001', hash: '0xa20b26adc1422adf86d72b98ed4c100345421896b7a3cefe085a618a396f8c9c',
    reason: 'Claude Code asks to buy 0.0479 ETH at Stand-in Exchange · market · about $117.63', usd: 119.99, expiresAt: '2026-10-22T08:05:46.830Z', shown: page.cards[0].shown }]);
  assert.equal(group.cards[0].hash, page.cards[0].hash, 'the hash the card is answered by, the page\'s own');
  assert.equal(cardsOf({ ...page, cards: [{ ...page.cards[0], hash: 7 }] })[0].cards[0].hash, '', 'a hash that is not a string is blank');
  assert.equal(group.cards[0].shown.length, 12);
  assert.deepEqual(group.cards[0].shown[9], { name: 'qty', value: '' }, 'an empty field stays, empty');

  // cards without an agent address group by name, as they are named
  const card = (id, agentName, more = {}) => ({ id, flight: 'F-1', usd: 1, reason: `card ${id}`, hash: '0x00', kind: 'agentLiveOrder', ...(agentName === undefined ? {} : { agentName }), expiresAt: '2026-10-22T08:00:00.000Z', shown: [], ...more });
  const groups = cardsOf({ ...page, cards: [card('a1', 'A'), card('b1', 'B'), card('a2', 'A'), card('x1', undefined), card('x2', ''),
    card('n1', 'N', { shown: [{ name: 'qty', value: 5 }, { name: 'reduceOnly', value: false }, { name: 7, value: null }, { name: 'leg', value: { side: 'buy' } }, { name: 'legs', value: '[{"side":"buy"}]' }] })] });
  assert.deepEqual(groups.map(g => [g.agentName, g.cards.map(c => c.id)]), [['A', ['a1', 'a2']], ['B', ['b1']], ['An agent', ['x1', 'x2']], ['N', ['n1']]]);
  // a field that is not a string draws nothing, never undefined, null or [object Object], on a card the owner signs
  assert.deepEqual(groups[3].cards[0].shown, [{ name: 'qty', value: '' }, { name: 'reduceOnly', value: '' }, { name: '', value: '' }, { name: 'leg', value: '' }, { name: 'legs', value: '[{"side":"buy"}]' }]);
  // cards with an agent address group by it, in any case, under the group's first name: one display name can be two agents
  const byAgent = cardsOf({ ...page, cards: [card('c1', undefined, { agent: '0xCCC' }), card('a1', 'Claude Code', { agent: '0xAAA' }), card('c2', 'Scout', { agent: '0xccc' }),
    card('a2', 'Claude Code (renamed)', { agent: '0xaaa' }), card('d1', 'Claude Code', { agent: '0xddd' }), card('x1', 'Claude Code')] });
  assert.deepEqual(byAgent.map(g => [g.agentName, g.cards.map(c => c.id)]), [['Scout', ['c1', 'c2']], ['Claude Code', ['a1', 'a2']], ['Claude Code', ['d1']], ['Claude Code', ['x1']]]);

  // each ask with what its grant is seeded from (grantOf reads the row as it reads the page's ask): the agent, the venue, the dollars
  const CC = '0x3a087530887bd175ccc38828ee3776e5b6ea1ac6';
  assert.deepEqual(asksOf(page), [
    { id: 'ask-0001', agent: CC, agentName: 'Claude Code', kind: 'limit', venue: 'ex', usd: '1000', text: 'Raise my trading budget to $1,000 so I can finish the SOL position you asked for', expiresAt: '2026-10-23T07:35:46.836Z' },
    { id: 'ask-0002', agent: CC, agentName: 'Claude Code', kind: 'venue', venue: 'standin-pubex', usd: '', text: 'Connect Stand-in Public Exchange: DOGE trades only there', expiresAt: '2026-10-23T07:35:46.838Z' },
  ]);
  assert.deepEqual(grantOf(asksOf(page)[0], page), grantOf(page.asks[0], page), 'the row grants as the page\'s own ask does');
  assert.deepEqual(asksOf({ ...page, asks: [{ id: 'ask-9', kind: 'limit', agent: 5, venue: null, usd: 1000 }] })[0], { id: 'ask-9', agent: '', agentName: '', kind: 'limit', venue: '', usd: '', text: '', expiresAt: '' });
  assert.deepEqual(requestsOf(page), []);
  assert.deepEqual(requestsOf({ ...page, requests: [{ address: '0xab12', name: 'Gravit', at: '2026-10-22T07:00:00.000Z' }] }), [{ address: '0xab12', name: 'Gravit', at: '2026-10-22T07:00:00.000Z' }]);
});

test("the keys' fields: an agent's address, each limit's id, scope and allow beside its words, a card's hash, an ask's grant seed", () => {
  const agents = fx('agents'), page = fx('account');
  const [gravit, claude] = agentsOf(agents, seatView());
  // Gravit's row stands on the seat view's address; the Account's agents on their own
  assert.equal(gravit.address, '0xab12');
  assert.equal(claude.address, agents.agents[0].address);
  assert.deepEqual(claude.limits.map(({ id, scope, allow }) => ({ id, scope, allow })), agents.agents[0].limits.map(({ id, scope, allow }) => ({ id, scope, allow })));
  // the trade limit's id and allow are the page's spend row's: End limit names what the Account holds
  const trade = claude.limits.find(l => l.scope === 'trade');
  const spend = page.spend.find(r => r.scope === 'trade');
  assert.deepEqual([trade.id, trade.allow], [spend.id, spend.allow]);
  assert.deepEqual(agentsOf({ ok: true, agents: [{ name: 'Nameless', address: 7, limits: [{ scope: 'trade', allow: 'ex', id: 3 }] }] }, null)[0],
    { gravit: false, name: 'Nameless', address: '', status: '', validUntil: '', limits: [{ id: '', scope: 'trade', allow: [], expired: false, words: 'trade' }], cards: 0, orders: 0 });
  // a card's hash, the one its answer signs, the page's own
  assert.equal(cardsOf(page)[0].cards[0].hash, page.cards[0].hash);
  // an ask carries what grantOf reads
  for (const [i, k] of asksOf(page).entries()) assert.deepEqual([k.agent, k.venue, k.usd], [page.asks[i].agent, page.asks[i].venue, page.asks[i].usd]);
});

test('an unrecognised page is unreadable, never a number: every function answers empty on {ok:true} alone', () => {
  const bare = { ok: true };
  const noWorth = { lead: { label: 'Net worth', usd: null }, second: null, paperLeads: false };
  assert.equal(pageOk(bare), false);
  assert.deepEqual(headOf(bare), { mode: '', writes: '' });
  assert.deepEqual(worthOf(bare), noWorth);
  assert.deepEqual(worthOf({ ok: true, totalUsd: 29138.1, mode: 'guard' }, fx('holdings'), fx('holdings-paper')), noWorth, 'a total on a body that is not a page is not drawn');
  assert.deepEqual(changeOf(bare), { usd: null, pct: null, partial: false, first: null, sinceStartUsd: null, rebuilt: false });
  for (const view of [assetsOf, positionsOf, openOrdersOf, missingWords, statementLinesOf, venuesOf, agentsOf, cardsOf, asksOf, requestsOf]) assert.deepEqual(view(bare), [], view.name);
  assert.equal(statementCsvOf(statementLinesOf(bare)), 'date,type,kind,description,amount,fee,status,by\r\n');
  // the page with ok false, or a read that is not an answer, is no page either
  const refused = { ...fx('account'), ok: false };
  assert.deepEqual([headOf(refused), worthOf(refused, null, fx('holdings-paper')), openOrdersOf(refused), venuesOf(refused), cardsOf(refused), asksOf(refused), requestsOf(refused)],
    [{ mode: '', writes: '' }, noWorth, [], [], [], [], []]);
  assert.deepEqual([assetsOf({ ...fx('holdings'), ok: false }), statementLinesOf({ ...fx('statement'), ok: false }), agentsOf({ ...fx('agents'), ok: false })], [[], [], []]);

  // pure: the views leave the bodies as they found them, the lists they sort included
  const holdings = fx('holdings'), statement = fx('statement');
  const bodies = [fx('account'), { ...holdings, rows: [...holdings.rows].reverse() }, fx('holdings-paper'), fx('history'), { ...statement, lines: [...statement.lines].reverse() }, fx('agents')];
  const before = JSON.stringify(bodies);
  const [page, held, paper, history, lines, agents] = bodies;
  headOf(page); worthOf(page, held, paper); changeOf(history); assetsOf(held); positionsOf(held); openOrdersOf(page); missingWords(held.missing);
  statementCsvOf(statementLinesOf(lines)); venuesOf(page); agentsOf(agents, seatView()); cardsOf(page); asksOf(page); requestsOf(page);
  assert.equal(JSON.stringify(bodies), before);
});

// ── the Venues' keys (plan 2 Task 8): what to connect, the kept paper books, the key file's check ──

// a venue the stand-in never yields, built beside the fixture: Kalshi not served where the account runs, in its own words
const KALSHI_SAID = 'Kalshi does not serve this location';
const withNotServed = () => {
  const body = fx('venues');
  return { ...body, venues: body.venues.map(v => (v.connector === 'live:kalshi' ? { ...v, verdict: 'not-served', said: KALSHI_SAID } : v)) };
};

test('connectOptionsOf keeps every kind and carries no elsewhere', () => {
  const page = fx('account');
  const options = connectOptionsOf(page, withNotServed());
  assert.deepEqual(options.map(o => o.connector), page.connectLive.options.map(o => o.connector), "every option, in the Account's order");
  const by = id => options.find(o => o.connector === id);
  assert.deepEqual(by('live:alpaca-paper'), {
    connector: 'live:alpaca-paper', label: 'Alpaca · paper trading on its paper account, API key (no real money)', needs: 'key-file',
    example: '{"keyId": "…", "secret": "…"} (the keys of your Alpaca PAPER account: in the dashboard switch to Paper, then Generate New Keys)',
    defaultRef: 'credentials/<venue>/api-key.json', venues: [], kind: 'alpaca-paper', verdict: 'connectable', said: '', group: 'Brokers',
  });
  // a not-served venue carries the venue's own words
  assert.deepEqual([by('live:kalshi').verdict, by('live:kalshi').said], ['not-served', KALSHI_SAID]);
  // every kind connects here, by what it needs: a sign-in, a command line, an address among the key files
  assert.ok(options.every(o => !Object.hasOwn(o, 'elsewhere')));
  assert.deepEqual(options.filter(o => o.needs !== 'key-file' && o.needs !== 'none').map(o => [o.connector, o.needs]),
    [['live:robinhood', 'sign-in'], ['live:metamask', 'cli'], ['live:wallet', 'address'], ['live:hyperliquid', 'address']]);
  // an option the venues list does not name keeps no verdict: the bare exchange (the list names each live:exchange:<id>)
  assert.deepEqual([by('live:exchange').verdict, by('live:exchange').said, by('live:exchange').group, by('live:exchange').venues], [null, '', '', ['binance', 'okx', 'bybit', 'kraken']]);
  // the venues not read yet, or not an answer: every option, no verdict
  for (const venues of [null, { ok: false, venues: withNotServed().venues }]) {
    const bare = connectOptionsOf(page, venues);
    assert.equal(bare.length, options.length);
    assert.ok(bare.every(o => o.verdict === null && o.said === ''));
    assert.equal(bare.find(o => o.connector === 'live:robinhood').needs, 'sign-in', "the option's own need");
  }
  // a page that is not one: nothing to connect
  assert.deepEqual(connectOptionsOf({ ok: true }, withNotServed()), []);
  // the connect sheet takes them as its seed: the paper account is its own sheet; a sign-in drafts once signed in
  const fields = fieldsOf('connect', { options });
  assert.ok(!fields[0].options.some(o => o.value === 'live:paper'));
  assert.equal(draftOf('connect', { connector: 'live:robinhood', venue: 'rh', label: 'Robinhood' }, { options }, 0), 'Sign in at Robinhood first');
  assert.deepEqual(draftOf('connect', { connector: 'live:alpaca-paper', venue: 'alpaca', label: 'Alpaca paper' }, { options }, 0),
    { type: 'connectVenue', venue: 'alpaca', connector: 'live:alpaca-paper', label: 'Alpaca paper', credentialRef: 'credentials/alpaca/api-key.json' });
});

test('paperBooksOf: the kept books, amounts numeric; the paper sheet seeded with them and the page venues never reuses an id', () => {
  assert.deepEqual(paperBooksOf(fx('paper-books')), [], 'the stand-in keeps none');
  const kept = { venue: 'paper-swing', name: 'Swing', cashUsd: 9500.5, startCashUsd: 10000, addedUsd: '0', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', holdings: 2, positions: 1, open: 0 };
  const books = paperBooksOf({ ok: true, books: [kept, 'junk', { name: 'No venue' }] });
  assert.deepEqual(books, [{ venue: 'paper-swing', name: 'Swing', cashUsd: 9500.5, startCashUsd: 10000, addedUsd: 0, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', holdings: 2, positions: 1, open: 0 }]);
  assert.deepEqual(paperBooksOf({ ok: false, books: [kept] }), []);
  assert.deepEqual(paperBooksOf(null), []);
  // the page already has paper-momentum: a new Momentum book is paper-momentum-2; a kept book continues as it was
  const seed = { books, venues: venuesOf(fx('account')) };
  assert.equal(draftOf('paper', { book: '', label: 'Momentum', usd: '5000' }, seed, 0).venue, 'paper-momentum-2');
  assert.equal(draftOf('paper', { book: '', label: 'Swing', usd: '5000' }, seed, 0).venue, 'paper-swing-2', 'a kept book’s id is in use too');
  assert.deepEqual(draftOf('paper', { book: 'paper-swing', label: '', usd: '' }, seed, 0), { type: 'connectVenue', venue: 'paper-swing', connector: 'live:paper', label: 'Swing', credentialRef: '' });
});

test("keyfileWords: ready with its path, the fields missing, else the Account's sentence; never a value", () => {
  const body = fx('keyfile');
  assert.deepEqual(keyfileWords(body), { ready: false, path: body.path, missing: [], message: body.message });
  assert.deepEqual(keyfileWords({ ok: true, ready: true, path: '/h/credentials/alpaca/api-key.json', fields: ['keyId', 'secret'], message: 'ready' }),
    { ready: true, path: '/h/credentials/alpaca/api-key.json', missing: [], message: 'ready' });
  assert.deepEqual(keyfileWords({ ...body, missing: ['secret', 7, 'keyId'] }).missing, ['secret', 'keyId']);
  for (const not of [null, { ok: false, ready: true, path: '/x' }, 'text']) assert.deepEqual(keyfileWords(not), { ready: false, path: '', missing: [], message: '' });
});

test("the connect sheet's check: what to ask, and the words from the key file's check and the venue's reach", () => {
  const options = connectOptionsOf(fx('account'), withNotServed());
  const sheet = fields => ({ kind: 'connect', seed: { options }, fields: fieldsOf('connect', { options, ...fields }) });
  const read = (data, asked, status = 'ready', message = null) => ({ status, data, at: 1, message, asked });
  const none = { status: 'idle', data: null, at: null, message: null };

  // nothing picked: nothing to ask, nothing to say
  const blank = sheet({});
  assert.equal(keyfileAskOf(blank), null);
  assert.equal(reachAskOf(blank), null);
  assert.equal(connectCheckOf(blank, none, none), '');
  // a sign-in reads no key file; its line is its sign-in's, and the venue's reach
  const rh = sheet({ connector: 'live:robinhood', venue: 'rh' });
  assert.equal(keyfileAskOf(rh), null, 'a sign-in reads no key file');
  assert.equal(connectCheckOf(rh, read(fx('keyfile'), null), none), 'Robinhood did not answer', "the venue's own words, never a key file's");

  // a key-file option: the key file asked by its kind, venue and typed path; the reach by its connector
  const ap = sheet({ connector: 'live:alpaca-paper', venue: 'alpaca-paper' });
  const ask = { kind: 'alpaca-paper', venue: 'alpaca-paper', ref: '', exchange: '' };
  assert.deepEqual(keyfileAskOf(ap), ask);
  assert.equal(reachAskOf(ap), 'live:alpaca-paper');
  assert.equal(keyfileAskOf(sheet({ connector: 'live:alpaca-paper' })), null, 'no venue yet: nothing to check');
  const body = fx('keyfile');
  assert.equal(connectCheckOf(ap, read(body, ask), none), body.message, "no file there: the Account's sentence");
  assert.equal(connectCheckOf(ap, read({ ok: true, ready: true, path: '/h/credentials/alpaca-paper/api-key.json', fields: [], message: '' }, ask), none),
    'Key file found: /h/credentials/alpaca-paper/api-key.json');
  assert.equal(connectCheckOf(ap, read({ ...body, missing: ['keyId', 'secret'] }, ask), none), 'Missing: keyId, secret');
  // a check asked for another form says nothing of this one; one in the air says so; a refused one, the Account's sentence
  assert.equal(connectCheckOf(ap, read(body, { ...ask, venue: 'other' }), none), '');
  assert.equal(connectCheckOf(ap, read({ ok: true, ready: true, path: '/old' }, ask, 'loading'), none), 'Checking the key file…');
  assert.equal(connectCheckOf(ap, read({ ok: true, ready: true, path: '/old' }, ask, 'error', 'kind is not a connection'), none), 'kind is not a connection');

  // the reach: a venue that does not answer here, in its words (or the state's), ahead of the key file; one that answers, nothing
  const reach = (state, said) => read({ ok: true, reach: [{ connector: 'live:alpaca-paper', state, at: '2026-10-24T15:00:00.000Z', ...(said ? { said } : {}) }] }, undefined);
  assert.equal(connectCheckOf(ap, read(body, ask), reach('location', 'not offered in this region')), `not offered in this region · ${body.message}`);
  assert.equal(connectCheckOf(ap, none, reach('unreachable')), 'Did not answer');
  assert.equal(connectCheckOf(ap, none, reach('ok')), '');
  // a not-served option says the venue's own words
  const kalshi = sheet({ connector: 'live:kalshi', venue: 'kalshi' });
  assert.equal(connectCheckOf(kalshi, none, none), KALSHI_SAID);

  // the bare exchange: its key file asked with the exchange; its reach once the exchange is picked; the typed path as typed
  const ex = sheet({ connector: 'live:exchange', exchange: 'okx', credentialRef: ' credentials/okx/key.json ' });
  assert.deepEqual(keyfileAskOf(ex), { kind: 'exchange', venue: 'okx', ref: 'credentials/okx/key.json', exchange: 'okx' });
  assert.equal(reachAskOf(ex), 'live:exchange:okx');
  assert.equal(reachAskOf(sheet({ connector: 'live:exchange' })), null, 'no exchange picked: no venue to reach');
  // another sheet, or none: nothing
  assert.equal(connectCheckOf({ kind: 'paper', seed: {}, fields: [] }, read(body, ask), none), '');
  assert.equal(connectCheckOf(null, none, none), '');
});
