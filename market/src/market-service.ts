/** The market as a background service on this Mac, so that the account and the face can read it at any time: started when the user logs in,
 * started again if it stops by accident, its log where only the user can read it. macOS's own launchd runs it (a LaunchAgent in
 * ~/Library/LaunchAgents), and nothing about it needs an administrator. The operator installs it; an agent never does.
 *
 *   npm run market:service -- install                    run `npm run market` in the background, from now on
 *   npm run market:service -- status                     is it running, and does it answer
 *   npm run market:service -- restart                    start it again (after an update, or to pick up new code)
 *   npm run market:service -- logs                       the last lines it wrote
 *   npm run market:service -- uninstall                  stop it and take it out of launchd
 *
 * What it runs is the code in this folder: a change here reaches it on the next restart. The market keeps no state: a restart reads its
 * sources again. The iFinD token stays in the repo's gitignored .env.ifind: the LaunchAgent names that file's path (node's
 * --env-file-if-exists, read at each start), never its contents, and this installer never reads it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LABEL = "com.gravit.market";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface ServicePlan {
  plist: string;
  path: string;
  log: string;
  errLog: string;
  args: string[];
}

const d0 = (f: string): boolean => {
  try {
    return existsSync(f) && !f.includes("/node_modules/");
  } catch {
    return false;
  }
};
const xml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** the LaunchAgent for `npm run market -- <serverArgs>`: node and tsx by their full paths (launchd has no shell to find them), the repo's
 * .env.ifind by its path, this folder as the working directory, restarted when it exits by accident, a log only the user can read (umask 077) */
export function plan(serverArgs: string[], o: { node?: string; root?: string; repo?: string; logs?: string; env?: Record<string, string | undefined> } = {}): ServicePlan {
  const env = o.env ?? process.env;
  // node as the PATH finds it (Homebrew's /opt/homebrew/bin/node), not the versioned folder it resolves to: an upgrade does not break it
  const node = o.node ?? (env.PATH ?? "").split(":").map((d) => join(d, "node")).find((f) => d0(f)) ?? process.execPath;
  const root = o.root ?? ROOT;
  const repo = o.repo ?? dirname(root);
  const logs = o.logs ?? join(homedir(), "Library", "Logs", "gravit-market");
  const log = join(logs, "market.log");
  const errLog = join(logs, "market.err.log");
  // the same flag the `market` script passes: the token is read from the file at each start, and the plist holds only the file's path
  const args = [node, `--env-file-if-exists=${join(repo, ".env.ifind")}`, join(root, "node_modules", "tsx", "dist", "cli.mjs"), join(root, "src", "server.ts"), ...serverArgs];
  // the AKShare command is found where the user put it; the bind, the hosts, a token and everything else stay out
  // (without the folders npm puts first on PATH while it runs this script: they are npm's, not the user's)
  const path = (env.PATH ?? "").split(":").filter((d) => d !== "" && !d.includes("/node_modules/")).join(":");
  const keep = Object.fromEntries(Object.entries({ PATH: path, HOME: env.HOME ?? homedir(), MARKET_AKSHARE_BIN: env.MARKET_AKSHARE_BIN }).filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, string>;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(keep).map(([k, v]) => `    <key>${xml(k)}</key><string>${xml(v)}</string>`).join("\n")}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(errLog)}</string>
  <key>ProcessType</key><string>Standard</string>
</dict>
</plist>
`;
  return { plist, path: join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`), log, errLog, args };
}

const domain = (): string => `gui/${userInfo().uid}`;
const launchctl = (args: string[], quiet = false): string => {
  try {
    return execFileSync("launchctl", args, { encoding: "utf8", stdio: quiet ? ["ignore", "pipe", "ignore"] : ["ignore", "pipe", "pipe"] });
  } catch (err) {
    if (quiet) return "";
    throw err;
  }
};

/** the port the service listens on, as its arguments say (4821 unless --port) */
const portOf = (args: string[]): number => {
  const i = args.indexOf("--port");
  return i >= 0 ? Number(args[i + 1]) : 4821;
};

async function answers(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2_000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** the server's own options in the installed LaunchAgent (what follows server.ts in its ProgramArguments) */
function installed(): { args: string[] } | undefined {
  const p = plan([]).path;
  if (!existsSync(p)) return undefined;
  const block = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(readFileSync(p, "utf8"))?.[1] ?? "";
  const strings = [...block.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]!.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
  const i = strings.findIndex((s) => s.endsWith("/src/server.ts"));
  return { args: i >= 0 ? strings.slice(i + 1) : [] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd = "status", ...rest] = process.argv.slice(2);
  const p = plan(rest);
  if (cmd === "install") {
    if (process.platform !== "darwin") throw new Error("this installs a macOS LaunchAgent: on another system run `npm run market` under its own service manager");
    mkdirSync(dirname(p.log), { recursive: true, mode: 0o700 });
    mkdirSync(dirname(p.path), { recursive: true });
    // a running copy of an earlier install is taken out first: one service, one port
    launchctl(["bootout", `${domain()}/${LABEL}`], true);
    writeFileSync(p.path, p.plist, { mode: 0o644 });
    launchctl(["bootstrap", domain(), p.path]);
    launchctl(["enable", `${domain()}/${LABEL}`], true);
    console.log(`installed: ${p.path}\n  runs: npm run market -- ${rest.join(" ") || "(no options)"} — at login, and again if it stops by accident\n  log: ${p.log} (only you can read it)\n  the market is at http://127.0.0.1:${portOf(rest)} · npm run market:service -- status`);
  } else if (cmd === "uninstall") {
    launchctl(["bootout", `${domain()}/${LABEL}`], true);
    rmSync(p.path, { force: true });
    console.log("uninstalled: the market no longer runs in the background (it kept no state; its logs stay where they were)");
  } else if (cmd === "restart") {
    launchctl(["kickstart", "-k", `${domain()}/${LABEL}`]);
    console.log("restarted: it reads its sources again (the market keeps no state)");
  } else if (cmd === "logs") {
    for (const f of [p.log, p.errLog]) if (existsSync(f)) console.log(`== ${f}\n${readFileSync(f, "utf8").split("\n").slice(-40).join("\n")}`);
  } else {
    const info = launchctl(["print", `${domain()}/${LABEL}`], true);
    const state = /state = (\w+)/.exec(info)?.[1];
    const pid = /pid = (\d+)/.exec(info)?.[1];
    const port = portOf(installed()?.args ?? rest);
    console.log(info ? `${LABEL}: ${state ?? "loaded"}${pid ? ` (pid ${pid})` : ""} · ${(await answers(port)) ? `answering at http://127.0.0.1:${port}` : `not answering on ${port} yet`}` : `${LABEL}: not installed (npm run market:service -- install)`);
  }
}
