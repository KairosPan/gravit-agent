// face/client/js/host/kinds.js — the kind table (spec 2026-10-19 §6): a mapper view becomes zero, one or two gravit-ui messages.
// Pure: no DOM, no network. Markdown is the renderer's (the flag rides on the message), the live layer's `calls` map
// carries every tool call's arguments because the mapper's card keeps only a title.
import { roundEndLine } from '../wire/room.js';
import { t, tn } from '../i18n/words.js';

// the Account seat's twelve write tools (spec 2026-10-20 §6.1): what the host's Gate 2 cards under any server name
export const SEAT_TOOLS = Object.freeze(['portfolio_live_order', 'portfolio_live_batch', 'portfolio_live_amend', 'portfolio_live_cancel',
  'portfolio_live_close', 'portfolio_live_leverage', 'portfolio_live_move', 'portfolio_live_earn', 'portfolio_pay',
  'portfolio_order', 'portfolio_execute', 'portfolio_transfer']);
// the face's own seat server (face/src/account-seat.ts): the host cards every tool under it that it has not classified as a
// read, so an approval arriving under this prefix is a seat card whatever its raw name
const SEAT_PREFIX = 'mcp__account__';

const bySuffix = (list, name) => typeof name === 'string' && list.some(raw => name === raw || name.endsWith('__' + raw));
// the raw name or the minted `mcp__<server>__<raw>`
export const isSeatWriteTool = name => bySuffix(SEAT_TOOLS, name);
const isSeatGate = name => isSeatWriteTool(name) || (typeof name === 'string' && name.startsWith(SEAT_PREFIX));
const rawOf = name => { if (typeof name !== 'string') return ''; const i = name.lastIndexOf('__'); return i < 0 ? name : name.slice(i + 2); };

