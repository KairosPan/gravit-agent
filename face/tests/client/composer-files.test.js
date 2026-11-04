// The composer's attachment list (plan 4 of the dsh UI port, Task 1): kinds, the pre-checks, the lines, the content. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIMITS, kindOf, admit, hasImage, blocking, sizeText, progressText, extOf, metaText, limitsLine,
  modelRefusalLine, encodeBase64, contentParts, attachmentsLine, isImageSrc,
} from '../../client/js/composer/files.js';

const MiB = 1048576;
let n = 0;
const pick = (name, bytes, mediaType) => ({ key: `k${++n}`, name, bytes, mediaType, blob: { size: bytes } });

test('an image is one of the limits\' media types; an SVG and a PDF are files', () => {
  for (const t of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) assert.equal(kindOf(t, DEFAULT_LIMITS), 'image');
  for (const t of ['image/svg+xml', 'application/pdf', 'image/heic', '', undefined]) assert.equal(kindOf(t, DEFAULT_LIMITS), 'file');
  assert.equal(kindOf('image/png', { ...DEFAULT_LIMITS, mediaTypes: ['image/jpeg'] }), 'file');
  assert.equal(kindOf('image/png'), 'image', 'the default limits when none are given');
});

test('admit keeps files whatever their size and refuses an image over the per-image limit, by name', () => {
  const chart = pick('chart.png', 21 * MiB, 'image/png'), zip = pick('big.zip', 300 * MiB, 'application/zip');
  const { files, refusal } = admit([], [chart, zip], DEFAULT_LIMITS);
  assert.equal(refusal, 'chart.png is over 20 MB');
  assert.equal(files.length, 1);
  assert.deepEqual(files[0], { key: zip.key, kind: 'file', name: 'big.zip', bytes: 300 * MiB, mediaType: 'application/zip', blob: zip.blob, status: 'ready', loaded: 0 });
  const ok = admit(files, [pick('a.png', 10, 'image/png')], DEFAULT_LIMITS);
  assert.equal(ok.refusal, null);
  assert.deepEqual(ok.files.map(f => [f.name, f.kind]), [['big.zip', 'file'], ['a.png', 'image']]);
  assert.ok(hasImage(ok.files));
  assert.ok(!hasImage(files));
});

test('admit stops at the count and at the message total, admitting the rest', () => {
  const pngs = Array.from({ length: 21 }, (_, i) => pick(`p${i}.png`, 1000, 'image/png'));
  const a = admit([], [...pngs, pick('notes.txt', 5, 'text/plain')], DEFAULT_LIMITS);
  assert.equal(a.files.length, 21);
  assert.equal(a.files.filter(f => f.kind === 'image').length, 20);
  assert.equal(a.files.at(-1).name, 'notes.txt', 'a file after the refused image is still admitted');
  assert.equal(a.refusal, 'Up to 20 images a message');
  const again = admit(a.files, [pick('x.png', 1, 'image/png')], DEFAULT_LIMITS);
  assert.equal(again.files.length, 21, 'the draft\'s images count');
  assert.equal(again.refusal, 'Up to 20 images a message');

  const jpegs = Array.from({ length: 11 }, (_, i) => pick(`j${i}.jpg`, 19 * MiB, 'image/jpeg'));
  const b = admit([], jpegs, DEFAULT_LIMITS);
  assert.equal(b.files.length, 10);
  assert.deepEqual(b.files.map(f => f.name), jpegs.slice(0, 10).map(f => f.name));
  assert.equal(b.refusal, 'Images in one message: up to 200 MB');
  const c = admit([], [pick('big.png', 25 * MiB, 'image/png'), ...pngs.slice(0, 21)], DEFAULT_LIMITS);
  assert.equal(c.refusal, 'big.png is over 20 MB', 'the first refusal is the line');
});

test('blocking reads an upload in flight before a failed one, and nothing for a ready draft', () => {
  const f = status => ({ key: status, status });
  assert.equal(blocking([f('failed'), f('uploading'), f('up')]), 'uploading');
  assert.equal(blocking([f('up'), f('failed'), f('ready')]), 'failed');
  assert.equal(blocking([f('ready'), f('up')]), null);
  assert.equal(blocking([]), null);
});

