// face/client/js/host/channels.js — a channel from the face (spec 2026-10-19 §7 Stage 3 "Channels"): the overview read
// behind its page (status, thesis, backtests, journal, files, rosters), a new channel, and the two roster writes.
// Impure; nothing here draws. A write answers {ok: true} or {error: <words>} for the editor that asked.
import { foldChannelName } from '../wire/channelName.js';
import { t } from '../i18n/words.js';

// the face's own rule for a channel's name (src/channels.ts NAME_RE), checked before anything is posted
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]{0,40}$/u;
export const MAX_BOTS = 6; // a channel rosters at most six bots (src/room-rules.ts ROOM_CAPS.maxMembers)
const words = err => err?.code ?? err?.message ?? t('channel.failed');

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

  // birth strategies/<name> from the template: the name folded as the old page folded it, then found again in the
  // re-read list by the directory the route answered (the route answers no workspace id)
  async function create(raw) {
    const name = foldChannelName(typeof raw === 'string' ? raw : '');
    if (!NAME_RE.test(name) || name === '_template') return { error: t('channel.name.rule') };
    try {
      const made = await postJson('/data/channels', { name });
      await refresh();
      const ch = (store.get().channels ?? []).find(c => c.dir === made?.dir);
      return ch ? { workspaceId: ch.workspaceId } : { error: t('channel.notListed') };
    } catch (err) {
      return { error: words(err) };
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
    ? Promise.resolve({ error: t('channel.atMostSix') })
    : write('/data/channels/bots', { workspaceId, bots: ids }, workspaceId));

  return { overview, create, agentChoices, setAgents, setBots };
}
