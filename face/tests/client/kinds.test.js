// The kind table (spec 2026-10-19 §6): a mapper view becomes zero, one or two gravit-ui messages.
// Driven by the hand-kept frame fixture the wire tests share, so a shape the host changes breaks here too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapFrame } from '../../client/js/wire/mapper.js';
import { ORDER_TOOLS, SEAT_TOOLS, isOrderTool, isSeatWriteTool, parseArgs, orderLine, seatLine, rememberCall, toMessages } from '../../client/js/host/kinds.js';

// the Account seat's twelve write tools (spec 2026-10-20 §6.1), spelled here as the gate's test spells them
const SEAT = ['portfolio_live_order', 'portfolio_live_batch', 'portfolio_live_amend', 'portfolio_live_cancel', 'portfolio_live_close',
  'portfolio_live_leverage', 'portfolio_live_move', 'portfolio_live_earn', 'portfolio_pay', 'portfolio_order', 'portfolio_execute', 'portfolio_transfer'];

const NOW = 1_760_000_000_000;
const frames = readFileSync(new URL('../fixtures/events.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l));
// the fixture in order, as the live layer feeds it: remember every call, then map
const calls = new Map();
const out = frames.map(frame => { rememberCall(calls, frame); return toMessages(mapFrame(frame), calls, NOW); });
const one = i => { assert.equal(out[i].length, 1, `line ${i + 1} gives one message`); return out[i][0]; };

test('the order tools match by raw name or minted name, the read-only orders listing never', () => {
  assert.deepEqual([...ORDER_TOOLS], ['place_order', 'cancel_order', ...SEAT]);
  assert.deepEqual([...SEAT_TOOLS], SEAT);
  assert.ok(isOrderTool('place_order') && isOrderTool('mcp__alpaca-kit__cancel_order'));
  assert.ok(!isOrderTool('orders') && !isOrderTool('mcp__alpaca-kit__orders') && !isOrderTool('bash'));
  assert.ok(isOrderTool('mcp__account__portfolio_live_order') && isSeatWriteTool('mcp__broker__portfolio_pay'));
  assert.ok(!isOrderTool('mcp__account__portfolio_account') && !isSeatWriteTool('mcp__alpaca-kit__place_order'));
});

test('seatLine words a seat write from its arguments', () => {
  const order = a => seatLine('mcp__account__portfolio_live_order', a);
  assert.equal(order({ venue: 'paper-1', symbol: 'AAPL', side: 'buy', usd: 100, orderType: 'market' }), 'buy $100 of AAPL · market · paper-1');
  assert.equal(order({ venue: 'paper-1', symbol: 'AAPL', side: 'sell', qty: 10, orderType: 'limit', limitPrice: 187.4 }), 'sell 10 AAPL · limit 187.4 · paper-1');
  assert.equal(order({ venue: 'paper-1', symbol: 'AAPL', side: 'buy', qty: 1 }), 'buy 1 AAPL · market · paper-1');
  assert.equal(order({ venue: 'paper-1', symbol: 'AAPL', side: 'sell', qty: 1, orderType: 'stop_limit', stopPrice: 150, limitPrice: 148 }), 'sell 1 AAPL · stop 150 limit 148 · paper-1');
  assert.equal(order({ venue: 'paper-1', symbol: 'AAPL', side: 'sell', qty: 1, orderType: 'trailing_stop', trailPercent: 2 }), 'sell 1 AAPL · trailing 2% · paper-1');
  assert.equal(seatLine('mcp__account__portfolio_live_cancel', { venue: 'paper-1', order: 'ord-0001' }), 'cancel ord-0001 · paper-1');
  assert.equal(seatLine('mcp__account__portfolio_live_amend', { venue: 'paper-1', order: 'ord-0001', qty: 5 }), 'amend ord-0001 · paper-1');
  assert.equal(seatLine('mcp__account__portfolio_live_close', { venue: 'paper-1', symbol: 'AAPL' }), 'close AAPL · paper-1');
  assert.equal(seatLine('mcp__account__portfolio_live_close', { venue: 'paper-1', symbol: 'AAPL', qty: 5 }), 'close 5 AAPL · paper-1');
  assert.equal(seatLine('mcp__account__portfolio_live_leverage', { venue: 'paper-1', symbol: 'BTC', leverage: 5 }), 'leverage BTC 5x · paper-1');
  assert.equal(seatLine('mcp__account__portfolio_live_move', { kind: 'withdraw', from: 'okx', asset: 'USDC', amount: 50 }), 'move 50 USDC · withdraw from okx');
  assert.equal(seatLine('mcp__account__portfolio_live_move', { kind: 'send', from: 'wallet', asset: 'USDC', amount: 5, to: '0xabc' }), 'move 5 USDC · send from wallet to 0xabc');
  assert.equal(seatLine('mcp__account__portfolio_live_earn', { venue: 'okx', kind: 'supply', product: 'simple', asset: 'USDC', amount: 100 }), 'earn supply 100 USDC · okx');
  assert.equal(seatLine('mcp__account__portfolio_pay', { url: 'https://api.example.com/v1/x', maxAmount: 2, from: 'agent-1' }), 'pay up to $2 · api.example.com');
  assert.equal(seatLine('mcp__account__portfolio_live_batch', { legs: [{}, {}, {}] }), 'batch · 3 legs');
  assert.equal(seatLine('mcp__account__portfolio_order', { base: 'BTC', side: 'buy', qty: 1 }), 'buy 1 BTC');
  assert.equal(seatLine('mcp__account__portfolio_transfer', { from: 'okx', to: 'kraken', amount: 50, token: 'USDC' }), 'transfer 50 USDC · okx to kraken');
  assert.equal(seatLine('mcp__account__portfolio_execute', { account: 'acc-1', intent: { kind: 'trade' } }), 'execute at acc-1');
  assert.equal(seatLine('mcp__account__portfolio_sweep', { venue: 'paper-1' }), 'portfolio_sweep · paper-1');
  assert.equal(seatLine('mcp__account__portfolio_sweep', {}), 'portfolio_sweep');
  assert.equal(seatLine('portfolio_live_cancel', { order: 'ord-2' }), 'cancel ord-2');
});

const seatCall = { type: 'session/event', sessionId: 's1', event: { type: 'tool/call', seq: 60, time: 1756512300000, data: { turn: 5, step: 1, callId: 'c10', name: 'mcp__account__portfolio_live_order', arguments: JSON.stringify({ venue: 'paper-1', symbol: 'AAPL', side: 'buy', usd: 100, orderType: 'market' }) } } };
const seatGate = { type: 'waterfall', event: 'approval/request', eventId: 'ev-10', agentId: 's1', request: { toolName: 'mcp__account__portfolio_live_order', callId: 'c10', reason: 'Account seat - mcp__account__portfolio_live_order: side=buy usd=100 symbol=AAPL orderType=market venue=paper-1', displayReason: 'Account seat - mcp__account__portfolio_live_order: side=buy usd=100 symbol=AAPL orderType=market venue=paper-1' } };
const seatResult = (text, isError, callId = 'c10') => ({ type: 'session/event', sessionId: 's1', event: { type: 'tool/result', seq: 61, time: 1756512301000, surfaceOp: 'append', data: { turn: 5, step: 1, message: { id: 'm-61', role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text }], isError } } } });
const seatCallAs = (callId, name, args) => ({ ...seatCall, event: { ...seatCall.event, data: { ...seatCall.event.data, callId, name, arguments: JSON.stringify(args) } } });

