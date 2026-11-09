import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureRoster, logAvailable, readRoster, ROSTER_V1_BACKUP, setAvailable } from "../src/roster.ts";
import { HttpError } from "../src/http.ts";

const home = (): Promise<string> => mkdtemp(join(tmpdir(), "face-roster-"));
const fileOf = (h: string): string => join(h, "face", "channels.json");
const backupOf = (h: string): string => join(h, "face", ROSTER_V1_BACKUP);

async function put(h: string, text: string): Promise<void> {
  await mkdir(join(h, "face"), { recursive: true });
  await writeFile(fileOf(h), text);
}

const exists = async (path: string): Promise<boolean> => {
  try { await access(path); return true; } catch { return false; }
};

test("ensureRoster on an absent file seeds the connected bins and no bots", async () => {
  const h = await home();
  const result = await ensureRoster(h, ["claude", "codex"]);
  assert.deepEqual(result, { roster: { agents: ["claude", "codex"], bots: [] }, corrupt: false, migrated: "seeded" });
  assert.deepEqual(JSON.parse(await readFile(fileOf(h), "utf8")), { version: 2, agents: ["claude", "codex"], bots: [] });
  assert.equal((await stat(fileOf(h))).mode & 0o777, 0o600);
});

test("ensureRoster turns a v1 file into the union of its channels", async () => {
  const h = await home();
  const v1 = JSON.stringify({
    version: 1,
    channels: {
      a: { agents: ["claude"], bots: ["drill-bull"] },
      b: { agents: ["codex", "claude"], bots: ["drill-bear", "drill-bull"] },
    },
  }, null, 2);
  await put(h, v1);
  const result = await ensureRoster(h, ["claude"]);
  assert.deepEqual(result, {
    roster: { agents: ["claude", "codex"], bots: ["drill-bull", "drill-bear"] }, corrupt: false, migrated: "v1",
  });
  assert.deepEqual(JSON.parse(await readFile(fileOf(h), "utf8")), {
    version: 2, agents: ["claude", "codex"], bots: ["drill-bull", "drill-bear"],
  });
  assert.equal(await readFile(backupOf(h), "utf8"), v1, "the old text is kept byte for byte");
});

test("ensureRoster never overwrites a v1 backup that already exists", async () => {
  const h = await home();
  await put(h, JSON.stringify({ version: 1, channels: { a: { agents: ["codex"], bots: [] } } }));
  await writeFile(backupOf(h), "an older backup");
  await ensureRoster(h, []);
  assert.equal(await readFile(backupOf(h), "utf8"), "an older backup");
  assert.deepEqual((await readRoster(h)).roster, { agents: ["codex"], bots: [] });
});

test("ensureRoster leaves a corrupt file alone", async () => {
  for (const text of ["{", "null", JSON.stringify({ version: 3, agents: [], bots: [] }), JSON.stringify({ version: 1, channels: 7 })]) {
    const h = await home();
    await put(h, text);
    const result = await ensureRoster(h, ["claude"]);
    assert.deepEqual(result, { roster: null, corrupt: true }, text);
    assert.equal(await readFile(fileOf(h), "utf8"), text, `${text}: unchanged byte for byte`);
    assert.equal(await exists(backupOf(h)), false, `${text}: no backup written`);
  }
});

test("ensureRoster on a v2 file changes nothing", async () => {
  const h = await home();
  const text = `${JSON.stringify({ version: 2, agents: ["codex"], bots: ["drill-bull"] }, null, 2)}\n`;
  await put(h, text);
  const before = (await stat(fileOf(h))).mtimeMs;
  const result = await ensureRoster(h, ["claude", "codex"]);
  assert.deepEqual(result, { roster: { agents: ["codex"], bots: ["drill-bull"] }, corrupt: false });
  assert.equal((await stat(fileOf(h))).mtimeMs, before, "mtime unchanged");
  assert.equal(await readFile(fileOf(h), "utf8"), text);
});

test("readRoster: absent is null and not corrupt; a v1 file reads as corrupt", async () => {
  const h = await home();
  assert.deepEqual(await readRoster(h), { roster: null, corrupt: false });
  await put(h, JSON.stringify({ version: 1, channels: {} }));
  assert.deepEqual(await readRoster(h), { roster: null, corrupt: true });
});

