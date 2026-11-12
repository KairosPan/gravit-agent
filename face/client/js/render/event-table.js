// face/client/js/render/event-table.js — an event analog view drawn as its table (spec 2026-11-12 §4.2): under a task's report
// line in Messages and at the top of the task's page. One card: the head (the title, the counts, every figure against the
// market), the present case first, then each group in the view's order with its rows; under the card, always, the caveats.
// A measured row carries its labelled chips and its link to the market page at its event; an unmeasured one is muted, with the
// market's words as they came. Every text from the view is escaped and masked as a worker's words. A view still being read
// is one line, a failed read its words, a view the face no longer keeps one line saying so and nothing else.
import { esc, cls } from '../html.js';
import { t, th, thn, sayOf } from '../i18n/words.js';
import { maskExcerpt } from '../mask.js';
import { eventTableOf, pct, toneOf } from '../host/event-table.js';

// a text from the view: masked, then escaped
const text = v => esc(maskExcerpt(v ?? ''));

export const TIMING = {
  pre: () => th('analog.timing.pre'),
  open: () => th('analog.timing.open'),
  post: () => th('analog.timing.post'),
  closed: () => th('analog.timing.closed'),
};
const FLAG = {
  quiet: () => th('analog.row.quiet'),
  elsewhere: () => th('analog.row.elsewhere'),
};

export const chip = ({ label, text: value, tone }) =>
  `<span class="${cls('et-chip', tone)}"><span class="et-chip-label">${esc(label)}</span>${esc(value)}</span>`;

// the badge: verified with its source; without a source, unverified; with one not verified, its date unverified
const badge = row => (row.verified ? `<span class="et-badge ok">${th('analog.row.verified')}</span>`
  : `<span class="et-badge warn">${row.source === null ? th('analog.row.unverified') : th('analog.row.dateUnverified')}</span>`);

function rowHtml(row) {
  const timing = Object.hasOwn(TIMING, row.timing ?? '') ? `<span class="et-timing">${TIMING[row.timing]()}</span>` : '';
  const top = `<div class="et-row-top"><span class="et-label">${text(row.label)}</span>` +
    (row.date ? `<span class="et-date">${esc(row.date)}</span>` : '') + timing +
    (row.shifted ? `<span class="et-shift">${th('analog.row.shifted', { date: row.day0.slice(5) })}</span>` : '') + `${badge(row)}</div>`;
  const note = row.note ? `<div class="et-note">${text(row.note)}</div>` : '';
  const flags = row.flags.filter(f => Object.hasOwn(FLAG, f)).map(f => `<span class="et-flag">${FLAG[f]()}</span>`).join('');
  const body = row.measured ? `<div class="et-chips">${row.chips.map(chip).join('')}${flags}</div>` : `<div class="et-words">${text(row.words)}</div>`;
  const links = (row.source !== null ? `<a class="et-src" href="${esc(row.source)}" target="_blank" rel="noopener noreferrer">${th('analog.row.source')}</a>` : '') +
    (row.href !== null ? `<a class="et-market" href="${esc(row.href)}">${th('analog.row.market')}</a>` : '');
  return `<div class="${cls('et-row', !row.measured && 'unmeasured')}">${top}${note}${body}${links ? `<div class="et-links">${links}</div>` : ''}</div>`;
}

function groupHtml(group) {
  const name = group.name === null ? th('analog.table.ungrouped') : text(group.name);
  const head = `<div class="et-group-head"><span class="et-group-name">${name}</span><span class="et-group-count">${thn('analog.table.group', group.count, { measured: group.measured })}</span></div>`;
  const s = group.summary;
  const summary = s
    ? `<div class="et-median"><span class="et-median-label">${th('analog.table.median')}</span>${chip({ label: t('analog.chip.day0'), text: pct(s.x0), tone: toneOf(s.x0) })}${chip({ label: t('analog.chip.d60'), text: pct(s.x60), tone: toneOf(s.x60) })}</div>`
    : `<div class="et-few">${th('analog.table.few')}</div>`;
  return `<div class="et-group">${head}${summary}${group.rows.map(rowHtml).join('')}</div>`;
}

/** The table of the view `viewId` as its analog entry stands: loading, failed (its words, or gone: one line), or loaded. */
export function eventTableHtml(entry, viewId) {
  if (entry?.status === 'failed') {
    return entry.gone === true ? `<div class="et-state">${th('analog.table.gone')}</div>` : `<div class="et-state et-failed">${esc(sayOf(entry.error))}</div>`;
  }
  if (entry?.status !== 'loaded') return `<div class="et-state">${th('analog.table.loading')}</div>`;
  const table = eventTableOf(viewId, entry.view);
  const { asked, measured, unmeasured } = table.counts;
  const head = `<div class="et-head"><div class="et-title">${text(table.title)}</div>` +
    `<div class="et-counts">${thn('analog.table.counts', asked, { measured, unmeasured })}</div><div class="et-basis">${th('analog.table.basis')}</div></div>`;
  const present = table.present
    ? `<div class="et-present"><div class="et-group-head"><span class="et-group-name">${th('analog.table.present', { symbol: maskExcerpt(table.present[0]?.symbol ?? '') })}</span></div>${table.present.map(rowHtml).join('')}</div>`
    : '';
  return `<section class="et"><div class="et-card">${head}${present}${table.groups.map(groupHtml).join('')}</div><div class="et-caveats">${th('analog.table.caveats')}</div></section>`;
}

/** The tables of `viewIds` in order, read from the analog slice; none draws nothing. */
export function eventTablesHtml(state, viewIds) {
  if (!viewIds.length) return '';
  const views = state?.analog?.views ?? {};
  return `<div class="et-list">${viewIds.map(id => eventTableHtml(views[id], id)).join('')}</div>`;
}
