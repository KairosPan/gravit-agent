// Background jobs' pure view (host/jobs-view.js): live and finished, the chip, the end lines, the meta line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isLive, jobsView, chipText, endLine, metaLine } from '../../client/js/host/jobs-view.js';

const job = (id, status, more = {}) => ({ id, kind: 'bash', label: `run ${id}`, owner: 's1', status, startedAt: 1_000, output: { total: 0, earliest: 0 }, ...more });
const slice = (rows, cleared = {}) => ({ convId: 's1', rows, open: null, cleared });

test('running and stopping are live; finished jobs leave out the cleared', () => {
  assert.equal(isLive(job('a', 'running')), true);
  assert.equal(isLive(job('a', 'stopping')), true);
  for (const s of ['completed', 'killed', 'failed']) assert.equal(isLive(job('a', s)), false);
  const rows = [job('a', 'running'), job('b', 'completed'), job('c', 'stopping'), job('d', 'killed')];
  const v = jobsView(slice(rows, { s1: ['b'] }), 's1');
  assert.deepEqual(v.running.map(j => j.id), ['a', 'c']);
  assert.deepEqual(v.finished.map(j => j.id), ['d']);
  // another conversation's slice shows nothing
  const other = jobsView(slice(rows), 's2');
  assert.deepEqual([other.running, other.finished, other.chip], [[], [], null]);
});

test('the chip: 1 job running, 2 jobs running, 2 jobs finished, none', () => {
  assert.equal(chipText([job('a', 'running')], [job('b', 'failed')]), '1 job running');
  assert.equal(chipText([job('a', 'running'), job('c', 'stopping')], []), '2 jobs running');
  assert.equal(chipText([], [job('b', 'failed'), job('d', 'completed')]), '2 jobs finished');
  assert.equal(chipText([], [job('b', 'failed')]), '1 job finished');
  assert.equal(chipText([], []), null);
  assert.equal(jobsView(slice([job('b', 'completed')], { s1: ['b'] }), 's1').chip, null);
  assert.equal(jobsView(slice([job('a', 'stopping')]), 's1').chip, '1 job running');
});

test("the end lines from bash's details, sandbox notes and a human kill's reason included", () => {
  assert.equal(endLine(job('a', 'completed', { detail: 'exit code: 3; sandbox: network denied' })), 'exit 3');
  assert.equal(endLine(job('a', 'completed', { detail: 'exit code: 0' })), 'exit 0');
  assert.equal(endLine(job('a', 'completed')), 'exit');
  assert.equal(endLine(job('a', 'killed', { detail: 'signal: SIGTERM; cancelled by the user' })), 'signal SIGTERM');
  assert.equal(endLine(job('a', 'killed', { detail: 'killed before exit; cancelled by the user' })), 'killed');
  assert.equal(endLine(job('a', 'killed')), 'killed');
  assert.equal(endLine(job('a', 'failed', { detail: 'spawn ENOENT' })), 'failed');
  assert.equal(endLine(job('a', 'running')), '');
  assert.equal(endLine(job('a', 'stopping', { detail: 'exit code: 1' })), '');
});

test('the meta line: kind, progress while live, the end once finished, the clock', () => {
  const start = 1_000;
  assert.equal(metaLine(job('a', 'running', { progress: 'page 7 of 12' }), start + 184_000), 'bash · page 7 of 12 · 3m 04s');
  assert.equal(metaLine(job('a', 'running'), start + 42_000), 'bash · 42s');
  assert.equal(metaLine(job('a', 'completed', { detail: 'exit code: 3', finishedAt: start + 3_840_000, progress: 'stale' }), start + 9_999_999), 'bash · exit 3 · 1h 04m');
  assert.equal(metaLine(job('a', 'running', { kind: '' }), start + 5_000), '5s');
});
