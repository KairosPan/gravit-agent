/** THE REAL PHOTON LINK (identity/photon-real.ts): Photon's REST calls for the project, its users and the line token, and the
 * advanced-imessage gRPC client for the event stream and the send — run here against a fake fetch, a fake client and a held clock, never
 * the network. */
import { IMessageError, RateLimitError, ValidationError } from "@photon-ai/advanced-imessage/grpc";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PhotonError, type PhotonEvent, type PhotonLink, type PhotonStreamHandlers } from "../../src/portfolio/identity/photon-link.ts";
import { realPhotonLink, type PhotonImClient } from "../../src/portfolio/identity/photon-real.ts";
import type { IdentityClock } from "../../src/portfolio/identity/telegram.ts";
import { basicOf } from "../../src/portfolio/identity/secret-file.ts";

const secret = "photon-secret-for-tests";
const p = { projectId: "prj_1", secret };
const API = "https://spectrum.photon.codes";

/** a clock whose time moves only when the test says so */
function heldClock() {
  let t = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  const clock: IdentityClock & { advance(ms: number): void } = {
    now: () => t,
    setTimeout(fn, ms) {
      const id = next++;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clearTimeout(h) {
      timers = timers.filter((x) => x.id !== h);
    },
    advance(ms) {
      t += ms;
      const due = timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at);
      timers = timers.filter((x) => x.at > t);
      for (const d of due) d.fn();
    },
  };
  return clock;
}

/** an async iterable the test pushes into, closable like a TypedEventStream */
function pushStream() {
  const items: unknown[] = [];
  let ended = false;
  let error: unknown;
  let failedOnce = false;
  let wake: (() => void) | undefined;
  const poke = () => {
    const w = wake;
    wake = undefined;
    w?.();
  };
  const s = {
    closed: false,
    push(e: unknown) {
      items.push(e);
      poke();
    },
    fail(e: unknown) {
      error = e;
      failedOnce = true;
      poke();
    },
    async close() {
      s.closed = true;
      ended = true;
      poke();
    },
    [Symbol.asyncIterator]() {
      return {
        next: async (): Promise<IteratorResult<unknown>> => {
          for (;;) {
            if (items.length) return { value: items.shift(), done: false };
            if (failedOnce) throw error;
            if (ended) return { value: undefined, done: true };
            await new Promise<void>((r) => (wake = r));
          }
        },
        return: async (): Promise<IteratorResult<unknown>> => {
          s.closed = true;
          return { value: undefined, done: true };
        },
      };
    },
  };
  return s;
}
type Push = ReturnType<typeof pushStream>;

