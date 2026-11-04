/** THE KINDS OF A MESSAGE, THE ROUTING ROWS AND QUIET HOURS — what the account decides before it sends anything to a network.
 *
 * Every message the account sends names its kind. A kind belongs to one routing row (the rows the Identity tab shows, in this order:
 * Chat with Gravit, Watch alerts, Pre-close brief, Cards waiting, Fills and reports), and the owner ticks, row by row, which connected
 * networks it goes to. The watchdog's notice is in no row: it goes to every connected network, because it says the rest is down.
 *
 * The owner signs the routing as one string — the rows in that order, `row=net,net` joined by `;`, the networks sorted, a row with none
 * written `row=` — so the dialog shows exactly what is written: `chat=telegram;alerts=telegram;brief=;cards=telegram;fills=telegram`.
 *
 * Quiet hours are a window on New York's wall clock, `from` to `to` (`to` not included; `from` after `to` crosses midnight). Inside it the
 * proactive kinds are held — an alert, a brief, a report, a card, a fill — and a held message is not sent later. A reply (`chat`), an
 * urgent alert and the watchdog's notice always go. */

/** the networks the account can speak on; B2 adds more */
export type Network = "telegram";
export const NETWORKS: readonly Network[] = ["telegram"];

export type PhoneKind = "chat" | "alert" | "urgent" | "brief" | "report" | "card" | "fill" | "watchdog";
export const PHONE_KINDS: readonly PhoneKind[] = ["chat", "alert", "urgent", "brief", "report", "card", "fill", "watchdog"];

export type RouteRow = "chat" | "alerts" | "brief" | "cards" | "fills";
export const ROUTE_ROWS: readonly RouteRow[] = ["chat", "alerts", "brief", "cards", "fills"];

export type Routing = Record<RouteRow, Network[]>;

const ROW_OF: Readonly<Record<PhoneKind, RouteRow | "always">> = {
  chat: "chat",
  alert: "alerts",
  urgent: "alerts",
  brief: "brief",
  card: "cards",
  fill: "fills",
  report: "fills",
  watchdog: "always",
};

/** the row a kind is routed by, or "always" for the watchdog's notice, which goes to every connected network */
export const rowOf = (kind: PhoneKind): RouteRow | "always" => ROW_OF[kind];

/** a routing with every row empty: nothing goes anywhere until the owner ticks a row */
export const emptyRouting = (): Routing => ({ chat: [], alerts: [], brief: [], cards: [], fills: [] });

const isNetwork = (s: string): s is Network => (NETWORKS as readonly string[]).includes(s);

/** Read the signed routing string. Answers the routing, or a string: the refusal's words. The rows must come in their order, each once;
 * the networks each be one the account knows, sorted, none twice. */
export function parseRouting(s: string): Routing | string {
  if (typeof s !== "string") return "the routing is a string: row=network,network for each row, joined by ;";
  const parts = s.split(";");
  if (parts.length !== ROUTE_ROWS.length) return `the routing names ${ROUTE_ROWS.length} rows, in this order: ${ROUTE_ROWS.join(", ")}`;
  const out = emptyRouting();
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as string;
    const eq = part.indexOf("=");
    if (eq < 0) return `each row of the routing is written row=network,network; "${part}" has no =`;
    const row = part.slice(0, eq);
    const want = ROUTE_ROWS[i] as RouteRow;
    if (row !== want) return `the routing's rows come in this order: ${ROUTE_ROWS.join(", ")} — row ${i + 1} is ${want}, not "${row}"`;
    const value = part.slice(eq + 1);
    const nets = value === "" ? [] : value.split(",");
    for (const n of nets) if (!isNetwork(n)) return `"${n}" is not a network the account speaks on (${NETWORKS.join(", ")})`;
    const sorted = [...nets].sort();
    if (new Set(nets).size !== nets.length) return `the ${row} row names a network twice`;
    if (sorted.join(",") !== nets.join(",")) return `the ${row} row's networks are written sorted`;
    out[row] = nets as Network[];
  }
  return out;
}

/** Write the routing as the string the owner signs: the rows in their order, the networks sorted */
export function formatRouting(r: Routing): string {
  return ROUTE_ROWS.map((row) => `${row}=${[...new Set(r[row] ?? [])].sort().join(",")}`).join(";");
}

/** Is the "HH:MM" a time of day? */
export const isClock = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const NEW_YORK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** the minute of the day on New York's wall clock */
function newYorkMinute(at: number): number {
  const parts = NEW_YORK.formatToParts(new Date(at));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return (hour % 24) * 60 + minute;
}

/** the kinds quiet hours never hold */
const ALWAYS_GOES: ReadonlySet<PhoneKind> = new Set<PhoneKind>(["chat", "urgent", "watchdog"]);

/** Do quiet hours hold a message of this kind back at this time? `quiet` null is off; so is a window whose two ends are not times of day
 * or are the same. A window with `from` after `to` crosses midnight; `to` is not part of it. */
export function quietHolds(kind: PhoneKind, at: number, quiet: { from: string; to: string } | null): boolean {
  if (ALWAYS_GOES.has(kind) || !quiet) return false;
  if (!isClock(quiet.from) || !isClock(quiet.to) || quiet.from === quiet.to) return false;
  const from = minutesOf(quiet.from);
  const to = minutesOf(quiet.to);
  const now = newYorkMinute(at);
  return from < to ? now >= from && now < to : now >= from || now < to;
}
