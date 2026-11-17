// face/client/js/reducers/box.js — the Gravit box open or closed on the screens that show no conversation (host/sessions.js
// boxShown); a saved preference (app.js prefsOf).
export const reducers = {
  boxOpen: s => ({ ...s, boxOpen: true }),
  boxClose: s => ({ ...s, boxOpen: false }),
};
