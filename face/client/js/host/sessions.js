// face/client/js/host/sessions.js — session/list rows become conversations (spec 2026-10-19 §5, §7 "List"). Pure.
// The old client's own helpers do the delicate parts: summaries.js restores the preset dsh 0.2 dropped from the row,
// room.js folds a room's member sessions under it, speaker.js knows which presets are the host.
import { summaryOf } from '../wire/summaries.js';
import { foldMembers } from '../wire/room.js';
import { isHostPreset } from '../wire/speaker.js';
import { isSubagentRow } from '../wire/subagents.js';
import { t } from '../i18n/words.js';

const str = v => (typeof v === 'string' && v !== '' ? v : undefined);
// the restored field first (summaryOf), the row's own projection when a raw row is handed in
const presetOf = s => str(s.agentPreset) ?? str(s.projections?.values?.agentPreset);
const roomMembers = room => (room && typeof room === 'object' && room.members && typeof room.members === 'object' ? Object.keys(room.members) : []);

// group once the room projection says so or the fold found members; a bot preset is the bot's home; else Gravit's
export function kindOf(summary, room, foldIds = []) {
  if ((room && room.kind === 'room') || foldIds.length > 0) return 'group';
  const preset = presetOf(summary);
  return preset !== undefined && !isHostPreset(preset) ? 'bot' : 'gravit';
}

// one row (already through summaryOf) → the conversation record the store keeps; `fold` is the room's member fold for it
export function conversationOf(summary, ctx, fold = { ids: [], sessions: [] }) {
  const id = String(summary.sessionId);
  const room = ctx.rooms?.get(id);
  const kind = kindOf(summary, room, fold.ids);
  const preset = presetOf(summary);
  const members = kind === 'bot' ? [preset] : kind === 'group' ? ['gravit', ...new Set([...roomMembers(room), ...fold.ids])] : ['gravit'];
  return {
    id,
    title: str(summary.projections?.values?.title) ?? t('list.untitled'),
    kind, members, memberSessions: fold.sessions,
    channel: ctx.channelOf?.(id) ?? null,
    // archived by the host (channels.json) or by the face (sessions-meta.json); only the face's can be undone
    archived: ctx.hostArchived?.has(id) ? 'host' : ctx.archived?.has(id) ? 'face' : false,
    preset,
    running: summary.running === true,
    live: summary.agentAvailable === true,
    updatedAt: typeof summary.updatedAt === 'number' ? summary.updatedAt : 0,
    created: null, // the follow snapshot's header fills it
    messages: [], loaded: false, preview: null, usage: null, thinking: null,
    lastSeen: typeof ctx.lastSeen?.[id] === 'number' ? ctx.lastSeen[id] : 0,
  };
}

// the whole list: members folded away, subagent children (origin) and deleted ids dropped, archived ones kept and
// marked, newest first
export function listConversations(items, ctx) {
  const rows = (Array.isArray(items) ? items : []).map(r => summaryOf(r, ctx.presets));
  const fold = foldMembers(rows);
  const out = [];
  for (const s of rows) {
    const id = String(s.sessionId);
    if (fold.members.has(id) || s.origin !== undefined || ctx.deleted?.has(id)) continue;
    const memberRows = fold.rooms.get(id) ?? [];
    out.push(conversationOf(s, ctx, { ids: memberRows.map(m => String(m.agentPreset)), sessions: memberRows.map(m => String(m.sessionId)) }));
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

// the subagent children the list leaves out, kept for their parent's Children section: who, under whom, running
export function childRowsOf(items) {
  return (Array.isArray(items) ? items : []).filter(isSubagentRow).map(r => ({
    sessionId: String(r.sessionId), parentSessionId: str(r.parentSessionId), running: r.running === true, origin: 'subagent',
  }));
}

// the conversation a default opens: the first that is not archived
export const firstOpen = conversations => (Array.isArray(conversations) ? conversations.find(c => !c.archived) : undefined) ?? null;

// the host moved it after the operator last looked
export const unreadOf = conv => conv.updatedAt > (conv.lastSeen ?? 0);
