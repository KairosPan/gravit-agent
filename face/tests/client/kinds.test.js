// The kind table (spec 2026-10-19 §6): a mapper view becomes zero, one or two gravit-ui messages.
// Driven by the hand-kept frame fixture the wire tests share, so a shape the host changes breaks here too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapFrame } from '../../client/js/wire/mapper.js';
import { ORDER_TOOLS, isOrderTool, parseArgs, orderLine, rememberCall, toMessages } from '../../client/js/host/kinds.js';

const NOW = 1_760_000_000_000;
const frames = readFileSync(new URL('../fixtures/events.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l));
// the fixture in order, as the live layer feeds it: remember every call, then map
const calls = new Map();
const out = frames.map(frame => { rememberCall(calls, frame); return toMessages(mapFrame(frame), calls, NOW); });
const one = i => { assert.equal(out[i].length, 1, `line ${i + 1} gives one message`); return out[i][0]; };

test('the order tools match by raw name or minted name, the read-only orders listing never', () => {
  assert.deepEqual([...ORDER_TOOLS], ['place_order', 'cancel_order']);
  assert.ok(isOrderTool('place_order') && isOrderTool('mcp__alpaca-kit__cancel_order'));
  assert.ok(!isOrderTool('orders') && !isOrderTool('mcp__alpaca-kit__orders') && !isOrderTool('bash'));
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
