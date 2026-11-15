// face/client/js/reducers/memory-gate.js — the memory gate's slice: what the face kept for each seat card's call id
// (GET /data/memory/gate), as host/memory-gate.js read it — loading, ready with its gate, none (the face keeps nothing for
// that call) or failed. An entry is never dropped: a card is asked once, and once more after an override was posted.

const slice = s => s.memoryGate ?? {};
const put = (s, callId, entry) => (typeof callId === 'string' && callId !== '' ? { ...s, memoryGate: { ...slice(s), [callId]: entry } } : s);

export const reducers = {
  memoryGateLoading: (s, { callId } = {}) => put(s, callId, { status: 'loading' }),
  memoryGateLoaded: (s, { callId, gate } = {}) => (gate && typeof gate === 'object' ? put(s, callId, { status: 'ready', gate }) : s),
  memoryGateNone: (s, { callId } = {}) => put(s, callId, { status: 'none' }),
  memoryGateFailed: (s, { callId } = {}) => put(s, callId, { status: 'failed' }),
};
