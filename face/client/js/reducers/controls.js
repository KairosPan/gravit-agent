// face/client/js/reducers/controls.js — the in-page controls: inline editors and two-step confirms (they replaced prompt
// and confirm)
import { reducers as messages } from './messages.js';

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
        const t = String(values.title ?? '').trim();
        return t ? done(messages.rename(s, { convId: e.convId, title: t })) : fail(s, 'Cannot be empty');
      }
      default:
        return done(s);
    }
  },

  askConfirm: (s, spec) => ({ ...s, confirm: spec, edit: null }),
  cancelConfirm: s => (s.confirm ? { ...s, confirm: null } : s),
};

