// face/client/js/render/avatars.js — the round marks: You, G, a bot's letter, a glyph
import { esc } from '../html.js';
import { icon } from '../icons.js';
import { th } from '../i18n/words.js';

export function mark(spec, size, radius, name) {
  const box = `width:${size}px;height:${size}px;border-radius:${radius}`;
  if (spec.type === 'glyph') return `<span class="av av-glyph" style="${box}">${icon(spec.icon, Math.round(size / 2), 2)}</span>`;
  return `<span class="av av-letter tone-${spec.tone ?? 'grey'}" style="${box};font-size:${Math.round(size * 0.42)}px">${esc(spec.text)}</span>`;
}

export function avatar(who, size = 28, state = null) {
  if (who === 'you') return `<span class="av av-you" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px">${th('list.you')}</span>`;
  if (who === 'gravit') return `<span class="av av-g" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.46)}px">G</span>`;
  // a bot the host lists gets the letter of its name; anyone else the letter of their id
  const name = state?.bots?.find(b => b.id === who)?.name ?? String(who);
  return mark({ type: 'letter', text: name.slice(0, 1).toUpperCase(), tone: 'grey' }, size, '999px', name);
}

