/** SENDING ON IMESSAGE (identity/imessage.ts ImessageTransport, identity.ts): every iMessage send is written to the outbox before Photon is
 * called, cut into parts once, each part sent under its own id (`<row id>:<n>`, Photon's clientMessageId) and taken off the row as it goes —
 * so a restart sends what is left under the same ids, never re-cutting the row. A duplicate part counts as sent; a late row carries the late
 * line in its first part; Photon refusing the operator's number records identity/imessage.refused and drops the row; an auth failure drops
 * it and marks the status failing. Telegram's sends keep today's path: nothing written ahead. Everything runs on the in-memory fake link
 * and a held clock, in a temp home. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Identity, IMESSAGE_REFUSED_FILE, type IdentityView, type Transport } from "../../src/portfolio/identity/identity.ts";
import { ImessageTransport } from "../../src/portfolio/identity/imessage.ts";
import { emptyRouting } from "../../src/portfolio/identity/kinds.ts";
import { PhotonError, type PhotonUser } from "../../src/portfolio/identity/photon-link.ts";
import { writeNetworkSecret, type ImessageSecret } from "../../src/portfolio/identity/secret-file.ts";
import { identityDir, saveIdentity, type Binding } from "../../src/portfolio/identity/store.ts";
import type { IdentityClock } from "../../src/portfolio/identity/telegram.ts";
import { fakePhotonLink, type FakePhoton } from "../identity-fakes.ts";

const PHONE = "+14155550100";
const LINE = "+14155550123";
const PROJECT = { projectId: "prj_1", secret: "photon-secret-for-tests" };
const USER: PhotonUser = { userId: "usr_1", phone: PHONE, line: LINE };
const SECRET: ImessageSecret = { projectId: PROJECT.projectId, projectSecret: PROJECT.secret, phone: PHONE, line: LINE, userId: "usr_1", operatorId: PHONE, operatorHandle: PHONE };
const BINDING: Binding = { network: "imessage", speaksAs: LINE, botId: `${PROJECT.projectId}:${LINE}`, talksOnlyWith: PHONE, operatorId: PHONE, since: "2026-11-09T00:00:00.000Z", fingerprint: "f".repeat(64) };
const TELEGRAM: Binding = { network: "telegram", speaksAs: "@gravit_bot", botId: "7000000001", talksOnlyWith: "@pan", operatorId: "555000123", since: "2026-11-09T00:00:00.000Z", fingerprint: "e".repeat(64) };
/** 10:00 in New York: outside the default quiet hours (they are off here all the same) */
const START = Date.parse("2026-11-09T15:00:00.000Z");
const ROW_ID = /^[0-9a-f]{16}$/;

function heldClock(start = START): IdentityClock & { advance(ms: number): void } {
  let now = start;
  let n = 0;
  const waits = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      const h = ++n;
      waits.set(h, { at: now + ms, fn });
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
  };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
