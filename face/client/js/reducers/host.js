// face/client/js/reducers/host.js — the host reducers (spec 2026-10-19 §5): the store is a cache of what dsh says.
// Messages are keyed by the host's ids (an event's seq, a tool's callId, a gate's eventId) and kept in seq order;
// a gate sits after the last event it arrived behind; nothing here drops a host message for a local reason.
const upd = (s, id, fn) => ({ ...s, conversations: s.conversations.map(c => (c.id === id ? fn(c) : c)) });
const find = (s, id) => s.conversations.find(c => c.id === id);
const isGate = m => !!m.data && typeof m.data.eventId === 'string';
const maxSeq = msgs => msgs.reduce((top, m) => (typeof m.seq === 'number' && m.seq > top ? m.seq : top), 0);
const roomMembers = room => (room && typeof room === 'object' && room.members && typeof room.members === 'object' ? Object.keys(room.members) : []);

// the history window (plan 5): a seq covered by any replace range the window has folded or the stream delivered is
// never drawn again, whichever page brings it back
const covered = (ranges, seq) => ranges.some(([a, b]) => seq >= a && seq <= b);
const rangesOf = w => (Array.isArray(w?.replaced) ? w.replaced : []);
const unionRanges = (a, b) => {
  const out = [...a];
  for (const r of b) if (!out.some(x => x[0] === r[0] && x[1] === r[1])) out.push(r);
  return out;
};
// messages of an earlier slice that may join the drawn ones: below the start, a numbered non-gate, not drawn, not covered
const earlierOf = (msgs, start, ranges, drawn) => msgs.filter(m => typeof m.seq === 'number' && m.seq < start && !isGate(m) && !drawn.has(m.id) && !covered(ranges, m.seq));

function insertBySeq(msgs, m) {
  const i = msgs.findIndex(x => typeof x.seq === 'number' && x.seq > m.seq);
  return i < 0 ? [...msgs, m] : [...msgs.slice(0, i), m, ...msgs.slice(i)];
}

// a window's messages folded in one pass, by hostEvent's rules (a replace drops its range but gates, a seen id is
// skipped or merged, the rest by seq) but in place: a message past the end is pushed, so a long backfill is linear
export function foldMessages(list) {
  let msgs = [];
  let at = new Map();               // id → index in msgs
  let top = -Infinity;              // the highest numbered seq in msgs: a message at or past it is pushed
  const reindex = () => {
    at = new Map(msgs.map((m, i) => [m.id, i]));
    top = msgs.reduce((t, m) => (typeof m.seq === 'number' && m.seq > t ? m.seq : t), -Infinity);
  };
  for (const message of list) {
    if (message.replace) {
      const { start, end } = message.replace;
      msgs = msgs.filter(m => isGate(m) || !(typeof m.seq === 'number' && m.seq >= start && m.seq <= end));
      reindex();
    }
    const i = at.get(message.id);
    if (i !== undefined) {
      if (message.merge) msgs[i] = { ...msgs[i], data: { ...msgs[i].data, ...message.data } };
      continue;
    }
    const { merge: _merge, ...rest } = message;
    if (typeof rest.seq !== 'number' || rest.seq >= top) {
      at.set(rest.id, msgs.length);
      msgs.push(rest);
      if (typeof rest.seq === 'number') top = rest.seq;
    } else {
      msgs = insertBySeq(msgs, rest);
      reindex();
    }
  }
  return msgs;
}

// a projection kept only whole: every outline entry's turn and seq integers, its previews strings; every figure finite
const isOutline = v => Array.isArray(v) && v.every(e => e && Number.isInteger(e.turn) && Number.isInteger(e.seq)
  && typeof e.prompt === 'string' && typeof e.response === 'string');
