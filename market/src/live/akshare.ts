/** The AKShare sidecar: `akshare-mcp` (a Python MCP server over AKShare, public A-share and other Chinese market data) run as the
 * Account's own MCP child over stdio. The pin, its fourteen tools and the install line (`uv tool install --python 3.12 --with 'mcp<2'`)
 * live in account/README.md; the command is MARKET_AKSHARE_BIN, else ~/.local/bin/akshare-mcp - argv only, never a shell.
 *
 * Started on use, not at boot: one child is shared by every caller while it lives; when it exits (or a start fails) it is forgotten and
 * the next ask starts a new one - no eager restart, no restart loop. A call that times out recycles the child (closed and forgotten), so a
 * blocked server loop cannot wedge every later ask. Its environment is an allowlist of the Account's (sidecarEnv), so the iFinD token and
 * every wallet or venue secret the Account holds never reach Python; its stderr is the Account's.
 *
 * Every ask - a cold start, the tool listing, the call - is bounded by one deadline (AKSHARE_CALL_MS). A timeout ends the ask; the child it
 * timed out on is closed (stdin ended, SIGTERM after the SDK's 2 s), so a Python call still running there dies with it. A reply whose content
 * serializes past AKSHARE_REPLY_MAX is refused; a tool's own error (isError) is an answer, not a refusal. */
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

export const AKSHARE_TOOLS: readonly string[] = [
  "akshare_discover",
  "akshare_stock_a",
  "akshare_stock_fundamental",
  "akshare_stock_hk_us",
  "akshare_stock_board_flow",
  "akshare_stock_margin_other",
  "akshare_macro",
  "akshare_futures",
  "akshare_fund",
  "akshare_bond",
  "akshare_index",
  "akshare_option",
  "akshare_fx_commodity",
  "akshare_other",
];
export const AKSHARE_CALL_MS = 120_000;
export const AKSHARE_REPLY_MAX = 4 * 1024 * 1024;
export const AKSHARE_ARGS_MAX = 16 * 1024;
const TOOL_NAME_MAX = 64;
/** the names the child is given from the Account's environment; every other name stays behind (a wallet's mnemonic, a venue's key) */
const PASSED = new Set(["PATH", "HOME", "USER", "LANG", "TMPDIR", "TMP", "TEMP", "SSL_CERT_FILE", "SSL_CERT_DIR", "FASTMCP_LOG_LEVEL"]);
const PROXY = new Set(["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]);
const passed = (k: string) => PASSED.has(k) || k.startsWith("LC_") || PROXY.has(k);
/** a proxy URL without its user:password@ */
const noUserinfo = (v: string) => v.replace(/^([a-z][a-z0-9+.-]*:\/\/)?[^/@]*@/i, "$1");

/** MARKET_AKSHARE_BIN when set and not empty, else the uv tool install's default place */
export function akshareCommand(env: NodeJS.ProcessEnv = process.env): string {
  return env.MARKET_AKSHARE_BIN || join(homedir(), ".local", "bin", "akshare-mcp");
}

/** The child's environment: an allowlist of the Account's own (PATH, HOME, USER, LANG and LC_*, the temp dirs, the TLS roots, the proxies
 * without their userinfo, FastMCP's log level), plus unbuffered Python and the server's row cap. Nothing else - no key, token or seed */
export function sidecarEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && passed(k)) out[k] = PROXY.has(k) ? noUserinfo(v) : v;
  out.PYTHONUNBUFFERED = "1";
  out.AKSHARE_MCP_MAX_ROWS = "500";
  return out;
}

export type AkshareWord = "off" | "unknown-tool" | "bad-arguments" | "unavailable" | "timeout" | "too-large";
export interface AkshareTool { name: string; description?: string; inputSchema: unknown }
export type AkshareAnswer<T> = { kind: "ok"; value: T } | { kind: "refused"; word: AkshareWord; message: string };
export interface AkshareCall { isError: boolean; content: unknown[] }
export interface Akshare {
  tools(signal?: AbortSignal): Promise<AkshareAnswer<AkshareTool[]>>;
  call(tool: string, args: unknown, signal?: AbortSignal): Promise<AkshareAnswer<AkshareCall>>;
  close(): Promise<void>;
}

interface Connected { client: Client; tools: AkshareTool[] }

const refused = (word: AkshareWord, message: string): AkshareAnswer<never> => ({ kind: "refused", word, message });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** a plain object (or nothing, read as {}), its serialization within the bound; null when it is not */
function plainArgs(args: unknown): Record<string, unknown> | null {
  if (args === undefined) return {};
  if (typeof args !== "object" || args === null || Array.isArray(args)) return null;
  const proto = Object.getPrototypeOf(args);
  if (proto !== Object.prototype && proto !== null) return null;
  let s: string | undefined;
  try { s = JSON.stringify(args); } catch { return null; }
  if (s === undefined || Buffer.byteLength(s, "utf8") > AKSHARE_ARGS_MAX) return null;
  return args as Record<string, unknown>;
}

