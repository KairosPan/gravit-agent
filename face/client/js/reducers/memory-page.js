// face/client/js/reducers/memory-page.js — the Memory screen (host/memory-page.js): each of its four reads - lessons,
// decisions, waiting, health - as it last answered, when, and the words of its last failure; a failed read keeps the data it
// had, and a read under way keeps the failure's line until it answers. And the screen's own choices: the rows opened by id,
// the differences shown by id, the symbol the decisions are read for.
const READS = ['lessons', 'decisions', 'waiting', 'health'];
const memoryPage = (s, patch) => ({ ...s, memoryPage: { ...s.memoryPage, ...patch } });
/** A plain id, the one a row's key carries (render/memory-lessons.js): a letter or digit, then letters, digits, `.`, `_`, `:`
 *  or `-`, at most 128 characters. */
export const isId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);
// one read's fields changed; a name that is no read changes nothing
const read = (s, name, patch) => (READS.includes(name) ? memoryPage(s, { [name]: { ...s.memoryPage[name], ...patch } }) : s);
const flipped = (map, id) => ({ ...map, [id]: !map[id] });

export const reducers = {
  memoryPageLoading: (s, { read: name } = {}) => read(s, name, { status: 'loading' }),
  memoryPageLoaded: (s, { read: name, data, at } = {}) => read(s, name, { status: 'ready', data, at, message: null }),
  memoryPageFailed: (s, { read: name, at, message = null } = {}) => read(s, name, { status: 'error', at, message }),
  memoryPageToggle: (s, { id } = {}) => (isId(id) ? memoryPage(s, { open: flipped(s.memoryPage.open, id) }) : s),
  memoryPageDiff: (s, { id } = {}) => (isId(id) ? memoryPage(s, { diff: flipped(s.memoryPage.diff, id) }) : s),
  memoryPageSymbol: (s, { symbol } = {}) => memoryPage(s, { symbol: typeof symbol === 'string' ? symbol : '' }),
};
