// compose.yml at the repo root: the two boxes (the spec's §5 and §7), read offline.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

const composeFile = fileURLToPath(new URL("../../compose.yml", import.meta.url));

type Service = {
  ports: string[];
  depends_on: Record<string, { condition: string }>;
  healthcheck: { test: string[] };
  environment: Record<string, string>;
  volumes: unknown[];
  working_dir: string;
};
type Compose = { services: Record<string, Service>; volumes: Record<string, unknown> };

test("compose.yml runs the face and the Account as two boxes, the agent box without the Account's home or a docker socket", async () => {
  const c = load(await readFile(composeFile, "utf8")) as Compose;
  assert.deepEqual(Object.keys(c.services).sort(), ["account", "agent"]);
  assert.deepEqual(c.services.agent.ports, ["127.0.0.1:3090:3090"]);
  assert.deepEqual(c.services.account.ports, ["127.0.0.1:4820:4820"]);
  assert.equal(c.services.agent.depends_on.account.condition, "service_healthy");
  assert.match(c.services.account.healthcheck.test.join(" "), /\/api\/overview/);
  assert.equal(c.services.account.environment.PORTFOLIO_BIND, "0.0.0.0");
  assert.equal(c.services.account.environment.PORTFOLIO_HOSTS, "account:4820");
  assert.equal(c.services.agent.environment.FACE_BIND, "0.0.0.0");
  assert.equal(c.services.agent.environment.FACE_ACCOUNT_URL, "http://account:4820");
  assert.equal(c.services.agent.environment.BUYER_HOME, "/seat-home");
  assert.equal(c.services.agent.environment.DSH_HOME, "/dsh-home");
  const agentMounts = c.services.agent.volumes.map(String);
  // The repo at its own host path: compose runs at the repo root, so the source `.` is the repo
  // and `${PWD}` is the same directory as the shell sees it.
  assert.ok(agentMounts.includes(".:${PWD}"));
  assert.equal(c.services.agent.working_dir, "${PWD}/face");
  assert.ok(agentMounts.includes("face-modules:${PWD}/face/node_modules"));
  assert.ok(agentMounts.includes("account-modules:${PWD}/account/node_modules"));
  assert.ok(agentMounts.every(v => !v.includes("docker.sock") && !v.includes("account-home")));
  assert.ok(agentMounts.some(v => v.startsWith("face-modules:")) && agentMounts.some(v => v.startsWith("account-modules:")));
  assert.deepEqual(Object.keys(c.volumes).sort(), ["account-home", "account-modules", "dsh-home", "face-modules", "seat-home"]);
});
