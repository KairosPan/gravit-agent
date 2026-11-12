// face/client/js/render/event-window.js — a stock's page at an event (spec 2026-11-12 §4.3, analog event table Task 9): above
// the price, a banner from the view — where the page came from, the case's group, date and timing, label, note and its three
// chips, a link back to Messages — and, in place of the price history, the range Around the event pressed before 1D…MAX and a card: the
// window's first and last dates, its daily candles marked (day 0, the symbol's other events in the view, +5 and +60 where those
// bars are), the case's line against the market (or a sentence when the view kept none), and a caption naming the bars' source,
// their adjustment and, for a window older than five years read from Nasdaq, that Nasdaq filled it. A view that is gone, or a
// case not in it, still draws the window and day 0 from `at`. Every text from the view is masked, then escaped.
import { esc } from '../html.js';
import { t, th, sayOf } from '../i18n/words.js';
import { maskExcerpt } from '../mask.js';
import { seg } from './controls.js';
import { eventCandlesSvg, eventRelSvg } from './chart.js';
import { chip, TIMING } from './event-table.js';
import { candleRanges } from '../host/market-view.js';
import { eventTableOf, pct, toneOf } from '../host/event-table.js';
import { EVENT_RANGE, eventWindowOf, marksOf, nyDay } from '../host/event-window.js';
import { VIEW_ID_RE } from '../host/analog.js';

const str = v => (typeof v === 'string' ? v : null);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = v => (Array.isArray(v) ? v : []);
// a text from the view: masked, then escaped
const text = v => esc(maskExcerpt(v ?? ''));
const note = line => { const words = sayOf(line); return words ? `<p class="mk-note">${esc(words)}</p>` : ''; };

// the +5 and +60 flags: each figure of the case's against the market, its label the table's chip's
const FLAGS = [[5, () => t('analog.chip.d5'), 'x5'], [60, () => t('analog.chip.d60'), 'x60']];
// the source whose bars fill a window older than Robinhood's five years
const NASDAQ = 'Nasdaq'; // en-kept: the provider's name

/** The event a stock's page is at, when the route is that page at one: its window's entry, and the view's case as the table
 *  models it (its row, its group) beside the case as it came (its measure and rel). Null for any other page. */
export function eventOf(state, id) {
  const route = state?.route;
  const event = route?.screen === 'markets' && route.id === id && typeof id === 'string' && id.startsWith('stock:') ? route.event : null;
  if (typeof event?.at !== 'string') return null;
  const viewId = str(event.view);
  const caseId = str(event.case);
  const entry = viewId !== null ? state.analog?.views?.[viewId] ?? null : null;
  const view = entry?.status === 'loaded' ? entry.view : null;
  const raw = view && caseId !== null ? [...list(view.query?.anchors), ...list(view.cases)].find(c => str(c?.id) === caseId) ?? null : null;
  let row = null;
  if (raw) {
    const table = eventTableOf(viewId, view);
    const rows = [...list(table.present).map(r => ({ row: r, group: null })), ...table.groups.flatMap(g => g.rows.map(r => ({ row: r, group: g.name })))];
    row = rows.find(r => r.row.id === caseId) ?? null;
  }
  const windows = state.markets?.event ?? {};
  const key = `${id}@${event.at}`;
  return { at: event.at, viewId, caseId, entry, view, raw, row, bars: Object.hasOwn(windows, key) ? windows[key] : null };
}

