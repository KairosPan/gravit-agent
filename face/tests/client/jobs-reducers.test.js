// The jobs slice's reducers (reducers/jobs.js): the watched conversation, its rows, the open job, the cleared.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';

const job = (id, status) => ({ id, kind: 'bash', label: id, owner: 's1', status, startedAt: 1, output: { total: 0, earliest: 0 } });

test('rows land for the watched conversation only; watching another empties them; clear hides the finished', () => {
  const store = createStore({ initial: emptyState(), reducers });
  assert.deepEqual(store.get().jobs, { convId: null, rows: [], open: null, cleared: {} });
  store.dispatch('watchJobs', 's1');
  store.dispatch('hostJobs', { convId: 's1', jobs: [job('a', 'running'), job('b', 'completed')] });
  store.dispatch('hostJobs', { convId: 's2', jobs: [job('z', 'running')] });
  assert.deepEqual(store.get().jobs.rows.map(j => j.id), ['a', 'b']);
  store.dispatch('openJob', 'a');
  assert.equal(store.get().jobs.open, 'a');
  store.dispatch('closeJob');
  assert.equal(store.get().jobs.open, null);
  store.dispatch('openJob', 'b');
  // the same conversation watched again keeps what it has
  store.dispatch('watchJobs', 's1');
  assert.equal(store.get().jobs.rows.length, 2);
  assert.equal(store.get().jobs.open, 'b');
  store.dispatch('clearJobs', 's1');
  assert.deepEqual(store.get().jobs.cleared, { s1: ['b'] });
  store.dispatch('hostJobs', { convId: 's1', jobs: [job('a', 'killed'), job('b', 'completed')] });
  store.dispatch('clearJobs', 's1');
  assert.deepEqual(store.get().jobs.cleared, { s1: ['b', 'a'] });
  store.dispatch('watchJobs', 's2');
  assert.deepEqual(store.get().jobs, { convId: 's2', rows: [], open: null, cleared: { s1: ['b', 'a'] } });
  store.dispatch('watchJobs', null);
  assert.equal(store.get().jobs.convId, null);
  // a malformed frame keeps what was
  store.dispatch('watchJobs', 's3');
  store.dispatch('hostJobs', { convId: 's3', jobs: [job('c', 'running')] });
  store.dispatch('hostJobs', { convId: 's3', jobs: 'nope' });
  assert.deepEqual(store.get().jobs.rows.map(j => j.id), ['c']);
});
