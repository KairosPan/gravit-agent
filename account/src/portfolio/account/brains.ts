/** THE BRAINS THE ACCOUNT KNOWS: every provider a desk may think with, all held at once (brainProviders) — so several can hold a key at the
 * same time, and the one the desk was hired with is the one asked. Claude speaks Anthropic's own format (brain-claude.ts); every other
 * one is an OpenAI-format endpoint (brain-openai.ts), one brain per preset, each with its own key file under credentials/brains/<id>.json
 * (brain-key.ts) and nothing shared between them.
 *
 * What each preset says comes from the provider's own documentation as it read on 2026-10-15 (CHECKED): its base URL, the models to
 * SUGGEST (shown in a list the owner may ignore: any model id the endpoint serves may be typed; the list is never said to be complete or
 * current), the prices the provider's page gave that day for some of them (shown as that day's, never counted: the desk counts the
 * owner's own number), the efforts it takes, and how its requests differ (quirks).
 *
 * EFFORTS are listed only where the research read the provider's own word on them: OpenAI (low, medium, high — of its low to max),
 * DeepSeek (low and high — of its none, low, high, max), Meta (Muse Spark always reasons; "none" is a 400) and Claude. Everywhere else the
 * list is EMPTY: no reasoning_effort is sent, the provider's own default applies, and the Brains place offers no effort choice it cannot
 * vouch for — a dialect learned from a 400 would have turned the field off anyway, but the page would have claimed a setting the provider
 * never documented.
 *
 *   claude      Anthropic's API (brain-claude.ts); the older credentials/anthropic/api-key.json still read
 *   openai      api.openai.com/v1; the older credentials/openai/api-key.json still read, and OPENAI_API_KEY (with OPENAI_BASE_URL,
 *               OPENAI_MODEL) in the environment still wins, as it always did — the owner's key there keeps working with nothing done
 *   deepseek    api.deepseek.com; json_object only (no json_schema), and its JSON mode wants the word "json" in the prompt; thinking is on
 *               by default (its reasoning_effort takes none, low, high or max): the desk's low and high are sent, its medium is not, so
 *               DeepSeek's own default applies then
 *   xai         Grok · xAI API, api.x.ai/v1; chat completions (xAI's legacy endpoint, still documented) with a strict json_schema
 *   meta        Muse · Meta Model API, api.meta.ai/v1 — a US public preview; Muse Spark always reasons and answers 400 to an effort of
 *               "none", which is never sent
 *   moonshot    Kimi · Moonshot, api.moonshot.ai/v1
 *   qwen        Qwen · Alibaba Model Studio: the base URL is the owner's workspace's own (region and workspace in it), so none is assumed;
 *               a Singapore (ap-southeast-1) workspace is asked in JSON mode, its region's models not supporting structured output yet
 *   openrouter  openrouter.ai/api/v1: model ids are vendor/model
 *   gemini      Gemini's OpenAI-compatibility layer (in beta, by Google's own word)
 *   groq        api.groq.com/openai/v1: strict json_schema on a few models, json_object on all (the brain learns which from a 400)
 *   together    api.together.ai/v1: models by their full names
 *   ollama      a server on this machine, http://localhost:11434/v1: the key is ignored; no file needed — ready once a model is named
 *   vllm        a server on this machine, http://localhost:8000/v1: a key only if it was started with one; no file needed either
 *   custom      any OpenAI-format endpoint the owner names: base URL, key, model
 *
 * The three AGENTS a person may mean by "Muse", "Grok bot" and "Instinct" are not here: Meta's Muse, xAI's Grok Bot and Spear Street's
 * Instinct (and instinct.xyz's trading app, waitlist only, its docs "coming soon") offer no API a program can send a question to and get an
 * answer back from (2026-10-15). What can be called are the MODELS behind two of them — Meta's Muse models and xAI's Grok models — and they
 * are the meta and xai presets above. Nothing here pretends otherwise.
 *
 * "Test the key" (testBrain): the brain's own test — the provider's list of models, the one call that bills nothing — answered in words.
 */
import { CLAUDE_KEY_REF, claudeBrain, type ClaudeClient, type ClaudeClientOptions } from "./brain-claude.ts";
import { OPENAI_DEFAULT_BASE, OPENAI_KEY_REF, OPENAI_LABEL, openaiBrain, type OpenAIPreset } from "./brain-openai.ts";
import { brainKeyRef, keyShaped } from "./brain-key.ts";
import type { Brain, BrainConfig, BrainTest } from "./desk.ts";

