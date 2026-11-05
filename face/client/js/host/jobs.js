// face/client/js/host/jobs.js — the open conversation's background jobs (spec §5.8): one job/list stream for the
// conversation watched, its whole-set rows frames into the jobs slice; one job/follow stream for the job open in Details,
// whose output stays here (never the store) and is read back by outputOf after onOutput; job/kill over call. Impure;
// nothing here draws.
// The mux re-opens a stream after a reconnect with its first args: job/list's first frame is the whole set again, and
// job/follow starts again from the oldest retained byte, so a chunk whose `at` is below the `next` already held is skipped.
// That re-open re-sends the whole retained ring on every reconnect (a known cost: the mux keeps the first args, so no
// `from` rides it). A job/list the host ends or refuses is opened again after live.js's backoffs.
import { failLine } from './actions.js';
import { t, said } from '../i18n/words.js';
import { FOLLOW_RETRY_MS, CONTROL_RETRY_MS } from './live.js';

// characters of output kept in memory per open job, the head dropped first
export const JOB_OUTPUT_KEEP = 262144;
// where output was dropped, held as a sentinel rather than the table's word (so a switch of the table reads it anew, and
// a re-opened follow under another table finds its own marker): no output holds it, since an output frame's NUL characters
// become U+FFFD on arrival. shownOutput draws it in the table that stands
export const DROPPED = '\u0000dropped\u0000\n';
const NUL = /\u0000/g;
// the held text as drawn: each marker (at the start or a line's start) in the words of the table that stands
export const shownOutput = text => (text.includes('\u0000') ? text.replaceAll(DROPPED, `${t('jobs.dropped')}\n`) : text);

export function startJobs({ store, mux, call, timers, onOutput = () => {} }) {
  let list = null;       // { convId, handle, timer }: handle null while a re-open waits on its timer
  let follow = null;     // { jobId, handle, text, ended, error?, next, opened }

  function closeList() {
    if (list?.timer != null) timers.cancel?.(list.timer);   // a fake host's timers may have no cancel
    list?.handle?.cancel();
    list = null;
  }
  function closeFollow() { follow?.handle.cancel(); follow = null; }

  // one job/list generation for the conversation watched; the rows stay as they are until its first frame replaces them
  function openList(id) {
    const mine = { convId: id, handle: null, timer: null };
    const retry = ms => {
      if (list !== mine) return;
      mine.handle = null;
      mine.timer = timers.after(ms, () => { if (list === mine && mine.handle === null) { list = null; openList(id); } }) ?? null;
    };
    list = mine;
    mine.handle = mux.stream('job/list', { request: { sessionId: id } }, {
      onItem: item => {
        if (list !== mine || item?.type !== 'rows') return;
        store.dispatch('hostJobs', { convId: id, jobs: item.jobs });
      },
      onEnd: () => retry(FOLLOW_RETRY_MS),
      onError: () => retry(CONTROL_RETRY_MS),
    });
  }

  // the dropped line on its own line, at the end of what is held, never twice in a row
  const mark = text => (text.endsWith(DROPPED) ? text : `${text}${text !== '' && !text.endsWith('\n') ? '\n' : ''}${DROPPED}`);
  function cap(f) {
    if (f.text.length <= JOB_OUTPUT_KEEP) return;
    const head = DROPPED;
    let cut = f.text.length - (JOB_OUTPUT_KEEP - head.length);
    const unit = f.text.charCodeAt(cut);
    if (unit >= 0xdc00 && unit <= 0xdfff) cut += 1;   // never half a surrogate pair
    // never part of a marker: one the cut lands in, or starts at, goes whole (the head says the same)
    const at = f.text.indexOf(DROPPED, Math.max(0, cut - DROPPED.length + 1));
    if (at !== -1 && at <= cut) cut = at + DROPPED.length;
    f.text = head + f.text.slice(cut);
  }

  function onFrame(f, frame) {
    if (frame?.type === 'opened') {
      const earliest = Number(frame.job?.output?.earliest) || 0;
      const from = Number(frame.from) || 0;
      if (!f.opened) {
        f.opened = true;
        f.text = earliest > 0 ? DROPPED : '';
        f.next = Math.max(earliest, from);
      } else if (Math.max(earliest, from) > f.next) {
        // a re-opened follow whose oldest retained byte is past what was held: the bytes between are gone
        f.text = mark(f.text);
        f.next = Math.max(earliest, from);
      }
    } else if (frame?.type === 'output') {
      let lossy = frame.lossy === true;
      for (const chunk of Array.isArray(frame.chunks) ? frame.chunks : []) {
        if (typeof chunk?.text !== 'string' || !(chunk.at >= f.next)) continue;
        if (lossy || chunk.gapBefore === true) f.text = mark(f.text);
        lossy = false;
        f.text += chunk.text.replace(NUL, '\uFFFD');
      }
      // offsets are bytes, the text UTF-16: the frame's own `next` is the only resume point
      if (Number.isFinite(frame.next) && frame.next > f.next) f.next = frame.next;
      cap(f);
    } else if (frame?.type === 'status') {
      f.ended = true;
    } else return;
    onOutput(f.jobId);
  }

  function say(line) { store.dispatch('hostStatus', { line, bad: true }); }

  return {
    // the open conversation's jobs: the stream it had and its follow cancelled, a new one opened (none for null); the
    // same conversation watched again keeps its stream, or opens it at once when it waits on a re-open
    watch(convId) {
      const id = typeof convId === 'string' && convId !== '' ? convId : null;
      if (list && list.convId === id) {
        if (list.handle === null) { closeList(); openList(id); }
        return;
      }
      if (list === null && id === null) { closeFollow(); store.dispatch('watchJobs', null); return; }
      closeList();
      closeFollow();
      store.dispatch('watchJobs', id);
      if (id !== null) openList(id);
    },
    // one job's output: the follow it had cancelled. sessionId is the caller (the conversation whose list shows the job,
    // the fenced read's reader), not the job's owner; omitted for a job with no owner (JobFollowRequest)
    follow(convId, job) {
      closeFollow();
      if (typeof job?.id !== 'string') return;
      const mine = { jobId: job.id, handle: null, text: '', ended: false, next: 0, opened: false };
      const request = { ...(job.owner ? { sessionId: convId } : {}), jobId: job.id };
      // a follow the host ends without a status, or refuses, is over: it reads as ended (with the refusal's code) and is
      // not opened again here; opening the job again in Details follows it anew
      const over = error => {
        if (follow !== mine || mine.ended) return;
        mine.ended = true;
        if (error !== undefined) mine.error = error?.code ?? said('status.error');
        onOutput(mine.jobId);
      };
      mine.handle = mux.stream('job/follow', { request }, {
        onItem: frame => { if (follow === mine) onFrame(mine, frame); },
        onEnd: () => over(),
        onError: error => over(error ?? {}),
      });
      follow = mine;
    },
    unfollow() { closeFollow(); },
    outputOf(jobId) {
      if (!follow || follow.jobId !== jobId) return null;
      return follow.error === undefined ? { text: follow.text, ended: follow.ended } : { text: follow.text, ended: follow.ended, error: follow.error };
    },
    // the operator's Stop: true when the host took it or the job had already finished; a refusal on the status line
    async kill(convId, jobId) {
      try {
        const value = await call('job/kill', { request: { sessionId: convId, jobId } });
        if (value?.outcome === 'requested' || value?.outcome === 'already-finished') return true;
        say(said('status.fail', { what: said('status.verb.stop'), reason: said('status.failed') }));
        return false;
      } catch (err) {
        say(failLine(err, said('status.verb.stop')));
        return false;
      }
    },
  };
}
