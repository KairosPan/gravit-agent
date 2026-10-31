// face/client/js/render/lunhui/ladder.js — the limit-up ladder block: one row per rung, top down — the rung number (a button that
// picks it), the names that sealed it (first seal, breaks), a gap row where nothing got there, the misses and the breaks with
// today's change — and, at the right, how many of the rung below got through, as a number and a meter. The readout answers the
// picked rung (default: the focus Gravit gave, else the height). Names are escaped text; stock links are plan 3's.
import { esc, attrs, cls } from '../../html.js';
import { label, headline, readout, count, signedPct } from './block.js';

const pctText = v => (v == null || !Number.isFinite(Number(v)) ? '—' : signedPct(Number(v)));
const nameOf = s => String(s?.name ?? s?.code ?? '—');
const withPct = s => `${nameOf(s)} ${pctText(s?.pct)}`;
const list = a => (Array.isArray(a) ? a : []);
const tone = v => { const r = Number(Number(v).toFixed(2)); return r > 0 ? 'up' : r < 0 ? 'down' : 'flat'; };

function chip(s) {
  const breaks = Number(s?.breaks) > 0 ? ` <span class="lh-chip-note">broke ${Number(s.breaks)}</span>` : '';
  const seal = s?.firstSeal ? ` <span class="lh-chip-note">${esc(s.firstSeal)}</span>` : '';
  return `<span class="lh-chip">${esc(nameOf(s))}${seal}${breaks}</span>`;
}
const named = s => `<span class="lh-lname">${esc(nameOf(s))} <span class="${cls('lh-lpct', tone(s?.pct))}">${esc(pctText(s?.pct))}</span></span>`;
const group = (word, stocks) => (stocks.length ? `<div class="lh-lgroup"><span class="lh-lword">${word}</span> ${stocks.map(named).join(' ')}</div>` : '');

function right(r, tries) {
  const first = r.n === 1;
  const from = Number(r.from), promoted = Number(r.promoted);
  const done = first ? Number(tries?.sealed) : promoted, of = first ? Number(tries?.tries) : from;
  const words = first ? `1st try ${done}/${of}` : `${r.n - 1}→${r.n} ${done}/${of}`;
  const w = of > 0 && Number.isFinite(done) ? Math.round(done / of * 100) : 0;
  return `<div class="lh-rright"><span class="lh-rnum">${esc(words)}</span><span class="lh-meter" aria-hidden="true"><span class="lh-meter-fill" style="width:${w}%"></span></span></div>`;
}

function row(r, on, stress, id, tries) {
  const sealed = list(r.sealed), missed = list(r.missed), broke = list(r.broke);
  const gap = r.gap ? `<div class="lh-gap">gap · none of ${esc(r.from)} sealed</div>` : '';
  const chips = sealed.length ? `<div class="lh-chips">${sealed.map(chip).join(' ')}</div>` : '';
  const btn = `<button${attrs({ type: 'button', class: cls('lh-rung-n', on && 'pressed'), 'data-action': 'lunhuiUi', 'data-id': id, 'data-field': 'rung', 'data-value': String(r.n), 'aria-pressed': on ? 'true' : 'false', 'aria-label': `Rung ${r.n}` })}>${esc(r.n)}</button>`;
  return `<div class="${cls('lh-rung', stress && 'stress')}">${btn}<div class="lh-rbody">${chips}${gap}${group('missed', missed)}${group('broke', broke)}</div>${right(r, tries)}</div>`;
}

export function ladderHtml(view, block, ui, id) {
  const l = view.ladder;
  if (!l || typeof l !== 'object' || l.unavailable) {
    return `${label('Limit-up ladder')}${headline(block)}<div class="lh-none">The ladder was not frozen for this run.</div>`;
  }
  const rungs = list(l.rungs);
  const asked = Number(ui?.rung);
  const focus = Number(block?.focus?.rung);
  const pickedN = Number.isInteger(asked) && ui?.rung != null ? asked : Number.isInteger(focus) && block?.focus?.rung != null ? focus : Number(l.height);
  const picked = rungs.find(r => r.n === pickedN);
  const higher = rungs.filter(r => r.n > 1).reduce((n, r) => n + list(r.sealed).length, 0);
  const sealedAll = (Number(l.firstTries?.sealed) || 0) + higher;
  const rows = rungs.map(r => row(r, r === picked, r.gap || r.n === focus, id, l.firstTries)).join('');
  let words = 'No such rung on the ladder';
  if (picked?.n === 1) {
    words = `First boards · ${l.firstTries?.sealed} of ${l.firstTries?.tries} tries sealed · ${list(picked.broke).length} broke`;
  } else if (picked) {
    const missed = list(picked.missed), broke = list(picked.broke);
    words = `${picked.n - 1}→${picked.n} · ${picked.promoted} of ${picked.from} · missed: ${missed.length ? missed.map(withPct).join(', ') : 'none'} · broke: ${broke.length ? broke.map(nameOf).join(', ') : 'none'}`;
  }
  return `${label(`Limit-up ladder · height ${l.height} · ${count(sealedAll)} sealed`)}${headline(block)}<div class="lh-ladder">${rows}</div>${readout(words)}`;
}
