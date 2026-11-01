import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { AKSHARE_TOOLS, akshareCommand, createAkshare, sidecarEnv, type Akshare, type AkshareAnswer, type AkshareCall } from "../../src/portfolio/live/akshare.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/fake-akshare-mcp.mjs", import.meta.url));
const SECRETS = { IFIND_ACCESS_TOKEN: "a", IFIND_REFRESH_TOKEN: "r", SOME_API_KEY: "k", DB_PASSWORD: "p", X_SECRET: "s" };

const open: Akshare[] = [];
const dirs: string[] = [];
function fake(opts: { env?: NodeJS.ProcessEnv; callMs?: number; command?: string } = {}): Akshare {
  const a = createAkshare({ command: opts.command ?? process.execPath, args: opts.command ? [] : [FIXTURE], env: opts.env ?? process.env, ...(opts.callMs !== undefined ? { callMs: opts.callMs } : {}) });
  open.push(a);
  return a;
}
function startLog(): string {
  const d = mkdtempSync(join(tmpdir(), "akshare-test-"));
  dirs.push(d);
  return join(d, "starts.log");
}
const lines = (f: string) => readFileSync(f, "utf8").split("\n").filter(Boolean);
function okText(r: AkshareAnswer<AkshareCall>): string {
  if (r.kind !== "ok") throw new Error(`refused ${r.word}: ${r.message}`);
  const c = r.value.content[0] as { type: string; text: string };
  return c.text;
}
const discover = async (a: Akshare) => JSON.parse(okText(await a.call("akshare_discover", {}))) as { pid: number; env: string[]; maxRows: string };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

