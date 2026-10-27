import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRefusal } from "../../src/core/errors.ts";
import { BODY_WORDS, BrainKeyStage, baseUrlProblem, checkBeforeDoor, DESK_KEY_WORDS, deskBrainKeyProblem, KEY_SHAPED_WORDS, keyHashOf, keyInSignedFields, keyMatches, newSalt, parseBrainKeyBody, removeBrainKey, setBrainKeyProblem, writeBrainKey, type SetBrainKey } from "../../src/portfolio/account/brain-keys.ts";
import { claudeBrain } from "../../src/portfolio/account/brain-claude.ts";
import { brainProviders } from "../../src/portfolio/account/brains.ts";
import { deskPath, ROLE_SPECS, roomPath, scriptedBrain, type Brain, type BrainTest, type RoleId } from "../../src/portfolio/account/desk.ts";
import { keyless, ledgered } from "../../src/portfolio/account/exchange.ts";
import { AGENT_TYPES, malformed, ownEnvelope, OWNER_TYPES, shownFields, signAgent, signOwner, simKey, type Envelope, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { loadKeyFile, type KeyShape } from "../../src/portfolio/live/credentials.ts";
import { register } from "../../src/portfolio/live/index.ts";
import type { LiveTrader, Market, OrderState } from "../../src/portfolio/live/trade.ts";
import { no } from "../../src/portfolio/refuse.ts";
import { startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

/** A BRAIN'S KEY, TYPED ON THE PAGE (account/brain-keys.ts): the one secret the account takes from the browser. The owner signs a
 * setBrainKey that carries the key's fingerprint, never the key; the key rides beside it once, to its own route; it is checked against the
 * fingerprint before the door, staged in memory, written by the door's handler to <home>/credentials/brains/<provider>.json (0600, in a
 * 0700 folder, atomically, never through a link) — and it reaches no ledger, room, desk.json, log line or answer. Every key below is made
 * up for the test. */
type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const homes: string[] = [];
const servers: PortfolioServerHandle[] = [];
afterAll(async () => {
  for (const s of servers) await s.close();
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});
const owner = simKey("owner");
const agent = simKey("agent:brain-keys");
const stranger = simKey("agent:stranger");
let n = 0;
const nonce = () => Date.now() + ++n;

/** a made-up key: letters no hash, address or timestamp on a ledger holds, so that "not in the ledger" means what it says */
const madeUpKey = (tag: string) => `sk-test-${tag}-QZJXWVKPRMTLHGFD-${tag}YQZW`;

// ---- the brains the desk holds in these tests: each reads its key file the way a real brain does (again at every check) ------------

const SHAPE: KeyShape = { required: ["apiKey"], optional: ["baseUrl", "model"], example: '{"apiKey": ""}' };
interface FileBrainOptions {
  /** what the brain says of itself: the variable that wins over its file (Brain.about().envWins) */
  envWins?: string | undefined;
  test?: ((model?: string) => Promise<BrainTest>) | undefined;
}
function fileBrain(home: string, id: string, label: string, o: FileBrainOptions = {}): Brain {
  return {
    id,
    label,
    models: [],
    ready(model?: string) {
      const r = loadKeyFile(home, `credentials/brains/${id}.json`, SHAPE, id);
      return isRefusal(r) ? { ok: false, model: model ?? "", why: `no key for ${label}` } : { ok: true, model: model || r.model || "", how: `the key file credentials/brains/${id}.json` };
    },
    async decide() {
      return { out: null, why: "not asked in these tests", usage: { inputTokens: 0, outputTokens: 0 } };
    },
    ...("envWins" in o ? { about: () => ({ kind: "model-api" as const, format: "openai" as const, baseUrl: "", efforts: [], keyFile: `credentials/brains/${id}.json`, keyFrom: o.envWins ? ("env" as const) : ("file" as const), envWins: o.envWins }) } : {}),
    ...(o.test ? { test: o.test } : {}),
  };
}

// ---- a venue to hire the desk at, so that desk.json and room.jsonl exist and can be read --------------------------------------------

const BTC: Market = { symbol: "BTC/USDT", name: "BTC/USDT", kind: "spot", base: "BTC", quote: "USDT", price: 60_000, bid: 59_990, ask: 60_010, minQty: 0.0001, qtyStep: 0.0001, priceStep: 0.1, open: true, types: ["market", "limit"] };
const trader: LiveTrader = {
  can: true,
  what: "spot",
  markets: async () => [{ ...BTC }],
  market: async (symbol) => (symbol === BTC.symbol ? { ...BTC } : no("E_VENUE_REJECTED", { venue: "ex", message: "no such market" })),
  place: async () => ({ ref: "o-1", status: "open", filledQty: 0, native: {} }) as OrderState,
  cancel: async () => ({ ref: "o-1", status: "canceled", filledQty: 0, native: {} }) as OrderState,
  status: async () => ({ ref: "o-1", status: "open", filledQty: 0, native: {} }) as OrderState,
  positions: async () => [],
};
register({ kind: "standin-brainkeys", label: "a venue for the desk", needs: "key-file", example: "", venues: [], async open(req) {
  return { source: { name: req.label || "Ex", kind: "cex", reference: "standin", via: "a stand-in", probe: { can: ["read", "trade"], note: "" }, read: async () => [{ asset: "USDT", amount: 5000, usd: 5000 }], trader, readOnlyBecause: "a stand-in moves no money" } as never, first: [{ asset: "USDT", amount: 5000, usd: 5000 }], summary: "connected" };
} });

interface Boot {
  brains?: ((home: string) => Brain[]) | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  home?: string | undefined;
  hire?: boolean | undefined;
  /** the brain the desk is hired with (default: the script) */
  hireBrain?: { provider: string; model: string } | undefined;
}
async function boot(o: Boot = {}) {
  const home = o.home ?? mkdtempSync(join(tmpdir(), "account-brain-keys-"));
  if (!o.home) homes.push(home);
  const brains = o.brains ? o.brains(home) : [scriptedBrain(() => null), fileBrain(home, "deepseek", "DeepSeek"), fileBrain(home, "openai", "OpenAI")];
  const svc = await PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined }, publicMarkets: [], liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date().toISOString() }] }, desk: { brain: brains, tickMs: 0, env: o.env ?? {} } });
  await svc.restoring;
  const srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
  servers.push(srv);
  const own = async (a: NoNonce<OwnerAction>) => svc.exchange(await signOwner(owner, { ...a, nonce: nonce() } as OwnerAction));
  if (o.hire) {
    const c = await own({ type: "connectVenue", venue: "ex", connector: "live:standin-brainkeys", label: "Ex", credentialRef: "" });
    if (isRefusal(c)) throw new Error(c.message);
    const roles: RoleId[] = ["head", "search", "risk", "sniper", "exit"];
    for (const role of roles) {
      const k = svc.desk!.seatKeyOf(role);
      if (isRefusal(k)) throw new Error(k.message);
      const r = await own({ type: "approveAgent", agentAddress: k.address, agentName: `Desk ${role}`, validUntil: Date.now() + 30 * 86_400_000 });
      if (isRefusal(r)) throw new Error(r.message);
      if (ROLE_SPECS[role].trades) await own({ type: "approveSpend", agent: k.address, scope: "trade", allow: "ex", perPayment: "100", budget: "500", windowHours: 0, validUntil: Date.now() + 7 * 86_400_000 });
    }
    const h = await own({ type: "setDesk", desk: "desk", change: "hire", value: JSON.stringify({ name: "Key desk", objective: { text: "Small entries on majors", venue: "ex", universe: "all", targetPct: 3, maxRiskPct: 1, maxDailyLossPct: 5, hours: 22, everyMin: 15, reportAt: "21:00" }, brain: { ...(o.hireBrain ?? { provider: "scripted", model: "scripted" }), effort: "medium" }, roles: roles.map((role) => ({ role, kind: "house" })) }) });
    if (isRefusal(h)) throw new Error(`hire: ${h.message}`);
  }
  return { home, svc, srv, own };
}

/** one request as a program sends it, every header the test's own (a Host that is not this machine's, a raw body that is not JSON) */
function send(url: string, path: string, o: { headers?: Record<string, string> | undefined; body?: string | undefined; method?: string | undefined } = {}): Promise<{ status: number; text: string }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path, method: o.method ?? "POST", headers: { "content-type": "application/json", ...(o.headers ?? {}) } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on("error", reject);
    req.end(o.body);
  });
}

/** a setBrainKey signed as the page signs it: the key's fingerprint made with a fresh salt, the key itself beside the envelope */
async function signedKey(o: { provider: string; key: string; baseUrl?: string; model?: string; at?: number; signer?: typeof owner; hashOf?: string }) {
  const salt = newSalt();
  const action: SetBrainKey = { type: "setBrainKey", provider: o.provider, baseUrl: o.baseUrl ?? "", model: o.model ?? "", keyHash: keyHashOf(salt, o.hashOf ?? o.key), salt, nonce: o.at ?? nonce() };
  const envelope = await signOwner(o.signer ?? owner, action);
  return { action, envelope, body: JSON.stringify({ envelope, apiKey: o.key }) };
}
const keyFile = (home: string, id: string) => join(home, "credentials", "brains", `${id}.json`);
const mode = (p: string) => (statSync(p).mode & 0o777).toString(8);
const ledgerText = (home: string) => readdirSync(join(home, "portfolio")).filter((f) => f.endsWith(".jsonl")).map((f) => readFileSync(join(home, "portfolio", f), "utf8")).join("\n");
const ledgerRows = (home: string) => ledgerText(home).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

