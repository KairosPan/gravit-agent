/** IMESSAGE WIRED INTO IDENTITY AND THE SERVICE (identity/identity.ts, service.ts, server.ts): connectNetwork signed at the door writes
 * credentials/networks/imessage.json and starts the stream from the sequence the hello was heard at; the view lists the network without its
 * ids; a send reaches Photon for the operator's number; a disconnect takes the secret and the cursor and keeps the refused line, the
 * Photon registration and the shared link; and the project secret is in no log line. The Photon link is the in-memory fake; the secret is made up. */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRefusal } from "../../src/core/errors.ts";
import { keyHashOf, newSalt } from "../../src/portfolio/account/brain-keys.ts";
import { scriptedBrain } from "../../src/portfolio/account/desk.ts";
import { signOwner, simKey, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { IMESSAGE_REFUSED_FILE } from "../../src/portfolio/identity/identity.ts";
import type { PendingView } from "../../src/portfolio/identity/pending.ts";
import type { PhotonEvent } from "../../src/portfolio/identity/photon-link.ts";
import { IDENTITY_WORDS, IMESSAGE_TOKEN_PATH } from "../../src/portfolio/identity/routes.ts";
import { readNetworkSecret } from "../../src/portfolio/identity/secret-file.ts";
import { startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";
import { fakePhotonLink, type FakePhoton } from "../identity-fakes.ts";

type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const secret = "photon-secret-for-tests";
const basicOf = (id: string, s: string): string => Buffer.from(`${id}:${s}`, "utf8").toString("base64");
const phone = "+14155550100";
const line = "+14155550123";
const owner = simKey("owner");
const ALL = "chat=imessage;alerts=imessage;brief=imessage;cards=imessage;fills=imessage";
let n = 0;
const nonce = () => Date.now() + ++n;

function post(url: string, path: string, body: string): Promise<{ status: number; text: string }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path, method: "POST", headers: { "content-type": "application/json" } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function until(ok: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const hello = (sequence: number): PhotonEvent => ({ type: "message", message: { sequence, guid: `G-${sequence}`, chatGuid: `iMessage;-;${phone}`, from: phone, service: "iMessage", fromMe: false, text: "hi", nonText: false } });

let said: string[] = [];
let spies: Array<{ mockRestore(): void }> = [];

describe("iMessage connected through the signed door", () => {
  let fake: FakePhoton;
  let home: string;
  let svc: PortfolioService;
  let srv: PortfolioServerHandle;
  let salt = "";
  let keyHash = "";

  beforeEach(async () => {
    said = [];
    const keep = (...a: unknown[]) => void said.push(a.map(String).join(" "));
    spies = [vi.spyOn(console, "log").mockImplementation(keep), vi.spyOn(console, "error").mockImplementation(keep), vi.spyOn(console, "warn").mockImplementation(keep), vi.spyOn(console, "info").mockImplementation(keep)];
    fake = fakePhotonLink({ project: { projectId: "prj_1", secret }, nextLine: line });
    home = mkdtempSync(join(tmpdir(), "identity-imessage-wiring-"));
    svc = await PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined }, publicMarkets: [], liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date().toISOString() }] }, desk: { brain: [scriptedBrain(() => null)], tickMs: 0, env: {} }, identity: { apiBase: "http://127.0.0.1:9", pollTimeoutS: 1 }, photon: fake });
    await svc.restoring;
    srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
  });
  afterEach(async () => {
    await srv.close();
    rmSync(home, { recursive: true, force: true });
    for (const s of spies) s.mockRestore();
  });

  const own = async (a: NoNonce<OwnerAction>, at = nonce()) => svc.exchange(await signOwner(owner, { ...a, nonce: at } as OwnerAction));
  /** sheets 1 to 3 through the route: the project and number sent with their one fingerprint, the operator's hello heard at `sequence` */
  const heardPending = async (sequence = 41): Promise<PendingView> => {
    salt = newSalt();
    keyHash = keyHashOf(salt, `prj_1\u0000${secret}`);
    const r = await post(srv.url, IMESSAGE_TOKEN_PATH, JSON.stringify({ projectId: "prj_1", projectSecret: secret, phone, keyHash, salt }));
    expect(r.status).toBe(200);
    const p = JSON.parse(r.text).pending as PendingView;
    await fake.push(hello(sequence));
    await until(() => svc.identity!.pending.view(p.id)?.state === "heard");
    return svc.identity!.pending.view(p.id)!;
  };
  const connectOf = (p: PendingView, over: Partial<Record<string, string>> = {}): NoNonce<OwnerAction> => ({ type: "connectNetwork", network: "imessage", pending: p.id, botId: `prj_1:${line}`, speaksAs: line, operatorId: phone, talksOnlyWith: phone, routing: ALL, keyHash, salt, ...over }) as NoNonce<OwnerAction>;
  const connect = async () => {
    const p = await heardPending();
    const r = await own(connectOf(p));
    expect(isRefusal(r)).toBe(false);
    return r;
  };
  const imessage = () => svc.identity!.view().networks.find((x) => x.network === "imessage");

  it("connectNetwork for iMessage writes imessage.json and starts listening after the hello", async () => {
    const r = await connect();
    expect(r).toMatchObject({ ok: true, kind: "account", summary: `iMessage connected: Gravit speaks as ${line} and talks only with ${phone} · project secret ${keyHash.slice(0, 8)}` });
    expect(readNetworkSecret(home, "imessage")).toMatchObject({ projectId: "prj_1", projectSecret: secret, phone, line, userId: "usr_1", operatorId: phone, operatorHandle: phone });
    await until(() => fake.openStreams() === 1);
    expect(fake.lastSince()).toBe(41);
    expect(JSON.stringify(r)).not.toContain(secret);
  });

  it("a signed speaksAs with an @ is refused for iMessage, and so is a bot of another project", async () => {
    const p = await heardPending();
    for (const over of [{ speaksAs: `@${line}` }, { botId: `prj_2:${line}` }]) {
      const answer = await own(connectOf(p, over));
      expect(isRefusal(answer) && answer.message).toBe(IDENTITY_WORDS.botMismatchOn("imessage"));
    }
    expect(readNetworkSecret(home, "imessage")).toBeUndefined();
  });

  it("the view lists iMessage with its status and without botId or operatorId", async () => {
    await connect();
    const v = imessage();
    expect(v).toMatchObject({ state: "connected", speaksAs: line, talksOnlyWith: phone });
    expect(v).not.toHaveProperty("botId");
    expect(v).not.toHaveProperty("operatorId");
    expect(v).not.toHaveProperty("refusedAt");
  });

  it("a refused line shows as refusedAt in the view, and another line does not", async () => {
    await connect();
    mkdirSync(join(home, "identity"), { recursive: true });
    writeFileSync(join(home, "identity", IMESSAGE_REFUSED_FILE), "+14155550009\n");
    expect(imessage()?.refusedAt).toBeUndefined();
    writeFileSync(join(home, "identity", IMESSAGE_REFUSED_FILE), `${line}\n`);
    expect(imessage()?.refusedAt).toEqual(expect.stringMatching(/^\d{4}-\d\d-\d\dT/));
  });

  it("a send routed to iMessage reaches Photon for the operator's number", async () => {
    await connect();
    const a = await svc.identity!.send({ kind: "urgent", text: "AAPL moved" });
    expect(a).toMatchObject({ ok: true, sent: [expect.stringMatching(/^imessage:/)] });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toMatchObject({ to: phone, text: "AAPL moved" });
  });

  it("disconnect removes imessage.json and imessage.cursor, keeps imessage.refused, the Photon registration and the link", async () => {
    await connect();
    await until(() => fake.openStreams() === 1);
    await fake.push(hello(42));
    await until(() => existsSync(join(home, "identity", "imessage.cursor")));
    writeFileSync(join(home, "identity", IMESSAGE_REFUSED_FILE), `${line}\n`);
    const r = await own({ type: "disconnectNetwork", network: "imessage" });
    expect(isRefusal(r)).toBe(false);
    expect(existsSync(join(home, "credentials/networks/imessage.json"))).toBe(false);
    expect(existsSync(join(home, "identity/imessage.cursor"))).toBe(false);
    expect(existsSync(join(home, "identity/imessage.refused"))).toBe(true);
    expect(fake.calls.some((c) => c.startsWith("removeUser"))).toBe(false);
    expect(fake.openStreams()).toBe(0);
    // the link is the service's, not the connection's: it is still there for the next one
    expect(fake.calls).not.toContain("dispose");
    const again = await heardPending(50);
    expect(again.state).toBe("heard");
    expect(fake.calls).not.toContain("dispose");
  });

  it("closing the service leaves a link it was given to its owner", async () => {
    await connect();
    await srv.close();
    expect(fake.calls).not.toContain("dispose");
    srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
  });

  it("the project secret is in no log line, no ledger row and no answer", async () => {
    await connect();
    await svc.identity!.send({ kind: "urgent", text: "x" });
    fake.failNextSend(new (await import("../../src/portfolio/identity/photon-link.ts")).PhotonError("refused", "addressNotFound", `no line for ${secret}`));
    await svc.identity!.send({ kind: "urgent", text: "y" });
    await srv.close();
    const lines = said.join("\n");
    expect(lines).not.toContain(secret);
    expect(lines).not.toContain(basicOf("prj_1", secret));
    srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
  });
});
