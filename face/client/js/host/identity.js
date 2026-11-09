// face/client/js/host/identity.js — Account › Identity's Connect Telegram (plan B1b Task 2, spec §5.2–§5.3) and Install app… for
// Slack (plan B2 Task 7) and Connect iMessage through Photon (the iMessage plan): sheets 1 to 3 as the Identity drawer, over the
// account's pending connection (plan B1a's routes, through the face's proxy), and sheet 4 handed to the owner sheet engine as the
// `connectNetwork` kind.
//
//   Sheet 1, Bot token (Telegram), App tokens (Slack) or Photon project (iMessage): Next reads the token, Slack's app-level and bot
//     tokens, or iMessage's project ID, project secret and number, from their fields, clears the secret ones, makes the fingerprint in
//     the browser (keyHash = hex sha256(salt ‖ token), Slack's over app ‖ 0x00 ‖ bot, iMessage's over project ID ‖ 0x00 ‖ secret, 16
//     random bytes of salt) and posts them ONCE, beside it, to the network's token route. A token or secret lives in this module's one
//     call and nowhere else: never the store, a reducer, storage, a log or an error's words.
//   Sheet 2, Say hi: the pending connection read every PENDING_POLL_MS until the bot hears a private message, never past the
//     connection's time (its expiresAt; one that cannot be read, PENDING_WAIT_MS from when sheet 2 began); a read with no answer says
//     the account is not answering and reads again.
//   Sheet 3, Is this you?: Not me counts that sender a stranger and waits again; This is me closes the drawer (keeping the pending
//     connection) and opens sheet 4, seeded from the pending connection, the fingerprint and the routing a fresh connection sends.
//
// Closing the drawer, Back from sheet 2, Start again, and the owner sheet's Cancel on sheet 4 drop the pending connection at once; a
// page that reloads holds none (the store keeps no connection) and the account's ten minutes cover a tab that died.
import { routeRows, routingOf, formatRouting } from './identity-view.js';
import { refusedAt, whyOf } from './owner-view.js';
import { said } from '../i18n/words.js';

/** Sheet 2 reads the pending connection this often (the plan's ruling 5). */
export const PENDING_POLL_MS = 1_500;
/** The account's own wait for a pending connection (ten minutes): the end of sheet 2 when its expiresAt cannot be read. */
export const PENDING_WAIT_MS = 10 * 60_000;
/** Each network's token route (the face's proxy to the account's). */
export const TOKEN_PATHS = {
  telegram: '/data/account/identity/telegram/token', slack: '/data/account/identity/slack/token', imessage: '/data/account/identity/imessage/token',
};
/** A number as the account takes it on iMessage's sheet 1: E.164, a + then the country code and the number (photon-link.ts E164). */
export const E164 = /^\+[1-9]\d{6,14}$/;
/** A typed number as sheet 1 sends it: its spaces, dashes and parentheses gone. */
export const phoneOf = typed => (typeof typed === 'string' ? typed.replace(/[\s()-]/g, '') : '');
const PENDING_PATH = '/data/account/identity/pending';
const NOT_ME_PATH = '/data/account/identity/pending/not-me';
const DROP_PATH = '/data/account/identity/pending/drop';

// the drawer's own words, each a said read when drawn
export const CONNECT_WORDS = {
  empty: () => said('identity.connect.empty'),
  noSubtle: () => said('identity.connect.noSubtle'),
  refused: () => said('identity.connect.refused'),
  slackRefused: () => said('identity.connect.slackRefused'),
  slackNoApp: () => said('identity.connect.slackNoApp'),
  slackNoBot: () => said('identity.connect.slackNoBot'),
  slackNone: () => said('identity.connect.slackNone'),
  imessageRefused: () => said('identity.connect.imessageRefused'),
  imessageShape: () => said('identity.connect.imessageShape'),
  expired: () => said('identity.connect.expired'),
  noSender: () => said('identity.connect.noSender'),
};

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const randomOf = n => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** The token's fingerprint, as the account checks it (brain-keys.ts keyHashOf): `salt` 16 random bytes as 32 lower-case hex,
 *  `keyHash` the hex SHA-256 of the salt's bytes then the token's UTF-8 bytes. */
export async function fingerprintOf(subtle, token, random = randomOf) {
  const salt = random(16);
  const bytes = new TextEncoder().encode(token);
  const both = new Uint8Array(salt.length + bytes.length);
  both.set(salt);
  both.set(bytes, salt.length);
  try {
    const digest = await subtle.digest('SHA-256', both);
    return { salt: hex(salt), keyHash: hex(new Uint8Array(digest)) };
  } finally {
    both.fill(0);
    bytes.fill(0);
  }
}

