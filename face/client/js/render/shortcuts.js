// gravit-ui/js/render/shortcuts.js — the shortcut sheet (spec 2026-11-03 §5.12): a centred dialog over the scrim, opened by ⌘/
// or Settings › Keyboard shortcuts' Show all. It lists the bound rows of keys.js by section, each what it does and the
// platform's chord, and rebinds nothing; its box keeps the rows whose words or chord hold the query, any case.
import { esc, attrs } from '../html.js';
import { t, th } from '../i18n/words.js';
import { SHORTCUTS, chordLabel, shortcutWords } from '../keys.js';

// a section's heading, read when drawn (never at import)
const sectionWords = id => (id === 'general' ? t('shortcuts.section.general') : t('shortcuts.section.composer'));

// '' while closed; the table is the page's own (a test hands one with a row unbound)
export function renderShortcuts(state, { mac = true, table = SHORTCUTS } = {}) {
  if (!state.shortcuts) return '';
  const q = typeof state.shortcuts.q === 'string' ? state.shortcuts.q : '';
  const needle = q.trim().toLowerCase();
  const kept = table.filter(r => r.bound).map(r => ({ r, words: shortcutWords(r), chord: chordLabel(r, mac) }))
    .filter(x => needle === '' || x.words.toLowerCase().includes(needle) || x.chord.toLowerCase().includes(needle));
  const sections = ['general', 'composer'].map(id => {
    const mine = kept.filter(x => x.r.section === id);
    if (!mine.length) return '';
    return `<h3 class="sc-section">${esc(sectionWords(id))}</h3><ul class="sc-rows">` +
      mine.map(x => `<li class="sc-row"><span class="sc-what">${esc(x.words)}</span><kbd class="sc-key">${esc(x.chord)}</kbd></li>`).join('') + '</ul>';
  }).join('');
  const box = `<input${attrs({ id: 'sc-q', class: 'input', type: 'search', value: q, placeholder: t('shortcuts.search'), 'aria-label': t('shortcuts.search'),
    autocomplete: 'off', spellcheck: 'false', 'data-action': 'scQuery' })}>`;
  return `<div class="scrim" data-action="closeShortcuts"></div><section class="shortcuts" role="dialog" aria-modal="true" aria-labelledby="sc-title">` +
    `<div class="sc-head"><h2 id="sc-title">${th('shortcuts.title')}</h2><button type="button" id="sc-close" class="close-key" data-action="closeShortcuts" aria-label="${th('common.close')}">×</button></div>` +
    `${box}<div class="sc-body">${sections || `<p class="sc-none">${th('shortcuts.none')}</p>`}</div><p class="sc-note">${th('shortcuts.note')}</p></section>`;
}
