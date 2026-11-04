/** The desk's watchdog (spec §16 H4): one check per run, run by launchd every five minutes as the
 * LaunchAgent `com.gravit.face.watchdog` that `npm run service -- install` puts beside the face's.
 *
 *   npm run watchdog       one check by hand, as launchd runs it
 *
 * Each run asks the desk's health as `npm run service -- status --check` does (scripts/service.ts
 * `checkHealth`) and moves its state, `$DSH_HOME/face/desk/watchdog.json`:
 * - `0` healthy: after an outage, the phone hears `the desk answers again (down since …)`; the state
 *   is cleared.
 * - `1` degraded: counted; at the second check in a row, once per episode, the phone hears
 *   `the desk is degraded since …: <reason>`. A degraded desk is never restarted - another face on
 *   the port reads 1, and the watchdog never takes a port from a face that is not launchd's. An
 *   answer from launchd's own face ends an outage as `0` does, with its line, so a later silence is a
 *   new outage; another face's (`OTHER_FACE`) during an outage neither ends it nor is counted - the
 *   state is saved as it was and nothing is said.
 * - `2` down: the first run that sees it opens the outage and runs the service's own `restart` once
 *   (a kickstart, for a job launchd is about to start again) - written to the state before the
 *   restart, so a run cut short never restarts twice - and the phone hears
 *   `the desk has not answered since … (<reason>); the watchdog restarted it`, or `…; the restart
 *   failed: <reason>`. Later runs in the same outage do neither.
 * - `3` stopped on purpose (no plist, or launchd has no job): the state is cleared, nothing is said.
 *
 * Each run also asks the account (`GET <FACE_ACCOUNT_URL>/api/overview`) and the market
 * (`GET <FACE_MARKET_URL>/api/health`), 5 s each; any HTTP answer, whatever its status, is up (a 500
 * from the account's overview is an account that answers) - only no answer in 5 s is down. Each is its
 * own episode, counted like a degraded desk (the plan's ruling 11): down at two checks in a row,
 * once per episode -
 * - the market: `the market has not answered since …: prices, the watch and paper fills wait`;
 *   back, after that line: `the market answers again (down since …)`;
 * - the account: `the account has not answered since …; nothing reaches the phone until it does`;
 *   back, after that line: `the account answers again (down since …)`.
 * The watchdog never restarts the account or the market: their own LaunchAgents
 * (`npm run account:service`, `npm run market:service`) keep them alive.
 *
 * The phone is the account (spec §5.10): every line goes as `POST /api/account/identity/send
 * {kind: "watchdog", text}`, which the account sends to every connected network, quiet hours or
 * not. While the account is down this run, a line is logged as not sent - and a line that marks its
 * episode told (the desk degraded, the market down) is not marked, so the next run that reaches the
 * account says it. The one exception is the account-down line itself: it cannot go through the
 * account, so the watchdog reads the Telegram token from the account's home
 * (`credentials/networks/telegram.json`, {@link accountHomeOf}) - only a plain file, inside the home,
 * no link on the way, readable by the operator alone, the account's own rules - and sends that one
 * line itself, with the Bot API's sendMessage to the operator the account bound ({@link
 * phoneDirectOf}). The token is used for nothing else, read only then, and taken out of every line
 * sent and logged, as `<token>`. Until the Bot API takes it (a 2xx), the line is tried again at each
 * run - no token file, a file that fails the rules, a refusal, no answer; once taken it sends
 * nothing more until the account has come back. It reads no
 * TELEGRAM_* name and no `$DSH_HOME/.env`. Under compose the watchdog does not run.
 * While the desk's `OFF` pause is in force no line is sent - the direct one included - the log says
 * what was not, and the state and the restart go on.
 *
 * This script loads no dsh runtime.
 *
 * Importing this file runs nothing; run as a script, the guard at the end builds the real deps and
 * exits with {@link runWatchdog}'s code.
 * @module
 */
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { seatUrl } from "../src/account-seat.ts";
import { deskDir, deskTime, readOffState } from "../src/desk.ts";
import { marketUrl } from "../src/market-row.ts";
import { checkHealth, contextOf, OTHER_FACE, realDeps, runService, WATCHDOG_STATE_FILE, type HealthCode } from "./service.ts";

