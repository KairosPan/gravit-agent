/** A BRAIN'S KEY, TYPED ON THE PAGE — the one secret this account takes from the browser, and how it is kept from going anywhere else.
 *
 * Every other credential reaches the account as a file the owner writes and the page only names (live/credentials.ts): the page hands
 * over where a file is, never what is in it. A brain's key is the one exception, because pasting one key into one field is what the owner
 * asked for, and a model provider's key is a key the owner can revoke at the provider in a minute. It is taken ONCE, over this machine's
 * own loopback, and written to the provider's key file in the home — <home>/credentials/brains/<provider>.json, {"apiKey", "baseUrl"?,
 * "model"?}, readable by the user alone in a folder only the user can open — and nowhere else: not the ledger, not the desk's room, not
 * desk.json, not a log line, not an answer, not the page's storage, not a cache. From there the brain reads it again at every check, the
 * way it reads a key file the owner wrote by hand, so a key set here needs no restart.
 *
 * How it travels, step by step:
 *
 *   1. The page hashes the key in the browser (crypto.subtle): keyHash = hex SHA-256(salt ‖ key), the salt being 16 random bytes and the
 *      key its UTF-8 bytes, both given to SHA-256 as bytes, one after the other. The owner signs `setBrainKey {provider, baseUrl, model,
 *      keyHash, salt}` with the device key, as every owner action is signed (sign.ts): the dialog shows the provider, the base URL, the
 *      model and the key's fingerprint (the first 8 hex of keyHash) — never the key. An agent key can never sign it: it is an owner type.
 *   2. The page sends {envelope, apiKey} to POST /api/account/brain-key — a route of its own, behind the same guard as every route (this
 *      machine's own pages only), with its own small reader (parseBrainKeyBody): the server's JSON parser is not used for it, because a
 *      body that is not JSON would otherwise reach the error log with its own words in it, key and all. A body that is not what this route
 *      takes is answered with one fixed sentence and is neither logged nor echoed.
 *   3. Before the door: the key's shape (8 to 512 printable characters, no space); the key nowhere in the model or the base URL the owner
 *      signed, and neither of those shaped like a key themselves (keyShaped, brain-key.ts; the base URL by its own rule, baseUrlKeyShaped:
 *      its host as typed, label by label, and its path, where an account's 32-hex id passes) — a key pasted into the wrong field would
 *      otherwise be signed, and a signed field is written to the ledger, which is hash-chained and cannot be cleaned afterwards, and sent to
 *      the provider as a model's name; and the key against the fingerprint the owner signed (keyMatches — a constant-time comparison of
 *      SHA-256(salt ‖ key) with keyHash). Whatever is refused there is answered with a fixed sentence that never repeats what was sent,
 *      nothing is staged, nothing is written, and the signature is not spent.
 *   4. The key is staged in this process's memory under the action's hash (BrainKeyStage), and the envelope goes through the account's
 *      ordinary door (exchange.ts): the signature, an owner's, a nonce never seen, within ten minutes of its date. The door's handler for
 *      setBrainKey takes the staged key (applyBrainKey) and writes the file (writeBrainKey): the folder made 0700 (and chmod'ed so), a
 *      link where the folder or the file should be refused, the key written to a fresh temporary file opened "wx" with mode 0600, flushed
 *      to disk, then renamed over the old one — so the file is never half-written, and a file someone had made readable by others (0644)
 *      is replaced by one that is not. Whatever happens, the staged key is deleted when the route answers (finally).
 *   5. The answer says which provider, the key's masked tail ("…ab12" — brain-key.ts keyTail, only "…" for a key under 16 characters; in
 *      this answer and the Brains place's, never in a record), its fingerprint, how the brain stands now (ready, or why not and the fix),
 *      and — when a variable in the service's environment holds a key for the same brain — that the variable wins over the file (envWins),
 *      since a brain reads its environment first; or, where the variable is a gateway's credential the brain will not use (Claude with
 *      ANTHROPIC_BASE_URL pointing elsewhere: brain-claude.ts), that it BLOCKS a saved key until it is removed (envBlocks). A local server's
 *      settings saved with no key are answered {keyless: true} instead of a fingerprint.
 *
 * The ledger keeps the instruction as it keeps an instruction about memory (exchange.ts ledgered): who signed it, its nonce, the provider,
 * the base URL, the model and the fingerprint — the full keyHash and the salt are not written, and the row that says it was done carries
 * no envelope at all. A signed key cannot be sent twice: the same envelope again in this run is answered "taken already" and writes
 * nothing; a later run refuses its nonce (remembered from the ledger), and ten minutes after its date it is too old anyway.
 *
 * A setBrainKey whose keyHash is "" takes the key away: the provider's file under credentials/brains is removed (the older paths a brain
 * still reads — credentials/anthropic/api-key.json, credentials/openai/api-key.json — are the owner's own files and are left alone, so the
 * standing in the answer says honestly whether the brain still finds a key there). The ledger's row says what happened, no more: "taken
 * away" only when a file was removed, "nothing to take away" when there was none — and, when the brain is still ready afterwards, where it
 * still reads a key from (the older file, the service's environment, or a local server that needs none).
 *
 * A LOCAL SERVER (a preset that ignores the key: Ollama, vLLM — the brain's about().keyOptional) needs no key at all, so no key is ever
 * made up for it: a setBrainKey with keyHash "" that names a base URL or a model (or both) saves those with no key — the provider's file
 * written {"baseUrl"?, "model"?} through the same atomic writer (writeBrainKey, no "apiKey" in it), replacing whatever was there, a key
 * included. With both empty it takes the file away, as for any provider. For a provider that needs a key, keyHash "" always takes the file
 * away: a base URL or a model beside it is not saved without the key it goes with.
 *
 * After a key file was written or removed, the desk is told (Desk.keyChanged, desk.ts, called by the service after every change): a refusal
 * the provider gave the OLD key is no longer the brain's standing, and the room says that the key changed, by its fingerprint only. When a
 * variable in the service's environment wins over the file (envWins), the key the brain uses did not change: the desk is told all the
 * same, keeps the refusal standing, and its room line says that the variable wins over the file. A clear that found no file changed
 * nothing, and the desk is not told.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, renameSync, rmSync, writeSync, type Stats } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { isRefusal, type Refusal } from "../../core/errors.ts";
import { no } from "../refuse.ts";
import { BRAIN_ID, BRAIN_KEY_DIR, brainKeyRef, hostKeyShaped, isLoopback, keyShaped, keyTail, pathKeyShaped, prefixedKey, typedHost } from "./brain-key.ts";
import { MODEL_ID, type BrainAbout, type BrainStatus } from "./desk.ts";
import { malformed, type Envelope, type OwnerAction } from "./sign.ts";

export type SetBrainKey = Extract<OwnerAction, { type: "setBrainKey" }>;
export { keyTail };

/** the route that takes a key, and whether a request's path is that route as express would match it (case and a trailing slash do not
 * matter to express, so they do not matter here either: the server's own JSON parser must skip every spelling the route answers to) */
