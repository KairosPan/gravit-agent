// face/client/js/host/search.js — the list's content search: the box's text goes to the store at once; after
// SEARCH_CONTENT_MS of quiet the face's index is read (GET /data/search?q=) and the answer lands under the query it was
// asked for. Impure; nothing here draws.
export const SEARCH_CONTENT_MS = 250;

export function startSearch({ store, getJson, timers }) {
  let wait = null;
  const cancel = () => { if (wait !== null) { timers.cancel(wait); wait = null; } };

  async function read(query) {
    try {
      const data = await getJson(`/data/search?q=${encodeURIComponent(query)}`);
      if (data?.ok !== true) throw new Error('refused'); // a refusal fails like a dead wire
      store.dispatch('searchContent', { query, items: data.items, hasMore: data.hasMore === true });
    } catch {
      store.dispatch('searchFailed', { query });
    }
  }

  return {
    type(q) {
      cancel();
      store.dispatch('setSearchQuery', q);
      if (typeof q !== 'string' || q.trim() === '') return;
      wait = timers.after(SEARCH_CONTENT_MS, () => { wait = null; void read(q); });
    },
    clear() {
      cancel();
      store.dispatch('setSearchQuery', '');
    },
  };
}
