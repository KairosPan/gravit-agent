// face/tests/desk-arm.test.ts
/** `npm run desk -- arm` and `rearm` (scripts/desk.ts over src/standing.ts): arming hashes the order's text and
 * its script, checks the market calendar, and appends a verified entry to standing.yml, written 0600; every
 * refusal is one line and leaves standing.yml as it was - a file refused for an unarmed order names the way out;
 * re-arming takes a changed file's new hash and leaves the rest, and `--expires` extends an order, an expired one
 * too; neither writes over an edit made after it read the file. Offline: a fake market clock. The fixture
 * repository roots and harness homes sit INSIDE the repository, under tests/tmp/desk-arm-<pid>/, and are removed
 * afterwards. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDesk } from "../scripts/desk.ts";
import { deskDir } from "../src/desk.ts";
import type { MarketClock } from "../src/market-clock.ts";
import { STANDING_FILE, parseStanding, sha256Hex, type StandingOrder } from "../src/standing.ts";

const TEST_DIR = join(dirname(fileURLToPath(import.meta.url)), "tmp", `desk-arm-${process.pid}`);
after(() => rm(TEST_DIR, { recursive: true, force: true }));

const USAGE = "usage: npm run desk -- pause [Nm | Nh | Nd] | resume | arm <desk | strategies/NAME> --id ID --at ANCHOR --expires YYYY-MM-DD"
  + " [--producer scripts/FILE.py | builtin:NAME] [--model PROVIDER/MODEL] [--turn-deadline DURATION] [--producer-deadline DURATION] [--no-wake]"
  + " | rearm ID [--expires YYYY-MM-DD]";
/** 14:00 ET on Tuesday 2026-10-20 (EDT). */
const NOW = Date.parse("2026-10-20T18:00:00Z");
const ARMED_AT = "2026-10-20T18:00:00.000Z";
/** The interpreter a calendar refusal names: the face's. */
const PYTHON = process.env.FACE_PYTHON || "python3";
const STANDING_MD = "# Pre-close\nBrief me before the close.\n";
const P_PY = "print('p')\n";

/** A fake clock: the asked date's session, 09:30 to 16:00 EDT; each ask's date lands in `calls`. */
const goodClock = (calls: string[]): MarketClock => async (from, days) => {
  calls.push(from);
  return { from, days, source: "a fake calendar", python: "fake", sessions: [{ date: from, open: `${from}T13:30:00Z`, close: `${from}T20:00:00Z`, early: false }] };
};

interface Rig {
  root: string;
  home: string;
  /** `<home>/face/desk/standing.yml`. */
  standing: string;
  /** The dates the clock was asked for. */
  calls: string[];
  deps: { home: string; root: string; out: (line: string) => void; now: () => number; marketClock: MarketClock };
  /** The lines printed since the last take. */
  take(): string[];
}

let made = 0;
/** A fresh repository root - desk/STANDING.md, scripts/p.py, strategies/alpha/STANDING.md - and harness home, under TEST_DIR.
 * `clock` makes the market clock from the ask log and the rig's standing.yml path; {@link goodClock} by default. */
