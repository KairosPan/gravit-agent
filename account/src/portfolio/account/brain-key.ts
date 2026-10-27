/** WHERE A BRAIN'S KEY GOES, said so a person can do it: the fix the desk's standing carries when a brain is not ready (BrainFix, desk.ts),
 * shared by the Claude brain (brain-claude.ts) and every OpenAI-format one (brain-openai.ts, one per preset in brains.ts).
 *
 * A brain reads its key from one file in the home, readable by the user alone, read again at every check — so a key put there needs no
 * restart. Each provider has its own: <home>/credentials/brains/<id>.json (brainKeyRef) — {"apiKey", "baseUrl"?, "model"?} — so OpenAI,
 * DeepSeek, Grok and the rest can all hold a key at once, and a venue that happens to be called "openai" never shares a file with a brain.
 * Two older files are still read, untouched, where the new one is not there yet: credentials/anthropic/api-key.json for Claude and
 * credentials/openai/api-key.json for OpenAI — so a key the owner put there before keeps working with nothing done. The new file, once it
 * is there, is the one read (and the one a problem is said about), even if the old one still holds a key: the owner's latest word wins.
 *
 * The fix names that file by its absolute path, says in one plain sentence what to do with it, and, where a command does it, gives
 * the command whole: run as it is written, it does the thing, with no value in it the owner must first replace. So a missing file is made
 * with an EMPTY template (the key's place is a pair of quotes with nothing between them, never a sample key that a pasted command would
 * leave behind looking like one) and opened in an editor, and the readiness checks refuse that empty template, and the old examples, as
 * "the example" — never as a key. A file other users can read is fixed with chmod; a file that is there but wrong is opened again. A key in
 * the service's environment is the one case no command fixes from here: the variable is set where the service is started, and a restart
 * is needed, which the fix says.
 *
 * What the page may be shown of a key is its masked tail (keyTail: "…" and the last four characters, and only for a key long enough that
 * four characters say little about it) — never the key, never more of it. A base URL in plain http is taken only for this machine's own
 * loopback (isLoopback): a key sent as a bearer over http to any other host would cross the network in the clear. Where words name a base
 * URL's host and that host looks like a key, they say "another address" instead (hostSaid).
 *
 * What a key LOOKS like (keyShaped) is decided here once, for every place that must refuse one where it does not belong — a model's name,
 * a base URL's path, a provider's id: the desk (desk.ts parseBrain), the brains (brain-openai.ts, brain-claude.ts), the key route and the
 * door (brain-keys.ts, server.ts), and the page (ui/brains.js brKeyShaped, a mirror of it). A base URL is judged by its own rule
 * (baseUrlKeyShaped, mirrored by the page's brBaseKeyShaped): its host as it was typed, label by label, and its path — where a segment that
 * is nothing but 32 to 39 hex characters is an account's id (Cloudflare's), not a key. The desk's own words (its name, the objective, the
 * charters), which may hold a 0x address, are asked only whether they hold a key that says what it is (prefixedKey). And a provider's own
 * words are shown only scrubbed of anything key-shaped (scrubbed), the key in use first, and every piece of it eight characters or longer.
 *
 * Paths are single-quoted for the shell (a quote inside one closed, escaped and opened again), so a home with spaces or quotes in its name
 * still runs as written. On a Mac the editor is TextEdit (`open -e`); elsewhere the owner's $EDITOR, else nano.
 */
import { lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readSecretFile } from "../live/credentials.ts";
import type { BrainFix } from "./desk.ts";

/** the folder, inside the home, where each brain's key file lives: one file per provider, named by its id */
export const BRAIN_KEY_DIR = "credentials/brains";
/** a provider id as a file's name may carry it: lower-case letters, digits and dashes, a letter first */
export const BRAIN_ID = /^[a-z][a-z0-9-]{0,31}$/;
/** the key file of one brain, relative to the home: credentials/brains/<id>.json. An id that could leave the folder is never made into a
 * path — it throws, since every id here comes from the presets (brains.ts), never from a request */