export const BRAIN_KEY_PATH = "/api/account/brain-key";
export const isBrainKeyPath = (path: string): boolean => path.toLowerCase().replace(/\/+$/, "") === BRAIN_KEY_PATH;
/** the most this route reads of a body: an envelope and one key fit in a fraction of it */
export const BRAIN_KEY_BODY_LIMIT = 4096;

/** a provider's id, as the desk names a brain (BrainConfig.provider) and its key file is named (brain-key.ts BRAIN_ID); a model's name is
 * the desk's own rule (desk.ts MODEL_ID), read where it is used */
const PROVIDER = BRAIN_ID;
/** a key: printable ASCII, no space, 8 to 512 characters. Whether the provider takes it, only the provider says (Test, or the next call) */
const KEY = /^[\x21-\x7e]{8,512}$/;
const HASH = /^[0-9a-f]{64}$/;
const SALT = /^[0-9a-f]{32}$/;
const MAX_URL = 300;

// ---- the words this route answers with: fixed sentences, none of which repeats anything that was sent -------------------------------

export const BODY_WORDS = {
  malformed: "This route takes one JSON object, {envelope, apiKey}: what was sent is not that, and it was not kept.",
  type: "This route takes application/json, sent as it is (no content encoding).",
  large: `This route takes at most ${BRAIN_KEY_BODY_LIMIT} bytes: what was sent is larger, and it was not kept.`,
  notSetKey: "This route takes a signed setBrainKey and the key beside it; every other instruction goes to POST /api/exchange.",
  keyShape: "A key is 8 to 512 printable characters with no spaces: the one sent is not, and it was not kept.",
  noKey: "A signature that sets a key needs the key beside it: nothing was written.",
  clearWithKey: 'A signature that takes the key away (keyHash "") carries no key: nothing was written.',
  hashShape: "The signed fingerprint is 64 hex characters and its salt 32 (16 bytes), both lower-case: nothing was written.",
  mismatch: "The key does not match the fingerprint you signed: nothing was written. Type the key again and sign again.",
  busy: "This signed key is being taken already: nothing more was written.",
  replay: "This signed key was taken already: nothing was written again. Sign again to set the key again.",
  keyInField: "The key is in the model or the base URL as well as in the key field: a key goes in the key field alone. Nothing was written, and the signature was not spent. Take it out of the other field and save again.",
} as const;