/** everything said on the console while a test runs, as text */
let said: string[] = [];
let spies: Array<{ mockRestore(): void }> = [];
beforeEach(() => {
  said = [];
  const catchAll = (...args: unknown[]) => void said.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  spies = (["error", "log", "warn", "info", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(catchAll));
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  spies.push(vi.spyOn(process.stderr, "write").mockImplementation(((c: unknown, ...rest: unknown[]) => (said.push(String(c)), err(c as string, ...(rest as []))) ) as never));
  spies.push(vi.spyOn(process.stdout, "write").mockImplementation(((c: unknown, ...rest: unknown[]) => (said.push(String(c)), out(c as string, ...(rest as [])))) as never));
});
afterEach(() => {
  for (const s of spies) s.mockRestore();
});
const console$ = () => said.join("\n");

describe("the fingerprint, the shapes, the body (account/brain-keys.ts)", () => {
  it("keyHash is hex SHA-256 of the salt's bytes then the key's UTF-8 bytes; the match is exact", () => {
    const salt = "00112233445566778899aabbccddeeff";
    // the same bytes as the page's crypto.subtle.digest("SHA-256", salt ‖ TextEncoder().encode(key)): one value worked out apart from this
    // code (Python's hashlib over bytes.fromhex(salt) + key.encode())
    expect(keyHashOf(salt, "sk-abc")).toBe("d7bdfe9e40ee1a6e1018fa629eb91e2174628fc846454b871716c86dfe5b5fec");
    expect(keyMatches(salt, "sk-abc", keyHashOf(salt, "sk-abc"))).toBe(true);
    expect(keyMatches(salt, "sk-abd", keyHashOf(salt, "sk-abc"))).toBe(false);
    expect(keyMatches("ff112233445566778899aabbccddeeff", "sk-abc", keyHashOf(salt, "sk-abc"))).toBe(false);
    expect(keyMatches(salt, "sk-abc", "not-a-hash")).toBe(false);
  });

  it("a base URL is https, or plain http only for this machine; no placeholder, name, query or fragment — and the words never repeat it", () => {
    expect(baseUrlProblem("")).toBeNull();
    expect(baseUrlProblem("https://api.deepseek.com")).toBeNull();
    expect(baseUrlProblem("http://localhost:11434/v1")).toBeNull();
    expect(baseUrlProblem("http://127.0.0.1:8000/v1")).toBeNull();
    expect(baseUrlProblem("http://[::1]:8000/v1")).toBeNull();
    expect(baseUrlProblem("http://api.example.com/v1")).toMatch(/plain http is only for this machine/);
    expect(baseUrlProblem("http://192.168.1.5:8000/v1")).toMatch(/plain http is only for this machine/);
    expect(baseUrlProblem("https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1")).toMatch(/placeholder/);
    expect(baseUrlProblem("https://me:pw@api.deepseek.com")).toMatch(/no name or password/);
    expect(baseUrlProblem("https://api.deepseek.com/v1?key=x")).toMatch(/without a query/);
    expect(baseUrlProblem("ftp://api.deepseek.com")).toMatch(/https URL/);
    const secretish = "https://sk-QZJXWVKPRMTLH@api.example.com";
    expect(baseUrlProblem(secretish)).not.toContain("QZJX");
    // a control character typed or pasted with it: refused, never quietly taken out
    expect(baseUrlProblem("https://api.deepseek.com\u0001")).toBe("the base URL holds a control character: type it again");
    expect(baseUrlProblem("\u007fhttps://api.deepseek.com")).toBe("the base URL holds a control character: type it again");
  });

  it("a setBrainKey's shapes: a brain's id, a model's name, a 64-hex fingerprint and a 32-hex salt — or both empty to take the key away", () => {
    const ok: SetBrainKey = { type: "setBrainKey", provider: "deepseek", baseUrl: "", model: "deepseek-flash", keyHash: "a".repeat(64), salt: "b".repeat(32), nonce: 1 };
    expect(setBrainKeyProblem(ok)).toBeNull();
    expect(setBrainKeyProblem({ ...ok, keyHash: "", salt: "" })).toBeNull();
    expect(setBrainKeyProblem({ ...ok, keyHash: "", salt: "b".repeat(32) })).toMatch(/empty salt too/);
    expect(setBrainKeyProblem({ ...ok, provider: "../x" })).toMatch(/brain's id/);
    expect(setBrainKeyProblem({ ...ok, model: "has space" })).toMatch(/model/);
    expect(setBrainKeyProblem({ ...ok, keyHash: "A".repeat(64) })).toBe(BODY_WORDS.hashShape);
    expect(setBrainKeyProblem({ ...ok, salt: "b".repeat(30) })).toBe(BODY_WORDS.hashShape);
  });

  it("the body: exactly {envelope, apiKey}; anything else is a fixed sentence, and the bytes read are zeroed", () => {
    const key = madeUpKey("body");
    const raw = Buffer.from(`{"envelope": {"action": {"type": "setBrainKey"}}, "apiKey": ${key}}`);
    const r = parseBrainKeyBody(raw);
    expect(r).toEqual({ ok: false, status: 400, error: BODY_WORDS.malformed });
    expect(JSON.stringify(r)).not.toContain(key);
    expect(raw.every((b) => b === 0)).toBe(true);
    expect(parseBrainKeyBody(Buffer.from(JSON.stringify({ envelope: { action: { type: "setBrainKey" } }, apiKey: key, extra: 1 })))).toMatchObject({ ok: false, error: BODY_WORDS.malformed });
    expect(parseBrainKeyBody(Buffer.from(JSON.stringify({ envelope: { action: { type: "setDesk" } }, apiKey: key })))).toMatchObject({ ok: false, error: BODY_WORDS.notSetKey });
    expect(parseBrainKeyBody(Buffer.from(JSON.stringify({ envelope: { action: { type: "setBrainKey" } }, apiKey: 42 })))).toMatchObject({ ok: false, error: BODY_WORDS.keyShape });
  });

  it("before the door: a key of the wrong shape, a key beside a signature that takes it away, a key that is not the one signed", () => {
    const salt = newSalt();
    const key = madeUpKey("door");
    const a: SetBrainKey = { type: "setBrainKey", provider: "deepseek", baseUrl: "", model: "", keyHash: keyHashOf(salt, key), salt, nonce: 1 };
    expect(checkBeforeDoor(a, key)).toBeNull();
    expect(checkBeforeDoor(a, undefined)).toEqual({ status: 400, error: BODY_WORDS.noKey });
    expect(checkBeforeDoor(a, "short")).toEqual({ status: 400, error: BODY_WORDS.keyShape });
    expect(checkBeforeDoor(a, `${key} with spaces`)).toEqual({ status: 400, error: BODY_WORDS.keyShape });
    expect(checkBeforeDoor(a, "k".repeat(513))).toEqual({ status: 400, error: BODY_WORDS.keyShape });
    expect(checkBeforeDoor(a, `${key}x`)).toEqual({ status: 409, error: BODY_WORDS.mismatch });
    expect(checkBeforeDoor({ ...a, keyHash: "", salt: "" }, key)).toEqual({ status: 400, error: BODY_WORDS.clearWithKey });
    expect(checkBeforeDoor({ ...a, keyHash: "", salt: "" }, undefined)).toBeNull();
    // a field the type does not sign, or a nonce that is not a whole number: said by name, never by value
    expect(checkBeforeDoor({ ...a, apiKey: key } as never, key)?.error).toMatch(/"apiKey" is not part of what "setBrainKey" signs/);
    expect(checkBeforeDoor({ ...a, nonce: 1.5 }, key)?.status).toBe(400);
  });

  it("the stage holds a key once, gives it once, and lets it go", () => {
    const s = new BrainKeyStage();
    expect(s.stage("h", "k1")).toBe(true);
    expect(s.stage("h", "k2")).toBe(false);
    expect(s.take("h")).toBe("k1");
    expect(s.take("h")).toBeUndefined();
    s.stage("h2", "k");
    s.drop("h2");
    expect(s.size).toBe(0);
  });
});

describe("setBrainKey is the owner's, and signs no key", () => {
  it("an owner type, never an agent's; what the owner sees and signs is the provider, the base URL, the model, the fingerprint and its salt", () => {
    expect((OWNER_TYPES as readonly string[]).includes("setBrainKey")).toBe(true);
    expect((AGENT_TYPES as readonly string[]).includes("setBrainKey")).toBe(false);
    const a: SetBrainKey = { type: "setBrainKey", provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-flash", keyHash: "c".repeat(64), salt: "d".repeat(32), nonce: 5 };
    expect(shownFields(a).map((f) => f.name)).toEqual(["provider", "baseUrl", "model", "keyHash", "salt", "nonce"]);
  });

  it("the ledger's copy of the envelope: the fingerprint only, no salt, and nothing that rode in beside the four fields", () => {
    const a: SetBrainKey = { type: "setBrainKey", provider: "deepseek", baseUrl: "", model: "", keyHash: "0123456789abcdef".repeat(4), salt: "e".repeat(32), nonce: 5 };
    const e = { action: a, nonce: 5, signature: { r: "0x1", s: "0x2", v: 27 }, apiKey: madeUpKey("ride") } as unknown as Envelope;
    const kept = ledgered(e);
    expect(kept.action).toMatchObject({ keyHash: "01234567", salt: "" });
    expect(JSON.stringify(kept)).not.toContain("QZJX");
    expect(keyless({ action: { type: "setDesk", desk: "desk", change: "pause", value: "", nonce: 1 }, nonce: 1, signature: { r: "0x1", s: "0x2", v: 27 } } as unknown as Envelope).action).toMatchObject({ type: "setDesk" });
  });
});

describe("POST /api/account/brain-key", () => {
  it("the key goes to credentials/brains/<provider>.json — 0600, in a 0700 folder, exactly the JSON — and nowhere else: not the ledger, room.jsonl, desk.json, the answer, the console", async () => {
    const { home, svc, srv } = await boot({ hire: true });
    expect(existsSync(deskPath(home))).toBe(true);
    const key = madeUpKey("set");
    const { body, action } = await signedKey({ provider: "deepseek", key, baseUrl: "https://api.deepseek.com", model: "deepseek-flash" });
    const r = await send(srv.url, "/api/account/brain-key", { body, headers: { origin: srv.url, "sec-fetch-site": "same-origin" } });
    expect(r.status).toBe(200);
    const answer = JSON.parse(r.text) as Record<string, unknown>;
    expect(answer).toMatchObject({ ok: true, provider: "deepseek", fingerprint: action.keyHash.slice(0, 8), tail: `…${key.slice(-4)}`, standing: { ok: true } });
    expect(r.text).not.toContain(key);
    // the file, exactly
    const f = keyFile(home, "deepseek");
    expect(JSON.parse(readFileSync(f, "utf8"))).toEqual({ apiKey: key, baseUrl: "https://api.deepseek.com", model: "deepseek-flash" });
    expect(mode(f)).toBe("600");
    expect(mode(join(home, "credentials", "brains"))).toBe("700");
    // nowhere else
    const tail = `…${key.slice(-4)}`;
    for (const text of [ledgerText(home), readFileSync(roomPath(home), "utf8"), readFileSync(deskPath(home), "utf8"), console$()]) {
      expect(text).not.toContain(key);
      expect(text).not.toContain(tail);
      expect(text).not.toContain(key.slice(-8));
    }
    // the ledger says it was done, by fingerprint: the taken row's envelope holds the fingerprint and no salt; the done row no envelope
    const rows = ledgerRows(home).filter((x) => x.tool === "setBrainKey");
    expect(rows.map((x) => x.outcome)).toEqual(["taken", "ok"]);
    expect((rows[0]!.envelope as Envelope).action).toMatchObject({ provider: "deepseek", keyHash: action.keyHash.slice(0, 8), salt: "" });
    expect(rows[1]!.envelope).toBeUndefined();
    expect(String(rows[1]!.reason)).toContain(`fingerprint ${action.keyHash.slice(0, 8)}`);
    expect(ledgerText(home)).not.toContain(action.keyHash);
    // the staged key is gone once the route answered
    expect(svc.brainKeys.size).toBe(0);
    // the temporary file is gone too: the folder holds the key file alone
    expect(readdirSync(join(home, "credentials", "brains"))).toEqual(["deepseek.json"]);
  });

  it("the standing flips to ready without a restart: before, not ready; the answer and the desk's catalog then say ready", async () => {
    const { svc, srv } = await boot();
    expect(svc.desk!.catalog().brains.find((b) => b.id === "openai")?.ok).toBe(false);
    const { body } = await signedKey({ provider: "openai", key: madeUpKey("flip"), model: "gpt-6.1-sol" });
    const r = await send(srv.url, "/api/account/brain-key", { body });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text).standing).toMatchObject({ ok: true, model: "gpt-6.1-sol" });
    expect(svc.desk!.catalog().brains.find((b) => b.id === "openai")?.ok).toBe(true);
  });

  it("a key that is not the one signed: refused before the door, nothing written, the signature not spent — the right key then goes through", async () => {
    const { home, svc, srv } = await boot();
    const key = madeUpKey("hash");
    const signed = await signedKey({ provider: "deepseek", key, hashOf: `${key}-other` });
    const r = await send(srv.url, "/api/account/brain-key", { body: signed.body });
    expect(r.status).toBe(409);
    expect(JSON.parse(r.text)).toEqual({ ok: false, error: BODY_WORDS.mismatch });
    expect(existsSync(keyFile(home, "deepseek"))).toBe(false);
    expect(ledgerRows(home).some((x) => x.tool === "setBrainKey")).toBe(false);
    // the same signature with the key it was made for: its nonce was never spent
    const right = await send(srv.url, "/api/account/brain-key", { body: JSON.stringify({ envelope: signed.envelope, apiKey: `${key}-other` }) });
    expect(right.status).toBe(200);
    expect(svc.brainKeys.size).toBe(0);
    expect(console$()).not.toContain(key);
  });

  it("an agent key cannot set a brain's key — one let in is refused as the owner's to sign, a stranger as a key the account does not know; nothing is written", async () => {
    const { home, srv, own } = await boot();
    const r0 = await own({ type: "approveAgent", agentAddress: agent.address, agentName: "Helper", validUntil: Date.now() + 86_400_000 });
    expect(isRefusal(r0)).toBe(false);
    const asAgent = await signedKey({ provider: "deepseek", key: madeUpKey("agent"), signer: agent });
    const a = await send(srv.url, "/api/account/brain-key", { body: asAgent.body });
    expect(a.status).toBe(409);
    expect(JSON.parse(a.text).refusal.code).toBe("E_ACCOUNT_OWNER_ONLY");
    const asStranger = await signedKey({ provider: "deepseek", key: madeUpKey("strgr"), signer: stranger });
    const s = await send(srv.url, "/api/account/brain-key", { body: asStranger.body });
    expect(s.status).toBe(401);
    expect(existsSync(keyFile(home, "deepseek"))).toBe(false);
    expect(a.text + s.text).not.toContain("QZJX");
  });

  it("another site's request, a cross-site one, or one under a host name that is not this machine's: refused before its body is read", async () => {
    const { home, srv } = await boot();
    const key = madeUpKey("guard");
    const body = `{"envelope": {}, "apiKey": ${key}`;
    for (const headers of [{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }, { host: "evil.example" }, { host: "attacker.localhost.example:80" }]) {
      const r = await send(srv.url, "/api/account/brain-key", { body, headers });
      expect(r.status).toBe(403);
      expect(r.text).not.toContain(key);
      // and the server's other routes: a foreign body is not parsed there either
      const x = await send(srv.url, "/api/exchange", { body, headers });
      expect(x.status).toBe(403);
    }
    expect(console$()).not.toContain(key);
    expect(existsSync(keyFile(home, "deepseek"))).toBe(false);
  });

  it("a body that is not JSON, with a key in it: one fixed sentence, never echoed, never logged — here and at any route the server's parser reads", async () => {
    // express logs a body it could not parse, stack and all, unless it runs as "test": the server here runs as it would by hand
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    let srv: PortfolioServerHandle;
    try {
      ({ srv } = await boot());
    } finally {
      process.env.NODE_ENV = env;
    }
    // unquoted, so that the parser stops AT the key: Node's JSON.parse then quotes the ten characters it stopped at in its message
    const key = "QZJXWVKPRMTLHGFD-malformed-0000";
    const body = `{"envelope": {"action": {"type": "setBrainKey"}}, "apiKey": ${key}}`;
    const r = await send(srv.url, "/api/account/brain-key", { body });
    expect(r.status).toBe(400);
    expect(JSON.parse(r.text)).toEqual({ ok: false, error: BODY_WORDS.malformed });
    // the same body sent to the door by mistake, or to the route by another spelling express answers to
    for (const path of ["/api/exchange", "/api/account/prepare", "/api/account/Brain-Key", "/api/account/brain-key/"]) {
      const x = await send(srv.url, path, { body });
      expect(x.status).toBe(400);
      expect(x.text).not.toContain("QZJXWVKP");
    }
    expect(console$()).not.toContain("QZJXWVKP");
  });

  it("a key of the wrong shape (too long, a space in it), a body too large, a type that is not JSON: refused, never echoed", async () => {
    const { home, srv } = await boot();
    const long = `sk-${"QZJX".repeat(130)}`;
    const salt = newSalt();
    const a: SetBrainKey = { type: "setBrainKey", provider: "deepseek", baseUrl: "", model: "", keyHash: keyHashOf(salt, long), salt, nonce: nonce() };
    const env = await signOwner(owner, a);
    const r = await send(srv.url, "/api/account/brain-key", { body: JSON.stringify({ envelope: env, apiKey: long }) });
    expect(r.status).toBe(400);
    expect(JSON.parse(r.text).error).toBe(BODY_WORDS.keyShape);
    expect(r.text).not.toContain("QZJX");
    const spaced = await send(srv.url, "/api/account/brain-key", { body: JSON.stringify({ envelope: env, apiKey: "sk-QZJX WVKP-1234" }) });
    expect(JSON.parse(spaced.text).error).toBe(BODY_WORDS.keyShape);
    const big = await send(srv.url, "/api/account/brain-key", { body: JSON.stringify({ envelope: env, apiKey: "QZJX".repeat(1200) }) });
    expect(big.status).toBe(413);
    expect(big.text).not.toContain("QZJX");
    const text = await send(srv.url, "/api/account/brain-key", { body: "apiKey=sk-QZJXWVKP", headers: { "content-type": "text/plain" } });
    expect(text.status).toBe(415);
    expect(existsSync(keyFile(home, "deepseek"))).toBe(false);
    expect(console$()).not.toContain("QZJX");
  });

  it("the same signed key again is refused and writes nothing — in this run, and after a restart", async () => {
    const { home, srv } = await boot();
    const key = madeUpKey("replay");
    const signed = await signedKey({ provider: "deepseek", key });
    expect((await send(srv.url, "/api/account/brain-key", { body: signed.body })).status).toBe(200);
    // the owner writes another key by hand meanwhile: a replay must not put the old one back
    writeFileSync(keyFile(home, "deepseek"), `${JSON.stringify({ apiKey: "sk-by-hand-0000000000000000" })}\n`, { mode: 0o600 });
    const again = await send(srv.url, "/api/account/brain-key", { body: signed.body });
    expect(again.status).toBe(409);
    expect(JSON.parse(again.text)).toEqual({ ok: false, error: BODY_WORDS.replay });
    expect(JSON.parse(readFileSync(keyFile(home, "deepseek"), "utf8")).apiKey).toBe("sk-by-hand-0000000000000000");
    // a later run of the account remembers the nonce from its ledger
    const later = await boot({ home });
    const r = await send(later.srv.url, "/api/account/brain-key", { body: signed.body });
    expect(r.status).toBe(409);
    expect(JSON.parse(r.text).refusal.code).toBe("E_ACCOUNT_NONCE");
    expect(JSON.parse(readFileSync(keyFile(home, "deepseek"), "utf8")).apiKey).toBe("sk-by-hand-0000000000000000");
  });

  it("a signature kept for later: past its ten minutes it is too old, and nothing is written", async () => {
    const { home, srv } = await boot();
    const { body } = await signedKey({ provider: "deepseek", key: madeUpKey("ttl"), at: Date.now() - 11 * 60_000 });
    const r = await send(srv.url, "/api/account/brain-key", { body });
    expect(r.status).toBe(409);
    expect(JSON.parse(r.text).refusal.code).toBe("E_ACCOUNT_EXPIRED");
    expect(existsSync(keyFile(home, "deepseek"))).toBe(false);
  });

  it("a link where the key file or its folder should be: refused, never followed, the file it points at untouched", async () => {
    const { home, srv } = await boot();
    const outside = mkdtempSync(join(tmpdir(), "account-brain-keys-outside-"));
    homes.push(outside);
    const target = join(outside, "elsewhere.json");
    writeFileSync(target, "untouched\n", { mode: 0o600 });
    mkdirSync(join(home, "credentials", "brains"), { recursive: true, mode: 0o700 });
    symlinkSync(target, keyFile(home, "deepseek"));
    const r = await send(srv.url, "/api/account/brain-key", { body: (await signedKey({ provider: "deepseek", key: madeUpKey("link") })).body });
    expect(r.status).toBe(409);
    expect(JSON.parse(r.text).refusal.message).toMatch(/is a link/);
    expect(readFileSync(target, "utf8")).toBe("untouched\n");
    expect(lstatSync(keyFile(home, "deepseek")).isSymbolicLink()).toBe(true);
    // the folder itself a link to elsewhere
    const home2 = (await boot()).home;
    mkdirSync(join(home2, "credentials"), { recursive: true });
    symlinkSync(outside, join(home2, "credentials", "brains"));
    const w = writeBrainKey(home2, "deepseek", { apiKey: madeUpKey("dir") });
    expect(isRefusal(w) && w.message).toMatch(/is a link/);
    expect(existsSync(join(outside, "deepseek.json"))).toBe(false);
    // nor is a key taken away through one: a credentials folder that is a link to elsewhere keeps what is there
    const home3 = (await boot()).home;
    const elsewhere = mkdtempSync(join(tmpdir(), "account-brain-keys-elsewhere-"));
    homes.push(elsewhere);
    mkdirSync(join(elsewhere, "brains"), { recursive: true });
    writeFileSync(join(elsewhere, "brains", "deepseek.json"), "kept\n", { mode: 0o600 });
    symlinkSync(elsewhere, join(home3, "credentials"));
    const gone = removeBrainKey(home3, "deepseek");
    expect(isRefusal(gone) && gone.message).toMatch(/is a link/);
    expect(readFileSync(join(elsewhere, "brains", "deepseek.json"), "utf8")).toBe("kept\n");
  });

  it("a key file others could read (0644) is replaced by one only the user can (0600); a folder others could open is closed to 0700", async () => {
    const { home, srv } = await boot();
    const dir = join(home, "credentials", "brains");
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755);
    writeFileSync(keyFile(home, "deepseek"), `${JSON.stringify({ apiKey: "sk-old-0000000000000000" })}\n`);
    chmodSync(keyFile(home, "deepseek"), 0o644);
    const key = madeUpKey("mode");
    expect((await send(srv.url, "/api/account/brain-key", { body: (await signedKey({ provider: "deepseek", key })).body })).status).toBe(200);
    expect(mode(keyFile(home, "deepseek"))).toBe("600");
    expect(mode(dir)).toBe("700");
    expect(JSON.parse(readFileSync(keyFile(home, "deepseek"), "utf8")).apiKey).toBe(key);
  });

  it("a variable in the service's environment that wins over the file is said (envWins): the brain's own word, else the variables it reads", async () => {
    const env = { OPENAI_API_KEY: "sk-env-0000000000000000", ANTHROPIC_API_KEY: "sk-ant-env-000000000000000000" };
    const { home, srv } = await boot({ env, brains: (h) => [scriptedBrain(() => null), fileBrain(h, "openai", "OpenAI"), fileBrain(h, "xai", "Grok · xAI API", { envWins: "XAI_API_KEY" }), claudeBrain({ home: h, env })] });
    const o = JSON.parse((await send(srv.url, "/api/account/brain-key", { body: (await signedKey({ provider: "openai", key: madeUpKey("envo") })).body })).text);
    expect(o).toMatchObject({ ok: true, envWins: "OPENAI_API_KEY" });
    const x = JSON.parse((await send(srv.url, "/api/account/brain-key", { body: (await signedKey({ provider: "xai", key: madeUpKey("envx") })).body })).text);
    expect(x).toMatchObject({ ok: true, envWins: "XAI_API_KEY" });
    const c = JSON.parse((await send(srv.url, "/api/account/brain-key", { body: (await signedKey({ provider: "claude", key: madeUpKey("envc") })).body })).text);
    expect(c).toMatchObject({ ok: true, envWins: "ANTHROPIC_API_KEY", standing: { ok: true } });
    // written all the same: the file is the one read once the variable is gone
    expect(existsSync(keyFile(home, "openai"))).toBe(true);
    expect(existsSync(keyFile(home, "claude"))).toBe(true);
    // no variable, nothing said
    const plain = await boot({ env: {} });
    const p = JSON.parse((await send(plain.srv.url, "/api/account/brain-key", { body: (await signedKey({ provider: "openai", key: madeUpKey("noenv") })).body })).text);
    expect(p.ok).toBe(true);
    expect(p.envWins).toBeUndefined();
  });

  it("keyHash \"\" takes the key away: the provider's file is removed, and a key may not ride beside such a signature", async () => {
    const { home, srv } = await boot();
    expect((await send(srv.url, "/api/account/brain-key", { body: (await signedKey({ provider: "deepseek", key: madeUpKey("clear") })).body })).status).toBe(200);
    const clear = await signOwner(owner, { type: "setBrainKey", provider: "deepseek", baseUrl: "", model: "", keyHash: "", salt: "", nonce: nonce() });
    const withKey = await send(srv.url, "/api/account/brain-key", { body: JSON.stringify({ envelope: clear, apiKey: madeUpKey("clr2") }) });
    expect(withKey.status).toBe(400);
    expect(existsSync(keyFile(home, "deepseek"))).toBe(true);
    const r = await send(srv.url, "/api/account/brain-key", { body: JSON.stringify({ envelope: clear }) });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toMatchObject({ ok: true, provider: "deepseek", cleared: true, standing: { ok: false } });
    expect(existsSync(keyFile(home, "deepseek"))).toBe(false);
  });

  it("a provider the desk does not hold, or a signature sent to the door without its key: refused, nothing written", async () => {
    const { home, svc, srv } = await boot();
    const r = await send(srv.url, "/api/account/brain-key", { body: (await signedKey({ provider: "nobody", key: madeUpKey("nobody") })).body });
    expect(r.status).toBe(409);
    expect(JSON.parse(r.text).refusal.message).toMatch(/not a brain this desk holds/);
    expect(existsSync(keyFile(home, "nobody"))).toBe(false);
    const { envelope } = await signedKey({ provider: "deepseek", key: madeUpKey("nokey") });
    const d = await send(srv.url, "/api/exchange", { body: JSON.stringify(envelope) });
    expect(d.status).toBe(409);
    expect(JSON.parse(d.text).refusal.message).toMatch(/the key did not arrive with this signature/);
    expect(existsSync(keyFile(home, "deepseek"))).toBe(false);
    expect(svc.brainKeys.size).toBe(0);
  });

  it("a key sent to the door by mistake, beside the envelope's own fields, is not written to the ledger", async () => {
    const { home, srv } = await boot();
    const key = madeUpKey("mistake");
    const { envelope } = await signedKey({ provider: "deepseek", key });
    await send(srv.url, "/api/exchange", { body: JSON.stringify({ ...envelope, apiKey: key }) });
    expect(ledgerText(home)).not.toContain(key);
    expect(ledgerText(home)).not.toContain("QZJX");
  });

  it("the page prepares a setBrainKey with no key in it: the dialog's fields name the fingerprint; a draft that carries a key is refused without saying it", async () => {
    const { srv } = await boot();
    const salt = newSalt();
    const ok = await send(srv.url, "/api/account/prepare", { body: JSON.stringify({ draft: { type: "setBrainKey", provider: "deepseek", baseUrl: "", model: "deepseek-flash", keyHash: keyHashOf(salt, madeUpKey("prep")), salt } }) });
    expect(ok.status).toBe(200);
    expect((JSON.parse(ok.text).shown as Array<{ name: string }>).map((f) => f.name)).toEqual(["provider", "baseUrl", "model", "keyHash", "salt", "nonce"]);
    const leak = await send(srv.url, "/api/account/prepare", { body: JSON.stringify({ draft: { type: "setBrainKey", provider: "deepseek", baseUrl: "", model: "", keyHash: "", salt: "", apiKey: madeUpKey("prep2") } }) });
    expect(leak.status).toBe(409);
    expect(leak.text).not.toContain("QZJX");
    const http = await send(srv.url, "/api/account/prepare", { body: JSON.stringify({ draft: { type: "setBrainKey", provider: "deepseek", baseUrl: "http://api.deepseek.com", model: "", keyHash: "", salt: "" } }) });
    expect(JSON.parse(http.text).refusal.message).toMatch(/plain http is only for this machine/);
  });
});

