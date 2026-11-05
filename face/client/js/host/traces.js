// face/client/js/host/traces.js — a room member's trace (spec 2026-10-19 §7 Stage 3 "Research surfaces"): the turn that
// produced a member's answer, read without activating the member's session (wire/member-traces.js reads the
// projections cut, then pages the history back) and folded into messages the way the thread folds a window, so its
// tool calls are stored but not drawn, the rest draws with the same renderers. Once per answer — an answer is its conversation and message id, since message
// ids are log sequences two rooms repeat; a failure may be opened again.
import { toMessages } from './kinds.js';
import { reducers as host } from '../reducers/host.js';
import { said } from '../i18n/words.js';

export function startTraces({ store, call, loadMemberTrace, now = Date.now }) {
  const started = new Set();

  async function open(convId, msgId) {
    const key = `${convId} ${msgId}`;
    if (started.has(key) || store.get().traces?.[convId]?.[msgId]?.status === 'ready') return;
    const m = store.get().conversations.find(c => c.id === convId)?.messages.find(x => x.id === msgId);
    if (!m) return;
    started.add(key);
    store.dispatch('traceLoading', { convId, msgId });
    try {
      const views = await loadMemberTrace(call, { sessionId: m.data?.memberSessionId, turn: m.data?.memberTurn });
      const calls = new Map();
      let scratch = { conversations: [{ id: 'trace', messages: [], thinking: null }] };
      for (const v of views) for (const msg of toMessages(v, calls, now(), m.from)) scratch = host.hostEvent(scratch, { convId: 'trace', message: msg });
      store.dispatch('traceLoaded', { convId, msgId, messages: scratch.conversations[0].messages });
    } catch (err) {
      store.dispatch('traceFailed', { convId, msgId, line: err?.said ?? err?.message ?? said('thread.trace.failed') });
    } finally {
      started.delete(key);
    }
  }

  return { open };
}
