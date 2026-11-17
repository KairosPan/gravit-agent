/** ATTEST (account/attest.ts, account/sign.ts attest): the account vouching that a device of its owner signed a sentence. The door bounds
 * its four fields before its "taken" row, takes it only signed and only within ATTEST_TTL_MS, takes the same envelope once (a repeat is refused
 * as a used nonce is, never answered from the first answer's cache), and changes nothing but its ledger; a restart replays it as nothing. Nothing leaves the process. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { LedgerRow } from "../../src/agent/ledger.ts";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { ATTEST_TTL_MS, attestProblem, attestSentence } from "../../src/portfolio/account/attest.ts";
import { MEMORY_TYPES, MONEY_TYPES, ownerTypedData, PAPER_TYPES, signDevice, simKey, STEER_TYPES, type Envelope, type OwnerAction, type SimKey } from "../../src/portfolio/account/sign.ts";
import type { LiveDeps } from "../../src/portfolio/live/index.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

type Attest = Extract<OwnerAction, { type: "attest" }>;
const START = Date.parse("2026-11-16T15:00:00.000Z");
const HOUR = 3_600_000;
const CODE = "K7QX-M2PA";
const DIGEST = "0123456789abcdef".repeat(4);
const GOOD = { type: "attest", service: "gravit-memory", act: "arm", subject: "no-chasing", digest: DIGEST } as const;
const SENTENCE = "the owner attested arm no-chasing for gravit-memory";
const WORDS = {
  service: "attest names a service of 2 to 40 lower-case letters, digits or dashes",
  act: "attest names an act of 2 to 24 lower-case letters or dashes",
  subject: "attest names a subject of 1 to 80 letters, digits or . _ : -",
  digest: "attest carries a digest of 64 lower-case hex digits",
} as const;

const homes: string[] = [];
afterAll(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })));
afterEach(() => vi.restoreAllMocks());

const fresh = () => {
  const h = mkdtempSync(join(tmpdir(), "account-attest-"));
  homes.push(h);
  return h;
};

/** one run of a real account on `home`, `at` ms after the start, with what its browser signs */
async function run(home: string, at = 0) {
  let n = 0;
  const liveDeps: Partial<LiveDeps> = { clock: () => START + at, http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined };
  const svc = await PortfolioService.create({ home, now: () => new Date(START + at).toISOString(), venues: "frontline", real: true, liveDeps, liveWrites: { capUsd: 100, pairingCode: CODE } });
  await svc.restoring;
  const engine = svc.account!;
  const nonce = () => START + at + ++n;
  const envelope = (device: SimKey, fields: Record<string, unknown>, at_ = nonce()): Envelope => {
    const action = { ...fields, nonce: at_ } as unknown as OwnerAction;
    return { action, nonce: action.nonce, signature: signDevice(device, action) };
  };
  const rows = (): readonly LedgerRow[] => svc.ledgerRows();
  return { svc, engine, envelope, nonce, rows };
}

/** a run with one paired device: the owner's browser */
async function paired(home = fresh(), at = 0) {
  const x = await run(home, at);
  const device = simKey("device:attest-owner");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  expect(x.engine.pairDevice(device.jwk, "this browser", CODE)).toMatchObject({ role: "owner" });
  return { ...x, device };
}

const refusal = (o: unknown): Refusal => {
  if (!isRefusal(o)) throw new Error(`expected a refusal, got ${JSON.stringify(o).slice(0, 200)}`);
  return o;
};
const takenRows = (rows: readonly LedgerRow[]) => rows.filter((r) => r.kind === "action" && r.outcome === "taken");

