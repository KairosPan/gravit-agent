import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { ANTHROPIC_KEY_REF, baseElsewhere, CLAUDE_BASE, CLAUDE_MAX_RETRIES, CLAUDE_TEST_TIMEOUT_MS, CLAUDE_TIMEOUT_MS, claudeBrain, newClaudeClient, type ClaudeClient, type ClaudeClientOptions } from "../../src/portfolio/account/brain-claude.ts";
import { baseUrlKeyShaped, brainKeyRef, hostKeyShaped, hostSaid, isLoopback, keyShaped, keyTail, pathKeyShaped, plainFieldName, prefixedKey, scrubbed, typedHost } from "../../src/portfolio/account/brain-key.ts";
import { OPENAI_KEY_REF } from "../../src/portfolio/account/brain-openai.ts";
import { BRAIN_PRESETS, brainProviders, CHECKED, testBrain } from "../../src/portfolio/account/brains.ts";
import { DECISIONS, Desk, readRoom, scriptedBrain, type Brain, type BrainConfig, type DeskWorld } from "../../src/portfolio/account/desk.ts";
import { isRefusal } from "../../src/core/errors.ts";
import { signDevice, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { startStandin, type Standin } from "../standin/ui-standin.ts";

/** THE BRAINS THE ACCOUNT KNOWS (account/brains.ts): every provider at once, one brain per preset, each with its own key file under
 * credentials/brains/<id>.json and the two older files still read; the presets' facts from the providers' own pages, dated; the catalog
 * showing where each is reached, what it suggests and the key's masked tail — never the key; "Test the key" asking for the list of models
 * and nothing billed; Claude's client with its own timeout, at most one retry, and Anthropic's base URL named. Nothing here reaches a
 * network, and every key is made up. */

const KEY = "sk-test-not-a-real-key-0123456789abcdef";
const ANT_KEY = "sk-ant-api03-TEST-not-a-real-key-0123456789wxyz";
const env = {} as NodeJS.ProcessEnv;
const homes: string[] = [];
afterAll(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })));
const homeFiles = (files: Record<string, string> = {}): string => {
  const home = mkdtempSync(join(tmpdir(), "account-brains-"));
  homes.push(home);
  for (const [ref, text] of Object.entries(files)) write(home, ref, text);
  return home;
};
const write = (home: string, ref: string, text: string) => {
  mkdirSync(join(home, ref, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, ref), text, { mode: 0o600 });
};
const RISK = { verdict: "clear", why: "a tight spread", sizeUsd: 40, tpPct: 2, slPct: 1, maxHours: 12 };
const cfg = (provider: string, model = "", effort: BrainConfig["effort"] = "medium"): BrainConfig => ({ provider, model, effort });
const ask = (b: Brain, brain: BrainConfig) => b.decide({ role: "risk", brain, system: "You are RISK.", input: "BTC/USDT · spread 0.02%", schema: DECISIONS.RiskOut, maxTokens: 512 });
/** a stand-in endpoint that records every request (its URL and its bearer) and answers each with the decision */
function recorder() {
  const calls: Array<{ url: string; authorization?: string | undefined }> = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), authorization: h.authorization });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(RISK) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("the presets", () => {
  it("Claude first, then the model APIs, this machine's servers and a custom endpoint — each with its own key file, its base URL, its suggestions from the provider's own page and the day it was read", () => {
    expect(BRAIN_PRESETS.map((p) => p.id)).toEqual(["claude", "openai", "deepseek", "xai", "meta", "moonshot", "qwen", "openrouter", "gemini", "groq", "together", "ollama", "vllm", "custom"]);
    expect(BRAIN_PRESETS.find((p) => p.id === "xai")?.label).toBe("Grok · xAI API");
    expect(BRAIN_PRESETS.find((p) => p.id === "meta")?.label).toBe("Muse · Meta Model API");
    // the agents that have no API are not dressed up as brains
    expect(BRAIN_PRESETS.some((p) => /instinct|grok bot/i.test(`${p.id} ${p.label}`))).toBe(false);
    for (const p of BRAIN_PRESETS) {
      expect(p.keyRef, p.id).toBe(`credentials/brains/${p.id}.json`);
      if (p.defaultBase) {
        const u = new URL(p.defaultBase);
        // https, or http only to this machine (the local servers)
        expect(u.protocol === "https:" || (u.protocol === "http:" && isLoopback(u.hostname) && p.kind === "local"), p.id).toBe(true);
      } else expect(["qwen", "custom"], p.id).toContain(p.id);
      if (p.format === "openai" && p.suggestedModels.models.length) {
        expect(p.suggestedModels.source, p.id).toMatch(/^https:\/\//);
        expect(p.suggestedModels.checked, p.id).toBe(CHECKED);
      }
    }
    expect(CHECKED).toBe("2026-10-15");
    // the older files: Claude's and OpenAI's, still read
    expect(BRAIN_PRESETS.find((p) => p.id === "claude")?.legacyKeyRef).toBe(ANTHROPIC_KEY_REF);
    expect(BRAIN_PRESETS.find((p) => p.id === "openai")?.legacyKeyRef).toBe(OPENAI_KEY_REF);
    expect(BRAIN_PRESETS.filter((p) => p.legacyKeyRef).map((p) => p.id)).toEqual(["claude", "openai"]);
    // the quirks the providers' docs name
    const q = (id: string) => {
      const p = BRAIN_PRESETS.find((x) => x.id === id);
      return p && p.format === "openai" ? p : undefined;
    };
    expect(q("deepseek")?.quirks).toMatchObject({ json: "object" });
    expect(q("deepseek")?.efforts).toEqual(["low", "high"]);
    expect(q("meta")?.quirks).toMatchObject({ noEffortNone: true });
    expect(q("meta")?.keyPage).toBe("https://dev.meta.ai/api-keys/");
    expect(q("ollama")?.keyOptional).toBe(true);
    expect(q("vllm")?.keyOptional).toBe(true);
    // an id that could leave the folder is never made into a path
    expect(brainKeyRef("deepseek")).toBe("credentials/brains/deepseek.json");
    for (const bad of ["../x", "a/b", "", "UPPER", "x.json"]) expect(() => brainKeyRef(bad), bad).toThrow(/is not a brain's id/);
  });

  it("the key's masked tail: the last four after an ellipsis, only for a key long enough, never more", () => {
    expect(keyTail(KEY)).toBe("…cdef");
    expect(keyTail("short-key-123")).toBe("…");
    expect(keyTail("")).toBeUndefined();
    expect(keyTail(undefined)).toBeUndefined();
  });
});

describe("what a key looks like (keyShaped), and a provider's words with keys masked (scrubbed)", () => {
  // made up, in each provider's shape: none of them is anyone's key
  const MADE_UP = {
    deepseek: `sk-${"0123456789abcdef".repeat(2)}`,
    kimi: "sk-TESTnotArealKey0123456789abcdefABCDEF0123456789ab",
    openrouter: `sk-or-v1-${"fedcba9876543210".repeat(4)}`,
    anthropic: "sk-ant-api03-TEST_not-a-real-key-0123456789wxyzABCDEFGHIJ",
    groq: `gsk_TESTnotArealKey${"0123456789abcdefABCDEF".repeat(2)}`,
    gemini: "AIzaTESTnotArealKey0123456789abcdefgh",
    xai: `xai-TESTnotArealKey${"0123456789ABCDEFabcdef".repeat(3)}`,
    together: "0123456789abcdef".repeat(4),
    mistralLike: "TESTnotArealKey0123456789abcdEFGH",
    base64: "TESTnotA/realKey+0123456789abcdefgh==",
  };

  it("every made-up key shape is a key; every model id the presets suggest, Claude's, and long vendor/model names are not", () => {
    for (const [who, k] of Object.entries(MADE_UP)) expect(keyShaped(k), who).toBe(true);
    // inside a longer text too: a base URL's path, a sentence
    expect(keyShaped(`/v1/${MADE_UP.groq}`)).toBe(true);
    expect(keyShaped(`my key is ${MADE_UP.gemini} thanks`)).toBe(true);
    const models = [
      ...BRAIN_PRESETS.flatMap((p) => (p.format === "openai" ? p.suggestedModels.models : [])),
      "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5",
      "deepseek-ai/DeepSeek-V4-Pro-0813", "NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO", "meta-llama/Meta-Llama-3-70B-Instruct-Turbo",
      "unsloth/DeepSeek-R1-Distill-Qwen-32B-GGUF", "accounts/fireworks/models/llama-v3p1-405b-instruct", "ft:gpt-4o-mini-2024-07-18:my-org:custom-suffix:9fQ2abcD",
      "hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M", "Qwen3-235B-A22B-Instruct-2507-FP8", "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
      "cognitivecomputations/dolphin-2.9.2-qwen2-72b", "xai-org/grok-1", "qwen3:8b", "llama3.3:70b-instruct-q4_K_M", "house-model-1", "kimi-k2",
      "/compatible-mode/v1", "/v1beta/openai", "/openai/v1", "/api/v1",
    ];
    expect(models.filter(keyShaped)).toEqual([]);
    expect(keyShaped("")).toBe(false);
  });

  it("scrubbed masks xai-, gsk_, sk-or-, AIza…, long hex and random runs, the key in use and a bearer — and keeps a model's name and plain words", () => {
    const said = scrubbed(`bad key ${MADE_UP.xai} or ${MADE_UP.groq} or ${MADE_UP.openrouter} or ${MADE_UP.gemini} or ${MADE_UP.together} or ${MADE_UP.mistralLike}; Bearer abc.def; for model NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO`, "");
    expect(said).toBe("bad key xai-… or gsk-… or sk-or-… or AIza… or … or …; Bearer … for model NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO");
    for (const k of Object.values(MADE_UP)) expect(said.includes(k.slice(4, 16)) && !"NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO".includes(k.slice(4, 16))).toBe(false);
    // a cut-off echo of a key: still masked — with the key in use given, the piece of it is masked whole, its prefix with it
    expect(scrubbed(`invalid: ${MADE_UP.xai.slice(0, 30)}`, MADE_UP.xai)).toBe("invalid: …");
    expect(scrubbed(`invalid: ${MADE_UP.gemini.slice(0, 24)}`, "")).toBe("invalid: AIza…");
    // the existing words, as they were
    expect(scrubbed("boom sk-abc123456789 key_abcdefgh", "")).toBe("boom sk-… key-…");
  });

  it("with the key in use given, every piece of it eight characters or longer is masked — the last twelve, a middle sixteen, the first ten before ****, a cut at '.' — and words with no key in them are unchanged", () => {
    // made up: a 64-hex key (Together's shape) and a 32-character one with no prefix
    for (const key of ["c0ffee11d00dfeed22bead33cafe44f00d55beef66deaf77face88babe99ace0", "Qz7xW3vK9pR2mT8lH4gF6dJ1sA5nB0cE"]) {
      const echoes = [key.slice(-12), key.slice(10, 26), `${key.slice(0, 10)}****${key.slice(-4)}`, `${key.slice(0, 16)}.${key.slice(16, 32)}`, `"${key.slice(3, 15)}"`, `Bearer-${key.slice(2, 14)}`, `<b>${key.slice(5, 20)}</b>`];
      for (const echo of echoes) {
        const said = scrubbed(`Incorrect API key provided: ${echo}. You can find your API key at https://example.com/keys`, key);
        for (let i = 0; i + 8 <= key.length; i++) expect(said, `${echo} → ${said}`).not.toContain(key.slice(i, i + 8));
        expect(said, echo).toMatch(/^Incorrect API key provided: .*You can find your API key at https:\/\/example\.com\/keys$/);
      }
      // nothing of the key: the words as they were, spaces made single
      expect(scrubbed("Incorrect   API key provided. Rate limit reached for gpt-6-luna in organization org-abc on requests per min.", key)).toBe("Incorrect API key provided. Rate limit reached for gpt-6-luna in organization org-abc on requests per min.");
    }
    // a run of seven of the key's characters is not a piece: left as it is
    expect(scrubbed("ref Qz7xW3v ok", "Qz7xW3vK9pR2mT8lH4gF6dJ1sA5nB0cE")).toBe("ref Qz7xW3v ok");
  });

  it("the base-URL rule the page mirrors (baseUrlKeyShaped): the host as typed, label by label; the path, an account's 32-hex id excused there alone; the name, password, query and fragment", () => {
    const HEX32 = "5f0c3a9d2b7e4c1a8f6d0e3b9a2c7d41";
    const yes = [
      `https://${MADE_UP.deepseek}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`,
      `https://${MADE_UP.groq}.example.com:8443/v1`,
      "https://AbCdEfGhIjKlMn12-shared-gateway-x.example.com/v1",
      `https://${HEX32}.example.com/v1`,
      `https://llm.example.com/v1/${MADE_UP.together}`,
      `https://llm.example.com/v1/fw_${HEX32}`,
      `https://llm.example.com/v1/${encodeURIComponent(MADE_UP.gemini)}`,
      `https://llm.example.com/v1?key=${MADE_UP.xai}`,
      `https://user:${MADE_UP.kimi}@llm.example.com/v1`,
      MADE_UP.openrouter,
      // the hex excuse is Cloudflare's alone, and only in its place: anywhere else a bare 32-hex segment is judged in full
      `https://llm.example.com/v1/${HEX32}`,
      `https://api.cloudflare.com/client/v4/${HEX32}/ai/v1`,
      // a control character in front never hides a key in the host from the reading as typed
      `\u0001https://${MADE_UP.gemini}.example.com/v1`,
    ];
    const no = [
      `https://api.cloudflare.com/client/v4/accounts/${HEX32}/ai/v1`,
      `https://gateway.ai.cloudflare.com/v1/${HEX32}/my-gateway/openai`,
      "https://ws-1a2b3c4d5e6f.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
      "https://generativelanguage.googleapis.com/v1beta/openai/",
      "http://localhost:11434/v1",
      "http://[::1]:8000/v1",
      "https://openrouter.ai/api/v1",
      "",
    ];
    for (const u of yes) expect(baseUrlKeyShaped(u), u).toBe(true);
    for (const u of no) expect(baseUrlKeyShaped(u), u).toBe(false);
    // the host as typed: what stands between "//" and the path, without a name, a password or a port
    expect(typedHost("https://me:pw@Ab3.Example.com:8443/v1")).toBe("Ab3.Example.com");
    expect(typedHost("http://[::1]:8000/v1")).toBe("[::1]");
    expect(typedHost("https:\\\\Host.example.com\\v1")).toBe("Host.example.com");
    expect(typedHost("not a url")).toBe("");
    // the one excuse is for a path: the same 32 hex alone is a key in a host, a model's name or the desk's words
    expect(pathKeyShaped(`/client/v4/accounts/${HEX32}/ai/v1`, "api.cloudflare.com")).toBe(false);
    expect(pathKeyShaped(`/v1/${HEX32}/my-gateway/openai`, "gateway.ai.cloudflare.com")).toBe(false);
    expect(pathKeyShaped(`/client/v4/accounts/${HEX32}/ai/v1`, "llm.example.com")).toBe(true);
    expect(pathKeyShaped(`/client/v4/accounts/${HEX32}/ai/v1`)).toBe(true);
    expect(typedHost(`\u0001https://Ab3.example.com/v1`)).toBe("Ab3.example.com");
    expect(keyShaped(HEX32)).toBe(true);
    expect(hostKeyShaped(`https://${HEX32}.example.com`)).toBe(true);
    // the desk's words: only a key that says what it is — a 0x address and a transaction hash are words
    expect(prefixedKey(`follow 0x${"ab".repeat(20)} tx 0x${"cd".repeat(32)}`)).toBe(false);
    for (const k of [MADE_UP.groq, MADE_UP.openrouter, MADE_UP.gemini, MADE_UP.xai, MADE_UP.deepseek]) expect(prefixedKey(`watch ${k}`), k).toBe(true);
    expect(prefixedKey(MADE_UP.together)).toBe(false);
    // a host named in words: "another address" when it looks like a key
    expect(hostSaid(`https://${MADE_UP.groq}.example.com/v1`)).toBe("another address");
    expect(hostSaid("https://api.deepseek.com/v1")).toBe("api.deepseek.com");
    expect(plainFieldName("extra")).toBe(true);
    expect(plainFieldName(MADE_UP.groq.slice(0, 32))).toBe(false);
    expect(plainFieldName('a "quoted" name')).toBe(false);
  });
});

describe("every provider at once", () => {
  it("in an empty home each says it has no key, with the fix that makes ITS file; a key written for one makes that one ready with no restart while the rest stay as they were", () => {
    const home = homeFiles();
    const brains = brainProviders(home, { env, platform: "darwin" });
    expect(brains.map((b) => b.id)).toEqual(BRAIN_PRESETS.map((p) => p.id));
    for (const b of brains) {
      const st = b.ready();
      expect(st.ok, b.id).toBe(false);
      expect(st.fix, b.id).toMatchObject({ code: "no-key", file: join(home, "credentials", "brains", `${b.id}.json`), restart: false });
      expect(b.about!(), b.id).toMatchObject({ keyFile: `credentials/brains/${b.id}.json`, keyFrom: "none" });
    }
    // the key typed for DeepSeek lands in its own file: DeepSeek is ready at the next check, OpenAI is not
    write(home, "credentials/brains/deepseek.json", JSON.stringify({ apiKey: KEY, model: "deepseek-flash" }));
    const byId = (id: string) => brains.find((b) => b.id === id)!;
    expect(byId("deepseek").ready()).toEqual({ ok: true, model: "deepseek-flash", how: "the key file credentials/brains/deepseek.json · api.deepseek.com" });
    expect(byId("openai").ready("gpt-6-luna").ok).toBe(false);
    expect(byId("deepseek").about!()).toMatchObject({ kind: "model-api", format: "openai", baseUrl: "https://api.deepseek.com", keyFrom: "file", tail: "…cdef", efforts: ["low", "high"], suggested: { models: ["deepseek-flash", "deepseek-v4-pro"], checked: "2026-10-15" } });
  });

  it("several hold a key at once, each asked at its own base URL with its own key — the owner's OpenAI key in the older file among them, untouched — and never the other's", async () => {
    const DS_KEY = "sk-test-deepseek-not-real-000000000000aaaa";
    const home = homeFiles({ [OPENAI_KEY_REF]: JSON.stringify({ apiKey: KEY, baseUrl: "https://api.openai.com/v1", model: "gpt-6-luna" }), "credentials/brains/deepseek.json": JSON.stringify({ apiKey: DS_KEY, model: "deepseek-flash" }) });
    const ep = recorder();
    const brains = brainProviders(home, { env, fetch: ep.fetch });
    const openai = brains.find((b) => b.id === "openai")!;
    const deepseek = brains.find((b) => b.id === "deepseek")!;
    expect(openai.ready()).toMatchObject({ ok: true, how: "the key file credentials/openai/api-key.json · api.openai.com" });
    expect(deepseek.ready()).toMatchObject({ ok: true });
    expect((await ask(openai, cfg("openai"))).out).toEqual(RISK);
    expect((await ask(deepseek, cfg("deepseek"))).out).toEqual(RISK);
    expect(ep.calls).toEqual([
      { url: "https://api.openai.com/v1/chat/completions", authorization: `Bearer ${KEY}` },
      { url: "https://api.deepseek.com/chat/completions", authorization: `Bearer ${DS_KEY}` },
    ]);
  });

  it("the catalog the page reads shows each provider's place, suggestions, efforts, the key's tail and an environment that wins — and never a key", () => {
    const home = homeFiles({ [ANTHROPIC_KEY_REF]: JSON.stringify({ apiKey: ANT_KEY }), "credentials/brains/meta.json": JSON.stringify({ apiKey: KEY, model: "muse-spark-1.3" }) });
    const desk = new Desk({ home } as DeskWorld, { brain: brainProviders(home, { env: { OPENAI_API_KEY: KEY } as NodeJS.ProcessEnv }) });
    const c = desk.catalog();
    const by = (id: string) => c.brains.find((b) => b.id === id)!;
    expect(by("claude")).toMatchObject({ ok: true, kind: "model-api", format: "anthropic", baseUrl: CLAUDE_BASE, tail: "…wxyz", keyFrom: "older-file", keyFile: "credentials/brains/claude.json", models: expect.any(Array) });
    expect(by("meta")).toMatchObject({ ok: true, model: "muse-spark-1.3", baseUrl: "https://api.meta.ai/v1", tail: "…cdef", keyFile: "credentials/brains/meta.json", note: expect.stringMatching(/public preview for developers in the US/) });
    expect(by("openai")).toMatchObject({ envWins: "OPENAI_API_KEY", keyFrom: "env", tail: "…cdef" });
    expect(by("qwen")).toMatchObject({ ok: false, baseUrl: "", baseRequired: true });
    expect(by("ollama")).toMatchObject({ kind: "local", keyOptional: true, baseUrl: "http://localhost:11434/v1" });
    expect(by("xai").suggested).toMatchObject({ models: expect.arrayContaining(["grok-4.7", "grok-4.3"]), source: "https://docs.x.ai/docs/models", checked: "2026-10-15" });
    const text = JSON.stringify(c);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(ANT_KEY);
    expect(text).not.toContain(KEY.slice(0, 12));
    expect(text).not.toContain(ANT_KEY.slice(0, 16));
  });
});

describe("Test the key", () => {
  it("testBrain names the provider: one the account does not hold, or a script, is said so and nothing is sent; a provider's own test answers", async () => {
    const ep = recorder();
    const home = homeFiles();
    const brains = [...brainProviders(home, { env, fetch: ep.fetch }), scriptedBrain(() => null, "m", { id: "scripted" })];
    expect(await testBrain(brains, "instinct")).toEqual({ ok: false, provider: "instinct", words: expect.stringMatching(/^"instinct" is not a brain this account holds: claude, openai, /) });
    expect(await testBrain(brains, "scripted")).toEqual({ ok: false, provider: "scripted", words: "a script has no key to test" });
    expect(await testBrain(brains, "groq")).toMatchObject({ ok: false, provider: "groq", words: expect.stringMatching(/^no key: /), fix: { code: "no-key" } });
    expect(ep.calls).toEqual([]);
  });

  it("a key typed where the provider or the model goes is refused before anything is sent, and never said back", async () => {
    const GSK = `gsk_TESTnotArealKey${"0123456789abcdefABCDEF".repeat(2)}`;
    const ep = recorder();
    const home = homeFiles({ "credentials/brains/groq.json": JSON.stringify({ apiKey: KEY, model: "openai/gpt-oss-20b" }) });
    const brains = brainProviders(home, { env, fetch: ep.fetch });
    const asProvider = await testBrain(brains, GSK);
    expect(asProvider).toEqual({ ok: false, provider: "", words: "the brain named looks like an API key, so it is not repeated here and nothing was sent: a key goes only in the Brains place's key field" });
    const asModel = await testBrain(brains, "groq", GSK);
    expect(asModel).toEqual({ ok: false, provider: "groq", words: "the model named looks like an API key, so it is not repeated here and nothing was sent: a key goes only in the Brains place's key field" });
    // Claude's own test refuses it too, its client never made
    let made = 0;
    const claude = claudeBrain({ home: homeFiles({ "credentials/brains/claude.json": JSON.stringify({ apiKey: ANT_KEY }) }), env, newClient: () => (made++, { messages: { parse: (async () => null) as never } }) });
    const c = await claude.test!(GSK);
    expect(c).toMatchObject({ ok: false, provider: "claude" });
    expect(JSON.stringify(c)).not.toContain(GSK.slice(4, 20));
    expect(made).toBe(0);
    expect(ep.calls).toEqual([]);
    expect(JSON.stringify([asProvider, asModel])).not.toContain(GSK.slice(4, 20));
  });
});

describe("Claude's client", () => {
  it("made with Anthropic's base URL named, a two-minute timeout and at most one retry — whatever ANTHROPIC_BASE_URL the shell holds", async () => {
    expect([CLAUDE_TIMEOUT_MS, CLAUDE_MAX_RETRIES]).toEqual([120_000, 1]);
    const was = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = "https://elsewhere.example.com";
    try {
      const c = newClaudeClient({ apiKey: ANT_KEY, authToken: null, baseURL: CLAUDE_BASE, timeout: CLAUDE_TIMEOUT_MS, maxRetries: CLAUDE_MAX_RETRIES }) as unknown as Anthropic;
      expect([c.baseURL, c.timeout, c.maxRetries]).toEqual(["https://api.anthropic.com", 120_000, 1]);
    } finally {
      if (was === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = was;
    }
    // the brain makes its client with exactly those options, the key from the file it read
    const made: ClaudeClientOptions[] = [];
    const parsed: Array<Record<string, unknown>> = [];
    const fake: ClaudeClient = { messages: { parse: (async (p: Record<string, unknown>) => (parsed.push(p), { stop_reason: "end_turn", parsed_output: RISK, usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 30 } })) as never } };
    const home = homeFiles({ "credentials/brains/claude.json": JSON.stringify({ apiKey: ANT_KEY }) });
    const b = claudeBrain({ home, env, newClient: (c) => (made.push(c), fake) });
    const a = await ask(b, cfg("claude", "claude-opus-5-5", "high"));
    expect(a).toEqual({ out: RISK, usage: { inputTokens: 130, outputTokens: 20 } });
    expect(made).toEqual([{ apiKey: ANT_KEY, authToken: null, baseURL: "https://api.anthropic.com", timeout: 120_000, maxRetries: 1 }]);
    expect(parsed[0]).toMatchObject({ model: "claude-opus-5-5", max_tokens: 512, system: "You are RISK.", messages: [{ role: "user", content: "BTC/USDT · spread 0.02%" }], output_config: { effort: "high" } });
    // an auth token from the environment: the token, no key
    const fromToken = claudeBrain({ home, env: { ANTHROPIC_AUTH_TOKEN: "token-not-real-0000000000" } as NodeJS.ProcessEnv, newClient: (c) => (made.push(c), fake) });
    await ask(fromToken, cfg("claude", "claude-opus-5-5"));
    expect(made.at(-1)).toMatchObject({ apiKey: null, authToken: "token-not-real-0000000000", baseURL: "https://api.anthropic.com" });
  });

  it("a call that fails some other way (not the API's own refusal) is said in its own words with the key taken out", async () => {
    const leaky: ClaudeClient = { messages: { parse: (async () => { throw new TypeError(`fetch failed for x-api-key ${ANT_KEY} at the proxy`); }) as never } };
    const b = claudeBrain({ home: homeFiles({ "credentials/brains/claude.json": JSON.stringify({ apiKey: ANT_KEY }) }), env, newClient: () => leaky });
    const err = await ask(b, cfg("claude", "claude-opus-5-5")).then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/^fetch failed for x-api-key … at the proxy$/);
    expect(err?.message).not.toContain(ANT_KEY.slice(-12));
    const blank: ClaudeClient = { messages: { parse: (async () => { throw new Error(""); }) as never } };
    await expect(ask(claudeBrain({ home: homeFiles({ "credentials/brains/claude.json": JSON.stringify({ apiKey: ANT_KEY }) }), env, newClient: () => blank }), cfg("claude", "claude-opus-5-5"))).rejects.toThrow(/^the call failed$/);
  });

  it("its key: the new file wins, the older one is read while the new one is not there, the environment wins over both; a refused key's fix names the file that held it", async () => {
    const refuse: ClaudeClient = { messages: { parse: (async () => { throw new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "invalid x-api-key", new Headers()); }) as never } };
    const older = homeFiles({ [ANTHROPIC_KEY_REF]: JSON.stringify({ apiKey: ANT_KEY }) });
    const b = claudeBrain({ home: older, env, newClient: () => refuse, platform: "darwin" });
    expect(b.ready()).toMatchObject({ ok: true, how: "the key file credentials/anthropic/api-key.json" });
    expect(b.about!()).toMatchObject({ keyFrom: "older-file", tail: "…wxyz" });
    await expect(ask(b, cfg("claude", "claude-opus-5-5"))).rejects.toMatchObject({ code: "E_BRAIN_KEY_REJECTED", who: "Anthropic", fix: { code: "rejected", file: join(older, ANTHROPIC_KEY_REF), restart: false } });
    // the new file written beside it (as the page's key field writes it): read from the next check, no restart
    write(older, "credentials/brains/claude.json", JSON.stringify({ apiKey: "sk-ant-api03-TEST-the-newer-key-00000000abcd" }));
    expect(b.ready()).toMatchObject({ ok: true, how: "the key file credentials/brains/claude.json" });
    expect(b.about!()).toMatchObject({ keyFrom: "file", tail: "…abcd" });
    await expect(ask(b, cfg("claude", "claude-opus-5-5"))).rejects.toMatchObject({ fix: { file: join(older, "credentials", "brains", "claude.json") } });
    // the environment wins, and the page is told so
    const envWins = claudeBrain({ home: older, env: { ANTHROPIC_API_KEY: ANT_KEY } as NodeJS.ProcessEnv });
    expect(envWins.ready()).toMatchObject({ ok: true, how: "ANTHROPIC_API_KEY in the service's environment" });
    expect(envWins.about!()).toMatchObject({ envWins: "ANTHROPIC_API_KEY", keyFrom: "env" });
    expect(envWins.about!().envBlocks).toBeUndefined();
  });

  it("a gateway's credential in the shell (ANTHROPIC_BASE_URL pointing elsewhere, its token beside it) is never used: not ready, the fix names the host and asks for a restart, and no client is ever made with it", async () => {
    const GW = "gw-TEST-not-a-real-gateway-token-000000000000";
    for (const [vars, host] of [
      [{ ANTHROPIC_AUTH_TOKEN: GW, ANTHROPIC_BASE_URL: "https://llm-gateway.example.com" }, "llm-gateway.example.com"],
      [{ ANTHROPIC_API_KEY: `sk-or-v1-${"0123456789abcdef".repeat(4)}`, ANTHROPIC_BASE_URL: "https://openrouter.ai/api" }, "openrouter.ai"],
      [{ ANTHROPIC_AUTH_TOKEN: GW, ANTHROPIC_BASE_URL: "not a url at all" }, "an address that is not a URL"],
    ] as const) {
      const made: ClaudeClientOptions[] = [];
      const fake: ClaudeClient = { messages: { parse: (async () => { throw new Error("no call may be made"); }) as never }, models: { list: (async () => { throw new Error("no call may be made"); }) as never } };
      // a key file beside it changes nothing: the environment's word stands until it is gone (a restart)
      const home = homeFiles({ "credentials/brains/claude.json": JSON.stringify({ apiKey: ANT_KEY }) });
      const b = claudeBrain({ home, env: vars as unknown as NodeJS.ProcessEnv, newClient: (c) => (made.push(c), fake), platform: "darwin" });
      const st = b.ready();
      expect(st, host).toMatchObject({ ok: false, why: expect.stringMatching(new RegExp(`^ANTHROPIC_BASE_URL in the service's environment points at ${host.replace(/\./g, "\\.")}, so the ANTHROPIC_(AUTH_TOKEN|API_KEY) beside it belongs to that host, not to Anthropic`)), fix: { code: "env", restart: true, file: join(home, "credentials", "brains", "claude.json") } });
      expect(st.fix?.words, host).toMatch(/this account sends a key only to api\.anthropic\.com, so it uses neither\. Remove both where the service is started and restart it/);
      expect(st.fix?.command, host).toBeUndefined();
      expect(await b.test!(), host).toMatchObject({ ok: false, provider: "claude", fix: { code: "env", restart: true } });
      expect((await ask(b, cfg("claude", "claude-opus-5-5"))).out, host).toBeNull();
      expect(made, host).toEqual([]);
      // nothing of the gateway's credential is shown, not even a tail — and the variable is said to BLOCK a saved key, never to win over it
      const about = b.about!();
      expect(about.tail, host).toBeUndefined();
      expect(about.envWins, host).toBeUndefined();
      expect(about.envBlocks, host).toMatch(/^ANTHROPIC_(AUTH_TOKEN|API_KEY)$/);
      expect(JSON.stringify([st, about]), host).not.toContain(GW.slice(-6));
    }
    // a host that looks like a key — as URL reads it, or only as it was typed (URL lower-cases it): "another address", never the host
    expect(baseElsewhere({ ANTHROPIC_BASE_URL: "https://AbCdEfGhIjKlMn12-shared-gateway-x.example.com" } as NodeJS.ProcessEnv)).toBe("another address");
    // ANTHROPIC_BASE_URL at Anthropic's own API (with or without a path), or unset: as before
    expect(baseElsewhere({ ANTHROPIC_BASE_URL: "https://api.anthropic.com" } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(baseElsewhere({ ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1/" } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(baseElsewhere({} as NodeJS.ProcessEnv)).toBeUndefined();
    const ours = claudeBrain({ home: homeFiles(), env: { ANTHROPIC_API_KEY: ANT_KEY, ANTHROPIC_BASE_URL: "https://api.anthropic.com" } as NodeJS.ProcessEnv });
    expect(ours.ready()).toMatchObject({ ok: true, how: "ANTHROPIC_API_KEY in the service's environment" });
    // a base URL set elsewhere with NO credential beside it: the key file is read, and sent to Anthropic's own API as always
    const made: ClaudeClientOptions[] = [];
    const ok: ClaudeClient = { messages: { parse: (async () => ({ stop_reason: "end_turn", parsed_output: RISK, usage: { input_tokens: 1, output_tokens: 1 } })) as never } };
    const fileOnly = claudeBrain({ home: homeFiles({ "credentials/brains/claude.json": JSON.stringify({ apiKey: ANT_KEY }) }), env: { ANTHROPIC_BASE_URL: "https://llm-gateway.example.com" } as NodeJS.ProcessEnv, newClient: (c) => (made.push(c), ok) });
    expect((await ask(fileOnly, cfg("claude", "claude-opus-5-5"))).out).toEqual(RISK);
    expect(made).toEqual([{ apiKey: ANT_KEY, authToken: null, baseURL: "https://api.anthropic.com", timeout: 120_000, maxRetries: 1 }]);
  });

  it("Test the key waits fifteen seconds at most and never asks again — the cycle's two minutes and one retry are not the test's", async () => {
    expect(CLAUDE_TEST_TIMEOUT_MS).toBe(15_000);
    const home = homeFiles({ "credentials/brains/claude.json": JSON.stringify({ apiKey: ANT_KEY }) });
    const asked: unknown[][] = [];
    const c: ClaudeClient = { messages: { parse: (async () => null) as never }, models: { list: (async (...args: unknown[]) => (asked.push(args), { data: [{ id: "claude-opus-5-5" }], has_more: false })) as never } };
    expect((await claudeBrain({ home, env, newClient: () => c }).test!()).ok).toBe(true);
    expect(asked).toEqual([[{ limit: 100 }, { timeout: 15_000, maxRetries: 0 }]]);
  });

  it("Test the key: Anthropic's list of models, nothing billed — taken, or refused in its words with the key masked; no key, nothing sent", async () => {
    const home = homeFiles({ "credentials/brains/claude.json": JSON.stringify({ apiKey: ANT_KEY }) });
    let listed = 0;
    const ok: ClaudeClient = { messages: { parse: (async () => { throw new Error("no message is sent by a test"); }) as never }, models: { list: (async () => (listed++, { data: [{ id: "claude-opus-5-5" }, { id: "claude-haiku-5-5" }], has_more: false })) as never } };
    expect(await claudeBrain({ home, env, newClient: () => ok }).test!("claude-opus-5-5")).toEqual({ ok: true, provider: "claude", status: 200, words: "Anthropic accepted the key; claude-opus-5-5 is among the models it lists.", models: ["claude-opus-5-5", "claude-haiku-5-5"] });
    expect(listed).toBe(1);
    const refused: ClaudeClient = { messages: ok.messages, models: { list: (async () => { throw new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: `invalid x-api-key ${ANT_KEY}` } }, `invalid x-api-key ${ANT_KEY}`, new Headers()); }) as never } };
    const r = await claudeBrain({ home, env, newClient: () => refused }).test!();
    expect(r).toMatchObject({ ok: false, provider: "claude", status: 401, words: expect.stringMatching(/^Anthropic did not accept the key: /) });
    expect(JSON.stringify(r)).not.toContain(ANT_KEY);
    let made = 0;
    const none = await claudeBrain({ home: homeFiles(), env, newClient: () => (made++, ok) }).test!();
    expect(none).toMatchObject({ ok: false, provider: "claude", words: expect.stringMatching(/^no key: /), fix: { code: "no-key" } });
    expect(made).toBe(0);
  });
});

describe("the stand-in's brains", () => {
  let s: Standin | undefined;
  afterEach(async () => {
    await s?.close();
    if (s) rmSync(s.home, { recursive: true, force: true });
    s = undefined;
  });

  it("--no-desk: every preset's real brain, each without a key in the fresh home — whatever key the shell that started it holds", async () => {
    const was = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = KEY;
    try {
      s = await startStandin({ port: 0, tickMs: 0, agentMs: 0, desk: false });
      const c = s.svc.desk!.catalog();
      expect(c.brains.map((b) => b.id)).toEqual(BRAIN_PRESETS.map((p) => p.id));
      for (const b of c.brains) expect([b.id, b.ok, b.fix?.code]).toEqual([b.id, false, "no-key"]);
      expect(c.brains.find((b) => b.id === "openai")?.envWins).toBeUndefined();
    } finally {
      if (was === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = was;
    }
    // a key saved for one makes it ready; its call meets no network, said as an unreachable endpoint
    write(s.home, "credentials/brains/groq.json", JSON.stringify({ apiKey: KEY, model: "openai/gpt-oss-20b" }));
    expect(s.svc.desk!.catalog().brains.find((b) => b.id === "groq")).toMatchObject({ ok: true, tail: "…cdef" });
    expect(await testBrain(s.svc.desk!.brains, "groq")).toEqual({ ok: false, provider: "groq", words: "the endpoint api.groq.com could not be reached" });
  }, 30_000);

  it("with a desk: the script holds Claude's place, labelled a script, beside every other preset; the brain switched away is said not ready, and switched back the script thinks again", async () => {
    s = await startStandin({ port: 0, tickMs: 0, agentMs: 0, superagent: true });
    const desk = s.svc.desk!;
    const c = desk.catalog();
    expect(c.brains.map((b) => b.id)).toEqual(BRAIN_PRESETS.map((p) => p.id));
    expect(c.brains.find((b) => b.id === "claude")).toMatchObject({ ok: true, label: "A script (stand-in, as Claude)", how: "a script", format: "anthropic", keyFile: "credentials/brains/claude.json" });
    expect(c.brains.filter((b) => b.ok).map((b) => b.id)).toEqual(["claude"]);
    expect((await desk.view())!.brain).toMatchObject({ ok: true, provider: "claude", label: "A script (stand-in, as Claude)", model: "claude-opus-5-5" });
    expect(await testBrain(desk.brains, "claude")).toEqual({ ok: false, provider: "claude", words: "A script (stand-in, as Claude) has no key to test" });
    // the owner signs the switch, as the page does: prepared by the account, signed by the stand-in's seed key (an owner), through the door
    const own = async (draft: Record<string, unknown>) => {
      const p = await s!.svc.account!.prepare(draft);
      if (isRefusal(p)) return p;
      return s!.svc.exchange({ action: p.action, nonce: p.action.nonce, signature: signDevice(s!.seed, p.action as OwnerAction) });
    };
    const switchTo = (brain: Record<string, unknown>) => own({ type: "setDesk", desk: "desk", change: "brain", value: JSON.stringify(brain) });
    const calls = async () => (await desk.view())!.brain.spend.calls;
    await desk.cycle("test");
    const before = await calls();
    expect(before).toBeGreaterThan(0);
    // away: DeepSeek, which holds no key in this fresh home — not ready, said so, and a cycle asks it nothing (no call, no fallback)
    const away = await switchTo({ provider: "deepseek", model: "deepseek-flash", effort: "low" });
    expect(isRefusal(away)).toBe(false);
    let v = (await desk.view())!;
    expect(v.brain).toMatchObject({ ok: false, provider: "deepseek", label: "DeepSeek", model: "deepseek-flash", why: expect.stringMatching(/^no key: the brain reads DeepSeek's key from /) });
    expect(readRoom(s.home).filter((m) => m.from === "you").at(-1)?.text).toMatch(/^You changed the brain: DeepSeek · deepseek-flash · low effort — not ready: no key: /);
    await desk.cycle("test");
    expect(await calls()).toBe(before);
    expect(readRoom(s.home).at(-1)?.text).toMatch(/^Cycle \d+: the house seats have no brain to think with \(no key: the brain reads DeepSeek's key/);
    // back: the script under Claude's id — ready, and the next cycle is answered
    expect(isRefusal(await switchTo({ provider: "claude", model: "claude-opus-5-5", effort: "medium" }))).toBe(false);
    v = (await desk.view())!;
    expect(v.brain).toMatchObject({ ok: true, provider: "claude", label: "A script (stand-in, as Claude)", model: "claude-opus-5-5" });
    await desk.cycle("test");
    expect(await calls()).toBeGreaterThan(before);
  }, 30_000);

  it("--brain-refuses: a key saved for Claude on the page (credentials/brains/claude.json, read before the older file) is the replaced key, and the next call is answered", async () => {
    s = await startStandin({ port: 0, tickMs: 0, agentMs: 0, superagent: true, brainRefuses: true });
    const desk = s.svc.desk!;
    await desk.cycle("test");
    expect((await desk.view())!.brain).toMatchObject({ ok: false, fix: { code: "rejected", file: join(s.home, ANTHROPIC_KEY_REF) } });
    write(s.home, "credentials/brains/claude.json", JSON.stringify({ apiKey: ANT_KEY }));
    await desk.cycle("test");
    expect((await desk.view())!.brain.ok).toBe(true);
  }, 30_000);
});