/** The words for a model, a base URL's path or a base URL's host shaped like a key: fixed, so that they never repeat it (a key said back
 * lands wherever the refusal goes — the page, a log, the ledger's refusal row) */
export const KEY_SHAPED_WORDS = {
  model: "the model looks like an API key, not a model's name: a key goes in the key field, never in the model. Nothing was kept",
  baseUrl: "the base URL's path holds something shaped like an API key: a key goes in the key field, never in the base URL. Nothing was kept",
  baseHost: "the base URL's host holds something shaped like an API key: a key goes in the key field, never in the base URL's address. Nothing was kept",
} as const;

// ---- the key's fingerprint ----------------------------------------------------------------------------------------------------

/** hex SHA-256(salt ‖ key): the salt's 16 bytes, then the key's UTF-8 bytes — what the page computes with crypto.subtle */
export function keyHashOf(saltHex: string, key: string): string {
  return createHash("sha256").update(Buffer.from(saltHex, "hex")).update(Buffer.from(key, "utf8")).digest("hex");
}

/** whether `key` is the key the owner signed the fingerprint of, compared in constant time */
export function keyMatches(saltHex: string, key: string, keyHash: string): boolean {
  if (!SALT.test(saltHex) || !HASH.test(keyHash)) return false;
  const made = createHash("sha256").update(Buffer.from(saltHex, "hex")).update(Buffer.from(key, "utf8")).digest();
  return timingSafeEqual(made, Buffer.from(keyHash, "hex"));
}

/** what the ledger, the page and a person see of a key: the first 8 hex of its keyHash */
export const fingerprintOf = (keyHash: string): string => keyHash.slice(0, 8);
/** 16 random bytes in hex: a salt, for a caller that makes the fingerprint on this side (the terminal, tests) */
export const newSalt = (): string => randomBytes(16).toString("hex");

// ---- what a setBrainKey may say -------------------------------------------------------------------------------------------------

/** Why a base URL cannot be one a brain's key is sent to, or null when it can: "" (the provider's own), or an https URL — plain http only
 * for this machine itself — with no name or password in it, no query and no fragment, no {placeholder} left from a provider's how-to
 * (Qwen's {WorkspaceId}), and nothing shaped like an API key in its host (hostKeyShaped, brain-key.ts: the host AS TYPED, label by label,
 * before URL lower-cases it — Qwen's workspace id goes in the host, and so might a key pasted there) or in its path (pathKeyShaped: a
 * segment of nothing but 32 to 39 hex characters is an account's id — Cloudflare's — and passes). Together these are the base-URL rule,
 * brain-key.ts baseUrlKeyShaped, which the page mirrors. The words never repeat the URL: a key pasted into the wrong field is not said
 * back */
export function baseUrlProblem(raw: string): string | null {
  if (raw === "") return null;
  if (raw.length > MAX_URL) return `the base URL is at most ${MAX_URL} characters`;
  if (/[{}<>\s]/.test(raw)) return "the base URL still holds a placeholder or a space: put your own value in its place (Qwen's {WorkspaceId}, for one)";
  // a control character is never part of an address (URL quietly drops some, which could hide what was typed): refused, not repeated
  if (/[\x00-\x1f\x7f]/.test(raw)) return "the base URL holds a control character: type it again";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "the base URL is not a URL: it is the endpoint's base, like https://api.deepseek.com";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "the base URL is an https URL";
  if (hostKeyShaped(raw)) return KEY_SHAPED_WORDS.baseHost;
  if (u.protocol === "http:" && !isLoopback(u.hostname)) return "a base URL on another machine is https: plain http is only for this machine (localhost, 127.0.0.1, [::1]), where Ollama or vLLM run";
  if (u.username || u.password) return "the base URL carries no name or password: the key goes in the key field";
  if (u.search || u.hash) return "the base URL is the endpoint's base, without a query or a fragment";
  if (pathKeyShaped(u.pathname, u.hostname)) return KEY_SHAPED_WORDS.baseUrl;
  return null;
}

/** a URL's path, one segment at a time, as it was typed and as it reads once its %-escapes are undone (a key may be typed escaped) */
function pathSegments(u: URL): string[] {
  const out: string[] = [];
  for (const seg of u.pathname.split("/")) {
    if (!seg) continue;
    out.push(seg);
    try {
      const plain = decodeURIComponent(seg);
      if (plain !== seg) out.push(plain);
    } catch {
      // an escape that does not decode: the segment as typed is checked
    }
  }
  return out;
}