test('a seat order approval is the orange card with the seat line and the venue from its arguments', () => {
  const c = new Map();
  rememberCall(c, seatCall);
  const [card] = toMessages(mapFrame(seatGate), c, NOW);
  assert.equal(card.kind, 'card'); assert.equal(card.id, 'ev-10');
  assert.equal(card.text, 'Your call: buy $100 of AAPL · market · paper-1');
  assert.equal(card.data.venue, 'paper-1'); assert.match(card.data.line, /^Account seat - /);
  assert.equal(card.data.toolName, 'mcp__account__portfolio_live_order'); assert.equal(card.data.callId, 'c10');
  assert.deepEqual(card.data.args, { venue: 'paper-1', symbol: 'AAPL', side: 'buy', usd: 100, orderType: 'market' });
});

test('a seat tool without a venue, or one the face never classified, is a card at the Account seat', () => {
  const c = new Map();
  rememberCall(c, seatCallAs('c11', 'mcp__account__portfolio_pay', { url: 'https://api.example.com/v1/x', maxAmount: 2, from: 'agent-1' }));
  const [pay] = toMessages(mapFrame({ ...seatGate, eventId: 'ev-11', request: { ...seatGate.request, toolName: 'mcp__account__portfolio_pay', callId: 'c11' } }), c, NOW);
  assert.equal(pay.kind, 'card'); assert.equal(pay.text, 'Your call: pay up to $2 · api.example.com'); assert.equal(pay.data.venue, 'Account seat');
  // the host cards a seat tool it has not classified; the client follows the host
  const [unknown] = toMessages(mapFrame({ ...seatGate, eventId: 'ev-12', request: { ...seatGate.request, toolName: 'mcp__account__portfolio_sweep', callId: 'c12' } }), new Map(), NOW);
  assert.equal(unknown.kind, 'card'); assert.equal(unknown.text, 'Your call: mcp__account__portfolio_sweep'); assert.equal(unknown.data.venue, 'Account seat');
});

