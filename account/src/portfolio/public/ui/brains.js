/* THE BRAINS (ui/brains.js): the one place where the owner picks what the desk's house seats think with, gives a provider its API key,
   names its model, tests it, and switches the desk over. Loaded before ui/desk.js and ui/superagent.js, which both open it, so the three
   ways in are the same sheet:
     the Superagent's header     its Brain stat is always a button ("Brain ›", the model, the calls, what they cost — or, when the brain
                                 cannot think, why, in amber); the sheet opens on the brain the desk uses now
     the Superagent's setup      "3 · The brain" has "Brains: add a key, pick a model ›" (and each brain not ready its own "Type its key ›"):
                                 a key typed there shows at once in the setup's checklist, and "Pick it for the desk" puts the provider,
                                 the model, the effort and the price into the setup's form — what was typed there stays (core formKeep)
     the Agents pane             the hired desk's "Brain…", and the hiring form's "4 · The brain" (the same "Pick it for the desk" into it)
   openBrains(ctx) opens it. It wears the tokens of where it opens: the sheet is dialog#modal, which ui/tokens.css gives Hyperliquid's
   values while the trading area shows (html[data-area="trade"]) and the Account's on the Agents pane, so this file and ui/brains.css name
   only the Account's tokens (--surface, --text, --dim, --border …) and the shared classes (.btn, .tag, .msg, dialog label).

   WHAT IT READS. GET /api/account/desk/catalog: brains[], one per provider the account registered — its id, its label, its kind (a model
   API, one on this machine, a custom endpoint), its base URL, the models it suggests (and the date they were read), whether it is ready
   (ok, how) or why not (why, and the account's fix: the key file's path and a command), the key's masked tail where a key is saved ("…ab12",
   never the key), and whether a key in the account's environment is used before the file (envWins). What a provider entry does not carry
   is taken from BR_PRESETS below: each provider's own page for a key, its docs, and the model ids its own docs listed — every one read on
   the date BR_READ says, from the provider's own pages (scratchpad research brains-web.md, and the key pages checked again that day). A
   model list is a suggestion in a datalist, never the whole list: any id the endpoint serves can be typed.

   WHAT THE OWNER SIGNS, each with this browser's device key:
     setBrainKey { provider, baseUrl, model, keyHash, salt }   "Save the key". keyHash is hex SHA-256(salt ‖ key): the salt's 16 random
                                 bytes, then the key's UTF-8 bytes, hashed here with crypto.subtle when Save is pressed (never per
                                 keystroke); salt is those 16 bytes as 32 lowercase hex characters. The account keeps the provider, the
                                 base URL, the model and a fingerprint (keyHash's first 8 hex) — never the key, never its tail. Before
                                 anything leaves the page, a yes is asked over the sheet (brConfirmSave) that shows exactly those four —
                                 the provider, the base URL, the model, the fingerprint — and never the key: a "no" sends nothing at all,
                                 not even the hash. keyHash "" (and salt "") with no base URL and no model takes the key away — the
                                 provider's file under credentials/brains is removed — so it is signed only by "Remove the key", asked
                                 for by name, through POST /api/exchange (no secret rides it). Save with nothing typed signs no key, for
                                 any provider; for a server that needs none (Ollama, vLLM) given ANOTHER address it signs that address
                                 and the model with keyHash "" and salt "" (brSaveAddress, after a yes that says no key is signed and
                                 names where the desk's questions go), sent to POST /api/account/brain-key as { envelope } alone
     setDesk change "brain"      "Use this brain" (a desk is hired): { provider, model, effort?, price? } — one signature, after a yes that
                                 names all of them (effort only where the provider takes one of the desk's three; the price the owner's,
                                 or none: then the tokens are counted, not their cost)
   What it asks without a signature: POST /api/account/brain-test { provider } — "Test the saved key": one call the provider bills nothing
   for where it allows one (its model list), answered ok or in the provider's own words.

   THE KEY, which is a secret: it is typed (pasted) into one input, which has no name and sits in no form, so nothing that sweeps a form into
   a draft (formFields, quoteDialog, core formKeep) can ever take it into a /api/account/prepare or /api/exchange body. The input is
   type="text" drawn as dots (brains.css: -webkit-text-security: disc; every browser the page supports draws it — Chrome and Safari for
   years, Firefox since 114 — and where one does not, the input becomes type="password" rather than show the key), with autocomplete,
   autocapitalize, autocorrect and spellcheck off: a password field that a fetch "submits" is what browsers offer to keep in their password
   store (Chrome would offer to save an API key as a password for 127.0.0.1, and sync it), and a text field is not offered. It is read
   once, when Save is pressed: the input is emptied at once, the hash is made, the yes asked, setBrainKey prepared (the draft holds the hash
   and the salt, not the key) and signed, and the signature sent with the key beside it — never inside it — to POST /api/account/brain-key
   as { envelope, apiKey } (Owner.submitTo). The account checks the hash against the key before its door, runs the envelope through the door
   like any owner action, writes the key to its own file (readable by the owner alone) and answers with the key's masked tail; the page
   shows the fingerprint and that tail, nothing more. The key is never kept in a variable past that one request, nor in storage, a data
   attribute, the page's cache of reads (api()), a log line or a draft. A key typed and never saved is wiped from its field when the sheet
   closes, and when the page is put away (pagehide). A provider's base URL with http:// is refused here (and by the account) unless it is
   this machine's own address: anywhere else the key would travel unencrypted.

   A KEY IN THE WRONG FIELD. A key pasted into the model field, or into a base URL — its path, or its host where a provider's how-to leaves
   a part of the address to fill in (Qwen's {WorkspaceId}) — would be signed as that field: kept for good in the account's hash-chained
   ledger, written into its room, sent to the provider as a model's name, or sent in clear text in every DNS query for that host. So a
   value shaped like a key (brKeyShaped: the account's own check, account/brain-key.ts keyShaped, mirrored; brBaseKeyShaped for a base URL,
   each host label as typed and each path segment — Cloudflare's account id in its one place aside) is refused there before anything is
   signed or sent,
   with a warning beside the field as it is typed, in words that never repeat what was typed; the key typed into the key field and found
   again inside the model or the base URL is refused the same way. The desk's own forms (the hiring form, the superagent's setup:
   ui/desk.js dkBrainDraft) refuse it with the same words.

   THE AGENTS the owner may mean by "Muse", "Grok Bot" and "Instinct" have their own short section: as their makers' pages stood on that
   date, none is a model a program can ask — none takes a task over an API and gives an answer back — so none can be the desk's brain. The
   models behind two of them can, and are cards above (Muse · Meta Model API, Grok · xAI API). Instinct, either of the two products by
   that name, publishes no API at all yet. Nothing on this sheet pretends otherwise.

   Every string from outside (a label, a reason, a path, a model id, an answer) is escaped before it is drawn. */

const BR = {
  // the catalog as last read, the provider whose form shows ("" for none), what each Save, Test or Use said (by provider), each key saved
  // in this opening of the sheet (its fingerprint and masked tail — never the key; emptied at each opening), the sheet's body while it is
  // open, the provider its form was built for, a run under way, the reads numbered (the latest wins), how the sheet was opened (openBrains'
  // ctx), the brain "Use this brain" just signed (until the desk is read again), the control to give the focus back to once the form is
  // built again after a run (a selector inside the form), and whether the wipe of an unsaved key is wired (once a page)
  catalog: null,
  pick: "",
  said: {},
  saved: {},
  body: null,
  formFor: "",
  busy: false,
  read: 0,
  ctx: null,
  cur: null,
  refocus: "",
  wipeOn: false,
};

/* the day the providers' own pages were read for the facts below (the model ids, the key pages, the notes) */
const BR_READ = "15 Oct 2026";

/* the three groups the sheet shows, in this order */
const BR_GROUPS = [["api", "Model APIs"], ["local", "On this machine"], ["custom", "Custom"]];
/* the providers in the order the owner meets them; one the account registers that is not named here goes last in its group */
const BR_ORDER = ["openai", "deepseek", "xai", "meta", "claude", "moonshot", "qwen", "openrouter", "gemini", "groq", "together", "ollama", "vllm", "custom"];

/** What the page knows of each provider by itself, all of it read from the provider's own pages on BR_READ: where to get a key (key), its
 * docs (docs), its usual base URL (base: the account's catalog gives the one in use), the model ids its docs list — [id, a few words] —
 * offered as suggestions only (models), whether it takes an effort (effort), whether its base URL is the owner's to type (baseEdit), whether
 * it needs a key at all (keyOptional: a server on this machine), and a note where the provider's own rules change what the owner should
 * expect.
 * The account's catalog wins wherever it says the same thing.
 *
 * "Get a key ↗": each link below was checked on 15 Oct 2026 against a page on the provider's own domain that gives it, word for word (the
 * key pages themselves ask for a sign-in, so the provider's docs are what say where they are):
 *   openai      platform.openai.com/settings/organization/api-keys    developers.openai.com/api/reference/overview
 *   deepseek    platform.deepseek.com/api_keys                        api-docs.deepseek.com ("apply for an API key")
 *   xai         console.x.ai/team/default/api-keys                    docs.x.ai/developers/quickstart (step 2)
 *   meta        dev.meta.ai/api-keys/                                 dev.meta.ai/docs (the research, brains-web.md, read that day)
 *   claude      platform.claude.com/settings/keys                     platform.claude.com/docs/en/get-api-key
 *   moonshot    platform.kimi.ai/console/api-keys                     platform.kimi.ai/docs/guide/start-using-kimi-api
 *   openrouter  openrouter.ai/keys                                    openrouter.ai/docs/api/reference/authentication
 *   gemini      aistudio.google.com/apikey                            ai.google.dev/gemini-api/docs/openai
 *   groq        console.groq.com/keys                                 console.groq.com/docs/quickstart ("visit here", /keys)
 *   together    api.together.ai/settings/projects/~current/api-keys   docs.together.ai/docs/openai-api-compatibility
 *   qwen        Alibaba's own help page on getting a key: its key page differs by region (…/ap-southeast-1/settings/api-key for Singapore,
 *               Beijing and the others, …/us-east-1 for Virginia), and a key works only in its own region — so the link is the page that
 *               says which, never one region's page that would be wrong for the others
 * Ollama, vLLM and a custom endpoint have no key page: there is none to link. */
