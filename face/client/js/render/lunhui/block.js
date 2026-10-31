// face/client/js/render/lunhui/block.js — the anatomy every composed-answer block shares (spec §5.3): the face's label, small
// and grey, then Gravit's headline (block.title, escaped as written), then the readout line that answers the control.
import { esc } from '../../html.js';

export const label = words => `<div class="lh-label">${esc(words)}</div>`;
export const headline = block => (typeof block?.title === 'string' && block.title !== '' ? `<div class="lh-title">${esc(block.title)}</div>` : '');
export const readout = words => `<div class="lh-readout" role="status" aria-live="polite">${esc(words)}</div>`;
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
