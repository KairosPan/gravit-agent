// The thread draws the kind table (spec 2026-10-19 §6) on host-shaped messages: text, tool, card, approval, question, receipt, refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMessage, renderThread, setMarkdown, chip, key, ticker, withTickers, thumbsNeeded } from '../../client/js/render/thread.js';
import { emptyState } from '../../client/js/data/empty.js';
import { MIN } from '../../client/js/time.js';
import { sessionUri } from '../../client/js/composer/draft.js';

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

test("the operator's bubble draws a conversation mention as a chip, and a file or bot reference as its text", () => {
  const text = `ask @news-scout about @strategies/a.md and @[估值 \\[v2\\] a\\\\b <x>](${sessionUri('s9')}) now`;
  const h = renderMessage(msg({ from: 'you', text }), conv(), state);
  assert.match(h, /bubble you">ask @news-scout about @strategies\/a\.md and <span class="ref-chip">/);
  const chipHtml = h.match(/<span class="ref-chip">([\s\S]*?)<\/span><\/span>/)?.[1];
  assert.ok(chipHtml, 'a chip');
  assert.match(chipHtml, /<svg/, 'the chat icon');
  assert.match(chipHtml, /<span class="ref-chip-label">估值 \[v2\] a\\b &lt;x&gt;$/);
  assert.doesNotMatch(h, /contenteditable/);
  assert.doesNotMatch(h, /dsh-session:/, 'the URI is not drawn');
  assert.match(h, /<\/span><\/span> now<\/div>/);
  // a malformed mention stays text, escaped
  assert.match(renderMessage(msg({ from: 'you', text: '@[x](dsh-session:!!) <b>' }), conv(), state), /@\[x\]\(dsh-session:!!\) &lt;b&gt;/);
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

// plan 2 of the Lunhui run view, task 4: Gravit's composed answer, its working notes folded above it
const RUN = '20261027T201627Z-6937d208';
const KEY = `cn-market/${RUN}/environment,sentiment`;
const composed = (over = {}) => msg({ id: 'p7', seq: 7, kind: 'composed', text: '弱势日，<b>跌多</b>涨少。', data: { callId: '7', strategy: 'cn-market', run: RUN, summary: '弱势日，<b>跌多</b>涨少。', blocks: [{ kind: 'breadth', title: '涨跌<i>分布</i>' }, { kind: 'ladder' }, { kind: 'sources' }], choices: [], modules: ['environment', 'sentiment'] }, ...over });
const turn = () => [
  msg({ id: 'e1', seq: 1, from: 'you', text: 'how was the market?' }),
  msg({ id: 'e2', seq: 2, text: 'Reading the run.', data: { markdown: true } }),
  msg({ id: 'tc3', seq: 3, kind: 'tool', text: '', data: { callId: '3', name: 'lunhui_read_run' } }),
  msg({ id: 'e4', seq: 4, text: 'Breadth is weak.', data: { markdown: true } }),
  msg({ id: 'e5', seq: 5, text: 'Composing.', data: { markdown: true } }),
  composed(),
];
const withView = entry => ({ ...state, lunhui: { views: entry ? { [KEY]: entry } : {}, ui: {} } });

test("the turn's Gravit words before a composed answer fold into one Working notes disclosure above it", async () => {
  const { foldNotes } = await import('../../client/js/render/lunhui/notes.js');
  assert.deepEqual([...foldNotes(turn())], [['p7', ['e2', 'e4', 'e5']]]);
  setMarkdown(null);
  const html = renderThread(conv({ id: 'c1', messages: turn() }), withView(null), NOW);
  assert.equal(html.match(/<details /g)?.length, 1);
  assert.match(html, /<details id="notes-c1-p7" class="notes"><summary>Working notes · 3<\/summary>/);
  const notes = html.indexOf('id="notes-c1-p7"');
  const body = html.indexOf('class="msg-body composed"');
  assert.ok(html.indexOf('how was the market?') < notes && notes < body, 'the notes sit between the question and the answer');
  for (const t of ['Reading the run.', 'Breadth is weak.', 'Composing.']) {
    assert.equal(html.split(t).length - 1, 1, `${t} is drawn once`);
    assert.ok(html.indexOf(t) > notes && html.indexOf(t) < body, `${t} is inside the notes`);
  }
});

test('words after a later operator message are not folded; the fold starts after the latest operator message before the answer', async () => {
  const { foldNotes } = await import('../../client/js/render/lunhui/notes.js');
  const later = [...turn(), msg({ id: 'e8', seq: 8, from: 'you', text: 'and the ladder?' }), msg({ id: 'e9', seq: 9, text: 'Looking again.', data: { markdown: true } })];
  assert.deepEqual([...foldNotes(later)], [['p7', ['e2', 'e4', 'e5']]]);
  const html = renderThread(conv({ id: 'c1', messages: later }), withView(null), NOW);
  assert.ok(html.indexOf('Looking again.') > html.indexOf('class="msg-body composed"'), 'drawn in its place, after the answer');
  const second = [msg({ id: 'e1', seq: 1, from: 'you', text: 'q' }), msg({ id: 'e2', seq: 2, text: 'only note', data: { markdown: true } }), composed({ id: 'p3', seq: 3 }), msg({ id: 'e4', seq: 4, from: 'you', text: 'again' }), composed({ id: 'p5', seq: 5 })];
  assert.deepEqual([...foldNotes(second)], [['p3', ['e2']], ['p5', []]]);
  assert.doesNotMatch(renderThread(conv({ id: 'c1', messages: second }), withView(null), NOW), /notes-c1-p5/, 'an answer with no notes has no disclosure');
});

test('the composed body: class msg-body composed, the summary escaped through the prose path, a skeleton line per block in order while loading', () => {
  setMarkdown(null);
  for (const entry of [null, { status: 'loading' }]) {
    const html = renderMessage(composed(), conv({ id: 'c1' }), withView(entry));
    assert.match(html, /class="msg-body composed"/);
    assert.match(html, /弱势日，&lt;b&gt;跌多&lt;\/b&gt;涨少。/);
    assert.doesNotMatch(html, /<b>|<i>/, 'no model markup reaches the page');
    const order = ['Drawing breadth…', 'Drawing the ladder…', 'Drawing the sources…'].map(t => html.indexOf(t));
    assert.ok(order.every(i => i > 0) && order[0] < order[1] && order[1] < order[2], 'one skeleton per block, in the call\'s order');
  }
  setMarkdown(text => `<p>${text.toUpperCase()}</p>`);
  assert.match(renderMessage(composed({ text: 'weak day' }), conv({ id: 'c1' }), withView(null)), /<p>WEAK DAY<\/p>/, 'the summary goes through the markdown renderer');
  setMarkdown(null);
  const loaded = renderMessage(composed(), conv({ id: 'c1' }), withView({ status: 'loaded', view: { strategy: 'cn-market' } }));
  assert.doesNotMatch(loaded, /Drawing /, 'loaded: no skeleton');
  assert.match(loaded, /涨跌&lt;i&gt;分布&lt;\/i&gt;/, "a block no drawer covers yet shows its title, escaped");
});

// plan 3, task 2: pool names in the summary and in the headlines are stock links; the rest is the markdown renderer's own
test('a composed answer links pool names in its summary and its titles', async () => {
  const { VIEW_1027 } = await import('./helpers/lunhui-view.js');
  setMarkdown(null);
  const m = composed({ text: '上海九百五连板，<b>样本</b>', data: { callId: '7', strategy: 'cn-market', run: RUN, summary: 'x', blocks: [{ kind: 'ladder', title: '上海九百领跑' }, { kind: 'breadth', title: '上海九百' }], choices: [], modules: ['environment', 'sentiment'] } });
  const html = renderMessage(m, conv({ id: 'c1' }), withView({ status: 'loaded', view: VIEW_1027 }));
  const link = `<button type="button" class="lh-stock" data-action="lunhuiStock" data-key="${KEY}" data-code="600001">上海九百</button>`;
  const summary = html.match(/<div class="lh-summary">([\s\S]*?)<\/div>/)[1];
  assert.equal(summary, `${link}五连板，&lt;b&gt;样本&lt;/b&gt;`);
  assert.ok(html.includes(`<div class="lh-title">${link}领跑</div>`), 'the ladder headline');
  assert.ok(html.includes(`<div class="lh-title">${link}</div>`), 'the breadth headline');
  assert.doesNotMatch(html, /<b>/, 'no model markup reaches the page');
});

test('a failed view: the summary, one error line and a Retry key naming the view, never a blank (Review Focus 3)', () => {
  setMarkdown(null);
  const html = renderMessage(composed(), conv({ id: 'c1' }), withView({ status: 'failed', error: 'HTTP <404>' }));
  assert.match(html, /弱势日/);
  assert.equal(html.split('The run view could not be loaded').length - 1, 1);
  assert.match(html, /The run view could not be loaded: HTTP &lt;404&gt;/);
  assert.match(html, new RegExp(`<button type="button" class="btn-sm" data-action="lunhuiRetry" data-key="${KEY.replace(/[.]/g, '\\.')}">Retry</button>`));
  assert.doesNotMatch(html, /Drawing /);
});

test('a refused lunhui_present call then an ok one in the same turn draws exactly one composed body (Review Focus 2)', async () => {
  const { toMessages, rememberCall } = await import('../../client/js/host/kinds.js');
  const { mapFrame } = await import('../../client/js/wire/mapper.js');
  const { reducers: R } = await import('../../client/js/reducers/index.js');
  const args = JSON.stringify({ strategy: 'cn-market', run: RUN, summary: '弱势日', blocks: [{ kind: 'sources' }] });
  const ev = (seq, event) => ({ type: 'session/event', sessionId: 'c1', event: { seq, time: NOW, ...event } });
  const callF = (seq, callId) => ev(seq, { type: 'tool/call', data: { turn: 1, step: seq, callId, name: 'lunhui_present', arguments: args } });
  const resultF = (seq, callId, text, isError) => ev(seq, { type: 'tool/result', surfaceOp: 'append', data: { turn: 1, step: seq, message: { id: `m-${seq}`, role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text }], isError } } });
  const frames = [callF(1, 'k1'), resultF(2, 'k1', 'Error: INVALID_PRESENT · numbers · 88.8%', true), callF(3, 'k2'), resultF(4, 'k2', JSON.stringify({ ok: true, blocks: ['sources'], modules: [] }), false)];
  const calls = new Map();
  let s = { ...state, conversations: [conv({ id: 'c1', messages: [] })] };
  for (const f of frames) { rememberCall(calls, f); for (const message of toMessages(mapFrame(f), calls, NOW)) s = R.hostEvent(s, { convId: 'c1', message }); }
  assert.deepEqual(s.conversations[0].messages.filter(m => m.kind === 'composed').map(m => m.id), ['pk2']);
  const html = renderThread(s.conversations[0], s, NOW);
  assert.equal(html.split('class="msg-body composed"').length - 1, 1);
  assert.doesNotMatch(html, /INVALID_PRESENT/, 'the refused tool row stays hidden');
});

// attachments in history (plan 4 Task 3): right-aligned above the operator's bubble
const PNG = (id, over = {}) => ({ type: 'image', attachmentId: id, mediaType: 'image/png', bytes: 1258291, width: 800, height: 600, name: id + '.png', ...over });
const CSV = { type: 'file', attachmentId: 'f1', name: 'q3.csv', bytes: 2936012 };
const thumbed = thumbs => ({ ...state, thumbs });
const you = (attachments, text = 'look') => msg({ from: 'you', text, data: { attachments } });

test('a lone image draws large, several draw as squares, a file as its card, all before the bubble', () => {
  const lone = renderMessage(you([PNG('i1')]), conv(), thumbed({ i1: 'data:image/png;base64,AA' }));
  assert.match(lone, /^<div class="msg you"><div class="you-body"><div class="you-files"><button type="button" class="you-image" data-action="openImage" data-attachment="i1" data-name="i1\.png" aria-label="i1\.png"><img src="data:image\/png;base64,AA" alt="i1\.png"><\/button><\/div><div class="bubble you">look<\/div><\/div>/);
  const many = renderMessage(you([PNG('i1'), PNG('i2'), CSV]), conv(), thumbed({ i1: 'data:image/png;base64,AA', i2: 'data:image/png;base64,BB' }));
  assert.equal((many.match(/class="you-thumb"/g) ?? []).length, 2);
  assert.doesNotMatch(many, /you-image/);
  assert.match(many, /data-action="openImage" data-attachment="i2" data-name="i2\.png"/);
  assert.match(many, /<div class="file-card"><span class="file-icon">[\s\S]*?<\/span><span class="file-name">q3\.csv<\/span><span class="file-meta">CSV · 2\.8 MB<\/span><\/div>/);
  assert.doesNotMatch(many, /attach-remove|attachRetry/, 'no remove key, no retry');
  assert.ok(many.indexOf('you-files') < many.indexOf('bubble you'), 'the attachments sit before the bubble');
  assert.match(renderMessage(msg({ from: 'you', text: 'hi there' }), conv(), state), /^<div class="msg you"><div class="bubble you">hi there<\/div>/, 'a message with none keeps its markup');
  assert.doesNotMatch(renderMessage(msg({ from: 'you', text: 'hi there' }), conv(), state), /you-body|you-files/);
});

test('an image-only message draws no empty bubble', () => {
  const h = renderMessage(you([PNG('i1')], ''), conv(), thumbed({ i1: 'data:image/png;base64,AA' }));
  assert.match(h, /you-image/);
  assert.doesNotMatch(h, /bubble/);
});

test('an image not loaded draws loading; one the host cannot give back, or offloaded, draws a card named Image', () => {
  const loading = renderMessage(you([PNG('i1')]), conv(), thumbed({}));
  assert.match(loading, /<button type="button" class="you-image loading" data-action="openImage" data-attachment="i1" data-name="i1\.png" aria-label="i1\.png"><\/button>/);
  const square = renderMessage(you([PNG('i1'), PNG('i2')]), conv(), thumbed({ i1: 'data:image/png;base64,AA' }));
  assert.match(square, /class="you-thumb loading" data-action="openImage" data-attachment="i2"/);
  const gone = renderMessage(you([PNG('i1', { name: undefined })]), conv(), thumbed({ i1: null }));
  assert.match(gone, /<span class="file-name">Image<\/span><span class="file-meta">PNG · 1\.2 MB<\/span>/);
  assert.doesNotMatch(gone, /openImage|<img/);
  const off = renderMessage(you([PNG('i1', { offloaded: true })]), conv(), thumbed({ i1: 'data:image/png;base64,AA' }));
  assert.match(off, /<span class="file-name">i1\.png<\/span><span class="file-meta">PNG · 1\.2 MB<\/span>/);
  assert.doesNotMatch(off, /openImage/);
  const esc = renderMessage(you([PNG('i"1', { name: '<b>.png' })]), conv(), thumbed({}));
  assert.match(esc, /data-attachment="i&quot;1" data-name="&lt;b&gt;\.png"/);
});

test('a thumb whose URL is not an inline image or an object URL draws the image as its card, never an img', () => {
  for (const src of ['https://x.test/a.png', 'data:text/html;base64,AA', 'data:image/svg+xml;base64,AA', 'javascript:alert(1)']) {
    const h = renderMessage(you([PNG('i1')]), conv(), thumbed({ i1: src }));
    assert.doesNotMatch(h, /<img|openImage/, src);
    assert.match(h, /<span class="file-name">i1\.png<\/span><span class="file-meta">PNG · 1\.2 MB<\/span>/, src);
  }
  assert.match(renderMessage(you([PNG('i1')]), conv(), thumbed({ i1: 'blob:http://127.0.0.1/1' })), /<img src="blob:http:\/\/127\.0\.0\.1\/1"/);
});

test("thumbsNeeded lists the conversation's images with no thumb, never an offloaded one", () => {
  const c = conv({ id: 's9', messages: [
    you([PNG('i1'), PNG('i2'), CSV]),
    msg({ id: 'e2', from: 'you', text: 'again', data: { attachments: [PNG('i3', { offloaded: true }), PNG('i4'), PNG('i1')] } }),
    msg({ id: 'e3', from: 'gravit', text: 'seen', data: { attachments: [PNG('i5')] } }),
  ] });
  assert.deepEqual(thumbsNeeded(c, { i2: null }), [{ sessionId: 's9', attachmentId: 'i1' }, { sessionId: 's9', attachmentId: 'i4' }]);
  assert.deepEqual(thumbsNeeded(conv(), {}), []);
});

// masking on screen (plan 5 Task 2, spec §5.9): the operator's own words only; the original stays in the raw run
const SK = 'sk-proj-aB3dE6fG9hJ2kL5mN8pQ1rS4';
const MASKED = 'sk-proj-' + '*'.repeat(SK.length - 8);
const SK2 = 'ghp_' + 'aB3dE6fG9h'.repeat(4);

test("the operator's key is drawn masked with its eye, the original in the raw run", () => {
  const h = renderMessage(msg({ id: 'e1', from: 'you', text: `use ${SK} now` }), conv(), state);
  assert.match(h, new RegExp(`bubble you">use <span class="secret" data-secret="e1-0"><span class="secret-raw" aria-hidden="true">${SK}</span><span class="secret-mask" role="img" aria-label="secret, hidden">sk-proj-\\*{${SK.length - 8}}</span></span>` +
    '<button type="button" class="secret-eye" id="secret-e1-0" data-action="toggleSecret" data-secret="e1-0" aria-label="Show secret"><svg width="14" height="14"'));
  assert.match(h, /<\/button> now<\/div>/);
  assert.ok(h.includes(MASKED));
});

test('two keys in one message are secrets 0 and 1; a revealed one draws Hide secret and no mask', () => {
  const m = msg({ id: 'ev-9', from: 'you', text: `${SK} and ${SK2}` });
  const h = renderThread(conv({ messages: [m] }), state, NOW, { revealed: new Set(['s1|ev-9|1']) });
  assert.match(h, /<span class="secret" data-secret="ev-9-0"><span class="secret-raw" aria-hidden="true">sk-proj-[^<]*<\/span><span class="secret-mask" role="img" aria-label="secret, hidden">/);
  assert.match(h, /id="secret-ev-9-0" data-action="toggleSecret" data-secret="ev-9-0" aria-label="Show secret"/);
  assert.match(h, new RegExp(`<span class="secret revealed" data-secret="ev-9-1"><span class="secret-raw">${SK2}</span></span><button type="button" class="secret-eye" id="secret-ev-9-1" data-action="toggleSecret" data-secret="ev-9-1" aria-label="Hide secret">`));
  assert.equal((h.match(/secret-mask/g) ?? []).length, 1, 'the revealed one has no mask');
  assert.equal((h.match(/aria-hidden="true">sk-proj-|aria-hidden="true">ghp_/g) ?? []).length, 1, 'only the masked one hides its raw run from a screen reader');
  // a reveal names its conversation: the same message id elsewhere stays masked
  const other = renderThread(conv({ id: 's2', messages: [m] }), state, NOW, { revealed: new Set(['s1|ev-9|1']) });
  assert.equal((other.match(/secret-mask/g) ?? []).length, 2);
  // no page argument: everything masked
  assert.equal((renderThread(conv({ messages: [m] }), state, NOW).match(/secret-mask/g) ?? []).length, 2);
});

test("a key in Gravit's bubble, a bot's, a context row and a composed answer is not masked", () => {
  const text = `the key ${SK}`;
  const plain = [
    renderMessage(msg({ text }), conv(), state),
    renderMessage(msg({ from: 'buffett', text, data: { name: 'B' } }), conv({ kind: 'group', members: ['gravit', 'buffett'] }), state),
    renderMessage(msg({ from: 'system', text, data: { source: 'runtime' } }), conv(), state),
    renderMessage(msg({ from: 'system', text }), conv(), state),
    renderMessage(msg({ kind: 'composed', text, data: { callId: '1', strategy: 'cn-market', run: 'r', summary: text, blocks: [], choices: [], modules: [] } }), conv(), state),
  ];
  for (const h of plain) {
    assert.doesNotMatch(h, /class="secret|secret-eye/);
    assert.ok(h.includes(SK));
  }
});

test("a conversation chip beside a key keeps its chip, and a secret's text is escaped", () => {
  const text = `@[Old](${sessionUri('s9')}) ${SK} https://me:p<b>w@host/x`;
  const h = renderMessage(msg({ id: 'e2', from: 'you', text }), conv(), state);
  assert.match(h, /<span class="ref-chip">/);
  assert.match(h, /data-secret="e2-0"><span class="secret-raw" aria-hidden="true">sk-proj-/);
  assert.match(h, /data-secret="e2-1"><span class="secret-raw" aria-hidden="true">p&lt;b&gt;w<\/span><span class="secret-mask" role="img" aria-label="secret, hidden">\*{5}<\/span>/);
  assert.doesNotMatch(h, /<b>/);
  assert.match(h, /https:\/\/me:<span class="secret"/);
});

// ---- the turn rail (plan 5, Task 7): the marks in the thread, the ticks, the card
const entry = (turn, seq, prompt = `prompt ${turn}`, response = `reply ${turn}`) => ({ turn, seq, prompt, response });
const said = (seq, from = 'you') => msg({ id: 'm' + seq, seq, from, text: 'said ' + seq });

test('a mark precedes each loaded turn\'s first message, an unloaded turn has none', () => {
  // turn 1 lies wholly before the window; turn 2's turn/start (12) is before the window's start (13) but its prompt is
  // drawn; turn 3 is inside; turn 4 has started with nothing drawn yet
  const c = conv({
    outline: [entry(1, 2), entry(2, 12), entry(3, 20), entry(4, 30)],
    window: { start: 13, through: 30, hasMore: true, replaced: [] },
    messages: [said(13), said(14, 'gravit'), said(21), said(22, 'gravit')],
  });
  const h = renderThread(c, state, NOW);
  assert.doesNotMatch(h, /id="turn-s1-1"/, 'nothing of turn 1 is drawn');
  assert.match(h, /<div class="turn-mark" id="turn-s1-2" data-turn="2"><\/div>(<div class="divider">[^<]*<\/div>)?<div class="msg you"><div class="bubble you">said 13/);
  assert.match(h, /said 14[\s\S]*<div class="turn-mark" id="turn-s1-3" data-turn="3"><\/div>[\s\S]*said 21/);
  assert.ok(h.endsWith('<div class="turn-mark" id="turn-s1-4" data-turn="4"></div>'), 'a loaded turn with nothing drawn goes at the end');
  assert.equal(h.match(/turn-mark/g).length, 3);
  // the whole log loaded: turn 1 has a mark too, before its first message
  const whole = renderThread(conv({ outline: [entry(1, 0), entry(2, 5)], messages: [said(1), said(6)] }), state, NOW);
  assert.match(whole, /^<div class="turn-mark" id="turn-s1-1" data-turn="1"><\/div>/);
});

test("the scroll keep's anchor is a data attribute: a folded notes block keeps its own id", () => {
  setMarkdown(null);
  const h = renderThread(conv({ id: 'c1', messages: turn() }), withView(null), NOW, { anchor: 6 });
  assert.match(h, /<details data-anchor id="notes-c1-p7" class="notes">/);
  assert.equal(h.match(/data-anchor/g).length, 1);
  assert.doesNotMatch(h, /thread-anchor/);
});

test('the rail draws a tick per turn, loaded and active as told, nothing under two turns', async () => {
  const { railHtml } = await import('../../client/js/render/thread.js');
  const c = conv({ outline: [entry(1, 2), entry(2, 14), entry(3, 20)], window: { start: 13, through: 30, hasMore: true, replaced: [] } });
  const h = railHtml(c, { active: 3 });
  assert.equal(h.match(/<div class="turn-row">/g).length, 3);
  assert.match(h, /<div class="turn-row"><button type="button" class="turn-tick" id="turn-tick-1" data-action="jumpTurn" data-turn="1" aria-label="Turn 1"><\/button><\/div>/);
  assert.match(h, /class="turn-tick loaded" id="turn-tick-2"/);
  assert.match(h, /class="turn-tick loaded active" id="turn-tick-3"/);
  assert.match(railHtml(c, { pulse: 1 }), /class="turn-tick pulse" id="turn-tick-1"/);
  assert.doesNotMatch(h, /turn-card/, 'no card without a hover');
  assert.equal(railHtml(conv({ outline: [entry(1, 2)] }), {}), '');
  assert.equal(railHtml(conv({ loaded: false, outline: [entry(1, 2), entry(2, 8)] }), {}), '');
  assert.equal(railHtml(conv(), {}), '');
});

test("the hovered tick's card reads its turn, its masked prompt and, once finished, its reply", async () => {
  const { railHtml } = await import('../../client/js/render/thread.js');
  const c = conv({ outline: [entry(1, 2, `use ${SK} <b>`, 'done <i>'), entry(2, 12, 'and now?', '')] });
  const h = railHtml(c, { hover: 1 });
  const card = h.match(/<div class="turn-card" role="tooltip">[\s\S]*?<\/div><\/div><\/div>/)?.[0] ?? '';
  assert.match(card, /<div class="turn-card-head">Turn 1 · jump<\/div>/);
  assert.match(card, /<div class="turn-card-prompt">use sk-proj-\*+ &lt;b&gt;<\/div>/, 'the prompt masked and escaped');
  assert.ok(!card.includes(SK));
  assert.match(card, /<div class="turn-card-reply">done &lt;i&gt;<\/div>/);
  assert.match(h, /id="turn-tick-1"[^>]*><\/button><div class="turn-card"/, 'the card in the hovered tick\'s row');
  const running = railHtml(c, { hover: 2 });
  assert.match(running, /Turn 2 · jump/);
  assert.doesNotMatch(running, /turn-card-reply/, 'no reply line while the turn has none');
});

test("the rail's markup is the same string for the same inputs", async () => {
  const { railHtml } = await import('../../client/js/render/thread.js');
  const outline = [entry(1, 2), entry(2, 12)];
  const window = { start: 0, through: 30, hasMore: false, replaced: [] };
  const a = railHtml(conv({ outline, window }), { active: 1 });
  const b = railHtml(conv({ outline, window: { ...window } }), { active: 1 });
  assert.ok(Object.is(a, b));
  assert.notEqual(railHtml(conv({ outline, window }), { active: 2 }), a);
  assert.notEqual(railHtml(conv({ outline: [...outline], window }), { active: 2, hover: 2 }), a);
});
