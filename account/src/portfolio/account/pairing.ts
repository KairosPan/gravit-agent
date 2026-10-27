/** THE PAIRING CODE: eight characters a person can read off a terminal and type — no 0/O, no 1/I/L. On a server that moves real money the
 * first browser becomes the owner's device only with it (account/exchange.ts pairDevice). It is made when the server starts, and made again
 * when the last device that signs for the account signs out (service.ts): a code seen before then lets no browser in afterwards */
import { randomBytes } from "node:crypto";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/** the bytes taken: below the largest multiple of the alphabet's length under 256, so that every character is as likely as any other */
const FAIR = 256 - (256 % ALPHABET.length);

export function pairingCode(): string {
  const chars: string[] = [];
  while (chars.length < 8) for (const b of randomBytes(16)) if (b < FAIR && chars.length < 8) chars.push(ALPHABET[b % ALPHABET.length]!);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}
