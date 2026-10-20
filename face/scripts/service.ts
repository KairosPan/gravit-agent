/** gravit-face as a macOS user service: started when the operator logs in, started again when it
 * stops by accident - a crash, a `kill -9` - with its logs under the harness home, where only the
 * operator can read them. launchd runs it (a LaunchAgent in ~/Library/LaunchAgents, modelled on the
 * demo's demo/src/portfolio/account-service.ts), and nothing about it needs an administrator.
 * Spec: docs/superpowers/specs/2026-10-19-always-on-gravit-design.md §5.2.
 *
 *   npm run service -- install      write $DSH_HOME/.env from the repo's key files when the home has none, then run the face in the background, from now on
 *   npm run service -- status       is it loaded, does it answer and since when, how the last run ended, the sign-in URL
 *   npm run service -- start        start it (refused, like install, while anything else answers on the port: a terminal npm start?)
 *   npm run service -- stop         stop it: launchd lets go of the job, and the plist stays for start or the next login
 *   npm run service -- restart      stop it and start it again (after an update, to pick up new code)
 *   npm run service -- logs         the last 40 lines of each of its two logs
 *   npm run service -- url          the sign-in URL (the one with ?token=) from its log
 *   npm run service -- uninstall    stop it and take it out of launchd; the ledger and $DSH_HOME/.env stay
 *
 * Every command takes `--port N` for a face not on 3090; without it the port is the installed
 * plist's FACE_PORT, else 3090. `install` hands the port to the face as FACE_PORT - the one given,
 * or the installed one, so a reinstall without `--port` does not move the face. The log and the
 * ledger are read from the home the installed plist names (its DSH_HOME) when it names one, else
 * from this shell's; `install` writes this shell's home into the plist.
 *
 * What it runs is this checkout - node by its PATH location, tsx, face/src/main.ts, with face/ as
 * the working directory (main.ts moves to the repo root itself) - so a change here reaches it on
 * the next restart. Its environment is PATH, HOME, DSH_HOME and, only when asked, FACE_PORT, never
 * a key: whatever a LaunchAgent's environment holds sits in its plist and shows in `launchctl
 * print`. The keys live in $DSH_HOME/.env (mode 0600), which dsh reads at boot; `install` writes
 * that file from .env.deepseek, .env.alpaca and .env.ifind at the repo root when the home has none,
 * and never rewrites it. It copies an allow-list of names only ({@link COPIED_KEYS}, and any
 * `ALPHA_*`) and names the rest: dsh refuses a bootstrap-only name (PATH, NODE_OPTIONS, any DSH_*)
 * in the home's .env at boot, which would fail every start, and Gate 1's ALPACA_KIT_ENABLE_ORDERS
 * must never reach the real harness home.
 *
 * The exports are a pure half - the plan, the home's .env, the parsers and the status text, which
 * touch nothing but the paths their arguments name - and {@link runService}, the commands over
 * injected {@link ServiceDeps} (launchctl, fetch, the paths, the printer, the clock), so that the
 * tests drive every command against a fake launchctl and never the operator's launchd. Importing
 * this file runs nothing; it loads desk.ts, whose ledger reader `status` uses. Run as a script, the
 * guard at the end builds the real deps and exits with the command's code.
 * @module
 */
import { execFileSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { deskDir, readEvents, runsOf, type DeskRun, type DeskStatus } from "../src/desk.ts";

/** The LaunchAgent's label: the plist is `com.gravit.face.plist`, the job `gui/<uid>/com.gravit.face`. */
export const LABEL = "com.gravit.face";

/** The names the service needs from $DSH_HOME/.env - DeepSeek's key for Gravit, Alpaca's pair for
 * the market data and the paper account. `install` names those the home's file lacks: a face
 * booted without one serves until the first prompt or quote that needs it. */
export const EXPECTED_KEYS = ["DEEPSEEK_API_KEY", "APCA_API_KEY_ID", "APCA_API_SECRET_KEY"] as const;

/** The names {@link ensureHomeEnv} copies into the home's .env: the expected keys, Alpaca's
 * endpoint and iFinD's tokens - and, by {@link COPIED_PREFIXES}, the workbench's own `ALPHA_*`
 * settings. It is an allow-list because a copied line can break or arm the service: dsh refuses a
 * bootstrap-only name (PATH, NODE_OPTIONS, any DSH_* ...) in the home's .env and the boot fails,
 * and Gate 1's ALPACA_KIT_ENABLE_ORDERS must never reach the real harness home. */
export const COPIED_KEYS = [...EXPECTED_KEYS, "APCA_API_BASE_URL", "IFIND_ACCESS_TOKEN", "IFIND_REFRESH_TOKEN"] as const;

/** The name prefixes {@link ensureHomeEnv} copies besides {@link COPIED_KEYS}. */
export const COPIED_PREFIXES = ["ALPHA_"] as const;

/** Whether {@link ensureHomeEnv} copies `name` into the home's .env: one of {@link COPIED_KEYS},
 * or a name that starts with one of {@link COPIED_PREFIXES}. Case-sensitive, as dsh reads names
 * on this system. */
export function isCopiedKey(name: string): boolean {
  return (COPIED_KEYS as readonly string[]).includes(name) || COPIED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** The LaunchAgent as data: what {@link servicePlan} returns and `install` writes. */
export interface ServicePlan {
  /** The plist's text. */
  plist: string;
  /** Where the plist goes: `<launchAgentsDir>/com.gravit.face.plist`. */
  path: string;
  /** The face's stdout, `$DSH_HOME/face/service/face.log` - the sign-in URL is printed there. */
  log: string;
  /** The face's stderr, `$DSH_HOME/face/service/face.err.log`. */
  errLog: string;
  /** `ProgramArguments`: node, tsx's CLI, main.ts. */
  args: string[];
  /** `EnvironmentVariables`, in the plist's order. */
  env: Record<string, string>;
}

/** `&`, `<` and `>` as XML entities - every string the plist carries goes through it. */
const xml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The PATH the service runs with: `path` without its empty entries and without any folder that
 * contains `/node_modules/` - the ones npm puts first while it runs a script are npm's, not the
 * operator's.
 */
export function filterPath(path: string): string {
  return path.split(":").filter((dir) => dir !== "" && !dir.includes("/node_modules/")).join(":");
}

/**
 * The LaunchAgent that runs this checkout's face, rendered as the demo's `plan` renders its own.
 * Pure: it reads and writes nothing, and every machine-specific value is an argument.
 *
 * - `ProgramArguments`: `node` by its full path (launchd has no shell to find it), then tsx's CLI
 *   and main.ts, both under `root`'s face/.
 * - `WorkingDirectory`: face/ - main.ts moves to the repo root itself.
 * - `EnvironmentVariables`: PATH through {@link filterPath}, HOME, DSH_HOME, and FACE_PORT only
 *   when `port` is given - never a key.
 * - `RunAtLoad` and `KeepAlive { SuccessfulExit false }`: started at login, and again after any
 *   exit but a clean one - the face exits 0 on SIGTERM. `stop` does not lean on that: it boots the
 *   job out of launchd, because a face whose teardown throws exits 1 and would be started again.
 * - `ThrottleInterval 30`: launchd starts it at most once every 30 s, so a face that cannot boot
 *   (the port taken, a broken checkout) is retried twice a minute, not in a tight loop.
 * - `Umask 63` (077): what the face creates, its logs included, gets no group or other access.
 * - `StandardOutPath` / `StandardErrorPath`: face.log / face.err.log in the home's face/service/.
 *
 * Every string in the plist is XML-escaped.
 * @param opts - `root`, the repo root; `home`, the harness home (DSH_HOME); `homeDir`, the
 *   operator's home directory (HOME); `node`, node's path; `path`, the PATH to filter;
 *   `launchAgentsDir`, where the plist goes; `port`, FACE_PORT, given only for a face that is not
 *   on main.ts's default.
 */
export function servicePlan(opts: {
  root: string;
  home: string;
  homeDir: string;
  node: string;
  path: string;
  launchAgentsDir: string;
  port?: number;
}): ServicePlan {
  const face = join(opts.root, "face");
  const logs = join(opts.home, "face", "service");
  const log = join(logs, "face.log");
  const errLog = join(logs, "face.err.log");
  const args = [opts.node, join(face, "node_modules", "tsx", "dist", "cli.mjs"), join(face, "src", "main.ts")];
  const env: Record<string, string> = { PATH: filterPath(opts.path), HOME: opts.homeDir, DSH_HOME: opts.home };
  if (opts.port !== undefined) env.FACE_PORT = String(opts.port);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key><string>${xml(face)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env).map(([k, v]) => `    <key>${xml(k)}</key><string>${xml(v)}</string>`).join("\n")}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(errLog)}</string>
  <key>ProcessType</key><string>Standard</string>
</dict>
</plist>
`;
  return { plist, path: join(opts.launchAgentsDir, `${LABEL}.plist`), log, errLog, args, env };
}

/** One `NAME=VALUE` line, indented by spaces or tabs or not, an `export ` before the name allowed -
 * what a file that is `source`d and dsh's reader both take. Only spaces and tabs: node's
 * `util.parseEnv` keeps any other leading character (a form feed, a no-break space) as part of the
 * name. */
const ENV_LINE = /^[ \t]*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/**
 * The `NAME=VALUE` lines of an env file, in order, as the home's .env takes them: `line` is the
 * source line without its indentation and its `export ` prefix, its value untouched - no
 * unquoting, no trimming, an inline `# comment` left for the reader to strip. Blanks, `#` comments
 * and every other line are dropped. A CRLF file reads as an LF one: the `\r` ends the line, it is
 * not part of the value.
 * @param text - the file's contents.
 */
export function envLinesOf(text: string): { name: string; line: string }[] {
  const lines: { name: string; line: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = ENV_LINE.exec(raw);
    if (match === null) continue;
    const [, name, value] = match;
    lines.push({ name, line: `${name}=${value}` });
  }
  return lines;
}

/**
 * The names an env file gives dsh: those node's `util.parseEnv` - the reader dsh's boot uses on the
 * home's .env - reads with a non-empty value, so `KEY=` and `KEY=""` do not count and an indented
 * `  KEY=v` does. `parseEnv` returns its names sorted; these come in the order the file first gives
 * them ({@link envLinesOf}), and a name only `parseEnv` finds (`KEY = v`) comes after, sorted.
 * @param text - the file's contents.
 */
function namesOf(text: string): string[] {
  const parsed = parseEnv(text);
  const read = Object.keys(parsed).filter((name) => typeof parsed[name] === "string" && parsed[name] !== "");
  const inFileOrder = envLinesOf(text).map((l) => l.name).filter((name) => read.includes(name));
  return [...new Set([...inFileOrder, ...read])];
}

/**
 * Make sure the harness home has its .env - the service's only source of keys - without ever
 * rewriting one.
 *
 * An existing `<home>/.env` is read, never written, and the sources are not read at all: `names`
 * are its own and `skipped` is empty. Otherwise the {@link envLinesOf} lines of every source that
 * exists are taken in order; those whose name {@link isCopiedKey} allows - an allow-list, because
 * dsh refuses bootstrap-only names in the home's .env and Gate 1's flag must never reach it - are
 * written as the new file, mode 0600, `home` created first (0700), and every other name is
 * `skipped`. When no line is allowed, nothing is written. The file is opened exclusively (`wx`),
 * so one that appears between the check and the write, or a dangling link in its place, is
 * refused rather than overwritten. `names` and `missing` are what dsh will read from the file
 * ({@link namesOf}), not what the lines look like: a key with an empty value is missing.
 * @param home - the harness home (DSH_HOME).
 * @param sources - the key files to copy from, in order (the repo root's .env.deepseek,
 *   .env.alpaca, .env.ifind).
 * @returns `path`, the home's .env; `created`, whether this call wrote it; `names`, the names dsh
 *   reads from the file with a value - none when nothing was written; `missing`, the
 *   {@link EXPECTED_KEYS} not among them; `missingSources`, the sources that do not exist;
 *   `skipped`, the names the sources hold that were not copied, once each, in the order first seen.
 * @throws when a file that exists cannot be read, or the new file cannot be written.
 */
export function ensureHomeEnv(home: string, sources: string[]): {
  path: string;
  created: boolean;
  names: string[];
  missing: string[];
  missingSources: string[];
  skipped: string[];
} {
  const path = join(home, ".env");
  const present: string[] = [];
  const missingSources: string[] = [];
  for (const source of sources) (existsSync(source) ? present : missingSources).push(source);
  const missingOf = (names: string[]): string[] => EXPECTED_KEYS.filter((key) => !names.includes(key));
  if (existsSync(path)) {
    const names = namesOf(readFileSync(path, "utf8"));
    return { path, created: false, names, missing: missingOf(names), missingSources, skipped: [] };
  }
  const found = present.flatMap((source) => envLinesOf(readFileSync(source, "utf8")));
  const lines = found.filter((l) => isCopiedKey(l.name));
  const skipped = [...new Set(found.filter((l) => !isCopiedKey(l.name)).map((l) => l.name))];
  if (lines.length === 0) return { path, created: false, names: [], missing: missingOf([]), missingSources, skipped };
  const text = `${lines.map((l) => l.line).join("\n")}\n`;
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(path, text, { mode: 0o600, flag: "wx" });
  const names = namesOf(text);
  return { path, created: true, names, missing: missingOf(names), missingSources, skipped };
}

/**
 * The job's state and pid out of `launchctl print gui/<uid>/<label>`: the first `state = ` line,
 * whole - a stopped job's reads `not running` - and the first `pid = ` line, which only a running
 * job has. Each is absent when its line is.
 * @param text - launchctl's output. A print that failed (launchd has no such job) leaves it empty,
 *   and `{}` says nothing about the job: the caller, which saw the failure, passes `not loaded` to
 *   {@link formatStatus} itself.
 */
export function parseLaunchctlPrint(text: string): { state?: string; pid?: number } {
  const state = /state = (.+)/.exec(text)?.[1]?.trim();
  const pid = /pid = (\d+)/.exec(text)?.[1];
  return { ...(state ? { state } : {}), ...(pid === undefined ? {} : { pid: Number(pid) }) };
}

/** The face's sign-in line: `gravit-face: http://127.0.0.1:3090/?token=… (profile: face)`. */
const TOKEN_URL = /https?:\/\/\S+\?token=\S+/;

/**
 * The sign-in URL from the face's log: the URL on the last line that carries one. The token is
 * new on every start, so only the last is worth opening; it mints the cookie for its host:port.
 * @param logText - the log's contents.
 */
export function lastTokenUrl(logText: string): string | undefined {
  const lines = logText.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = TOKEN_URL.exec(lines[i]);
    if (match !== null) return match[0];
  }
  return undefined;
}