const readOutbox = (home: string): Array<Record<string, unknown>> => {
  try {
    return JSON.parse(readFileSync(join(identityDir(home), "outbox.json"), "utf8")) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
};
const imessageRow = (v: IdentityView) => v.networks.find((n) => n.network === "imessage")!;

describe("sending on iMessage", () => {
  let home: string;
  let fake: FakePhoton;
  let clock: ReturnType<typeof heldClock>;
  let lines: string[];
  const made: Identity[] = [];

  const make = (): Identity => {
    const i = new Identity({ home, apiBase: "http://127.0.0.1:9", photon: fake, clock, now: clock.now, log: (l) => lines.push(l) });
    made.push(i);
    return i;
  };
  const boot = (bindings: Binding[] = [BINDING]) => {
    const routing = emptyRouting();
    routing.alerts = bindings.map((b) => b.network).sort();
    saveIdentity(home, { bindings, routing, quiet: null, blocked: [] });
    expect(writeNetworkSecret(home, "imessage", SECRET)).toMatchObject({ ok: true });
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "imessage-send-"));
    fake = fakePhotonLink({ project: PROJECT, users: [USER] });
    clock = heldClock();
    lines = [];
    boot();
  });
  afterEach(async () => {
    for (const i of made.splice(0)) await i.dispose();
    rmSync(home, { recursive: true, force: true });
  });

  it("an iMessage send is in outbox.json before Photon is called", async () => {
    const identity = make();
    await settle();
    const seenAtSend: unknown[] = [];
    const send = fake.sendText.bind(fake);
    fake.sendText = async (p, to, text, id) => {
      seenAtSend.push(readOutbox(home));
      return send(p, to, text, id);
    };
    const a = await identity.send({ kind: "alert", text: "NVDA is down 6%" });
    expect(seenAtSend[0]).toMatchObject([{ network: "imessage", kind: "alert", text: "NVDA is down 6%", parts: ["NVDA is down 6%"], next: 0 }]);
    expect((seenAtSend[0] as Array<{ id: string }>)[0]!.id).toMatch(ROW_ID);
    expect(fake.sent).toEqual([{ to: PHONE, text: "NVDA is down 6%", clientMessageId: `${(seenAtSend[0] as Array<{ id: string }>)[0]!.id}:0` }]);
    expect(a).toMatchObject({ ok: true, sent: [expect.stringMatching(/^imessage:[0-9A-F-]{36}$/)] });
    expect(a).not.toHaveProperty("queued");
    expect(readOutbox(home)).toEqual([]);
  });

  it("the parts carry <row id>:<n> as clientMessageId", async () => {
    const identity = make();
    await settle();
    let rowId = "";
    const send = fake.sendText.bind(fake);
    fake.sendText = async (p, to, text, id) => {
      rowId ||= String(readOutbox(home)[0]!.id);
      return send(p, to, text, id);
    };
    const a = await identity.send({ kind: "alert", text: `${"a".repeat(3_000)}\n${"b".repeat(3_000)}` });
    expect(fake.sent.map((s) => s.clientMessageId)).toEqual([`${rowId}:0`, `${rowId}:1`]);
    expect(fake.sent.map((s) => s.text.length)).toEqual([3_001, 3_000]);
    expect(a).toMatchObject({ ok: true, sent: [expect.stringMatching(/^imessage:/), expect.stringMatching(/^imessage:/)] });
  });

  it("a restart mid-send sends the rest under the same ids and never re-cuts the row", async () => {
    const first = make();
    await settle();
    const send = fake.sendText.bind(fake);
    let n = 0;
    fake.sendText = async (p, to, text, id) => {
      n += 1;
      if (n === 2) throw new PhotonError("retry", "serviceUnavailable", "Photon asks to try again later (serviceUnavailable)");
      return send(p, to, text, id);
    };
    const body = `${"a".repeat(3_900)}\n${"b".repeat(3_900)}\n${"c".repeat(100)}`;
    const a = await first.send({ kind: "alert", text: body });
    expect(a).toMatchObject({ ok: true, sent: [expect.stringMatching(/^imessage:/)], queued: true });
    const [row] = readOutbox(home);
    const rowId = String(row!.id);
    expect(row).toMatchObject({ network: "imessage", next: 1, parts: [`${"b".repeat(3_900)}\n`, "c".repeat(100)] });
    await first.dispose();
    fake.sendText = send;
    make();
    await settle();
    clock.advance(0);
    await settle();
    expect(fake.sent.map((s) => s.clientMessageId)).toEqual([`${rowId}:0`, `${rowId}:1`, `${rowId}:2`]);
    expect(fake.sent.map((s) => s.text)).toEqual([`${"a".repeat(3_900)}\n`, `${"b".repeat(3_900)}\n`, "c".repeat(100)]);
    expect(readOutbox(home)).toEqual([]);
  });

  it("a retry arms the flush timer, which sends the rest", async () => {
    const identity = make();
    await settle();
    fake.failNextSend(new PhotonError("retry", "serviceUnavailable", "Photon asks to try again later (serviceUnavailable)"));
    expect(await identity.send({ kind: "alert", text: "x" })).toEqual({ ok: true, queued: true });
    expect(readOutbox(home)).toHaveLength(1);
    clock.advance(30_000);
    await settle();
    expect(fake.sent.map((s) => s.text)).toEqual(["x"]);
    expect(readOutbox(home)).toEqual([]);
  });

  it("a duplicate part counts as sent", async () => {
    const identity = make();
    await settle();
    fake.duplicateNextSend();
    const a = await identity.send({ kind: "alert", text: "x" });
    expect(a).toEqual({ ok: true, sent: [] });
    expect(fake.sent).toHaveLength(1);
    expect(readOutbox(home)).toEqual([]);
  });

  it("a late row carries the late line in its first part", async () => {
    const t = new Date(START - 5 * 60_000).toISOString();
    writeFileSync(join(identityDir(home), "outbox.json"), JSON.stringify([{ t, network: "imessage", kind: "alert", text: "late news", id: "0123456789abcdef", parts: ["late news"], next: 0 }]));
    make();
    await settle();
    clock.advance(0);
    await settle();
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.text.startsWith("(written ")).toBe(true);
    expect(fake.sent[0]!.text.endsWith("\nlate news")).toBe(true);
    expect(fake.sent[0]!.clientMessageId).toBe("0123456789abcdef:0");
  });

  it("a late line that does not fit beside the first part goes alone first, as <row id>:late", async () => {
    const t = new Date(START - 5 * 60_000).toISOString();
    const full = "z".repeat(4_000);
    writeFileSync(join(identityDir(home), "outbox.json"), JSON.stringify([{ t, network: "imessage", kind: "alert", text: full, id: "0123456789abcdef", parts: [full], next: 0 }]));
    make();
    await settle();
    clock.advance(0);
    await settle();
    expect(fake.sent.map((s) => s.clientMessageId)).toEqual(["0123456789abcdef:late", "0123456789abcdef:0"]);
    expect(fake.sent[0]!.text.startsWith("(written ")).toBe(true);
    expect(fake.sent[1]!.text).toBe(full);
  });

  it("Photon refusing the number records identity/imessage.refused and drops the row", async () => {
    const identity = make();
    await settle();
    fake.failNextSend(new PhotonError("refused", "addressNotFound", "Photon refused the message (addressNotFound)"));
    const a = await identity.send({ kind: "alert", text: "x" });
    expect(a).toMatchObject({ ok: false });
    expect(readFileSync(join(home, "identity", IMESSAGE_REFUSED_FILE), "utf8")).toBe(LINE);
    expect(readOutbox(home)).toEqual([]);
  });

  it("an auth failure drops the row and marks the status failing", async () => {
    const identity = make();
    await settle();
    fake.failNextSend(new PhotonError("auth", "tokenBlocked", "Photon refused the project"));
    await identity.send({ kind: "alert", text: "x" });
    expect(readOutbox(home)).toEqual([]);
    expect(imessageRow(identity.view()).pollFailing).toBeDefined();
  });

  it("a Telegram send is still not written ahead", async () => {
    boot([BINDING, TELEGRAM]);
    const identity = make();
    await settle();
    let outboxAtTelegramSend: unknown;
    const fakeTelegram: Transport = {
      network: "telegram",
      secrets: [],
      partMax: 4_096,
      send: async () => {
        outboxAtTelegramSend = readOutbox(home);
        return "telegram:41";
      },
      classify: () => "retry",
      dispose: () => {},
    };
    (identity as unknown as { transports: Map<string, Transport> }).transports.set("telegram", fakeTelegram);
    const a = await identity.send({ kind: "alert", text: "x" });
    expect(outboxAtTelegramSend).toEqual([]);
    expect(a).toMatchObject({ ok: true, sent: expect.arrayContaining(["telegram:41", expect.stringMatching(/^imessage:/)]) });
  });
});

