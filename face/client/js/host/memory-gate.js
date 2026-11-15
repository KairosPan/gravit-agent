// face/client/js/host/memory-gate.js — the lessons an order card draws (memory order card, Task 6): each seat card the page
// holds with a call id is asked once, `GET /data/memory/gate?callId=`, and what the face kept for that call lands in the
// memoryGate slice (reducers/memory-gate.js) — the gate, none on a 404 (a card raised before the gate, or an entry being
// checked again), failed on anything else. An answered card is asked too, so what was registered for it can be drawn. The
// owner's override of a red line is posted in their own words, `POST /data/memory/gate/override`, and the card asked once
// more so it shows the override. Nothing here answers a card: the caller does, once the override is kept.

// the gate's grammar for a call id (src/memory-gate.ts CALL_ID): any other is never asked
const CALL_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

const callIdOf = m => (m?.kind === 'card' && typeof m.data?.callId === 'string' && CALL_ID.test(m.data.callId) ? m.data.callId : null);

/** The gate the face kept for a seat card message, once read; null for any other message, or before it is read. */
export function gateOf(state, m) {
  const callId = callIdOf(m);
  const kept = state?.memoryGate;
  if (callId === null || !kept || !Object.hasOwn(kept, callId)) return null;
  const entry = kept[callId];
  return entry?.status === 'ready' && entry.gate && typeof entry.gate === 'object' ? entry.gate : null;
}

// every seat card's call id the slice holds nothing for, once each, in the order the page holds them
function wanted(state) {
  const kept = state.memoryGate ?? {};
  const out = new Set();
  for (const conv of state.conversations ?? []) {
    for (const m of conv?.messages ?? []) {
      const callId = callIdOf(m);
      if (callId !== null && !Object.hasOwn(kept, callId)) out.add(callId);
    }
  }
  return [...out];
}

const gatePath = callId => `/data/memory/gate?callId=${encodeURIComponent(callId)}`;

export function startMemoryGate({ store, getJson, postJson }) {
  // the scan is skipped while neither the conversations nor the slice moved (renders run many times a second)
  let seen = null;

  async function read(callId) {
    store.dispatch('memoryGateLoading', { callId });
    try {
      const body = await getJson(gatePath(callId));
      if (body?.gate && typeof body.gate === 'object') store.dispatch('memoryGateLoaded', { callId, gate: body.gate });
      else store.dispatch('memoryGateFailed', { callId });
    } catch (error) {
      store.dispatch(error?.status === 404 ? 'memoryGateNone' : 'memoryGateFailed', { callId });
    }
  }

  // asked again after an override: the card keeps what it drew until the new answer lands, and keeps it when none does
  async function refresh(callId) {
    try {
      const body = await getJson(gatePath(callId));
      if (body?.gate && typeof body.gate === 'object') store.dispatch('memoryGateLoaded', { callId, gate: body.gate });
    } catch { /* the card keeps what it drew */ }
  }

  async function ensure() {
    const s = store.get();
    if (seen && seen[0] === s.conversations && seen[1] === s.memoryGate) return;
    seen = [s.conversations, s.memoryGate];
    await Promise.all(wanted(s).map(read));
  }

  /** The owner's override of a red-lined card: true once the face kept it, false when it refused or nothing was said. */
  async function override(callId, reason, wrongIf) {
    const said = typeof reason === 'string' ? reason.trim() : '';
    const wrong = typeof wrongIf === 'string' ? wrongIf.trim() : '';
    if (typeof callId !== 'string' || !CALL_ID.test(callId) || said === '') return false;
    try {
      await postJson('/data/memory/gate/override', { callId, reason: said, ...(wrong === '' ? {} : { wrongIf: wrong }) });
    } catch {
      return false;
    }
    void refresh(callId);
    return true;
  }

  return { ensure, override };
}