const BR_PRESETS = {
  openai: { group: "api", name: "OpenAI", base: "https://api.openai.com/v1", key: "https://platform.openai.com/settings/organization/api-keys", docs: "https://developers.openai.com/api/docs/models", effort: true, models: [["gpt-6-astra", "flagship"], ["gpt-6.1-sol", "balanced"], ["gpt-6-luna", "low cost"]] },
  deepseek: { group: "api", name: "DeepSeek", base: "https://api.deepseek.com", key: "https://platform.deepseek.com/api_keys", docs: "https://api-docs.deepseek.com/", effort: true, models: [["deepseek-flash", "V4.1 Flash"], ["deepseek-v4-pro", "V4-Pro"]], note: "DeepSeek answers JSON without a schema (its JSON mode): the account asks for JSON in words and checks every answer. deepseek-chat and deepseek-reasoner were announced as discontinued on 24 Jul 2026." },
  xai: { group: "api", name: "Grok · xAI API", base: "https://api.x.ai/v1", key: "https://console.x.ai/team/default/api-keys", docs: "https://docs.x.ai/docs/models", models: [["grok-4.7", ""], ["grok-4.3", ""], ["grok-4.20-0309-reasoning", ""], ["grok-4.20-0309-non-reasoning", ""]], note: "The model API behind Grok, not the Grok Bot agent (see Agents below)." },
  meta: { group: "api", name: "Muse · Meta Model API", base: "https://api.meta.ai/v1", key: "https://dev.meta.ai/api-keys/", docs: "https://dev.meta.ai/docs/", effort: true, models: [["muse-spark-1.3", "the docs' default"], ["muse-spark-1.2", ""], ["muse-spark-1.1", ""], ["muse-wonder-1.0", "preview"], ["muse-spark-1.3-contributor", "Meta may keep prompts for training"]], note: "The Muse models, not the Muse agent (see Agents below). A public preview for developers in the US; Meta says availability can vary by country. Its models always reason." },
  claude: { group: "api", name: "Claude · Anthropic API", key: "https://platform.claude.com/settings/keys", docs: "https://platform.claude.com/docs/en/api/overview", effort: true },
  moonshot: { group: "api", name: "Kimi · Moonshot", base: "https://api.moonshot.ai/v1", key: "https://platform.kimi.ai/console/api-keys", docs: "https://platform.kimi.ai/docs/guide/start-using-kimi-api", models: [["kimi-k3", ""], ["kimi-k2.6", ""]] },
  qwen: { group: "api", name: "Qwen · Alibaba Model Studio", baseEdit: true, baseHint: "https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", key: "https://www.alibabacloud.com/help/en/model-studio/get-api-key", docs: "https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope", models: [["qwen3.8-max", ""]], note: "The base URL is your own workspace's, in its region (Singapore, the US or Beijing): copy it from Model Studio. A key works only in the region it was made in." },
  openrouter: { group: "api", name: "OpenRouter", base: "https://openrouter.ai/api/v1", key: "https://openrouter.ai/keys", docs: "https://openrouter.ai/docs/quickstart", models: [["meta/muse-spark-1.3", ""], ["meta/muse-wonder", ""]], note: "Models are named vendor/model. Whether one keeps to a JSON schema depends on who serves it." },
  gemini: { group: "api", name: "Gemini · OpenAI compatibility", base: "https://generativelanguage.googleapis.com/v1beta/openai/", key: "https://aistudio.google.com/apikey", docs: "https://ai.google.dev/gemini-api/docs/openai", models: [["gemini-3.8-flash", ""]], note: "Google's OpenAI-compatible layer for Gemini, which its docs mark as beta." },
  groq: { group: "api", name: "Groq", base: "https://api.groq.com/openai/v1", key: "https://console.groq.com/keys", docs: "https://console.groq.com/docs/openai", models: [["openai/gpt-oss-120b", "strict JSON schema"], ["openai/gpt-oss-20b", "strict JSON schema"], ["qwen/qwen3.8-27b", "strict JSON schema"]], note: "A strict JSON schema works only on the three models suggested; every other model answers in JSON mode." },
  together: { group: "api", name: "Together", base: "https://api.together.ai/v1", key: "https://api.together.ai/settings/projects/~current/api-keys", docs: "https://docs.together.ai/docs/openai-api-compatibility", models: [["deepseek-ai/DeepSeek-V4-Pro-0813", ""]], note: "Models go by their full names: OpenAI's names are not found there." },
  ollama: { group: "local", name: "Ollama", base: "http://localhost:11434/v1", baseEdit: true, keyOptional: true, docs: "https://docs.ollama.com/api/openai-compatibility", note: "Runs on this machine: no key (Ollama ignores one), nothing billed. Name a model you have pulled." },
  vllm: { group: "local", name: "vLLM", base: "http://localhost:8000/v1", baseEdit: true, keyOptional: true, docs: "https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/", note: "Runs on this machine: a key only if you started it with --api-key." },
  custom: { group: "custom", name: "Custom endpoint", baseEdit: true, note: "Any endpoint that speaks OpenAI's chat format: its base URL, its key, its model." },
};

/* a key as the account takes one: 8 to 512 printable characters, no space */
const BR_KEY_SHAPE = /^[\x21-\x7e]{8,512}$/;
/* a model id as the desk takes one (account/desk.ts parseBrain) */
const BR_MODEL_SHAPE = /^[A-Za-z0-9][\w.\-:/]{0,79}$/;

/* WHAT AN API KEY LOOKS LIKE — account/brain-key.ts keyShaped, mirrored here line for line (test/unit/ui-brains.test.ts holds the two to the
   same answers), so the page refuses a key pasted into the model field or a base URL's path before anything is signed, rather than after
   the account refuses it. True for: a key that says what it is by its prefix (the account's memory.ts list — Stripe-style sk_/rk_/pk_ live
   and test keys, sk-…, AWS's AKIA…, GitHub's gh?_…, Slack's xox?-…, Google's AIza… — and the providers': sk- for OpenAI, Anthropic's
   sk-ant-, DeepSeek, Kimi and Qwen, sk-or- for OpenRouter, xai- for xAI, gsk_ for Groq, AIza for Gemini, each followed by a run of key
   characters); a key block or a signed token; thirty-two or more hex characters in a row (Together's keys are that alone); a run of base64's
   characters thirty-two or more long that holds a + or an =; and any run of thirty-two or more key characters that reads as random: somewhere
   in it a stretch of twelve or more letters and digits with no "-" or "_" that holds both, and is thirty-two long or more, or changes between
   lower case, upper case and digits at least two times in five. False for every model id the presets suggest and the long vendor/model
   names OpenRouter, Together and Hugging Face use ("NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO" is words). Whoever refuses on it says so
   in words that never repeat the value */
