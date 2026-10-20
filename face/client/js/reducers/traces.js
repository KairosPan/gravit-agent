// face/client/js/reducers/traces.js — a room member's trace by the answer it explains (host/traces.js): loading, its
// folded messages, or the loader's words.
const put = (s, msgId, value) => ({ ...s, traces: { ...(s.traces ?? {}), [msgId]: value } });

export const reducers = {
  traceLoading: (s, { msgId }) => put(s, msgId, { status: 'loading' }),
  traceLoaded: (s, { msgId, messages }) => put(s, msgId, { status: 'ready', messages: Array.isArray(messages) ? messages : [] }),
  traceFailed: (s, { msgId, line }) => put(s, msgId, { status: 'failed', line: typeof line === 'string' && line !== '' ? line : 'The trace could not be read.' }),
};
