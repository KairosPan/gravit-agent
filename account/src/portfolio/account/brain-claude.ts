/** THE HOUSE BRAIN: a Claude model through the Anthropic API, asked one structured question at a time by the desk (desk.ts). It reaches the
 * API the way the owner lets it: a key file in the home — <home>/credentials/brains/claude.json, {"apiKey": "<the key>"}, readable by the
 * user alone, read again at every check, so a key put there needs no restart (the page's key field writes it, the fix's command makes it)
 * — or, while that file is not there, the older <home>/credentials/anthropic/api-key.json, still read so a key the owner put there before
 * keeps working untouched; or, for an account started by hand, ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in the service's environment,
 * which wins over both files. Nothing else: no profile of a command-line login is looked for — a key the account cannot see in one of
 * those places is not promised. Without any of them — or with a file that still holds the empty template or an example instead of a key —
 * it is not ready, and says what would make it so (BrainFix, brain-key.ts: the file's path, a command that runs as written, whether a
 * restart is needed, one plain sentence); it never pretends to think.
 *
 * The key goes to Anthropic's own API and nowhere else: the client is made with Anthropic's base URL named, so an ANTHROPIC_BASE_URL left
 * in the shell that started the account never carries the account's key elsewhere. And the other way round: a shell set up to send
 * Claude-format requests through a gateway (Claude Code's documented setups for OpenRouter, DeepSeek, Kimi and others export
 * ANTHROPIC_BASE_URL=<the gateway> beside ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY = <THAT GATEWAY'S key>) holds a credential that belongs
 * to the gateway, not to Anthropic. With ANTHROPIC_BASE_URL set to any origin but https://api.anthropic.com, the brain uses neither variable
 * — it is not ready, its fix names the host the variable points at and says to remove both and restart (an environment is changed only
 * where the service is started), and no client is ever made with that credential, so no cycle and no "Test the key" sends it to Anthropic.
 * What the brain says of itself for the Brains place (about) then names that variable as one that BLOCKS a saved key (envBlocks), never as
 * one that wins over it (envWins): a key saved on the page is not read either until the variables are gone.
 * The LaunchAgent starts the account with no such variables; this guards an account started by hand from such a shell. And the client
 * waits at most two minutes for an answer and asks again at most once (CLAUDE_TIMEOUT_MS, CLAUDE_MAX_RETRIES) — the SDK's own defaults are
 * ten minutes and two retries, while the desk's clock takes one step at a time and a cycle held for half an hour would hold every exit
 * behind it; "Test the key" waits at most fifteen seconds and never asks again (CLAUDE_TEST_TIMEOUT_MS), as the OpenAI-format test does,
 * so the route that asks it is never held for minutes on a network that does not answer.
 *
 * Each question is one request: a system prompt (the role and its charter), the data as text, and the answer constrained to the role's
 * JSON shape (structured outputs). Thinking is the model's own (adaptive, the default on these models); the depth is the desk's effort
 * setting. A decline (stop reason `refusal`), an answer cut by the token limit, or one that does not fit the shape is "no decision", said
 * so; a key the API rejects, a rate limit or an unreachable API is an error the desk writes in its room — the rejected key as its own kind
 * (E_BRAIN_KEY_REJECTED, carrying the fix), which the desk keeps as the brain's standing until a call is answered again. The API's own
 * token counts come back with every answer, so the desk's cost line is counted, not guessed.
 *
 * "Test the key" (test) asks the API for its list of models — a call that bills no token — and says whether the key was taken, in the
 * API's own words scrubbed of anything key-shaped.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { isRefusal } from "../../core/errors.ts";
import { loadKeyFile, type KeyShape } from "../live/credentials.ts";
import { brainKeyRef, emptyField, envFix, exampleFix, fileProblem, hostKeyShaped, keyFileAt, keyRejected, keyShaped, keyTail, noKeyFix, present, rejectedFix, scrubbed, unusableFix } from "./brain-key.ts";
import { BRAIN_MODELS, DEFAULT_BRAIN, MODEL_ID, type Brain, type BrainAbout, type BrainAnswer, type BrainFix, type BrainRequest, type BrainStatus, type BrainTest } from "./desk.ts";

/** Claude's key file, where the page writes a key and the fix's command makes one */
export const CLAUDE_KEY_REF = brainKeyRef("claude");
/** the older key file, still read while credentials/brains/claude.json is not there */
export const ANTHROPIC_KEY_REF = "credentials/anthropic/api-key.json";
/** the file's empty template: the key goes between the quotes. It is what the make-the-file command writes, and the readiness check refuses
 * it as the example until a key is there */
