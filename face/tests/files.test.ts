import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";
import { FILES_CACHE_MS, folderEntries, rankFiles, registerFileRoutes, walkRepository, type FileEntry } from "../src/files.ts";

/** The fixture tree under a fresh temp dir; `done` restores the unreadable folder so the cleanup can remove it. */
async function fixture(): Promise<{ root: string; done(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "files-test-"));
  const file = async (p: string): Promise<void> => {
    await mkdir(join(root, p, ".."), { recursive: true });
    await writeFile(join(root, p), "x");
  };
  await file("strategies/cn-market/journal.md");
  await mkdir(join(root, "strategies/cn-market/analysis"), { recursive: true });
  await file("desk/levels.yml");
  await file(".env.ifind");
  await file(".git/HEAD");
  await file("node_modules/x/index.js");
  await file(".claude/worktrees/w/file.md");
  await file("face/dist/a.js");
  await symlink("..", join(root, "desk/loop"));
  await mkdir(join(root, "locked"));
  await file("locked/secret.txt");
  await chmod(join(root, "locked"), 0o000);
  return {
    root,
    done: async () => {
      await chmod(join(root, "locked"), 0o755);
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("the walk skips the key files, git, packages, build output and other worktrees", async () => {
  const f = await fixture();
  try {
    const { entries, truncated } = await walkRepository(f.root);
    const paths = entries.map((e) => e.path);
    assert.equal(truncated, false);
    for (const p of paths) assert.doesNotMatch(p, /\.env|\.git|node_modules|dist|\.claude\/worktrees/);
    assert.ok(paths.includes("desk/levels.yml"));
    assert.ok(paths.includes("strategies/cn-market/analysis"));
    assert.deepEqual(entries.find((e) => e.path === "strategies/cn-market"), { path: "strategies/cn-market", kind: "directory" });
  } finally {
    await f.done();
  }
});

test("a symlink loop and an unreadable folder are skipped and the walk goes on", async () => {
  const f = await fixture();
  try {
    const paths = (await walkRepository(f.root)).entries.map((e) => e.path);
    assert.ok(!paths.some((p) => p.startsWith("desk/loop")));
    assert.ok(!paths.includes("locked/secret.txt"));
    assert.ok(paths.includes("strategies/cn-market/journal.md"));
  } finally {
    await f.done();
  }
});

test("the walk stops at its cap", async () => {
  const f = await fixture();
  try {
    const r = await walkRepository(f.root, 3);
    assert.equal(r.entries.length, 3);
    assert.equal(r.truncated, true);
  } finally {
    await f.done();
  }
});

const E = (path: string, kind: FileEntry["kind"] = "file"): FileEntry => ({ path, kind });
const TREE = [
  E("desk/journal.txt"), E("strategies", "directory"), E("strategies/cn-market", "directory"),
  E("strategies/cn-market/journal.md"), E("strategies/cn-market/analysis", "directory"),
  E("strategies/cn-market/analysis/notes.md"), E("docs/injournal/readme.md"), E("a/b/my-journal.md"),
];

test("ranking: name prefix, then name substring, then path; the conversation's folder first", () => {
  const plain = rankFiles(TREE, "jou").map((e) => e.path);
  assert.deepEqual(plain, ["desk/journal.txt", "strategies/cn-market/journal.md", "a/b/my-journal.md", "docs/injournal/readme.md"]);
  const near = rankFiles(TREE, "JOU", "strategies/cn-market").map((e) => e.path);
  assert.equal(near[0], "strategies/cn-market/journal.md");
  assert.equal(rankFiles(TREE, "jou", undefined, 2).length, 2);
});

test("a query holding / lists that folder's children by prefix", () => {
  assert.deepEqual(folderEntries(TREE, "strategies/cn-market", "an"), [E("strategies/cn-market/analysis", "directory")]);
  assert.deepEqual(folderEntries(TREE, "strategies/cn-market", "").map((e) => e.path),
    ["strategies/cn-market/analysis", "strategies/cn-market/journal.md"]);
  assert.deepEqual(folderEntries(TREE, "", "").map((e) => e.path), ["strategies"]);
});

async function serve(routes: WebRoute[]): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const route = routes.find((r) => r.path === path);
    if (route === undefined) { res.writeHead(404); res.end(); return; }
    void route.handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

test("GET /data/files: the fence, bad queries, a hit, the folder forms, and the 30 s walk cache", async () => {
  const f = await fixture();
  let clock = 1_000_000;
  const routes: WebRoute[] = [];
  registerFileRoutes({ register: (route) => routes.push(route) }, { root: f.root, now: () => clock });
  assert.deepEqual(routes.map((r) => r.path), ["/data/files"]);
  const s = await serve(routes);
  const get = async (qs: string): Promise<{ status: number; body: any }> => {
    const r = await fetch(`${s.url}/data/files${qs}`);
    return { status: r.status, body: await r.json() };
  };
  try {
    const forged = await fetch(`${s.url}/data/files?q=x`, { headers: { origin: "https://evil.example.com" } });
    assert.equal(forged.status, 403);
    assert.equal(await forged.text(), '{"ok":false,"error":"forbidden"}');

    for (const qs of ["?dir=/etc", "?dir=../x", "?dir=a/../b", `?q=${"x".repeat(501)}`, "?q=a%00b"]) {
      const bad = await get(qs);
      assert.equal(bad.status, 400, qs);
      assert.deepEqual(bad.body, { ok: false, error: "bad query" });
    }

    const hit = await get("?q=jou");
    assert.equal(hit.status, 200);
    assert.equal(hit.body.ok, true);
    assert.equal(hit.body.truncated, false);
    assert.equal(hit.body.items[0].path, "strategies/cn-market/journal.md");

    const folder = await get("?q=strategies/cn-market/an");
    assert.deepEqual(folder.body.items, [{ path: "strategies/cn-market/analysis", kind: "directory" }]);
    const inDir = await get("?dir=strategies/cn-market");
    assert.deepEqual(inDir.body.items.map((e: FileEntry) => e.path), ["strategies/cn-market/analysis", "strategies/cn-market/journal.md"]);

    // A file made now is not seen inside the cache window, and is after it.
    await writeFile(join(f.root, "desk/fresh.md"), "x");
    clock += FILES_CACHE_MS - 1;
    assert.equal((await get("?q=fresh")).body.items.length, 0);
    clock += 2;
    assert.equal((await get("?q=fresh")).body.items.length, 1);
  } finally {
    await s.close();
    await f.done();
  }
});
