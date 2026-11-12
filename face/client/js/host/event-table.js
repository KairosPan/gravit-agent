// face/client/js/host/event-table.js — an event analog view as the table the face draws (Task 7 renders it): its title and
// counts, the present case's anchors first, then each group in the view's order with its rows. Every figure is a labelled
// percentage — one decimal, its sign always (U+2212 for minus), the none word when there is none — against the market. A
// source is kept only when http(s), and reads unverified when it is not; a row links to the market page at its event only
// when it was measured and has a day 0. The texts are the view's as they came: the renderer escapes and masks them. Pure.
import { t } from '../i18n/words.js';

const str = v => (typeof v === 'string' ? v : null);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = v => (Array.isArray(v) ? v : []);
// a figure in tenths of a percent, so the sign and the tone agree with what is written
const tenths = x => Math.round(Math.abs(x) * 1000);

/** A fraction as a signed percentage, one decimal: −0.112 is "−11.2%", 0 "0.0%"; no figure is the none word. */
export function pct(x) {
  const v = num(x);
  if (v === null) return t('analog.none');
  const n = tenths(v);
  const sign = n === 0 ? '' : v > 0 ? '+' : '−';
  return `${sign}${(n / 10).toFixed(1)}%`;
}

/** The colour a figure takes: up above zero, down below, flat when it reads 0.0%, none with no figure. */
export function toneOf(x) {
  const v = num(x);
  if (v === null) return 'none';
  return tenths(v) === 0 ? 'flat' : v > 0 ? 'up' : 'down';
}

/** The market page at an event: the stock, its day 0, the view and the case it came from. */
export function marketHref(viewId, symbol, day0, caseId) {
  const e = encodeURIComponent;
  return `#/markets/stock:${e(symbol)}?at=${e(day0)}&view=${e(viewId)}&case=${e(caseId)}`;
}

// a source link the page may open: http(s) alone
const sourceOf = v => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null);

// each chip's label (read when drawn, in the table that stands) and the measure's field it shows
const DAY0 = [() => t('analog.chip.day0'), 'x0'];
const NEXT = [() => t('analog.chip.next'), 'x1'];
const D5 = [() => t('analog.chip.d5'), 'x5'];
const D60 = [() => t('analog.chip.d60'), 'x60'];
const CASE_CHIPS = [DAY0, D5, D60];
const ANCHOR_CHIPS = [DAY0, NEXT, D5, D60];

// one row: a case of a group, or an anchor of the present case (its symbol the query's)
function rowOf(viewId, c, symbol, chipsOf) {
  const id = str(c?.id) ?? '';
  const day0 = str(c?.day0);
  const date = str(c?.date);
  const source = sourceOf(c?.source);
  const measured = c?.state === 'measured' && c?.measure !== null && typeof c?.measure === 'object';
  const chips = measured ? chipsOf.map(([label, field]) => ({ label: label(), text: pct(c.measure[field]), tone: toneOf(c.measure[field]) })) : [];
  return {
    id, symbol, label: str(c?.label) ?? '', date, timing: str(c?.timing), day0,
    shifted: day0 !== null && date !== null && day0 !== date,
    note: str(c?.note), source,
    verified: source !== null && c?.verified === true,
    claimed: c?.claimed === true,
    flags: list(c?.flags).filter(f => typeof f === 'string'),
    measured, words: str(c?.words), chips,
    href: measured && day0 !== null && symbol !== '' && id !== '' ? marketHref(viewId, symbol, day0, id) : null,
  };
}

// a group's medians, when its summary gives any (a group under eight cases has none)
function summaryOf(s) {
  const x0 = num(s?.x0);
  const x60 = num(s?.x60);
  return x0 === null && x60 === null ? null : { x0, x60 };
}

/** The table of event view `viewId`. A view that is not one gives an empty table. */
export function eventTableOf(viewId, view) {
  const cases = list(view?.cases);
  const coverage = view?.coverage ?? {};
  const counts = {
    asked: num(coverage.asked) ?? cases.length,
    measured: num(coverage.measured) ?? cases.filter(c => c?.state === 'measured').length,
    unmeasured: Array.isArray(coverage.unmeasured) ? coverage.unmeasured.length : cases.filter(c => c?.state !== 'measured').length,
  };
  const query = view?.query;
  const anchors = list(query?.anchors);
  const present = anchors.length ? anchors.map(a => rowOf(viewId, a, str(query.symbol) ?? '', ANCHOR_CHIPS)) : null;
  // the view's named groups in its order, then any group a case names that the view did not (none for a case of no group)
  const named = list(view?.groups?.named).filter(g => typeof g?.name === 'string');
  const order = named.map(g => g.name);
  for (const c of cases) {
    const name = str(c?.group);
    if (!order.includes(name)) order.push(name);
  }
  const groups = order.map(name => {
    const rows = cases.filter(c => str(c?.group) === name).map(c => rowOf(viewId, c, str(c?.symbol) ?? '', CASE_CHIPS));
    return { name, count: rows.length, measured: rows.filter(r => r.measured).length, summary: summaryOf(named.find(g => g.name === name)?.summary), rows };
  });
  return { title: str(view?.title) ?? '', counts, present, groups };
}
