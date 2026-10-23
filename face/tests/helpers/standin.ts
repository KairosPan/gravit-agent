/** The Account's own stand-in for the smokes that run against it (`account-seat-smoke`, `account-graft-smoke`) and
 * for `scripts/capture-account-fixtures.ts`: Linqi's `test/standin/ui-standin.ts` from the installed checkout
 * `FACE_ACCOUNT_SEAT_DIR` names (or the one a caller hands {@link startStandin}) — the real Account over simulated
 * venues, no network, no real money — started on a free loopback port with `--no-desk`, in the fresh temporary
 * home it makes for itself (`<tmpdir>/ui-standin-XXXXXX`), and stopped as Ctrl-C stops it.
 *
 * The checkout is read, never written: the stand-in runs from it with its own tsx, never `npx`. It never takes
 * 4820, the real Account's port (it refuses that port itself; {@link startStandin} refuses it first). Its home is
 * removed after the stop only when {@link isStandinHome} says the path is one: a `ui-standin-` directory directly
 * under this process's `tmpdir()` — the operator's `~/.buyer-agent-demo` or anything else a stray `home` line
 * names is never touched. */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/** The installed checkout of linqizhe07/buyer-agent-demo, as the environment names it ("" when unset). */
export const STANDIN_DIR = process.env.FACE_ACCOUNT_SEAT_DIR ?? "";
/** Under the checkout `dir`: its own tsx, which runs the stand-in (the Account's devDependency), and the stand-in. */
export function standinPaths(dir: string): { cli: string; script: string } {
  return { cli: join(dir, "node_modules", "tsx", "dist", "cli.mjs"), script: join(dir, "test", "standin", "ui-standin.ts") };
}
/** The checkout's own tsx, which runs the stand-in (the Account's devDependency). */
export const STANDIN_CLI = standinPaths(STANDIN_DIR).cli;
export const STANDIN_SCRIPT = standinPaths(STANDIN_DIR).script;
/** The real Account's port: no stand-in is ever started there. */
export const REAL_ACCOUNT_PORT = 4820;
const START_MS = 90_000;
const STOP_MS = 10_000;

/** Why a smoke against the stand-in is skipped, or false when it can run: `FACE_SMOKE=1` and an installed checkout. */
export function standinSkip(): string | false {
  if (process.env.FACE_SMOKE !== "1") return "set FACE_SMOKE=1";
  if (STANDIN_DIR === "") return "set FACE_ACCOUNT_SEAT_DIR to an installed checkout of linqizhe07/buyer-agent-demo";
  if (!existsSync(STANDIN_CLI)) return `${STANDIN_CLI} is missing: run npm ci in the checkout`;
  if (!existsSync(STANDIN_SCRIPT)) return `${STANDIN_SCRIPT} is missing: not the Account's checkout`;
  return false;
}

/** A free loopback port, as the OS hands one out. */
export const freePort = (): Promise<number> => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => (typeof address === "object" && address !== null ? resolvePort(address.port) : reject(new Error("no port"))));
  });
});

/** A started stand-in: its page's URL, its temporary home, the pairing code it printed, the process, and what it said. */
export interface Standin { url: string; home: string; code: string; child: ChildProcess; log: () => string }

/** Start the stand-in from the checkout `dir` (`FACE_ACCOUNT_SEAT_DIR`'s unless given) on `port` and wait for its page,
 * pairing code and home lines (one write, at once). */
export function startStandin(port: number, dir = STANDIN_DIR): Promise<Standin> {
  if (port === REAL_ACCOUNT_PORT) return Promise.reject(new Error(`port ${REAL_ACCOUNT_PORT} is the real Account's: no stand-in starts there`));
  const { cli, script } = standinPaths(dir);
  return new Promise((resolveStandin, reject) => {
    const child = spawn(process.execPath, [cli, script, "--port", String(port), "--no-desk"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const log = (): string => out;
    const timer = setTimeout(() => { child.kill("SIGINT"); reject(new Error(`the stand-in printed no page line in ${START_MS / 1000} s:\n${out}`)); }, START_MS);
    const look = (): void => {
      const url = /^\s*page\s+(\S+)/m.exec(out)?.[1];
      const code = /^\s*pairing code\s+(\S+)/m.exec(out)?.[1];
      const home = /^\s*home\s+(\S+)/m.exec(out)?.[1];
      if (url !== undefined && code !== undefined && home !== undefined) { clearTimeout(timer); resolveStandin({ url, home, code, child, log }); }
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
