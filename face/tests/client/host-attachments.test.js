// The attachments' reads (host/attachments.js): the image limits, the upload's receipt, a history thumb read once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { DEFAULT_LIMITS } from '../../client/js/composer/files.js';
import { startAttachments } from '../../client/js/host/attachments.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function rig(answer, upload) {
  const store = createStore({ initial: emptyState(), reducers });
  const calls = [];
  const call = (endpoint, args) => { calls.push([endpoint, args]); return answer(endpoint, args); };
  const attachments = startAttachments({ call, store, ...(upload ? { upload } : {}) });
  return { store, calls, attachments };
}

const LIMITS = { ...DEFAULT_LIMITS, maxImagesPerMessage: 5 };

test('the limits are dsh\'s defaults until read, then the projection\'s', async () => {
  const r = rig(async () => ({ kind: 'sequenced', values: { imageLimits: LIMITS } }));
  assert.deepEqual(r.attachments.limits(), DEFAULT_LIMITS);
  await r.attachments.readLimits('s1');
  assert.deepEqual(r.calls, [['session/projections', { request: { sessionId: 's1' } }]]);
  assert.equal(r.attachments.limits().maxImagesPerMessage, 5);
  await r.attachments.readLimits('s2');
  assert.equal(r.calls.length, 1, 'the limits are read once');
});

test('a failed or malformed limits read keeps what was', async () => {
  for (const answer of [
    async () => { throw new Error('down'); },
    async () => null,
    async () => ({ values: {} }),
    async () => ({ values: { imageLimits: { maxImageBytes: 'big' } } }),
    async () => ({ values: { imageLimits: { ...LIMITS, mediaTypes: 'image/png' } } }),
  ]) {
    const r = rig(answer);
    await r.attachments.readLimits('s1');
    assert.deepEqual(r.attachments.limits(), DEFAULT_LIMITS);
  }
  // a failure after a good read keeps the good one, and a failed read may be tried again
  let n = 0;
  const r = rig(async () => { if (n++ === 0) throw new Error('down'); return { values: { imageLimits: LIMITS } }; });
  await r.attachments.readLimits('s1');
  assert.deepEqual(r.attachments.limits(), DEFAULT_LIMITS);
  await r.attachments.readLimits('s1');
  assert.equal(r.attachments.limits().maxImagesPerMessage, 5);
});

test('an upload resolves its receipt id', async () => {
  const seen = [];
  let aborted = false;
  const upload = opts => {
    seen.push(opts);
    opts.onProgress(2);
    return { done: Promise.resolve({ receiptId: 'r1', file: { attachmentId: 'a1' } }), abort() { aborted = true; } };
  };
  const r = rig(async () => null, upload);
  const blob = { name: 'q.csv', size: 3 };
  const ticks = [];
  const handle = r.attachments.upload('s1', blob, n => ticks.push(n));
  assert.equal(await handle.done, 'r1');
  assert.equal(seen[0].sessionId, 's1');
  assert.equal(seen[0].name, 'q.csv');
  assert.equal(seen[0].blob, blob);
  assert.deepEqual(ticks, [2]);
  handle.abort();
  assert.equal(aborted, true);
});

test('a thumb is read once per attachment and lands as a data URL, or null on a throw', async () => {
  const d = deferred();
  const r = rig(async (endpoint, args) => {
    if (args.request.attachmentId === 'bad') throw Object.assign(new Error('gone'), { code: 'session/attachment-invalid' });
    return d.promise;
  });
  const first = r.attachments.thumb('s1', 'a1');
  const second = r.attachments.thumb('s1', 'a1');
  assert.deepEqual(r.calls, [['session/attachment', { request: { sessionId: 's1', attachmentId: 'a1' } }]]);
  d.resolve({ attachment: { attachmentId: 'a1', mediaType: 'image/png' }, data: 'iVBORw==' });
  await Promise.all([first, second]); await settle();
  assert.equal(r.store.get().thumbs.a1, 'data:image/png;base64,iVBORw==');
  await r.attachments.thumb('s1', 'a1');
  assert.equal(r.calls.length, 1, 'an answered thumb is not read again');
  await r.attachments.thumb('s1', 'bad'); await settle();
  assert.equal(r.store.get().thumbs.bad, null);
  assert.ok(Object.hasOwn(r.store.get().thumbs, 'bad'));
});

test('a carrier failure leaves a thumb free to read again; a refusal or a bad answer lands as null for good', async () => {
  let n = 0;
  const carrier = rig(async () => { if (n++ === 0) throw Object.assign(new Error('HTTP 502'), { status: 502 }); return { attachment: { mediaType: 'image/png' }, data: 'AA==' }; });
  await carrier.attachments.thumb('s1', 'a1'); await settle();
  assert.equal(Object.hasOwn(carrier.store.get().thumbs, 'a1'), false, 'nothing cached on a carrier failure');
  await carrier.attachments.thumb('s1', 'a1'); await settle();
  assert.equal(carrier.store.get().thumbs.a1, 'data:image/png;base64,AA==');
  assert.equal(carrier.calls.length, 2);

  const codeless = rig(async () => { throw new Error('socket hang up'); });
  await codeless.attachments.thumb('s1', 'a1'); await codeless.attachments.thumb('s1', 'a1');
  assert.equal(codeless.calls.length, 2, 'an error with no code is a carrier failure too');

  const refused = rig(async () => { throw Object.assign(new Error('no'), { code: 'session/attachment-invalid' }); });
  await refused.attachments.thumb('s1', 'a1'); await refused.attachments.thumb('s1', 'a1');
  assert.equal(refused.store.get().thumbs.a1, null);
  assert.equal(refused.calls.length, 1);

  const malformed = rig(async () => ({ attachment: {}, data: 7 }));
  await malformed.attachments.thumb('s1', 'a1'); await malformed.attachments.thumb('s1', 'a1');
  assert.equal(malformed.store.get().thumbs.a1, null);
  assert.equal(malformed.calls.length, 1);
});

test('the fake XHR refuses a header before open, as a real one does', async () => {
  const { fakeXhr } = await import('./helpers/fake-xhr.js');
  assert.throws(() => fakeXhr().setRequestHeader('content-type', 'x'));
});
