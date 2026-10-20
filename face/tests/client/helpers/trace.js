// face/tests/client/helpers/trace.js — a room member's turn as its session's history serves it (dsh 0.2.0-rc.2: records
// `{type:'event', event}`, a page `{records, hasMore}`): the turn's start, one alpaca-kit call and its result, the end.
const ev = (seq, type, data) => ({ type: 'event', event: { seq, type, time: 1756512200000 + seq, data } });
export const memberTurn = (turn = 3, text = '{"ok":true,"equity":"100"}') => [
  ev(10, 'turn/start', { turn }),
  ev(11, 'tool/call', { turn, step: 1, callId: 'mc1', name: 'mcp__alpaca-kit__account', arguments: '{}' }),
  ev(12, 'tool/result', { turn, step: 1, message: { id: 'msg-12', role: 'tool', toolCallId: 'mc1', content: [{ type: 'text', text }], isError: false, source: { kind: 'tool', callId: 'mc1' } } }),
  ev(13, 'turn/end', { turn, reason: { kind: 'completed' } }),
];
export const memberPage = records => ({ records, hasMore: false });
