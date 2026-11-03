/** rc.5's webserver refuses every wildcard bind address at load
 * (@deepseek-ai/dsh-host-webserver: the unspecified address is rejected, and `webserver` is a required
 * startup id), so a face started with FACE_BIND=0.0.0.0 never boots. That is why the agent box's
 * entrypoint (docker-entrypoint.sh) binds the container's own address and compose.yml sets no
 * FACE_BIND; this pins the refusal, so a dsh that starts admitting the wildcard is noticed rather
 * than assumed. Own file, gated: one boot per process. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupFaceProfile } from "../src/setup.ts";
import { bootFace } from "../src/boot.ts";
import { makeBotsRoot } from "./bots-fixture.ts";

const gated = process.env.FACE_SMOKE !== "1";

test("bind smoke: bootFace with FACE_BIND=0.0.0.0 rejects, naming the webserver row", { skip: gated && "set FACE_SMOKE=1" }, async () => {
  const home = mkdtempSync(join(tmpdir(), "face-bindsmoke-"));
  const previous = process.env.FACE_BIND;
  const bots = await makeBotsRoot();
  try {
    setupFaceProfile(home);
    /* A scratch profile must not start the operator's Account seat. */
    const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
    const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
    writeFileSync(patchPath, `${patch}\n- id: mcp-account\n  disabled: true\n`);
    process.env.FACE_BIND = "0.0.0.0";
    await assert.rejects(
      bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: bots }),
      (error: Error) => /webserver/.test(error.message),
    );
  } finally {
    if (previous === undefined) delete process.env.FACE_BIND; else process.env.FACE_BIND = previous;
    rmSync(home, { recursive: true, force: true });
    rmSync(bots, { recursive: true, force: true });
  }
});
