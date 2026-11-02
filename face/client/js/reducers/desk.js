// face/client/js/reducers/desk.js — the desk's status (host/desk.js): /data/desk/status as it last answered, when, and the
// sentence of the last failure — a failed read keeps the status it had, as the Account's slices do — and the pause the page
// set, landed over the status at once (the next read confirms it)
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const desk = (s, patch) => ({ ...s, desk: { ...s.desk, ...patch } });

export const reducers = {
  deskLoading: s => desk(s, { status: 'loading' }),
  deskLoaded: (s, { data, at } = {}) => desk(s, { status: 'ready', data, at, message: null }),
  deskFailed: (s, { at, message = null } = {}) => desk(s, { status: 'error', at, message }),
  // POST /data/desk/pause answers `{ off }`, the pause in force afterwards
  pauseAnswered: (s, { off } = {}) => (isRecord(off) && isRecord(s.desk.data) ? desk(s, { data: { ...s.desk.data, off }, message: null }) : s),
};
