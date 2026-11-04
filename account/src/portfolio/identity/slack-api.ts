/** THE SLACK WEB API, as the account speaks it: six methods (auth.test, bots.info, users.info, apps.connections.open,
 * conversations.history, chat.postMessage) over fetch, each a POST of `application/x-www-form-urlencoded` to `<apiBase>/<method>` with the
 * token in `Authorization: Bearer` — never in the URL — and each under a 15 s deadline, cut at once when the caller's signal aborts.
 * apps.connections.open is called with the app-level token, everything else with the bot token. An answer that is not `ok` is a
 * SlackApiError: the HTTP status, Slack's `error` code and, for a 429, its Retry-After. No error this module makes carries a token: each
 * is taken out by its exact spellings (bot-api.ts redactorOf) and by every Slack token shape (kinds.ts SLACK_TOKEN_ANYWHERE).
 *
 * The address is https://slack.com/api. ACCOUNT_SLACK_API overrides it for the tests and the smokes, and only with an
 * http://127.0.0.1:<port> value (or that and `/api`): anything else is ignored with one line, so that no setting can send a token to
 * another host (slackApiBase). The socket URL apps.connections.open answers is taken only as Slack's own wss host, or under the override as
 * a ws URL on that same loopback port (socketUrlOk), so no answer can steer the app-level token's socket elsewhere. This file is the only
 * one in account/src that names Slack's host.
 *
 * Also here: escapeSlack (what is sent is plain: `&`, `<` and `>` escaped, so a text cannot carry `<!channel>` or a `<url|label>` link)
 * and SLACK_MANIFEST, the app manifest the Identity tab shows the owner to paste into Slack (Socket Mode, a bot user, the DM tab, three
 * bot scopes and message.im). */
import { redactorOf } from "./bot-api.ts";
import { SLACK_TOKEN_ANYWHERE } from "./kinds.ts";

/** Slack's own Web API address: the only one a token is sent to outside a test */
const SLACK_API = "https://slack.com/api";
/** the one override taken: plain http to this machine's 127.0.0.1, a port, and at most `/api` */
const LOOPBACK_BASE = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})(?:\/api)?$/;
/** a host of Slack's own: one or more labels, then slack.com */
const SLACK_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+slack\.com$/;
/** every call's deadline */
const CALL_DEADLINE_MS = 15_000;

/**
 * The Web API's address for this run: Slack's own, unless `ACCOUNT_SLACK_API` is exactly `http://127.0.0.1:<port>` or that and `/api` (a
 * fake Slack in a test or a smoke), which answers `http://127.0.0.1:<port>/api`. A value that is set and is not that is ignored, and `log`
 * is told so in one line that does not repeat it.
 */
export function slackApiBase(env: NodeJS.ProcessEnv, log: (l: string) => void): string {
  const v = env.ACCOUNT_SLACK_API;
  if (v === undefined || v === "") return SLACK_API;
  const m = LOOPBACK_BASE.exec(v);
  if (m && Number(m[1]) <= 65_535) return `http://127.0.0.1:${m[1]}/api`;
  log(`identity: ACCOUNT_SLACK_API is not an http://127.0.0.1:<port> address, so it is ignored: the Web API is ${SLACK_API}`);
  return SLACK_API;
}

/**
 * Is `url` a socket URL the app-level token may be opened on? Under Slack's own base: `wss://<name>.slack.com/…`, with no port and no
 * credentials. Under the loopback override `http://127.0.0.1:<port>/api`: `ws://127.0.0.1:<that same port>/…`. Anything else is not.
 */
export function socketUrlOk(url: string, apiBase: string): boolean {
  let u: URL;
  let base: URL;
  try {
    u = new URL(url);
    base = new URL(apiBase);
  } catch {
    return false;
  }
  if (u.username !== "" || u.password !== "") return false;
  if (apiBase.replace(/\/+$/, "") === SLACK_API) return u.protocol === "wss:" && u.port === "" && SLACK_HOST.test(u.hostname);
  if (!LOOPBACK_BASE.test(apiBase.replace(/\/+$/, ""))) return false;
  return u.protocol === "ws:" && u.hostname === "127.0.0.1" && base.hostname === "127.0.0.1" && u.port !== "" && u.port === base.port;
}