describe("the account's own brains (brains.ts brainProviders), as the service builds them", () => {
  /** no request leaves the test: a fetch that answers nothing */
  const noNetwork = (async () => {
    throw new Error("no network in this test");
  }) as unknown as typeof fetch;

  it("a key typed for DeepSeek makes the DeepSeek preset ready with no restart; Claude's and OpenAI's keep reading their older files until theirs is written", async () => {
    const { home, svc, srv } = await boot({ brains: (h) => brainProviders(h, { env: {}, fetch: noNetwork }) });
    const standing = (id: string) => svc.desk!.catalog().brains.find((b) => b.id === id);
    expect(standing("deepseek")?.ok).toBe(false);
    const key = madeUpKey("preset");
    const r = await send(srv.url, "/api/account/brain-key", { body: (await signedKey({ provider: "deepseek", key, model: "deepseek-flash" })).body });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toMatchObject({ ok: true, provider: "deepseek", standing: { ok: true } });
    expect(standing("deepseek")?.ok).toBe(true);
    expect(JSON.parse(readFileSync(keyFile(home, "deepseek"), "utf8"))).toEqual({ apiKey: key, model: "deepseek-flash" });
    // the owner's OpenAI key where it lived before the Brains place: it keeps working, and a key typed on the page then takes its place
    mkdirSync(join(home, "credentials", "openai"), { recursive: true });
    writeFileSync(join(home, "credentials", "openai", "api-key.json"), `${JSON.stringify({ apiKey: "sk-older-file-0000000000", baseUrl: "https://api.openai.com/v1", model: "gpt-6.1-sol" })}\n`, { mode: 0o600 });
    expect(standing("openai")?.ok).toBe(true);
    const typed = await send(srv.url, "/api/account/brain-key", { body: (await signedKey({ provider: "openai", key: madeUpKey("newer"), model: "gpt-6-luna" })).body });
    expect(JSON.parse(typed.text)).toMatchObject({ ok: true, standing: { ok: true, model: "gpt-6-luna" } });
    expect(JSON.parse(readFileSync(join(home, "credentials", "openai", "api-key.json"), "utf8")).apiKey).toBe("sk-older-file-0000000000");
  });

  it("OPENAI_API_KEY and ANTHROPIC_API_KEY in the environment still win over the files, and the answer says so", async () => {
    const env = { OPENAI_API_KEY: "sk-env-openai-00000000000", ANTHROPIC_API_KEY: "sk-ant-env-0000000000000000000" };
    const { home, srv } = await boot({ env, brains: (h) => brainProviders(h, { env, fetch: noNetwork }) });
    const o = JSON.parse((await send(srv.url, "/api/account/brain-key", { body: (await signedKey({ provider: "openai", key: madeUpKey("eo"), model: "gpt-6-luna" })).body })).text);
    expect(o).toMatchObject({ ok: true, envWins: "OPENAI_API_KEY" });
    const c = JSON.parse((await send(srv.url, "/api/account/brain-key", { body: (await signedKey({ provider: "claude", key: madeUpKey("ec") })).body })).text);
    expect(c).toMatchObject({ ok: true, envWins: "ANTHROPIC_API_KEY" });
    const d = JSON.parse((await send(srv.url, "/api/account/brain-key", { body: (await signedKey({ provider: "deepseek", key: madeUpKey("ed"), model: "deepseek-flash" })).body })).text);
    expect(d.ok).toBe(true);
    expect(d.envWins).toBeUndefined();
    expect(existsSync(keyFile(home, "openai")) && existsSync(keyFile(home, "claude"))).toBe(true);
  });
});

