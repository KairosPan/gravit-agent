// face/client/js/render/lunhui/block.js — the anatomy every composed-answer block shares (spec §5.3): the face's label, small
// and grey, then Gravit's headline (block.title, escaped as written), then the readout line that answers the control.
import { esc, attrs, cls } from '../../html.js';

export const label = words => `<div class="lh-label">${esc(words)}</div>`;
export const headline = block => (typeof block?.title === 'string' && block.title !== '' ? `<div class="lh-title">${esc(block.title)}</div>` : '');
export const readout = words => `<div class="lh-readout" role="status" aria-live="polite">${esc(words)}</div>`;
// a state's pill tone: strength green, weakness red, a module that could not judge in the stress colour, the rest grey
const TONE = { STRONG: 'up', EXPANDING: 'up', RELAY: 'up', WEAK: 'down', CONTRACTING: 'down', NOT_EVALUABLE: 'warn' };
export const pill = state => `<span class="${cls('chip', TONE[state] ?? 'grey')}">${esc(state ?? '—')}</span>`;
export const count = n => Number(n).toLocaleString('en-US');
// an amount in yuan, in plan 1's digest grammar (lib/view.mjs turnoverText) so every amount the face draws reads like the
// number Gravit quotes: X.XX万亿 from 1e12, X.XX亿 from 1e8, else whole yuan
export function yuan(v) {
  const n = Number(v);
  if (v == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e12) return `¥${(n / 1e12).toFixed(2)}万亿`;
  if (Math.abs(n) >= 1e8) return `¥${(n / 1e8).toFixed(2)}亿`;
  return `¥${Math.round(n)}`;
}
export const fix2 = v => Number(v).toFixed(2);
// the digest's grammar: "−" for a negative, "+" on a positive percentage, "0.00%" for none (never a negative zero)
export const signedPct = v => { const s = Math.abs(v).toFixed(2); return s === '0.00' ? '0.00%' : v < 0 ? `−${s}%` : `+${s}%`; };

// a stock's name as a link to the stock drawer (plan 3, task 2): the opening answer's view key and the code, every value
// escaped; a stock with no code is its name alone
export function stockLink(stock, key) {
  const name = esc(stock?.name ?? stock?.code ?? '');
  const code = stock?.code;
  if (code == null || code === '') return name;
  return `<button${attrs({ type: 'button', class: 'lh-stock', 'data-action': 'lunhuiStock', 'data-key': key ?? '', 'data-code': String(code) })}>${name}</button>`;
}

// the pool names (view.stocks, by code) a run's text can link: two characters or more, escaped as the page holds them,
// longest first so 上海九百 wins over 九百
function poolNames(view) {
  const stocks = view?.stocks && typeof view.stocks === 'object' ? view.stocks : {};
  return Object.entries(stocks)
    .map(([code, s]) => ({ code, name: typeof s?.name === 'string' ? s.name : '' }))
    .filter(s => s.name.length >= 2)
    .map(s => ({ ...s, html: esc(s.name) }))
    .sort((a, b) => b.html.length - a.html.length);
}

const ENTITY = /^&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;
// one text segment: at each place the longest name that starts there becomes its link; an entity is never split
function linkText(text, names, key) {
  let out = '';
  for (let i = 0; i < text.length;) {
    const hit = names.find(n => text.startsWith(n.html, i));
    if (hit) { out += stockLink({ code: hit.code, name: hit.name }, key); i += hit.html.length; continue; }
    const ent = text[i] === '&' ? ENTITY.exec(text.slice(i)) : null;
    const step = ent ? ent[0].length : 1;
    out += text.slice(i, i + step);
    i += step;
  }
  return out;
}

/** Link every exact pool name in the text of `html` — never inside a tag or inside <a>…</a> — and leave every other byte as it is. */
export function linkNames(html, view, key) {
  const src = String(html ?? '');
  const names = poolNames(view);
  if (!names.length) return src;
  let out = '', inA = 0;
  // a tag ends at the first > outside its quotes, so an attribute holding > stays inside the tag
  for (const part of src.split(/(<(?:[^>"']|"[^"]*"|'[^']*')*>)/)) {
    if (part.startsWith('<') && part.endsWith('>')) {
      if (/^<a[\s>]/i.test(part)) inA += 1;
      else if (/^<\/a\s*>/i.test(part)) inA = Math.max(0, inA - 1);
      out += part;
    } else out += inA ? part : linkText(part, names, key);
  }
  return out;
}
