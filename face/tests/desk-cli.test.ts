// face/tests/desk-cli.test.ts
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDesk } from "../scripts/desk.ts";
import { MUTE_FILE, OFF_FILE, deskDir, readEvents, readMuteState, readOffState, writeMute } from "../src/desk.ts";
import type { MarketClock } from "../src/market-clock.ts";
import { LEVELS_NONE, REPORT_PLACE, STANDING_FILE, parseStanding, sha256Hex, type StandingOrder } from "../src/standing.ts";

/** Every harness home made with {@link home}, removed once the file's tests are done. */
const homes: string[] = [];
after(() => Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));
/** A fresh harness home under the system's temp directory, removed after the file's tests. */
const home = async (): Promise<string> => {
  const made = await mkdtemp(join(tmpdir(), "face-desk-cli-"));
  homes.push(made);
  return made;
};
const USAGE = "usage: npm run desk -- pause [Nm | Nh | Nd] | resume | arm <desk | strategies/NAME> --id ID --at ANCHOR --expires YYYY-MM-DD [--market us | cn]"
  + " [--producer scripts/FILE.py | builtin:NAME] [--model PROVIDER/MODEL] [--turn-deadline DURATION] [--producer-deadline DURATION] [--no-wake]"
  + " | rearm ID [--expires YYYY-MM-DD] | unmute";
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
    ["resume", ["now"]], ["unmute", ["now"]], ["mute", ["2h"]]];
  for (const [cmd, args] of cases) {
    const h = await home(); const r = rig(h);
    assert.equal(await runDesk(cmd, args, r.deps), 2, [cmd, ...args].join(" "));
    assert.deepEqual(r.take(), [USAGE]);
    assert.deepEqual(await readEvents(h), { events: [], skipped: 0 });
    assert.deepEqual(await readOffState(h), { expired: false });
    assert.deepEqual(await readMuteState(h), { expired: false });
  }
});

