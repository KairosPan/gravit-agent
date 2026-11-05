// gravit-ui/js/time.js — clocks, row times and the centred dividers (spec §5.2)
import { t, said, saidn } from './i18n/words.js';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
// the months' short names, read from the table at each call (never at import: the table can change)
const MONTHS = () => [t('time.month.jan'), t('time.month.feb'), t('time.month.mar'), t('time.month.apr'), t('time.month.may'), t('time.month.jun'),
  t('time.month.jul'), t('time.month.aug'), t('time.month.sep'), t('time.month.oct'), t('time.month.nov'), t('time.month.dec')];
const pad = n => String(n).padStart(2, '0');

export function fmtClock(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function sameDay(a, b) {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

export function dayLabel(ts, now) {
  if (sameDay(ts, now)) return t('time.today');
  if (sameDay(ts, now - DAY)) return t('time.yesterday');
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function rowTime(ts, now) {
  return sameDay(ts, now) ? fmtClock(ts) : dayLabel(ts, now);
}

export function divider(ts, prev, now) {
  if (prev != null && ts - prev < 15 * MIN) return null;
  if (prev == null || !sameDay(ts, prev)) return t('time.dayClock', { day: dayLabel(ts, now), clock: fmtClock(ts) });
  return fmtClock(ts);
}

export function fmtDate(ts) {
  const d = new Date(ts);
  return t('time.date', { month: MONTHS()[d.getMonth()], day: d.getDate() });
}

// a call's length as m:ss
export function fmtDuration(ms) {
  const secs = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(secs / 60)}:${pad(secs % 60)}`;
}

// a conversation's age, for the @ menu: a said (the menu keeps it while it is open), read by sayOf where it is drawn
export function ago(ts, now) {
  const d = Math.max(0, now - ts);
  if (d < MIN) return said('time.justNow');
  if (d < HOUR) return saidn('time.ago.minutes', Math.floor(d / MIN));
  if (d < DAY) return saidn('time.ago.hours', Math.floor(d / HOUR));
  return saidn('time.ago.days', Math.floor(d / DAY));
}