const BR_PREFIXED_KEY = /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}|\bsk-or-[A-Za-z0-9_-]{8,}|\bsk-[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{20,}|\bxai-[A-Za-z0-9]{20,}|\bgsk_[A-Za-z0-9]{20,}/;
const BR_KEY_BLOCK = /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|KEY BLOCK|ENCRYPTED|OPENSSH)[A-Z0-9 ]*-----/;
const BR_JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/;
const BR_HEX_RUN = /(?<![0-9a-fA-F])[0-9a-fA-F]{32,}(?![0-9a-fA-F])/;
const BR_B64_RUN = /[A-Za-z0-9+/=_-]{32,}/g;
/* lower case 1, upper case 2, a digit 3, anything else 0 */
const brCharClass = (c) => (c >= "a" && c <= "z" ? 1 : c >= "A" && c <= "Z" ? 2 : c >= "0" && c <= "9" ? 3 : 0);
/* how often a stretch changes between lower case, upper case and digits from one character to the next, 0 to 1 */
function brSwitchRate(s) {
  let n = 0;
  for (let i = 1; i < s.length; i++) if (brCharClass(s[i]) !== brCharClass(s[i - 1])) n++;
  return s.length > 1 ? n / (s.length - 1) : 0;
}
/* a run of thirty-two or more key characters that reads as random rather than as words joined by dashes */
function brRandomRun(run) {
  if (run.length < 32) return false;
  for (const part of run.split(/[-_]+/)) {
    if (part.length < 12 || !/[A-Za-z]/.test(part) || !/[0-9]/.test(part)) continue;
    if (part.length >= 32 || brSwitchRate(part) >= 0.4) return true;
  }
  return false;
}
/** whether some text holds what looks like an API key (account/brain-key.ts keyShaped) */
function brKeyShaped(s) {
  const t = String(s ?? "");
  if (!t) return false;
  if (BR_PREFIXED_KEY.test(t) || BR_KEY_BLOCK.test(t) || BR_JWT.test(t) || BR_HEX_RUN.test(t)) return true;
  for (const m of t.matchAll(BR_B64_RUN)) {
    const run = m[0];
    if (/[+=]/.test(run) && /[A-Za-z]/.test(run) && /[0-9]/.test(run)) return true;
    if (run.split("/").some(brRandomRun)) return true;
  }
  return false;
}
/* %-escapes undone, or the text as it is where they do not decode (a lone "%") */
function brDecoded(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
/** A base URL's host AS IT WAS TYPED (account/brain-key.ts typedHost, mirrored): what stands between the scheme's "//" (any number of "/"
 * or "\", as URL reads them) and the first "/", "\", "?" or "#", without a name or password before the last "@" and without a ":port"
 * ([…] kept whole for an IPv6 address). Read from the text itself, never from new URL(), which writes the host in lower case and in
 * punycode — and a key's mix of lower case, upper case and digits is part of how it reads as random (a lower-cased key reads less like
 * one). Tabs and line breaks, which URL drops, are dropped first. "" when the text has no scheme */
function brHostTyped(raw) {
  const t = String(raw ?? "").replace(/[\t\n\r]/g, "").replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "");
  const m = /^[A-Za-z][A-Za-z0-9+.-]*:[/\\]*([^/\\?#]*)/.exec(t);
  if (!m) return "";
  const authority = m[1];
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end >= 0 ? host.slice(0, end + 1) : host;
  }
  const colon = host.lastIndexOf(":");
  return colon >= 0 ? host.slice(0, colon) : host;
}
/** Whether a base URL's HOST holds what looks like an API key (account/brain-key.ts hostKeyShaped, mirrored): the host as typed
 * (brHostTyped) whole — a signed token's dots are part of it — and one "."-separated label at a time, each also with its %-escapes undone;
 * and the host as URL reads it, label by label, for a host URL reads differently than it was typed. No hex run is excused in a host.
 * Qwen's own how-to puts the owner's workspace id in the host (https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/…), so a key pasted
 * there is a mistake waiting to happen: signed, it would be in the ledger for good, and sent, it would go out in clear text in the DNS query
 * and the TLS greeting of every call */
function brHostKeyShaped(raw) {
  const host = brHostTyped(raw);
  const parts = [host, ...host.split(".")];
  try {
    parts.push(...new URL(String(raw ?? "").trim()).hostname.split("."));
  } catch {
    // not a URL: the host as typed was taken
  }
  return parts.some((p) => p !== "" && (brKeyShaped(p) || brKeyShaped(brDecoded(p))));
}
/* CLOUDFLARE'S ACCOUNT ID, which is not a key: a base URL's path segment that is NOTHING BUT 32 to 39 hex characters. Cloudflare puts its
   32-hex account id in the path of its OpenAI-compatible endpoints — https://api.cloudflare.com/client/v4/accounts/<account id>/ai/v1
   (Workers AI) and https://gateway.ai.cloudflare.com/v1/<account id>/<gateway>/openai (AI Gateway) — and the key check counts any hex run
   of 32 or more as a key (Together's keys are 64 hex alone), so without this those addresses would be refused as "a key in the path": a
   refusal made up. A key is still caught in a path when it says what it is by its prefix (sk-…, gsk_…, xai-…), when it is a longer hex run
   (Together's 64), when the segment holds anything beside the hex, and — whatever its shape — when it is the key typed in the key field
   (brKeyInFields). Only in a path: the same 32 hex in a host's label or a model's name is still a key (account/brain-key.ts
   SHORT_HEX_SEGMENT, mirrored) */
const BR_SHORT_HEX_SEGMENT = /^[0-9a-fA-F]{32,39}$/;
/** Whether a base URL's PATH holds what looks like an API key (account/brain-key.ts pathKeyShaped, mirrored): the path as typed and the
 * path with each segment's %-escapes undone, a segment of nothing but 32 to 39 hex characters (as typed, or once decoded) left out first —
 * judged whole, not a segment at a time, so a standard-base64 key whose "/" made two segments of it is still seen whole */
function brPathKeyShaped(pathname, host = "") {
  const segs = String(pathname ?? "").split("/");
  const excused = (i, x) => BR_SHORT_HEX_SEGMENT.test(x) && brCloudflareIdAt(segs, i, host);
  const typed = segs.map((x, i) => (excused(i, x) ? "" : x)).join("/");
  const plain = segs
    .map((x, i) => {
      const d = brDecoded(x);
      return excused(i, d) ? "" : d;
    })
    .join("/");
  return brKeyShaped(typed) || brKeyShaped(plain);
}
/* where Cloudflare puts its 32-hex account id, and only there (account/brain-key.ts cloudflareIdAt, mirrored): on api.cloudflare.com right
   after "accounts", on gateway.ai.cloudflare.com the first segment after "v1" */
function brCloudflareIdAt(segs, i, host) {
  const h = String(host ?? "").toLowerCase();
  if (h === "api.cloudflare.com") return i > 0 && String(segs[i - 1] ?? "").toLowerCase() === "accounts";
  if (h === "gateway.ai.cloudflare.com") return i === 2 && String(segs[1] ?? "").toLowerCase() === "v1";
  return false;
}
/** THE BASE-URL RULE, as the account has it (account/brain-key.ts baseUrlKeyShaped — used by baseUrlProblem at the route, the door and
 * /prepare, and by parseBaseUrl in the brain itself — mirrored step for step; ui-brains.test.ts holds the two to the same answer on every
 * sample): whether a base URL holds what looks like an API key anywhere a key could be pasted into it.
 *   1. the text, trimmed; "" → no
 *   2. not a URL → whether the text itself is key-shaped
 *   3. its HOST (brHostKeyShaped): as typed, whole and label by label, as is and %-decoded; and as URL reads it, label by label
 *   4. its PATH (brPathKeyShaped): as typed and %-decoded, Cloudflare's account id in a segment of its own left out
 *   5. the rest a URL may carry — a name, a password, a query, a fragment — each as is and %-decoded (the base URL refuses all four
 *      anyway: checked here so that the words say "a key")
 * Whoever refuses on it says so in words that never repeat the value */
function brBaseKeyShaped(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return false;
  let u;
  try {
    u = new URL(t);
  } catch {
    return brKeyShaped(t);
  }
  if (brHostKeyShaped(t) || brPathKeyShaped(u.pathname, u.hostname)) return true;
  return [u.username, u.password, u.search, u.hash].some((x) => x !== "" && (brKeyShaped(x) || brKeyShaped(brDecoded(x))));
}
/** Whether the key typed in the key field is ALSO in the model or the base URL about to be signed (account/brain-keys.ts keyInSignedFields,
 * mirrored, so the page refuses it before the draft goes to /api/account/prepare — whose answer would carry it back — rather than the
 * account refusing it after): the whole key anywhere inside either; or, for a part of it pasted on its own, a model, a label of the base
 * URL's host as typed, or a segment of its path (as typed or %-decoded) of eight characters or more that is a piece of the key. This is
 * what catches a key no shape gives away (a 32-hex key in a path segment, which the base-URL rule lets pass as Cloudflare's account id; a
 * short word a local server was started with). Compared here, never said */
function brKeyInFields(key, model, base) {
  if (!key) return false;
  const m = String(model ?? "");
  const b = String(base ?? "");
  if (m.includes(key) || b.includes(key)) return true;
  const piece = (s) => s.length >= 8 && key.includes(s);
  if (piece(m)) return true;
  if (brHostTyped(b).split(".").some(piece)) return true;
  let u;
  try {
    u = b ? new URL(b) : undefined;
  } catch {
    u = undefined;
  }
  if (!u) return false;
  for (const seg of u.pathname.split("/")) {
    if (!seg) continue;
    if (piece(seg)) return true;
    const plain = brDecoded(seg);
    if (plain !== seg && piece(plain)) return true;
  }
  return false;
}
/* the words for a key in the wrong field: they never repeat what was typed */
const BR_KEY_WORDS = {
  model: "That looks like an API key, not a model's name: a key goes in the key field, never in the model. Nothing is signed or sent while it is there.",
  base: "The base URL holds something shaped like an API key, in its address or its path: a key goes in the key field, never in the base URL. Nothing is signed or sent while it is there.",
  inside: "The key you typed is also in the model or the base URL: take it out of there first. Nothing was signed or sent.",
};

/* bytes as lowercase hex */
const brHex = (bytes) => Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
/* this machine's own names: the only hosts a key may be sent to over http:// */
const brLoopback = (host) => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(String(host || "").toLowerCase());

/** keyHash = hex SHA-256(salt ‖ key): the salt's bytes, then the key's UTF-8 bytes. The byte copies are zeroed once hashed */
async function brHash(salt, key) {
  const k = new TextEncoder().encode(key);
  const all = new Uint8Array(salt.length + k.length);
  all.set(salt, 0);
  all.set(k, salt.length);
  const digest = await crypto.subtle.digest("SHA-256", all);
  all.fill(0);
  k.fill(0);
  return brHex(new Uint8Array(digest));
}

/** a base URL as the account will take one, or the sentence why not: https:// anywhere, http:// only on this machine, no name or password
 * in it. `required`: a provider with no usual base URL (Qwen's is per workspace; a custom endpoint) */
function brBaseWrong(url, required) {
  const u = String(url || "").trim();
  if (!u) return required ? "Give its base URL first: the address its API answers at." : "";
  let x;
  try {
    x = new URL(u);
  } catch {
    return "A base URL looks like https://api.example.com/v1.";
  }
  if (x.username || x.password) return "A base URL carries no name or password: the key goes in its own field.";
  if (x.protocol === "https:") return "";
  if (x.protocol === "http:") return brLoopback(x.hostname) ? "" : "http:// only for this machine (localhost, 127.0.0.1): anywhere else the key would travel unencrypted. Use https://.";
  return "A base URL starts with https:// (or http:// on this machine).";
}
/* the host a base URL names (with its port), for the words that say where the key goes — "another address" for one that looks like it holds
   a key, as URL reads it or as it was typed (as the account says it: account/brain-key.ts hostSaid), so no sentence ever carries one; and
   its name alone, for the loopback check */
function brHost(url, nameOnly = false) {
  try {
    const u = new URL(String(url ?? "").trim());
    if (brKeyShaped(u.host) || brHostKeyShaped(url)) return "another address";
    return nameOnly ? u.hostname : u.host;
  } catch {
    return "";
  }
}
/** where a base URL is, in the words a sentence says it with: "this machine" for this machine's own loopback (localhost, 127.x, [::1]) and
 * only then; anywhere else its host as typed (with its port) — a server the owner runs on another machine, or a provider's endpoint */
function brWhere(url) {
  const name = brHost(url, true);
  if (!name) return "";
  return brLoopback(name) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name) ? "this machine" : brHost(url);
}

/** One provider as the sheet draws it: the account's catalog entry (b: desk.ts catalog().brains[i], its standing with BrainAbout), with
 * what the page knows of it (BR_PRESETS) wherever the entry is silent:
 *   kind "model-api" | "local" | "custom"   → the card's group;  baseUrl, baseRequired, baseHint   → the base URL field
 *   keyOptional                              → a key only if the server asks for one;  efforts → the effort select's choices
 *   suggested { models, source, checked, prices }   → the datalist, dated, each model's listed price that day beside it
 *   tail ("…ab12", or "…" for a key too short to show any), keyFrom ("env" · "file" · "older-file" · "none"), keyFile, envWins
 *   envBlocks                                → a variable in the account's environment that BLOCKS a saved key rather than standing in for
 *                                              it: Claude's ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN beside an ANTHROPIC_BASE_URL that points
 *                                              at another host (a gateway's credential, which the brain never uses, and while it is set the
 *                                              brain does not read the file either — brain-claude.ts). Read from the entry's envBlocks, or
 *                                              from keyFrom "env-ignored" / "env-blocked" with the variable in envWins: either way the page
 *                                              then says "blocks", never "is used before"
 *   keyPage, docs, note                      → the provider's own pages and the one fact to know
 * An older account's entry (none of these) still draws: the page's own facts stand in, each dated */