describe("attest: the owner's device signs a sentence, and the account keeps the row and changes nothing else", () => {
  it("the bounds and the sentence, as functions", () => {
    expect(attestProblem(GOOD)).toBeUndefined();
    expect(attestSentence(GOOD)).toBe(SENTENCE);
    expect(ATTEST_TTL_MS).toBe(600_000);
  });

  it("a good attest is taken: the sentence as the answer, a taken row and an ok row, and the account's page as it was", async () => {
    const x = await paired();
    const before = await x.svc.accountView();
    const count = x.rows().length;
    const env = x.envelope(x.device, GOOD);
    expect(await x.svc.exchange(env)).toEqual({ ok: true, kind: "account", summary: SENTENCE });
    const added = x.rows().slice(count);
    expect(added).toHaveLength(2);
    const [taken, done] = added;
    expect(taken).toMatchObject({ kind: "action", venue: "*", tool: "attest", signer: `device:${x.device.kid}`, outcome: "taken", reason: "attest taken: it is not taken again, by this run of the account or a later one" });
    expect(done).toMatchObject({ kind: "action", venue: "*", tool: "attest", signer: `device:${x.device.kid}`, outcome: "ok", reason: SENTENCE });
    // both rows hold the envelope, as the account keeps it: the action, its nonce and the device's signature
    for (const row of [taken!, done!]) expect(row.envelope).toEqual({ action: env.action, nonce: env.nonce, signature: env.signature });
    // nothing but the ledger: the page is the same, on a clock that does not move
    expect(await x.svc.accountView()).toEqual(before);
  });

  it("each field off its bound is refused with its sentence before any row says it was taken; the same nonce with good fields is then taken", async () => {
    const x = await paired();
    const at = x.nonce();
    const off: Array<[keyof typeof WORDS, string]> = [
      ["service", "Gravit-memory"],
      ["service", "g"],
      ["service", "a".repeat(41)],
      ["act", "arm2"],
      ["act", "a".repeat(25)],
      ["subject", "no chasing"],
      ["subject", "no\nchasing"],
      ["subject", "a".repeat(81)],
      ["digest", DIGEST.slice(1)],
      ["digest", `A${DIGEST.slice(1)}`],
      ["digest", `g${DIGEST.slice(1)}`],
    ];
    const taken = takenRows(x.rows()).length;
    for (const [field, value] of off) {
      const r = refusal(await x.svc.exchange(x.envelope(x.device, { ...GOOD, [field]: value }, at)));
      expect([field, r.code, r.message]).toEqual([field, "E_ACCOUNT_BAD_ACTION", WORDS[field]]);
      expect(attestProblem({ ...GOOD, [field]: value })).toBe(WORDS[field]);
    }
    expect(takenRows(x.rows()).length).toBe(taken);
    // and at the edges of each bound, in: two characters, forty, twenty-four, one, eighty
    for (const edge of [{ service: "ab" }, { service: `a${"-".repeat(39)}` }, { act: `a${"-".repeat(23)}` }, { subject: "a" }, { subject: `A${"._:-9".repeat(15)}${"z".repeat(4)}` }]) expect(attestProblem({ ...GOOD, ...edge })).toBeUndefined();
    expect(await x.svc.exchange(x.envelope(x.device, GOOD, at))).toEqual({ ok: true, kind: "account", summary: SENTENCE });
    expect(takenRows(x.rows()).length).toBe(taken + 1);
  });

  it("a field that is not text, and a field attest does not sign, are refused as malformed", async () => {
    const x = await paired();
    expect(refusal(await x.svc.exchange(x.envelope(x.device, { ...GOOD, digest: 5 })))).toMatchObject({ code: "E_ACCOUNT_BAD_ACTION", message: '"digest" is text' });
    expect(refusal(await x.svc.exchange(x.envelope(x.device, { ...GOOD, extra: "x" })))).toMatchObject({ code: "E_ACCOUNT_BAD_ACTION", message: '"extra" is not part of what "attest" signs' });
    expect(takenRows(x.rows())).toHaveLength(0);
  });

  it("the unsigned door refuses it with the signed sentence, and writes no action", async () => {
    const x = await paired();
    const actions = x.rows().filter((r) => r.kind === "action").length;
    expect(refusal(await x.svc.act(GOOD))).toMatchObject({ code: "E_ACCOUNT_BAD_ACTION", message: '"attest" is signed: only a browser that signs for the account takes it' });
    expect(x.rows().filter((r) => r.kind === "action").length).toBe(actions);
  });

  it("signed by a key the account does not know: a bad signature", async () => {
    const x = await paired();
    const stranger = simKey("device:attest-stranger");
    expect(refusal(await x.svc.exchange(x.envelope(stranger, GOOD))).code).toBe("E_ACCOUNT_BAD_SIGNATURE");
    expect(takenRows(x.rows())).toHaveLength(0);
  });

  it("an attest signed more than ATTEST_TTL_MS ago is refused; one signed a second inside it is taken", async () => {
    const x = await paired();
    expect(refusal(await x.svc.exchange(x.envelope(x.device, GOOD, START - ATTEST_TTL_MS - 1))).code).toBe("E_ACCOUNT_EXPIRED");
    expect(takenRows(x.rows())).toHaveLength(0);
    expect(await x.svc.exchange(x.envelope(x.device, GOOD, START - ATTEST_TTL_MS + 1000))).toEqual({ ok: true, kind: "account", summary: SENTENCE });
  });

  it("the same envelope a second time: refused as a used nonce is, never the first answer again, and no taken or ok row added", async () => {
    const x = await paired();
    const env = x.envelope(x.device, GOOD);
    expect(await x.svc.exchange(env)).toEqual({ ok: true, kind: "account", summary: SENTENCE });
    const count = x.rows().length;
    const again = refusal(await x.svc.exchange(env));
    expect([again.code, again.message]).toEqual(["E_ACCOUNT_NONCE", "this nonce was used before"]);
    const added = x.rows().slice(count);
    expect(added.filter((r) => r.kind === "action")).toHaveLength(0);
    expect(added.every((r) => r.kind === "account-refusal")).toBe(true);
    // a third time, the same
    expect(refusal(await x.svc.exchange(env)).code).toBe("E_ACCOUNT_NONCE");
  });

  it("another owner type keeps its cached first answer for the same envelope", async () => {
    const x = await paired();
    const env = x.envelope(x.device, { type: "setWatch", venue: "frontline", symbol: "BTC", on: "on" });
    const first = await x.svc.exchange(env);
    expect(await x.svc.exchange(env)).toEqual(first);
  });

  it("the same envelope after a restart on the same home, inside its ten minutes: refused, and no taken or ok row added", async () => {
    const home = fresh();
    const one = await paired(home);
    const env = one.envelope(one.device, GOOD);
    expect(await one.svc.exchange(env)).toEqual({ ok: true, kind: "account", summary: SENTENCE });
    const two = await run(home, 60_000);
    const count = two.rows().length;
    const again = refusal(await two.svc.exchange(env));
    expect(again.code).toBe("E_ACCOUNT_NONCE");
    expect(two.rows().slice(count).filter((r) => r.kind === "action")).toHaveLength(0);
  });

  it("prepare: what is signed, field for field, on the simulation's chain; a draft off its bounds is refused with its sentence", async () => {
    const x = await paired();
    const { type: _type, ...fields } = GOOD;
    const p = await x.engine.prepare({ ...GOOD });
    if (isRefusal(p)) throw new Error(p.message);
    expect(p.primaryType).toBe("AccountAttest:Sign");
    expect(p.accountChain).toBe("Simulation");
    expect(p.shown.map((f) => f.name)).toEqual(["service", "act", "subject", "digest", "nonce"]);
    expect(p.shown.slice(0, 4).map((f) => f.value)).toEqual(Object.values(fields));
    expect(refusal(await x.engine.prepare({ ...GOOD, subject: "no chasing" })).message).toBe(WORDS.subject);
    expect(refusal(await x.engine.prepare({ ...GOOD, digest: DIGEST.toUpperCase() })).message).toBe(WORDS.digest);
    // a prepared attest signed as it was shown is taken
    expect(await x.svc.exchange({ action: p.action, nonce: p.action.nonce, signature: signDevice(x.device, p.action) })).toEqual({ ok: true, kind: "account", summary: SENTENCE });
  });

  it("in no money, steering, memory or paper set, and signed on the simulation's chain, which no live type is (LIVE_TYPES decides it)", () => {
    for (const set of [MONEY_TYPES, STEER_TYPES, MEMORY_TYPES, PAPER_TYPES]) expect(set.has("attest")).toBe(false);
    expect(ownerTypedData({ ...GOOD, nonce: START } as Attest).message.accountChain).toBe("Simulation");
  });

  it("a restart over the same home replays it as nothing: no line skipped, the signers and the settings as they were", async () => {
    const home = fresh();
    const one = await paired(home);
    expect(await one.svc.exchange(one.envelope(one.device, GOOD))).toMatchObject({ ok: true });
    const state = one.engine.state;
    const policy = one.svc.policy();
    const two = await run(home, HOUR);
    expect(two.svc.restored).toMatchObject({ owner: true, skipped: [] });
    expect(two.engine.state.owners).toEqual(state.owners);
    expect(two.engine.state.threshold).toBe(state.threshold);
    expect(two.engine.state.agents).toEqual(state.agents);
    expect(two.engine.state.spends).toEqual(state.spends);
    expect(two.svc.policy()).toEqual(policy);
    // and the envelope is not taken again by the later run
    expect(refusal(await two.svc.exchange(one.envelope(one.device, GOOD, START + 1))).code).toBe("E_ACCOUNT_NONCE");
  });
});