export const ANTHROPIC_KEY_TEMPLATE = '{"apiKey": ""}';
export const ANTHROPIC_KEY_SHAPE: KeyShape = { required: ["apiKey"], example: ANTHROPIC_KEY_TEMPLATE };
export const CLAUDE_LABEL = "Claude · Anthropic API";
/** Anthropic's API: the one place the key is sent */
export const CLAUDE_BASE = "https://api.anthropic.com";
/** the longest the client waits for one answer, and how many times it asks again after a failed one */
export const CLAUDE_TIMEOUT_MS = 120_000;
export const CLAUDE_MAX_RETRIES = 1;
/** "Test the key": the list of models, waited for this long at most, and never asked again */
export const CLAUDE_TEST_TIMEOUT_MS = 15_000;
/** where the key comes from, in a person's words (the fix's sentences say it) */
const WHERE_FROM = "it starts sk-ant-, from console.anthropic.com › API keys";

/** the parts of the SDK's client the brain uses: messages.parse to ask, models.list to test the key */
export interface ClaudeClient {
  messages: Pick<Anthropic["messages"], "parse">;
  models?: Pick<Anthropic["models"], "list"> | undefined;
}
/** what the client is made with: one of the key or the token, Anthropic's base URL, the timeout and the retries */
export interface ClaudeClientOptions {
  apiKey: string | null;
  authToken: string | null;
  baseURL: string;
  timeout: number;
  maxRetries: number;
}
/** the SDK's client, made with exactly these options — nothing read from the environment by the SDK itself */
export const newClaudeClient = (c: ClaudeClientOptions): ClaudeClient => new Anthropic(c);

export interface ClaudeBrainOptions {
  home: string;
  env?: NodeJS.ProcessEnv | undefined;
  /** the SDK's client, for tests (a fake that answers parse()) */
  client?: ClaudeClient | undefined;
  /** how a client is made from its options (newClaudeClient by default): tests read the options, the stand-in answers "no network" */
  newClient?: ((c: ClaudeClientOptions) => ClaudeClient) | undefined;
  /** the machine the commands in a fix are for (tests); this one's by default */
  platform?: NodeJS.Platform | undefined;
}

/** could be a key: not the example from the how-to, not a fragment of one — whether the API accepts it, only the API says */
const looksLikeKey = (k: string): boolean => k.length >= 20 && !/[\s…<>]|\.\.\./.test(k);

export type ClaudeReach =
  | { ok: true; how: string; apiKey?: string | undefined; authToken?: string | undefined; fromEnv?: string | undefined; file: string }
  | { ok: false; why: string; fix: BrainFix };

/** Where ANTHROPIC_BASE_URL in the environment points, when it points anywhere but Anthropic's own API: its host as a person reads it ("an
 * address that is not a URL" when it is not one, "another address" when its host looks like a key — as URL reads it, or as it was typed,
 * label by label: hostKeyShaped) — never the variable's whole value. Undefined when it is unset, empty, or https://api.anthropic.com (with
 * or without a path) */
export function baseElsewhere(env: NodeJS.ProcessEnv): string | undefined {
  const raw = (env.ANTHROPIC_BASE_URL ?? "").trim();
  if (!raw) return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "an address that is not a URL";
  }
  if (u.origin === CLAUDE_BASE) return undefined;
  return keyShaped(u.host) || hostKeyShaped(raw) ? "another address" : u.host;
}

/** where the key is read from: the environment (`elsewhere`: ANTHROPIC_BASE_URL points at another host, so the variable holds THAT host's
 * credential, which is never used), else the key file, else — only while that is not there — the older one */
