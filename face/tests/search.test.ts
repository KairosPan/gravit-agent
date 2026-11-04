import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";
import { openSearchIndex } from "../src/search-index.ts";
import type { StoredEvent } from "../src/search-text.ts";
import { indexedIds, makeSearch, readEventsFrom, registerSearchRoutes, type StoredSession } from "../src/search.ts";

const ROOT = "/repo/workbench";

const session = (id: string, extra: Partial<StoredSession["header"]> = {}, top: Partial<StoredSession> = {}): StoredSession =>
  ({ header: { id, cwd: ROOT, ...extra }, revision: "r1", ...top });

const said = (seq: number, t: string): StoredEvent =>
  ({ type: "user/message", seq, time: seq * 1000, data: { message: { role: "user", content: [{ type: "text", text: t }] } } });

/** A fake store: sessions by id with their logs; `read` records every call. */
function fakeStore(initial: Record<string, { s: StoredSession; log: StoredEvent[] }>) {
  const store = new Map(Object.entries(initial));
  const reads: { id: string; from: number }[] = [];
  const deleted = new Set<string>();
  let failing = new Set<string>();
  let gate: Promise<void> | undefined;
  let listThrows = false;
  return {
    store, reads, deleted,
    fail(ids: string[]) { failing = new Set(ids); },
    setGate(p: Promise<void> | undefined) { gate = p; },
    listThrows(v: boolean) { listThrows = v; },
    deps(index = openSearchIndex(":memory:")) {
      return {
        root: ROOT,
        index,
        list: async () => {
          if (listThrows) throw new Error("listing failed");
          return [...store.values()].map((v) => v.s);
        },
        read: async (id: string, from: number) => {
          reads.push({ id, from });
          if (gate !== undefined) await gate;
          reads.push({ id: `${id}:done`, from });
          if (failing.has(id)) throw new Error("unreadable");
          return store.get(id)!.log.slice(from);
        },
        deleted: async () => deleted as ReadonlySet<string>,
      };
    },
  };
}

test("indexedIds keeps the face's own top-level conversations", () => {
  const stored = [
    session("gravit", { agentPreset: "gravit" }),
    session("fork", { agentPreset: "gravit", parentSession: "gravit" }),
    session("bot-home", { agentPreset: "news-scout" }),
    session("desk", { agentPreset: "gravit-desk" }),
    session("room", {}),
    session("child", { agentPreset: "gravit", parentSession: "gravit", origin: "subagent" }),
    session("member", { agentPreset: "drill-bull", parentSession: "room" }),
    session("gone", { agentPreset: "gravit" }),
    session("old", { agentPreset: "gravit" }, { formatStatus: "migration-required" }),
    session("elsewhere", { agentPreset: "gravit", cwd: "/other/project" }),
    session("sibling", { agentPreset: "gravit", cwd: `${ROOT}-copy` }),
    session("subdir", { agentPreset: "gravit", cwd: `${ROOT}/strategies/cn-market` }),
  ];
  assert.deepEqual(
    indexedIds(stored, ROOT, new Set(["gone"])),
    ["gravit", "fork", "bot-home", "desk", "room", "subdir"],
  );
});

test("reconcile reads a new conversation whole, then only what was appended", async () => {
  const f = fakeStore({ a: { s: session("a"), log: [said(1, "first words"), said(2, "second words")] } });
  const search = makeSearch(f.deps());
  assert.deepEqual(await search.reconcile(), { sessions: 1, skipped: 0 });
  f.store.get("a")!.log.push(said(3, "third words"));
  f.store.get("a")!.s.revision = "r2";
  await search.reconcile();
  assert.deepEqual(f.reads.filter((r) => !r.id.endsWith(":done")), [{ id: "a", from: 0 }, { id: "a", from: 2 }]);
  const r = await search.search("third");
  assert.deepEqual(r.items.map((i) => i.sessionId), ["a"]);
  assert.equal((await search.search("first")).items.length, 1);
});

test("an unchanged revision is not read", async () => {
  const f = fakeStore({ a: { s: session("a"), log: [said(1, "words")] } });
  const search = makeSearch(f.deps());
  await search.reconcile();
  await search.reconcile();
  assert.equal(f.reads.filter((r) => !r.id.endsWith(":done")).length, 1);
});

test("a log that shrank is read again from the start", async () => {
  const f = fakeStore({ a: { s: session("a"), log: [said(1, "alpha one"), said(2, "alpha two"), said(3, "alpha three")] } });
  const index = openSearchIndex(":memory:");
  const search = makeSearch(f.deps(index));
  await search.reconcile();
  const a = f.store.get("a")!;
  a.log = [said(1, "beta rewritten")];
  a.s.revision = "r2";
  a.s.eventCount = 1;
  await search.reconcile();
  assert.deepEqual(f.reads.filter((r) => !r.id.endsWith(":done")), [{ id: "a", from: 0 }, { id: "a", from: 0 }]);
  assert.equal(index.query("alpha").items.length, 0);
  assert.equal(index.query("beta").items.length, 1);
  assert.deepEqual(index.marks().get("a"), { revision: "r2", readCount: 1 });
});