export function brainKeyRef(id: string): string {
  if (!BRAIN_ID.test(id)) throw new Error(`"${id.slice(0, 40)}" is not a brain's id`);
  return `${BRAIN_KEY_DIR}/${id}.json`;
}

/** whether a file (or a link) is at this path inside the home, without following it: a link there is "there" — read and refused by the
 * secret file's own checks — and never a reason to read an older file instead */
export function present(home: string, ref: string): boolean {
  try {
    lstatSync(keyFileAt(home, ref));
    return true;
  } catch {
    return false;
  }
}

/** What the page may be shown of a key: "…" and its last four characters — and only "…" for a key shorter than sixteen, where four
 * characters would be a quarter of it or more. Never the key; undefined for no key */
export function keyTail(key: string | undefined): string | undefined {
  const k = (key ?? "").trim();
  if (!k) return undefined;
  return k.length >= 16 ? `…${k.slice(-4)}` : "…";
}

// ---- what a key looks like -------------------------------------------------------------------------------------------------------

/** Keys that say what they are by their first letters. memory.ts's own list (PREFIXED: Stripe-style sk_/rk_/pk_ live and test keys,
 * sk-…, AWS's AKIA…, GitHub's gh?_…, Slack's xox?-…, Google's AIza…) and the model providers' that the Brains place reaches: sk- (OpenAI,
 * Anthropic's sk-ant-, DeepSeek, Kimi, Qwen), sk-or- (OpenRouter), xai- (xAI), gsk_ (Groq), AIza (Gemini — from 20 characters on here,
 * where memory.ts waits for 30, so a cut-off one is caught too). Each needs a run of key characters after its prefix, so a model's name
 * that merely starts the same way ("xai-org/grok-1", "sk-…" with a word after it) is not one: xai- and gsk_ are followed by letters and
 * digits only in a real key, never by a dash-separated word */
const PREFIXED_KEY = /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}|\bsk-or-[A-Za-z0-9_-]{8,}|\bsk-[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{20,}|\bxai-[A-Za-z0-9]{20,}|\bgsk_[A-Za-z0-9]{20,}/;
/** a key block (PEM, SSH, PGP) and a signed token (a JWT), as memory.ts knows them */
const KEY_BLOCK = /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|KEY BLOCK|ENCRYPTED|OPENSSH)[A-Z0-9 ]*-----/;
const JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/;
/** thirty-two or more hex characters in a row: DeepSeek's, Qwen's and OpenRouter's keys are hex after their prefix, Together's are hex
 * alone. No model's name holds such a run */
const HEX_RUN = /(?<![0-9a-fA-F])[0-9a-fA-F]{32,}(?![0-9a-fA-F])/;
/** A base URL's path segment that is NOTHING BUT 32 to 39 hex characters: an account's or a gateway's id, never a key on its own there.
 * Cloudflare puts its 32-hex account id in the path of its OpenAI-compatible endpoints — https://api.cloudflare.com/client/v4/accounts/
 * <account id>/ai/v1 (Workers AI) and https://gateway.ai.cloudflare.com/v1/<account id>/<gateway>/openai (AI Gateway): the shapes the
 * review named from Cloudflare's docs as known before this round, not re-read in brains-web.md — and a check that refused those addresses
 * as "a key in the path" would be a refusal made up. A key is still caught there when it says what it is by its
 * prefix (sk-…, sk-or-…, xai-…, gsk_…, AIza…), when it is a longer hex run (Together's 64 hex), when the segment holds anything beside the
 * hex (fw_<hex>, <hex>.<hex>), and — whatever its shape — when it is the key typed in the key field (brain-keys.ts keyInSignedFields).
 * Only in a path: the same 32 hex in a host's label, a model's name or the desk's settings is still a key */
const SHORT_HEX_SEGMENT = /^[0-9a-fA-F]{32,39}$/;
/** a run of base64's own characters (+ = /) thirty-two or more long that holds a + or an =: what a standard-base64 secret looks like.
 * A model's name never holds either character */
const B64_RUN = /[A-Za-z0-9+/=_-]{32,}/g;

