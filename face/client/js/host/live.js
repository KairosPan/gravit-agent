// face/client/js/host/live.js — the impure half of the host layer (spec 2026-10-19 §5): the mux, the follow-or-page
// policy, the list and its previews, gates and projections, all into the store. The decisions are the old client's
// (chat.js on main, its open/follow/page/reconcile and host-event handling), ported; nothing here touches the DOM.
import { foldMembers } from '../wire/room.js';
import { summaryOf, readProjections } from '../wire/summaries.js';
import { rememberCall, toMessages } from './kinds.js';
import { attachmentsLine } from '../composer/files.js';
import { listConversations, childRowsOf } from './sessions.js';
import { foldMessages } from '../reducers/host.js';
import { t } from '../i18n/words.js';

export const LIST_REFRESH_MS = 1200;   // the list is re-read this long after a burst of host facts
export const PREVIEW_ROWS = 12;        // how many rows get a one-message page for their preview
export const FOLLOW_RETRY_MS = 2000;   // a follow the host ended is re-decided after this
export const CONTROL_RETRY_MS = 10_000;
export const ACTIVATE_MS = 10_000;     // how long activate waits for a follow's first snapshot
export const EARLIER_PAGE = 50;        // messages per earlier page (the host's own default window)
export const EARLIER_MAX_PAGES = 40;   // the most pages one earlier call reads toward its toSeq (2,000 messages)

// a live session is followed (a follow cannot activate it); a cold one is paged, never followed (PLAN D16)
export const viewFor = conv => (conv?.live ? 'follow' : 'page');

const address = id => ({ kind: 'session', sessionId: id });
const codeOf = err => err?.code ?? (err?.status ? `HTTP ${err.status}` : err?.message ?? t('status.failed'));
const failedLine = (what, err) => t('status.fail', { what, reason: codeOf(err) });

