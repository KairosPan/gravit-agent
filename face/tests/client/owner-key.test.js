// The owner key (spec 2026-10-22, plan 2 task 2): wire/owner-key.js over Node's own WebCrypto, checked against
// node:crypto as an independent verifier — the Account's canonical bytes (the owner-path map §2.1) character for
// character, an ES256 signature the Account's es256Verify would take, the kid as sign.ts kidOf makes it, and b64u.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import {
  canonical, b64u, signingInput, kidOf, publicJwkOf, signPrepared, makeKey,
} from '../../client/js/wire/owner-key.js';

const subtle = globalThis.crypto.subtle;

// the map's illustrative watch, its shown fields out of alphabetical order on purpose
const WATCH = {
  domain: { name: 'AgentAccountSignTransaction', version: '1', chainId: 424242 },
  primaryType: 'AccountTransaction:SetWatch',
  accountChain: 'Simulation',
  shown: [
    { name: 'venue', value: 'okx' },
    { name: 'symbol', value: 'BTC/USDT' },
    { name: 'on', value: 'true' },
    { name: 'nonce', value: '1761100000000' },
  ],
};
const WATCH_BYTES = '{"domain":{"chainId":424242,"name":"AgentAccountSignTransaction","version":"1"},"message":{"accountChain":"Simulation","nonce":"1761100000000","on":"true","symbol":"BTC/USDT","venue":"okx"},"primaryType":"AccountTransaction:SetWatch"}';

test("the canonical bytes equal the map's SetWatch input character for character", () => {
  assert.equal(signingInput(WATCH), WATCH_BYTES);
});

test('undefined is dropped and null is kept', () => {
  assert.equal(canonical({ b: undefined, a: null, c: [3, { z: 1, y: undefined, x: null }] }), '{"a":null,"c":[3,{"x":null,"z":1}]}');
  assert.equal(canonical({ z: { b: 2, a: 1 }, a: 'x' }), '{"a":"x","z":{"a":1,"b":2}}');
  assert.equal(canonical(['b', 'a']), '["b","a"]');
});

test('a signature verifies under ieee-p1363', async () => {
  const pair = await makeKey(subtle);
  assert.equal(pair.privateKey.extractable, false);
  assert.deepEqual([...pair.privateKey.usages], ['sign']);
  assert.deepEqual(pair.privateKey.algorithm, { name: 'ECDSA', namedCurve: 'P-256' });
  const jwk = await publicJwkOf(subtle, pair);
  assert.deepEqual(Object.keys(jwk).sort(), ['crv', 'kty', 'x', 'y']);
  assert.equal(jwk.kty, 'EC');
  assert.equal(jwk.crv, 'P-256');
  const kid = await kidOf(subtle, jwk);
  const signature = await signPrepared(subtle, pair.privateKey, kid, WATCH);
  assert.deepEqual(Object.keys(signature).sort(), ['es256', 'kid']);
  assert.equal(signature.kid, kid);
  const raw = Buffer.from(signature.es256, 'base64url');
  assert.equal(raw.length, 64);
  assert.doesNotMatch(signature.es256, /[+/=]/);
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  assert.equal(verify('sha256', Buffer.from(WATCH_BYTES), { key, dsaEncoding: 'ieee-p1363' }, raw), true);
  // and over other bytes it does not
  assert.equal(verify('sha256', Buffer.from(WATCH_BYTES + ' '), { key, dsaEncoding: 'ieee-p1363' }, raw), false);
});

test('the kid is the first sixteen hex of sha256 over x and y', async () => {
  const pair = await makeKey(subtle);
  const jwk = await publicJwkOf(subtle, pair);
  const expected = createHash('sha256')
    .update(Buffer.concat([Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]))
    .digest('hex')
    .slice(0, 16);
  const kid = await kidOf(subtle, jwk);
  assert.match(kid, /^[0-9a-f]{16}$/);
  assert.equal(kid, expected);
});

test('b64u pads nothing and maps + and /', () => {
  // 0xfb 0xff → standard "+/8=" → "-_8"
  assert.equal(b64u(new Uint8Array([0xfb, 0xff]).buffer), '-_8');
  assert.equal(b64u(new Uint8Array([0xfb, 0xff])), '-_8');
  assert.equal(b64u(new Uint8Array([0x66])), 'Zg');
  assert.equal(b64u(new Uint8Array([])), '');
  // a view into a larger buffer reads only its own bytes
  const whole = new Uint8Array([1, 2, 0xfb, 0xff, 9]);
  assert.equal(b64u(whole.subarray(2, 4)), '-_8');
  assert.equal(b64u(new DataView(whole.buffer, 2, 2)), '-_8');
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  assert.equal(b64u(new Uint8Array(bytes)), bytes.toString('base64url'));
});
