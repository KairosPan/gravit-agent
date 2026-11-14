import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { initHome } from "gravit-memory";
import {
  DEFAULT_MEMORY_DIR,
  MEMORY_COMMIT,
  MEMORY_NO_HOME_NOTICE,
  NO_MEMORY_HERE,
  assertHomeAllowed,
  isTestProcess,
  memoryFaultWords,
  memoryHome,
  memoryOpener,
  namedMemoryHome,
  openFaceMemory,
} from "../src/memory.ts";

const FACE = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(FACE, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(FACE, "package-lock.json"), "utf8"));

/** A test process's environment, for the guard's tests that must not lean on the runner's own. */
const IN_TEST = { NODE_TEST_CONTEXT: "child-v8" };

/** A fresh directory under the system's temporary directory, removed when the test ends. */
async function scratch(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "face-memory-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("the dependency is the tagged commit", () => {
  assert.equal(pkg.dependencies["gravit-memory"], `github:KairosPan/gravit-memory#${MEMORY_COMMIT}`);
  assert.ok(lock.packages["node_modules/gravit-memory"].resolved.endsWith(`#${MEMORY_COMMIT}`));
  assert.ok(existsSync(join(DEFAULT_MEMORY_DIR, "dist", "cli.js")));
});

test("the home: FACE_MEMORY_HOME, then GRAVIT_MEMORY_HOME, then the package's default", () => {
  assert.equal(memoryHome({ FACE_MEMORY_HOME: "/a", GRAVIT_MEMORY_HOME: "/b" }), "/a");
  assert.equal(memoryHome({ GRAVIT_MEMORY_HOME: "/b" }), "/b");
  assert.equal(memoryHome({}), join(homedir(), ".gravit-memory"));
});

test("a test process is one node's runner or a smoke started", () => {
  assert.equal(isTestProcess({ NODE_TEST_CONTEXT: "child-v8" }), true);
  assert.equal(isTestProcess({ FACE_SMOKE: "1" }), true);
  assert.equal(isTestProcess({}), false);
});

test("in a test process only a home under the temporary directory is allowed", () => {
  const refused = (home: string) =>
    assert.throws(() => assertHomeAllowed(home, IN_TEST), (e: Error) => {
      assert.match(e.message, /a test never opens a real memory/);
      assert.match(e.message, /tests\/helpers\/no-memory\.ts/);
      return true;
    });
  refused(memoryHome({}));
  refused("/somewhere/else/memory");
  assert.throws(() => assertHomeAllowed("/somewhere/else/memory", IN_TEST), /else\/memory/);
  // a home not made yet is judged by where it would be
  assert.doesNotThrow(() => assertHomeAllowed(join(tmpdir(), "x", "home"), IN_TEST));
  // outside a test process the guard allows everything
  assert.doesNotThrow(() => assertHomeAllowed(memoryHome({}), {}));
});

test("a link out of the temporary directory is judged by where it leads", async (t) => {
  const tmp = await scratch(t);
  await symlink(FACE, join(tmp, "out"), "junction");
  assert.throws(() => assertHomeAllowed(join(tmp, "out", "home"), IN_TEST), /a test never opens a real memory/);
  assert.doesNotThrow(() => assertHomeAllowed(join(tmp, "home"), IN_TEST));
});

test("a disabled row and a missing install are said, not thrown", async (t) => {
  const tmp = await scratch(t);
  const home = join(tmp, "home");
  assert.deepEqual(await openFaceMemory({ home, disabled: true }), {
    connected: false,
    why: "disabled",
    say: "the memory is not connected: the mcp-memory row is disabled",
  });
  const empty = await mkdtemp(join(tmp, "empty-"));
  assert.deepEqual(await openFaceMemory({ home, dir: empty }), {
    connected: false,
    why: "no install",
    say: "the memory is not connected: gravit-memory is not installed",
  });
});

test("a home nobody made answers no memory here", async (t) => {
  const tmp = await scratch(t);
  const s = await openFaceMemory({ home: join(tmp, "home") });
  assert.equal(s.connected, true);
  if (!s.connected) return;
  await assert.rejects(s.memory.status(), (e) => memoryFaultWords(e) === NO_MEMORY_HERE);
  // nothing was made in its place
  assert.equal(existsSync(join(tmp, "home")), false);
});

test("a home that was made answers", async (t) => {
  const tmp = await scratch(t);
  const home = join(tmp, "home");
  await initHome(home);
  const s = await openFaceMemory({ home });
  assert.equal(s.connected, true);
  if (!s.connected) return;
  assert.equal(s.home, home);
  assert.equal((await s.memory.status()).version, 1);
});

test("opening a home outside the temporary directory in a test throws before anything is read", async () => {
  assert.equal(isTestProcess(), true);
  // the guard comes first: neither the row's switch nor the install is looked at
  for (const opts of [{}, { disabled: true }, { dir: join(tmpdir(), "no-such-install") }]) {
    await assert.rejects(openFaceMemory({ ...opts, home: "/somewhere/else/memory" }), /a test never opens a real memory/);
  }
});

