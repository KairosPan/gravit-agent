import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertOutsideTempRoots } from "./fixture-root.ts";

const MESSAGE = "run the real boots from a checkout outside /tmp and $TMPDIR: dsh's workspace-write grants both (dsh-sandbox writableRoots), so a fence test there passes for the wrong reason";

test("assertOutsideTempRoots refuses a path under os.tmpdir(), through a symlink too", () => {
  const dir = mkdtempSync(join(tmpdir(), "face-fixture-root-"));
  const away = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), "tmp-away-"));
  try {
    mkdirSync(join(dir, "sub"));
    assert.throws(() => assertOutsideTempRoots(join(dir, "sub")), { message: MESSAGE });
    const link = join(away, "link");
    symlinkSync(dir, link);
    assert.throws(() => assertOutsideTempRoots(link), { message: MESSAGE }, "the real path decides, not the spelling");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(away, { recursive: true, force: true });
  }
});

test("assertOutsideTempRoots admits the repository's own face/tests/tmp", () => {
  /* gitignored, so a fresh clone has none until a smoke makes it: create it rather than depend on order */
  const dir = join(dirname(fileURLToPath(import.meta.url)), "tmp");
  mkdirSync(dir, { recursive: true });
  assertOutsideTempRoots(dir);
});
