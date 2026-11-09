/** CONNECT IMESSAGE, SHEETS 1 TO 3 (through Photon's hosted relay): iMessage's side of a pending connection (pending.ts PendingSource).
 *
 *   Sheet 1's check: the project looked up with its secret (checkProject; a project Photon gives dedicated lines is refused — the shared
 *     pool only), then the operator's number found among the project's users or registered (addUser), which names the pool number Gravit
 *     will speak from. A registration whose line Photon refused to write to (the line kept in <home>/identity/imessage.refused) is removed
 *     and registered again, so Photon gives a fresh number. Every refusal is in IDENTITY_WORDS' fixed words; nothing Photon says is repeated.
 *   Sheet 2's listening: the project's one event stream, live from now. Only a 1:1 iMessage text from the number typed on sheet 1 is heard;
 *     Gravit's own messages, a group's, another service's (SMS, RCS: one log line a minute) and anything not text are skipped, and any
 *     other sender — the operator's own email handle among them — is reported to the shell as a stranger.
 *
 * The project secret is held here in memory only, for the pending connection's life; it is in no line said (the shell redacts `secrets`,
 * the secret and its Basic spelling) and in no answer. */
import type { Refusal } from "../../core/errors.ts";
import { no } from "../refuse.ts";
import type { PendingBot, PendingResume, PendingSource } from "./pending.ts";
import { isGroupChat, PhotonError, type PhotonLink, type PhotonMessage, type PhotonProject, type PhotonStream } from "./photon-link.ts";
import { IDENTITY_WORDS } from "./routes.ts";
import { basicOf } from "./secret-file.ts";
import { maskId } from "./store.ts";
import type { IdentityClock } from "./telegram.ts";

/** how often an SMS or RCS message reaching the line is said: one line a minute at most */
const OTHER_SERVICE_LOG_MS = 60_000;

export interface ImessagePendingSourceOptions {
  link: PhotonLink;
  project: PhotonProject;
  /** the operator's number as typed on sheet 1 (E.164) */
  phone: string;
  /** the line Photon refused to write to, as <home>/identity/imessage.refused keeps it (undefined: none) */
  refusedLine: () => string | undefined;
  clock: IdentityClock;
  log: (l: string) => void;
}

type ListenCtx = Parameters<PendingSource["listen"]>[0];

const refused = (message: string): Refusal => no("E_ACCOUNT_BAD_ACTION", { message });

export class ImessagePendingSource implements PendingSource {
  readonly network = "imessage" as const;
  readonly secrets: readonly string[];
  /** the registration the check found or made: the Photon user and the pool number it was given */
  private user: { userId: string; line: string } | undefined;
  /** the sequence of the message heard */
  private sequence: number | undefined;
  /** when an SMS or RCS message was last said (-Infinity: never) */
  private otherSaidAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly o: ImessagePendingSourceOptions) {
    this.secrets = [o.project.secret, basicOf(o.project.projectId, o.project.secret)];
  }

  async check(signal: AbortSignal): Promise<PendingBot | Refusal> {
    const { link, project, phone } = this.o;
    try {
      await link.checkProject(project, signal);
    } catch (err) {
      return this.failed(err, "project check", true, signal);
    }
    let user;
    try {
      user = await link.findUser(project, phone, signal);
      // a registration whose line Photon refused to write to: removed, and registered again for a fresh number
      const refusedLine = this.o.refusedLine();
      if (user && refusedLine !== undefined && user.line === refusedLine) {
        await link.removeUser(project, user.userId, signal);
        user = undefined;
      }
      if (!user) user = await link.addUser(project, phone, signal);
    } catch (err) {
      return this.failed(err, "user registration", false, signal);
    }
    if (signal.aborted) return refused(IDENTITY_WORDS.photonUnreachable);
    this.user = { userId: user.userId, line: user.line };
    return { id: `${project.projectId}:${user.line}`, username: user.line, name: "iMessage", link: `sms:${user.line}` };
  }

  async listen(ctx: ListenCtx): Promise<void> {
    if (ctx.signal.aborted || !this.user) return;
    let stream: PhotonStream | undefined;
    try {
      await new Promise<void>((done, fail) => {
        let over = false;
        const end = (err?: PhotonError) => {
          if (over) return;
          over = true;
          ctx.signal.removeEventListener("abort", aborted);
          if (err) fail(err);
          else done();
        };
        const aborted = () => end();
        ctx.signal.addEventListener("abort", aborted, { once: true });
        stream = this.o.link.stream(this.o.project, undefined, {
          event: async (e) => {
            if (over || e.type !== "message") return;
            if (this.take(e.message, ctx)) end();
          },
          heartbeat: () => {},
          gap: () => {},
          failed: (err) => end(err),
        });
      });
    } finally {
      // heard, the connection ended, or the stream failed: it is closed either way
      await stream?.close().catch(() => {});
    }
  }

  resume(): PendingResume {
    return { network: "imessage", sequence: this.sequence, userId: this.user?.userId ?? "", line: this.user?.line ?? "", phone: this.o.phone };
  }

  // ---- inside ----

  /** one message while pending: true once the operator was heard (the listening then ends) */
  private take(m: PhotonMessage, ctx: ListenCtx): boolean {
    if (ctx.signal.aborted || m.fromMe || isGroupChat(m.chatGuid)) return false;
    if (m.service !== "iMessage") {
      const now = this.o.clock.now();
      if (now - this.otherSaidAt >= OTHER_SERVICE_LOG_MS) {
        this.otherSaidAt = now;
        ctx.log(`identity: an ${m.service === "SMS" || m.service === "RCS" ? m.service : "other"} message reached Gravit's iMessage line; only an iMessage counts, so it is skipped`);
      }
      return false;
    }
    if (m.from !== this.o.phone) {
      ctx.stranger(m.from);
      return false;
    }
    if (m.nonText || m.text === undefined || m.text === "") return false;
    if (ctx.admit(m.from) !== "hear") return false;
    this.sequence = m.sequence;
    ctx.heard({ id: m.from, name: m.from, handle: m.from, masked: maskId(m.from), text: m.text });
    return true;
  }

  /** a call that failed: Photon's refusal in its fixed words, or Photon not answering (one line, its reason without the secret) */
  private failed(err: unknown, what: string, projectCheck: boolean, signal: AbortSignal): Refusal {
    if (err instanceof PhotonError) {
      if (err.kind === "auth") return refused(IDENTITY_WORDS.refusedByPhoton);
      if (projectCheck && err.kind === "refused" && err.code === "dedicated") return refused(IDENTITY_WORDS.photonDedicated);
      if (err.kind === "limit") return refused(IDENTITY_WORDS.photonUserLimit);
      if (err.kind === "noNumber") return refused(IDENTITY_WORDS.photonNoNumber);
    }
    const reason = err instanceof PhotonError ? `${err.kind}: ${err.message}` : err instanceof Error ? err.name : "error";
    if (!signal.aborted) this.o.log(`identity: Photon's ${what} did not answer (${reason})`);
    return refused(IDENTITY_WORDS.photonUnreachable);
  }
}
