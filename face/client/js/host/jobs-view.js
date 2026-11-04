// face/client/js/host/jobs-view.js — background jobs as the page draws them (spec §5.8): the open conversation's live and
// finished jobs from the jobs slice, the head's chip, a finished job's end line from its `detail`, a job's meta line. Pure.
// A job's end is bash's `detail`: `exit code: N` or `signal: X` / `killed before exit`, sandbox notes and a human kill's
// reason after `; ` (dsh-tool-bash, JobController.kill at rc.5).

import { clockText } from './turns-view.js';

export const isLive = job => job?.status === 'running' || job?.status === 'stopping';

const count = (n, word) => `${n} job${n === 1 ? '' : 's'} ${word}`;
export function chipText(running, finished) {
  if (running.length > 0) return count(running.length, 'running');
  if (finished.length > 0) return count(finished.length, 'finished');
  return null;
}

// the jobs the conversation shows: its slice's rows when the slice watches it, the finished ones the operator cleared left out
export function jobsView(slice, convId) {
  const rows = slice && convId != null && slice.convId === convId && Array.isArray(slice.rows) ? slice.rows : [];
  const cleared = new Set(slice?.cleared?.[convId] ?? []);
  const running = rows.filter(isLive);
  const finished = rows.filter(j => !isLive(j) && !cleared.has(j.id));
  return { running, finished, chip: chipText(running, finished) };
}

const detailOf = job => (typeof job?.detail === 'string' ? job.detail : '');
export function endLine(job) {
  if (job?.status === 'completed') {
    const m = /(?:^|;\s*)exit code:\s*([^;\s]+)/.exec(detailOf(job));
    return m ? `exit ${m[1]}` : 'exit';
  }
  if (job?.status === 'killed') {
    const m = /(?:^|;\s*)signal:\s*([^;\s]+)/.exec(detailOf(job));
    return m ? `signal ${m[1]}` : 'killed';
  }
  if (job?.status === 'failed') return 'failed';
  return '';
}

// `${kind} · ${progress | endLine} · ${clock}`: the progress while live, the end once finished, the clock to now while live
// and to its finish after; an empty part left out
export function metaLine(job, now) {
  const live = isLive(job);
  const middle = live ? (typeof job?.progress === 'string' ? job.progress : '') : endLine(job);
  const end = !live && Number.isFinite(job?.finishedAt) ? job.finishedAt : now;
  const clock = Number.isFinite(job?.startedAt) ? clockText(end - job.startedAt) : '';
  return [typeof job?.kind === 'string' ? job.kind : '', middle, clock].filter(Boolean).join(' · ');
}
