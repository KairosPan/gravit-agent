// compose.yml at the repo root: the three boxes (the spec's §5 and §7), read offline.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

const composeFile = fileURLToPath(new URL("../../compose.yml", import.meta.url));

type Service = {
  ports: string[];
  expose: string[];
  depends_on: Record<string, { condition: string }>;
  healthcheck: { test: string[] };
  environment: Record<string, string>;
  volumes: unknown[];
  working_dir: string;
  env_file: unknown;
  tmpfs: unknown;
};
type Compose = { services: Record<string, Service>; volumes: Record<string, unknown> };

test("compose.yml runs the face, the account and the market as three boxes, the agent box without the Account's home or a docker socket", async () => {
  const c = load(await readFile(composeFile, "utf8")) as Compose;
  assert.deepEqual(Object.keys(c.services).sort(), ["account", "agent", "market"]);
  assert.deepEqual(c.services.market.expose, ["4821"]);
  assert.equal(c.services.market.ports, undefined);
  assert.ok(Object.values(c.services).every(s => (s.ports ?? []).every(p => !/482[01]/.test(String(p)))), "no service publishes 4820 or 4821");
  assert.match(c.services.market.healthcheck.test.join(" "), /4821\/api\/health/);
  assert.equal(c.services.market.environment.MARKET_BIND, "0.0.0.0");
  assert.equal(c.services.market.environment.MARKET_HOSTS, "market:4821");
  assert.deepEqual(c.services.market.env_file, [{ path: ".env.ifind", required: false }]);
  assert.equal(c.services.account.env_file, undefined);
  assert.equal(c.services.account.environment.PORTFOLIO_MARKET_URL, "http://market:4821");
  assert.equal(c.services.account.depends_on.market.condition, "service_healthy");
  assert.equal(c.services.market.volumes, undefined);
  assert.deepEqual(c.services.agent.ports, ["127.0.0.1:3090:3090"]);
  assert.equal(c.services.account.ports, undefined);
  assert.deepEqual(c.services.account.expose, ["4820"]);
  assert.ok(Object.values(c.services).every(s => (s.ports ?? []).every(p => !String(p).includes("4820"))), "no service publishes 4820");
  assert.equal(c.services.agent.depends_on.account.condition, "service_healthy");
  assert.match(c.services.account.healthcheck.test.join(" "), /\/api\/overview/);
  assert.equal(c.services.account.environment.PORTFOLIO_BIND, "0.0.0.0");
  assert.equal(c.services.account.environment.PORTFOLIO_HOSTS, "account:4820");
  /* rc.5's webserver refuses a wildcard bind: compose sets no FACE_BIND, the entrypoint binds the container's own address. */
  assert.equal(c.services.agent.environment.FACE_BIND, undefined);
  assert.match(readFileSync(new URL("../docker-entrypoint.sh", import.meta.url), "utf8"), /FACE_BIND:=\$\(hostname -i/);
  assert.equal(c.services.agent.environment.FACE_ACCOUNT_URL, "http://account:4820");
  assert.equal(c.services.agent.environment.FACE_MARKET_URL, "http://market:4821");
  assert.equal(c.services.agent.depends_on.market.condition, "service_healthy");
  assert.equal(c.services.agent.environment.BUYER_HOME, "/seat-home");
  assert.equal(c.services.agent.environment.DSH_HOME, "/dsh-home");
  assert.equal(c.services.agent.environment.FACE_AKSHARE_MCP_COMMAND, undefined);
  assert.deepEqual(c.services.agent.env_file, [{ path: ".env.deepseek", required: false }]);
  assert.ok(Object.keys(c.services.agent.environment).every(k => !k.startsWith("IFIND")));
  const agentMounts = c.services.agent.volumes.map(String);
  // An allowlist of the tree at its own host path, never the root: compose runs at the repo
  // root, so `./<name>` is the repo's and `${PWD}` is the same directory as the shell sees it.
  assert.ok(agentMounts.every(v => !v.startsWith(".:") && !v.startsWith("./:")), "no mount of the repo root");
  assert.ok(agentMounts.every(v => !v.includes(".env")), "no .env path in the box");
  for (const name of ["face", "strategies", "bots", "roles"]) {
    assert.ok(agentMounts.includes(`./${name}:\${PWD}/${name}`), `${name} read-write`);
  }
  for (const name of ["account", "market", "dsh", "docs", "GRAVIT.md", "CLAUDE.md", "AGENTS.md", "Gravit-Design.md", "DEVELOPMENT.md", "ROADMAP.md"]) {
    assert.ok(agentMounts.includes(`./${name}:\${PWD}/${name}:ro`), `${name} read-only`);
  }
  const accountBind = agentMounts.filter(v => v.startsWith("./account:"));
  assert.deepEqual(accountBind, ["./account:${PWD}/account:ro"]);
  assert.deepEqual(c.services.agent.tmpfs, ["${PWD}/.git:ro"]);
  assert.equal(c.services.agent.working_dir, "${PWD}/face");
  assert.ok(agentMounts.includes("face-modules:${PWD}/face/node_modules"));
  assert.ok(agentMounts.includes("account-modules:${PWD}/account/node_modules"));
  assert.ok(agentMounts.includes("./market:${PWD}/market:ro"));
  assert.ok(agentMounts.includes("market-modules:${PWD}/market/node_modules"));
  assert.ok("market-modules" in c.volumes);
  assert.match(readFileSync(new URL("../docker-entrypoint.sh", import.meta.url), "utf8"), /for dir in \.\.\/face \.\.\/account \.\.\/market/);
  assert.ok(agentMounts.every(v => !v.includes("docker.sock") && !v.includes("account-home")));
  assert.ok(agentMounts.some(v => v.startsWith("face-modules:")) && agentMounts.some(v => v.startsWith("account-modules:")));
  assert.deepEqual(Object.keys(c.volumes).sort(), ["account-home", "account-modules", "dsh-home", "face-modules", "market-modules", "seat-home"]);
});

test("the agent image and the account image carry no AKShare, the market image carries it at the pin", async () => {
  const faceFile = await readFile(fileURLToPath(new URL("../Dockerfile", import.meta.url)), "utf8");
  const accountFile = await readFile(fileURLToPath(new URL("../../account/Dockerfile", import.meta.url)), "utf8");
  const marketFile = await readFile(fileURLToPath(new URL("../../market/Dockerfile", import.meta.url)), "utf8");
  assert.doesNotMatch(faceFile, /akshare|astral\.sh|uv tool|--python/i);
  assert.doesNotMatch(accountFile, /akshare|astral\.sh|uv tool/i);
  assert.ok(marketFile.includes("uv tool install --python 3.12 --with 'mcp<2'"));
  assert.ok(marketFile.includes("git+https://github.com/xiaozhozho/akshare-mcp.git@9b6a22b6d83cce2a996a5072743bb06686040ce0"));
  assert.ok(marketFile.includes("MARKET_AKSHARE_BIN=/usr/local/bin/akshare-mcp"));
  assert.ok(marketFile.indexOf("uv tool install") < marketFile.indexOf("COPY package.json"), "the install layer comes before the source copy");
});

/* Gravit reads a PDF with Poppler's command-line tools (dsh UI port spec §5.6): the agent box installs
 * them from Debian, right after FROM, in one layer that drops the apt lists it fetched. */
test("the agent image installs poppler-utils from the distribution, in one layer that cleans its lists", async () => {
  const faceFile = await readFile(fileURLToPath(new URL("../Dockerfile", import.meta.url)), "utf8");
  const layer = "RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*";
  const lines = faceFile.split("\n");
  const from = lines.findIndex((line) => line.startsWith("FROM "));
  assert.ok(from >= 0, "the image has a FROM");
  assert.equal(lines.filter((line) => line.startsWith("RUN ") && line.includes("poppler-utils")).length, 1, "one layer installs Poppler");
  assert.equal(lines.slice(from + 1).find((line) => line.startsWith("RUN ")), layer, "the first RUN after FROM is the Poppler layer");
  assert.match(lines.slice(0, from).join("\n"), /Poppler/, "the header comment names Poppler as Gravit's PDF tool");
});
