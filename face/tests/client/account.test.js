// Account on the face (spec 2026-10-22 §6.2): the Account's own page and reads through the face's proxy, drawn in four tabs —
// Portfolio, Venues, Agents, Cards — with the Statement and a venue's Details as drawers and the Settings drawer; states built
// with the host reducers over the stand-in's answers (tests/fixtures/account/). And the router's account tabs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderAccountScreen, renderStatement, renderSettings, positionKeys, changeKey } from '../../client/js/render/account.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { parseHash, toHash } from '../../client/js/router.js';
import { esc } from '../../client/js/html.js';
import { fmtClock, fmtDate } from '../../client/js/time.js';

const NOW = Date.parse('2026-10-22T07:40:00.000Z');
const CJK = /[\u3400-\u9fff]/;
// a fixture of the stand-in's answers, parsed afresh for every call so no test sees another's copy
const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
// a time as the screen words it on the day it is drawn (the operator's own clock), and a point's time on the curve's axis
const hhmm = at => fmtClock(Date.parse(at));
const stamp = at => `${fmtDate(Date.parse(at))} ${fmtClock(Date.parse(at))}`;
const has = (html, fragment, why = fragment) => assert.ok(html.includes(fragment), `missing: ${why}`);
const lacks = (html, fragment, why = fragment) => assert.ok(!html.includes(fragment), `present: ${why}`);

// spec 2026-10-20 §6.3: the Account seat's standing as /data/seat.json serves it
const seatView = (over = {}) => ({
  ok: true, url: 'http://127.0.0.1:4820', reachable: true, asOf: '2026-10-22T07:32:00.000Z', mode: 'guard', writes: { on: true, capUsd: 100 }, cardMinutes: 30,
  seat: { name: 'Gravit', status: 'admitted', address: '0xab12', validUntil: new Date(2026, 10, 19).getTime(), limits: [{ scope: 'trade', allow: ['paper-1'], perOrderUsd: 100, budgetUsd: 1000, spentUsd: 100, reservedUsd: 50, leftUsd: 850, validUntil: 1, expired: false }] },
  venues: [{ id: 'paper-1', name: 'Paper account · paper', paper: true, usd: 10000 }, { id: 'okx', name: 'OKX', paper: false, usd: 0, stale: true, notServed: 'OKX does not serve this location' }],
  cards: [{ id: 'card-7', usd: 56 }, { id: 'card-9', usd: 12 }], others: 1, ...over,
});

// the Account's reads as the host's reducers land them: the page, holdings and its paper lens, the 1W curve, the statement,
// the agents — each null to leave it unread — and the seat when one is given
function state({ tab = 'portfolio', page = fx('account'), holdings = fx('holdings'), paper = fx('holdings-paper'), history = fx('history'),
  statement = fx('statement'), agents = fx('agents'), seat, range = '1w' } = {}) {
  let s = R.setHistoryRange(R.nav(emptyState(), { screen: 'account', tab }), range);
  if (page !== null) s = R.accountLoaded(s, { data: page, at: NOW });
  if (holdings !== null) s = R.holdingsLoaded(s, { data: holdings, at: NOW });
  if (paper !== null) s = R.paperLoaded(s, { data: paper, at: NOW });
  if (history !== null) s = R.historyLoaded(s, { data: history, at: NOW });
  if (statement !== null) s = R.statementLoaded(s, { data: statement, at: NOW });
  if (agents !== null) s = R.agentsLoaded(s, { data: agents, at: NOW });
  if (seat !== undefined) s = R.seatLoaded(s, { data: seat, at: NOW });
  return s;
}
const draw = s => renderAccountScreen(s, NOW);
const SEAT_BOX = /<section class="cardbox" aria-label="Account seat">[\s\S]*?<\/section>/;

