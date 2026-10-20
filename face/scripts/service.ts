/** gravit-face as a macOS user service: started when the operator logs in, started again when it
 * stops by accident - a crash, a `kill -9` - with its logs under the harness home, where only the
 * operator can read them. launchd runs it (a LaunchAgent in ~/Library/LaunchAgents, modelled on the
 * demo's demo/src/portfolio/account-service.ts), and nothing about it needs an administrator.
 * Spec: docs/superpowers/specs/2026-10-19-always-on-gravit-design.md §5.2.
 *
 *   npm run service -- install      write $DSH_HOME/.env from the repo's key files when the home has none, then run the face in the background, from now on
 *   npm run service -- status       is it loaded, does it answer and since when, how the last run ended, the sign-in URL
 *   npm run service -- start        start it (refused, like install, while anything answers on the port: a terminal npm start?)
 *   npm run service -- stop         stop it: the face exits 0, which launchd leaves stopped until start, restart or the next login
 *   npm run service -- restart      stop it and start it again (after an update, to pick up new code)
 *   npm run service -- logs         the last 40 lines of each of its two logs
 *   npm run service -- url          the sign-in URL (the one with ?token=) from its log
 *   npm run service -- uninstall    stop it and take it out of launchd; the ledger and $DSH_HOME/.env stay
 *
 * `install`, `start` and `status` take `--port N` for a face not on 3090; `install` hands it to the
 * face as FACE_PORT.
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
 * The exports here are the pure half: the plan, the home's .env, the parsers and the status text.
 * They touch nothing but the paths their arguments name, and importing this file runs nothing and
 * loads no face code - the desk's types come in as types only.
 * @module
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import type { DeskRun, DeskStatus } from "../src/desk.ts";

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
 *   exit but a clean one - the face exits 0 on SIGTERM, so a stopped service stays stopped.
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
