/** ATTEST (account/sign.ts attest): the account vouching that a device of its owner signed a sentence — `the owner attested <act>
 * <subject> for <service>` — for a service beside the account to act on. It moves no money, changes no setting and is read by no limit:
 * the ledger's two rows of it, the door's "taken" row and the outcome row with the sentence, are all it leaves. Signed only (the unsigned
 * door refuses it), taken within ATTEST_TTL_MS of its signing, and its four fields bounded before the "taken" row is written, so no long
 * text enters the hash-chained ledger. An attest is taken ONCE: the same envelope arriving again — in the same run, or after the account
 * restarts (the rebuild marks it taken) — is refused as a used nonce is, never answered from the first answer's cache as the other owner
 * types are, so a service that acts on the account's yes is never told yes twice for one signature. What the service does with the
 * account's yes is the service's own */

/** an attest is signed and sent at once: an envelope kept for later is refused */
export const ATTEST_TTL_MS = 600_000;

const SERVICE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const ACT = /^[a-z][a-z-]{1,23}$/;
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const DIGEST = /^[0-9a-f]{64}$/;

const fits = (value: unknown, shape: RegExp): boolean => typeof value === "string" && shape.test(value);

/** The sentence that refuses an attest whose fields are off their bounds, or undefined. Fixed words, which never repeat the value */
export function attestProblem(action: { service?: unknown; act?: unknown; subject?: unknown; digest?: unknown }): string | undefined {
  if (!fits(action.service, SERVICE)) return "attest names a service of 2 to 40 lower-case letters, digits or dashes";
  if (!fits(action.act, ACT)) return "attest names an act of 2 to 24 lower-case letters or dashes";
  if (!fits(action.subject, SUBJECT)) return "attest names a subject of 1 to 80 letters, digits or . _ : -";
  if (!fits(action.digest, DIGEST)) return "attest carries a digest of 64 lower-case hex digits";
  return undefined;
}

/** `the owner attested <act> <subject> for <service>`: the outcome row's reason and the answer's summary */
export function attestSentence(action: { service: string; act: string; subject: string }): string {
  return `the owner attested ${action.act} ${action.subject} for ${action.service}`;
}
