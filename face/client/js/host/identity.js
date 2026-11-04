// face/client/js/host/identity.js — Account › Identity's Connect Telegram (plan B1b Task 2, spec §5.2–§5.3): sheets 1 to 3 as the
// Identity drawer, over the account's pending connection (plan B1a's routes, through the face's proxy), and sheet 4 handed to the
// owner sheet engine as the `connectNetwork` kind.
//
//   Sheet 1, Bot token: Next reads the token from its password field, clears the field, makes the fingerprint in the browser
//     (keyHash = hex sha256(salt ‖ token), 16 random bytes of salt) and posts the token ONCE, beside it, to the token route. The token
//     lives in this module's one call and nowhere else: never the store, a reducer, storage, a log or an error's words.
//   Sheet 2, Say hi: the pending connection read every PENDING_POLL_MS until the bot hears a private message.
//   Sheet 3, Is this you?: Not me counts that sender a stranger and waits again; This is me closes the drawer (keeping the pending
//     connection) and opens sheet 4, seeded from the pending connection, the fingerprint and the routing a fresh connection sends.
//
// Closing the drawer, Back from sheet 2, Start again, and the owner sheet's Cancel on sheet 4 drop the pending connection at once; a
// page that reloads holds none (the store keeps no connection) and the account's ten minutes cover a tab that died.
import { ROUTE_ROWS, routingOf, formatRouting } from './identity-view.js';
import { refusedAt, whyOf } from './owner-view.js';

/** Sheet 2 reads the pending connection this often (the plan's ruling 5). */
export const PENDING_POLL_MS = 1_500;
export const TOKEN_PATH = '/data/account/identity/telegram/token';
const PENDING_PATH = '/data/account/identity/pending';
const NOT_ME_PATH = '/data/account/identity/pending/not-me';
const DROP_PATH = '/data/account/identity/pending/drop';

export const CONNECT_WORDS = {
  empty: 'Paste the token from BotFather first.',
  noSubtle: 'This browser cannot fingerprint the token on this page: open the face at its 127.0.0.1 address.',
  refused: 'The account refused the token.',
  expired: 'This connection waited ten minutes and expired: nothing was kept. Start again.',
  noSender: 'The account did not say who wrote: start again.',
};

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const randomOf = n => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** The token's fingerprint, as the account checks it (brain-keys.ts keyHashOf): `salt` 16 random bytes as 32 lower-case hex,
 *  `keyHash` the hex SHA-256 of the salt's bytes then the token's UTF-8 bytes. */
export async function fingerprintOf(subtle, token, random = randomOf) {
  const salt = random(16);
  const t = new TextEncoder().encode(token);
  const both = new Uint8Array(salt.length + t.length);
  both.set(salt);
  both.set(t, salt.length);
  try {
    const digest = await subtle.digest('SHA-256', both);
    return { salt: hex(salt), keyHash: hex(new Uint8Array(digest)) };
  } finally {
    both.fill(0);
    t.fill(0);
  }
}

// the pending connection as the account answered it, its fields of their shapes; anything else is no answer
function pendingOf(body) {
  const p = body?.pending;
  if (!isRecord(p) || typeof p.id !== 'string' || p.id === '' || !isRecord(p.bot)) return null;
  const sender = isRecord(p.sender)
    ? { id: str(p.sender.id), name: str(p.sender.name), handle: str(p.sender.handle), masked: str(p.sender.masked), text: str(p.sender.text) }
    : null;
  return {
    id: p.id, network: str(p.network) || 'telegram',
    bot: { id: str(p.bot.id), username: str(p.bot.username), name: str(p.bot.name) },
    link: str(p.link), qr: str(p.qr), expiresAt: str(p.expiresAt), state: str(p.state),
    ...(sender ? { sender } : {}),
  };
}