export { WATCHDOG_LABEL } from "./service.ts";

/** What watchdog.json holds between runs. `degradedSince` is the first check of a degraded episode,
 * which the degraded line names. The account's and the market's episodes: the checks down in a row,
 * the first of them (`…Since`), and whether the episode's line was said (`…Said`). */
export interface WatchdogState {
  outageSince?: string;
  degradedChecks: number;
  degradedSaid?: boolean;
  restartedAt?: string;
  degradedSince?: string;
  accountDownChecks: number;
  accountSince?: string;
  accountSaid?: true;
  marketDownChecks: number;
  marketSince?: string;
  marketSaid?: true;
}

/** The desk's part of the state. */
type DeskPart = Pick<WatchdogState, "outageSince" | "degradedChecks" | "degradedSaid" | "restartedAt" | "degradedSince">;
/** The account's and the market's part. */
type UpstreamPart = Omit<WatchdogState, keyof DeskPart>;

/** What {@link runWatchdog} acts on, injected: the script passes the real ones, a test fakes. */
export interface WatchdogDeps {
  /** The harness home, whose face/desk/ holds watchdog.json. */
  home: string;
  /** The desk's health (scripts/service.ts `checkHealth`). */
  check(): Promise<{ code: HealthCode; reason: string }>;
  /** Whether the account answers `GET /api/overview` at all in 5 s - any HTTP status is an answer; never throws. */
  checkAccount(): Promise<boolean>;
  /** Whether the market answers `GET /api/health` at all in 5 s - any HTTP status is an answer; never throws. */
  checkMarket(): Promise<boolean>;
  /** The service's restart; its exit code. */
  restart(): Promise<number>;
  /** `POST /api/account/identity/send {kind: "watchdog", text}`: true when the account answered (sent, queued or
   * held - its own words are logged), false when it did not or refused; never throws. */
  send(text: string): Promise<boolean>;
  /** The account-down line alone, straight to the Bot API with the token from the account's home
   * ({@link phoneDirectOf}): true only when the Bot API answered 2xx; never throws. */
  sendDirect(text: string): Promise<boolean>;
  /** Whether the desk's `OFF` pause is in force. */
  offInForce(): Promise<boolean>;
  now(): number;
  log(line: string): void;
}

/** watchdog.json's path under `home`. */
export function watchdogStatePath(home: string): string {
  return join(deskDir(home), WATCHDOG_STATE_FILE);
}

const CLEAR: WatchdogState = { degradedChecks: 0, accountDownChecks: 0, marketDownChecks: 0 };
const DESK_CLEAR: DeskPart = { degradedChecks: 0 };

/** Whether `v` is an ISO-ish time string - what the state's times are. */
const isTime = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

/**
 * watchdog.json as a state, or a cleared one when it is absent or is not one: a state the watchdog
 * cannot read starts afresh - at worst one more restart, never none.
 * @param home - the harness home.
 */
export async function readWatchdogState(home: string): Promise<WatchdogState> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(watchdogStatePath(home), "utf8"));
  } catch {
    return { ...CLEAR };
  }
  if (parsed === null || typeof parsed !== "object") return { ...CLEAR };
  const p = parsed as Record<string, unknown>;
  const count = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);
  return {
    ...(isTime(p.outageSince) ? { outageSince: p.outageSince } : {}),
    degradedChecks: count(p.degradedChecks),
    ...(p.degradedSaid === true ? { degradedSaid: true } : {}),
    ...(isTime(p.restartedAt) ? { restartedAt: p.restartedAt } : {}),
    ...(isTime(p.degradedSince) ? { degradedSince: p.degradedSince } : {}),
    accountDownChecks: count(p.accountDownChecks),
    ...(isTime(p.accountSince) ? { accountSince: p.accountSince } : {}),
    ...(p.accountSaid === true ? { accountSaid: true as const } : {}),
    marketDownChecks: count(p.marketDownChecks),
    ...(isTime(p.marketSince) ? { marketSince: p.marketSince } : {}),
    ...(p.marketSaid === true ? { marketSaid: true as const } : {}),
  };
}

