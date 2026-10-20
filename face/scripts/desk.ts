/** The desk's switch from a terminal: pause the desk, and - from here only - resume it. The switch
 * is desk.ts's `OFF` file ({@link writeOff}, {@link clearOff}); the phone and the Desk panel can
 * set it too, but nothing but this command, the file's deletion or its own expiry lifts it.
 * Spec: docs/superpowers/specs/2026-10-19-always-on-gravit-design.md §5.8.
 *
 *   npm run desk -- pause          pause the desk until a resume
 *   npm run desk -- pause 2h       pause it for a while: Nm, Nh or Nd, a whole number of minutes, hours or days
 *   npm run desk -- resume         lift the pause
 *
 * It acts on the harness home this shell resolves - `$DSH_HOME`, else ~/.dsh - as `npm start` and
 * `npm run service -- install` do. No face need be running: the switch is a file, which the face
 * reads when it needs it, and each set and lift is a line in the desk's ledger.
 *
 * The export is {@link runDesk}, the commands over an injected home, printer and clock, which the
 * tests drive against temp homes. Importing this file runs nothing; run as a script, the guard at
 * the end resolves the home and exits with the command's code.
 * @module
 */
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { OFF_FILE, clearOff, deskDir, deskTime, parseDuration, writeOff, type OffState } from "../src/desk.ts";

/** What {@link runDesk} prints for a command or an argument it does not know. */
const USAGE = "usage: npm run desk -- pause [Nm | Nh | Nd] | resume";

/** A failure as its code when it has one (ENOTDIR, EACCES, EPERM), else its message. */
function reasonOf(err: unknown): string {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string") return code;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run one command - `npm run desk -- <cmd> [duration]` - and return its exit code: 0 when it is
 * done or there was nothing to do, 1 when the switch could not be written or removed, 2 for a
 * command or an argument it does not know. Every line goes through `deps.out`; nothing here exits
 * the process.
 *
 * - `pause [duration]`: writes `OFF`, set by `terminal` - with `until` the duration after `now()`
 *   when one is given ({@link parseDuration}) - and prints `paused`, or `paused until HH:MM ET`,
 *   dated `YYYY-MM-DD HH:MM ET` when that is not today in New York ({@link deskTime}). A terminal
 *   pause replaces whatever pause is there. A duration that does not parse - a zero one, one past
 *   36,500 days - or a second argument is the usage line, and nothing is written.
 * - `resume`: removes `OFF` and prints `resumed`, or `not paused` when there was none. An argument
 *   is the usage line.
 *
 * A switch it cannot write or remove is one line naming the file and the error's code.
 * @param cmd - the command.
 * @param args - what follows it.
 * @param deps - `home`, the harness home; `out`, the printer; `now`, the clock, default `Date.now`.
 */
export async function runDesk(cmd: string, args: string[], deps: { home: string; out: (line: string) => void; now?: () => number }): Promise<number> {
  const at = (deps.now ?? Date.now)();
  const file = join(deskDir(deps.home), OFF_FILE);
  if (cmd === "pause" && args.length <= 1) {
    const ms = args.length === 0 ? undefined : parseDuration(args[0]);
    if (args.length === 1 && ms === undefined) {
      deps.out(USAGE);
      return 2;
    }
    let state: OffState;
    try {
      state = await writeOff(deps.home, { by: "terminal", ...(ms === undefined ? {} : { until: at + ms }) }, () => at);
    } catch (err) {
      deps.out(`cannot write ${file}: ${reasonOf(err)}`);
      return 1;
    }
    deps.out(state.until === undefined ? "paused" : `paused until ${deskTime(new Date(state.until), new Date(at))}`);
    return 0;
  }
  if (cmd === "resume" && args.length === 0) {
    let lifted: boolean;
    try {
      lifted = await clearOff(deps.home, "terminal", () => at);
    } catch (err) {
      deps.out(`cannot remove ${file}: ${reasonOf(err)}`);
      return 1;
    }
    deps.out(lifted ? "resumed" : "not paused");
    return 0;
  }
  deps.out(USAGE);
  return 2;
}

/* Run only as a script - the tests import runDesk. Compared as real paths, as service.ts does: a
 * checkout reached through a symlink spells the same file two ways. */
const invokedAs = process.argv[1];
if (invokedAs !== undefined && existsSync(invokedAs) && realpathSync(invokedAs) === realpathSync(fileURLToPath(import.meta.url))) {
  const [cmd = "", ...args] = process.argv.slice(2);
  const code = await runDesk(cmd, args, { home: resolveDshHome(undefined), out: (line) => console.log(line) }).catch((err: unknown) => {
    console.error(err);
    return 1;
  });
  /* Exit with the command's code once stdout has drained, as service.ts does: on macOS a pipe is
   * written asynchronously, and process.exit drops what is still queued. */
  process.stdout.write("", () => process.exit(code));
}