test('the head: Guard and Trading on chips; Refresh and Settings; five tabs with the cards count', () => {
  const html = draw(state());
  assert.match(html, /^<main class="main acct">/);
  has(html, '<div class="acct-head"><h1 class="head-title">Account</h1><span class="chip grey">Guard</span><span class="chip grey">Trading on · $250 a move</span><span class="spacer"></span>' +
    '<button type="button" class="pill" data-action="refreshAccount">Refresh</button><button type="button" class="pill" data-action="openSettings">Settings</button></div>');
  has(html, '<div class="seg"><a class="seg-item pressed" aria-current="page" href="#/account/portfolio">Portfolio</a><a class="seg-item" href="#/account/venues">Venues</a>' +
    '<a class="seg-item" href="#/account/agents">Agents</a><a class="seg-item" href="#/account/cards">Cards · 1</a><a class="seg-item" href="#/account/rules">Rules</a></div>', 'the five tabs, the Cards tab counting its one card');
  const page = fx('account');
  assert.match(draw(state({ page: { ...page, cards: [] } })), /href="#\/account\/cards">Cards<\/a>/, 'no count with nothing waiting');
  const two = draw(state({ page: { ...page, cards: [page.cards[0], { ...page.cards[0], id: 'card-0002', agent: '0xb0b', agentName: 'Scout' }] } }));
  assert.match(two, /href="#\/account\/cards">Cards · 2<\/a>/, 'every card of every agent');
  // the Account's mode and writes, its words; read only (no key changes them here)
  const beast = draw(state({ page: { ...page, mode: 'open', connectLive: { ...page.connectLive, writes: { on: false, capUsd: 250 } } } }));
  has(beast, '<h1 class="head-title">Account</h1><span class="chip grey">Beast</span><span class="chip grey">Read-only</span><span class="spacer"></span>');
  for (const html2 of [html, beast]) assert.doesNotMatch(html2, /data-action="(?:setMode|setCap|setWrites)/);
  // nothing read yet: the head and the tabs, no chip
  const bare = draw(state({ page: null }));
  has(bare, '<h1 class="head-title">Account</h1><span class="spacer"></span>');
  assert.doesNotMatch(bare, /class="chip/);
  for (const tab of ['venues', 'agents', 'cards', 'rules']) {
    assert.match(draw(state({ tab })), new RegExp(`<a class="seg-item pressed" aria-current="page" href="#/account/${tab}">`), tab);
  }
  // Settings: the theme seg, drawn by app.js into whichever screen is up; the screen makes room for it
  const set = R.openSettings(state());
  assert.match(draw(set), /^<main class="main acct with-drawer">/);
  const drawer = renderSettings({ ...set, theme: 'black' });
  assert.match(drawer, /<aside class="drawer" aria-label="Settings">/);
  assert.match(drawer, /class="seg-item pressed" aria-pressed="true" data-action="setTheme" data-value="Black"/);
});

test('Portfolio on the stand-in: Paper leads with its label; the change line; the curve; assets and positions rows; open orders with who', () => {
  // the operator's Account: no real money, a paper book with money in it — Paper leads, with its own curve, its own change
  // line and its own rows; real money second
  const zero = { ...fx('account'), totalUsd: 0 };
  const paper = draw(state({ page: zero, history: fx('history-paper') }));
  has(paper, '<div class="acct-figures"><div><div class="label">Paper</div><div class="networth">$25,400.00</div></div>' +
    '<div><div class="label">Net worth</div><div class="acct-second">$0.00</div></div></div>');
  // the paper curve's change in one run: the change, the range, what the book made since its start, and that it was rebuilt
  has(paper, '<div class="delta"><span class="flat">$0.00 · 0.00 % · 1W · rebuilt</span></div>', 'a flat change is 0, drawn flat');
  has(draw(state({ page: zero, history: { ...fx('history-paper'), startUsd: 25000, sinceStartUsd: 400 } })),
    '<div class="delta"><span class="flat">$0.00 · 0.00 % · 1W · since start +$400.00 · rebuilt</span></div>');
  has(draw(state({ page: zero, history: { ...fx('history-paper'), changeUsd: null } })),
    '<div class="delta"><span class="flat">— · 1W · rebuilt</span></div>', 'no change given: the range and the paper words, never nothing');
  // the curve named by the figure it draws
  const paperPoints = fx('history-paper').points;
  has(paper, `aria-label="${esc(`Paper from ${stamp(paperPoints[0].at)} to ${stamp(paperPoints.at(-1).at)}: from $25,000.00 to $25,400.00, low $25,000.00, high $25,400.00`)}"`);
  // the leading lens's rows: the paper book's assets and positions, not real money's
  const paperAssets = paper.match(/<section class="cardbox" aria-label="Assets">[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.deepEqual([...paperAssets.matchAll(/<tr><td><b>([^<]+)<\/b>/g)].map(m => m[1]), ['USD', 'USDC'], "holdings-paper's rows");
  has(paperAssets, '<tr><td><b>USD</b><br><span class="dim">Momentum · paper · 25,000</span></td><td class="r">25,000</td><td class="r">$1.00</td><td class="r"><span class="flat">—</span></td><td class="r">$25,000.00</td></tr>');
  lacks(paper, 'aria-label="Positions"', 'the paper book holds no position');
  const paperHeld = { ...fx('holdings-paper'), positions: [{ venue: 'paper-momentum', venueName: 'Momentum · paper', symbol: 'ETH/USD:USD', side: 'long', qty: 1, usd: 2450, paper: true }] };
  const paperBox = draw(state({ page: zero, paper: paperHeld })).match(/<section class="cardbox" aria-label="Positions">[\s\S]*?<\/section>/)?.[0] ?? '';
  has(paperBox, '<b>ETH/USD:USD</b> <span class="chip grey">Paper</span><br><span class="dim">Momentum · paper · long · 1</span>');
  lacks(paperBox, 'BTC/USDT:USDT', "real money's positions stay with real money");

  // the stand-in as captured (its page's totalUsd is 29,138.10): real money leads, with its own rows, Paper second
  const html = draw(state());
  has(html, '<div class="acct-figures"><div><div class="label">Net worth</div><div class="networth">$29,138.10</div></div>' +
    '<div><div class="label">Paper</div><div class="acct-second">$25,400.00</div></div></div>');
  assert.match(draw(state({ paper: null })), /<div class="networth">\$29,138\.10<\/div><\/div><\/div>/, 'no paper lens read: one figure');
  // the change for the range in one run: the Account's percent drawn as a percent (0.72 is 0.72 %, never 72 %), the range the
  // curve was read for
  has(html, '<div class="delta"><span class="up">+$208.78 · +0.72 % · 1W</span></div>');
  lacks(html, '72.00');
  has(draw(state({ history: { ...fx('history'), sinceStartUsd: 5, rebuilt: true } })), '<div class="delta"><span class="up">+$208.78 · +0.72 % · 1W</span></div>',
    "the paper words are the paper curve's alone");
  has(draw(state({ history: { ...fx('history'), changeUsd: -12.5, changePct: -0.04, partial: true } })),
    '<div class="delta"><span class="down">-$12.50 · -0.04 % · 1W · partial</span></div>');
  has(draw(state({ range: 'all', history: { ...fx('history'), range: 'all', changePct: null } })),
    `<div class="delta"><span class="up">+$208.78 · — · All · since ${fmtDate(Date.parse('2026-10-15T07:35:46.850Z'))}</span></div>`);
  // a read for a range the screen has since left is labelled as what it is, not as the range pressed
  has(draw(R.setHistoryRange(state(), '1m')), '<span class="up">+$208.78 · +0.72 % · 1W</span>');
  has(draw(state({ history: null })), '<div class="delta"><span class="flat">— · 1W</span></div>', 'no history read: the range alone, never nothing');
  // the ranges, the pressed one the slice's; each key hands the Account's own range name
  has(html, '<div class="seg"><button type="button" class="seg-item" aria-pressed="false" data-action="setHistoryRange" data-value="1d">1D</button>' +
    '<button type="button" class="seg-item pressed" aria-pressed="true" data-action="setHistoryRange" data-value="1w">1W</button>' +
    '<button type="button" class="seg-item" aria-pressed="false" data-action="setHistoryRange" data-value="1m">1M</button>' +
    '<button type="button" class="seg-item" aria-pressed="false" data-action="setHistoryRange" data-value="all">All</button></div>');
  // the curve: the history's points, first to last
  const points = fx('history').points;
  has(html, `aria-label="${esc(`Net worth from ${stamp(points[0].at)} to ${stamp(points.at(-1).at)}: from $28,929.32 to $28,591.76, low $28,553.06, high $28,948.81`)}"`);
  lacks(draw(state({ history: null })), 'mk-chart');

  // Assets: largest first, each asset's venues under its name; the 24h change a percent, — where the Account has none
  const assets = html.match(/<section class="cardbox" aria-label="Assets">[\s\S]*?<\/section>/)?.[0] ?? '';
  has(assets, '<thead><tr><th scope="col">Asset</th><th scope="col" class="r">Amount</th><th scope="col" class="r">Price</th><th scope="col" class="r">24h</th><th scope="col" class="r">Value</th></tr></thead>');
  assert.deepEqual([...assets.matchAll(/<tr><td><b>([^<]+)<\/b>/g)].map(m => m[1]), ['BTC', 'USDT', 'ETH', 'SOL', 'USD', 'USDY', 'USDC', 'AAPL', 'NVDA', 'USDT']);
  has(assets, '<tr><td><b>BTC</b><br><span class="dim">Stand-in Exchange · 0.12</span><br><span class="dim">Stand-in Wallet · 0.004</span></td>' +
    '<td class="r">0.124</td><td class="r">$62,479.03</td><td class="r"><span class="up">+2.30 %</span></td><td class="r">$7,747.40</td></tr>');
  has(assets, '<td class="r">5,700</td><td class="r">$1.00</td><td class="r"><span class="flat">—</span></td><td class="r">$5,700.00</td>');
  has(assets, '<td class="r"><span class="down">-1.60 %</span></td><td class="r">$3,571.25</td>');
  const stale = fx('holdings');
  stale.rows[0].venues[1].stale = true;
  has(draw(state({ holdings: stale })), '<span class="dim">Stand-in Wallet · 0.004 · stale</span>');
  assert.match(draw(state({ holdings: null })), /aria-label="Assets"><div class="cardbox-title">Assets<\/div><p class="acct-note">Loading…<\/p>/);

  // Positions: the symbol, where, which side and how many; value, entry, mark and the P&L with its sign
  const positions = html.match(/<section class="cardbox" aria-label="Positions">[\s\S]*?<\/section>/)?.[0] ?? '';
  has(positions, '<th scope="col">Position</th><th scope="col" class="r">Value</th><th scope="col" class="r">Entry</th><th scope="col" class="r">Mark</th><th scope="col" class="r">P&amp;L</th>');
  has(positions, '<tr><td><b>BTC/USDT:USDT</b><br><span class="dim">Stand-in Exchange · long · 0.01</span></td><td class="r">$624.99</td><td class="r">$60,520.00</td><td class="r">$62,498.80</td><td class="r"><span class="up">+$19.79</span></td></tr>');
  has(positions, '<td class="r">$31.00</td><td class="r">$0.63</td><td class="r">$0.62</td><td class="r"><span class="down">-$0.50</span></td>');
  const paperPosition = { ok: true, rows: [], positions: [{ venue: 'paper-1', venueName: 'Paper account', symbol: 'ETH/USD:USD', side: 'short', qty: 2, usd: 4900, paper: true }] };
  has(draw(state({ holdings: paperPosition })), '<b>ETH/USD:USD</b> <span class="chip grey">Paper</span><br><span class="dim">Paper account · short · 2</span>');
  lacks(draw(state({ holdings: { ...fx('holdings'), positions: [] } })), 'aria-label="Positions"', 'no positions: no table');

  // Open orders: open, partial and pending, newest first, each with whose it is
  const orders = [...html.matchAll(/<div class="order-row">([^<]+)<\/div>/g)].map(m => m[1]);
  assert.deepEqual(orders, [
    'Stand-in Exchange · Buy 0.707 SOL/USDT · limit 141.44 · open · Agent · Claude Code',
    'Stand-in Broker · Buy 0.25 SPY · limit 660.07 · pending · You',
    'Stand-in Exchange · Sell 0.6 SOL/USDT · stop · open · You',
    'Stand-in Exchange · Sell 0.002 BTC/USDT · limit 63,226.6 · open · You',
    'Stand-in Exchange · Buy 0.5 SOL/USDT · limit 142.44 · open · You',
  ]);
  has(draw(state({ page: { ...fx('account'), orders: [] } })), '<div class="cardbox-title">Open orders</div><p class="acct-note">No open orders</p>');
  // the venues a read could not reach, once each, the paper lens's too; the Statement key; nothing stale on a fresh read
  const gone = draw(state({ holdings: { ...fx('holdings'), missing: [{ venue: 'ex', venueName: 'Stand-in Exchange', why: 'no answer in 4 s' }] },
    paper: { ...fx('holdings-paper'), missing: [{ venue: 'ex', venueName: 'Stand-in Exchange' }, { venue: 'paper', venueName: 'Stand-in Paper' }] } }));
  has(gone, '<p class="acct-note">Stand-in Exchange did not answer · Stand-in Paper did not answer</p>');
  has(html, '<div class="btn-row"><button type="button" class="btn-sm" data-action="openStatement">Statement</button></div>');
  assert.doesNotMatch(html, /stale|As of|did not answer|Retry/);
});

test('Portfolio: an unrecognised page reads Account unreadable and draws no figure; a 409 message is drawn as the Account words', () => {
  const unread = draw(state({ page: { ok: true, totalUsd: 29138.1, mode: 'guard' } }));
  has(unread, '<p class="acct-note">Account unreadable</p>');
  for (const gone of [/networth/, /\$/, /class="chip/, /data-action="openStatement"/, /class="delta"/, /mk-chart/, /aria-label="Assets"/]) assert.doesNotMatch(unread, gone, String(gone));
  for (const tab of ['venues', 'cards']) has(draw(state({ tab, page: { ok: true } })), '<p class="acct-note">Account unreadable</p>', tab);
  // nothing read: Loading…, or Account unavailable with Retry once the read failed
  assert.match(draw(R.accountLoading(state({ page: null }))), /<p class="acct-note">Loading…<\/p>/);
  const down = draw(R.accountFailed(state({ page: null }), { at: NOW }));
  has(down, '<p class="acct-note">Account unavailable</p><div class="btn-row"><button type="button" class="btn-sm" data-action="refreshAccount">Retry</button></div>');
  lacks(down, 'networth');

  // the Account refused (a 409): its sentence under the head, the last good page kept, stamped stale, and Retry
  const said = 'The Account is locked until its owner signs in.';
  const refused = draw(R.accountFailed(state(), { at: NOW, message: said }));
  assert.match(refused, new RegExp(`</div><p class="acct-note">${said.replace(/\./g, '\\.')}</p><div class="seg">`), 'the Account\'s words, under the head');
  has(refused, '<div class="networth">$29,138.10</div>', 'the numbers stay');
  has(refused, `<p class="acct-note">As of ${hhmm(fx('account').now)} · stale</p>`);
  has(refused, '<div class="btn-row"><button type="button" class="btn-sm" data-action="refreshAccount">Retry</button><button type="button" class="btn-sm" data-action="openStatement">Statement</button></div>');
  lacks(draw(R.accountLoaded(R.accountFailed(state(), { at: NOW, message: said }), { data: fx('account'), at: NOW })), said, 'a good read clears it');
  // unreachable after a good read (no sentence): the stamp and Retry, no words of its own
  const unreachable = draw(R.accountFailed(state(), { at: NOW }));
  has(unreachable, `<p class="acct-note">As of ${hhmm(fx('account').now)} · stale</p>`);
  assert.doesNotMatch(unreachable, /unavailable|unreadable/);
  has(draw(state({ page: { ...fx('account'), stale: true } })), '· stale</p>', 'a page that says it is stale');
});

test("the Venues line says the Account's China words", () => {
  const s = state({ tab: 'venues' });
  const said = 'Tencent is not answering: A shares cannot be read now';
  const html = draw({ ...s, markets: { ...s.markets, providers: [{ id: 'tencent', market: 'cn', status: 'error', said }] } });
  has(html, `<div class="label">A-share quotes</div><div class="venues"><div class="venue"><span>${said}</span></div></div></section>`);
  const escaped = draw({ ...s, markets: { ...s.markets, providers: [{ id: 'tencent', market: 'cn', status: 'error', said: '<b>x</b> & y' }] } });
  has(escaped, '<span>&lt;b&gt;x&lt;/b&gt; &amp; y</span>', "the Account's words are escaped");
});

test('Venues: the rows with health, does and Paper; Details opens the drawer; the seat box and Open the Account page stay', () => {
  const s = state({ tab: 'venues' });
  const html = draw(s);
  const venues = html.match(/<section class="cardbox" aria-label="Venues">[\s\S]*?<\/section>/)?.[0] ?? '';
  const row = (id, inner) => `<div class="venue">${inner}<button type="button" class="btn-sm" data-action="openVenueDetails" data-id="${id}">Details</button></div>`;
  has(venues, row('broker', '<span><b>Stand-in Broker</b><br><span class="dim">$3,050.00 · Stocks · US stocks and ETFs</span><br><span class="dim">Not read yet · Trades</span></span>'));
  has(venues, row('ex', '<span><b>Stand-in Exchange</b><br><span class="dim">$21,638.93 · Exchange · spot and perpetuals</span><br><span class="dim">Answers · Trades · Moves money · Earns</span></span>'));
  has(venues, row('paper', '<span><b>Stand-in Paper</b> <span class="chip grey">Paper</span><br><span class="dim">$400.00 · Exchange · perpetuals</span><br><span class="dim">Not read yet · Trades</span></span>'));
  has(venues, row('agent-claude-code', '<span><b>Agent wallet · Claude Code</b><br><span class="dim">$47.37 · On-chain</span><br><span class="dim">Not read yet · Receives</span></span>'));
  assert.equal((venues.match(/data-action="openVenueDetails"/g) ?? []).length, 7);
  // health from the page: not answering since the last failure; stale in the Account's words, or the word
  const page = fx('account');
  const failing = draw(state({ tab: 'venues', page: { ...page, health: { broker: { lastOkAt: '2026-10-22T07:00:00.000Z', lastFailAt: '2026-10-22T07:30:00.000Z' } },
    venues: [{ ...page.venues[0], stale: true }, { ...page.venues[1], stale: 'the venue said 429' }] } }));
  has(failing, `<span class="dim">Not answering since ${hhmm('2026-10-22T07:30:00.000Z')} · Trades · stale</span>`);
  has(failing, '<span class="dim">Not read yet · Trades · Moves money · Earns · the venue said 429</span>');

  // Details: a drawer with the venue's holdings and its facts, blanks skipped; one at a time, as the Statement is
  const open = R.openVenueDetails(s, 'ex');
  assert.equal(open.account.detailsVenue, 'ex');
  const ex = draw(open);
  assert.match(ex, /^<main class="main acct with-drawer">/);
  has(ex, '<aside class="drawer" aria-label="Venue details"><div class="drawer-head"><h2>Stand-in Exchange</h2><button type="button" class="close-key" data-action="closeVenueDetails" aria-label="Close">×</button></div>');
  has(ex, '<div class="dsec"><div class="dsec-label">Holdings</div><div class="dsec-line">BTC · 0.12 · $7,497.60</div>');
  has(ex, '<div class="dsec"><div class="dsec-label">Watch only</div><div class="dsec-line">Live · read-only</div></div>');
  for (const blank of ['No trading', 'Restricted', 'Not served', 'Close only', 'Key file']) lacks(ex, `>${blank}<`, blank);
  has(draw(R.openVenueDetails(s, 'agent-claude-code')), '<div class="dsec-label">No trading</div><div class="dsec-line">An agent wallet pays for things; agents trade at the venues it funds.</div>');
  const keyed = R.openVenueDetails(state({ tab: 'venues', page: { ...page, venues: [{ id: 'kalshi', name: 'Kalshi', keyFile: 'credentials/kalshi/api-key.json',
    restricted: 'not for US persons', notServed: { said: 'Kalshi does not serve this location' }, closeOnly: { said: 'sells and closes only' } },
  { id: 'okx', name: 'OKX', keyFile: { apiKey: 'SECRET-KEY' } }] } }), 'kalshi');
  const kalshi = draw(keyed);
  for (const [label, words] of [['Restricted', 'not for US persons'], ['Not served', 'Kalshi does not serve this location'], ['Close only', 'sells and closes only'], ['Key file', 'credentials/kalshi/api-key.json']]) {
    has(kalshi, `<div class="dsec-label">${label}</div><div class="dsec-line">${words}</div>`, label);
  }
  has(draw(R.openVenueDetails(keyed, 'okx')), '<h2>OKX</h2><button', 'a venue with nothing on record');
  has(draw(R.openVenueDetails(keyed, 'okx')), '<div class="drawer-body"><p class="acct-note">No details</p></div>');
  lacks(draw(R.openVenueDetails(keyed, 'okx')), 'SECRET', 'never what a key file holds');
  lacks(draw(R.openVenueDetails(s, 'gone')), 'Venue details', 'a venue the page does not name opens no drawer');
  assert.equal(R.openStatement(open).account.detailsVenue, null, 'the Statement closes Details');
  assert.equal(R.openVenueDetails(R.openStatement(open), 'ex').account.statementOpen, false, 'and Details the Statement');
  assert.equal(R.openSettings(open).account.detailsVenue, null);
  assert.equal(R.toggleDetails(open).account.detailsVenue, null);
  assert.equal(R.nav(open, { screen: 'markets', id: null }).account.detailsVenue, null, 'leaving Account closes it');
  assert.equal(R.nav(open, { screen: 'account', tab: 'portfolio' }).account.detailsVenue, 'ex', 'moving inside Account keeps it');
  const shut = R.closeVenueDetails(open);
  assert.equal(shut.account.detailsVenue, null);
  assert.equal(R.closeVenueDetails(shut), shut, 'closing a closed drawer changes nothing');
  assert.equal(R.openVenueDetails(s, ''), s);
  assert.equal(emptyState().account.detailsVenue, null);

  // the A-share quotes line: China's state in the Account's own words where it says some, else the face's word
  const quoted = draw(R.chinaStatusUpdated(s, { status: { state: 'live', said: 'Tencent · answering' } }));
  has(quoted, '<div class="label">A-share quotes</div><div class="venues"><div class="venue"><span>Tencent · answering</span></div></div></section>');
  lacks(quoted, 'Alpaca');
  const wordless = draw(R.chinaStatusUpdated(s, { status: { state: 'live' } }));
  has(wordless, '<div class="label">A-share quotes</div><div class="venues"><div class="venue"><span>Tencent · Connected</span></div></div></section>');
  lacks(html, 'A-share quotes', 'no cn provider reported: no line');

  // the seat box under them, as before: nothing read, then the service, the seat and its limit, the venues, the cards, the link
  has(html, '<section class="cardbox" aria-label="Account seat"><div class="cardbox-title">Account seat</div><p class="acct-note">Loading…</p>');
  const seat = draw(state({ tab: 'venues', seat: seatView() })).match(SEAT_BOX)?.[0] ?? '';
  has(seat, '<div class="venue"><span><b>127.0.0.1:4820 · reachable</b><br><span class="dim">Guard · Trading on · $100 a move</span></span></div>');
  has(seat, '<div class="venue"><span><b>Gravit · admitted until Nov 19</b><br><span class="dim">trade · paper-1 · $100 an order · $850 of $1,000 left</span></span></div>');
  has(seat, '<div class="venue"><span><b>Paper account · paper</b> <span class="chip grey">Paper</span><br><span class="dim">$10,000</span></span></div>');
  has(seat, `<p class="acct-note">2 cards waiting · As of ${hhmm('2026-10-22T07:32:00.000Z')}</p>`);
  has(seat, '<div class="btn-row"><a class="btn-sm" href="http://127.0.0.1:4820" target="_blank" rel="noopener">Open the Account page</a><button type="button" class="btn-sm" data-action="refreshAccount">Refresh</button></div>');
  const off = draw(R.seatFailed(state({ tab: 'venues', seat: { ok: true, url: 'http://127.0.0.1:4820', reachable: false, error: 'ECONNREFUSED' } }), { at: NOW }));
  has(off, '<div class="venues"><div class="venue"><span><b>127.0.0.1:4820 · not reachable</b></span></div></div>');
  has(off, 'Open the Account page</a>');
  assert.ok(html.indexOf('aria-label="Venues"') < html.indexOf('aria-label="Account seat"'), 'the seat box under the venues');
});

test('Agents: Gravit first, the stand-in agent after with its limit words; Knocking requests', () => {
  const page = fx('account');
  const html = draw(state({ tab: 'agents', seat: seatView(), page: { ...page, requests: [{ address: '0xab12', name: 'Scout', at: '2026-10-22T07:30:00.000Z' }] } }));
  const agents = html.match(/<section class="cardbox" aria-label="Agents">[\s\S]*?<\/section>/)?.[0] ?? '';
  has(agents, '<div class="cardbox-title">Agents</div><div class="venues"><div class="venue"><span><b>Gravit · admitted until Nov 19</b>' +
    '<br><span class="dim">trade · paper-1 · $100 an order · $850 of $1,000 left</span><br><span class="dim">Cards 0 · Open orders 0</span></span></div>', "Gravit's seat first, its counts the Account's");
  has(agents, `<div class="venue"><span><b>Claude Code</b><br><span class="dim">ok · until ${fmtDate(Date.parse('2026-11-21T07:35:46.778Z'))}</span>` +
    '<br><span class="dim">trade · ex, predict, wallet · $150 an order · $380.01 of $600 left</span>' +
    '<br><span class="dim">venues · ex, agent-claude-code · $50 an order · $200 of $200 left</span>' +
    '<br><span class="dim">payees · api.example.com · $2 an order · $20 of $20 left</span><br><span class="dim">Cards 1 · Open orders 1</span></span></div>');
  assert.ok(agents.indexOf('Gravit ·') < agents.indexOf('Claude Code'));
  has(agents, `<div class="label">Knocking</div><div class="venues"><div class="venue"><span><b>Scout</b><br><span class="dim">0xab12 · ${hhmm('2026-10-22T07:30:00.000Z')}</span></span></div></div>`);
  lacks(draw(state({ tab: 'agents', seat: seatView() })), 'Knocking', 'nobody knocking: no label');
  // the agents not read yet: Gravit's counts unknown, never 0 and never null; then the list's state
  const unread = draw(state({ tab: 'agents', seat: seatView(), agents: null }));
  has(unread, '<span class="dim">Cards — · Open orders —</span>');
  has(unread, '</div><p class="acct-note">Loading…</p>');
  assert.doesNotMatch(unread, /null|Cards 0/);
  has(draw(R.agentsFailed(state({ tab: 'agents', agents: null }), { at: NOW })), '<p class="acct-note">Agents unavailable</p>');
  // no seat read: the Account's list is the whole answer
  const plain = draw(state({ tab: 'agents' }));
  assert.match(plain, /<div class="cardbox-title">Agents<\/div><div class="venues"><div class="venue"><span><b>Claude Code<\/b>/);
  has(draw(state({ tab: 'agents', agents: { ok: true, agents: [] } })), '<p class="acct-note">No agents</p>');
});

test('Cards: grouped by agent with What it asks verbatim; Asks under them', () => {
  const page = fx('account');
  const html = draw(state({ tab: 'cards' }));
  const cards = html.match(/<section class="cardbox" aria-label="Cards">[\s\S]*?<\/section>/)?.[0] ?? '';
  has(cards, '<div class="cardbox-title">Waiting for you</div><div class="dsec-label">Claude Code</div><div class="venues"><div class="venue"><div>' +
    `<b>Claude Code asks to buy 0.0479 ETH at Stand-in Exchange · market · about $117.63</b><br><span class="dim">$119.99 · answer by ${hhmm('2026-10-22T08:05:46.830Z')}</span>` +
    '<details id="shown-card-0001" class="acct-shown"><summary>What it asks</summary>');
  // every field the owner signs, as the Account sends it — an empty one stays, empty
  const shown = [...cards.matchAll(/<div class="dsec-line">([^<]*)<\/div>/g)].map(m => m[1]);
  assert.deepEqual(shown, page.cards[0].shown.map(f => esc(`${f.name}: ${f.value}`)));
  assert.equal(shown.length, 12);
  assert.ok(shown.includes('qty: '));
  // two agents, two groups, in the order they first ask
  const two = draw(state({ tab: 'cards', page: { ...page, cards: [page.cards[0], { ...page.cards[0], id: 'card-0002', agent: '0xb0b', agentName: 'Scout', reason: 'Scout asks', usd: 5, shown: [] }] } }));
  assert.deepEqual([...two.matchAll(/<div class="dsec-label">([^<]+)<\/div>/g)].map(m => m[1]), ['Claude Code', 'Scout']);
  has(two, '<b>Scout asks</b><br><span class="dim">$5.00 · answer by');
  // the asks under the cards, in their words
  const asks = html.match(/<section class="cardbox" aria-label="Asks">[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.deepEqual([...asks.matchAll(/<div class="order-row">([^<]+)<\/div>/g)].map(m => m[1]), [
    'Claude Code · Raise my trading budget to $1,000 so I can finish the SOL position you asked for · limit',
    'Claude Code · Connect Stand-in Public Exchange: DOGE trades only there · venue',
  ]);
  assert.ok(html.indexOf('aria-label="Cards"') < html.indexOf('aria-label="Asks"'));
  const none = draw(state({ tab: 'cards', page: { ...page, cards: [], asks: [] } }));
  has(none, '<div class="cardbox-title">Waiting for you</div><p class="acct-note">Nothing waiting</p>');
  lacks(none, 'aria-label="Asks"');
  // a page that does not sign answers nothing: no key on a card or an ask
  assert.doesNotMatch(html, /data-action="(?:approve|reject|answerCard|answerAsk|openSheet|grant)"/);
});

// the holdings' and the paper lens's refusals keep the Account's sentence: the Assets box says the leading lens's, where Holdings
// unavailable would be before any answer (the fixed word only when there is none), and over the rows kept after one
test("Portfolio's Assets box says the leading lens's refusal in the Account's words", () => {
  const assets = s => draw(s).match(/<section class="cardbox" aria-label="Assets">[\s\S]*?<\/section>/)?.[0] ?? '';
  // the stand-in: real money leads, so its holdings are the lens
  const unread = state({ holdings: null });
  has(assets(R.holdingsFailed(unread, { at: NOW, message: 'Venues are still settling.' })),
    '<div class="cardbox-title">Assets</div><p class="acct-note">Venues are still settling.</p></section>');
  has(assets(R.holdingsFailed(unread, { at: NOW })), '<div class="cardbox-title">Assets</div><p class="acct-note">Holdings unavailable</p></section>');
  const kept = assets(R.holdingsFailed(state(), { at: NOW, message: 'Venues are still settling.' }));
  has(kept, '<div class="cardbox-title">Assets</div><p class="acct-note">Venues are still settling.</p><div class="acct-wrap">', 'over the rows kept');
  lacks(assets(R.holdingsLoaded(R.holdingsFailed(state(), { at: NOW, message: 'Venues are still settling.' }), { data: fx('holdings'), at: NOW })),
    'Venues are still settling', 'an answer clears it');
  // Paper leads (real money at zero): the paper lens's own sentence, and not real money's
  const paperLeads = state({ page: { ...fx('account'), totalUsd: 0 } });
  has(assets(R.paperFailed(paperLeads, { at: NOW, message: 'The paper book is being rebuilt.' })),
    '<div class="cardbox-title">Assets</div><p class="acct-note">The paper book is being rebuilt.</p><div class="acct-wrap">');
  lacks(assets(R.holdingsFailed(paperLeads, { at: NOW, message: 'Venues are still settling.' })), 'Venues are still settling', "real money's refusal is not the leading lens's");
  lacks(assets(R.paperLoaded(R.paperFailed(paperLeads, { at: NOW, message: 'The paper book is being rebuilt.' }), { data: fx('holdings-paper'), at: NOW })),
    'being rebuilt', 'an answer clears it');
});

test('the Statement drawer: the lines newest first with by; Export CSV', () => {
  const s = R.openStatement(state());
  const html = draw(s);
  assert.match(html, /^<main class="main acct with-drawer">/);
  const drawer = renderStatement(s, NOW);
  assert.ok(html.includes(drawer), 'the screen carries the drawer');
  has(drawer, '<aside class="drawer" aria-label="Statement"><div class="drawer-head"><h2>Statement</h2><button type="button" class="close-key" data-action="closeStatement" aria-label="Close">×</button></div>');
  const lines = fx('statement').lines;
  const rows = [...drawer.matchAll(/<div class="activity-row">([\s\S]*?)<\/span><\/div>/g)];
  assert.equal(rows.length, lines.length);
  // each line's who, its status in the Account's word, and its fee when it had one
  has(drawer, `<div class="activity-row"><span class="dim">${hhmm(lines[0].at)}</span><span class="activity-text">Buy 0.707 SOL · SOL / USDT · limit 141.44<br><span class="dim">Claude Code, inside its limit · open</span></span><span class="num">$0.00</span></div>`);
  has(drawer, '<span class="activity-text">Buy 0.02 WETH · Wrapped Ether on Base · market · at 2,458.55<br><span class="dim">You · filled · fee $0.15</span></span><span class="num">-$49.17</span>');
  has(drawer, 'Swap 50 USDC → USDT<br><span class="dim">You · settled</span>');
  has(drawer, 'Supply 150 USDT · USDT · Flexible (stand-in) · 4.6% APY<br><span class="dim">You · pending</span>');
  assert.ok(drawer.indexOf('Buy 0.707 SOL') < drawer.indexOf('Sell 0.002 BTC'), 'newest first');
  const reversed = renderStatement(R.statementLoaded(s, { data: { ok: true, lines: [...lines].reverse() }, at: NOW }), NOW);
  assert.ok(reversed.indexOf('Buy 0.707 SOL') < reversed.indexOf('Sell 0.002 BTC'), 'whatever order the lines come in');
  has(drawer, '<div class="btn-row"><button type="button" class="btn-sm" data-action="exportStatement">Export CSV</button></div>');
  // nothing read yet, read and empty, failed before any read
  const blank = R.openStatement(state({ statement: null }));
  has(renderStatement(blank, NOW), '<div class="drawer-body"><p class="acct-note">Loading…</p></div>');
  const empty = renderStatement(R.openStatement(state({ statement: { ok: true, lines: [] } })), NOW);
  has(empty, '<p class="acct-note">No statement lines yet</p>');
  lacks(empty, 'exportStatement', 'nothing to export');
  has(renderStatement(R.statementFailed(blank, { at: NOW }), NOW), '<p class="acct-note">Statement unavailable</p>');
  // the Account's sentence when it refused: over Statement unavailable before any answer, over the lines kept after one
  has(renderStatement(R.statementFailed(blank, { at: NOW, message: 'The statement is being rebuilt.' }), NOW),
    '<div class="drawer-body"><p class="acct-note">The statement is being rebuilt.</p><p class="acct-note">Statement unavailable</p></div>');
  const keptLines = renderStatement(R.statementFailed(s, { at: NOW, message: 'The statement is being rebuilt.' }), NOW);
  has(keptLines, '<div class="drawer-body"><p class="acct-note">The statement is being rebuilt.</p><div class="activity">');
  assert.equal([...keptLines.matchAll(/<div class="activity-row">/g)].length, lines.length, 'the lines kept');
  lacks(renderStatement(R.statementLoaded(R.statementFailed(s, { at: NOW, message: 'The statement is being rebuilt.' }), { data: fx('statement'), at: NOW }), NOW),
    'being rebuilt', 'an answer clears it');
  // open over Settings, Settings wins the space; the Statement stays when moving inside Account
  lacks(draw(R.openSettings(s)), 'aria-label="Statement"');
  has(draw(R.nav(s, { screen: 'account', tab: 'cards' })), 'aria-label="Statement"');
});

test('no CJK, no icon URL, no raw JSON in any rendered string', () => {
  const page = fx('account');
  // the Account's rows name third-party images; the face draws none of them
  const icon = 'https://elbstream.com/logos/symbol/BTC';
  const holdings = fx('holdings');
  for (const r of holdings.rows) r.icon = icon;
  const iconPage = { ...page, venues: page.venues.map(v => ({ ...v, icon: 'https://www.google.com/s2/favicons?domain=example.com' })), cards: page.cards.map(c => ({ ...c, icon })), asks: page.asks.map(k => ({ ...k, icon })),
    requests: [{ address: '0xab12', name: 'Scout', at: '2026-10-22T07:30:00.000Z', icon }] };
  const states = [];
  for (const tab of ['portfolio', 'venues', 'agents', 'cards']) {
    states.push(state({ tab, page: iconPage, holdings, seat: seatView() }), state({ tab }), state({ tab, page: null }), state({ tab, page: { ok: true } }),
      R.accountFailed(state({ tab }), { at: NOW, message: 'The Account is locked until its owner signs in.' }), R.accountFailed(state({ tab, page: null }), { at: NOW }),
      state({ tab, holdings: null, paper: null, history: null, statement: null, agents: null }), state({ tab, page: { ...page, totalUsd: 0 }, history: fx('history-paper') }),
      R.ownerStanding(state({ tab, page: iconPage, holdings, seat: seatView() }), { role: 'signs', kid: 'a5048199a8081854' }));
  }
  for (const v of page.venues) {
    states.push(R.openVenueDetails(state({ tab: 'venues', page: iconPage }), v.id),
      R.askConfirm(R.openVenueDetails(R.ownerStanding(state({ tab: 'venues', page: iconPage }), { role: 'signs', kid: 'a5048199a8081854' }), v.id), { action: 'disconnect', venue: v.id, name: v.name }));
  }
  states.push(R.openStatement(state()), R.openStatement(state({ statement: null })), R.openSettings(state()),
    state({ tab: 'venues', seat: { ok: true, url: 'http://127.0.0.1:4820', reachable: false, error: 'ECONNREFUSED' } }),
    state({ tab: 'agents', seat: seatView({ seat: { name: 'Gravit', status: 'knocking', limits: [] } }), agents: null }));
  for (const s of states) {
    const html = draw(s) + renderStatement(s, NOW) + renderSettings(s);
    assert.doesNotMatch(html, CJK);
    assert.doesNotMatch(html, /<img|\bsrc=|elbstream|favicon/);
    for (const [url] of html.matchAll(/https?:\/\/[^\s"'<]+/g)) assert.equal(url, 'http://127.0.0.1:4820', 'the only address drawn is the Account page link');
    assert.doesNotMatch(html, /\{"|":|\[object Object\]|undefined|NaN|\bnull\b/);
  }
});

test('the owner device on the screen: the device line under the head chips, Devices in Settings', () => {
  const KID = 'a5048199a8081854';
  const HEAD_END = '<button type="button" class="pill" data-action="openSettings">Settings</button></div>';
  // the line sits right under the head, before the tabs; a standing not known yet draws nothing there
  const signs = draw(R.ownerStanding(state(), { role: 'signs', kid: KID }));
  has(signs, `${HEAD_END}<p class="acct-note">This page signs for the account</p><div class="seg">`);
  has(draw(state()), `${HEAD_END}<div class="seg">`);
  const pair = draw(R.ownerStanding(state(), { role: 'needs-code', kid: '' }));
  has(pair, `${HEAD_END}<p class="acct-note">Pair with the code the Account printed in its terminal</p><form class="pair-box" data-action="pairDevice" autocomplete="off"><input id="pair-code"`);
  has(draw(R.ownerStanding(state(), { role: 'signed-out', kid: KID })), 'data-action="signIn">Sign in</button>');
  // Settings: the theme, then Devices — Sign out only for a page that signs
  const set = renderSettings(R.ownerStanding(R.openSettings(state()), { role: 'signs', kid: KID }));
  has(set, 'data-value="System">System</button></div></div><div class="dsec"><div class="dsec-label">Devices</div>');
  has(set, `<div class="dsec-line">Stand-in seed key · device:${KID} · this page</div>`);
  has(set, 'data-action="signOut">Sign out</button>');
  lacks(renderSettings(R.ownerStanding(R.openSettings(state()), { role: 'pending', kid: '0123456789abcdef' })), 'data-action="signOut"');
  // no page read: the theme alone
  lacks(renderSettings(R.openSettings(R.nav(emptyState(), { screen: 'account', tab: 'portfolio' }))), 'Devices');
});

// the owner's keys (plan 2 Task 7): each opens its sheet with the seed the store cannot tell in data-*; drawn only for a page
// that signs, absent (never disabled) otherwise
test("the owner's keys on Agents and Cards: Let in, Give a limit, End limit, Revoke, Approve, Reject, Grant and Decline for a page that signs", () => {
  const KID = 'a5048199a8081854';
  const CC = '0x3a087530887bd175ccc38828ee3776e5b6ea1ac6';
  const page = fx('account');
  const knocks = { ...page, requests: [{ address: '0xab12', name: 'Scout', at: '2026-10-22T07:30:00.000Z' }] };
  const signing = s => R.ownerStanding(s, { role: 'signs', kid: KID });
  const box = (html, label) => html.match(new RegExp(`<section class="cardbox" aria-label="${label}">[\\s\\S]*?</section>`))?.[0] ?? '';
  const sheetKey = (kind, data, word, cl = 'btn-sm') => `<button type="button" class="${cl}" data-action="openSheet" data-kind="${kind}"${Object.entries(data).map(([k, v]) => ` data-${k}="${v}"`).join('')}>${word}</button>`;

  // Agents: a knocking key's Let in…, an agent's Give a limit…, End limit on its trade limit, Revoke…; Gravit's own row none
  const agents = box(draw(signing(state({ tab: 'agents', seat: seatView(), page: knocks }))), 'Agents');
  has(agents, `<span class="dim">0xab12 · ${hhmm('2026-10-22T07:30:00.000Z')}</span></span><span class="btn-row">${sheetKey('letIn', { address: '0xab12', name: 'Scout' }, 'Let in…')}</span></div>`);
  has(agents, '<span class="dim">Cards 1 · Open orders 1</span></span><span class="btn-row">' +
    sheetKey('limit', { address: CC, name: 'Claude Code' }, 'Give a limit…') +
    sheetKey('endLimit', { address: CC, name: 'Claude Code', allow: 'ex,predict,wallet' }, 'End limit') +
    `<button type="button" class="btn-danger" data-action="askRevoke" data-address="${CC}" data-name="Claude Code">Revoke…</button></span></div>`);
  assert.equal((agents.match(/data-kind="endLimit"/g) ?? []).length, 1, 'the trade limit alone: venues and payees are not ended here');
  has(agents, '<span class="dim">Cards 0 · Open orders 0</span></span></div>', "Gravit's row: no key — the seat is admitted on the Account page");
  // Revoke… asks twice: the confirm for this agent stands in its place
  const asking = box(draw(R.askConfirm(signing(state({ tab: 'agents', seat: seatView() })), { action: 'revoke', name: 'Claude Code', address: CC })), 'Agents');
  has(asking, 'data-allow="ex,predict,wallet">End limit</button><span class="confirm"><button type="button" class="btn-danger" data-action="confirmYes">Yes, revoke</button><button type="button" class="btn-sm" data-action="cancelConfirm">No</button></span></span></div>');
  lacks(asking, 'data-action="askRevoke"');
  has(box(draw(R.askConfirm(signing(state({ tab: 'agents' })), { action: 'revoke', name: 'Someone else', address: '0xb0b' })), 'Agents'), 'data-action="askRevoke"', 'a confirm for another agent leaves this one');
  // each trade limit standing gets End limit, its ids comma-joined, never *; an expired one, or one naming nothing, none
  const agentsBody = fx('agents');
  const more = { ...agentsBody, agents: [{ ...agentsBody.agents[0], limits: [
    { id: 'spend-1', scope: 'trade', allow: ['ex'], perPaymentUsd: 10, budgetUsd: 20 },
    { id: 'spend-2', scope: 'trade', allow: ['*', 'paper', 'broker'], perPaymentUsd: 10, budgetUsd: 20 },
    { id: 'spend-3', scope: 'trade', allow: ['wallet'], expired: true },
    { id: 'spend-4', scope: 'trade', allow: ['*'] },
  ] }] };
  const ends = [...draw(signing(state({ tab: 'agents', agents: more }))).matchAll(/data-kind="endLimit"[^>]*data-allow="([^"]*)"/g)].map(m => m[1]);
  assert.deepEqual(ends, ['ex', 'paper,broker']);
  // an agent with no address: Revoke… by its name alone; nothing that needs the address; every seed escaped
  const odd = draw(signing(state({ tab: 'agents', agents: { ok: true, agents: [{ name: 'Bob "<b>"', status: 'ok', limits: [{ scope: 'trade', allow: ['ex'] }] }] } })));
  has(odd, '<button type="button" class="btn-danger" data-action="askRevoke" data-address="" data-name="Bob &quot;&lt;b&gt;&quot;">Revoke…</button>');
  lacks(odd, 'data-action="openSheet"');
  const quoted = draw(signing(state({ tab: 'agents', page: { ...page, requests: [{ address: '0x"><i>', name: '<Scout>', at: '' }] } })));
  has(quoted, sheetKey('letIn', { address: '0x&quot;&gt;&lt;i&gt;', name: '&lt;Scout&gt;' }, 'Let in…'));

  // Cards: each card's ✓ Approve and ✗ Reject with its id and hash; each ask's Grant (when it grants here) and Decline
  const html = draw(signing(state({ tab: 'cards' })));
  const card = page.cards[0];
  has(box(html, 'Cards'), `</details></div><span class="btn-row">${sheetKey('approveCard', { card: card.id, hash: card.hash, decision: 'approve' }, '✓ Approve')}` +
    `${sheetKey('approveCard', { card: card.id, hash: card.hash, decision: 'reject' }, '✗ Reject')}</span></div>`);
  const asks = box(html, 'Asks');
  has(asks, '<div class="order-row"><span>Claude Code · Raise my trading budget to $1,000 so I can finish the SOL position you asked for · limit</span><span class="spacer"></span><span class="btn-row">' +
    `<button type="button" class="btn-sm" data-action="grant" data-ask="ask-0001">Grant</button>${sheetKey('declineAsk', { ask: 'ask-0001' }, 'Decline')}</span></div>`);
  has(asks, `<button type="button" class="btn-sm" data-action="grant" data-ask="ask-0002">Grant</button>${sheetKey('declineAsk', { ask: 'ask-0002' }, 'Decline')}`, 'a venue ask grants as a limit');
  // an ask granted on the Account page (a session) has Decline alone; an ask with no id, no key
  const session = draw(signing(state({ tab: 'cards', page: { ...page, asks: [{ id: 'ask-0003', agentName: 'Claude Code', kind: 'session', text: 'A session' }, { kind: 'limit', text: 'No id' }] } })));
  has(session, `<span>Claude Code · A session · session</span><span class="spacer"></span><span class="btn-row">${sheetKey('declineAsk', { ask: 'ask-0003' }, 'Decline')}</span></div>`);
  lacks(session, 'data-action="grant"');
  has(session, '<div class="order-row">No id · limit</div>');
  // a card with no hash is not answered here
  lacks(draw(signing(state({ tab: 'cards', page: { ...page, cards: [{ ...card, hash: '' }] } }))), 'data-kind="approveCard"');

  // a page that does not sign: none of these keys, and the device line says why
  for (const [role, line] of [['pending', 'Waiting to be let in'], ['none', 'This browser cannot sign for the account'], ['needs-code', 'Pair with the code'], ['signed-out', 'Signed out'], ['unknown', '']]) {
    for (const tab of ['agents', 'cards']) {
      const out = draw(R.ownerStanding(state({ tab, seat: seatView(), page: knocks }), { role, kid: KID }));
      for (const k of ['data-action="openSheet"', 'data-action="askRevoke"', 'data-action="grant"', 'Let in…', 'Give a limit…', 'End limit', 'Revoke…', 'Approve', 'Reject', 'Decline']) lacks(out, k, `${role} ${tab}: ${k}`);
      if (line) has(out, `<p class="acct-note">${line}`, `${role}: the device line`);
    }
  }
});

// the Venues' keys (plan 2 Task 8): Connect an account and Open a paper account under the list, Disconnect… on a row — asked
// twice —, Top up and Start over in a paper venue's Details; drawn only for a page that signs, absent otherwise
test("the Venues' keys: Connect an account, Open a paper account, Disconnect, Top up and Start over for a page that signs", () => {
  const KID = 'a5048199a8081854';
  const signing = s => R.ownerStanding(s, { role: 'signs', kid: KID });
  const venuesBox = html => html.match(/<section class="cardbox" aria-label="Venues">[\s\S]*?<\/section>/)?.[0] ?? '';
  const sheetKey = (kind, data, word) => `<button type="button" class="btn-sm" data-action="openSheet" data-kind="${kind}"${Object.entries(data).map(([k, v]) => ` data-${k}="${v}"`).join('')}>${word}</button>`;
  const disconnect = (venue, name) => `<button type="button" class="btn-danger" data-action="askDisconnect" data-venue="${venue}" data-name="${name}">Disconnect…</button>`;

  const html = venuesBox(draw(signing(state({ tab: 'venues' }))));
  has(html, `<div class="btn-row">${sheetKey('connect', {}, 'Connect an account')}${sheetKey('paper', {}, 'Open a paper account')}</div>`);
  has(html, `data-id="ex">Details</button>${disconnect('ex', 'Stand-in Exchange')}</div>`);
  has(html, `data-id="paper-momentum">Details</button>${disconnect('paper-momentum', 'Momentum · paper')}</div>`);
  assert.equal((html.match(/data-action="askDisconnect"/g) ?? []).length, 6, 'every venue but the agent wallet, which the Account never disconnects');
  has(html, 'data-id="agent-claude-code">Details</button></div>');
  // Disconnect… asks twice: the confirm for this venue in its place
  const asking = venuesBox(draw(R.askConfirm(signing(state({ tab: 'venues' })), { action: 'disconnect', venue: 'ex', name: 'Stand-in Exchange' })));
  has(asking, 'data-id="ex">Details</button><span class="confirm"><button type="button" class="btn-danger" data-action="confirmYes">Yes, disconnect</button><button type="button" class="btn-sm" data-action="cancelConfirm">No</button></span></div>');
  assert.equal((asking.match(/data-action="askDisconnect"/g) ?? []).length, 5, 'the other venues keep theirs');
  assert.equal((venuesBox(draw(R.askConfirm(signing(state({ tab: 'venues' })), { action: 'revoke', name: 'ex' }))).match(/askDisconnect/g) ?? []).length, 6, "another confirm is not this one's");
  // every seed escaped
  const page = fx('account');
  const odd = venuesBox(draw(signing(state({ tab: 'venues', page: { ...page, venues: [{ ...page.venues[3], id: 'p"<1>', name: 'Mo <b>"x"</b>' }] } }))));
  has(odd, disconnect('p&quot;&lt;1&gt;', 'Mo &lt;b&gt;&quot;x&quot;&lt;/b&gt;'));

  // a paper venue's Details: Top up and Start over, naming the venue; a venue that is not paper, neither
  const paper = draw(R.openVenueDetails(signing(state({ tab: 'venues' })), 'paper-momentum'));
  has(paper, `<div class="btn-row">${sheetKey('topUp', { venue: 'paper-momentum', name: 'Momentum · paper' }, 'Top up')}${sheetKey('resetPaper', { venue: 'paper-momentum', name: 'Momentum · paper' }, 'Start over')}</div></div></aside>`);
  lacks(draw(R.openVenueDetails(signing(state({ tab: 'venues' })), 'ex')), 'data-kind="topUp"');

  // a page that does not sign: none of these keys, the rows and Details as before
  for (const role of ['pending', 'none', 'needs-code', 'signed-out', 'unknown']) {
    const out = draw(R.openVenueDetails(R.ownerStanding(state({ tab: 'venues' }), { role, kid: KID }), 'paper-momentum'));
    for (const k of ['data-action="openSheet"', 'askDisconnect', 'Connect an account', 'Open a paper account', 'Disconnect…', 'Top up', 'Start over']) lacks(out, k, `${role}: ${k}`);
    has(out, 'data-id="ex">Details</button></div>');
  }
  // a page that signs but is not read, or not one the face recognises: nothing to connect from, no keys
  for (const p of [null, { ok: true }]) lacks(draw(signing(state({ tab: 'venues', page: p }))), 'data-action="openSheet"');
});

test('router: account tabs agents, cards and rules parse; an unknown tab is portfolio', () => {
  for (const tab of ['portfolio', 'venues', 'agents', 'cards', 'rules']) {
    assert.deepEqual(parseHash(`#/account/${tab}`), { screen: 'account', tab });
    assert.equal(toHash({ screen: 'account', tab }), `#/account/${tab}`);
  }
  assert.deepEqual(parseHash('#/account/memory'), { screen: 'account', tab: 'portfolio' });
  assert.deepEqual(parseHash('#/account'), { screen: 'account', tab: 'portfolio' });
  // the screen draws the tab its route names, one it does not know as Portfolio
  assert.match(draw(R.nav(emptyState(), parseHash('#/account/cards'))), /<a class="seg-item pressed" aria-current="page" href="#\/account\/cards">/);
  assert.match(draw(R.nav(emptyState(), { screen: 'account', tab: 'memory' })), /<a class="seg-item pressed" aria-current="page" href="#\/account\/portfolio">/);
});

// ── Rules (plan 4a Task 5): Guard one unsigned click; Beast, the cap, the session and their leverage signed ──

const RULES_KID = 'a5048199a8081854';
const signingRules = s => R.ownerStanding(s, { role: 'signs', kid: RULES_KID });
const rulesKey = (kind, word) => `<button type="button" class="btn-sm" data-action="openSheet" data-kind="${kind}">${word}</button>`;
const GATE2 = "Beast removes the Account's card only: Gravit's orders still raise their Gate 2 card in this face first.";
const LEAD = 'Guard: what agents ask for waits for you on a card. Beast: inside the limits you signed, it goes at once. Guard is one click; Beast is signed.';

test('Rules on a writes-on page that signs: Mode, the door rules, each move, the session, their leverage, every key and the Gate 2 sentence', () => {
  const html = draw(signingRules(state({ tab: 'rules' })));
  has(html, '<a class="seg-item pressed" aria-current="page" href="#/account/rules">Rules</a>');
  // Mode: Guard pressed, Beast a signed sheet
  has(html, '<div class="seg"><button type="button" class="seg-item pressed" aria-pressed="true" data-action="setGuard">Guard</button>' +
    '<button type="button" class="seg-item" aria-pressed="false" data-action="openSheet" data-kind="beast">Beast</button></div>');
  has(html, esc(LEAD));
  has(html, esc(GATE2));
  lacks(html, 'Only a browser that signs switches to Beast.');
  // the door-by-door table, the mode in force marked Now
  has(html, '<th scope="col">An agent, inside its limit</th><th scope="col">Guard <span class="chip grey">Now</span></th><th scope="col">Beast</th>');
  has(html, '<tr><td>Place or enlarge an order</td><td>Waits on a card</td><td>At once</td></tr>');
  has(html, 'A card nobody answers in 30 minutes expires.');
  // each move, the session, their leverage — each with its key
  has(html, '$250 an order or a move');
  has(html, rulesKey('cap', 'Change…'));
  has(html, `Agents may act until ${fmtDate(Date.parse('2026-11-21T07:35:46.773Z'))}.`);
  has(html, rulesKey('session', 'Renew for 30 days'));
  has(html, 'Up to 5x on a perpetual, at a venue that sets leverage from here.');
  has(html, rulesKey('leverageCap', 'Change…'));
  lacks(html, 'Read-only:');
  // Beast in force: Beast pressed, Now on its column
  const page = fx('account');
  const beast = draw(signingRules(state({ tab: 'rules', page: { ...page, mode: 'open' } })));
  has(beast, 'aria-pressed="false" data-action="setGuard">Guard</button><button type="button" class="seg-item pressed" aria-pressed="true">Beast</button>');
  lacks(beast, 'data-kind="beast"', 'Beast in force: pressed, no sheet to sign');
  has(beast, '<th scope="col">Guard</th><th scope="col">Beast <span class="chip grey">Now</span></th>');
  // an ended session starts a new one
  const ended = draw(signingRules(state({ tab: 'rules', page: { ...page, dial: { ...page.dial, sessionEnded: true } } })));
  has(ended, 'Ended: agents can do nothing until you start a new one.');
  has(ended, rulesKey('session', 'Start a new one'));
  // no venue sets leverage: no leverage row
  const flat = { ...page, venues: page.venues.map(v => (v.trade ? { ...v, trade: { ...v.trade, leverage: false } } : v)) };
  lacks(draw(signingRules(state({ tab: 'rules', page: flat }))), 'Their leverage');
  // what the Guard press said, and a refusal, under the switch
  has(draw(R.guardSaid(signingRules(state({ tab: 'rules' })), 'Guard: what agents ask for waits for you on a card.')), '<p class="acct-note">Guard: what agents ask for waits for you on a card.</p>');
  const openPage = { tab: 'rules', page: { ...page, mode: 'open' } };
  has(draw(R.guardRefused(signingRules(state(openPage)), 'No & no')), '<p class="acct-note">No &amp; no</p>');
  // a line the page no longer bears out is not drawn: Guard said, then Beast signed (the page in Beast); a refusal, then the
  // page in Guard after all
  const stale = draw(R.guardSaid(signingRules(state(openPage)), 'Guard: what agents ask for waits for you on a card.'));
  lacks(stale, '<p class="acct-note">Guard: what agents ask for waits for you on a card.</p>');
  lacks(draw(R.guardRefused(signingRules(state({ tab: 'rules' })), 'No & no')), 'No &amp; no');
  // a signed Beast clears it
  assert.deepEqual(R.guardClear(R.guardSaid(signingRules(state(openPage)), 'x')).account.guard, { status: 'idle', said: null, message: null });
  // the head's chips stay
  has(html, '<span class="chip grey">Guard</span><span class="chip grey">Trading on · $250 a move</span>');
});

test('Rules on a read-only page: the three Read-only sentences, no key', () => {
  const page = fx('account');
  const ro = { ...page, connectLive: { ...page.connectLive, writes: { on: false, capUsd: 250 } } };
  const html = draw(signingRules(state({ tab: 'rules', page: ro })));
  has(html, 'Read-only: the Account was started without trading, so there is no cap to set.');
  has(html, 'Read-only: the Account was started without trading, so there is no session to open.');
  has(html, 'Read-only: the Account was started without trading, so there is no leverage to set.');
  for (const k of ['cap', 'session', 'leverageCap']) lacks(html, `data-kind="${k}"`);
  lacks(html, '$250 an order or a move');
  // Mode still stands: Guard one click, and the Gate 2 sentence
  has(html, 'data-action="setGuard">Guard</button>');
  has(html, esc(GATE2));
});

test('Rules on a page that does not sign: the Guard seg live, no Beast sheet key, no Change…', () => {
  for (const role of ['unknown', 'needs-code', 'pending', 'signed-out']) {
    const html = draw(R.ownerStanding(state({ tab: 'rules' }), { role, kid: '' }));
    has(html, '<button type="button" class="seg-item pressed" aria-pressed="true" data-action="setGuard">Guard</button>', role);
    has(html, '<button type="button" class="seg-item" aria-pressed="false" disabled>Beast</button>', role);
    has(html, 'Only a browser that signs switches to Beast.');
    lacks(html, 'data-action="openSheet"', role);
    lacks(html, 'Change…', role);
    lacks(html, 'Renew for 30 days', role);
    // the rules read as they stand
    has(html, '$250 an order or a move');
    has(html, esc(GATE2));
  }
  // an unread page: its note, no rule
  lacks(draw(state({ tab: 'rules', page: null })), 'data-action="setGuard"');
  has(draw(state({ tab: 'rules', page: { ok: true } })), 'Account unreadable');
});

test("a Leverage key carries the most and the modes the market's read says; a Change key is not drawn for an order that cannot be changed", () => {
  const page = JSON.parse(readFileSync(new URL('./../fixtures/account/account.json', import.meta.url), 'utf8'));
  const perp = { venue: 'ex', venueName: 'Stand-in Exchange', symbol: 'BTC/USDT:USDT', name: 'BTC perpetual', kind: 'perp', leverage: 3 };
  const [bare] = positionKeys(perp, page).filter(k => k.includes('data-kind="leverage"'));
  assert.doesNotMatch(bare, /data-max-leverage|data-margin-modes/, 'nothing said, nothing drawn');
  const [said] = positionKeys(perp, page, { 'ex|BTC/USDT:USDT': { maxLeverage: 50, marginModes: ['cross', 'isolated'] } }).filter(k => k.includes('data-kind="leverage"'));
  assert.match(said, /data-leverage="3" data-max-leverage="50" data-margin-modes="cross,isolated"/);
  const order = { id: 'ord-0004', venue: 'ex', type: 'stop', kind: 'spot', qty: 0.6, stopPrice: 137.83, side: 'sell', base: 'SOL' };
  assert.match(changeKey(order, page), /Change…/);
  for (const flag of ['waitingForWallet', 'canceling', 'unfollowed', 'changing', 'unconfirmed']) assert.equal(changeKey({ ...order, [flag]: true }, page), '', flag);
});