/** Whether the key typed in the key field is ALSO in the model or the base URL the owner signed: anywhere inside either, or — for a part of
 * it pasted on its own — a model, a label of the base URL's host as typed, or a segment of its path, of eight characters or more that is a
 * piece of the key. This is what still catches a key no shape gives away (a 32-hex key in a path segment, which the base-URL rule lets
 * pass as an account's id; a local server's own word). Compared as text and never said: the caller answers with a fixed sentence */
export function keyInSignedFields(action: Pick<SetBrainKey, "model" | "baseUrl">, apiKey: string): boolean {
  if (!apiKey) return false;
  if (action.model.includes(apiKey) || action.baseUrl.includes(apiKey)) return true;
  const piece = (s: string) => s.length >= 8 && apiKey.includes(s);
  if (piece(action.model)) return true;
  if (typedHost(action.baseUrl).split(".").some(piece)) return true;
  let u: URL | undefined;
  try {
    u = action.baseUrl ? new URL(action.baseUrl) : undefined;
  } catch {
    u = undefined;
  }
  return u ? pathSegments(u).some(piece) : false;
}

/** Why a setBrainKey cannot be signed or taken as it is, or null: the provider's id, the base URL (and no key-shaped segment in its path),
 * the model (and not shaped like a key: a key pasted into the model field would be signed, ledgered and sent to the provider as a model's
 * name — keyShaped, brain-key.ts), and the fingerprint and salt in their exact shapes ("" and "" take the key away — or, for a local
 * server, save its base URL and model with no key: applyBrainKey). Shapes only — whether
 * the desk holds that provider is the handler's to say. Used where the page prepares one (/api/account/prepare), before the door at the
 * key's own route, at the door before anything is written (exchange.ts take) and in the handler; the words never repeat a value */
export function setBrainKeyProblem(a: SetBrainKey): string | null {
  if (!PROVIDER.test(a.provider)) return "the provider is a brain's id, as the Brains place names it (deepseek, openai, claude …)";
  const url = baseUrlProblem(a.baseUrl);
  if (url) return url;
  if (a.model !== "" && keyShaped(a.model)) return KEY_SHAPED_WORDS.model;
  if (a.model !== "" && !MODEL_ID.test(a.model)) return "the model is its name as the provider gives it (letters, digits and . _ - : /, at most 80), or empty for the provider's default";
  if (a.keyHash === "") return a.salt === "" ? null : 'a signature that takes the key away has an empty salt too (keyHash "" and salt "")';
  if (!HASH.test(a.keyHash) || !SALT.test(a.salt)) return BODY_WORDS.hashShape;
  return null;
}

/** The words a setDesk is refused in at the door (and where the page prepares it) when it carries a key, or a brain that is not one:
 * fixed, so they never repeat a value */
export const DESK_KEY_WORDS = {
  brainShape: "the desk's brain is one object, {provider, model, effort, price}: what was sent in its place is not one, and it was not kept",
  brain: "the brain names something shaped like an API key where a provider, a model or an effort goes: a key goes in the Brains place's key field, never in the desk's settings. Nothing was kept",
  text: "the desk's settings hold something that looks like an API key (in its name, the objective or a charter): a key goes in the Brains place's key field, never in the desk's words. Nothing was kept",
  notJson: "the desk's value is not JSON, and it holds something shaped like an API key: a key goes in the Brains place's key field. Nothing was kept",
} as const;

const plainObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** whether any string in a parsed JSON value — every field's name and every value, however deep, in arrays too — passes `test`. Walked
 * with a stack of its own, not by recursion, so a value nested thousands deep is read to the bottom rather than overflowing */
function anyText(root: unknown, test: (s: string) => boolean): boolean {
  const stack: unknown[] = [root];
  while (stack.length) {
    const x = stack.pop();
    if (typeof x === "string") {
      if (test(x) || test(x.trim())) return true;
    } else if (Array.isArray(x)) {
      for (const y of x) stack.push(y);
    } else if (x && typeof x === "object") {
      for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
        if (test(k)) return true;
        stack.push(v);
      }
    }
  }
  return false;
}

