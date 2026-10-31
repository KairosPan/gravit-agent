// face/client/js/render/lunhui/block.js — the anatomy every composed-answer block shares (spec §5.3): the face's label, small
// and grey, then Gravit's headline (block.title, escaped as written), then the readout line that answers the control.
import { esc } from '../../html.js';

export const label = words => `<div class="lh-label">${esc(words)}</div>`;
export const headline = block => (typeof block?.title === 'string' && block.title !== '' ? `<div class="lh-title">${esc(block.title)}</div>` : '');
export const readout = words => `<div class="lh-readout" role="status" aria-live="polite">${esc(words)}</div>`;
export const count = n => Number(n).toLocaleString('en-US');