function sourceOf(o: ClaudeBrainOptions): { from: "env"; envVar: "ANTHROPIC_API_KEY" | "ANTHROPIC_AUTH_TOKEN"; elsewhere?: string | undefined } | { from: "file" | "older-file" | "none"; ref: string } {
  const env = o.env ?? process.env;
  const elsewhere = baseElsewhere(env);
  if (env.ANTHROPIC_API_KEY) return { from: "env", envVar: "ANTHROPIC_API_KEY", ...(elsewhere ? { elsewhere } : {}) };
  if (env.ANTHROPIC_AUTH_TOKEN) return { from: "env", envVar: "ANTHROPIC_AUTH_TOKEN", ...(elsewhere ? { elsewhere } : {}) };
  if (present(o.home, CLAUDE_KEY_REF)) return { from: "file", ref: CLAUDE_KEY_REF };
  if (present(o.home, ANTHROPIC_KEY_REF)) return { from: "older-file", ref: ANTHROPIC_KEY_REF };
  return { from: "none", ref: CLAUDE_KEY_REF };
}

/** how the brain would reach the API now, without reaching it; when it cannot, why (a sentence) and the fix (brain-key.ts) */
export function brainReach(o: ClaudeBrainOptions): ClaudeReach {
  const env = o.env ?? process.env;
  const newFile = keyFileAt(o.home, CLAUDE_KEY_REF);
  if (o.client) return { ok: true, how: "a client given to it", file: newFile };
  const src = sourceOf(o);
  // a gateway's credential: never used, never sent to Anthropic — not ready until both variables are gone (a restart)
  if (src.from === "env" && src.elsewhere) {
    const words = `ANTHROPIC_BASE_URL in the service's environment points at ${src.elsewhere}, so the ${src.envVar} beside it is that host's credential, not an Anthropic key: this account sends a key only to api.anthropic.com, so it uses neither. Remove both where the service is started and restart it — then a key saved in the Brains place (the file below) is read.`;
    return { ok: false, why: `ANTHROPIC_BASE_URL in the service's environment points at ${src.elsewhere}, so the ${src.envVar} beside it belongs to that host, not to Anthropic: the brain uses neither — remove both where the service is started and restart it`, fix: envFix(newFile, words) };
  }
  if (src.from === "env" && src.envVar === "ANTHROPIC_API_KEY") {
    const key = env.ANTHROPIC_API_KEY ?? "";
    if (!looksLikeKey(key))
      return { ok: false, why: "ANTHROPIC_API_KEY in the service's environment is the example or a fragment, not a key: set the key itself and restart the service", fix: envFix(newFile, `ANTHROPIC_API_KEY in the service's environment holds an example, not a key. Set your Anthropic API key there (${WHERE_FROM}) where the service is started, and restart it — or remove the variable and put the key in the file below instead, which needs no restart.`) };
    return { ok: true, how: "ANTHROPIC_API_KEY in the service's environment", apiKey: key, fromEnv: "ANTHROPIC_API_KEY", file: newFile };
  }
  if (src.from === "env") return { ok: true, how: "ANTHROPIC_AUTH_TOKEN in the service's environment", authToken: env.ANTHROPIC_AUTH_TOKEN, fromEnv: "ANTHROPIC_AUTH_TOKEN", file: newFile };
  const paste = `Paste your Anthropic API key (${WHERE_FROM}) between the quotes in the file below and save. It is read at the next cycle, no restart.`;
  if (src.from === "none")
    return { ok: false, why: `no key: the brain reads an Anthropic API key from ${newFile}, which is not there yet; it is read again at every check, no restart needed (if you start the account by hand, ANTHROPIC_API_KEY in its environment works too)`, fix: noKeyFix(newFile, ANTHROPIC_KEY_TEMPLATE, `Run the command below: it makes the key file, readable by you alone, and opens it. ${paste}`, o.platform) };
  const file = keyFileAt(o.home, src.ref);
  const read = loadKeyFile(o.home, src.ref, ANTHROPIC_KEY_SHAPE, "anthropic");
  const isExample = `${file} holds the example, not a key: put your key between the quotes of "apiKey" — the file is read again at every check, no restart needed`;
  if (!isRefusal(read)) {
    if (!looksLikeKey(read.apiKey ?? "")) return { ok: false, why: isExample, fix: exampleFix(file, `The key file holds an example, not a key. ${paste}`, o.platform) };
    return { ok: true, how: `the key file ${src.ref}`, apiKey: read.apiKey, file };
  }
  const problem = fileProblem(read);
  // the template made and left empty: "apiKey" is there with nothing in it — the example, not a broken file
  if (problem === "content" && emptyField(o.home, src.ref, "apiKey")) return { ok: false, why: isExample, fix: exampleFix(file, `The key file is there, but its key is empty. ${paste}`, o.platform) };
  // the file is there but cannot be used (its mode, not JSON, no "apiKey"): its own reason — which names no value from it
  const words = problem === "mode" ? "The key file can be read by other users of this machine, so the brain does not read it. Run the command below so only you can read it; the next cycle reads it, no restart." : problem === "content" ? `The key file is not what the brain reads: it should hold one line, ${ANTHROPIC_KEY_TEMPLATE}, with your Anthropic API key (${WHERE_FROM}) between the quotes. Open it with the command below, fix it and save; the next cycle reads it, no restart.` : `The key file cannot be used: ${read.message}`;
  return { ok: false, why: `the key file cannot be used: ${read.message}`, fix: unusableFix(file, problem === "missing" ? "other" : problem, words, o.platform) };
}