/** Why a setDesk cannot be taken because it carries an API key — in the brain it names, or in its own words — or null.
 *
 * The desk's brain is chosen with a setDesk (hire, brain, objective, resume: desk.ts parseBrain), and the door writes every instruction it
 * takes to the ledger BEFORE the desk's handler reads it (exchange.ts take: the "taken" row, which a later run reads so as not to take it
 * twice). So a key pasted into the hiring form's model field would be on record — hash-chained, never to be cleaned — even though the desk
 * then refuses it. This is asked first, at the door and where the page prepares the draft (exchange.ts prepare, /api/account/prepare), and
 * answered with fixed words that never repeat the value (DESK_KEY_WORDS, KEY_SHAPED_WORDS):
 *   - the BRAIN — `value` itself for change "brain", `value.brain` for the others, when there is one: it must be one plain object (an array,
 *     a string, a number or null in its place is refused, as the desk refuses it), and every string in it, every field's name and every
 *     nested value, is asked whether it is shaped like a key (keyShaped, brain-key.ts, in full) — the model first, in the model's own words;
 *   - the desk's OWN WORDS — every string and every field's name anywhere in the value (the desk's name, the objective's sentence, a seat's
 *     name, a charter's three lines, and whatever else rides in it) — asked only whether it holds a key that says what it is (prefixedKey:
 *     sk-…, sk-or-…, gsk_…, xai-…, AIza…, a key block, a signed token). Not keyShaped: an objective may name a 0x address or a transaction
 *     hash, which are hex runs, and must be taken;
 *   - a value that is not JSON (the desk refuses it in its own words, "the desk's value is JSON") is asked whether it is shaped like a key at
 *     all: it is refused either way, and this way it is not written down first */
export function deskBrainKeyProblem(change: string, value: string): string | null {
  let v: unknown;
  try {
    v = value === "" ? undefined : JSON.parse(value);
  } catch {
    return keyShaped(value) ? DESK_KEY_WORDS.notJson : null;
  }
  const brain = change === "brain" ? v : plainObject(v) ? v.brain : undefined;
  if (brain !== undefined) {
    if (!plainObject(brain)) return DESK_KEY_WORDS.brainShape;
    if (typeof brain.model === "string" && keyShaped(brain.model.trim())) return KEY_SHAPED_WORDS.model;
    if (anyText(brain, keyShaped)) return DESK_KEY_WORDS.brain;
  }
  if (v !== undefined && anyText(v, prefixedKey)) return DESK_KEY_WORDS.text;
  return null;
}

// ---- the body of POST /api/account/brain-key ------------------------------------------------------------------------------------

export type BodyAnswer = { ok: true; envelope: Envelope; action: SetBrainKey; apiKey: string | undefined } | { ok: false; status: number; error: string };

/** Read the route's body: one JSON object, {envelope, apiKey}, and nothing else. Anything that is not exactly that is answered with one of
 * the fixed sentences above — the parser's own message is never kept (Node's JSON.parse quotes what it could not read, and that is the
 * key). The bytes are zeroed once read */
export function parseBrainKeyBody(raw: Buffer): BodyAnswer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return { ok: false, status: 400, error: BODY_WORDS.malformed };
  } finally {
    raw.fill(0);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, status: 400, error: BODY_WORDS.malformed };
  const body = parsed as Record<string, unknown>;
  if (Object.keys(body).some((k) => k !== "envelope" && k !== "apiKey")) return { ok: false, status: 400, error: BODY_WORDS.malformed };
  const envelope = body.envelope as Envelope | undefined;
  const action = envelope && typeof envelope === "object" ? (envelope.action as SetBrainKey | undefined) : undefined;
  if (!action || typeof action !== "object" || action.type !== "setBrainKey") return { ok: false, status: 400, error: BODY_WORDS.notSetKey };
  const apiKey = body.apiKey;
  if (apiKey !== undefined && typeof apiKey !== "string") return { ok: false, status: 400, error: BODY_WORDS.keyShape };
  return { ok: true, envelope: envelope!, action, apiKey: apiKey === undefined ? undefined : apiKey };
}

/** The checks before the door: the signed fields' shapes (exactly the fields setBrainKey signs, each in its shape — the words name a field,
 * never its value), the key's shape, the key nowhere in the model or the base URL (keyInSignedFields — a fixed sentence), and the key against
 * the fingerprint the owner signed. Whatever is refused here — nothing is staged, nothing is written, and the signature is not spent at the
 * door. Null: it may go on */