/** The routing a fresh connection signs (the plan's ruling 4): the routing now, `network` ticked in every row. */
export function connectRoutingOf(read, network = 'telegram') {
  const now = routingOf(read);
  return formatRouting(Object.fromEntries(ROUTE_ROWS.map(([row]) => [row, [...(now[row] ?? []), network]])));
}

export function startIdentity({ store, getJson, post, subtle, schedule, cancelTimer, now = Date.now, openSheet, loadIdentity = null, random = randomOf }) {
  let gen = 0;           // the drawer's generation: an answer for a drawer since closed, or moved on, lands nowhere
  let pollTimer = null;
  let sending = false;   // a token on its way: a second Next does nothing

  const connect = () => store.get().identity?.connect ?? null;
  const set = patch => store.dispatch('identityConnectSet', patch);
  const stopPoll = () => { if (pollTimer !== null) { cancelTimer(pollTimer); pollTimer = null; } };
  const armPoll = () => { stopPoll(); pollTimer = schedule(poll, PENDING_POLL_MS); };
  const drop = id => (typeof id === 'string' && id !== '' ? post(DROP_PATH, { id }).catch(() => null) : Promise.resolve(null));
  const expired = p => p?.state === 'expired' || (Date.parse(str(p?.expiresAt)) <= now());

  // sheet 4's Cancel (any close of the owner sheet before it signs) drops the pending connection it was opened for
  let lastSheet = store.get().sheet ?? null;
  store.subscribe((s, type) => {
    const was = lastSheet;
    lastSheet = s.sheet ?? null;
    if (type === 'sheetClose' && was?.kind === 'connectNetwork' && was.status !== 'done' && was.status !== 'signing') void drop(was.seed?.pending);
  });

  /** The Identity read (host/account.js loadIdentity when given); `fresh` past the face's cache. */
  function load(fresh = false) {
    if (loadIdentity) return loadIdentity({ fresh });
    store.dispatch('identityLoading');
    return getJson(`/data/account/identity${fresh ? '?fresh=1' : ''}`)
      .then(body => { if (body && body.ok !== false) store.dispatch('identityLoaded', body); else store.dispatch('identityFailed', str(body?.error)); })
      .catch(err => store.dispatch('identityFailed', str(err?.body?.error)));
  }

  // sheet 2: the pending connection, until the bot hears someone
  async function poll() {
    pollTimer = null;
    const c = connect();
    if (!c || c.step !== 2 || !c.pending) return;
    const mine = gen;
    const id = c.pending.id;
    let body = null;
    let gone = null;
    try {
      body = await getJson(`${PENDING_PATH}?id=${encodeURIComponent(id)}&fresh=1`);
    } catch (err) {
      if (err?.status === 404) gone = str(err?.body?.error) || CONNECT_WORDS.expired;
    }
    const d = connect();
    if (mine !== gen || !d || d.step !== 2 || d.pending?.id !== id) return;
    if (gone) { set({ error: gone }); return; }
    const p = pendingOf(body);
    if (!p) {
      // the account did not answer: read again, unless the connection's time is up
      if (expired(d.pending)) { set({ error: CONNECT_WORDS.expired }); return; }
      armPoll();
      return;
    }
    if (p.state === 'heard' && p.sender) { set({ step: 3, pending: p, error: null }); return; }
    if (p.state === 'expired') { set({ pending: p, error: CONNECT_WORDS.expired }); return; }
    set({ pending: p, error: null });
    armPoll();
  }

  /** Connect…: the drawer at sheet 1 (one open before is closed, its pending connection dropped). */
  function openConnect() {
    if (connect()) close();
    gen += 1;
    store.dispatch('identityConnectOpen');
  }

  /** Sheet 1's Next: the token read from its field and the field cleared at once, fingerprinted here, posted once. */
  async function next(tokenInput) {
    const c = connect();
    if (!c || c.step !== 1 || c.busy || sending) return;
    let token = typeof tokenInput?.value === 'string' ? tokenInput.value.trim() : '';
    if (tokenInput) tokenInput.value = '';
    if (!token) { set({ error: CONNECT_WORDS.empty }); return; }
    if (!subtle || typeof subtle.digest !== 'function') { token = ''; set({ error: CONNECT_WORDS.noSubtle }); return; }
    const mine = gen;
    sending = true;
    set({ busy: true, error: null });
    let fp = null;
    let r = null;
    let words = '';
    try {
      fp = await fingerprintOf(subtle, token, random);
      r = await post(TOKEN_PATH, { token, keyHash: fp.keyHash, salt: fp.salt });
      // the account's words, never the token's: a sentence that carried it would be replaced
      words = whyOf(r);
      if (words.includes(token)) words = CONNECT_WORDS.refused;
    } catch {
      words = fp ? CONNECT_WORDS.refused : CONNECT_WORDS.noSubtle;
    } finally {
      token = '';
      sending = false;
    }
    const p = r && !refusedAt(r) ? pendingOf(r.body) : null;
    if (mine !== gen || !connect()) { if (p) void drop(p.id); return; }
    if (!p) { set({ busy: false, error: words || CONNECT_WORDS.refused }); return; }
    set({ step: 2, pending: p, fp, busy: false, error: null });
    armPoll();
  }

  /** Sheet 3's Not me: that sender is a stranger, and sheet 2 waits again. */
  async function notMe() {
    const c = connect();
    if (!c || c.step !== 3 || !c.pending || c.busy) return;
    const mine = gen;
    set({ busy: true });
    const r = await post(NOT_ME_PATH, { id: c.pending.id });
    if (mine !== gen || !connect()) return;
    const p = !refusedAt(r) ? pendingOf(r.body) : null;
    if (!p) { set({ busy: false, error: whyOf(r) || CONNECT_WORDS.expired }); return; }
    set({ step: 2, pending: p, busy: false, error: null });
    armPoll();
  }

  /** Sheet 3's This is me: the drawer closed without dropping, and sheet 4, the owner sheet, opened over the pending connection. */
  function thisIsMe() {
    const c = connect();
    if (!c || c.step !== 3 || !c.pending?.sender || !c.fp) return;
    const p = c.pending;
    if (!p.sender.id || !p.bot.id || !p.bot.username) { set({ error: CONNECT_WORDS.noSender }); return; }
    const seed = {
      pending: p.id, botId: p.bot.id, speaksAs: `@${p.bot.username}`, operatorId: p.sender.id,
      talksOnlyWith: p.sender.handle || p.sender.masked, routing: connectRoutingOf(store.get().identity?.data, p.network || 'telegram'),
      keyHash: c.fp.keyHash, salt: c.fp.salt,
    };
    gen += 1;
    stopPoll();
    store.dispatch('identityConnectClose');
    return openSheet('connectNetwork', seed);
  }

  /** Back: from sheet 2 the pending connection is dropped and sheet 1 shows again; from sheet 3, sheet 2 waits again. */
  function back() {
    const c = connect();
    if (!c || c.busy) return;
    if (c.step === 2) {
      gen += 1;
      stopPoll();
      void drop(c.pending?.id);
      set({ step: 1, pending: null, fp: null, error: null });
    } else if (c.step === 3) {
      set({ step: 2, error: null });
      armPoll();
    }
  }

  /** Cancel or ×: the drawer closed and its pending connection dropped at once. */
  function close() {
    const c = connect();
    if (!c) return;
    gen += 1;
    stopPoll();
    void drop(c.pending?.id);
    store.dispatch('identityConnectClose');
  }

  /** Start again (an expired or gone connection, on sheets 2 to 4): the drawer at sheet 1, anything pending dropped. */
  function startAgain() {
    if (connect()) close();
    openConnect();
  }

  return { load, openConnect, next, notMe, thisIsMe, back, close, startAgain };
}
