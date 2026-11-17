// face/client/js/reducers/memory-page.js — the Memory screen (host/memory-page.js): each of its four reads - lessons,
// decisions, waiting, health - as it last answered, when, and the words of its last failure with the memory's own why when
// the face gave one; a failed read keeps the data it had, and a read under way keeps the failure's lines until it answers.
// And the screen's own choices: the rows opened by id, the differences shown by id, the symbol the decisions are read for
// and the decision they are read before (a window of older ones; none: the newest). And the owner's act open in its drawer
// (host/memory-acts.js): its act and subject, the owner's words as typed, its status, what it acts on, the Account's
// preparation, a refusal's words and what the done act answered.
const READS = ['lessons', 'decisions', 'waiting', 'health'];
const memoryPage = (s, patch) => ({ ...s, memoryPage: { ...s.memoryPage, ...patch } });
/** A plain id, the one a row's key carries (render/memory-lessons.js): a letter or digit, then letters, digits, `.`, `_`, `:`
 *  or `-`, at most 128 characters. */
export const isId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);
// one read's fields changed; a name that is no read changes nothing
const read = (s, name, patch) => (READS.includes(name) ? memoryPage(s, { [name]: { ...s.memoryPage[name], ...patch } }) : s);
// a row's flag flipped: set only when the map holds it as its own true, so an id such as `constructor` reads as unset
const flipped = (map, id) => ({ ...map, [id]: !(Object.hasOwn(map, id) && map[id] === true) });

/** The owner's acts the screen takes (src/memory-acts.ts ACTS), and those that take the owner's words. */
export const MEMORY_ACTS = Object.freeze(['arm', 'retire', 'discard', 'accept', 'edit', 'reject', 'void']);
export const WORDED_ACTS = Object.freeze(['retire', 'reject', 'void']);
// the open act's fields changed; no act open changes nothing
const act = (s, patch) => (s.memoryPage.act ? memoryPage(s, { act: { ...s.memoryPage.act, ...patch } }) : s);
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const statusOf = s => s.memoryPage.act?.status;

export const reducers = {
  memoryPageLoading: (s, { read: name } = {}) => read(s, name, { status: 'loading' }),
  memoryPageLoaded: (s, { read: name, data, at } = {}) => read(s, name, { status: 'ready', data, at, message: null, why: null }),
  memoryPageFailed: (s, { read: name, at, message = null, why = null } = {}) => read(s, name, { status: 'error', at, message, why: typeof why === 'string' && why !== '' ? why : null }),
  memoryPageToggle: (s, { id } = {}) => (isId(id) ? memoryPage(s, { open: flipped(s.memoryPage.open, id) }) : s),
  memoryPageDiff: (s, { id } = {}) => (isId(id) ? memoryPage(s, { diff: flipped(s.memoryPage.diff, id) }) : s),
  memoryPageSymbol: (s, { symbol } = {}) => memoryPage(s, { symbol: typeof symbol === 'string' ? symbol : '', before: '' }),
  memoryPageBefore: (s, { id } = {}) => memoryPage(s, { before: isId(id) ? id : '' }),
  // the owner's act (host/memory-acts.js): opened on an act of the list and a plain id, reading - the words kept when the same
  // act on the same subject is opened again -; what it acts on shown; the words as typed, dropping what was prepared; the
  // Account's preparation; signing; done with the face's answer; refused with its words; closed
  memoryActOpen: (s, { act: name, subject } = {}) => {
    if (!MEMORY_ACTS.includes(name) || !isId(subject)) return s;
    const was = s.memoryPage.act;
    const words = was && was.act === name && was.subject === subject ? was.words : '';
    return memoryPage(s, { act: { act: name, subject, words, status: 'reading', show: null, prepared: null, message: null, done: null } });
  },
  memoryActShown: (s, { show } = {}) => {
    if (!isObject(show)) return s;
    const status = statusOf(s) === 'reading' ? (WORDED_ACTS.includes(s.memoryPage.act.act) ? 'words' : 'preparing') : statusOf(s);
    return act(s, { show, status });
  },
  memoryActWords: (s, { words } = {}) => {
    const status = statusOf(s);
    if (typeof words !== 'string' || status === undefined || status === 'signing' || status === 'done') return s;
    return act(s, { words, prepared: null, message: null, status: status === 'reading' ? 'reading' : 'words' });
  },
  memoryActPreparing: s => act(s, { status: 'preparing', prepared: null, message: null }),
  memoryActPrepared: (s, { prepared } = {}) => (isObject(prepared) ? act(s, { status: 'ready', prepared, message: null }) : s),
  memoryActSigning: s => (statusOf(s) === 'ready' ? act(s, { status: 'signing' }) : s),
  memoryActDone: (s, { done } = {}) => act(s, { status: 'done', done: isObject(done) ? done : {} }),
  memoryActRefused: (s, { message = null } = {}) => act(s, { status: 'refused', message }),
  memoryActClose: s => (s.memoryPage.act ? memoryPage(s, { act: null }) : s),
};
