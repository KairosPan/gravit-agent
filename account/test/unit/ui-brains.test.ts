/** The Brains sheet (ui/brains.js), run as the page runs it: owner.js (the real device key, over a stand-in IndexedDB and Node's own Web
 * Crypto), ui/core.js, ui/brains.js and ui/desk.js in one global scope, in a vm whose fetch is the test's spy. What is checked is what
 * the owner sees and what leaves the page: the providers' cards grouped from a catalog with each one's standing and masked tail; a
 * provider's form (the base URL, a password key field with no name in no form, the model with its dated suggestions, the effort, the
 * owner's price, the provider's own key page); and above all the key — hashed with a fresh salt, never in a /api/account/prepare or
 * /api/exchange body, sent once beside the signature to /api/account/brain-key, its field emptied, only its fingerprint and masked tail
 * shown, kept nowhere on the page. Then the drafts the sheet signs (setBrainKey, an empty hash to clear, setDesk change "brain"), Test,
 * and the pick put back into the form that opened the sheet. Every key here is made up. Nothing leaves the process. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { baseUrlKeyShaped, keyShaped } from "../../src/portfolio/account/brain-key.ts";
import { baseUrlProblem, keyInSignedFields } from "../../src/portfolio/account/brain-keys.ts";
import { parseBaseUrl } from "../../src/portfolio/account/brain-openai.ts";

const PUBLIC = fileURLToPath(new URL("../../src/portfolio/public/", import.meta.url));
const source = (f: string) => readFileSync(join(PUBLIC, f), "utf8");

/** made up for these tests: no provider ever issued it */
const KEY = "sk-made-up-for-tests-0000-abcd-7890";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
type Call = { path: string; method: string; body: Any; raw: string };

/** a stand-in IndexedDB, enough for owner.js to keep its device key: one store, gets and puts answered on the next turn */
const IDB = `(() => {
  const store = new Map();
  const req = (fn) => { const r = {}; queueMicrotask(() => { try { r.result = fn(); r.onsuccess && r.onsuccess(); } catch (e) { r.error = e; r.onerror && r.onerror(); } }); return r; };
  return { open: () => req(() => ({ createObjectStore() {}, transaction: () => ({ objectStore: () => ({ get: (k) => req(() => store.get(k)), put: (v, k) => req(() => void store.set(k, v)) }) }) })) };
})()`;

/** elements as the sheet uses them, made in the page's own scope: an input with a value, a button, and a box (a provider's form) that finds
 * each by the selector the sheet asks with */
const FAKE = `function asOwner() { Object.defineProperty(Owner, "role", { get: () => "owner", configurable: true }); }
function fakeInput(value) { return { value, disabled: false, dataset: {}, type: "text" }; }
function fakeBox(id, parts) {
  const msgs = { key: { className: "", textContent: "" }, act: { className: "", textContent: "" } };
  const buttons = [{ disabled: false, dataset: {} }, { disabled: false, dataset: {} }];
  return { dataset: { brForm: id }, isConnected: true, msgs, buttons,
    querySelector(s) { const m = /^\\[data-br-msg="(\\w+)"\\]$/.exec(s); if (m) return msgs[m[1]] || null; return parts[s] || null; },
    querySelectorAll(s) { return s === "[data-br-act]" ? buttons : []; } };
}`;

/** The page's scripts in a stand-in for the browser, fetch answered by `answer` and every call kept */
function page(answer: (c: Call) => { status: number; body: unknown } = () => ({ status: 200, body: { ok: true } })) {
  const calls: Call[] = [];
  const stored: string[] = [];
  const element = (): Any => ({ addEventListener() {}, removeAttribute() {}, setAttribute() {}, querySelectorAll: () => [], querySelector: () => null, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {}, style: {}, hidden: false, value: "", textContent: "", innerHTML: "" });
  const sandbox: Record<string, unknown> = {
    document: { getElementById: element, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: element(), documentElement: { dataset: { theme: "cream" }, setAttribute() {} }, hidden: false, activeElement: null },
    location: { hash: "", origin: "http://127.0.0.1:4903" },
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem: (k: string) => void stored.push(k), removeItem() {} },
    sessionStorage: { getItem: () => null, setItem: (k: string) => void stored.push(k) },
    // an event as the page makes one: its type, and whether it bubbles (new Event("change", { bubbles: true }))
    Event: class {
      readonly bubbles: boolean;
      constructor(
        readonly type: string,
        init: { bubbles?: boolean } = {},
      ) {
        this.bubbles = !!init.bubbles;
      }
    },
    addEventListener() {},
    dispatchEvent: () => true,
    fetch: async (path: string, init: { method?: string; body?: string } = {}) => {
      const raw = String(init.body ?? "");
      const c: Call = { path, method: init.method ?? "GET", body: raw ? JSON.parse(raw) : undefined, raw };
      calls.push(c);
      const a = answer(c);
      return { status: a.status, statusText: "", json: async () => a.body };
    },
    crypto: globalThis.crypto,
    TextEncoder,
    URL,
    btoa,
    queueMicrotask,
    console,
    URLSearchParams,
    Intl,
    setTimeout,
    clearTimeout,
  };
  const ctx = createContext(sandbox);
  sandbox.window = runInContext("globalThis", ctx);
  sandbox.indexedDB = runInContext(IDB, ctx);
  for (const f of ["owner.js", "ui/core.js", "ui/brains.js", "ui/desk.js"]) new Script(source(f), { filename: f }).runInContext(ctx);
  runInContext(FAKE, ctx);
  const run = <T = unknown>(code: string): T => runInContext(code, ctx) as T;
  const out = <T = Any>(code: string): T => JSON.parse(run<string>(`JSON.stringify(${code})`)) as T;
  return { run, out, calls, stored, sandbox };
}

/** what /api/account/prepare answers for a draft: the action with its nonce, and the fields shown to sign — the account's shape */
const prepared = (draft: Record<string, unknown>) => {
  const action = { ...draft, nonce: 1_760_000_000_007 };
  return { ok: true, action, primaryType: "AccountBrain:SetKey", domain: { name: "Account", version: "1", chainId: 1337 }, accountChain: "local", shown: Object.entries(action).map(([name, value]) => ({ name, value: String(value) })) };
};

