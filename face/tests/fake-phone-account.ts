// face/tests/fake-phone-account.ts
/** A fake of the account's two phone routes (account/src/portfolio/identity/routes.ts), on a `node:http` server at
 * 127.0.0.1, port 0 - what src/phone.ts reaches, so no test ever asks a real account or a network:
 * - `GET /api/account/identity/inbox?after=<n>&wait=<s>` answers `{ok: true, messages, last, status}` from a ring the test
 *   fills ({@link FakePhoneAccount.push}) - every message numbered above `after` - and, with none, holds the request
 *   open for `wait` seconds, until a message is pushed, until {@link FakePhoneAccount.endPoll} or until the client lets go,
 *   as the account's long poll does. Reading never changes the ring.
 * - `POST /api/account/identity/send` records the body as it came and answers `{ok: true, sent: ["<network>:<n>"]}` -
 *   Slack's as its `ts`, `slack:1730812345.000<n>` - or what {@link FakePhoneAccount.sendAnswer} says.
 * `inboxAnswer`, when set, answers a read in its place: an HTTP status and a body (a 503, a body that is no inbox), or
 * `"drop"` - the socket closed with no answer, as a dead account's would be. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AccountPhoneStatus, InboxMessage } from "../src/phone.ts";

export interface SentBody { kind?: unknown; text?: unknown; replyTo?: unknown; network?: unknown; [k: string]: unknown }

type Answer = { status: number; body: unknown } | "drop";

function answer(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

export class FakePhoneAccount {
  url = "";
  /** The ring, in order. */
  readonly messages: InboxMessage[] = [];
  /** Every send's body, in arrival order. */
  readonly sends: SentBody[] = [];
  /** Every inbox read's `after` and `wait`, in arrival order. */
  readonly reads: { after: number; wait: number }[] = [];
  /** The phone as each inbox answer carries it. */
  status: AccountPhoneStatus = { networks: [{ network: "telegram", polling: true }], queued: 0, strangers: 0 };
  /** When set, a read is answered with it instead. */
  inboxAnswer: (() => Answer | undefined) | undefined;
  /** When set, a send is answered with it instead of `{ok: true, sent: [...]}`. */
  sendAnswer: ((body: SentBody) => Answer | undefined) | undefined;
  /** The next inbox number. */
  next = 1;
  private nextSent = 501;
  private readonly waiting = new Set<() => void>();
  private readonly server = createServer((req, res) => {
    this.serve(req, res).catch(() => { answer(res, 500, { ok: false, error: "fake failure" }); });
  });

  async listen(): Promise<this> {
    await new Promise<void>((done) => { this.server.listen(0, "127.0.0.1", done); });
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async close(): Promise<void> {
    this.release();
    this.server.closeAllConnections();
    await new Promise<void>((done) => { this.server.close(() => done()); });
  }

  /** Add a message to the ring, numbered next unless it says otherwise, and wake a read held open. */
  push(m: Omit<InboxMessage, "id"> & { id?: number }): InboxMessage {
    const full: InboxMessage = { ...m, id: m.id ?? this.next };
    this.next = Math.max(this.next, full.id + 1);
    this.messages.push(full);
    this.release();
    return full;
  }

  /** The account's home made afresh: an empty ring, numbered from 1 again. */
  fresh(): void {
    this.messages.length = 0;
    this.next = 1;
  }

  /** Answer the reads held open, with whatever there is. */
  endPoll(): void { this.release(); }

  /** How many reads are held open now. */
  get pending(): number { return this.waiting.size; }

  /** The sent texts, in order. */
  texts(): unknown[] { return this.sends.map((s) => s.text); }

  private release(): void { for (const wake of [...this.waiting]) wake(); }

  private last(): number { return this.messages.reduce((top, m) => Math.max(top, m.id), 0); }

  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://x");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    if (req.method === "GET" && url.pathname === "/api/account/identity/inbox") {
      const after = Number(url.searchParams.get("after") ?? "0");
      const wait = Number(url.searchParams.get("wait") ?? "0");
      this.reads.push({ after, wait });
      const instead = this.inboxAnswer?.();
      if (instead === "drop") {
        res.socket?.destroy();
        return;
      }
      if (instead !== undefined) return answer(res, instead.status, instead.body);
      const ready = (): InboxMessage[] => this.messages.filter((m) => m.id > after);
      if (after === this.last() && wait > 0) await this.hold(res, wait * 1_000);
      return answer(res, 200, { ok: true, messages: ready(), last: this.last(), status: this.status });
    }
    if (req.method === "POST" && url.pathname === "/api/account/identity/send") {
      let body: SentBody = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as SentBody;
      } catch {
        return answer(res, 400, { ok: false, error: "not JSON" });
      }
      this.sends.push(body);
      const instead = this.sendAnswer?.(body);
      if (instead === "drop") {
        res.socket?.destroy();
        return;
      }
      if (instead !== undefined) return answer(res, instead.status, instead.body);
      const network = typeof body.network === "string" ? body.network : "telegram";
      const n = this.nextSent++;
      return answer(res, 200, { ok: true, sent: [network === "slack" ? `slack:1730812345.000${n}` : `${network}:${n}`] });
    }
    return answer(res, 404, { ok: false, error: "no such route" });
  }

  private hold(res: ServerResponse, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.waiting.delete(done);
        res.off("close", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.waiting.add(done);
      res.on("close", done);
    });
  }
}

/** A fake account, listening. */
export async function fakePhoneAccount(): Promise<FakePhoneAccount> {
  return new FakePhoneAccount().listen();
}
