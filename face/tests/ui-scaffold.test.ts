/** The redesign scaffold (`face/ui`) typechecks, rejects raw hex, and builds.
 *  It is a separate package: `npm ci` in `face/ui` once. It does not replace `npm start` or `npm run build`. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ui = fileURLToPath(new URL("../ui/", import.meta.url));

test("the redesign app lints, typechecks and builds", { timeout: 180_000 }, () => {
  assert.ok(
    existsSync(fileURLToPath(new URL("../ui/node_modules/vite/package.json", import.meta.url))),
    "face/ui dependencies are missing — run npm ci in face/ui",
  );
  const result = spawnSync("npm", ["run", "check"], { cwd: ui, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
