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
  const clock = { t: 1000 };
  // the page's Blob and URL: each object URL made is counted, and names the blob it was made from
  const blobs = [];
  const win = {
    Blob: class { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; } },
    URL: { createObjectURL: b => { blobs.push(b); return `blob:t/${blobs.length}`; } },
  };
  const attachments = startAttachments({ call, store, win, now: () => clock.t, ...(upload ? { upload } : {}) });
  return { store, calls, attachments, clock, blobs };
}

const LIMITS = { ...DEFAULT_LIMITS, maxImagesPerMessage: 5 };

test('the limits are dsh\'s defaults until read, then the projection\'s', async () => {
  const r = rig(async () => ({ kind: 'sequenced', values: { imageLimits: LIMITS } }));
  assert.deepEqual(r.attachments.limits(), DEFAULT_LIMITS);
  assert.equal(await r.attachments.readLimits('s1'), true, 'read');
  assert.deepEqual(r.calls, [['session/projections', { request: { sessionId: 's1' } }]]);
  assert.equal(r.attachments.limits().maxImagesPerMessage, 5);
  assert.equal(await r.attachments.readLimits('s2'), true, 'read already');
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
    assert.equal(await r.attachments.readLimits('s1'), false, 'not read');
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

test('a thumb is read once per attachment and lands as a blob: URL, or null on a throw', async () => {
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
  assert.equal(r.store.get().thumbs.a1, 'blob:t/1', 'a blob: URL, not the bytes as a data: URL');
  assert.equal(r.blobs.length, 1);
  assert.equal(r.blobs[0].type, 'image/png');
  assert.deepEqual([...r.blobs[0].parts[0]], [0x89, 0x50, 0x4e, 0x47], 'the base64 decoded once into the blob\'s bytes');
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
  carrier.clock.t += 2000;
  await carrier.attachments.thumb('s1', 'a1'); await settle();
  assert.equal(carrier.store.get().thumbs.a1, 'blob:t/1');
  assert.equal(carrier.calls.length, 2);

  const codeless = rig(async () => { throw new Error('socket hang up'); });
  await codeless.attachments.thumb('s1', 'a1'); codeless.clock.t += 2000; await codeless.attachments.thumb('s1', 'a1');
  assert.equal(codeless.calls.length, 2, 'an error with no code is a carrier failure too');

  const refused = rig(async () => { throw Object.assign(new Error('no'), { code: 'session/attachment-invalid' }); });
  await refused.attachments.thumb('s1', 'a1'); await refused.attachments.thumb('s1', 'a1');
  assert.equal(refused.store.get().thumbs.a1, null);
  assert.equal(refused.calls.length, 1);

  const malformed = rig(async () => ({ attachment: {}, data: 7 }));
  await malformed.attachments.thumb('s1', 'a1'); await malformed.attachments.thumb('s1', 'a1');
  assert.equal(malformed.store.get().thumbs.a1, null);
  assert.equal(malformed.calls.length, 1);

  const undecodable = rig(async () => ({ attachment: { mediaType: 'image/png' }, data: '%%not base64%%' }));
  await undecodable.attachments.thumb('s1', 'a1'); await undecodable.attachments.thumb('s1', 'a1');
  assert.equal(undecodable.store.get().thumbs.a1, null, 'data that does not decode lands as null');
  assert.equal(undecodable.blobs.length, 0);
  assert.equal(undecodable.calls.length, 1);

  const svg = rig(async () => ({ attachment: { mediaType: 'image/svg+xml' }, data: 'PHN2Zy8+' }));
  await svg.attachments.thumb('s1', 'a1');
  assert.equal(svg.store.get().thumbs.a1, null, 'a media type outside the raster four lands as null');
  assert.equal(svg.blobs.length, 0);
});

test('a carrier failure backs off: no read again until the clock passes 2 s, then 4 s, doubling to a minute', async () => {
  const r = rig(async () => { throw Object.assign(new Error('HTTP 500'), { status: 500 }); });
  const reads = () => r.calls.length;
  await r.attachments.thumb('s1', 'a1');
  for (let i = 0; i < 5; i++) await r.attachments.thumb('s1', 'a1');
  assert.equal(reads(), 1, 'every render inside the backoff asks nothing');
  r.clock.t += 1999; await r.attachments.thumb('s1', 'a1');
  assert.equal(reads(), 1);
  r.clock.t += 1; await r.attachments.thumb('s1', 'a1');
  assert.equal(reads(), 2, 'past 2 s it reads again');
  r.clock.t += 3999; await r.attachments.thumb('s1', 'a1');
  assert.equal(reads(), 2, 'the second wait is 4 s');
  r.clock.t += 1; await r.attachments.thumb('s1', 'a1');
  assert.equal(reads(), 3);
  for (let i = 0; i < 10; i++) { r.clock.t += 60000; await r.attachments.thumb('s1', 'a1'); }
  assert.equal(reads(), 13, 'the wait stops growing at a minute');
  await r.attachments.thumb('s1', 'a2');
  assert.equal(reads(), 14, 'another image has its own backoff');
  for (const status of [408, 429]) {
    const t = rig(async () => { throw Object.assign(new Error('busy'), { status }); });
    await t.attachments.thumb('s1', 'a1'); await settle();
    assert.equal(Object.hasOwn(t.store.get().thumbs, 'a1'), false, `${status} is the carrier's, retried later`);
  }
});

test('a 4xx other than 401, 403, 408 or 429 is the image\'s answer: null, never read again', async () => {
  for (const status of [400, 404, 410]) {
    const r = rig(async () => { throw Object.assign(new Error('gone'), { status }); });
    await r.attachments.thumb('s1', 'a1'); await settle();
    assert.equal(r.store.get().thumbs.a1, null, String(status));
    r.clock.t += 120000; await r.attachments.thumb('s1', 'a1');
    assert.equal(r.calls.length, 1, String(status));
  }
});

test('a 401 or 403 stops every thumb read until the live layer reconnects', async () => {
  for (const status of [401, 403]) {
    let n = 0;
    const r = rig(async () => { if (n++ === 0) throw Object.assign(new Error('fence'), { status }); return { attachment: { mediaType: 'image/png' }, data: 'AA==' }; });
    await r.attachments.thumb('s1', 'a1');
    r.clock.t += 120000;
    await r.attachments.thumb('s1', 'a1'); await r.attachments.thumb('s1', 'a2');
    assert.equal(r.calls.length, 1, `${status}: nothing is read, this image or another`);
    assert.equal(Object.hasOwn(r.store.get().thumbs, 'a1'), false, 'and nothing lands');
    r.attachments.reconnected();
    await r.attachments.thumb('s1', 'a1'); await settle();
    assert.equal(r.store.get().thumbs.a1, 'blob:t/1', 'a reconnect reads again at once');
  }
});

test('the fake XHR refuses a header before open, as a real one does', async () => {
  const { fakeXhr } = await import('./helpers/fake-xhr.js');
  assert.throws(() => fakeXhr().setRequestHeader('content-type', 'x'));
});