/** p, or a rejection as soon as signal aborts */
function within<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function createAkshare(opts: { command: string; args?: string[]; env?: NodeJS.ProcessEnv; callMs?: number }): Akshare {
  const { command } = opts;
  const args = opts.args ?? [];
  const callMs = opts.callMs ?? AKSHARE_CALL_MS;
  let current: Promise<Connected> | null = null;

  /** one child, shared until it closes; its start has its own deadline, so one caller's abort never ends another's start */
  function start(): Promise<Connected> {
    const client = new Client({ name: "gravit-account", version: "0.1.0" });
    const transport = new StdioClientTransport({ command, args, env: sidecarEnv(opts.env ?? process.env), stderr: "inherit" });
    const p: Promise<Connected> = (async () => {
      const signal = AbortSignal.timeout(callMs);
      await client.connect(transport, { signal, timeout: callMs });
      const tools: AkshareTool[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor !== undefined ? { cursor } : undefined, { signal, timeout: callMs });
        for (const t of page.tools) tools.push({ name: t.name, ...(t.description !== undefined ? { description: t.description } : {}), inputSchema: t.inputSchema });
        cursor = page.nextCursor;
      } while (cursor);
      return { client, tools };
    })();
    current = p;
    client.onclose = () => { if (current === p) current = null; };
    p.catch(() => {
      if (current === p) current = null;
      void client.close().catch(() => {});
    });
    return p;
  }

  const isTimeout = (e: unknown, signal: AbortSignal) =>
    signal.aborted || (e instanceof McpError && e.code === ErrorCode.RequestTimeout) || (typeof e === "object" && e !== null && (e as { name?: unknown }).name === "TimeoutError");

  function refusal(e: unknown, signal: AbortSignal): AkshareAnswer<never> {
    if (isTimeout(e, signal)) {
      const why = signal.aborted && !(signal.reason instanceof DOMException && signal.reason.name === "TimeoutError") ? "the ask was aborted" : `no answer within ${callMs} ms`;
      return refused("timeout", `akshare-mcp (${command}): ${why}`);
    }
    if (e instanceof McpError && e.code === ErrorCode.InvalidParams) return refused("bad-arguments", `akshare-mcp (${command}): ${e.message}`);
    return refused("unavailable", `akshare-mcp (${command}) is unavailable: ${errText(e)}`);
  }

  async function ask<T>(caller: AbortSignal | undefined, work: (c: Connected, signal: AbortSignal) => Promise<AkshareAnswer<T>>): Promise<AkshareAnswer<T>> {
    const deadline = AbortSignal.timeout(callMs);
    const signal = caller ? AbortSignal.any([deadline, caller]) : deadline;
    let joined: Promise<Connected> | undefined;
    let c: Connected | undefined;
    try {
      joined = current ?? start();
      c = await within(joined, signal);
      return await within(work(c, signal), signal);
    } catch (e) {
      // a timeout on a child that was up recycles it: a blocked loop there must not wedge the next ask (a start that failed closed itself)
      // only on this ask's own deadline: a caller's abort leaves the shared child to its other in-flight calls
      if (c && isTimeout(e, signal) && !(caller?.aborted && !deadline.aborted)) {
        if (current === joined) current = null;
        void c.client.close().catch(() => {});
      }
      return refusal(e, signal);
    }
  }

  return {
    tools(signal) {
      return ask(signal, async (c) => ({ kind: "ok", value: c.tools }));
    },

    call(tool, rawArgs, signal) {
      if (typeof tool !== "string" || tool.length === 0 || tool.length > TOOL_NAME_MAX) return Promise.resolve(refused("unknown-tool", "the tool is not a name of at most 64 characters"));
      const params = plainArgs(rawArgs);
      if (!params) return Promise.resolve(refused("bad-arguments", `the arguments are not a plain object of at most ${AKSHARE_ARGS_MAX} bytes`));
      return ask(signal, async (c, s) => {
        if (!c.tools.some((t) => t.name === tool)) return refused("unknown-tool", `akshare-mcp has no tool ${tool}`);
        const r = await c.client.callTool({ name: tool, arguments: params }, undefined, { signal: s, timeout: callMs });
        const content = Array.isArray(r.content) ? (r.content as unknown[]) : [];
        if (Buffer.byteLength(JSON.stringify(content), "utf8") > AKSHARE_REPLY_MAX) return refused("too-large", `akshare-mcp's reply from ${tool} is past ${AKSHARE_REPLY_MAX} bytes`);
        return { kind: "ok", value: { isError: r.isError === true, content } };
      });
    },

    async close() {
      const p = current;
      current = null;
      if (!p) return;
      try {
        const { client } = await p;
        await client.close();
      } catch {
        // a start that failed has closed itself
      }
    },
  };
}
