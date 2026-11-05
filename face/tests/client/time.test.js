// gravit-ui/tests/time.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN, HOUR, DAY, fmtClock, rowTime, divider, fmtDate, sameDay } from '../../client/js/time.js';
import { withTable } from '../../client/js/i18n/words.js';

const NOW = new Date(2026, 9, 9, 14, 7).getTime(); // Oct 9 2026 14:07 local

test('fmtClock is zero-padded 24h', () => {
  assert.equal(fmtClock(new Date(2026, 9, 9, 9, 5).getTime()), '09:05');
  assert.equal(fmtClock(NOW), '14:07');
});

test('rowTime is the clock today, Yesterday for yesterday, M/D before', () => {
  assert.equal(rowTime(NOW - 6 * MIN, NOW), '14:01');
  assert.equal(rowTime(NOW - DAY, NOW), 'Yesterday');
  assert.equal(rowTime(NOW - 3 * DAY, NOW), '10/6');
});

test('divider: first of the day carries the day, later ones the clock, none inside 15 minutes', () => {
  const first = NOW - 6 * MIN;
  assert.equal(divider(first, null, NOW), 'Today 14:01');
  assert.equal(divider(first + 3 * MIN, first, NOW), null);
  assert.equal(divider(first + 20 * MIN, first, NOW), '14:21');
  assert.equal(divider(NOW - DAY, null, NOW), 'Yesterday 14:07');
  assert.equal(divider(NOW, NOW - DAY, NOW), 'Today 14:07');
  assert.equal(sameDay(NOW, NOW - DAY), false);
});

test('fmtDate is Mon D', () => {
  assert.equal(fmtDate(NOW), 'Oct 9');
  assert.equal(fmtDate(NOW + 6 * DAY), 'Oct 15');
});

test('an hour is sixty minutes', () => {
  assert.equal(HOUR, 60 * MIN);
});

test('ago reads just now, minutes, hours and days, one of each in the singular', async () => {
  const { ago } = await import('../../client/js/time.js');
  assert.equal(ago(NOW - 20_000, NOW), 'Just now');
  assert.equal(ago(NOW + 5_000, NOW), 'Just now');
  assert.equal(ago(NOW - MIN, NOW), '1 minute ago');
  assert.equal(ago(NOW - 5 * MIN, NOW), '5 minutes ago');
  assert.equal(ago(NOW - HOUR, NOW), '1 hour ago');
  assert.equal(ago(NOW - 3 * HOUR, NOW), '3 hours ago');
  assert.equal(ago(NOW - DAY, NOW), '1 day ago');
  assert.equal(ago(NOW - 4 * DAY, NOW), '4 days ago');
});

test("a date and a divider's day and clock are in the table's order", () => {
  withTable({ 'time.date': '{day} {month}' }, () => assert.equal(fmtDate(NOW), '9 Oct'));
  withTable({ 'time.dayClock': '{clock}, {day}' }, () => assert.equal(divider(NOW - DAY, null, NOW), '14:07, Yesterday'));
});