const STAT_FIELDS = ['turns', 'steps', 'llmMs', 'toolMs', 'ttftMs', 'ttftSteps', 'decodeMs', 'decodeTokens'];
const isStats = v => !!v && typeof v === 'object' && STAT_FIELDS.every(k => Number.isFinite(v[k]));

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
        ? { ...c, messages: o.messages, loaded: o.loaded, window: o.window, outline: o.outline, stats: o.stats, preview: o.preview, previewAt: o.previewAt, usage: o.usage, thinking: o.thinking, subagentCatalog: o.subagentCatalog, created: o.created ?? c.created, lastSeen: Math.max(o.lastSeen ?? 0, c.lastSeen ?? 0) }
        : c;
    });
    return {
      ...s, conversations: next, channels: Array.isArray(channels) ? channels : s.channels, bots: Array.isArray(bots) ? bots : s.bots,
      childRows: Array.isArray(childRows) ? childRows : s.childRows,
    };
  },

  // a follow snapshot or a page: the window whole, never appended to what was drawn. With a window that the old one
  // reaches (its cut or its last streamed message at least the seq before the new start), the earlier pages already
  // drawn below the start stay before it (a reconnect while reading up keeps the place), and the start and its hasMore
  // are the lower window's; a window past a gap is taken whole, so the gap pages in, and so is a fresh one (the
  // conversation re-opened to fold its lines again: nothing folded before it stays). Loading is only what the payload
  // says: the live layer folds in a read still under way
  hostWindow(s, { convId, messages, usage, created, window }) {
    const c0 = find(s, convId);
    if (!c0) return s;
    if (!window) return upd(s, convId, c => ({ ...c, messages: [...messages], loaded: true, usage: usage ?? c.usage, created: created ?? c.created }));
    const old = c0.window;
    const replaced = unionRanges(rangesOf(old), rangesOf(window));
    const drawn = new Set(messages.map(m => m.id));
    const reach = old ? Math.max(typeof old.through === 'number' ? old.through : 0, maxSeq(c0.messages.filter(m => !isGate(m)))) : -Infinity;
    const kept = old && !window.fresh && reach >= window.start - 1 ? earlierOf(c0.messages, window.start, replaced, drawn) : [];
    const lower = kept.length > 0 && old.start < window.start;
    const next = {
      start: lower ? old.start : window.start, through: window.through,
      hasMore: lower ? old.hasMore === true : window.hasMore === true, replaced,
      ...(window.loading ? { loading: true } : {}),
    };
    return upd(s, convId, c => ({ ...c, messages: [...kept, ...messages], loaded: true, window: next, usage: usage ?? c.usage, created: created ?? c.created }));
  },

  // earlier pages of the window on screen: prepended below its start, a drawn id or a covered seq dropped; a page's own
  // ranges join the window's (they lie below the page, so they cover nothing already drawn). Pages read before a start
  // the window no longer has (a snapshot past a gap replaced it) are dropped, and loading cleared
  hostEarlier(s, { convId, messages, start, hasMore, replaced: more = [], before }) {
    const c0 = find(s, convId);
    if (!c0?.window) return s;
    if (typeof before === 'number' && before !== c0.window.start) return reducers.hostEarlierLoading(s, { convId, on: false });
    const replaced = unionRanges(rangesOf(c0.window), Array.isArray(more) ? more : []);
    const add = earlierOf(messages, c0.window.start, replaced, new Set(c0.messages.map(m => m.id)));
    const { loading: _done, ...w } = c0.window;
    const win = { ...w, start: Math.min(w.start, typeof start === 'number' ? start : w.start), hasMore: hasMore === true, replaced };
    return upd(s, convId, c => ({ ...c, messages: [...add, ...c.messages], window: win }));
  },
  // the earlier pages dropped (the reader at the tail as a turn starts): the messages below start go, a gate and a send
  // with no seq stay; the window starts there again with more before it
  hostDropEarlier(s, { convId, start }) {
    const c0 = find(s, convId);
    if (!c0?.window || typeof start !== 'number' || c0.window.start >= start) return s;
    const messages = c0.messages.filter(m => isGate(m) || typeof m.seq !== 'number' || m.seq >= start);
    return upd(s, convId, c => ({ ...c, messages, window: { ...c.window, start, hasMore: true } }));
  },
  hostEarlierLoading(s, { convId, on }) {
    const c0 = find(s, convId);
    if (!c0?.window) return s;
    const { loading: _was, ...w } = c0.window;
    return upd(s, convId, c => ({ ...c, window: on ? { ...w, loading: true } : w }));
  },

  hostEvent(s, { convId, message }) {
    const c = find(s, convId);
    if (!c) return s;
    let msgs = c.messages;
    let window = c.window;
    if (message.replace) {
      const { start, end } = message.replace;
      msgs = msgs.filter(m => isGate(m) || !(typeof m.seq === 'number' && m.seq >= start && m.seq <= end));
      if (window) window = { ...window, replaced: unionRanges(rangesOf(window), [[start, end]]) };
    }
    const i = msgs.findIndex(m => m.id === message.id);
    if (i >= 0) {
      if (!message.merge) return msgs === c.messages && window === c.window ? s : upd(s, convId, x => ({ ...x, messages: msgs, ...(window ? { window } : {}) }));
      const merged = { ...msgs[i], data: { ...msgs[i].data, ...message.data } };
      msgs = msgs.map((m, j) => (j === i ? merged : m));
    } else {
      const { merge, ...rest } = message;
      msgs = insertBySeq(msgs, rest);
    }
    const thinking = message.from === 'you' ? c.thinking : null;
    return upd(s, convId, x => ({ ...x, messages: msgs, thinking, ...(window ? { window } : {}) }));
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
      // the whole log's turns (dsh-session-turn-outline) and figures (dsh-session-stats), independent of the window
      case 'turnOutline':
        return isOutline(value) ? upd(s, convId, c => ({ ...c, outline: value })) : s;
      case 'sessionStats':
        return isStats(value) ? upd(s, convId, c => ({ ...c, stats: value })) : s;
      // the parent's record of its children, kept as the host sent it; the Children section validates it
      case 'subagentCatalog':
        return upd(s, convId, c => ({ ...c, subagentCatalog: value }));
      default:
        return s;
    }
  },

  hostThinking: (s, { convId, mode }) => (find(s, convId) ? upd(s, convId, c => ({ ...c, thinking: mode ?? null })) : s),
  // an operator image's thumbnail by its attachment id: a data: URL, or null for one the host cannot give back
  hostThumb: (s, { attachmentId, src }) => ({ ...s, thumbs: { ...s.thumbs, [attachmentId]: typeof src === 'string' ? src : null } }),

  hostPreview: (s, { convId, preview, at }) => (find(s, convId) ? upd(s, convId, c => ({ ...c, preview: preview ?? null, previewAt: at })) : s),

  // the operator looked: unread is what the host moved after this
  markSeen(s, { convId, seq }) {
    const c = find(s, convId);
    if (!c) return s;
    const v = Math.max(c.lastSeen ?? 0, typeof seq === 'number' ? seq : 0);
    return { ...upd(s, convId, x => ({ ...x, lastSeen: v })), lastSeen: { ...(s.lastSeen ?? {}), [convId]: v } };
  },
};