test("a log that throws is skipped and counted; the others are indexed", async () => {
  const f = fakeStore({
    bad: { s: session("bad"), log: [said(1, "never seen")] },
    good: { s: session("good"), log: [said(1, "seen words")] },
  });
  const index = openSearchIndex(":memory:");
  const search = makeSearch(f.deps(index));
  f.fail(["bad"]);
  assert.deepEqual(await search.reconcile(), { sessions: 1, skipped: 1 });
  assert.equal(index.marks().has("bad"), false);
  assert.equal(index.query("seen").items.length, 1);
  f.fail([]);
  assert.deepEqual(await search.reconcile(), { sessions: 2, skipped: 0 });
  assert.equal(index.query("never").items.length, 1);
});

test("two searches at once run one reconcile at a time", async () => {
  const f = fakeStore({
    a: { s: session("a"), log: [said(1, "gamma a")] },
    b: { s: session("b"), log: [said(1, "gamma b")] },
  });
  const search = makeSearch(f.deps());
  let open!: () => void;
  f.setGate(new Promise<void>((resolve) => { open = resolve; }));
  const first = search.search("gamma");
  const second = search.search("gamma");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(f.reads.length, 1, "the second reconcile waits for the first");
  open();
  const [r1, r2] = await Promise.all([first, second]);
  for (let i = 0; i < f.reads.length; i += 2) {
    assert.equal(f.reads[i + 1]!.id, `${f.reads[i]!.id}:done`, "reads never interleave");
  }
  assert.equal(r1.items.length, 2);
  assert.equal(r2.items.length, 2);
});

test("a deleted conversation leaves the index at the next reconcile", async () => {
  const f = fakeStore({ a: { s: session("a"), log: [said(1, "delta words")] } });
  const index = openSearchIndex(":memory:");
  const search = makeSearch(f.deps(index));
  await search.reconcile();
  assert.equal(index.query("delta").items.length, 1);
  f.deleted.add("a");
  assert.deepEqual(await search.reconcile(), { sessions: 0, skipped: 0 });
  assert.equal(index.query("delta").items.length, 0);
  assert.equal(index.marks().has("a"), false);
});

test("readEventsFrom pages from an offset until an empty page, then disposes", async () => {
  const log = Array.from({ length: 1100 }, (_, i) => said(i + 1, `e${i}`));
  const calls: [number | undefined, number | undefined][] = [];
  let disposed = false;
  const persistence = {
    open: async (_id: string, _access: "read") => ({
      read: async (offset?: number, length?: number) => {
        calls.push([offset, length]);
        return { events: log.slice(offset ?? 0, (offset ?? 0) + (length ?? 0)) };
      },
      [Symbol.asyncDispose]: async () => { disposed = true; },
    }),
  };
  const events = await readEventsFrom(persistence, "a", 10);
  assert.equal(events.length, 1090);
  assert.equal(events[0]!.seq, 11);
  assert.deepEqual(calls, [[10, 512], [522, 512], [1034, 512], [1100, 512]]);
  assert.equal(disposed, true);
});

/** A bare server dispatching to the routes the registrar recorded, by exact path. */
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

test("GET /data/search: the fence, the query bounds, a Chinese hit, a failure", async () => {
  const f = fakeStore({ a: { s: session("a"), log: [said(1, "贵州茅台的估值很高")] } });
  const routes: WebRoute[] = [];
  registerSearchRoutes({ register: (route) => routes.push(route) }, makeSearch(f.deps()));
  assert.deepEqual(routes.map((r) => r.path), ["/data/search"]);
  const s = await serve(routes);
  try {
    const forged = await fetch(`${s.url}/data/search?q=x`, { headers: { origin: "https://evil.example.com" } });
    assert.equal(forged.status, 403);
    assert.equal(await forged.text(), '{"ok":false,"error":"forbidden"}');

    for (const q of ["", "x".repeat(501)]) {
      const bad = await fetch(`${s.url}/data/search?q=${q}`);
      assert.equal(bad.status, 400);
      assert.equal(await bad.text(), '{"ok":false,"error":"query must be 1-500 characters"}');
    }

    const hit = await fetch(`${s.url}/data/search?q=%E8%8C%85%E5%8F%B0`);
    assert.equal(hit.status, 200);
    const body = await hit.json() as { ok: boolean; items: { sessionId: string }[]; hasMore: boolean; indexed: unknown };
    assert.equal(body.ok, true);
    assert.equal(body.items[0]!.sessionId, "a");
    assert.equal(body.hasMore, false);
    assert.deepEqual(body.indexed, { sessions: 1, skipped: 0 });

    f.listThrows(true);
    const failed = await fetch(`${s.url}/data/search?q=abc`);
    assert.equal(failed.status, 500);
    assert.equal(await failed.text(), '{"ok":false,"error":"search failed"}');
  } finally {
    await s.close();
  }
});