describe("POST /api/account/brain-test", () => {
  it("the owner's page asks the brain's own test; a program that is not the page, a brain the desk does not hold, a brain with no test are each said", async () => {
    let calls = 0;
    const test = async (model?: string): Promise<BrainTest> => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true, provider: "deepseek", words: `DeepSeek took the key${model ? ` · ${model} is listed` : ""}`, status: 200, models: ["deepseek-flash", "deepseek-v4-pro"] };
    };
    const { srv } = await boot({ brains: (h) => [scriptedBrain(() => null), fileBrain(h, "deepseek", "DeepSeek", { test }), fileBrain(h, "openai", "OpenAI")] });
    const page = { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty", origin: srv.url };
    // two asks at once are one call to the provider
    const [a, b] = await Promise.all([send(srv.url, "/api/account/brain-test", { body: JSON.stringify({ provider: "deepseek", model: "deepseek-flash" }), headers: page }), send(srv.url, "/api/account/brain-test", { body: JSON.stringify({ provider: "deepseek", model: "deepseek-flash" }), headers: page })]);
    expect(JSON.parse(a.text)).toMatchObject({ ok: true, provider: "deepseek", words: "DeepSeek took the key · deepseek-flash is listed" });
    expect(JSON.parse(b.text).ok).toBe(true);
    expect(calls).toBe(1);
    // a program that is not a browser (no Fetch Metadata, no Origin): refused; a browser that sends only its Origin (older Safari): taken
    expect((await send(srv.url, "/api/account/brain-test", { body: JSON.stringify({ provider: "deepseek" }) })).status).toBe(403);
    expect((await send(srv.url, "/api/account/brain-test", { body: JSON.stringify({ provider: "deepseek" }), headers: { origin: srv.url } })).status).toBe(200);
    expect(calls).toBe(2);
    expect((await send(srv.url, "/api/account/brain-test", { body: JSON.stringify({ provider: "nobody" }), headers: page })).status).toBe(404);
    expect((await send(srv.url, "/api/account/brain-test", { body: JSON.stringify({ provider: "../x" }), headers: page })).status).toBe(400);
    const none = JSON.parse((await send(srv.url, "/api/account/brain-test", { body: JSON.stringify({ provider: "openai" }), headers: page })).text);
    expect(none).toMatchObject({ ok: false, provider: "openai" });
    expect(none.words).toMatch(/^OpenAI has no/);
    expect(calls).toBe(2);
  });
});

// ---- round 2 of the review: a key in the wrong field, the desk told of a new key, the door's own fields, the clear's words --------------