test("the opener follows the row as composed: disabled or absent is the disabled standing, else its install and home", async (t) => {
  const tmp = await scratch(t);
  const home = join(tmp, "home");
  // a disabled or absent row names no home: the environment's is the one guarded
  const was = process.env.FACE_MEMORY_HOME;
  process.env.FACE_MEMORY_HOME = home;
  t.after(() => { if (was === undefined) delete process.env.FACE_MEMORY_HOME; else process.env.FACE_MEMORY_HOME = was; });
  const disabled = { connected: false, why: "disabled", say: "the memory is not connected: the mcp-memory row is disabled" };
  assert.deepEqual(await memoryOpener({ disabled: true })(), disabled);
  assert.deepEqual(await memoryOpener(undefined)(), disabled);
  const empty = await mkdtemp(join(tmp, "empty-"));
  assert.equal((await memoryOpener({ disabled: false, dir: empty, home })()).connected, false);
  const s = await memoryOpener({ disabled: false, dir: DEFAULT_MEMORY_DIR, home })();
  assert.equal(s.connected, true);
  if (s.connected) assert.equal(s.home, home);
  // the row's home is guarded as any other
  await assert.rejects(memoryOpener({ disabled: false, dir: DEFAULT_MEMORY_DIR, home: "/somewhere/else/memory" })(),
    /a test never opens a real memory/);
});

/** The standing of a face on a scratch harness home that names no memory home. */
const NO_HOME = {
  connected: false,
  why: "no home named",
  say: "the memory is not connected: this face runs on a scratch harness home and no memory home is named",
};

test("the home a face may open: the harness's default home opens the memory's; a scratch one none unless named", async (t) => {
  const tmp = await scratch(t);
  const dshDefault = resolveDshHome(undefined, {});
  const dshScratch = join(tmp, "dsh");
  // the harness's own default home (the installed service, the daily start): the memory's default, as before
  assert.equal(namedMemoryHome(dshDefault, {}), join(homedir(), ".gravit-memory"));
  assert.equal(namedMemoryHome(join(dshDefault, "x", ".."), {}), join(homedir(), ".gravit-memory"), "the same home, written otherwise");
  // a scratch harness home names none
  assert.equal(namedMemoryHome(dshScratch, {}), undefined);
  assert.equal(namedMemoryHome(dshScratch, { DSH_HOME: dshScratch }), undefined);
  // unless a home is named, by either variable
  assert.equal(namedMemoryHome(dshScratch, { FACE_MEMORY_HOME: join(tmp, "a") }), join(tmp, "a"));
  assert.equal(namedMemoryHome(dshScratch, { GRAVIT_MEMORY_HOME: join(tmp, "b") }), join(tmp, "b"));
  assert.equal(namedMemoryHome(dshScratch, { FACE_MEMORY_HOME: join(tmp, "a"), GRAVIT_MEMORY_HOME: join(tmp, "b") }), join(tmp, "a"));
  // the docker box's pair (compose.yml's agent box): its harness home is not the default, and it names the memory's
  assert.equal(namedMemoryHome("/dsh-home", { DSH_HOME: "/dsh-home", GRAVIT_MEMORY_HOME: "/memory-home" }), "/memory-home");
});

test("on a scratch harness home with no home named nothing is opened, and the standing says so", async (t) => {
  const tmp = await scratch(t);
  // not a test process's environment, so the guard stands aside and the rule is what keeps the default home shut
  const env = { DSH_HOME: join(tmp, "dsh") };
  // an install that is not there would be "no install" had the library been looked for: it was not
  assert.deepEqual(await openFaceMemory({ env, dir: join(tmp, "no-such-install") }), NO_HOME);
  assert.deepEqual(await openFaceMemory({ env, dshHome: join(tmp, "dsh"), dir: join(tmp, "no-such-install") }), NO_HOME);
  assert.deepEqual(await openFaceMemory({ env, disabled: true }), NO_HOME, "the rule is said before the row's switch");
  assert.deepEqual(await memoryOpener(undefined, env)(), NO_HOME, "no row composed");
  assert.deepEqual(await memoryOpener({ disabled: true }, env)(), NO_HOME);
  // a home named: the rule stands aside, and the row's switch is said again
  assert.deepEqual(await memoryOpener({ disabled: true }, { ...env, FACE_MEMORY_HOME: join(tmp, "home") })(), {
    connected: false, why: "disabled", say: "the memory is not connected: the mcp-memory row is disabled",
  });
  // in a test process the guard still refuses first
  await assert.rejects(openFaceMemory({ env: { ...IN_TEST, DSH_HOME: join(tmp, "dsh") } }), /a test never opens a real memory/);
  await assert.rejects(memoryOpener(undefined, { ...IN_TEST, DSH_HOME: join(tmp, "dsh") })(), /a test never opens a real memory/);
  // the boot's one line names the variable to set
  assert.equal(MEMORY_NO_HOME_NOTICE, `${NO_HOME.say}; set FACE_MEMORY_HOME to name one`);
});

test("a fault is one short line, and no home is said as the door says it", () => {
  assert.equal(memoryFaultWords(Object.assign(new Error("anything"), { code: "E_NO_HOME" })), NO_MEMORY_HERE);
  assert.equal(memoryFaultWords(new Error("first\nsecond")), "first second");
  const long = memoryFaultWords(new Error("x".repeat(500)));
  assert.ok(long.length <= 200);
  assert.equal(memoryFaultWords("plain"), "plain");
});