test("a seat write's result lifts a card-raised line, a placed or canceled order, the Account's refusal, or a batch count; a seat read lifts nothing", () => {
  const c = new Map();
  rememberCall(c, seatCall);
  const raised = toMessages(mapFrame(seatResult(JSON.stringify({ ok: true, pending: true, card: { id: 'card-0007', usd: 100 }, next: 'the owner answers this card on the Account page' }), false)), c, NOW);
  assert.equal(raised.length, 2); assert.equal(raised[0].kind, 'tool');
  assert.equal(raised[1].kind, 'receipt'); assert.equal(raised[1].id, 'rc10'); assert.equal(raised[1].from, 'gravit'); assert.equal(raised[1].seq, 61);
  assert.equal(raised[1].text, 'Card raised on the Account page · card-0007 · answer it there');
  assert.deepEqual(raised[1].data, { seat: true, cardId: 'card-0007', callId: 'c10' });
  const placed = toMessages(mapFrame(seatResult(JSON.stringify({ ok: true, order: { id: 'ord-0001', status: 'filled', paper: true } }), false)), c, NOW);
  assert.equal(placed[1].kind, 'receipt'); assert.equal(placed[1].text, 'Order placed · buy $100 of AAPL · market · paper-1 · ord-0001 · paper');
  assert.deepEqual(placed[1].data, { seat: true, orderId: 'ord-0001', callId: 'c10' });
  const real = toMessages(mapFrame(seatResult(JSON.stringify({ ok: true, order: { id: 'ord-0002', status: 'placed' } }), false)), c, NOW);
  assert.equal(real[1].text, 'Order placed · buy $100 of AAPL · market · paper-1 · ord-0002', 'no paper word without the flag');
  const refused = toMessages(mapFrame(seatResult(JSON.stringify({ ok: false, code: 'E_MANDATE_RECIPIENT', message: 'paper-1 is not in your limit' }), true)), c, NOW);
  assert.equal(refused[1].kind, 'refusal'); assert.equal(refused[1].text, 'E_MANDATE_RECIPIENT · paper-1 is not in your limit');
  assert.deepEqual(refused[1].data, { seat: true, toolName: 'mcp__account__portfolio_live_order', callId: 'c10' });
  const bare = toMessages(mapFrame(seatResult('the user rejected tool "mcp__account__portfolio_live_order"', true)), c, NOW);
  assert.equal(bare[1].kind, 'refusal'); assert.equal(bare[1].text, 'the user rejected tool "mcp__account__portfolio_live_order"');
  const b = new Map();
  rememberCall(b, seatCallAs('c13', 'mcp__account__portfolio_live_batch', { legs: [{}, {}, {}] }));
  const batch = toMessages(mapFrame(seatResult(JSON.stringify({ ok: true, legs: [{ leg: 1, ok: true, order: { id: 'ord-1' } }, { leg: 2, ok: false, code: 'E_X' }, { leg: 3, ok: true, order: { id: 'ord-2' } }] }), false, 'c13')), b, NOW);
  assert.equal(batch[1].kind, 'receipt'); assert.equal(batch[1].text, 'Batch · 2 of 3 legs placed');
  const r = new Map();
  rememberCall(r, seatCallAs('c14', 'mcp__account__portfolio_account', {}));
  assert.equal(toMessages(mapFrame(seatResult(JSON.stringify({ ok: true, seat: { name: 'Gravit' } }), false, 'c14')), r, NOW).length, 1, 'a read lifts nothing');
  const cancel = new Map();
  rememberCall(cancel, seatCallAs('c15', 'mcp__account__portfolio_live_cancel', { venue: 'paper-1', order: 'ord-0001' }));
  const canceled = toMessages(mapFrame(seatResult(JSON.stringify({ ok: true, order: { id: 'ord-0001', status: 'canceled', paper: true } }), false, 'c15')), cancel, NOW);
  assert.equal(canceled[1].text, 'Order canceled · cancel ord-0001 · paper-1 · ord-0001 · paper');
  const quiet = toMessages(mapFrame(seatResult(JSON.stringify({ ok: true, changed: false }), false)), c, NOW);
  assert.equal(quiet.length, 1, 'an answer that is neither a card, an order, a refusal nor a batch lifts nothing');
});

