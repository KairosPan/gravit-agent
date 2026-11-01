// face/client/js/wire/owner-key.js — the owner key's arithmetic (spec 2026-10-22, plan 2): the face's page signs the
// Account's owner envelope exactly as the retired page does (its owner.js `sign` ≡ sign.ts `deviceSigningInput`;
// docs/research/2026-10-22-account-owner-path-map.md §1.1–§1.2, §2.1):
// - canonical(v): JSON with object keys sorted recursively, keys whose value is undefined dropped, arrays in order, no
//   whitespace (null stays null);
// - signingInput(prepared): message = { accountChain } plus each shown field's name → value, then the canonical form of
//   { domain, primaryType, message } — so the order of `shown` never matters;
// - signPrepared: ECDSA P-256 / SHA-256 over the input's UTF-8 bytes, the raw r‖s (64 bytes) as base64url → { kid, es256 };
// - kidOf: the first 16 hex of SHA-256 over base64url-decoded x ‖ y (sign.ts kidOf), the device's id `device:<kid>`;
// - makeKey: a P-256 pair that cannot be exported; only its public half (publicJwkOf) ever leaves the browser.
// `subtle` is always the caller's (the browser's crypto.subtle, Node's in tests). No DOM, no store, no network, and no
// key material is ever stringified or logged.

const ECDSA_P256 = { name: 'ECDSA', namedCurve: 'P-256' };
const ES256 = { name: 'ECDSA', hash: 'SHA-256' };

/** @param {unknown} v @returns {unknown} */
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = /** @type {Record<string, unknown>} */ (v);
    return Object.fromEntries(Object.keys(o).sort().filter(k => o[k] !== undefined).map(k => [k, sortKeys(o[k])]));
  }
  return v;
}

/** The Account's canonical JSON (core/hash.ts). @param {unknown} v @returns {string} */
export function canonical(v) {
  return JSON.stringify(sortKeys(v));
}

/** Base64url without padding. @param {ArrayBuffer | ArrayBufferView} bufferOrView @returns {string} */
export function b64u(bufferOrView) {
  const bytes = ArrayBuffer.isView(bufferOrView)
    ? new Uint8Array(bufferOrView.buffer, bufferOrView.byteOffset, bufferOrView.byteLength)
    : new Uint8Array(bufferOrView);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} text @returns {Uint8Array} */
function unb64u(text) {
  const standard = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(standard + '='.repeat((4 - (standard.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The bytes a device signs for a prepared owner action, as a string.
 * @param {{ domain: unknown, primaryType: string, accountChain: string, shown: { name: string, value: string }[] }} prepared
 * @returns {string}
 */
export function signingInput(prepared) {
  /** @type {Record<string, string>} */
  const message = { accountChain: prepared.accountChain };
  for (const f of prepared.shown) message[f.name] = f.value;
  return canonical({ domain: prepared.domain, primaryType: prepared.primaryType, message });
}

/**
 * The device's kid: the first 16 hex of SHA-256 over base64url-decoded x ‖ y.
 * @param {SubtleCrypto} subtle @param {{ x: string, y: string }} jwk @returns {Promise<string>}
 */
export async function kidOf(subtle, jwk) {
  const x = unb64u(jwk.x), y = unb64u(jwk.y);
  const xy = new Uint8Array(x.length + y.length);
  xy.set(x, 0);
  xy.set(y, x.length);
  const digest = new Uint8Array(await subtle.digest('SHA-256', xy));
  return Array.from(digest.subarray(0, 8), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The public half as the Account takes it, and nothing else.
 * @param {SubtleCrypto} subtle @param {CryptoKeyPair} keyPair
 * @returns {Promise<{ kty: string, crv: string, x: string, y: string }>}
 */
export async function publicJwkOf(subtle, keyPair) {
  const jwk = await subtle.exportKey('jwk', keyPair.publicKey);
  return { kty: String(jwk.kty), crv: String(jwk.crv), x: String(jwk.x), y: String(jwk.y) };
}

/**
 * The envelope's signature for a prepared owner action.
 * @param {SubtleCrypto} subtle @param {CryptoKey} privateKey @param {string} kid
 * @param {Parameters<typeof signingInput>[0]} prepared
 * @returns {Promise<{ kid: string, es256: string }>}
 */
export async function signPrepared(subtle, privateKey, kid, prepared) {
  const sig = await subtle.sign(ES256, privateKey, new TextEncoder().encode(signingInput(prepared)));
  return { kid, es256: b64u(sig) };
}

/** A P-256 pair the browser keeps and cannot export. @param {SubtleCrypto} subtle @returns {Promise<CryptoKeyPair>} */
export async function makeKey(subtle) {
  return /** @type {Promise<CryptoKeyPair>} */ (subtle.generateKey(ECDSA_P256, false, ['sign', 'verify']));
}
