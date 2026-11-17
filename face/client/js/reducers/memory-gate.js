// face/client/js/reducers/memory-gate.js — the memory gate's slice: what the face kept for each seat card's call id
// (GET /data/memory/gate), as host/memory-gate.js read it — loading, ready with its gate, none (the face keeps nothing for
// that call) or failed — with what the host's schedule of reads again needs: `at`, when the last read began, and `again`,
// how many reads came after the first. A read again keeps a kept gate drawn (`busy` while it runs): a failure of it leaves
// the gate as it was. An entry is never dropped.

const slice = s => s.memoryGate ?? {};
const prior = (s, callId) => (Object.hasOwn(slice(s), callId) ? slice(s)[callId] : null);
const put = (s, callId, entry) => (typeof callId === 'string' && callId !== '' ? { ...s, memoryGate: { ...slice(s), [callId]: entry } } : s);
const schedule = (p, over = {}) => ({ ...(p && typeof p.at === 'number' ? { at: p.at } : {}), ...(p && typeof p.again === 'number' ? { again: p.again } : {}), ...over });

export const reducers = {
  memoryGateLoading(s, { callId, at, again } = {}) {
    if (typeof callId !== 'string') return s;
    const p = prior(s, callId);
    const when = { ...(typeof at === 'number' ? { at } : {}), again: typeof again === 'number' ? again : 0 };
    return put(s, callId, p?.status === 'ready' ? { ...p, ...when, busy: true } : { status: 'loading', ...when });
  },
  memoryGateLoaded: (s, { callId, gate } = {}) => (gate && typeof gate === 'object' && typeof callId === 'string' ? put(s, callId, schedule(prior(s, callId), { status: 'ready', gate })) : s),
  memoryGateNone: (s, { callId } = {}) => ended(s, callId, 'none'),
  memoryGateFailed: (s, { callId } = {}) => ended(s, callId, 'failed'),
};

// a read that brought no gate: a gate kept from an earlier read stays as it was, else the entry takes the status
function ended(s, callId, status) {
  if (typeof callId !== 'string') return s;
  const p = prior(s, callId);
  if (p?.status === 'ready') { const { busy: _busy, ...kept } = p; return put(s, callId, kept); }
  return put(s, callId, schedule(p, { status }));
}
