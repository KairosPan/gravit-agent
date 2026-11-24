// face/client/js/host/event-table.js — an event analog view as the table the face draws (Task 7 renders it): its title and
// counts, the present case's anchors first, then each group in the view's order with its rows. Every figure is a labelled
// percentage — one decimal, its sign always (U+2212 for minus), the none word when there is none. A source is kept only when
// http(s), and reads unverified when it is not; a row links to the market page at its event only when it was measured and
// has a day 0. The texts are the view's as they came: the renderer escapes and masks them. Pure.
// A version 1 view is against the market (SPY) at fixed chips. A version 2 view (event analog redesign §4.5) says its base
// and its benchmark in the head, has one chip per horizon it was measured at (each change against the benchmark, or raw
// when the benchmark was not read), and a row its price, its split and whether its day 0 was a listing or skipped sessions.
import { t, tn } from '../i18n/words.js';

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

/** The market page at an event: the stock, its day 0, the view and the case it came from; `after`, the sessions it shows
 *  after day 0, named only past the 60 it shows anyway. */
export function marketHref(viewId, symbol, day0, caseId, after = 60) {
  const e = encodeURIComponent;
  const more = Number.isInteger(after) && after > 60 ? `&after=${after}` : '';
  return `#/markets/stock:${e(symbol)}?at=${e(day0)}&view=${e(viewId)}&case=${e(caseId)}${more}`;
}

/** A split factor as the server writes it (price-tie.mjs factorWords): a whole number as written, else three significant
 *  digits; no figure is null. */
export function factorText(f) {
  const v = num(f);
  if (v === null) return null;
  const r = Math.round(v);
  if (r !== 0 && Math.abs(v - r) < 1e-6) return String(r);
  return String(Number(v.toPrecision(3)));
}

/** A change's figure under the view's `against` (event-summary.mjs valueOf): against the benchmark, or raw without one. */
export const valueOf = (change, against) => num(against === 'raw' ? change?.r : change?.x);

// a source link the page may open: http(s) alone
const sourceOf = v => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null);

// each chip's label (read when drawn, in the table that stands) and the measure's field it shows
const DAY0 = [() => t('analog.chip.day0'), 'x0'];
const NEXT = [() => t('analog.chip.next'), 'x1'];
const D5 = [() => t('analog.chip.d5'), 'x5'];
const D60 = [() => t('analog.chip.d60'), 'x60'];
const CASE_CHIPS = [DAY0, D5, D60];
const ANCHOR_CHIPS = [DAY0, NEXT, D5, D60];

/** A version 2 chip's label: Day 0, the next day, then N days. */
export const horizonLabel = k => (k === 0 ? t('analog.chip.day0') : k === 1 ? t('analog.chip.next') : tn('analog.chip.days', k));

// a version 1 measure's chips: the fixed labels, each over its field
const fixedChips = chipsOf => measure => chipsOf.map(([label, field]) => ({ label: label(), text: pct(measure[field]), tone: toneOf(measure[field]) }));
// a version 2 measure's chips: one per change, its horizon's label, its figure under the view's `against`
const horizonChips = against => measure => list(measure.changes).filter(ch => Number.isInteger(ch?.k)).map(ch => {
  const v = valueOf(ch, against);
  return { label: horizonLabel(ch.k), text: pct(v), tone: toneOf(v) };
});

// a version 2 row's split: its factor as written, its record's page (http(s) alone) and whether a reader opened it; none
// when no split in the record is after day 0 (the scan stores none then; a view stored before it did may hold one)
function splitOf(s, day0) {
  if (s === null || typeof s !== 'object') return null;
  const dates = list(s.list).map(x => str(x?.date)).filter(d => d !== null);
  if (day0 !== null && dates.length > 0 && dates.every(d => d <= day0)) return null;
  const factor = factorText(s.factor);
  if (factor === null) return null;
  const source = sourceOf(s.source);
  return { factor, source, verified: source !== null && s.verified === true };
}