/** The line about the run before this one: the ledger's last run is the face that answered. */
function lastRunLine(runs: DeskRun[]): string | undefined {
  const previous = runs.length >= 2 ? runs[runs.length - 2] : undefined;
  if (previous === undefined) return undefined;
  if (previous.lost) return "last run: lost (killed or crashed; no shutdown event)";
  if (previous.endedAt !== undefined) return `last run: ended ${previous.endedAt} code ${previous.code}`;
  return undefined;
}

/**
 * What `status` prints. Not installed is one line. Otherwise: launchd's state and pid, or
 * `state unknown` when no state is given - never `loaded`: the caller passes `not loaded` for a
 * plist launchd has no job for, so a face answering on the port is not credited to a job launchd
 * lacks; then, when the face answered, its address, uptime, boot time and whether its desk is on -
 * followed by the ledger's read error when there is one, the sleep gaps when there were any, and
 * how the run before it ended - or else `not answering on <port>`; and last the sign-in URL from
 * the log.
 * @param args - `label`, the job; `info`, {@link parseLaunchctlPrint}'s; `installed`, whether the
 *   plist exists; `status`, what `/data/desk/status` answered, `undefined` when it did not;
 *   `url`, {@link lastTokenUrl}'s; `port`, the port asked.
 */
export function formatStatus(args: {
  label: string;
  info: { state?: string; pid?: number };
  installed: boolean;
  status: DeskStatus | undefined;
  url: string | undefined;
  port: number;
}): string {
  if (!args.installed) return `${args.label}: not installed (npm run service -- install)`;
  const { info, status } = args;
  const lines = [`${args.label}: ${info.state ?? "state unknown"}${info.pid === undefined ? "" : ` (pid ${info.pid})`}`];
  if (status === undefined) lines.push(`not answering on ${args.port}`);
  else {
    const hours = Math.floor(status.uptimeMs / 3_600_000);
    const minutes = Math.floor(status.uptimeMs / 60_000) % 60;
    const desk = status.desk.enabled ? "on" : "off (FACE_DESK=0)";
    lines.push(`answering at http://127.0.0.1:${args.port} · up ${hours}h ${minutes}m since ${status.bootedAt} · desk ${desk}`);
    if (status.ledgerError !== undefined) lines.push(`ledger: unreadable (${status.ledgerError})`);
    if (status.asleep.length > 0) lines.push(`asleep: ${status.asleep.length} gap(s) since boot`);
    const last = lastRunLine(status.runs);
    if (last !== undefined) lines.push(last);
  }
  lines.push(args.url === undefined ? "sign in: no URL in the log yet (npm run service -- logs)" : `sign in: ${args.url}`);
  return lines.join("\n");
}