/** the day the provider facts below were read from the providers' own pages (scratchpad research, 2026-10-15) */
export const CHECKED = "2026-10-15";
const ALL: ReadonlyArray<BrainConfig["effort"]> = ["low", "medium", "high"];
/** no effort the provider's docs name: none is sent, its own default applies */
const PROVIDER_DEFAULT: ReadonlyArray<BrainConfig["effort"]> = [];

/** A preset: Claude (the Anthropic format, its own brain) or one OpenAI-format endpoint (OpenAIPreset). The list is the Brains place's
 * order: Claude first, as the desk's default brain, then the model APIs, the servers on this machine, the custom endpoint */
export type BrainPreset = ({ format: "anthropic" } & Pick<OpenAIPreset, "id" | "label" | "kind" | "defaultBase" | "keyRef" | "legacyKeyRef" | "efforts">) | ({ format: "openai" } & OpenAIPreset);

export const BRAIN_PRESETS: ReadonlyArray<BrainPreset> = [
  { format: "anthropic", id: "claude", label: "Claude · Anthropic API", kind: "model-api", defaultBase: "https://api.anthropic.com", keyRef: CLAUDE_KEY_REF, legacyKeyRef: "credentials/anthropic/api-key.json", efforts: ALL },
  {
    format: "openai",
    id: "openai",
    label: OPENAI_LABEL,
    kind: "model-api",
    defaultBase: OPENAI_DEFAULT_BASE,
    keyRef: brainKeyRef("openai"),
    legacyKeyRef: OPENAI_KEY_REF,
    envPrefix: "OPENAI",
    suggestedModels: { models: ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna", "gpt-5.5"], source: "https://developers.openai.com/api/docs/models", checked: CHECKED, prices: { "gpt-6-astra": { inUsd: 10, outUsd: 50 }, "gpt-6.1-sol": { inUsd: 2, outUsd: 10 }, "gpt-6-luna": { inUsd: 0.1, outUsd: 0.5 } } },
    efforts: ALL,
    // max_completion_tokens at api.openai.com is the host's own way (brain-openai.ts HOST_QUIRKS): the older file may point this preset at
    // another endpoint, which then gets that endpoint's ways
    quirks: {},
    docs: "https://developers.openai.com/api/docs/models",
  },
  {
    format: "openai",
    id: "deepseek",
    label: "DeepSeek",
    kind: "model-api",
    defaultBase: "https://api.deepseek.com",
    keyRef: brainKeyRef("deepseek"),
    suggestedModels: { models: ["deepseek-flash", "deepseek-v4-pro"], source: "https://api-docs.deepseek.com/quick_start/pricing", checked: CHECKED, prices: { "deepseek-flash": { inUsd: 0.3, outUsd: 1.2 }, "deepseek-v4-pro": { inUsd: 1.32, outUsd: 3.96 } } },
    efforts: ["low", "high"],
    quirks: { json: "object", reasons: true },
    docs: "https://api-docs.deepseek.com/",
    note: "JSON mode only (no JSON schema): the answer is checked against the shape and asked once more when it does not fit. The prices shown are peak hours; off-peak is half (DeepSeek's pricing page).",
  },
  {
    format: "openai",
    id: "xai",
    label: "Grok · xAI API",
    kind: "model-api",
    defaultBase: "https://api.x.ai/v1",
    keyRef: brainKeyRef("xai"),
    suggestedModels: { models: ["grok-4.7", "grok-4.3", "grok-4.20-0309-reasoning", "grok-4.20-0309-non-reasoning"], source: "https://docs.x.ai/docs/models", checked: CHECKED, prices: { "grok-4.7": { inUsd: 2, outUsd: 6 }, "grok-4.3": { inUsd: 1.25, outUsd: 2.5 }, "grok-4.20-0309-reasoning": { inUsd: 1.25, outUsd: 2.5 }, "grok-4.20-0309-non-reasoning": { inUsd: 1.25, outUsd: 2.5 } } },
    efforts: PROVIDER_DEFAULT,
    quirks: {},
    docs: "https://docs.x.ai/docs/overview",
    note: "The models behind xAI's Grok, not the Grok Bot agent (which has no API to call). Chat Completions is xAI's legacy endpoint, still documented.",
  },
  {
    format: "openai",
    id: "meta",
    label: "Muse · Meta Model API",
    kind: "model-api",
    defaultBase: "https://api.meta.ai/v1",
    keyRef: brainKeyRef("meta"),
    suggestedModels: { models: ["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.1", "muse-wonder-1.0", "muse-spark-1.3-contributor", "muse-spark-1.2-contributor"], source: "https://dev.meta.ai/docs/models.md", checked: CHECKED, prices: { "muse-wonder-1.0": { inUsd: 4, outUsd: 20 }, "muse-spark-1.3": { inUsd: 1.25, outUsd: 4.25 }, "muse-spark-1.2": { inUsd: 1.25, outUsd: 4.25 }, "muse-spark-1.1": { inUsd: 1.25, outUsd: 4.25 }, "muse-spark-1.3-contributor": { inUsd: 0.1, outUsd: 0.2 }, "muse-spark-1.2-contributor": { inUsd: 0.1, outUsd: 0.2 } } },
    efforts: ALL,
    quirks: { noEffortNone: true, reasons: true },
    docs: "https://dev.meta.ai/docs/",
    keyPage: "https://dev.meta.ai/api-keys/",
    note: "The models behind Meta's Muse, not the Muse agent (which has no API to call). A public preview for developers in the US; on the -contributor tier Meta may keep prompts for training.",
  },
  {
    format: "openai",
    id: "moonshot",
    label: "Kimi · Moonshot",
    kind: "model-api",
    defaultBase: "https://api.moonshot.ai/v1",
    keyRef: brainKeyRef("moonshot"),
    suggestedModels: { models: ["kimi-k3", "kimi-k2.6"], source: "https://platform.kimi.ai/docs/guide/start-using-kimi-api", checked: CHECKED },
    efforts: PROVIDER_DEFAULT,
    quirks: {},
    docs: "https://platform.kimi.ai/docs/guide/start-using-kimi-api",
  },
  {
    format: "openai",
    id: "qwen",
    label: "Qwen · Alibaba Model Studio",
    kind: "model-api",
    defaultBase: "",
    baseHint: "https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    keyRef: brainKeyRef("qwen"),
    suggestedModels: { models: ["qwen3.8-max"], source: "https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope", checked: CHECKED },
    efforts: PROVIDER_DEFAULT,
    quirks: {},
    docs: "https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope",
    note: "The base URL is your workspace's own, and the key must come from the same region. Alibaba's page (2026-10-15) says Singapore-region models do not support structured output yet: at an ap-southeast-1 address the brain asks for JSON mode and checks the answer against the shape itself.",
  },
  {
    format: "openai",
    id: "openrouter",
    label: "OpenRouter",
    kind: "model-api",
    defaultBase: "https://openrouter.ai/api/v1",
    keyRef: brainKeyRef("openrouter"),
    suggestedModels: { models: ["meta/muse-spark-1.3", "meta/muse-wonder"], source: "https://openrouter.ai/meta", checked: CHECKED },
    efforts: PROVIDER_DEFAULT,
    quirks: {},
    docs: "https://openrouter.ai/docs/quickstart",
    note: "Model ids are vendor/model; whether a JSON schema is honoured depends on the provider OpenRouter routes to.",
  },
  {
    format: "openai",
    id: "gemini",
    label: "Gemini · Google (OpenAI compatibility)",
    kind: "model-api",
    defaultBase: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyRef: brainKeyRef("gemini"),
    suggestedModels: { models: ["gemini-3.8-flash"], source: "https://ai.google.dev/gemini-api/docs/openai", checked: CHECKED },
    efforts: PROVIDER_DEFAULT,
    quirks: {},
    docs: "https://ai.google.dev/gemini-api/docs/openai",
    note: "Google's OpenAI-compatibility layer, which Google says is still in beta.",
  },
  {
    format: "openai",
    id: "groq",
    label: "Groq",
    kind: "model-api",
    defaultBase: "https://api.groq.com/openai/v1",
    keyRef: brainKeyRef("groq"),
    suggestedModels: { models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"], source: "https://console.groq.com/docs/structured-outputs", checked: CHECKED },
    efforts: PROVIDER_DEFAULT,
    quirks: {},
    docs: "https://console.groq.com/docs/openai",
  },
  {
    format: "openai",
    id: "together",
    label: "Together AI",
    kind: "model-api",
    defaultBase: "https://api.together.ai/v1",
    keyRef: brainKeyRef("together"),
    suggestedModels: { models: ["deepseek-ai/DeepSeek-V4-Pro-0813"], source: "https://docs.together.ai/docs/openai-api-compatibility", checked: CHECKED },
    efforts: PROVIDER_DEFAULT,
    quirks: {},
    docs: "https://docs.together.ai/docs/openai-api-compatibility",
    note: "Models go by their full names; OpenAI's names are not served.",
  },
  {
    format: "openai",
    id: "ollama",
    label: "Ollama",
    kind: "local",
    defaultBase: "http://localhost:11434/v1",
    keyRef: brainKeyRef("ollama"),
    keyOptional: true,
    suggestedModels: { models: [], source: "https://docs.ollama.com/api/openai-compatibility", checked: CHECKED },
    efforts: PROVIDER_DEFAULT,
    quirks: {},
    docs: "https://docs.ollama.com/api/openai-compatibility",
    note: "Name a model your Ollama has pulled. The key is ignored here.",
  },
  {
    format: "openai",
    id: "vllm",
    label: "vLLM",
    kind: "local",
    defaultBase: "http://localhost:8000/v1",
    keyRef: brainKeyRef("vllm"),
    keyOptional: true,
    suggestedModels: { models: [], source: "https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/", checked: CHECKED },
    efforts: PROVIDER_DEFAULT,
    quirks: {},
    docs: "https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/",
    note: "Name the model your server serves; a key only if it was started with --api-key.",
  },
  {
    format: "openai",
    id: "custom",
    label: "Custom endpoint",
    kind: "custom",
    defaultBase: "",
    keyRef: brainKeyRef("custom"),
    suggestedModels: { models: [], source: "" },
    efforts: PROVIDER_DEFAULT,
    quirks: {},
    note: "Any endpoint that speaks OpenAI's chat completions: its base URL (https, or http on this machine only), your key, its model.",
  },
];

/** a preset by its id; undefined for one the account does not know */
export const presetById = (id: string): BrainPreset | undefined => BRAIN_PRESETS.find((p) => p.id === id);

export interface BrainProvidersOptions {
  /** the environment the brains read their variables from (the service's own by default; the stand-in's is empty) */
  env?: NodeJS.ProcessEnv | undefined;
  /** the OpenAI-format brains' fetch (tests; the stand-in's answers "no network") */
  fetch?: typeof fetch | undefined;
  /** how Claude's client is made (tests; the stand-in's reaches no network) */
  newClaudeClient?: ((c: ClaudeClientOptions) => ClaudeClient) | undefined;
  /** the machine the commands in a fix are for (tests) */
  platform?: NodeJS.Platform | undefined;
}

/** Every brain the account knows, one per preset, in BRAIN_PRESETS' order — what the service gives the desk (DeskOptions.brain). Each reads
 * its own key file at every check, so a key written while the account runs (the page's key field, or a file made by hand) makes its brain
 * ready with no restart */
export function brainProviders(home: string, opts: BrainProvidersOptions = {}): Brain[] {
  return BRAIN_PRESETS.map((p) => {
    if (p.format === "anthropic") return claudeBrain({ home, env: opts.env, newClient: opts.newClaudeClient, platform: opts.platform });
    const { format: _format, ...preset } = p;
    return openaiBrain({ ...preset, home, env: opts.env, fetch: opts.fetch, platform: opts.platform });
  });
}

/** "Test the key" for one provider: the brain's own test — the provider's list of models, which bills nothing — answered in words that
 * carry no key (BrainTest). A provider the account does not hold, or a brain with no test (a script), is said so and nothing is sent.
 * `model`: the model the owner means to use, said to be among what the provider lists or not */
export async function testBrain(brains: ReadonlyArray<Brain>, provider: string, model?: string): Promise<BrainTest> {
  const id = String(provider ?? "").slice(0, 40);
  // a key typed where the provider or the model goes: refused before anything is asked of anyone, and never said back — the answer
  // reaches the page (provider is echoed only when it is a brain's id)
  if (keyShaped(String(provider ?? ""))) return { ok: false, provider: "", words: "the brain named looks like an API key, so it is not repeated here and nothing was sent: a key goes only in the Brains place's key field" };
  if (keyShaped(String(model ?? ""))) return { ok: false, provider: id, words: "the model named looks like an API key, so it is not repeated here and nothing was sent: a key goes only in the Brains place's key field" };
  const b = brains.find((x) => x.id === id);
  if (!b) return { ok: false, provider: id, words: `"${id}" is not a brain this account holds: ${brains.map((x) => x.id).join(", ")}` };
  if (!b.test) return { ok: false, provider: id, words: `${b.label} has no key to test` };
  return b.test(model);
}