test('parseArgs reads JSON and tolerates anything else', () => {
  assert.deepEqual(parseArgs('{"a":1}'), { a: 1 });
  assert.deepEqual(parseArgs('nope'), {});
  assert.deepEqual(parseArgs(undefined), {});
});

test('orderLine words an order from its arguments', () => {
  assert.equal(orderLine({ side: 'buy', qty: 0.00008, symbol: 'BTC/USD', order_type: 'market' }), 'buy 0.00008 BTC/USD · market');
  assert.equal(orderLine({ side: 'sell', qty: 10, symbol: 'AAPL', order_type: 'limit', limit_price: 187.4 }), 'sell 10 AAPL · limit 187.4');
  assert.equal(orderLine({ order_id: 'ord-7' }), 'cancel ord-7');
});

test("the operator's words are a blue text message from you, dated by the event", () => {
  const m = one(0);
  assert.equal(m.kind, 'text'); assert.equal(m.from, 'you');
  assert.equal(m.text, '两个 pivot 今早都触发了');
  assert.equal(m.id, 'e4'); assert.equal(m.seq, 4); assert.equal(m.at, 1756512000000);
  assert.equal(m.replace, undefined);
});

test("Gravit's words are a text message flagged for markdown, the bot's words carry the bot's name", () => {
  const g = one(1);
  assert.equal(g.from, 'gravit'); assert.equal(g.kind, 'text'); assert.equal(g.text, 'Both pivots are technically valid.');
  assert.equal(g.data.markdown, true);
  const b = one(21);
  assert.equal(b.from, 'buffett'); assert.equal(b.kind, 'text'); assert.equal(b.data.name, '巴菲特型'); assert.equal(b.text, '买。理由：便宜。');
  // a member writes the same markdown Gravit does (news-scout's sources are [name](url) links): drawn as markdown
  // in a room as in its home session, as the old client drew it
  assert.equal(b.data.markdown, true);
});

test("in a bot's home session Gravit's role speaks as the bot", () => {
  const [m] = toMessages(mapFrame(frames[1]), new Map(), NOW, 'buffett');
  assert.equal(m.from, 'buffett');
});