/** The face's desk status route on loopback: what `status` and the port checks ask. */
const statusUrl = (port: number): string => `http://127.0.0.1:${port}/data/desk/status`;

/**
 * Whether anything answers on the port: `GET /data/desk/status` with a 1,500 ms timeout. Any HTTP
 * response is yes - an older face, which has no such route, answers 404, and whatever answers holds
 * the port; a refused connection or a timeout is no. The body is discarded.
 * @param port - the port on 127.0.0.1.
 * @param fetchImpl - `fetch`, or a test's.
 */
export async function portAnswers(port: number, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  let res: Response;
  try {
    res = await fetchImpl(statusUrl(port), { signal: AbortSignal.timeout(1_500) });
  } catch {
    return false;
  }
  await res.body?.cancel().catch(() => undefined);
  return true;
}

/**
 * What the face on the port says of itself: `GET /data/desk/status` with a 2,000 ms timeout.
 * `undefined` unless it answers `200` with a JSON object whose `ok` is `true` - an older face's 404,
 * a refused connection, a timeout and a body that is not such JSON all read as no status. Only `ok`
 * is checked: the route is the face's own, and the rest of its shape is desk.ts's to keep.
 * @param port - the port on 127.0.0.1.
 * @param fetchImpl - `fetch`, or a test's.
 */
