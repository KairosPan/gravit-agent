// face/client/js/reducers/memory-page.js — the Memory screen (host/memory-page.js): each of its four reads - lessons,
// decisions, waiting, health - as it last answered, when, and the words of its last failure with the memory's own why when
// the face gave one; a failed read keeps the data it had, and a read under way keeps the failure's lines until it answers.
// And the screen's own choices: the rows opened by id, the differences shown by id, the symbol the decisions are read for
// and the decision they are read before (a window of older ones; none: the newest).
const READS = ['lessons', 'decisions', 'waiting', 'health'];
const memoryPage = (s, patch) => ({ ...s, memoryPage: { ...s.memoryPage, ...patch } });
/** A plain id, the one a row's key carries (render/memory-lessons.js): a letter or digit, then letters, digits, `.`, `_`, `:`
 *  or `-`, at most 128 characters. */
export const isId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);
// one read's fields changed; a name that is no read changes nothing
const read = (s, name, patch) => (READS.includes(name) ? memoryPage(s, { [name]: { ...s.memoryPage[name], ...patch } }) : s);
// a row's flag flipped: set only when the map holds it as its own true, so an id such as `constructor` reads as unset
const flipped = (map, id) => ({ ...map, [id]: !(Object.hasOwn(map, id) && map[id] === true) });

export const reducers = {
  memoryPageLoading: (s, { read: name } = {}) => read(s, name, { status: 'loading' }),
  memoryPageLoaded: (s, { read: name, data, at } = {}) => read(s, name, { status: 'ready', data, at, message: null, why: null }),
  memoryPageFailed: (s, { read: name, at, message = null, why = null } = {}) => read(s, name, { status: 'error', at, message, why: typeof why === 'string' && why !== '' ? why : null }),
  memoryPageToggle: (s, { id } = {}) => (isId(id) ? memoryPage(s, { open: flipped(s.memoryPage.open, id) }) : s),
  memoryPageDiff: (s, { id } = {}) => (isId(id) ? memoryPage(s, { diff: flipped(s.memoryPage.diff, id) }) : s),
  memoryPageSymbol: (s, { symbol } = {}) => memoryPage(s, { symbol: typeof symbol === 'string' ? symbol : '', before: '' }),
  memoryPageBefore: (s, { id } = {}) => memoryPage(s, { before: isId(id) ? id : '' }),
};
