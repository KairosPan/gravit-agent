// face/client/js/host/kinds.js — the kind table (spec 2026-10-19 §6): a mapper view becomes zero, one or two gravit-ui messages.
// Pure: no DOM, no network. Markdown is the renderer's (the flag rides on the message), the live layer's `calls` map
// carries every tool call's arguments because the mapper's card keeps only a title.
import { roundEndLine } from '../wire/room.js';

// the Account seat's twelve write tools (spec 2026-10-20 §6.1): what the host's Gate 2 cards under any server name
export const SEAT_TOOLS = Object.freeze(['portfolio_live_order', 'portfolio_live_batch', 'portfolio_live_amend', 'portfolio_live_cancel',
  'portfolio_live_close', 'portfolio_live_leverage', 'portfolio_live_move', 'portfolio_live_earn', 'portfolio_pay',
  'portfolio_order', 'portfolio_execute', 'portfolio_transfer']);
export const ORDER_TOOLS = Object.freeze(['place_order', 'cancel_order', ...SEAT_TOOLS]);
// the face's own seat server (face/src/account-seat.ts): the host cards every tool under it that it has not classified as a
// read, so an approval arriving under this prefix is a seat card whatever its raw name
const SEAT_PREFIX = 'mcp__account__';

const bySuffix = (list, name) => typeof name === 'string' && list.some(raw => name === raw || name.endsWith('__' + raw));
// the raw name or the minted `mcp__<server>__<raw>`; the read-only `orders` listing never matches
export const isOrderTool = name => bySuffix(ORDER_TOOLS, name);
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

// "buy 0.00008 BTC/USD · market", "sell 10 AAPL · limit 187.4", "cancel ord-7"
export function orderLine(args = {}) {
  if (args.order_id !== undefined && args.side === undefined) return `cancel ${args.order_id}`;
  const head = [args.side, args.qty, args.symbol].filter(v => v !== undefined && v !== null && v !== '').join(' ');
  const type = args.order_type === 'limit' && args.limit_price !== undefined ? `limit ${args.limit_price}` : args.order_type;
  return type ? `${head} · ${type}` : head;
}

const has = v => v !== undefined && v !== null && v !== '';
const words = (...parts) => parts.filter(has).join(' ');
const money = n => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const at = (line, venue) => (typeof venue === 'string' && venue !== '' ? `${line} · ${venue}` : line);
// a seat order's type in words: "market", "limit 187.4", "stop 150 limit 148", "trailing 2%"
function typeWord(a) {
  const t = a.orderType ?? 'market';
  if (t === 'limit') return has(a.limitPrice) ? `limit ${a.limitPrice}` : 'limit';
  if (t === 'stop') return has(a.stopPrice) ? `stop ${a.stopPrice}` : 'stop';
  if (t === 'stop_limit') return `stop ${has(a.stopPrice) ? a.stopPrice : '?'} limit ${has(a.limitPrice) ? a.limitPrice : '?'}`;
  if (t === 'trailing_stop') return has(a.trailPercent) ? `trailing ${a.trailPercent}%` : has(a.trailPrice) ? `trailing ${a.trailPrice}` : 'trailing';
  return String(t);
}
// a seat write in words (spec 2026-10-20 §6.1): "buy $100 of AAPL · market · paper-1", "cancel ord-0001 · paper-1",
// "move 50 USDC · withdraw from okx", "pay up to $2 · api.example.com"; a tool the face never classified is its raw name
// one order in words, without its venue: "buy $100 of AAPL · market", "sell 10 AAPL · limit 187.4"
function orderWords(a) {
  const size = has(a.usd) ? `${money(a.usd)} of ${has(a.symbol) ? a.symbol : '?'}` : words(a.qty, a.symbol);
  return `${has(a.side) ? a.side : 'order'} ${size} · ${typeWord(a)}`;
}
export function seatLine(name, a = {}) {
  const raw = rawOf(name);
  switch (raw) {
    case 'portfolio_live_order': return at(orderWords(a), a.venue);
    // a batch is several orders: every leg in words (the host's card carries each leg's venue in its own line)
    case 'portfolio_live_batch': {
      const legs = Array.isArray(a.legs) ? a.legs.filter(l => l && typeof l === 'object') : [];
      const head = `batch · ${legs.length} leg${legs.length === 1 ? '' : 's'}`;
      return legs.length ? `${head}: ${legs.map(orderWords).join('; ')}` : head;
    }
    case 'portfolio_live_amend': return at(`amend ${has(a.order) ? a.order : '?'}`, a.venue);
    case 'portfolio_live_cancel': return at(`cancel ${has(a.order) ? a.order : '?'}`, a.venue);
    case 'portfolio_live_close': return at(`close ${words(a.qty, a.symbol) || '?'}`, a.venue);
    case 'portfolio_live_leverage': return at(`leverage ${has(a.symbol) ? a.symbol : '?'} ${has(a.leverage) ? a.leverage : '?'}x`, a.venue);
    case 'portfolio_live_move': return `move ${words(a.amount, a.asset) || '?'} · ${has(a.kind) ? a.kind : 'move'} from ${has(a.from) ? a.from : '?'}${has(a.to) ? ` to ${a.to}` : ''}`;
    case 'portfolio_live_earn': return at(`earn ${words(a.kind, a.amount, a.asset) || '?'}`, a.venue);
    case 'portfolio_pay': {
      let host = '';
      try { host = new URL(String(a.url)).host; } catch { host = typeof a.url === 'string' ? a.url : ''; }
      return `pay up to ${money(has(a.maxAmount) ? a.maxAmount : 0)}${host ? ` · ${host}` : ''}`;
    }
    case 'portfolio_order': return `${has(a.side) ? a.side : 'order'} ${words(a.qty, a.base) || '?'}`;
    case 'portfolio_execute': return `execute at ${has(a.account) ? a.account : '?'}`;
    case 'portfolio_transfer': return `transfer ${words(a.amount, has(a.token) ? a.token : 'USD')} · ${has(a.from) ? a.from : '?'} to ${has(a.to) ? a.to : '?'}`;
    default: return at(raw, a.venue);
  }
}