export async function fetchStatus(port: number, fetchImpl: typeof fetch = fetch): Promise<DeskStatus | undefined> {
  try {
    const res = await fetchImpl(statusUrl(port), { signal: AbortSignal.timeout(2_000) });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      return undefined;
    }
    const body: unknown = await res.json();
    return body !== null && typeof body === "object" && (body as { ok?: unknown }).ok === true ? (body as DeskStatus) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether `install` or `start` may go ahead: refused while anything answers on the port. A second
 * face there would fail to bind, exit 1, and be started again by launchd every 30 s.
 * @param args - `port`, the port the service runs on; `answers`, {@link portAnswers}'s.
 */
export function installPlan(args: { port: number; answers: boolean }): { refuse?: string } {
  if (!args.answers) return {};
  return { refuse: `something already answers on 127.0.0.1:${args.port} - stop it (a terminal npm start?) before installing or starting the service` };
}

/**
 * The node the plist runs: the first `node` on `path` that is an executable file in an absolute
 * folder and not under a `node_modules` - npm puts its own folders first while it runs a script.
 * Kept as PATH names it, not resolved: Homebrew's /opt/homebrew/bin/node outlives an upgrade, the
 * versioned folder it links to does not.
 * @param path - a PATH value.
 * @returns the file, or `undefined` when PATH has none (the script then runs `process.execPath`).
 */
export function nodeOnPath(path: string): string | undefined {
  for (const dir of path.split(":")) {
    if (!isAbsolute(dir)) continue;
    const node = join(dir, "node");
    if (node.includes("/node_modules/")) continue;
    try {
      if (!statSync(node).isFile()) continue;
      accessSync(node, constants.X_OK);
      return node;
    } catch {
      /* none here, or not executable: the next folder */
    }
  }
  return undefined;
}

/** What {@link runService} touches, injected: the script passes the real ones; a test passes fakes,
 * and so never reaches the operator's launchd. */
export interface ServiceDeps {
  /** Runs `launchctl <args>`: `ok` when it exits 0; `out`, what it printed - on a failure, its error text. */
  launchctl(args: string[]): { ok: boolean; out: string };
  /** For the face's status route. */
  fetch: typeof fetch;
  /** The operator's home directory (HOME), whose Library/LaunchAgents holds the plist. */
  homeDir: string;
  /** The harness home (DSH_HOME): its .env, the ledger, the service's logs. */
  home: string;
  /** The repo root: the checkout the service runs, and where the key files are. */
  root: string;
  /** The operator's uid: the job is `gui/<uid>/com.gravit.face`. */
  uid: number;
  /** The launchd commands run on darwin only. */
  platform: NodeJS.Platform;
  /** The node the plist runs. */
  nodePath: string;
  /** The PATH the plist's PATH is filtered from. */
  envPath: string;
  /** Prints a line - or several, joined by newlines. */
  out(line: string): void;
  /** Waits: install's poll for the port to fall silent. */
  sleep(ms: number): Promise<void>;
}

/** main.ts's port when FACE_PORT is unset. */
const DEFAULT_PORT = 3090;

/** How long install waits for the port to fall silent after it booted out the job it replaces, and how often it asks. */
const RELEASE_WAIT_MS = 10_000;
const RELEASE_POLL_MS = 500;

/** The key files at the repo root that install writes the home's .env from, in order. */
const KEY_FILES = [".env.deepseek", ".env.alpaca", ".env.ifind"] as const;

/** The commands that drive launchd, refused off darwin; `status`, `logs` and `url` only read. */
const LAUNCHD_COMMANDS: ReadonlySet<string> = new Set(["install", "uninstall", "start", "stop", "restart"]);

/** What every command works from, worked out once per run. */
interface ServiceContext {
  deps: ServiceDeps;
  /** The LaunchAgent as install would write it now, on this shell's home (`deps.home`); its `path` is where the plist is. */
  plan: ServicePlan;
  /** Whether the plist exists - the test a scratch HOME can pass: launchctl is per user, not per HOME. */
  installed: boolean;
  /** The home the installed face runs on: the plist's DSH_HOME when it names an absolute path, else
   * `deps.home` - whose ledger `status` reads and whose ledger and .env `uninstall` names. */
  home: string;
  /** The installed face's stdout and stderr logs, under `home`. */
  log: string;
  errLog: string;
  /** `--port`, else the installed plist's FACE_PORT, else 3090. */
  port: number;
  /** `gui/<uid>`, the operator's launchd domain. */
  domain: string;
  /** `gui/<uid>/com.gravit.face`. */
  job: string;
}

/** What launchd says of the job: loaded when `print` succeeds and says something, and then the state and pid it names. */
interface JobInfo {
  loaded: boolean;
  state?: string;
  pid?: number;
}

/** `text` as a TCP port - one to five digits, 1 to 65535 - or `undefined`. */
function asPort(text: string | undefined): number | undefined {
  if (text === undefined || !/^\d{1,5}$/.test(text)) return undefined;
  const port = Number(text);
  return port >= 1 && port <= 65_535 ? port : undefined;
}

/** The arguments after the command: `--port N`, and nothing else. */
function parseArgs(args: string[]): { port?: number; error?: string } {
  let port: number | undefined;
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] !== "--port") return { error: `unknown argument: ${args[i]}` };
    port = asPort(args[i + 1]);
    if (port === undefined) return { error: `--port takes a port from 1 to 65535${args[i + 1] === undefined ? "" : `, not ${args[i + 1]}`}` };
  }
  return { port };
}

/** {@link xml} undone: `&lt;` and `&gt;` first, `&amp;` last, so an escaped `&lt;` comes back as text. */
const unxml = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** A plist's EnvironmentVariables as {@link servicePlan} writes them - each `<key>` and its
 * `<string>`, unescaped; empty when it has none. */
function plistEnv(plist: string): Map<string, string> {
  const dict = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(plist)?.[1] ?? "";
  return new Map([...dict.matchAll(/<key>([^<]*)<\/key>\s*<string>([^<]*)<\/string>/g)].map((m) => [unxml(m[1]), unxml(m[2])]));
}

/** A failure as its code when it has one (EACCES, EISDIR, EEXIST), else its message. */
function reasonOf(err: unknown): string {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string") return code;
  return err instanceof Error ? err.message : String(err);
}

/** The path a filesystem error names, if it names one. */
function pathOf(err: unknown): string | undefined {
  const path = (err as { path?: unknown } | null | undefined)?.path;
  return typeof path === "string" ? path : undefined;
}

/** A file's text, or `undefined` when it is absent or cannot be read. */
function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** The last `n` lines of a text; the newline that ends it opens no line. */
function lastLines(text: string, n: number): string[] {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body === "" ? [] : body.split("\n").slice(-n);
}

