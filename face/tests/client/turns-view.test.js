// The turn rail's and the stats' pure view (host/turns-view.js): the rail's ticks, the active turn, the figures, the pills.
import test from 'node:test';
import assert from 'node:assert/strict';
import { railView, activeTurn, statsView, pillsText, compactTokens, durationText, clockText } from '../../client/js/host/turns-view.js';
import { withTable } from '../../client/js/i18n/words.js';

const entry = (turn, seq) => ({ turn, seq, prompt: `p${turn}`, response: `r${turn}` });
const stats = (over = {}) => ({ turns: 7, steps: 41, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0, ...over });

test('the rail shows from two turns, on a loaded conversation only', () => {
  assert.equal(railView(null).show, false);
  assert.deepEqual(railView({ loaded: true }), { show: false, ticks: [] });
  assert.equal(railView({ loaded: true, outline: [entry(1, 1)] }).show, false);
  assert.equal(railView({ loaded: true, outline: [entry(1, 1), entry(2, 8)] }).show, true);
  assert.equal(railView({ loaded: false, outline: [entry(1, 1), entry(2, 8)] }).show, false);
  assert.equal(railView({ loaded: true, outline: 'x' }).show, false);
});

test('a tick is loaded at or after the window\'s start, every tick when nothing is earlier', () => {
  const outline = [entry(1, 1), entry(2, 40), entry(3, 90)];
  const paged = railView({ loaded: true, outline, window: { start: 40, through: 120, hasMore: true } });
  assert.deepEqual(paged.ticks, [
    { turn: 1, seq: 1, loaded: false, prompt: 'p1', response: 'r1' },
    { turn: 2, seq: 40, loaded: true, prompt: 'p2', response: 'r2' },
    { turn: 3, seq: 90, loaded: true, prompt: 'p3', response: 'r3' },
  ]);
  const whole = railView({ loaded: true, outline, window: { start: 40, through: 120, hasMore: false } });
  assert.deepEqual(whole.ticks.map(t => t.loaded), [true, true, true]);
  assert.deepEqual(railView({ loaded: true, outline }).ticks.map(t => t.loaded), [true, true, true]);
});

test('the active turn is the last mark at or above the view\'s top, the first above them all', () => {
  const marks = [{ turn: 1, top: 0 }, { turn: 2, top: 400 }, { turn: 3, top: 900 }];
  assert.equal(activeTurn(marks, 0), 1);
  assert.equal(activeTurn(marks, 391), 1);
  assert.equal(activeTurn(marks, 392), 2);
  assert.equal(activeTurn(marks, 5000), 3);
  assert.equal(activeTurn([{ turn: 4, top: 300 }, { turn: 5, top: 700 }], 0), 4);
  assert.equal(activeTurn([], 100), null);
  assert.equal(activeTurn(undefined, 100), null);
});

test('no stats until the first step has finished', () => {
  assert.equal(statsView(null, null), null);
  assert.equal(statsView(undefined, { outputTokens: 4 }), null);
  assert.equal(statsView(stats({ turns: 0, steps: 0 }), { outputTokens: 4 }), null);
  assert.notEqual(statsView(stats({ turns: 1, steps: 1 }), null), null);
});

test('the figures: 38 tok/s, cache 63%, first token the average, no speed without decode time', () => {
  const v = statsView(stats({ llmMs: 252_000, toolMs: 42_000, ttftMs: 5_600, ttftSteps: 4, decodeMs: 10_000, decodeTokens: 384 }),
    { uncachedInputTokens: 60_000, cacheReadTokens: 102_000, outputTokens: 20_400 });
  assert.deepEqual(v, { turns: 7, steps: 41, speed: 38, tokens: 182_400, cache: 102_000 / 162_000, modelMs: 252_000, toolMs: 42_000, firstTokenMs: 1_400 });
  assert.equal(Math.round(v.cache * 100), 63);
  const bare = statsView(stats(), {});
  assert.equal(bare.speed, null);
  assert.equal(bare.firstTokenMs, null);
  assert.equal(bare.cache, null);
  assert.equal(bare.tokens, 0);
  assert.equal(bare.modelMs, null);
  assert.equal(bare.toolMs, null);
  // steps timed but no first token measured (ttftMs 0): no 0.0 s figure
  assert.equal(statsView(stats({ ttftMs: 0, ttftSteps: 3 }), {}).firstTokenMs, null);
  assert.equal(statsView(stats(), null).tokens, null);
});

test('the pills read singular and plural, and drop a part with no figure', () => {
  const v = statsView(stats({ decodeMs: 10_000, decodeTokens: 384 }), { uncachedInputTokens: 60_000, cacheReadTokens: 102_000, outputTokens: 20_400 });
  assert.deepEqual(pillsText(v), ['7 turns · 41 steps · 38 tok/s', '182k tokens · cache 63%']);
  assert.deepEqual(pillsText(statsView(stats({ turns: 1, steps: 1 }), { outputTokens: 900 })), ['1 turn · 1 step', '900 tokens']);
  assert.deepEqual(pillsText(statsView(stats({ turns: 1, steps: 1 }), null)), ['1 turn · 1 step', '']);
});

test('tokens, durations and clocks read as the constraints write them', () => {
  assert.equal(compactTokens(0), '0');
  assert.equal(compactTokens(999), '999');
  assert.equal(compactTokens(4210), '4.2k');
  assert.equal(compactTokens(182_400), '182k');
  assert.equal(compactTokens(1_250_000), '1.3M');
  assert.equal(compactTokens(9_960), '10k');
  assert.equal(compactTokens(9_999), '10k');
  assert.equal(compactTokens(10_000), '10k');
  assert.equal(compactTokens(999_499), '999k');
  assert.equal(compactTokens(999_500), '1.0M');
  assert.equal(compactTokens(999_999), '1.0M');
  assert.equal(compactTokens(1_000_000), '1.0M');
  assert.equal(durationText(9_940), '9.9 s');
  assert.equal(durationText(9_950), '10 s');
  assert.equal(durationText(9_999), '10 s');
  assert.equal(durationText(10_000), '10 s');
  assert.equal(durationText(1400), '1.4 s');
  assert.equal(durationText(42_000), '42 s');
  assert.equal(durationText(252_000), '4m 12s');
  assert.equal(durationText(3_840_000), '1h 04m');
  assert.equal(clockText(42_000), '42s');
  assert.equal(clockText(184_000), '3m 04s');
  assert.equal(clockText(3_840_000), '1h 04m');
});

test("a duration's and a clock's units are the table's", () => {
  withTable({ 'time.duration.seconds': '{n}秒', 'time.duration.minutes': '{m}分{s}秒', 'time.duration.hours': '{h}时{m}分', 'time.clock.seconds': '{n}秒' }, () => {
    assert.deepEqual([durationText(1400), durationText(42_000), durationText(252_000), durationText(3_840_000)], ['1.4秒', '42秒', '4分12秒', '1时04分']);
    assert.deepEqual([clockText(42_000), clockText(184_000), clockText(3_840_000)], ['42秒', '3分04秒', '1时04分']);
  });
});
