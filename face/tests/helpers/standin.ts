/** The Account's own stand-in for the smokes that run against it (`account-seat-smoke`, `account-graft-smoke`) and
 * for `scripts/capture-account-fixtures.ts`: Linqi's `test/standin/ui-standin.ts` from the repo's `account/` (`npm ci`
 * there), or the install `FACE_ACCOUNT_SEAT_DIR` names (or the one a caller hands {@link startStandin}) — the real Account over simulated
 * venues, no network, no real money — started on a free loopback port with `--no-desk`, in the fresh temporary
 * home it makes for itself (`<tmpdir>/ui-standin-XXXXXX`), and stopped as Ctrl-C stops it. Beside it runs the
 * stand-in's own market (plan A2: market/src's server over the stand-in's world, on an ephemeral port of its own),
 * whose URL it prints on its `market` line: {@link Standin.marketUrl}, what a smoke sets `FACE_MARKET_URL` to.
 *
 * The install is read, never written: the stand-in runs from it with its own tsx, never `npx`. It never takes
 * 4820, the real Account's port, nor 4821, the market's (it refuses both itself; {@link startStandin} refuses them
 * first). Its home is
 * removed after the stop only when {@link isStandinHome} says the path is one: a `ui-standin-` directory directly
 * under this process's `tmpdir()` — the operator's `~/.buyer-agent-demo` or anything else a stray `home` line
 * names is never touched. */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { seatDir } from "../../src/account-seat.ts";

/** The Account's install `env` names: `FACE_ACCOUNT_SEAT_DIR`, or the face's own default, the repo's `account/`. */
export function standinDir(env: NodeJS.ProcessEnv): string {
  return env.FACE_ACCOUNT_SEAT_DIR || seatDir();
}
/** The Account's install the smokes run from ({@link standinDir} of this process's environment). */
export const STANDIN_DIR = standinDir(process.env);
/** Under the install `dir`: its own tsx, which runs the stand-in (the Account's devDependency), and the stand-in. */
export function standinPaths(dir: string): { cli: string; script: string } {
  return { cli: join(dir, "node_modules", "tsx", "dist", "cli.mjs"), script: join(dir, "test", "standin", "ui-standin.ts") };
}
/** The install's own tsx, which runs the stand-in (the Account's devDependency). */
export const STANDIN_CLI = standinPaths(STANDIN_DIR).cli;
export const STANDIN_SCRIPT = standinPaths(STANDIN_DIR).script;
/** The real Account's port: no stand-in is ever started there. */
export const REAL_ACCOUNT_PORT = 4820;
/** The real market's port: no stand-in is ever started there either. */
export const REAL_MARKET_PORT = 4821;
const START_MS = 90_000;
const STOP_MS = 10_000;

/** Why a smoke against the stand-in in `dir` is skipped under `env`, or false when it can run: `FACE_SMOKE=1` and an
 * installed Account. */
export function standinSkipFor(env: NodeJS.ProcessEnv, dir: string): string | false {
  if (env.FACE_SMOKE !== "1") return "set FACE_SMOKE=1";
  const { cli, script } = standinPaths(dir);
  if (!existsSync(cli)) return `${dir}/node_modules/tsx is missing: run npm ci in account/ (or set FACE_ACCOUNT_SEAT_DIR to another checkout)`;
  if (!existsSync(script)) return `${script} is missing: not the Account's install`;
  return false;
}

/** {@link standinSkipFor} this process's environment and {@link STANDIN_DIR}. */
export function standinSkip(): string | false {
  return standinSkipFor(process.env, STANDIN_DIR);
}

/** A free loopback port, as the OS hands one out. */
export const freePort = (): Promise<number> => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => (typeof address === "object" && address !== null ? resolvePort(address.port) : reject(new Error("no port"))));
  });
});

/** A started stand-in: its account's URL, its market's URL, its temporary home, the pairing code it printed, the
 * process, and what it said. */
export interface Standin { url: string; marketUrl: string; home: string; code: string; child: ChildProcess; log: () => string }

/** The code the stand-in's account printed for each browser that asked for one (`a browser asks to sign for the account (<label>
 * · <kid8>): code ABCD-EFGH, …`), by the first eight characters of its key id — the last line for a browser wins, as a new ask
 * makes a new code. */
export type StandinAsks = Record<string, string>;
const ASK_LINE = /^a browser asks to sign for the account \(.* · ([0-9a-f]{8})\): code (\S+?),/gm;

/** The stand-in's account, market, pairing code and home lines, read from what it printed, with the codes asked for so far
 * ({@link StandinAsks}); `undefined` until the four lines are there. */
export function parseStandinLines(out: string): { url: string; marketUrl: string; code: string; home: string; asks: StandinAsks } | undefined {
  const url = /^\s*account\s+(http\S+)/m.exec(out)?.[1];
  const marketUrl = /^\s*market\s+(http\S+)/m.exec(out)?.[1];
  const code = /^\s*pairing code\s+(\S+)/m.exec(out)?.[1];
  const home = /^\s*home\s+(\S+)/m.exec(out)?.[1];
  const asks: StandinAsks = {};
  for (const [, kid8, asked] of out.matchAll(ASK_LINE)) asks[kid8!] = asked!;
  return url !== undefined && marketUrl !== undefined && code !== undefined && home !== undefined ? { url, marketUrl, code, home, asks } : undefined;
}

/** Start the stand-in from the install `dir` ({@link STANDIN_DIR} unless given) on `port` and wait for its account,
 * market, pairing code and home lines (one write, at once). */
export function startStandin(port: number, dir = STANDIN_DIR): Promise<Standin> {
  if (port === REAL_ACCOUNT_PORT) return Promise.reject(new Error(`port ${REAL_ACCOUNT_PORT} is the real Account's: no stand-in starts there`));
  if (port === REAL_MARKET_PORT) return Promise.reject(new Error(`port ${REAL_MARKET_PORT} is the market's: no stand-in starts there`));
  const { cli, script } = standinPaths(dir);
  return new Promise((resolveStandin, reject) => {
    const child = spawn(process.execPath, [cli, script, "--port", String(port), "--no-desk"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const log = (): string => out;
    const timer = setTimeout(() => { child.kill("SIGINT"); reject(new Error(`the stand-in printed no account line in ${START_MS / 1000} s:\n${out}`)); }, START_MS);
    const look = (): void => {
      const lines = parseStandinLines(out);
      if (lines !== undefined) { clearTimeout(timer); const { url, marketUrl, code, home } = lines; resolveStandin({ url, marketUrl, code, home, child, log }); }
    };
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); look(); });
    child.stderr.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`the stand-in exited with ${code}:\n${out}`)); });
  });
}

/** True only for a stand-in's own home: a `ui-standin-` directory directly under `tmpdir()`, nothing else. */
export function isStandinHome(home: string): boolean {
  const path = resolve(home);
  return dirname(path) === resolve(tmpdir()) && /^ui-standin-[A-Za-z0-9]+$/.test(basename(path));
}

/** Stop the stand-in as Ctrl-C does — killed if it is still up after {@link STOP_MS} — and remove its home when it is one. */
export async function stopStandin(standin: Standin): Promise<void> {
  const { child } = standin;
  if (child.exitCode === null && child.signalCode === null) {
    const exited = await new Promise<boolean>((done) => {
      const timer = setTimeout(() => done(false), STOP_MS);
      child.once("exit", () => { clearTimeout(timer); done(true); });
      child.kill("SIGINT");
    });
    if (!exited) child.kill("SIGKILL");
  }
  if (isStandinHome(standin.home)) await rm(standin.home, { recursive: true, force: true });
}
