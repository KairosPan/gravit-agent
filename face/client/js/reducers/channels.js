// face/client/js/reducers/channels.js — the channel page's read (host/channels.js): loading, loaded, failed or missing.
// A failed read keeps what was loaded for that channel, stamped stale by the page.
const same = (s, id) => s.channel?.id === id;

export const reducers = {
  channelLoading: (s, { workspaceId }) => ({
    ...s, channel: { id: workspaceId, status: 'loading', data: same(s, workspaceId) ? s.channel.data : null, at: same(s, workspaceId) ? s.channel.at : null },
  }),
  channelLoaded: (s, { workspaceId, data, at }) => ({ ...s, channel: { id: workspaceId, status: 'ready', data, at } }),
  channelFailed: (s, { workspaceId, at, missing = false }) => ({
    ...s,
    channel: {
      id: workspaceId, status: missing ? 'missing' : 'failed',
      data: same(s, workspaceId) ? s.channel.data : null, at: same(s, workspaceId) && s.channel.at !== null ? s.channel.at : at,
    },
  }),
};
