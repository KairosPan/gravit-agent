// face/client/js/render/memory-health.js — the Memory screen's Health tab (memory screen plan Task 4), for a connected health
// read: the home; each ledger with its line count, its chain sound or broken at a line, and a partial last line named; the
// price source - its address as text and its last run in the package's own three cases (gravit-memory's status text): never
// asked; a last run that asked it nothing; else when it was last asked and whether it answered or how many it refused, of how
// many - or No price source is named, with where one is named; the face's seven facts with its definitions; and the commands,
// each in a code under At the terminal, in face/. Every text from the memory is made visible (visible.js) and then escaped;
// nothing is a link, a count that is not one is left out, and a class comes from the face's own tables alone.
import { esc } from '../html.js';
import { t, tn } from '../i18n/words.js';
import { fmtClock } from '../time.js';
import { shown, dim, command, dayOf } from './memory-lessons.js';

const str = v => (typeof v === 'string' ? v : '');
const count = v => (Number.isInteger(v) && v >= 0 ? v : null);
// a section under its head, the face's words
const section = (head, body) => `<section class="mp-section"><h2 class="mp-section-head">${esc(head)}</h2>${body}</section>`;

// each ledger once: those with a line count, then those with a chain or a partial line alone, in the order given
function ledgersHtml(read) {
  const lines = read.lines && typeof read.lines === 'object' ? read.lines : {};
  const chains = (Array.isArray(read.chains) ? read.chains : []).filter(c => c && typeof c.file === 'string');
  const partial = new Set((Array.isArray(read.partial) ? read.partial : []).filter(f => typeof f === 'string'));
  const files = [...new Set([...Object.keys(lines), ...chains.map(c => c.file), ...partial])];
  if (!files.length) return '';
  const rows = files.map(file => {
    const n = count(lines[file]);
    const chain = chains.find(c => c.file === file);
    const at = chain ? count(chain.line) : null;
    const chainHtml = !chain ? '' : chain.ok === true
      ? `<span class="chip ok">${esc(t('memory.health.sound'))}</span>`
      : `<span class="chip down">${esc(at !== null ? t('memory.health.brokenAt', { n: at }) : t('memory.health.broken'))}</span>`;
    return `<div class="mp-ledger"><code class="mp-fact">${shown(file)}</code>` +
      (n !== null ? `<span class="mp-counts">${esc(tn('memory.health.lines', n))}</span>` : '') + chainHtml +
      (partial.has(file) ? `<span class="chip warn">${esc(t('memory.health.partial'))}</span>` : '') + '</div>';
  });
  return section(t('memory.health.ledgers'), `<div class="mp-ledgers">${rows.join('')}</div>`);
}

// the last run of the price source, in the package's three cases: none, never asked; one that asked nothing (asked 0), when it
// ran; else when it was last asked and answered - a source set that refused nothing - or refused k, of n when asked is a count
// (a last run with no asked was written before asked was, and is read as a run that asked)
function lastRunOf(last, now) {
  if (!last) return t('memory.health.neverAsked');
  const at = Date.parse(str(last.t));
  const when = Number.isNaN(at) ? null : `${dayOf(at, now)} ${fmtClock(at)}`;
  const asked = count(last.asked);
  if (asked === 0) return [...(when ? [t('memory.health.lastRan', { when })] : []), t('memory.health.askedNothing')].join(' · '); // words-order: the run's facts under the visual separator
  const refused = count(last.refused);
  const outcome = last.ok === true ? t('memory.health.answered')
    : refused === null ? t('memory.health.refusedSome')
      : asked !== null ? t('memory.health.refusedOf', { n: refused, asked }) : t('memory.health.refused', { n: refused });
  return [...(when ? [t('memory.health.lastAsked', { when })] : []), outcome].join(' · '); // words-order: the run's facts under the visual separator
}

function pricesHtml(prices, now) {
  const url = str(prices?.url);
  if (url === '') return section(t('memory.health.prices'), dim(t('memory.health.noSource')));
  const last = prices.last && typeof prices.last === 'object' ? prices.last : null;
  return section(t('memory.health.prices'), `<code class="mp-fact">${shown(url)}</code><div class="mp-when">${esc(lastRunOf(last, now))}</div>`);
}

function factsHtml(facts) {
  const rows = (Array.isArray(facts) ? facts : []).filter(f => f && typeof f.fact === 'string')
    .map(f => `<li class="mp-check"><code class="mp-fact">${shown(f.fact)}</code><span class="mp-def">${shown(str(f.definition))}</span></li>`);
  return rows.length ? section(t('memory.health.facts'), `<ul class="mp-check-list">${rows.join('')}</ul>`) : '';
}

function commandsHtml(commands) {
  const lines = (Array.isArray(commands) ? commands : []).map(c => c?.line).filter(v => typeof v === 'string' && v !== '');
  return lines.length ? section(t('memory.lessons.terminal'), `<div class="mp-commands">${lines.map(command).join('')}</div>`) : '';
}

/** The Health tab's body for a connected health read: `read` its body, `page` the screen's slice, `now` the clock's time,
 *  against which a last run's day carries its year when it is another. */
export function healthHtml(read, page, now) {
  const r = read && typeof read === 'object' ? read : {};
  return `<div class="mp-body mp-health">${section(t('memory.health.home'), `<code class="mp-fact">${shown(str(r.home))}</code>`)}` +
    `${ledgersHtml(r)}${pricesHtml(r.prices, now)}${factsHtml(r.facts)}${commandsHtml(r.commands)}</div>`;
}