/** Write the state, mode 0600 in a 0700 directory, as src/phone-bridge.ts writes its cursor. */
async function writeState(home: string, state: WatchdogState): Promise<void> {
  await writeFileAtomic(watchdogStatePath(home), `${JSON.stringify(state)}\n`, { mode: 0o600, dirMode: 0o700 });
}

/** A failure as its message. */
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * One check of each of the three, and what follows from it (the module's header). Every line sent is
 * also logged; while `OFF` is in force, or the account is down, it is logged as not sent.
 * @returns 0 once the state is written; 1 when the desk's check threw (the desk's part is left as it was; the
 *   account's and the market's still move) or the state could not be written.
 */
export async function runWatchdog(deps: WatchdogDeps): Promise<number> {
  const prev = await readWatchdogState(deps.home);
  /* The desk's check failing leaves the desk's part as it was - but the account and the market are still checked,
   * so an account-down notice is not lost to it, and the run exits 1. */
  let health: { code: HealthCode; reason: string } | undefined;
  try {
    health = await deps.check();
  } catch (err) {
    deps.log(`${new Date(deps.now()).toISOString()} check failed: ${messageOf(err)}`);
  }
  const [accountUp, marketUp] = await Promise.all([deps.checkAccount().catch(() => false), deps.checkMarket().catch(() => false)]);
  const now = deps.now();
  const iso = new Date(now).toISOString();
  deps.log(`${iso} health ${health === undefined ? "unknown" : `${health.code} ${health.reason}`}; account ${accountUp ? "answers" : "down"}; market ${marketUp ? "answers" : "down"}`);
  const at = (time: string): string => deskTime(new Date(time), new Date(now));
  let off: boolean;
  try {
    off = await deps.offInForce();
  } catch {
    off = true; /* a pause that cannot be read is never read as none */
  }
  /** A line through the account: true when the account took it. */
  const say = async (line: string): Promise<boolean> => {
    if (off) {
      deps.log(`OFF in force, not sent: ${line}`);
      return false;
    }
    if (!accountUp) {
      deps.log(`the account is down, not sent: ${line}`);
      return false;
    }
    deps.log(`sent: ${line}`);
    if (await deps.send(line)) return true;
    deps.log(`the account did not take it: ${line}`);
    return false;
  };
  const save = async (state: WatchdogState): Promise<boolean> => {
    try {
      await writeState(deps.home, state);
      return true;
    } catch (err) {
      deps.log(`cannot write ${watchdogStatePath(deps.home)}: ${messageOf(err)}`);
      return false;
    }
  };
  const prevUpstream: UpstreamPart = {
    accountDownChecks: prev.accountDownChecks, marketDownChecks: prev.marketDownChecks,
    ...(prev.accountSince === undefined ? {} : { accountSince: prev.accountSince }),
    ...(prev.accountSaid === true ? { accountSaid: true as const } : {}),
    ...(prev.marketSince === undefined ? {} : { marketSince: prev.marketSince }),
    ...(prev.marketSaid === true ? { marketSaid: true as const } : {}),
  };

  /* The account first: its answers-again line goes before any line it carries this run. */
  const upstream: UpstreamPart = { accountDownChecks: 0, marketDownChecks: 0 };
  if (accountUp) {
    if (prev.accountSaid === true && prev.accountSince !== undefined) await say(`the account answers again (down since ${at(prev.accountSince)})`);
  } else {
    upstream.accountDownChecks = prev.accountDownChecks + 1;
    upstream.accountSince = prev.accountSince ?? iso;
    if (prev.accountSaid === true) upstream.accountSaid = true;
    else if (upstream.accountDownChecks >= 2) {
      const line = `the account has not answered since ${at(upstream.accountSince)}; nothing reaches the phone until it does`;
      if (off) deps.log(`OFF in force, not sent: ${line}`);
      else {
        deps.log(`sending directly: ${line}`);
        if (await deps.sendDirect(line)) upstream.accountSaid = true;
        else deps.log(`not sent directly, tried again at the next run: ${line}`);
      }
    }
  }

  const desk = health === undefined
    ? { state: deskPartOf(prev), ok: false }
    : await deskStep(prev, health.code, health.reason, iso, at, say, async (part) => save({ ...part, ...prevUpstream }), deps);
  if (desk === undefined) return 1;

  if (marketUp) {
    if (prev.marketSaid === true && prev.marketSince !== undefined) await say(`the market answers again (down since ${at(prev.marketSince)})`);
  } else {
    upstream.marketDownChecks = prev.marketDownChecks + 1;
    upstream.marketSince = prev.marketSince ?? iso;
    if (prev.marketSaid === true) upstream.marketSaid = true;
    else if (upstream.marketDownChecks >= 2 && (await say(`the market has not answered since ${at(upstream.marketSince)}: prices, the watch and paper fills wait`))) upstream.marketSaid = true;
  }
  const written = await save({ ...desk.state, ...upstream });
  return written && desk.ok ? 0 : 1;
}