const FIX = (code: string, words: string) => ({ code, file: `/Users/x/.account/credentials/brains/${code}.json`, restart: false, words });
const ALL = ["low", "medium", "high"];
const SUGGEST = (models: string[], source: string, prices: Record<string, { inUsd: number; outUsd: number }> = {}) => ({ models, source, checked: "2026-10-15", prices });
/** a catalog as the account gives it (desk.ts catalog(): each brain's standing with its BrainAbout), in an order of its own */
const CATALOG = {
  ok: true,
  brains: [
    { id: "claude", label: "Claude · Anthropic API", kind: "model-api", format: "anthropic", ok: true, how: "the Anthropic API", model: "claude-opus-5-5", models: [{ id: "claude-opus-5-5", name: "Claude Opus 5.5", inUsd: 4, outUsd: 20 }, { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", inUsd: 2, outUsd: 10 }], baseUrl: "https://api.anthropic.com", efforts: ALL, envWins: "ANTHROPIC_API_KEY", keyFrom: "env", keyFile: "credentials/brains/claude.json", keyPage: "https://platform.claude.com/settings/keys" },
    { id: "deepseek", label: "DeepSeek", kind: "model-api", format: "openai", ok: false, why: "no key", fix: FIX("no-key", "No key for DeepSeek yet."), baseUrl: "https://api.deepseek.com", models: [], efforts: ["low", "high"], suggested: SUGGEST(["deepseek-flash", "deepseek-v4-pro"], "https://api-docs.deepseek.com/quick_start/pricing", { "deepseek-flash": { inUsd: 0.3, outUsd: 1.2 } }), keyFrom: "none", keyFile: "credentials/brains/deepseek.json", note: "JSON mode only (no JSON schema): the answer is checked against the shape and asked once more when it does not fit." },
    { id: "openai", label: "OpenAI", kind: "model-api", format: "openai", ok: true, how: "https://api.openai.com/v1", baseUrl: "https://api.openai.com/v1", tail: "…ab12", keyFrom: "file", keyFile: "credentials/brains/openai.json", model: "gpt-6.1-sol", models: [], efforts: ALL, suggested: SUGGEST(["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"], "https://developers.openai.com/api/docs/models"), keyPage: "https://platform.openai.com/settings/organization/api-keys" },
    { id: "xai", label: "Grok · xAI API", kind: "model-api", format: "openai", ok: false, why: "xAI refused the key", fix: FIX("rejected", "xAI refused the key: save one it accepts."), baseUrl: "https://api.x.ai/v1", tail: "…zz99", keyFrom: "file", models: [], efforts: [] },
    { id: "meta", label: "Muse · Meta Model API", kind: "model-api", format: "openai", ok: false, why: "no key", baseUrl: "https://api.meta.ai/v1", models: [], efforts: ALL, keyFrom: "none" },
    { id: "qwen", label: "Qwen · Alibaba Model Studio", kind: "model-api", format: "openai", ok: false, why: "no base URL", baseUrl: "", baseRequired: true, baseHint: "https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", models: [], efforts: [], keyFrom: "none" },
    { id: "groq", label: "Groq", kind: "model-api", format: "openai", ok: false, why: "no key", baseUrl: "https://api.groq.com/openai/v1", models: [], efforts: [], keyFrom: "none" },
    { id: "vllm", label: "vLLM", kind: "local", format: "openai", ok: false, why: "nothing answers at http://localhost:8000/v1", baseUrl: "http://localhost:8000/v1", keyOptional: true, models: [], efforts: [], keyFrom: "none" },
    { id: "ollama", label: "Ollama", kind: "local", format: "openai", ok: true, how: "http://localhost:11434/v1", baseUrl: "http://localhost:11434/v1", keyOptional: true, model: "qwen3:8b", models: [], efforts: [], keyFrom: "none" },
    { id: "custom", label: "Custom <img src=x onerror=alert(1)>", kind: "custom", format: "openai", ok: false, why: "no base URL", baseUrl: "", baseRequired: true, models: [], efforts: ALL, keyFrom: "none" },
  ],
};

// ---- the cards ------------------------------------------------------------------------------------------------------------------------------

describe("the sheet's cards, from a catalog", () => {
  const p = page();

  it("groups the providers — Model APIs, On this machine, Custom — in the owner's order, each with its standing and masked tail, the one in use marked, the picked one pressed, every string escaped", () => {
    const html = p.run<string>(`brCardsHtml(${JSON.stringify(CATALOG)}, { provider: "openai", model: "gpt-6.1-sol" }, "deepseek")`);
    const at = (s: string) => html.indexOf(s);
    expect(at(">Model APIs</h3>")).toBeGreaterThan(-1);
    expect(at(">Model APIs</h3>")).toBeLessThan(at(">On this machine</h3>"));
    expect(at(">On this machine</h3>")).toBeLessThan(at(">Custom</h3>"));
    // OpenAI, DeepSeek, Grok, Muse, Claude, Qwen, Groq: the order the owner meets them, whatever order the catalog gave
    const order = ["openai", "deepseek", "xai", "meta", "claude", "qwen", "groq"].map((id) => at(`data-br-pick="${id}"`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(at('data-br-pick="vllm"')).toBeGreaterThan(at(">On this machine</h3>"));
    // the standing, in words (the dot only repeats them)
    const card = (id: string) => html.slice(at(`data-br-pick="${id}"`), html.indexOf("</button>", at(`data-br-pick="${id}"`)));
    expect(card("openai")).toContain('<span class="br-st" data-s="ok"><i aria-hidden="true"></i>Ready · key …ab12</span>');
    expect(card("openai")).toContain('<span class="tag up">In use</span>');
    // opened from a form: the one the form names is "Picked", not in use
    expect(p.run<string>(`brCardsHtml(${JSON.stringify(CATALOG)}, { provider: "openai" }, "", true)`)).toContain('<span class="tag up">Picked</span>');
    expect(card("deepseek")).toContain('aria-pressed="true"');
    expect(card("deepseek")).toContain(">No key</span>");
    expect(card("xai")).toContain('data-s="warn"><i aria-hidden="true"></i>Key refused</span>');
    // a key in the account's environment, used before any file: ready, and said where from
    expect(card("claude")).toContain(">Ready · from the environment</span>");
    expect(card("ollama")).toContain(">Local · ready</span>");
    // a server on this machine needs no key and no file: not ready until a model is named, never "not set up"
    expect(card("vllm")).toContain(">Local · not ready</span>");
    // the reason is said in full on the provider's form, not as a card's tooltip
    expect(card("vllm")).not.toContain("title=");
    // a label from the account is drawn as text
    expect(html).toContain("Custom &lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
    // nothing offered: said so; a group with none is not drawn
    expect(p.run(`brCardsHtml({ ok: true, brains: [] }, null, "")`)).toBe('<p class="dim small">The account offers no brain yet.</p>');
    expect(p.run<string>(`brCardsHtml({ ok: true, brains: [${JSON.stringify(CATALOG.brains[2])}] }, null, "")`)).not.toContain("On this machine");
  });

  it("takes the account's word over the page's own wherever both speak: the kind, the base URL, the suggestions with their source, date and that day's prices, the efforts, the key's tail and where it is read from", () => {
    const x = p.out(`brOf({ id: "openai", label: "OpenAI", kind: "local", baseUrl: "http://127.0.0.1:9999/v1", suggested: { models: ["gpt-x", "gpt-6-luna"], source: "https://example.test/models", checked: "2026-10-15", prices: { "gpt-6-luna": { inUsd: 0.1, outUsd: 0.5 } } }, efforts: ["low", "high"], tail: "…cd34", keyFrom: "older-file", envWins: "OPENAI_API_KEY", keyPage: "https://example.test/keys", note: "The account's note." })`);
    expect([x.group, x.base, x.suggest, x.asOf, x.source, x.efforts, x.tail, x.keyFrom, x.env, x.key, x.note]).toEqual(["local", "http://127.0.0.1:9999/v1", [["gpt-x", ""], ["gpt-6-luna", "low cost · $0.1/$0.5 per M tokens"]], "2026-10-15", "https://example.test/models", ["low", "high"], "cd34", "older-file", "OPENAI_API_KEY", "https://example.test/keys", "The account's note."]);
    // a key too short to show any of it ("…"): set, its tail not shown
    expect(p.out(`[brOf({ id: "openai", tail: "…" }).keySet, brOf({ id: "openai", tail: "…" }).tail]`)).toEqual([true, ""]);
    // the account silent: the page's own, read from the provider's docs on the date it says
    const y = p.out(`brOf({ id: "deepseek" })`);
    expect([y.group, y.name, y.base, y.suggest.map((m: string[]) => m[0]), y.asOf, y.key]).toEqual(["api", "DeepSeek", "https://api.deepseek.com", ["deepseek-flash", "deepseek-v4-pro"], "15 Oct 2026", "https://platform.deepseek.com/api_keys"]);
    // a provider the page does not know: a model API, its own name, no suggestion made up for it
    expect(p.out(`brOf({ id: "newco", label: "NewCo" })`)).toMatchObject({ group: "api", name: "NewCo", suggest: [], key: "", note: "" });
  });
});

// ---- a provider's form ----------------------------------------------------------------------------------------------------------------------

describe("a provider's form", () => {
  const p = page();
  const form = (id: string, ctx: Record<string, unknown> = { owner: true, desk: true, cur: { provider: "openai", model: "gpt-6.1-sol", effort: "high", price: { inUsd: 2, outUsd: 10 } } }) => p.run<string>(`brFormHtml(brOf(${JSON.stringify(CATALOG.brains.find((b) => b.id === id))}), ${JSON.stringify(ctx)})`);

  it("draws the key as one field with no name, in no form — a text field drawn as dots, never a password field a browser offers to save — and the rest of what the provider takes", () => {
    const f = form("openai");
    // the key: a text field (a password field a fetch "submits" is what Chrome offers to keep in its password store), nothing to remember,
    // correct or complete it, no name for a form to sweep — and no form at all
    expect(f).toContain('<input id="br-key-openai" type="text" data-br-key autocomplete="off" spellcheck="false" autocapitalize="off" autocorrect="off" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other" placeholder="Paste the key" />');
    expect(f).not.toContain('type="password"');
    expect(f).not.toMatch(/\sname="/);
    expect(f).not.toContain("<form");
    // drawn as dots by the sheet's style, in every browser the page supports
    expect(source("ui/brains.css")).toMatch(/\.br \[data-br-key\] \{ -webkit-text-security: disc; \}/);
    // the base URL the provider answers at, fixed for OpenAI; the model as the desk uses it now, with the docs' suggestions, dated
    expect(f).toContain('<input data-br-base value="https://api.openai.com/v1" inputmode="url" autocomplete="off" spellcheck="false" autocapitalize="off" readonly />');
    expect(f).toContain('<input data-br-model list="br-ml-openai" value="gpt-6.1-sol"');
    expect(f).toContain('<datalist id="br-ml-openai"><option value="gpt-6-astra" label="flagship"></option><option value="gpt-6.1-sol" label="balanced"></option><option value="gpt-6-luna" label="low cost"></option></datalist>');
    expect(f).toContain('Suggestions from <a class="link dim" href="https://developers.openai.com/api/docs/models" target="_blank" rel="noopener noreferrer">OpenAI\'s own pages</a>, read 2026-10-15: not every model, and maybe not the newest. Any id it serves can be typed; Test lists the ones your key reaches.');
    expect(f).toContain('<option value="high" selected>high</option>');
    expect(f).toContain('<input data-br-in inputmode="decimal" value="2"');
    // the provider's own key page, opened apart
    expect(f).toContain('<a class="link" href="https://platform.openai.com/settings/organization/api-keys" target="_blank" rel="noopener noreferrer">Get a key ↗</a>');
    // a key is saved: its tail, and the way to remove it; a desk is hired: the switch
    expect(f).toContain('A key is in use: <span class="br-nw">…ab12</span>');
    expect(f).toContain("It is written to credentials/brains/openai.json, readable by you alone.");
    expect(f).toContain('data-br-act="forget"');
    expect(f).toContain('data-br-act="use">Use it with these settings</button>');
    expect(f).toContain("sends it to api.openai.com only.");
  });

  it("lets the owner type the base URL only where it is theirs (a Qwen workspace's, this machine's, a custom endpoint's), asks a key of a server on this machine only if it wants one, and offers only the efforts a provider takes", () => {
    expect(form("qwen")).toContain('<input data-br-base value="" inputmode="url" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1" />');
    expect(form("vllm")).toMatch(/<input data-br-base value="http:\/\/localhost:8000\/v1"[^>]*autocapitalize="off" \/>/);
    expect(form("custom")).toContain('placeholder="https://…/v1"');
    const o = form("ollama");
    // nothing saved to test for a server that takes no key: "Test it"
    expect(o).toContain('data-br-act="test">Test it</button>');
    expect(form("deepseek")).toContain('data-br-act="test">Test the saved key</button>');
    expect(o).toContain('<label class="br-key-l" for="br-key-ollama">API key (only if it asks for one)</label>');
    // no key and no file needed: the address the account has now (the catalog's), what it needs (a model), and that another address is the
    // account's once Save signs it — with the model, and a key only where the server asks for one: never a key to make up
    expect(o).toContain("Needs no key: the account calls it at http://localhost:11434/v1. Name the model your server serves below, then Use this brain. Another address counts once Save signs it, with the model — and a key only if your server was started with one.");
    expect(o).not.toMatch(/any 8 characters|ignores it:/);
    // Ollama's settings saved with no key: what was saved, never "A key is in use"
    const saved = p.run<string>(`brFormHtml(brOf(${JSON.stringify({ ...CATALOG.brains.find((b) => b.id === "ollama"), keyFrom: "file", tail: undefined, baseUrl: "http://localhost:11434/v1", model: "qwen3:8b" })}), { owner: true })`);
    expect(saved).toContain("Saved with no key: localhost:11434 · qwen3:8b");
    expect(saved).not.toContain("A key is in use");
    // no effort where the provider takes none of the desk's three; DeepSeek's two only (the effort it does not take is never offered)
    expect(form("groq")).not.toContain("data-br-effort");
    expect(form("deepseek")).toContain('<select data-br-effort><option value="low">low</option><option value="high" selected>high</option></select>');
    // that day's price beside a suggestion, said as that day's
    expect(form("deepseek")).toContain('<option value="deepseek-flash" label="V4.1 Flash · $0.3/$1.2 per M tokens"></option>');
    expect(form("deepseek")).toContain("(a price beside one is that day's, not counted unless you give it below)");
  });

  it("draws Claude's listed models with their prices (no price of the owner's asked), its one address fixed, and says a key in the environment wins — and offers no Remove for a key that is not the sheet's", () => {
    const f = form("claude");
    expect(f).toContain('<select data-br-model><option value="claude-opus-5-5" selected>Claude Opus 5.5 · $4/$20 per M tokens</option><option value="claude-sonnet-5-5">Claude Sonnet 5.5 · $2/$10 per M tokens</option></select>');
    expect(f).not.toContain("data-br-in");
    expect(f).toContain('<input data-br-base value="https://api.anthropic.com" inputmode="url" autocomplete="off" spellcheck="false" autocapitalize="off" readonly />');
    expect(f).toContain("A key is in use (read from the account&#39;s environment)");
    expect(f).not.toContain('data-br-act="forget"');
    expect(f).toContain("ANTHROPIC_API_KEY is set where the account runs, and is used before a key saved here");
    expect(f).toContain('href="https://platform.claude.com/settings/keys"');
  });

  it("says why a provider cannot think in the account's own words, with its key file for whoever would rather put it there", () => {
    const f = form("deepseek");
    // no key yet: the field below is the way, said in a line; the key file and the account's sentence about it folded under it
    expect(f).toContain('<div class="br-why"><p class="small">No key yet: paste one below.</p><details class="br-file"><summary class="small">Or put the key in its key file</summary><p class="dim small">No key for DeepSeek yet.</p>');
    // a key refused: the account's own words, in front
    expect(form("xai")).toContain('<div class="br-why"><p class="small">xAI refused the key: save one it accepts.</p>');
    // a key saved, no model named yet (the file's model the template's): the model field is the way, never "no key"
    const noModel = p.run<string>(`brFormHtml(brOf(${JSON.stringify({ ...CATALOG.brains[1], tail: "…abcd", keyFrom: "file", fix: FIX("example", "The key file names no model.") })}), { owner: true })`);
    expect(noModel).toContain('<p class="small">Its key is saved; it needs a model: name it below — no need to paste the key again.</p>');
    // opened from a form, or with a desk: the button that carries the model there, named
    expect(p.run<string>(`brFormHtml(brOf(${JSON.stringify({ ...CATALOG.brains[1], tail: "…abcd", keyFrom: "file", fix: FIX("example", "The key file names no model.") })}), { owner: true, pick: true })`)).toContain("name it below, then Pick it for the desk — no need to paste the key again.");
    expect(noModel).not.toContain("No key yet");
    expect(f).toContain('<code class="br-path">/Users/x/.account/credentials/brains/no-key.json</code><button type="button" class="btn btn-sm" data-br-copy="/Users/x/.account/credentials/brains/no-key.json">Copy</button>');
    expect(f).toContain("JSON mode only (no JSON schema): the answer is checked against the shape");
    expect(f).not.toMatch(/sk-|apiKey/);
  });

  it("offers Use this brain only with a desk hired, Pick it only to a form that opened the sheet, and nothing to press to a browser that only looks", () => {
    expect(form("deepseek", { owner: true, desk: false })).not.toContain('data-br-act="use"');
    expect(form("deepseek", { owner: true, desk: false, pick: true })).toContain('data-br-act="pick">Pick it for the desk</button>');
    expect(form("deepseek", { owner: true, desk: true })).toContain('data-br-act="use">Use this brain</button>');
    const looking = form("openai", { owner: false, desk: true });
    expect(looking.match(/data-br-act="(save|test|use|forget)"[^>]*disabled title="This browser can look but not sign"/g)).toHaveLength(4);
    // an older account's entry, with none of the catalog's new fields: drawn from the page's own facts, dated
    const older = p.run<string>(`brFormHtml(brOf({ id: "deepseek", label: "DeepSeek", ok: false, why: "no key", models: [] }), { owner: true })`);
    expect(older).toContain('<option value="deepseek-flash" label="V4.1 Flash"></option>');
    expect(older).toContain("Suggestions from DeepSeek's own docs, read 15 Oct 2026");
    expect(older).toContain('href="https://platform.deepseek.com/api_keys"');
    expect(looking).toMatch(/type="text" data-br-key [^>]* disabled title="This browser can look but not sign"/);
  });

  it("says what Muse, Grok Bot and Instinct are: agents with no API to call, the models behind two of them a click away, Instinct nothing to connect", () => {
    const a = p.run<string>(`brAgentsHtml(${JSON.stringify(CATALOG)})`);
    expect(a).toContain("Agents: Muse, Grok Bot, Instinct");
    expect(a).toContain('<button type="button" class="link" data-br-pick="meta">Muse · Meta Model API</button>');
    expect(a).toContain('<button type="button" class="link" data-br-pick="xai">Grok · xAI API</button>');
    expect(a).toContain("Neither publishes an API or a model: nothing to connect yet.");
    expect(a).toContain('href="https://instinct.xyz/docs" target="_blank" rel="noopener noreferrer"');
    expect(a).toContain("was decided against for now (2026-10-15): it is not built.");
    // a model API the account does not offer is named, not made a button that goes nowhere
    expect(p.run<string>(`brAgentsHtml({ ok: true, brains: [] })`)).not.toContain("data-br-pick");
  });
});

// ---- the key ---------------------------------------------------------------------------------------------------------------------------------

describe("typing a key: it never rides a draft, and the page keeps none of it", () => {
  const answer = (c: Call) => {
    if (c.path === "/api/account/prepare") return { status: 200, body: prepared(c.body.draft) };
    if (c.path === "/api/account/brain-key") return { status: 200, body: { ok: true, provider: "deepseek", tail: "…7890", standing: { ok: true } } };
    if (c.path === "/api/account/desk/catalog") return { status: 200, body: CATALOG };
    return { status: 200, body: { ok: true } };
  };
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  };

  it("hashes the key with a fresh salt, prepares setBrainKey with the hash and the salt only, signs it, and sends the key once beside the signature to /api/account/brain-key — the field emptied, the fingerprint and the tail shown", async () => {
    const p = page(answer);
    p.run(`var KEYEL = fakeInput(${JSON.stringify(`  ${KEY}\n`)}); var BOX = fakeBox("deepseek", { "[data-br-key]": KEYEL, "[data-br-base]": fakeInput("https://api.deepseek.com"), "[data-br-model]": fakeInput("deepseek-v4-pro") }); asOwner(); var ASKED = []; brConfirmSave = async (x, s) => (ASKED.push(s), true)`);
    await p.run(`brSave(brOf(${JSON.stringify(CATALOG.brains[1])}), BOX)`);
    await settle();
    const paths = p.calls.map((c) => `${c.method} ${c.path}`);
    expect(paths.slice(0, 2)).toEqual(["POST /api/account/prepare", "POST /api/account/brain-key"]);
    expect(paths).not.toContain("POST /api/exchange");
    // the key in exactly one request: the one to brain-key, beside the envelope — never in /prepare, /exchange or any read
    for (const c of p.calls.filter((x) => x.path !== "/api/account/brain-key")) expect(c.raw, c.path).not.toContain(KEY);
    const send = p.calls.find((c) => c.path === "/api/account/brain-key")!;
    expect(Object.keys(send.body).sort()).toEqual(["apiKey", "envelope"]);
    expect(send.body.apiKey).toBe(KEY);
    expect(JSON.stringify(send.body.envelope)).not.toContain(KEY);
    expect(Object.keys(send.body.envelope).sort()).toEqual(["action", "nonce", "signature"]);
    // the draft: exactly these fields; the hash is SHA-256 of the salt's 16 bytes then the key's UTF-8 bytes
    const draft = p.calls[0]!.body.draft;
    expect(Object.keys(draft)).toEqual(["type", "provider", "baseUrl", "model", "keyHash", "salt"]);
    expect([draft.type, draft.provider, draft.baseUrl, draft.model]).toEqual(["setBrainKey", "deepseek", "https://api.deepseek.com", "deepseek-v4-pro"]);
    expect(draft.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(draft.keyHash).toBe(createHash("sha256").update(Buffer.from(draft.salt, "hex")).update(KEY, "utf8").digest("hex"));
    expect(send.body.envelope.action).toEqual({ ...draft, nonce: 1_760_000_000_007 });
    expect(send.body.envelope.signature.es256).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    // the field is empty; what shows is the fingerprint and the masked tail
    expect(p.run("KEYEL.value")).toBe("");
    expect(p.run("BOX.msgs.key.textContent")).toBe(`Saved · fingerprint ${draft.keyHash.slice(0, 8)} · key …7890.`);
    expect(p.run("BOX.msgs.key.className")).toBe("msg ok");
    // the form is drawn again with the next read of the catalog, saying it once, in its "Saved just now" line: fingerprint and tail only
    expect(p.run("BR.formFor")).toBe("");
    expect(p.out("BR.saved.deepseek")).toEqual({ print: draft.keyHash.slice(0, 8), tail: "…7890", env: "" });
    expect(p.run<string>(`brFormHtml(brOf(${JSON.stringify(CATALOG.brains[1])}), { owner: true })`)).toContain(`Saved just now · fingerprint <span class="mono">${draft.keyHash.slice(0, 8)}</span> · <span class="br-nw">key …7890</span>`);
    // kept nowhere on the page: not in the sheet's state, the cache of reads, storage
    expect(p.run<string>("JSON.stringify(BR)")).not.toContain(KEY);
    expect(p.run<string>("JSON.stringify([...API])")).not.toContain(KEY);
    expect(p.stored).toEqual([]);
    // a second save: a fresh salt
    p.run(`KEYEL.value = ${JSON.stringify(KEY)}`);
    await p.run(`brSave(brOf(${JSON.stringify(CATALOG.brains[1])}), BOX)`);
    const salts = p.calls.filter((c) => c.path === "/api/account/prepare").map((c) => c.body.draft.salt);
    expect(salts).toHaveLength(2);
    expect(salts[0]).not.toBe(salts[1]);
  });

  it("sends nothing for a key that cannot be one (a space in it), nor to an http:// base off this machine, and empties the field once it was read", async () => {
    const p = page(answer);
    p.run(`asOwner(); var KEYEL = fakeInput("sk made up with spaces 1234"); var BOX = fakeBox("deepseek", { "[data-br-key]": KEYEL, "[data-br-base]": fakeInput("https://api.deepseek.com"), "[data-br-model]": fakeInput("deepseek-flash") })`);
    await p.run(`brSave(brOf(${JSON.stringify(CATALOG.brains[1])}), BOX)`);
    expect(p.calls).toEqual([]);
    expect(p.run("KEYEL.value")).toBe("");
    expect(p.run("BOX.msgs.key.textContent")).toBe("A key is 8 to 512 characters, with no spaces: paste it again.");
    // a custom endpoint over http:// elsewhere: refused before anything is read or sent
    p.run(`KEYEL = fakeInput(${JSON.stringify(KEY)}); BOX = fakeBox("custom", { "[data-br-key]": KEYEL, "[data-br-base]": fakeInput("http://models.example.com/v1"), "[data-br-model]": fakeInput("m-1") })`);
    await p.run(`brSave(brOf(${JSON.stringify(CATALOG.brains[9])}), BOX)`);
    expect(p.calls).toEqual([]);
    expect(p.run("BOX.msgs.key.textContent")).toBe("http:// only for this machine (localhost, 127.0.0.1): anywhere else the key would travel unencrypted. Use https://.");
    expect(p.out('["https://x.example/v1", "http://localhost:11434/v1", "http://127.0.0.1:8000/v1", "http://[::1]:8000/v1", "http://10.0.0.2/v1", "https://u:p@x.example/v1", "ftp://x"].map((u) => brBaseWrong(u, true))')).toEqual(["", "", "", "", "http:// only for this machine (localhost, 127.0.0.1): anywhere else the key would travel unencrypted. Use https://.", "A base URL carries no name or password: the key goes in its own field.", "A base URL starts with https:// (or http:// on this machine)."]);
    // no key typed for a model API: asked for, nothing sent
    p.run(`KEYEL = fakeInput(""); BOX = fakeBox("deepseek", { "[data-br-key]": KEYEL, "[data-br-base]": fakeInput("https://api.deepseek.com"), "[data-br-model]": fakeInput("") })`);
    await p.run(`brSave(brOf(${JSON.stringify(CATALOG.brains[1])}), BOX)`);
    expect([p.calls.length, p.run("BOX.msgs.key.textContent")]).toEqual([0, "Paste the key first."]);
  });

  it("says the account's refusal in its own words, and the field is empty after it too", async () => {
    const p = page((c) => (c.path === "/api/account/brain-key" ? { status: 401, body: { ok: false, refusal: { message: "The key did not match its signature: nothing was saved." } } } : answer(c)));
    p.run(`asOwner(); brConfirmSave = async () => true; var KEYEL = fakeInput(${JSON.stringify(KEY)}); var BOX = fakeBox("deepseek", { "[data-br-key]": KEYEL, "[data-br-base]": fakeInput("https://api.deepseek.com"), "[data-br-model]": fakeInput("deepseek-flash") })`);
    await p.run(`brSave(brOf(${JSON.stringify(CATALOG.brains[1])}), BOX)`);
    expect(p.run("BOX.msgs.key.textContent")).toBe("The key did not match its signature: nothing was saved.");
    expect(p.run("BOX.msgs.key.className")).toBe("msg no");
    expect(p.run("KEYEL.value")).toBe("");
    expect(p.run<string>("JSON.stringify(BR.saved)")).toBe("{}");
  });

  it("refuses to send what rides beside a signature anywhere but a path of this account", async () => {
    const p = page(answer);
    const r = await p.run<Promise<Any>>(`Owner.submitTo("https://elsewhere.example/steal", ${JSON.stringify(prepared({ type: "setBrainKey" }))}, { apiKey: ${JSON.stringify(KEY)} })`);
    expect(r).toEqual({ status: 0, body: { ok: false, error: "Not a path of this account." } });
    expect(p.calls).toEqual([]);
  });
});

// ---- what else the sheet signs, and asks -----------------------------------------------------------------------------------------------------

describe("the sheet's other signatures, its test, and the pick", () => {
  it("signs nothing when Save is pressed with no key — an empty fingerprint would take a saved key away — and says so, for a server on this machine too", async () => {
    const p = page();
    p.run(`asOwner(); var DRAFTS = []; own = async (d, then) => { DRAFTS.push(d); if (then) await then(); return { status: 200, body: { ok: true } }; }; var BOX = fakeBox("ollama", { "[data-br-key]": fakeInput(""), "[data-br-base]": fakeInput("http://localhost:11434/v1"), "[data-br-model]": fakeInput("qwen3:8b") })`);
    await p.run(`brSave(brOf(${JSON.stringify(CATALOG.brains[8])}), BOX)`);
    expect(p.out("DRAFTS")).toEqual([]);
    expect(p.calls).toEqual([]);
    expect(p.run("BOX.msgs.key.textContent")).toBe("Nothing to save: it needs no key, and the account calls it at http://localhost:11434/v1. Name its model below.");
    // a key typed for vLLM on this machine goes the same way as any: over http:// on this machine's own address
    expect(p.run(`brBaseWrong("http://localhost:8000/v1", true)`)).toBe("");
  });

  it("switches the desk's brain with ONE setDesk change \"brain\" after a yes — the model, the effort, the owner's own price — and refuses a model id or a price it cannot be", async () => {
    const p = page();
    p.run(`asOwner(); var DRAFTS = []; var ASKED = []; confirmSheet = async (t, o) => (ASKED.push([o.title, t]), true); own = async (d, then) => { DRAFTS.push(d); if (then) await then(); return { status: 200, body: { ok: true } }; }`);
    const box = (model: string, inUsd = "", outUsd = "", effort = "high") => `fakeBox("deepseek", { "[data-br-model]": fakeInput(${JSON.stringify(model)}), "[data-br-effort]": fakeInput(${JSON.stringify(effort)}), "[data-br-in]": fakeInput(${JSON.stringify(inUsd)}), "[data-br-out]": fakeInput(${JSON.stringify(outUsd)}) })`;
    await p.run(`brUse(brOf(${JSON.stringify(CATALOG.brains[1])}), ${box("deepseek-v4-pro", "1.32", "3.96")})`);
    expect(p.out("DRAFTS")).toEqual([{ type: "setDesk", desk: "desk", change: "brain", value: JSON.stringify({ provider: "deepseek", model: "deepseek-v4-pro", effort: "high", price: { inUsd: 1.32, outUsd: 3.96 } }) }]);
    const [title, words] = p.out<[string, string]>("ASKED[0]");
    expect(title).toBe("Use this brain");
    // the yes names all that is signed: the provider, the model, the effort, the owner's price
    expect(words).toBe("From their next call, the desk's house seats think with DeepSeek · deepseek-v4-pro · high effort · your price $1.32/$3.96 per M tokens. Its calls are billed to your key at DeepSeek. It is not ready yet (no key): until it is, the house seats make no lead up, and the plan's exits still run.");
    // no price: null, which clears one given before
    p.run("DRAFTS = []");
    await p.run(`brUse(brOf(${JSON.stringify(CATALOG.brains[1])}), ${box("deepseek-flash")})`);
    expect(JSON.parse(p.out<Any[]>("DRAFTS")[0].value)).toEqual({ provider: "deepseek", model: "deepseek-flash", effort: "high", price: null });
    // what cannot be signed is said, and nothing is
    p.run("DRAFTS = []; var B1 = " + box("bad model!") + "; var B2 = " + box("deepseek-flash", "1") + "; var B3 = " + box(""));
    for (const b of ["B1", "B2", "B3"]) await p.run(`brUse(brOf(${JSON.stringify(CATALOG.brains[1])}), ${b})`);
    expect(p.out("DRAFTS")).toEqual([]);
    expect(p.out("[B1.msgs.act.textContent, B2.msgs.act.textContent, B3.msgs.act.textContent]")).toEqual(["A model id is letters, digits and . - _ : / (up to 80).", "A price is dollars per million tokens, in and out: both, or neither.", "Name the model, as the endpoint names it."]);
    // a no signs nothing
    p.run("confirmSheet = async () => false");
    await p.run(`brUse(brOf(${JSON.stringify(CATALOG.brains[1])}), ${box("deepseek-flash")})`);
    expect(p.out("DRAFTS")).toEqual([]);
  });

  it("removes a key with setBrainKey and everything else empty — no base URL, no model, no hash, no salt — after a yes", async () => {
    const p = page();
    p.run(`asOwner(); var DRAFTS = []; var ASKED = []; confirmSheet = async (t, o) => (ASKED.push(o.title), true); own = async (d, then) => { DRAFTS.push(d); if (then) await then(); return { status: 200, body: { ok: true } }; }; var BOX = fakeBox("openai", { "[data-br-base]": fakeInput("https://api.openai.com/v1"), "[data-br-model]": fakeInput("gpt-6.1-sol") })`);
    await p.run(`brForget(brOf(${JSON.stringify(CATALOG.brains[2])}), BOX)`);
    // an empty hash beside an address or a model is how a server that needs no key is given another address (account/brain-keys.ts
    // applyBrainKey): a removal names neither, so it is a removal for every provider
    expect(p.out("DRAFTS")).toEqual([{ type: "setBrainKey", provider: "openai", baseUrl: "", model: "", keyHash: "", salt: "" }]);
    expect(p.out("ASKED")).toEqual(["Remove the key"]);
    // Ollama, a key file saved for it: removed the same way, never read as its address saved with no key
    p.run(`DRAFTS = []; BOX = fakeBox("ollama", { "[data-br-base]": fakeInput("http://localhost:11500/v1"), "[data-br-model]": fakeInput("qwen3:8b") })`);
    await p.run(`brForget(brOf(${JSON.stringify({ ...CATALOG.brains[8], tail: "…", keyFrom: "file" })}), BOX)`);
    expect(p.out("DRAFTS")).toEqual([{ type: "setBrainKey", provider: "ollama", baseUrl: "", model: "", keyHash: "", salt: "" }]);
  });

  it("tests the saved key by asking the account (POST /api/account/brain-test), never the provider, and says the answer in its own words", async () => {
    const p = page((c) => (c.path === "/api/account/brain-test" ? { status: 200, body: c.body.provider === "openai" ? { ok: true, provider: "openai", words: "OpenAI answered: 2 models listed.", models: ["gpt-6.1-sol", "gpt-<b>x"] } : { ok: false, provider: "xai", status: 401, words: "xAI refused the key (401)." } } : { status: 200, body: { ok: true } }));
    p.run(`var DL = { innerHTML: "" }; var B1 = fakeBox("openai", { "[data-br-model]": fakeInput("gpt-6.1-sol"), "#br-ml-openai": DL }); var B2 = fakeBox("xai", {})`);
    await p.run(`brTest(brOf(${JSON.stringify(CATALOG.brains[2])}), B1)`);
    await p.run(`brTest(brOf(${JSON.stringify(CATALOG.brains[3])}), B2)`);
    expect(p.calls.map((c) => [c.method, c.path, c.body])).toEqual([["POST", "/api/account/brain-test", { provider: "openai", model: "gpt-6.1-sol" }], ["POST", "/api/account/brain-test", { provider: "xai" }]]);
    expect(p.out("[B1.msgs.act.textContent, B1.msgs.act.className, B2.msgs.act.textContent, B2.msgs.act.className]")).toEqual(["OpenAI answered: 2 models listed.", "msg ok", "xAI refused the key (401).", "msg no"]);
    // the models the provider listed for this key, offered in the model field — escaped
    expect(p.run("DL.innerHTML")).toBe('<option value="gpt-6.1-sol" label="listed by OpenAI for your key"></option><option value="gpt-&lt;b&gt;x" label="listed by OpenAI for your key"></option>');
  });

  it("puts a pick into the form that opened the sheet: the provider chosen (its block shown), the model, the effort, the price", () => {
    const p = page();
    p.run(`var CH = []; var F = { provider: { value: "claude", dispatchEvent: (e) => CH.push(e.type) }, "model-deepseek": { value: "" }, effort: { value: "medium" }, "in-deepseek": { value: "" }, "out-deepseek": { value: "" } };
      var FORM = { querySelector: (s) => { const m = /^\\[name="([\\w-]+)"\\]$/.exec(s); return m ? F[m[1]] || null : null; } };
      brPutInForm(FORM, { provider: "deepseek", model: "deepseek-flash", effort: "low", price: { inUsd: 0.3, outUsd: 1.2 } })`);
    expect(p.out('[F.provider.value, F["model-deepseek"].value, F.effort.value, F["in-deepseek"].value, F["out-deepseek"].value, CH]')).toEqual(["deepseek", "deepseek-flash", "low", "0.3", "1.2", ["change"]]);
  });

  it("opens from the Agents pane: the hired desk's Brain… on its brain, with Use this brain; the hiring form's Brains › with the pick into that form", async () => {
    const p = page();
    p.run(`var OPENED = []; openBrains = (ctx) => OPENED.push(ctx); DK.catalog = ${JSON.stringify(CATALOG)}; DK.view = { brain: { provider: "deepseek", model: "deepseek-flash", effort: "low", label: "DeepSeek", ok: false } }`);
    await p.run('dkAct("brain", {})');
    expect(p.out("[OPENED[0].where, OPENED[0].desk(), OPENED[0].cur().provider, OPENED[0].cur().model, typeof OPENED[0].form, OPENED[0].catalog.brains.length]")).toEqual(["agents", true, "deepseek", "deepseek-flash", "undefined", 10]);
    // no desk yet: the hiring form's way in, the pick going into it
    p.run("DK.view = null");
    await p.run('dkAct("brains", {})');
    expect(p.out("[OPENED[1].where, OPENED[1].desk(), typeof OPENED[1].form]")).toEqual(["hire", false, "function"]);
    // the earlier quote dialog for the brain is gone: one place for it
    expect(p.run("typeof dkBrainForm")).toBe("undefined");
  });

  it("hands the hiring form's brain fields the providers' dated suggestions, with no discontinued example", () => {
    const p = page();
    const f = p.run<string>(`dkBrainFields(${JSON.stringify(CATALOG.brains)}, null, { idp: "dk" })`);
    expect(f).toContain('<input name="model-deepseek" value="" list="dk-ml-deepseek" autocomplete="off" spellcheck="false" placeholder="e.g. deepseek-flash" /><datalist id="dk-ml-deepseek"><option value="deepseek-flash" label="V4.1 Flash · $0.3/$1.2 per M tokens"></option><option value="deepseek-v4-pro" label="V4-Pro"></option></datalist>');
    expect(f).not.toContain("deepseek-chat");
    // each provider's standing in the Brains sheet's words
    expect(f).toContain('<option value="openai">OpenAI · Ready · key …ab12</option><option value="xai">Grok · xAI API · Key refused</option>');
    expect(f).toContain('<option value="vllm">vLLM · Local · not ready</option>');
    expect(p.run<string>(`dkBrainFields(${JSON.stringify(CATALOG.brains)}, null, { idp: "sg" })`)).toContain('list="sg-ml-deepseek"');
  });
});

// ---- what was typed, kept across a form drawn again (core formKeep) ------------------------------------------------------------------------

describe("a form drawn again keeps what was typed — never a password", () => {
  it("puts back each named field's text, a select's choice the form still offers, a box's tick, and leaves a password field empty", () => {
    const p = page();
    p.run(`var mk = (fields) => ({ querySelectorAll: (s) => (s === "[name]" ? fields : []) });
      var OLD = mk([{ name: "text", value: "Small entries on majors" }, { name: "provider", tagName: "SELECT", value: "deepseek", options: [] }, { name: "role", type: "checkbox", value: "watch", checked: true }, { name: "secret", type: "password", value: ${JSON.stringify(KEY)} }, { name: "venue", tagName: "SELECT", value: "paper-2" }]);
      var NEW = mk([{ name: "text", value: "" }, { name: "provider", tagName: "SELECT", value: "claude", options: [{ value: "claude" }, { value: "deepseek" }] }, { name: "role", type: "checkbox", value: "watch", checked: false }, { name: "secret", type: "password", value: "" }, { name: "venue", tagName: "SELECT", value: "paper-1", options: [{ value: "paper-1" }] }]);
      formKeep(OLD)(NEW)`);
    const fields = p.out<Array<{ name: string; value: string; checked?: boolean }>>("NEW.querySelectorAll('[name]')");
    expect(fields.map((f) => [f.name, f.value, f.checked])).toEqual([["text", "Small entries on majors", undefined], ["provider", "deepseek", undefined], ["role", "watch", true], ["secret", "", undefined], ["venue", "paper-1", undefined]]);
    // nothing to read, nothing to put back: no throw
    expect(() => p.run("formKeep(null)(null)")).not.toThrow();
  });
});

// ---- the round's fixes: a key in the wrong field, the yes before a save, what a save keeps, the key never outliving its sheet ---------------

/** made-up keys in the shapes the providers give theirs, built from pieces so no provider's key pattern stands whole in this file: none was
 * ever issued by anyone */
const piece = (...p: string[]) => p.join("");
const SHAPED = {
  groq: piece("gs", "k_", "Ab3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xY3zA5bC7dE9fG1hJ3kL5"),
  deepseek: piece("s", "k-", "0123456789abcdef", "fedcba9876543210"),
  openrouter: piece("s", "k-or-", "v1-", "0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c"),
  gemini: piece("AI", "za", "SyB3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xY3z"),
  xai: piece("xa", "i-", "Ab3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xY3zA5bC7dE9fG1hJ3kL5mN7pQ9rS1tU3vW5xY7zA9b"),
  together: piece("0123456789abcdef", "0123456789abcdef", "0123456789abcdef", "0123456789abcdef"),
  random32: piece("Ab3dE5fG7hJ9", "kL2mN4pQ6rS8tU0vW1xY"),
};
/** model ids that are words, however long: the presets' suggestions and the long vendor/model names OpenRouter, Together and Hugging Face use */
const MODELS = ["gpt-6-astra", "gpt-6.1-sol", "deepseek-v4-pro", "grok-4.20-0309-non-reasoning", "muse-spark-1.3-contributor", "kimi-k2.7-code-highspeed", "qwen3.8-max", "meta/muse-spark-1.3", "openai/gpt-oss-120b", "qwen/qwen3.8-27b", "deepseek-ai/DeepSeek-V4-Pro-0813", "gemini-3.8-flash", "claude-opus-5-5", "qwen3:8b", "NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO", "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8", "hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M", "accounts/fireworks/models/llama-v3p1-405b-instruct", "xai-org/grok-1"];

describe("a key in the wrong field: refused before anything is signed or sent, in words that never repeat it", () => {
  it("knows a key by its shape exactly as the account does (account/brain-key.ts keyShaped), and a model id by its words", () => {
    const p = page();
    for (const [name, k] of Object.entries(SHAPED)) {
      expect(p.run(`brKeyShaped(${JSON.stringify(k)})`), name).toBe(true);
      expect(keyShaped(k), name).toBe(true);
    }
    for (const m of MODELS) {
      expect(p.run(`brKeyShaped(${JSON.stringify(m)})`), m).toBe(false);
      expect(keyShaped(m), m).toBe(false);
    }
    // the two agree on every one of them, and on the edges between
    const edges = ["", "sk-", "sk-short", "gsk_x", "AIza-short", "0123456789abcdef0123456789abcde", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig", "-----BEGIN OPENSSH PRIVATE KEY-----", "a+b=c".repeat(8) + "123"];
    for (const t of [...Object.values(SHAPED), ...MODELS, ...edges]) expect(p.run(`brKeyShaped(${JSON.stringify(t)})`), t).toBe(keyShaped(t));
    // a base URL: its path, a segment at a time, as typed and %-decoded; its host is an address, not a key's place
    expect(p.run(`brBaseKeyShaped(${JSON.stringify(`https://models.example.com/v1/${SHAPED.together}`)})`)).toBe(true);
    expect(p.run(`brBaseKeyShaped(${JSON.stringify(`https://models.example.com/v1/${encodeURIComponent(SHAPED.groq)}/chat`)})`)).toBe(true);
    expect(p.run(`brBaseKeyShaped("https://1234.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1")`)).toBe(false);
    expect(p.run(`brBaseKeyShaped("http://localhost:11434/v1")`)).toBe(false);
  });

  it("Save: a key pasted as the model, a key in the base URL's path, or the typed key found again in either — nothing signed, nothing sent, the words never the value", async () => {
    const p = page();
    p.run("asOwner(); var ASKED = []; brConfirmSave = async (x, s) => (ASKED.push(s), true)");
    const save = async (id: number, key: string, base: string, model: string) => {
      p.run(`var KEYEL = fakeInput(${JSON.stringify(key)}); var BOX = fakeBox(${JSON.stringify(CATALOG.brains[id]!.id)}, { "[data-br-key]": KEYEL, "[data-br-base]": fakeInput(${JSON.stringify(base)}), "[data-br-model]": fakeInput(${JSON.stringify(model)}) })`);
      await p.run(`brSave(brOf(${JSON.stringify(CATALOG.brains[id])}), BOX)`);
      return p.run<string>("BOX.msgs.key.textContent");
    };
    // Groq's key pasted into DeepSeek's model field
    const a = await save(1, KEY, "https://api.deepseek.com", SHAPED.groq);
    expect(a).toBe("That looks like an API key, not a model's name: a key goes in the key field, never in the model. Nothing is signed or sent while it is there.");
    // a key in the path of a custom endpoint's base URL (escaped, too)
    const b = await save(9, KEY, `https://models.example.com/v1/${SHAPED.together}`, "m-1");
    const c = await save(9, KEY, `https://models.example.com/${encodeURIComponent(SHAPED.groq)}/v1`, "m-1");
    expect([b, c]).toEqual(Array(2).fill("The base URL holds something shaped like an API key, in its address or its path: a key goes in the key field, never in the base URL. Nothing is signed or sent while it is there."));
    // the typed key, short and plain, found again in the model field: refused the same way
    const d = await save(9, "proxy-pass-1", "https://models.example.com/v1", "proxy-pass-1");
    expect(d).toBe("The key you typed is also in the model or the base URL: take it out of there first. Nothing was signed or sent.");
    expect(p.calls).toEqual([]);
    expect(p.out("ASKED")).toEqual([]);
    for (const words of [a, b, c, d]) for (const k of [SHAPED.groq, SHAPED.together, "proxy-pass-1"]) expect(words).not.toContain(k.slice(4, 16));
  });

  it("Use this brain, Pick it and Test refuse a key as the model too; the hiring form's draft as well", async () => {
    const p = page();
    p.run(`asOwner(); var DRAFTS = []; confirmSheet = async () => true; own = async (d) => (DRAFTS.push(d), { status: 200, body: { ok: true } }); var CH = []; BR.ctx = { form: () => ({ querySelector: (s) => ({ set value(v) { CH.push([s, v]); }, dispatchEvent() {} }) }) }; closeSheet = () => {}`);
    const box = `fakeBox("deepseek", { "[data-br-model]": fakeInput(${JSON.stringify(SHAPED.deepseek)}), "[data-br-effort]": fakeInput("high"), "[data-br-in]": fakeInput(""), "[data-br-out]": fakeInput("") })`;
    p.run(`var B1 = ${box}; var B2 = ${box}; var B3 = ${box}`);
    await p.run(`brUse(brOf(${JSON.stringify(CATALOG.brains[1])}), B1)`);
    p.run(`brPick(brOf(${JSON.stringify(CATALOG.brains[1])}), B2)`);
    await p.run(`brTest(brOf(${JSON.stringify(CATALOG.brains[1])}), B3)`);
    expect([p.out("DRAFTS"), p.out("CH"), p.calls]).toEqual([[], [], []]);
    const words = "That looks like an API key, not a model's name: a key goes in the key field, never in the model. Nothing is signed or sent while it is there.";
    expect(p.out("[B1.msgs.act.textContent, B2.msgs.act.textContent, B3.msgs.act.textContent]")).toEqual([words, words, words]);
    expect(p.out(`dkBrainDraft({ provider: "deepseek", "model-deepseek": ${JSON.stringify(SHAPED.gemini)} }, ${JSON.stringify(CATALOG.brains)})`)).toBe(words);
  });

  it("warns beside the model and the base URL as they are typed — the words, never the value — and takes the warning away once the field is right", () => {
    const p = page();
    p.run(`var LINES = { model: { textContent: "", hidden: true }, base: { textContent: "", hidden: true } }; var MARKED = {};
      var fld = (k, v) => ({ value: v, readOnly: false, setAttribute: (a, x) => (MARKED[k] = x), removeAttribute: () => delete MARKED[k] });
      var F = { "[data-br-model]": fld("model", ${JSON.stringify(SHAPED.xai)}), "[data-br-base]": fld("base", ${JSON.stringify(`https://x.example/${SHAPED.random32}/v1`)}), '[data-br-warn="model"]': LINES.model, '[data-br-warn="base"]': LINES.base };
      var BOX = { querySelector: (s) => F[s] || null }; brFieldWarn(BOX)`);
    const warned = p.out<Record<string, { textContent: string; hidden: boolean }>>("LINES");
    expect(warned.model).toEqual({ textContent: "That looks like an API key, not a model's name: a key goes in the key field, never in the model. Nothing is signed or sent while it is there.", hidden: false });
    expect(warned.base!.hidden).toBe(false);
    expect(JSON.stringify(warned)).not.toContain(SHAPED.xai.slice(4, 16));
    expect(JSON.stringify(warned)).not.toContain(SHAPED.random32.slice(0, 12));
    expect(p.out("MARKED")).toEqual({ model: "true", base: "true" });
    p.run(`F["[data-br-model]"].value = "grok-4.7"; F["[data-br-base]"].value = "https://api.x.ai/v1"; brFieldWarn(BOX)`);
    expect(p.out("[LINES, MARKED]")).toEqual([{ model: { textContent: "", hidden: true }, base: { textContent: "", hidden: true } }, {}]);
    // the form draws the lines, hidden, where the owner types the model or the base URL
    const f = p.run<string>(`brFormHtml(brOf(${JSON.stringify(CATALOG.brains[9])}), { owner: true })`);
    expect(f).toContain('<p class="small warn-t br-warn" data-br-warn="base" aria-live="polite" hidden></p>');
    expect(f).toContain('<p class="small warn-t br-warn" data-br-warn="model" aria-live="polite" hidden></p>');
  });
});

describe("the yes before a key is saved: the provider, the base URL, the model and the fingerprint — never the key", () => {
  const answer = (c: Call) => {
    if (c.path === "/api/account/prepare") return { status: 200, body: prepared(c.body.draft) };
    if (c.path === "/api/account/brain-key") return { status: 200, body: { ok: true, provider: "deepseek", tail: "…7890" } };
    if (c.path === "/api/account/desk/catalog") return { status: 200, body: CATALOG };
    return { status: 200, body: { ok: true } };
  };

  it("asks with exactly those four, the fingerprint the hash that is then signed; the dialog holds no part of the key", async () => {
    const p = page(answer);
    p.run(`asOwner(); var ASKED = []; brConfirmSave = async (x, s) => (ASKED.push([x.name, s]), true); var BOX = fakeBox("deepseek", { "[data-br-key]": fakeInput(${JSON.stringify(KEY)}), "[data-br-base]": fakeInput("https://api.deepseek.com"), "[data-br-model]": fakeInput("deepseek-v4-pro") })`);
    await p.run(`brSave(brOf(${JSON.stringify(CATALOG.brains[1])}), BOX)`);
    const [name, shown] = p.out<[string, Record<string, string>]>("ASKED[0]");
    const draft = p.calls.find((c) => c.path === "/api/account/prepare")!.body.draft;
    expect([name, shown]).toEqual(["DeepSeek", { base: "https://api.deepseek.com", model: "deepseek-v4-pro", print: draft.keyHash.slice(0, 8), host: "api.deepseek.com" }]);
    expect(JSON.stringify(shown)).not.toContain(KEY.slice(-8));
    // the dialog itself (a page of its own, the yes not stood in for): the four rows, escaped, and where the key goes — nothing of the key
    const q = page(answer);
    q.run(`var HTML = ""; asking = async (h, read) => ((HTML = h), read("yes"))`);
    const yes = await q.run<Promise<boolean>>(`brConfirmSave(brOf(${JSON.stringify(CATALOG.brains[9])}), { base: "https://models.example.com/v1", model: "m-<1>", print: "1a2b3c4d", host: "models.example.com" })`);
    const html = q.run<string>("HTML");
    expect(yes).toBe(true);
    expect(html).toContain('<dt>Provider</dt><dd>Custom &lt;img src=x onerror=alert(1)&gt;</dd><dt>Base URL</dt><dd>https://models.example.com/v1</dd><dt>Model</dt><dd>m-&lt;1&gt;</dd><dt>Key fingerprint</dt><dd>1a2b3c4d</dd>');
    expect(html).toContain("sends it to models.example.com only.");
    expect(html).not.toContain("<img");
  });

  it("a no sends nothing at all — not the hash, not a read — signs nothing, keeps nothing, and leaves the field empty", async () => {
    const p = page(answer);
    p.run(`asOwner(); brConfirmSave = async () => false; var KEYEL = fakeInput(${JSON.stringify(KEY)}); var BOX = fakeBox("deepseek", { "[data-br-key]": KEYEL, "[data-br-base]": fakeInput("https://api.deepseek.com"), "[data-br-model]": fakeInput("deepseek-v4-pro") })`);
    await p.run(`brSave(brOf(${JSON.stringify(CATALOG.brains[1])}), BOX)`);
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    expect(p.calls).toEqual([]);
    expect(p.run("KEYEL.value")).toBe("");
    expect(p.run("BOX.msgs.key.textContent")).toBe("Nothing was signed or sent. The field is empty: paste the key again to save it.");
    expect(p.out("[BR.saved, BR.busy, BOX.buttons.map((b) => b.disabled)]")).toEqual([{}, false, [false, false]]);
  });

  it("asks for the model first where the provider has none of its own: a key saved without one would leave the brain unable to think", async () => {
    const p = page(answer);
    p.run(`asOwner(); var ASKED = 0; brConfirmSave = async () => (ASKED++, true); var KEYEL = fakeInput(${JSON.stringify(KEY)}); var BOX = fakeBox("xai", { "[data-br-key]": KEYEL, "[data-br-base]": fakeInput("https://api.x.ai/v1"), "[data-br-model]": fakeInput("") })`);
    await p.run(`brSave(brOf(${JSON.stringify(CATALOG.brains[3])}), BOX)`);
    expect([p.calls.length, p.run("ASKED"), p.run("BOX.msgs.key.textContent")]).toEqual([0, 0, "Name the model first: Grok · xAI API has no model of its own to fall back on, so a key saved without one leaves it unable to think."]);
    // the key stays in its field to be saved once the model is named: it was never read for sending
    expect(p.run("KEYEL.value")).toBe(KEY);
  });

  it("gives a server that needs no key another address with NO key — never one to make up — after a yes that names where the desk's questions go", async () => {
    // the account's answer to a keyless save: {keyless: true} (server.ts), the file holding the address and the model only
    const keyless = (c: Call) => (c.path === "/api/account/brain-key" ? { status: 200, body: { ok: true, provider: "ollama", keyless: true } } : answer(c));
    const p = page(keyless);
    p.run(`asOwner(); var ASKED = []; brConfirmAddress = async (x, s) => (ASKED.push([x.name, s]), true); var BOX = fakeBox("ollama", { "[data-br-key]": fakeInput(""), "[data-br-base]": fakeInput("http://localhost:11500/v1"), "[data-br-model]": fakeInput("qwen3:8b") })`);
    await p.run(`brSave(brOf(${JSON.stringify(CATALOG.brains[8])}), BOX)`);
    // asked first, with what is signed and where it goes: this machine, since localhost is this machine's own address
    expect(p.out("ASKED")).toEqual([["Ollama", { base: "http://localhost:11500/v1", model: "qwen3:8b", at: "on this machine (localhost:11500)" }]]);
    // signed: the address and the model, an empty hash and salt — sent to the key's route with the envelope alone (no key rides it)
    const prep = p.calls.find((c) => c.path === "/api/account/prepare")!;
    expect(prep.body.draft).toEqual({ type: "setBrainKey", provider: "ollama", baseUrl: "http://localhost:11500/v1", model: "qwen3:8b", keyHash: "", salt: "" });
    const send = p.calls.find((c) => c.path === "/api/account/brain-key")!;
    expect(Object.keys(send.body)).toEqual(["envelope"]);
    expect(p.calls.map((c) => c.path)).not.toContain("/api/exchange");
    const words = p.run<string>("BOX.msgs.key.textContent");
    expect(words).toBe("Saved · the account calls Ollama on this machine (localhost:11500), with qwen3:8b and no key.");
    expect([words, p.run<string>("BOX.msgs.key.className")]).toEqual([words, "msg ok"]);
    // never a key to make up, anywhere it speaks
    expect(words).not.toMatch(/any 8 characters|together with a key|type the one/);
  });

  it("names the typed host for an address on another machine, and says \"this machine\" only for this machine's own loopback", async () => {
    const p = page((c) => (c.path === "/api/account/brain-key" ? { status: 200, body: { ok: true, provider: "ollama", keyless: true } } : answer(c)));
    p.run(`asOwner(); var HTML = ""; asking = async (h, read) => ((HTML = h), read("yes")); var BOX = fakeBox("ollama", { "[data-br-key]": fakeInput(""), "[data-br-base]": fakeInput("https://ollama.example.com/v1"), "[data-br-model]": fakeInput("qwen3:8b") })`);
    await p.run(`brSave(brOf(${JSON.stringify(CATALOG.brains[8])}), BOX)`);
    const html = p.run<string>("HTML");
    // the dialog: what is signed — the provider, the base URL, the model, no key — and where the desk's questions go, by its host
    expect(html).toContain("<h2 id=\"ask-title\">Save the Ollama address?</h2><p>Your device signs the provider, the base URL and the model. No key is signed or sent.</p>");
    expect(html).toContain("<dt>Base URL</dt><dd>https://ollama.example.com/v1</dd><dt>Model</dt><dd>qwen3:8b</dd><dt>Key</dt><dd>none</dd>");
    expect(html).toContain("From then on the account sends the desk&#39;s questions to Ollama at ollama.example.com, with no key.");
    expect(p.run("BOX.msgs.key.textContent")).toBe("Saved · the account calls Ollama at ollama.example.com, with qwen3:8b and no key.");
    for (const said of [html, p.run<string>("BOX.msgs.key.textContent")]) expect(said).not.toContain("this machine");
    // where a base URL is, in words: this machine only for its loopback
    expect(p.out('["http://localhost:11434/v1", "http://127.0.0.1:8000/v1", "http://[::1]:8000/v1", "https://ollama.example.com/v1", "https://10.0.0.2:8443/v1"].map(brAtWords)')).toEqual(["on this machine (localhost:11434)", "on this machine (127.0.0.1:8000)", "on this machine ([::1]:8000)", "at ollama.example.com", "at 10.0.0.2:8443"]);
  });

  it("asks the model first for another address, keeps a key saved for it from being dropped by a save with none, and says it plainly when the account did not keep the address", async () => {
    const p = page((c) => (c.path === "/api/account/brain-key" ? { status: 200, body: { ok: true, provider: "ollama", cleared: true } } : answer(c)));
    p.run(`asOwner(); var ASKED = 0; brConfirmAddress = async () => (ASKED++, true); var BOX = fakeBox("ollama", { "[data-br-key]": fakeInput(""), "[data-br-base]": fakeInput("http://localhost:11500/v1"), "[data-br-model]": fakeInput("") })`);
    await p.run(`brSave(brOf(${JSON.stringify(CATALOG.brains[8])}), BOX)`);
    expect([p.calls.length, p.run("ASKED"), p.run("BOX.msgs.key.textContent")]).toEqual([0, 0, "Name the model first: another address is saved with the model Ollama serves there."]);
    // a key saved for vLLM (started with --api-key): another address with no key would replace that key with none — asked to paste it
    p.run(`BOX = fakeBox("vllm", { "[data-br-key]": fakeInput(""), "[data-br-base]": fakeInput("http://localhost:8001/v1"), "[data-br-model]": fakeInput("my-model") })`);
    await p.run(`brSave(brOf(${JSON.stringify({ ...CATALOG.brains[7], tail: "…wxyz", keyFrom: "file" })}), BOX)`);
    expect([p.calls.length, p.run("ASKED"), p.run("BOX.msgs.key.textContent")]).toEqual([0, 0, "A key is saved for vLLM: to give it another address, paste that key again and Save — or Remove the key first. Nothing was signed."]);
    // the account answered that it took the file away rather than saving the address: said as it is, never as a save
    p.run(`BOX = fakeBox("ollama", { "[data-br-key]": fakeInput(""), "[data-br-base]": fakeInput("http://localhost:11500/v1"), "[data-br-model]": fakeInput("qwen3:8b") })`);
    await p.run(`brSave(brOf(${JSON.stringify(CATALOG.brains[8])}), BOX)`);
    expect([p.run("BOX.msgs.key.textContent"), p.run("BOX.msgs.key.className")]).toEqual(["The account did not keep that address with no key: it took the key file away instead. Paste the key your server was started with and Save.", "msg no"]);
  });
});

describe("after a save: the form keeps what was set and the focus; the sheet's memory of it lasts one opening; an unsaved key does not outlive the sheet", () => {
  /** the sheet's body as brDraw uses it: a form side whose fields are drawn fresh (as the catalog says them) each time it is written */
  const SHEET = `var FOCUSED = "";
    var fresh = () => ({ "[data-br-base]": { value: "https://api.deepseek.com", readOnly: true }, "[data-br-model]": { value: "", tagName: "INPUT" }, "[data-br-effort]": { value: "high", tagName: "SELECT", options: [{ value: "low" }, { value: "high" }] }, "[data-br-in]": { value: "" }, "[data-br-out]": { value: "" }, "[data-br-key]": { value: "" }, '[data-br-act="save"]': { disabled: false, dataset: {}, focus: () => (FOCUSED = "save") }, "#br-f-h": { focus: () => (FOCUSED = "heading") }, '[data-br-msg="key"]': { className: "", textContent: "" }, '[data-br-msg="act"]': { className: "", textContent: "" } });
    var SIDE = { html: "", fields: fresh(), set innerHTML(h) { this.html = h; this.fields = fresh(); }, get innerHTML() { return this.html; },
      querySelector(s) { if (s.startsWith("[data-br-form=")) return this.html.includes('data-br-form="deepseek"') ? FORM : null; if (s === "[data-br-form]") return this.html ? FORM : null; return this.fields[s] || null; }, querySelectorAll: () => [] };
    var FORM = { dataset: { brForm: "deepseek" }, querySelector: (s) => SIDE.fields[s] || null, querySelectorAll: (s) => (s === "[data-br-act]" ? [SIDE.fields['[data-br-act="save"]']] : []) };
    var PART = () => ({ innerHTML: "", querySelectorAll: () => [], querySelector: () => null });
    var PARTS = { '[data-br-p="cards"]': PART(), '[data-br-p="agents"]': PART(), '[data-br-p="form"]': SIDE };
    BR.body = { isConnected: true, querySelector: (s) => (s === "[data-br]" ? { dataset: {}, querySelector: (q) => PARTS[q] || null } : null) };
    BR.ctx = {}; BR.pick = "deepseek"; BR.formFor = ""; BR.catalog = ${JSON.stringify(CATALOG)}; brDraw()`;
  const answer = (c: Call) => {
    if (c.path === "/api/account/prepare") return { status: 200, body: prepared(c.body.draft) };
    if (c.path === "/api/account/brain-key") return { status: 200, body: { ok: true, provider: "deepseek", tail: "…7890" } };
    if (c.path === "/api/account/desk/catalog") return { status: 200, body: { ...CATALOG, brains: CATALOG.brains.map((b) => (b.id === "deepseek" ? { ...b, ok: true, tail: "…7890", keyFrom: "file", fix: undefined } : b)) } };
    return { status: 200, body: { ok: true } };
  };

  it("builds the same provider's form again after a Save keeping the model, the effort and the price set in it — never the key — and gives the focus back to Save", async () => {
    const p = page(answer);
    p.run(`asOwner(); brConfirmSave = async () => true; ${SHEET}`);
    p.run(`SIDE.fields["[data-br-model]"].value = "deepseek-v4-pro"; SIDE.fields["[data-br-effort]"].value = "low"; SIDE.fields["[data-br-in]"].value = "1.32"; SIDE.fields["[data-br-out]"].value = "3.96"; SIDE.fields["[data-br-key]"].value = ${JSON.stringify(KEY)}`);
    await p.run(`brSave(brAll(BR.catalog).find((x) => x.id === "deepseek"), FORM)`);
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    // the form was written again (the catalog's next read: the key saved, its tail) …
    expect(p.run<string>("SIDE.html")).toContain("Saved just now · fingerprint");
    // … with what the owner set, and an empty key field; the focus on Save
    expect(p.out('["[data-br-model]", "[data-br-effort]", "[data-br-in]", "[data-br-out]", "[data-br-key]"].map((s) => SIDE.fields[s].value)')).toEqual(["deepseek-v4-pro", "low", "1.32", "3.96", ""]);
    expect(p.run("FOCUSED")).toBe("save");
    // a choice the rebuilt form no longer offers is left as drawn; the fixed base URL is the account's, never carried
    expect(p.run<string>("JSON.stringify(BR)")).not.toContain(KEY);
  });

  it("forgets what was saved at the next opening, and never says a key was saved here once the account reads another", () => {
    const p = page();
    p.run(`openSheet = () => ({ addEventListener() {}, querySelector: () => null }); BR.saved = { deepseek: { print: "1a2b3c4d", tail: "…7890", env: "" } }; openBrains({ where: "agents" })`);
    expect(p.out("BR.saved")).toEqual({});
    // the key file replaced since (another tail): "Saved just now" is not said
    p.run('BR.saved = { openai: { print: "1a2b3c4d", tail: "…7890", env: "" } }');
    expect(p.run<string>(`brFormHtml(brOf(${JSON.stringify(CATALOG.brains[2])}), { owner: true })`)).not.toContain("Saved just now");
    expect(p.run<string>(`brFormHtml(brOf(${JSON.stringify({ ...CATALOG.brains[2], tail: "…7890" })}), { owner: true })`)).toContain("Saved just now · fingerprint");
  });

  it("empties a key typed and never saved when the sheet closes and when the page is put away — and a key left in the model field with it", () => {
    const p = page();
    p.run(`var MODAL = { on: {}, addEventListener(t, fn) { this.on[t] = fn; } }; var WINDOW_ON = {}; addEventListener = (t, fn) => (WINDOW_ON[t] = fn);
      var KEYS = [{ value: ${JSON.stringify(KEY)} }, { value: "another-typed-1" }]; var MODELS = [{ value: ${JSON.stringify(SHAPED.groq)}, tagName: "INPUT", readOnly: false }, { value: "deepseek-flash", tagName: "INPUT", readOnly: false }];
      document.getElementById = (id) => (id === "modal" ? MODAL : null); document.querySelectorAll = (s) => (s === "[data-br-key]" ? KEYS : s === "[data-br-model], [data-br-base]" ? MODELS : []);
      openSheet = () => ({ addEventListener() {}, querySelector: () => null }); BR.wipeOn = false; openBrains({ where: "agents" }); openBrains({ where: "agents" })`);
    expect(p.out("[typeof MODAL.on.close, typeof WINDOW_ON.pagehide]")).toEqual(["function", "function"]);
    p.run("MODAL.on.close()");
    expect(p.out("[KEYS.map((k) => k.value), MODELS.map((m) => m.value)]")).toEqual([["", ""], ["", "deepseek-flash"]]);
    p.run(`KEYS[0].value = ${JSON.stringify(KEY)}; WINDOW_ON.pagehide()`);
    expect(p.out("KEYS[0].value")).toBe("");
  });

  it("says Remove for what it does: the key file is removed (the environment's or an older file's key then read), after a yes", async () => {
    const p = page();
    p.run(`asOwner(); var ASKED = []; confirmSheet = async (t, o) => (ASKED.push(t), false); var BOX = fakeBox("openai", { "[data-br-base]": fakeInput("https://api.openai.com/v1"), "[data-br-model]": fakeInput("gpt-6.1-sol") })`);
    await p.run(`brForget(brOf(${JSON.stringify(CATALOG.brains[2])}), BOX)`);
    expect(p.out("ASKED[0]")).toBe("Remove the OpenAI key from this account? Its key file (credentials/brains/openai.json) is removed. Until a key is saved again, OpenAI cannot think for the desk — unless the account's environment or an older key file holds a key for it, which is then the one read.");
    expect(p.out("ASKED[0]")).not.toContain("emptied");
  });
});

describe("the brain put into a form, the efforts signed, and the choice a redrawn form puts back", () => {
  it("formKeep tells a select it puts back to another choice (a change event, at once, before the fields after it), and no other field", () => {
    const p = page();
    p.run(`var LOG = []; var sel = (name, value, opts) => ({ name, tagName: "SELECT", value, options: opts.map((v) => ({ value: v })), dispatchEvent: (e) => (LOG.push(["change", name, e.type, e.bubbles]), true) });
      var txt = (name, value) => ({ name, tagName: "INPUT", type: "text", get value() { return this.v; }, set value(x) { LOG.push(["set", name]); this.v = x; }, v: value, dispatchEvent: () => LOG.push(["change", name]) });
      var mk = (fields) => ({ querySelectorAll: (s) => (s === "[name]" ? fields : []) });
      var OLD = mk([sel("provider", "deepseek", ["claude", "deepseek"]), txt("model-deepseek", "deepseek-flash"), sel("venue", "paper-1", ["paper-1"])]);
      var NEW = mk([sel("provider", "claude", ["claude", "deepseek"]), txt("model-deepseek", ""), sel("venue", "paper-1", ["paper-1"])]);
      formKeep(OLD)(NEW)`);
    expect(p.out("LOG")).toEqual([["change", "provider", "change", true], ["set", "model-deepseek"]]);
  });

  it("puts a pick into the form in the order a browser needs: the provider told first, so the effort is set into that provider's own choices", () => {
    const p = page();
    p.run(`var LOG = []; var F = { provider: { set value(v) { LOG.push(["provider", v]); }, dispatchEvent: (e) => LOG.push(["change"]) }, effort: { set value(v) { LOG.push(["effort", v]); } }, "model-openai": { set value(v) { LOG.push(["model", v]); } }, "in-openai": { set value(v) {} }, "out-openai": { set value(v) {} } };
      var FORM = { querySelector: (s) => { const m = /^\\[name="([\\w-]+)"\\]$/.exec(s); return m ? F[m[1]] || null : null; } };
      brPutInForm(FORM, { provider: "openai", model: "gpt-6.1-sol", effort: "medium" })`);
    expect(p.out("LOG")).toEqual([["provider", "openai"], ["change"], ["model", "gpt-6.1-sol"], ["effort", "medium"]]);
  });

  it("signs no effort for a provider that takes none of the desk's three, and says so in the yes", async () => {
    const p = page();
    p.run(`asOwner(); var DRAFTS = []; var ASKED = []; confirmSheet = async (t) => (ASKED.push(t), true); own = async (d) => (DRAFTS.push(d), { status: 200, body: { ok: true } })`);
    await p.run(`brUse(brOf(${JSON.stringify(CATALOG.brains[6])}), fakeBox("groq", { "[data-br-model]": fakeInput("openai/gpt-oss-120b"), "[data-br-in]": fakeInput(""), "[data-br-out]": fakeInput("") }))`);
    expect(JSON.parse(p.out<Any[]>("DRAFTS")[0].value)).toEqual({ provider: "groq", model: "openai/gpt-oss-120b", price: null });
    expect(p.out("ASKED[0]")).toContain("Groq · openai/gpt-oss-120b · Groq's own effort · no price of yours: the tokens are counted, not their cost");
    // and an effort a provider does not take is never signed, whatever the field holds (DeepSeek: low and high)
    p.run("DRAFTS = []");
    await p.run(`brUse(brOf(${JSON.stringify(CATALOG.brains[1])}), fakeBox("deepseek", { "[data-br-model]": fakeInput("deepseek-flash"), "[data-br-effort]": fakeInput("medium"), "[data-br-in]": fakeInput(""), "[data-br-out]": fakeInput("") }))`);
    expect(JSON.parse(p.out<Any[]>("DRAFTS")[0].value)).toEqual({ provider: "deepseek", model: "deepseek-flash", price: null });
  });
});

// ---- a key in a base URL's host, Cloudflare's account id in its path: the page's rule is the account's, sample for sample --------------

/** made-up hex, built from pieces: a Cloudflare-shaped account id (32 hex) and a Together-shaped key (64 hex). Neither was ever issued */
const HEX32 = piece("0a1b2c3d4e5f6a7b", "8c9d0e1f2a3b4c5d");
const HEX64 = piece(HEX32, "6e7f8a9b0c1d2e3f", "4a5b6c7d8e9f0a1b");

describe("a key in a base URL, anywhere it could ride — the page's check is the account's, on every sample", () => {
  /** base URLs a key could ride in: its host (Qwen's how-to puts the workspace id there), its path, the rest of it — and the real ones that
   * must pass: a Qwen workspace's, Cloudflare's Workers AI and AI Gateway (its 32-hex account id in the path), the presets' own */
  const KEYED = {
    "a DeepSeek-shaped key where Qwen's {WorkspaceId} goes": `https://${SHAPED.deepseek}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`,
    "sk- and 32 hex as the host's first label": `https://sk-${HEX32}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`,
    "a random-looking label, its case as typed": `https://${SHAPED.random32}.example.com/v1`,
    "a Groq key as a label, with a port": `https://${SHAPED.groq}.example.com:8443/v1`,
    "32 hex as a host label (no id is excused in a host)": `https://${HEX32}.example.com/v1`,
    "a key %-escaped in the host": `https://sk%2D${HEX32}.example.com/v1`,
    "a key after a name and an @": `https://u@${SHAPED.deepseek}.example.com/v1`,
    "backslashes for slashes": `https:\\\\${SHAPED.deepseek}.example.com\\v1`,
    "Together's 64 hex in the path": `https://llm.example.com/v1/${HEX64}`,
    "a Groq key %-escaped in the path": `https://models.example.com/v1/${encodeURIComponent(SHAPED.groq)}/chat`,
    "a key in the query": `https://x.example.com/v1?key=${SHAPED.groq}`,
    "a key in the fragment": `https://x.example.com/v1#${SHAPED.xai}`,
    "a key that is not a URL": SHAPED.openrouter,
    // a bare hex run is excused only where Cloudflare puts its account id: anywhere else — another host, or another place on Cloudflare's —
    // it is judged in full, so a key split into hex segments is never let through
    "a 32-hex segment on another host": `https://llm.example.com/v1/${HEX32}`,
    "a 32-hex segment in another place on Cloudflare's": `https://api.cloudflare.com/client/v4/${HEX32}/ai/v1`,
    "a key behind a control character": `\u0001https://${SHAPED.gemini}.example.com/v1`,
  };
  const CLEAN = {
    "a Qwen workspace": "https://ws-1a2b3c4d5e6f.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    "Cloudflare Workers AI": `https://api.cloudflare.com/client/v4/accounts/${HEX32}/ai/v1`,
    "Cloudflare AI Gateway, openai": `https://gateway.ai.cloudflare.com/v1/${HEX32}/my-gateway/openai`,
    "Cloudflare AI Gateway, compat": `https://gateway.ai.cloudflare.com/v1/${HEX32}/my-gateway/compat`,
    "Ollama": "http://localhost:11434/v1",
    "vLLM on [::1]": "http://[::1]:8000/v1",
    "Gemini's compatibility layer": "https://generativelanguage.googleapis.com/v1beta/openai/",
    "OpenRouter": "https://openrouter.ai/api/v1",
    "an Azure deployment": "https://my-resource.openai.azure.com/openai/deployments/gpt-6-luna",
    "the Hugging Face router": "https://router.huggingface.co/v1",
    "not a URL, and no key": "not a url",
    "nothing typed": "",
  };

  it("refuses a key in a base URL's host — label by label, as typed, before anything lower-cases it — and in its path, query or fragment, exactly as the account does (brain-key.ts baseUrlKeyShaped)", () => {
    const p = page();
    for (const [name, url] of Object.entries(KEYED)) {
      expect(p.run(`brBaseKeyShaped(${JSON.stringify(url)})`), name).toBe(true);
      expect(baseUrlKeyShaped(url), name).toBe(true);
    }
    // the account's own refusals agree: the route's and the door's (baseUrlProblem), and the brain's (parseBaseUrl) — in words that never
    // repeat the URL
    for (const [name, url] of Object.entries(KEYED).filter(([, u]) => u.startsWith("https://") && !u.includes("@") && !u.includes("?") && !u.includes("#"))) {
      const said = baseUrlProblem(url);
      expect(said, name).toMatch(/shaped like an API key/);
      expect(parseBaseUrl(url).ok, name).toBe(false);
      for (const words of [said, (parseBaseUrl(url) as { why: string }).why]) for (const k of [SHAPED.deepseek, SHAPED.groq, SHAPED.random32, HEX32, HEX64]) expect(words, name).not.toContain(k.slice(4, 20));
    }
  });

  it("lets Cloudflare's account id stand in its path, and every real base URL pass — as the account does", () => {
    const p = page();
    for (const [name, url] of Object.entries(CLEAN)) {
      expect(p.run(`brBaseKeyShaped(${JSON.stringify(url)})`), name).toBe(false);
      expect(baseUrlKeyShaped(url), name).toBe(false);
    }
    for (const name of ["Cloudflare Workers AI", "Cloudflare AI Gateway, openai", "Cloudflare AI Gateway, compat", "a Qwen workspace"]) {
      const url = CLEAN[name as keyof typeof CLEAN];
      expect(baseUrlProblem(url), name).toBeNull();
      expect(parseBaseUrl(url).ok, name).toBe(true);
    }
  });

  it("answers as the account answers on every sample, and on the edges between: the presets' own, the model ids put in a path, each key put in a host and in a path", () => {
    const p = page();
    const samples = [
      ...Object.values(KEYED),
      ...Object.values(CLEAN),
      ...Object.values(BR_BASES()),
      ...MODELS.map((m) => `https://models.example.com/v1/${m}`),
      ...Object.values(SHAPED).flatMap((k) => [`https://${k}.example.com/v1`, `https://x.example.com/${k}/v1`, `https://X.${k.toUpperCase()}.example.com/v1`]),
      `https://x.example.com/v1/${HEX32}${HEX32.slice(0, 7)}`,
      `https://x.example.com/v1/${HEX32}${HEX32.slice(0, 8)}`,
      `https://x.example.com/v1/fw_${HEX32}`,
      `https://x.example.com/${HEX32}.${HEX32}/v1`,
      "https://x.example.com:99999/v1",
      "https://\\tx.example.com/v1",
      "  https://x.example.com/v1  ",
    ];
    for (const s of samples) expect(p.run(`brBaseKeyShaped(${JSON.stringify(s)})`), s).toBe(baseUrlKeyShaped(s));
    // and the words that name a host never name one that looks like a key (account/brain-key.ts hostSaid)
    expect(p.run(`brHost(${JSON.stringify(KEYED["sk- and 32 hex as the host's first label"])})`)).toBe("another address");
    expect(p.run(`brHost("https://api.deepseek.com")`)).toBe("api.deepseek.com");
  });

  it("finds the typed key again — whole, or a piece of eight or more as the model, a host label or a path segment — exactly as the account does (brain-keys.ts keyInSignedFields), and refuses it before anything is prepared", async () => {
    const p = page();
    const cases: Array<[string, string, string]> = [
      ["proxy-pass-1", "proxy-pass-1", "https://models.example.com/v1"],
      ["Zq9-proxy-pass-0042", "m-1", "https://Zq9-proxy-pass.example.com/v1"],
      ["Zq9-proxy-pass-0042", "m-1", "https://models.example.com/v1/proxy-pass-00"],
      ["Zq9-proxy-pass-0042", "m-1", "https://models.example.com/v1/proxy%2Dpass-00"],
      ["Zq9-proxy-pass-0042", "pass-0042", "https://models.example.com/v1"],
      ["Zq9-proxy-pass-0042", "m-1", "https://models.example.com/v1/proxy"],
      [HEX64, "m-1", `https://llm.example.com/v1/${HEX32}`],
      [HEX64, "m-1", "https://llm.example.com/v1"],
      ["", "m-1", "https://llm.example.com/v1"],
    ];
    for (const [key, model, base] of cases) expect(p.run(`brKeyInFields(${JSON.stringify(key)}, ${JSON.stringify(model)}, ${JSON.stringify(base)})`), `${key} · ${model} · ${base}`).toBe(keyInSignedFields({ model, baseUrl: base }, key));
    // Save: a piece of the typed key as the host's label — refused before /api/account/prepare, whose answer would carry it back
    p.run(`asOwner(); var ASKED = 0; brConfirmSave = async () => (ASKED++, true); var BOX = fakeBox("custom", { "[data-br-key]": fakeInput("Zq9-proxy-pass-0042"), "[data-br-base]": fakeInput("https://Zq9-proxy-pass.example.com/v1"), "[data-br-model]": fakeInput("m-1") })`);
    await p.run(`brSave(brOf(${JSON.stringify(CATALOG.brains[9])}), BOX)`);
    expect([p.calls, p.run("ASKED"), p.run("BOX.msgs.key.textContent")]).toEqual([[], 0, "The key you typed is also in the model or the base URL: take it out of there first. Nothing was signed or sent."]);
    // a 64-hex key whose first half sits in a Cloudflare-shaped path (which the base-URL rule lets pass as an account's id): caught as a piece
    p.run(`BOX = fakeBox("custom", { "[data-br-key]": fakeInput(${JSON.stringify(HEX64)}), "[data-br-base]": fakeInput(${JSON.stringify(`https://api.cloudflare.com/client/v4/accounts/${HEX32}/ai/v1`)}), "[data-br-model]": fakeInput("m-1") })`);
    await p.run(`brSave(brOf(${JSON.stringify(CATALOG.brains[9])}), BOX)`);
    expect([p.calls, p.run("ASKED"), p.run("BOX.msgs.key.textContent")]).toEqual([[], 0, "The key you typed is also in the model or the base URL: take it out of there first. Nothing was signed or sent."]);
    // the warning beside the base URL as it is typed: a key in its host is said, in words — never the value
    p.run(`var LINE = { textContent: "", hidden: true }; var FLD = { value: ${JSON.stringify(KEYED["a DeepSeek-shaped key where Qwen's {WorkspaceId} goes"])}, readOnly: false, setAttribute() {}, removeAttribute() {} }; brFieldWarn({ querySelector: (s) => (s === "[data-br-base]" ? FLD : s === '[data-br-warn="base"]' ? LINE : null) })`);
    expect(p.out("LINE")).toEqual({ textContent: "The base URL holds something shaped like an API key, in its address or its path: a key goes in the key field, never in the base URL. Nothing is signed or sent while it is there.", hidden: false });
  });
});

/** the base URLs the presets carry, as the page knows them */
function BR_BASES(): Record<string, string> {
  const p = page();
  return p.out<Record<string, string>>("Object.fromEntries(Object.entries(BR_PRESETS).filter(([, v]) => v.base).map(([k, v]) => [k, v.base]))");
}

// ---- a server on this machine: ready once its model is named --------------------------------------------------------------------------

/** Ollama as the account says it with no file and no model named (brain-openai.ts openaiReach): not ready, fix "no-key", reached at its
 * usual address with no key */
const OLLAMA_NO_MODEL = { id: "ollama", label: "Ollama", kind: "local", format: "openai", ok: false, why: "Ollama needs a model's name: name one your server serves when you choose it as the desk's brain (Use this brain) — it is reached at http://localhost:11434/v1 with no key, and needs no file", fix: FIX("no-key", "Name the model when you choose Ollama as the desk's brain — nothing else is needed."), baseUrl: "http://localhost:11434/v1", keyOptional: true, models: [], efforts: [], keyFrom: "none" };

describe("a server on this machine whose only want is a model: judged with the model on the form", () => {
  it("is ready with a model named — and only then, and only when that is all it lacks", () => {
    const p = page();
    const ready = (entry: unknown, model: string) => p.run(`brReadyWith(brOf(${JSON.stringify(entry)}), ${JSON.stringify(model)})`);
    expect([ready(OLLAMA_NO_MODEL, "qwen3:8b"), ready(OLLAMA_NO_MODEL, ""), ready(OLLAMA_NO_MODEL, SHAPED.groq), ready(OLLAMA_NO_MODEL, "bad model!")]).toEqual([true, false, false, false]);
    // another reason (a file it cannot use, a key refused, none given), a key file of its own, a model API with no key: the account's word stands
    expect(ready({ ...OLLAMA_NO_MODEL, fix: FIX("unusable", "The key file cannot be used.") }, "qwen3:8b")).toBe(false);
    expect(ready({ ...OLLAMA_NO_MODEL, fix: undefined }, "qwen3:8b")).toBe(false);
    expect(ready({ ...OLLAMA_NO_MODEL, keyFrom: "file" }, "qwen3:8b")).toBe(false);
    expect(ready(CATALOG.brains[1], "deepseek-flash")).toBe(false);
    expect(ready(CATALOG.brains[2], "")).toBe(true);
    // its card and its form say what it wants: a model — never the account's sentence naming one button where the sheet shows the other
    expect(p.out(`brStanding(brOf(${JSON.stringify(OLLAMA_NO_MODEL)}))`)).toEqual(["Local · needs a model", "off"]);
    const f = p.run<string>(`brFormHtml(brOf(${JSON.stringify(OLLAMA_NO_MODEL)}), { owner: true, pick: true })`);
    expect(f).not.toContain("(Use this brain)");
    expect(f).not.toContain('class="br-why"');
    expect(f).toContain("Name the model your server serves below, then Pick it for the desk.");
  });

  it("Use this brain: the yes says it is ready with that model once signed — not \"not ready yet\" — and that an address typed but not saved is not the one called", async () => {
    const p = page();
    p.run(`asOwner(); var DRAFTS = []; var ASKED = []; confirmSheet = async (t) => (ASKED.push(t), true); own = async (d) => (DRAFTS.push(d), { status: 200, body: { ok: true } })`);
    const box = (base: string) => `fakeBox("ollama", { "[data-br-model]": fakeInput("qwen3:8b"), "[data-br-base]": fakeInput(${JSON.stringify(base)}), "[data-br-in]": fakeInput(""), "[data-br-out]": fakeInput("") })`;
    await p.run(`brUse(brOf(${JSON.stringify(OLLAMA_NO_MODEL)}), ${box("http://localhost:11434/v1")})`);
    expect(p.out("ASKED[0]")).toBe("From their next call, the desk's house seats think with Ollama · qwen3:8b · Ollama's own effort · no price of yours: the tokens are counted, not their cost. It runs on this machine: nothing is billed. It is ready with qwen3:8b once you sign: the account calls it at http://localhost:11434/v1, with no key.");
    expect(p.out("ASKED[0]")).not.toContain("not ready");
    expect(JSON.parse(p.out<Any[]>("DRAFTS")[0].value)).toEqual({ provider: "ollama", model: "qwen3:8b", price: null });
    await p.run(`brUse(brOf(${JSON.stringify(OLLAMA_NO_MODEL)}), ${box("http://localhost:11500/v1")})`);
    expect(p.out("ASKED[1]")).toContain("It is ready with qwen3:8b once you sign: the account calls it at http://localhost:11434/v1, with no key. The address typed above is not saved: until Save signs it, the account calls http://localhost:11434/v1.");
    // a reason other than the model: the account's own words, as before
    await p.run(`brUse(brOf(${JSON.stringify({ ...OLLAMA_NO_MODEL, fix: FIX("unusable", "x"), why: "the key file cannot be used" })}), ${box("http://localhost:11434/v1")})`);
    expect(p.out("ASKED[2]")).toContain("It is not ready yet (the key file cannot be used): until it is, the house seats make no lead up");
    // an address saved for it on another machine: its server there, never "this machine"
    await p.run(`brUse(brOf(${JSON.stringify({ ...OLLAMA_NO_MODEL, ok: true, fix: undefined, keyFrom: "file", baseUrl: "https://ollama.example.com/v1" })}), ${box("https://ollama.example.com/v1")})`);
    expect(p.out("ASKED[3]")).toContain("not their cost. It is your server at ollama.example.com.");
    expect(p.out("ASKED[3]")).not.toContain("this machine");
  });

  it("the hiring form says \"needs a model\" for it, in its own words — never \"not ready\" beside the field the model goes in", () => {
    const p = page();
    const f = p.run<string>(`dkBrainFields(${JSON.stringify([CATALOG.brains[0], OLLAMA_NO_MODEL])}, { provider: "ollama" }, { idp: "dk" })`);
    expect(f).toContain('<span class="tag">needs a model</span> <span class="dim small">Runs on this machine and needs no key: name a model it serves above. It is ready with that model once you sign.</span>');
    expect(f).not.toContain("(Use this brain)");
    expect(f).toContain('<option value="ollama" selected>Ollama · Local · needs a model</option>');
  });
});

// ---- a variable that blocks a saved key: the gateway case -----------------------------------------------------------------------------

describe("a variable in the account's environment that BLOCKS a saved key (Claude behind a gateway's ANTHROPIC_BASE_URL)", () => {
  /** Claude as the account says it in the gateway case (brain-claude.ts about(): envBlocks, never envWins) */
  const GATEWAY = { ...CATALOG.brains[0], ok: false, why: "ANTHROPIC_BASE_URL in the service's environment points at gateway.example.com, so the ANTHROPIC_API_KEY beside it belongs to that host, not to Anthropic: the brain uses neither", fix: { code: "env", file: "/Users/x/.account/credentials/brains/claude.json", restart: true, words: "Remove both where the service is started and restart it." }, envWins: undefined, envBlocks: "ANTHROPIC_API_KEY", keyFrom: "env", tail: undefined };

  it("says it blocks a saved key — unset it and ANTHROPIC_BASE_URL, then restart — never that it is used before one, and shows no key in use", () => {
    const p = page();
    const f = p.run<string>(`brFormHtml(brOf(${JSON.stringify(GATEWAY)}), { owner: true })`);
    expect(f).toContain("ANTHROPIC_API_KEY is set where the account runs and blocks a saved key: unset it and ANTHROPIC_BASE_URL, then restart.");
    expect(f).not.toContain("is used before a key saved here");
    expect(f).not.toContain("A key is in use");
    expect(p.out(`brStanding(brOf(${JSON.stringify(GATEWAY)}))`)).toEqual(["Blocked by the environment", "warn"]);
    // the other way to say it (keyFrom "env-ignored", the variable in envWins): the same words
    expect(p.run<string>(`brFormHtml(brOf(${JSON.stringify({ ...GATEWAY, envBlocks: undefined, envWins: "ANTHROPIC_AUTH_TOKEN", keyFrom: "env-ignored" })}), { owner: true })`)).toContain("ANTHROPIC_AUTH_TOKEN is set where the account runs and blocks a saved key: unset it and ANTHROPIC_BASE_URL, then restart.");
    // a variable that wins (no gateway): as before
    expect(p.run<string>(`brFormHtml(brOf(${JSON.stringify(CATALOG.brains[0])}), { owner: true })`)).toContain("ANTHROPIC_API_KEY is set where the account runs, and is used before a key saved here");
  });

  it("says it after a save too: the key is saved, and the variable blocks it", async () => {
    const p = page((c) => {
      if (c.path === "/api/account/prepare") return { status: 200, body: prepared(c.body.draft) };
      if (c.path === "/api/account/brain-key") return { status: 200, body: { ok: true, provider: "claude", fingerprint: "1a2b3c4d", tail: "…7890", envBlocks: "ANTHROPIC_API_KEY" } };
      return { status: 200, body: { ok: true } };
    });
    p.run(`asOwner(); brConfirmSave = async () => true; var BOX = fakeBox("claude", { "[data-br-key]": fakeInput(${JSON.stringify(KEY)}), "[data-br-base]": fakeInput("https://api.anthropic.com"), "[data-br-model]": { value: "claude-opus-5-5" } })`);
    await p.run(`brSave(brOf(${JSON.stringify(GATEWAY)}), BOX)`);
    const words = p.run<string>("BOX.msgs.key.textContent");
    expect(words).toMatch(/^Saved · fingerprint [0-9a-f]{8} · key …7890\. ANTHROPIC_API_KEY is set where the account runs and blocks a saved key: unset it and ANTHROPIC_BASE_URL, then restart\.$/);
    expect(words).not.toContain("used before");
  });
});

describe("the providers' own key pages", () => {
  it("links each 'Get a key ↗' to the page its provider's own docs name (checked 15 Oct 2026), Qwen's to Alibaba's page that says which region's page is yours", () => {
    const p = page();
    expect(p.out("Object.fromEntries(Object.entries(BR_PRESETS).filter(([, v]) => v.key).map(([k, v]) => [k, v.key]))")).toEqual({
      openai: "https://platform.openai.com/settings/organization/api-keys",
      deepseek: "https://platform.deepseek.com/api_keys",
      xai: "https://console.x.ai/team/default/api-keys",
      meta: "https://dev.meta.ai/api-keys/",
      claude: "https://platform.claude.com/settings/keys",
      moonshot: "https://platform.kimi.ai/console/api-keys",
      qwen: "https://www.alibabacloud.com/help/en/model-studio/get-api-key",
      openrouter: "https://openrouter.ai/keys",
      gemini: "https://aistudio.google.com/apikey",
      groq: "https://console.groq.com/keys",
      together: "https://api.together.ai/settings/projects/~current/api-keys",
    });
    // and each one is written down beside the page that named it, with the day it was checked
    const src = source("ui/brains.js");
    expect(src).toContain('"Get a key ↗": each link below was checked on 15 Oct 2026');
    for (const page of ["developers.openai.com/api/reference/overview", "api-docs.deepseek.com", "docs.x.ai/developers/quickstart", "platform.claude.com/docs/en/get-api-key", "platform.kimi.ai/docs/guide/start-using-kimi-api", "openrouter.ai/docs/api/reference/authentication", "ai.google.dev/gemini-api/docs/openai", "console.groq.com/docs/quickstart", "docs.together.ai/docs/openai-api-compatibility"]) expect(src).toContain(page);
  });
});
