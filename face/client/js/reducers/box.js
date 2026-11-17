// face/client/js/reducers/box.js — the gravit box open or closed on the screens that show no conversation (host/sessions.js
// boxShown); a saved preference (app.js prefsOf). Detached: × on the page chip leaves the page tag off what the box sends
// from this page (its hash), until the page changes; never saved.
import { toHash } from '../router.js';

export const reducers = {
  boxOpen: s => ({ ...s, boxOpen: true }),
  boxClose: s => ({ ...s, boxOpen: false }),
  boxDetach: s => ({ ...s, boxDetached: toHash(s.route) }),
  boxAttach: s => ({ ...s, boxDetached: null }),
};