/** `text` as Slack shows it literally: `&` as `&amp;`, `<` as `&lt;`, `>` as `&gt;`, and nothing else changed */
export const escapeSlack = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The app manifest the owner pastes into Slack's "Create an app › From a manifest": Socket Mode (no request URL, so nothing reaches this
 * machine from outside), a bot user named Gravit, the Messages tab writable so the operator can DM it, the three bot scopes (chat:write,
 * im:history, users:read) and the one event, message.im. The app-level token's connections:write is asked for on Slack's own page. */
export const SLACK_MANIFEST: string = JSON.stringify(
  {
    display_information: { name: "Gravit" },
    features: {
      app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      bot_user: { display_name: "Gravit", always_online: true },
    },
    oauth_config: { scopes: { bot: ["chat:write", "im:history", "users:read"] } },
    settings: {
      event_subscriptions: { bot_events: ["message.im"] },
      interactivity: { is_enabled: false },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  },
  null,
  2,
);

// ---- the client -------------------------------------------------------------------------------------------------------------------

/** A Web API answer that was not `ok`: the HTTP status, Slack's `error` code (or `http_<status>` when the answer said none) and, for a
 * 429, how many seconds Slack asked to wait. Its message is `HTTP <status> <code>`, every token taken out */
export class SlackApiError extends Error {
  readonly retryAfterS?: number;
  constructor(
    readonly status: number,
    readonly code: string,
    retryAfterS?: number,
  ) {
    super(`HTTP ${status} ${code}`);
    this.name = "SlackApiError";
    if (retryAfterS !== undefined) this.retryAfterS = retryAfterS;
  }
}

/** A failure as one line: its message, and the code it or its cause carries when the message does not say it (`fetch failed
 * (ECONNREFUSED)`) */
function reasonOf(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const own = (err as { code?: unknown }).code;
  const code = typeof own === "string" ? own : (err.cause as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && !err.message.includes(code) ? `${err.message} (${code})` : err.message;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export interface SlackApiOptions {
  /** the bot token (xoxb-): every method but apps.connections.open */
  token: string;
  /** the app-level token (xapp-): apps.connections.open alone, which is refused at once without it */
  appToken?: string | undefined;
  apiBase: string;
  fetch?: typeof fetch | undefined;
  /** aborted: every call under way is cut, and every later one refused at once */
  signal?: AbortSignal | undefined;
}

type Form = Record<string, string | number | boolean | undefined>;

export class SlackApi {
  private readonly token: string;
  private readonly appToken: string | undefined;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly signal: AbortSignal | undefined;
  private readonly redactOwn: (text: string) => string;

  constructor(o: SlackApiOptions) {
    this.token = o.token;
    this.appToken = o.appToken;
    this.base = o.apiBase.replace(/\/+$/, "");
    this.fetchImpl = o.fetch ?? fetch;
    this.signal = o.signal;
    this.redactOwn = redactorOf(o.appToken ? [o.token, o.appToken] : [o.token], "<token>");
  }

  /** `text` with this client's tokens, and every Slack token shape, taken out */
  redact(text: string): string {
    return this.redactOwn(text).replace(SLACK_TOKEN_ANYWHERE, "<token>");
  }

  /** who the bot token is: its workspace, its bot user and its bot id */
  async authTest(): Promise<{ teamId: string; team: string; userId: string; user: string; botId: string }> {
    const r = await this.call("auth.test", {});
    const out = { teamId: str(r.team_id), team: str(r.team), userId: str(r.user_id), user: str(r.user), botId: str(r.bot_id) };
    if (out.teamId === "" || out.userId === "" || out.botId === "") throw new Error("auth.test answered something that is not a bot");
    return out;
  }

  /** the app a bot belongs to, and its name */
  async botsInfo(botId: string): Promise<{ appId: string; name: string }> {
    const r = await this.call("bots.info", { bot: botId });
    const bot = (r.bot ?? {}) as Record<string, unknown>;
    const appId = str(bot.app_id);
    if (appId === "") throw new Error("bots.info answered no app id");
    return { appId, name: str(bot.name) };
  }

  /** a workspace member's names, and whether they are a bot */
  async usersInfo(userId: string): Promise<{ name: string; displayName: string; realName: string; isBot: boolean }> {
    const r = await this.call("users.info", { user: userId });
    const user = (r.user ?? {}) as Record<string, unknown>;
    const profile = (user.profile ?? {}) as Record<string, unknown>;
    const name = str(user.name);
    if (name === "") throw new Error("users.info answered no user");
    return { name, displayName: str(profile.display_name), realName: str(profile.real_name) || str(user.real_name), isBot: user.is_bot === true };
  }

  /** a fresh Socket Mode URL, with the app-level token; the caller takes it only if socketUrlOk */
  async connectionsOpen(): Promise<string> {
    if (this.appToken === undefined) throw new Error("apps.connections.open needs the app-level token, and this client holds none");
    const r = await this.call("apps.connections.open", {}, this.appToken);
    const url = str(r.url);
    if (url === "") throw new Error("apps.connections.open answered no URL");
    return url;
  }

  /** a page of a conversation's messages after `oldest` (not including it), newest first as Slack answers them; `next` is the cursor of
   * the page after, when there is one */
  async history(channel: string, oldest: string, limit: number, cursor?: string): Promise<{ messages: unknown[]; next?: string }> {
    const r = await this.call("conversations.history", { channel, oldest, inclusive: false, limit, cursor });
    if (!Array.isArray(r.messages)) throw new Error("conversations.history answered something that is not a list");
    const next = str((r.response_metadata as { next_cursor?: unknown } | undefined)?.next_cursor);
    return { messages: r.messages as unknown[], ...(next === "" ? {} : { next }) };
  }

  /** send `text` to `channel` as it is — no mrkdwn, no unfurls, top level (the caller escapes it: escapeSlack); answers the new
   * message's ts */
  async postMessage(channel: string, text: string): Promise<string> {
    const r = await this.call("chat.postMessage", { channel, text, mrkdwn: false, unfurl_links: false, unfurl_media: false });
    const ts = str(r.ts);
    if (ts === "") throw new Error("chat.postMessage answered no ts");
    return ts;
  }

  /** One call: `method` with `form`, the token in Authorization, cut at the deadline or when the caller's signal aborts. Resolves the
   * answer; rejects with a SlackApiError for an answer that is not `ok`, or with an Error that says what stopped the request — never a
   * token */
  private async call(method: string, form: Form, token = this.token): Promise<Record<string, unknown>> {
    if (this.signal?.aborted) throw new Error("stopped");
    const deadline = AbortSignal.timeout(CALL_DEADLINE_MS);
    const signal = this.signal ? AbortSignal.any([this.signal, deadline]) : deadline;
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) if (v !== undefined) body.set(k, String(v));
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/${method}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal,
      });
    } catch (err) {
      if (this.signal?.aborted) throw new Error("stopped");
      if (deadline.aborted) throw new Error(`no answer in ${CALL_DEADLINE_MS / 1000} s`);
      throw new Error(this.redact(reasonOf(err)));
    }
    let answer: Record<string, unknown> | undefined;
    try {
      const v = (await res.json()) as unknown;
      answer = v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
    } catch {
      if (this.signal?.aborted) throw new Error("stopped");
      if (deadline.aborted) throw new Error(`no answer in ${CALL_DEADLINE_MS / 1000} s`);
      answer = undefined;
    }
    if (res.ok && answer?.ok === true) return answer;
    const said = str(answer?.error);
    const code = this.redact(said === "" ? (res.ok ? "bad_answer" : `http_${res.status}`) : said);
    const header = res.headers.get("retry-after");
    const after = header === null || header.trim() === "" ? Number.NaN : Number(header);
    throw new SlackApiError(res.status, code, res.status === 429 && Number.isFinite(after) && after >= 0 ? after : undefined);
  }
}
