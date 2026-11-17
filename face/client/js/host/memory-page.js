// face/client/js/host/memory-page.js — the Memory screen's reads (memory screen plan Task 2): the open tab's read and the
// waiting read, whose proposals the third tab counts, into the store's memoryPage slice, at once and every MEMORY_POLL_MS
// while the screen is on screen in a visible tab; on Waiting the tab's read is the count's, read once a tick. A tab's name is
// its read's name. One read of a path in flight at a time; a failed read keeps the data it had. The decisions read carries
// the symbol the slice holds, and is read again when it changes. Nothing here touches the DOM, and nothing is read before
// the screen shows.
import { said } from '../i18n/words.js';
import { MEMORY_TABS } from '../router.js';

export const MEMORY_POLL_MS = 20_000;
export const PATH_OF_READ = Object.freeze({ lessons: '/data/memory/lessons', decisions: '/data/memory/decisions', waiting: '/data/memory/review', health: '/data/memory/status' });

// a refusal's words: the route's own (`{ ok: false, error }` riding on the throw), else the throw's
const messageOf = err => {
  const words = err?.body?.error;
  if (typeof words === 'string' && words !== '') return words;
  return err instanceof Error ? err.said ?? err.message : said('memory.page.notRead');
};
// a call made now, at once, its throw a rejection
const attempt = fn => { try { return Promise.resolve(fn()); } catch (err) { return Promise.reject(err); } };
// the reads a tab polls: its own and the waiting read, one read on Waiting
const readsOf = tab => (tab === 'waiting' ? ['waiting'] : [tab, 'waiting']);

export function startMemoryPage({ store, getJson, schedule, cancelTimer, now = Date.now }) {
  let closed = false;
  let shown = false;
  let tab = null;
  let timer = null;
  const flights = new Map();   // a read's name -> its answer in flight
  const again = new Set();     // the reads asked again while in flight, read once more when they answer
  let symbolAsked = null;      // the symbol the last decisions read carried

  const symbolOf = () => { const v = store.get().memoryPage?.symbol; return typeof v === 'string' ? v : ''; };
  const pathOf = name => (name === 'decisions' && symbolOf() !== '' ? `${PATH_OF_READ.decisions}?symbol=${encodeURIComponent(symbolOf())}` : PATH_OF_READ[name]);

  function read(name) {
    if (closed || !Object.hasOwn(PATH_OF_READ, name)) return Promise.resolve();
    const out = flights.get(name);
    if (out) return out;
    if (name === 'decisions') symbolAsked = symbolOf();
    const path = pathOf(name);
    store.dispatch('memoryPageLoading', { read: name });
    const current = attempt(() => getJson(path))
      .then(data => {
        if (closed) return;
        if (data && data.ok === true) store.dispatch('memoryPageLoaded', { read: name, data, at: now() });
        else store.dispatch('memoryPageFailed', { read: name, at: now(), message: typeof data?.error === 'string' && data.error !== '' ? data.error : said('memory.page.notRead') });
      }, err => { if (!closed) store.dispatch('memoryPageFailed', { read: name, at: now(), message: messageOf(err) }); })
      .finally(() => {
        if (flights.get(name) === current) flights.delete(name);
        if (again.delete(name) && shown && !closed) void read(name);
      });
    flights.set(name, current);
    return current;
  }
  function arm() {
    timer = schedule(() => {
      timer = null;
      if (closed || !shown) return;
      arm();
      for (const name of readsOf(tab)) void read(name);
    }, MEMORY_POLL_MS);
  }
  function stop() {
    if (timer !== null) { cancelTimer(timer); timer = null; }
  }
  function reread(name) {
    if (closed || !shown || !Object.hasOwn(PATH_OF_READ, name)) return Promise.resolve();
    const out = flights.get(name);
    if (out) { again.add(name); return out; }
    return read(name);
  }

  return {
    /** The screen on screen in a visible tab on `next`, or not: the tab's reads at once on showing it, then every
     *  MEMORY_POLL_MS until it hides or another tab shows; the decisions read again when the symbol changed. */
    show(on, next) {
      if (closed) return;
      if (!on) {
        shown = false;
        stop();
        return;
      }
      const want = MEMORY_TABS.includes(next) ? next : MEMORY_TABS[0];
      if (shown && want === tab) {
        if (tab === 'decisions' && symbolOf() !== symbolAsked) void reread('decisions');
        return;
      }
      shown = true;
      tab = want;
      stop();
      arm();
      for (const name of readsOf(tab)) void read(name);
    },
    /** One read asked now, while the screen shows: once more after the one in flight answers. */
    reread,
    dispose() {
      closed = true;
      shown = false;
      stop();
    },
  };
}
