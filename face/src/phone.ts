// face/src/phone.ts
/**
 * The phone as the face reaches it: the account's identity half (account/src/portfolio/identity/), which holds the
 * networks, picks the recipients, the routing and quiet hours. Every desk send names its kind, and the account reads
 * the kind to route it; it cannot check who calls, so the face is exact:
 * - `chat` only for a reply to the operator's own text - it goes back to the network the text came from, and quiet
 *   hours never hold it;
 * - `watchdog` only from the watchdog (scripts/watchdog.ts) - it goes to every connected network;
 * - every other producer its own: `alert` (a watch alert, batch, late or lost line, annotation and the watch's own
 *   lines), `urgent` (an alert of a rule marked `urgent: true` - it goes through quiet hours), `brief` (the pre-close
 *   brief's firing), `report` (every other firing, the standing orders' lines, a wake turn's answer), `card` (Gate 2's
 *   notices), `fill` (the account's own).
 * A message id is `<network>:<the network's own id>` - `telegram:4821`.
 */

/** What a desk send is, as the account routes it (the account's `PHONE_KINDS`). */
export type PhoneKind = "chat" | "alert" | "urgent" | "brief" | "report" | "card" | "fill" | "watchdog";