function brOf(b) {
  const p = BR_PRESETS[b.id] || {};
  const kind = String(b.kind || "").toLowerCase();
  const group = /local|machine/.test(kind) ? "local" : /custom/.test(kind) ? "custom" : kind ? "api" : p.group || "api";
  const sg = b.suggested && typeof b.suggested === "object" && !Array.isArray(b.suggested) ? b.suggested : null;
  const list = sg && Array.isArray(sg.models) ? sg.models : Array.isArray(b.suggestedModels) ? b.suggestedModels : Array.isArray(b.suggested) ? b.suggested : null;
  const prices = (sg && sg.prices) || {};
  const hint = (id, words) => {
    const pr = prices[id];
    const price = pr && Number.isFinite(Number(pr.inUsd)) && Number.isFinite(Number(pr.outUsd)) ? `$${Number(pr.inUsd)}/$${Number(pr.outUsd)} per M tokens` : "";
    return [words, price].filter(Boolean).join(" · ");
  };
  const own = Object.fromEntries((p.models || []).map(([id, w]) => [id, w]));
  const suggest = (list || p.models || []).map((m) => (Array.isArray(m) ? [String(m[0]), String(m[1] || "")] : typeof m === "string" ? [m, own[m] || ""] : [String((m && m.id) || ""), String((m && (m.note || m.name)) || "")])).filter((m) => m[0]).map(([id, w]) => [id, hint(id, w)]);
  const rawTail = String(b.tail || b.keyTail || "");
  const base = String(b.baseUrl || b.base || b.defaultBase || (b.baseRequired ? "" : p.base) || "");
  const baseEdit = b.baseEditable !== undefined ? !!b.baseEditable : group !== "api" || !!b.baseRequired || !!p.baseEdit;
  const keyFrom = String(b.keyFrom || (rawTail ? "file" : ""));
  const named = (v) => (typeof v === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(v) ? v : "");
  // the variable that blocks a saved key (the gateway case): said by name only when it is a variable's name, else in words
  const envBlocks = b.envBlocks ? named(b.envBlocks) || "a variable in the account's environment" : /^env-(ignored|blocked)$/.test(keyFrom) ? named(b.envWins) || "a variable in the account's environment" : "";
  const efforts = Array.isArray(b.efforts) ? b.efforts.filter((e) => ["low", "medium", "high"].includes(e)) : p.effort ? ["low", "medium", "high"] : [];
  return {
    id: String(b.id),
    name: String(b.label || p.name || b.id),
    group,
    kind: group === "local" ? "On this machine" : group === "custom" ? "Custom endpoint" : "Model API",
    base,
    baseEdit,
    baseHint: String(b.baseHint || p.baseHint || ""),
    // a base URL the owner must give: one the provider has no usual address for (a Qwen workspace's, a custom endpoint's)
    needsBase: !base && (!!b.baseRequired || baseEdit),
    keyOptional: b.keyOptional !== undefined ? !!b.keyOptional : !!p.keyOptional,
    key: String(b.keyPage || b.keyUrl || p.key || ""),
    docs: String(b.docs || b.docsUrl || p.docs || ""),
    efforts,
    listed: Array.isArray(b.models) ? b.models.filter((m) => m && m.id) : [],
    suggest,
    asOf: String((sg && sg.checked) || b.suggestedAt || b.modelsAsOf || (list ? "" : BR_READ)),
    source: String((sg && sg.source) || ""),
    note: String(b.note || p.note || ""),
    tail: rawTail.replace(/^…/, ""),
    // a key in use: one with a tail, or one read from a file or the environment — never one the environment blocks (the gateway case: the
    // variable is not used, and the file is not read while it is set)
    keySet: !envBlocks && (!!rawTail || keyFrom === "file" || keyFrom === "older-file" || keyFrom === "env"),
    // a key is IN the file the account reads (its tail shows, "…" for a short one): a file a server on this machine was given with no key
    // (an address and a model only) has none
    hasKey: !!rawTail,
    keyFrom,
    keyFile: String(b.keyFile || ""),
    env: envBlocks ? "" : b.envWins ? (typeof b.envWins === "string" ? b.envWins : "a variable in the account's environment") : "",
    envBlocks,
    ok: !!b.ok,
    how: String(b.how || ""),
    why: String(b.why || ""),
    fix: b.fix || null,
    model: String(b.model || ""),
  };
}

/** a provider's standing in a few words, and its tone (ok · warn · off): Ready · key …ab12, Ready, No key, Key refused, Key file unusable,
 * Local — the reason itself in full on its form */
function brStanding(x) {
  const code = x.fix && x.fix.code;
  // a server on this machine needs no key and no file (the account reaches its usual address once a model is named): "needs a model" where
  // that is all it lacks (brOnlyModel), else "not ready" — never "not set up"; its form says the rest
  if (x.group === "local") return x.ok ? ["Local · ready", "ok"] : brOnlyModel(x) ? ["Local · needs a model", "off"] : ["Local · not ready", "off"];
  if (x.ok) return [x.tail ? `Ready · key …${x.tail}` : x.env || x.keyFrom === "env" ? "Ready · from the environment" : "Ready", "ok"];
  if (x.envBlocks) return ["Blocked by the environment", "warn"];
  if (code === "rejected") return ["Key refused", "warn"];
  if (code === "unusable") return ["Key file unusable", "warn"];
  return [x.tail ? `Not ready · key …${x.tail}` : "No key", x.tail ? "warn" : "off"];
}

/** A server on this machine whose ONLY want is a model's name — as the account judges it (account/brain-openai.ts openaiReach): a preset
 * that needs no key (keyOptional), with no file of its own (keyFrom "none": the account reaches it at its usual address, the catalog's
 * baseUrl), not ready, and the account's fix "no-key" — which is what it says of exactly that case, a local server with no model named
 * (any other reason — a key refused, a file it cannot use, no fix given at all — is the account's to say, and is said) */
function brOnlyModel(x) {
  return !!x && !x.ok && !!x.keyOptional && x.keyFrom === "none" && !!x.fix && x.fix.code === "no-key";
}
/* a model's name the desk would take: named, not shaped like a key, a model id's characters */
const brModelOk = (model) => {
  const m = String(model || "").trim();
  return !!m && !brKeyShaped(m) && BR_MODEL_SHAPE.test(m);
};
/** Whether a provider will think with the model the form names, judged as the account judges it: ready now (the catalog's own standing,
 * which for a local server already counts a model it was hired with), or a server on this machine whose only want is a model's name
 * (brOnlyModel) with one named — the account calls it at its usual address with no key, and the model rides the signature ("Use this
 * brain", the hire, the superagent's Start). What a place says of readiness (the Use confirm, the setup's checklist and its words) goes by
 * this, never by the standing read without the form's model */
function brReadyWith(x, model) {
  if (!x) return false;
  return x.ok || (brOnlyModel(x) && brModelOk(model));
}

/* the providers the catalog offers, each as the sheet draws it, in BR_ORDER */
function brAll(catalog) {
  const list = ((catalog && Array.isArray(catalog.brains) && catalog.brains) || []).filter((b) => b && b.id).map(brOf);
  const at = (id) => (BR_ORDER.includes(id) ? BR_ORDER.indexOf(id) : BR_ORDER.length);
  return list.sort((a, b) => at(a.id) - at(b.id));
}

/** the cards, grouped (Model APIs, On this machine, Custom; a group with none is not drawn): each a button with the provider's name, its
 * kind and its standing, the one the desk thinks with now marked "In use" (or, opened from a form, the one that form names: "Picked"),
 * the one whose form shows pressed */
function brCardsHtml(catalog, cur, pick, forForm = false) {
  const all = brAll(catalog);
  if (!all.length) return '<p class="dim small">The account offers no brain yet.</p>';
  return BR_GROUPS.map(([g, title]) => {
    const list = all.filter((x) => x.group === g);
    if (!list.length) return "";
    return `<section class="br-group" aria-labelledby="br-g-${g}"><h3 class="label" id="br-g-${g}">${esc(title)}</h3><div class="br-cards">${list.map((x) => {
      const [word, tone] = brStanding(x);
      const inUse = !!cur && cur.provider === x.id;
      return `<button type="button" class="br-card" data-br-pick="${esc(x.id)}" data-k="${esc(x.id)}" aria-pressed="${String(x.id === pick)}"><span class="br-card-n">${esc(x.name)}</span><span class="br-card-k">${esc(x.kind)}${inUse ? ` · <span class="tag up">${forForm ? "Picked" : "In use"}</span>` : ""}</span><span class="br-st" data-s="${tone}"><i aria-hidden="true"></i>${esc(word)}</span></button>`;
    }).join("")}</div></section>`;
  }).join("");
}

/** The agents section: what "Muse", "Grok Bot" and "Instinct" are, as their makers' own pages stood on BR_READ — none has an API a
 * program can ask, so none is a brain; the models behind two of them are (their cards above, a click away where the account offers them).
 * Instinct, either of the two by that name, publishes nothing to connect */
function brAgentsHtml(catalog) {
  const has = (id) => brAll(catalog).some((x) => x.id === id);
  const to = (id, words) => (has(id) ? `<button type="button" class="link" data-br-pick="${esc(id)}">${esc(words)}</button>` : esc(words));
  const out = (href, words) => `<a class="link dim" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(words)} ↗</a>`;
  return `<section class="br-agents" aria-labelledby="br-ag-h"><h3 class="label" id="br-ag-h">Agents: Muse, Grok Bot, Instinct</h3>
    <p class="dim small">These are personal AI agents, not models a program can ask: as their makers' own pages stood on ${esc(BR_READ)}, none takes a task over an API and gives an answer back, so none can be the desk's brain.</p>
    <ul class="br-ag">
      <li><b>Muse</b><span>Meta's personal agent (announced 8 Sep 2026; its app, muse.ai and WhatsApp). No API calls it. Its models do: ${to("meta", "Muse · Meta Model API")}. ${out("https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/", "Meta's post")}</span></li>
      <li><b>Grok Bot</b><span>xAI's agent, in beta since 11 Aug 2026. Its docs give no API, webhook or MCP endpoint that sends it a task. Its models answer through ${to("xai", "Grok · xAI API")}. ${out("https://docs.x.ai/grok-bot/overview", "Its docs")}</span></li>
      <li><b>Instinct</b><span>Two products by the name: Spear Street's assistant (invite-only beta) and instinct.xyz's trading agents (launched 14 Oct 2026, a waitlist, its docs still to come). Neither publishes an API or a model: nothing to connect yet. ${out("https://instinct.com", "instinct.com")} ${out("https://instinct.xyz/docs", "instinct.xyz")}</span></li>
    </ul>
    <p class="dim small">Letting one of them reach into this account instead (a public connector it calls) was decided against for now (2026-10-15): it is not built.</p></section>`;
}

/** One provider's form: what it is (its standing, its note, a way to a key), its base URL (the owner's to type where it is a workspace's,
 * a custom endpoint's or this machine's), the key — a text input drawn as dots, with no name, in no form — and Save, the model (the listed ones as a
 * select; otherwise any id, with the dated suggestions in a datalist), the effort where the provider takes one, the owner's own price where
 * no listed price applies, then Test the saved key, and Use this brain (a desk is hired) or Pick it (a form opened the sheet).
 * ctx: { cur: the desk's brain (or the form's) now, desk: whether a desk is hired, pick: whether a form takes the pick, owner } */
