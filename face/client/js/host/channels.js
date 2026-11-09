// face/client/js/host/channels.js — a strategy's channel from the face (spec 2026-10-19 §7 Stage 3 "Channels"): the overview
// read behind its page (status, thesis, backtests, journal, files, rosters), the paper positions of the venue its status.yaml
// names (one-entry plan 2: only that venue, never a guess), and the two roster writes.
// Impure; nothing here draws. A write answers {ok: true} or {error: <words>} for the editor that asked.
import { positionsOf } from './account-view.js';
import { said } from '../i18n/words.js';

export const MAX_BOTS = 6; // a channel rosters at most six bots (src/room-rules.ts ROOM_CAPS.maxMembers)
// the Account's refusal as one line: its sentence, else its code; null when the body carries none
const text = v => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const refusalLine = body => text(body?.refusal?.message) ?? text(body?.refusal?.code) ?? null;
const words = err => err?.code ?? err?.said ?? err?.message ?? said('channel.failed');

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

  // the agents a channel may roster: the connected CLI agents that answered on this machine
  async function agentChoices() {
    try {
      const body = await getJson('/data/agents.json');
      return (Array.isArray(body?.local) ? body.local : [])
        .filter(a => a && a.found === true && typeof a.bin === 'string' && a.bin !== '')
        .map(a => ({ bin: a.bin, label: typeof a.label === 'string' && a.label !== '' ? a.label : a.bin }));
    } catch {
      return [];
    }
  }

  async function write(path, body, workspaceId) {
    try {
      await postJson(path, body);
    } catch (err) {
      return { error: words(err) };
    }
    await overview(workspaceId);
    return { ok: true };
  }
  const setAgents = (workspaceId, bins) => write('/data/channels/agents', { workspaceId, agents: bins }, workspaceId);
  const setBots = (workspaceId, ids) => (ids.length > MAX_BOTS
    ? Promise.resolve({ error: said('channel.atMostSix') })
    : write('/data/channels/bots', { workspaceId, bots: ids }, workspaceId));

  return { overview, positions, agentChoices, setAgents, setBots };
}