/** The desk's part of `state`. */
function deskPartOf(state: WatchdogState): DeskPart {
  return {
    ...(state.outageSince === undefined ? {} : { outageSince: state.outageSince }),
    degradedChecks: state.degradedChecks,
    ...(state.degradedSaid === true ? { degradedSaid: true } : {}),
    ...(state.restartedAt === undefined ? {} : { restartedAt: state.restartedAt }),
    ...(state.degradedSince === undefined ? {} : { degradedSince: state.degradedSince }),
  };
}

/**
 * The desk's part of a run (the module's header): its next state, and whether every write on the way
 * went - or `undefined` when the outage could not be written before the restart (nothing restarted).
 * `saveEarly` writes the desk's part with the account's and the market's as they were.
 */
async function deskStep(
  prev: WatchdogState, code: HealthCode, reason: string, iso: string, at: (time: string) => string,
  say: (line: string) => Promise<boolean>, saveEarly: (part: DeskPart) => Promise<boolean>, deps: WatchdogDeps,
): Promise<{ state: DeskPart; ok: boolean } | undefined> {
  if (code === 3) return { state: { ...DESK_CLEAR }, ok: true };
  if (code === 2) {
    if (prev.outageSince !== undefined) return { state: { ...DESK_CLEAR, outageSince: prev.outageSince, ...(prev.restartedAt === undefined ? {} : { restartedAt: prev.restartedAt }) }, ok: true };
    /* The outage is written before the restart: a run cut short in the restart never restarts again. */
    const opened: DeskPart = { ...DESK_CLEAR, outageSince: iso };
    if (!(await saveEarly(opened))) return undefined;
    let failure: string | undefined;
    try {
      const exit = await deps.restart();
      if (exit !== 0) failure = `npm run service -- restart exited ${exit} (its lines are in watchdog.log)`;
    } catch (err) {
      failure = messageOf(err);
    }
    const restarted: DeskPart = { ...opened, restartedAt: new Date(deps.now()).toISOString() };
    const written = await saveEarly(restarted);
    await say(`the desk has not answered since ${at(iso)} (${reason}); ${failure === undefined ? "the watchdog restarted it" : `the restart failed: ${failure}`}`);
    return { state: restarted, ok: written };
  }
  const prevDesk = deskPartOf(prev);
  /* Another face on the port - the operator's own, started to look - is not launchd's answering: in an outage the
   * outage stays open, nothing is said, and the degraded count is left alone (Ruling 10's narrowing). */
  if (code === 1 && reason === OTHER_FACE && prev.outageSince !== undefined) return { state: prevDesk, ok: true };
  /* 0 or 1: launchd's face answers, which ends an outage. */
  if (prev.outageSince !== undefined) await say(`the desk answers again (down since ${at(prev.outageSince)})`);
  if (code === 0) return { state: { ...DESK_CLEAR }, ok: true };
  const episode = prev.outageSince === undefined ? prevDesk : DESK_CLEAR;
  const next: DeskPart = {
    degradedChecks: episode.degradedChecks + 1,
    degradedSince: episode.degradedSince ?? iso,
    ...(episode.degradedSaid === true ? { degradedSaid: true } : {}),
  };
  if (next.degradedChecks >= 2 && next.degradedSaid !== true && (await say(`the desk is degraded since ${at(next.degradedSince!)}: ${reason}`))) next.degradedSaid = true;
  return { state: next, ok: true };
}

