/** CONNECT IMESSAGE, SHEETS 1 TO 3 (identity/imessage-pending.ts, pending.ts, routes.ts): the Photon project's ID and secret and the
 * operator's number travel once, beside one fingerprint (keyHash = hex sha256(salt ‖ projectId ‖ NUL ‖ projectSecret)), on their own
 * route. The account checks the pair against the fingerprint, asks Photon for the project, finds or registers the number (a refused line
 * is registered again), then holds the secret in memory only and hears the first 1:1 iMessage from the number typed. Everything goes
 * through the in-memory Photon fake; the secret is made up. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keyHashOf, newSalt } from "../../src/portfolio/account/brain-keys.ts";
import { IMESSAGE_REFUSED_FILE, Identity } from "../../src/portfolio/identity/identity.ts";
import { operatorHandleOf, speaksAsOf, type PendingView } from "../../src/portfolio/identity/pending.ts";
import { PhotonError, type PhotonEvent, type PhotonMessage, type PhotonUser } from "../../src/portfolio/identity/photon-link.ts";
import { IDENTITY_WORDS, IMESSAGE_TOKEN_PATH, isIdentityTokenPath, parseImessageTokenBody, registerIdentityRoutes } from "../../src/portfolio/identity/routes.ts";
import { fakePhotonLink, type FakePhoton } from "../identity-fakes.ts";

const secret = "photon-secret-for-tests";
const project = { projectId: "prj_1", secret };
const phone = "+14155550100";

let seq = 0;
const msg = (o: Partial<PhotonMessage> = {}): PhotonEvent => {
  seq += 1;
  return { type: "message", message: { sequence: seq, guid: `G-${seq}`, chatGuid: `iMessage;-;${o.from ?? phone}`, from: phone, service: "iMessage", fromMe: false, text: "hi", nonText: false, ...o } };
};

/** a body read the way the server reads it: up to `limit` bytes, "large" past it */
function readSmall(req: express.Request, limit: number): Promise<Buffer | "large" | "broken"> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        req.resume();
        return resolve("large");
      }
      chunks.push(c);
    });
    req.on("end", () => !done && resolve(Buffer.concat(chunks)));
    req.on("error", () => !done && resolve("broken"));
  });
}

async function until(ok: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}

let said: string[] = [];
let spies: Array<{ mockRestore(): void }> = [];
beforeEach(() => {
  said = [];
  const keep = (...a: unknown[]) => void said.push(a.map(String).join(" "));
  spies = [vi.spyOn(console, "log").mockImplementation(keep), vi.spyOn(console, "error").mockImplementation(keep)];
});
afterEach(() => {
  for (const s of spies) s.mockRestore();
});

describe("the iMessage token route's body", () => {
  it("is exactly {projectId, projectSecret, phone, keyHash, salt}, five strings, and the buffer is zeroed", () => {
    const raw = Buffer.from(JSON.stringify({ projectId: "prj_1", projectSecret: secret, phone, keyHash: "k", salt: "s" }), "utf8");
    expect(parseImessageTokenBody(raw)).toEqual({ ok: true, projectId: "prj_1", projectSecret: secret, phone, keyHash: "k", salt: "s" });
    expect(raw.every((b) => b === 0)).toBe(true);
    for (const bad of [{ projectId: "prj_1", projectSecret: secret, phone, keyHash: "k" }, { projectId: "prj_1", projectSecret: secret, phone, keyHash: "k", salt: "s", more: "x" }, { projectId: "prj_1", projectSecret: secret, phone: 1, keyHash: "k", salt: "s" }, ["x"], "x"]) {
      expect(parseImessageTokenBody(Buffer.from(JSON.stringify(bad), "utf8"))).toEqual({ ok: false });
    }
    expect(isIdentityTokenPath(IMESSAGE_TOKEN_PATH)).toBe(true);
    expect(isIdentityTokenPath("/API/account/identity/iMessage/token/")).toBe(true);
  });
});

