// The owner key's home (spec 2026-10-22, plan 2 task 2): wire/key-store.js — the IndexedDB store under the face's
// names over a minimal fake indexedDB, the in-memory twin, and the sign-out flag over a storage that may throw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDbKeys, memoryKeys, signedOutFlag } from '../../client/js/wire/key-store.js';

// an indexedDB with the shape the module uses: open → a request that fires onupgradeneeded (first open of a version)
// then onsuccess; transaction(store, mode).objectStore(store).get/put/delete → requests firing onsuccess, async
function fakeIndexedDb() {
  const log = [];
  const databases = new Map();
  const later = fn => setTimeout(fn, 0);
  const request = run => {
    const req = { result: undefined, error: null, onsuccess: null, onerror: null };
    later(() => { req.result = run(); req.onsuccess?.({ target: req }); });
    return req;
  };
  return {
    log,
    databases,
    open(name, version) {
      log.push(['open', name, version]);
      const req = { result: undefined, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
      later(() => {
        let entry = databases.get(name);
        const upgrade = !entry || entry.version < version;
        if (!entry) { entry = { version, stores: new Map() }; databases.set(name, entry); }
        entry.version = version;
        const db = {
          objectStoreNames: { contains: store => entry.stores.has(store) },
          createObjectStore(store) {
            log.push(['createObjectStore', store]);
            if (entry.stores.has(store)) throw new Error('ConstraintError');
            entry.stores.set(store, new Map());
          },
          transaction(store, mode) {
            log.push(['transaction', store, mode]);
            const records = entry.stores.get(store);
            if (!records) throw new Error('NotFoundError');
            return {
              objectStore(name) {
                assert.equal(name, store);
                return {
                  get: key => request(() => records.get(key)),
                  put: (value, key) => request(() => { records.set(key, value); return key; }),
                  delete: key => request(() => { records.delete(key); return undefined; }),
                };
              },
            };
          },
        };
        req.result = db;
        if (upgrade) req.onupgradeneeded?.({ target: req });
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
}

test('memoryKeys gets, puts and removes', async () => {
  const keys = memoryKeys();
  assert.equal(await keys.get(), undefined);
  const pair = { publicKey: {}, privateKey: {} };
  assert.equal(await keys.put(pair), undefined);
  assert.equal(await keys.get(), pair);
  assert.equal(await keys.remove(), undefined);
  assert.equal(await keys.get(), undefined);
});

test('indexedDbKeys creates the store on upgrade and round-trips a value', async () => {
  const idb = fakeIndexedDb();
  const keys = indexedDbKeys(idb);
  assert.equal(await keys.get(), undefined);
  assert.deepEqual(idb.log.slice(0, 3), [
    ['open', 'gravit-face-owner', 1],
    ['createObjectStore', 'keys'],
    ['transaction', 'keys', 'readonly'],
  ]);
  const pair = { publicKey: { k: 'pub' }, privateKey: { k: 'priv' } };
  assert.equal(await keys.put(pair), undefined);
  assert.equal(idb.databases.get('gravit-face-owner').stores.get('keys').get('device'), pair);
  assert.deepEqual(idb.log.at(-1), ['transaction', 'keys', 'readwrite']);
  assert.equal(await keys.get(), pair);
  // a second handle over the same database finds the record, and no second store is made
  assert.equal(await indexedDbKeys(idb).get(), pair);
  assert.equal(idb.log.filter(([op]) => op === 'createObjectStore').length, 1);
  assert.equal(await keys.remove(), undefined);
  assert.deepEqual(idb.log.at(-1), ['transaction', 'keys', 'readwrite']);
  assert.equal(idb.databases.get('gravit-face-owner').stores.get('keys').has('device'), false);
  assert.equal(await keys.get(), undefined);
});

test('indexedDbKeys rejects, never throws, when there is no indexedDB or the open fails', async () => {
  const none = indexedDbKeys(undefined);
  await assert.rejects(none.get());
  await assert.rejects(none.put({}));
  await assert.rejects(none.remove());
  const failing = indexedDbKeys({
    open() {
      const req = { error: new Error('blocked'), onsuccess: null, onerror: null, onupgradeneeded: null };
      setTimeout(() => req.onerror?.({ target: req }), 0);
      return req;
    },
  });
  await assert.rejects(failing.get(), /blocked/);
});

test('signedOutFlag reads and writes gravit.owner.signedOut.v1', () => {
  const items = new Map();
  const storage = {
    getItem: key => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => { items.set(key, String(value)); },
    removeItem: key => { items.delete(key); },
  };
  const flag = signedOutFlag(storage);
  assert.equal(flag.get(), false);
  flag.set(true);
  assert.deepEqual([...items], [['gravit.owner.signedOut.v1', '1']]);
  assert.equal(flag.get(), true);
  flag.set(false);
  assert.equal(items.size, 0);
  assert.equal(flag.get(), false);
});

test('signedOutFlag over a throwing storage answers false and never throws', () => {
  const boom = () => { throw new Error('SecurityError'); };
  const flag = signedOutFlag({ getItem: boom, setItem: boom, removeItem: boom });
  assert.equal(flag.get(), false);
  assert.doesNotThrow(() => flag.set(true));
  assert.doesNotThrow(() => flag.set(false));
  const absent = signedOutFlag(undefined);
  assert.equal(absent.get(), false);
  assert.doesNotThrow(() => absent.set(true));
});