// one row: a case of a group, or an anchor of the present case (its symbol the query's). `drawn`: how its measure becomes
// chips, how far after day 0 its link opens the market and, under a benchmark read, the benchmark and the raw chips a case
// with no figure against it at any horizon (its dates older than the benchmark's bars) shows instead of a row of none.
// `raw`: that benchmark, when the row shows raw chips; `noVolume`: a measured row whose tape check did not run, not a listing
function rowOf(viewId, c, symbol, { chips: chipsOf, after = 60, benchmark = null, rawChips = null }) {
  const id = str(c?.id) ?? '';
  const day0 = str(c?.day0);
  const date = str(c?.date);
  const source = sourceOf(c?.source);
  const measured = c?.state === 'measured' && c?.measure !== null && typeof c?.measure === 'object';
  const changes = measured ? list(c.measure.changes).filter(ch => Number.isInteger(ch?.k)) : [];
  // raw only when some horizon has a raw change to show: with every horizon still ahead, the row stays as it is
  const raw = rawChips !== null && changes.some(ch => valueOf(ch, 'raw') !== null) && changes.every(ch => valueOf(ch, 'benchmark') === null);
  const chips = !measured ? [] : raw ? rawChips(c.measure) : chipsOf(c.measure);
  const price = num(c?.price);
  const skipped = num(c?.skipped);
  return {
    id, symbol, label: str(c?.label) ?? '', date, timing: str(c?.timing), day0,
    shifted: day0 !== null && date !== null && day0 !== date,
    note: str(c?.note), source,
    verified: source !== null && c?.verified === true,
    claimed: c?.claimed === true,
    flags: list(c?.flags).filter(f => typeof f === 'string'),
    measured, words: str(c?.words), chips,
    href: measured && day0 !== null && symbol !== '' && id !== '' ? marketHref(viewId, symbol, day0, id, after) : null,
    price: price === null ? null : price.toFixed(2),
    split: splitOf(c?.splits, day0),
    listed: c?.listed === true,
    raw: raw ? benchmark : null,
    noVolume: measured && c?.tapeRan === false && c?.listed !== true,
    skipped: skipped !== null && skipped > 0 ? skipped : 0,
  };
}

// a group's medians, when its summary gives any (a group under eight cases has none): version 1's at day 0 and 60
function summaryOf(s) {
  const x0 = num(s?.x0);
  const x60 = num(s?.x60);
  return x0 === null && x60 === null ? null : { x0, x60 };
}

// version 2's: at its first and its last horizon, each labelled
function summaryAtOf(s) {
  const at = list(s?.at).filter(a => Number.isInteger(a?.k));
  if (!at.length) return null;
  const ends = at.length === 1 ? [at[0]] : [at[0], at[at.length - 1]];
  if (ends.every(a => num(a.median) === null)) return null;
  return ends.map(a => ({ label: horizonLabel(a.k), value: num(a.median) }));
}

// the base's words, one function per base the view may name; under no benchmark, day 0's open names no benchmark's open
const BASIS = {
  prior_close: () => t('analog.basis.priorClose'),
  price: () => t('analog.basis.price'),
  day0_open: benchmark => (benchmark === null ? t('analog.basis.day0OpenAlone') : t('analog.basis.day0Open')),
  day0_close: () => t('analog.basis.day0Close'),
};

// a version 2 view's basis: its base, its benchmark, what its figures are against, and the head's line that says so
// (`line`, not `words`: a row's `words` are the market's, and a words call's result is never named so — words-table.test.js)
function basisOf(view) {
  const p = view?.parameters ?? {};
  const base = Object.hasOwn(BASIS, p.base ?? '') ? p.base : 'prior_close';
  const benchmark = str(p.benchmark);
  const against = p.against === 'benchmark' && benchmark !== null ? 'benchmark' : 'raw';
  const vs = against === 'benchmark' ? t('analog.against.benchmark', { symbol: benchmark })
    : benchmark === null ? t('analog.against.none')
    : t('analog.against.unread', { symbol: benchmark });
  return { base, benchmark, against, line: t('analog.table.basis2', { basis: BASIS[base](benchmark), against: vs }) };
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
  const v2 = view?.version === 2;
  const basis = v2 ? basisOf(view) : null;
  const last = v2 ? list(view.parameters?.horizons).filter(Number.isInteger).at(-1) ?? 0 : 0;
  const drawn = chipsOf => (v2 ? {
    chips: horizonChips(basis.against), after: Math.max(60, last), benchmark: basis.benchmark,
    rawChips: basis.against === 'benchmark' ? horizonChips('raw') : null,
  } : { chips: fixedChips(chipsOf) });
  const query = view?.query;
  const anchors = list(query?.anchors);
  const present = anchors.length ? anchors.map(a => rowOf(viewId, a, str(query.symbol) ?? '', drawn(ANCHOR_CHIPS))) : null;
  // the view's named groups in its order, then any group a case names that the view did not (none for a case of no group)
  const named = list(view?.groups?.named).filter(g => typeof g?.name === 'string');
  const order = named.map(g => g.name);
  for (const c of cases) {
    const name = str(c?.group);
    if (!order.includes(name)) order.push(name);
  }
  const groups = order.map(name => {
    const rows = cases.filter(c => str(c?.group) === name).map(c => rowOf(viewId, c, str(c?.symbol) ?? '', drawn(CASE_CHIPS)));
    const s = named.find(g => g.name === name)?.summary;
    return { name, count: rows.length, measured: rows.filter(r => r.measured).length, summary: v2 ? summaryAtOf(s) : summaryOf(s), rows };
  });
  return { title: str(view?.title) ?? '', counts, basis, present, groups };
}
