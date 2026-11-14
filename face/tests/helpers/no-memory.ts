/** Every test that boots a face imports this, right after `./no-market.ts`: since memory plan 1 a boot composes the
 * `mcp-memory` row, which spawns gravit-memory's door over `FACE_MEMORY_HOME` (default the owner's real
 * `~/.gravit-memory`), and in a test process a home outside the system's temporary directory is refused loudly
 * (src/memory.ts `assertHomeAllowed`). So no test face ever opens a real memory, this points `FACE_MEMORY_HOME`, on
 * import, at a home inside a directory of this run's own under `os.tmpdir()` - a home it does NOT make, so every
 * memory tool answers "no memory here" - turns the face's reconcile off (`FACE_MEMORY_RECONCILE=0`), and removes
 * the directory when the process exits. A child process started with `process.env` inherits both. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RUN_DIR = mkdtempSync(join(tmpdir(), "face-no-memory-"));
/** The home every test face points its memory row at; never created here. */
export const TEST_MEMORY_HOME = join(RUN_DIR, "home");
process.env.FACE_MEMORY_HOME = TEST_MEMORY_HOME;
process.env.FACE_MEMORY_RECONCILE = "0";
process.on("exit", () => { rmSync(RUN_DIR, { recursive: true, force: true }); });