/** lower case, upper case, a digit: which of the three a character is (0 for anything else) */
const charClass = (c: string): number => (c >= "a" && c <= "z" ? 1 : c >= "A" && c <= "Z" ? 2 : c >= "0" && c <= "9" ? 3 : 0);
/** how often a stretch changes between lower case, upper case and digits from one character to the next, 0 to 1 */
const switchRate = (s: string): number => {
  let n = 0;
  for (let i = 1; i < s.length; i++) if (charClass(s[i]!) !== charClass(s[i - 1]!)) n++;
  return s.length > 1 ? n / (s.length - 1) : 0;
};

/** A run of letters, digits, "-" and "_", thirty-two or more long, that reads as random rather than as words: somewhere in it a stretch of
 * twelve or more letters and digits with no "-" or "_" (a model's name is words and numbers joined by dashes, each part short) that holds
 * letters AND digits, and is either thirty-two long or more, or changes between lower case, upper case and digits at least two times in
 * five (a random key does so about three times in five; "DeepSeek-R1-Distill-Qwen-32B-GGUF", "NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO"
 * and every model id the presets suggest are words, and pass). memory.ts's longSecret is deliberately NOT used here: written for notes,
 * it counts any forty-character run with mixed case and digits and a dash or a slash, and so would refuse real model ids such as
 * "NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO" (Together) — a key-shaped check that refused a real model would be a refusal made up */
function randomRun(run: string): boolean {
  if (run.length < 32) return false;
  for (const part of run.split(/[-_]+/)) {
    if (part.length < 12 || !/[A-Za-z]/.test(part) || !/[0-9]/.test(part)) continue;
    if (part.length >= 32 || switchRate(part) >= 0.4) return true;
  }
  return false;
}

/** WHETHER SOME TEXT HOLDS WHAT LOOKS LIKE AN API KEY — the one check the account, the routes and the page (ui/brains.js brKeyShaped mirrors
 * it) share, so a key pasted into the wrong field (a model's name, a base URL's path, a provider's id) is refused before it can land
 * anywhere a key must never be: the ledger, the room, desk.json, a response, or the model field of a request sent to another provider.
 * True for: a key that says what it is by its prefix (PREFIXED_KEY), a key block or a signed token, thirty-two or more hex characters in a
 * row, a standard-base64 run with a + or an =, and any run of thirty-two or more key characters that reads as random (randomRun). False for
 * every model id the presets suggest and the long vendor/model names OpenRouter, Together and Hugging Face use. Whoever refuses on it says
 * so in words that NEVER repeat the value: "it looks like an API key", never the thing itself */
export function keyShaped(s: string): boolean {
  const t = String(s ?? "");
  if (!t) return false;
  if (PREFIXED_KEY.test(t) || KEY_BLOCK.test(t) || JWT.test(t) || HEX_RUN.test(t)) return true;
  for (const m of t.matchAll(B64_RUN)) {
    const run = m[0];
    if (/[+=]/.test(run) && /[A-Za-z]/.test(run) && /[0-9]/.test(run)) return true;
    // "/" separates a vendor from its model: each side is judged as a run of its own
    if (run.split("/").some(randomRun)) return true;
  }
  return false;
}

/** A key that SAYS what it is: a provider's prefix (PREFIXED_KEY: sk-…, sk-or-…, xai-…, gsk_…, AIza…, Stripe's, AWS's, GitHub's, Slack's),
 * a key block (PEM, SSH, PGP) or a signed token (a JWT) — and nothing that is a key by its shape alone (no hex run, no random-looking run).
 * The narrow check for the desk's own words — its name, the objective's sentence, a seat's name and charter — which may well hold a 0x
 * address or a transaction hash (hex, 40 and 64 long) and must still be taken: keyShaped would refuse those, this does not. Whoever refuses
 * on it says so in fixed words that never repeat the value (brain-keys.ts deskBrainKeyProblem) */
