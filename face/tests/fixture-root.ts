import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative } from "node:path";

/** Throw when `path` lies under `/tmp` or `os.tmpdir()`, by real path (D24).
 *  dsh's `workspace-write` preset grants both as writable roots
 *  (`@deepseek-ai/dsh-sandbox` `writableRoots`), so a smoke that proves a write is REFUSED
 *  passes for the wrong reason from a checkout living under either. The real boots call this on the
 *  checkout (or the fixture root) they fence; the desk, telegram, watch and schedule smokes
 *  name the same precondition in `face/README.md`. */
export function assertOutsideTempRoots(path: string): void {
  const real = realpathSync(path);
  for (const root of ["/tmp", tmpdir()]) {
    let base: string;
    try { base = realpathSync(root); } catch { continue; }
    const rel = relative(base, real);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
      throw new Error("run the real boots from a checkout outside /tmp and $TMPDIR: dsh's workspace-write grants both (dsh-sandbox writableRoots), so a fence test there passes for the wrong reason");
    }
  }
}
