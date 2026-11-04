// face/client/js/host/jobs.js — the open conversation's background jobs (spec §5.8): one job/list stream for the
// conversation watched, its whole-set rows frames into the jobs slice; one job/follow stream for the job open in Details,
// whose output stays here (never the store) and is read back by outputOf after onOutput; job/kill over call. Impure;
// nothing here draws.
// The mux re-opens a stream after a reconnect with its first args: job/list's first frame is the whole set again, and
// job/follow starts again from the oldest retained byte, so a chunk whose `at` is below the `next` already held is skipped.
import { NOT_SIGNED_IN } from './actions.js';

// characters of output kept in memory per open job, the head dropped first
export const JOB_OUTPUT_KEEP = 262144;
const DROPPED = '… earlier output dropped …';

export function startJobs({ store, mux, call, onOutput = () => {} }) {
  let list = null;       // { convId, handle }
  let follow = null;     // { jobId, handle, text, ended, next, opened }

  function closeList() { list?.handle.cancel(); list = null; }

  // the dropped line on its own line, at the end of what is held
  const mark = text => `${text}${text !== '' && !text.endsWith('\n') ? '\n' : ''}${DROPPED}\n`;
  function cap(f) {
    if (f.text.length <= JOB_OUTPUT_KEEP) return;
    const head = `${DROPPED}\n`;
    let cut = f.text.length - (JOB_OUTPUT_KEEP - head.length);
    const unit = f.text.charCodeAt(cut);
    if (unit >= 0xdc00 && unit <= 0xdfff) cut += 1;   // never half a surrogate pair
    f.text = head + f.text.slice(cut);
  }

  function onFrame(f, frame) {
    if (frame?.type === 'opened') {
      const earliest = Number(frame.job?.output?.earliest) || 0;
      const from = Number(frame.from) || 0;
      if (!f.opened) {
        f.opened = true;
        f.text = earliest > 0 ? `${DROPPED}\n` : '';
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
        f.text += chunk.text;
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
    // the open conversation's jobs: the stream it had cancelled, a new one opened (none for null); the same conversation
    // watched again keeps its stream
    watch(convId) {
      const id = typeof convId === 'string' && convId !== '' ? convId : null;
      if (list && list.convId === id) return;
      closeList();
      store.dispatch('watchJobs', id);
      if (id === null) return;
      const mine = { convId: id, handle: null };
      mine.handle = mux.stream('job/list', { request: { sessionId: id } }, {
        onItem: item => {
          if (list !== mine || item?.type !== 'rows') return;
          store.dispatch('hostJobs', { convId: id, jobs: item.jobs });
        },
        onEnd: () => { if (list === mine) list = null; },
        onError: () => { if (list === mine) list = null; },
      });
      list = mine;
    },
    // one job's output: the follow it had cancelled; sessionId omitted for a job with no owner (JobFollowRequest)
    follow(convId, job) {
      follow?.handle.cancel();
      follow = null;
      if (typeof job?.id !== 'string') return;
      const mine = { jobId: job.id, handle: null, text: '', ended: false, next: 0, opened: false };
      const request = { ...(job.owner ? { sessionId: convId } : {}), jobId: job.id };
      mine.handle = mux.stream('job/follow', { request }, {
        onItem: frame => { if (follow === mine) onFrame(mine, frame); },
      });
      follow = mine;
    },
    unfollow() {
      follow?.handle.cancel();
      follow = null;
    },
    outputOf(jobId) {
      return follow && follow.jobId === jobId ? { text: follow.text, ended: follow.ended } : null;
    },
    // the operator's Stop: true when the host took it or the job had already finished; a refusal on the status line
    async kill(convId, jobId) {
      try {
        const value = await call('job/kill', { request: { sessionId: convId, jobId } });
        if (value?.outcome === 'requested' || value?.outcome === 'already-finished') return true;
        say('stop: failed');
        return false;
      } catch (err) {
        say(err?.status === 401 ? NOT_SIGNED_IN : `stop: ${err?.code ?? (err?.status ? `HTTP ${err.status}` : err?.message ?? 'failed')}`);
        return false;
      }
    },
  };
}