// a seat write's answer, lifted under its tool row (spec 2026-10-20 §6.2): the card the Account raised, the order it placed or
// canceled, its refusal in its own words, a batch's count; anything else lifts nothing. `seat: true` routes the reload.
const refusalWords = (v, text) => (typeof v.code === 'string' && typeof v.message === 'string' ? `${v.code} · ${v.message}` : typeof v.message === 'string' ? v.message : text);
// dsh hands a failed call's text to the thread as `Error: <the server's words>`; the lift reads the words
const unprefixed = text => (typeof text === 'string' ? text.replace(/^Error:\s*/, '') : '');
export function seatLift(name, args, text, isError, callId) {
  text = unprefixed(text);
  const v = parseArgs(text);
  const legs = Array.isArray(v.legs) ? v.legs.filter(l => l && typeof l === 'object') : null;
  if (isError || v.ok === false) {
    // a batch whose every leg was refused: the count, and the first refusal in the Account's words
    const first = legs?.find(l => l.ok === false);
    const line = legs && first ? `Batch · ${legs.filter(l => l.ok === false).length} of ${legs.length} legs refused · ${refusalWords(first, text)}` : refusalWords(v, text);
    return { kind: 'refusal', text: line, data: { seat: true, toolName: name, callId } };
  }
  if (v.pending === true && typeof v.card?.id === 'string') {
    return { kind: 'receipt', text: `Card raised on the Account page · ${v.card.id} · answer it there`, data: { seat: true, cardId: v.card.id, callId } };
  }
  if (typeof v.order?.id === 'string') {
    const word = v.order.status === 'canceled' ? 'Order canceled' : 'Order placed';
    return { kind: 'receipt', text: `${word} · ${seatLine(name, args)} · ${v.order.id}${v.order.paper === true ? ' · paper' : ''}`, data: { seat: true, orderId: v.order.id, callId } };
  }
  if (legs) {
    // in Guard the Account answers a leg with a card of its own and places nothing: a card is not a fill
    const placed = legs.filter(l => l.order && typeof l.order === 'object').length;
    const cards = legs.filter(l => l.pending === true && typeof l.card?.id === 'string').length;
    const refused = legs.filter(l => l.ok === false).length;
    const parts = [];
    if (placed > 0 || (cards === 0 && refused === 0)) parts.push(`${placed} of ${legs.length} legs placed`);
    if (cards > 0) parts.push(`${cards} card${cards === 1 ? '' : 's'} raised on the Account page`);
    if (refused > 0) parts.push(`${refused} refused`);
    return { kind: 'receipt', text: `Batch · ${parts.join(' · ')}`, data: { seat: true, callId } };
  }
  return null;
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
const orderIdOf = text => { const v = parseArgs(text); return typeof v.id === 'string' ? v.id : ''; };

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
    if (text.trim() === '' && view.interrupted !== true) return null; // a tool-only step: the tool row carries it
    return { ...b, from: speaker, kind: 'text', text, data: { markdown: true, interrupted: view.interrupted === true } };
  }
  // only the operator's own words are You; every other user-role record (a compaction checkpoint, a plugin notice,
  // runtime context, a member's delta) is a system line, never the operator's blue bubble
  if (view.source === 'user' || view.source === undefined) return { ...b, from: 'you', kind: 'text', text: view.text ?? '', data: { mention: view.mention } };
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
  // the result names its call (the renderer dresses alpaca-kit's results by name), when the call was seen
  const row = { ...base(view), id: `t${callId}`, merge: true, from: 'gravit', kind: 'tool', text: '', data: { callId, result: c.text ?? '', isError: c.isError === true, ...(known ? { name: known.name, args: known.args } : {}) } };
  if (!known) return [row];
  if (isSeatWriteTool(known.name)) {
    const lift = seatLift(known.name, known.args, c.text ?? '', c.isError === true, callId);
    return lift ? [row, { ...base(view), id: `r${callId}`, from: 'gravit', ...lift }] : [row];
  }
  if (!isOrderTool(known.name)) return [row];
  const lift = c.isError === true
    ? { ...base(view), id: `r${callId}`, from: 'gravit', kind: 'refusal', text: unprefixed(c.text), data: { toolName: known.name, callId } }
    : { ...base(view), id: `r${callId}`, from: 'gravit', kind: 'receipt', text: `Order accepted · ${orderLine(known.args)} · ${orderIdOf(c.text)}`, data: { orderId: orderIdOf(c.text), callId } };
  return [row, lift];
}