// the pending connection as the account answered it, its fields of their shapes; anything else is no answer
function pendingOf(body) {
  const p = body?.pending;
  if (!isRecord(p) || typeof p.id !== 'string' || p.id === '' || !isRecord(p.bot)) return null;
  const sender = isRecord(p.sender)
    ? {
      id: str(p.sender.id), name: str(p.sender.name), handle: str(p.sender.handle), masked: str(p.sender.masked), text: str(p.sender.text),
      ...(typeof p.sender.userId === 'string' ? { userId: p.sender.userId } : {}),
    }
    : null;
  const workspace = str(p.workspace) || str(p.bot.workspace);
  const heard = isRecord(p.strangerHeard) && str(p.strangerHeard.masked) ? { masked: str(p.strangerHeard.masked), at: str(p.strangerHeard.at) } : null;
  return {
    id: p.id, network: str(p.network) || 'telegram',
    bot: { id: str(p.bot.id), username: str(p.bot.username), name: str(p.bot.name) },
    ...(workspace ? { workspace } : {}),
    link: str(p.link), qr: str(p.qr), expiresAt: str(p.expiresAt), state: str(p.state),
    ...(sender ? { sender } : {}),
    ...(heard ? { strangerHeard: heard } : {}),
  };
}

/** The routing a fresh connection signs (the plan's ruling 4): the routing now, `network` ticked in every row. */
export function connectRoutingOf(read, network = 'telegram') {
  const now = routingOf(read);
  return formatRouting(Object.fromEntries(routeRows().map(([row]) => [row, [...(now[row] ?? []), network]])));
}

/** The manifest's Copy: the text to the clipboard; a clipboard missing or refused, `select()` (the <pre> selected, for the operator
 *  to copy by hand). True when the clipboard took it. */
export async function copyManifest(text, clipboard, select) {
  if (typeof text !== 'string' || text === '') return false;
  try {
    if (!clipboard || typeof clipboard.writeText !== 'function') throw new TypeError(); // no clipboard here
    await clipboard.writeText(text);
    return true;
  } catch {
    try { select?.(); } catch { /* nothing to select */ }
    return false;
  }
}