afterEach(async () => {
  await Promise.all(open.splice(0).map((a) => a.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("the AKShare sidecar", () => {
  it("AKSHARE_TOOLS names the pin's fourteen tools", () => {
    expect(AKSHARE_TOOLS).toEqual([
      "akshare_discover", "akshare_stock_a", "akshare_stock_fundamental", "akshare_stock_hk_us", "akshare_stock_board_flow", "akshare_stock_margin_other",
      "akshare_macro", "akshare_futures", "akshare_fund", "akshare_bond", "akshare_index", "akshare_option", "akshare_fx_commodity", "akshare_other",
    ]);
  });

  it("akshareCommand reads PORTFOLIO_AKSHARE_BIN, else ~/.local/bin/akshare-mcp", () => {
    expect(akshareCommand({ PORTFOLIO_AKSHARE_BIN: "/opt/x" })).toBe("/opt/x");
    expect(akshareCommand({})).toBe(join(homedir(), ".local", "bin", "akshare-mcp"));
    expect(akshareCommand({ PORTFOLIO_AKSHARE_BIN: "" })).toBe(join(homedir(), ".local", "bin", "akshare-mcp"));
  });

  it("the child inherits no secret", async () => {
    const e = sidecarEnv({ PATH: "/bin", ifind_access_token: "x", ...SECRETS, KEEP: "1" });
    expect(e).toEqual({ PATH: "/bin", KEEP: "1", PYTHONUNBUFFERED: "1", AKSHARE_MCP_MAX_ROWS: "500" });
    const d = await discover(fake({ env: { ...process.env, ...SECRETS } }));
    for (const k of ["PATH", "HOME", "PYTHONUNBUFFERED", "AKSHARE_MCP_MAX_ROWS"]) expect(d.env).toContain(k);
    for (const k of Object.keys(SECRETS)) expect(d.env).not.toContain(k);
    expect(d.maxRows).toBe("500");
  });

  it("tools lists the child's tools", async () => {
    const r = await fake().tools();
    if (r.kind !== "ok") throw new Error(r.message);
    expect(r.value.map((t) => t.name)).toEqual(["akshare_discover", "akshare_stock_a"]);
    for (const t of r.value) expect(t.inputSchema).toBeTruthy();
  });

  it("a call answers the child's content unchanged", async () => {
    const a = fake();
    const r = await a.call("akshare_stock_a", { method: "stock_zh_a_spot_tx" });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.value.isError).toBe(false);
    expect(r.value.content).toEqual([{ type: "text", text: okText(r) }]);
    expect(JSON.parse(okText(r)).rows[0].名称).toBe("贵州茅台");
    const f = await a.call("akshare_stock_a", { method: "fails" });
    expect(f).toEqual({ kind: "ok", value: { isError: true, content: [{ type: "text", text: "{\"error\":\"upstream refused\"}" }] } });
  });

  it("an unknown tool or bad arguments are refused before the child is asked", async () => {
    const a = fake();
    const u = await a.call("akshare_nope", {});
    expect(u.kind === "refused" && u.word).toBe("unknown-tool");
    expect(u.kind === "refused" && u.message).toContain("akshare_nope");
    for (const bad of [[], "x", { params_json: "y".repeat(17 * 1024) }]) {
      const r = await a.call("akshare_stock_a", bad);
      expect(r.kind === "refused" && r.word).toBe("bad-arguments");
    }
    const d = await a.call("akshare_discover", undefined);
    expect(d.kind).toBe("ok");
  });

  it("two calls on a cold sidecar start one child", async () => {
    const log = startLog();
    const a = fake({ env: { ...process.env, FAKE_AKSHARE_START_LOG: log } });
    const [x, y] = await Promise.all([discover(a), discover(a)]);
    expect(x.pid).toBe(y.pid);
    expect(lines(log)).toHaveLength(1);
  });

  it("a child that exits mid-call is unavailable, and the next call starts a new one", async () => {
    const log = startLog();
    const a = fake({ env: { ...process.env, FAKE_AKSHARE_START_LOG: log } });
    const first = await discover(a);
    const t0 = Date.now();
    const r = await a.call("akshare_stock_a", { method: "exit" });
    expect(r.kind === "refused" && r.word).toBe("unavailable");
    expect(Date.now() - t0).toBeLessThan(2_000);
    const next = await discover(a);
    expect(next.pid).not.toBe(first.pid);
    expect(lines(log)).toHaveLength(2);
  });

  it("a missing command is unavailable, quickly, and is tried again next time", async () => {
    const a = fake({ command: "/nonexistent/akshare-mcp" });
    for (const ask of [() => a.tools(), () => a.call("akshare_discover", {}), () => a.call("akshare_discover", {})]) {
      const t0 = Date.now();
      const r = await ask();
      expect(Date.now() - t0).toBeLessThan(1_000);
      expect(r.kind === "refused" && r.word).toBe("unavailable");
      expect(r.kind === "refused" && r.message).toContain("/nonexistent/akshare-mcp");
    }
  });

  it("the deadline bounds the whole ask", async () => {
    const a = fake({ callMs: 300 });
    await discover(a); // the child is warm: the 300 ms bound the sleep, not the start
    const t0 = Date.now();
    const r = await a.call("akshare_stock_a", { method: "sleep" });
    expect(r.kind === "refused" && r.word).toBe("timeout");
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect((await a.call("akshare_discover", {})).kind).toBe("ok");
  });

  it("an abort ends the ask", async () => {
    const a = fake();
    await discover(a);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    const t0 = Date.now();
    const r = await a.call("akshare_stock_a", { method: "sleep" }, ac.signal);
    expect(r.kind === "refused" && r.word).toBe("timeout");
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("a reply past 4 MiB is refused", async () => {
    const r = await fake().call("akshare_stock_a", { method: "flood" });
    expect(r.kind === "refused" && r.word).toBe("too-large");
  });

  it("close ends the child", async () => {
    const a = fake();
    const { pid } = await discover(a);
    await a.close();
    const until = Date.now() + 2_000;
    while (alive(pid) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    expect(alive(pid)).toBe(false);
    const again = await discover(a);
    expect(again.pid).not.toBe(pid);
  });
});