function gate(view, calls, now) {
  const data = { eventId: view.id, sessionId: view.sessionId, toolName: view.toolName, callId: view.callId, reason: view.reason, displayReason: view.displayReason };
  const line = view.displayReason ?? view.reason ?? '';
  if (!isOrderTool(view.toolName) && !isSeatGate(view.toolName)) return { id: view.id, at: now, from: 'gravit', kind: 'approval', text: line, data };
  // the gate's own session's call of the same tool, or nothing: a headline must never come from another session's call
  const known = callOf(calls, view, view.callId, view.toolName);
  // a seat card: the seat line, and the argument's venue as the chip — a batch's venues, or the seat itself when the tool names none
  if (isSeatGate(view.toolName)) {
    const venue = typeof known?.args?.venue === 'string' && known.args.venue !== '' ? known.args.venue : (venuesOf(known?.args?.legs) || 'Account seat');
    return {
      id: view.id, at: now, from: 'gravit', kind: 'card',
      text: `Your call: ${known ? seatLine(view.toolName, known.args) : view.toolName}`,
      data: { ...data, venue, line, args: known?.args ?? {} },
    };
  }
  return {
    id: view.id, at: now, from: 'gravit', kind: 'card',
    text: `Your call: ${known ? orderLine(known.args) : view.toolName}`,
    data: { ...data, venue: 'Alpaca paper', line, args: known?.args ?? {} },
  };
}

// view → messages; `speaker` is who the assistant role is in this conversation (a bot in its home session)
export function toMessages(view, calls, now, speaker = 'gravit') {
  switch (view?.kind) {
    case 'bubble': { const m = bubble(view, speaker); return m ? [m] : []; }
    case 'room-line': return [sys(view, roundEndLine(view))];
    case 'subagent-message': return [sys(view, `Report from ${view.childSessionId ?? 'a child'}: ${view.text ?? ''}`)];
    case 'card': return toolMessages(view, calls);
    case 'approval': return [gate(view, calls, now)];
    case 'question': return [{ id: view.id, at: now, from: 'gravit', kind: 'question', text: '', data: { eventId: view.id, sessionId: view.sessionId, questions: Array.isArray(view.questions) ? view.questions : [] } }];
    default: return [];
  }
}

// the keys a card's title is made of (seatLine, orderLine): a card drawn again from a call must find each one the call
// carries in the host's own reason line (Gate 2's describeOrder: `key=value` pairs, a key field whole, another value cut
// at forty characters), bounded on both sides so `usd=10` is not `usd=100`; a batch's legs the same, leg by leg
const TITLE_KEYS = ['venue', 'symbol', 'side', 'usd', 'qty', 'kind', 'from', 'to', 'asset', 'amount', 'url', 'order', 'order_id', 'orderType', 'order_type', 'leverage', 'maxAmount', 'limit_price', 'limitPrice'];
const LEG_KEYS = ['venue', 'symbol', 'side', 'usd', 'qty', 'orderType', 'order_type'];
const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pairIn = (reason, key, value) => {
  const shown = String(value);
  const whole = new RegExp(`(^|[\\s\\[;{(])${escapeRe(key)}=${escapeRe(shown)}(?=$|[\\s;\\]})])`, 'u').test(reason);
  if (whole || shown.length <= 40) return whole; // a key field is shown whole (up to 120); any other value is cut at forty
  return new RegExp(`(^|[\\s\\[;{(])${escapeRe(key)}=${escapeRe(shown.slice(0, 40))}…`, 'u').test(reason);
};
const scalarsAgree = (row, keys, reason) => keys.every(key => {
  const value = row[key];
  return value === undefined || value === null || typeof value === 'object' || pairIn(reason, key, value);
});
export function argsAgreeWithReason(args, reason) {
  if (!args || typeof args !== 'object' || typeof reason !== 'string' || reason === '') return false;
  if (!scalarsAgree(args, TITLE_KEYS, reason)) return false;
  if (Array.isArray(args.legs)) return args.legs.every(leg => !leg || typeof leg !== 'object' || scalarsAgree(leg, LEG_KEYS, reason));
  return true;
}

// a gate drawn before its own tool/call reached the page: its card again, from the call's arguments, only when they agree
// with the host's reason line — the server's Gate 2 text is the authority, and a card the operator may already be reading
// is never replaced by a call that says otherwise. Null: no agreeing call of this gate's session, id and tool
export function redressGate(view, calls, now) {
  const known = callOf(calls, view, view.callId, view.toolName);
  if (!known || !argsAgreeWithReason(known.args, view.reason ?? view.displayReason)) return null;
  const [m] = toMessages(view, calls, now);
  return m ?? null;
}