test('a tool call is a collapsed tool row; its result merges into the same row', () => {
  const call = one(2);
  assert.equal(call.kind, 'tool'); assert.equal(call.id, 'tc1'); assert.equal(call.from, 'gravit');
  assert.equal(call.data.name, 'bash'); assert.equal(call.data.title, 'python -m alpaca_kit.breadth');
  assert.deepEqual(call.data.args, { command: 'python -m alpaca_kit.breadth' });
  const result = one(3);
  assert.equal(result.id, 'tc1'); assert.equal(result.merge, true); assert.equal(result.kind, 'tool');
  assert.equal(result.data.result, 'advancers 312 / decliners 188'); assert.equal(result.data.isError, false);
});

test('a failed read is a tool row in error, not a refusal: read is no order tool', () => {
  const r = one(14);
  assert.equal(r.kind, 'tool'); assert.equal(r.id, 'tc3'); assert.equal(r.merge, true); assert.equal(r.data.isError, true);
  assert.equal(r.data.result, 'ENOENT: no such file');
});

test('a context note and a compaction checkpoint are system lines; the checkpoint carries its replace range', () => {
  const note = one(13);
  assert.equal(note.from, 'system'); assert.equal(note.kind, 'text'); assert.equal(note.text, 'AGENTS.md changed on disk.');
  const cp = one(15);
  assert.equal(cp.from, 'system'); assert.deepEqual(cp.replace, { start: 4, end: 11 });
  assert.match(cp.text, /^Summary of the compacted range/);
});

test('a round end is a system line in the room helper\'s words; an @ keeps its mention', () => {
  const line = one(22);
  assert.equal(line.from, 'system'); assert.match(line.text, /^round 1 · settled · answered: 巴菲特型/);
  const at = one(23);
  assert.equal(at.from, 'you'); assert.deepEqual(at.data.mention, ['buffett']);
});

test('an approval of a non-order tool is a generic approval card keyed by its eventId, dated now', () => {
  const a = one(6);
  assert.equal(a.kind, 'approval'); assert.equal(a.id, 'ev-1'); assert.equal(a.at, NOW); assert.equal(a.from, 'gravit');
  assert.deepEqual(a.data, { eventId: 'ev-1', sessionId: 's1', toolName: 'bash', callId: 'c2', reason: 'shell command outside the allowlist', displayReason: undefined });
});

test('a question batch is one question card', () => {
  const q = one(7);
  assert.equal(q.kind, 'question'); assert.equal(q.id, 'ev-2'); assert.equal(q.data.sessionId, 's1');
  assert.equal(q.data.questions.length, 1); assert.equal(q.data.questions[0].id, 'q1');
});

test('pulses, projections, turns, gate settlements, snapshots and errors give no message', () => {
  for (const i of [4, 5, 8, 9, 17, 18, 19, 20, 25]) assert.deepEqual(out[i], [], `line ${i + 1}`);
});

const orderCall = { type: 'session/event', sessionId: 's1', event: { type: 'tool/call', seq: 40, time: 1756512200000, data: { turn: 4, step: 1, callId: 'c9', name: 'mcp__alpaca-kit__place_order', arguments: JSON.stringify({ symbol: 'BTC/USD', qty: 0.00008, side: 'buy', order_type: 'market' }) } } };
const orderGate = { type: 'waterfall', event: 'approval/request', eventId: 'ev-9', agentId: 's1', request: { toolName: 'mcp__alpaca-kit__place_order', callId: 'c9', reason: 'PAPER order - mcp__alpaca-kit__place_order: side=buy qty=0.00008 symbol=BTC/USD order_type=market', displayReason: 'PAPER order - mcp__alpaca-kit__place_order: side=buy qty=0.00008 symbol=BTC/USD order_type=market' } };
const orderResult = (text, isError) => ({ type: 'session/event', sessionId: 's1', event: { type: 'tool/result', seq: 41, time: 1756512201000, surfaceOp: 'append', data: { turn: 4, step: 1, message: { id: 'm-41', role: 'tool', source: { kind: 'tool', callId: 'c9' }, toolCallId: 'c9', content: [{ type: 'text', text }], isError } } } });

