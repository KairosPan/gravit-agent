// face/client/js/host/live.js — the impure half of the host layer (spec 2026-10-19 §5): the mux, the follow-or-page
// policy, the list and its previews, gates and projections, all into the store. The decisions are the old client's
// (chat.js on main, its open/follow/page/reconcile and host-event handling), ported; nothing here touches the DOM.
import { foldMembers } from '../wire/room.js';
import { summaryOf } from '../wire/summaries.js';
import { rememberCall, toMessages } from './kinds.js';
import { listConversations } from './sessions.js';
import { reducers as host } from '../reducers/host.js';

export const LIST_REFRESH_MS = 1200;   // the list is re-read this long after a burst of host facts
export const PREVIEW_ROWS = 12;        // how many rows get a one-message page for their preview
export const FOLLOW_RETRY_MS = 2000;   // a follow the host ended is re-decided after this
export const CONTROL_RETRY_MS = 10_000;

// a live session is followed (a follow cannot activate it); a cold one is paged, never followed (PLAN D16)
export const viewFor = conv => (conv?.live ? 'follow' : 'page');

const address = id => ({ kind: 'session', sessionId: id });
const codeOf = err => err?.code ?? (err?.status ? `HTTP ${err.status}` : err?.message ?? 'failed');

// onReceipt: called after a streamed order receipt lands (spec §6: the account is read again right after a fill); a
// receipt folded into a window is history and calls nothing
export function startLive({ store, openMux, call, mapFrame, getJson, timers, now = Date.now, onReceipt = () => {} }) {
  const calls = new Map();        // callId → {name, args}: the arguments the order card joins on
  const rooms = new Map();        // sessionId → the room projection's value
  const pending = new Map();      // eventId → the gate message as delivered and still open: placed afresh at every dispatch
  const answeredHere = new Set(); // eventIds this tab's answer won: a report for one afterwards means it lost a race
  let memberBot = new Map();      // a room member's session → its bot id
  let openSeq = 0;
  let listSeq = 0;
  let view = null;                // {id, token, mode: 'follow' | 'page', handle, stale?, failed?}
  let listPending = false;

  const state = () => store.get();
  const convOf = id => state().conversations.find(c => c.id === id);
  const homeOf = sessionId => convOf(sessionId) ?? state().conversations.find(c => Array.isArray(c.memberSessions) && c.memberSessions.includes(sessionId));
  const speakerOf = conv => (conv?.kind === 'bot' && conv.preset ? conv.preset : 'gravit');
  const say = (line, bad = false, connected) => store.dispatch('hostStatus', { line, bad, connected });

  // ---- projections: the control stream, a snapshot's block, a list row's block
  function acceptProjection(v) {
    if (v?.kind !== 'projection' || typeof v.sessionId !== 'string') return;
    if (v.key === 'room') rooms.set(v.sessionId, v.value);
    const conv = convOf(v.sessionId);
    if (!conv) return;
    store.dispatch('hostProjection', { convId: v.sessionId, key: v.key, value: v.value });
    if (v.key === 'title' && typeof v.value === 'string' && v.value !== conv.title) scheduleRefresh();
  }
  function seedBlock(sessionId, block) {
    if (!block || typeof block !== 'object' || block.kind === 'cached') return; // a cached hint's watermark is not comparable
    const values = block.values;
    if (!values || typeof values !== 'object') return;
    for (const [key, value] of Object.entries(values)) acceptProjection({ kind: 'projection', sessionId, key, value, seq: block.asOfSeq });
  }
  function seedBaseline(baseline) {
    const p = baseline?.projections;
    if (!p || typeof p !== 'object') return;
    for (const [id, block] of Object.entries(p)) seedBlock(id, block);
  }

  // ---- frames of the conversation on screen
  function accept(convId, frame) {
    const v = mapFrame(frame);
    if (v.kind === 'pulse') { store.dispatch('hostThinking', { convId, mode: v.mode ?? 'text' }); return; }
    if (v.kind === 'turn') {
      if (v.phase === 'start' || v.phase === 'end') store.dispatch('hostProjection', { convId, key: 'running', value: v.phase === 'start' });
      scheduleRefresh();
      return;
    }
    if (v.kind === 'projection') { acceptProjection(v); return; }
    rememberCall(calls, frame);
    for (const m of toMessages(v, calls, now(), speakerOf(convOf(convId)))) {
      store.dispatch('hostEvent', { convId, message: m });
      if (m.kind === 'receipt') onReceipt();
    }
  }
  // a window is folded with the same reducer the stream uses, so backfill and stream draw identically
  function windowOf(convId, records) {
    const speaker = speakerOf(convOf(convId));
    let scratch = { conversations: [{ id: convId, messages: [], thinking: null }] };
    for (const r of Array.isArray(records) ? records : []) {
      const frame = { type: 'session/event', sessionId: convId, event: r?.event };
      rememberCall(calls, frame);
      for (const m of toMessages(mapFrame(frame), calls, now(), speaker)) scratch = host.hostEvent(scratch, { convId, message: m });
    }
    return scratch.conversations[0].messages;
  }
  function applySnapshot(convId, snapshot) {
    const created = typeof snapshot?.header?.createdAt === 'number' ? snapshot.header.createdAt : undefined;
    store.dispatch('hostWindow', { convId, messages: windowOf(convId, snapshot?.records), created });
    seedBlock(convId, snapshot?.projections);
    for (const m of pending.values()) { // after the window, wherever the list now says each one belongs
      const g = placeGate(m);
      if (g.convId === convId) store.dispatch('hostGate', g);
    }
  }

  // ---- the read of the conversation on screen
  function closeView() {
    const v = view;
    view = null;
    v?.handle?.cancel();
  }
  function follow(id, token) {
    closeView();
    let handle = null;
    const owns = () => view !== null && view.handle === handle && token === openSeq && view.id === id;
    handle = mux.stream('session/follow', { request: { address: address(id), assistantStream: true } }, {
      onItem: item => {
        if (!owns()) return;
        if (item?.type === 'snapshot') applySnapshot(id, item);
        else if (item?.type === 'event') accept(id, { type: 'session/event', sessionId: id, event: item.event });
        else if (item?.type === 'assistant-stream') accept(id, { type: 'assistant-stream', sessionId: id, frame: item.frame });
      },
      onEnd: () => { // the host ended it: re-decided by liveness, never blindly re-followed
        if (!owns()) return;
        view = { id, token, mode: 'page', handle: null, stale: true };
        timers.after(FOLLOW_RETRY_MS, reconcile);
      },
      onError: error => { // a refusal is terminal for this open
        if (!owns()) return;
        view = { id, token, mode: 'page', handle: null, failed: true };
        say(`${error?.code ?? 'error'} — ${error?.message ?? 'the follow failed'}`, true);
      },
    });
    view = { id, token, mode: 'follow', handle };
  }
  async function page(id, token) {
    closeView();
    const v = { id, token, mode: 'page', handle: null };
    view = v;
    try {
      const cut = await call('session/projections', { request: { sessionId: id } });
      if (view !== v || token !== openSeq) return;
      if (!cut || !Number.isSafeInteger(cut.asOfSeq)) throw new Error('the host answered without a projections cut');
      const pg = await call('session/page', { request: { address: address(id), throughSeq: cut.asOfSeq } });
      if (view !== v || token !== openSeq) return;
      applySnapshot(id, { projections: cut, records: pg?.records });
    } catch (err) {
      if (view !== v || token !== openSeq) return;
      view = { ...v, failed: true };
      say(`open: ${codeOf(err)}`, true);
    }
  }
  function open(id) {
    const token = ++openSeq;
    const conv = convOf(id);
    if (!conv) return;
    store.dispatch('markSeen', { convId: id, seq: conv.updatedAt });
    if (viewFor(conv) === 'follow') follow(id, token);
    else void page(id, token);
  }
  // this tab wrote to a paged session: following it now promotes nothing the prompt did not already
  function promote(id) {
    if (view && view.id === id && view.mode === 'page' && !view.failed) follow(id, view.token);
  }
  function reconcile() {
    if (!view || view.failed) return;
    const conv = convOf(view.id);
    if (!conv) return;
    if (view.mode === 'page' && conv.live) follow(view.id, view.token);
    else if (view.stale) void page(view.id, view.token);
  }
  function suspend() {
    if (view && view.mode === 'follow') {
      view.handle?.cancel();
      view = { ...view, mode: 'page', handle: null, stale: true };
    }
  }
  function stopFollowing(id) {
    if (view && view.id === id && view.mode === 'follow') {
      view.handle?.cancel();
      view = { ...view, mode: 'page', handle: null };
    }
  }

  // ---- gates
  // where a gate goes NOW: its session's own conversation, or the room whose fold lists that session, in the member's
  // bot name; a session the list does not know yet keeps its own id, and the reducer parks the gate as an orphan.
  // Placed at every dispatch, never once at delivery: a gate replayed after a reload arrives before the list does.
  function placeGate(message) {
    const sessionId = message.data?.sessionId;
    const home = homeOf(sessionId);
    if (!home) return { convId: sessionId, message };
    const bot = memberBot.get(sessionId);
    return { convId: home.id, message: bot && home.id !== sessionId ? { ...message, from: bot } : message };
  }
  function acceptGate(frame) {
    const v = mapFrame(frame);
    if (v.kind !== 'approval' && v.kind !== 'question') return;
    const [m] = toMessages(v, calls, now());
    if (!m) return;
    pending.set(m.id, m);
    store.dispatch('hostGate', placeGate(m));
  }
  // the mux reports a gate over; for one this tab's answer won, api.js reports only a cancel that trailed the win —
  // another answer or a Stop settled it first — so the card reads Settled elsewhere, never this tab's outcome
  function gateGone(eventId) {
    pending.delete(eventId);
    const lost = answeredHere.delete(eventId);
    store.dispatch('hostGateGone', { eventId, outcome: lost ? 'elsewhere' : 'closed' });
  }
  // this tab's answer, under the mux's current generation; once it wins, the gate is settled here (api.js reports
  // nothing for a winner), so no window load brings it back answerable
  async function answer(eventId, value) {
    await mux.answer(eventId, value);
    pending.delete(eventId);
    answeredHere.add(eventId);
  }
  function retryOrphans() {
    for (const [id, g] of Object.entries(state().orphanGates ?? {})) {
      const placed = placeGate(pending.get(id) ?? g.message);
      if (convOf(placed.convId)) store.dispatch('hostGate', placed);
    }
  }

  // ---- the list
  function scheduleRefresh() {
    if (listPending) return;
    listPending = true;
    timers.after(LIST_REFRESH_MS, () => { listPending = false; void refresh(); });
  }
  async function refresh() {
    const token = ++listSeq;
    let list, index, botsBody;
    try {
      [list, index, botsBody] = await Promise.all([
        call('session/list', { _request: {} }),
        getJson('/data/channels.json').catch(() => null),
        getJson('/data/bots.json').catch(() => null),
      ]);
    } catch (err) {
      say(`list: ${codeOf(err)}`, true);
      return;
    }
    if (token !== listSeq) return;
    if (!Array.isArray(list?.items)) { say('the host answered without a session list', true); return; }
    const channels = (Array.isArray(index?.channels) ? index.channels : []).map(ch => ({
      workspaceId: ch.workspaceId, name: ch.name, isRoot: ch.isRoot === true, sessionIds: Array.isArray(ch.sessionIds) ? ch.sessionIds : [],
    }));
    const channelOf = id => { const ch = channels.find(c => c.sessionIds.includes(id)); return ch ? { workspaceId: ch.workspaceId, name: ch.name } : null; };
    const bots = new Map((Array.isArray(botsBody?.bots) ? botsBody.bots : []).map(b => [b.id, { name: b.name }]));
    const rows = list.items.map(r => summaryOf(r, index?.presets));
    memberBot = new Map();
    for (const members of foldMembers(rows).rooms.values()) for (const m of members) memberBot.set(String(m.sessionId), String(m.agentPreset));
    const conversations = listConversations(list.items, {
      presets: index?.presets ?? {}, bots, channelOf, rooms, lastSeen: state().lastSeen, archived: new Set(index?.archived ?? []), deleted: new Set(),
    });
    store.dispatch('hostList', {
      conversations,
      channels: channels.map(c => ({ workspaceId: c.workspaceId, name: c.name, isRoot: c.isRoot })),
      bots: [...bots].map(([id, b]) => ({ id, name: b.name })), // the screens name a bot by these
    });
    for (const r of list.items) if (typeof r?.sessionId === 'string') seedBlock(r.sessionId, r.projections);
    const openId = state().route.screen === 'messages' ? state().route.id : null;
    const openConv = openId ? convOf(openId) : null;
    if (openConv) store.dispatch('markSeen', { convId: openConv.id, seq: openConv.updatedAt }); // the one on screen is read as it moves
    reconcile();
    retryOrphans();
    void previews();
  }
  // the last SPOKEN line of a row, read without activating it (projections cut + a one-message page): the kind table
  // decides what counts, so an injected context row (a system message in the thread) never becomes a preview
  function lastText(records) {
    let out = '';
    const seen = new Map();
    for (const r of Array.isArray(records) ? records : []) {
      const frame = { type: 'session/event', event: r?.event };
      rememberCall(seen, frame);
      for (const m of toMessages(mapFrame(frame), seen, 0)) if (m.kind === 'text' && m.from !== 'system' && typeof m.text === 'string' && m.text.trim() !== '') out = m.text;
    }
    return out || null;
  }
  // a row is read when it was never read, or when its session moved past the read (previewAt is the row's updatedAt
  // then): a moved row is refreshed, a silent one waits for activity; the one on screen previews from its own window
  async function previews() {
    const openId = state().route.screen === 'messages' ? state().route.id : null;
    const todo = state().conversations.filter(c => c.id !== openId && (c.previewAt === undefined || c.updatedAt > c.previewAt)).slice(0, PREVIEW_ROWS);
    for (const c of todo) {
      try {
        const cut = await call('session/projections', { request: { sessionId: c.id } });
        if (!cut || !Number.isSafeInteger(cut.asOfSeq)) continue;
        const pg = await call('session/page', { request: { address: address(c.id), throughSeq: cut.asOfSeq, maxMessages: 1 } });
        if (convOf(c.id)) store.dispatch('hostPreview', { convId: c.id, preview: lastText(pg?.records), at: c.updatedAt });
      } catch { /* a preview is a nicety; the row keeps its title */ }
    }
  }

  // ---- host facts over $events
  function onEvent(event, args) {
    const list = Array.isArray(args) ? args : [];
    switch (event) {
      case 'api-session/added':
      case 'api-session/activity':
      case 'agent-preset/selected':
        scheduleRefresh();
        return;
      case 'api-session/removed': {
        const id = list[0];
        if (typeof id === 'string') {
          if (convOf(id)) store.dispatch('hostProjection', { convId: id, key: 'running', value: false });
          stopFollowing(id); // a re-opened follow of it would promote it now
        }
        scheduleRefresh();
        return;
      }
      case 'api-session/status': {
        const [id, running] = list;
        if (typeof id === 'string' && typeof running === 'boolean' && convOf(id)) store.dispatch('hostProjection', { convId: id, key: 'running', value: running });
        scheduleRefresh();
        return;
      }
      case 'api-session/error': {
        const [id, message] = list;
        if (id === state().route.id) say(typeof message === 'string' && message !== '' ? message : 'the agent failed', true);
        return;
      }
      default:
        return;
    }
  }

  const mux = openMux({
    onReady: () => { say('', false, true); void refresh(); },
    onEvent,
    onGate: acceptGate,
    onGateGone: gateGone,
    onDown: reason => { say(`Reconnecting… (${reason})`, true, false); suspend(); },
  });
  function openControl() {
    mux.stream('session/control', {}, {
      onItem: item => { if (item?.type === 'baseline') seedBaseline(item.value); else acceptProjection(mapFrame(item)); },
      onEnd: () => timers.after(FOLLOW_RETRY_MS, openControl),
      onError: error => { say(`live session state unavailable: ${error?.code ?? 'error'}`, true); timers.after(CONTROL_RETRY_MS, openControl); },
    });
  }
  openControl();

  return { open, promote, refresh, reconcile, retryOrphans, answer, close: () => { closeView(); mux.close(); }, mux };
}
