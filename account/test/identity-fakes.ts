/** A FAKE TELEGRAM BOT API on this machine's loopback, for the identity tests: `/bot<token>/getMe`, `getUpdates` (the long poll held
 * until an update is pushed or its timeout passes) and `sendMessage`, each answered as the Bot API answers ({ok, result} or {ok: false,
 * error_code, description}); any other token is answered 401 Unauthorized, as Telegram answers a token it does not know. No test ever
 * reaches api.telegram.org: every token in the tests is made up, shaped like BotFather's. */
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

/** the token the fake knows: digits, a colon, then letters — the shape BotFather gives, made up for the tests */
export const FAKE_BOT_TOKEN = "7770001112:AAFakeTokenForTestsOnly_qzxwvkpmjhgfdsa";
/** another token of the same shape, one the fake does not know */
export const OTHER_BOT_TOKEN = "7770003334:AAAnotherFakeTokenForTests_lkjhgfdsamnb";

export interface FakeBotApi {
  url: string;
  me: { id: number; username: string; first_name: string };
  /** an update Telegram holds for the bot: a getUpdates waiting is answered at once */
  push(update: object): void;
  /** every sendMessage the bot was asked to send, in order */
  sent: Array<{ chat_id: number; text: string; reply_parameters?: object }>;
  /** every call made with the fake's token, by method, in order (the bodies as sent) */
  calls: Array<{ method: string; body: Record<string, unknown> }>;
  /** from now on, `method` is answered with `status` and `body` (as Telegram's JSON) instead of its own answer; status 0 restores it */
  answer(method: string, status: number, body: object): void;
  close(): Promise<void>;
}