export function prefixedKey(s: string): boolean {
  const t = String(s ?? "");
  return t !== "" && (PREFIXED_KEY.test(t) || KEY_BLOCK.test(t) || JWT.test(t));
}

/** a field's name as a refusal may say it back: a plain identifier (a letter, then letters, digits and "_", 32 at most) that keyShaped does
 * not call a key. Anything else — a key sent as a field's name, text with quotes or spaces in it — is said as "a field", never by name */
export function plainFieldName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(name) && !keyShaped(name);
}

// ---- a key in a base URL --------------------------------------------------------------------------------------------------------

/** %-escapes undone, or the text as it is where they do not decode (a lone "%") */
const decoded = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** A base URL's host AS IT WAS TYPED: what stands between the scheme's "//" (any number of "/" or "\", as URL reads them) and the first "/",
 * "\", "?" or "#", without a name or password before the last "@" and without a ":port" ([…] kept whole for an IPv6 address). Taken from the
 * raw text, before URL lower-cases it and turns it into punycode: a key's mixed case is part of how it reads as random (randomRun), and a
 * lower-cased key reads less like one. Tabs and line breaks, which URL drops, are dropped first. "" when the text has no scheme */
export function typedHost(raw: string): string {
  // as URL reads it: tabs and line breaks anywhere dropped, then C0 controls and spaces at either end — a control character in front must
  // not hide the host from this reading and leave it to URL's lower-cased one
  const t = String(raw ?? "").replace(/[\t\n\r]/g, "").replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "");
  const m = /^[A-Za-z][A-Za-z0-9+.-]*:[/\\]*([^/\\?#]*)/.exec(t);
  if (!m) return "";
  const authority = m[1]!;
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end >= 0 ? host.slice(0, end + 1) : host;
  }
  const colon = host.lastIndexOf(":");
  return colon >= 0 ? host.slice(0, colon) : host;
}

/** Whether a base URL's HOST holds what looks like an API key (keyShaped, in full: no hex run is excused in a host). Asked of the host as
 * typed (typedHost) whole — a signed token's dots are part of it — and one "."-separated label at a time, each also with its %-escapes
 * undone (URL undoes them in a host); and of the host as URL reads it, label by label, for a host URL reads differently than it was typed.
 * Qwen's own how-to puts the owner's workspace id in the host (https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/…), so a key pasted
 * there is a mistake waiting to happen: sent, it would go out in clear text in the DNS query and the TLS handshake before any request */
export function hostKeyShaped(raw: string): boolean {
  const host = typedHost(raw);
  const parts = [host, ...host.split(".")];
  try {
    parts.push(...new URL(String(raw ?? "").trim()).hostname.split("."));
  } catch {
    // not a URL: the host as typed was taken
  }
  return parts.some((p) => p !== "" && (keyShaped(p) || keyShaped(decoded(p))));
}

/** Whether a base URL's PATH holds what looks like an API key: keyShaped of the path as typed and of the path with each segment's
 * %-escapes undone (a key may be typed escaped) — except that a segment which is nothing but 32 to 39 hex characters (SHORT_HEX_SEGMENT:
 * Cloudflare's account id) is left out first, as typed and as decoded. The path is judged whole, not only a segment at a time, so a
 * standard-base64 key whose "/" made two segments of it is still seen whole */
export function pathKeyShaped(pathname: string, host = ""): boolean {
  const segs = String(pathname ?? "").split("/");
  const excused = (i: number, s: string): boolean => SHORT_HEX_SEGMENT.test(s) && cloudflareIdAt(segs, i, host);
  const typed = segs.map((s, i) => (excused(i, s) ? "" : s)).join("/");
  const plain = segs
    .map((s, i) => {
      const d = decoded(s);
      return excused(i, d) ? "" : d;
    })
    .join("/");
  return keyShaped(typed) || keyShaped(plain);
}
/** Whether path segment i is where Cloudflare puts its 32-hex account id, and only there: on api.cloudflare.com the segment right after
 * "accounts" (/client/v4/accounts/<id>/ai/v1), on gateway.ai.cloudflare.com the first segment after "v1" (/v1/<id>/<gateway>/openai). A
 * bare hex run anywhere else — any other host, any other place — is judged in full, so a key split into hex segments is never excused */
function cloudflareIdAt(segs: string[], i: number, host: string): boolean {
  const h = String(host ?? "").toLowerCase();
  if (h === "api.cloudflare.com") return i > 0 && String(segs[i - 1] ?? "").toLowerCase() === "accounts";
  if (h === "gateway.ai.cloudflare.com") return i === 2 && String(segs[1] ?? "").toLowerCase() === "v1";
  return false;
}

/** THE BASE-URL RULE — baseUrlKeyShaped(raw): whether a base URL holds what looks like an API key anywhere a key could be pasted. The page
 * mirrors it as ui/brains.js brBaseKeyShaped, and the two must answer the same for every text (a mirror test holds them together). Exactly:
 *   1. the text, trimmed; "" → false.
 *   2. not a URL (new URL throws) → keyShaped(the text).
 *   3. the HOST (hostKeyShaped): typedHost(text) — the host as typed, from the raw text before URL lower-cases it — whole and split on ".",
 *      each piece as it is and %-decoded; and new URL(text).hostname split on "." — any piece keyShaped → true. No hex run is excused here.
 *   4. the PATH (pathKeyShaped): new URL(text).pathname split on "/"; a segment that is nothing but 32–39 hex characters (as typed, or once
 *      %-decoded) is replaced by "" — never a key on its own in a path (Cloudflare's account id); then keyShaped of the segments joined
 *      again with "/" as typed, or of them each %-decoded and joined → true.
 *   5. the rest a URL may carry: its name, its password, its query and its fragment (url.username, .password, .search, .hash), each as it
 *      is and %-decoded — any keyShaped → true. (The base URL refuses all four anyway; checked here so that the words say "a key".)
 * Used by baseUrlProblem (brain-keys.ts: the route, the door, /prepare) and parseBaseUrl (brain-openai.ts: the brain itself) — each of which
 * says, in its own fixed words, whether it was the host or the path */
export function baseUrlKeyShaped(raw: string): boolean {
  const t = String(raw ?? "").trim();
  if (!t) return false;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return keyShaped(t);
  }
  if (hostKeyShaped(t) || pathKeyShaped(u.pathname, u.hostname)) return true;
  return [u.username, u.password, u.search, u.hash].some((x) => x !== "" && (keyShaped(x) || keyShaped(decoded(x))));
}