describe("the iMessage transport", () => {
  it("refuses a part with no id, and classifies Photon's failures", async () => {
    const fake = fakePhotonLink({ project: PROJECT, users: [USER] });
    const said: string[] = [];
    const t = new ImessageTransport({ link: fake, secret: SECRET, refusedLine: (l) => said.push(l) });
    expect(t.network).toBe("imessage");
    expect(t.partMax).toBe(4_000);
    expect(t.secrets).toContain(PROJECT.secret);
    await expect(t.send("x")).rejects.toThrow();
    expect(fake.sent).toEqual([]);
    expect(t.classify(new PhotonError("retry", "timeout", "later"))).toBe("retry");
    expect(t.classify(new PhotonError("auth", "unauthenticated", "no"))).toBe("auth");
    expect(t.classify(new PhotonError("refused", "invalidArgument", "no"))).toBe("refused");
    expect(t.classify(new PhotonError("limit", "402", "no"))).toBe("refused");
    expect(t.classify(new Error("boom"))).toBe("refused");
    fake.failNextSend(new PhotonError("refused", "invalidArgument", "Photon refused the message (invalidArgument)"));
    await expect(t.send("x", undefined, "r:0")).rejects.toThrow();
    expect(said).toEqual([]);
    for (const code of ["chatNotFound", "recipientLocked"]) {
      fake.failNextSend(new PhotonError("refused", code, `Photon refused the message (${code})`));
      await expect(t.send("x", undefined, "r:0")).rejects.toThrow();
    }
    fake.failNextSend(new PhotonError("refused", "permissionDenied", "Target not allowed for this project"));
    await expect(t.send("x", undefined, "r:0")).rejects.toThrow();
    expect(said).toEqual([LINE, LINE, LINE]);
    fake.duplicateNextSend();
    expect(await t.send("x", undefined, "r:1")).toBe("");
  });
});