test("readRoster drops junk entries", async () => {
  const h = await home();
  await put(h, JSON.stringify({ version: 2, agents: ["claude", "", 7, "claude"], bots: ["drill-bull", "Bad Id", "gravit"] }));
  assert.deepEqual(await readRoster(h), { roster: { agents: ["claude"], bots: ["drill-bull"] }, corrupt: false });
});

test("setAvailable adds and removes, keeps order, logs a dated line", async () => {
  const h = await home();
  await ensureRoster(h, ["claude"]);
  assert.deepEqual(await setAvailable(h, "agent", "codex", true), { agents: ["claude", "codex"], bots: [] });
  assert.deepEqual(await setAvailable(h, "agent", "codex", true), { agents: ["claude", "codex"], bots: [] }, "adding twice is one entry");
  assert.deepEqual(await setAvailable(h, "bot", "drill-bull", true), { agents: ["claude", "codex"], bots: ["drill-bull"] });
  assert.deepEqual(await setAvailable(h, "bot", "drill-bear", true), { agents: ["claude", "codex"], bots: ["drill-bull", "drill-bear"] });
  assert.deepEqual(await setAvailable(h, "agent", "claude", false), { agents: ["codex"], bots: ["drill-bull", "drill-bear"] });
  assert.deepEqual(await setAvailable(h, "bot", "drill-bull", false), { agents: ["codex"], bots: ["drill-bear"] });
  assert.deepEqual((await readRoster(h)).roster, { agents: ["codex"], bots: ["drill-bear"] }, "what it answered is on disk");

  await logAvailable(h, "bot", "drill-bear", true);
  await logAvailable(h, "agent", "claude", false);
  const lines = (await readFile(join(h, "face", "roster.log"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 2, "append-only");
  assert.match(lines[0]!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z available bot drill-bear = on$/);
  assert.match(lines[1]!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z available agent claude = off$/);
});

test("logAvailable never throws - the log is a record, not a gate", async () => {
  const h = await home();
  await writeFile(join(h, "face"), "not a directory");
  await assert.doesNotReject(logAvailable(h, "agent", "claude", true));
});

test("setAvailable refuses a corrupt or absent file with 409", async () => {
  const absent = await home();
  await assert.rejects(setAvailable(absent, "agent", "claude", true),
    (err: unknown) => err instanceof HttpError && err.status === 409 && err.message.includes(fileOf(absent)));
  assert.equal(await exists(fileOf(absent)), false, "an absent file is not created by a switch");

  const broken = await home();
  const text = JSON.stringify({ version: 3, agents: [], bots: [] });
  await put(broken, text);
  await assert.rejects(setAvailable(broken, "bot", "drill-bull", true),
    (err: unknown) => err instanceof HttpError && err.status === 409 && err.message.includes(fileOf(broken)));
  assert.equal(await readFile(fileOf(broken), "utf8"), text, "the file is left byte for byte");
});

test("setAvailable refuses a bot id outside isBotId with 400", async () => {
  const h = await home();
  await ensureRoster(h, []);
  for (const id of ["Bad Id", "gravit", "gravit-desk", "role-cn-reviewer", "_template", ""]) {
    await assert.rejects(setAvailable(h, "bot", id, true),
      (err: unknown) => err instanceof HttpError && err.status === 400, id);
  }
  assert.deepEqual((await readRoster(h)).roster, { agents: [], bots: [] });
});

test("concurrent setAvailable calls all land", async () => {
  const h = await home();
  await ensureRoster(h, ["claude"]);
  await Promise.all([
    setAvailable(h, "agent", "codex", true),
    setAvailable(h, "bot", "drill-bull", true),
    setAvailable(h, "bot", "drill-bear", true),
    setAvailable(h, "bot", "drill-bull", false),
  ]);
  const { roster } = await readRoster(h);
  assert.ok(roster !== null);
  assert.ok(roster.agents.includes("codex"), "the agent switch was not reverted");
  assert.ok(roster.agents.includes("claude"));
  assert.deepEqual(roster.bots, ["drill-bear"], "each bot switch landed in the order it was issued");
});