// ---- a provider's words, scrubbed ---------------------------------------------------------------------------------------------------

/** the key's characters a run of a provider's words is read in, for a piece of the key: letters, digits and _ - + = — a run stops at a
 * space, "*", ".", "%" and every other mark, so "k1.k2" and "abcd****wxyz" are each read as two runs */
const PIECE_RUN = /[A-Za-z0-9_+=-]+/g;
/** how long a stretch of the key must be to count as a piece of it */
const PIECE = 8;

/** Every stretch of the text that is part of a piece of `key` eight characters or longer, masked. First, every place where the text holds
 * any eight-character window of the key is marked; then each run of key characters (PIECE_RUN) that holds a marked place is marked whole,
 * so a half-masked word never shows the rest of a key; then each marked stretch becomes one "…". Since "…" is never in a key (printable
 * ASCII), no eight characters of the key are left anywhere in the answer — a cut-off echo (the last twelve, a middle sixteen, the first ten
 * before "****"), and one cut at a "." alike */
function piecesMasked(text: string, key: string): string {
  if (key.length < PIECE || text.length < PIECE) return text;
  const windows = new Set<string>();
  for (let i = 0; i + PIECE <= key.length; i++) windows.add(key.slice(i, i + PIECE));
  const marked = new Uint8Array(text.length);
  let any = false;
  for (let i = 0; i + PIECE <= text.length; i++) {
    if (!windows.has(text.slice(i, i + PIECE))) continue;
    marked.fill(1, i, i + PIECE);
    any = true;
  }
  if (!any) return text;
  for (const m of text.matchAll(PIECE_RUN)) {
    const a = m.index ?? 0;
    const b = a + m[0].length;
    if (marked.subarray(a, b).includes(1)) marked.fill(1, a, b);
  }
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (!marked[i]) out += text[i];
    else if (i === 0 || !marked[i - 1]) out += "…";
  }
  return out;
}

