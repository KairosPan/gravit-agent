// face/client/js/host/attachments.js — the attachments' reads: the image limits (session/projections' imageLimits, read
// once, dsh's defaults until then), a file's upload to its session (resolving its receipt id), and a history thumb
// (session/attachment, once per attachment id) landed in the store's thumbs as a data URL. Impure; nothing here draws.
import { uploadFile } from '../wire/api.js';
import { DEFAULT_LIMITS } from '../composer/files.js';

const LIMIT_NUMBERS = ['maxImageBytes', 'maxImagesPerMessage', 'maxMessageImageBytes', 'maxImagePixels', 'maxImageDimension'];

/** The projection's imageLimits when every field is the right shape, else null. */
function limitsOf(v) {
  if (!v || typeof v !== 'object') return null;
  if (!LIMIT_NUMBERS.every(k => Number.isFinite(v[k]) && v[k] > 0)) return null;
  if (!Array.isArray(v.mediaTypes) || !v.mediaTypes.every(t => typeof t === 'string')) return null;
  return { ...Object.fromEntries(LIMIT_NUMBERS.map(k => [k, v[k]])), mediaTypes: [...v.mediaTypes] };
}

export function startAttachments({ call, upload = uploadFile, store }) {
  let limits = DEFAULT_LIMITS;
  let read = false;
  const thumbs = new Set();

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

    async thumb(sessionId, attachmentId) {
      if (thumbs.has(attachmentId)) return;
      thumbs.add(attachmentId);
      let src = null;
      try {
        const v = await call('session/attachment', { request: { sessionId, attachmentId } });
        const mediaType = v?.attachment?.mediaType;
        if (typeof mediaType === 'string' && typeof v?.data === 'string') src = `data:${mediaType};base64,${v.data}`;
      } catch (e) {
        // a carrier failure (an HTTP status, or no host code) says nothing of the image: unmark it, a later read retries;
        // a host refusal is the image's answer, null, and the thread draws a card
        if (e?.status !== undefined || typeof e?.code !== 'string') { thumbs.delete(attachmentId); return; }
      }
      store.dispatch('hostThumb', { attachmentId, src });
    },
  };
}
