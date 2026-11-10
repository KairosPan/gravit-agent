/** THE UNSIGNED DOOR (POST /api/account/act; the design 2026-11-09-sign-only-money §3, §5.1): the few owner acts a page that cannot sign
 * may still take — Account › Identity's four (connectNetwork, disconnectNetwork, setRouting, blockSender) and opening a paper account
 * (connectVenue whose connector is live:paper: a new paper book, or a kept one continued). They reach no money, no card, no limit, no device
 * and no paper account's record (its top-up and reset stay signed). Every other act is the signed door's alone (POST /api/exchange).
 *
 * Who can knock: any program on this machine (the server's fence turns away another site's page), Gravit's shell included — the accepted
 * residual of §6. The ledger's row of an unsigned act names its signer `local`, and a restart brings back only an unsigned row of one of
 * these types (restore.ts); a `local` row of any other type is skipped and said */
import { isAgentAction, isOwnerAction } from "./sign.ts";

/** the signer an unsigned act's ledger row names */
export const UNSIGNED_SIGNER = "local";

/** the five types the unsigned door takes; connectVenue only with connector live:paper */
export const UNSIGNED_TYPES: ReadonlySet<string> = new Set(["connectNetwork", "disconnectNetwork", "setRouting", "blockSender", "connectVenue"]);

/** the one connector an unsigned connectVenue may name */
export const UNSIGNED_CONNECTOR = "live:paper";

/** the fixed sentence for an act the unsigned door does not take */
export const signedOnly = (type: string): string => `"${type}" is signed: only a browser that signs for the account takes it`;

/** null when `action` may be taken unsigned; else why not, in one fixed sentence (a non-paper connectVenue names connectVenue) */
export function unsignedProblem(action: unknown): string | null {
  const type = action && typeof action === "object" ? (action as { type?: unknown }).type : undefined;
  // a type the account does not know is said as the signed door says it: never words the caller chose
  if (typeof type !== "string" || !(isOwnerAction({ type }) || isAgentAction({ type }))) return "not an instruction this account knows";
  if (!UNSIGNED_TYPES.has(type)) return signedOnly(type);
  if (type === "connectVenue" && (action as { connector?: unknown }).connector !== UNSIGNED_CONNECTOR) return signedOnly(type);
  return null;
}