/** A provider's words, with anything key-shaped masked: the key itself wherever it appears (an endpoint may echo part of a request back);
 * with the key in use given, every piece of it eight characters or longer, wherever it appears, whatever is around it (piecesMasked: the
 * last twelve, a middle sixteen, a cut at "*" or "." — "…"); a bearer token; any word that starts like a key — sk-, sk-or-, xai-, gsk_,
 * key-, token- (said as "sk-…") and AIza… — and any run that keyShaped calls a key (a long hex run, a random-looking run: "…"). So a
 * refusal can be shown on the page and written in the room as the provider said it, and never carries a secret, even a cut-off echo of
 * one. Words with no key in them come back as they were (their spaces made single) */
export function scrubbed(s: string, key: string): string {
  const p = String(s ?? "").replace(/\s+/g, " ").trim();
  return piecesMasked(key ? p.split(key).join("…") : p, key ?? "")
    .replace(/\bBearer\s+\S+/gi, "Bearer …")
    .replace(/\b(sk-or|sk|xai|gsk|key|token)[-_][A-Za-z0-9*_-]{6,}/gi, "$1-…")
    .replace(/\bAIza[0-9A-Za-z_-]{6,}/g, "AIza…")
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, (run) => (keyShaped(run) ? "…" : run));
}

/** whether some text holds a piece of `key` eight characters or longer (or the key itself, however short): compared in memory, never said */
export function holdsPieceOf(text: string, key: string): boolean {
  if (!key || !text) return false;
  if (text.includes(key)) return true;
  if (key.length < PIECE) return false;
  for (let i = 0; i + PIECE <= key.length; i++) if (text.includes(key.slice(i, i + PIECE))) return true;
  return false;
}

/** this machine's own loopback, by a URL's hostname: localhost, 127.0.0.0/8, ::1 — the only hosts a key may be sent to over plain http */
export function isLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "[::1]" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** A base URL's host as words may name it: its host (with the port), or "another address" when that host looks like a key — as URL reads it
 * or as it was typed (hostKeyShaped). Words with a host in them reach the page, the room and a seat over MCP; a key in a host is never said
 * back through them. "an address that is not a URL" when it is not one */
export function hostSaid(url: string): string {
  let host: string;
  try {
    host = new URL(String(url ?? "").trim()).host;
  } catch {
    return "an address that is not a URL";
  }
  return keyShaped(host) || hostKeyShaped(url) ? "another address" : host;
}

/** one argument, quoted for a POSIX shell: inside single quotes nothing is special but the quote itself */
export const shq = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

/** the key file's absolute path */
export const keyFileAt = (home: string, ref: string): string => resolve(join(home, ref));

/** the command that opens the file in an editor: TextEdit on a Mac, the owner's editor elsewhere */
export function editCommand(file: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "darwin" ? `open -e ${shq(file)}` : `\${EDITOR:-nano} ${shq(file)}`;
}

/** The command that makes a missing key file: its folder, then the file holding the empty template, readable by the user alone (umask 077
 * inside a subshell, so the shell's own umask is left as it was), then opened in the editor. `template` is one line of JSON with empty
 * values and no single quote, printed by printf (its "\n" ends the line) */
export function createCommand(file: string, template: string, platform: NodeJS.Platform = process.platform): string {
  return `mkdir -p ${shq(dirname(file))} && (umask 077 && printf ${shq(`${template}\\n`)} > ${shq(file)}) && ${editCommand(file, platform)}`;
}

/** the fix for a key file that is not there: make it, then paste the key between the quotes */
export function noKeyFix(file: string, template: string, words: string, platform?: NodeJS.Platform): BrainFix {
  return { code: "no-key", file, command: createCommand(file, template, platform), restart: false, words };
}

