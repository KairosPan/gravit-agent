// face/client/js/host/desk-news.js — the Desk page's read (desk-page plan 1 Task 3): /data/desk/news into the store's deskPage
// slice, at once (unless read within the poll already) and every DESK_NEWS_POLL_MS while the Desk is on screen in a visible
// tab; one read in flight at a time. The desk's status beside it is host/desk.js's, shown on the Desk as on Markets. Nothing
// here touches the DOM.
import { said } from '../i18n/words.js';

export const DESK_NEWS_POLL_MS = 15_000;

const NEWS = '/data/desk/news';
const messageOf = err => (err instanceof Error ? err.said ?? err.message : err == null ? said('desk.requestFailed') : String(err));
// a call made now, at once, its throw a rejection
const attempt = fn => { try { return Promise.resolve(fn()); } catch (err) { return Promise.reject(err); } };

export function startDeskNews({ store, getJson, schedule, cancelTimer, now = Date.now }) {
  let closed = false;
  let shown = false;
  let timer = null;
  let flight = null;
  let readAt = null;   // when the last read was asked: the Desk shown again within the poll reads at the poll's turn, not at once

  function read() {
    if (closed) return Promise.resolve();
    if (flight) return flight;
    readAt = now();
    store.dispatch('deskNewsLoading');
    const current = attempt(() => getJson(NEWS))
      .then(data => {
        if (closed) return;
        if (data && data.ok === true) store.dispatch('deskNewsLoaded', { data, at: now() });
        else store.dispatch('deskNewsFailed', { at: now(), message: typeof data?.error === 'string' ? data.error : said('desk.page.notNews') });
      }, err => { if (!closed) store.dispatch('deskNewsFailed', { at: now(), message: messageOf(err) }); })
      .finally(() => { if (flight === current) flight = null; });
    flight = current;
    return current;
  }
  function arm(ms = DESK_NEWS_POLL_MS) {
    timer = schedule(() => { timer = null; if (closed || !shown) return; arm(); void read(); }, ms);
  }
  function stop() {
    if (timer !== null) { cancelTimer(timer); timer = null; }
  }

  return {
    /** The Desk on screen in a visible tab, or not: the news is read at once on showing, then every DESK_NEWS_POLL_MS until it hides. */
    show(on) {
      if (closed) return;
      const next = Boolean(on);
      if (next === shown) return;
      shown = next;
      if (!shown) { stop(); return; }
      const since = readAt === null ? Infinity : now() - readAt;
      if (since < DESK_NEWS_POLL_MS) { arm(DESK_NEWS_POLL_MS - since); return; }
      arm();
      void read();
    },
    dispose() {
      closed = true;
      shown = false;
      stop();
    },
  };
}