/** the API's error, in a sentence: its status and its own words, scrubbed of anything key-shaped */
const apiWords = (err: unknown, key: string): string => `the API answered ${(err as { status?: unknown }).status ?? "an error"}: ${scrubbed(String((err as Error)?.message ?? err), key).slice(0, 160)}`;

export function claudeBrain(o: ClaudeBrainOptions): Brain {
  let client: ClaudeClient | undefined = o.client;
  let clientKey: string | undefined;
  const clientFor = (reach: Extract<ClaudeReach, { ok: true }>): ClaudeClient => {
    if (o.client) return o.client;
    const who = `${reach.apiKey ? "key" : "token"}:${reach.apiKey ?? reach.authToken ?? ""}`;
    if (client && clientKey === who) return client;
    clientKey = who;
    client = (o.newClient ?? newClaudeClient)({ apiKey: reach.apiKey ?? null, authToken: reach.apiKey ? null : (reach.authToken ?? null), baseURL: CLAUDE_BASE, timeout: CLAUDE_TIMEOUT_MS, maxRetries: CLAUDE_MAX_RETRIES });
    return client;
  };
  const secret = (reach: Extract<ClaudeReach, { ok: true }>): string => reach.apiKey ?? reach.authToken ?? "";
  return {
    id: "claude",
    label: CLAUDE_LABEL,
    models: BRAIN_MODELS,
    ready(): BrainStatus {
      const r = brainReach(o);
      return r.ok ? { ok: true, model: DEFAULT_BRAIN.model, how: r.how } : { ok: false, model: DEFAULT_BRAIN.model, why: r.why, fix: r.fix };
    },
    about(): BrainAbout {
      const env = o.env ?? process.env;
      const src = sourceOf(o);
      let tail: string | undefined;
      // a gateway's credential beside a foreign ANTHROPIC_BASE_URL is not an Anthropic key: not even its tail is shown as one
      if (src.from === "env") tail = src.elsewhere ? undefined : keyTail(env[src.envVar]);
      else if (src.from !== "none") {
        const r = loadKeyFile(o.home, src.ref, ANTHROPIC_KEY_SHAPE, "anthropic");
        if (!isRefusal(r)) tail = keyTail(r.apiKey);
      }
      return {
        kind: "model-api",
        format: "anthropic",
        baseUrl: CLAUDE_BASE,
        // no suggestions: Claude's models are the ones this brain LISTS (BRAIN_MODELS, with their prices) — the only ones a desk may name
        efforts: ["low", "medium", "high"],
        ...(tail ? { tail } : {}),
        // a variable in the environment either WINS over the file (the brain uses it) or, beside an ANTHROPIC_BASE_URL that points away from
        // Anthropic, BLOCKS it: the brain uses neither that credential nor the file until both variables are gone and the service restarted
        // (brainReach) — said as envBlocks, never as envWins, so the page never says a key "is used before a saved key" that is not used
        ...(src.from === "env" ? (src.elsewhere ? { envBlocks: src.envVar } : { envWins: src.envVar }) : {}),
        keyFile: CLAUDE_KEY_REF,
        keyFrom: src.from,
      };
    },
    async test(model?: string): Promise<BrainTest> {
      const want = (model ?? "").trim();
      // a model's name that looks like a key is refused before anything is sent, in words that do not repeat it
      if (keyShaped(want)) return { ok: false, provider: "claude", words: "the model named looks like an API key, not a model's name: it is not repeated here, and nothing was sent — a key goes only in the Brains place's key field" };
      const reach = brainReach(o);
      if (!reach.ok) return { ok: false, provider: "claude", words: reach.why, fix: reach.fix };
      const c = clientFor(reach);
      if (!c.models) return { ok: false, provider: "claude", words: "this client lists no models: the key could not be checked without a billed call" };
      try {
        // the test's own limits, not the cycle's: fifteen seconds, no second try
        const page = await c.models.list({ limit: 100 }, { timeout: CLAUDE_TEST_TIMEOUT_MS, maxRetries: 0 });
        // each id checked to look like a model's name before the page is shown it (at most 200)
        const ids = (page.data ?? []).map((m) => m.id).filter((x): x is string => typeof x === "string" && MODEL_ID.test(x) && !keyShaped(x));
        const among = !want ? "" : ids.includes(want) ? `; ${want} is among the models it lists` : page.has_more ? "" : `; "${want.slice(0, 80)}" is not among the models it lists`;
        return { ok: true, provider: "claude", status: 200, words: `Anthropic accepted the key${among}.`, models: ids.slice(0, 200) };
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return { ok: false, provider: "claude", status: err.status, words: `Anthropic did not accept the key: ${scrubbed(String(err.message), secret(reach)).slice(0, 160)}` };
        if (err instanceof Anthropic.APIConnectionError) return { ok: false, provider: "claude", words: "the API could not be reached" };
        if (err instanceof Anthropic.APIError) return { ok: false, provider: "claude", status: typeof err.status === "number" ? err.status : undefined, words: apiWords(err, secret(reach)) };
        return { ok: false, provider: "claude", words: scrubbed(String((err as Error)?.message ?? err), secret(reach)).slice(0, 160) };
      }
    },
    async decide<T>(req: BrainRequest<T>): Promise<BrainAnswer<T>> {
      const reach = brainReach(o);
      if (!reach.ok) return { out: null, why: reach.why, usage: { inputTokens: 0, outputTokens: 0 } };
      const c = clientFor(reach);
      try {
        const r = await c.messages.parse({
          model: req.brain.model,
          max_tokens: req.maxTokens ?? 1024,
          system: req.system,
          messages: [{ role: "user", content: req.input }],
          output_config: { format: zodOutputFormat(req.schema), effort: req.brain.effort },
        });
        const usage = { inputTokens: r.usage.input_tokens + (r.usage.cache_creation_input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0), outputTokens: r.usage.output_tokens };
        if (r.stop_reason === "refusal") return { out: null, why: `the model declined to answer${r.stop_details && "category" in r.stop_details && r.stop_details.category ? ` (${scrubbed(String(r.stop_details.category), secret(reach)).slice(0, 60)})` : ""}`, usage };
        if (r.stop_reason === "max_tokens") return { out: null, why: "the answer ran past its token limit", usage };
        const out = r.parsed_output;
        if (out === null || out === undefined) return { out: null, why: "the answer did not fit the shape asked for", usage };
        const parsed = req.schema.safeParse(out);
        return parsed.success ? { out: parsed.data, usage } : { out: null, why: "the answer did not fit the shape asked for", usage };
      } catch (err) {
        // a key the API refused is the brain's standing, not one bad cycle: thrown as its own kind with the fix (brain-key.ts), which the desk
        // keeps until a call is answered again
        if (err instanceof Anthropic.AuthenticationError) throw keyRejected("the API did not accept the key", "Anthropic", rejectedFix(reach.file, reach.fromEnv, "Anthropic", o.platform));
        if (err instanceof Anthropic.RateLimitError) throw new Error("the API is rate-limiting this key: it is asked again next cycle");
        if (err instanceof Anthropic.APIConnectionError) throw new Error("the API could not be reached");
        if (err instanceof Anthropic.APIError) throw new Error(apiWords(err, secret(reach)));
        // anything else (a header the HTTP layer refused, a socket error) may quote the request — the key with it: its words go to the
        // room, so they are scrubbed of the key and every piece of it first
        throw new Error(scrubbed(String((err as Error)?.message ?? err), secret(reach)).slice(0, 160) || "the call failed");
      }
    },
  };
}
