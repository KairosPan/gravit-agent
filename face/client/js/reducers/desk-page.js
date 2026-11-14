// face/client/js/reducers/desk-page.js — the Desk page (host/desk-news.js): /data/desk/news as it last answered, when, and the
// sentence of the last failure — a failed read keeps the news it had, as the desk's status does — and the page's own choices:
// the symbol filter, the rows opened by id, the watch rules unfolded. And the Routines column (host/desk-routines.js, plan 2
// Task 7): /data/desk/routines as it last answered under `routines`, a failed read keeping the routines it had; the routine
// row opened (`rOpen`), the one asked to delete (`rAsk`), the acts under way by id (`rBusy`: `test`) and a refused act's line
// by id (`rSaid`); and a routine card's refused answer by its proposal's id (`pSaid`: `limit` or `failed`, plan 3 Task 3)
// and its answer in flight (`pBusy`), its keys hidden meanwhile
const deskPage = (s, patch) => ({ ...s, deskPage: { ...s.deskPage, ...patch } });
const isId = id => typeof id === 'string' && id !== '';
// a map by id with `id` set to `value`, or without it for null
const keyed = (map, id, value) => {
  const { [id]: _gone, ...rest } = map;
  return value == null ? rest : { ...rest, [id]: value };
};

export const reducers = {
  deskNewsLoading: s => deskPage(s, { status: 'loading' }),
  deskNewsLoaded: (s, { data, at } = {}) => deskPage(s, { status: 'ready', data, at, message: null }),
  deskNewsFailed: (s, { at, message = null } = {}) => deskPage(s, { status: 'error', at, message }),
  deskFilter: (s, { value } = {}) => deskPage(s, { filter: typeof value === 'string' && value !== '' ? value : 'all' }),
  deskToggle: (s, { id } = {}) => (typeof id === 'string' && id !== '' ? deskPage(s, { open: { ...s.deskPage.open, [id]: !s.deskPage.open[id] } }) : s),
  deskRules: s => deskPage(s, { rules: !s.deskPage.rules }),
  // a read that holds the routines drops the row open, the delete question, the acts under way and the lines of an id it no
  // longer holds; one whose store cannot be read says nothing of which are gone, and drops nothing
  deskRoutinesLoaded: (s, { data, at } = {}) => {
    const routines = { status: 'ready', data, at, message: null };
    if (!Array.isArray(data?.routines) || data?.load?.ok === false) return deskPage(s, { routines });
    const ids = new Set(data.routines.map(r => r?.id));
    const p = s.deskPage;
    const only = map => Object.fromEntries(Object.entries(map).filter(([id]) => ids.has(id)));
    return deskPage(s, {
      routines,
      rOpen: ids.has(p.rOpen) ? p.rOpen : '',
      rAsk: ids.has(p.rAsk) ? p.rAsk : '',
      rBusy: only(p.rBusy),
      rSaid: only(p.rSaid),
    });
  },
  deskRoutinesFailed: (s, { at, message = null } = {}) => deskPage(s, { routines: { ...s.deskPage.routines, status: 'error', at, message } }),
  deskRoutineBusy: (s, { id, what = null } = {}) => (isId(id) ? deskPage(s, { rBusy: keyed(s.deskPage.rBusy, id, what === 'test' ? 'test' : null) }) : s),
  deskRoutineSaid: (s, { id, message = null } = {}) => (isId(id) ? deskPage(s, { rSaid: keyed(s.deskPage.rSaid, id, message) }) : s),
  // a row opened, or closed when it is the one open; its delete question goes either way
  deskRoutineOpen: (s, { id } = {}) => (isId(id) ? deskPage(s, { rOpen: s.deskPage.rOpen === id ? '' : id, rAsk: '' }) : s),
  deskRoutineAsk: (s, { id } = {}) => (isId(id) ? deskPage(s, { rAsk: id }) : s),
  deskRoutineAskOff: s => deskPage(s, { rAsk: '' }),
  deskProposalBusy: (s, { proposal, busy = false } = {}) => (isId(proposal) ? deskPage(s, { pBusy: keyed(s.deskPage.pBusy ?? {}, proposal, busy === true ? true : null) }) : s),
  deskProposalSaid: (s, { proposal, said = null } = {}) => (isId(proposal)
    ? deskPage(s, { pSaid: keyed(s.deskPage.pSaid ?? {}, proposal, said === 'limit' || said === 'failed' ? said : null) }) : s),
};