/** made-up keys in the shapes the providers give (Groq gsk_…, DeepSeek/Kimi/Qwen sk-…, Gemini AIza…, Together's 64 hex): none is real */
const SHAPED = {
  groq: "gsk_QZJXWVKPRMTLHGFDa1b2c3d4e5f6g7h8i9j0QZJXWVKPRMTLzz",
  deepseek: "sk-TEST-deepseek-not-a-real-key-0",
  gemini: "AIzaSyQZJXWVKPRMTLHGFD_a1b2c3d4e5f6g7h8i",
  together: "c0ffee11d00dfeed22bead33cafe44f00d55beef66deaf77face88babe99ace0",
} as const;
/** the model ids the presets suggest and the long vendor/model names: none of them is a key, and none may be refused as one */
const REAL_MODELS = ["deepseek-flash", "deepseek-v4-pro", "gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna", "grok-4.20-0309-reasoning", "grok-4.7", "muse-spark-1.3", "muse-wonder-1.0", "kimi-k3", "kimi-k2.6", "qwen3.8-max", "meta/muse-spark-1.3", "openai/gpt-oss-120b", "deepseek-ai/DeepSeek-V4-Pro-0813", "gemini-3.8-flash", "qwen3:8b", "claude-opus-5-5"];

describe("a key in the wrong field: refused before anything is signed, staged, ledgered or sent — in words that never repeat it", () => {
  const ok: SetBrainKey = { type: "setBrainKey", provider: "deepseek", baseUrl: "", model: "deepseek-flash", keyHash: "a".repeat(64), salt: "b".repeat(32), nonce: 1 };

  it("a model shaped like a key, or a base URL whose path holds one: refused, the words fixed; every real model id and base URL passes", () => {
    for (const k of Object.values(SHAPED)) {
      expect(setBrainKeyProblem({ ...ok, model: k })).toBe(KEY_SHAPED_WORDS.model);
      expect(baseUrlProblem(`https://llm.example.com/${k}/v1`)).toBe(KEY_SHAPED_WORDS.baseUrl);
      expect(setBrainKeyProblem({ ...ok, provider: "custom", baseUrl: `https://llm.example.com/v1/${encodeURIComponent(k)}` })).toBe(KEY_SHAPED_WORDS.baseUrl);
      expect(setBrainKeyProblem({ ...ok, model: k, keyHash: "", salt: "" })).toBe(KEY_SHAPED_WORDS.model);
    }
    for (const m of REAL_MODELS) expect(setBrainKeyProblem({ ...ok, model: m })).toBeNull();
    for (const u of ["https://ws-8a7b.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", "https://generativelanguage.googleapis.com/v1beta/openai/", "https://openrouter.ai/api/v1", "http://localhost:11434/v1"]) expect(baseUrlProblem(u)).toBeNull();
    for (const w of Object.values(KEY_SHAPED_WORDS)) for (const k of Object.values(SHAPED)) expect(w).not.toContain(k.slice(4, 16));
  });

  it("the key typed in the key field and ALSO in the model or the base URL (or a piece of it): a fixed 400 before the door", () => {
    // a key no shape gives away (a local server's own, 16 characters): only being the key itself says it is one
    const key = "local-key-000111";
    const salt = newSalt();
    const a: SetBrainKey = { type: "setBrainKey", provider: "vllm", baseUrl: "http://localhost:8000/v1", model: "qwen3:8b", keyHash: keyHashOf(salt, key), salt, nonce: 1 };
    expect(checkBeforeDoor(a, key)).toBeNull();
    for (const wrong of [{ model: key }, { model: key.slice(0, 10) }, { baseUrl: `http://localhost:8000/${key}/v1` }, { baseUrl: `http://localhost:8000/v1/${key.slice(2, 12)}` }]) {
      const r = checkBeforeDoor({ ...a, ...wrong }, key);
      expect(r).toEqual({ status: 400, error: BODY_WORDS.keyInField });
      expect(keyInSignedFields({ ...a, ...wrong }, key)).toBe(true);
    }
    expect(BODY_WORDS.keyInField).not.toContain(key);
    // a model that only shares a short run with the key is no piece of it
    expect(keyInSignedFields({ model: "local", baseUrl: "" }, key)).toBe(false);
  });

  it("the desk's brain named with a key (setDesk hire, brain, objective, resume): refused; a seat's address or a plain name is not a brain and is not asked", () => {
    expect(deskBrainKeyProblem("brain", JSON.stringify({ provider: "deepseek", model: SHAPED.groq }))).toBe(KEY_SHAPED_WORDS.model);
    expect(deskBrainKeyProblem("hire", JSON.stringify({ name: "Desk", brain: { provider: "openai", model: SHAPED.deepseek } }))).toBe(KEY_SHAPED_WORDS.model);
    expect(deskBrainKeyProblem("objective", JSON.stringify({ text: "x", brain: { provider: SHAPED.gemini } }))).toMatch(/shaped like an API key/);
    expect(deskBrainKeyProblem("resume", JSON.stringify({ brain: { [SHAPED.together]: "x" } }))).toMatch(/shaped like an API key/);
    expect(deskBrainKeyProblem("brain", JSON.stringify({ provider: "deepseek", model: "deepseek-flash", effort: "high" }))).toBeNull();
    expect(deskBrainKeyProblem("seat", JSON.stringify({ role: "flow", address: `0x${"ab".repeat(20)}` }))).toBeNull();
    expect(deskBrainKeyProblem("hire", "not json")).toBeNull();
    for (const k of Object.values(SHAPED)) expect(String(deskBrainKeyProblem("brain", JSON.stringify({ model: k })))).not.toContain(k.slice(4, 16));
  });

  it("through the routes, with a desk hired: /prepare, the key's own route, the door and brain-test all refuse — and no made-up key reaches the ledger, room.jsonl, desk.json, an answer, the console, or a provider", async () => {
    let fetched = "";
    const spy = (async (url: unknown, init?: { body?: unknown; headers?: unknown }) => {
      fetched += `${String(url)} ${JSON.stringify(init ?? {})}\n`;
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const { home, srv } = await boot({ hire: true, brains: (h) => [scriptedBrain(() => null), ...brainProviders(h, { env: {}, fetch: spy })] });
    const page = { origin: srv.url, "sec-fetch-site": "same-origin" };
    const answers: string[] = [];
    const keyField = madeUpKey("field");
    const post = async (path: string, body: unknown, expected: number) => {
      const r = await send(srv.url, path, { body: JSON.stringify(body), headers: page });
      answers.push(r.text);
      expect(r.status, `${path} ${r.text}`).toBe(expected);
      return JSON.parse(r.text) as { error?: string; refusal?: { message: string } };
    };
    // the page prepares the signature: a key-shaped model or base-URL path is refused before the dialog shows it back
    for (const k of Object.values(SHAPED)) {
      expect((await post("/api/account/prepare", { draft: { type: "setBrainKey", provider: "deepseek", baseUrl: "", model: k, keyHash: "", salt: "" } }, 409)).refusal?.message).toBe(KEY_SHAPED_WORDS.model);
      expect((await post("/api/account/prepare", { draft: { type: "setBrainKey", provider: "custom", baseUrl: `https://llm.example.com/${k}/v1`, model: "", keyHash: "", salt: "" } }, 409)).refusal?.message).toBe(KEY_SHAPED_WORDS.baseUrl);
      expect((await post("/api/account/prepare", { draft: { type: "setDesk", desk: "desk", change: "brain", value: JSON.stringify({ provider: "deepseek", model: k, effort: "high" }) } }, 409)).refusal?.message).toBe(KEY_SHAPED_WORDS.model);
    }
    // the key's own route: another key left in the model field; the same key in the model; the key in the base URL's path
    const other = await signedKey({ provider: "deepseek", key: keyField, model: SHAPED.groq });
    expect((await post("/api/account/brain-key", JSON.parse(other.body), 400)).error).toBe(KEY_SHAPED_WORDS.model);
    const same = await signedKey({ provider: "deepseek", key: keyField, model: keyField });
    expect((await post("/api/account/brain-key", JSON.parse(same.body), 400)).error).toBe(BODY_WORDS.keyInField);
    const inPath = await signedKey({ provider: "custom", key: keyField, baseUrl: `https://llm.example.com/${keyField}/v1`, model: "m-1" });
    expect((await post("/api/account/brain-key", JSON.parse(inPath.body), 400)).error).toBe(BODY_WORDS.keyInField);
    // the same signatures sent straight to the door: refused before they are taken — the "taken" row would write the model down
    for (const k of Object.values(SHAPED)) {
      const { envelope } = await signedKey({ provider: "deepseek", key: madeUpKey("door"), model: k });
      expect((await post("/api/exchange", envelope, 409)).refusal?.message).toBe(KEY_SHAPED_WORDS.model);
      const desk = await signOwner(owner, { type: "setDesk", desk: "desk", change: "brain", value: JSON.stringify({ provider: "deepseek", model: k, effort: "high" }), nonce: nonce() });
      expect((await post("/api/exchange", desk, 409)).refusal?.message).toBe(KEY_SHAPED_WORDS.model);
      const hire = await signOwner(owner, { type: "setDesk", desk: "desk", change: "objective", value: JSON.stringify({ text: "Small entries", brain: { provider: "deepseek", model: k } }), nonce: nonce() });
      expect((await post("/api/exchange", hire, 409)).refusal?.message).toBe(KEY_SHAPED_WORDS.model);
      // "Test the key" with a key as the model: its words would name the model, and the model would be sent to the provider
      expect((await post("/api/account/brain-test", { provider: "deepseek", model: k }, 400)).error).toBe(KEY_SHAPED_WORDS.model);
    }
    // nothing was written, and no made-up key is anywhere
    expect(existsSync(keyFile(home, "deepseek"))).toBe(false);
    expect(existsSync(keyFile(home, "custom"))).toBe(false);
    const everywhere = [ledgerText(home), readFileSync(roomPath(home), "utf8"), readFileSync(deskPath(home), "utf8"), answers.join("\n"), console$(), fetched];
    for (const k of [...Object.values(SHAPED), keyField]) {
      for (const text of everywhere) {
        expect(text).not.toContain(k);
        expect(text).not.toContain(k.slice(4, 20));
      }
    }
    // the refusals are on the record, by their fixed words, with no envelope
    const refusals = ledgerRows(home).filter((x) => x.kind === "account-refusal" && (x.tool === "setBrainKey" || x.tool === "setDesk"));
    expect(refusals.length).toBeGreaterThanOrEqual(8);
    expect(refusals.every((x) => x.envelope === undefined)).toBe(true);
    // and the desk still thinks with the brain it was hired with
    expect(JSON.parse(readFileSync(deskPath(home), "utf8")).brain).toMatchObject({ provider: "scripted" });
  });
});

/** an endpoint that refuses every key: what a revoked or mistyped key gets (401, the OpenAI format's own words) */
const refusing = (async () => new Response(JSON.stringify({ error: { message: "Incorrect API key provided", type: "invalid_request_error" } }), { status: 401, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
/** the owner's OpenAI key where it lived before the Brains place */
function olderOpenaiFile(home: string): void {
  mkdirSync(join(home, "credentials", "openai"), { recursive: true });
  writeFileSync(join(home, "credentials", "openai", "api-key.json"), `${JSON.stringify({ apiKey: "sk-older-file-0000000000", baseUrl: "https://api.openai.com/v1", model: "gpt-6.1-sol" })}\n`, { mode: 0o600 });
}
const roomText = (home: string) => readFileSync(roomPath(home), "utf8");

describe("a key set or taken away: the desk is told, and the route's answer, the catalog and the feed say the same", () => {
  it("a key the provider refused, then a new one typed: ready at once in the answer, the catalog and the feed — no cycle between — the room says so by fingerprint; refused again, the fix names the file now in use", async () => {
    const { home, svc, srv } = await boot({
      hire: true,
      hireBrain: { provider: "openai", model: "gpt-6.1-sol" },
      brains: (h) => {
        olderOpenaiFile(h);
        return [scriptedBrain(() => null), ...brainProviders(h, { env: {}, fetch: refusing })];
      },
    });
    const desk = svc.desk!;
    const standing = () => desk.catalog().brains.find((b) => b.id === "openai")!;
    await desk.cycle("test");
    expect(standing()).toMatchObject({ ok: false, fix: { code: "rejected" } });
    expect(standing().fix!.file.endsWith("credentials/openai/api-key.json")).toBe(true);
    // the desk is paused: no call runs between the key and what the page reads
    await svc.exchange(await signOwner(owner, { type: "setDesk", desk: "desk", change: "pause", value: "", nonce: nonce() }));
    const key = madeUpKey("anew");
    const signed = await signedKey({ provider: "openai", key, model: "gpt-6.1-sol" });
    const r = await send(srv.url, "/api/account/brain-key", { body: signed.body });
    expect(r.status).toBe(200);
    const answer = JSON.parse(r.text);
    expect(answer.standing).toMatchObject({ ok: true });
    expect(answer.standing.fix).toBeUndefined();
    expect(standing()).toMatchObject({ ok: true });
    expect((await desk.feed(0))!.brain).toMatchObject({ ok: true });
    // the room says the key changed, by its fingerprint, never the key or its tail
    const fp = signed.action.keyHash.slice(0, 8);
    expect(roomText(home)).toContain(fp);
    expect(roomText(home)).not.toContain(key);
    expect(roomText(home)).not.toContain(key.slice(-4));
    // the endpoint refuses this key too: the fix now names the file the key is read from — the new one, not the older one
    await svc.exchange(await signOwner(owner, { type: "setDesk", desk: "desk", change: "resume", value: "", nonce: nonce() }));
    await desk.cycle("test");
    expect(standing()).toMatchObject({ ok: false, fix: { code: "rejected" } });
    expect(standing().fix!.file.endsWith("credentials/brains/openai.json")).toBe(true);
  });

  it("the review's own case, with Claude: refused on the older file, desk paused, a new key saved — no 'Saved' beside 'Key refused', and no fix naming the older file", async () => {
    // Anthropic's own answer to a key it does not take (the SDK's AuthenticationError), every time it is asked
    const refusingClaude = () => ({ messages: { parse: (async () => { throw new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "invalid x-api-key", new Headers()); }) as never } });
    const { home, svc, srv } = await boot({
      hire: true,
      hireBrain: { provider: "claude", model: "claude-opus-5-5" },
      brains: (h) => {
        mkdirSync(join(h, "credentials", "anthropic"), { recursive: true });
        writeFileSync(join(h, "credentials", "anthropic", "api-key.json"), `${JSON.stringify({ apiKey: "sk-ant-older-file-00000000000000000000" })}\n`, { mode: 0o600 });
        return [scriptedBrain(() => null), ...brainProviders(h, { env: {}, fetch: refusing, newClaudeClient: refusingClaude as never })];
      },
    });
    const desk = svc.desk!;
    const claude = () => desk.catalog().brains.find((b) => b.id === "claude")!;
    await desk.cycle("test");
    expect(claude()).toMatchObject({ ok: false, fix: { code: "rejected" } });
    expect(claude().fix!.file.endsWith("credentials/anthropic/api-key.json")).toBe(true);
    await svc.exchange(await signOwner(owner, { type: "setDesk", desk: "desk", change: "pause", value: "", nonce: nonce() }));
    const r = JSON.parse((await send(srv.url, "/api/account/brain-key", { body: (await signedKey({ provider: "claude", key: madeUpKey("claude") })).body })).text);
    expect(r).toMatchObject({ ok: true, provider: "claude", standing: { ok: true } });
    // the catalog, the feed (the Superagent header's Brain stat) and the answer: the same standing, and nothing names the older file
    expect(claude()).toMatchObject({ ok: true });
    const feed = (await desk.feed(0))!;
    expect(feed.brain).toMatchObject({ ok: true });
    expect(JSON.stringify([r.standing, claude(), feed.brain])).not.toContain("credentials/anthropic/api-key.json");
    expect(roomText(home)).not.toContain("QZJX");
  });

  it("a variable in the service's environment that wins over the file: the key in use did not change, so the refusal stands — and the answer says the same as the catalog", async () => {
    const env = { OPENAI_API_KEY: "sk-env-refused-000000000000" };
    const { home, svc, srv } = await boot({ env, hire: true, hireBrain: { provider: "openai", model: "gpt-6.1-sol" }, brains: (h) => [scriptedBrain(() => null), ...brainProviders(h, { env, fetch: refusing })] });
    const desk = svc.desk!;
    await desk.cycle("test");
    const before = desk.catalog().brains.find((b) => b.id === "openai")!;
    expect(before).toMatchObject({ ok: false, fix: { code: "rejected", restart: true } });
    const signed = await signedKey({ provider: "openai", key: madeUpKey("envwin"), model: "gpt-6.1-sol" });
    const answer = JSON.parse((await send(srv.url, "/api/account/brain-key", { body: signed.body })).text);
    expect(answer).toMatchObject({ ok: true, envWins: "OPENAI_API_KEY", standing: { ok: false, fix: { code: "rejected", restart: true } } });
    expect(desk.catalog().brains.find((b) => b.id === "openai")).toMatchObject({ ok: false, fix: { code: "rejected" } });
    // the room says the key was saved, by fingerprint, and that the variable's key is still the one in use
    const line = roomText(home).split("\n").filter(Boolean).map((l) => JSON.parse(l) as { text: string }).find((m) => m.text.includes(signed.action.keyHash.slice(0, 8)));
    expect(line?.text).toMatch(/OPENAI_API_KEY in the service's environment wins over the file/);
  });

  it("a clear that found no file says 'nothing to take away' — and, when the brain is still ready, that it reads the older file; a clear that removed one says so", async () => {
    const { home, svc, srv } = await boot({ hire: true, brains: (h) => [scriptedBrain(() => null), ...brainProviders(h, { env: {}, fetch: refusing })] });
    const clear = async (provider: string) => send(srv.url, "/api/account/brain-key", { body: JSON.stringify({ envelope: await signOwner(owner, { type: "setBrainKey", provider, baseUrl: "", model: "", keyHash: "", salt: "", nonce: nonce() }) }) });
    const lastDone = () => String(ledgerRows(home).filter((x) => x.tool === "setBrainKey" && x.outcome === "ok").at(-1)!.reason);
    // nothing there at all
    expect((await clear("deepseek")).status).toBe(200);
    expect(lastDone()).toBe("nothing to take away for DeepSeek: there was no credentials/brains/deepseek.json");
    // only the older OpenAI file: nothing removed, and the brain is still ready on that file
    olderOpenaiFile(home);
    const room0 = roomText(home);
    const r = JSON.parse((await clear("openai")).text);
    expect(r).toMatchObject({ ok: true, cleared: true, standing: { ok: true } });
    expect(lastDone()).toMatch(/^nothing to take away for OpenAI API: there was no credentials\/brains\/openai\.json; OpenAI API is still ready: it reads its key from the older file \(the key file credentials\/openai\/api-key\.json/);
    expect(lastDone()).not.toMatch(/taken away \(/);
    // nothing changed, so the desk was not told: the room has no new line about the key
    expect(roomText(home)).toBe(room0);
    // a typed key, then taken away: the file is removed, and the older one is read again
    expect((await send(srv.url, "/api/account/brain-key", { body: (await signedKey({ provider: "openai", key: madeUpKey("gone"), model: "gpt-6-luna" })).body })).status).toBe(200);
    expect((await clear("openai")).status).toBe(200);
    expect(lastDone()).toMatch(/^the OpenAI API key was taken away \(credentials\/brains\/openai\.json removed\); OpenAI API is still ready: it reads its key from the older file/);
    expect(svc.brainKeys.size).toBe(0);
  });
});

describe("the door keeps an envelope's own fields only, whatever instruction it carries (sign.ts ownEnvelope, exchange.ts take)", () => {
  it("a key beside an approveAgent envelope, inside its signature, or in its cosignatures: the agent is let in, and the key is nowhere in the ledger — after a restart too", async () => {
    const { home, svc } = await boot();
    const key = madeUpKey("beside");
    const env = await signOwner(owner, { type: "approveAgent", agentAddress: agent.address, agentName: "Helper", validUntil: Date.now() + 86_400_000, nonce: nonce() });
    const sent = { ...env, apiKey: key, signature: { ...env.signature, note: key }, cosignatures: [key, { r: "0x1", s: "0x2", v: 27, apiKey: key }] } as unknown as Envelope;
    const r = await svc.exchange(sent);
    expect(isRefusal(r)).toBe(false);
    expect(svc.account!.agentName(agent.address)).toBe("Helper");
    expect(ledgerText(home)).not.toContain(key);
    expect(ledgerText(home)).not.toContain("QZJX");
    // every row that carries the envelope carries its own fields alone
    for (const row of ledgerRows(home).filter((x) => x.tool === "approveAgent" && x.envelope)) {
      expect(Object.keys(row.envelope as object).sort()).toEqual(["action", "cosignatures", "nonce", "signature"]);
      expect(Object.keys((row.envelope as Envelope).signature).sort()).toEqual(["r", "s", "v"]);
    }
    // the account built again from its ledger knows the agent: the kept signature still checks out
    const later = await boot({ home });
    expect(later.svc.account!.agentName(agent.address)).toBe("Helper");
  });

  it("ownEnvelope: the four fields, each signature its own fields in their own types; a device's signature keeps its kid and es256", () => {
    const action = { type: "setDesk", desk: "desk", change: "pause", value: "", nonce: 1 } as const;
    expect(ownEnvelope({ action, nonce: 1, signature: { kid: "k1", es256: "AAA", extra: "x" }, more: 1 } as never)).toEqual({ action, nonce: 1, signature: { kid: "k1", es256: "AAA" } });
    expect(ownEnvelope({ action, nonce: 1, signature: { r: "0x1", s: "0x2", v: "sk-in-v" }, cosignatures: "sk-not-a-list" } as never)).toEqual({ action, nonce: 1, signature: { r: "0x1", s: "0x2" } });
  });

  it("a refusal row names the instruction's type only when it is one the account knows — never a value sent where a type goes", async () => {
    const { home, svc } = await boot();
    const key = madeUpKey("type");
    await svc.exchange({ action: { type: key }, nonce: 1, signature: { r: "0x1", s: "0x2", v: 27 } } as unknown as Envelope);
    expect(ledgerText(home)).not.toContain("QZJX");
  });
});

describe("Test the key: one test in flight per provider AND model", () => {
  it("two asks for the same model are one call; an ask for another model is its own, with its own words", async () => {
    let calls = 0;
    const test = async (model?: string): Promise<BrainTest> => {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true, provider: "deepseek", words: `DeepSeek took the key${model ? ` · ${model} is listed` : ""}`, status: 200 };
    };
    const { srv } = await boot({ brains: (h) => [scriptedBrain(() => null), fileBrain(h, "deepseek", "DeepSeek", { test })] });
    const page = { "sec-fetch-site": "same-origin", origin: srv.url };
    const ask = (model: string) => send(srv.url, "/api/account/brain-test", { body: JSON.stringify({ provider: "deepseek", model }), headers: page });
    const [a, b, c] = await Promise.all([ask("deepseek-flash"), ask("deepseek-v4-pro"), ask("deepseek-flash")]);
    expect(JSON.parse(a.text).words).toBe("DeepSeek took the key · deepseek-flash is listed");
    expect(JSON.parse(b.text).words).toBe("DeepSeek took the key · deepseek-v4-pro is listed");
    expect(JSON.parse(c.text).words).toBe("DeepSeek took the key · deepseek-flash is listed");
    expect(calls).toBe(2);
  });
});

describe("the server's JSON parser inflates nothing", () => {
  it("a body declared gzip that is not: one fixed sentence, nothing on the console — no zlib error page, no stack", async () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    let srv: PortfolioServerHandle;
    try {
      ({ srv } = await boot());
    } finally {
      process.env.NODE_ENV = env;
    }
    const key = madeUpKey("gzip");
    for (const path of ["/api/exchange", "/api/account/prepare"]) {
      const r = await send(srv.url, path, { body: JSON.stringify({ envelope: {}, apiKey: key }), headers: { "content-encoding": "gzip" } });
      expect(r.status).toBe(415);
      expect(JSON.parse(r.text)).toEqual({ ok: false, error: "The body of this request could not be read as JSON; it was not kept." });
      expect(r.text).not.toContain(key);
    }
    expect(console$()).not.toMatch(/incorrect header check|zlib|Error:/);
    expect(console$()).not.toContain("QZJX");
  });
});

// ---- round 3 of the review: a key in a base URL's HOST, Cloudflare's account id in a path, the desk's own words, a brain that is not
// one object, a key sent as a field's name, and a local server's settings saved with no key ---------------------------------------------

/** a made-up 32-hex id in the shape of a Cloudflare account id: an id, not a key */
const CF_ID = "5f0c3a9d2b7e4c1a8f6d0e3b9a2c7d41";
/** Cloudflare's OpenAI-compatible bases: Workers AI, and AI Gateway's OpenAI and compat routes — the account id in the path */
const CLOUDFLARE = [`https://api.cloudflare.com/client/v4/accounts/${CF_ID}/ai/v1`, `https://gateway.ai.cloudflare.com/v1/${CF_ID}/my-gateway/openai`, `https://gateway.ai.cloudflare.com/v1/${CF_ID}/my-gateway/compat`];
/** Qwen's own how-to puts the workspace id in the HOST: a key pasted there instead */
const KEY_IN_HOST = `https://${SHAPED.deepseek}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`;
const WORKSPACE = "https://ws-1a2b3c4d5e6f.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";

describe("a base URL's host is read as typed, and an account's id in its path is not a key", () => {
  const ok: SetBrainKey = { type: "setBrainKey", provider: "qwen", baseUrl: "", model: "qwen3.8-max", keyHash: "a".repeat(64), salt: "b".repeat(32), nonce: 1 };

  it("a key in the host — any provider's shape, with a port, a name, plain http, or mixed case that URL would lower — is refused in fixed words; a workspace id passes", () => {
    expect(baseUrlProblem(KEY_IN_HOST)).toBe(KEY_SHAPED_WORDS.baseHost);
    expect(setBrainKeyProblem({ ...ok, baseUrl: KEY_IN_HOST })).toBe(KEY_SHAPED_WORDS.baseHost);
    for (const k of Object.values(SHAPED)) {
      expect(baseUrlProblem(`https://${k}.example.com/v1`), k).toBe(KEY_SHAPED_WORDS.baseHost);
      expect(baseUrlProblem(`https://${k}.example.com:8443/v1`), k).toBe(KEY_SHAPED_WORDS.baseHost);
      expect(baseUrlProblem(`http://${k}.example.com/v1`), k).toBe(KEY_SHAPED_WORDS.baseHost);
    }
    // a run that reads as random only in its own case (URL would lower it to "abcdefghijklmn12-…", which reads as words)
    expect(baseUrlProblem("https://AbCdEfGhIjKlMn12-shared-gateway-x.example.com/v1")).toBe(KEY_SHAPED_WORDS.baseHost);
    expect(baseUrlProblem(WORKSPACE)).toBeNull();
    expect(setBrainKeyProblem({ ...ok, baseUrl: WORKSPACE })).toBeNull();
    for (const k of Object.values(SHAPED)) expect(KEY_SHAPED_WORDS.baseHost).not.toContain(k.slice(4, 16));
    // the key typed in the key field, a piece of it in a host's label: the fixed sentence before the door
    const key = "local-key-000111";
    const salt = newSalt();
    expect(checkBeforeDoor({ ...ok, provider: "custom", baseUrl: `https://${key.slice(0, 12)}.example.com/v1`, keyHash: keyHashOf(salt, key), salt }, key)).toEqual({ status: 400, error: BODY_WORDS.keyInField });
  });

  it("Cloudflare's account id in the path passes everywhere the base URL is checked; a key in a path is still refused, and so is the typed key however it looks", () => {
    for (const u of CLOUDFLARE) {
      expect(baseUrlProblem(u), u).toBeNull();
      expect(setBrainKeyProblem({ ...ok, provider: "custom", baseUrl: u }), u).toBeNull();
    }
    // a hex run of 64 (Together's), a prefixed key, an id with a key's prefix glued on, a 32-hex id in a HOST: still keys
    for (const u of [`https://llm.example.com/v1/${SHAPED.together}`, `https://x.example.com/v1/${SHAPED.together}`, `https://llm.example.com/v1/${SHAPED.groq}`, `https://llm.example.com/v1/${SHAPED.deepseek}`, `https://llm.example.com/v1/fw_${CF_ID}`]) expect(baseUrlProblem(u), u).toBe(KEY_SHAPED_WORDS.baseUrl);
    expect(baseUrlProblem(`https://${CF_ID}.example.com/v1`)).toBe(KEY_SHAPED_WORDS.baseHost);
    // a key that is 32 hex and nothing else, typed in the key field AND in the path: the typed key is what gives it away
    const salt = newSalt();
    const hexKey = "9a8b7c6d5e4f30211203f4e5d6c7b8a9";
    expect(checkBeforeDoor({ ...ok, provider: "custom", baseUrl: `https://llm.example.com/v1/${hexKey}`, keyHash: keyHashOf(salt, hexKey), salt }, hexKey)).toEqual({ status: 400, error: BODY_WORDS.keyInField });
  });

  it("through the routes: /prepare, the key's own route and the door refuse a key in the host before anything is written — the ledger, the catalog and every answer hold no part of it; a workspace id and Cloudflare's base are taken", async () => {
    let fetched = "";
    const spy = (async (url: unknown, init?: unknown) => {
      fetched += `${String(url)} ${JSON.stringify(init ?? {})}\n`;
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const { home, srv } = await boot({ hire: true, brains: (h) => [scriptedBrain(() => null), ...brainProviders(h, { env: {}, fetch: spy })] });
    const page = { origin: srv.url, "sec-fetch-site": "same-origin" };
    const answers: string[] = [];
    const post = async (path: string, body: unknown, expected: number) => {
      const r = await send(srv.url, path, { body: JSON.stringify(body), headers: page });
      answers.push(r.text);
      expect(r.status, `${path} ${r.text}`).toBe(expected);
      return JSON.parse(r.text) as { error?: string; refusal?: { message: string }; ok?: boolean };
    };
    const keyField = madeUpKey("host");
    expect((await post("/api/account/prepare", { draft: { type: "setBrainKey", provider: "qwen", baseUrl: KEY_IN_HOST, model: "qwen3.8-max", keyHash: "", salt: "" } }, 409)).refusal?.message).toBe(KEY_SHAPED_WORDS.baseHost);
    const inHost = await signedKey({ provider: "qwen", key: keyField, baseUrl: KEY_IN_HOST, model: "qwen3.8-max" });
    expect((await post("/api/account/brain-key", JSON.parse(inHost.body), 400)).error).toBe(KEY_SHAPED_WORDS.baseHost);
    const atDoor = await signedKey({ provider: "qwen", key: keyField, baseUrl: KEY_IN_HOST, model: "qwen3.8-max" });
    expect((await post("/api/exchange", atDoor.envelope, 409)).refusal?.message).toBe(KEY_SHAPED_WORDS.baseHost);
    expect(existsSync(keyFile(home, "qwen"))).toBe(false);
    // a workspace's own host, and Cloudflare's base with the account id in its path: taken, and written
    const ws = await signedKey({ provider: "qwen", key: keyField, baseUrl: WORKSPACE, model: "qwen3.8-max" });
    expect((await post("/api/account/brain-key", JSON.parse(ws.body), 200)).ok).toBe(true);
    expect(JSON.parse(readFileSync(keyFile(home, "qwen"), "utf8"))).toEqual({ apiKey: keyField, baseUrl: WORKSPACE, model: "qwen3.8-max" });
    for (const u of CLOUDFLARE) expect((await post("/api/account/prepare", { draft: { type: "setBrainKey", provider: "custom", baseUrl: u, model: "", keyHash: "", salt: "" } }, 200)).ok).toBe(true);
    const cf = await signedKey({ provider: "custom", key: madeUpKey("cfkey"), baseUrl: CLOUDFLARE[1]!, model: "openai/gpt-6-luna" });
    expect((await post("/api/account/brain-key", JSON.parse(cf.body), 200)).ok).toBe(true);
    expect(JSON.parse(readFileSync(keyFile(home, "custom"), "utf8")).baseUrl).toBe(CLOUDFLARE[1]);
    const catalog = await send(srv.url, "/api/account/desk/catalog", { method: "GET", headers: page });
    answers.push(catalog.text);
    expect(JSON.parse(catalog.text).brains.find((b: { id: string }) => b.id === "custom")).toMatchObject({ ok: true, baseUrl: CLOUDFLARE[1] });
    const k = SHAPED.deepseek;
    for (const text of [ledgerText(home), readFileSync(roomPath(home), "utf8"), readFileSync(deskPath(home), "utf8"), answers.join("\n"), console$(), fetched]) {
      expect(text).not.toContain(k);
      expect(text).not.toContain(k.slice(3, 20));
      expect(text).not.toContain(keyField);
    }
  });
});

describe("the desk's settings at the door: a brain that is not one object, a key nested anywhere in it, a key in the desk's own words", () => {
  it("deskBrainKeyProblem: a brain sent as a list, a string or null, a key nested in it or as a field's name, a key in a name, an objective or a charter — refused in fixed words; a 0x address and a transaction hash are words", () => {
    for (const value of [JSON.stringify([SHAPED.groq]), JSON.stringify(SHAPED.groq), "null", "42"]) expect(deskBrainKeyProblem("brain", value), value).toBe(DESK_KEY_WORDS.brainShape);
    for (const change of ["hire", "objective", "resume"]) expect(deskBrainKeyProblem(change, JSON.stringify({ brain: [SHAPED.groq] }))).toBe(DESK_KEY_WORDS.brainShape);
    expect(deskBrainKeyProblem("brain", JSON.stringify({ provider: "deepseek", model: "deepseek-flash", extra: { k: SHAPED.groq } }))).toBe(DESK_KEY_WORDS.brain);
    expect(deskBrainKeyProblem("brain", JSON.stringify({ provider: "deepseek", model: "deepseek-flash", price: { inUsd: 1, outUsd: 2, note: [SHAPED.together] } }))).toBe(DESK_KEY_WORDS.brain);
    expect(deskBrainKeyProblem("hire", JSON.stringify({ brain: { provider: "deepseek", nested: { [SHAPED.gemini]: 1 } } }))).toBe(DESK_KEY_WORDS.brain);
    const OPENROUTER = `sk-or-v1-${"0a1b2c3d4e5f6a7b".repeat(4)}`;
    for (const k of [SHAPED.groq, OPENROUTER, SHAPED.gemini, SHAPED.deepseek]) {
      expect(deskBrainKeyProblem("objective", JSON.stringify({ text: `watch this ${k}`, venue: "ex" })), k).toBe(DESK_KEY_WORDS.text);
      expect(deskBrainKeyProblem("hire", JSON.stringify({ name: `Desk ${k}`, objective: { text: "Small entries", venue: "ex" }, roles: [{ role: "head", kind: "house" }] })), k).toBe(DESK_KEY_WORDS.text);
      expect(deskBrainKeyProblem("hire", JSON.stringify({ objective: { text: `Small entries ${k}` }, roles: [{ role: "head", kind: "house" }] })), k).toBe(DESK_KEY_WORDS.text);
      expect(deskBrainKeyProblem("charter", JSON.stringify({ role: "risk", owns: "sizing", good: `use ${k}`, never: "x" })), k).toBe(DESK_KEY_WORDS.text);
      expect(deskBrainKeyProblem("seat", JSON.stringify({ role: "flow", kind: "outside", address: `0x${"ab".repeat(20)}`, name: k })), k).toBe(DESK_KEY_WORDS.text);
      expect(deskBrainKeyProblem("hire", JSON.stringify({ roles: [{ role: "head", kind: "house", charter: { owns: k } }] })), k).toBe(DESK_KEY_WORDS.text);
    }
    // a value that is not JSON and is a key: refused here (the desk would refuse it anyway, after the ledger wrote it down)
    expect(deskBrainKeyProblem("objective", SHAPED.groq)).toBe(DESK_KEY_WORDS.notJson);
    expect(deskBrainKeyProblem("hire", "not json")).toBeNull();
    // the desk's words may name an address and a transaction: hex, and taken
    expect(deskBrainKeyProblem("objective", JSON.stringify({ text: `follow 0x${"ab".repeat(20)} and tx 0x${"cd".repeat(32)}`, venue: "ex" }))).toBeNull();
    expect(deskBrainKeyProblem("seat", JSON.stringify({ role: "flow", kind: "outside", address: `0x${"ab".repeat(20)}`, name: "Flow" }))).toBeNull();
    expect(deskBrainKeyProblem("brain", JSON.stringify({ provider: "deepseek", model: "deepseek-flash", effort: "high", price: null }))).toBeNull();
    expect(deskBrainKeyProblem("brain", "")).toBeNull();
    for (const w of Object.values(DESK_KEY_WORDS)) for (const k of Object.values(SHAPED)) expect(w).not.toContain(k.slice(4, 16));
  });

  it("through /prepare and the door, with a desk hired: each is refused before it is taken, and the ledger, the room and desk.json hold no part of any key; an objective naming an address is taken", async () => {
    const { home, srv, own } = await boot({ hire: true });
    const page = { origin: srv.url, "sec-fetch-site": "same-origin" };
    const answers: string[] = [];
    const sent = [
      { change: "brain", value: JSON.stringify([SHAPED.groq]), words: DESK_KEY_WORDS.brainShape },
      { change: "brain", value: JSON.stringify(SHAPED.groq), words: DESK_KEY_WORDS.brainShape },
      { change: "brain", value: JSON.stringify({ provider: "scripted", model: "scripted", extra: { k: SHAPED.groq } }), words: DESK_KEY_WORDS.brain },
      { change: "objective", value: JSON.stringify({ text: `watch this ${SHAPED.groq}`, venue: "ex" }), words: DESK_KEY_WORDS.text },
      { change: "objective", value: JSON.stringify({ text: `watch this ${SHAPED.gemini}`, venue: "ex" }), words: DESK_KEY_WORDS.text },
      { change: "charter", value: JSON.stringify({ role: "risk", good: `keys like ${SHAPED.deepseek}` }), words: DESK_KEY_WORDS.text },
    ];
    for (const s of sent) {
      const prep = await send(srv.url, "/api/account/prepare", { body: JSON.stringify({ draft: { type: "setDesk", desk: "desk", change: s.change, value: s.value } }), headers: page });
      answers.push(prep.text);
      expect(prep.status, prep.text).toBe(409);
      expect(JSON.parse(prep.text).refusal.message).toBe(s.words);
      const r = await own({ type: "setDesk", desk: "desk", change: s.change, value: s.value });
      answers.push(JSON.stringify(r));
      expect(isRefusal(r) ? r.message : "taken").toBe(s.words);
    }
    const address = `0x${"ab".repeat(20)}`;
    expect(isRefusal(await own({ type: "setDesk", desk: "desk", change: "objective", value: JSON.stringify({ text: `Follow ${address} on majors`, venue: "ex" }) }))).toBe(false);
    expect(JSON.parse(readFileSync(deskPath(home), "utf8")).objective.text).toBe(`Follow ${address} on majors`);
    for (const text of [ledgerText(home), readFileSync(roomPath(home), "utf8"), readFileSync(deskPath(home), "utf8"), answers.join("\n"), console$()]) {
      for (const k of Object.values(SHAPED)) {
        expect(text).not.toContain(k);
        expect(text).not.toContain(k.slice(4, 20));
      }
    }
  });
});

describe("a field no signature covers is named only when its name is plain and not a key (sign.ts malformed)", () => {
  it("an owner's action and an agent's: a plain name is said, a key sent as a field's name is 'a field it was sent'", () => {
    expect(malformed({ type: "setWatch", venue: "ex", symbol: "BTC/USDT", on: "1", extra: 1, nonce: 1 } as never)).toBe('"extra" is not part of what "setWatch" signs');
    expect(malformed({ type: "setWatch", venue: "ex", symbol: "BTC/USDT", on: "1", [SHAPED.groq]: 1, nonce: 1 } as never)).toBe('a field it was sent is not part of what "setWatch" signs');
    expect(malformed({ type: "setWatch", venue: "ex", symbol: "BTC/USDT", on: "1", 'say "hi" there': 1, nonce: 1 } as never)).toBe('a field it was sent is not part of what "setWatch" signs');
    expect(malformed({ type: "agentReport", intent: "i", status: "s", note: "n", refs: "", extra: 1, nonce: 1 } as never)).toBe('"extra" is not part of "agentReport"');
    expect(malformed({ type: "agentReport", intent: "i", status: "s", note: "n", refs: "", [SHAPED.gemini]: 1, nonce: 1 } as never)).toBe('a field it was sent is not part of "agentReport"');
  });

  it("at /prepare and the door: refused, and neither the answer nor the ledger holds the name", async () => {
    const { home, srv, svc } = await boot();
    const page = { origin: srv.url, "sec-fetch-site": "same-origin" };
    const prep = await send(srv.url, "/api/account/prepare", { body: JSON.stringify({ draft: { type: "setWatch", venue: "ex", symbol: "BTC/USDT", on: "1", [SHAPED.groq]: 1 } }), headers: page });
    expect(prep.status).toBe(409);
    expect(prep.text).not.toContain(SHAPED.groq.slice(4, 20));
    const env = await signOwner(owner, { type: "setWatch", venue: "ex", symbol: "BTC/USDT", on: "1", nonce: nonce() });
    const r = await svc.exchange({ ...env, action: { ...env.action, [SHAPED.groq]: 1 } } as unknown as Envelope);
    expect(isRefusal(r) ? r.message : "taken").toBe('a field it was sent is not part of what "setWatch" signs');
    const agentEnv = await signAgent(agent, { type: "agentReport", intent: "i", status: "s", note: "n", refs: "", nonce: nonce() });
    await svc.exchange({ ...agentEnv, action: { ...agentEnv.action, [SHAPED.gemini]: 1 } } as unknown as Envelope);
    for (const k of [SHAPED.groq, SHAPED.gemini]) {
      expect(ledgerText(home)).not.toContain(k.slice(4, 20));
      expect(console$()).not.toContain(k.slice(4, 20));
    }
  });
});

describe("a server on this machine: its address and model saved with no key — no key ever made up for it", () => {
  it("keyHash \"\" beside a base URL or a model writes Ollama's file with no key (0600, atomically), answered {keyless: true}, ready, the room says it; both empty removes it; a provider that needs a key is never written without one", async () => {
    const { home, srv } = await boot({ hire: true, brains: (h) => [scriptedBrain(() => null), ...brainProviders(h, { env: {}, fetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch })] });
    const page = { origin: srv.url, "sec-fetch-site": "same-origin" };
    const keyless = async (provider: string, baseUrl: string, model: string) => {
      const envelope = await signOwner(owner, { type: "setBrainKey", provider, baseUrl, model, keyHash: "", salt: "", nonce: nonce() });
      const r = await send(srv.url, "/api/account/brain-key", { body: JSON.stringify({ envelope }), headers: page });
      return { status: r.status, body: JSON.parse(r.text) as Record<string, unknown> };
    };
    const saved = await keyless("ollama", "http://127.0.0.1:11434/v1", "qwen3:8b");
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ ok: true, provider: "ollama", keyless: true, standing: { ok: true, model: "qwen3:8b" } });
    expect(saved.body.cleared).toBeUndefined();
    expect(saved.body.fingerprint).toBeUndefined();
    expect(JSON.parse(readFileSync(keyFile(home, "ollama"), "utf8"))).toEqual({ baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b" });
    expect(mode(keyFile(home, "ollama"))).toBe("600");
    expect(readFileSync(roomPath(home), "utf8")).toContain("You saved Ollama");
    expect(readFileSync(roomPath(home), "utf8")).toContain("address and model, with no key");
    expect(ledgerRows(home).some((x) => x.tool === "setBrainKey" && x.outcome === "ok" && String(x.reason).includes("saved with no key"))).toBe(true);
    // a key the old file held goes with it: the file is replaced whole
    writeFileSync(keyFile(home, "vllm"), `${JSON.stringify({ apiKey: "vllm-own-key-000", baseUrl: "http://localhost:8000/v1" })}\n`, { mode: 0o600 });
    expect((await keyless("vllm", "", "qwen3:8b")).body).toMatchObject({ ok: true, keyless: true });
    expect(JSON.parse(readFileSync(keyFile(home, "vllm"), "utf8"))).toEqual({ model: "qwen3:8b" });
    // both empty: taken away, as for any provider
    expect((await keyless("ollama", "", "")).body).toMatchObject({ ok: true, cleared: true });
    expect(existsSync(keyFile(home, "ollama"))).toBe(false);
    // DeepSeek needs a key: a base URL and a model beside keyHash "" are not saved without it — the file is not written
    expect((await keyless("deepseek", "https://api.deepseek.com", "deepseek-flash")).body).toMatchObject({ ok: true, cleared: true });
    expect(existsSync(keyFile(home, "deepseek"))).toBe(false);
  });
});