test('an order approval is the orange card with the exact arguments joined from its tool call', () => {
  const c = new Map();
  rememberCall(c, orderCall);
  const [row] = toMessages(mapFrame(orderCall), c, NOW);
  assert.equal(row.kind, 'tool');
  const [card] = toMessages(mapFrame(orderGate), c, NOW);
  assert.equal(card.kind, 'card'); assert.equal(card.id, 'ev-9'); assert.equal(card.at, NOW);
  assert.equal(card.text, 'Your call: buy 0.00008 BTC/USD · market');
  assert.equal(card.data.venue, 'Alpaca paper'); assert.equal(card.data.callId, 'c9'); assert.equal(card.data.sessionId, 's1');
  assert.equal(card.data.toolName, 'mcp__alpaca-kit__place_order');
  assert.match(card.data.line, /^PAPER order/);
});

test('an order approval whose call was never seen falls back to the tool name', () => {
  const [card] = toMessages(mapFrame(orderGate), new Map(), NOW);
  assert.equal(card.kind, 'card'); assert.equal(card.text, 'Your call: mcp__alpaca-kit__place_order');
});

test('an accepted order result is the tool row plus a green receipt; a failed one the row plus a red refusal', () => {
  const c = new Map();
  rememberCall(c, orderCall);
  const ok = toMessages(mapFrame(orderResult(JSON.stringify({ ok: true, id: 'ord-1', status: 'accepted' }), false)), c, NOW);
  assert.equal(ok.length, 2);
  assert.equal(ok[0].kind, 'tool'); assert.equal(ok[0].id, 'tc9');
  assert.equal(ok[1].kind, 'receipt'); assert.equal(ok[1].id, 'rc9'); assert.equal(ok[1].from, 'gravit');
  assert.equal(ok[1].text, 'Order accepted · buy 0.00008 BTC/USD · market · ord-1'); assert.equal(ok[1].data.orderId, 'ord-1');
  assert.equal(ok[1].seq, 41); assert.equal(ok[1].at, 1756512201000);
  const bad = toMessages(mapFrame(orderResult('the user rejected tool "mcp__alpaca-kit__place_order"', true)), c, NOW);
  assert.equal(bad.length, 2);
  assert.equal(bad[1].kind, 'refusal'); assert.equal(bad[1].id, 'rc9'); assert.equal(bad[1].text, 'the user rejected tool "mcp__alpaca-kit__place_order"');
});

test("a result row carries the call's name and arguments", () => {
  const known = new Map();
  rememberCall(known, { type: 'session/event', sessionId: 's1', event: { type: 'tool/call', seq: 50, time: 1, data: { turn: 1, step: 1, callId: 'c50', name: 'mcp__alpaca-kit__screen', arguments: JSON.stringify({ kind: 'gainers' }) } } });
  const view = { kind: 'card', seq: 51, time: 2, card: { callId: 'c50', phase: 'result', text: '{"ok":true,"rows":[]}', isError: false } };
  const [row] = toMessages(view, known, NOW);
  assert.equal(row.kind, 'tool');
  assert.equal(row.data.name, 'mcp__alpaca-kit__screen');
  assert.deepEqual(row.data.args, { kind: 'gainers' });
  const [unknown] = toMessages({ ...view, card: { ...view.card, callId: 'c99' } }, known, NOW);
  assert.equal('name' in unknown.data, false, 'a result whose call was never seen carries no name');
});

test("a member's answer carries its member session and turn", () => {
  const [m] = toMessages({ kind: 'bubble', role: 'bot', bot: 'buffett', name: 'Buffett', text: 'Hold', seq: 9, time: 1, memberSessionId: 'm1', memberTurn: 3 }, new Map(), NOW);
  assert.equal(m.data.memberSessionId, 'm1'); assert.equal(m.data.memberTurn, 3);
  const [plain] = toMessages({ kind: 'bubble', role: 'bot', bot: 'buffett', name: 'Buffett', text: 'Hold', seq: 9, time: 1 }, new Map(), NOW);
  assert.equal('memberSessionId' in plain.data, false);
});
