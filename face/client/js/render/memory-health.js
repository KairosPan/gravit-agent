// face/client/js/render/memory-health.js — the Memory screen's Health tab (memory screen plan Task 4), for a connected health
// read: the home; each ledger with its line count, its chain sound or broken at a line, and a partial last line named; the
// price source - its address as text, when it last ran, whether it answered and how many it refused - or No price source is
// named; the face's seven facts with its definitions; and the commands, each in a code under At the terminal. Every text from
// the memory is made visible (visible.js) and then escaped; nothing is a link, and a class comes from the face's own tables
// alone.
import { esc } from '../html.js';
import { t, tn } from '../i18n/words.js';
import { fmtDate, fmtClock } from '../time.js';
import { shown, dim, command } from './memory-lessons.js';

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

function pricesHtml(prices) {
  const url = str(prices?.url);
  if (url === '') return section(t('memory.health.prices'), dim(t('memory.health.noSource')));
  const last = prices.last && typeof prices.last === 'object' ? prices.last : null;
  let run = t('memory.health.notYet');
  if (last) {
    const at = Date.parse(str(last.t));
    const refused = count(last.refused) ?? 0;
    const asked = count(last.asked);
    const parts = [
      ...(Number.isNaN(at) ? [] : [t('memory.health.lastRan', { when: `${fmtDate(at)} ${fmtClock(at)}` })]),
      last.ok === true ? t('memory.health.answered') : t('memory.health.notAnswered'),
      asked !== null ? t('memory.health.refusedOf', { n: refused, asked }) : t('memory.health.refused', { n: refused }),
    ];
    run = parts.join(' · ');
  }
  return section(t('memory.health.prices'), `<code class="mp-fact">${shown(url)}</code><div class="mp-when">${esc(run)}</div>`);
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
 *  which a last run's time does not need. */
export function healthHtml(read, page, now) {
  const r = read && typeof read === 'object' ? read : {};
  return `<div class="mp-body mp-health">${section(t('memory.health.home'), `<code class="mp-fact">${shown(str(r.home))}</code>`)}` +
    `${ledgersHtml(r)}${pricesHtml(r.prices)}${factsHtml(r.facts)}${commandsHtml(r.commands)}</div>`;
}
