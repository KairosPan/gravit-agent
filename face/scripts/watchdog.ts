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
 *   answer ends an outage as `0` does, with its line, so a later silence is a new outage.
 * - `2` down: the first run that sees it opens the outage and runs the service's own `restart` once
 *   (a kickstart, for a job launchd is about to start again) - written to the state before the
 *   restart, so a run cut short never restarts twice - and the phone hears
 *   `the desk has not answered since …(<reason>); the watchdog restarted it`, or `the restart
 *   failed: <reason>`. Later runs in the same outage do neither.
 * - `3` stopped on purpose (no plist, or launchd has no job): the state is cleared, nothing is said.
 * While the desk's `OFF` pause is in force no line is sent - the log says what was not - and the
 * state and the restart go on.
 *
 * The phone is the Bot API's sendMessage to TELEGRAM_OPERATOR_ID, with TELEGRAM_BOT_TOKEN, both read
 * from `$DSH_HOME/.env` as the face reads them; plain text, a 15 s timeout, never thrown. It is its
 * own few lines, not src/telegram.ts, which loads the desk tools: this script loads no dsh runtime.
 * The token is taken out of every line sent and every line logged, as `<token>`.
 *
 * Importing this file runs nothing; run as a script, the guard at the end builds the real deps and
 * exits with {@link runWatchdog}'s code.
 * @module
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { deskDir, deskTime, readOffState } from "../src/desk.ts";
import { checkHealth, contextOf, realDeps, runService, WATCHDOG_STATE_FILE, type HealthCode } from "./service.ts";

export { WATCHDOG_LABEL } from "./service.ts";

/** What watchdog.json holds between runs. `degradedSince` is the first check of a degraded episode,
 * which the degraded line names. */
export interface WatchdogState {
  outageSince?: string;
  degradedChecks: number;
  degradedSaid?: boolean;
  restartedAt?: string;
  degradedSince?: string;
}

/** What {@link runWatchdog} acts on, injected: the script passes the real ones, a test fakes. */
export interface WatchdogDeps {
  /** The harness home, whose face/desk/ holds watchdog.json. */
  home: string;
  /** The desk's health (scripts/service.ts `checkHealth`). */
  check(): Promise<{ code: HealthCode; reason: string }>;
  /** The service's restart; its exit code. */
  restart(): Promise<number>;
  /** Bot API sendMessage to TELEGRAM_OPERATOR_ID, 15 s, never throws. */
  send(text: string): Promise<void>;
  /** Whether the desk's `OFF` pause is in force. */
  offInForce(): Promise<boolean>;
  now(): number;
  log(line: string): void;
}

/** watchdog.json's path under `home`. */
export function watchdogStatePath(home: string): string {
  return join(deskDir(home), WATCHDOG_STATE_FILE);
}

const CLEAR: WatchdogState = { degradedChecks: 0 };

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
  const checks = typeof p.degradedChecks === "number" && Number.isInteger(p.degradedChecks) && p.degradedChecks >= 0 ? p.degradedChecks : 0;
  return {
    ...(isTime(p.outageSince) ? { outageSince: p.outageSince } : {}),
    degradedChecks: checks,
    ...(p.degradedSaid === true ? { degradedSaid: true } : {}),
    ...(isTime(p.restartedAt) ? { restartedAt: p.restartedAt } : {}),
    ...(isTime(p.degradedSince) ? { degradedSince: p.degradedSince } : {}),
  };
}

/** Write the state, mode 0600 in a 0700 directory, as src/telegram.ts writes its files. */
async function writeState(home: string, state: WatchdogState): Promise<void> {
  await writeFileAtomic(watchdogStatePath(home), `${JSON.stringify(state)}\n`, { mode: 0o600, dirMode: 0o700 });
}

