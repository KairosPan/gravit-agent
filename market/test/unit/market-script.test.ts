import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** `npm run market` reads the repo's .env.ifind when it exists: the script's own command form, run on a fixture env file in place of the
 * real one and a fixture script in place of the server, hands the file's variables to the process — and goes on without the file */
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const script = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> }).scripts.market!;

const run = (envFile: string) => {
  const [bin, ...args] = script.replace("../.env.ifind", envFile).replace("src/server.ts", "test/fixtures/print-env.ts").split(" ");
  const env = { ...process.env };
  delete env.MARKET_FIXTURE_TOKEN;
  return spawnSync(`node_modules/.bin/${bin!}`, args, { cwd: ROOT, env, encoding: "utf8" });
};

describe("the market script", () => {
  it("reads ../.env.ifind through --env-file-if-exists", () => {
    expect(script).toBe("tsx --env-file-if-exists=../.env.ifind src/server.ts");
  });
  it("hands an env file's variables to the process", () => {
    const r = run("test/fixtures/env-file.fixture");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("from-the-fixture");
  });
  it("goes on without the file", () => {
    const r = run("test/fixtures/no-such.fixture");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("unset");
  });
});
