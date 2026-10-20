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
const gate = (kind, over = {}) => msg({ id: 'ev-1', seq: 1.5, kind, from: 'gravit', text: 'Your call: buy 0.00008 BTC/USD · market', data: { eventId: 'ev-1', sessionId: 's1', toolName: 'mcp__alpaca-kit__place_order', callId: 'c9', venue: 'Alpaca paper', line: 'PAPER order - place_order: side=buy' }, ...over });

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

test('a tool row is a collapsed details titled by the call; the result fills a pre; an error is marked danger', () => {
  const call = renderMessage(msg({ id: 'tc1', kind: 'tool', text: 'python -m alpaca_kit.breadth', data: { callId: 'c1', name: 'bash', title: 'python -m alpaca_kit.breadth', args: {} } }), conv(), state);
  assert.match(call, /<details class="tool"><summary>/); assert.match(call, /tool-name">python -m alpaca_kit.breadth</); assert.match(call, /running/);
  assert.doesNotMatch(call, /<pre>/);
  const done = renderMessage(msg({ id: 'tc1', kind: 'tool', text: 'python -m alpaca_kit.breadth', data: { callId: 'c1', name: 'bash', result: 'advancers 312 <ok>', isError: false } }), conv(), state);
  assert.match(done, /<pre>advancers 312 &lt;ok&gt;<\/pre>/); assert.doesNotMatch(done, /running/);
  const bad = renderMessage(msg({ id: 'tc3', kind: 'tool', text: 'read', data: { callId: 'c3', result: 'ENOENT', isError: true } }), conv(), state);
  assert.match(bad, /<details class="tool danger">/);
  assert.match(call, /msg-body wide/);
});

test('the order card carries its title, the venue line, and Decline then Approve keys that answer rejected and allowed-once', () => {
  const html = renderMessage(gate('card'), conv(), state);
  assert.match(html, /card orange/); assert.match(html, /card-title">Your call: buy 0.00008 BTC\/USD · market</);
  assert.match(html, /Alpaca paper · PAPER order - place_order: side=buy/);
  const keys = [...html.matchAll(/data-action="answer"[^>]*data-value="([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(keys, ['rejected', 'allowed-once']);
  assert.match(html, /aria-label="Decline"/); assert.match(html, /aria-label="Approve"/);
  assert.match(html, /data-conv="s1"/); assert.match(html, /data-msg="ev-1"/);
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

test('a question card lists each question with inputs named by its id, radio or checkbox by multiSelect, a text box without options, and one Answer key', () => {
  const questions = [
    { id: 'q1', question: 'Pin the paper account before the drill?', header: 'Gate 2', options: [{ label: 'Yes, pin it' }, { label: 'No, keep replay-only', description: 'stay offline' }] },
    { id: 'q2', question: 'Which symbols?', options: [{ label: 'AAPL' }, { label: 'NVDA' }], multiSelect: true },
    { id: 'q3', question: 'Anything else?' },
  ];
  const html = renderMessage(gate('question', { text: '', data: { eventId: 'ev-2', sessionId: 's1', questions } }), conv(), state);
  assert.match(html, /card orange question/);
  assert.match(html, /card-title">Gate 2</); assert.match(html, /Pin the paper account before the drill\?/);
  assert.equal((html.match(/type="radio" name="q-q1"/g) ?? []).length, 2);
  assert.match(html, /stay offline/);
  assert.equal((html.match(/type="checkbox" name="q-q2"/g) ?? []).length, 2);
  assert.match(html, /type="text" name="q-q3-custom"/);
  assert.equal((html.match(/data-action="answerQuestion"/g) ?? []).length, 1);
  assert.match(html, /data-msg="ev-1"/);
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

test('helpers: chip, key, ticker, withTickers', () => {
  assert.equal(chip('x', 'up'), '<span class="chip up">x</span>');
  assert.match(key('yes', 'Approve', { 'data-action': 'answer' }), /class="key yes" aria-label="Approve" data-action="answer"/);
  assert.match(ticker('BTC'), /href="#\/markets\/BTC"/);
  assert.match(withTickers('hold {{BTC}} & {{ETH}}'), /class="ticker" href="#\/markets\/BTC"/);
  assert.match(withTickers('a & b'), /a &amp; b/);
});
