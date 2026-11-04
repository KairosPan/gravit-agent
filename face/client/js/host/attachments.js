// face/client/js/host/attachments.js — the attachments' reads: the image limits (session/projections' imageLimits, read
// once, dsh's defaults until then), a file's upload to its session (resolving its receipt id), and a history thumb
// (session/attachment, once per attachment id) landed in the store's thumbs as a data URL. A thumb read the carrier failed
// waits out a backoff before the next render may ask again; one fenced (401, 403) waits for the live layer's reconnect.
// Impure; nothing here draws.
import { uploadFile } from '../wire/api.js';
import { DEFAULT_LIMITS } from '../composer/files.js';

// a thumb read's backoff after a carrier failure: 2 s, doubling, at most a minute
const BACKOFF_MS = 2000;
const BACKOFF_MAX_MS = 60000;
// an HTTP status that is the carrier's (the face or the cookie), not the image's: a fence, a timeout, a rate limit, a 5xx
const FENCED = new Set([401, 403]);
const TRANSIENT = new Set([408, 429]);

const LIMIT_NUMBERS = ['maxImageBytes', 'maxImagesPerMessage', 'maxMessageImageBytes', 'maxImagePixels', 'maxImageDimension'];

/** The projection's imageLimits when every field is the right shape, else null. */
function limitsOf(v) {
  if (!v || typeof v !== 'object') return null;
  if (!LIMIT_NUMBERS.every(k => Number.isFinite(v[k]) && v[k] > 0)) return null;
  if (!Array.isArray(v.mediaTypes) || !v.mediaTypes.every(t => typeof t === 'string')) return null;
  return { ...Object.fromEntries(LIMIT_NUMBERS.map(k => [k, v[k]])), mediaTypes: [...v.mediaTypes] };
}

export function startAttachments({ call, upload = uploadFile, store, now = Date.now }) {
  let limits = DEFAULT_LIMITS;
  let read = false;
  const thumbs = new Set();
  // by attachment id, the carrier failures so far and when a read may go again
  const failed = new Map();
  let fenced = false;   // a 401 or 403 answered: no thumb read until the live layer reconnects

  return {
    limits() { return limits; },

    // true once the session's limits are read (now or before), false when this read failed and a later one may try again
    async readLimits(sessionId) {
      if (read) return true;
      try {
        const got = limitsOf((await call('session/projections', { request: { sessionId } }))?.values?.imageLimits);
        if (got) { limits = got; read = true; }
      } catch { /* keep what was; a later read may try again */ }
      return read;
    },

    upload(sessionId, file, onProgress = () => {}) {
      const handle = upload({ sessionId, name: file.name, blob: file, onProgress });
      return { done: handle.done.then(v => v.receiptId), abort: () => handle.abort() };
    },

    // the live layer is back: a fenced page reads again, and every backoff starts over
    reconnected() { fenced = false; failed.clear(); },

    async thumb(sessionId, attachmentId) {
      if (thumbs.has(attachmentId) || fenced) return;
      const f = failed.get(attachmentId);
      if (f && now() < f.retryAt) return;
      thumbs.add(attachmentId);
      let src = null;
      try {
        const v = await call('session/attachment', { request: { sessionId, attachmentId } });
        const mediaType = v?.attachment?.mediaType;
        if (typeof mediaType === 'string' && typeof v?.data === 'string') src = `data:${mediaType};base64,${v.data}`;
      } catch (e) {
        // a host refusal (a code, no status) or a 4xx of the image's own (a 404) is the image's answer, null, and the thread
        // draws a card; a fence stops every read until the reconnect; any other carrier failure (a 5xx, a 408 or 429, no
        // code at all) says nothing of the image: unmark it, and a later render retries once its backoff passes
        const status = e?.status;
        const answered = status === undefined ? typeof e?.code === 'string' : status >= 400 && status < 500 && !FENCED.has(status) && !TRANSIENT.has(status);
        if (!answered) {
          thumbs.delete(attachmentId);
          if (FENCED.has(status)) { fenced = true; return; }
          const failures = f?.failures ?? 0;
          failed.set(attachmentId, { failures: failures + 1, retryAt: now() + Math.min(BACKOFF_MS * 2 ** failures, BACKOFF_MAX_MS) });
          return;
        }
      }
      failed.delete(attachmentId);
      store.dispatch('hostThumb', { attachmentId, src });
    },
  };
}