/** A failure as its message. */
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * One check, and what follows from it (the module's header). Every line sent is also logged; while
 * `OFF` is in force, it is logged as not sent.
 * @returns 0 once the state is written; 1 when the check threw (the state is left as it was) or the
 *   state could not be written.
 */
export async function runWatchdog(deps: WatchdogDeps): Promise<number> {
  const prev = await readWatchdogState(deps.home);
  let health: { code: HealthCode; reason: string };
  try {
    health = await deps.check();
  } catch (err) {
    deps.log(`${new Date(deps.now()).toISOString()} check failed: ${messageOf(err)}`);
    return 1;
  }
  const { code, reason } = health;
  const now = deps.now();
  const iso = new Date(now).toISOString();
  deps.log(`${iso} health ${code} ${reason}`);
  const at = (time: string): string => deskTime(new Date(time), new Date(now));
  let off: boolean;
  try {
    off = await deps.offInForce();
  } catch {
    off = true; /* a pause that cannot be read is never read as none */
  }
  const say = async (line: string): Promise<boolean> => {
    if (off) {
      deps.log(`OFF in force, not sent: ${line}`);
      return false;
    }
    deps.log(`sent: ${line}`);
    await deps.send(line);
    return true;
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

  if (code === 3) return (await save({ ...CLEAR })) ? 0 : 1;
  if (code === 2) {
    if (prev.outageSince !== undefined) return (await save({ ...CLEAR, outageSince: prev.outageSince, ...(prev.restartedAt === undefined ? {} : { restartedAt: prev.restartedAt }) })) ? 0 : 1;
    /* The outage is written before the restart: a run cut short in the restart never restarts again. */
    const opened: WatchdogState = { ...CLEAR, outageSince: iso };
    if (!(await save(opened))) return 1;
    let failure: string | undefined;
    try {
      const exit = await deps.restart();
      if (exit !== 0) failure = `npm run service -- restart exited ${exit} (its lines are in watchdog.log)`;
    } catch (err) {
      failure = messageOf(err);
    }
    const restarted = { ...opened, restartedAt: new Date(deps.now()).toISOString() };
    const written = await save(restarted);
    await say(`the desk has not answered since ${at(iso)} (${reason}); ${failure === undefined ? "the watchdog restarted it" : `the restart failed: ${failure}`}`);
    return written ? 0 : 1;
  }
  /* 0 or 1: the port answers, which ends an outage. */
  if (prev.outageSince !== undefined) await say(`the desk answers again (down since ${at(prev.outageSince)})`);
  if (code === 0) return (await save({ ...CLEAR })) ? 0 : 1;
  const episode = prev.outageSince === undefined ? prev : CLEAR;
  const next: WatchdogState = {
    degradedChecks: episode.degradedChecks + 1,
    degradedSince: episode.degradedSince ?? iso,
    ...(episode.degradedSaid === true ? { degradedSaid: true } : {}),
  };
  if (next.degradedChecks >= 2 && next.degradedSaid !== true && (await say(`the desk is degraded since ${at(next.degradedSince!)}: ${reason}`))) next.degradedSaid = true;
  return (await save(next)) ? 0 : 1;
}

/** Every spelling of `token` a line could carry - as it is, URL-encoded, JSON-escaped - made `<token>`. */
export function redactorOf(token: string): (text: string) => string {
  if (token === "") return (text) => text;
  const spellings = [...new Set([token, encodeURIComponent(token), JSON.stringify(token).slice(1, -1)])].sort((a, b) => b.length - a.length);
  return (text) => spellings.reduce((out, spelling) => out.split(spelling).join("<token>"), text);
}

/**
 * The watchdog's phone: Bot API `sendMessage` to TELEGRAM_OPERATOR_ID with TELEGRAM_BOT_TOKEN, from
 * `env` (the home's .env), plain text, a 15 s timeout; a refusal or a failure is logged, never
 * thrown. Unless the token is set and the id is digits only, nothing is sent and the log says so.
 * The token is taken out of the text sent and of every line logged; `redact` does the same for the
 * caller's own log.
 * @param env - the names, as `parseEnv` reads $DSH_HOME/.env.
 * @param io - `fetch`, and `log`, where a line goes.
 */
export function phoneOf(env: Record<string, string | undefined>, io: { fetch: typeof fetch; log(line: string): void }): { send(text: string): Promise<void>; redact(text: string): string } {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const id = env.TELEGRAM_OPERATOR_ID?.trim() ?? "";
  const redact = redactorOf(token);
  const log = (line: string): void => io.log(redact(line));
  const operatorId = /^\d+$/.test(id) ? Number(id) : Number.NaN;
  if (token === "" || !Number.isSafeInteger(operatorId)) {
    return { redact, send: async (text) => { log(`telegram not configured (TELEGRAM_BOT_TOKEN and TELEGRAM_OPERATOR_ID in $DSH_HOME/.env), not sent: ${text}`); } };
  }
  return {
    redact,
    async send(text) {
      try {
        const res = await io.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: operatorId, text: redact(text) }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) {
          await res.body?.cancel().catch(() => undefined);
          return;
        }
        const body = await res.text().catch(() => "");
        log(`telegram refused the line: ${res.status} ${body}`);
      } catch (err) {
        log(`telegram send failed: ${messageOf(err)}`);
      }
    },
  };
}

/** The home's .env as names, or none when it cannot be read; the process's own names fill the gaps. */
function homeEnv(home: string): Record<string, string | undefined> {
  let file: Record<string, string> = {};
  try {
    file = parseEnv(readFileSync(join(home, ".env"), "utf8")) as Record<string, string>;
  } catch {
    /* no .env: the phone says it is not configured */
  }
  return { ...process.env, ...file };
}

/** The real deps: the service's own check and restart over its real deps, the home's .env for the
 * phone, the desk's OFF, and stdout - launchd's watchdog.log - for the log, redacted. */
function realWatchdogDeps(): WatchdogDeps {
  const service = realDeps();
  const phone = phoneOf(homeEnv(service.home), { fetch, log: (line) => console.log(line) });
  const log = (line: string): void => console.log(phone.redact(line));
  const quiet = { ...service, out: log };
  return {
    home: service.home,
    check: () => checkHealth(contextOf(quiet, undefined)),
    restart: () => runService("restart", [], quiet),
    send: phone.send,
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
