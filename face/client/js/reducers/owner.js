// face/client/js/reducers/owner.js — the owner device's slice (host/owner.js): whether this page signs for the Account
// (`role`), its key's id at the Account (`kid`), the Account's last refusal to it as words, and whether a pairing or a
// sign-out is in the air. No key material is ever kept here.
// The owner sheet's slice (host/sheet.js), `sheet: null` while none is open: its kind, seed and fields, where it stands —
// `incomplete` (the missing `words`), `asking`, `ready` (the Account's `prepared`, when it landed, the draft it was `asked`
// for, its `deadline` when it carries one), `refused` (the Account's `message`, `again` when preparing again is the answer),
// `signing`, `done` (what the Account `said`).

const ROLES = new Set(['unknown', 'signs', 'pending', 'needs-code', 'signed-out', 'none']);
const own = (s, patch) => {
  const next = { ...s.owner, ...patch };
  return Object.keys(patch).every(k => next[k] === s.owner[k]) ? s : { ...s, owner: next };
};

// a patch to the open sheet; none open, nothing changes
const sheet = (s, patch) => (s.sheet ? { ...s, sheet: { ...s.sheet, ...patch } } : s);
// no preparation left to sign: the countdown with it
const UNPREPARED = { prepared: null, preparedAt: null, asked: null, deadline: null };

// a field's new value: the sheet-view's field list by name (a name it does not have changes nothing), or a plain form
function withField(s, { name, value } = {}) {
  if (!s.sheet || typeof name !== 'string') return s;
  const { fields } = s.sheet;
  if (Array.isArray(fields)) {
    if (!fields.some(f => f?.name === name)) return s;
    return sheet(s, { fields: fields.map(f => (f?.name === name ? { ...f, value } : f)) });
  }
  return sheet(s, { fields: { ...(fields && typeof fields === 'object' ? fields : {}), [name]: value } });
}

export const reducers = {
  // the standing: a role the device does not know leaves the slice as it is
  ownerStanding: (s, { role, kid } = {}) => (ROLES.has(role) ? own(s, { role, kid: typeof kid === 'string' ? kid : '' }) : s),
  // the Account's words when it refused the device (null clears them)
  ownerRefusal: (s, message) => own(s, { refusal: typeof message === 'string' ? message : null }),
  ownerBusy: (s, on) => own(s, { busy: on === true }),

  sheetOpen: (s, { kind, seed, fields } = {}) => ({
    ...s,
    sheet: {
      kind, seed, fields, status: 'incomplete', words: '', ...UNPREPARED, message: null, again: false, said: null,
    },
  }),
  // the form changes; what was asked stays, so the renderer can tell the shown preparation is not the form's any more
  sheetField: withField,
  sheetIncomplete: (s, words) => sheet(s, { status: 'incomplete', words: typeof words === 'string' ? words : '', ...UNPREPARED, message: null, again: false }),
  // a quiet ask keeps the shown preparation, ready, until the new one lands; a loud one clears it
  sheetAsking: (s, { quiet } = {}) => {
    if (!s.sheet || (quiet === true && s.sheet.status === 'ready')) return s;
    return sheet(s, { status: 'asking', words: '', ...UNPREPARED, message: null, again: false });
  },
  sheetPrepared: (s, { prepared, at, asked, deadline } = {}) => sheet(s, {
    status: 'ready', words: '', prepared, preparedAt: at, asked, deadline: Number.isFinite(deadline) ? deadline : null, message: null, again: false,
  }),
  sheetRefused: (s, { message, again } = {}) => sheet(s, {
    status: 'refused', ...UNPREPARED, message: typeof message === 'string' && message ? message : 'Refused', again: again === true,
  }),
  sheetSigning: s => sheet(s, { status: 'signing' }),
  sheetDone: (s, { said } = {}) => sheet(s, { status: 'done', deadline: null, said: typeof said === 'string' ? said : '' }),
  // the countdown's second: a new state, so subscribers draw the words from deadline − now
  sheetTick: s => sheet(s, {}),
  sheetClose: s => (s.sheet ? { ...s, sheet: null } : s),
};
