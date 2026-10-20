// face/client/js/host/kinds.js — the kind table (spec 2026-10-19 §6): a mapper view becomes zero, one or two gravit-ui messages.
// Pure: no DOM, no network. Markdown is the renderer's (the flag rides on the message), the live layer's `calls` map
// carries every tool call's arguments because the mapper's card keeps only a title.
import { roundEndLine } from '../wire/room.js';

export const ORDER_TOOLS = Object.freeze(['place_order', 'cancel_order']);

// the raw name or the minted `mcp__<server>__<raw>`; the read-only `orders` listing never matches
export const isOrderTool = name => typeof name === 'string' && ORDER_TOOLS.some(raw => name === raw || name.endsWith('__' + raw));

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

// the live layer calls this on every raw frame before mapping it: a tool/call's arguments are kept by callId
export function rememberCall(calls, frame) {
  const event = frame?.event;
  if (!event || event.type !== 'tool/call') return;
  const d = event.data ?? {};
  if (typeof d.callId !== 'string') return;
  calls.set(d.callId, { name: typeof d.name === 'string' ? d.name : '', args: parseArgs(d.arguments) });
}

const replaceOf = view => (view.surfaceOp && typeof view.surfaceOp === 'object' && view.surfaceOp.op === 'replace'
  ? { replace: { start: view.surfaceOp.start, end: view.surfaceOp.end } } : {});
const base = view => ({ id: `e${view.seq}`, seq: view.seq, at: view.time, ...replaceOf(view) });
const sys = (view, text) => ({ ...base(view), from: 'system', kind: 'text', text, data: {} });
const orderIdOf = text => { const v = parseArgs(text); return typeof v.id === 'string' ? v.id : ''; };

function bubble(view, speaker) {
  const b = base(view);
  // a room member's answer is a dsh agent's markdown too, drawn as the bot's home session draws it
  if (view.role === 'bot') return { ...b, from: view.bot ?? 'bot', kind: 'text', text: view.displayText ?? view.text ?? '', data: { name: view.name, markdown: true } };
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
  const known = calls.get(callId);
  if (c.phase === 'call') {
    return [{ ...base(view), id: `t${callId}`, from: 'gravit', kind: 'tool', text: c.title ?? c.name ?? '', data: { callId, name: c.name, title: c.title, args: known?.args ?? {} } }];
  }
  // the result names its call (the renderer dresses alpaca-kit's results by name), when the call was seen
  const row = { ...base(view), id: `t${callId}`, merge: true, from: 'gravit', kind: 'tool', text: '', data: { callId, result: c.text ?? '', isError: c.isError === true, ...(known ? { name: known.name, args: known.args } : {}) } };
  if (!known || !isOrderTool(known.name)) return [row];
  const lift = c.isError === true
    ? { ...base(view), id: `r${callId}`, from: 'gravit', kind: 'refusal', text: c.text ?? '', data: { toolName: known.name, callId } }
    : { ...base(view), id: `r${callId}`, from: 'gravit', kind: 'receipt', text: `Order accepted · ${orderLine(known.args)} · ${orderIdOf(c.text)}`, data: { orderId: orderIdOf(c.text), callId } };
  return [row, lift];
}

function gate(view, calls, now) {
  const data = { eventId: view.id, sessionId: view.sessionId, toolName: view.toolName, callId: view.callId, reason: view.reason, displayReason: view.displayReason };
  const line = view.displayReason ?? view.reason ?? '';
  if (!isOrderTool(view.toolName)) return { id: view.id, at: now, from: 'gravit', kind: 'approval', text: line, data };
  const known = typeof view.callId === 'string' ? calls.get(view.callId) : undefined;
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