function contextOf(deps: ServiceDeps, flagPort: number | undefined): ServiceContext {
  const launchAgentsDir = join(deps.homeDir, "Library", "LaunchAgents");
  const plistPath = join(launchAgentsDir, `${LABEL}.plist`);
  const installed = existsSync(plistPath);
  const env = installed ? plistEnv(readText(plistPath) ?? "") : new Map<string, string>();
  /* The port install writes: the one given, else the installed one - so the port every command
   * checks is the port the plist runs the face on. */
  const planPort = flagPort ?? asPort(env.get("FACE_PORT")?.trim());
  const common = { root: deps.root, homeDir: deps.homeDir, node: deps.nodePath, path: deps.envPath, launchAgentsDir, port: planPort };
  /* The home the installed face runs on is the plist's; install writes this shell's. */
  const named = env.get("DSH_HOME");
  const home = named !== undefined && isAbsolute(named) ? named : deps.home;
  const served = servicePlan({ ...common, home });
  const domain = `gui/${deps.uid}`;
  return {
    deps, plan: servicePlan({ ...common, home: deps.home }), installed, home, log: served.log, errLog: served.errLog,
    port: planPort ?? DEFAULT_PORT, domain, job: `${domain}/${LABEL}`,
  };
}

function jobInfo(ctx: ServiceContext): JobInfo {
  const { ok, out } = ctx.deps.launchctl(["print", ctx.job]);
  return ok && out.trim() !== "" ? { loaded: true, ...parseLaunchctlPrint(out) } : { loaded: false };
}

/** Print a launchctl call that failed - its command line and what launchctl said - and return 1. */
function failed(ctx: ServiceContext, args: string[], result: { out: string }): number {
  const said = result.out.trim();
  ctx.deps.out(`launchctl ${args.join(" ")} failed${said === "" ? "" : `: ${said}`}`);
  return 1;
}

/** Load the plist into launchd, which starts the face (RunAtLoad), then enable the job. A failure is
 * printed and stops it; true when both succeeded. */
function bootstrapped(ctx: ServiceContext): boolean {
  for (const args of [["bootstrap", ctx.domain, ctx.plan.path], ["enable", ctx.job]]) {
    const result = ctx.deps.launchctl(args);
    if (!result.ok) {
      failed(ctx, args, result);
      return false;
    }
  }
  return true;
}

/** The line `status` adds when the face does not answer: how the ledger's last run ended. */
async function ledgerLine(home: string): Promise<string> {
  let runs: DeskRun[];
  try {
    runs = runsOf((await readEvents(home)).events);
  } catch (err) {
    return `ledger: unreadable (${reasonOf(err)})`;
  }
  const last = runs.at(-1);
  if (last === undefined) return "ledger: empty";
  const end = last.endedAt === undefined ? "no shutdown event" : `ended ${last.endedAt} code ${last.code}`;
  return `ledger: last boot ${last.bootedAt} (pid ${last.pid}) - ${end}`;
}

/** `start`, and `restart`'s answer for a job that is not running; `known` is what launchd said, asked here when not given. */
async function startJob(ctx: ServiceContext, known?: JobInfo): Promise<number> {
  const { deps } = ctx;
  if (!ctx.installed) {
    deps.out(`${LABEL}: not installed (npm run service -- install)`);
    return 1;
  }
  const job = known ?? jobInfo(ctx);
  if (job.loaded && job.state === "running") {
    deps.out(`already running${job.pid === undefined ? "" : ` (pid ${job.pid})`}`);
    return 0;
  }
  const { refuse } = installPlan({ port: ctx.port, answers: await portAnswers(ctx.port, deps.fetch) });
  if (refuse !== undefined) {
    deps.out(refuse);
    return 1;
  }
  if (job.loaded) {
    const args = ["kickstart", ctx.job];
    const result = deps.launchctl(args);
    if (!result.ok) return failed(ctx, args, result);
    deps.out(`started: launchd runs the loaded job ${ctx.job} again (next: npm run service -- url)`);
    return 0;
  }
  if (!bootstrapped(ctx)) return 1;
  deps.out(`started: launchd loaded ${ctx.plan.path} and runs it (next: npm run service -- url)`);
  return 0;
}

