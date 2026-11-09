/** THE CONNECTED IMESSAGE CONNECTOR (identity/imessage.ts ImessageConnector): once connectNetwork is signed for iMessage, the account reads
 * Photon's event stream for the project and stores the bound operator's 1:1 iMessage texts in the inbox, moving `identity/imessage.cursor`
 * past each event once it is handled. A stranger (the operator's own email handle included) is counted, never stored and never answered;
 * SMS and RCS are dropped, from anyone; a group is dropped. A stream with no heartbeat for 120 s is pollFailing and is reopened from the
 * cursor, backing off 5 s doubling to 60 s; an auth failure retries at 60 s; a pruned cursor is gapAt; a line Photon moved stops the
 * connector with movedAt. Everything runs on the in-memory fake link and a held clock, in a temp home. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HEARTBEAT_STALE_MS, IMESSAGE_CURSOR_FILE, ImessageConnector } from "../../src/portfolio/identity/imessage.ts";
import { InboxRing } from "../../src/portfolio/identity/inbox.ts";
import { chatOffLine } from "../../src/portfolio/identity/kinds.ts";
import { PhotonError, type PhotonEvent, type PhotonMessage, type PhotonUser } from "../../src/portfolio/identity/photon-link.ts";
import type { ImessageSecret } from "../../src/portfolio/identity/secret-file.ts";
import { identityDir, senderRef, Strangers, type Binding } from "../../src/portfolio/identity/store.ts";
import { TEXT_ONLY, type IdentityClock } from "../../src/portfolio/identity/telegram.ts";
import { fakePhotonLink, type FakePhoton } from "../identity-fakes.ts";

const PHONE = "+14155550100";
const LINE = "+14155550123";
const G1 = "11111111-AAAA-4BBB-8CCC-000000000001";
const G2 = "11111111-AAAA-4BBB-8CCC-000000000002";
const G3 = "11111111-AAAA-4BBB-8CCC-000000000003";
const G4 = "11111111-AAAA-4BBB-8CCC-000000000004";
const PROJECT = { projectId: "prj_1", secret: "photon-secret-for-tests" };
const USER: PhotonUser = { userId: "usr_1", phone: PHONE, line: LINE };
const SECRET: ImessageSecret = { projectId: PROJECT.projectId, projectSecret: PROJECT.secret, phone: PHONE, line: LINE, userId: "usr_1", operatorId: PHONE, operatorHandle: PHONE };
const BINDING: Binding = { network: "imessage", speaksAs: LINE, botId: LINE, talksOnlyWith: PHONE, operatorId: PHONE, since: "2026-11-09T00:00:00.000Z", fingerprint: "f".repeat(64) };

let seq = 100;
let guidN = 1000;
const msg = (m: Partial<PhotonMessage> & { from: string }): PhotonEvent => {
  const sequence = m.sequence ?? ++seq;
  const guid = m.guid ?? `22222222-AAAA-4BBB-8CCC-${String(++guidN).padStart(12, "0")}`;
  return { type: "message", message: { sequence, guid, chatGuid: m.chatGuid ?? `iMessage;-;${m.from}`, from: m.from, service: m.service ?? "iMessage", fromMe: m.fromMe ?? false, nonText: m.nonText ?? false, ...(m.text !== undefined ? { text: m.text } : {}), ...(m.replyTo !== undefined ? { replyTo: m.replyTo } : {}) } };
};

/** a clock whose time moves only when the test advances it, firing each wait that falls due, in order */
function heldClock(start = Date.parse("2026-11-09T15:00:00.000Z")): IdentityClock & { advance(ms: number): void; pending(): number[] } {
  let now = start;
  let n = 0;
  const waits = new Map<number, { at: number; fn: () => void; ms: number }>();
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      const h = ++n;
      waits.set(h, { at: now + ms, fn, ms });
      return h;
    },
    clearTimeout: (h) => {
      waits.delete(h as number);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | undefined;
        for (const e of waits) if (e[1].at <= end && (!next || e[1].at < next[1].at || (e[1].at === next[1].at && e[0] < next[0]))) next = e;
        if (!next) break;
        waits.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
    pending: () => [...waits.values()].map((w) => w.ms),
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("the iMessage connector", () => {
  let home: string;
  let fake: FakePhoton;
  let clock: ReturnType<typeof heldClock>;
  let inbox: InboxRing;
  let strangers: Strangers;
  let replies: string[];
  let lines: string[];
  let chat: boolean;
  let blocked: string[];
  let conn: ImessageConnector;
  const connectors: ImessageConnector[] = [];

  const make = (o: { sequence?: number | undefined; link?: FakePhoton } = {}): ImessageConnector => {
    const c = new ImessageConnector({
      home,
      link: o.link ?? fake,
      binding: BINDING,
      secret: SECRET,
      inbox,
      strangers,
      blocked: () => blocked,
      chatOn: () => chat,
      reply: async (t) => {
        replies.push(t);
      },
      sequence: "sequence" in o ? o.sequence : ImessageConnector.resumeFrom(home),
      clock,
      log: (l) => lines.push(l),
    });
    connectors.push(c);
    return c;
  };
  const started = async (c: ImessageConnector) => {
    c.start();
    await flush();
    return c;
  };

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "imessage-inbox-"));
    fake = fakePhotonLink({ project: PROJECT, users: [USER] });
    clock = heldClock();
    inbox = new InboxRing(home);
    strangers = new Strangers(home);
    replies = [];
    lines = [];
    chat = true;
    blocked = [];
    conn = await started(make());
  });
  afterEach(async () => {
    for (const c of connectors.splice(0)) await c.dispose();
    rmSync(home, { recursive: true, force: true });
  });

  it("checks the user's line, then opens the stream with no cursor", () => {
    expect(fake.calls.slice(0, 2)).toEqual(["getUser:usr_1", "stream"]);
    expect(fake.openStreams()).toBe(1);
    expect(fake.lastSince()).toBeUndefined();
    expect(conn.status()).toMatchObject({ network: "imessage", polling: true });
  });

  it("the operator's text goes to the inbox as imessage:<GUID> and the cursor follows it", async () => {
    await fake.push(msg({ sequence: 7, guid: G1, from: PHONE, text: "status?", replyTo: G4 }));
    expect(inbox.after(0).map((m) => m.messageId)).toEqual([`imessage:${G1}`]);
    expect(inbox.after(0)[0]).toMatchObject({ network: "imessage", text: "status?", replyTo: `imessage:${G4}` });
    expect(ImessageConnector.resumeFrom(home)).toBe(7);
    expect(readFileSync(join(identityDir(home), IMESSAGE_CURSOR_FILE), "utf8")).toBe("7\n");
    expect(conn.status().lastPollAt).toBe(new Date(clock.now()).toISOString());
    expect(replies).toEqual([]);
  });

  it("a restart catches up from the cursor", async () => {
    await fake.push(msg({ sequence: 7, guid: G1, from: PHONE, text: "status?" }));
    await conn.dispose();
    const link = fakePhotonLink({ project: PROJECT, users: [USER] });
    await started(make({ link }));
    expect(link.lastSince()).toBe(7);
  });

  it("a GUID the inbox has, or an old sequence, is skipped", async () => {
    await fake.push(msg({ sequence: 7, guid: G1, from: PHONE, text: "status?" }));
    await fake.push(msg({ sequence: 8, guid: G1, from: PHONE, text: "again" }));
    await fake.push(msg({ sequence: 6, guid: G2, from: PHONE, text: "old" }));
    expect(inbox.after(0)).toHaveLength(1);
    expect(ImessageConnector.resumeFrom(home)).toBe(8);
  });

  it("another handle, the operator's email included, is counted in Not you and never answered", async () => {
    await fake.push(msg({ from: "kairos@icloud.com", text: "hi" }));
    expect(strangers.list()[0]).toMatchObject({ network: "imessage", masked: "…com", count: 1 });
    expect(replies).toEqual([]);
    expect(inbox.after(0)).toEqual([]);
  });

  it("a blocked handle is not counted", async () => {
    blocked = [senderRef("imessage", "+14155550199")];
    await fake.push(msg({ from: "+14155550199", text: "hi" }));
    expect(strangers.list()).toEqual([]);
  });

  it("an SMS from the operator's number is dropped and never answered, with one line a minute", async () => {
    await fake.push(msg({ from: PHONE, service: "SMS", text: "/pause" }));
    await fake.push(msg({ from: PHONE, service: "RCS", text: "/pause" }));
    expect(inbox.after(0)).toEqual([]);
    expect(replies).toEqual([]);
    expect(strangers.list()).toEqual([]);
    expect(lines.filter((l) => /SMS/.test(l))).toHaveLength(1);
    clock.advance(60_000);
    fake.beat();
    await fake.push(msg({ from: "+14155550199", service: "SMS", text: "x" }));
    expect(lines.filter((l) => /SMS/.test(l))).toHaveLength(2);
    expect(strangers.list()).toEqual([]);
  });

  it("a group, and Gravit's own message, are dropped; the cursor still moves", async () => {
    await fake.push(msg({ sequence: 20, from: PHONE, chatGuid: "iMessage;+;chat123", text: "in a group" }));
    await fake.push(msg({ sequence: 21, from: PHONE, fromMe: true, text: "mine" }));
    await fake.push({ type: "other", sequence: 22 });
    expect(inbox.after(0)).toEqual([]);
    expect(replies).toEqual([]);
    expect(strangers.list()).toEqual([]);
    expect(ImessageConnector.resumeFrom(home)).toBe(22);
  });

  it("a photo from the operator is answered text only, please", async () => {
    await fake.push(msg({ from: PHONE, nonText: true }));
    expect(replies).toEqual([TEXT_ONLY]);
    expect(inbox.after(0)).toEqual([]);
  });

  it("with Chat with Gravit off, the operator is answered the chat-off line, and a phone command still goes through", async () => {
    chat = false;
    await fake.push(msg({ from: PHONE, text: "hello" }));
    expect(replies).toEqual([chatOffLine("imessage")]);
    expect(inbox.after(0)).toEqual([]);
    await fake.push(msg({ from: PHONE, text: "/pause" }));
    expect(inbox.after(0).map((m) => m.text)).toEqual(["/pause"]);
  });

  it("/Pause reaches the inbox as typed", async () => {
    await fake.push(msg({ sequence: 9, guid: G3, from: PHONE, text: "/Pause" }));
    expect(inbox.after(0).at(-1)?.text).toBe("/Pause");
  });

  it("an append that fails stops the stream; the event is read again from the cursor", async () => {
    await fake.push(msg({ sequence: 7, guid: G1, from: PHONE, text: "first" }));
    // the inbox's file becomes a folder: the next append cannot write it
    rmSync(join(identityDir(home), "inbox.json"));
    mkdirSync(join(identityDir(home), "inbox.json"));
    await fake.push(msg({ sequence: 8, guid: G2, from: PHONE, text: "second" }));
    expect(ImessageConnector.resumeFrom(home)).toBe(7);
    expect(fake.openStreams()).toBe(0);
    expect(lines.some((l) => /could not be stored/.test(l))).toBe(true);
    rmSync(join(identityDir(home), "inbox.json"), { recursive: true });
    clock.advance(5_000);
    await flush();
    expect(fake.openStreams()).toBe(1);
    expect(fake.lastSince()).toBe(7);
    await fake.push(msg({ sequence: 8, guid: G2, from: PHONE, text: "second" }));
    expect(inbox.after(0).map((m) => m.text)).toEqual(["first", "second"]);
    expect(ImessageConnector.resumeFrom(home)).toBe(8);
  });

  it("a silent stream turns failing and reopens", async () => {
    await fake.push(msg({ sequence: 7, guid: G1, from: PHONE, text: "status?" }));
    clock.advance(HEARTBEAT_STALE_MS - 1);
    expect(conn.status().pollFailing).toBeUndefined();
    clock.advance(30_002);
    expect(conn.status().pollFailing).toBeDefined();
    expect(fake.openStreams()).toBe(0);
    clock.advance(5_000);
    await flush();
    expect(fake.openStreams()).toBe(1);
    expect(fake.lastSince()).toBe(7);
    expect(fake.calls.filter((c) => c === "getUser:usr_1")).toHaveLength(2);
    fake.beat();
    expect(conn.status().pollFailing).toBeUndefined();
  });

  it("the stale check fires at 120 s, and the backoff doubles to 60 s while the stream stays silent", async () => {
    clock.advance(HEARTBEAT_STALE_MS);
    expect(conn.status().pollFailing).toBeDefined();
    expect(fake.openStreams()).toBe(0);
    for (const want of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]) {
      clock.advance(want - 1);
      await flush();
      expect(fake.openStreams()).toBe(0);
      clock.advance(1);
      await flush();
      expect(fake.openStreams()).toBe(1);
      clock.advance(HEARTBEAT_STALE_MS);
      await flush();
      expect(fake.openStreams()).toBe(0);
    }
  });

  it("an auth failure keeps the status failing and retries at the longest backoff", async () => {
    fake.fail(new PhotonError("auth", "unauthenticated", "Photon refused the project"));
    expect(conn.status().pollFailing).toMatchObject({ reason: expect.stringMatching(/^auth/) });
    expect(fake.openStreams()).toBe(0);
    clock.advance(59_999);
    await flush();
    expect(fake.openStreams()).toBe(0);
    clock.advance(1);
    await flush();
    expect(fake.openStreams()).toBe(1);
    expect(conn.status().pollFailing).toBeDefined();
    fake.beat();
    expect(conn.status().pollFailing).toBeUndefined();
  });

  it("a retryable failure reopens after the backoff", async () => {
    fake.fail(new PhotonError("retry", "unavailable", "Photon did not answer"));
    expect(conn.status().pollFailing).toBeDefined();
    expect(fake.openStreams()).toBe(0);
    clock.advance(5_000);
    await flush();
    expect(fake.openStreams()).toBe(1);
  });

  it("a pruned cursor sets gapAt and stays live", async () => {
    fake.gap();
    expect(conn.status().gapAt).toBe(new Date(clock.now()).toISOString());
    expect(fake.openStreams()).toBe(1);
    expect(lines.some((l) => /missed/.test(l))).toBe(true);
  });

  it("a number Photon moved stops the connector with movedAt", async () => {
    await conn.dispose();
    const link = fakePhotonLink({ project: PROJECT, users: [{ userId: "usr_1", phone: PHONE, line: "+14155559999" }] });
    const c = await started(make({ link, sequence: undefined }));
    expect(c.status().movedAt).toBeDefined();
    expect(c.status().polling).toBe(false);
    expect(link.openStreams()).toBe(0);
    expect(clock.pending()).toEqual([]);
  });

  it("a user Photon no longer has stops the connector with movedAt", async () => {
    const link = fakePhotonLink({ project: PROJECT, users: [] });
    const c = await started(make({ link, sequence: undefined }));
    expect(c.status().movedAt).toBeDefined();
    expect(link.openStreams()).toBe(0);
  });

  it("the line is checked again on a reopen", async () => {
    await conn.dispose();
    const users = [{ ...USER }];
    const link = fakePhotonLink({ project: PROJECT, users });
    const c = await started(make({ link }));
    expect(link.openStreams()).toBe(1);
    // the fake holds these user objects: Photon now names another line for the operator
    users[0]!.line = "+14155559999";
    link.fail(new PhotonError("retry", "unavailable", "Photon did not answer"));
    clock.advance(5_000);
    await flush();
    expect(c.status().movedAt).toBeDefined();
    expect(link.openStreams()).toBe(0);
  });

  it("a cursor file that is not a number is no cursor", () => {
    mkdirSync(identityDir(home), { recursive: true });
    writeFileSync(join(identityDir(home), IMESSAGE_CURSOR_FILE), "x\n");
    expect(ImessageConnector.resumeFrom(home)).toBeUndefined();
  });

  it("dispose closes the stream and leaves no wait", async () => {
    await conn.dispose();
    expect(fake.openStreams()).toBe(0);
    expect(clock.pending()).toEqual([]);
    expect(conn.status().polling).toBe(false);
  });
});
