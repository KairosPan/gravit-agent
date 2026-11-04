/** THE INBOX — the operator's texts, as the connected poller (telegram.ts) took them, for the face's desk to read.
 *
 * `<home>/identity/inbox.json` holds `{next, messages}`: the last INBOX_MAX messages, each numbered by the account (`id`, 1, 2, 3 … never
 * reused, across restarts too: `next` is kept even when the ring has let the oldest go), with the network's own id (`telegram:<id>`), the
 * message it replies to when it replies to one, its text and when it was written. Only the bound operator's texts in a private chat land
 * here: a stranger's text never does (store.ts Strangers keeps a count and a time, never a text).
 *
 * The file is written whole at every append (store.ts writeIdentityFile: 0600 in a 0700 folder, a temporary file flushed and renamed, no
 * link on the way) — and only at an append: reading the inbox (`after`, `last`, `wait`) never changes it. The poller appends a message
 * before it moves Telegram's offset past it, so an account that stops in between reads it again from Telegram rather than lose it; a
 * message whose network id is in the ring already is not appended twice. */
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NETWORKS, type Network } from "./kinds.ts";
import { identityDir, writeIdentityFile } from "./store.ts";

/** how many messages the ring holds: the account stream's ring size */
export const INBOX_MAX = 500;
const FILE = "inbox.json";

export interface InboxMessage {
  /** the account's own number for it: grows by one at each message, never reused */
  id: number;
  network: Network;
  /** `<network>:<the network's own id>` — `telegram:4821` */
  messageId: string;
  /** the message this one replies to, as `<network>:<id>` */
  replyTo?: string;
  text: string;
  /** when it was written, ISO */
  at: string;
}

const isNetwork = (v: unknown): v is Network => typeof v === "string" && (NETWORKS as readonly string[]).includes(v);

function messageOf(v: unknown): InboxMessage | undefined {
  if (!v || typeof v !== "object") return undefined;
  const m = v as Record<string, unknown>;
  if (typeof m.id !== "number" || !Number.isSafeInteger(m.id) || m.id < 1) return undefined;
  if (!isNetwork(m.network) || typeof m.messageId !== "string" || typeof m.text !== "string" || typeof m.at !== "string") return undefined;
  if (m.replyTo !== undefined && typeof m.replyTo !== "string") return undefined;
  return { id: m.id, network: m.network, messageId: m.messageId, ...(typeof m.replyTo === "string" ? { replyTo: m.replyTo } : {}), text: m.text, at: m.at };
}

const copy = (m: InboxMessage): InboxMessage => ({ ...m });

/** whether `path` is a link (or cannot be looked at): the inbox is never read through one */
function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

/** The last `max` messages, numbered across restarts, written whole at each append and never at a read */
export class InboxRing {
  private next = 1;
  private messages: InboxMessage[] = [];
  private readonly waiters = new Set<() => void>();

  constructor(
    private readonly home: string,
    private readonly max = INBOX_MAX,
  ) {
    this.load();
  }

  /** a message taken: numbered, kept (the oldest let go past `max`), the file written — or, when its network id is in the ring already,
   * the one kept before. Throws when the file cannot be written; then nothing changed */
  append(m: Omit<InboxMessage, "id">): InboxMessage {
    const known = this.messages.find((x) => x.messageId === m.messageId);
    if (known) return copy(known);
    const message: InboxMessage = { id: this.next, network: m.network, messageId: m.messageId, ...(m.replyTo !== undefined ? { replyTo: m.replyTo } : {}), text: m.text, at: m.at };
    const messages = [...this.messages, message].slice(-this.max);
    writeIdentityFile(this.home, FILE, `${JSON.stringify({ next: this.next + 1, messages })}\n`);
    this.next += 1;
    this.messages = messages;
    for (const w of [...this.waiters]) w();
    return copy(message);
  }

  /** the messages numbered above `id`, oldest first */
  after(id: number): InboxMessage[] {
    return this.messages.filter((m) => m.id > id).map(copy);
  }

  /** the number of the last message taken, 0 before the first */
  last(): number {
    return this.next - 1;
  }

  /** resolves once a message numbered above `after` is in the ring, at `ms`, or when `signal` aborts — whichever is first */
  wait(after: number, ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((done) => {
      if (this.last() > after || ms <= 0 || signal?.aborted) return done();
      const end = () => {
        clearTimeout(timer);
        this.waiters.delete(check);
        signal?.removeEventListener("abort", end);
        done();
      };
      const check = () => {
        if (this.last() > after) end();
      };
      const timer = setTimeout(end, ms);
      timer.unref();
      this.waiters.add(check);
      signal?.addEventListener("abort", end, { once: true });
    });
  }

  private load(): void {
    const dir = identityDir(this.home);
    const file = join(dir, FILE);
    // a link at the folder or the file reads as an empty inbox — and the next append refuses it (writeIdentityFile)
    if (isLink(dir) || isLink(file)) return;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const r = raw as { next?: unknown; messages?: unknown };
    const messages = Array.isArray(r.messages) ? r.messages.map(messageOf).filter((m): m is InboxMessage => m !== undefined) : [];
    messages.sort((a, b) => a.id - b.id);
    this.messages = messages.slice(-this.max);
    const top = messages.length > 0 ? messages[messages.length - 1]!.id + 1 : 1;
    this.next = Math.max(typeof r.next === "number" && Number.isSafeInteger(r.next) && r.next >= 1 ? r.next : 1, top);
  }
}
