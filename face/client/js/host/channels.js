// face/client/js/host/channels.js — a strategy's channel from the face (spec 2026-10-19 §7 Stage 3 "Channels"): the overview
// read behind its page (status, thesis, backtests, journal, files), the paper positions of the venue its status.yaml
// names (one-entry plan 2: only that venue, never a guess). Impure; nothing here draws.
import { positionsOf } from './account-view.js';

// the Account's refusal as one line: its sentence, else its code; null when the body carries none
const text = v => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const refusalLine = body => text(body?.refusal?.message) ?? text(body?.refusal?.code) ?? null;

export function startChannels({ store, postJson, getJson, now = Date.now }) {
  let seq = 0; // only the latest-started overview lands

  async function overview(workspaceId) {
    if (typeof workspaceId !== 'string' || workspaceId === '') return;
    const mine = ++seq;
    store.dispatch('channelLoading', { workspaceId });
    try {
      const data = await postJson('/data/channels/overview', { workspaceId });
      if (mine !== seq) return;
      store.dispatch('channelLoaded', { workspaceId, data, at: now() });
      const venue = data?.status?.venue;
      if (typeof venue === 'string' && venue !== '') void positions(venue, workspaceId);
    } catch (err) {
      if (mine !== seq) return;
      store.dispatch('channelFailed', { workspaceId, at: now(), missing: err?.status === 404 });
    }
  }

  // the paper positions at the venue a strategy's status.yaml names, through the face's proxy to the Account: its rows as
  // positionsOf reads them, or its refusal (a 409's `refusal`) as one line; anything else fails. Only the latest-asked lands,
  // and only on the channel it was asked for
  let pseq = 0;
  async function positions(venue, workspaceId = store.get().channel?.id ?? null) {
    if (typeof venue !== 'string' || venue === '' || typeof workspaceId !== 'string') return;
    const mine = ++pseq;
    store.dispatch('channelPositionsLoading', { workspaceId, venue });
    try {
      const body = await getJson(`/data/account/positions?venue=${encodeURIComponent(venue)}`);
      if (mine !== pseq) return;
      if (body?.ok === true) store.dispatch('channelPositionsLoaded', { workspaceId, venue, rows: positionsOf(body) });
      else store.dispatch('channelPositionsFailed', { workspaceId, venue, message: refusalLine(body) });
    } catch (err) {
      if (mine !== pseq) return;
      store.dispatch('channelPositionsFailed', { workspaceId, venue, message: refusalLine(err?.body) });
    }
  }

  return { overview, positions };
}