function brFormHtml(x, ctx = {}) {
  const cur = ctx.cur || null;
  const mine = !!cur && cur.provider === x.id;
  const [word, tone] = brStanding(x);
  const id = esc(x.id);
  // a key saved in this opening of the sheet — said only while the key the account now reads is that one (a key put in the key file or
  // the environment since, its tail another, is not the one saved here)
  const s0 = BR.saved[x.id];
  const saved = s0 && (!x.tail || !s0.tail || s0.tail.replace(/^…/, "") === x.tail) ? s0 : null;
  const off = ctx.owner ? "" : ' disabled title="This browser can look but not sign"';
  const head = `<div class="br-f-h"><h3 class="h2" id="br-f-h" tabindex="-1">${esc(x.name)}</h3><span class="br-st" data-s="${tone}" data-br-p="standing"><i aria-hidden="true"></i>${esc(word)}</span>${x.key ? `<a class="link" href="${esc(x.key)}" target="_blank" rel="noopener noreferrer">Get a key ↗</a>` : ""}${x.docs ? `<a class="link dim" href="${esc(x.docs)}" target="_blank" rel="noopener noreferrer">Its docs ↗</a>` : ""}</div>`;
  const note = x.note ? `<p class="dim small br-note">${esc(x.note)}</p>` : "";
  // not ready: in a line, what stands in the way (no key yet: the field below is the way; a key refused or a file it cannot use: the
  // account's own words), and, folded, the key file for whoever would rather put the key there — the account's own sentence about it, its
  // path and its command, never one composed here
  const fix = x.fix || {};
  const fileRow = (label, text) => `<div class="br-fix-r"><span class="dim small">${esc(label)}</span><code class="br-path">${esc(text)}</code><button type="button" class="btn btn-sm" data-br-copy="${esc(text)}">Copy</button></div>`;
  // no key yet (or the empty template, a sample): the field below is the way. A key is there and the file names no model yet: the model
  // field below is the way. Anything else (a key refused, a file it cannot use): the account's own words
  const noKey = (!fix.code || fix.code === "no-key" || fix.code === "example") && !x.keySet;
  const noModel = x.keySet && fix.code === "example";
  // a key saved and no model named: the model reaches the desk by "Use this brain" or "Pick it for the desk", which carry it without the
  // key — never by pasting the key again
  const next = brNextWords(ctx);
  // a server on this machine whose only want is a model (brOnlyModel): said once, in its own words under the key's label below — the
  // account's sentence for it names one button, and this sheet may show the other
  const head0 = x.group === "local" ? (brOnlyModel(x) ? "" : x.why || "Not set up yet.") : noKey ? (x.keyOptional ? "" : "No key yet: paste one below.") : noModel ? `Its key is saved; it needs a model: name it below${next ? `, then ${next}` : ""} — no need to paste the key again.` : fix.words || x.why || "Not ready.";
  const file = fix.file && x.group !== "local" ? `<details class="br-file"><summary class="small">Or put the key in its key file</summary>${(noKey || noModel) && fix.words ? `<p class="dim small">${esc(fix.words)}</p>` : ""}${fix.command ? fileRow("Run, in Terminal", fix.command) : ""}${fileRow("The key file", fix.file)}${fix.restart ? '<p class="dim small">The account reads it when it starts: restart it once the key is there.</p>' : ""}</details>` : "";
  const why = x.ok || (!head0 && !file) ? "" : `<div class="br-why">${head0 ? `<p class="small">${esc(head0)}</p>` : ""}${file}</div>`;
  // a variable in the account's environment: one that BLOCKS a saved key (the gateway case: neither it nor the file is used while it is
  // set), or one that is used before it
  const env = x.envBlocks
    ? `<p class="small warn-t">${esc(x.envBlocks)} is set where the account runs and blocks a saved key: unset it and ANTHROPIC_BASE_URL, then restart.</p>`
    : x.env
      ? `<p class="small warn-t">${esc(x.env)} is set where the account runs, and is used before a key saved here: unset it for a saved key to count.</p>`
      : "";
  const baseVal = x.base;
  // a warning line beside the base URL and the model, written as they are typed when what is there looks like a key (brFieldWarn): words
  // only, never the value
  const warn = (which) => `<p class="small warn-t br-warn" data-br-warn="${which}" aria-live="polite" hidden></p>`;
  const base = !baseVal && !x.baseEdit ? "" : `<label>Base URL<input data-br-base value="${esc(baseVal)}" inputmode="url" autocomplete="off" spellcheck="false" autocapitalize="off"${x.baseEdit ? "" : " readonly"}${x.baseHint ? ` placeholder="${esc(x.baseHint)}"` : x.baseEdit && !baseVal ? ' placeholder="https://…/v1"' : ""} /></label>${x.baseEdit ? warn("base") : ""}`;
  const host = brHost(baseVal) || x.name;
  const keyLabel = x.keyOptional ? "API key (only if it asks for one)" : "API key";
  const from = x.keyFrom === "older-file" ? " (read from the older key file, which stays as it is)" : x.keyFrom === "env" ? " (read from the account's environment)" : "";
  const has = saved ? `Saved just now · fingerprint <span class="mono">${esc(saved.print)}</span>${saved.tail ? ` · <span class="br-nw">key ${esc(saved.tail.startsWith("…") ? saved.tail : `…${saved.tail}`)}</span>` : ""}` : x.keySet && x.keyFrom !== "none" && (x.tail || x.keyFrom === "env" || x.keyFrom === "older-file") ? `A key is in use${x.tail ? `: <span class="br-nw">…${esc(x.tail)}</span>` : ""}${esc(from)}` : x.keyOptional && x.keyFrom === "file" ? `Saved with no key${x.base ? `: ${esc(brHost(x.base) || x.base)}` : ""}${x.model ? ` · ${esc(x.model)}` : ""}` : "";
  // a server that needs no key: the account calls it at the address it has now (the catalog's, never the field's), and it thinks once a
  // model is named; another address is the account's once Save signs it — with the model, and with a key only if the server was started
  // with one (Save with the key field empty signs the address and the model alone: brSave)
  const local = x.keyOptional ? `<p class="dim small">Needs no key: the account calls it at ${esc(x.base || "its base URL")}. Name the model your server serves below${next ? `, then ${esc(next)}` : ""}. Another address counts once Save signs it, with the model — and a key only if your server was started with one.</p>` : "";
  // the key: a text field drawn as dots (brains.css), with nothing that remembers, corrects or completes what is typed — so the browser has
  // no password field to offer to save — and no name, in no form
  const key = `<div class="br-key">${local}<label class="br-key-l" for="br-key-${id}">${esc(keyLabel)}</label><div class="br-key-row"><input id="br-key-${id}" type="text" data-br-key autocomplete="off" spellcheck="false" autocapitalize="off" autocorrect="off" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other" placeholder="Paste the key"${off} /><button type="button" class="btn btn-sm btn-primary" data-br-act="save"${off}>Save the key</button></div>
      <p class="dim small">Saving asks you first, then signs the provider, the base URL, the model and the key's fingerprint, never the key. The key goes once, from this page to the account on this machine, which keeps it in its own file and sends it to ${esc(host)} only.${x.keyFile ? ` It is written to ${esc(x.keyFile)}, readable by you alone.` : ""}</p>${has ? `<p class="small" data-br-p="has">${has}</p>` : ""}${brMsgHtml(x.id, "key")}</div>`;
  const model = mine ? String(cur.model || "") : x.model;
  const listed = x.listed.length
    ? `<label>Model<select data-br-model>${x.listed.map((m) => `<option value="${esc(m.id)}"${m.id === model ? " selected" : ""}>${esc(`${m.name || m.id}${m.inUsd !== undefined ? ` · $${m.inUsd}/$${m.outUsd} per M tokens` : ""}`)}</option>`).join("")}</select></label>`
    : `<label>Model, as the endpoint names it<input data-br-model list="br-ml-${id}" value="${esc(model)}" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="${esc(x.suggest[0] ? `e.g. ${x.suggest[0][0]}` : "its model id")}" /></label><datalist id="br-ml-${id}">${x.suggest.map(([m, w]) => `<option value="${esc(m)}"${w ? ` label="${esc(w)}"` : ""}></option>`).join("")}</datalist>`;
  const effortNow = x.efforts.includes((mine && cur.effort) || "medium") ? (mine && cur.effort) || "medium" : x.efforts[x.efforts.length - 1];
  const effort = x.efforts.length ? `<label>Effort<select data-br-effort>${x.efforts.map((e) => `<option value="${esc(e)}"${e === effortNow ? " selected" : ""}>${esc(e)}</option>`).join("")}</select></label>` : "";
  const sug = !x.listed.length && x.suggest.length ? `<p class="dim small">Suggestions from ${x.source ? `<a class="link dim" href="${esc(x.source)}" target="_blank" rel="noopener noreferrer">${esc(x.name)}'s own pages</a>` : `${esc(x.name)}'s own docs`}${x.asOf ? `, read ${esc(x.asOf)}` : ""}${x.suggest.some(([, w]) => /per M tokens/.test(w)) ? " (a price beside one is that day's, not counted unless you give it below)" : ""}: not every model, and maybe not the newest. Any id it serves can be typed; Test lists the ones your key reaches.</p>` : "";
  const price = mine && cur.price ? cur.price : null;
  const prices = x.listed.length ? "" : `<div class="row2"><label>Its price in, $ per M tokens (optional)<input data-br-in inputmode="decimal" value="${price ? esc(String(price.inUsd)) : ""}" placeholder="yours to give" /></label><label>Out, $ per M tokens<input data-br-out inputmode="decimal" value="${price ? esc(String(price.outUsd)) : ""}" placeholder="yours to give" /></label></div><p class="dim small">The account keeps no price list for it: with your numbers it counts the cost; without them it counts the tokens.</p>`;
  const use = ctx.desk ? `<button type="button" class="btn btn-sm btn-primary" data-br-act="use"${off}>${mine ? "Use it with these settings" : "Use this brain"}</button>` : ctx.pick ? `<button type="button" class="btn btn-sm btn-primary" data-br-act="pick">Pick it for the desk</button>` : "";
  // only a key saved here can be removed here: one in the environment or in the older key file is the owner's own, left as it is
  const forget = x.keyFrom === "file" ? `<button type="button" class="btn btn-sm btn-ghost" data-br-act="forget"${off}>Remove the key</button>` : "";
  return `<section class="br-form" data-br-form="${id}" aria-labelledby="br-f-h"><button type="button" class="link br-back" data-br-back>‹ All brains</button>${head}${note}${why}${env}
    <div class="br-fields">${base}${key}<div class="row2">${listed}${effort || "<div></div>"}</div>${x.listed.length ? "" : warn("model")}${sug}${prices}</div>
    <div class="br-acts"><button type="button" class="btn btn-sm" data-br-act="test"${off}>${x.keyOptional ? "Test it" : "Test the saved key"}</button>${use}${forget}</div>${brMsgHtml(x.id, "act")}</section>`;
}

/** what the owner asks the desk to think with, from the form — or the sentence why not yet: { provider, model, effort?, price? } (effort
 * only where the provider takes one of the desk's three — one it does not take is never sent, so it is never signed either; price only
 * where no listed price applies: null clears an earlier one). A model that looks like an API key is refused in words that do not repeat it */
function brDraft(x, box) {
  const q = (s) => box.querySelector(s);
  const model = String((q("[data-br-model]") || {}).value || "").trim();
  if (!model) return "Name the model, as the endpoint names it.";
  if (brKeyShaped(model)) return BR_KEY_WORDS.model;
  if (!BR_MODEL_SHAPE.test(model)) return "A model id is letters, digits and . - _ : / (up to 80).";
  const effortEl = q("[data-br-effort]");
  const effort = effortEl && x.efforts.includes(effortEl.value) ? effortEl.value : "";
  const out = { provider: x.id, model, ...(effort ? { effort } : {}) };
  if (!x.listed.length) {
    const i = String((q("[data-br-in]") || {}).value || "").trim();
    const o = String((q("[data-br-out]") || {}).value || "").trim();
    if (i || o) {
      if (!i || !o || !(Number(i) >= 0) || !(Number(o) >= 0)) return "A price is dollars per million tokens, in and out: both, or neither.";
      out.price = { inUsd: Number(i), outUsd: Number(o) };
    } else out.price = null;
  }
  return out;
}

/** the setBrainKey draft: the provider, the base URL, the model, the key's hash and its salt — never the key. keyHash "" and salt ""
 * clear the key */
const brKeyDraft = (provider, baseUrl, model, keyHash, salt) => ({ type: "setBrainKey", provider, baseUrl, model, keyHash, salt });

/* a line under a part of the form: what Save, Test or Use said — kept by provider, so a form built again (after a save, on coming back to
   it) says it still */
