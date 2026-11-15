// face/client/js/host/memory-gate.js — the lessons an order card draws (memory order card, Task 6): each seat card the page
// holds with a call id is asked once, `GET /data/memory/gate?callId=`, and what the face kept for that call lands in the
// memoryGate slice (reducers/memory-gate.js) — the gate, none on a 404 (a card raised before the gate, or an entry being
// checked again), failed on anything else. An answered card is asked too, so what was registered for it can be drawn; an
// answered card whose gate says nothing registered yet, and a failed read, are read again after a render (each event of the
// session brings one), up to GATE_READS_AGAIN times, GATE_READ_AGAIN_MS apart — no timer of its own. A none stays none. The
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

/** How many reads may follow a card's first, and how long after the previous read the next may begin. */
export const GATE_READS_AGAIN = 3;
export const GATE_READ_AGAIN_MS = 2_000;

const registered = gate => (Array.isArray(gate?.lines) ? gate.lines : []).some(l => typeof l?.registered === 'string' && l.registered !== '');

// whether an entry is read again, by the schedule: a failed read, or an answered card whose gate says nothing registered yet,
// at most GATE_READS_AGAIN times after the first, each GATE_READ_AGAIN_MS after the one before; `wait` when it will be, later
function againOf(entry, m) {
  const ready = entry?.status === 'ready' && entry.busy !== true && !!m.answer && !registered(entry.gate);
  if (!(entry?.status === 'failed' || ready)) return 'no';
  return (entry.again ?? 0) >= GATE_READS_AGAIN ? 'no' : 'due';
}

// every seat card's call id to read now — the slice holds nothing for it, or the schedule says read it again — once each,
// in the order the page holds them; and whether a read again waits on the clock alone
function wanted(state, now) {
  const kept = state.memoryGate ?? {};
  const out = new Map();
  let waits = false;
  for (const conv of state.conversations ?? []) {
    for (const m of conv?.messages ?? []) {
      const callId = callIdOf(m);
      if (callId === null || out.has(callId)) continue;
      if (!Object.hasOwn(kept, callId)) { out.set(callId, 0); continue; }
      const entry = kept[callId];
      if (againOf(entry, m) !== 'due') continue;
      if (typeof entry.at === 'number' && now - entry.at < GATE_READ_AGAIN_MS) { waits = true; continue; }
      out.set(callId, (entry.again ?? 0) + 1);
    }
  }
  return { reads: [...out], waits };
}

const gatePath = callId => `/data/memory/gate?callId=${encodeURIComponent(callId)}`;

export function startMemoryGate({ store, getJson, postJson, now = Date.now }) {
  // the scan is skipped while neither the conversations nor the slice moved and no read again waits on the clock (renders run
  // many times a second)
  let seen = null;

  async function read([callId, again]) {
    store.dispatch('memoryGateLoading', { callId, at: now(), again });
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
    const { reads, waits } = wanted(s, now());
    seen = waits ? null : [s.conversations, s.memoryGate];
    await Promise.all(reads.map(read));
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