/** the fix for a key file that holds the empty template or an example: open it and put the key in */
export function exampleFix(file: string, words: string, platform?: NodeJS.Platform): BrainFix {
  return { code: "example", file, command: editCommand(file, platform), restart: false, words };
}

/** The fix for a key file that is there but cannot be used. Its mode (other users can read it): chmod 600. Its content (not JSON, not one
 * object, a field missing): opened again. A link out of the home, or something that is not a file: no command from here, only words */
export function unusableFix(file: string, why: "mode" | "content" | "other", words: string, platform?: NodeJS.Platform): BrainFix {
  if (why === "mode") return { code: "unusable", file, command: `chmod 600 ${shq(file)}`, restart: false, words };
  if (why === "content") return { code: "unusable", file, command: editCommand(file, platform), restart: false, words };
  return { code: "unusable", file, restart: false, words };
}

/** the fix for a key in the service's environment that is the example: no command, a restart */
export function envFix(file: string, words: string): BrainFix {
  return { code: "env", file, restart: true, words };
}

/** The fix for a key the API refused. From the key file: open it and replace the key — the next cycle reads it, no restart. From the
 * service's environment: set a working key where the service is started and restart it (or take the variable away and use the file) */
export function rejectedFix(file: string, fromEnv: string | undefined, who: string, platform?: NodeJS.Platform): BrainFix {
  if (fromEnv) return { code: "rejected", file, restart: true, words: `${who} refused the key in ${fromEnv}, in the service's environment. Set a working key there and restart the service — or remove ${fromEnv} and put the key in the file below instead, which is read at the next cycle with no restart.` };
  return { code: "rejected", file, command: editCommand(file, platform), restart: false, words: `${who} refused the key in the file below. Open it, replace the key between the quotes with a working one and save: the next cycle reads it, no restart.` };
}

/** Which way a key file that loadKeyFile refused is wrong, from the refusal's own detail and words (live/credentials.ts readSecretFile and
 * loadKeyFile): "missing" (no file), "mode" (other users can read it), "content" (not JSON, not one object, a field missing or empty), or
 * "other" (a link out of the home, not a file) */
export function fileProblem(r: { message?: string | undefined; detail?: Record<string, unknown> | undefined }): "missing" | "mode" | "content" | "other" {
  const d = r.detail ?? {};
  if (d.expected !== undefined) return "missing";
  if (d.mode !== undefined) return "mode";
  if (Array.isArray(d.missing) || /is not JSON|should hold one JSON object/.test(r.message ?? "")) return "content";
  return "other";
}

/** a key file whose field is there and empty (the template as it was made): read only to tell that from a file that lacks the field, and
 * nothing from it is said */
export function emptyField(home: string, ref: string, field: string): boolean {
  const f = readSecretFile(home, ref, "brain", "");
  if ("ok" in f) return false;
  try {
    const j = JSON.parse(f.text) as Record<string, unknown>;
    return !!j && typeof j === "object" && typeof j[field] === "string" && (j[field] as string).trim() === "";
  } catch {
    return false;
  }
}

/** An error a brain throws when the API refused its key: the desk keeps it as the brain's fault until the next answered call (desk.ts
 * ask), so the standing says "not ready" with this fix instead of a healthy brain that never answers */
export const E_BRAIN_KEY_REJECTED = "E_BRAIN_KEY_REJECTED";
export interface BrainKeyRejected extends Error {
  code: typeof E_BRAIN_KEY_REJECTED;
  /** who refused it, as a person names them: "Anthropic", "api.deepseek.com" */
  who: string;
  fix: BrainFix;
}
export function keyRejected(message: string, who: string, fix: BrainFix): BrainKeyRejected {
  return Object.assign(new Error(message), { code: E_BRAIN_KEY_REJECTED as typeof E_BRAIN_KEY_REJECTED, who, fix });
}
export const isKeyRejected = (err: unknown): err is BrainKeyRejected => !!err && typeof err === "object" && (err as { code?: unknown }).code === E_BRAIN_KEY_REJECTED;