export async function fakeBotApi(o: { token?: string; me?: FakeBotApi["me"] } = {}): Promise<FakeBotApi> {
  const token = o.token ?? FAKE_BOT_TOKEN;
  const me = o.me ?? { id: 777, username: "gravit_desk_bot", first_name: "Gravit" };
  const updates: Array<{ update_id: number } & Record<string, unknown>> = [];
  const waiting = new Set<() => void>();
  const overrides = new Map<string, { status: number; body: object }>();
  const sent: FakeBotApi["sent"] = [];
  const calls: FakeBotApi["calls"] = [];
  let nextMessageId = 1000;
  let closed = false;

  const reply = (res: ServerResponse, status: number, body: object) => {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve) => {
      let text = "";
      req.setEncoding("utf8");
      req.on("data", (c: string) => (text += c));
      req.on("end", () => {
        try {
          const v = text === "" ? {} : (JSON.parse(text) as unknown);
          resolve(v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
        } catch {
          resolve({});
        }
      });
      req.on("error", () => resolve({}));
    });

  const server = createServer(async (req, res) => {
    const m = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(req.url ?? "");
    const body = await readBody(req);
    if (!m) return reply(res, 404, { ok: false, error_code: 404, description: "Not Found" });
    if (decodeURIComponent(m[1]!) !== token) return reply(res, 401, { ok: false, error_code: 401, description: "Unauthorized" });
    const method = m[2]!;
    calls.push({ method, body });
    const override = overrides.get(method);
    if (override) return reply(res, override.status, override.body);
    if (method === "getMe") return reply(res, 200, { ok: true, result: { ...me, is_bot: true } });
    if (method === "sendMessage") {
      sent.push({ chat_id: Number(body.chat_id), text: String(body.text), ...(body.reply_parameters ? { reply_parameters: body.reply_parameters as object } : {}) });
      return reply(res, 200, { ok: true, result: { message_id: nextMessageId++, chat: { id: Number(body.chat_id) }, text: String(body.text) } });
    }
    if (method === "getUpdates") {
      const offset = typeof body.offset === "number" ? body.offset : undefined;
      const timeoutS = typeof body.timeout === "number" ? body.timeout : 0;
      const ready = () => updates.filter((u) => offset === undefined || u.update_id >= offset);
      // Telegram forgets the updates below the offset a poll confirms
      if (offset !== undefined) for (let i = updates.length - 1; i >= 0; i--) if (updates[i]!.update_id < offset) updates.splice(i, 1);
      if (ready().length > 0 || timeoutS <= 0 || closed) return reply(res, 200, { ok: true, result: ready() });
      let timer: NodeJS.Timeout | undefined;
      const done = () => {
        waiting.delete(done);
        if (timer) clearTimeout(timer);
        // an override set while the poll was held answers it, as Telegram would answer the next one
        const now = overrides.get("getUpdates");
        if (now) return reply(res, now.status, now.body);
        reply(res, 200, { ok: true, result: ready() });
      };
      timer = setTimeout(done, timeoutS * 1000);
      waiting.add(done);
      req.on("close", () => {
        waiting.delete(done);
        if (timer) clearTimeout(timer);
      });
      return;
    }
    return reply(res, 404, { ok: false, error_code: 404, description: "Not Found: method not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;
  const wakeAll = () => {
    for (const w of [...waiting]) w();
  };

  return {
    url: `http://127.0.0.1:${port}`,
    me,
    sent,
    calls,
    push(update) {
      updates.push(update as { update_id: number });
      wakeAll();
    },
    answer(method, status, body) {
      if (status === 0) overrides.delete(method);
      else overrides.set(method, { status, body });
      if (method === "getUpdates") wakeAll();
    },
    async close() {
      closed = true;
      wakeAll();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

/** four made-up Slack tokens, one of each kind the account meets — the app-level token, the bot token, a user token and a refresh token —
 * each shaped as Slack shapes it. Built by concatenation at runtime, so no literal in the tree has a secret scanner's Slack shape */
export function slackTokens(): { app: string; bot: string; user: string; refresh: string } {
  const app = ["xa", "pp-", "1-", "A0FAKEAPP01", "-", "1730000000001", "-", "0123456789abcdef".repeat(4)].join("");
  const bot = ["xo", "xb-", "1000000001", "-", "2000000002", "-", "FakeBotTokenForTests0001"].join("");
  const user = ["xo", "xp-", "1000000001", "-", "3000000003", "-", "4000000004", "-", "fedcba9876543210".repeat(2)].join("");
  const refresh = ["xo", "xe-", "1-", "FakeRefreshTokenForTestsOnly0001"].join("");
  return { app, bot, user, refresh };
}

// ---- a fake Slack -----------------------------------------------------------------------------------------------------------------

/** an envelope's or a frame's JSON, as the fake sends it */
type Json = Record<string, unknown>;

export interface FakeSlackOptions {
  team?: { id: string; name: string };
  bot?: { userId: string; botId: string; appId: string; name: string };
  /** the workspace's members, by user id; the bot user is answered by users.info whether or not it is here */
  users?: Map<string, { name: string; displayName: string; realName: string }>;
  tokens?: { app: string; bot: string };
}

export interface FakeSlack {
  /** the Web API's base, `http://127.0.0.1:<port>/api`: a SlackApi's apiBase, and an ACCOUNT_SLACK_API value */
  url: string;
  tokens: { app: string; bot: string };
  team: { id: string; name: string };
  bot: { userId: string; botId: string; appId: string; name: string };
  users: Map<string, { name: string; displayName: string; realName: string }>;
  /** send an envelope (its JSON as given) to the newest open socket; with none open it is lost, as Slack does not hold one */
  push(envelope: object): void;
  /** send a text frame as it is (not JSON, say, or a large one) to the newest open socket */
  pushText(text: string): void;
  /** the DM's messages conversations.history answers from, in the order added (chat.postMessage adds the bot's own) */
  history: Array<{ ts: string; user: string; text: string; subtype?: string; bot_id?: string; thread_ts?: string }>;
  /** every ack's envelope_id, in order */
  acks: string[];
  /** every chat.postMessage, its form fields as sent */
  posted: Array<{ channel: string; text: string; mrkdwn: string; unfurl_links: string; unfurl_media: string; thread_ts?: string }>;
  /** every Web API call, in order: the method, the request's URL and headers as sent, and its form */
  calls: Array<{ method: string; url: string; contentType: string; authorization: string; form: Record<string, string> }>;
  /** what happened to the sockets, in order: `open <n>` (n the count open after it) and `close <n>` */
  events: string[];
  /** how many sockets are open now (a socket that sent its close frame is no longer counted) */
  sockets(): number;
  /** a disconnect envelope (`refresh_requested`, `warning`, `link_disabled`) to every open socket; the fake does not close them itself */
  disconnect(reason: string): void;
  /** every open socket cut at once, with no close frame */
  drop(): void;
  /** from now on each hello says `num_connections: n`; 0 restores the true count */
  helloConnections(n: number): void;
  /** from now on `method` is answered `status` with `body` (and `headers`) instead of its own answer; status 0 restores it */
  answer(method: string, status: number, body: object, headers?: Record<string, string>): void;
  /** from now on apps.connections.open answers this URL; "" restores the fake's own */
  socketUrl(url: string): void;
  close(): Promise<void>;
}

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** one unmasked frame, server to client */
function wsFrame(opcode: number, payload: Buffer): Buffer {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65_536 ? Buffer.alloc(4) : Buffer.alloc(10);
  if (n >= 126 && n < 65_536) {
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(n, 2);
  } else if (n >= 65_536) {
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([head, payload]);
}

/**
 * A FAKE SLACK on this machine's loopback, one node:http server: the Web API at `/api/<method>` (auth.test, bots.info, users.info,
 * apps.connections.open, conversations.history, chat.postMessage), each a form POST whose `Authorization: Bearer` must be the fake's app
 * token (apps.connections.open) or bot token (the rest) — `invalid_auth` otherwise, as Slack answers — and Socket Mode at `/link`, a
 * hand-rolled RFC 6455 server: the Sec-WebSocket-Accept handshake, unmasked text frames out, masked frames in, ping and close. Each socket
 * is sent a hello on open; every frame the client sends with an `envelope_id` is recorded as an ack. No test ever reaches Slack: the tokens
 * are made up (slackTokens).
 */
export async function fakeSlack(o: FakeSlackOptions = {}): Promise<FakeSlack> {
  const made = slackTokens();
  const tokens = o.tokens ?? { app: made.app, bot: made.bot };
  const team = o.team ?? { id: "T0FAKE001", name: "Fake Co" };
  const bot = o.bot ?? { userId: "U0BOT0001", botId: "B0BOT0001", appId: "A0FAKE001", name: "gravit" };
  const users = o.users ?? new Map([["U0OPER001", { name: "pan", displayName: "Pan", realName: "Pan Zhe" }]]);
  const history: FakeSlack["history"] = [];
  const acks: string[] = [];
  const posted: FakeSlack["posted"] = [];
  const calls: FakeSlack["calls"] = [];
  const events: string[] = [];
  const overrides = new Map<string, { status: number; body: object; headers: Record<string, string> }>();
  const open: Socket[] = [];
  const all = new Set<Socket>();
  let helloN = 0;
  let urlOverride = "";
  let posts = 0;
  let tickets = 0;

  const reply = (res: ServerResponse, status: number, body: object, headers: Record<string, string> = {}) => {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  const readForm = (req: IncomingMessage): Promise<Record<string, string>> =>
    new Promise((resolve) => {
      let text = "";
      req.setEncoding("utf8");
      req.on("data", (c: string) => (text += c));
      req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(text))));
      req.on("error", () => resolve({}));
    });

  const server = createServer(async (req, res) => {
    const form = await readForm(req);
    const m = /^\/api\/([A-Za-z.]+)$/.exec(req.url ?? "");
    if (!m || req.method !== "POST") return reply(res, 404, { ok: false, error: "unknown_method" });
    const method = m[1]!;
    const authorization = String(req.headers.authorization ?? "");
    calls.push({ method, url: req.url ?? "", contentType: String(req.headers["content-type"] ?? ""), authorization, form });
    const want = method === "apps.connections.open" ? tokens.app : tokens.bot;
    if (authorization !== `Bearer ${want}`) return reply(res, 200, { ok: false, error: authorization === "" ? "not_authed" : "invalid_auth" });
    const override = overrides.get(method);
    if (override) return reply(res, override.status, override.body, override.headers);
    switch (method) {
      case "auth.test":
        return reply(res, 200, { ok: true, url: "https://fake.example/", team: team.name, user: bot.name, team_id: team.id, user_id: bot.userId, bot_id: bot.botId, is_enterprise_install: false });
      case "bots.info":
        if (form.bot !== bot.botId) return reply(res, 200, { ok: false, error: "bot_not_found" });
        return reply(res, 200, { ok: true, bot: { id: bot.botId, deleted: false, name: bot.name, app_id: bot.appId, user_id: bot.userId } });
      case "users.info": {
        if (form.user === bot.userId) return reply(res, 200, { ok: true, user: { id: bot.userId, team_id: team.id, name: bot.name, real_name: "Gravit", is_bot: true, profile: { display_name: "Gravit", real_name: "Gravit" } } });
        const u = users.get(form.user ?? "");
        if (!u) return reply(res, 200, { ok: false, error: "user_not_found" });
        return reply(res, 200, { ok: true, user: { id: form.user, team_id: team.id, name: u.name, real_name: u.realName, is_bot: false, profile: { display_name: u.displayName, real_name: u.realName } } });
      }
      case "apps.connections.open": {
        const port = (server.address() as { port: number }).port;
        return reply(res, 200, { ok: true, url: urlOverride !== "" ? urlOverride : `ws://127.0.0.1:${port}/link/?ticket=fake-${++tickets}` });
      }
      case "conversations.history": {
        const oldest = Number(form.oldest ?? "0") || 0;
        const inclusive = form.inclusive === "true" || form.inclusive === "1";
        const limit = Math.max(1, Math.min(1000, Number(form.limit ?? "100") || 100));
        const after = history.filter((h) => (inclusive ? Number(h.ts) >= oldest : Number(h.ts) > oldest)).sort((a, b) => Number(b.ts) - Number(a.ts));
        const start = form.cursor ? Number(Buffer.from(form.cursor, "base64").toString("utf8").replace(/^offset:/, "")) || 0 : 0;
        const page = after.slice(start, start + limit);
        const more = start + limit < after.length;
        return reply(res, 200, { ok: true, messages: page.map((h) => ({ type: "message", ...h })), has_more: more, response_metadata: { next_cursor: more ? Buffer.from(`offset:${start + limit}`).toString("base64") : "" } });
      }
      case "chat.postMessage": {
        const ts = `${1_730_900_000 + posts}.${String(++posts).padStart(6, "0")}`;
        posted.push({ channel: form.channel ?? "", text: form.text ?? "", mrkdwn: form.mrkdwn ?? "", unfurl_links: form.unfurl_links ?? "", unfurl_media: form.unfurl_media ?? "", ...(form.thread_ts !== undefined ? { thread_ts: form.thread_ts } : {}) });
        history.push({ ts, user: bot.userId, text: form.text ?? "", bot_id: bot.botId });
        return reply(res, 200, { ok: true, channel: form.channel, ts, message: { type: "message", ts, text: form.text, bot_id: bot.botId } });
      }
      default:
        return reply(res, 200, { ok: false, error: "unknown_method" });
    }
  });

  const forget = (s: Socket, why: string) => {
    const i = open.indexOf(s);
    if (i < 0) return;
    open.splice(i, 1);
    events.push(`${why} ${open.length}`);
  };
  const sendText = (s: Socket, text: string) => {
    if (!s.destroyed && s.writable) s.write(wsFrame(0x1, Buffer.from(text, "utf8")));
  };

  server.on("upgrade", (req: IncomingMessage, socket: Socket) => {
    const key = req.headers["sec-websocket-key"];
    if (!(req.url ?? "").startsWith("/link") || typeof key !== "string") {
      socket.end("HTTP/1.1 404 Not Found\r\nconnection: close\r\ncontent-length: 0\r\n\r\n");
      return;
    }
    const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    all.add(socket);
    open.push(socket);
    events.push(`open ${open.length}`);
    let buf = Buffer.alloc(0);
    let fragments: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        const fin = (buf[0]! & 0x80) !== 0;
        const opcode = buf[0]! & 0x0f;
        const masked = (buf[1]! & 0x80) !== 0;
        let len = buf[1]! & 0x7f;
        let at = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          at = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          at = 10;
        }
        const maskAt = at;
        if (masked) at += 4;
        if (buf.length < at + len) return;
        const payload = Buffer.from(buf.subarray(at, at + len));
        if (masked) for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ buf[maskAt + (i % 4)]!;
        buf = buf.subarray(at + len);
        if (opcode === 0x8) {
          forget(socket, "close");
          if (!socket.destroyed) socket.end(wsFrame(0x8, payload.subarray(0, 2)));
          return;
        }
        if (opcode === 0x9) {
          socket.write(wsFrame(0xa, payload));
          continue;
        }
        if (opcode === 0x1 || opcode === 0x0) {
          fragments.push(payload);
          if (!fin) continue;
          const text = Buffer.concat(fragments).toString("utf8");
          fragments = [];
          try {
            const v = JSON.parse(text) as Json;
            if (typeof v.envelope_id === "string") acks.push(v.envelope_id);
          } catch {
            /* not JSON: nothing Slack would take */
          }
        }
      }
    });
    socket.on("close", () => {
      all.delete(socket);
      forget(socket, "close");
    });
    socket.on("error", () => undefined);
    sendText(socket, JSON.stringify({ type: "hello", num_connections: helloN > 0 ? helloN : open.length, debug_info: { host: "fake-slack", approximate_connection_time: 18060 }, connection_info: { app_id: bot.appId } }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;

  return {
    url: `http://127.0.0.1:${port}/api`,
    tokens,
    team,
    bot,
    users,
    history,
    acks,
    posted,
    calls,
    events,
    push(envelope) {
      const s = open[open.length - 1];
      if (s) sendText(s, JSON.stringify(envelope));
    },
    pushText(text) {
      const s = open[open.length - 1];
      if (s) sendText(s, text);
    },
    sockets: () => open.length,
    disconnect(reason) {
      for (const s of [...open]) sendText(s, JSON.stringify({ type: "disconnect", reason, debug_info: { host: "fake-slack" } }));
    },
    drop() {
      for (const s of [...open]) {
        forget(s, "close");
        s.destroy();
      }
    },
    helloConnections(n) {
      helloN = n;
    },
    answer(method, status, body, headers = {}) {
      if (status === 0) overrides.delete(method);
      else overrides.set(method, { status, body, headers });
    },
    socketUrl(url) {
      urlOverride = url;
    },
    async close() {
      for (const s of [...all]) s.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
