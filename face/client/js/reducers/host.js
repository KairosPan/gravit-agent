// face/client/js/reducers/host.js — the host reducers (spec 2026-10-19 §5): the store is a cache of what dsh says.
// Messages are keyed by the host's ids (an event's seq, a tool's callId, a gate's eventId) and kept in seq order;
// a gate sits after the last event it arrived behind; nothing here drops a host message for a local reason.
const upd = (s, id, fn) => ({ ...s, conversations: s.conversations.map(c => (c.id === id ? fn(c) : c)) });
const find = (s, id) => s.conversations.find(c => c.id === id);
const isGate = m => !!m.data && typeof m.data.eventId === 'string';
const maxSeq = msgs => msgs.reduce((top, m) => (typeof m.seq === 'number' && m.seq > top ? m.seq : top), 0);
const roomMembers = room => (room && typeof room === 'object' && room.members && typeof room.members === 'object' ? Object.keys(room.members) : []);

function insertBySeq(msgs, m) {
  const i = msgs.findIndex(x => typeof x.seq === 'number' && x.seq > m.seq);
  return i < 0 ? [...msgs, m] : [...msgs.slice(0, i), m, ...msgs.slice(i)];
}

export const reducers = {
  hostStatus(s, { line, bad = false, connected }) {
    return { ...s, status: { line: line ?? s.status?.line ?? '', bad, connected: connected ?? s.status?.connected ?? false } };
  },

  // the pin set, whole, as the host last said it
  hostPins(s, ids) {
    return { ...s, pinned: Array.isArray(ids) ? ids.filter(x => typeof x === 'string') : [] };
  },

  // the list as the host gives it; a surviving conversation keeps its window and what the viewer did with it
  hostList(s, { conversations, channels, bots, childRows }) {
    const old = new Map(s.conversations.map(c => [c.id, c]));
    const next = conversations.map(c => {
      const o = old.get(c.id);
      return o
        ? { ...c, messages: o.messages, loaded: o.loaded, preview: o.preview, previewAt: o.previewAt, usage: o.usage, thinking: o.thinking, subagentCatalog: o.subagentCatalog, created: o.created ?? c.created, lastSeen: Math.max(o.lastSeen ?? 0, c.lastSeen ?? 0) }
        : c;
    });
    return {
      ...s, conversations: next, channels: Array.isArray(channels) ? channels : s.channels, bots: Array.isArray(bots) ? bots : s.bots,
      childRows: Array.isArray(childRows) ? childRows : s.childRows,
    };
  },

  // a follow snapshot or a page: the window whole, never appended to what was drawn
  hostWindow(s, { convId, messages, usage, created }) {
    if (!find(s, convId)) return s;
    return upd(s, convId, c => ({ ...c, messages: [...messages], loaded: true, usage: usage ?? c.usage, created: created ?? c.created }));
  },

  hostEvent(s, { convId, message }) {
    const c = find(s, convId);
    if (!c) return s;
    let msgs = c.messages;
    if (message.replace) {
      const { start, end } = message.replace;
      msgs = msgs.filter(m => isGate(m) || !(typeof m.seq === 'number' && m.seq >= start && m.seq <= end));
    }
    const i = msgs.findIndex(m => m.id === message.id);
    if (i >= 0) {
      if (!message.merge) return msgs === c.messages ? s : upd(s, convId, x => ({ ...x, messages: msgs }));
      const merged = { ...msgs[i], data: { ...msgs[i].data, ...message.data } };
      msgs = msgs.map((m, j) => (j === i ? merged : m));
    } else {
      const { merge, ...rest } = message;
      msgs = insertBySeq(msgs, rest);
    }
    const thinking = message.from === 'you' ? c.thinking : null;
    return upd(s, convId, x => ({ ...x, messages: msgs, thinking }));
  },

  // a gate lands on its conversation, or waits in orphanGates until the list knows that conversation
  hostGate(s, { convId, message }) {
    const { [message.id]: _gone, ...orphans } = s.orphanGates ?? {};
    const c = find(s, convId);
    if (!c) return { ...s, orphanGates: { ...orphans, [message.id]: { convId, message } } };
    const i = c.messages.findIndex(m => m.id === message.id);
    const msgs = i >= 0
      ? c.messages.map((m, j) => (j === i ? { ...message, seq: m.seq, answer: m.answer } : m))
      : insertBySeq(c.messages, { ...message, seq: maxSeq(c.messages) + 0.5 });
    return upd({ ...s, orphanGates: orphans }, convId, x => ({ ...x, messages: msgs }));
  },

  // the gate is over: this tab's own answer stands against a plain withdrawal ('closed'); a lost race ('elsewhere')
  // overrides it, because then this tab's answer is not the one the host took
  hostGateGone(s, { eventId, outcome }) {
    const { [eventId]: _gone, ...orphans } = s.orphanGates ?? {};
    const conversations = s.conversations.map(c => (c.messages.some(m => m.id === eventId)
      ? { ...c, messages: c.messages.map(m => (m.id === eventId && (!m.answer || outcome === 'elsewhere') ? { ...m, answer: outcome } : m)) }
      : c));
    return { ...s, orphanGates: orphans, conversations };
  },

  hostProjection(s, { convId, key, value }) {
    if (!find(s, convId)) return s;
    switch (key) {
      case 'title':
        return typeof value === 'string' && value !== '' ? upd(s, convId, c => ({ ...c, title: value })) : s;
      case 'tokenUsage':
      case 'contextPressure':
        return upd(s, convId, c => ({ ...c, usage: { ...(c.usage ?? {}), [key]: value } }));
      case 'room': {
        if (!value || value.kind !== 'room') return s;
        const members = roomMembers(value);
        return upd(s, convId, c => ({ ...c, kind: 'group', members: ['gravit', ...new Set([...c.members.filter(m => m !== 'gravit'), ...members])] }));
      }
      case 'running':
        return typeof value === 'boolean' ? upd(s, convId, c => ({ ...c, running: value })) : s;
      // the parent's record of its children, kept as the host sent it; the Children section validates it
      case 'subagentCatalog':
        return upd(s, convId, c => ({ ...c, subagentCatalog: value }));
      default:
        return s;
    }
  },

  hostThinking: (s, { convId, mode }) => (find(s, convId) ? upd(s, convId, c => ({ ...c, thinking: mode ?? null })) : s),
  hostPreview: (s, { convId, preview, at }) => (find(s, convId) ? upd(s, convId, c => ({ ...c, preview: preview ?? null, previewAt: at })) : s),

  // the operator looked: unread is what the host moved after this
  markSeen(s, { convId, seq }) {
    const c = find(s, convId);
    if (!c) return s;
    const v = Math.max(c.lastSeen ?? 0, typeof seq === 'number' ? seq : 0);
    return { ...upd(s, convId, x => ({ ...x, lastSeen: v })), lastSeen: { ...(s.lastSeen ?? {}), [convId]: v } };
  },
};
