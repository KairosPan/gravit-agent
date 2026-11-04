/** A FAKE TELEGRAM BOT API on this machine's loopback, for the identity tests: `/bot<token>/getMe`, `getUpdates` (the long poll held
 * until an update is pushed or its timeout passes) and `sendMessage`, each answered as the Bot API answers ({ok, result} or {ok: false,
 * error_code, description}); any other token is answered 401 Unauthorized, as Telegram answers a token it does not know. No test ever
 * reaches api.telegram.org: every token in the tests is made up, shaped like BotFather's. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

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
