import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Ledger } from "../../src/agent/ledger.ts";
import { isRefusal } from "../../src/core/errors.ts";
import type { Outcome } from "../../src/portfolio/account/exchange.ts";
import { signOwner, simKey, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { UNSIGNED_SIGNER, unsignedProblem } from "../../src/portfolio/account/unsigned.ts";
import { IDENTITY_WORDS } from "../../src/portfolio/identity/routes.ts";
import type { LiveDeps } from "../../src/portfolio/live/index.ts";
import { paperBookPath } from "../../src/portfolio/live/paper.ts";
import { startPortfolioServer } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

/** THE UNSIGNED DOOR (account/unsigned.ts): Identity's four and opening a paper account are taken without a signature; everything else is
 * the signed door's, refused here in one fixed sentence. A paper opening takes no id a venue has; a restart brings it back, and skips a
 * `local` row of any other type */
type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const START = Date.parse("2026-11-09T15:00:00Z");
const owner = simKey("owner");
const homes: string[] = [];
afterAll(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })));

async function boot(o: { home?: string; at?: number } = {}) {
  const home = o.home ?? mkdtempSync(join(tmpdir(), "account-unsigned-"));
  if (!o.home) homes.push(home);
  let n = 0;
  const liveDeps: Partial<LiveDeps> = { clock: () => 5_000_000 + (o.at ?? 0), http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined };
  const svc = await PortfolioService.create({ home, now: () => new Date(START + (o.at ?? 0)).toISOString(), venues: "frontline", real: true, liveDeps, liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date(START).toISOString() }] } });
  await svc.restoring;
  const ex = svc.account!;
  const own = async (a: NoNonce<OwnerAction>) => svc.exchange(await signOwner(owner, { ...a, nonce: START + (o.at ?? 0) + ++n } as OwnerAction));
  const rows = () => readFileSync(svc.ledgerPath(), "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x) as Record<string, unknown>);
  const lastRow = () => rows().at(-1)!;
  return { svc, ex, own, rows, lastRow, home };
}
const messageOf = (o: Outcome): string => (isRefusal(o) ? o.message : `not refused: ${o.kind}`);
const paper = (venue: string, credentialRef = "10000") => ({ type: "connectVenue", venue, connector: "live:paper", label: venue, credentialRef });