describe("speaksAsOf and operatorHandleOf", () => {
  it("speaksAsOf and operatorHandleOf carry no @ for iMessage", () => {
    expect(speaksAsOf("imessage", { username: "+14155550123" })).toBe("+14155550123");
    expect(speaksAsOf("telegram", { username: "gravit_bot" })).toBe("@gravit_bot");
    expect(speaksAsOf("slack", { username: "gravit" })).toBe("@gravit");
    expect(operatorHandleOf({ id: phone, handle: phone }, "imessage")).toBe(phone);
    expect(operatorHandleOf({ id: "1234567", handle: "" }, "telegram")).toBe("…567");
    expect(operatorHandleOf({ id: "1234567", handle: "@pan" }, "telegram")).toBe("@pan");
  });
});

describe("connect iMessage through the account: the token route and the pending connection", () => {
  let fake: FakePhoton;
  let home: string;
  let identity: Identity;
  let server: Server;
  let base: string;

  const start = async (o: { users?: PhotonUser[]; refused?: string } = {}) => {
    fake = fakePhotonLink({ project, ...(o.users ? { users: o.users } : {}), nextLine: "+14155550123" });
    if (o.refused !== undefined) {
      mkdirSync(join(home, "identity"), { recursive: true });
      writeFileSync(join(home, "identity", IMESSAGE_REFUSED_FILE), `${o.refused}\n`);
    }
    identity = new Identity({ home, apiBase: "http://127.0.0.1:9", photon: fake });
    const app = express();
    const wrap = (fn: (req: express.Request, res: express.Response) => Promise<void> | void) => (req: express.Request, res: express.Response) => void Promise.resolve(fn(req, res)).catch(() => res.status(500).end());
    registerIdentityRoutes(app, { identity: () => identity, wrap, readSmall });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };

  beforeEach(() => {
    seq = 0;
    home = mkdtempSync(join(tmpdir(), "identity-imessage-pending-"));
  });
  afterEach(async () => {
    await identity?.dispose();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(home, { recursive: true, force: true });
  });

  const postRaw = (path: string, body: string): Promise<{ status: number; body: { ok: boolean; error?: string; pending?: PendingView }; text: string }> =>
    new Promise((resolve, reject) => {
      const u = new URL(base);
      const req = request({ host: u.hostname, port: u.port, path, method: "POST", headers: { "content-type": "application/json" } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(text), text }));
      });
      req.on("error", reject);
      req.end(body);
    });
  const fp = (projectId: string, projectSecret: string) => {
    const salt = newSalt();
    return { salt, keyHash: keyHashOf(salt, `${projectId}\u0000${projectSecret}`) };
  };
  const post = (path: string, b: Record<string, string>) => postRaw(path, JSON.stringify(b));
  const begin = async (o: { projectId?: string; projectSecret?: string; phone?: string; signed?: string } = {}) => {
    const projectId = o.projectId ?? "prj_1";
    const projectSecret = o.projectSecret ?? secret;
    const { salt, keyHash } = fp(projectId, o.signed ?? projectSecret);
    return post(IMESSAGE_TOKEN_PATH, { projectId, projectSecret, phone: o.phone ?? phone, keyHash, salt });
  };
  const pendingIds = () => {
    const cur = (identity.pending as unknown as { current?: { id: string } }).current;
    return cur ? [cur.id] : [];
  };
  let pendingId = "";
  const view = () => identity.pending.view(pendingId)!;

  it("the route takes the five fields once and answers the pending connection", async () => {
    await start();
    const r = await begin();
    expect(r.status).toBe(200);
    expect(r.body.pending).toMatchObject({ network: "imessage", link: "sms:+14155550123", bot: { id: "prj_1:+14155550123", username: "+14155550123", name: "iMessage" }, state: "waiting" });
    expect(r.body.pending!.qr.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(r.text).not.toContain(secret);
    expect(fake.calls).toEqual(["checkProject", `findUser:${phone}`, `addUser:${phone}`, "stream"]);
    expect(fake.openStreams()).toBe(1);
    expect(fake.lastSince()).toBeUndefined();
    expect(said.join("\n")).not.toContain(secret);
  });

  it("a body past 1,024 bytes is 413 and a malformed one is imessageMalformed; neither repeats what was sent", async () => {
    await start();
    expect((await postRaw(IMESSAGE_TOKEN_PATH, "x".repeat(1_025))).status).toBe(413);
    const bad = await postRaw(IMESSAGE_TOKEN_PATH, JSON.stringify({ projectId: "prj_1", projectSecret: secret }));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe(IDENTITY_WORDS.imessageMalformed);
    expect(JSON.stringify(bad.body)).not.toContain(secret);
    expect(fake.calls).toEqual([]);
  });

  it("bad shapes are imessageShape (400) and a fingerprint of another secret is imessageMismatch, both before Photon is asked", async () => {
    await start();
    for (const o of [{ projectId: "p1" }, { projectId: "prj 1" }, { projectSecret: "short" }, { projectSecret: `${"s".repeat(20)} x` }, { phone: "4155550100" }, { phone: "+0415555" }]) {
      const r = await begin(o);
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ ok: false, error: IDENTITY_WORDS.imessageShape });
    }
    const m = await begin({ signed: "another-secret-entirely" });
    expect(m.status).toBe(409);
    expect(m.body).toEqual({ ok: false, error: IDENTITY_WORDS.imessageMismatch });
    expect(fake.calls).toEqual([]);
    expect(pendingIds()).toEqual([]);
  });

  it("Photon refusing the secret is refusedByPhoton, and nothing is kept", async () => {
    await start();
    const r = await post(IMESSAGE_TOKEN_PATH, { projectId: "prj_1", projectSecret: "w".repeat(32), phone, ...fp("prj_1", "w".repeat(32)) });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe(IDENTITY_WORDS.refusedByPhoton);
    expect(pendingIds()).toEqual([]);
    expect(r.text).not.toContain("w".repeat(32));
  });

  it("a dedicated project, a full plan, no free number and Photon not answering are each refused in their words", async () => {
    await start();
    const cases: Array<[string, PhotonError, string, number]> = [
      ["checkProject", new PhotonError("refused", "dedicated", "dedicated"), IDENTITY_WORDS.photonDedicated, 409],
      ["checkProject", new PhotonError("retry", "network", "Photon could not be reached"), IDENTITY_WORDS.photonUnreachable, 502],
      ["addUser", new PhotonError("limit", "402", "no room"), IDENTITY_WORDS.photonUserLimit, 409],
      ["addUser", new PhotonError("noNumber", "noNumber", "no number"), IDENTITY_WORDS.photonNoNumber, 409],
      ["findUser", new PhotonError("retry", "network", "Photon could not be reached"), IDENTITY_WORDS.photonUnreachable, 502],
    ];
    for (const [method, err, words, status] of cases) {
      const spy = vi.spyOn(fake, method as "checkProject").mockRejectedValueOnce(err);
      const r = await begin();
      expect([r.status, r.body.error]).toEqual([status, words]);
      spy.mockRestore();
      expect(pendingIds()).toEqual([]);
    }
  });

  it("a registered number is reused; a refused line is replaced", async () => {
    await start({ users: [{ userId: "usr_9", phone, line: "+14155550009" }] });
    const reused = await begin();
    expect(reused.body.pending).toMatchObject({ link: "sms:+14155550009", bot: { username: "+14155550009" } });
    expect(fake.calls).not.toContain(`addUser:${phone}`);
    await identity.dispose();
    await new Promise<void>((r) => server.close(() => r()));

    await start({ users: [{ userId: "usr_1", phone, line: "+14155550001" }], refused: "+14155550001" });
    const replaced = await begin();
    expect(fake.calls).toEqual(expect.arrayContaining(["removeUser:usr_1", `addUser:${phone}`]));
    expect(replaced.body.pending).toMatchObject({ link: "sms:+14155550123", bot: { username: "+14155550123" } });
  });

  it("only the typed number is heard; another sender is a stranger and the view says so", async () => {
    await start();
    pendingId = (await begin()).body.pending!.id;
    await fake.push(msg({ from: "kairos@icloud.com", text: "hi" }));
    expect(view().state).toBe("waiting");
    expect(view().strangerHeard?.masked).toBe("…com");
    expect(identity.strangers().map((s) => [s.network, s.masked])).toEqual([["imessage", "…com"]]);
    await fake.push(msg({ from: phone, text: "hi" }));
    expect(view()).toMatchObject({ state: "heard", sender: { id: phone, name: phone, handle: phone, masked: "…100", text: "hi" } });
    await until(() => fake.openStreams() === 0);
    const taken = identity.pending.peek(pendingId)!;
    expect(taken.resume).toEqual({ network: "imessage", sequence: 2, userId: "usr_1", line: "+14155550123", phone });
    expect(taken.secret).toEqual({ projectId: "prj_1", projectSecret: secret, phone, line: "+14155550123", userId: "usr_1", operatorId: phone, operatorHandle: phone });
    expect(said.join("\n")).not.toContain(secret);
  });

  it("an SMS from the typed number is never heard", async () => {
    await start();
    pendingId = (await begin()).body.pending!.id;
    await fake.push(msg({ from: phone, service: "SMS" }));
    await fake.push(msg({ from: phone, service: "SMS" }));
    expect(view().state).toBe("waiting");
    // one line a minute, whatever the count
    expect(said.filter((l) => l.includes("SMS")).length).toBe(1);
  });

  it("Gravit's own, a group's and a non-text message are skipped; Not me waits again on a fresh stream", async () => {
    await start();
    pendingId = (await begin()).body.pending!.id;
    await fake.push(msg({ fromMe: true }));
    await fake.push(msg({ chatGuid: "iMessage;+;chat123" }));
    await fake.push(msg({ nonText: true, text: "" }));
    await fake.push({ type: "other", sequence: 99 });
    expect(view().state).toBe("waiting");
    expect(view().strangerHeard).toBeUndefined();
    await fake.push(msg({ text: "hello" }));
    expect(view().state).toBe("heard");
    identity.pending.notMe(pendingId);
    expect(view().state).toBe("waiting");
    await until(() => fake.openStreams() === 1);
    // the same number again is counted, never heard
    await fake.push(msg({ text: "hi again" }));
    expect(view().state).toBe("waiting");
  });

  it("connectNetwork's checks: speaksAs is the pool number and talksOnlyWith the operator's number, neither with an @", async () => {
    await start();
    pendingId = (await begin()).body.pending!.id;
    await fake.push(msg({ text: "hi" }));
    const { salt, keyHash } = fp("prj_1", secret);
    const action = { type: "connectNetwork" as const, network: "imessage", pending: pendingId, keyHash, salt, botId: "prj_1:+14155550123", speaksAs: "+14155550123", operatorId: phone, talksOnlyWith: phone, routing: "chat=imessage;alerts=imessage;brief=;cards=;fills=" };
    const problem = (a: Record<string, string>) => identity.problem({ ...action, ...a } as Parameters<Identity["problem"]>[0]);
    const ok = {};
    expect(problem(ok)).toBeNull();
    expect(problem({ ...ok, speaksAs: "@+14155550123" })).toBe(IDENTITY_WORDS.imessageBotMismatch);
    expect(problem({ ...ok, talksOnlyWith: `@${phone}` })).toBe(IDENTITY_WORDS.senderMismatch);
    expect(problem({ ...ok, keyHash: keyHashOf(salt, "prj_1\u0000other-secret-value") })).toBe(IDENTITY_WORDS.imessageMismatch);
  });
});