export function startIdentity({ store, getJson, post, subtle, schedule, cancelTimer, now = Date.now, openSheet, loadIdentity = null, random = randomOf }) {
  let gen = 0;           // the drawer's generation: an answer for a drawer since closed, or moved on, lands nowhere
  let pollTimer = null;
  let sending = false;   // a token on its way: a second Next does nothing
  let waitFrom = 0;      // when sheet 2 began waiting for this connection (the account's ten minutes run from about then)

  const connect = () => store.get().identity?.connect ?? null;
  const set = patch => store.dispatch('identityConnectSet', patch);
  const stopPoll = () => { if (pollTimer !== null) { cancelTimer(pollTimer); pollTimer = null; } };
  const armPoll = () => { stopPoll(); pollTimer = schedule(poll, PENDING_POLL_MS); };
  const drop = id => (typeof id === 'string' && id !== '' ? post(DROP_PATH, { id }).catch(() => null) : Promise.resolve(null));
  // the connection's time is up: the account says so, its expiresAt has passed, or — one that cannot be read — ten minutes went by
  const expired = p => {
    if (p?.state === 'expired') return true;
    const ms = Date.parse(str(p?.expiresAt));
    return Number.isFinite(ms) ? ms <= now() : now() - waitFrom >= PENDING_WAIT_MS;
  };

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
      if (err?.status === 404) gone = str(err?.body?.error) || CONNECT_WORDS.expired();
    }
    const d = connect();
    if (mine !== gen || !d || d.step !== 2 || d.pending?.id !== id) return;
    if (gone) { set({ error: gone }); return; }
    const p = pendingOf(body);
    if (!p) {
      // the account did not answer: said, and read again, unless the connection's time is up
      if (expired(d.pending)) { set({ error: CONNECT_WORDS.expired(), silent: false }); return; }
      set({ silent: true });
      armPoll();
      return;
    }
    if (p.state === 'heard' && p.sender) { set({ step: 3, pending: p, error: null, silent: false }); return; }
    if (expired(p)) { set({ pending: p, error: CONNECT_WORDS.expired(), silent: false }); return; }
    set({ pending: p, error: null, silent: false });
    armPoll();
  }

  /** Connect… (Telegram, iMessage) or Install app… (Slack): the drawer at sheet 1 for that network (one open before is closed, its pending
   *  connection dropped). */
  function openConnect(network = 'telegram') {
    if (connect()) close();
    gen += 1;
    store.dispatch('identityConnectOpen', network);
  }

  // a field's value, trimmed, and the field cleared at once
  const take = input => {
    const v = typeof input?.value === 'string' ? input.value.trim() : '';
    if (input) input.value = '';
    return v;
  };

  /** Sheet 1's Next: the token (Telegram: `first`), the two tokens (Slack: `first` the app-level token, `second` the bot token) or the
   *  Photon project (iMessage: `first` the project ID, `second` the project secret, `third` the operator's number) read from their
   *  fields, the token and secret fields cleared at once, fingerprinted here, posted once. A Slack field left empty posts nothing and
   *  says which; an iMessage field left empty, or a number that is not +, a country code and the number, posts nothing either. */
  async function next(first, second, third) {
    const c = connect();
    if (!c || c.step !== 1 || c.busy || sending) return;
    const slack = c.network === 'slack';
    const imessage = c.network === 'imessage';
    // iMessage's project ID and number are no secret: their fields keep what was typed
    const keep = input => (typeof input?.value === 'string' ? input.value.trim() : '');
    let token = imessage ? keep(first) : take(first);
    let bot = slack || imessage ? take(second) : '';
    const phone = imessage ? phoneOf(keep(third)) : '';
    const missing = slack ? !token || !bot : imessage ? !token || !bot || !E164.test(phone) : !token;
    if (missing) {
      const empty = imessage ? CONNECT_WORDS.imessageShape : !slack ? CONNECT_WORDS.empty : !token && !bot ? CONNECT_WORDS.slackNone : !token ? CONNECT_WORDS.slackNoApp : CONNECT_WORDS.slackNoBot;
      token = ''; bot = '';
      set({ error: empty() });
      return;
    }
    if (!subtle || typeof subtle.digest !== 'function') { token = ''; bot = ''; set({ error: CONNECT_WORDS.noSubtle() }); return; }
    const refused = slack ? CONNECT_WORDS.slackRefused() : imessage ? CONNECT_WORDS.imessageRefused() : CONNECT_WORDS.refused();
    const mine = gen;
    sending = true;
    set({ busy: true, error: null });
    let fp = null;
    let r = null;
    let words = '';
    try {
      // Slack's fingerprint is over app ‖ 0x00 ‖ bot, iMessage's over project ID ‖ 0x00 ‖ secret (none holds a NUL, so the join is
      // unambiguous): the account's keyMatches
      fp = await fingerprintOf(subtle, slack || imessage ? `${token}\u0000${bot}` : token, random);
      r = slack
        ? await post(TOKEN_PATHS.slack, { appToken: token, botToken: bot, keyHash: fp.keyHash, salt: fp.salt })
        : imessage
          ? await post(TOKEN_PATHS.imessage, { projectId: token, projectSecret: bot, phone, keyHash: fp.keyHash, salt: fp.salt })
          : await post(TOKEN_PATHS.telegram, { token, keyHash: fp.keyHash, salt: fp.salt });
      // the account's words, never a token's or a secret's: a sentence that carried one would be replaced
      words = whyOf(r);
      if (typeof words === 'string' && ((!imessage && words.includes(token)) || (bot && words.includes(bot)))) words = refused;
    } catch {
      words = fp ? refused : CONNECT_WORDS.noSubtle();
    } finally {
      token = '';
      bot = '';
      sending = false;
    }
    const p = r && !refusedAt(r) ? pendingOf(r.body) : null;
    if (mine !== gen || !connect()) { if (p) void drop(p.id); return; }
    if (!p) { set({ busy: false, error: words || refused }); return; }
    waitFrom = now();
    set({ step: 2, pending: p, fp, busy: false, error: null, silent: false });
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
    if (!p) { set({ busy: false, error: whyOf(r) || CONNECT_WORDS.expired() }); return; }
    set({ step: 2, pending: p, busy: false, error: null, silent: false });
    armPoll();
  }

  /** Sheet 3's This is me: the drawer closed without dropping, and sheet 4, the owner sheet, opened over the pending connection. */
  function thisIsMe() {
    const c = connect();
    if (!c || c.step !== 3 || !c.pending?.sender || !c.fp) return;
    const p = c.pending;
    if (!p.sender.id || !p.bot.id || !p.bot.username) { set({ error: CONNECT_WORDS.noSender() }); return; }
    const network = c.network === 'slack' || c.network === 'imessage' ? c.network : 'telegram';
    // iMessage's handles are numbers, with no @: the line Gravit speaks from, and the operator's number
    const imessage = network === 'imessage';
    const seed = {
      network, pending: p.id, botId: p.bot.id, speaksAs: imessage ? p.bot.username : `@${p.bot.username}`, operatorId: p.sender.id,
      talksOnlyWith: imessage ? p.sender.handle : p.sender.handle || p.sender.masked, routing: connectRoutingOf(store.get().identity?.data, network),
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
      set({ step: 2, error: null, silent: false });
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

  /** Start again (an expired or gone connection, on sheets 2 to 4): the drawer at sheet 1 for the same network, anything pending
   *  dropped. `network` names it when no drawer is open (sheet 4's, from its seed). */
  function startAgain(network) {
    const net = connect()?.network ?? network ?? 'telegram';
    if (connect()) close();
    openConnect(net);
  }

  /** Slack's sheet 1 Copy: the account's manifest to the clipboard, or the <pre> selected (`select`) when the browser says no. */
  async function copy(clipboard, select) {
    const c = connect();
    if (!c || c.network !== 'slack' || c.step !== 1) return;
    const text = store.get().identity?.data?.slackManifest;
    const ok = await copyManifest(typeof text === 'string' ? text : '', clipboard, select);
    const d = connect();
    if (ok && d && d.network === 'slack' && d.step === 1) set({ copied: true });
  }

  return { load, openConnect, next, notMe, thisIsMe, back, close, startAgain, copy };
}
