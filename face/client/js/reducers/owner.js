// face/client/js/reducers/owner.js — the owner device's slice (host/owner.js): whether this page signs for the Account
// (`role`), its key's id at the Account (`kid`), the Account's last refusal to it as words, and whether a pairing or a
// sign-out is in the air. No key material is ever kept here.

const ROLES = new Set(['unknown', 'signs', 'pending', 'needs-code', 'signed-out', 'none']);
const own = (s, patch) => {
  const next = { ...s.owner, ...patch };
  return Object.keys(patch).every(k => next[k] === s.owner[k]) ? s : { ...s, owner: next };
};

export const reducers = {
  // the standing: a role the device does not know leaves the slice as it is
  ownerStanding: (s, { role, kid } = {}) => (ROLES.has(role) ? own(s, { role, kid: typeof kid === 'string' ? kid : '' }) : s),
  // the Account's words when it refused the device (null clears them)
  ownerRefusal: (s, message) => own(s, { refusal: typeof message === 'string' ? message : null }),
  ownerBusy: (s, on) => own(s, { busy: on === true }),
};