/** Every spelling of `token` a line could carry - as it is, URL-encoded, JSON-escaped - made `<token>`. */
export function redactorOf(token: string): (text: string) => string {
  if (token === "") return (text) => text;
  const spellings = [...new Set([token, encodeURIComponent(token), JSON.stringify(token).slice(1, -1)])].sort((a, b) => b.length - a.length);
  return (text) => spellings.reduce((out, spelling) => out.split(spelling).join("<token>"), text);
}

/** The account's home, whose `credentials/networks/telegram.json` {@link phoneDirectOf} reads: `FACE_ACCOUNT_HOME`,
 * else `BUYER_HOME` (the account's own name for it), else `~/.buyer-agent-demo`, the account's default. */
export function accountHomeOf(env: NodeJS.ProcessEnv): string {
  return env.FACE_ACCOUNT_HOME?.trim() || env.BUYER_HOME?.trim() || join(homedir(), ".buyer-agent-demo");
}

/** Whether `path` is under `root`, and not `root` itself. */
const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/** The account's Telegram file, read as the account reads it (account/src/portfolio/identity/secret-file.ts
 * `readNetworkSecret` over live/credentials.ts `readSecretFile`): no link on the way, inside the home, a plain file,
 * readable by its owner alone; its token and the operator's id. Or why not - words that carry no value from the file. */
