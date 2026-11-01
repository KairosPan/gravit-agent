/** OWNERS CHECK — before the Account's own page is retired: does the face sign for the Account the operator runs? It reads the `signers` of
 * `GET /api/account` (the owners, the devices waiting) and says one of three things:
 *
 *   ownerless   no owner yet: retiring the page locks nobody out, the face pairs as the first owner
 *   face-signs  an owner device carries the face's pairing label (a hint, not a proof)
 *   stop        owners exist and none is the face's, or the shape cannot be read, or the Account did not answer
 *
 *   npm run account:owners                    http://127.0.0.1:4820
 *   npm run account:owners -- --url <origin>  another Account
 *
 * One read of one route. It prints each owner as `kind · label` and the count of devices waiting: no key, no id, no kid. Exit 0 for
 * ownerless and face-signs, 3 for stop.
 */
import { fileURLToPath } from "node:url";

export type OwnerVerdict = "ownerless" | "face-signs" | "stop";

/** the label the face pairs its owner device under (face/client/js/host/owner.js) */
export const FACE_DEVICE_LABEL = "Gravit face";
export const DEFAULT_ACCOUNT_URL = "http://127.0.0.1:4820";

export const SENTENCE: Record<OwnerVerdict, string> = {
  ownerless: "No owner yet: retiring the page locks nobody out. The face pairs as the first owner with the code the Account prints.",
  "face-signs": 'A device labelled Gravit face is an owner. A label is a hint, not a proof: open the face\'s Account screen and check that its device line reads "This page signs for the account" before the page goes.',
  stop: "STOP: no owner device is the face's. Before the page goes, let the face in from the page's Settings › Devices (the face asks under Settings › Devices first), or sign the page's device out there so that the Account prints a new code the face pairs with. Never --fresh: it throws away the owner, the venues, the agents and their limits.",
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** a one-line label: control characters and line breaks folded to spaces, so a label cannot break the printout */
const oneLine = (s: string): string => s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();

export function ownerStanding(signers: unknown): { verdict: OwnerVerdict; lines: string[] } {
  const unreadable = { verdict: "stop" as const, lines: ["The Account's signers could not be read.", SENTENCE.stop] };
  if (!isObj(signers) || !Array.isArray(signers.owners)) return unreadable;
  const owners: Array<{ kind: string; label: string }> = [];
  for (const o of signers.owners) {
    if (!isObj(o) || typeof o.kind !== "string" || typeof o.label !== "string") return unreadable;
    owners.push({ kind: oneLine(o.kind), label: oneLine(o.label) });
  }
  const waiting = Array.isArray(signers.pendingDevices) ? signers.pendingDevices.length : 0;
  const lines = owners.length ? owners.map((o) => `${o.kind} · ${o.label}`) : ["no owner"];
  lines.push(`devices waiting: ${waiting}`);
  const verdict: OwnerVerdict = !owners.length ? "ownerless" : owners.some((o) => o.kind === "device" && o.label === FACE_DEVICE_LABEL) ? "face-signs" : "stop";
  lines.push(SENTENCE[verdict]);
  return { verdict, lines };
}

export async function checkOwners({ url = DEFAULT_ACCOUNT_URL, fetch: doFetch = fetch }: { url?: string; fetch?: typeof fetch } = {}): Promise<{ verdict: OwnerVerdict; lines: string[] }> {
  const silent = { verdict: "stop" as const, lines: [`The Account at ${url} did not answer: start it (npm run account) and run this again`] };
  try {
    const res = await doFetch(`${url.replace(/\/+$/, "")}/api/account`);
    if (!res.ok) return silent;
    const body: unknown = await res.json();
    return ownerStanding(isObj(body) ? body.signers : undefined);
  } catch {
    return silent;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const url = args.includes("--url") ? args[args.indexOf("--url") + 1] : undefined;
  const r = await checkOwners(url ? { url } : {});
  process.stdout.write(`${r.lines.join("\n")}\n`);
  process.exit(r.verdict === "stop" ? 3 : 0);
}
