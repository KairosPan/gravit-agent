// face/client/js/reducers/channels.js — a strategy page's reads (host/channels.js): its channel's overview — loading, loaded,
// failed or missing; a failed read keeps what was loaded for that channel, stamped stale by the page — and the paper positions
// of the venue its status.yaml names, kept beside the overview of the same channel.
const same = (s, id) => s.channel?.id === id;
export const NO_POSITIONS = Object.freeze({ status: 'idle', venue: null, rows: [], message: null });
const keptPositions = (s, id) => (same(s, id) && s.channel.positions ? s.channel.positions : NO_POSITIONS);
// a positions answer lands only on the channel it was asked for
const withPositions = (s, workspaceId, positions) => (same(s, workspaceId) ? { ...s, channel: { ...s.channel, positions } } : s);

export const reducers = {
  channelLoading: (s, { workspaceId }) => ({
    ...s,
    channel: {
      id: workspaceId, status: 'loading', data: same(s, workspaceId) ? s.channel.data : null, at: same(s, workspaceId) ? s.channel.at : null,
      positions: keptPositions(s, workspaceId),
    },
  }),
  channelLoaded: (s, { workspaceId, data, at }) => ({ ...s, channel: { id: workspaceId, status: 'ready', data, at, positions: keptPositions(s, workspaceId) } }),
  channelFailed: (s, { workspaceId, at, missing = false }) => ({
    ...s,
    channel: {
      id: workspaceId, status: missing ? 'missing' : 'failed',
      data: same(s, workspaceId) ? s.channel.data : null, at: same(s, workspaceId) && s.channel.at !== null ? s.channel.at : at,
      positions: keptPositions(s, workspaceId),
    },
  }),
  // the venue's positions: asked (the rows of the same venue kept meanwhile), answered, or refused in the Account's words
  // (`message`) — with none, failed
  channelPositionsLoading: (s, { workspaceId, venue }) => {
    const p = keptPositions(s, workspaceId);
    return withPositions(s, workspaceId, { status: 'loading', venue, rows: p.venue === venue ? p.rows : [], message: null });
  },
  channelPositionsLoaded: (s, { workspaceId, venue, rows }) => withPositions(s, workspaceId, { status: 'ready', venue, rows: Array.isArray(rows) ? rows : [], message: null }),
  channelPositionsFailed: (s, { workspaceId, venue, message = null }) => withPositions(s, workspaceId, {
    status: message ? 'refused' : 'failed', venue, rows: [], message: message ?? null,
  }),
};
