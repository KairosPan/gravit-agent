// face/client/js/wire/key-store.js — the owner key's home (spec 2026-10-22, plan 2): the Account's owner.js `open`/`tx`
// (docs/research/2026-10-22-account-owner-path-map.md §1.1) under the face's names — IndexedDB database
// `gravit-face-owner` version 1, one object store `keys`, the CryptoKeyPair under the record `device` — an in-memory twin
// of the same shape for tests, and the sign-out flag in storage (`gravit.owner.signedOut.v1` === "1").
// The IndexedDB calls answer as promises: no indexedDB, a failed open or a failed request is a rejection, never a throw.
// The flag never throws: a storage that keeps nothing reads as not signed out and forgets every write.
// IndexedDB keeps the pair as a structured clone, so the private key stays non-extractable; nothing here reads it.

const DB = 'gravit-face-owner', VERSION = 1, STORE = 'keys', RECORD = 'device';
const SIGNED_OUT = 'gravit.owner.signedOut.v1';

/**
 * @typedef {{
 *   get(): Promise<CryptoKeyPair | undefined>,
 *   put(k: CryptoKeyPair): Promise<void>,
 *   remove(): Promise<void>,
 * }} KeyStore
 */

/** @param {IDBFactory | undefined} indexedDB @returns {KeyStore} */
export function indexedDbKeys(indexedDB) {
  /** @returns {Promise<IDBDatabase>} */
  const open = () => new Promise((resolve, reject) => {
    const r = /** @type {IDBFactory} */ (indexedDB).open(DB, VERSION);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  /** @param {IDBTransactionMode} mode @param {(s: IDBObjectStore) => IDBRequest} fn @returns {Promise<any>} */
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };
  return {
    get: () => tx('readonly', s => s.get(RECORD)),
    put: async k => { await tx('readwrite', s => s.put(k, RECORD)); },
    remove: async () => { await tx('readwrite', s => s.delete(RECORD)); },
  };
}

/** @returns {KeyStore} */
export function memoryKeys() {
  /** @type {CryptoKeyPair | undefined} */
  let held;
  return {
    get: async () => held,
    put: async k => { held = k; },
    remove: async () => { held = undefined; },
  };
}

/** @param {Storage | undefined} storage @returns {{ get(): boolean, set(on: boolean): void }} */
export function signedOutFlag(storage) {
  return {
    get() {
      try {
        return /** @type {Storage} */ (storage).getItem(SIGNED_OUT) === '1';
      } catch {
        return false;
      }
    },
    set(on) {
      try {
        if (on) /** @type {Storage} */ (storage).setItem(SIGNED_OUT, '1');
        else /** @type {Storage} */ (storage).removeItem(SIGNED_OUT);
      } catch {
        // a storage that keeps nothing: the flag is simply not kept
      }
    },
  };
}
