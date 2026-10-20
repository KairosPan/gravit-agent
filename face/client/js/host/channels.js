// face/client/js/host/channels.js — a channel from the face (spec 2026-10-19 §7 Stage 3 "Channels"): the overview read
// behind its page (status, thesis, backtests, journal, files, rosters). Impure; nothing here draws.
export function startChannels({ store, postJson, getJson, refresh, now = Date.now }) {
  let seq = 0; // only the latest-started overview lands

  async function overview(workspaceId) {
    if (typeof workspaceId !== 'string' || workspaceId === '') return;
    const mine = ++seq;
    store.dispatch('channelLoading', { workspaceId });
    try {
      const data = await postJson('/data/channels/overview', { workspaceId });
      if (mine !== seq) return;
      store.dispatch('channelLoaded', { workspaceId, data, at: now() });
    } catch (err) {
      if (mine !== seq) return;
      store.dispatch('channelFailed', { workspaceId, at: now(), missing: err?.status === 404 });
    }
  }

  return { overview };
}
