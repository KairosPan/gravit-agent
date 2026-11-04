/** A NETWORK'S TOKEN FILE — `<home>/credentials/networks/<network>.json`, {"token","botId","username","operatorId","operatorHandle"}: the
 * one place a network's token is kept. Readable by the user alone (0600) in a folder only the user can open (0700, set again each time),
 * written whole (a fresh temporary file "wx" 0600, flushed, renamed over the old one), and never through a link — neither the credentials
 * folder, nor the networks folder, nor the file may be one. It follows the brains' key file (account/brain-keys.ts) step for step, with
 * its own words. It is read through live/credentials.ts readSecretFile (inside the home, 0600), and any refusal reads as no token. */
import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, renameSync, rmSync, writeSync, type Stats } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { isRefusal, type Refusal } from "../../core/errors.ts";
import { readSecretFile } from "../live/credentials.ts";
import { no } from "../refuse.ts";
import { NETWORKS, type Network } from "./kinds.ts";

export interface NetworkSecret {
  token: string;
  botId: string;
  username: string;
  operatorId: string;
  operatorHandle: string;
}

export const NETWORK_SECRET_DIR = "credentials/networks";
export const networkSecretRef = (network: Network): string => `${NETWORK_SECRET_DIR}/${network}.json`;

const FIELDS = ["token", "botId", "username", "operatorId", "operatorHandle"] as const;

const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};
const lstatOf = (p: string): Stats | undefined => {
  try {
    return lstatSync(p);
  } catch {
    return undefined;
  }
};
const known = (network: string): network is Network => (NETWORKS as readonly string[]).includes(network);
const badNetwork = (): Refusal => no("E_ACCOUNT_BAD_ACTION", { message: `the network is one the account speaks on (${NETWORKS.join(", ")})` });

/** the networks' token folder, made if it is not there (0700, set again each time); neither it nor the credentials folder may be a link */
function networksDir(home: string, network: Network): string | Refusal {
  const root = realpathSync(resolve(home));
  const credentials = join(root, "credentials");
  const dir = join(credentials, "networks");
  for (const p of [credentials, dir]) {
    const st = lstatOf(p);
    if (st?.isSymbolicLink()) return no("E_ACCOUNT_CREDENTIAL", { venue: network, message: `${relative(root, p)} in the home is a link: a network's token is not written through one. Make it a plain folder and connect again` });
    if (st && !st.isDirectory()) return no("E_ACCOUNT_CREDENTIAL", { venue: network, message: `${relative(root, p)} in the home is not a folder: a network's token cannot be written there` });
    if (!st) mkdirSync(p, { mode: 0o700 });
  }
  chmodSync(dir, 0o700);
  if (!inside(root, realpathSync(dir))) return no("E_ACCOUNT_CREDENTIAL", { venue: network, message: "the networks' token folder leads out of the home: a network's token is not written" });
  return dir;
}

/** Write a network's token file whole. A link where the file should be is refused (never followed, never replaced). Answers the file's
 * absolute path. */
export function writeNetworkSecret(home: string, network: Network, content: NetworkSecret): { ok: true; file: string } | Refusal {
  if (!known(network)) return badNetwork();
  const dir = networksDir(home, network);
  if (isRefusal(dir)) return dir;
  const file = join(dir, `${network}.json`);
  const st = lstatOf(file);
  if (st?.isSymbolicLink()) return no("E_ACCOUNT_CREDENTIAL", { venue: network, message: `${networkSecretRef(network)} is a link: a network's token is not written through one. Remove it and connect again` });
  if (st && !st.isFile()) return no("E_ACCOUNT_CREDENTIAL", { venue: network, message: `${networkSecretRef(network)} is not a file: a network's token cannot be written there` });
  const text = `${JSON.stringify({ token: content.token, botId: content.botId, username: content.username, operatorId: content.operatorId, operatorHandle: content.operatorHandle })}\n`;
  const tmp = join(dir, `.${network}.json.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const fd = openSync(tmp, "wx", 0o600);
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  try {
    const d = openSync(dir, "r");
    try {
      fsyncSync(d);
    } finally {
      closeSync(d);
    }
  } catch {
    // a folder that cannot be flushed on this system: the file itself was
  }
  return { ok: true, file };
}

/** Take a network's token file away: removed if it is there; a link is refused as it is for writing */
export function removeNetworkSecret(home: string, network: Network): { ok: true; removed: boolean } | Refusal {
  if (!known(network)) return badNetwork();
  const root = realpathSync(resolve(home));
  for (const p of [join(root, "credentials"), join(root, NETWORK_SECRET_DIR)]) {
    if (lstatOf(p)?.isSymbolicLink()) return no("E_ACCOUNT_CREDENTIAL", { venue: network, message: `${relative(root, p)} in the home is a link: a network's token is not removed through one` });
  }
  const file = join(root, networkSecretRef(network));
  const st = lstatOf(file);
  if (!st) return { ok: true, removed: false };
  if (st.isSymbolicLink()) return no("E_ACCOUNT_CREDENTIAL", { venue: network, message: `${networkSecretRef(network)} is a link: a network's token is not removed through one` });
  if (!st.isFile()) return no("E_ACCOUNT_CREDENTIAL", { venue: network, message: `${networkSecretRef(network)} is not a file` });
  rmSync(file);
  return { ok: true, removed: true };
}

/** Read a network's token file: inside the home, a plain file, 0600, every field a non-empty string — or undefined */
export function readNetworkSecret(home: string, network: Network): NetworkSecret | undefined {
  if (!known(network)) return undefined;
  const root = resolve(home);
  // no link on the way: the folders are checked as the writer checks them
  for (const p of [join(root, "credentials"), join(root, NETWORK_SECRET_DIR), join(root, networkSecretRef(network))]) if (lstatOf(p)?.isSymbolicLink()) return undefined;
  const file = readSecretFile(home, networkSecretRef(network), network, "Connect the network on Account › Identity");
  if ("ok" in file) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.text);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const p = parsed as Record<string, unknown>;
  for (const f of FIELDS) if (typeof p[f] !== "string" || (p[f] as string) === "") return undefined;
  return { token: p.token as string, botId: p.botId as string, username: p.username as string, operatorId: p.operatorId as string, operatorHandle: p.operatorHandle as string };
}
