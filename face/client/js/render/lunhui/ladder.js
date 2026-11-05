// face/client/js/render/lunhui/ladder.js — the limit-up ladder block: one row per rung, top down — the rung number (a button that
// picks it), the names that sealed it (first seal, breaks), a gap row where nothing got there, the misses and the breaks with
// today's change — and, at the right, how many of the rung below got through, as a number and a meter. The readout answers the
// picked rung (default: the focus Gravit gave, else the height). A name whose code the view's stocks hold is a stock link
// (block.js stockLink); any other is escaped text.
import { esc, attrs, cls } from '../../html.js';
import { label, headline, readout, count, signedPct, stockLink } from './block.js';
import { t, th } from '../../i18n/words.js';

const pctText = v => (v == null || !Number.isFinite(Number(v)) ? '—' : signedPct(Number(v)));
const nameOf = s => String(s?.name ?? s?.code ?? '—');
const withPct = s => `${nameOf(s)} ${pctText(s?.pct)}`;
const list = a => (Array.isArray(a) ? a : []);
const num = v => (v == null || !Number.isFinite(Number(v)) ? '—' : count(v));
const tone = v => { const r = Number(Number(v).toFixed(2)); return r > 0 ? 'up' : r < 0 ? 'down' : 'flat'; };

// a rung's name: a link when the view's stocks hold its code, else its name
const nameHtml = (s, view, key) => {
  const code = s?.code;
  const held = typeof code === 'string' && view?.stocks && typeof view.stocks === 'object' && Object.hasOwn(view.stocks, code);
  return held ? stockLink({ code, name: nameOf(s) }, key) : esc(nameOf(s));
};

function chip(s, view, key) {
  const breaks = Number(s?.breaks) > 0 ? ` <span class="lh-chip-note">${th('lunhui.ladder.brokeN', { n: Number(s.breaks) })}</span>` : '';
  const seal = s?.firstSeal ? ` <span class="lh-chip-note">${esc(s.firstSeal)}</span>` : '';
  return `<span class="lh-chip">${nameHtml(s, view, key)}${seal}${breaks}</span>`;
}
const named = (s, view, key) => `<span class="lh-lname">${nameHtml(s, view, key)} <span class="${cls('lh-lpct', tone(s?.pct))}">${esc(pctText(s?.pct))}</span></span>`;
const group = (word, stocks, view, key) => (stocks.length ? `<div class="lh-lgroup"><span class="lh-lword">${word}</span> ${stocks.map(s => named(s, view, key)).join(' ')}</div>` : '');

function right(r, tries) {
  const first = r.n === 1;
  const from = Number(r.from), promoted = Number(r.promoted);
  const done = first ? Number(tries?.sealed) : promoted, of = first ? Number(tries?.tries) : from;
  const words = first ? t('lunhui.ladder.firstTry', { done: num(done), of: num(of) }) : `${r.n - 1}→${r.n} ${num(done)}/${num(of)}`;
  const w = of > 0 && Number.isFinite(done) ? Math.round(done / of * 100) : 0;
  return `<div class="lh-rright"><span class="lh-rnum">${esc(words)}</span><span class="lh-meter" aria-hidden="true"><span class="lh-meter-fill" style="width:${w}%"></span></span></div>`;
}

function row(r, on, stress, id, tries, view, key) {
  const sealed = list(r.sealed), missed = list(r.missed), broke = list(r.broke);
  // rung 1 has no rung below it (from: null): its gap is a day with no first boards
  const gap = !r.gap ? '' : `<div class="lh-gap">${r.from == null ? th('lunhui.ladder.gapFirst') : th('lunhui.ladder.gap', { n: num(r.from) })}</div>`;
  const chips = sealed.length ? `<div class="lh-chips">${sealed.map(x => chip(x, view, key)).join(' ')}</div>` : '';
  const btn = `<button${attrs({ type: 'button', class: cls('lh-rung-n', on && 'pressed'), 'data-action': 'lunhuiUi', 'data-id': id, 'data-field': 'rung', 'data-value': String(r.n), 'aria-pressed': on ? 'true' : 'false', 'aria-label': t('lunhui.ladder.rungN', { n: r.n }) })}>${esc(r.n)}</button>`;
  return `<div class="${cls('lh-rung', stress && 'stress')}">${btn}<div class="lh-rbody">${chips}${gap}${group(th('lunhui.ladder.missed'), missed, view, key)}${group(th('lunhui.ladder.broke'), broke, view, key)}</div>${right(r, tries)}</div>`;
}

export function ladderHtml(view, block, ui, id, key) {
  const l = view.ladder;
  if (!l || typeof l !== 'object' || l.unavailable) {
    return `${label(t('lunhui.ladder.title'))}${headline(block)}<div class="lh-none">${th('lunhui.ladder.none')}</div>`;
  }
  const rungs = list(l.rungs);
  const asked = Number(ui?.rung);
  const focus = Number(block?.focus?.rung);
  const pickedN = Number.isInteger(asked) && ui?.rung != null ? asked : Number.isInteger(focus) && block?.focus?.rung != null ? focus : Number(l.height);
  const picked = rungs.find(r => r.n === pickedN);
  const higher = rungs.filter(r => r.n > 1).reduce((n, r) => n + list(r.sealed).length, 0);
  const sealedAll = (Number(l.firstTries?.sealed) || 0) + higher;
  const rows = rungs.map(r => row(r, r === picked, r.gap || r.n === focus, id, l.firstTries, view, key)).join('');
  let words = t('lunhui.ladder.noRung');
  if (picked?.n === 1) {
    words = t('lunhui.ladder.first', { sealed: num(l.firstTries?.sealed), tries: num(l.firstTries?.tries), broke: list(picked.broke).length });
  } else if (picked) {
    const missed = list(picked.missed), broke = list(picked.broke);
    words = t('lunhui.ladder.rung', {
      step: `${picked.n - 1}→${picked.n}`, promoted: num(picked.promoted), from: num(picked.from),
      missed: missed.length ? missed.map(withPct).join(', ') : t('lunhui.ladder.noneWord'), broke: broke.length ? broke.map(nameOf).join(', ') : t('lunhui.ladder.noneWord'),
    });
  }
  return `${label(t('lunhui.ladder.label', { height: l.height, sealed: count(sealedAll) }))}${headline(block)}<div class="lh-ladder">${rows}</div>${readout(words)}`;
}