// a tool's arguments as the model sent them: JSON, or nothing
export function parseArgs(raw) {
  if (typeof raw !== 'string') return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

const has = v => v !== undefined && v !== null && v !== '';
const words = (...parts) => parts.filter(has).join(' ');
const money = n => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const at = (line, venue) => (typeof venue === 'string' && venue !== '' ? t('thread.seat.at', { line, venue }) : line);
// a seat order's type in words: "market", "limit 187.4", "stop 150 limit 148", "trailing 2%"
function typeWord(a) {
  const type = a.orderType ?? 'market';
  if (type === 'market') return t('thread.seat.market');
  if (type === 'limit') return has(a.limitPrice) ? t('thread.seat.limitAt', { price: a.limitPrice }) : t('thread.seat.limit');
  if (type === 'stop') return has(a.stopPrice) ? t('thread.seat.stopAt', { price: a.stopPrice }) : t('thread.seat.stop');
  if (type === 'stop_limit') return t('thread.seat.stopLimit', { stop: has(a.stopPrice) ? a.stopPrice : '?', limit: has(a.limitPrice) ? a.limitPrice : '?' });
  if (type === 'trailing_stop') {
    return has(a.trailPercent) ? t('thread.seat.trailingPct', { pct: a.trailPercent }) : has(a.trailPrice) ? t('thread.seat.trailingAt', { price: a.trailPrice }) : t('thread.seat.trailing');
  }
  return String(type);
}
// a seat write in words (spec 2026-10-20 §6.1): "buy $100 of AAPL · market · paper-1", "cancel ord-0001 · paper-1",
// "move 50 USDC · withdraw from okx", "pay up to $2 · api.example.com"; a tool the face never classified is its raw name
// one order in words, without its venue: "buy $100 of AAPL · market", "sell 10 AAPL · limit 187.4"
function orderWords(a) {
  const size = has(a.usd) ? t('thread.seat.usdOf', { usd: money(a.usd), symbol: has(a.symbol) ? a.symbol : '?' }) : words(a.qty, a.symbol);
  return t('thread.seat.orderLine', { side: has(a.side) ? a.side : t('thread.seat.order'), size, type: typeWord(a) });
}
export function seatLine(name, a = {}) {
  const raw = rawOf(name);
  switch (raw) {
    case 'portfolio_live_order': return at(orderWords(a), a.venue);
    // a batch is several orders: every leg in words (the host's card carries each leg's venue in its own line)
    case 'portfolio_live_batch': {
      const legs = Array.isArray(a.legs) ? a.legs.filter(l => l && typeof l === 'object') : [];
      const head = tn('thread.seat.batch', legs.length);
      return legs.length ? t('thread.seat.batchLegs', { head, legs: legs.map(orderWords).join(t('thread.seat.legSep')) }) : head;
    }
    case 'portfolio_live_amend': return at(t('thread.seat.amend', { order: has(a.order) ? a.order : '?' }), a.venue);
    case 'portfolio_live_cancel': return at(t('thread.seat.cancel', { order: has(a.order) ? a.order : '?' }), a.venue);
    case 'portfolio_live_close': return at(t('thread.seat.close', { what: words(a.qty, a.symbol) || '?' }), a.venue);
    case 'portfolio_live_leverage': return at(t('thread.seat.leverage', { symbol: has(a.symbol) ? a.symbol : '?', x: has(a.leverage) ? a.leverage : '?' }), a.venue);
    case 'portfolio_live_move': {
      const move = { what: words(a.amount, a.asset) || '?', kind: has(a.kind) ? a.kind : t('thread.seat.moveKind'), from: has(a.from) ? a.from : '?' };
      return has(a.to) ? t('thread.seat.moveTo', { ...move, to: a.to }) : t('thread.seat.move', move);
    }
    case 'portfolio_live_earn': return at(t('thread.seat.earn', { what: words(a.kind, a.amount, a.asset) || '?' }), a.venue);
    case 'portfolio_pay': {
      let host = '';
      try { host = new URL(String(a.url)).host; } catch { host = typeof a.url === 'string' ? a.url : ''; }
      return at(t('thread.seat.pay', { amount: money(has(a.maxAmount) ? a.maxAmount : 0) }), host);
    }
    case 'portfolio_order': return t('thread.seat.sideWhat', { side: has(a.side) ? a.side : t('thread.seat.order'), what: words(a.qty, a.base) || '?' });
    case 'portfolio_execute': return t('thread.seat.execute', { account: has(a.account) ? a.account : '?' });
    case 'portfolio_transfer': return t('thread.seat.transfer', { what: words(a.amount, has(a.token) ? a.token : 'USD'), from: has(a.from) ? a.from : '?', to: has(a.to) ? a.to : '?' });
    default: return at(raw, a.venue);
  }
}

// a seat write's answer, lifted under its tool row (spec 2026-10-20 §6.2): the card the Account raised, the order it placed or
// canceled, its refusal in its own words, a batch's count; anything else lifts nothing. `seat: true` routes the reload.
const refusalWords = (v, text) => (typeof v.code === 'string' && typeof v.message === 'string' ? t('thread.seat.refusal', { code: v.code, message: v.message }) : typeof v.message === 'string' ? v.message : text);
// dsh hands a failed call's text to the thread as `Error: <the server's words>`; the lift reads the words
const unprefixed = text => (typeof text === 'string' ? text.replace(/^Error:\s*/, '') : '');
export function seatLift(name, args, text, isError, callId) {
  text = unprefixed(text);
  const v = parseArgs(text);
  const legs = Array.isArray(v.legs) ? v.legs.filter(l => l && typeof l === 'object') : null;
  if (isError || v.ok === false) {
    // a batch whose every leg was refused: the count, and the first refusal in the Account's words
    const first = legs?.find(l => l.ok === false);
    const line = legs && first ? t('thread.seat.batchRefused', { refused: legs.filter(l => l.ok === false).length, total: legs.length, reason: refusalWords(first, text) }) : refusalWords(v, text);
    return { kind: 'refusal', text: line, data: { seat: true, toolName: name, callId } };
  }
  if (v.pending === true && typeof v.card?.id === 'string') {
    return { kind: 'receipt', text: t('thread.seat.cardRaised', { id: v.card.id }), data: { seat: true, cardId: v.card.id, callId } };
  }
  if (typeof v.order?.id === 'string') {
    const order = { line: seatLine(name, args), id: v.order.id };
    const word = v.order.status === 'canceled' ? t('thread.seat.canceled', order) : t('thread.seat.placed', order);
    return { kind: 'receipt', text: v.order.paper === true ? t('thread.seat.paper', { line: word }) : word, data: { seat: true, orderId: v.order.id, callId } };
  }
  if (legs) {
    // in Guard the Account answers a leg with a card of its own and places nothing: a card is not a fill
    const placed = legs.filter(l => l.order && typeof l.order === 'object').length;
    const cards = legs.filter(l => l.pending === true && typeof l.card?.id === 'string').length;
    const refused = legs.filter(l => l.ok === false).length;
    const parts = [];
    if (placed > 0 || (cards === 0 && refused === 0)) parts.push(t('thread.seat.legsPlaced', { placed, total: legs.length }));
    if (cards > 0) parts.push(tn('thread.seat.cardsRaised', cards));
    if (refused > 0) parts.push(t('thread.seat.legsRefused', { n: refused }));
    // words-order: the receipt's parts under the visual separator
    return { kind: 'receipt', text: t('thread.seat.batchReceipt', { parts: parts.join(' · ') }), data: { seat: true, callId } };
  }
  return null;
}

// Gravit's composed answer (plan 2 of the Lunhui run view, task 4): an ok `lunhui_present` result is the face's own catalog
// drawn from the run's view — the summary as Gravit wrote it, the blocks in the order the check confirmed them (each with
// the call's title and focus), the choices, the view modules the answer reads. A refusal (a tool error: the turn goes on,
// and a later ok call answers it) or any other tool lifts nothing, so only the ok call is drawn.
export const PRESENT_TOOL = 'lunhui_present';
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export function presentLift(name, args, text, isError, callId) {
  if (name !== PRESENT_TOOL || isError) return null;
  const v = parseArgs(text);
  if (v.ok !== true) return null;
  const a = isObj(args) ? args : {};
  const asked = Array.isArray(a.blocks) ? a.blocks.filter(isObj) : [];
  const kinds = Array.isArray(v.blocks) ? v.blocks.filter(k => typeof k === 'string') : asked.map(b => b.kind);
  const blocks = kinds.map(kind => {
    const b = asked.find(x => x.kind === kind) ?? {};
    return { kind, ...(typeof b.title === 'string' ? { title: b.title } : {}), ...(b.focus !== undefined ? { focus: b.focus } : {}) };
  });
  const summary = typeof a.summary === 'string' ? a.summary : '';
  return {
    kind: 'composed', text: summary,
    data: {
      callId, strategy: a.strategy, run: a.run, module: a.module, summary, blocks,
      choices: Array.isArray(a.choices) ? a.choices.filter(isObj) : [],
      modules: Array.isArray(v.modules) ? v.modules.filter(m => typeof m === 'string') : [],
    },
  };
}
// the tool results that lift a message of their own: a seat write's receipt or refusal, Gravit's composed answer
function liftOf(name, args, text, isError, callId) {
  const [prefix, lift] = isSeatWriteTool(name) ? ['r', seatLift(name, args, text, isError, callId)] : ['p', presentLift(name, args, text, isError, callId)];
  return lift && { id: `${prefix}${callId}`, ...lift };
}

// a call id is a session's own (the host's guard treats them as non-unique too), so a call is kept by session AND id
const callKey = (sessionId, callId) => `${typeof sessionId === 'string' ? sessionId : ''}:${callId}`;
// the live layer calls this on every raw frame before mapping it: a tool/call's arguments are kept by session and callId
export function rememberCall(calls, frame) {
  const event = frame?.event;
  if (!event || event.type !== 'tool/call') return;
  const d = event.data ?? {};
  if (typeof d.callId !== 'string') return;
  calls.set(callKey(frame.sessionId, d.callId), { name: typeof d.name === 'string' ? d.name : '', args: parseArgs(d.arguments) });
}
// the call a view names, in the view's own session; `toolName` given, only a call of that tool
function callOf(calls, view, callId, toolName) {
  if (typeof callId !== 'string') return undefined;
  const known = calls.get(callKey(view?.sessionId, callId));
  if (!known) return undefined;
  if (typeof toolName === 'string' && known.name !== toolName) return undefined;
  return known;
}
// the venues a batch's legs name, each once, in order
const venuesOf = legs => (Array.isArray(legs) ? [...new Set(legs.map(l => l?.venue).filter(v => typeof v === 'string' && v !== ''))].join(', ') : '');

const replaceOf = view => (view.surfaceOp && typeof view.surfaceOp === 'object' && view.surfaceOp.op === 'replace'
  ? { replace: { start: view.surfaceOp.start, end: view.surfaceOp.end } } : {});
const base = view => ({ id: `e${view.seq}`, seq: view.seq, at: view.time, ...replaceOf(view) });
const sys = (view, text) => ({ ...base(view), from: 'system', kind: 'text', text, data: {} });

function bubble(view, speaker) {
  const b = base(view);
  // a room member's answer is a dsh agent's markdown too, drawn as the bot's home session draws it
  // it keeps the member turn that produced it, which its Trace reads
  if (view.role === 'bot') {
    const member = typeof view.memberSessionId === 'string' ? { memberSessionId: view.memberSessionId, memberTurn: view.memberTurn } : {};
    return { ...b, from: view.bot ?? 'bot', kind: 'text', text: view.displayText ?? view.text ?? '', data: { name: view.name, markdown: true, ...member } };
  }
  if (view.role === 'gravit') {
    const text = view.text ?? '';
    if (text.trim() === '' && view.interrupted !== true) return null; // a tool-only step: its tool calls are stored but not drawn, so it draws nothing
    return { ...b, from: speaker, kind: 'text', text, data: { markdown: true, interrupted: view.interrupted === true } };
  }
  // only the operator's own words are You; every other user-role record (a compaction checkpoint, a plugin notice,
  // runtime context, a member's delta) is a system line, never the operator's blue bubble
  // their attachments ride on the row as the mapper read them (plan 4 Task 3)
  if (view.source === 'user' || view.source === undefined) {
    return { ...b, from: 'you', kind: 'text', text: view.text ?? '', data: { mention: view.mention, ...(Array.isArray(view.attachments) ? { attachments: view.attachments } : {}) } };
  }
  return { ...b, from: 'system', kind: 'text', text: view.text ?? '', data: { source: view.source } };
}

function toolMessages(view, calls) {
  const c = view.card ?? {};
  const callId = c.callId;
  if (typeof callId !== 'string') return [];
  const known = callOf(calls, view, callId);
  if (c.phase === 'call') {
    return [{ ...base(view), id: `t${callId}`, from: 'gravit', kind: 'tool', text: c.title ?? c.name ?? '', data: { callId, name: c.name, title: c.title, args: known?.args ?? {} } }];
  }
  // the result names its call, when the call was seen: the row draws the call's name and its payload folded
  const row = { ...base(view), id: `t${callId}`, merge: true, from: 'gravit', kind: 'tool', text: '', data: { callId, result: c.text ?? '', isError: c.isError === true, ...(known ? { name: known.name, args: known.args } : {}) } };
  if (!known) return [row];
  const lift = liftOf(known.name, known.args, c.text ?? '', c.isError === true, callId);
  return lift ? [row, { ...base(view), from: 'gravit', ...lift }] : [row];
}

function gate(view, now) {
  const data = { eventId: view.id, sessionId: view.sessionId, toolName: view.toolName, callId: view.callId, reason: view.reason, displayReason: view.displayReason };
  const line = view.displayReason ?? view.reason ?? '';
  // anything not the seat's — an old session's alpaca-kit order included — is the plain approval card: its name and reason
  if (!isSeatGate(view.toolName)) return { id: view.id, at: now, from: 'gravit', kind: 'approval', text: line, data };
  // the title is made from the host's own reason line and nothing else (reasonArgs): never from a tool/call frame, which may
  // reach the page after the gate or come later under the same id; a line that names another tool, or no pair, titles nothing
  const read = reasonArgs(view.reason ?? view.displayReason);
  const args = read.tool === view.toolName && Object.keys(read.args).length > 0 ? read.args : null;
  // a seat card: the seat line, and the line's venue as the chip — a batch's venues, or the seat itself when the tool names none
  const venue = args && typeof args.venue === 'string' && args.venue !== '' ? args.venue : (venuesOf(args?.legs) || t('thread.seat.venue'));
  return {
    id: view.id, at: now, from: 'gravit', kind: 'card',
    text: t('thread.seat.yourCall', { line: args ? seatLine(view.toolName, args) : view.toolName }),
    data: { ...data, venue, line, args: args ?? {} },
  };
}

// view → messages; `speaker` is who the assistant role is in this conversation (a bot in its home session)
export function toMessages(view, calls, now, speaker = 'gravit') {
  switch (view?.kind) {
    case 'bubble': { const m = bubble(view, speaker); return m ? [m] : []; }
    case 'room-line': return [sys(view, roundEndLine(view))];
    case 'subagent-message': return [sys(view, t('thread.report', { child: view.childSessionId ?? t('thread.aChild'), text: view.text ?? '' }))];
    case 'card': return toolMessages(view, calls);
    case 'approval': return [gate(view, now)];
    case 'question': return [{ id: view.id, at: now, from: 'gravit', kind: 'question', text: '', data: { eventId: view.id, sessionId: view.sessionId, questions: Array.isArray(view.questions) ? view.questions : [] } }];
    default: return [];
  }
}

// ---- the host's reason line, read back
// Gate 2 draws `<prefix> - <tool>: key=value key=value …` (src/orders.ts describeOrder): a bare value carries no whitespace,
// quote, bracket or semicolon — any other value is a JSON string —, a nested object is `{k=v …}`, a batch's legs are
// `[1: k=v …; 2: …]`. A card's title is made from this line and nothing else, so what the title says is what the host said:
// a tool/call that reaches the page late, or a later one under the same id, changes nothing (the security review of
// 2026-10-21). The first pair of a key wins.
const scalarOf = word => (word === 'true' ? true : word === 'false' ? false : /^-?\d+(\.\d+)?$/.test(word) ? Number(word) : word);
// the JSON string at text[i] === '"': its value and the index after its closing quote (an unterminated one: its raw text)
function quotedAt(text, i) {
  let j = i + 1;
  while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
  const end = Math.min(j + 1, text.length);
  try { return { value: JSON.parse(text.slice(i, end)), end }; } catch { return { value: text.slice(i + 1, j), end }; }
}
// the index of the bracket that closes the one at text[i], quoted strings skipped; -1 when none
function closingAt(text, i) {
  const close = text[i] === '[' ? ']' : '}';
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === '"') { j = quotedAt(text, j).end; continue; }
    if (text[j] === close) return j;
    j += 1;
  }
  return -1;
}
function pairsFrom(text) {
  const out = {};
  let i = 0;
  while (i < text.length) {
    while (i < text.length && text[i] === ' ') i += 1;
    const km = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(text.slice(i));
    if (!km) { const sp = text.indexOf(' ', i); if (sp < 0) break; i = sp + 1; continue; }
    const key = km[1];
    i += km[0].length;
    let value;
    const c = text[i];
    if (c === '"') { const q = quotedAt(text, i); value = q.value; i = q.end; }
    else if (c === '[' || c === '{') {
      const end = closingAt(text, i);
      const inner = text.slice(i + 1, end < 0 ? text.length : end);
      value = c === '[' ? legsFrom(inner) : pairsFrom(inner);
      i = end < 0 ? text.length : end + 1;
    } else {
      const sp = text.indexOf(' ', i);
      value = scalarOf(sp < 0 ? text.slice(i) : text.slice(i, sp));
      i = sp < 0 ? text.length : sp;
    }
    if (!(key in out)) out[key] = value;
  }
  return out;
}
// `1: k=v …; 2: …` → one object per leg, in order (a leg drawn as `?` is an empty one); quoted values never split a leg
function legsFrom(inner) {
  const legs = [];
  let i = 0;
  let start = -1;
  const flush = end => { if (start >= 0) legs.push(pairsFrom(inner.slice(start, end))); };
  while (i < inner.length) {
    if (inner[i] === '"') { i = quotedAt(inner, i).end; continue; }
    const m = (i === 0 ? /^(\d+): / : /^; (\d+): /).exec(inner.slice(i));
    if (m) { flush(i); start = i + m[0].length; i = start; continue; }
    i += 1;
  }
  flush(inner.length);
  return legs;
}
export function reasonArgs(reason) {
  if (typeof reason !== 'string') return { tool: undefined, args: {} };
  const colon = reason.indexOf(': ');
  const head = colon < 0 ? reason : reason.slice(0, colon);
  const body = colon < 0 ? '' : reason.slice(colon + 2);
  const dash = head.lastIndexOf(' - ');
  const tool = (dash < 0 ? head : head.slice(dash + 3)).trim();
  return { tool: tool === '' ? undefined : tool, args: pairsFrom(body) };
}
