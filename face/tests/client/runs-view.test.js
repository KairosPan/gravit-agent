// A channel's Lunhui research runs (modules spec A14, §5.11): the latest sealed run's chips and expectation card, a
// row per listed run, the omitted count, and the two empty words — shaped from the overview, pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runsView, valueWord, countWord } from '../../client/js/host/runs-view.js';

const R1 = '2026-10-24-0930-ab12';
const R2 = '2026-10-23-0930-cd34';
const runsBody = () => ({
  runs: [
    {
      run: R1, asOf: '2026-10-24', snapshotId: 's-1', sealed: true, kind: 'market', marketRun: null, bytes: 3072,
      artifacts: {
        sentiment: { accepted: true, status: null, contractVersion: '1', headline: { state: 'ice', money_effect: 'weak' } },
        theme: { accepted: true, status: 'NOT_EVALUABLE', contractVersion: '1', headline: {} },
        mode: { accepted: true, status: null, contractVersion: '1', headline: { mode: 'WAIT' } },
        counterevidence: { accepted: true, status: null, contractVersion: '1', headline: { items: [{ a: 1 }, { a: 2 }, { a: 3 }] } },
      },
    },
    { run: R2, asOf: null, snapshotId: null, sealed: false, kind: null, artifacts: {}, marketRun: null, bytes: 0 },
  ],
  runsOmitted: 2,
  latestRun: {
    run: R1, asOf: '2026-10-24', session: '2026-10-23', snapshotId: 's-1', marketRun: '2026-10-24-0900-ef56',
    artifacts: {
      sentiment: { headline: { state: 'ice', money_effect: 'weak', freeze_type: 0.123456 }, json: { state: 'ice', money_effect: 'weak' } },
      theme: { headline: {}, json: { status: 'NOT_EVALUABLE' } },
      mode: {
        headline: { mode: 'WAIT', preconditions: ['a', 'b'], expectation: { direction: 'up', horizon: 3, watch: ['x', 'y', 'z', 'w'] } },
        json: { mode: 'WAIT' },
      },
      counterevidence: { headline: { items: [{ a: 1 }, { a: 2 }, { a: 3 }] }, json: { items: [] } },
    },
  },
});

test('valueWord: scalars as themselves, a short scalar list joined, longer or nested lists by length, objects by fields', () => {
  assert.equal(valueWord('ice'), 'ice'); assert.equal(valueWord(3), '3'); assert.equal(valueWord(0.123456), '0.1235');
  assert.equal(valueWord(null), 'null'); assert.equal(valueWord(true), 'true');
  assert.equal(valueWord(['a', 'b', 'c']), 'a, b, c'); assert.equal(valueWord(['a', 'b', 'c', 'd']), '4 items');
  assert.equal(valueWord([{ x: 1 }]), '1 item'); assert.equal(valueWord([{ x: 1 }, { x: 2 }]), '2 items');
  assert.equal(valueWord({ a: 1, b: 2 }), '2 fields'); assert.equal(valueWord({ a: 1 }), '1 field');
});

test('runsView: shapes the latest run, its chips and the rows; omitted carries through', () => {
  const v = runsView(runsBody());
  assert.equal(v.empty, null);
  assert.equal(v.omitted, 2);
  assert.deepEqual({ ...v.latest, chips: undefined, expectation: undefined, details: undefined },
    { run: R1, asOf: '2026-10-24', session: '2026-10-23', snapshotId: 's-1', marketRun: '2026-10-24-0900-ef56', chips: undefined, expectation: undefined, details: undefined });
  assert.deepEqual(v.latest.chips, [
    { module: 'sentiment', text: 'sentiment: ice · weak · 0.1235' },
    { module: 'theme', text: 'theme: not evaluable' },
    { module: 'mode', text: 'mode: WAIT · a, b · 3 fields' },
    { module: 'counterevidence', text: 'counterevidence: 3 items' },
  ]);
  assert.deepEqual(v.latest.expectation, [['direction', 'up'], ['horizon', '3'], ['watch', '4 items']]);
  assert.deepEqual(v.latest.details.map(d => d.module), ['sentiment', 'theme', 'mode', 'counterevidence']);
  assert.equal(v.latest.details[0].json, '{"state":"ice","money_effect":"weak"}');
  assert.deepEqual(v.rows, [
    { run: R1, asOf: '2026-10-24', sealed: true, artifacts: ['sentiment', 'theme', 'mode', 'counterevidence'], bytes: 3072 },
    { run: R2, asOf: null, sealed: false, artifacts: [], bytes: 0 },
  ]);
});

test('countWord: singular for one, plural otherwise; one counterevidence item reads 1 item', () => {
  assert.equal(countWord(0, 'item'), '0 items'); assert.equal(countWord(1, 'item'), '1 item'); assert.equal(countWord(2, 'artifact'), '2 artifacts');
  const b = runsBody(); b.latestRun.artifacts.counterevidence.headline.items = [{ a: 1 }];
  assert.equal(runsView(b).latest.chips[3].text, 'counterevidence: 1 item');
});

test('runsView: a not-evaluable status read from the row when the whole artifact lacks it; no expectation is null', () => {
  const b = runsBody();
  b.latestRun.artifacts.theme.json = {};
  delete b.latestRun.artifacts.mode.headline.expectation;
  const v = runsView(b);
  assert.equal(v.latest.chips[1].text, 'theme: not evaluable');
  assert.equal(v.latest.expectation, null);
});

test('runsView: no runs yields the empty word; runs without an artifact yield the other', () => {
  assert.deepEqual(runsView({}), { latest: null, rows: [], omitted: 0, empty: 'no runs yet' });
  assert.deepEqual(runsView({ runs: [], runsOmitted: 0, latestRun: null }).empty, 'no runs yet');
  assert.equal(runsView(null).empty, 'no runs yet');
  const bare = runsView({ runs: [{ run: R2, asOf: null, snapshotId: null, sealed: true, kind: 'market', artifacts: {}, marketRun: null, bytes: 12 }], runsOmitted: 0, latestRun: null });
  assert.equal(bare.empty, 'no sealed run with an artifact yet');
  assert.deepEqual(bare.rows, [{ run: R2, asOf: null, sealed: true, artifacts: [], bytes: 12 }]);
});

test('runsView: malformed wire rows are dropped, a bad omitted count reads 0', () => {
  const v = runsView({ runs: [null, 'x', { run: 7 }, { run: R1 }], runsOmitted: -1, latestRun: { run: 9 } });
  assert.deepEqual(v.rows, [{ run: R1, asOf: null, sealed: false, artifacts: [], bytes: null }]);
  assert.equal(v.omitted, 0); assert.equal(v.latest, null);
});
