/** `GET /data/files`: the repository's files and folders for the page's `@` picker.
 *
 * {@link walkRepository} lists the tree once (cached for {@link FILES_CACHE_MS}); {@link rankFiles} answers a name
 * query and {@link folderEntries} a path under a folder. The walk never lists the key files (`.env*`), `.git`,
 * packages, build output or other worktrees, never follows a symbolic link, and goes on past a folder it cannot
 * read. Paths are repo-relative and "/"-separated. */

import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { FORBIDDEN, isTrustedDataRequest, send } from "./http.ts";
import type { RouteRegistrar } from "./static.ts";

export const FILES_WALK_MAX = 50_000;
export const FILES_ITEMS_MAX = 20;
export const FILES_CACHE_MS = 30_000;

export interface FileEntry { path: string; kind: "file" | "directory" }

const SKIP_NAMES = new Set([".git", "node_modules", "dist", "build"]);
const SKIP_PATHS = new Set([".claude/worktrees"]);

const skipped = (name: string, path: string): boolean =>
  SKIP_NAMES.has(name) || name.startsWith(".env") || SKIP_PATHS.has(path);

/**
 * Every file and folder under `root`, depth first with names sorted, up to `max` entries (`truncated` when more
 * remained). A symbolic link is skipped whole; a folder that cannot be read is listed but not entered.
 */
export async function walkRepository(root: string, max: number = FILES_WALK_MAX): Promise<{ entries: FileEntry[]; truncated: boolean }> {
  const entries: FileEntry[] = [];
  let truncated = false;

  const visit = async (rel: string): Promise<void> => {
    let names: string[];
    try {
      names = (await readdir(join(root, rel))).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const path = rel === "" ? name : `${rel}/${name}`;
      if (skipped(name, path)) continue;
      let kind: FileEntry["kind"];
      try {
        const st = await lstat(join(root, path));
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) kind = "directory";
        else if (st.isFile()) kind = "file";
        else continue;
      } catch {
        continue;
      }
      if (entries.length >= max) { truncated = true; return; }
      entries.push({ path, kind });
      if (kind === "directory") {
        await visit(path);
        if (truncated) return;
      }
    }
  };

  await visit("");
  return { entries, truncated };
}

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const depth = (path: string): number => path.split("/").length;

/**
 * Entries matching `q`, case-insensitively, in three tiers: the base name starts with it, the base name holds it,
 * the path holds it. Within a tier, entries under `dir` come first, then fewer path segments, then the path.
 */
export function rankFiles(entries: readonly FileEntry[], q: string, dir?: string, limit: number = FILES_ITEMS_MAX): FileEntry[] {
  const needle = q.toLowerCase();
  const under = dir === undefined || dir === "" ? undefined : `${dir}/`;
  const ranked: { e: FileEntry; tier: number; near: number }[] = [];
  for (const e of entries) {
    const base = baseName(e.path).toLowerCase();
    const tier = base.startsWith(needle) ? 0 : base.includes(needle) ? 1 : e.path.toLowerCase().includes(needle) ? 2 : -1;
    if (tier < 0) continue;
    ranked.push({ e, tier, near: under !== undefined && e.path.startsWith(under) ? 0 : 1 });
  }
  ranked.sort((a, b) =>
    a.tier - b.tier || a.near - b.near || depth(a.e.path) - depth(b.e.path) || (a.e.path < b.e.path ? -1 : a.e.path > b.e.path ? 1 : 0));
  return ranked.slice(0, limit).map((r) => r.e);
}

/** The direct children of `folder` (`""` is the root) whose names start with `prefix`: folders first, then files, each alphabetical. */
export function folderEntries(entries: readonly FileEntry[], folder: string, prefix: string, limit: number = FILES_ITEMS_MAX): FileEntry[] {
  const head = folder === "" ? "" : `${folder}/`;
  const needle = prefix.toLowerCase();
  const kids = entries.filter((e) =>
    e.path.startsWith(head) && !e.path.slice(head.length).includes("/") && baseName(e.path).toLowerCase().startsWith(needle));
  kids.sort((a, b) =>
    (a.kind === b.kind ? 0 : a.kind === "directory" ? -1 : 1) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return kids.slice(0, limit);
}

const BAD_QUERY = '{"ok":false,"error":"bad query"}';
const FAILED = '{"ok":false,"error":"listing failed"}';

/** A `dir` is repo-relative: not absolute, no `..` segment, no NUL. */
const validDir = (dir: string): boolean =>
  !dir.startsWith("/") && !dir.includes("\0") && !dir.split(/[\\/]/).includes("..");

/**
 * Mount `GET /data/files?q=&dir=`: 403 when the request is untrusted, 400 for a bad `q` (over 500 characters or a
 * NUL) or `dir`, else `{ok: true, items, truncated}`; any throw is a 500 with a fixed line.
 * @param webServer - the host webserver service, or a test recorder.
 * @param deps - `root`, the repository root; `now`, the clock the walk's cache reads.
 */
export function registerFileRoutes(webServer: RouteRegistrar, deps: { root: string; now?: () => number }): void {
  const now = deps.now ?? Date.now;
  let cached: { at: number; walk: Promise<{ entries: FileEntry[]; truncated: boolean }> } | undefined;

  const walked = (): Promise<{ entries: FileEntry[]; truncated: boolean }> => {
    if (cached === undefined || now() - cached.at >= FILES_CACHE_MS) {
      const walk = walkRepository(deps.root);
      const mine = { at: now(), walk };
      cached = mine;
      walk.catch(() => { if (cached === mine) cached = undefined; });
    }
    return cached.walk;
  };

  webServer.register({
    kind: "exact",
    path: "/data/files",
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!isTrustedDataRequest(req)) return send(res, 403, FORBIDDEN);
      const params = new URL(req.url ?? "", "http://localhost").searchParams;
      const q = params.get("q") ?? "";
      const dir = params.get("dir")?.replace(/\/+$/, "");
      if (q.length > 500 || q.includes("\0") || (dir !== undefined && !validDir(dir))) return send(res, 400, BAD_QUERY);
      try {
        const { entries, truncated } = await walked();
        const slash = q.lastIndexOf("/");
        const items = slash >= 0 ? folderEntries(entries, q.slice(0, slash), q.slice(slash + 1))
          : q === "" ? folderEntries(entries, dir ?? "", "")
          : rankFiles(entries, q, dir);
        return send(res, 200, { ok: true, items, truncated });
      } catch {
        return send(res, 500, FAILED);
      }
    },
  });
}
