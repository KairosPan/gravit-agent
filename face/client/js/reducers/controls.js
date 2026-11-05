// face/client/js/reducers/controls.js — the in-page controls: inline editors and two-step confirms (they replaced prompt
// and confirm)
import { reducers as messages, closeOverlays } from './messages.js';
import { t } from '../i18n/words.js';

const fail = (s, error) => ({ ...s, edit: { ...s.edit, error } });
const done = s => ({ ...s, edit: null });

export const reducers = {
  startEdit: (s, spec) => ({ ...s, edit: spec, confirm: null }),
  cancelEdit: s => (s.edit ? { ...s, edit: null } : s),

  // one commit for every editor: it reads the values the editor's inputs held and checks them
  commitEdit(s, { values = {} }) {
    const e = s.edit;
    if (!e) return s;
    switch (e.kind) {
      case 'rename': {
        const title = String(values.title ?? '').trim();
        return title ? done(messages.rename(s, { convId: e.convId, title })) : fail(s, t('details.nameEmpty'));
      }
      default:
        return done(s);
    }
  },

  // a write the editor asked for was refused: the editor stays open with the words
  editFailed: (s, { error }) => (s.edit ? fail(s, error) : s),
  // a roster editor's box: the store holds what is ticked; a seventh bot is never added
  toggleRosterTick(s, { value, on }) {
    const e = s.edit;
    if (e?.kind !== 'roster' || typeof value !== 'string') return s;
    const has = e.ticked.includes(value);
    if (on && !has && e.which === 'bots' && e.ticked.length >= 6) return s;
    const ticked = on ? (has ? e.ticked : [...e.ticked, value]) : e.ticked.filter(v => v !== value);
    return ticked === e.ticked ? s : { ...s, edit: { ...e, ticked } };
  },

  // files dragged over the page, or no longer: the drop overlay (app.js draws it while a composer is on screen)
  setDropping: (s, on) => (s.dropping === (on === true) ? s : { ...s, dropping: on === true }),

  // an operator image at full size: opened on its thumb (app.js opens it only on one that landed), closed by its backdrop, its
  // close key or Esc; leaving the conversation closes it (nav)
  openLightbox: (s, { attachmentId, name } = {}) => (typeof attachmentId === 'string' && attachmentId !== ''
    ? { ...s, lightbox: { attachmentId, name: typeof name === 'string' ? name : '' } } : s),
  closeLightbox: s => (s.lightbox ? { ...s, lightbox: null } : s),

  // the shortcut sheet (keys.js): ⌘/ opens it from anywhere and closes it again; Esc closes it after the lightbox (D34)
  openShortcuts: s => (s.shortcuts ? s : { ...s, shortcuts: { q: '' } }),
  closeShortcuts: s => (s.shortcuts ? { ...s, shortcuts: null } : s),
  // its box's words as typed (render/shortcuts.js keeps the rows they match), only while it stands
  setShortcutsQuery: (s, q) => (s.shortcuts ? { ...s, shortcuts: { q: typeof q === 'string' ? q : '' } } : s),

  // Details opened from elsewhere (a pill): opens it, never closes it
  openDetails: s => (s.detailsOpen ? s : { ...closeOverlays(s), detailsOpen: true }),

  askConfirm: (s, spec) => ({ ...s, confirm: spec, edit: null }),
  cancelConfirm: s => (s.confirm ? { ...s, confirm: null } : s),
};