async function rig(clock?: (calls: string[], standing: string) => MarketClock): Promise<Rig> {
  const dir = join(TEST_DIR, String(++made));
  const root = join(dir, "root");
  const home = join(dir, "home");
  await mkdir(join(root, "desk", "journal"), { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  await mkdir(join(root, "strategies", "alpha"), { recursive: true });
  await writeFile(join(root, "desk", "STANDING.md"), STANDING_MD);
  await writeFile(join(root, "scripts", "p.py"), P_PY);
  await writeFile(join(root, "strategies", "alpha", "STANDING.md"), "# alpha\nReport before the open.\n");
  const calls: string[] = [];
  const standing = join(deskDir(home), STANDING_FILE);
  let lines: string[] = [];
  return {
    root, home, standing, calls,
    deps: { home, root, out: (line) => { lines.push(line); }, now: () => NOW, marketClock: (clock ?? goodClock)(calls, standing) },
    take: () => { const got = lines; lines = []; return got; },
  };
}

/** standing.yml's orders; fails the test when it does not load. */
async function ordersIn(r: Rig): Promise<StandingOrder[]> {
  const load = parseStanding(await readFile(r.standing, "utf8"));
  assert.ok(load.ok, load.ok ? "" : load.errors.join("; "));
  return load.ok ? load.orders : [];
}

const PRECLOSE = ["desk", "--id", "preclose", "--at", "close-30m", "--producer", "builtin:brief", "--expires", "2026-11-30"];

test("arm hashes STANDING.md, checks the calendar, appends a verified 0600 entry and prints it", async () => {
  const r = await rig();
  const code = await runDesk("arm", PRECLOSE, r.deps);
  const sha = sha256Hex(await readFile(join(r.root, "desk", "STANDING.md")));
  assert.deepEqual(r.take(), [`armed preclose in ${r.root}: desk/STANDING.md sha256 ${sha.slice(0, 12)}…, at close-30m, expires 2026-11-30, producer builtin:brief; the face reads standing.yml again within 30 s`]);
  assert.equal(code, 0);
  assert.equal((await stat(r.standing)).mode & 0o777, 0o600);
  assert.deepEqual(r.calls, ["2026-10-20"], "the calendar is asked once, for today in New York");
  assert.deepEqual(await ordersIn(r), [{
    id: "preclose", dir: "desk", file: "STANDING.md", sha256: sha, at: "close-30m", anchor: { kind: "close", offsetMin: -30 },
    producer: { kind: "builtin", name: "brief" }, wake: true, turnDeadlineMs: 600_000, producerDeadlineMs: 300_000,
    expires: "2026-11-30", enabled: true, armedAt: ARMED_AT,
  }]);
  const first = await readFile(r.standing, "utf8");
  assert.match(first, /^orders:\n {2}- id: "preclose"\n/, "the entry as renderOrder writes it");

  /* a second order, in a strategy - its directory typed with a trailing slash - with a model, a deadline in seconds, a
   * time anchor, and today as its last day */
  assert.equal(await runDesk("arm", ["strategies/alpha/", "--id", "alpha-open", "--at", "09:00", "--expires", "2026-10-20",
    "--model", "deepseek-official/deepseek-v4-pro", "--turn-deadline", "90s"], r.deps), 0);
  const alphaSha = sha256Hex("# alpha\nReport before the open.\n");
  assert.deepEqual(r.take(), [`armed alpha-open in ${r.root}: strategies/alpha/STANDING.md sha256 ${alphaSha.slice(0, 12)}…, at 09:00, expires 2026-10-20; the face reads standing.yml again within 30 s`]);
  const orders = await ordersIn(r);
  assert.deepEqual(orders.map((o) => o.id), ["preclose", "alpha-open"]);
  assert.deepEqual(orders[1], {
    id: "alpha-open", dir: "strategies/alpha", file: "STANDING.md", sha256: alphaSha, at: "09:00", anchor: { kind: "time", hour: 9, minute: 0 },
    wake: true, model: "deepseek-official/deepseek-v4-pro", turnDeadlineMs: 90_000, producerDeadlineMs: 300_000, expires: "2026-10-20", enabled: true,
    armedAt: ARMED_AT,
  });
  assert.ok((await readFile(r.standing, "utf8")).startsWith(first), "appended: the first entry stays as it was");
  assert.equal((await stat(r.standing)).mode & 0o777, 0o600);
});

test("arm notes another enabled order at the same anchor: they run one after another (M5)", async () => {
  const r = await rig();
  assert.equal(await runDesk("arm", PRECLOSE, r.deps), 0);
  r.take();
  assert.equal(await runDesk("arm", ["desk", "--id", "second", "--at", "close-30m", "--expires", "2026-11-30"], r.deps), 0);
  const said = r.take();
  assert.equal(said.length, 2, said.join(" | "));
  assert.equal(said[1], "note: preclose also fires at close-30m; orders sharing an anchor run one after another, so second may start late - and a close-anchored text that finishes after the close is held back");
  assert.equal(await runDesk("arm", ["desk", "--id", "third", "--at", "close-15m", "--expires", "2026-11-30", "--turn-deadline", "5m"], r.deps), 0);
  assert.equal(r.take().length, 1, "another anchor: no note");
});

test("arm and rearm a script producer: its hash is recorded, printed and re-taken", async () => {
  const r = await rig();
  assert.equal(await runDesk("arm", ["desk", "--id", "cap", "--at", "close-30m", "--producer", "scripts/p.py", "--expires", "2026-11-30", "--no-wake",
    "--producer-deadline", "20m"], r.deps), 0);
  const sha = sha256Hex(STANDING_MD);
  const psha = sha256Hex(P_PY);
  const [line, ...rest] = r.take();
  assert.deepEqual(rest, []);
  assert.ok(line.endsWith(`, producer scripts/p.py sha256 ${psha.slice(0, 12)}…; the face reads standing.yml again within 30 s`), line);
  assert.equal(line, `armed cap in ${r.root}: desk/STANDING.md sha256 ${sha.slice(0, 12)}…, at close-30m, expires 2026-11-30, producer scripts/p.py sha256 ${psha.slice(0, 12)}…; the face reads standing.yml again within 30 s`);
  const [armed] = await ordersIn(r);
  assert.equal(armed.producerSha256, psha);
  assert.deepEqual(armed.producer, { kind: "script", script: "scripts/p.py" });
  assert.equal(armed.wake, false, "--no-wake: the producer runs and nothing is woken");
  assert.equal(armed.producerDeadlineMs, 1_200_000);

  await writeFile(join(r.root, "scripts", "p.py"), "print('changed')\n");
  const newPsha = sha256Hex("print('changed')\n");
  assert.equal(await runDesk("rearm", ["cap"], r.deps), 0);
  assert.deepEqual(r.take(), [`re-armed cap: desk/STANDING.md sha256 ${sha.slice(0, 12)}…, scripts/p.py sha256 ${newPsha.slice(0, 12)}… (changed)`],
    "the moved pin marked (p2-m11)");
  const [rearmed] = await ordersIn(r);
  assert.deepEqual(rearmed, { ...armed, producerSha256: newPsha }, "only the script's hash moved; armedAt too stays");
  assert.equal(await runDesk("rearm", ["cap"], r.deps), 0);
  assert.deepEqual(r.take(), ["cap: nothing changed since arming"]);

  await rm(join(r.root, "scripts", "p.py"));
  const before = await readFile(r.standing);
  assert.equal(await runDesk("rearm", ["cap"], r.deps), 1);
  assert.deepEqual(r.take(), ["cannot re-arm cap: scripts/p.py is missing"]);
  assert.deepEqual(await readFile(r.standing), before);
});

test("arm refuses a taken id, a bad --at, a past --expires, a non-.py script, a short close anchor, a failed calendar and a refused standing.yml", async () => {
  const r = await rig();
  assert.equal(await runDesk("arm", PRECLOSE, r.deps), 0);
  r.take();
  r.calls.length = 0;
  const before = await readFile(r.standing);
  await mkdir(join(r.root, "strategies", "big"), { recursive: true });
  await writeFile(join(r.root, "strategies", "big", "STANDING.md"), "x".repeat(16_385));
  await mkdir(join(r.root, "strategies", "latin"), { recursive: true });
  await writeFile(join(r.root, "strategies", "latin", "STANDING.md"), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  await mkdir(join(r.root, "strategies", "linked"), { recursive: true });
  await symlink(join(r.root, "desk", "STANDING.md"), join(r.root, "strategies", "linked", "STANDING.md"));
  await writeFile(join(r.root, "outside.py"), "print('outside')\n");
  await symlink(join(r.root, "outside.py"), join(r.root, "scripts", "out.py"));
  /* root reads a 0000 file all the same, so the unreadable-script row runs only for another user */
  const asRoot = process.getuid?.() === 0;
  if (!asRoot) await writeFile(join(r.root, "scripts", "locked.py"), "print('locked')\n", { mode: 0o000 });
  const x = (...more: string[]): string[] => ["desk", "--id", "x", "--at", "close-30m", "--expires", "2026-11-30", ...more];
  const refusals: [args: string[], line: string][] = [
    [["desk", "--id", "preclose", "--at", "close-30m", "--expires", "2026-11-30"],
      "cannot arm preclose: preclose is already armed; npm run desk -- rearm preclose takes a changed file's new hash"],
    [["desk", "--id", "x", "--at", "close-30", "--expires", "2026-11-30"],
      "cannot arm x: --at close-30 is not open, close, open±Nm, close±Nm (N 1-600; open-Nm at most 570, close+Nm at most 479) or HH:MM"],
    [["desk", "--id", "x", "--at", "close-30m", "--expires", "2026-10-19"], "cannot arm x: --expires 2026-10-19 is before today, 2026-10-20 ET"],
    [["desk", "--id", "x", "--at", "close-30m", "--expires", "2026-11-31"], "cannot arm x: --expires 2026-11-31 is not a date, YYYY-MM-DD"],
    [x("--producer", "scripts/x.mjs"), "cannot arm x: producer must be scripts/<file>.py or builtin:<name>"],
    [x("--producer", "builtin:nope"), 'cannot arm x: unknown builtin "nope"'],
    [x("--producer", "scripts/gone.py"), "cannot arm x: scripts/gone.py is missing"],
    [x("--producer", "scripts/out.py"), "cannot arm x: scripts/out.py leaves scripts/"],
    /* hashed as a firing reads it: a script that cannot be read is missing to both, in the firing's words */
    ...(asRoot ? [] : [[x("--producer", "scripts/locked.py"), "cannot arm x: scripts/locked.py is missing"] as [string[], string]]),
    [["desk", "--id", "x", "--at", "close-10m", "--producer", "builtin:brief", "--expires", "2026-11-30"],
      "cannot arm x: close-10m leaves 10 min before the close; its producer (5 min), its turn (10 min) and the 5-minute grace need 20 min"],
    [x("--turn-deadline", "45m"), "cannot arm x: --turn-deadline 45m must be <n>s or <n>m, from 1 min to 30 min"],
    [x("--producer", "builtin:brief", "--producer-deadline", "5s"), "cannot arm x: --producer-deadline 5s must be <n>s or <n>m, from 10 s to 180 min"],
    [x("--model", "flash"), "cannot arm x: --model flash is not PROVIDER/MODEL"],
    [x("--no-wake"), "cannot arm x: --no-wake needs a --producer: an order with neither runs nothing"],
    [["desk", "--id", "Bad_Id", "--at", "close-30m", "--expires", "2026-11-30"],
      "cannot arm Bad_Id: --id Bad_Id is not an order id: a-z, 0-9 and -, opening with a letter, at most 40 characters"],
    [["strategies/_template", "--id", "x", "--at", "close-30m", "--expires", "2026-11-30"], "cannot arm x: strategies/_template is not desk or strategies/NAME"],
    [["desk/journal", "--id", "x", "--at", "close-30m", "--expires", "2026-11-30"], "cannot arm x: desk/journal is not desk or strategies/NAME"],
    [["strategies/beta", "--id", "x", "--at", "close-30m", "--expires", "2026-11-30"], "cannot arm x: strategies/beta/STANDING.md is missing"],
    [["strategies/big", "--id", "x", "--at", "close-30m", "--expires", "2026-11-30"], "cannot arm x: strategies/big/STANDING.md is 16,385 bytes; the limit is 16,384"],
    [["strategies/latin", "--id", "x", "--at", "close-30m", "--expires", "2026-11-30"], "cannot arm x: strategies/latin/STANDING.md is not UTF-8"],
    [["strategies/linked", "--id", "x", "--at", "close-30m", "--expires", "2026-11-30"], "cannot arm x: strategies/linked/STANDING.md is not a regular file"],
  ];
  for (const [args, line] of refusals) {
    assert.equal(await runDesk("arm", args, r.deps), 1, args.join(" "));
    assert.deepEqual(r.take(), [line]);
    assert.deepEqual(await readFile(r.standing), before, `${args.join(" ")}: standing.yml as it was`);
  }
  assert.deepEqual(r.calls, [], "the calendar is asked last, once every other check has passed - here, never");

  /* the usage line, exit 2: an unknown flag, a missing value, a missing flag, a second directory; the calendar never asked */
  r.calls.length = 0;
  for (const args of [x("--bogus"), x("--model"), ["desk", "--id", "x", "--at", "close-30m"], [...x(), "strategies/alpha"], x("--id", "y"),
    x("--no-wake", "--no-wake"), ["--id", "x", "--at", "close-30m", "--expires", "2026-11-30"], x("--model", "--no-wake"), x("--at=close")]) {
    assert.equal(await runDesk("arm", args, r.deps), 2, args.join(" "));
    assert.deepEqual(r.take(), [USAGE]);
  }
  for (const args of [[], ["a", "b"]]) {
    assert.equal(await runDesk("rearm", args, r.deps), 2);
    assert.deepEqual(r.take(), [USAGE]);
  }
  assert.deepEqual(r.calls, [], "no flags, no clock");
  assert.deepEqual(await readFile(r.standing), before);

  /* a failed calendar */
  const failing = await rig(() => async () => { throw new Error("No module named 'pandas_market_calendars'"); });
  assert.equal(await runDesk("arm", PRECLOSE, failing.deps), 1);
  const [calendar] = failing.take();
  assert.equal(calendar, `cannot arm preclose: the market calendar failed in ${PYTHON}: No module named 'pandas_market_calendars'; FACE_PYTHON must name an interpreter with pandas_market_calendars`);
  assert.ok(calendar.endsWith("pandas_market_calendars"));
  assert.equal(existsSync(failing.standing), false, "nothing written");
  const holey = await rig(() => async (_from, days) => ({ from: "2026-10-21", days, source: "fake", python: "fake", sessions: [] }));
  assert.equal(await runDesk("arm", PRECLOSE, holey.deps), 1);
  assert.deepEqual(holey.take(), [`cannot arm preclose: the market calendar failed in ${PYTHON}: the market clock answered a window from 2026-10-21 for 10 days, which does not hold 2026-10-20; FACE_PYTHON must name an interpreter with pandas_market_calendars`]);

  /* a file refused for orders that are not armed: the way out, since arm adds nothing to a refused file */
  const unarmed = await rig();
  await mkdir(deskDir(unarmed.home), { recursive: true });
  await writeFile(unarmed.standing, "orders:\n  - id: preclose\n    dir: desk\n    at: close-30m\n    expires: 2026-11-30\n");
  const unarmedBefore = await readFile(unarmed.standing);
  const wayOut = "orders[0] (preclose): not armed: npm run desk -- arm desk …; remove orders[0] (preclose) from standing.yml, then arm it again";
  assert.equal(await runDesk("arm", PRECLOSE, unarmed.deps), 1);
  assert.deepEqual(unarmed.take(), [`cannot arm preclose: ${unarmed.standing} is refused, so nothing is added to it until it is fixed: ${wayOut}`]);
  assert.equal(await runDesk("rearm", ["preclose"], unarmed.deps), 1);
  assert.deepEqual(unarmed.take(), [`cannot re-arm preclose: ${unarmed.standing} is refused, so nothing in it changes until it is fixed: ${wayOut}`]);
  assert.deepEqual(await readFile(unarmed.standing), unarmedBefore);
  await writeFile(unarmed.standing, `${unarmedBefore.toString("utf8")}  - id: other\n    dir: strategies/alpha\n    at: "09:00"\n    expires: 2026-11-30\n`);
  assert.equal(await runDesk("arm", PRECLOSE, unarmed.deps), 1);
  assert.ok(unarmed.take()[0].endsWith("; remove orders[0] (preclose) and orders[1] (other) from standing.yml, then arm them again"));
  await writeFile(unarmed.standing, "orders:\n");
  assert.equal(await runDesk("arm", PRECLOSE, unarmed.deps), 0, "the way out: removed, then armed");
  unarmed.take();

  /* a refused standing.yml */
  const broken = await rig();
  await mkdir(deskDir(broken.home), { recursive: true });
  await writeFile(broken.standing, "orderz:\n  - id: a\n");
  const brokenBefore = await readFile(broken.standing);
  assert.equal(await runDesk("arm", PRECLOSE, broken.deps), 1);
  assert.deepEqual(broken.take(), [`cannot arm preclose: ${broken.standing} is refused, so nothing is added to it until it is fixed: orderz is not a key standing.yml takes (budget, orders)`]);
  assert.deepEqual(await readFile(broken.standing), brokenBefore);
  assert.deepEqual(broken.calls, [], "refused before the calendar");

  /* a shape arm cannot append to: the entry to paste, and nothing written */
  const shaped = await rig();
  await mkdir(deskDir(shaped.home), { recursive: true });
  await writeFile(shaped.standing, "orders: []\nbudget:\n  dailyTokens: 5\n");
  assert.equal(await runDesk("arm", PRECLOSE, shaped.deps), 1);
  const [paste, ...more] = shaped.take();
  assert.deepEqual(more, []);
  assert.ok(paste.startsWith("cannot arm preclose: standing.yml has a shape arm cannot append to safely; add this entry under orders: by hand:\n  - id: \"preclose\"\n"), paste);
  assert.ok(paste.includes(`    armedAt: "${ARMED_AT}"\n`));
  assert.equal(await readFile(shaped.standing, "utf8"), "orders: []\nbudget:\n  dailyTokens: 5\n");

  /* a home where the desk directory cannot be made */
  const blocked = await rig();
  await mkdir(blocked.home, { recursive: true });
  await writeFile(join(blocked.home, "face"), "a file where the directory should be");
  assert.equal(await runDesk("arm", PRECLOSE, blocked.deps), 1);
  assert.deepEqual(blocked.take(), [`cannot arm preclose: cannot read ${blocked.standing}: ENOTDIR`]);
});

test("rearm takes a changed text's new hash and leaves the rest", async () => {
  const r = await rig();
  assert.equal(await runDesk("rearm", ["preclose"], r.deps), 1, "no standing.yml yet");
  assert.deepEqual(r.take(), ["cannot re-arm preclose: no such order in standing.yml"]);
  assert.equal(await runDesk("arm", PRECLOSE, r.deps), 0);
  r.take();
  const armed = await readFile(r.standing, "utf8");
  const sha = sha256Hex(STANDING_MD);
  const edited = "# Pre-close\nBrief me twenty minutes before the close.\n";
  await writeFile(join(r.root, "desk", "STANDING.md"), edited);
  const newSha = sha256Hex(edited);

  assert.equal(await runDesk("rearm", ["preclose"], r.deps), 0);
  assert.deepEqual(r.take(), [`re-armed preclose: desk/STANDING.md sha256 ${newSha.slice(0, 12)}… (changed)`]);
  assert.equal(await readFile(r.standing, "utf8"), armed.replace(sha, newSha), "only the hash moved; armedAt too stays");
  const [order] = await ordersIn(r);
  assert.equal(order.sha256, newSha);
  assert.equal(order.armedAt, ARMED_AT);
  assert.equal((await stat(r.standing)).mode & 0o777, 0o600);

  const rearmed = await readFile(r.standing);
  assert.equal(await runDesk("rearm", ["preclose"], r.deps), 0);
  assert.deepEqual(r.take(), ["preclose: nothing changed since arming"]);
  assert.deepEqual(await readFile(r.standing), rearmed);

  assert.equal(await runDesk("rearm", ["nope"], r.deps), 1);
  assert.deepEqual(r.take(), ["cannot re-arm nope: no such order in standing.yml"]);

  await unlink(join(r.root, "desk", "STANDING.md"));
  assert.equal(await runDesk("rearm", ["preclose"], r.deps), 1);
  assert.deepEqual(r.take(), ["cannot re-arm preclose: desk/STANDING.md is missing"]);
  assert.deepEqual(await readFile(r.standing), rearmed);

  await writeFile(r.standing, `${rearmed.toString("utf8")}orderz: 1\n`);
  assert.equal(await runDesk("rearm", ["preclose"], r.deps), 1);
  assert.deepEqual(r.take(), [`cannot re-arm preclose: ${r.standing} is refused, so nothing in it changes until it is fixed: orderz is not a key standing.yml takes (budget, orders)`]);
  assert.deepEqual(r.calls, ["2026-10-20"], "rearm never asks the calendar");
});

test("rearm --expires extends an order, an expired one too, and checks the date as arm does", async () => {
  const r = await rig();
  assert.equal(await runDesk("arm", ["desk", "--id", "preclose", "--at", "close-30m", "--producer", "builtin:brief", "--expires", "2026-10-20"], r.deps), 0);
  r.take();
  const armed = await readFile(r.standing, "utf8");
  const sha = sha256Hex(STANDING_MD);
  /** Two weeks on: the order expired after 2026-10-20. */
  const later = { ...r.deps, now: () => Date.parse("2026-11-03T18:00:00Z") };

  assert.equal(await runDesk("rearm", ["preclose", "--expires", "2026-12-31"], later), 0);
  assert.deepEqual(r.take(), [`re-armed preclose: desk/STANDING.md sha256 ${sha.slice(0, 12)}…, expires 2026-12-31`]);
  assert.equal(await readFile(r.standing, "utf8"), armed.replace('expires: "2026-10-20"', 'expires: "2026-12-31"'), "only its last day moved");
  const [order] = await ordersIn(r);
  assert.equal(order.expires, "2026-12-31");
  assert.equal(order.armedAt, ARMED_AT, "armedAt stays");
  assert.equal((await stat(r.standing)).mode & 0o777, 0o600);
  assert.equal(await runDesk("rearm", ["preclose", "--expires", "2026-12-31"], later), 0);
  assert.deepEqual(r.take(), ["preclose: nothing changed since arming"]);

  /* a text edited since arming: --expires never pins it with the new date */
  const extended = await readFile(r.standing);
  await writeFile(join(r.root, "desk", "STANDING.md"), "# Pre-close\nBrief me ten minutes earlier.\n");
  assert.equal(await runDesk("rearm", ["--expires", "2027-01-15", "preclose"], later), 1, "the flag before the id; refused, not the usage line");
  assert.deepEqual(r.take(), ["cannot re-arm preclose: desk/STANDING.md changed since arming; review it, then: npm run desk -- rearm preclose"]);
  assert.deepEqual(await readFile(r.standing), extended, "nothing written: the edit not pinned, the date not moved");

  const before = await readFile(r.standing);
  const refusals: [string[], string][] = [
    [["preclose", "--expires", "2026-11-31"], "cannot re-arm preclose: --expires 2026-11-31 is not a date, YYYY-MM-DD"],
    [["preclose", "--expires", "2026-11-02"], "cannot re-arm preclose: --expires 2026-11-02 is before today, 2026-11-03 ET"],
    [["nope", "--expires", "2026-12-31"], "cannot re-arm nope: no such order in standing.yml"],
  ];
  for (const [args, line] of refusals) {
    assert.equal(await runDesk("rearm", args, later), 1, args.join(" "));
    assert.deepEqual(r.take(), [line]);
    assert.deepEqual(await readFile(r.standing), before);
  }
  for (const args of [["preclose", "--expires"], ["--expires", "2026-12-31"], ["preclose", "--expires", "2026-12-31", "--expires", "2027-01-01"],
    ["preclose", "--until", "2026-12-31"], ["preclose", "--expires", "--no-wake"]]) {
    assert.equal(await runDesk("rearm", args, later), 2, args.join(" "));
    assert.deepEqual(r.take(), [USAGE]);
  }
  assert.deepEqual(await readFile(r.standing), before);
});

test("an edit made while an order was expired is reviewed and re-pinned before it is extended: rearm, then rearm --expires", async () => {
  const r = await rig();
  assert.equal(await runDesk("arm", ["desk", "--id", "cap", "--at", "close-30m", "--producer", "scripts/p.py", "--expires", "2026-10-20"], r.deps), 0);
  r.take();
  const armed = await readFile(r.standing, "utf8");
  /** Two weeks on: the order expired after 2026-10-20, and its files were edited meanwhile. */
  const later = { ...r.deps, now: () => Date.parse("2026-11-03T18:00:00Z") };
  const script = "print('changed while it was expired')\n";
  const text = "# Pre-close\nEdited while it was expired.\n";

  await writeFile(join(r.root, "scripts", "p.py"), script);
  assert.equal(await runDesk("rearm", ["cap", "--expires", "2026-12-31"], later), 1);
  assert.deepEqual(r.take(), ["cannot re-arm cap: scripts/p.py changed since arming; review it, then: npm run desk -- rearm cap"]);
  assert.equal(await readFile(r.standing, "utf8"), armed, "nothing written");
  await writeFile(join(r.root, "desk", "STANDING.md"), text);
  assert.equal(await runDesk("rearm", ["cap", "--expires", "2026-12-31"], later), 1);
  assert.deepEqual(r.take(), ["cannot re-arm cap: desk/STANDING.md and scripts/p.py changed since arming; review them, then: npm run desk -- rearm cap"],
    "both changed: both named, the text first (p2-m11)");
  assert.equal(await readFile(r.standing, "utf8"), armed, "nothing written");

  /* step one, after the review: the plain rearm re-pins both files, the date untouched */
  const sha = sha256Hex(text);
  const psha = sha256Hex(script);
  assert.equal(await runDesk("rearm", ["cap"], later), 0);
  assert.deepEqual(r.take(), [`re-armed cap: desk/STANDING.md sha256 ${sha.slice(0, 12)}… (changed), scripts/p.py sha256 ${psha.slice(0, 12)}… (changed)`]);
  const [pinned] = await ordersIn(r);
  assert.deepEqual([pinned.sha256, pinned.producerSha256, pinned.expires], [sha, psha, "2026-10-20"]);

  /* step two: the extension */
  assert.equal(await runDesk("rearm", ["cap", "--expires", "2026-12-31"], later), 0);
  assert.deepEqual(r.take(), [`re-armed cap: desk/STANDING.md sha256 ${sha.slice(0, 12)}…, scripts/p.py sha256 ${psha.slice(0, 12)}…, expires 2026-12-31`]);
  const [extended] = await ordersIn(r);
  assert.deepEqual(extended, { ...pinned, expires: "2026-12-31" }, "only the date moved");
});

test("arm and rearm write only over the file they read: an edit made in between is refused and kept", async () => {
  /* arm asks the market clock after it has read standing.yml and before it builds its edit (appendOrder runs after
   * the calendar), so a clock that edits the file stands in for the operator's editor saving while arm runs */
  let meddle = true;
  const edit = "# edited by hand while arm ran\norders: []\n";
  const r = await rig((calls, standing) => async (from, days) => {
    calls.push(from);
    if (meddle) {
      await mkdir(dirname(standing), { recursive: true });
      await writeFile(standing, edit);
    }
    return { from, days, source: "a fake calendar", python: "fake", sessions: [{ date: from, open: `${from}T13:30:00Z`, close: `${from}T20:00:00Z`, early: false }] };
  });
  const changed = (verb: string, id: string): string => `cannot ${verb} ${id}: cannot write ${r.standing}: it changed since it was read; run the command again`;

  assert.equal(await runDesk("arm", PRECLOSE, r.deps), 1, "no file when read, one when written");
  assert.deepEqual(r.take(), [changed("arm", "preclose")]);
  assert.equal(await readFile(r.standing, "utf8"), edit, "the file that appeared meanwhile is kept");

  meddle = false;
  assert.equal(await runDesk("arm", PRECLOSE, r.deps), 0);
  r.take();
  const armed = await readFile(r.standing, "utf8");
  assert.ok(armed.startsWith("# edited by hand while arm ran\norders:\n  - id: \"preclose\"\n"), "armed on top of the edit");

  meddle = true;
  assert.equal(await runDesk("arm", ["desk", "--id", "second", "--at", "close-30m", "--expires", "2026-11-30"], r.deps), 1);
  assert.deepEqual(r.take(), [changed("arm", "second")]);
  assert.equal(await readFile(r.standing, "utf8"), edit, "the edit made meanwhile is kept, not the file arm built from what it read");

  /* rearm --expires reads the clock after standing.yml, so a clock that edits the file stands in the same way */
  await writeFile(r.standing, armed);
  const meanwhile = `# edited by hand while rearm ran\n${armed}`;
  const meddling = { ...r.deps, now: (): number => { writeFileSync(r.standing, meanwhile); return NOW; } };
  assert.equal(await runDesk("rearm", ["preclose", "--expires", "2026-12-31"], meddling), 1);
  assert.deepEqual(r.take(), [changed("re-arm", "preclose")]);
  assert.equal(await readFile(r.standing, "utf8"), meanwhile);
});
