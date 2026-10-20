// face/client/js/reducers/traces.js — a room member's trace by the answer it explains (host/traces.js), under that
// answer's conversation (a message id is its log's sequence, so two rooms repeat them): loading, its folded messages, or
// the loader's words.
const put = (s, convId, msgId, value) => ({ ...s, traces: { ...(s.traces ?? {}), [convId]: { ...(s.traces?.[convId] ?? {}), [msgId]: value } } });

export const reducers = {
  traceLoading: (s, { convId, msgId }) => put(s, convId, msgId, { status: 'loading' }),
  traceLoaded: (s, { convId, msgId, messages }) => put(s, convId, msgId, { status: 'ready', messages: Array.isArray(messages) ? messages : [] }),
  traceFailed: (s, { convId, msgId, line }) => put(s, convId, msgId, { status: 'failed', line: typeof line === 'string' && line !== '' ? line : 'The trace could not be read.' }),
};