function brSay(box, which, text, tone = "") {
  const id = box && box.dataset ? box.dataset.brForm : "";
  if (id) BR.said[id] = { ...(BR.said[id] || {}), [which]: { text: text || "", tone } };
  const m = box && box.querySelector(`[data-br-msg="${which}"]`);
  if (!m) return;
  m.className = `msg${text && tone ? ` ${tone}` : ""}`;
  m.textContent = text || "";
}
/* the message line a form is built with: what was said there last */
function brMsgHtml(id, which) {
  const m = (BR.said[id] || {})[which];
  return `<div class="msg${m && m.text && m.tone ? ` ${esc(m.tone)}` : ""}" data-br-msg="${which}" role="status">${m ? esc(m.text) : ""}</div>`;
}
/* every button of the form off while a run is under way, and back as they were after */
function brHold(box, on) {
  for (const b of box.querySelectorAll ? box.querySelectorAll("[data-br-act]") : []) {
    if (on) {
      b.dataset.brWas = b.disabled ? "1" : "";
      b.disabled = true;
    } else if (b.dataset.brWas !== undefined) {
      b.disabled = b.dataset.brWas === "1";
      delete b.dataset.brWas;
    }
  }
}

/** what comes after a model is named, in the words of the button that carries it to the desk: "Use this brain" where a desk is hired,
 * "Pick it for the desk" where a form opened the sheet ("" where neither shows) */
function brNextWords(ctx = {}) {
  const c = ctx && (ctx.desk !== undefined || ctx.pick !== undefined) ? ctx : { desk: !!(BR.ctx && typeof BR.ctx.desk === "function" && BR.ctx.desk()), pick: !!(BR.ctx && typeof BR.ctx.form === "function") };
  return c.desk ? "Use this brain" : c.pick ? "Pick it for the desk" : "";
}
/* two base URLs the same address: what is typed and what the account has, a trailing "/" aside */
const brSameBase = (a, b) => String(a || "").trim().replace(/\/+$/, "") === String(b || "").trim().replace(/\/+$/, "");

/** The yes asked before a key is saved (over the sheet: core asking(), dialog#ask), showing exactly what the owner's device signs — the
 * provider, the base URL, the model, the key's fingerprint (keyHash's first 8 hex) — and where the key itself goes. Never the key, nor any
 * part of it. True only for the yes */
function brConfirmSave(x, s) {
  const row = (k, v) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`;
  return asking(`<form method="dialog" class="ask-f br-sign"><h2 id="ask-title">${esc(`Save the ${x.name} key?`)}</h2><p>Your device signs these four. The key is not one of them.</p><dl>${row("Provider", x.name)}${row("Base URL", s.base || "the provider's own")}${row("Model", s.model || "none named")}${row("Key fingerprint", s.print)}</dl><p class="dim small">${esc(`The key goes once, beside the signature, to the account on this machine, which keeps it in its own file and sends it to ${s.host} only.`)}</p><div class="end"><button type="submit" value="" class="btn">Cancel</button><button type="submit" value="yes" class="btn btn-primary">Sign and save</button></div></form>`, (v) => v === "yes");
}

/** Save the key. In order, and nothing leaves the page until the owner's yes:
 *   - the base URL as the account takes one (https, or http:// on this machine only), its path holding nothing shaped like a key
 *   - the model: named, where the provider lists none of its own to fall back on (else the key is saved and the brain still cannot think);
 *     never shaped like a key; a model id as the desk takes one
 *   - nothing typed in the key field, for a provider that needs a key: nothing is signed ("Paste the key first"). For a server that needs
 *     none (Ollama, vLLM: keyOptional), what is true: at the address the account has now (the catalog's) there is nothing to save — the
 *     model rides "Use this brain" or the form's pick; at ANOTHER address, Save signs that address and the model with no key (brSaveAddress)
 *     — never a key made up to carry it. Where a key is saved for it already, another address waits for that key (pasted again), or for
 *     "Remove the key" first: an address saved with no key must not quietly cost the owner the key they gave
 *   - the typed key found again in the model or the base URL — whole, or a piece of eight characters or more as the model, a host label
 *     or a path segment (brKeyInFields, the account's own rule): refused (it would be signed there)
 * Then the key is read once and its input emptied at once; checked for its shape; hashed with a fresh salt; the yes asked, showing the
 * provider, the base URL, the model and the fingerprint (brConfirmSave) — a "no" sends nothing, not even the hash; setBrainKey prepared
 * (hash and salt, never the key) and signed; the signature sent with the key beside it to POST /api/account/brain-key ({ envelope, apiKey }).
 * The answer's masked tail and the fingerprint are shown; the key is not kept. The form is built again with the catalog's next read,
 * keeping the base URL, the model, the effort and the price as they were set (never the key), and the focus on Save */
async function brSave(x, box) {
  if (!box || BR.busy) return;
  if (!owns()) return void brSay(box, "key", "This browser can look but not sign.", "no");
  const keyEl = box.querySelector("[data-br-key]");
  const typed = keyEl ? String(keyEl.value || "").trim() : "";
  const base = String((box.querySelector("[data-br-base]") || {}).value || x.base || "").trim();
  const wrong = brBaseWrong(base, x.needsBase);
  if (wrong) return void brSay(box, "key", wrong, "no");
  if (brBaseKeyShaped(base)) return void brSay(box, "key", BR_KEY_WORDS.base, "no");
  const model = String((box.querySelector("[data-br-model]") || {}).value || "").trim();
  if (brKeyShaped(model)) return void brSay(box, "key", BR_KEY_WORDS.model, "no");
  if (model && !BR_MODEL_SHAPE.test(model)) return void brSay(box, "key", "A model id is letters, digits and . - _ : / (up to 80).", "no");
  // nothing typed: no key is signed
  if (!typed) {
    if (!x.keyOptional) return void brSay(box, "key", "Paste the key first.", "no");
    const next = brNextWords();
    if (brSameBase(base, x.base)) return void brSay(box, "key", `Nothing to save: it needs no key, and the account calls it at ${x.base || "its usual address"}. Name its model below${next ? `, then ${next}` : ""}.`);
    // another address, with no key: the address and the model, signed with no key
    if (!model) return void brSay(box, "key", `Name the model first: another address is saved with the model ${x.name} serves there.`, "no");
    if (x.hasKey) return void brSay(box, "key", `A key is saved for ${x.name}: to give it another address, paste that key again and Save — or Remove the key first. Nothing was signed.`, "no");
    return await brSaveAddress(x, box, base, model);
  }
  if (!model && !x.listed.length) return void brSay(box, "key", `Name the model first: ${x.name} has no model of its own to fall back on, so a key saved without one leaves it unable to think.`, "no");
  // the typed key, whole or a piece of eight characters or more, also in the model or the base URL: it would be signed there, and the
  // draft's answer from /api/account/prepare would carry it back
  if (brKeyInFields(typed, model, base)) return void brSay(box, "key", BR_KEY_WORDS.inside, "no");
  // from here the key is only in `typed`, for the one request; the input is empty whatever happens next
  if (keyEl) keyEl.value = "";
  if (!BR_KEY_SHAPE.test(typed)) return void brSay(box, "key", "A key is 8 to 512 characters, with no spaces: paste it again.", "no");
  BR.busy = true;
  brHold(box, true);
  brSay(box, "key", "Asking you first…", "wait");
  let sent = false;
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyHash = await brHash(salt, typed);
    if (!(await brConfirmSave(x, { base, model, print: keyHash.slice(0, 8), host: brHost(base) || x.name }))) return void brSay(box, "key", "Nothing was signed or sent. The field is empty: paste the key again to save it.");
    brSay(box, "key", "Signing and saving…", "wait");
    sent = true;
    const p = await Owner.prepare(brKeyDraft(x.id, base, model, keyHash, brHex(salt)));
    if (p.status !== 200 || !p.body || p.body.ok === false || !Array.isArray(p.body.shown)) return void brSay(box, "key", Owner.why(p) || "Refused.", "no");
    const r = await Owner.submitTo("/api/account/brain-key", p.body, { apiKey: typed });
    if (refusedAt(r)) return void brSay(box, "key", Owner.why(r) || "Refused.", "no");
    const b = r.body || {};
    BR.saved[x.id] = { print: keyHash.slice(0, 8), tail: String(b.tail || ""), env: b.envWins ? String(b.envWins) : "" };
    const tail = BR.saved[x.id].tail;
    // a variable in the account's environment that blocks the key just saved (the gateway case), or that is used before it — the answer's
    // word for it, or the catalog's (brOf): saving a key changes nothing in the environment, so what blocked before blocks still
    const blocks = brOf({ id: x.id, envBlocks: b.envBlocks, envWins: b.envWins, keyFrom: b.keyFrom }).envBlocks || x.envBlocks;
    const after = blocks ? ` ${blocks} is set where the account runs and blocks a saved key: unset it and ANTHROPIC_BASE_URL, then restart.` : b.envWins ? ` ${b.envWins} in the account's environment is still used before it.` : "";
    brSay(box, "key", `Saved · fingerprint ${keyHash.slice(0, 8)}${tail ? ` · key ${tail.startsWith("…") ? tail : `…${tail}`}` : ""}.${after}`, "ok");
    // the form is built again with the catalog's next read: the saved key's line (which says this, once), and the way to remove it — what
    // was set in it kept (brDraw), the focus back on Save
    BR.formFor = "";
    BR.refocus = '[data-br-act="save"]';
    if (BR.said[x.id]) delete BR.said[x.id].key;
  } catch {
    brSay(box, "key", "The key could not be signed here: nothing was sent.", "no");
  } finally {
    if (keyEl) keyEl.value = "";
    BR.busy = false;
    brHold(box, false);
    if (sent) brAfter();
  }
}

/** where a base URL is, as a sentence says the account calls it there: "on this machine (localhost:11500)" for this machine's own loopback
 * and only then, else "at ollama.example.com" — the host as typed, never "this machine" for another one */
function brAtWords(url) {
  const where = brWhere(url);
  return where === "this machine" ? `on this machine (${brHost(url)})` : `at ${where || "the address typed"}`;
}

/** The yes asked before a server that needs no key is given another address (brSaveAddress): what the owner's device signs — the provider,
 * the base URL, the model, and no key — and where the desk's questions go from then on, named: "on this machine (…)" only for this
 * machine's own loopback, else the host as typed. True only for the yes */