test("runDesk unmute lifts a mute and says so; with none, not muted; exit 0 both", async () => {
  const h = await home(); const r = rig(h);
  await writeMute(h, { by: "telegram", until: NOW + 7_200_000 }, () => NOW);
  assert.equal(await runDesk("unmute", [], r.deps), 0);
  assert.deepEqual(r.take(), ["unmuted"]);
  assert.deepEqual(await readMuteState(h), { expired: false });
  assert.equal(await runDesk("unmute", [], r.deps), 0);
  assert.deepEqual(r.take(), ["not muted"]);
  assert.deepEqual((await readEvents(h)).events, [
    { t: "2026-10-20T18:00:00.000Z", kind: "mute-set", by: "telegram", until: "2026-10-20T20:00:00.000Z" },
    { t: "2026-10-20T18:00:00.000Z", kind: "mute-cleared", by: "terminal" },
  ], "one lift, on the command's clock");
  assert.deepEqual(await readOffState(h), { expired: false }, "unmute touches no pause");

  const stuck = await home(); const s = rig(stuck);
  await mkdir(join(deskDir(stuck), MUTE_FILE), { recursive: true }); // a directory: unlink refuses it
  assert.equal(await runDesk("unmute", [], s.deps), 1);
  const [line, ...rest] = s.take();
  assert.deepEqual(rest, []);
  assert.ok(line.startsWith(`cannot remove ${join(deskDir(stuck), MUTE_FILE)}: `), line);
  assert.match(line, /: E[A-Z]+$/);
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

/* ---------- P4: arming a strategy's report - its market, its levels.yml pin, the room before the open ---------- */

const ARM_DIR = join(dirname(fileURLToPath(import.meta.url)), "tmp", `desk-cli-${process.pid}`);
after(() => rm(ARM_DIR, { recursive: true, force: true }));

const DEMO_MD = "# demo\nReport before the open.\n";
const LEVELS_YML = "- symbol: NVDA\n  kind: watch\n  price: 180\n  when: cross_up\n  plan: reread the thesis\n  expires: 2026-12-31\n";
const CN_LEVELS_YML = ['"600519"', '"000001"'].map((symbol) => `- symbol: ${symbol}\n  kind: watch\n  price: 10\n  when: cross_up\n  plan: reread the thesis\n  expires: 2026-12-31\n`).join("");
/** 13:00 ET on Friday 2026-11-20 (EST). */
const ARM_NOW = Date.parse("2026-11-20T18:00:00Z");
/** 10:00 Beijing on Monday 2026-11-30, still Sunday the 29th in New York. */
const BJ_NOW = Date.parse("2026-11-30T02:00:00Z");

/** A fake clock that answers any date with a session on it; each ask's date lands in `calls`. */
const anyDay = (calls: string[]): MarketClock => async (from, days) => {
  calls.push(from);
  return { from, days, source: "a fake calendar", sessions: [{ date: from, open: `${from}T14:30:00Z`, close: `${from}T21:00:00Z`, early: false }] };
};

interface ArmRig {
  root: string;
  home: string;
  standing: string;
  demo: string;
  usCalls: string[];
  cnCalls: string[];
  deps: { home: string; root: string; out: (line: string) => void; now: () => number; marketClock: MarketClock; cnMarketClock: MarketClock };
  take(): string[];
}

let armRigs = 0;
/** A repository root with strategies/demo/STANDING.md (and `levels`, when given, as its levels.yml), scripts/p.py and desk/STANDING.md. */
async function armRig(now: number, levels?: string): Promise<ArmRig> {
  const dir = join(ARM_DIR, String(++armRigs));
  const root = join(dir, "root");
  const h = join(dir, "home");
  const demo = join(root, "strategies", "demo");
  await mkdir(demo, { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  await mkdir(join(root, "desk", "journal"), { recursive: true });
  await writeFile(join(demo, "STANDING.md"), DEMO_MD);
  await writeFile(join(root, "desk", "STANDING.md"), "# desk\n");
  await writeFile(join(root, "scripts", "p.py"), "print('p')\n");
  if (levels !== undefined) await writeFile(join(demo, "levels.yml"), levels);
  const usCalls: string[] = [];
  const cnCalls: string[] = [];
  let lines: string[] = [];
  return {
    root, home: h, standing: join(deskDir(h), STANDING_FILE), demo, usCalls, cnCalls,
    deps: { home: h, root, out: (line) => { lines.push(line); }, now: () => now, marketClock: anyDay(usCalls), cnMarketClock: anyDay(cnCalls) },
    take: () => { const got = lines; lines = []; return got; },
  };
}

/** standing.yml's orders; fails the test when it does not load. */
async function armedOrders(r: ArmRig): Promise<StandingOrder[]> {
  const load = parseStanding(await readFile(r.standing, "utf8"));
  assert.ok(load.ok, load.ok ? "" : load.errors.join("; "));
  return load.ok ? load.orders : [];
}

/** standing.yml's text, or null when there is none. */
const standingText = (r: ArmRig): Promise<string | null> => readFile(r.standing, "utf8").catch(() => null);

const REPORT_ARGS = ["strategies/demo", "--id", "demo-report", "--at", "open-90m", "--producer", "builtin:report", "--expires", "2026-12-31"];
const s12 = sha256Hex(DEMO_MD).slice(0, 12);

test("arm pins a strategy report's STANDING.md and levels.yml and prints both", async () => {
  const r = await armRig(ARM_NOW, LEVELS_YML);
  assert.equal(await runDesk("arm", REPORT_ARGS, r.deps), 0);
  const l12 = sha256Hex(LEVELS_YML).slice(0, 12);
  assert.deepEqual(r.take(), [`armed demo-report in ${r.root}: strategies/demo/STANDING.md sha256 ${s12}…, at open-90m, expires 2026-12-31, producer builtin:report, strategies/demo/levels.yml sha256 ${l12}…; the face reads standing.yml again within 30 s`]);
  const [order] = await armedOrders(r);
  assert.equal(order.levelsSha256, sha256Hex(Buffer.from(LEVELS_YML)));
  assert.equal(Object.hasOwn(order, "market"), false, "no --market: us, written as nothing");
  assert.deepEqual(r.usCalls, ["2026-11-20"]);
  assert.deepEqual(r.cnCalls, []);
});

test("arm pins an absent levels.yml as none, refuses one it cannot take, and pins nothing for a producer-only order", async () => {
  const absent = await armRig(ARM_NOW);
  await writeFile(join(absent.demo, "levels.example.yml"), LEVELS_YML);
  assert.equal(await runDesk("arm", REPORT_ARGS, absent.deps), 0);
  assert.deepEqual(absent.take(), [`armed demo-report in ${absent.root}: strategies/demo/STANDING.md sha256 ${s12}…, at open-90m, expires 2026-12-31, producer builtin:report, no strategies/demo/levels.yml; the face reads standing.yml again within 30 s`]);
  assert.equal((await armedOrders(absent))[0].levelsSha256, LEVELS_NONE);

  const refusals: [label: string, make: (r: ArmRig) => Promise<void>, line: string][] = [
    ["a: 1", (r) => writeFile(join(r.demo, "levels.yml"), "a: 1\n"), "cannot arm demo-report: strategies/demo/levels.yml must be a list of entries"],
    ["a symlink", async (r) => { await writeFile(join(r.demo, "good.yml"), LEVELS_YML); await symlink("good.yml", join(r.demo, "levels.yml")); },
      "cannot arm demo-report: strategies/demo/levels.yml is not a regular file"],
    ["0xff 0xfe", (r) => writeFile(join(r.demo, "levels.yml"), Buffer.from([0xff, 0xfe])), "cannot arm demo-report: strategies/demo/levels.yml is not UTF-8"],
    ["a directory", (r) => mkdir(join(r.demo, "levels.yml")), "cannot arm demo-report: strategies/demo/levels.yml is not a regular file"],
    ["oversize", (r) => writeFile(join(r.demo, "levels.yml"), `#${"x".repeat(65_536)}\n`),
      "cannot arm demo-report: strategies/demo/levels.yml is 65,538 bytes; the limit is 65,536"],
  ];
  for (const [label, make, line] of refusals) {
    const r = await armRig(ARM_NOW);
    await make(r);
    assert.equal(await runDesk("arm", REPORT_ARGS, r.deps), 1, label);
    assert.deepEqual(r.take(), [line], label);
    assert.equal(await standingText(r), null, `${label}: nothing written`);
  }

  const quiet = await armRig(ARM_NOW, "a: 1\n");
  assert.equal(await runDesk("arm", ["strategies/demo", "--id", "quiet", "--at", "close-30m", "--producer", "scripts/p.py", "--no-wake", "--expires", "2026-12-31"], quiet.deps), 0);
  const [line] = quiet.take();
  assert.ok(!line.includes("levels.yml"), line);
  assert.equal(Object.hasOwn((await armedOrders(quiet))[0], "levelsSha256"), false, "a producer-only order wakes nothing, so no pin - its levels.yml unread");

  for (const args of [["desk", "--id", "x", "--at", "close-30m", "--producer", "builtin:report", "--expires", "2026-12-31"],
    ["strategies/demo", "--id", "x", "--at", "close-30m", "--producer", "builtin:report", "--no-wake", "--expires", "2026-12-31"]]) {
    const r = await armRig(ARM_NOW);
    assert.equal(await runDesk("arm", args, r.deps), 1, args.join(" "));
    assert.deepEqual(r.take(), [`cannot arm x: ${REPORT_PLACE}`]);
    assert.equal(await standingText(r), null);
  }
});

test("arm refuses an open-Nm anchor too short for the producer, the turn and the grace", async () => {            // RF 5
  const r = await armRig(ARM_NOW, LEVELS_YML);
  await mkdir(dirname(r.standing), { recursive: true });
  await writeFile(r.standing, "orders:\n");
  assert.equal(await runDesk("arm", REPORT_ARGS.map((a) => (a === "open-90m" ? "open-10m" : a)), r.deps), 1);
  assert.deepEqual(r.take(), ["cannot arm demo-report: open-10m leaves 10 min before the open; its producer (5 min), its turn (10 min) and the 5-minute grace need 20 min"]);
  assert.equal(await standingText(r), "orders:\n", "byte-identical");
});

test("rearm re-takes levels.yml: an edit, a removal, nothing changed, a broken file", async () => {
  const r = await armRig(ARM_NOW, LEVELS_YML);
  assert.equal(await runDesk("arm", REPORT_ARGS, r.deps), 0);
  r.take();
  const edited = LEVELS_YML.replace("180", "185");
  await writeFile(join(r.demo, "levels.yml"), edited);

  const before = await standingText(r);
  assert.equal(await runDesk("rearm", ["demo-report", "--expires", "2027-01-31"], r.deps), 1);
  assert.deepEqual(r.take(), ["cannot re-arm demo-report: strategies/demo/levels.yml changed since arming; review it, then: npm run desk -- rearm demo-report"]);
  assert.equal(await standingText(r), before);
  await writeFile(join(r.demo, "STANDING.md"), `${DEMO_MD}more\n`);
  assert.equal(await runDesk("rearm", ["demo-report", "--expires", "2027-01-31"], r.deps), 1);
  assert.deepEqual(r.take(), ["cannot re-arm demo-report: strategies/demo/STANDING.md and strategies/demo/levels.yml changed since arming; review them, then: npm run desk -- rearm demo-report"],
    "named after the text");
  await writeFile(join(r.demo, "STANDING.md"), DEMO_MD);

  assert.equal(await runDesk("rearm", ["demo-report"], r.deps), 0);
  assert.deepEqual(r.take(), [`re-armed demo-report: strategies/demo/STANDING.md sha256 ${s12}…, strategies/demo/levels.yml sha256 ${sha256Hex(edited).slice(0, 12)}… (changed)`]);
  assert.equal((await armedOrders(r))[0].levelsSha256, sha256Hex(edited));
  assert.equal(await runDesk("rearm", ["demo-report", "--expires", "2027-01-31"], r.deps), 0, "reviewed and re-pinned: it extends");
  assert.deepEqual(r.take(), [`re-armed demo-report: strategies/demo/STANDING.md sha256 ${s12}…, strategies/demo/levels.yml sha256 ${sha256Hex(edited).slice(0, 12)}…, expires 2027-01-31`]);

  await unlink(join(r.demo, "levels.yml"));
  assert.equal(await runDesk("rearm", ["demo-report"], r.deps), 0);
  assert.deepEqual(r.take(), [`re-armed demo-report: strategies/demo/STANDING.md sha256 ${s12}…, no strategies/demo/levels.yml (changed)`]);
  assert.equal((await armedOrders(r))[0].levelsSha256, LEVELS_NONE);
  assert.equal(await runDesk("rearm", ["demo-report"], r.deps), 0);
  assert.deepEqual(r.take(), ["demo-report: nothing changed since arming"]);

  await writeFile(join(r.demo, "levels.yml"), "a: 1\n");
  const kept = await standingText(r);
  assert.equal(await runDesk("rearm", ["demo-report"], r.deps), 1);
  assert.deepEqual(r.take(), ["cannot re-arm demo-report: strategies/demo/levels.yml must be a list of entries"]);
  assert.equal(await standingText(r), kept);
});

test("arm --market cn pins a Lunhui strategy's report and prints its market", async () => {
  const r = await armRig(BJ_NOW);
  assert.equal(await runDesk("arm", ["strategies/demo", "--id", "demo-report", "--at", "open-90m", "--market", "cn", "--producer", "builtin:report", "--expires", "2026-12-31"], r.deps), 0);
  assert.deepEqual(r.take(), [`armed demo-report in ${r.root}: strategies/demo/STANDING.md sha256 ${s12}…, at open-90m, expires 2026-12-31, market cn, producer builtin:report, no strategies/demo/levels.yml; the face reads standing.yml again within 30 s`]);
  const [order] = await armedOrders(r);
  assert.equal(order.market, "cn");
  assert.match(await readFile(r.standing, "utf8"), /\n {4}dir: "strategies\/demo"\n {4}market: "cn"\n/);
  assert.deepEqual(r.cnCalls, ["2026-11-30"], "the XSHG calendar, asked for the Beijing date");
  assert.deepEqual(r.usCalls, []);
});

test("arm --market cn --at open-570m is armed: the offset stays on the Beijing date", async () => {
  const r = await armRig(BJ_NOW);
  assert.equal(await runDesk("arm", ["strategies/demo", "--id", "demo-report", "--at", "open-570m", "--market", "cn", "--producer", "builtin:report", "--expires", "2026-12-31"], r.deps), 0);
  assert.equal((await armedOrders(r))[0].at, "open-570m");
});

test("arm --market cn at 2026-11-30T02:00:00Z with --expires 2026-11-29 is refused", async () => {                    // R3
  const r = await armRig(BJ_NOW);
  assert.equal(await runDesk("arm", ["strategies/demo", "--id", "demo-report", "--at", "open-90m", "--market", "cn", "--producer", "builtin:report", "--expires", "2026-11-29"], r.deps), 1);
  assert.deepEqual(r.take(), ["cannot arm demo-report: --expires 2026-11-29 is before today, 2026-11-30 Beijing"]);
  assert.equal(await standingText(r), null);
  assert.equal(await runDesk("arm", ["strategies/demo", "--id", "demo-report", "--at", "open-90m", "--producer", "builtin:report", "--expires", "2026-11-29"], r.deps), 0,
    "on us, still the 29th in New York");
});

test("arm refuses a market it does not know, a wall time on cn, and builtin:brief on cn", async () => {
  const cases: [string[], string][] = [
    [["strategies/demo", "--id", "x", "--at", "open-90m", "--market", "jp", "--expires", "2026-12-31"], "cannot arm x: --market jp is not us or cn"],
    [["strategies/demo", "--id", "x", "--at", "08:00", "--market", "cn", "--expires", "2026-12-31"], "cannot arm x: an A-share order anchors on the open or the close, not 08:00"],
    [["desk", "--id", "x", "--at", "close-30m", "--market", "cn", "--producer", "builtin:brief", "--expires", "2026-12-31"],
      "cannot arm x: builtin:brief is the US pre-close brief; it runs only with market: us"],
  ];
  for (const [args, line] of cases) {
    const r = await armRig(BJ_NOW);
    assert.equal(await runDesk("arm", args, r.deps), 1, args.join(" "));
    assert.deepEqual(r.take(), [line]);
    assert.equal(await standingText(r), null);
  }
  const twice = await armRig(BJ_NOW);
  assert.equal(await runDesk("arm", ["desk", "--id", "x", "--at", "close", "--market", "cn", "--market", "us", "--expires", "2026-12-31"], twice.deps), 2);
  assert.deepEqual(twice.take(), [USAGE]);
});

test("arm without --market over a levels.yml whose every symbol is an A share prints one note naming --market cn", async () => {   // R3
  const r = await armRig(ARM_NOW, CN_LEVELS_YML);
  assert.equal(await runDesk("arm", REPORT_ARGS, r.deps), 0);
  const lines = r.take();
  assert.equal(lines.length, 2, lines.join("\n"));
  assert.equal(lines[1], "note: every symbol in strategies/demo/levels.yml is an A share; arm with --market cn, or the report fires on New York's open");
  const cn = await armRig(ARM_NOW, CN_LEVELS_YML);
  assert.equal(await runDesk("arm", [...REPORT_ARGS, "--market", "cn"], cn.deps), 0);
  assert.equal(cn.take().length, 1, "no note on cn");
  const mixed = await armRig(ARM_NOW, CN_LEVELS_YML + LEVELS_YML);
  assert.equal(await runDesk("arm", REPORT_ARGS, mixed.deps), 0);
  assert.equal(mixed.take().length, 1, "no note when one symbol is a US one");
});

test("rearm --expires on a cn order reads the Beijing date", async () => {
  const r = await armRig(BJ_NOW);
  assert.equal(await runDesk("arm", ["strategies/demo", "--id", "demo-report", "--at", "open-90m", "--market", "cn", "--producer", "builtin:report", "--expires", "2026-12-31"], r.deps), 0);
  r.take();
  assert.equal(await runDesk("rearm", ["demo-report", "--expires", "2026-11-29"], r.deps), 1);
  assert.deepEqual(r.take(), ["cannot re-arm demo-report: --expires 2026-11-29 is before today, 2026-11-30 Beijing"]);
});
