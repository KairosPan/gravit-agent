/** THE PHOTON SEAM AND ITS FAKE (identity/photon-link.ts, test/identity-fakes.ts): the in-memory link every iMessage test runs through
 * must refuse a wrong secret, deliver stream events in order and wait for each handler, and answer sends the way Photon does. */
import { beforeEach, describe, expect, it } from "vitest";
import { dmChat, E164, isGroupChat, PhotonError, type PhotonEvent } from "../../src/portfolio/identity/photon-link.ts";
import { fakePhotonLink, type FakePhoton } from "../identity-fakes.ts";

const p = { projectId: "prj_1", secret: "photon-secret-for-tests" };
const ev = (sequence: number): PhotonEvent => ({ type: "other", sequence });

describe("the Photon fake", () => {
  let fake: FakePhoton;
  beforeEach(() => {
    fake = fakePhotonLink({ project: p });
  });

  it("the fake refuses a wrong secret as auth", async () => {
    await expect(fake.checkProject({ projectId: "prj_1", secret: "wrong" })).rejects.toMatchObject({ kind: "auth" });
    await expect(fake.addUser({ projectId: "prj_1", secret: "wrong" }, "+14155550100")).rejects.toBeInstanceOf(PhotonError);
  });

  it("the fake's stream delivers in order and waits for each handler", async () => {
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    fake.stream(p, 7, {
      async event(e) {
        const n = (e as { sequence: number }).sequence;
        order.push(`start:${n}`);
        if (n === 1) await held;
        order.push(`end:${n}`);
      },
      heartbeat: () => {},
      gap: () => {},
      failed: () => {},
    });
    expect(fake.lastSince()).toBe(7);
    const pushed = fake.push(ev(1)).then(() => fake.push(ev(2)));
    await Promise.resolve();
    expect(order).toEqual(["start:1"]);
    release();
    await pushed;
    expect(order).toEqual(["start:1", "end:1", "start:2", "end:2"]);
  });

  it("unawaited pushes still run one handler at a time", async () => {
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    fake.stream(p, undefined, {
      async event(e) {
        const n = (e as { sequence: number }).sequence;
        order.push(`start:${n}`);
        if (n === 1) await held;
        order.push(`end:${n}`);
      },
      heartbeat: () => {},
      gap: () => {},
      failed: () => {},
    });
    const a = fake.push(ev(1));
    const b = fake.push(ev(2));
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(["start:1"]);
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(["start:1", "end:1", "start:2", "end:2"]);
  });

  it("openStreams counts every stream not yet closed", async () => {
    const got: number[] = [];
    const h = { event: async (e: PhotonEvent) => void got.push((e as { sequence: number }).sequence), heartbeat: () => {}, gap: () => {}, failed: () => {} };
    const s1 = fake.stream(p, undefined, h);
    const s2 = fake.stream(p, undefined, h);
    expect(fake.openStreams()).toBe(2);
    await s2.close();
    expect(fake.openStreams()).toBe(1);
    await fake.push(ev(9));
    expect(got).toEqual([9]);
    await s1.close();
    expect(fake.openStreams()).toBe(0);
  });

  it("a rejecting handler does not poison later pushes", async () => {
    let n = 0;
    fake.stream(p, undefined, {
      event: async () => {
        if (++n === 1) throw new Error("boom");
      },
      heartbeat: () => {},
      gap: () => {},
      failed: () => {},
    });
    await expect(fake.push(ev(1))).rejects.toThrow("boom");
    await expect(fake.push(ev(2))).resolves.toBeUndefined();
  });

  it("beat, gap and fail reach the open stream; close drops it", async () => {
    const seen: string[] = [];
    const s = fake.stream(p, undefined, {
      event: async () => {},
      heartbeat: (at) => seen.push(`beat:${at}`),
      gap: () => seen.push("gap"),
      failed: (e) => seen.push(`failed:${e.kind}`),
    });
    expect(fake.openStreams()).toBe(1);
    fake.beat(5);
    fake.gap();
    fake.fail(new PhotonError("retry", "x", "later"));
    expect(seen).toEqual(["beat:5", "gap", "failed:retry"]);
    await s.close();
    expect(fake.openStreams()).toBe(0);
  });

  it("users: add, find, get and remove over the in-memory list", async () => {
    const u = await fake.addUser(p, "+14155550100");
    expect(u).toMatchObject({ userId: "usr_1", phone: "+14155550100" });
    expect(E164.test(u.line)).toBe(true);
    expect(await fake.findUser(p, "+14155550100")).toEqual(u);
    expect(await fake.getUser(p, "usr_1")).toEqual(u);
    await fake.removeUser(p, "usr_1");
    expect(await fake.findUser(p, "+14155550100")).toBeUndefined();
    expect(fake.calls).toEqual(["addUser:+14155550100", "findUser:+14155550100", "getUser:usr_1", "removeUser:usr_1", "findUser:+14155550100"]);
  });

  it("sends are recorded and answer a GUID; failNextSend and duplicateNextSend apply once", async () => {
    const a = await fake.sendText(p, "+14155550100", "hi", "r0:0");
    expect(a).toMatchObject({ guid: expect.stringMatching(/^[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}$/) });
    fake.duplicateNextSend();
    expect(await fake.sendText(p, "+14155550100", "hi", "r1:0")).toEqual({ duplicate: true });
    fake.failNextSend(new PhotonError("limit", "rate", "slow down", 1000));
    await expect(fake.sendText(p, "+14155550100", "x", "r2:0")).rejects.toMatchObject({ kind: "limit", retryAfterMs: 1000 });
    expect(await fake.sendText(p, "+14155550100", "y", "r3:0")).toHaveProperty("guid");
    expect(fake.sent.map((s) => s.clientMessageId)).toEqual(["r0:0", "r1:0", "r3:0"]);
  });

  it("chat helpers", () => {
    expect(dmChat("+14155550100")).toBe("any;-;+14155550100");
    expect(isGroupChat("iMessage;+;chat1")).toBe(true);
    expect(isGroupChat(dmChat("+14155550100"))).toBe(false);
  });
});
