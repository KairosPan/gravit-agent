// face/client/js/reducers/desk-page.js — the Desk page (host/desk-news.js): /data/desk/news as it last answered, when, and the
// sentence of the last failure — a failed read keeps the news it had, as the desk's status does — and the page's own choices:
// the symbol filter, the rows opened by id, the watch rules unfolded
const deskPage = (s, patch) => ({ ...s, deskPage: { ...s.deskPage, ...patch } });

export const reducers = {
  deskNewsLoading: s => deskPage(s, { status: 'loading' }),
  deskNewsLoaded: (s, { data, at } = {}) => deskPage(s, { status: 'ready', data, at, message: null }),
  deskNewsFailed: (s, { at, message = null } = {}) => deskPage(s, { status: 'error', at, message }),
  deskFilter: (s, { value } = {}) => deskPage(s, { filter: typeof value === 'string' && value !== '' ? value : 'all' }),
  deskToggle: (s, { id } = {}) => (typeof id === 'string' && id !== '' ? deskPage(s, { open: { ...s.deskPage.open, [id]: !s.deskPage.open[id] } }) : s),
  deskRules: s => deskPage(s, { rules: !s.deskPage.rules }),
};
