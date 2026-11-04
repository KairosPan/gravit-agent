// face/tests/fixtures/mcp-standin.js
/**
 * A stdio MCP server for the desk's real-boot smokes (tests/desk-smoke.test.ts, tests/phone-smoke.test.ts)
 * only: the operator's `alpaca-kit` row as the desk meets it, with nothing behind it - no keys, no data, no
 * network. The smokes mount it through `@deepseek-ai/dsh-mcp-client`, the bridge the operator's row uses, so
 * dsh spawns it as a real stdio child: with dsh's scrubbed environment, through the version-negotiation probe,
 * and under dsh's own `mcp__<serverName>__<raw>` minting.
 *
 * Its tools are the four raw names the desk's allow list asks for (`DESK_ALLOW`'s `mcp__*__earnings`,
 * `mcp__*__daily_bars`, `mcp__*__calendar`, `mcp__*__corp_actions`, src/desk-preset.ts), each answering one
 * line, and `env_report`, which answers the NAMES - never a value - of this process's `TELEGRAM_*` variables,
 * so a smoke can tell whether the bot's token reached an MCP child.
 *
 * Hand-rolled, because the face's dependency closure has the MCP client SDK and no server SDK: one JSON-RPC
 * 2.0 message per line on stdin and stdout. It answers `initialize` (the legacy handshake), `ping`,
 * `tools/list` and `tools/call`, takes notifications silently, and answers any other request - the client's
 * `server/discover` probe among them, which then falls back to `initialize` - with "method not found".
 * Imports nothing but node:readline.
 */
import { createInterface } from "node:readline";

/** The protocol versions it accepts in `initialize`, newest first; it answers with the one it was asked for. */
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];

const NO_ARGUMENTS = { type: "object", properties: {} };

const TOOLS = [
  { name: "earnings", description: "stand-in for alpaca-kit's earnings read - nothing behind it" },
  { name: "daily_bars", description: "stand-in for alpaca-kit's daily bars read - nothing behind it" },
  { name: "calendar", description: "stand-in for alpaca-kit's market calendar read - nothing behind it" },
  { name: "corp_actions", description: "stand-in for alpaca-kit's corporate actions read - nothing behind it" },
  { name: "env_report", description: "the names, never the values, of this server's TELEGRAM_* environment variables" },
].map((tool) => ({ ...tool, inputSchema: NO_ARGUMENTS }));

/** Write one JSON-RPC message, one line. */
const send = (message) => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
};

/** One tool's answer, as `tools/call` returns it. */
function call(name) {
  if (name === "env_report") {
    const telegram = Object.keys(process.env).filter((key) => key.startsWith("TELEGRAM_")).sort();
    return { content: [{ type: "text", text: JSON.stringify({ telegram }) }] };
  }
  return { content: [{ type: "text", text: `${name}: stand-in, no data` }] };
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return; // not a message
  }
  if (message === null || typeof message !== "object" || message.id === undefined || typeof message.method !== "string") return; // a notification, or a response
  const { id, method, params } = message;
  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      send({
        id,
        result: {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "desk-mcp-standin", version: "0.0.0" },
        },
      });
      return;
    }
    case "ping":
      send({ id, result: {} });
      return;
    case "tools/list":
      send({ id, result: { tools: TOOLS } });
      return;
    case "tools/call": {
      const name = params?.name;
      if (TOOLS.some((tool) => tool.name === name)) send({ id, result: call(name) });
      else send({ id, error: { code: -32602, message: `unknown tool: ${String(name)}` } });
      return;
    }
    default:
      send({ id, error: { code: -32601, message: `method not found: ${method}` } });
  }
});
lines.on("close", () => {
  process.exit(0);
});