test('sizes and progress read B, KB and MB, the progress in the total\'s unit', () => {
  assert.equal(sizeText(900), '900 B');
  assert.equal(sizeText(1023), '1023 B');
  assert.equal(sizeText(15360), '15 KB');
  assert.equal(sizeText(2936013), '2.8 MB');
  assert.equal(progressText(1153434, 2936013), '1.1 / 2.8 MB');
  assert.equal(progressText(5120, 15360), '5 / 15 KB');
  assert.equal(progressText(100, 900), '100 / 900 B');
  assert.equal(metaText({ name: 'q3.csv', bytes: 2936013 }), 'CSV · 2.8 MB');
  assert.equal(extOf('a.csv'), 'CSV');
  assert.equal(extOf('README'), 'FILE');
  assert.equal(extOf('archive.tar.gz'), 'GZ');
  assert.equal(extOf('.env'), 'FILE');
  assert.equal(extOf('trailing.'), 'FILE');
});

test('the limits line and the model refusal read as the spec writes them', () => {
  assert.equal(limitsLine(DEFAULT_LIMITS), 'Images: up to 20 a message, 20 MB each');
  assert.equal(modelRefusalLine(), "Gravit's model takes no images. Remove the image, or run Gravit on a model that does.");
  const bot = modelRefusalLine('news-scout');
  assert.equal(bot.split('news-scout').length - 1, 2);
  assert.ok(!bot.includes('Gravit'));
});

test('base64 is canonical for every length, and a 3 MB array encodes without a stack overflow', () => {
  for (let len = 0; len <= 5; len++) {
    const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 97 + 251) & 255);
    assert.equal(encodeBase64(bytes), Buffer.from(bytes).toString('base64'), `length ${len}`);
  }
  const big = new Uint8Array(3145728);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 255;
  assert.equal(encodeBase64(big), Buffer.from(big).toString('base64'));
});

test('content: text first when not blank, then images and receipts in the draft\'s order; no text part for blank words', () => {
  const files = [
    { key: 'a', kind: 'file', name: 'q3.csv', mediaType: 'text/csv', receiptId: 'r-1' },
    { key: 'b', kind: 'image', name: 'chart.png', mediaType: 'image/png' },
    { key: 'c', kind: 'file', name: 'b.pdf', mediaType: 'application/pdf', receiptId: 'r-2' },
  ];
  const dataOf = key => `data-${key}`;
  assert.deepEqual(contentParts('look at these', files, dataOf), [
    { type: 'text', text: 'look at these' },
    { type: 'file', receiptId: 'r-1' },
    { type: 'image', mediaType: 'image/png', data: 'data-b', name: 'chart.png' },
    { type: 'file', receiptId: 'r-2' },
  ]);
  assert.deepEqual(contentParts('  \n ', files.slice(1, 2), dataOf), [{ type: 'image', mediaType: 'image/png', data: 'data-b', name: 'chart.png' }]);
  assert.deepEqual(contentParts('hi', [], dataOf), [{ type: 'text', text: 'hi' }]);
});

test('history\'s names: an unnamed image reads image', () => {
  assert.equal(attachmentsLine([{ type: 'image', name: 'chart.png' }, { type: 'image' }, { type: 'file', name: 'q3.csv' }]), 'chart.png, image, q3.csv');
  assert.equal(attachmentsLine([]), '');
});

test('an img src is drawn only for an object URL or an inline image of the four kinds; any other scheme is not', () => {
  for (const ok of ['blob:http://127.0.0.1:3090/1f2e', 'data:image/png;base64,AA', 'data:image/jpeg;base64,AA', 'data:image/webp;base64,AA', 'data:image/gif;base64,AA']) assert.equal(isImageSrc(ok), true, ok);
  for (const no of ['https://x.test/a.png', 'http://x.test/a.png', 'data:image/svg+xml;base64,AA', 'data:text/html;base64,AA', 'data:image/png,AA', 'javascript:alert(1)', ' blob:x', '', null, undefined, 7]) assert.equal(isImageSrc(no), false, String(no));
});