/** The banner above the price: where the page came from and the way back; the case from the view, or a line on the view. */
export function eventBannerHtml(ev) {
  const head = `<div class="ew-banner-head"><span class="ew-from">${th('markets.event.from')}</span><a class="ew-back" href="#/messages">${th('markets.event.back')}</a></div>`;
  let body = '';
  if (ev.row) {
    const { row, group } = ev.row;
    const timing = Object.hasOwn(TIMING, row.timing ?? '') ? `<span class="et-timing">${TIMING[row.timing]()}</span>` : '';
    body = `<div class="ew-banner-top">${group !== null ? `<span class="ew-group">${text(group)}</span>` : ''}` +
      `${row.date ? `<span class="et-date">${esc(row.date)}</span>` : ''}${timing}</div>` +
      `<div class="ew-label">${text(row.label)}</div>${row.note ? `<div class="et-note">${text(row.note)}</div>` : ''}` +
      `${row.chips.length ? `<div class="et-chips">${row.chips.map(chip).join('')}</div>` : ''}`;
  } else if (ev.viewId !== null) {
    const { entry } = ev;
    // a view= that is no view id (a hand-edited link) is never read: it is no longer kept, never Loading…
    const words = !VIEW_ID_RE.test(ev.viewId) ? th('markets.event.gone')
      : entry?.status === 'failed' && entry.gone !== true ? esc(sayOf(entry.error))
      : entry?.status === 'failed' || entry?.status === 'loaded' ? th('markets.event.gone') : th('analog.table.loading');
    body = `<p class="mk-note">${words}</p>`;
  }
  return `<div class="ew-banner">${head}${body}</div>`;
}

/** The range control at an event: Around the event, pressed, before the Account's ranges. */
export function eventRangesHtml(id) {
  return seg([[t('markets.event.range'), EVENT_RANGE], ...candleRanges()], EVENT_RANGE, 'setRange', { 'data-id': id });
}

// the window older than five years before today: Nasdaq's bars fill what Robinhood's five years do not reach
const olderThanFive = (ms, now) => { const d = new Date(now); d.setUTCFullYear(d.getUTCFullYear() - 5); return ms < d.getTime(); };

/** The event's card in place of the price history: Loading… until the window has answered, a failed read's words, no bar on
 *  the day; else the window's dates, its candles marked and flagged, the line against the market, and the caption. */
export function eventHistoryHtml(ev, now) {
  const card = inner => `<div class="ew-card">${inner}</div>`;
  const b = ev.bars;
  if (b?.status === 'error') return card(note(b.message || t('markets.event.failed')));
  if (b?.status !== 'ready') return card(note(t('common.loading')));
  const shown = eventWindowOf(b.data?.candles, ev.at);
  if (!shown) return card(note(t('markets.event.noDay', { date: ev.at })));
  const { bars, day0 } = shown;
  const marks = marksOf(ev.view, ev.caseId, shown).map(m => ({
    index: m.index, kind: m.kind, label: maskExcerpt(m.kind === 'day0' ? m.label : [m.group, m.label].filter(Boolean).join(' · ')), // words-order: the view's own texts, group then label
  }));
  const measure = ev.raw?.state === 'measured' && ev.raw.measure !== null && typeof ev.raw.measure === 'object' ? ev.raw.measure : null;
  const flags = measure ? FLAGS.filter(([n, , field]) => num(measure[field]) !== null && day0 + n < bars.length)
    .map(([n, label, field]) => ({ index: day0 + n, label: label(), text: pct(measure[field]), tone: toneOf(measure[field]) })) : [];
  const title = `<div class="ew-card-head">${th('markets.event.span', { first: nyDay(bars[0].t), last: nyDay(bars.at(-1).t) })}</div>`;
  const candles = eventCandlesSvg(bars, { day0, marks, flags, unit: 'usd' });
  let rel = '';
  if (ev.raw) {
    const line = eventRelSvg(ev.raw.rel, { day0, count: bars.length });
    rel = line ? `<div class="ew-rel-head">${th('markets.event.relHead')}</div>${line}` : `<p class="mk-note">${th('markets.event.noRel')}</p>`;
  }
  const source = str(b.data?.source);
  const filled = source?.startsWith(NASDAQ) && olderThanFive(bars[0].t, now) ? t('markets.event.filled', { source: NASDAQ }) : null;
  const caption = [source, str(b.data?.adjustment), filled].filter(w => w !== null && w.trim() !== '').join(' · '); // words-order: the bars' facts, a phrase each
  return card(`${title}${candles}${rel}${caption ? `<p class="mk-note ew-caption">${esc(caption)}</p>` : ''}`);
}
