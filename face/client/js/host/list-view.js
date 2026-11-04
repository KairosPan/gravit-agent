// face/client/js/host/list-view.js — the conversation list's groups (spec 2026-10-19 §7 Stage 3 "Channels"). Pure.
// grouping.js decides the bucket (archived > the desk > a bot's home > a channel > none); this orders the buckets: the
// root channel first, then Desk - every gravit-desk conversation, wherever it ran, so a report never lands among a
// strategy's research (P4 ruling 6) - then each group by its newest conversation, the empty channels by name, Archived
// last.
import { bucketFor, ARCHIVED_KEY, DESK_KEY, UNGROUPED_KEY, BOT_KEY_PREFIX } from '../wire/grouping.js';
import { isDeskPreset } from '../wire/speaker.js';

// a channel goes by one name everywhere: its display title (the registry's, the operator's to change), else its name
export const channelLabel = ch => (typeof ch.title === 'string' && ch.title !== '' ? ch.title : ch.name);
const labelOf = channelLabel;
const newest = g => g.conversations.reduce((top, c) => Math.max(top, c.updatedAt ?? 0), -1);

// [{key, label, kind: 'channel'|'desk'|'bot'|'none'|'archived', workspaceId, isRoot, conversations, collapsed, shown}]; a
// collapsed group shows only the conversation on screen. Collapse is the viewer's (prefs `collapsed`), Archived shut
// until opened.
export function groupsOf(state) {
  const channels = Array.isArray(state.channels) ? state.channels : [];
  const botName = id => state.bots?.find(b => b.id === id)?.name ?? id;
  const groups = new Map();
  const add = (key, init) => {
    if (!groups.has(key)) groups.set(key, { key, workspaceId: null, isRoot: false, ...init, conversations: [] });
    return groups.get(key);
  };
  // every channel is a group, an empty one too, so a new channel's page is reachable from the list
  for (const ch of channels) add(ch.workspaceId, { label: labelOf(ch), kind: 'channel', workspaceId: ch.workspaceId, isRoot: ch.isRoot === true });
  for (const c of state.conversations ?? []) {
    const known = c.channel ? channels.find(ch => ch.workspaceId === c.channel.workspaceId) : null;
    const channel = c.channel ? { workspaceId: c.channel.workspaceId, title: known ? labelOf(known) : c.channel.name } : null;
    const bot = c.kind === 'bot' && c.preset ? { id: c.preset, label: botName(c.preset) } : null;
    const b = bucketFor(channel, !!c.archived, bot, false, isDeskPreset(c.preset));
    const kind = b.key === ARCHIVED_KEY ? 'archived' : b.key === DESK_KEY ? 'desk' : b.key === UNGROUPED_KEY ? 'none'
      : bot && b.key === BOT_KEY_PREFIX + bot.id ? 'bot' : 'channel';
    const label = kind === 'archived' ? 'Archived' : kind === 'desk' ? 'Desk' : kind === 'none' ? 'No channel' : b.label;
    add(b.key, { label, kind, workspaceId: kind === 'channel' ? b.key : null }).conversations.push(c);
  }
  // pinned lead their group, newest first, then the rest newest first; an archived row is never pinned, and a pinned id
  // the list does not hold matches nothing. The records handed back are copies carrying `pinned`
  const pins = new Set(Array.isArray(state.pinned) ? state.pinned : []);
  const byNew = (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  for (const g of groups.values()) {
    const marked = g.conversations.map(c => ({ ...c, pinned: g.kind !== 'archived' && !c.archived && pins.has(c.id) }));
    g.conversations = [...marked.filter(c => c.pinned).sort(byNew), ...marked.filter(c => !c.pinned).sort(byNew)];
  }
  const all = [...groups.values()];
  const live = all.filter(g => g.kind !== 'archived' && g.kind !== 'desk');
  const order = [
    ...live.filter(g => g.isRoot),
    ...all.filter(g => g.kind === 'desk'),
    ...live.filter(g => !g.isRoot && g.conversations.length).sort((a, b) => newest(b) - newest(a)),
    ...live.filter(g => !g.isRoot && !g.conversations.length).sort((a, b) => a.label.localeCompare(b.label)),
    ...all.filter(g => g.kind === 'archived'),
  ];
  const current = state.route?.screen === 'messages' ? state.route.id : null;
  return order.map(g => {
    const set = state.collapsed?.[g.key];
    const collapsed = typeof set === 'boolean' ? set : g.kind === 'archived';
    return { ...g, collapsed, shown: collapsed ? g.conversations.filter(c => c.id === current) : g.conversations };
  });
}