export function checkBeforeDoor(action: SetBrainKey, apiKey: string | undefined): { status: number; error: string } | null {
  const wrong = malformed(action);
  if (wrong) return { status: 400, error: `the signed setBrainKey is not well formed: ${wrong}` };
  if (action.keyHash === "") {
    if (apiKey !== undefined && apiKey !== "") return { status: 400, error: BODY_WORDS.clearWithKey };
    const shape = setBrainKeyProblem(action);
    return shape ? { status: 400, error: shape } : null;
  }
  if (apiKey === undefined || apiKey === "") return { status: 400, error: BODY_WORDS.noKey };
  if (!KEY.test(apiKey)) return { status: 400, error: BODY_WORDS.keyShape };
  if (typeof action.model === "string" && typeof action.baseUrl === "string" && keyInSignedFields(action, apiKey)) return { status: 400, error: BODY_WORDS.keyInField };
  const shape = setBrainKeyProblem(action);
  if (shape) return { status: 400, error: shape };
  return keyMatches(action.salt, apiKey, action.keyHash) ? null : { status: 409, error: BODY_WORDS.mismatch };
}

// ---- the key, staged between the route and the door's handler -------------------------------------------------------------------

/** The keys that arrived with a signature, held in this process's memory by the action's hash from the moment the route has checked them
 * until it answers — taken by the door's handler (once), deleted by the route whatever happened. Nothing else reads it, and it is never
 * written anywhere but the provider's key file */
export class BrainKeyStage {
  private readonly held = new Map<string, string>();

  /** false when a key is staged under this hash already (the same signed key sent twice at once) */
  stage(hash: string, key: string): boolean {
    if (this.held.has(hash)) return false;
    this.held.set(hash, key);
    return true;
  }

  /** the staged key, taken: it is no longer held */
  take(hash: string): string | undefined {
    const k = this.held.get(hash);
    this.held.delete(hash);
    return k;
  }

  has(hash: string): boolean {
    return this.held.has(hash);
  }

  drop(hash: string): void {
    this.held.delete(hash);
  }

  /** how many keys are held now (tests: none, once every route has answered) */
  get size(): number {
    return this.held.size;
  }
}

// ---- the file ---------------------------------------------------------------------------------------------------------------------

const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};
const lstatOf = (p: string): Stats | undefined => {
  try {
    return lstatSync(p);
  } catch {
    return undefined;
  }
};

/** the folder of the brains' keys, made if it is not there: only the user may open it (0700, set again each time), and neither it nor the
 * credentials folder above it may be a link — a key is never written through one */
function brainsDir(home: string, provider: string): string | Refusal {
  const root = realpathSync(resolve(home));
  const credentials = join(root, "credentials");
  const dir = join(credentials, "brains");
  for (const p of [credentials, dir]) {
    const st = lstatOf(p);
    if (st?.isSymbolicLink()) return no("E_ACCOUNT_CREDENTIAL", { venue: provider, message: `${relative(root, p)} in the home is a link: a brain's key is not written through one. Make it a plain folder and set the key again` });
    if (st && !st.isDirectory()) return no("E_ACCOUNT_CREDENTIAL", { venue: provider, message: `${relative(root, p)} in the home is not a folder: a brain's key cannot be written there` });
    if (!st) mkdirSync(p, { mode: 0o700 });
  }
  chmodSync(dir, 0o700);
  if (!inside(root, realpathSync(dir))) return no("E_ACCOUNT_CREDENTIAL", { venue: provider, message: "the brains' key folder leads out of the home: the key is not written" });
  return dir;
}

/** Write a provider's key file whole: a fresh temporary file beside it ("wx", 0600), the JSON, flushed to disk, chmod 0600, renamed over
 * the old one. A link where the file should be is refused (never followed, never replaced). Answers the file's absolute path. With no
 * `apiKey` (a local server's settings, saved with no key: applyBrainKey), the file holds only the base URL and the model — and whatever key
 * the old file held is gone with it */
