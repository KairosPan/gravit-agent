/** THE PAIRING CODE: eight characters a person can read off a terminal and type — no 0/O, no 1/I/L. On a server that moves real money the
 * first browser becomes the owner's device only with it (account/exchange.ts pairDevice). It is made when the server starts, and made again
 * when the last device that signs for the account signs out (service.ts): a code seen before then lets no browser in afterwards */
import { randomBytes } from "node:crypto";
import { noLinks } from "../identity/notices.ts";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/** the bytes taken: below the largest multiple of the alphabet's length under 256, so that every character is as likely as any other */
const FAIR = 256 - (256 % ALPHABET.length);

export function pairingCode(): string {
  const chars: string[] = [];
  while (chars.length < 8) for (const b of randomBytes(16)) if (b < FAIR && chars.length < 8) chars.push(ALPHABET[b % ALPHABET.length]!);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** A DEVICE'S CODE (account/exchange.ts pairDevice): once the account has an owner, a browser that waits to sign asks for a code of its own,
 * printed in the account's terminal and typed on that page. It lives in the account's memory only — never in its home — for ten minutes and
 * five wrong tries, and dies with the process */
export const DEVICE_CODE_MS = 600_000;
export const DEVICE_CODE_TRIES = 5;

/** the label a browser gives itself, cleaned before it is stored, printed in the terminal or sent to the phone: no control or format
 * characters, whitespace runs one space, every link defanged as a notice's is, at most 40 characters; nothing left is "this browser" */
export function cleanLabel(label: unknown): string {
  if (typeof label !== "string") return "this browser";
  const flat = label.slice(0, 400).replace(/\s+/g, " ").replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, "");
  const cut = Array.from(noLinks(flat).replace(/\s+/g, " ").trim()).slice(0, 40).join("").trim();
  return cut || "this browser";
}
