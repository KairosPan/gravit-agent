// face/tests/service.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXPECTED_KEYS, LABEL, ensureHomeEnv, envLinesOf, filterPath, formatStatus, lastTokenUrl, parseLaunchctlPrint, servicePlan } from "../scripts/service.ts";
import type { DeskStatus } from "../src/desk.ts";

const home = (): Promise<string> => mkdtemp(join(tmpdir(), "face-service-"));
const plan = (port?: number) => servicePlan({ root: "/repo", home: "/h/.dsh", homeDir: "/h", node: "/usr/local/bin/node", path: "/usr/local/bin:/repo/face/node_modules/.bin::/opt/homebrew/bin", launchAgentsDir: "/h/Library/LaunchAgents", port });

test("servicePlan: node, tsx, main.ts; face/ as cwd; only PATH HOME DSH_HOME in the environment; launchd keys", () => {
  const p = plan();
  assert.deepEqual(p.args, ["/usr/local/bin/node", "/repo/face/node_modules/tsx/dist/cli.mjs", "/repo/face/src/main.ts"]);
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
  assert.deepEqual(first, { path: join(h, ".dsh", ".env"), created: true, names: [...EXPECTED_KEYS], missing: [], missingSources: [join(src, ".env.ifind")] });
  assert.equal(((await stat(first.path)).mode & 0o777), 0o600);
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

test("parseLaunchctlPrint and lastTokenUrl", () => {
  assert.deepEqual(parseLaunchctlPrint("gui/501/com.gravit.face = {\n\tstate = running\n\tpid = 4242\n}"), { state: "running", pid: 4242 });
  assert.deepEqual(parseLaunchctlPrint(""), {});
  assert.deepEqual(parseLaunchctlPrint("gui/501/com.gravit.face = {\n\tstate = not running\n}"), { state: "not running" }, "a stopped job's state is two words");
  const log = "x\ngravit-face: http://127.0.0.1:3090/?token=aaa (profile: face)\nagain\ngravit-face: http://127.0.0.1:3090/?token=bbb (profile: face)\n";
  assert.equal(lastTokenUrl(log), "http://127.0.0.1:3090/?token=bbb"); assert.equal(lastTokenUrl("nothing"), undefined);
});

test("formatStatus names a lost last run", () => {
  const status: DeskStatus = { ok: true, pid: 7, version: "v", bootedAt: "2026-10-19T15:00:00.000Z", uptimeMs: 90 * 60_000, desk: { enabled: true, dir: "/d" }, asleep: [],
    runs: [{ bootedAt: "2026-10-19T14:00:00.000Z", pid: 6, lost: true }, { bootedAt: "2026-10-19T15:00:00.000Z", pid: 7, lost: false }] };
  const text = formatStatus({ label: LABEL, info: { state: "running", pid: 7 }, installed: true, status, url: "http://127.0.0.1:3090/?token=t", port: 3090 });
  assert.match(text, /^com\.gravit\.face: running \(pid 7\)/);
  assert.match(text, /answering at http:\/\/127\.0\.0\.1:3090 · up 1h 30m since 2026-10-19T15:00:00\.000Z · desk on/);
  assert.match(text, /last run: lost \(killed or crashed; no shutdown event\)/);
  assert.match(text, /sign in: http:\/\/127\.0\.0\.1:3090\/\?token=t/);
  const unreadable: DeskStatus = { ok: true, pid: 7, version: "v", bootedAt: "2026-10-19T15:00:00.000Z", uptimeMs: 90 * 60_000, desk: { enabled: true, dir: "/d" }, asleep: [],
    runs: [], ledgerError: "EACCES" };
  assert.match(formatStatus({ label: LABEL, info: { state: "running", pid: 7 }, installed: true, status: unreadable, url: undefined, port: 3090 }), /· desk on\nledger: unreadable \(EACCES\)\n/);
  const quiet: DeskStatus = { ok: true, pid: 9, version: "v", bootedAt: "2026-10-19T15:00:00.000Z", uptimeMs: 7_559_999, desk: { enabled: false, dir: "/d" },
    asleep: [{ from: "2026-10-19T15:10:00.000Z", to: "2026-10-19T15:20:00.000Z", gapMs: 600_000 }, { from: "2026-10-19T16:00:00.000Z", to: "2026-10-19T16:30:00.000Z", gapMs: 1_800_000 }],
    runs: [{ bootedAt: "2026-10-19T13:00:00.000Z", pid: 7, lost: true }, { bootedAt: "2026-10-19T14:00:00.000Z", pid: 8, endedAt: "2026-10-19T14:30:00.000Z", code: 0, lost: false },
      { bootedAt: "2026-10-19T15:00:00.000Z", pid: 9, lost: false }] };
  assert.equal(formatStatus({ label: LABEL, info: { state: "running", pid: 9 }, installed: true, status: quiet, url: undefined, port: 3091 }), [
    "com.gravit.face: running (pid 9)",
    "answering at http://127.0.0.1:3091 · up 2h 5m since 2026-10-19T15:00:00.000Z · desk off (FACE_DESK=0)",
    "asleep: 2 gap(s) since boot",
    "last run: ended 2026-10-19T14:30:00.000Z code 0",
    "sign in: no URL in the log yet (npm run service -- logs)",
  ].join("\n"));
  assert.equal(formatStatus({ label: LABEL, info: {}, installed: true, status: undefined, url: undefined, port: 3090 }),
    "com.gravit.face: loaded\nnot answering on 3090\nsign in: no URL in the log yet (npm run service -- logs)");
  assert.match(formatStatus({ label: LABEL, info: {}, installed: false, status: undefined, url: undefined, port: 3090 }), /not installed \(npm run service -- install\)/);
});
