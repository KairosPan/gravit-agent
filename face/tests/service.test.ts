// face/tests/service.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COPIED_KEYS, EXPECTED_KEYS, LABEL, WATCH_POLL_MS, checkHealth, contextOf, ensureHomeEnv, envLinesOf, fetchStatus, filterPath, formatStatus,
  installPlan, lastTokenUrl, nodeOnPath, parseLaunchctlPrint, portAnswers, runService, servicePlan, type ServiceDeps,
} from "../scripts/service.ts";
import { WATCH_CN_POLL_MS, WATCH_US_POLL_MS } from "../src/watch.ts";
import { deskStatusLines, type DeskStatus } from "../src/desk.ts";

const home = (): Promise<string> => mkdtemp(join(tmpdir(), "face-service-"));
/** A status's `turnsToday` on a day with no desk turn. */
const noTurns: DeskStatus["turnsToday"] = { count: 0, usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
const plan = (port?: number) => servicePlan({ root: "/repo", home: "/h/.dsh", homeDir: "/h", node: "/usr/local/bin/node", path: "/usr/local/bin:/repo/face/node_modules/.bin::/opt/homebrew/bin", launchAgentsDir: "/h/Library/LaunchAgents", port });

test("servicePlan: node imports tsx's loader and runs main.ts itself; face/ as cwd; only PATH HOME DSH_HOME in the environment; launchd keys", () => {
  const p = plan();
  assert.deepEqual(p.args, ["/usr/local/bin/node", "--import", "file:///repo/face/node_modules/tsx/dist/loader.mjs", "/repo/face/src/main.ts"]);
  assert.ok(p.plist.includes("    <string>/usr/local/bin/node</string>\n    <string>--import</string>\n"
    + "    <string>file:///repo/face/node_modules/tsx/dist/loader.mjs</string>\n    <string>/repo/face/src/main.ts</string>\n"),
    "the arguments in the plist, in order");
  assert.ok(!p.plist.includes("cli.mjs"), "never tsx's CLI, which would run the face in a child launchd does not watch");
  assert.deepEqual(p.env, { PATH: "/usr/local/bin:/opt/homebrew/bin", HOME: "/h", DSH_HOME: "/h/.dsh" });
  assert.equal(p.path, `/h/Library/LaunchAgents/${LABEL}.plist`);
  assert.equal(p.log, "/h/.dsh/face/service/face.log"); assert.equal(p.errLog, "/h/.dsh/face/service/face.err.log");
  for (const needle of ["<key>Label</key><string>com.gravit.face</string>", "<key>WorkingDirectory</key><string>/repo/face</string>",
    "<key>RunAtLoad</key><true/>", "<key>SuccessfulExit</key><false/>", "<key>ThrottleInterval</key><integer>30</integer>",
    "<key>Umask</key><integer>63</integer>", `<key>StandardOutPath</key><string>${p.log}</string>`]) assert.ok(p.plist.includes(needle), needle);
  assert.doesNotMatch(p.plist, /KEY|TOKEN|SECRET/, "no credential name reaches the plist");
  assert.ok(plan(3091).plist.includes("<key>FACE_PORT</key><string>3091</string>"));
  assert.ok(!p.plist.includes("FACE_PORT"));
});

test("servicePlan escapes XML in paths", () => {
  const p = servicePlan({ root: "/re&po", home: "/h/.dsh", homeDir: "/h", node: "/n", path: "", launchAgentsDir: "/l" });
  assert.ok(p.plist.includes("/re&amp;po/face"));
  const odd = servicePlan({ root: "/r<1>&", home: "/h<1>&", homeDir: "/u<1>&", node: "/n<1>&", path: "/p<1>&", launchAgentsDir: "/l", port: 1 });
  assert.doesNotMatch(odd.plist.replace(/<\/?[A-Za-z!?][^<>]*>/g, ""), /[<>]|&(?!amp;|lt;|gt;)/, "no bare <, > or & left between the tags");
  assert.equal(odd.args[2], "file:///r%3C1%3E&/face/node_modules/tsx/dist/loader.mjs", "the loader is a file URL: < and > percent-encoded");
  assert.ok(odd.plist.includes("<string>file:///r%3C1%3E&amp;/face/node_modules/tsx/dist/loader.mjs</string>"), "and its & XML-escaped in the plist");
  assert.equal(servicePlan({ root: "/my repo", home: "/h", homeDir: "/h", node: "/n", path: "", launchAgentsDir: "/l" }).args[2],
    "file:///my%20repo/face/node_modules/tsx/dist/loader.mjs", "a space in the checkout's path is percent-encoded");
});

test("filterPath drops empty and node_modules entries", () => {
  assert.equal(filterPath("/a::/x/node_modules/.bin:/b"), "/a:/b");
});

test("envLinesOf keeps NAME=VALUE lines verbatim, strips export, drops comments and blanks", () => {
  assert.deepEqual(envLinesOf('# keys\nexport DEEPSEEK_API_KEY="sk x"\n\nAPCA_API_KEY_ID=abc # trailing\nnot a line\n'), [
    { name: "DEEPSEEK_API_KEY", line: 'DEEPSEEK_API_KEY="sk x"' },
    { name: "APCA_API_KEY_ID", line: "APCA_API_KEY_ID=abc # trailing" },
  ]);
  assert.deepEqual(envLinesOf("DEEPSEEK_API_KEY=d\r\nAPCA_API_KEY_ID=k\r\n"), [
    { name: "DEEPSEEK_API_KEY", line: "DEEPSEEK_API_KEY=d" }, { name: "APCA_API_KEY_ID", line: "APCA_API_KEY_ID=k" },
  ], "a CRLF line end is a line end, not part of the value");
});

test("ensureHomeEnv writes .env mode 0600 from the sources once, then leaves it alone", async () => {
  const h = await home(); const src = await home();
  await writeFile(join(src, ".env.deepseek"), "export DEEPSEEK_API_KEY=d\n");
  await writeFile(join(src, ".env.alpaca"), "APCA_API_KEY_ID=k\nAPCA_API_SECRET_KEY=s\n");
  const first = ensureHomeEnv(join(h, ".dsh"), [join(src, ".env.deepseek"), join(src, ".env.alpaca"), join(src, ".env.ifind")]);
  assert.deepEqual(first, { path: join(h, ".dsh", ".env"), created: true, names: [...EXPECTED_KEYS], missing: [], missingSources: [join(src, ".env.ifind")], skipped: [] });
  assert.equal(((await stat(first.path)).mode & 0o777), 0o600);
  assert.equal(((await stat(join(h, ".dsh"))).mode & 0o777), 0o700, "the home it creates is the operator's alone");
  const text = await readFile(first.path, "utf8");
  assert.equal(text, "DEEPSEEK_API_KEY=d\nAPCA_API_KEY_ID=k\nAPCA_API_SECRET_KEY=s\n");
  const again = ensureHomeEnv(join(h, ".dsh"), [join(src, ".env.deepseek")]);
  assert.equal(again.created, false);
  assert.equal(await readFile(first.path, "utf8"), text, "never rewritten");
});

test("ensureHomeEnv reports the expected names an existing file lacks, and writes nothing without sources", async () => {
  const h = await home();
  await writeFile(join(h, ".env"), "DEEPSEEK_API_KEY=d\n");
  const r = ensureHomeEnv(h, ["/nowhere/.env.alpaca"]);
  assert.deepEqual(r.names, ["DEEPSEEK_API_KEY"]); assert.deepEqual(r.missing, ["APCA_API_KEY_ID", "APCA_API_SECRET_KEY"]);
  const empty = await home();
  const none = ensureHomeEnv(empty, ["/nowhere/.env.deepseek"]);
  assert.equal(none.created, false); assert.deepEqual(none.missing, [...EXPECTED_KEYS]);
  await assert.rejects(stat(join(empty, ".env")));
});

test("ensureHomeEnv copies only the allow-list, in source order, and names every name it skipped", async () => {
  const h = await home(); const src = await home();
  await writeFile(join(src, ".env.alpaca"), "PATH=/x\nNODE_OPTIONS=--x\nALPACA_KIT_ENABLE_ORDERS=1\nALPHA_DATA_FEED=iex\nDEEPSEEK_API_KEY=d\n");
  const r = ensureHomeEnv(h, [join(src, ".env.alpaca")]);
  assert.equal(r.created, true);
  assert.equal(await readFile(r.path, "utf8"), "ALPHA_DATA_FEED=iex\nDEEPSEEK_API_KEY=d\n");
  assert.deepEqual(r.skipped, ["PATH", "NODE_OPTIONS", "ALPACA_KIT_ENABLE_ORDERS"]);
  assert.deepEqual(r.names, ["ALPHA_DATA_FEED", "DEEPSEEK_API_KEY"]); assert.deepEqual(r.missing, ["APCA_API_KEY_ID", "APCA_API_SECRET_KEY"]);
  assert.deepEqual(ensureHomeEnv(h, [join(src, ".env.alpaca")]).skipped, [], "an existing .env: the sources are not read");
  assert.deepEqual(COPIED_KEYS, ["DEEPSEEK_API_KEY", "APCA_API_KEY_ID", "APCA_API_SECRET_KEY", "APCA_API_BASE_URL", "IFIND_ACCESS_TOKEN", "IFIND_REFRESH_TOKEN",
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_OPERATOR_ID"]);
});

test("ensureHomeEnv writes nothing when no name is on the allow-list, and names them all once", async () => {
  const h = await home(); const src = await home();
  await writeFile(join(src, ".env.a"), "PATH=/x\nDSH_HOME=/elsewhere\n");
  await writeFile(join(src, ".env.b"), "export PATH=/y\nALPACA_KIT_ENABLE_ORDERS=1\n");
  const r = ensureHomeEnv(join(h, ".dsh"), [join(src, ".env.a"), join(src, ".env.b")]);
  assert.deepEqual(r, { path: join(h, ".dsh", ".env"), created: false, names: [], missing: [...EXPECTED_KEYS], missingSources: [],
    skipped: ["PATH", "DSH_HOME", "ALPACA_KIT_ENABLE_ORDERS"] });
  await assert.rejects(stat(join(h, ".dsh")), "nothing written, not even the home");
});

test("ensureHomeEnv counts a name as dsh reads it: an empty value is missing, an indented line counts and is copied flush", async () => {
  const h = await home();
  await writeFile(join(h, ".env"), 'DEEPSEEK_API_KEY=\n  APCA_API_KEY_ID=k\nAPCA_API_SECRET_KEY=""\nALPHA_DATA_FEED = iex\n');
  const r = ensureHomeEnv(h, []);
  assert.deepEqual(r.names, ["APCA_API_KEY_ID", "ALPHA_DATA_FEED"], "file order first; a name only dsh's parser finds comes after");
  assert.deepEqual(r.missing, ["DEEPSEEK_API_KEY", "APCA_API_SECRET_KEY"]);
  const fresh = await home(); const src = await home();
  await writeFile(join(src, ".env.alpaca"), "  export APCA_API_KEY_ID=k\n\tAPCA_API_SECRET_KEY=s\n");
  const w = ensureHomeEnv(join(fresh, ".dsh"), [join(src, ".env.alpaca")]);
  assert.equal(await readFile(w.path, "utf8"), "APCA_API_KEY_ID=k\nAPCA_API_SECRET_KEY=s\n");
  assert.deepEqual(w.names, ["APCA_API_KEY_ID", "APCA_API_SECRET_KEY"]); assert.deepEqual(w.missing, ["DEEPSEEK_API_KEY"]);
});

test("ensureHomeEnv never writes through a dangling link at .env", async () => {
  const h = await home(); const src = await home();
  await writeFile(join(src, ".env.deepseek"), "DEEPSEEK_API_KEY=d\n");
  await symlink(join(h, "elsewhere"), join(h, ".env"));
  assert.throws(() => ensureHomeEnv(h, [join(src, ".env.deepseek")]), { code: "EEXIST" });
  await assert.rejects(stat(join(h, "elsewhere")), "the link's target was not created");
});

test("parseLaunchctlPrint and lastTokenUrl", () => {
  assert.deepEqual(parseLaunchctlPrint("gui/501/com.gravit.face = {\n\tstate = running\n\tpid = 4242\n}"), { state: "running", pid: 4242 });
  assert.deepEqual(parseLaunchctlPrint(""), {});
  assert.deepEqual(parseLaunchctlPrint("gui/501/com.gravit.face = {\n\tstate = not running\n}"), { state: "not running" }, "a stopped job's state is two words");
  const log = "x\ngravit-face: http://127.0.0.1:3090/?token=aaa (profile: face)\nagain\ngravit-face: http://127.0.0.1:3090/?token=bbb (profile: face)\n";
  assert.equal(lastTokenUrl(log), "http://127.0.0.1:3090/?token=bbb"); assert.equal(lastTokenUrl("nothing"), undefined);
});

test("formatStatus names a lost last run", () => {
  const status: DeskStatus = { ok: true, pid: 7, version: "v", bootedAt: "2026-10-19T15:00:00.000Z", uptimeMs: 90 * 60_000, desk: { enabled: true, dir: "/d" }, asleep: [],
    runs: [{ bootedAt: "2026-10-19T14:00:00.000Z", pid: 6, lost: true }, { bootedAt: "2026-10-19T15:00:00.000Z", pid: 7, lost: false }], turnsToday: noTurns };
  const text = formatStatus({ label: LABEL, info: { state: "running", pid: 7 }, installed: true, status, url: "http://127.0.0.1:3090/?token=t", port: 3090 });
  assert.match(text, /^com\.gravit\.face: running \(pid 7\)/);
  assert.match(text, /answering at http:\/\/127\.0\.0\.1:3090 · up 1h 30m since 2026-10-19T15:00:00\.000Z · desk on/);
  assert.match(text, /last run: lost \(killed or crashed; no shutdown event\)/);
  assert.match(text, /sign in: http:\/\/127\.0\.0\.1:3090\/\?token=t/);
  const unreadable: DeskStatus = { ok: true, pid: 7, version: "v", bootedAt: "2026-10-19T15:00:00.000Z", uptimeMs: 90 * 60_000, desk: { enabled: true, dir: "/d" }, asleep: [],
    runs: [], turnsToday: noTurns, ledgerError: "EACCES" };
  assert.match(formatStatus({ label: LABEL, info: { state: "running", pid: 7 }, installed: true, status: unreadable, url: undefined, port: 3090 }), /· desk on\nledger: unreadable \(EACCES\)\n/);
  const quiet: DeskStatus = { ok: true, pid: 9, version: "v", bootedAt: "2026-10-19T15:00:00.000Z", uptimeMs: 7_559_999, desk: { enabled: false, dir: "/d" },
    asleep: [{ from: "2026-10-19T15:10:00.000Z", to: "2026-10-19T15:20:00.000Z", gapMs: 600_000 }, { from: "2026-10-19T16:00:00.000Z", to: "2026-10-19T16:30:00.000Z", gapMs: 1_800_000 }],
    runs: [{ bootedAt: "2026-10-19T13:00:00.000Z", pid: 7, lost: true }, { bootedAt: "2026-10-19T14:00:00.000Z", pid: 8, endedAt: "2026-10-19T14:30:00.000Z", code: 0, lost: false },
      { bootedAt: "2026-10-19T15:00:00.000Z", pid: 9, lost: false }], turnsToday: noTurns };
  assert.equal(formatStatus({ label: LABEL, info: { state: "running", pid: 9 }, installed: true, status: quiet, url: undefined, port: 3091 }), [
    "com.gravit.face: running (pid 9)",
    "answering at http://127.0.0.1:3091 · up 2h 5m since 2026-10-19T15:00:00.000Z · desk off (FACE_DESK=0)",
    "asleep: 2 gap(s) since boot",
    "last run: ended 2026-10-19T14:30:00.000Z code 0",
    "sign in: no URL in the log yet (npm run service -- logs)",
  ].join("\n"));
  assert.equal(formatStatus({ label: LABEL, info: {}, installed: true, status: undefined, url: undefined, port: 3090 }),
    "com.gravit.face: state unknown\nnot answering on 3090\nsign in: no URL in the log yet (npm run service -- logs)");
  assert.match(formatStatus({ label: LABEL, info: { state: "not loaded" }, installed: true, status, url: undefined, port: 3090 }),
    /^com\.gravit\.face: not loaded\nanswering at /, "a face on the port is not credited to a job launchd lacks");
  assert.match(formatStatus({ label: LABEL, info: {}, installed: false, status: undefined, url: undefined, port: 3090 }), /not installed \(npm run service -- install\)/);
});

test("formatStatus prints the pause and telegram lines", () => {
  const base: DeskStatus = { ok: true, pid: 7, version: "v", bootedAt: "2026-10-20T13:00:00.000Z", uptimeMs: 90 * 60_000, desk: { enabled: true, dir: "/d" },
    asleep: [], runs: [], turnsToday: noTurns };
  const lines = (status: DeskStatus, now = Date.parse("2026-10-20T18:30:00Z")): string[] => // 14:30 ET
    formatStatus({ label: LABEL, info: { state: "running", pid: 7 }, installed: true, status, url: undefined, port: 3090, now }).split("\n");
  const head = ["com.gravit.face: running (pid 7)", "answering at http://127.0.0.1:3090 · up 1h 30m since 2026-10-20T13:00:00.000Z · desk on"];
  const tail = "sign in: no URL in the log yet (npm run service -- logs)";
  const polled = { configured: true, polling: true, lastPollAt: "2026-10-20T18:03:00.000Z", dropped: 2, queued: 1 };
  assert.deepEqual(lines({ ...base, off: { setAt: "2026-10-20T18:00:00.000Z", by: "telegram", until: "2026-10-20T20:00:00.000Z" }, telegram: polled }), [...head,
    "desk: paused since 14:00 ET by telegram until 16:00 ET (npm run desk -- resume)",
    "telegram: polling, last poll 14:03 ET, 2 dropped, 1 queued",
    tail]);
  assert.deepEqual(lines({ ...base, off: { setAt: "2026-12-01T19:00:00.000Z", by: "terminal" },
    telegram: { ...polled, lastPollAt: "2026-12-01T19:03:00.000Z", dropped: 0, queued: 0, conflictAt: "2026-12-01T19:05:00.000Z" } },
  Date.parse("2026-12-01T19:30:00Z")), [...head,
    "desk: paused since 14:00 ET by terminal (npm run desk -- resume)",
    "telegram: polling, last poll 14:03 ET, 0 dropped, 0 queued, conflict at 14:05 ET",
    tail], "no until, no clause; a conflict, its own; EST renders as ET as EDT does");
  assert.deepEqual(lines({ ...base, off: { setAt: "2026-10-19T18:00:00.000Z", by: "telegram", until: "2026-10-21T18:00:00.000Z" },
    telegram: { ...polled, conflictAt: "2026-10-20T03:59:00.000Z" } }), [...head,
    "desk: paused since 2026-10-19 14:00 ET by telegram until 2026-10-21 14:00 ET (npm run desk -- resume)",
    "telegram: polling, last poll 14:03 ET, 2 dropped, 1 queued, conflict at 2026-10-19 23:59 ET",
    tail], "a time on another New York date carries it - 03:59 UTC on the 20th is still the 19th in New York");
  assert.deepEqual(lines({ ...base, telegram: { configured: false, polling: false, dropped: 0, queued: 0 } }), [...head,
    "telegram: not configured (TELEGRAM_BOT_TOKEN and TELEGRAM_OPERATOR_ID in $DSH_HOME/.env)",
    tail]);
  assert.equal(lines({ ...base, telegram: { configured: true, polling: false, dropped: 0, queued: 3 } })[2],
    "telegram: not polling, no poll yet, 0 dropped, 3 queued", "a bridge that has not polled says so");
  assert.deepEqual(lines(base), [...head, tail], "neither line without its field");
  assert.deepEqual(lines({ ...base, off: { setAt: "2026-10-20T18:00:00.000Z", by: "page" }, ledgerError: "EACCES" }), [...head,
    "desk: paused since 14:00 ET by page (npm run desk -- resume)",
    "ledger: unreadable (EACCES)",
    tail], "right after the answering line, before the ledger's own");
});

test("formatStatus prints the desk's lines through deskStatusLines: the desk line after the port, then the rest", () => {
  const now = Date.parse("2026-10-20T18:30:00Z"); // 14:30 ET
  const status: DeskStatus = { ok: true, pid: 7, version: "v", bootedAt: "2026-10-20T13:00:00.000Z", uptimeMs: 90 * 60_000, desk: { enabled: true, dir: "/d" },
    asleep: [], runs: [], turnsToday: noTurns, off: { setAt: "2026-10-20T18:00:00.000Z", by: "terminal" },
    telegram: { configured: true, polling: true, lastPollAt: "2026-10-19T23:00:00.000Z", dropped: 0, queued: 0 } };
  const [desk, ...rest] = deskStatusLines(status, new Date(now));
  const lines = formatStatus({ label: LABEL, info: { state: "running", pid: 7 }, installed: true, status, url: undefined, port: 3090, now }).split("\n");
  assert.deepEqual(lines.slice(1, 2 + rest.length), [`answering at http://127.0.0.1:3090 · ${desk}`, ...rest]);
  assert.equal(lines[3], "telegram: polling, last poll 2026-10-19 19:00 ET, 0 dropped, 0 queued", "a last poll on another New York date carries it");
});

test("formatStatus prints the standing and budget lines after the telegram line", () => {
  const now = Date.parse("2026-11-27T16:00:00Z"); // 11:00 ET
  const used = { uncachedInputTokens: 34_567, outputTokens: 200_000, cacheReadTokens: 900_000, cacheWriteTokens: 100_000, total: 1_234_567 };
  const order = {
    id: "preclose", dir: "desk", file: "STANDING.md", at: "close-30m", producer: "builtin:brief", wake: true, enabled: true, expires: "2026-12-31", expired: false,
    hash: "ok" as const, nextAnchor: "2026-11-27T17:30:00.000Z",
    last: { key: "preclose:2026-11-26", order: "preclose", date: "2026-11-26", kind: "finished" as const, outcome: "delivered", t: "2026-11-26T20:31:40.000Z" },
  };
  const status: DeskStatus = {
    ok: true, pid: 7, version: "v", bootedAt: "2026-11-27T14:30:00.000Z", uptimeMs: 90 * 60_000, desk: { enabled: true, dir: "/d" }, asleep: [], runs: [],
    turnsToday: noTurns, telegram: { configured: true, polling: true, lastPollAt: "2026-11-27T15:59:00.000Z", dropped: 0, queued: 0 },
    budget: { dailyTokens: 2_000_000, used, spent: false },
    standing: {
      file: { path: "/d/standing.yml", state: "loaded" }, calendar: { clock: "fake clock", state: "failed", error: "exit 1" },
      orders: [order, { ...order, id: "weekly", dir: "strategies/alpha", file: "WEEKLY.md", hash: "changed", last: undefined }], queued: [], recent: [],
    },
  };
  const lines = (s: DeskStatus): string[] =>
    formatStatus({ label: LABEL, info: { state: "running", pid: 7 }, installed: true, status: s, url: undefined, port: 3090, now }).split("\n");
  assert.deepEqual(lines(status), [
    "com.gravit.face: running (pid 7)",
    "answering at http://127.0.0.1:3090 · up 1h 30m since 2026-11-27T14:30:00.000Z · desk on",
    "telegram: polling, last poll 10:59 ET, 0 dropped, 0 queued",
    "budget: 1,234,567 of 2,000,000 tokens today",
    "standing orders: no calendar today, fake clock: exit 1",
    "standing preclose: close-30m, next 12:30 ET; last delivered 2026-11-26 15:31 ET",
    "standing weekly: strategies/alpha/WEEKLY.md changed since arming (npm run desk -- rearm weekly)",
    "sign in: no URL in the log yet (npm run service -- logs)",
  ]);
  assert.deepEqual(lines({ ...status, ledgerError: "EACCES", budget: { dailyTokens: 2_000_000, used: { ...used, total: 0 }, spent: false, error: "EACCES" } }).slice(3, -1), [
    "budget: 0 of 2,000,000 tokens today (ledger unreadable: EACCES)",
    "standing orders: no calendar today, fake clock: exit 1",
    "standing preclose: close-30m, next 12:30 ET; last delivered 2026-11-26 15:31 ET",
    "standing weekly: strategies/alpha/WEEKLY.md changed since arming (npm run desk -- rearm weekly)",
    "ledger: unreadable (EACCES)",
  ], "the ledger's own line after them");
});

test("formatStatus prints the watch lines after the standing and budget lines", () => {
  const now = Date.parse("2026-11-30T15:30:00Z"); // 10:30 ET
  const today = { sent: 2, suppressed: { cooldown: 1, cap: 0, muted: 0, off: 0, window: 0 }, repeats: 0 };
  const status: DeskStatus = {
    ok: true, pid: 7, version: "v", bootedAt: "2026-11-30T14:00:00.000Z", uptimeMs: 90 * 60_000, desk: { enabled: true, dir: "/d" }, asleep: [], runs: [],
    turnsToday: noTurns, budget: { used: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, total: 0 }, spent: false },
    standing: { file: { path: "/d/standing.yml", state: "loaded" }, calendar: { clock: "fake clock", state: "ok" }, orders: [], queued: [], recent: [] },
    watch: {
      state: "watching",
      markets: {
        us: { state: "polling", session: { date: "2026-11-30", open: "2026-11-30T14:30:00.000Z", close: "2026-11-30T21:00:00.000Z" }, watched: 3, notWatched: [], lastPollAt: "2026-11-30T15:29:00.000Z", today },
        cn: { state: "off", watched: 0, notWatched: [], today: { ...today, sent: 0, suppressed: { ...today.suppressed, cooldown: 0 } } },
      },
      files: [], near: [], marks: [], pending: 0, recent: [], filings: { state: "off", symbols: 0, aShares: 0, seeded: 0 },
    },
  };
  const lines = formatStatus({ label: LABEL, info: { state: "running", pid: 7 }, installed: true, status, url: undefined, port: 3090, now }).split("\n");
  assert.deepEqual(lines.slice(2, -1), [
    "budget: 0 tokens today, cap not set (budget.dailyTokens in standing.yml)",
    "standing orders: none armed (npm run desk -- arm)",
    "watch: watching",
    "watch US: polling the 2026-11-30 session, 3 symbols, last poll 10:29 ET",
    "alerts today (US): 2 sent, 1 suppressed (cooldown 1)",
    "filings: off",
  ]);
});

const fakeFetch = (status: number, body?: unknown): typeof fetch =>
  (async () => new Response(body === undefined ? null : JSON.stringify(body), { status })) as unknown as typeof fetch;
const refusing: typeof fetch = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;

test("portAnswers: any HTTP answer is yes, a refused connection is no", async () => {
  assert.equal(await portAnswers(3090, fakeFetch(404)), true);
  assert.equal(await portAnswers(3090, refusing), false);
});

test("fetchStatus: only a 200 with ok:true counts", async () => {
  assert.equal(await fetchStatus(3090, fakeFetch(404)), undefined);
  assert.equal(await fetchStatus(3090, fakeFetch(200, { ok: false })), undefined);
  assert.equal((await fetchStatus(3090, fakeFetch(200, { ok: true, pid: 1 })))?.pid, 1);
});

test("install refuses while the port answers", () => {
  assert.match(installPlan({ port: 3090, answers: true }).refuse ?? "", /something already answers on 127\.0\.0\.1:3090 - stop it/);
  assert.equal(installPlan({ port: 3090, answers: false }).refuse, undefined);
});

test("the CLI's status against an empty temp home says not installed", async () => {
  const h = await home();
  const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "service.ts");
  const out = await new Promise<string>((resolve, reject) => execFile(process.execPath, [join(dirname(script), "..", "node_modules", "tsx", "dist", "cli.mjs"), script, "status", "--port", "1"],
    { env: { ...process.env, HOME: h, DSH_HOME: join(h, ".dsh") }, encoding: "utf8" }, (err, stdout) => (err ? reject(err) : resolve(stdout))));
  assert.match(out, /com\.gravit\.face: not installed \(npm run service -- install\)/);
});

/* The commands, driven through runService against a fake launchctl: no test touches the operator's launchd. */

const JOB = `gui/501/${LABEL}`;
const older = (): Response => new Response(null, { status: 404 });

/** What `launchctl print` answers for a job launchd has. */
const loaded = (state: string, pid?: number) =>
  ({ ok: true, out: `${JOB} = {\n\tstate = ${state}\n${pid === undefined ? "" : `\tpid = ${pid}\n`}}\n` });

/** What launchctl answers for a bootout whose job is still stopping. */
const IN_PROGRESS = { ok: false, out: "Boot-out failed: 36: Operation now in progress" };

/** A job launchd holds - `print` says so - until a bootout, and then not; the bootout itself answers
 * `bootout` (default: success). */
const untilBootout = (state: string, pid?: number, bootout?: { ok: boolean; out: string }) =>
  (args: string[], calls: string[][]) =>
    args[0] === "bootout" ? bootout : args[0] === "print" && !calls.some((c) => c[0] === "bootout") ? loaded(state, pid) : undefined;

interface Rig { deps: ServiceDeps; calls: string[][]; urls: string[]; sleeps: number[]; plist: string; text(): string; reset(): void }

/** A fake launchctl: given a call and the calls so far (this one included), its answer, or `undefined` for the rig's default. */
type Launchctl = (args: string[], calls: string[][]) => { ok: boolean; out: string } | undefined;

/**
 * A ServiceDeps over fresh temp dirs (homeDir, home = homeDir/.dsh, root) that records every launchctl call,
 * every URL fetched, every sleep and every line printed; `reset` forgets them. `launchctl` answers a call,
 * given the calls so far (this one included), when it returns something; otherwise `print` fails (launchd
 * has no job) and every other call succeeds. `answer` is the port's answer given the calls so far;
 * `undefined` (the default) is a refused connection. The home has the `profiles/face` install requires
 * unless `profile` is false.
 */
async function rig(o: {
  launchctl?: Launchctl;
  answer?: (calls: string[][]) => Response | undefined;
  platform?: NodeJS.Platform;
  profile?: boolean;
} = {}): Promise<Rig> {
  const homeDir = await home(); const root = await home();
  if (o.profile !== false) await mkdir(join(homeDir, ".dsh", "profiles", "face"), { recursive: true });
  const calls: string[][] = []; const urls: string[] = []; const sleeps: number[] = []; const lines: string[] = [];
  const deps: ServiceDeps = {
    launchctl: (args) => { calls.push(args); return o.launchctl?.(args, calls) ?? { ok: args[0] !== "print", out: "" }; },
    fetch: (async (input: string | URL | Request) => {
      urls.push(String(input));
      const res = o.answer?.(calls);
      if (res === undefined) throw new TypeError("fetch failed");
      return res;
    }) as typeof fetch,
    homeDir, home: join(homeDir, ".dsh"), root, uid: 501, platform: o.platform ?? "darwin",
    nodePath: "/usr/local/bin/node", envPath: "/usr/local/bin:/usr/bin",
    out: (line) => { lines.push(line); }, sleep: async (ms) => { sleeps.push(ms); },
  };
  const reset = (): void => { for (const list of [calls, urls, sleeps, lines]) list.length = 0; };
  return { deps, calls, urls, sleeps, plist: join(homeDir, "Library", "LaunchAgents", `${LABEL}.plist`), text: () => lines.join("\n"), reset };
}

/** The plist install would write for this rig, put in place - on `dshHome`, the rig's home unless given. */
async function putPlist(r: Rig, port?: number, dshHome = r.deps.home): Promise<void> {
  const p = servicePlan({ root: r.deps.root, home: dshHome, homeDir: r.deps.homeDir, node: r.deps.nodePath, path: r.deps.envPath, launchAgentsDir: dirname(r.plist), port });
  await mkdir(dirname(r.plist), { recursive: true });
  await writeFile(r.plist, p.plist);
}

/** Put the desk ledger's lines under a harness home. */
async function putLedger(dshHome: string, lines: object[]): Promise<void> {
  await mkdir(join(dshHome, "face", "desk"), { recursive: true });
  await writeFile(join(dshHome, "face", "desk", "events.jsonl"), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
}

/** Put the service's stdout log under a harness home. */
async function putLog(dshHome: string, text: string): Promise<void> {
  await mkdir(join(dshHome, "face", "service"), { recursive: true });
  await writeFile(join(dshHome, "face", "service", "face.log"), text);
}

/** A ledger `boot` at 15:00 UTC. */
const boot = (pid: number) => ({ t: "2026-10-19T15:00:00.000Z", kind: "boot", pid, version: "v", deskEnabled: true });

const deskStatusOf = (pid: number): DeskStatus => ({ ok: true, pid, version: "v", bootedAt: "2026-10-19T15:00:00.000Z", uptimeMs: 60_000,
  desk: { enabled: true, dir: "/d" }, asleep: [], runs: [{ bootedAt: "2026-10-19T15:00:00.000Z", pid, lost: false }], turnsToday: noTurns });

/** The route's answer, every time it is asked, from a face of pid `pid`. */
const answeredBy = (pid: number) => (): Response => new Response(JSON.stringify(deskStatusOf(pid)), { status: 200 });

/** What `url` adds to the log's URL while the face does not answer. */
const NOT_YET = " (the face is not answering yet; this may be the previous run's URL)";

/** install's line for a checkout inside a folder macOS guards per app. */
const privacyLine = (folder: string, errLog: string): string => `privacy: the checkout is in ${folder}, which macOS guards per app - `
  + "on the first start macOS may ask whether node may access it: allow it, or grant node access under System Settings → Privacy & Security → "
  + `Files and Folders; otherwise the service exits with EPERM, which shows in ${errLog}`;

/** A running job (pid 42) that launchd still holds at the first ask after the bootout and lets go of at
 * the next, the bootout answering `Operation now in progress`; and its port, which answers until the
 * bootout and twice after it. */
function lettingGo(): { launchctl: Launchctl; answer: (calls: string[][]) => Response | undefined } {
  let afterBootout = 0;
  return {
    launchctl: (args, calls) => {
      if (args[0] === "bootout") return IN_PROGRESS;
      if (args[0] !== "print") return undefined;
      const at = calls.findIndex((c) => c[0] === "bootout");
      return at < 0 || calls.slice(at + 1).filter((c) => c[0] === "print").length <= 1 ? loaded("running", 42) : undefined;
    },
    answer: (calls) => (!calls.some((c) => c[0] === "bootout") || afterBootout++ < 2 ? older() : undefined),
  };
}

test("install with no job and the port answering refuses: no plist, no bootstrap", async () => {
  const r = await rig({ answer: older });
  assert.equal(await runService("install", [], r.deps), 1);
  assert.match(r.text(), /something already answers on 127\.0\.0\.1:3090 - stop it \(a terminal npm start\?\)/);
  assert.deepEqual(r.calls, [["print", JOB]], "asked launchd once, changed nothing");
  assert.deepEqual(r.sleeps, [], "no job of its own to wait for");
  await assert.rejects(stat(r.plist), "no plist written");
});

test("install replaces a running job: a bootout still in progress, launchd let go of, the port fallen silent, then the plist, enable and bootstrap", async () => {
  const r = await rig(lettingGo());
  await writeFile(join(r.deps.root, ".env.deepseek"), "DEEPSEEK_API_KEY=d\n");
  assert.equal(await runService("install", [], r.deps), 0, "bootout's exit code is not the outcome: launchd let go of the job");
  assert.deepEqual(r.calls, [["print", JOB], ["bootout", JOB], ["print", JOB], ["print", JOB], ["enable", JOB], ["bootstrap", "gui/501", r.plist]]);
  assert.deepEqual(r.sleeps, [500, 500, 500], "one poll until launchd let go of the job, two until its face let go of the port");
  assert.ok(r.urls.every((u) => u === "http://127.0.0.1:3090/data/desk/status"));
  const written = await readFile(r.plist, "utf8");
  assert.equal(written, servicePlan({ root: r.deps.root, home: r.deps.home, homeDir: r.deps.homeDir, node: "/usr/local/bin/node", path: "/usr/local/bin:/usr/bin", launchAgentsDir: dirname(r.plist) }).plist);
  assert.equal((await stat(r.plist)).mode & 0o777, 0o644);
  assert.equal((await stat(join(r.deps.home, "face", "service"))).mode & 0o777, 0o700, "the logs directory is the operator's alone");
  assert.deepEqual(r.text().split("\n").slice(-6), [`installed: ${r.plist}`, `runs: ${join(r.deps.root, "face", "src", "main.ts")}`,
    `home: ${r.deps.home}`, "node: /usr/local/bin/node", `log: ${join(r.deps.home, "face", "service", "face.log")}`, "next: npm run service -- url"],
  "what it runs, on which home, with which node; no privacy line for a checkout outside ~/Desktop, ~/Documents and ~/Downloads");
  assert.ok(!r.text().includes("moving"), "no plist named another home");
});

test("install refuses a home with no profiles/face before any launchctl call or file", async () => {
  const r = await rig({ profile: false });
  await writeFile(join(r.deps.root, ".env.deepseek"), "DEEPSEEK_API_KEY=d\n");
  const profile = join(r.deps.home, "profiles", "face");
  assert.equal(await runService("install", [], r.deps), 1);
  assert.equal(r.text(), `no profile at ${profile}: run "cd face && npm run setup" with DSH_HOME=${r.deps.home} first`);
  assert.deepEqual([r.calls, r.urls], [[], []], "neither launchd nor the port asked");
  await assert.rejects(stat(r.plist), "no plist");
  await assert.rejects(stat(join(r.deps.home, ".env")), "no .env, though a key file holds a name it would copy");
  await mkdir(dirname(profile), { recursive: true });
  await writeFile(profile, "");
  r.reset();
  assert.equal(await runService("install", [], r.deps), 1, "a file where the profile's directory belongs is no profile");
  assert.match(r.text(), /^no profile at /);
  assert.deepEqual(r.calls, []);
});

test("install names a move of the service's home from the one the installed plist names", async () => {
  const r = await rig();
  const old = join(await home(), ".dsh");
  await putPlist(r, undefined, old);
  assert.equal(await runService("install", [], r.deps), 0);
  assert.equal(r.text().split("\n")[0], `moving the service's home from ${old} to ${r.deps.home}`);
  assert.ok((await readFile(r.plist, "utf8")).includes(`<key>DSH_HOME</key><string>${r.deps.home}</string>`));
  r.reset();
  assert.equal(await runService("install", [], r.deps), 0);
  assert.ok(!r.text().includes("moving"), "a reinstall on the installed home moves nothing");
  const refused = await rig({ profile: false });
  await putPlist(refused, undefined, old);
  assert.equal(await runService("install", [], refused.deps), 1);
  assert.deepEqual(refused.text().split("\n"), [`moving the service's home from ${old} to ${refused.deps.home}`,
    `no profile at ${join(refused.deps.home, "profiles", "face")}: run "cd face && npm run setup" with DSH_HOME=${refused.deps.home} first`],
  "the move is said first: it is why the new home is the one checked");
  assert.ok((await readFile(refused.plist, "utf8")).includes(`<string>${old}</string>`), "a refused install leaves the installed plist alone");
});

test("install warns before next: that macOS may ask about node for a checkout in ~/Desktop, ~/Documents or ~/Downloads", async () => {
  for (const folder of ["Desktop", "Documents", "Downloads"]) {
    const r = await rig();
    const root = join(r.deps.homeDir, folder, "self-evolve", "evolving-alpha-us");
    await mkdir(root, { recursive: true });
    Object.assign(r.deps, { root });
    assert.equal(await runService("install", [], r.deps), 0, folder);
    assert.deepEqual(r.text().split("\n").slice(-2), [privacyLine(join(r.deps.homeDir, folder), join(r.deps.home, "face", "service", "face.err.log")),
      "next: npm run service -- url"], folder);
  }
  for (const beside of ["Desktop2", join("Library", "Desktop")]) {
    const r = await rig();
    Object.assign(r.deps, { root: join(r.deps.homeDir, beside, "evolving-alpha-us") });
    assert.equal(await runService("install", [], r.deps), 0, beside);
    assert.ok(!r.text().includes("privacy:"), `${beside} is not a folder macOS guards`);
  }
});

test("install refuses when the port still answers 10 s after the bootout", async () => {
  const r = await rig({ launchctl: untilBootout("running", 42), answer: older });
  assert.equal(await runService("install", [], r.deps), 1);
  assert.equal(r.sleeps.length, 20); assert.ok(r.sleeps.every((ms) => ms === 500));
  assert.match(r.text(), /something already answers on 127\.0\.0\.1:3090/);
  assert.deepEqual(r.calls, [["print", JOB], ["bootout", JOB], ["print", JOB]]);
  await assert.rejects(stat(r.plist));
});

test("install fails when launchd still holds the job 10 s after the bootout", async () => {
  const r = await rig({ launchctl: (args) => (args[0] === "print" ? loaded("running", 42) : args[0] === "bootout" ? IN_PROGRESS : undefined), answer: older });
  assert.equal(await runService("install", [], r.deps), 1);
  assert.match(r.text(), /\nlaunchctl bootout gui\/501\/com\.gravit\.face failed: Boot-out failed: 36: Operation now in progress$/);
  assert.equal(r.sleeps.length, 20); assert.ok(r.sleeps.every((ms) => ms === 500));
  assert.deepEqual(r.calls, [["print", JOB], ["bootout", JOB], ...Array.from({ length: 21 }, () => ["print", JOB])], "asked at once, then every 500 ms");
  assert.deepEqual(r.urls, [], "the port is not asked about a job launchd still holds");
  await assert.rejects(stat(r.plist));
});

test("install names the keys the home .env lacks, the names it did not copy and the sources it did not find", async () => {
  const r = await rig();
  await writeFile(join(r.deps.root, ".env.alpaca"), "PATH=/x\nAPCA_API_KEY_ID=k\nAPCA_API_SECRET_KEY=s\n");
  assert.equal(await runService("install", [], r.deps), 0);
  const env = join(r.deps.home, ".env");
  const lines = r.text().split("\n");
  for (const line of [`wrote ${env} with: APCA_API_KEY_ID, APCA_API_SECRET_KEY`,
    `not in ${env}: DEEPSEEK_API_KEY (the face also reads DEEPSEEK_API_KEY from dsh's credential store)`,
    `not copied (not on the service's allow-list; add them to ${env} by hand if the service needs them): PATH`,
    `no source: ${join(r.deps.root, ".env.deepseek")}, ${join(r.deps.root, ".env.ifind")}, ${join(r.deps.root, ".env.telegram")}`]) assert.ok(lines.includes(line), line);
  assert.equal(await readFile(env, "utf8"), "APCA_API_KEY_ID=k\nAPCA_API_SECRET_KEY=s\n");
  const again = await rig();
  Object.assign(again.deps, { home: r.deps.home, root: r.deps.root });
  assert.equal(await runService("install", [], again.deps), 0);
  assert.ok(again.text().split("\n").includes(`kept ${env}`), "a second install keeps the file");
  assert.ok(!again.text().includes("not copied"), "an existing .env: the sources are not read");
});

test("install copies the Telegram bridge's two names from .env.telegram, after the other key files; the plist carries neither", async () => {
  const r = await rig();
  await writeFile(join(r.deps.root, ".env.deepseek"), "DEEPSEEK_API_KEY=d\n");
  await writeFile(join(r.deps.root, ".env.telegram"), "TELEGRAM_BOT_TOKEN=424242:fake\nTELEGRAM_OPERATOR_ID=42\nTELEGRAM_OTHER=x\n");
  assert.equal(await runService("install", [], r.deps), 0);
  const env = join(r.deps.home, ".env");
  assert.equal(await readFile(env, "utf8"), "DEEPSEEK_API_KEY=d\nTELEGRAM_BOT_TOKEN=424242:fake\nTELEGRAM_OPERATOR_ID=42\n");
  const lines = r.text().split("\n");
  assert.ok(lines.includes(`wrote ${env} with: DEEPSEEK_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_OPERATOR_ID`));
  assert.ok(lines.includes(`not copied (not on the service's allow-list; add them to ${env} by hand if the service needs them): TELEGRAM_OTHER`));
  assert.doesNotMatch(await readFile(r.plist, "utf8"), /TELEGRAM/, "no key reaches the plist");
});

test("install with nothing to copy writes no .env and says so; a .env it cannot write stops it before launchd", async () => {
  const r = await rig();
  assert.equal(await runService("install", [], r.deps), 0);
  const env = join(r.deps.home, ".env");
  assert.ok(r.text().split("\n").includes(`wrote no ${env}: no source holds a name on the service's allow-list`));
  assert.ok(r.text().split("\n").includes(`not in ${env}: DEEPSEEK_API_KEY, APCA_API_KEY_ID, APCA_API_SECRET_KEY (the face also reads DEEPSEEK_API_KEY from dsh's credential store)`));
  await assert.rejects(stat(env));
  const dangling = await rig();
  await mkdir(dangling.deps.home, { recursive: true });
  await writeFile(join(dangling.deps.root, ".env.deepseek"), "DEEPSEEK_API_KEY=d\n");
  await symlink(join(dangling.deps.home, "elsewhere"), join(dangling.deps.home, ".env"));
  assert.equal(await runService("install", [], dangling.deps), 1);
  assert.equal(dangling.text(), `cannot write ${join(dangling.deps.home, ".env")}: EEXIST`);
  assert.deepEqual(dangling.calls, []);
});

test("install stops at a failed enable or bootstrap and prints what launchctl said", async () => {
  const r = await rig({ launchctl: (args) => (args[0] === "bootstrap" ? { ok: false, out: "Bootstrap failed: 5: Input/output error" } : undefined) });
  assert.equal(await runService("install", [], r.deps), 1);
  assert.match(r.text(), /launchctl bootstrap gui\/501 .*com\.gravit\.face\.plist failed: Bootstrap failed: 5: Input\/output error$/);
  assert.deepEqual(r.calls.map((c) => c[0]), ["print", "enable", "bootstrap"], "enable first: it clears a disable that would refuse the bootstrap");
  assert.ok(!r.text().includes("installed:"));
  const off = await rig({ launchctl: (args) => (args[0] === "enable" ? { ok: false, out: "Could not enable service" } : undefined) });
  assert.equal(await runService("install", [], off.deps), 1);
  assert.match(off.text(), /\nlaunchctl enable gui\/501\/com\.gravit\.face failed: Could not enable service$/);
  assert.deepEqual(off.calls.map((c) => c[0]), ["print", "enable"], "no bootstrap after a failed enable");
});

test("start: a running job is left alone; a loaded one kickstarted; one launchd lacks enabled and bootstrapped; a held port refused", async () => {
  const running = await rig({ launchctl: (args) => (args[0] === "print" ? loaded("running", 42) : undefined), answer: older });
  await putPlist(running);
  assert.equal(await runService("start", [], running.deps), 0);
  assert.equal(running.text(), "already running (pid 42)");
  assert.deepEqual(running.calls, [["print", JOB]], "no kickstart");

  const stopped = await rig({ launchctl: (args) => (args[0] === "print" ? loaded("not running") : undefined) });
  await putPlist(stopped);
  assert.equal(await runService("start", [], stopped.deps), 0);
  assert.deepEqual(stopped.calls, [["print", JOB], ["kickstart", JOB]]);

  const unloaded = await rig();
  await putPlist(unloaded);
  assert.equal(await runService("start", [], unloaded.deps), 0);
  assert.deepEqual(unloaded.calls, [["print", JOB], ["enable", JOB], ["bootstrap", "gui/501", unloaded.plist]]);

  const held = await rig({ answer: older });
  await putPlist(held);
  assert.equal(await runService("start", [], held.deps), 1);
  assert.match(held.text(), /something already answers on 127\.0\.0\.1:3090 - stop it/);
  assert.deepEqual(held.calls, [["print", JOB]], "refused before launchd was asked to do anything");

  const absent = await rig();
  assert.equal(await runService("start", [], absent.deps), 1);
  assert.equal(absent.text(), "com.gravit.face: not installed (npm run service -- install)");
  assert.deepEqual(absent.calls, []);
});

test("stop boots the job out and waits for launchd to let go of it, whatever bootout returned; the plist stays", async () => {
  const r = await rig({ launchctl: untilBootout("running", 42) });
  await putPlist(r);
  assert.equal(await runService("stop", [], r.deps), 0);
  assert.deepEqual(r.calls, [["print", JOB], ["bootout", JOB], ["print", JOB]], "one bootout; launchd asked before it and after it");
  assert.equal(r.text(), "stopped: launchd no longer runs it; the plist stays, so the next login or npm run service -- start brings it back");
  await stat(r.plist);

  const slow = await rig({ launchctl: untilBootout("running", 42, IN_PROGRESS) });
  await putPlist(slow);
  assert.equal(await runService("stop", [], slow.deps), 0, "a bootout still in progress is no failure once launchd lets go");
  assert.equal(slow.text(), "stopped: launchd no longer runs it; the plist stays, so the next login or npm run service -- start brings it back");

  const stuck = await rig({ launchctl: (args) => (args[0] === "print" ? loaded("running", 42) : args[0] === "bootout" ? IN_PROGRESS : undefined) });
  await putPlist(stuck);
  assert.equal(await runService("stop", [], stuck.deps), 1, "a job launchd still holds after 10 s is a failure");
  assert.equal(stuck.text(), "launchctl bootout gui/501/com.gravit.face failed: Boot-out failed: 36: Operation now in progress");
  assert.equal(stuck.sleeps.length, 20); assert.ok(stuck.sleeps.every((ms) => ms === 500));
  assert.equal(stuck.calls.filter((c) => c[0] === "bootout").length, 1, "booted out once, then only asked");

  const idle = await rig();
  assert.equal(await runService("stop", [], idle.deps), 0, "nothing to stop is not a failure");
  assert.equal(idle.text(), "not loaded: launchd has no job gui/501/com.gravit.face, so there was nothing to stop");
  assert.deepEqual(idle.calls, [["print", JOB]], "no bootout for a job launchd lacks");
});

test("restart stops a running job as stop does - bootout, launchd let go of, its port fallen silent - then takes start's path: enable, bootstrap", async () => {
  const r = await rig(lettingGo());
  await putPlist(r);
  assert.equal(await runService("restart", [], r.deps), 0, "bootout's exit code is not the outcome: launchd let go of the job");
  assert.deepEqual(r.calls, [["print", JOB], ["bootout", JOB], ["print", JOB], ["print", JOB], ["enable", JOB], ["bootstrap", "gui/501", r.plist]],
    "never kickstart -k, whose kill signal launchd does not document; its own port before the bootout is no refusal");
  assert.deepEqual(r.sleeps, [500, 500, 500], "one poll until launchd let go of the job, two until its face let go of the port");
  assert.equal(r.text(), [`stopping the running job to start it again: launchctl bootout ${JOB}`,
    `started: launchd loaded ${r.plist} and runs it (next: npm run service -- url)`].join("\n"));
});

test("restart fails as stop does when launchd never lets go of the job: no enable, no bootstrap; nor into a port still held", async () => {
  const stuck = await rig({ launchctl: (args) => (args[0] === "print" ? loaded("running", 42) : args[0] === "bootout" ? IN_PROGRESS : undefined), answer: older });
  await putPlist(stuck);
  assert.equal(await runService("restart", [], stuck.deps), 1);
  assert.equal(stuck.text(), [`stopping the running job to start it again: launchctl bootout ${JOB}`,
    `launchctl bootout ${JOB} failed: Boot-out failed: 36: Operation now in progress`].join("\n"));
  assert.deepEqual(stuck.calls, [["print", JOB], ["bootout", JOB], ...Array.from({ length: 21 }, () => ["print", JOB])], "asked at once, then every 500 ms; nothing bootstrapped");
  assert.equal(stuck.sleeps.length, 20);
  assert.deepEqual(stuck.urls, [], "the port is not asked about a job launchd still holds");

  const held = await rig({ launchctl: untilBootout("running", 42), answer: older });
  await putPlist(held);
  assert.equal(await runService("restart", [], held.deps), 1);
  assert.match(held.text(), /\nsomething already answers on 127\.0\.0\.1:3090 - stop it \(a terminal npm start\?\)/);
  assert.deepEqual(held.calls, [["print", JOB], ["bootout", JOB], ["print", JOB]], "stopped, but not bootstrapped into a port still held after 10 s");
  assert.equal(held.sleeps.length, 20);

  const orphan = await rig({ launchctl: (args) => (args[0] === "print" ? loaded("running", 42) : undefined) });
  assert.equal(await runService("restart", [], orphan.deps), 1);
  assert.equal(orphan.text(), "com.gravit.face: not installed (npm run service -- install)");
  assert.deepEqual(orphan.calls, [["print", JOB]], "with no plist, nothing could bring back a job booted out: it is left running");
});

test("restart: every state but running takes start's path, a port another process holds refused", async () => {
  const stoppedHeld = await rig({ launchctl: (args) => (args[0] === "print" ? loaded("not running") : undefined), answer: older });
  await putPlist(stoppedHeld);
  assert.equal(await runService("restart", [], stoppedHeld.deps), 1);
  assert.match(stoppedHeld.text(), /something already answers on 127\.0\.0\.1:3090 - stop it \(a terminal npm start\?\)/);
  assert.deepEqual(stoppedHeld.calls, [["print", JOB]], "no kickstart into a port another process holds");

  const stopped = await rig({ launchctl: (args) => (args[0] === "print" ? loaded("not running") : undefined) });
  await putPlist(stopped);
  assert.equal(await runService("restart", [], stopped.deps), 0);
  assert.deepEqual(stopped.calls, [["print", JOB], ["kickstart", JOB]]);

  const unloadedHeld = await rig({ answer: older });
  await putPlist(unloadedHeld);
  assert.equal(await runService("restart", [], unloadedHeld.deps), 1);
  assert.match(unloadedHeld.text(), /something already answers on 127\.0\.0\.1:3090/);
  assert.deepEqual(unloadedHeld.calls, [["print", JOB]]);

  const unloaded = await rig();
  await putPlist(unloaded);
  assert.equal(await runService("restart", [], unloaded.deps), 0);
  assert.deepEqual(unloaded.calls, [["print", JOB], ["enable", JOB], ["bootstrap", "gui/501", unloaded.plist]]);

  const absent = await rig();
  assert.equal(await runService("restart", [], absent.deps), 1);
  assert.equal(absent.text(), "com.gravit.face: not installed (npm run service -- install)");
  assert.ok(!absent.calls.some((c) => c[0] !== "print"), "nothing changed in launchd");
});

test("uninstall boots a loaded job out and removes the plist; the ledger and the home .env stay", async () => {
  const r = await rig({ launchctl: untilBootout("running", 42, IN_PROGRESS) });
  await putPlist(r);
  await putLedger(r.deps.home, [boot(77)]);
  await writeFile(join(r.deps.home, ".env"), "DEEPSEEK_API_KEY=d\n");
  const untouched = `the ledger (${join(r.deps.home, "face", "desk")}) and ${join(r.deps.home, ".env")} are untouched`;
  assert.equal(await runService("uninstall", [], r.deps), 0, "a bootout still in progress is no failure once launchd lets go");
  assert.deepEqual(r.calls, [["print", JOB], ["bootout", JOB], ["print", JOB]]);
  assert.equal(r.text(), `uninstalled: launchd no longer runs it and ${r.plist} is removed; ${untouched}`);
  await assert.rejects(stat(r.plist), "the plist is gone");
  await stat(join(r.deps.home, "face", "desk", "events.jsonl")); await stat(join(r.deps.home, ".env"));

  const idle = await rig();
  await putPlist(idle);
  assert.equal(await runService("uninstall", [], idle.deps), 0);
  assert.deepEqual(idle.calls, [["print", JOB]], "no bootout for a job launchd lacks");
  await assert.rejects(stat(idle.plist));

  const stuck = await rig({ launchctl: (args) => (args[0] === "print" ? loaded("running", 42) : args[0] === "bootout" ? IN_PROGRESS : undefined) });
  await putPlist(stuck);
  assert.equal(await runService("uninstall", [], stuck.deps), 1, "launchd still holding the job is no success");
  assert.equal(stuck.text(), "launchd still holds the job (Boot-out failed: 36: Operation now in progress); the plist is removed, so it will not start at the next login; "
    + `the ledger (${join(stuck.deps.home, "face", "desk")}) and ${join(stuck.deps.home, ".env")} are untouched`);
  assert.equal(stuck.sleeps.length, 20);
  await assert.rejects(stat(stuck.plist), "the plist goes even so");

  const none = await rig();
  assert.equal(await runService("uninstall", [], none.deps), 0);
  assert.equal(none.text(), `not installed: no ${none.plist}, and launchd has no job ${JOB}`);
  assert.deepEqual(none.calls, [["print", JOB]]);
});

test("status: a plist launchd has no job for is not loaded; with the face silent, one ledger line says how its last run ended", async () => {
  const r = await rig();
  await putPlist(r);
  await putLedger(r.deps.home, [boot(77)]);
  assert.equal(await runService("status", [], r.deps), 0);
  assert.equal(r.text(), [
    "com.gravit.face: not loaded",
    "not answering on 3090",
    "sign in: no URL in the log yet (npm run service -- logs)",
    "ledger: last boot 2026-10-19T15:00:00.000Z (pid 77) - no shutdown event",
  ].join("\n"));
  assert.deepEqual(r.calls, [["print", JOB]]);
});

test("status's ledger line: a clean end, an empty ledger, an unreadable one; none while the face answers", async () => {
  const ended = await rig();
  await putPlist(ended);
  await putLedger(ended.deps.home, [boot(77), { t: "2026-10-19T16:00:00.000Z", kind: "shutdown", pid: 77, code: 0 }]);
  await runService("status", [], ended.deps);
  assert.match(ended.text(), /\nledger: last boot 2026-10-19T15:00:00\.000Z \(pid 77\) - ended 2026-10-19T16:00:00\.000Z code 0$/);
  const empty = await rig();
  await putPlist(empty);
  await runService("status", [], empty.deps);
  assert.match(empty.text(), /\nledger: empty$/);
  const unreadable = await rig();
  await putPlist(unreadable);
  await mkdir(join(unreadable.deps.home, "face", "desk", "events.jsonl"), { recursive: true });
  await runService("status", [], unreadable.deps);
  assert.match(unreadable.text(), /\nledger: unreadable \(EISDIR\)$/);
  const answering = await rig({ launchctl: (args) => (args[0] === "print" ? loaded("running", 42) : undefined), answer: answeredBy(42) });
  await putPlist(answering);
  await mkdir(join(answering.deps.home, "face", "service"), { recursive: true });
  await writeFile(join(answering.deps.home, "face", "service", "face.log"), "gravit-face: http://127.0.0.1:3090/?token=tok (profile: face)\n");
  assert.equal(await runService("status", [], answering.deps), 0);
  assert.match(answering.text(), /^com\.gravit\.face: running \(pid 42\)\nanswering at http:\/\/127\.0\.0\.1:3090 · up 0h 1m/);
  assert.match(answering.text(), /\nsign in: http:\/\/127\.0\.0\.1:3090\/\?token=tok$/);
  assert.ok(!answering.text().includes("ledger:"));
  assert.ok(!answering.text().includes("another face"), "the face that answers is launchd's job");
});

test("status names a face answering on the port that is not launchd's job", async () => {
  const r = await rig({ launchctl: (args) => (args[0] === "print" ? loaded("running", 42) : undefined), answer: answeredBy(99) });
  await putPlist(r);
  assert.equal(await runService("status", [], r.deps), 0);
  const lines = r.text().split("\n");
  assert.equal(lines[0], "com.gravit.face: running (pid 42)");
  assert.deepEqual(lines.slice(-2), ["sign in: no URL in the log yet (npm run service -- logs)",
    "the face answering on 3090 is pid 99, not launchd's job (pid 42): another face holds the port"], "one line, after formatStatus's output");
  for (const launchctl of [(args: string[]) => (args[0] === "print" ? loaded("not running") : undefined), undefined]) {
    const unknown = await rig({ launchctl, answer: answeredBy(99) });
    await putPlist(unknown);
    await runService("status", [], unknown.deps);
    assert.ok(!unknown.text().includes("another face"), "with launchd's pid unknown, there is nothing to compare");
  }
});

test("the port is --port, else the installed plist's FACE_PORT, else 3090; a reinstall keeps the installed port", async () => {
  const r = await rig();
  await putPlist(r, 3091);
  await runService("status", [], r.deps);
  assert.deepEqual(r.urls, ["http://127.0.0.1:3091/data/desk/status"]);
  assert.match(r.text(), /not answering on 3091/);
  await runService("status", ["--port", "3092"], r.deps);
  assert.equal(r.urls.at(-1), "http://127.0.0.1:3092/data/desk/status");
  assert.equal(await runService("install", [], r.deps), 0);
  assert.equal(r.urls.at(-1), "http://127.0.0.1:3091/data/desk/status", "install checks the port the plist runs on");
  assert.ok((await readFile(r.plist, "utf8")).includes("<key>FACE_PORT</key><string>3091</string>"));
  assert.equal(await runService("install", ["--port", "3093"], r.deps), 0);
  assert.ok((await readFile(r.plist, "utf8")).includes("<key>FACE_PORT</key><string>3093</string>"));
  const plain = await rig();
  await putPlist(plain);
  await runService("status", [], plain.deps);
  assert.deepEqual(plain.urls, ["http://127.0.0.1:3090/data/desk/status"]);
});

test("status, logs and url read the home the installed plist names, else this shell's; install writes this shell's", async () => {
  const r = await rig();
  const served = join(await home(), "a&b<c>");
  await putPlist(r, undefined, served);
  assert.ok((await readFile(r.plist, "utf8")).includes("<key>DSH_HOME</key><string>"), "the plist names its home");
  assert.ok((await readFile(r.plist, "utf8")).includes("a&amp;b&lt;c&gt;"), "escaped: the reader must undo it");
  await putLedger(served, [boot(88)]); await putLedger(r.deps.home, [boot(77)]);
  await putLog(served, "gravit-face: http://127.0.0.1:3090/?token=served (profile: face)\n");
  await putLog(r.deps.home, "gravit-face: http://127.0.0.1:3090/?token=shell (profile: face)\n");

  assert.equal(await runService("status", [], r.deps), 0);
  assert.match(r.text(), /\nsign in: http:\/\/127\.0\.0\.1:3090\/\?token=served\nledger: last boot 2026-10-19T15:00:00\.000Z \(pid 88\) - no shutdown event$/);
  r.reset();
  assert.equal(await runService("url", [], r.deps), 0);
  assert.equal(r.text(), `http://127.0.0.1:3090/?token=served${NOT_YET}`);
  r.reset();
  assert.equal(await runService("logs", [], r.deps), 0);
  assert.equal(r.text(), `== ${join(served, "face", "service", "face.log")}\ngravit-face: http://127.0.0.1:3090/?token=served (profile: face)`);
  r.reset();
  assert.equal(await runService("uninstall", [], r.deps), 0);
  assert.ok(r.text().endsWith(`the ledger (${join(served, "face", "desk")}) and ${join(served, ".env")} are untouched`), "uninstall names the installed home's files");

  await putPlist(r, undefined, served);
  r.reset();
  assert.equal(await runService("install", [], r.deps), 0);
  assert.ok((await readFile(r.plist, "utf8")).includes(`<key>DSH_HOME</key><string>${r.deps.home}</string>`), "install writes this shell's home");
  assert.equal(r.text().split("\n")[0], `moving the service's home from ${served} to ${r.deps.home}`, "and says it moves the service there, unescaped");
  r.reset();
  await runService("status", [], r.deps);
  assert.match(r.text(), /\nledger: last boot 2026-10-19T15:00:00\.000Z \(pid 77\) - no shutdown event$/, "and status follows the plist there");

  for (const plist of [`<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n  <key>Label</key><string>${LABEL}</string>\n</dict>\n</plist>\n`,
    servicePlan({ root: r.deps.root, home: "relative/home", homeDir: r.deps.homeDir, node: r.deps.nodePath, path: r.deps.envPath, launchAgentsDir: dirname(r.plist) }).plist]) {
    await writeFile(r.plist, plist);
    r.reset();
    await runService("url", [], r.deps);
    assert.equal(r.text(), `http://127.0.0.1:3090/?token=shell${NOT_YET}`, "a plist that names no absolute home: this shell's");
  }
});

test("logs prints the last 40 lines of each log under its path; url prints the last sign-in URL", async () => {
  const r = await rig();
  const log = join(r.deps.home, "face", "service", "face.log"); const errLog = join(r.deps.home, "face", "service", "face.err.log");
  assert.equal(await runService("logs", [], r.deps), 0);
  assert.equal(r.text(), `no log yet: ${log}`);
  const none = await rig();
  assert.equal(await runService("url", [], none.deps), 0);
  assert.equal(none.text(), "no sign-in URL in the log yet (npm run service -- logs)");
  await mkdir(dirname(log), { recursive: true });
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
  lines[44] = "gravit-face: http://127.0.0.1:3090/?token=new (profile: face)"; lines[4] = "gravit-face: http://127.0.0.1:3090/?token=old (profile: face)";
  await writeFile(log, `${lines.join("\n")}\n`);
  await writeFile(errLog, "boom\n");
  const shown = await rig();
  Object.assign(shown.deps, { home: r.deps.home });
  assert.equal(await runService("logs", [], shown.deps), 0);
  assert.equal(shown.text(), [`== ${log}`, ...lines.slice(10), `== ${errLog}`, "boom"].join("\n"));
  const url = await rig({ answer: answeredBy(42) });
  Object.assign(url.deps, { home: r.deps.home });
  assert.equal(await runService("url", [], url.deps), 0);
  assert.equal(url.text(), "http://127.0.0.1:3090/?token=new");
});

test("url says the log's URL may be the previous run's while the face does not answer, asking it once", async () => {
  for (const answer of [undefined, older]) {
    const r = await rig({ answer });
    await putLog(r.deps.home, "gravit-face: http://127.0.0.1:3090/?token=old (profile: face)\n");
    assert.equal(await runService("url", [], r.deps), 0);
    assert.equal(r.text(), `http://127.0.0.1:3090/?token=old${NOT_YET}`, answer === undefined ? "a refused connection" : "an answer that is no status");
    assert.deepEqual(r.urls, ["http://127.0.0.1:3090/data/desk/status"]);
  }
  const up = await rig({ answer: answeredBy(42) });
  await putLog(up.deps.home, "gravit-face: http://127.0.0.1:3090/?token=now (profile: face)\n");
  assert.equal(await runService("url", [], up.deps), 0);
  assert.equal(up.text(), "http://127.0.0.1:3090/?token=now");
  assert.deepEqual(up.urls, ["http://127.0.0.1:3090/data/desk/status"]);
});

test("an unknown command or argument prints the usage; the launchd commands refuse off macOS before launchctl", async () => {
  const r = await rig({ platform: "linux" });
  assert.equal(await runService("bogus", [], r.deps), 2);
  assert.equal(r.text(), "usage: npm run service -- install | uninstall | start | stop | restart | status | logs | url [--port N] (status also takes --check)");
  for (const args of [["--port"], ["--port", "0"], ["--port", "3090x"], ["--verbose"], ["--check", "--check"]]) {
    const bad = await rig();
    assert.equal(await runService("status", args, bad.deps), 2, args.join(" "));
    assert.match(bad.text(), /usage: npm run service -- /);
  }
  for (const cmd of ["install", "uninstall", "start", "stop", "restart"]) {
    const off = await rig({ platform: "linux" });
    assert.equal(await runService(cmd, [], off.deps), 1, cmd);
    assert.equal(off.text().split("\n").length, 1, `${cmd}: one line`);
    assert.match(off.text(), /needs macOS/);
    assert.deepEqual(off.calls, [], `${cmd}: no launchctl`);
  }
  for (const cmd of ["logs", "url", "start"]) {
    const check = await rig();
    assert.equal(await runService(cmd, ["--check"], check.deps), 2, `${cmd} --check`);
    assert.match(check.text(), /^--check is status's alone\nusage: /);
  }
  const status = await rig({ platform: "linux" });
  assert.equal(await runService("status", [], status.deps), 0, "status, logs and url run anywhere");
  assert.equal(status.text(), "com.gravit.face: not installed (npm run service -- install)");
  assert.deepEqual([status.calls, status.urls], [[], []], "no plist: neither launchd nor the port is asked");
});

test("nodeOnPath: the first executable node on PATH, never one under node_modules", async () => {
  const d = await home();
  for (const dir of [join("node_modules", ".bin"), "plain", "bin"]) await mkdir(join(d, dir), { recursive: true });
  await writeFile(join(d, "node_modules", ".bin", "node"), ""); await chmod(join(d, "node_modules", ".bin", "node"), 0o755);
  await writeFile(join(d, "plain", "node"), ""); await chmod(join(d, "plain", "node"), 0o644);
  await writeFile(join(d, "bin", "node"), ""); await chmod(join(d, "bin", "node"), 0o755);
  assert.equal(nodeOnPath([join(d, "node_modules", ".bin"), join(d, "plain"), "", "relative", join(d, "bin")].join(":")), join(d, "bin", "node"));
  assert.equal(nodeOnPath(join(d, "plain")), undefined);
});

/* status --check (spec §16 H4): checkHealth over the same rig - a fake launchctl, a fake port, a recorded sleep. */

const HEALTH_NOW = Date.parse("2026-11-30T15:30:00.000Z");
const running42 = (args: string[]) => (args[0] === "print" ? loaded("running", 42) : undefined);
const todayOf = { sent: 0, suppressed: { cooldown: 0, cap: 0, muted: 0, off: 0, window: 0 }, repeats: 0 };

/** pid 42's status with `extra` laid over it: a watch watching, both markets off, unless `extra` says otherwise. */
const healthStatus = (extra: Partial<DeskStatus> = {}): DeskStatus => ({
  ...deskStatusOf(42),
  watch: {
    state: "watching",
    markets: { us: { state: "off", watched: 0, notWatched: [], today: todayOf }, cn: { state: "off", watched: 0, notWatched: [], today: todayOf } },
    files: [], near: [], marks: [], pending: 0, recent: [], filings: { state: "off", symbols: 0, aShares: 0, seeded: 0 },
  },
  telegram: { configured: true, polling: true, dropped: 0, queued: 0 },
  ...extra,
});
const answering = (status: DeskStatus) => (): Response => new Response(JSON.stringify(status), { status: 200 });

/** checkHealth on an installed rig: pid 42 running unless `launchctl` says otherwise; the sleep recorded, never waited. */
async function health(o: { answer?: (calls: string[][]) => Response | undefined; launchctl?: Launchctl; installed?: boolean } = {}) {
  const r = await rig({ launchctl: o.launchctl ?? running42, answer: o.answer });
  if (o.installed !== false) await putPlist(r);
  const result = await checkHealth(contextOf(r.deps, undefined), { now: () => HEALTH_NOW });
  return { ...result, r };
}

test("checkHealth 3: not installed, without asking launchd or the port; installed and not loaded, without asking the port", async () => {
  const none = await health({ installed: false, answer: answering(healthStatus()) });
  assert.deepEqual([none.code, none.reason], [3, "not installed"]);
  assert.deepEqual([none.r.calls, none.r.urls], [[], []]);
  const stopped = await health({ launchctl: () => undefined, answer: answering(healthStatus()) });
  assert.deepEqual([stopped.code, stopped.reason], [3, "stopped"]);
  assert.deepEqual(stopped.r.urls, [], "a job launchd lacks is stopped whatever answers on the port");
});

test("checkHealth 2: no answer on two tries 10 s apart, the wait through the injected sleep", async () => {
  const down = await health();
  assert.deepEqual([down.code, down.reason], [2, "no answer on 3090"]);
  assert.equal(down.r.urls.length, 2, "two tries");
  assert.deepEqual(down.r.sleeps, [10_000], "10 s between them, through deps.sleep");
  const r = await rig({ launchctl: running42 });
  await putPlist(r);
  const waits: number[] = [];
  const short = await checkHealth(contextOf(r.deps, undefined), { retryMs: 5, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(short.code, 2);
  assert.deepEqual([waits, r.sleeps], [[5], []], "retryMs and sleep as given");
  const older404 = await health({ answer: () => new Response(null, { status: 404 }) });
  assert.equal(older404.code, 2, "a 404 is no status: an older face, or not a face");
});

test("a face that misses the first try and answers the second is not down", async () => {
  let tries = 0;
  const late = await health({ answer: () => (tries++ === 0 ? undefined : answering(healthStatus())()) });
  assert.deepEqual([late.code, late.reason], [0, "healthy"]);
  assert.equal(late.r.urls.length, 2);
  assert.deepEqual(late.r.sleeps, [10_000]);
  const first = await health({ answer: answering(healthStatus()) });
  assert.deepEqual([first.code, first.reason, first.r.urls.length, first.r.sleeps], [0, "healthy", 1, []], "an answer at once: one try, no wait");
});

test("another face on the port reads 1 and nothing else", async () => {
  const sick = healthStatus({ pid: 99, ledgerError: "EACCES", telegram: { configured: true, polling: false, dropped: 0, queued: 0, blocked: true } });
  const other = await health({ answer: answering(sick) });
  assert.deepEqual([other.code, other.reason], [1, "another face holds the port"], "the other face's own troubles are not the job's");
  const notRunning = await health({ launchctl: (args) => (args[0] === "print" ? loaded("not running") : undefined), answer: answering(healthStatus()) });
  assert.deepEqual([notRunning.code, notRunning.reason], [1, "another face holds the port"], "a loaded job with no pid runs no face");
});

test("checkHealth 1: the Telegram bridge's poll failing, blocked, or in conflict within 10 minutes", async () => {
  const tg = (extra: object) => healthStatus({ telegram: { configured: true, polling: true, dropped: 0, queued: 0, ...extra } });
  const failing = await health({ answer: answering(tg({ pollFailing: { since: "2026-11-30T15:00:00.000Z", reason: "401 Unauthorized" } })) });
  assert.deepEqual([failing.code, failing.reason], [1, "telegram poll failing since 2026-11-30T15:00:00.000Z: 401 Unauthorized"]);
  const blocked = await health({ answer: answering(tg({ blocked: true })) });
  assert.deepEqual([blocked.code, blocked.reason], [1, "telegram blocked: the operator's chat refuses the bot (403)"]);
  const conflict = await health({ answer: answering(tg({ conflictAt: "2026-11-30T15:21:00.000Z" })) });
  assert.deepEqual([conflict.code, conflict.reason], [1, "telegram conflict at 2026-11-30T15:21:00.000Z: another poller holds the token"]);
  const edge = await health({ answer: answering(tg({ conflictAt: "2026-11-30T15:20:00.000Z" })) });
  assert.equal(edge.code, 1, "10 minutes ago to the ms is within");
  const old = await health({ answer: answering(tg({ conflictAt: "2026-11-30T15:19:59.999Z" })) });
  assert.deepEqual([old.code, old.reason], [0, "healthy"], "an older conflict is over");
});

test("checkHealth 1: the watch's lease failed or held elsewhere", async () => {
  const watchIn = (extra: object) => { const s = healthStatus(); return healthStatus({ watch: { ...s.watch!, ...extra } }); };
  const failed = await health({ answer: answering(watchIn({ state: "lease-failed", leaseError: "EACCES" })) });
  assert.deepEqual([failed.code, failed.reason], [1, "watch lease failed: EACCES"]);
  const elsewhere = await health({ answer: answering(watchIn({ state: "held-elsewhere", holder: { pid: 7, since: "2026-11-30T14:00:00.000Z" } })) });
  assert.deepEqual([elsewhere.code, elsewhere.reason], [1, "watch held elsewhere: pid 7 since 2026-11-30T14:00:00.000Z"]);
});

test("checkHealth 1: a market polling whose last poll is older than three of its intervals", async () => {
  const pollingAt = (m: "us" | "cn", lastPollAt: string | undefined, state: "polling" | "after-close" = "polling") => {
    const s = healthStatus();
    return healthStatus({ watch: { ...s.watch!, markets: { ...s.watch!.markets, [m]: { ...s.watch!.markets[m], state, ...(lastPollAt === undefined ? {} : { lastPollAt }) } } } });
  };
  const ago = (ms: number) => new Date(HEALTH_NOW - ms).toISOString();
  const usStale = await health({ answer: answering(pollingAt("us", ago(3 * 20_000 + 1))) });
  assert.deepEqual([usStale.code, usStale.reason], [1, `watch US: polling, last poll ${ago(60_001)}, older than 3 polls (60 s)`]);
  assert.equal((await health({ answer: answering(pollingAt("us", ago(60_000))) })).code, 0, "three intervals to the ms is not older");
  const cnStale = await health({ answer: answering(pollingAt("cn", ago(30_001))) });
  assert.deepEqual([cnStale.code, cnStale.reason], [1, `watch CN: polling, last poll ${ago(30_001)}, older than 3 polls (30 s)`]);
  assert.equal((await health({ answer: answering(pollingAt("cn", ago(30_000))) })).code, 0);
  assert.equal((await health({ answer: answering(pollingAt("us", ago(3_600_000), "after-close")) })).code, 0, "only a polling market is judged");
  assert.equal((await health({ answer: answering(pollingAt("us", undefined)) })).code, 0, "a market not yet polled has no last poll to judge");
});

test("checkHealth 1: an unreadable ledger, the desk's or the watch's", async () => {
  const desk = await health({ answer: answering(healthStatus({ ledgerError: "EISDIR" })) });
  assert.deepEqual([desk.code, desk.reason], [1, "ledger unreadable (EISDIR)"]);
  const s = healthStatus();
  const watch = await health({ answer: answering(healthStatus({ watch: { ...s.watch!, ledgerError: "EIO" } })) });
  assert.deepEqual([watch.code, watch.reason], [1, "watch ledger unreadable (EIO)"]);
});

test("checkHealth 0: a face with no telegram and no watch in its status is healthy", async () => {
  const bare = await health({ answer: answering(deskStatusOf(42)) });
  assert.deepEqual([bare.code, bare.reason], [0, "healthy"]);
});

test("the watch's poll intervals as service.ts copies them are watch.ts's", () => {
  assert.deepEqual(WATCH_POLL_MS, { us: WATCH_US_POLL_MS, cn: WATCH_CN_POLL_MS });
});

test("status --check returns the code and prints the health line; plain status still returns 0", async () => {
  const down = await rig({ launchctl: running42 });
  await putPlist(down);
  assert.equal(await runService("status", [], down.deps), 0, "plain status: 0 though the face does not answer");
  assert.ok(!down.text().includes("health:"));
  assert.deepEqual(down.sleeps, [], "plain status never waits");
  down.reset();
  assert.equal(await runService("status", ["--check"], down.deps), 2);
  const lines = down.text().split("\n");
  assert.equal(lines[0], "com.gravit.face: running (pid 42)");
  assert.equal(lines.at(-1), "health: 2 no answer on 3090", "the block status prints, then the health line");
  assert.ok(lines.includes("not answering on 3090"));
  const ok = await rig({ launchctl: running42, answer: answering(healthStatus()) });
  await putPlist(ok);
  assert.equal(await runService("status", ["--port", "3090", "--check"], ok.deps), 0);
  assert.equal(ok.text().split("\n").at(-1), "health: 0 healthy");
  const other = await rig({ launchctl: running42, answer: answering(healthStatus({ pid: 99 })) });
  await putPlist(other);
  assert.equal(await runService("status", ["--check", "--port", "3090"], other.deps), 1);
  assert.deepEqual(other.text().split("\n").slice(-2), [
    "the face answering on 3090 is pid 99, not launchd's job (pid 42): another face holds the port", "health: 1 another face holds the port",
  ]);
  const none = await rig();
  assert.equal(await runService("status", ["--check"], none.deps), 3);
  assert.equal(none.text(), "com.gravit.face: not installed (npm run service -- install)\nhealth: 3 not installed");
  const stopped = await rig();
  await putPlist(stopped);
  assert.equal(await runService("status", ["--check"], stopped.deps), 3);
  assert.equal(stopped.text().split("\n").at(-1), "health: 3 stopped");
});
