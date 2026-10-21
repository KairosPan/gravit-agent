// face/tests/desk-cli.test.ts
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDesk } from "../scripts/desk.ts";
import { OFF_FILE, deskDir, readEvents, readOffState } from "../src/desk.ts";

/** Every harness home made with {@link home}, removed once the file's tests are done. */
const homes: string[] = [];
after(() => Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));
/** A fresh harness home under the system's temp directory, removed after the file's tests. */
const home = async (): Promise<string> => {
  const made = await mkdtemp(join(tmpdir(), "face-desk-cli-"));
  homes.push(made);
  return made;
};
const USAGE = "usage: npm run desk -- pause [Nm | Nh | Nd] | resume | arm <desk | strategies/NAME> --id ID --at ANCHOR --expires YYYY-MM-DD"
  + " [--producer scripts/FILE.py | builtin:NAME] [--model PROVIDER/MODEL] [--turn-deadline DURATION] [--producer-deadline DURATION] [--no-wake]"
  + " | rearm ID [--expires YYYY-MM-DD]";
/** 14:00 ET on a Tuesday in October (EDT). */
const NOW = Date.parse("2026-10-20T18:00:00Z");

/** runDesk's deps over the home `h` and the fixed clock; `take` returns the lines printed since it was last called. */
function rig(h: string): { deps: { home: string; out: (line: string) => void; now: () => number }; take(): string[] } {
  let lines: string[] = [];
  return {
    deps: { home: h, out: (line) => { lines.push(line); }, now: () => NOW },
    take: () => { const got = lines; lines = []; return got; },
  };
}

test("runDesk pause 2h writes OFF and prints the ET time; resume clears it; a bad duration is usage", async () => {
  const h = await home(); const r = rig(h);
  assert.equal(await runDesk("pause", ["2h"], r.deps), 0);
  assert.deepEqual(r.take(), ["paused until 16:00 ET"]);
  assert.deepEqual(await readOffState(h, () => NOW),
    { state: { setAt: "2026-10-20T18:00:00.000Z", by: "terminal", until: "2026-10-20T20:00:00.000Z" }, expired: false });
  assert.equal(await runDesk("resume", [], r.deps), 0);
  assert.deepEqual(r.take(), ["resumed"]);
  assert.deepEqual(await readOffState(h), { expired: false });
  assert.equal(await runDesk("resume", [], r.deps), 0);
  assert.deepEqual(r.take(), ["not paused"]);
  assert.equal(await runDesk("pause", ["2x"], r.deps), 2);
  assert.deepEqual(r.take(), [USAGE]);
  assert.deepEqual(await readOffState(h), { expired: false }, "a bad duration writes nothing");
  assert.equal(await runDesk("pause", [], r.deps), 0);
  assert.deepEqual(r.take(), ["paused"]);
  assert.deepEqual(await readOffState(h, () => NOW), { state: { setAt: "2026-10-20T18:00:00.000Z", by: "terminal" }, expired: false },
    "no duration: paused until a resume");
  assert.deepEqual((await readEvents(h)).events, [
    { t: "2026-10-20T18:00:00.000Z", kind: "off-set", by: "terminal", until: "2026-10-20T20:00:00.000Z" },
    { t: "2026-10-20T18:00:00.000Z", kind: "off-cleared", by: "terminal" },
    { t: "2026-10-20T18:00:00.000Z", kind: "off-set", by: "terminal" },
  ], "the ledger's record of it, on the command's clock");
});

test("runDesk dates a pause that ends on another New York day", async () => {
  const h = await home(); const r = rig(h);
  assert.equal(await runDesk("pause", ["1d"], r.deps), 0);
  assert.deepEqual(r.take(), ["paused until 2026-10-21 14:00 ET"], "1d at 14:00 ET: tomorrow");
  assert.equal(await runDesk("pause", ["10h"], r.deps), 0);
  assert.deepEqual(r.take(), ["paused until 2026-10-21 00:00 ET"], "past midnight is tomorrow too");
  assert.equal(await runDesk("pause", ["599m"], r.deps), 0);
  assert.deepEqual(r.take(), ["paused until 23:59 ET"], "the last minute of today is undated");
});

test("runDesk: an unknown command, an extra argument, a zero pause and one past 36,500 days are usage, and write nothing", async () => {
  const cases: [string, string[]][] = [["", []], ["bogus", []], ["status", []], ["pause", ["0m"]], ["pause", ["99999999d"]], ["pause", ["2h", "3h"]],
    ["resume", ["now"]]];
  for (const [cmd, args] of cases) {
    const h = await home(); const r = rig(h);
    assert.equal(await runDesk(cmd, args, r.deps), 2, [cmd, ...args].join(" "));
    assert.deepEqual(r.take(), [USAGE]);
    assert.deepEqual(await readEvents(h), { events: [], skipped: 0 });
    assert.deepEqual(await readOffState(h), { expired: false });
  }
});

test("runDesk names a switch it cannot write or remove, and exits 1", async () => {
  const blocked = await home(); const r = rig(blocked);
  await writeFile(join(blocked, "face"), "a file where the directory should be");
  assert.equal(await runDesk("pause", ["30m"], r.deps), 1);
  assert.deepEqual(r.take(), [`cannot write ${join(deskDir(blocked), OFF_FILE)}: ENOTDIR`]);
  assert.equal(await runDesk("resume", [], r.deps), 0, "no switch can be there");
  assert.deepEqual(r.take(), ["not paused"]);
  const stuck = await home(); const s = rig(stuck);
  await mkdir(join(deskDir(stuck), OFF_FILE), { recursive: true }); // a directory: unlink refuses it
  assert.equal(await runDesk("resume", [], s.deps), 1);
  const [line, ...rest] = s.take();
  assert.deepEqual(rest, []);
  assert.ok(line.startsWith(`cannot remove ${join(deskDir(stuck), OFF_FILE)}: `), line);
  assert.match(line, /: E[A-Z]+$/);
});

test("the CLI acts on the home DSH_HOME names and exits with the command's code once its line is out", async () => {
  const h = await home();
  const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "desk.ts");
  const run = (args: string[]): Promise<{ code: number | string | null; stdout: string }> => new Promise((resolve) => execFile(process.execPath,
    [join(dirname(script), "..", "node_modules", "tsx", "dist", "cli.mjs"), script, ...args],
    { env: { ...process.env, DSH_HOME: h }, encoding: "utf8" }, (err, stdout) => resolve({ code: err === null ? 0 : (err.code ?? null), stdout })));
  const paused = await run(["pause", "30m"]);
  assert.equal(paused.code, 0);
  assert.match(paused.stdout, /^paused until (\d{4}-\d{2}-\d{2} )?\d{2}:\d{2} ET\n$/, "dated when run in the half hour before midnight ET");
  assert.equal((await readOffState(h)).state?.by, "terminal");
  assert.deepEqual(await run(["resume"]), { code: 0, stdout: "resumed\n" });
  assert.deepEqual(await run(["pause", "soon"]), { code: 2, stdout: `${USAGE}\n` });
});
