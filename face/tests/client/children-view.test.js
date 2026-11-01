// A conversation's subagent children (spec 2026-10-19 §7 Stage 3 "Research surfaces"): the parent's catalog composed
// with the list's child rows, the old client's decisions, the states as enums.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childrenOf } from '../../client/js/host/children-view.js';

const parent = (catalog, over = {}) => ({ id: 'p', live: true, subagentCatalog: catalog, ...over });
const rows = [
  { sessionId: 'live', parentSessionId: 'p', running: true, origin: 'subagent' },
  { sessionId: 'once', parentSessionId: 'p', running: false, origin: 'subagent' },
];

test('catalog children with their states; a running continuable child can stop, a one-shot cannot', () => {
  const v = childrenOf(parent([{ id: 'live', createdAt: 1, mode: 'continuable', label: 'Check the screen' }, { id: 'once', createdAt: 2, mode: 'one-shot' }, { id: 'cold', createdAt: 3, mode: 'continuable', label: 'Later' }]), rows);
  assert.equal(v.unavailable, false);
  assert.deepEqual(v.children, [
    { id: 'live', label: 'Check the screen', mode: 'continuable', state: 'running', canStop: true },
    { id: 'once', label: 'Subagent', mode: 'one-shot', state: 'inactive', canStop: false },
    { id: 'cold', label: 'Later', mode: 'continuable', state: 'unknown', canStop: false },
  ]);
  assert.deepEqual(childrenOf(parent(undefined), rows), { children: [], unavailable: false }, 'no catalog, no children');
});

test('a malformed catalog reads unavailable, never an empty list', () => {
  assert.deepEqual(childrenOf(parent({ not: 'a list' }), rows), { children: [], unavailable: true });
  assert.deepEqual(childrenOf(parent('x'), rows), { children: [], unavailable: true });
});

test('an unknown-mode entry reads unavailable', () => {
  const v = childrenOf(parent([{ id: 'legacy', createdAt: 1, mode: 'unknown' }]), rows);
  assert.deepEqual(v.children, [{ id: 'legacy', label: 'Subagent', mode: null, state: 'unavailable', canStop: false }]);
});
