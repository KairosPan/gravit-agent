// face/client/js/reducers/search.js — the list's search (host/search.js): the box's query and the content read's phase
// ('idle' | 'loading' | 'done' | 'failed'). An answer lands only for the query still in the box.
const search = (s, patch) => ({ ...s, search: { ...s.search, ...patch } });

export const reducers = {
  setSearchQuery: (s, q) => {
    const query = typeof q === 'string' ? q : '';
    return search(s, { query, contentPhase: query.trim() === '' ? 'idle' : 'loading', content: [], hasMore: false });
  },
  searchContent: (s, { query, items, hasMore } = {}) => (query === s.search.query
    ? search(s, { contentPhase: 'done', content: Array.isArray(items) ? items : [], hasMore: hasMore === true })
    : s),
  searchFailed: (s, { query } = {}) => (query === s.search.query ? search(s, { contentPhase: 'failed', content: [], hasMore: false }) : s),
};
