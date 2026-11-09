// face/client/js/reducers/controls.js — the in-page controls: inline editors and two-step confirms (they replaced prompt
// and confirm)
import { closeOverlays } from './messages.js';

export const reducers = {
  startEdit: (s, spec) => ({ ...s, edit: spec, confirm: null }),
  cancelEdit: s => (s.edit ? { ...s, edit: null } : s),

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