function readTelegramFile(accountHome: string): { token: string; operatorId: string } | { why: string } {
  const root = resolve(accountHome);
  const ref = "credentials/networks/telegram.json";
  const file = join(root, ref);
  try {
    for (const p of [join(root, "credentials"), join(root, "credentials", "networks"), file]) {
      if (lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink()) return { why: `${ref}: a link on the way, not read` };
    }
    if (!existsSync(file)) return { why: `no ${ref} in the account's home (Telegram not connected)` };
    const real = realpathSync(file);
    if (!inside(realpathSync(root), real)) return { why: `${ref} leads out of the account's home, not read` };
    const st = statSync(real);
    if (!st.isFile()) return { why: `${ref} is not a file, not read` };
    if ((st.mode & 0o077) !== 0) return { why: `${ref} can be read by other users (mode ${(st.mode & 0o777).toString(8)}), not read` };
    const parsed: unknown = JSON.parse(readFileSync(real, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { why: `${ref} is not a token file` };
    const { token, operatorId } = parsed as Record<string, unknown>;
    if (typeof token !== "string" || token === "" || typeof operatorId !== "string" || !/^\d{1,16}$/.test(operatorId)) return { why: `${ref} is not a token file` };
    return { token, operatorId };
  } catch (err) {
    return { why: `${ref} could not be read (${(err as NodeJS.ErrnoException).code ?? "unreadable"})` };
  }
}

/**
 * The watchdog's direct phone, for the account-down line alone: the Bot API's `sendMessage` to the operator the
 * account bound, with the token from `<accountHome>/credentials/networks/telegram.json` - read at each send, only if
 * the file passes the account's own rules (no link on the way, inside the home, a plain file, mode 0600) - plain
 * text, a 15 s timeout; true only on the Bot API's 2xx. A file that does not pass, a refusal or a failure is
 * logged, never thrown, and answers false. Every token read is
 * taken out of the text sent and of every line logged; `redact` does the same for the caller's own log.
 * @param accountHome - the account's home ({@link accountHomeOf}).
 * @param io - `fetch`, and `log`, where a line goes.
 */
export function phoneDirectOf(accountHome: string, io: { fetch: typeof fetch; log(line: string): void }): { send(text: string): Promise<boolean>; redact(text: string): string } {
  const tokens = new Set<string>();
  const redact = (text: string): string => [...tokens].reduce((out, token) => redactorOf(token)(out), text);
  const log = (line: string): void => io.log(redact(line));
  return {
    redact,
    async send(text) {
      const file = readTelegramFile(accountHome);
      if ("why" in file) {
        log(`${file.why}; not sent: ${text}`);
        return false;
      }
      tokens.add(file.token);
      const chatId = Number.isSafeInteger(Number(file.operatorId)) ? Number(file.operatorId) : file.operatorId;
      try {
        const res = await io.fetch(`https://api.telegram.org/bot${file.token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: redact(text) }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) {
          await res.body?.cancel().catch(() => undefined);
          return true;
        }
        const body = await res.text().catch(() => "");
        log(`telegram refused the line: ${res.status} ${body}`);
      } catch (err) {
        log(`telegram send failed: ${messageOf(err)}`);
      }
      return false;
    },
  };
}

/** Whether `url` answers a GET at all in 5 s - any HTTP status, a 500 included, is an answer; only no answer
 * (refused, reset, timed out) is not. Never throws.
 * @param fetchImpl - the global fetch by default. */
export async function answers(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) });
    await res.body?.cancel().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/**
 * A watchdog line through the account at `base`: `POST /api/account/identity/send {kind: "watchdog", text}`, 30 s
 * (src/phone.ts's deadline). True when the account answered `{ok: true, …}` - sent, queued, or held, which is logged
 * - false, with one line, when it refused (`{ok: false, error}`) or did not answer.
 */
export function accountSendOf(base: string, io: { fetch: typeof fetch; log(line: string): void }): (text: string) => Promise<boolean> {
  const url = `${base.replace(/\/+$/, "")}/api/account/identity/send`;
  return async (text) => {
    try {
      const res = await io.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "watchdog", text }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined;
      if (body?.ok === true) {
        if (typeof body.held === "string") io.log(`the account held it (${body.held})`);
        return true;
      }
      io.log(`the account refused it: ${typeof body?.error === "string" ? body.error : `HTTP ${res.status}`}`);
      return false;
    } catch (err) {
      io.log(`the account could not be asked: ${messageOf(err)}`);
      return false;
    }
  };
}

/** The real deps: the service's own check and restart over its real deps, the account and the market at the face's
 * own URLs (`FACE_ACCOUNT_URL`, `FACE_MARKET_URL`, or their defaults), the account's home for the direct phone, the
 * desk's OFF, and stdout - launchd's watchdog.log - for the log, redacted. */
function realWatchdogDeps(): WatchdogDeps {
  const service = realDeps();
  const direct = phoneDirectOf(accountHomeOf(process.env), { fetch, log: (line) => console.log(line) });
  const log = (line: string): void => console.log(direct.redact(line));
  const quiet = { ...service, out: log };
  const account = seatUrl().replace(/\/+$/, "");
  return {
    home: service.home,
    check: () => checkHealth(contextOf(quiet, undefined)),
    checkAccount: () => answers(`${account}/api/overview`),
    checkMarket: () => answers(`${marketUrl().replace(/\/+$/, "")}/api/health`),
    restart: () => runService("restart", [], quiet),
    send: accountSendOf(account, { fetch, log }),
    sendDirect: direct.send,
    async offInForce() {
      const { state, expired } = await readOffState(service.home);
      return state !== undefined && !expired;
    },
    now: Date.now,
    log,
  };
}

/* Run only as a script - the tests import runWatchdog. Compared as real paths, as service.ts does. */
const invokedAs = process.argv[1];
if (invokedAs !== undefined && existsSync(invokedAs) && realpathSync(invokedAs) === realpathSync(fileURLToPath(import.meta.url))) {
  const code = await runWatchdog(realWatchdogDeps()).catch((err: unknown) => {
    console.error(err);
    return 1;
  });
  process.stdout.write("", () => process.exit(code));
}