/** The commands, in the order the usage line lists them; each returns its exit code. */
const COMMANDS: Record<string, (ctx: ServiceContext) => Promise<number>> = {
  async install(ctx) {
    const { deps, plan, port } = ctx;
    const envFile = join(deps.home, ".env");
    let env: ReturnType<typeof ensureHomeEnv>;
    try {
      env = ensureHomeEnv(deps.home, KEY_FILES.map((name) => join(deps.root, name)));
    } catch (err) {
      const where = pathOf(err);
      deps.out(`cannot write ${envFile}: ${reasonOf(err)}${where === undefined || where === envFile ? "" : ` (${where})`}`);
      return 1;
    }
    if (env.created) deps.out(`wrote ${env.path} with: ${env.names.join(", ")}`);
    else if (existsSync(env.path)) deps.out(`kept ${env.path}`);
    else deps.out(`wrote no ${env.path}: no source holds a name on the service's allow-list`);
    if (env.missing.length > 0) deps.out(`not in ${env.path}: ${env.missing.join(", ")} (the face also reads DEEPSEEK_API_KEY from dsh's credential store)`);
    if (env.skipped.length > 0) deps.out(`not copied (not on the service's allow-list; add them to ${env.path} by hand if the service needs them): ${env.skipped.join(", ")}`);
    if (env.missingSources.length > 0) deps.out(`no source: ${env.missingSources.join(", ")}`);
    /* A job this install replaces holds the port until launchd has stopped it: boot it out, then
     * give its face up to 10 s to let go, so that a reinstall is not refused by the service itself. */
    const replacing = jobInfo(ctx).loaded;
    if (replacing) {
      const args = ["bootout", ctx.job];
      deps.out(`stopping the loaded job to replace it: launchctl ${args.join(" ")}`);
      const result = deps.launchctl(args);
      if (!result.ok) return failed(ctx, args, result);
    }
    let answers = await portAnswers(port, deps.fetch);
    for (let waited = 0; replacing && answers && waited < RELEASE_WAIT_MS; waited += RELEASE_POLL_MS) {
      await deps.sleep(RELEASE_POLL_MS);
      answers = await portAnswers(port, deps.fetch);
    }
    const { refuse } = installPlan({ port, answers });
    if (refuse !== undefined) {
      deps.out(refuse);
      return 1;
    }
    try {
      mkdirSync(dirname(plan.log), { recursive: true, mode: 0o700 });
      mkdirSync(dirname(plan.path), { recursive: true });
      writeFileSync(plan.path, plan.plist, { mode: 0o644 });
      chmodSync(plan.path, 0o644);
    } catch (err) {
      deps.out(`cannot write ${pathOf(err) ?? plan.path}: ${reasonOf(err)}`);
      return 1;
    }
    if (!bootstrapped(ctx)) return 1;
    deps.out(`installed: ${plan.path}`);
    deps.out(`runs: ${plan.args.at(-1)}`);
    deps.out(`log: ${plan.log}`);
    deps.out("next: npm run service -- url");
    return 0;
  },

  async uninstall(ctx) {
    const { deps, plan } = ctx;
    /* A job launchd lacks is no failure here: the plist goes either way. */
    const bootout = deps.launchctl(["bootout", ctx.job]);
    if (!ctx.installed && !bootout.ok) {
      deps.out(`not installed: no ${plan.path}, and launchd has no job ${ctx.job}`);
      return 0;
    }
    try {
      rmSync(plan.path, { force: true });
    } catch (err) {
      deps.out(`cannot remove ${plan.path}: ${reasonOf(err)}`);
      return 1;
    }
    const plist = ctx.installed ? `${plan.path} is removed` : `there was no ${plan.path}`;
    deps.out(`uninstalled: launchd no longer runs it and ${plist}; the ledger (${deskDir(ctx.home)}) and ${join(ctx.home, ".env")} are untouched`);
    return 0;
  },

  start: (ctx) => startJob(ctx),

  async stop(ctx) {
    const { deps } = ctx;
    const args = ["bootout", ctx.job];
    const result = deps.launchctl(args);
    if (result.ok) {
      deps.out(ctx.installed
        ? "stopped: launchd no longer runs it; the plist stays, so the next login or npm run service -- start brings it back"
        : `stopped: launchd no longer runs it, and with no ${ctx.plan.path} nothing brings it back`);
      return 0;
    }
    /* A bootout fails for a job launchd lacks - stopped already - and for one it could not stop. */
    if (jobInfo(ctx).loaded) return failed(ctx, args, result);
    deps.out(`not loaded: launchd has no job ${ctx.job}, so there was nothing to stop`);
    return 0;
  },

  async restart(ctx) {
    const job = jobInfo(ctx);
    /* `kickstart -k` replaces a face that runs, and nothing else: any other state is start's, so a
     * port another process holds is refused instead of fed to KeepAlive as an EADDRINUSE loop. */
    if (!(job.loaded && job.state === "running")) return startJob(ctx, job);
    const args = ["kickstart", "-k", ctx.job];
    const result = ctx.deps.launchctl(args);
    if (!result.ok) return failed(ctx, args, result);
    ctx.deps.out(`restarted: launchd stopped ${ctx.job} and runs it again, with a new sign-in URL (next: npm run service -- url)`);
    return 0;
  },

  async status(ctx) {
    const { deps, port } = ctx;
    if (!ctx.installed) {
      deps.out(formatStatus({ label: LABEL, info: {}, installed: false, status: undefined, url: undefined, port }));
      return 0;
    }
    const job = jobInfo(ctx);
    const answer = await fetchStatus(port, deps.fetch);
    const log = readText(ctx.log);
    deps.out(formatStatus({ label: LABEL, info: job.loaded ? job : { state: "not loaded" }, installed: true, status: answer,
      url: log === undefined ? undefined : lastTokenUrl(log), port }));
    if (answer === undefined) deps.out(await ledgerLine(ctx.home));
    return 0;
  },

  async logs(ctx) {
    const { deps } = ctx;
    const files = [ctx.log, ctx.errLog].filter((file) => existsSync(file));
    if (files.length === 0) {
      deps.out(`no log yet: ${ctx.log}`);
      return 0;
    }
    let code = 0;
    for (const file of files) {
      deps.out(`== ${file}`);
      try {
        const tail = lastLines(readFileSync(file, "utf8"), 40);
        if (tail.length > 0) deps.out(tail.join("\n"));
      } catch (err) {
        deps.out(`cannot read ${file}: ${reasonOf(err)}`);
        code = 1;
      }
    }
    return code;
  },

  async url(ctx) {
    const log = readText(ctx.log);
    ctx.deps.out((log === undefined ? undefined : lastTokenUrl(log)) ?? "no sign-in URL in the log yet (npm run service -- logs)");
    return 0;
  },
};

