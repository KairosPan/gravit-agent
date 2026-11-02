// face/client/js/host/desk.js — the Desk tab's impure half (plan 2026-11-01-desk-p3-watch Task 11): /data/desk/status into the
// store's desk slice, at once and every DESK_POLL_MS while Markets is on screen in a visible tab — any tab of it, or a market's
// page, as startMarkets's own show — so the level marks on the rows stay fresh; one read in flight at a time. And the page's
// one write, Pause: POST /data/desk/pause with no `until` (paused until a terminal resumes), its answer landed at once, then
// the status read again. There is no resume: the page, like the phone, only pauses (spec §5.7). Nothing here touches the DOM.
import { DESK_POLL_MS } from './desk-view.js';

const STATUS = '/data/desk/status';
const PAUSE = '/data/desk/pause';
const messageOf = err => (err instanceof Error ? err.message : String(err ?? 'request failed'));
// a call made now, at once — the read is asked as Markets shows, not a turn later — its throw a rejection
const attempt = fn => { try { return Promise.resolve(fn()); } catch (err) { return Promise.reject(err); } };

export function startDesk({ store, getJson, postJson, schedule, cancelTimer, now = Date.now }) {
  let closed = false;
  let shown = false;
  let timer = null;
  let flight = null;
  let pausing = null;

  function read() {
    if (closed) return Promise.resolve();
    if (flight) return flight;
    store.dispatch('deskLoading');
    const current = attempt(() => getJson(STATUS))
      .then(data => {
        if (closed) return;
        if (data && data.ok === true) store.dispatch('deskLoaded', { data, at: now() });
        else store.dispatch('deskFailed', { at: now(), message: typeof data?.error === 'string' ? data.error : 'not a desk status' });
      }, err => { if (!closed) store.dispatch('deskFailed', { at: now(), message: messageOf(err) }); })
      .finally(() => { if (flight === current) flight = null; });
    flight = current;
    return current;
  }
  function arm() {
    timer = schedule(() => { timer = null; if (closed || !shown) return; arm(); void read(); }, DESK_POLL_MS);
  }
  function stop() {
    if (timer !== null) { cancelTimer(timer); timer = null; }
  }

  return {
    /** Markets on screen in a visible tab, or not: the status is read at once on showing, then every DESK_POLL_MS until it hides. */
    show(on) {
      if (closed) return;
      const next = Boolean(on);
      if (next === shown) return;
      shown = next;
      if (!shown) { stop(); return; }
      arm();
      void read();
    },
    /** Pause: one post at a time; the pause in force lands, then the status is read again. A refused pause says so. */
    pause() {
      if (closed) return Promise.resolve();
      if (pausing) return pausing;
      const current = attempt(() => postJson(PAUSE, {}))
        .then(body => {
          if (closed) return undefined;
          store.dispatch('pauseAnswered', { off: body?.off });
          return read();
        }, err => { if (!closed) store.dispatch('deskFailed', { at: now(), message: `Pause failed: ${messageOf(err)}` }); })
        .finally(() => { if (pausing === current) pausing = null; });
      pausing = current;
      return current;
    },
    dispose() {
      closed = true;
      shown = false;
      stop();
    },
  };
}