export function writeBrainKey(home: string, provider: string, content: { apiKey?: string | undefined; baseUrl?: string | undefined; model?: string | undefined }): { ok: true; file: string; replaced: boolean } | Refusal {
  if (!PROVIDER.test(provider)) return no("E_ACCOUNT_BAD_ACTION", { message: "the provider is a brain's id, as the Brains place names it" });
  const dir = brainsDir(home, provider);
  if (isRefusal(dir)) return dir;
  const file = join(dir, `${provider}.json`);
  const st = lstatOf(file);
  if (st?.isSymbolicLink()) return no("E_ACCOUNT_CREDENTIAL", { venue: provider, message: `${brainKeyRef(provider)} is a link: it is not followed and not replaced. Remove it and set the key again` });
  if (st && !st.isFile()) return no("E_ACCOUNT_CREDENTIAL", { venue: provider, message: `${brainKeyRef(provider)} is not a file: the key cannot be written there` });
  const text = `${JSON.stringify({ ...(content.apiKey ? { apiKey: content.apiKey } : {}), ...(content.baseUrl ? { baseUrl: content.baseUrl } : {}), ...(content.model ? { model: content.model } : {}) })}\n`;
  const tmp = join(dir, `.${provider}.json.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const fd = openSync(tmp, "wx", 0o600);
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  // the folder's entry for the renamed file, flushed too where the system allows it
  try {
    const d = openSync(dir, "r");
    try {
      fsyncSync(d);
    } finally {
      closeSync(d);
    }
  } catch {
    // a folder that cannot be flushed on this system: the file itself was
  }
  return { ok: true, file, replaced: st !== undefined };
}

/** Take a provider's key file away (keyHash ""): removed if it is there; a link is refused as it is for writing */
export function removeBrainKey(home: string, provider: string): { ok: true; removed: boolean } | Refusal {
  if (!PROVIDER.test(provider)) return no("E_ACCOUNT_BAD_ACTION", { message: "the provider is a brain's id, as the Brains place names it" });
  const root = realpathSync(resolve(home));
  const file = join(root, BRAIN_KEY_DIR, `${provider}.json`);
  for (const p of [join(root, "credentials"), join(root, BRAIN_KEY_DIR)]) {
    if (lstatOf(p)?.isSymbolicLink()) return no("E_ACCOUNT_CREDENTIAL", { venue: provider, message: `${relative(root, p)} in the home is a link: nothing is removed through one` });
  }
  const st = lstatOf(file);
  if (!st) return { ok: true, removed: false };
  if (st.isSymbolicLink()) return no("E_ACCOUNT_CREDENTIAL", { venue: provider, message: `${brainKeyRef(provider)} is a link: it is not followed and not removed from here` });
  if (!st.isFile()) return no("E_ACCOUNT_CREDENTIAL", { venue: provider, message: `${brainKeyRef(provider)} is not a file` });
  rmSync(file);
  return { ok: true, removed: true };
}

// ---- the environment that wins over the file --------------------------------------------------------------------------------------

/** The variables in the service's environment a brain reads BEFORE its key file, by provider — where they worked before the Brains place
 * (brain-claude.ts, brain-openai.ts), they still do. A key set on the page is written all the same, and the answer says the variable wins.
 * A brain that says so itself (Brain.about().envWins) is believed first; this list is for one that does not */
export const BRAIN_KEY_ENV: Readonly<Record<string, readonly string[]>> = {
  claude: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
  openai: ["OPENAI_API_KEY"],
};

/** the variable that wins over the provider's key file now, if one holds anything */
export function envWinsFor(provider: string, env: NodeJS.ProcessEnv, names: Readonly<Record<string, readonly string[]>> = BRAIN_KEY_ENV): string | undefined {
  return (names[provider] ?? []).find((n) => (env[n] ?? "").trim() !== "");
}

// ---- the door's handler -------------------------------------------------------------------------------------------------------

/** a brain as this handler needs it: its id and label, its standing, and what it says of itself where it says it (desk.ts Brain) */
export interface KeyedBrain {
  readonly id: string;
  readonly label: string;
  ready(model?: string): BrainStatus;
  about?(): BrainAbout;
}

/** the variable that wins over this brain's key file: what the brain says of itself (about().envWins), else the list above, in `env` */
export function envWinsOf(brain: KeyedBrain, env: NodeJS.ProcessEnv): string | undefined {
  return brain.about ? brain.about().envWins : envWinsFor(brain.id, env);
}

/** The variable that BLOCKS this brain's key file, as the brain says of itself (about().envBlocks): one it does not use and that keeps it
 * from reading the file either — Claude's ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN beside an ANTHROPIC_BASE_URL that points away from
 * Anthropic, a gateway's credential (brain-claude.ts). A key saved on the page is written all the same, and is read once the variable and
 * the base URL are removed and the service restarted. Undefined for a brain that says nothing of it */
export function envBlocksOf(brain: KeyedBrain): string | undefined {
  return brain.about?.().envBlocks;
}

export interface BrainKeyDone {
  ok: true;
  kind: "account";
  /** what the ledger's row says: the provider, the fingerprint, the base URL and the model — never the key, never its tail. The door's
   * answer carries no path: where the file is, the brain's own standing says */
  summary: string;
  provider: string;
  fingerprint: string;
  cleared: boolean;
  /** a local server's base URL and model saved with no key (keyHash "" beside them, for a brain that ignores the key): the file was
   * written, holding no key */
  keyless?: boolean | undefined;
  /** whether a key file was written or removed: false only for a clear that found no file to remove — then the key the brain uses is the
   * one it used before, and the desk is not told that it changed */
  changed: boolean;
}

/** where a brain still finds a key once its file under credentials/brains is gone, in words for the ledger's row: what the brain says of
 * its own standing (`how` — "the key file credentials/openai/api-key.json · api.openai.com", "OPENAI_API_KEY in the service's environment
 * · …"), which never holds a key. Empty when it is not ready */
function stillReads(brain: KeyedBrain): string {
  const st = brain.ready();
  if (!st.ok) return "";
  const from = brain.about?.().keyFrom;
  if (from === "older-file") return `; ${brain.label} is still ready: it reads its key from the older file${st.how ? ` (${st.how})` : ""}`;
  if (from === "env") return `; ${brain.label} is still ready: it reads its key from the service's environment${st.how ? ` (${st.how})` : ""}`;
  return `; ${brain.label} is still ready${st.how ? ` (${st.how})` : ""}`;
}

/** The door's handler for setBrainKey, once the signature, the owner and the nonce have been checked: the provider is one the desk holds,
 * the fields have their shapes, and the key staged for this signature (taken by the caller from the BrainKeyStage) is written to the
 * provider's file — or, for keyHash "", the file is removed. Except for a brain that ignores the key (about().keyOptional: Ollama, vLLM):
 * there keyHash "" beside a base URL or a model saves those two with no key (writeBrainKey with no apiKey) — so the owner never has to
 * make up a key to point a local server at another address or name its model — and only keyHash "" with both empty removes the file. A
 * setBrainKey that arrived without its key (sent to POST /api/exchange on its own) sets nothing */
export function applyBrainKey(home: string, brains: ReadonlyArray<KeyedBrain>, action: SetBrainKey, staged: string | undefined): BrainKeyDone | Refusal {
  const shape = setBrainKeyProblem(action);
  if (shape) return no("E_ACCOUNT_BAD_ACTION", { message: shape });
  const brain = brains.find((b) => b.id === action.provider);
  if (!brain) return no("E_ACCOUNT_BAD_ACTION", { message: `"${action.provider}" is not a brain this desk holds: the Brains place lists the ones it does (${brains.map((b) => b.id).join(", ") || "none"})` });
  const said = `${action.baseUrl ? ` · base URL ${action.baseUrl}` : ""}${action.model ? ` · model ${action.model}` : ""}`;
  if (action.keyHash === "" && brain.about?.().keyOptional === true && (action.baseUrl !== "" || action.model !== "")) {
    // a local server's settings, with no key: written whole, a key the old file held included in what is replaced
    const w = writeBrainKey(home, action.provider, { baseUrl: action.baseUrl, model: action.model });
    if (isRefusal(w)) return w;
    return { ok: true, kind: "account", summary: `the ${brain.label} settings were saved with no key (${brainKeyRef(action.provider)})${said}`, provider: action.provider, fingerprint: "", cleared: false, keyless: true, changed: true };
  }
  if (action.keyHash === "") {
    const r = removeBrainKey(home, action.provider);
    if (isRefusal(r)) return r;
    // what happened, no more: a file removed is "taken away"; no file is "nothing to take away" — and either way, where the brain still
    // finds a key, if it does (an older file, the environment, a local server that needs none)
    const still = stillReads(brain);
    const summary = r.removed ? `the ${brain.label} key was taken away (${brainKeyRef(action.provider)} removed)${still}` : `nothing to take away for ${brain.label}: there was no ${brainKeyRef(action.provider)}${still}`;
    return { ok: true, kind: "account", summary, provider: action.provider, fingerprint: "", cleared: true, changed: r.removed };
  }
  if (staged === undefined) return no("E_ACCOUNT_BAD_ACTION", { message: "the key did not arrive with this signature: a key is set from the Brains place, which sends it beside the signature (POST /api/account/brain-key). Nothing was written" });
  // checked before the door already; checked again here, where it is written, so that nothing but the key that was signed is ever written
  if (!KEY.test(staged) || !keyMatches(action.salt, staged, action.keyHash)) return no("E_ACCOUNT_BAD_ACTION", { message: BODY_WORDS.mismatch });
  const w = writeBrainKey(home, action.provider, { apiKey: staged, baseUrl: action.baseUrl, model: action.model });
  if (isRefusal(w)) return w;
  const fingerprint = fingerprintOf(action.keyHash);
  return { ok: true, kind: "account", summary: `the ${brain.label} key was set (fingerprint ${fingerprint})${said}`, provider: action.provider, fingerprint, cleared: false, changed: true };
}