describe("the unsigned door", () => {
  it("unsignedProblem: the five types pass; anything else, and a connectVenue that is not paper, is named as signed", () => {
    for (const a of [paper("p"), { type: "connectNetwork" }, { type: "disconnectNetwork" }, { type: "setRouting" }, { type: "blockSender" }]) expect(unsignedProblem(a)).toBeNull();
    expect(unsignedProblem({ type: "liveOrder" })).toBe('"liveOrder" is signed: only a browser that signs for the account takes it');
    expect(unsignedProblem({ type: "connectVenue", connector: "live:alpaca" })).toBe('"connectVenue" is signed: only a browser that signs for the account takes it');
    expect(unsignedProblem(null)).toBe("not an instruction this account knows");
    expect(unsignedProblem({})).toBe("not an instruction this account knows");
    expect(unsignedProblem({ type: "notAType" })).toBe("not an instruction this account knows");
  });

  it("an unsigned paper opening is taken, and its row says local", async () => {
    const { ex, lastRow, home } = await boot();
    const out = await ex.act(paper("paper-x"));
    expect(out.ok).toBe(true);
    expect(lastRow()).toMatchObject({ kind: "action", venue: "paper-x", tool: "connectVenue", signer: UNSIGNED_SIGNER, outcome: "ok", native: { unsigned: paper("paper-x") } });
    expect(lastRow().envelope).toBeUndefined();
    expect(existsSync(paperBookPath(home, "paper-x"))).toBe(true);
  });

  it("every signed type is refused at the unsigned door with its sentence, and nothing changes", async () => {
    const { ex, rows } = await boot();
    const before = rows().filter((r) => r.kind === "action").length;
    for (const type of ["liveOrder", "liveMove", "approveSpend", "approveCard", "convertToMultiSigUser", "signOut", "topUpPaper", "resetPaper", "disconnectVenue", "setPolicy"]) {
      const r = await ex.act({ type });
      expect(r.ok).toBe(false);
      expect(messageOf(r)).toBe(`"${type}" is signed: only a browser that signs for the account takes it`);
    }
    expect(messageOf(await ex.act({ type: "connectVenue", venue: "alpaca-1", connector: "live:alpaca", label: "a", credentialRef: "k" }))).toBe('"connectVenue" is signed: only a browser that signs for the account takes it');
    expect(rows().filter((r) => r.kind === "action").length).toBe(before);
    expect(ex.host.adapter("alpaca-1")).toBeUndefined();
  });

  it("an unsigned paper opening is checked like a signed one: a field it does not carry, or one that is not text, is refused", async () => {
    const { ex } = await boot();
    expect(messageOf(await ex.act({ ...paper("paper-y"), extra: "1" }))).toBe('"extra" is not part of what "connectVenue" signs');
    expect(messageOf(await ex.act({ ...paper("paper-y"), label: 3 }))).toBe('"label" is text');
  });

  it("an unsigned paper opening on a venue id in use is refused; a kept book continues", async () => {
    const { svc, ex, own } = await boot();
    const inUse = '"paper-x" is in use: an unsigned paper account takes a name no venue has';
    // a connected id: one opened at this door, and one the owner signed
    expect((await ex.act(paper("paper-x"))).ok).toBe(true);
    expect(messageOf(await ex.act(paper("paper-x", "")))).toBe(inUse);
    expect((await own({ type: "connectVenue", venue: "paper-s", connector: "live:paper", label: "s", credentialRef: "" })).ok).toBe(true);
    expect(messageOf(await ex.act(paper("paper-s", "")))).toBe('"paper-s" is in use: an unsigned paper account takes a name no venue has');
    // a waiting id: a connection the owner signed whose venue has not answered this network
    const waiting = (svc as unknown as { waiting: Map<string, unknown> }).waiting;
    waiting.set("paper-w", { c: { venue: "paper-w", connector: "live:okx", label: "", credentialRef: "" } });
    try {
      expect(messageOf(await ex.act(paper("paper-w")))).toBe('"paper-w" is in use: an unsigned paper account takes a name no venue has');
    } finally {
      waiting.delete("paper-w");
    }
    // a kept idle book: disconnected (signed), its book kept in the home, continued with no starting sum
    expect((await own({ type: "disconnectVenue", venue: "paper-s" })).ok).toBe(true);
    expect(svc.paperBooksIdle().map((b) => b.venue)).toContain("paper-s");
    expect((await ex.act(paper("paper-s", ""))).ok).toBe(true);
    expect(ex.host.adapter("paper-s")).toBeDefined();
  });

  it("a restart brings back an unsigned paper opening, and skips a local row of a signed type", async () => {
    const a = await boot();
    expect((await a.ex.act(paper("paper-x"))).ok).toBe(true);
    const tamper = new Ledger(a.svc.ledgerPath(), () => new Date(START + 60_000).toISOString());
    tamper.append({ kind: "action", venue: "real", tool: "liveOrder", signer: UNSIGNED_SIGNER, outcome: "ok", reason: "forged", native: { unsigned: { type: "liveOrder", venue: "real" } } });
    const b = await boot({ home: a.home, at: 3_600_000 });
    expect(b.ex.host.adapter("paper-x")).toBeDefined();
    expect(b.svc.restored?.venues).toEqual([expect.objectContaining({ venue: "paper-x", ok: true })]);
    expect(b.svc.restored?.skipped).toEqual(["liveOrder of 2026-11-09T15:01:00.000Z: an unsigned row of a signed act: not brought back"]);
  });

  it("a restart skips an unsigned paper row on an id a connection holds, and ignores a local Identity row", async () => {
    const a = await boot();
    // the owner signed paper-s open; then a local row opening paper-s again, and a local Identity row, written into the ledger by hand
    expect((await a.own({ type: "connectVenue", venue: "paper-s", connector: "live:paper", label: "signed", credentialRef: "" })).ok).toBe(true);
    const tamper = new Ledger(a.svc.ledgerPath(), () => new Date(START + 60_000).toISOString());
    tamper.append({ kind: "action", venue: "paper-s", tool: "connectVenue", signer: UNSIGNED_SIGNER, outcome: "ok", reason: "by hand", native: { unsigned: { ...paper("paper-s"), label: "unsigned" } } });
    tamper.append({ kind: "action", venue: "*", tool: "connectNetwork", signer: UNSIGNED_SIGNER, outcome: "ok", reason: "connectNetwork", native: { unsigned: { type: "connectNetwork", network: "telegram" } } });
    const b = await boot({ home: a.home, at: 3_600_000 });
    // the signed connection stands as it was signed: one venue, its own label
    expect(b.svc.restored?.venues).toEqual([expect.objectContaining({ venue: "paper-s", ok: true })]);
    expect(b.ex.host.adapter("paper-s")?.account.name).toBe("signed · paper");
    // the held id is said; the Identity row is neither replayed nor said
    expect(b.svc.restored?.skipped).toEqual(["connectVenue of 2026-11-09T15:01:00.000Z: an unsigned paper account on paper-s, which a connection holds: not brought back"]);
    expect(b.ex.host.adapter("telegram")).toBeUndefined();
  });

  it("an unsigned paper opening on an id of the wrong shape is refused before any path is built from it, and its row keeps no caller words", async () => {
    const { ex, rows, home } = await boot();
    // a kept book planted where a path built from '../x' or 'paper-/../../x' would land: read, it would answer with its own refusal
    expect((await ex.act(paper("paper-z"))).ok).toBe(true);
    const planted = join(home, "x");
    mkdirSync(planted, { recursive: true });
    const book = JSON.parse(readFileSync(paperBookPath(home, "paper-z"), "utf8")) as Record<string, unknown>;
    writeFileSync(join(planted, "book.json"), JSON.stringify({ ...book, cashUsd: 5_000 }));
    expect(paperBookPath(home, "../x")).toBe(join(planted, "book.json"));
    const shape = "a venue's id is lower-case letters, digits and dashes";
    for (const id of ["../x", "paper-/../../x", join(home, "x"), "/etc", `paper-${"a".repeat(40)}`, "Paper-X", ""]) {
      const r = await ex.act(paper(id));
      expect(messageOf(r), id).toBe(shape);
      expect(isRefusal(r) && r.venue, id).toBeFalsy();
      expect(rows().at(-1), id).toMatchObject({ kind: "account-refusal", venue: "*", tool: "connectVenue", reason: shape, signer: UNSIGNED_SIGNER });
    }
    expect(ex.host.adapter("x")).toBeUndefined();
  });

  it("identity acts pass the unsigned door to the identity host", async () => {
    const { svc, ex, lastRow } = await boot();
    const seen: unknown[] = [];
    let problem: string | null = null;
    // the service's own identity, its apply and problem stood in for: the door's handing on is what is checked here
    const identity = (svc as unknown as { identity?: object }).identity;
    if (!identity) throw new Error("the service keeps no identity");
    Object.assign(identity, {
      apply: async (a: unknown) => {
        seen.push(a);
        return { ok: true, kind: "account", summary: "routing: telegram" };
      },
      problem: () => problem,
    });
    const routing = { type: "setRouting", routing: "telegram", quietFrom: "", quietTo: "" };
    expect(await ex.act(routing)).toEqual({ ok: true, kind: "account", summary: "routing: telegram" });
    expect(seen).toEqual([routing]);
    expect(lastRow()).toMatchObject({ kind: "action", venue: "*", tool: "setRouting", signer: UNSIGNED_SIGNER, outcome: "ok", reason: "routing: telegram" });
    expect(lastRow().native).toBeUndefined();
    // the host's own problem refuses, in its words, and the host is not asked
    problem = "no network is connected";
    expect(messageOf(await ex.act(routing))).toBe("no network is connected");
    // a bot token pasted into a field is refused before anything is written
    problem = null;
    expect(messageOf(await ex.act({ ...routing, routing: "123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }))).toBe(IDENTITY_WORDS.tokenInField);
    expect(seen.length).toBe(1);
  });

  it("an unsigned connectNetwork writes neither its keyHash nor its salt to the ledger, taken or refused", async () => {
    const { svc, ex, rows } = await boot();
    const keyHash = "0x" + "ab12".repeat(16);
    const salt = "5a17" + "cd34".repeat(7);
    const connect = { type: "connectNetwork", network: "telegram", pending: "pend-1", botId: "1", speaksAs: "gravit_bot", operatorId: "2", talksOnlyWith: "2", routing: "telegram", keyHash, salt };
    const identity = (svc as unknown as { identity?: object }).identity;
    if (!identity) throw new Error("the service keeps no identity");
    let problem: string | null = "no pending connection pend-1";
    Object.assign(identity, { apply: async () => ({ ok: true, kind: "account", summary: "telegram connected" }), problem: () => problem });
    expect(messageOf(await ex.act(connect))).toBe("no pending connection pend-1");
    problem = null;
    expect((await ex.act(connect)).ok).toBe(true);
    const text = readFileSync(svc.ledgerPath(), "utf8");
    expect(rows().filter((r) => r.tool === "connectNetwork").map((r) => r.kind)).toEqual(["account-refusal", "action"]);
    expect(text).not.toContain(keyHash.slice(2));
    expect(text).not.toContain(salt);
  });

  it("a type the account does not know is refused without its words, at the door and on the ledger", async () => {
    const { ex, rows } = await boot();
    expect(messageOf(await ex.act({ type: "made-up-type-words" }))).toBe("not an instruction this account knows");
    expect(JSON.stringify(rows())).not.toContain("made-up-type-words");
  });

  it("POST /api/account/act: 200 an outcome, 409 a refusal, 400 an action that is not an object", async () => {
    const { svc } = await boot();
    const srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
    try {
      const post = async (body: unknown) => {
        const r = await fetch(`${srv.url}/api/account/act`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        return { status: r.status, body: (await r.json()) as Record<string, unknown> };
      };
      expect(await post({ action: paper("paper-h") })).toMatchObject({ status: 200, body: { ok: true, kind: "account" } });
      expect(await post({ action: { type: "liveOrder" } })).toMatchObject({ status: 409, body: { ok: false, refusal: { message: '"liveOrder" is signed: only a browser that signs for the account takes it' } } });
      expect(await post({ action: "liveOrder" })).toMatchObject({ status: 400, body: { ok: false } });
      expect(await post({})).toMatchObject({ status: 400, body: { ok: false } });
    } finally {
      await srv.close();
    }
  });
});