function brConfirmAddress(x, s) {
  const row = (k, v) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`;
  return asking(`<form method="dialog" class="ask-f br-sign"><h2 id="ask-title">${esc(`Save the ${x.name} address?`)}</h2><p>Your device signs the provider, the base URL and the model. No key is signed or sent.</p><dl>${row("Provider", x.name)}${row("Base URL", s.base)}${row("Model", s.model)}${row("Key", "none")}</dl><p class="dim small">${esc(`From then on the account sends the desk's questions to ${x.name} ${s.at}, with no key. A server that asks for one refuses them: then paste its key and Save.`)}</p><div class="end"><button type="submit" value="" class="btn">Cancel</button><button type="submit" value="yes" class="btn btn-primary">Sign and save</button></div></form>`, (v) => v === "yes");
}

/** Save another address for a server that needs no key (Ollama, vLLM), with nothing in the key field: after the yes (brConfirmAddress),
 * setBrainKey { provider, baseUrl, model, keyHash: "", salt: "" } prepared, signed and sent to POST /api/account/brain-key as { envelope }
 * alone — no apiKey beside it, since there is none. The account writes the address and the model to the provider's file, with no key
 * (account/brain-keys.ts applyBrainKey: a setBrainKey with an empty hash that names an address or a model, for a brain that ignores the
 * key; with neither it takes the file away — "Remove the key" signs it so) and answers {keyless: true}. The base URL and the model were
 * checked before (brSave): https, or http:// on this machine; nothing shaped like a key in either; and no key saved for it already (the
 * account would replace that key with none). Said after: where the account calls it now, by its host — "this machine" only for this
 * machine's own loopback */
async function brSaveAddress(x, box, base, model) {
  const at = brAtWords(base);
  BR.busy = true;
  brHold(box, true);
  brSay(box, "key", "Asking you first…", "wait");
  let sent = false;
  try {
    if (!(await brConfirmAddress(x, { base, model, at }))) return void brSay(box, "key", "Nothing was signed or sent.");
    brSay(box, "key", "Signing and saving…", "wait");
    sent = true;
    const p = await Owner.prepare(brKeyDraft(x.id, base, model, "", ""));
    if (p.status !== 200 || !p.body || p.body.ok === false || !Array.isArray(p.body.shown)) return void brSay(box, "key", Owner.why(p) || "Refused.", "no");
    const r = await Owner.submitTo("/api/account/brain-key", p.body);
    if (refusedAt(r)) return void brSay(box, "key", Owner.why(r) || "Refused.", "no");
    // the account says what it did: {keyless: true} — the address and the model saved with no key. Anything else (it took the file away,
    // as it does for a provider that needs a key) is said as it is, never as a save
    const b = r.body || {};
    if (b.keyless !== true) return void brSay(box, "key", `The account did not keep that address with no key${b.cleared ? ": it took the key file away instead" : ""}. Paste the key your server was started with and Save.`, "no");
    brSay(box, "key", `Saved · the account calls ${x.name} ${at}, with ${model} and no key.`, "ok");
    // the form is built again with the catalog's next read (its address now this one), what was set in it kept, the focus back on Save
    BR.formFor = "";
    BR.refocus = '[data-br-act="save"]';
  } catch {
    brSay(box, "key", "It could not be signed here: nothing was sent.", "no");
  } finally {
    BR.busy = false;
    brHold(box, false);
    if (sent) brAfter();
  }
}

/* a signed run of the form's (own(): prepare, sign, send, then the account read again), said on its line */
async function brRun(box, which, run, done) {
  BR.busy = true;
  brHold(box, true);
  brSay(box, which, "Signing…", "wait");
  let r = null;
  try {
    r = await run();
  } finally {
    BR.busy = false;
    brHold(box, false);
  }
  if (r && !refusedAt(r)) brSay(box, which, done, "ok");
  else brSay(box, which, (r && Owner.why(r)) || "Refused.", "no");
  return r;
}

/* after anything the sheet changed: the desk's reads (its catalog among them) dropped, the opener told, the catalog read again */
function brAfter() {
  forget("/api/account/desk");
  if (BR.ctx && typeof BR.ctx.after === "function") {
    try {
      BR.ctx.after();
    } catch (err) {
      console.error(err);
    }
  }
  brRead();
}

/** Test the saved key: one call the provider bills nothing for where it allows (the account asks it; the key never comes to the page) */
async function brTest(x, box) {
  if (BR.busy) return;
  const model = String((box.querySelector("[data-br-model]") || {}).value || "").trim();
  // a key in the model field is never sent as a model's name, even to the account's own test
  if (brKeyShaped(model)) return void brSay(box, "act", BR_KEY_WORDS.model, "no");
  BR.busy = true;
  brHold(box, true);
  brSay(box, "act", `Asking ${x.name}…`, "wait");
  let r;
  try {
    r = await postJson("/api/account/brain-test", { provider: x.id, ...(model && BR_MODEL_SHAPE.test(model) ? { model } : {}) });
  } finally {
    BR.busy = false;
    brHold(box, false);
  }
  const b = (r && r.body) || {};
  const ok = r && r.status === 200 && b.ok !== false;
  brSay(box, "act", ok ? String(b.words || b.message || `${x.name} answered: the saved key works.`) : refusalOf(b) || String(b.words || b.why || "") || "It did not answer.", ok ? "ok" : "no");
  // the models the provider listed for this key, offered in the model field (each id as the provider wrote it, escaped; the account kept
  // only what looks like a model's name)
  const dl = ok && Array.isArray(b.models) && b.models.length && box.querySelector(`#br-ml-${String(x.id).replace(/[^\w-]/g, "")}`);
  if (dl) dl.innerHTML = b.models.slice(0, 200).map((m) => `<option value="${esc(m)}" label="${esc(`listed by ${x.name} for your key`)}"></option>`).join("");
}

/** the brain a draft names, in words: the provider, the model, the effort (where the provider takes one) and the price — the owner's, or
 * none given (then the account counts the tokens, not their cost), or the provider's listed one (Claude's models) */
function brDraftWords(x, d) {
  const price = d.price ? ` · your price $${d.price.inUsd}/$${d.price.outUsd} per M tokens` : d.price === null ? " · no price of yours: the tokens are counted, not their cost" : x.listed.length ? " · at the model's listed price" : "";
  return `${x.name} · ${d.model}${d.effort ? ` · ${d.effort} effort` : ` · ${x.name}'s own effort`}${price}`;
}

/** the words a yes says of whether the brain will think, judged with the model being signed (brReadyWith) — not with the standing the
 * catalog read without it: ready ("" — nothing to say), ready once signed (a server on this machine whose only want was a model: named
 * now, at the address the account has — and, where the base URL field holds another one not yet saved, that the account calls the one it
 * has), or not ready, in the account's own words */
function brReadyWords(x, model, typedBase = "") {
  if (x.ok) return "";
  if (brReadyWith(x, model)) {
    const other = x.baseEdit && String(typedBase || "").trim() && !brSameBase(typedBase, x.base) ? ` The address typed above is not saved: until Save signs it, the account calls ${x.base}.` : "";
    return ` It is ready with ${model} once you sign: the account calls it at ${x.base || "its usual address"}, with no key.${other}`;
  }
  return ` It is not ready yet (${x.why || "no key"}): until it is, the house seats make no lead up, and the plan's exits still run.`;
}

/** Use this brain: setDesk change "brain", after a yes that says all it signs (the provider, the model, the effort, the price), who bills
 * it, and whether it will think with that model (brReadyWords) */
async function brUse(x, box) {
  if (BR.busy || !owns()) return;
  const d = brDraft(x, box);
  if (typeof d === "string") return void brSay(box, "act", d, "no");
  // a server that needs no key: on this machine (its loopback), nothing is billed; at another address saved for it, it is the owner's server
  // there — named, and nothing said of its bills, which are not the account's to know
  const local = x.group === "local" || x.keyOptional;
  const billed = !local ? `Its calls are billed to your key at ${x.name}.` : !x.base || brWhere(x.base) === "this machine" ? "It runs on this machine: nothing is billed." : `It is your server at ${brHost(x.base)}.`;
  const notYet = brReadyWords(x, d.model, String((box.querySelector("[data-br-base]") || {}).value || ""));
  if (!(await confirmSheet(`From their next call, the desk's house seats think with ${brDraftWords(x, d)}. ${billed}${notYet}`, { title: "Use this brain", yes: "Sign it" }))) return;
  const r = await brRun(box, "act", () => own({ type: "setDesk", desk: "desk", change: "brain", value: JSON.stringify(d) }, brAfter), `The desk thinks with ${x.name} · ${d.model} now.`);
  if (r && !refusedAt(r)) {
    BR.cur = d;
    // drawn again with the desk's brain now this one (its button says so), what Use said kept on its line, what was set kept, the focus
    // back on the button
    BR.formFor = "";
    BR.refocus = '[data-br-act="use"]';
    brDraw();
  }
}

/** Remove the key: setBrainKey with everything empty but the provider (no base URL, no model, keyHash "" and salt ""), after a yes that
 * says what happens: the key file under credentials/brains is removed (the account's handler deletes it); a key the account's environment
 * or an older key file holds is then the one read, if there is one */
async function brForget(x, box) {
  if (BR.busy || !owns()) return;
  if (!(await confirmSheet(`Remove the ${x.name} key from this account? Its key file${x.keyFile ? ` (${x.keyFile})` : ""} is removed. Until a key is saved again, ${x.name} cannot think for the desk — unless the account's environment or an older key file holds a key for it, which is then the one read.`, { title: "Remove the key", yes: "Remove it", danger: true }))) return;
  // all empty — no address, no model, no hash, no salt: what takes the key file away. An empty hash WITH an address or a model is how a
  // server that needs no key is given another address (brSaveAddress), so a removal never names either
  const r = await brRun(box, "key", () => own(brKeyDraft(x.id, "", "", "", ""), brAfter), "The key is removed.");
  if (r && !refusedAt(r)) {
    delete BR.saved[x.id];
    BR.formFor = "";
    BR.refocus = "#br-f-h";
  }
}

/** Pick it: the provider, the model, the effort and the price put into the form that opened the sheet (the setup's, the hiring form's),
 * the sheet closed */
function brPick(x, box) {
  const d = brDraft(x, box);
  if (typeof d === "string") return void brSay(box, "act", d, "no");
  const form = BR.ctx && typeof BR.ctx.form === "function" ? BR.ctx.form() : null;
  if (form) brPutInForm(form, d);
  closeSheet();
}
/** a brain put into a form drawn with dkBrainFields: its provider picked — and told (a change event), so that provider's block shows and the
 * effort offers that provider's own choices (ui/desk.js) — then its model, effort and price, set into the fields as they now are */
function brPutInForm(form, d) {
  if (!form || !form.querySelector) return;
  const set = (sel, v) => {
    const el = form.querySelector(sel);
    if (el && v !== undefined) el.value = v;
    return el;
  };
  const sel = set('[name="provider"]', d.provider);
  if (sel && typeof sel.dispatchEvent === "function" && typeof Event === "function") sel.dispatchEvent(new Event("change", { bubbles: true }));
  set(`[name="model-${d.provider}"]`, d.model);
  set('[name="effort"]', d.effort);
  set(`[name="in-${d.provider}"]`, d.price ? String(d.price.inUsd) : "");
  set(`[name="out-${d.provider}"]`, d.price ? String(d.price.outUsd) : "");
}

// ---- the sheet -------------------------------------------------------------------------------------------------------------------------

/** Open the Brains sheet. ctx: { where ("superagent" | "setup" | "agents" | "hire"), catalog (what the opener read already, drawn at
 * once), cur() → the brain the desk (or the form) uses now, desk() → whether a desk is hired ("Use this brain"), form() → the form a pick
 * goes into ("Pick it for the desk"), after() → what the opener reads again after a change, pick (a provider to open on) } */
