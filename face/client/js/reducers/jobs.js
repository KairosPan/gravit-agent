// face/client/js/reducers/jobs.js — the open conversation's background jobs (host/jobs.js): the conversation watched, its
// rows as the last job/list frame gave them (whole-set), the job open in Details, and the finished ids the operator cleared
// by conversation. A job's output never rides the store.
import { isLive } from '../host/jobs-view.js';

const jobs = (s, patch) => ({ ...s, jobs: { ...s.jobs, ...patch } });

export const reducers = {
  // a new conversation empties the rows and the open job; the cleared stay
  watchJobs: (s, convId = null) => {
    const id = typeof convId === 'string' && convId !== '' ? convId : null;
    return id === s.jobs.convId ? s : jobs(s, { convId: id, rows: [], open: null });
  },
  hostJobs: (s, { convId, jobs: rows } = {}) => (convId != null && convId === s.jobs.convId && Array.isArray(rows)
    ? jobs(s, { rows: rows.filter(j => j && typeof j.id === 'string') })
    : s),
  // the page's own word on a job's status until the next rows frame: Stopping once Yes, stop is pressed, running again
  // when the host refused it (only from the status it was marked from)
  markJob: (s, { id, from, to } = {}) => (s.jobs.rows.some(j => j.id === id && j.status === from)
    ? jobs(s, { rows: s.jobs.rows.map(j => (j.id === id && j.status === from ? { ...j, status: to } : j)) })
    : s),
  openJob: (s, id) => jobs(s, { open: typeof id === 'string' && id !== '' ? id : null }),
  closeJob: s => (s.jobs.open === null ? s : jobs(s, { open: null })),
  // the finished jobs on screen join the conversation's cleared
  clearJobs: (s, convId) => {
    if (convId == null || convId !== s.jobs.convId) return s;
    const had = s.jobs.cleared[convId] ?? [];
    const add = s.jobs.rows.filter(j => !isLive(j) && !had.includes(j.id)).map(j => j.id);
    return add.length === 0 ? s : jobs(s, { cleared: { ...s.jobs.cleared, [convId]: [...had, ...add] } });
  },
};