// onReceipt: called after a streamed order receipt lands (spec §6: the account is read again right after a fill); a
// receipt folded into a window is history and calls nothing. atTail(id): whether the reader stands at that conversation's
// tail (the page's word; this layer touches no DOM)
export function startLive({ store, openMux, call, mapFrame, getJson, timers, now = Date.now, onReceipt = () => {}, atTail = () => false }) {
  const calls = new Map();        // callId → {name, args}: the arguments the order card joins on
  const rooms = new Map();        // sessionId → the room projection's value
  const pending = new Map();      // eventId → the gate message as delivered and still open: placed afresh at every dispatch
  const answeredHere = new Set(); // eventIds this tab's answer won: a report for one afterwards means it lost a race
  let memberBot = new Map();      // a room member's session → its bot id
  let openSeq = 0;
  let listSeq = 0;
  let view = null;                // {id, token, mode: 'follow' | 'page', handle, stale?, failed?, snapped?, waiters?}
  let listPending = false;
  let earlierRun = null;          // {id, token, promise}: the earlier read under way; a second call for it answers its promise
  const ownStart = new Map();     // sessionId → the start of its last snapshot's own records, below which lie earlier pages
  // the last good answer of each /data read the list joins: a failed read keeps it, never an empty set in its place
  let lastIndex = null;
  let lastMeta = null;
  let lastBots = null;

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
      if (v.phase === 'start') dropEarlier(convId);
      scheduleRefresh();
      return;
    }
    if (v.kind === 'projection') { acceptProjection(v); return; }
    rememberCall(calls, frame);
    for (const m of toMessages(v, calls, now(), speakerOf(convOf(convId)))) {
      store.dispatch('hostEvent', { convId, message: m });
      if (m.kind === 'receipt') onReceipt(m);
    }
  }
  // a window is folded with the same reducer the stream uses, so backfill and stream draw identically; its start is the
  // first record's seq (0 with none), its replaced every replace range the fold met
  function windowOf(convId, records) {
    const speaker = speakerOf(convOf(convId));
    const list = Array.isArray(records) ? records : [];
    const replaced = [];
    const out = [];
    for (const r of list) {
      const frame = { type: 'session/event', sessionId: convId, event: r?.event };
      rememberCall(calls, frame);
      for (const m of toMessages(mapFrame(frame), calls, now(), speaker)) {
        if (m.replace) replaced.push([m.replace.start, m.replace.end]);
        out.push(m);
      }
    }
    const first = list[0]?.event?.seq;
    return { messages: foldMessages(out), start: typeof first === 'number' ? first : 0, replaced };
  }
  // through: the follow's cursor or the page's asOfSeq, the cut every earlier page of this window is read against
  function applySnapshot(convId, snapshot, { through, hasMore }) {
    const created = typeof snapshot?.header?.createdAt === 'number' ? snapshot.header.createdAt : undefined;
    const { messages, start, replaced } = windowOf(convId, snapshot?.records);
    ownStart.set(convId, start);
    const loading = !!earlierRun && earlierRun.id === convId && earlierRun.token === openSeq;   // a read still under way keeps its key
    store.dispatch('hostWindow', { convId, messages, created, window: { start, through, hasMore: hasMore === true, replaced, ...(loading ? { loading } : {}) } });
    seedBlock(convId, snapshot?.projections);
    for (const m of pending.values()) { // after the window, wherever the list now says each one belongs
      const g = placeGate(m);
      if (g.convId === convId) store.dispatch('hostGate', g);
    }
  }

  // ---- the read of the conversation on screen
  // a follow's activate waiters, answered once: true on its first snapshot, false when the follow goes without one
  function release(v, ok) {
    const waiters = v?.waiters ?? [];
    if (v) v.waiters = [];
    for (const w of waiters) w(ok);
  }
  function closeView() {
    const v = view;
    view = null;
    release(v, false);
    v?.handle?.cancel();
  }
  function follow(id, token) {
    closeView();
    let handle = null;
    const owns = () => view !== null && view.handle === handle && token === openSeq && view.id === id;
    handle = mux.stream('session/follow', { request: { address: address(id), assistantStream: true } }, {
      onItem: item => {
        if (!owns()) return;
        if (item?.type === 'snapshot') {
          applySnapshot(id, item, { through: item.cursor, hasMore: item.hasMore });
          if (owns() && !view.snapped) { view.snapped = true; release(view, true); }   // the store's render may have moved on
        }
        else if (item?.type === 'event') accept(id, { type: 'session/event', sessionId: id, event: item.event });
        else if (item?.type === 'assistant-stream') accept(id, { type: 'assistant-stream', sessionId: id, frame: item.frame });
      },
      onEnd: () => { // the host ended it: re-decided by liveness, never blindly re-followed
        if (!owns()) return;
        release(view, false);
        view = { id, token, mode: 'page', handle: null, stale: true };
        timers.after(FOLLOW_RETRY_MS, reconcile);
      },
      onError: error => { // a refusal is terminal for this open
        if (!owns()) return;
        release(view, false);
        view = { id, token, mode: 'page', handle: null, failed: true };
        say(`${error?.code ?? t('status.error')} — ${error?.message ?? t('status.followFailed')}`, true);
      },
    });
    view = { id, token, mode: 'follow', handle, snapped: false, waiters: [] };
  }
  async function page(id, token) {
    closeView();
    const v = { id, token, mode: 'page', handle: null };
    view = v;
    try {
      const cut = await call('session/projections', { request: { sessionId: id } });
      if (view !== v || token !== openSeq) return;
      const { asOfSeq, migrationRequired } = readProjections(cut);
      // rc.5: an older log answers `migration-required` with no cut to page against - the same status line as any refused open
      if (migrationRequired) throw Object.assign(new Error(t('status.migrationRequired')), { code: 'session/migration-required' });
      if (asOfSeq === null) throw new Error(t('status.noProjections'));
      const pg = await call('session/page', { request: { address: address(id), throughSeq: asOfSeq } });
      if (view !== v || token !== openSeq) return;
      applySnapshot(id, { projections: cut, records: pg?.records }, { through: asOfSeq, hasMore: pg?.hasMore });
    } catch (err) {
      if (view !== v || token !== openSeq) return;
      view = { ...v, failed: true };
      say(failedLine(t('status.verb.open'), err), true);
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
  // the conversation made live before a command runs on it (so the page follows it and the result draws): a live one at once; the
  // one paged on screen followed, as promote does, and true once the follow's first snapshot lands; false when that
  // follow ends or fails first, after ACTIVATE_MS, or when the screen shows another conversation
  function activate(id) {
    if (convOf(id)?.live) return Promise.resolve(true);
    if (!view || view.id !== id) return Promise.resolve(false);
    if (view.mode === 'page') follow(id, view.token);
    const v = view;
    if (v.snapped) return Promise.resolve(true);
    return new Promise(resolve => {
      let done = false;
      let deadline = null;
      const answer = ok => {
        if (done) return;
        done = true;
        if (deadline !== null) timers.cancel?.(deadline);   // a fake host's timers may have no cancel
        resolve(ok);
      };
      v.waiters.push(answer);
      deadline = timers.after(ACTIVATE_MS, () => { deadline = null; answer(false); }) ?? null;
    });
  }
  // earlier history of the conversation on screen, never activating it (PLAN D16): pages before the window's start against
  // its through, until toSeq when one is given, folded and landed in one hostEarlier; another conversation opened
  // meanwhile drops them. True when they landed
  function earlier(id, { toSeq } = {}) {
    if (earlierRun && earlierRun.id === id && earlierRun.token === openSeq) return earlierRun.promise;
    const w = convOf(id)?.window;
    if (!view || view.id !== id || view.failed || !w || !w.hasMore) return Promise.resolve(false);
    const token = openSeq;
    const run = { id, token, promise: null };
    // a run's loading is cleared by it only while no newer run reads the same conversation
    const done = () => { if (!earlierRun || earlierRun === run || earlierRun.id !== id) store.dispatch('hostEarlierLoading', { convId: id, on: false }); };
    run.promise = (async () => {
      store.dispatch('hostEarlierLoading', { convId: id, on: true });
      const pages = [];               // newest first, joined once at the end
      let start = w.start;
      let hasMore = true;
      try {
        for (let n = 0; n < EARLIER_MAX_PAGES; n++) {
          if (token !== openSeq) break;
          const pg = await call('session/page', { request: { address: address(id), throughSeq: w.through, beforeSeq: start, maxMessages: EARLIER_PAGE } });
          if (token !== openSeq) break;
          const got = Array.isArray(pg?.records) ? pg.records : [];
          hasMore = pg?.hasMore === true && got.length > 0;
          const first = got[0]?.event?.seq;
          pages.push(got);
          if (typeof first === 'number') start = Math.min(start, first);
          if (!hasMore || typeof toSeq !== 'number' || start <= toSeq) break;
        }
      } catch (err) {
        done();
        if (token === openSeq) say(failedLine(t('status.verb.earlier'), err), true);
        return false;
      }
      if (token !== openSeq) { done(); return false; }
      // a snapshot past a gap moved the start while the pages were read: they belong to no window now
      if (convOf(id)?.window?.start !== w.start) { done(); return false; }
      const folded = windowOf(id, pages.reverse().flat());
      store.dispatch('hostEarlier', { convId: id, messages: folded.messages, start, hasMore, replaced: folded.replaced, before: w.start });
      return true;
    })().finally(() => { if (earlierRun === run) earlierRun = null; });
    earlierRun = run;
    return run.promise;
  }
  // the drawn window bounded: a turn starting on the conversation followed on screen while the reader stands at its tail
  // drops the earlier pages, back to its snapshot's own window (hasMore, so Earlier messages reads them again). Never while
  // an earlier read for it runs (a rail jump waits on it)
  function dropEarlier(id) {
    const base = ownStart.get(id);
    const w = convOf(id)?.window;
    if (!view || view.id !== id || view.mode !== 'follow' || typeof base !== 'number' || !w || w.start >= base) return;
    if (earlierRun && earlierRun.id === id && earlierRun.token === openSeq) return;
    if (!atTail(id)) return;
    store.dispatch('hostDropEarlier', { convId: id, start: base });
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
      release(view, false);
      view.handle?.cancel();
      view = { ...view, mode: 'page', handle: null, stale: true, snapped: false };
    }
  }
  function stopFollowing(id) {
    if (view && view.id === id && view.mode === 'follow') {
      release(view, false);
      view.handle?.cancel();
      view = { ...view, mode: 'page', handle: null, snapped: false };
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
    let list, index, botsBody, meta;
    try {
      [list, index, botsBody, meta] = await Promise.all([
        call('session/list', { _request: {} }),
        getJson('/data/channels.json').catch(() => null),
        getJson('/data/bots.json').catch(() => null),
        getJson('/data/sessions-meta.json').catch(() => null),
      ]);
    } catch (err) {
      say(failedLine(t('status.verb.list'), err), true);
      return;
    }
    if (token !== listSeq) return;
    if (!Array.isArray(list?.items)) { say(t('status.noSessionList'), true); return; }
    if (Array.isArray(index?.channels)) lastIndex = index; else index = lastIndex;
    if (Array.isArray(meta?.archived)) lastMeta = meta; else meta = lastMeta;
    if (Array.isArray(botsBody?.bots)) lastBots = botsBody; else botsBody = lastBots;
    const channels = (Array.isArray(index?.channels) ? index.channels : []).map(ch => ({
      workspaceId: ch.workspaceId, name: ch.name, title: typeof ch.title === 'string' && ch.title !== '' ? ch.title : ch.name,
      dir: typeof ch.dir === 'string' ? ch.dir : null, isRoot: ch.isRoot === true, missingDir: ch.missingDir === true,
      sessionIds: Array.isArray(ch.sessionIds) ? ch.sessionIds : [],
    }));
    const channelOf = id => { const ch = channels.find(c => c.sessionIds.includes(id)); return ch ? { workspaceId: ch.workspaceId, name: ch.name } : null; };
    const bots = new Map((Array.isArray(botsBody?.bots) ? botsBody.bots : []).map(b => [b.id, { name: b.name, description: typeof b.description === 'string' ? b.description : '' }]));
    const rows = list.items.map(r => summaryOf(r, index?.presets));
    memberBot = new Map();
    for (const members of foldMembers(rows).rooms.values()) for (const m of members) memberBot.set(String(m.sessionId), String(m.agentPreset));
    const conversations = listConversations(list.items, {
      presets: index?.presets ?? {}, bots, channelOf, rooms, lastSeen: state().lastSeen,
      archived: new Set(meta?.archived ?? []), hostArchived: new Set(index?.archived ?? []), deleted: new Set(Array.isArray(meta?.deleted) ? meta.deleted : []),
    });
    store.dispatch('hostList', {
      conversations,
      channels,
      bots: [...bots].map(([id, b]) => ({ id, name: b.name, description: b.description })), // the screens name a bot by these; the @ menu shows the line
      childRows: childRowsOf(list.items),
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
  // decides what counts, so an injected context row (a system message in the thread) never becomes a preview; a composed
  // answer (an ok lunhui_present) previews its summary
  function lastText(records) {
    let out = '';
    const seen = new Map();
    for (const r of Array.isArray(records) ? records : []) {
      const frame = { type: 'session/event', event: r?.event };
      rememberCall(seen, frame);
      for (const m of toMessages(mapFrame(frame), seen, 0)) {
        if ((m.kind !== 'text' && m.kind !== 'composed') || m.from === 'system' || typeof m.text !== 'string') continue;
        // words, or with none the attachments' names (an image sent alone still previews)
        const line = m.text.trim() !== '' ? m.text : attachmentsLine(Array.isArray(m.data?.attachments) ? m.data.attachments : []);
        if (line !== '') out = line;
      }
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
        const { asOfSeq } = readProjections(cut); // null for a migration-required log too: no cut, no preview
        if (asOfSeq === null) continue;
        const pg = await call('session/page', { request: { address: address(c.id), throughSeq: asOfSeq, maxMessages: 1 } });
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
        if (id === state().route.id) say(typeof message === 'string' && message !== '' ? message : t('status.agentFailed'), true);
        return;
      }
      default:
        return;
    }
  }

  const mux = openMux({
    onReady: () => { say('', false, true); void refresh(); openPins(); },
    onEvent,
    onGate: acceptGate,
    onGateGone: gateGone,
    onDown: reason => { say(t('status.reconnecting', { reason }), true, false); suspend(); closePins(); },
  });
  function openControl() {
    mux.stream('session/control', {}, {
      onItem: item => { if (item?.type === 'baseline') seedBaseline(item.value); else acceptProjection(mapFrame(item)); },
      onEnd: () => timers.after(FOLLOW_RETRY_MS, openControl),
      onError: error => { say(t('status.controlUnavailable', { code: error?.code ?? t('status.error') }), true); timers.after(CONTROL_RETRY_MS, openControl); },
    });
  }
  openControl();

  // the pin set: workspace/follow's baseline, then a frame per change. One stream at a time; it opens again on its end,
  // after an error, and after a reconnect, and the new baseline replaces whatever was drawn
  let pins = null;
  function closePins() { pins?.cancel(); pins = null; }
  function openPins() {
    if (pins) return;
    const mine = mux.stream('workspace/follow', {}, {
      onItem: item => {
        const ids = item?.type === 'baseline' ? item.value?.pinnedSessionIds : item?.type === 'pinned' ? item.pinnedSessionIds : undefined;
        if (Array.isArray(ids)) store.dispatch('hostPins', ids);
      },
      onEnd: () => { if (pins === mine) pins = null; timers.after(FOLLOW_RETRY_MS, openPins); },
      onError: () => { if (pins === mine) pins = null; timers.after(CONTROL_RETRY_MS, openPins); },
    });
    pins = mine;
  }
  openPins();

  // leave: no conversation is on screen any more (the last open one was deleted): stop reading the one that was
  return { open, promote, activate, earlier, refresh, reconcile, retryOrphans, answer, leave: closeView, close: () => { closeView(); mux.close(); }, mux };
}