function openBrains(ctx = {}) {
  BR.ctx = ctx;
  BR.cur = null;
  BR.said = {};
  // "Saved just now" belongs to this opening: a later one says what the account reads then
  BR.saved = {};
  BR.refocus = "";
  brWipeWire();
  if (ctx.catalog && Array.isArray(ctx.catalog.brains)) BR.catalog = ctx.catalog;
  const cur = brCur();
  BR.pick = String(ctx.pick || (cur && cur.provider) || "");
  BR.formFor = "";
  const body = openSheet(`<div class="br" data-br data-where="${esc(ctx.where || "")}"${BR.pick ? ' data-picked="1"' : ""}><p class="dim small br-lede">What the desk's house seats think with: a model reached with your own key and billed by its provider, asked one structured question at a time. The limits you signed stay the authority.</p><div class="br-split"><div class="br-pickers" data-br-p="cards"><div class="skel-rows" aria-hidden="true"><span class="skel"></span><span class="skel"></span><span class="skel" style="width:60%"></span></div></div><div class="br-side" data-br-p="form"></div></div><div data-br-p="agents"></div></div>`, { title: "Brains", wide: true, redraw: brDraw });
  BR.body = body;
  if (body && body.addEventListener) {
    body.addEventListener("click", brClick);
    // a key typed into the model or the base URL: said beside it as it is typed, in words that never repeat it
    body.addEventListener("input", (e) => {
      const t = e.target;
      if (t && t.matches && t.matches("[data-br-model], [data-br-base]")) brFieldWarn(t.closest("[data-br-form]"));
    });
    body.addEventListener("keydown", (e) => {
      // Enter in the key's field saves it
      if (e.key !== "Enter" || !e.target || !e.target.matches || !e.target.matches("[data-br-key]")) return;
      e.preventDefault();
      brAct("save", e.target.closest("[data-br-form]"));
    });
  }
  brDraw();
  brRead();
  return body;
}
/** the warning lines beside the model and the base URL (data-br-warn), from what those fields hold now: shown, with BR_KEY_WORDS, while one
 * holds what looks like a key (its field marked aria-invalid), hidden and empty otherwise. Never the value */
function brFieldWarn(box) {
  if (!box || !box.querySelector) return;
  for (const [which, sel, shaped] of [["model", "[data-br-model]", brKeyShaped], ["base", "[data-br-base]", brBaseKeyShaped]]) {
    const field = box.querySelector(sel);
    const line = box.querySelector(`[data-br-warn="${which}"]`);
    const bad = !!field && !field.readOnly && shaped(String(field.value || "").trim());
    if (field && field.setAttribute) {
      if (bad) field.setAttribute("aria-invalid", "true");
      else if (field.removeAttribute) field.removeAttribute("aria-invalid");
    }
    if (!line) continue;
    line.textContent = bad ? BR_KEY_WORDS[which] : "";
    line.hidden = !bad;
  }
}

/** A key typed and never saved does not outlive the place it was typed in: when the sheet (dialog#modal) closes — Esc, the close button,
 * "Pick it for the desk" — and when the page is put away (pagehide), every key field of the page is emptied, and so is a model or base URL
 * field that holds what looks like a key (another sheet opened in its place writes over the Brains sheet, its fields with it). Wired once
 * a page */
function brWipeKeys() {
  if (typeof document === "undefined" || !document.querySelectorAll) return;
  for (const el of document.querySelectorAll("[data-br-key]")) el.value = "";
  for (const el of document.querySelectorAll("[data-br-model], [data-br-base]")) if (!el.readOnly && el.tagName !== "SELECT" && (brKeyShaped(el.value) || brBaseKeyShaped(el.value))) el.value = "";
}
function brWipeWire() {
  if (BR.wipeOn) return;
  const modal = typeof $ === "function" ? $("modal") : null;
  if (!modal || typeof modal.addEventListener !== "function") return;
  BR.wipeOn = true;
  modal.addEventListener("close", brWipeKeys);
  if (typeof addEventListener === "function") addEventListener("pagehide", brWipeKeys);
}

/* the brain in use now, as the opener says it (or as "Use this brain" just signed it, before the desk is read again) */
function brCur() {
  if (BR.cur) return BR.cur;
  const c = BR.ctx && typeof BR.ctx.cur === "function" ? BR.ctx.cur() : null;
  return c && typeof c === "object" && c.provider ? c : null;
}
/* the catalog read again (no older answer kept: forget() dropped it after a change), then the sheet drawn with it */
function brRead() {
  const my = ++BR.read;
  api("/api/account/desk/catalog", { ttl: 5_000 }).then((c) => {
    if (my !== BR.read || !c || c.ok === false) return;
    BR.catalog = c;
    brDraw();
  });
}

/** the sheet drawn from BR: the cards painted (only what changed), the agents section, and the picked provider's form — built once for
 * each pick (what is typed in it stays as typed), its standing kept current in place. Also the sheet's redraw after each load of the page */
function brDraw() {
  const body = BR.body;
  if (!body || body.isConnected === false || !body.querySelector) return;
  const root = body.querySelector("[data-br]");
  if (!root) return;
  const c = BR.catalog;
  if (!c) return;
  const cur = brCur();
  const all = brAll(c);
  if (BR.pick && !all.some((x) => x.id === BR.pick)) BR.pick = "";
  if (root.dataset) {
    if (BR.pick) root.dataset.picked = "1";
    else delete root.dataset.picked;
  }
  paint(root.querySelector('[data-br-p="cards"]'), brCardsHtml(c, cur, BR.pick, !!(BR.ctx && typeof BR.ctx.form === "function")));
  paint(root.querySelector('[data-br-p="agents"]'), brAgentsHtml(c));
  const side = root.querySelector('[data-br-p="form"]');
  if (!side) return;
  const x = all.find((y) => y.id === BR.pick);
  const ctx = { cur, desk: !!(BR.ctx && typeof BR.ctx.desk === "function" && BR.ctx.desk()), pick: !!(BR.ctx && typeof BR.ctx.form === "function"), owner: owns() };
  // the form is written whole whenever the pick changes, never laid over the one before (paint() would keep the elements, and with them
  // whatever was typed into the last provider's key field): a key typed for one provider can never be saved for another
  if (!x) {
    if (BR.formFor !== "-") side.innerHTML = `<p class="dim small br-none">Pick a brain to add its key, name its model and test it${ctx.desk ? ", or to switch the desk to it" : ""}.</p>`;
    BR.formFor = "-";
    return;
  }
  if (BR.formFor !== x.id) {
    // the same provider's form built again (after a Save, a Use, a Remove): what the owner set in it is carried across — the base URL they
    // typed, the model, the effort, their price — never the key; a form for another provider starts from what the account says
    const kept = side.querySelector && side.querySelector(`[data-br-form="${String(x.id).replace(/[^\w-]/g, "")}"]`) ? brKept(side) : null;
    side.innerHTML = brFormHtml(x, ctx);
    BR.formFor = x.id;
    if (kept) brPutBack(side, kept);
    brMasked(side);
    brFieldWarn(side.querySelector && side.querySelector("[data-br-form]"));
    // the focus back where the run was asked from (Save, Use), or on the form's heading when that control is gone (Remove)
    if (BR.refocus && side.querySelector) {
      const el = side.querySelector(BR.refocus) || side.querySelector("#br-f-h");
      BR.refocus = "";
      if (el && el.focus && !el.disabled) el.focus({ preventScroll: true });
    }
    return;
  }
  // the same provider's form: only its standing written again, what is typed stays
  const st = side.querySelector('[data-br-p="standing"]');
  if (st) {
    const [word, tone] = brStanding(x);
    paint(st, `<i aria-hidden="true"></i>${esc(word)}`);
    if (st.dataset) st.dataset.s = tone;
  }
}

/** what the owner set in a provider's form that a rebuild of it keeps: the base URL where it is theirs to type, the model, the effort, their
 * price in and out — never the key, which is never read here */
function brKept(side) {
  const v = (sel, editable = false) => {
    const el = side.querySelector(sel);
    return el && (!editable || !el.readOnly) ? String(el.value ?? "") : undefined;
  };
  return { "[data-br-base]": v("[data-br-base]", true), "[data-br-model]": v("[data-br-model]"), "[data-br-effort]": v("[data-br-effort]"), "[data-br-in]": v("[data-br-in]"), "[data-br-out]": v("[data-br-out]") };
}
/* …put back into the form built again, each where its field still is (a choice only where the select still offers it) */
function brPutBack(side, kept) {
  for (const [sel, value] of Object.entries(kept)) {
    if (value === undefined) continue;
    const el = side.querySelector(sel);
    if (!el || (sel === "[data-br-base]" && el.readOnly)) continue;
    if (el.tagName === "SELECT" && ![...(el.options || [])].some((o) => o.value === value)) continue;
    el.value = value;
  }
}
/* the key field drawn as dots (brains.css -webkit-text-security). A browser that cannot draw a text field so is given a password field
   instead: the key is never shown in the clear */
function brMasked(side) {
  const el = side && side.querySelector && side.querySelector("[data-br-key]");
  if (!el || typeof CSS === "undefined" || typeof CSS.supports !== "function") return;
  if (!CSS.supports("-webkit-text-security", "disc")) el.type = "password";
}

/* the sheet's clicks: a card (its form), back to the cards, an action of the form, a Copy */
function brClick(e) {
  const t = e.target && e.target.closest && e.target.closest("[data-br-pick], [data-br-back], [data-br-act], [data-br-copy]");
  if (!t || t.disabled) return;
  if (t.dataset.brCopy !== undefined) return void copyText(t.dataset.brCopy, t);
  if (t.dataset.brBack !== undefined) {
    const was = BR.pick;
    BR.pick = "";
    brDraw();
    const card = BR.body && BR.body.querySelector(`[data-br-pick="${String(was).replace(/[^\w-]/g, "")}"]`);
    if (card && card.focus) card.focus();
    return;
  }
  if (t.dataset.brPick !== undefined) {
    BR.pick = t.dataset.brPick;
    brDraw();
    const h = BR.body && BR.body.querySelector("#br-f-h");
    if (h && h.focus) h.focus({ preventScroll: true });
    const form = BR.body && BR.body.querySelector("[data-br-form]");
    if (form && form.scrollIntoView) form.scrollIntoView({ block: "nearest", behavior: still() ? "auto" : "smooth" });
    return;
  }
  brAct(t.dataset.brAct, t.closest("[data-br-form]"));
}
/* an action of a provider's form, for the provider the form is for */
function brAct(act, box) {
  if (!box) return;
  const x = brAll(BR.catalog).find((y) => y.id === box.dataset.brForm);
  if (!x) return;
  if (act === "save") return void brSave(x, box);
  if (act === "test") return void brTest(x, box);
  if (act === "use") return void brUse(x, box);
  if (act === "forget") return void brForget(x, box);
  if (act === "pick") brPick(x, box);
}