interface Seen {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (data: unknown): Response => json(200, { succeed: true, data });
const user = (id: string, phone: string, line: string) => ({
  id,
  projectId: "prj_1",
  type: "shared",
  firstName: null,
  lastName: null,
  email: null,
  phoneNumber: phone,
  assignedPhoneNumber: line,
  meta: null,
  createdAt: "2026-11-09T00:00:00Z",
});

/** a message.received event as advanced-imessage decodes it */
const received = (sequence: number, over: Record<string, unknown> = {}, msg: Record<string, unknown> = {}) => ({
  type: "message.received",
  sequence,
  chatGuid: "any;-;+14155550100",
  isFromMe: false,
  occurredAt: new Date(0),
  actor: { address: "+14155550100", service: "iMessage" },
  ...over,
  message: {
    guid: `G${sequence}`,
    itemType: "normal",
    isFromMe: false,
    sender: { address: "+14155550100", service: "iMessage" },
    content: { attachments: [], formatting: [], mentions: [], text: `t${sequence}` },
    ...msg,
  },
});
const other = (sequence: number) => ({ type: "message.read", sequence, chatGuid: "c", isFromMe: false, occurredAt: new Date(0), messageGuid: "x", readAt: new Date(0) });

const imError = (Cls: typeof IMessageError, code: string, extra: Record<string, unknown> = {}) =>
  new Cls(`server said ${code}`, { code: code as never, grpcCode: 0, retryable: false, ...extra });

describe("the real Photon link", () => {
  let seen: Seen[];
  let route: (s: Seen) => Response | Promise<Response>;
  let clock: ReturnType<typeof heldClock>;
  let mints: number;
  let tokens: string[];
  let expiresIn: number;
  let lives: Push[];
  let clients: { token: string; address: string; tls: boolean; closed: boolean }[];
  let catchUpSince: (number | undefined)[];
  let catchUp: (since: number | undefined, live: Push) => AsyncIterable<unknown>;
  let send: (chat: string, text: string, o: { clientMessageId: string }) => Promise<{ guid: string }>;
  let sends: { chat: string; text: string; clientMessageId: string; token: string }[];
  let link: PhotonLink;
  let logs: string[];

  const fetchFake = (async (input: string | URL | Request, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    const s: Seen = {
      url: String(input),
      method: init?.method ?? "GET",
      auth: h.get("authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    seen.push(s);
    if (s.method === "POST" && s.url === `${API}/projects/prj_1/imessage/tokens`) {
      mints++;
      const token = `line-token-${mints}`;
      tokens.push(token);
      return ok({ type: "shared", token, expiresIn });
    }
    return route(s);
  }) as typeof fetch;

  const createClient = (o: { address: string; token: string; tls: boolean }): PhotonImClient => {
    const c = { ...o, closed: false };
    clients.push(c);
    return {
      messages: {
        subscribeEvents: ({ onHeartbeat }) => {
          const live = pushStream();
          (live as Push & { heartbeat?: () => void }).heartbeat = onHeartbeat;
          lives.push(live);
          return live;
        },
        sendText: async (chat, text, so) => {
          sends.push({ chat, text, clientMessageId: so.clientMessageId, token: o.token });
          return send(chat, text, so);
        },
      },
      events: {
        catchUp: (since) => {
          catchUpSince.push(since);
          const src = catchUp(since, lives.at(-1)!);
          const it = src[Symbol.asyncIterator]();
          const s = {
            closed: false,
            [Symbol.asyncIterator]: () => it,
            close: async () => {
              s.closed = true;
              await it.return?.();
            },
          };
          return s;
        },
      },
      close: async () => {
        c.closed = true;
      },
    };
  };

  function handlers() {
    const handled: number[] = [];
    const events: PhotonEvent[] = [];
    const failures: PhotonError[] = [];
    let gaps = 0;
    const beats: number[] = [];
    const h: PhotonStreamHandlers = {
      async event(e) {
        events.push(e);
        handled.push(e.type === "message" ? e.message.sequence : e.sequence);
      },
      heartbeat: (at) => beats.push(at),
      gap: () => void gaps++,
      failed: (err) => failures.push(err),
    };
    return { h, handled, events, failures, beats, gaps: () => gaps };
  }

  beforeEach(() => {
    seen = [];
    route = () => json(404, { succeed: false, error: "no route" });
    clock = heldClock();
    mints = 0;
    tokens = [];
    expiresIn = 3600;
    lives = [];
    clients = [];
    catchUpSince = [];
    catchUp = async function* () {
      yield { type: "catchup.complete", headSequence: 0 };
    };
    send = async () => ({ guid: "out-1" });
    sends = [];
    logs = [];
    link = realPhotonLink({ fetch: fetchFake, createClient, clock, log: (l) => logs.push(l) });
  });

  describe("REST", () => {
    it("checkProject sends Basic auth to /projects/{id}/ and maps 401 to auth", async () => {
      route = () => json(401, { succeed: false });
      await expect(link.checkProject(p)).rejects.toMatchObject({ kind: "auth" });
      expect(seen[0]).toMatchObject({ url: `${API}/projects/prj_1/`, method: "GET", auth: `Basic ${basicOf("prj_1", secret)}` });
    });

    it("a 404 on the project itself is auth; a shared project passes", async () => {
      route = () => json(404, { succeed: false });
      await expect(link.checkProject(p)).rejects.toMatchObject({ kind: "auth" });
      route = (s) => (s.url.endsWith("/imessage/") ? ok({ type: "shared" }) : ok({ id: "prj_1" }));
      await expect(link.checkProject(p)).resolves.toBeUndefined();
      expect(seen.slice(-2).map((s) => s.url)).toEqual([`${API}/projects/prj_1/`, `${API}/projects/prj_1/imessage/`]);
    });

    it("a dedicated project is refused", async () => {
      route = (s) => (s.url.endsWith("/imessage/") ? ok({ type: "dedicated" }) : ok({ id: "prj_1" }));
      await expect(link.checkProject(p)).rejects.toMatchObject({ kind: "refused", code: "dedicated" });
    });

    it("findUser finds the user whose phoneNumber is the phone", async () => {
      route = () => ok({ users: [user("usr_0", "+14155550199", "+14155550123"), user("usr_1", "+14155550100", "+14155550123")], total: 2 });
      expect(await link.findUser(p, "+14155550100")).toEqual({ userId: "usr_1", phone: "+14155550100", line: "+14155550123" });
      expect(await link.findUser(p, "+14155550111")).toBeUndefined();
      expect(seen[0]!.url.startsWith(`${API}/projects/prj_1/users/`)).toBe(true);
      expect(seen[0]!.method).toBe("GET");
    });

    it("findUser reads every page of users", async () => {
      route = (s) => {
        const offset = Number(new URL(s.url).searchParams.get("offset") ?? 0);
        const users = offset === 0 ? Array.from({ length: 500 }, (_, i) => user(`usr_${i}`, `+1415555${String(i).padStart(4, "0")}`, "+14155550123")) : [user("usr_x", "+19995550100", "+14155550123")];
        return ok({ users, total: 501 });
      };
      expect(await link.findUser(p, "+19995550100")).toEqual({ userId: "usr_x", phone: "+19995550100", line: "+14155550123" });
      expect(seen).toHaveLength(2);
    });

    it("getUser reads one user; a 404 is undefined", async () => {
      route = (s) => (s.url === `${API}/projects/prj_1/users/usr_1/` ? ok(user("usr_1", "+14155550100", "+14155550123")) : json(404, { succeed: false }));
      expect(await link.getUser(p, "usr_1")).toEqual({ userId: "usr_1", phone: "+14155550100", line: "+14155550123" });
      expect(await link.getUser(p, "usr_2")).toBeUndefined();
    });

    it("addUser posts the shared registration and answers the assigned line; no free number is noNumber", async () => {
      let available = true;
      route = (s) => {
        if (s.url === `${API}/projects/prj_1/imessage/shared/availability`) return ok({ available });
        if (s.url === `${API}/projects/prj_1/users/` && s.method === "POST") return ok(user("usr_1", "+14155550100", "+14155550123"));
        return json(404, {});
      };
      expect(await link.addUser(p, "+14155550100")).toEqual({ userId: "usr_1", phone: "+14155550100", line: "+14155550123" });
      const bodies = seen.map((s) => s.body).filter((b) => b !== undefined);
      expect(bodies.at(-1)).toEqual({ type: "shared", phoneNumber: "+14155550100" });
      expect(seen.map((s) => s.method)).toEqual(["GET", "POST"]);
      available = false;
      const before = seen.length;
      await expect(link.addUser(p, "+14155550100")).rejects.toMatchObject({ kind: "noNumber" });
      expect(seen.slice(before).map((s) => s.method)).toEqual(["GET"]);
    });

    it("402, 409 and 422 on addUser are limit", async () => {
      for (const status of [402, 409, 422]) {
        route = (s) => (s.method === "POST" ? json(status, { succeed: false }) : ok({ available: true }));
        await expect(link.addUser(p, "+14155550100")).rejects.toMatchObject({ kind: "limit", code: String(status) });
      }
    });

    it("removeUser deletes the user", async () => {
      route = () => ok({});
      await link.removeUser(p, "usr_1");
      expect(seen[0]).toMatchObject({ url: `${API}/projects/prj_1/users/usr_1/`, method: "DELETE" });
    });

    it("429, a 5xx and a network failure are retry; 403 is auth; anything else is refused", async () => {
      route = () => json(429, {});
      await expect(link.getUser(p, "usr_1")).rejects.toMatchObject({ kind: "retry", code: "429" });
      route = () => json(503, {});
      await expect(link.getUser(p, "usr_1")).rejects.toMatchObject({ kind: "retry", code: "503" });
      route = () => {
        throw new TypeError("fetch failed");
      };
      await expect(link.getUser(p, "usr_1")).rejects.toMatchObject({ kind: "retry" });
      route = () => json(403, {});
      await expect(link.getUser(p, "usr_1")).rejects.toMatchObject({ kind: "auth" });
      route = () => json(400, {});
      await expect(link.getUser(p, "usr_1")).rejects.toMatchObject({ kind: "refused", code: "400" });
      route = () => json(409, {});
      await expect(link.removeUser(p, "usr_1")).rejects.toMatchObject({ kind: "refused" });
    });

    it("the message is fixed words and the status, never the response body", async () => {
      route = () => json(400, { succeed: false, error: "body-words-that-must-not-leak" });
      const e = await link.getUser(p, "usr_1").catch((x: unknown) => x);
      expect(e).toBeInstanceOf(PhotonError);
      expect(String((e as Error).message)).toContain("400");
      expect(String((e as Error).message)).not.toContain("body-words");
    });

    it("a PhotonError never carries the secret or the token", async () => {
      const token = "line-token-1";
      route = () => {
        throw new Error(`boom ${secret} ${token}`);
      };
      const e = await link.checkProject(p).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(PhotonError);
      expect(String((e as Error).message)).not.toContain(secret);
      expect(String((e as Error).message)).not.toContain(token);
      send = async () => {
        throw new Error(`boom ${secret} ${token}`);
      };
      const s = await link.sendText(p, "+14155550100", "hi", "r1:0").catch((x: unknown) => x);
      expect(s).toMatchObject({ kind: "retry" });
      expect(String((s as Error).message)).not.toContain(secret);
      expect(String((s as Error).message)).not.toContain(tokens[0]!);
      expect(logs.join("\n")).not.toContain(secret);
      expect(logs.join("\n")).not.toContain(tokens[0]!);
    });
  });

  describe("the line token and the send", () => {
    it("sendText mints a token, opens the client over TLS and sends to the DM chat with the part id", async () => {
      expect(await link.sendText(p, "+14155550100", "hi", "r1:0")).toEqual({ guid: "out-1" });
      expect(clients).toEqual([{ address: "imessage.spectrum.photon.codes:443", token: "line-token-1", tls: true, closed: false }]);
      expect(sends).toEqual([{ chat: "any;-;+14155550100", text: "hi", clientMessageId: "r1:0", token: "line-token-1" }]);
      expect(seen.at(-1)).toMatchObject({ url: `${API}/projects/prj_1/imessage/tokens`, method: "POST", auth: `Basic ${basicOf("prj_1", secret)}` });
    });

    it("the held token serves until 80% of its life, then a new one is minted", async () => {
      expiresIn = 100;
      await link.sendText(p, "+14155550100", "a", "r1:0");
      clock.advance(79_999);
      await link.sendText(p, "+14155550100", "b", "r1:1");
      expect(mints).toBe(1);
      clock.advance(1);
      await link.sendText(p, "+14155550100", "c", "r1:2");
      expect(mints).toBe(2);
      expect(sends.map((s) => s.token)).toEqual(["line-token-1", "line-token-1", "line-token-2"]);
      expect(clients[0]!.closed).toBe(true);
    });

    it("a dedicated token answer is refused", async () => {
      const f = (async (input: string | URL | Request) => {
        seen.push({ url: String(input), method: "POST", auth: null, body: undefined });
        return ok({ type: "dedicated", auth: {}, numbers: {}, expiresIn: 60 });
      }) as typeof fetch;
      const l = realPhotonLink({ fetch: f, createClient, clock, log: () => {} });
      await expect(l.sendText(p, "+14155550100", "hi", "r1:0")).rejects.toMatchObject({ kind: "refused", code: "dedicated" });
    });

    it("a duplicateMessage send answers {duplicate: true}", async () => {
      send = async () => {
        throw imError(IMessageError, "duplicateMessage");
      };
      expect(await link.sendText(p, "+14155550100", "hi", "r1:0")).toEqual({ duplicate: true });
    });

    it("rate codes are retry with retryAfterMs", async () => {
      send = async () => {
        throw imError(RateLimitError, "burstRateExceeded", { retryable: true, retryAfter: 3000 });
      };
      await expect(link.sendText(p, "+14155550100", "hi", "r1:0")).rejects.toMatchObject({ kind: "retry", code: "burstRateExceeded", retryAfterMs: 3000 });
      send = async () => {
        throw imError(RateLimitError, "dailyLimitExceeded");
      };
      await expect(link.sendText(p, "+14155550100", "hi", "r1:0")).rejects.toMatchObject({ kind: "retry", code: "dailyLimitExceeded" });
    });

    it("auth codes are auth, refusal codes keep their code, and the rest retry", async () => {
      for (const code of ["unauthenticated", "tokenBlocked", "unauthorized"]) {
        send = async () => {
          throw imError(IMessageError, code);
        };
        await expect(link.sendText(p, "+14155550100", "hi", "r1:0")).rejects.toMatchObject({ kind: "auth", code });
      }
      for (const code of ["addressNotFound", "chatNotFound", "recipientLocked", "invalidArgument", "preconditionFailed", "operationNotSupported"]) {
        send = async () => {
          throw imError(IMessageError, code);
        };
        await expect(link.sendText(p, "+14155550100", "hi", "r1:0")).rejects.toMatchObject({ kind: "refused", code });
      }
      for (const code of ["tokenExpired", "serviceUnavailable", "timeout", "networkError", "internalError"]) {
        send = async () => {
          throw imError(IMessageError, code);
        };
        await expect(link.sendText(p, "+14155550100", "hi", "r1:0")).rejects.toMatchObject({ kind: "retry", code });
      }
      send = async () => {
        throw imError(IMessageError, "databaseError", { retryable: true });
      };
      await expect(link.sendText(p, "+14155550100", "hi", "r1:0")).rejects.toMatchObject({ kind: "retry", code: "databaseError" });
      const e = await link.sendText(p, "+14155550100", "hi", "r1:0").catch((x: unknown) => x);
      expect(String((e as Error).message)).not.toContain("server said");
    });

    it("an expired token is minted again on the next send", async () => {
      send = async () => {
        throw imError(IMessageError, "tokenExpired");
      };
      await expect(link.sendText(p, "+14155550100", "hi", "r1:0")).rejects.toMatchObject({ kind: "retry" });
      send = async () => ({ guid: "out-2" });
      expect(await link.sendText(p, "+14155550100", "hi", "r1:0")).toEqual({ guid: "out-2" });
      expect(mints).toBe(2);
    });
  });

  describe("the stream", () => {
    it("with no cursor it goes live at once, maps each event and reports heartbeats", async () => {
      const r = handlers();
      link.stream(p, undefined, r.h);
      await vi.waitFor(() => expect(lives).toHaveLength(1));
      expect(catchUpSince).toEqual([]);
      clock.advance(5);
      (lives[0] as Push & { heartbeat: () => void }).heartbeat();
      expect(r.beats).toEqual([5]);
      lives[0]!.push(received(1));
      lives[0]!.push(other(2));
      await vi.waitFor(() => expect(r.handled).toEqual([1, 2]));
      expect(r.events[0]).toEqual({
        type: "message",
        message: { sequence: 1, guid: "G1", chatGuid: "any;-;+14155550100", from: "+14155550100", service: "iMessage", fromMe: false, text: "t1", nonText: false },
      });
      expect(r.events[1]).toEqual({ type: "other", sequence: 2 });
    });

    it("map: the actor when there is no sender, attachments and other kinds are nonText, and replyTo", async () => {
      const r = handlers();
      link.stream(p, undefined, r.h);
      await vi.waitFor(() => expect(lives).toHaveLength(1));
      lives[0]!.push(received(1, { actor: { address: "me@example.com", service: "SMS" }, isFromMe: true }, { sender: undefined, replyTargetGuid: "G0" }));
      lives[0]!.push(received(2, {}, { content: { attachments: [{ guid: "a" }], formatting: [], mentions: [] } }));
      lives[0]!.push(received(3, {}, { itemType: "groupNameChange" }));
      await vi.waitFor(() => expect(r.handled).toEqual([1, 2, 3]));
      const msgs = r.events.map((e) => (e.type === "message" ? e.message : undefined));
      expect(msgs[0]).toMatchObject({ from: "me@example.com", service: "SMS", fromMe: true, replyTo: "G0", nonText: false });
      expect(msgs[1]).toMatchObject({ nonText: true });
      expect(msgs[1]!.text).toBeUndefined();
      expect(msgs[2]).toMatchObject({ nonText: true });
    });

    it("catch-up then the buffered live, each sequence once", async () => {
      catchUp = async function* (_since, live) {
        yield received(6);
        live.push(received(7));
        live.push(received(8));
        yield received(7);
        yield { type: "catchup.complete", headSequence: 7 };
      };
      const r = handlers();
      link.stream(p, 5, r.h);
      await vi.waitFor(() => expect(r.handled).toEqual([6, 7, 8]));
      expect(catchUpSince).toEqual([5]);
      lives[0]!.push(received(8));
      lives[0]!.push(received(9));
      await vi.waitFor(() => expect(r.handled).toEqual([6, 7, 8, 9]));
    });

    it("a pruned cursor calls gap() and goes on live", async () => {
      catchUp = async function* (_since, live) {
        live.push(received(9));
        throw imError(ValidationError, "invalidArgument");
      };
      const r = handlers();
      link.stream(p, 3, r.h);
      await vi.waitFor(() => expect(r.handled).toEqual([9]));
      expect(r.gaps()).toBe(1);
      expect(r.failures).toEqual([]);
    });

    it("renewal reopens from the last delivered sequence", async () => {
      expiresIn = 100;
      catchUp = async function* (since) {
        if (since === 5) yield received(6);
        yield { type: "catchup.complete", headSequence: 6 };
      };
      const r = handlers();
      link.stream(p, 5, r.h);
      await vi.waitFor(() => expect(r.handled).toEqual([6]));
      lives[0]!.push(received(7));
      lives[0]!.push(received(8));
      await vi.waitFor(() => expect(r.handled).toEqual([6, 7, 8]));
      clock.advance(79_999);
      expect(mints).toBe(1);
      clock.advance(1);
      await vi.waitFor(() => expect(lives).toHaveLength(2));
      expect(mints).toBe(2);
      expect(lives[0]!.closed).toBe(true);
      expect(clients[0]!.closed).toBe(true);
      expect(clients[1]!.token).toBe("line-token-2");
      expect(catchUpSince.at(-1)).toBe(8);
      lives[1]!.push(received(9));
      await vi.waitFor(() => expect(r.handled).toEqual([6, 7, 8, 9]));
      expect(r.failures).toEqual([]);
    });

    it("a renewal during a slow handler waits for it, then catches up from the sequence it delivered", async () => {
      expiresIn = 100;
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const handled: number[] = [];
      const started: number[] = [];
      catchUp = async function* (since) {
        if (since === 8) yield received(8);
        yield { type: "catchup.complete", headSequence: 8 };
      };
      link.stream(p, undefined, {
        async event(e) {
          const n = e.type === "message" ? e.message.sequence : e.sequence;
          started.push(n);
          if (n === 8) await gate;
          handled.push(n);
        },
        heartbeat: () => {},
        gap: () => {},
        failed: () => {},
      });
      await vi.waitFor(() => expect(lives).toHaveLength(1));
      lives[0]!.push(received(8));
      await vi.waitFor(() => expect(started).toEqual([8]));
      clock.advance(80_000);
      await vi.waitFor(() => expect(mints).toBe(2));
      await new Promise((res) => setTimeout(res, 10));
      expect(catchUpSince).toEqual([]);
      release();
      await vi.waitFor(() => expect(catchUpSince).toEqual([8]));
      lives.at(-1)!.push(received(9));
      await vi.waitFor(() => expect(handled).toEqual([8, 9]));
      expect(started).toEqual([8, 9]);
    });

    it("an auth error on the live stream fails with auth, and the link never reopens by itself", async () => {
      const r = handlers();
      link.stream(p, undefined, r.h);
      await vi.waitFor(() => expect(lives).toHaveLength(1));
      lives[0]!.fail(imError(IMessageError, "unauthenticated"));
      await vi.waitFor(() => expect(r.failures).toHaveLength(1));
      expect(r.failures[0]).toMatchObject({ kind: "auth", code: "unauthenticated" });
      clock.advance(10 * 3600_000);
      await new Promise((res) => setTimeout(res, 10));
      expect(lives).toHaveLength(1);
      expect(mints).toBe(1);
    });

    it("any other error, or the stream ending, fails with retry", async () => {
      const a = handlers();
      link.stream(p, undefined, a.h);
      await vi.waitFor(() => expect(lives).toHaveLength(1));
      lives[0]!.fail(imError(IMessageError, "addressNotFound"));
      await vi.waitFor(() => expect(a.failures).toHaveLength(1));
      expect(a.failures[0]).toMatchObject({ kind: "retry" });

      const b = handlers();
      link.stream(p, undefined, b.h);
      await vi.waitFor(() => expect(lives).toHaveLength(2));
      lives[1]!.fail(new Error(`boom ${tokens[0]}`));
      await vi.waitFor(() => expect(b.failures).toHaveLength(1));
      expect(b.failures[0]).toMatchObject({ kind: "retry" });
      expect(b.failures[0]!.message).not.toContain(tokens[0]!);

      const c = handlers();
      link.stream(p, undefined, c.h);
      await vi.waitFor(() => expect(lives).toHaveLength(3));
      void lives[2]!.close();
      await vi.waitFor(() => expect(c.failures).toHaveLength(1));
      expect(c.failures[0]).toMatchObject({ kind: "retry" });
    });

    it("a token refused at open fails with auth", async () => {
      const f = (async () => json(401, {})) as typeof fetch;
      const l = realPhotonLink({ fetch: f, createClient, clock, log: () => {} });
      const r = handlers();
      l.stream(p, undefined, r.h);
      await vi.waitFor(() => expect(r.failures).toHaveLength(1));
      expect(r.failures[0]).toMatchObject({ kind: "auth" });
      expect(clients).toHaveLength(0);
    });

    it("close() stops the stream without failing it; dispose() closes the client", async () => {
      const r = handlers();
      const s = link.stream(p, undefined, r.h);
      await vi.waitFor(() => expect(lives).toHaveLength(1));
      await s.close();
      expect(lives[0]!.closed).toBe(true);
      await new Promise((res) => setTimeout(res, 10));
      expect(r.failures).toEqual([]);
      clock.advance(10 * 3600_000);
      expect(mints).toBe(1);
      await link.dispose();
      expect(clients[0]!.closed).toBe(true);
    });
  });
});