const USAGE = `usage: npm run service -- ${Object.keys(COMMANDS).join(" | ")} [--port N]`;

/**
 * Run one command - `npm run service -- <cmd> [--port N]` - and return its exit code: 0 when it is
 * done or there was nothing to do (already running, nothing to stop), 1 when it refused or failed, 2
 * for a command or an argument it does not know. Every line goes through `deps.out`; nothing here
 * exits the process. The port is `--port`, else the installed plist's FACE_PORT, else 3090. The
 * home whose log and ledger the commands read is the installed plist's DSH_HOME, else `deps.home`;
 * `install` writes `deps.home`.
 *
 * - `status` (the script's default): not installed when the plist is absent, and launchd is not
 *   asked; otherwise launchd's state (`not loaded` when `print` fails or says nothing), what the
 *   face answers on the port ({@link fetchStatus}), the sign-in URL from the log - and, when the
 *   face does not answer, one line from the ledger on how its last run ended.
 * - `install`: the home's .env ({@link ensureHomeEnv}), each finding a line; a job launchd has is
 *   booted out first and its port given up to 10 s to fall silent; refused while the port still
 *   answers ({@link installPlan}); then the logs directory (0700), the plist (0644), `bootstrap`
 *   and `enable`.
 * - `start`: not installed is a failure; a running job is left alone; refused while the port
 *   answers; then `kickstart` for a loaded job, `bootstrap` and `enable` for one launchd lacks.
 * - `stop`: `bootout` - not `kill`: a face whose teardown throws exits 1, which KeepAlive would
 *   restart. The plist stays.
 * - `restart`: `kickstart -k` for a running job; in any other state, `start` - so a port another
 *   process holds is refused, never handed to KeepAlive as an EADDRINUSE loop.
 * - `uninstall`: `bootout` (a job launchd lacks is fine), then the plist goes; the ledger and the
 *   home's .env stay.
 * - `logs`: the last 40 lines of each log that exists; `url`: the log's last sign-in URL.
 *
 * `install`, `uninstall`, `start`, `stop` and `restart` refuse off darwin before launchctl is run.
 * @param cmd - the command.
 * @param args - what follows it.
 * @param deps - the world it acts on.
 */
export async function runService(cmd: string, args: string[], deps: ServiceDeps): Promise<number> {
  if (!Object.hasOwn(COMMANDS, cmd)) {
    deps.out(USAGE);
    return 2;
  }
  const { port, error } = parseArgs(args);
  if (error !== undefined) {
    deps.out(error);
    deps.out(USAGE);
    return 2;
  }
  if (LAUNCHD_COMMANDS.has(cmd) && deps.platform !== "darwin") {
    deps.out(`${cmd} needs macOS: the service is a launchd LaunchAgent - on ${deps.platform}, run npm start under the system's own service manager`);
    return 1;
  }
  return COMMANDS[cmd](contextOf(deps, port));
}

/** The real deps: launchctl run with its output captured (a failure's error text comes back as
 * `out`, never straight to the terminal), and this checkout, this operator, this harness home. */
function realDeps(): ServiceDeps {
  const envPath = process.env.PATH ?? "";
  return {
    launchctl(args) {
      try {
        return { ok: true, out: execFileSync("launchctl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
      } catch (err) {
        const { stdout, stderr } = err as { stdout?: unknown; stderr?: unknown };
        return { ok: false, out: [stdout, stderr].filter((text): text is string => typeof text === "string").join("").trim() };
      }
    },
    fetch,
    homeDir: homedir(),
    home: resolveDshHome(undefined),
    root: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."),
    uid: userInfo().uid,
    platform: process.platform,
    nodePath: nodeOnPath(envPath) ?? process.execPath,
    envPath,
    out: (line) => console.log(line),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  };
}

/* Run only as a script - the tests import runService. Compared as real paths, as check-home.ts
 * does: a checkout reached through a symlink spells the same file two ways. */
const invokedAs = process.argv[1];
if (invokedAs !== undefined && existsSync(invokedAs) && realpathSync(invokedAs) === realpathSync(fileURLToPath(import.meta.url))) {
  const [cmd = "status", ...args] = process.argv.slice(2);
  const code = await runService(cmd, args, realDeps()).catch((err: unknown) => {
    console.error(err);
    return 1;
  });
  /* Exit with the command's code once stdout has drained: on macOS a pipe is written
   * asynchronously, and process.exit drops what is still queued (measured: 65,500 of 1,000,000
   * bytes reached a slow reader). */
  process.stdout.write("", () => process.exit(code));
}
