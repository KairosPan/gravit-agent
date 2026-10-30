// The thread draws the kind table (spec 2026-10-19 §6) on host-shaped messages: text, tool, card, approval, question, receipt, refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMessage, renderThread, setMarkdown, chip, key, ticker, withTickers } from '../../client/js/render/thread.js';
import { emptyState } from '../../client/js/data/empty.js';
import { MIN } from '../../client/js/time.js';

const NOW = new Date(2026, 9, 19, 14, 7).getTime();
const state = emptyState();
const conv = (over = {}) => ({ id: 's1', title: 'T', kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: true, updatedAt: 5, created: null, messages: [], loaded: true, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const msg = (over = {}) => ({ id: 'e1', seq: 1, at: NOW, from: 'gravit', kind: 'text', text: 'hello', data: {}, ...over });
const gate = (kind, over = {}) => msg({ id: 'ev-1', seq: 1.5, kind, from: 'gravit', text: 'Your call: buy $10 of BTC/USD · market · paper-1', data: { eventId: 'ev-1', sessionId: 's1', toolName: 'mcp__account__portfolio_live_order', callId: 'c9', venue: 'paper-1', line: 'Account seat - mcp__account__portfolio_live_order: side=buy usd=10 symbol=BTC/USD venue=paper-1' }, ...over });

test("the operator's words are a blue bubble on the right, Gravit's a grey one on the left, a system line is centred", () => {
  const you = renderMessage(msg({ from: 'you', text: 'hi there' }), conv(), state);
  assert.match(you, /class="msg you"/); assert.match(you, /bubble you/); assert.match(you, /hi there/);
  const g = renderMessage(msg(), conv(), state);
  assert.match(g, /class="msg left"/); assert.match(g, /bubble grey/); assert.doesNotMatch(g, /sender-name/);
  assert.equal(renderMessage(msg({ from: 'system', text: 'round 1 · settled' }), conv(), state), '<div class="sysline">round 1 · settled</div>');
});

test('an injected context row (a system message with a source) is a collapsed details headed by its source; a room line stays a centred line', () => {
  const ctx = renderMessage(msg({ from: 'system', text: 'AGENTS.md changed on disk.\n<system-reminder>…</system-reminder>', data: { source: 'plugin:fs-observation' } }), conv(), state);
  assert.match(ctx, /^<details class="sysline ctx"><summary>context · plugin:fs-observation<\/summary><pre>AGENTS\.md changed on disk\.\n&lt;system-reminder&gt;…&lt;\/system-reminder&gt;<\/pre><\/details>$/);
  assert.doesNotMatch(ctx, /open/, 'closed until the operator opens it');
  assert.equal(renderMessage(msg({ from: 'system', text: 'round 1 · settled', data: {} }), conv(), state), '<div class="sysline">round 1 · settled</div>');
});

test("a bot's words in a group carry the sender's name from the message", () => {
  const html = renderMessage(msg({ from: 'buffett', text: '买。', data: { name: '巴菲特型' } }), conv({ kind: 'group', members: ['gravit', 'buffett'] }), state);
  assert.match(html, /sender-name">巴菲特型</);
  assert.match(html, /bubble grey/);
});

test("Gravit's text renders through the markdown hook when one is set, escaped otherwise; an interrupted answer is cut-marked", () => {
  setMarkdown(null);
  const plain = renderMessage(msg({ text: 'a <b>bold</b> claim', data: { markdown: true } }), conv(), state);
  assert.match(plain, /a &lt;b&gt;bold&lt;\/b&gt; claim/);
  setMarkdown(text => `<p>${text.toUpperCase()}</p>`);
  const rich = renderMessage(msg({ text: 'hello', data: { markdown: true } }), conv(), state);
  assert.match(rich, /<p>HELLO<\/p>/);
  const you = renderMessage(msg({ from: 'you', text: 'hello' }), conv(), state);
  assert.doesNotMatch(you, /HELLO/, 'only Gravit speaks markdown');
  setMarkdown(null);
  const cut = renderMessage(msg({ text: 'The first pivot looks like', data: { markdown: true, interrupted: true } }), conv(), state);
  assert.match(cut, /class="cut">Interrupted</);
});

test('a tool call draws nothing, whatever its state: running, done or failed', () => {
  const running = renderMessage(msg({ id: 'tc1', kind: 'tool', text: 'python -m alpaca_kit.breadth', data: { callId: 'c1', name: 'bash', title: 'python -m alpaca_kit.breadth', args: {} } }), conv(), state);
  const done = renderMessage(msg({ id: 'tc1', kind: 'tool', text: 'python -m alpaca_kit.breadth', data: { callId: 'c1', name: 'bash', result: 'advancers 312 <ok>', isError: false } }), conv(), state);
  const bad = renderMessage(msg({ id: 'tc3', kind: 'tool', text: 'read', data: { callId: 'c3', result: 'ENOENT', isError: true } }), conv(), state);
  const json = renderMessage(msg({ id: 'tc5', kind: 'tool', text: 'market_snapshot', data: { callId: 'c5', name: 'mcp__alpaca-kit__market_snapshot', result: JSON.stringify({ ok: true }), isError: false } }), conv(), state);
  assert.deepEqual([running, done, bad, json], ['', '', '', '']);
});

test('the order card carries its title, the venue line, and Decline then Approve keys that answer rejected and allowed-once', () => {
  const html = renderMessage(gate('card'), conv(), state);
  assert.match(html, /card orange/); assert.match(html, /card-title">Your call: buy \$10 of BTC\/USD · market · paper-1</);
  assert.match(html, /paper-1 · Account seat - mcp__account__portfolio_live_order: side=buy/);
  const keys = [...html.matchAll(/data-action="answer"[^>]*data-value="([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(keys, ['rejected', 'allowed-once']);
  assert.match(html, /aria-label="Decline"/); assert.match(html, /aria-label="Approve"/);
  assert.match(html, /data-conv="s1"/); assert.match(html, /data-msg="ev-1"/);
});

test("a seat card's dim line is the argument's venue and the seat's reason", () => {
  const html = renderMessage(gate('card', { text: 'Your call: buy $100 of AAPL · market · paper-1', data: { eventId: 'ev-1', sessionId: 's1', toolName: 'mcp__account__portfolio_live_order', callId: 'c10', venue: 'paper-1', line: 'Account seat - portfolio_live_order: side=buy' } }), conv(), state);
  assert.match(html, /card-title">Your call: buy \$100 of AAPL · market · paper-1</);
  assert.match(html, /paper-1 · Account seat - portfolio_live_order: side=buy/);
  const keys = [...html.matchAll(/data-action="answer"[^>]*data-value="([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(keys, ['rejected', 'allowed-once']);
});

test('an answered gate shows its end state in the old client\'s four words and no keys', () => {
  for (const [answer, word] of [['approved', 'Approved'], ['rejected', 'Declined'], ['closed', 'Closed'], ['elsewhere', 'Settled elsewhere'], ['answered', 'Answered']]) {
    const html = renderMessage(gate('card', { answer }), conv(), state);
    assert.match(html, new RegExp(`class="chip [a-z]+">${word}<`), answer);
    assert.doesNotMatch(html, /data-action="answer"/, answer);
  }
});

test('a generic approval names the tool and shows the display reason, with the audit reason only when it differs', () => {
  const same = renderMessage(gate('approval', { text: 'shell command outside the allowlist', data: { eventId: 'ev-1', sessionId: 's1', toolName: 'bash', reason: 'shell command outside the allowlist', displayReason: undefined } }), conv(), state);
  assert.match(same, /card-title">bash</); assert.match(same, /shell command outside the allowlist/);
  assert.equal((same.match(/shell command outside the allowlist/g) ?? []).length, 1);
  const two = renderMessage(gate('approval', { text: 'Run ls?', data: { eventId: 'ev-1', sessionId: 's1', toolName: 'bash', reason: 'audit: ls', displayReason: 'Run ls?' } }), conv(), state);
  assert.match(two, /Run ls\?/); assert.match(two, /dim">audit: ls</);
  assert.match(two, /data-value="allowed-once"/);
});

test('a question card lists each question with inputs named by the gate and the question, radio or checkbox by multiSelect, a free answer beside every question, and one Answer key', () => {
  const questions = [
    { id: 'q1', question: 'Pin the paper account before the drill?', header: 'Gate 2', options: [{ label: 'Yes, pin it' }, { label: 'No, keep replay-only', description: 'stay offline' }] },
    { id: 'q2', question: 'Which symbols?', options: [{ label: 'AAPL' }, { label: 'NVDA' }], multiSelect: true },
    { id: 'q3', question: 'Anything else?' },
  ];
  const html = renderMessage(gate('question', { text: '', data: { eventId: 'ev-2', sessionId: 's1', questions } }), conv(), state);
  assert.match(html, /class="card orange question" data-gate="ev-1"/);
  assert.match(html, /card-title">Gate 2</); assert.match(html, /Pin the paper account before the drill\?/);
  assert.equal((html.match(/type="radio" id="q-ev-1-q1-\d" name="q-ev-1-q1"/g) ?? []).length, 2);
  assert.match(html, /type="radio" id="q-ev-1-q1-0" name="q-ev-1-q1" value="Yes, pin it"/);
  assert.match(html, /stay offline/);
  assert.equal((html.match(/type="checkbox" id="q-ev-1-q2-\d" name="q-ev-1-q2"/g) ?? []).length, 2);
  // the free answer is dsh's `custom`, open beside a menu too: the operator is never forced onto a wrong option
  assert.match(html, /type="text" id="q-ev-1-q1-custom" name="q-ev-1-q1-custom" placeholder="Other…"/);
  assert.match(html, /type="text" id="q-ev-1-q2-custom" name="q-ev-1-q2-custom" placeholder="Other…"/);
  assert.match(html, /type="text" id="q-ev-1-q3-custom" name="q-ev-1-q3-custom" placeholder="Your answer"/);
  assert.equal((html.match(/data-action="answerQuestion"/g) ?? []).length, 1);
  assert.match(html, /data-msg="ev-1"/);
  // a second pending card asking the same question id is its own radio group
  const other = renderMessage(gate('question', { id: 'ev-7', text: '', data: { eventId: 'ev-7', sessionId: 's1', questions } }), conv(), state);
  assert.match(other, /type="radio" id="q-ev-7-q1-0" name="q-ev-7-q1"/);
  assert.doesNotMatch(other, /name="q-ev-1-/);
  const answered = renderMessage(gate('question', { text: '', answer: 'answered', data: { eventId: 'ev-2', sessionId: 's1', questions } }), conv(), state);
  assert.doesNotMatch(answered, /data-action="answerQuestion"/);
  assert.match(answered, />Answered</);
});

test('a receipt is a green bubble, a refusal a red card', () => {
  const r = renderMessage(msg({ id: 'rc9', kind: 'receipt', text: 'Order accepted · buy 0.00008 BTC/USD · market · ord-1', data: { orderId: 'ord-1' } }), conv(), state);
  assert.match(r, /bubble green/); assert.match(r, /Order accepted · buy 0.00008 BTC\/USD · market · ord-1/);
  const x = renderMessage(msg({ id: 'rc9', kind: 'refusal', text: 'the user rejected tool "place_order"', data: {} }), conv(), state);
  assert.match(x, /card red/); assert.match(x, /the user rejected tool &quot;place_order&quot;/);
});

test('the thread draws a divider after a 15-minute gap and the thinking row only while the conversation thinks', () => {
  const messages = [msg({ id: 'e1', seq: 1, at: NOW - 40 * MIN, from: 'you', text: 'a' }), msg({ id: 'e2', seq: 2, at: NOW, text: 'b' })];
  const quiet = renderThread(conv({ messages }), state, NOW);
  assert.equal((quiet.match(/class="divider"/g) ?? []).length, 2, 'one before the first message, one after the gap');
  assert.doesNotMatch(quiet, /thinking/);
  const busy = renderThread(conv({ messages, thinking: 'reasoning' }), state, NOW);
  assert.match(busy, /class="bubble grey thinking"/);
  assert.ok(busy.lastIndexOf('thinking') > busy.lastIndexOf('>b<'), 'the thinking row comes last');
});

test('the thread draws no tool row: a receipt the call raised stays, and a divider reads the gap between the rows it draws', () => {
  const tool = msg({ id: 'tc1', seq: 2, at: NOW - 30 * MIN, kind: 'tool', text: 'mcp__account__portfolio_explore', data: { callId: 'c1', name: 'mcp__account__portfolio_explore', result: '{"ok":true}', isError: false } });
  const failed = msg({ id: 'tc2', seq: 3, at: NOW - 30 * MIN, kind: 'tool', text: 'read', data: { callId: 'c2', result: 'ENOENT', isError: true } });
  const running = msg({ id: 'tc3', seq: 4, at: NOW - 30 * MIN, kind: 'tool', text: 'bash', data: { callId: 'c3', name: 'bash', args: {} } });
  const receipt = msg({ id: 'r1', seq: 5, at: NOW - 20 * MIN, kind: 'receipt', text: 'Order placed', data: { status: 'accepted' } });
  const h = renderThread(conv({ messages: [msg({ id: 'e1', seq: 1, at: NOW - 40 * MIN, from: 'you', text: 'a' }), tool, failed, running, receipt] }), state, NOW);
  assert.doesNotMatch(h, /class="tool|tool-name|portfolio_explore|ENOENT|running/);
  assert.match(h, /class="bubble green"/);
  assert.equal((h.match(/class="divider"/g) ?? []).length, 2, 'one before the first message, one for the 20 minutes between the two rows drawn');
});

test('helpers: chip, key, ticker, withTickers', () => {
  assert.equal(chip('x', 'up'), '<span class="chip up">x</span>');
  assert.match(key('yes', 'Approve', { 'data-action': 'answer' }), /class="key yes" aria-label="Approve" data-action="answer"/);
  assert.match(ticker('BTC'), /href="#\/markets\/BTC"/);
  assert.match(withTickers('hold {{BTC}} & {{ETH}}'), /class="ticker" href="#\/markets\/BTC"/);
  assert.match(withTickers('a & b'), /a &amp; b/);
});

test("a member's answer offers Trace; Gravit's and the operator's do not", () => {
  const room = conv({ id: 'room', kind: 'group', members: ['gravit', 'buffett'] });
  const answer = msg({ id: 'e9', from: 'buffett', text: 'Hold', data: { name: 'Buffett', markdown: true, memberSessionId: 'm1', memberTurn: 3 } });
  const h = renderMessage(answer, room, state);
  assert.match(h, /<details id="trace-room-e9" class="trace"><summary data-action="openTrace" data-conv="room" data-msg="e9">Trace<\/summary>/);
  assert.doesNotMatch(renderMessage(msg({ id: 'e1', from: 'gravit', data: { markdown: true } }), room, state), /Trace/);
  assert.doesNotMatch(renderMessage(msg({ id: 'e2', from: 'you', text: 'hi' }), room, state), /Trace/);
  assert.doesNotMatch(renderMessage(msg({ id: 'e3', from: 'buffett', text: 'x', data: { name: 'Buffett' } }), room, state), /Trace/, 'an answer with no member turn has none');
});

test('a loaded trace draws its context lines and words, no tool call; loading and failure say so', () => {
  const room = conv({ id: 'room', kind: 'group', members: ['gravit', 'buffett'] });
  const answer = msg({ id: 'e9', from: 'buffett', text: 'Hold', data: { name: 'Buffett', memberSessionId: 'm1', memberTurn: 3 } });
  const tool = msg({ id: 'tmc1', seq: 11, kind: 'tool', text: 'account', data: { callId: 'mc1', name: 'mcp__alpaca-kit__account', result: '{"ok":true,"equity":"100"}', isError: false } });
  const failed = msg({ id: 'tmc2', seq: 12, kind: 'tool', text: 'read', data: { callId: 'mc2', result: 'ENOENT', isError: true } });
  const ctx = msg({ id: 'e10', seq: 10, from: 'system', text: 'round 1' });
  const words = msg({ id: 'e13', seq: 13, from: 'buffett', text: 'Checked the book' });
  const loaded = renderMessage(answer, room, { ...state, traces: { room: { e9: { status: 'ready', messages: [ctx, tool, failed, words] } } } });
  assert.match(loaded, /class="trace-body"><div class="sysline">round 1<\/div><div class="dsec-line">Checked the book<\/div><\/div>/);
  assert.doesNotMatch(loaded, /class="tool|tool-mc|account|equity|ENOENT/, 'no tool call, not even a failed one');
  assert.match(renderMessage(answer, room, { ...state, traces: { room: { e9: { status: 'ready', messages: [tool, failed] } } } }), /No steps/, 'a turn of tool calls alone has no steps to show');
  assert.match(renderMessage(answer, room, { ...state, traces: { room: { e9: { status: 'loading' } } } }), /trace-body[^>]*>[\s\S]*?Loading…/);
  assert.match(renderMessage(answer, room, { ...state, traces: { room: { e9: { status: 'failed', line: 'The member session does not exist.' } } } }), /The member session does not exist\./);
  assert.match(renderMessage(answer, room, { ...state, traces: { room: { e9: { status: 'ready', messages: [] } } } }), /No steps/);
  // another room's answer with the same message id is not this one's
  const other = renderMessage(answer, conv({ id: 'room2', kind: 'group', members: ['gravit', 'buffett'] }), { ...state, traces: { room: { e9: { status: 'ready', messages: [ctx, words] } } } });
  assert.match(other, /<details id="trace-room2-e9" class="trace">/);
  assert.doesNotMatch(other, /Checked the book/);
});
