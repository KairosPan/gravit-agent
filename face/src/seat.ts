/** `/data/seat.json`: the Account seat's standing for the screen (spec
 * 2026-10-20 §5.4). The face reads the Account's own `GET /api/account` — a
 * plain loopback fetch, no Origin, which the Account's fence answers to any
 * local process — and reduces it to what the seat box draws: the service
 * reachable or not, the seat absent / knocking / admitted / expired / revoked
 * with its limits, the venues with the paper ones marked, the cards waiting
 * on the Account page. The seat is found by the NAME the owner typed when
 * admitting it (`face/src/account-seat.ts` ACCOUNT_SEAT_NAME): the face never
 * reads the seat's key file, and this route touches no key and no home.
 *
 * Failure is a state, not an error: an unreachable, refusing, hanging or
 * unreadable service answers `reachable: false` with the failure's CODE
 * (`ECONNREFUSED`, `timeout`, `http 403`, `unreadable`), never its text, and
 * nothing is served stale — the service's absence is the fact to show. Every
 * answer is cached for {@link SEAT_TTL_MS} (the unreachable one too, so a
 * hanging service costs one timeout a half-minute); `?fresh=1` skips the
 * cache, as the account route's Refresh does; concurrent reads share one
 * fetch. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { ACCOUNT_SEAT_NAME, seatUrl } from "./account-seat.ts";
import { isTrustedDataRequest } from "./data.ts";
import { FORBIDDEN } from "./http.ts";
import type { RouteRegistrar } from "./static.ts";

/** How long one answer is served without asking the Account again. */
export const SEAT_TTL_MS = 30_000;
/** How long the Account may take to answer: its `/api/account` settles venue polls for up to 3 s. */
export const SEAT_TIMEOUT_MS = 7_000;

export interface SeatLimit {
  scope: string;
  allow: string[];
  perOrderUsd: number | null;
  budgetUsd: number | null;
  spentUsd: number;
  reservedUsd: number;
  leftUsd: number | null;
  validUntil: number | null;
  expired: boolean;
}

export interface SeatVenue {
  id: string;
  name: string;
  paper: boolean;
  usd: number | null;
  frontLine?: string;
  stale?: boolean;
  notServed?: string;
}

export interface SeatCard {
  id: string;
  usd: number | null;
  reason?: string;
  expiresAt?: string;
}

export type SeatStatus = "absent" | "knocking" | "admitted" | "expired" | "revoked";

export interface SeatStanding {
  name: string;
  status: SeatStatus;
  address?: string;
  validUntil?: number;
  limits: SeatLimit[];
}

export interface SeatView {
  ok: true;
  url: string;
  reachable: boolean;
  error?: string;
  asOf?: string;
  mode?: "guard" | "open";
  writes?: { on: boolean; capUsd: number | null };
  cardMinutes?: number;
  seat?: SeatStanding;
  venues?: SeatVenue[];
  cards?: SeatCard[];
  others?: number;
}

export interface SeatDeps {
  /** The Account service; default `FACE_ACCOUNT_URL` or `http://127.0.0.1:4820`. */
  url?: string;
  /** The seat's name on the Account page; default `Gravit`. */
  seatName?: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const sameName = (v: unknown, name: string): boolean => typeof v === "string" && v.trim().toLowerCase() === name.trim().toLowerCase();

/** A limit's `allow`: the Account's list, or a comma-joined string as the owner typed it. */
function allowOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter((s) => s !== "");
  return [];
}

/** The Account's `/api/account` body reduced to the seat's standing. Total:
 * any shape gives a view — an odd one gives empty lists and `absent`. */
export function seatView(account: unknown, seatName: string, url: string, nowMs: number): SeatView {
  const a = isRecord(account) ? account : {};
  const keys = rows(a.keys);
  const requests = rows(a.requests);
  const spend = rows(a.spend);
  const cards = rows(a.cards);
  const venues = rows(a.venues);

  const key = keys.find((k) => sameName(k.name, seatName));
  let status: SeatStatus = "absent";
  let address: string | undefined;
  let validUntil: number | undefined;
  if (key !== undefined) {
    /* `ok | unknown | expired | revoked` are the Account's words for a key the
     * owner let in; `unknown` is one it has not yet seen act, still admitted. */
    status = key.status === "expired" ? "expired" : key.status === "revoked" ? "revoked" : "admitted";
    address = str(key.address);
    validUntil = num(key.validUntil) ?? undefined;
  } else if (requests.some((r) => sameName(r.name, seatName))) {
    status = "knocking";
  }

  const limits: SeatLimit[] = spend.filter((l) => sameName(l.agentName, seatName)).map((l) => {
    const budget = num(l.budgetUsd);
    const spent = num(l.spentUsd) ?? 0;
    const reserved = num(l.reservedUsd) ?? 0;
    return {
      scope: str(l.scope) ?? "",
      allow: allowOf(l.allow),
      perOrderUsd: num(l.perPaymentUsd),
      budgetUsd: budget,
      spentUsd: spent,
      reservedUsd: reserved,
      leftUsd: budget === null ? null : Math.max(0, budget - spent - reserved),
      validUntil: num(l.validUntil),
      expired: l.expired === true,
    };
  });

  const mine = cards.filter((c) => sameName(c.agentName, seatName));
  const seatCards: SeatCard[] = mine.map((c) => {
    const card: SeatCard = { id: str(c.id) ?? "", usd: num(c.usd) };
    const reason = str(c.reason);
    if (reason !== undefined) card.reason = reason;
    const expiresAt = str(c.expiresAt);
    if (expiresAt !== undefined) card.expiresAt = expiresAt;
    return card;
  });

  const venueRows: SeatVenue[] = venues.map((v) => {
    const id = str(v.id) ?? "";
    const row: SeatVenue = { id, name: str(v.name) ?? id, paper: v.paper === true, usd: num(v.usd) };
    const frontLine = str(v.frontLine);
    if (frontLine !== undefined) row.frontLine = frontLine;
    if (v.stale === true) row.stale = true;
    const said = isRecord(v.notServed) ? str(v.notServed.said) : undefined;
    if (said !== undefined) row.notServed = said;
    return row;
  });

  const writesRow = isRecord(a.connectLive) && isRecord(a.connectLive.writes) ? a.connectLive.writes : undefined;
  const view: SeatView = {
    ok: true,
    url,
    reachable: true,
    asOf: new Date(nowMs).toISOString(),
    writes: { on: writesRow?.on === true, capUsd: writesRow === undefined ? null : num(writesRow.capUsd) },
    seat: { name: seatName, status, limits },
    venues: venueRows,
    cards: seatCards,
    others: cards.length - mine.length,
  };
  if (a.mode === "guard" || a.mode === "open") view.mode = a.mode;
  const cardMinutes = isRecord(a.modeRules) ? num(a.modeRules.cardMinutes) : null;
  if (cardMinutes !== null) view.cardMinutes = cardMinutes;
  if (address !== undefined) view.seat!.address = address;
  if (validUntil !== undefined) view.seat!.validUntil = validUntil;
  return view;
}

/** A failure's code, bounded to a code's shape so no error text ever reaches the page. */
function codeOf(err: unknown): string {
  const e = err as { cause?: { code?: unknown }; code?: unknown; name?: unknown } | null;
  const code = e?.cause?.code ?? e?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,31}$/.test(code) ? code : "unreachable";
}

/** Mount `GET /data/seat.json` on the host webserver. */
export function registerSeatRoute(webServer: RouteRegistrar, deps: SeatDeps = {}): void {
  const url = (deps.url ?? seatUrl()).replace(/\/+$/, "");
  const seatName = deps.seatName ?? ACCOUNT_SEAT_NAME;
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? SEAT_TIMEOUT_MS;
  let cache: { body: string; at: number } | undefined;
  let flight: Promise<string> | undefined;

  const unreachable = (error: string): string => JSON.stringify({ ok: true, url, reachable: false, error } satisfies SeatView);

  const read = async (): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let body: string;
    try {
      const r = await doFetch(`${url}/api/account`, { signal: controller.signal, redirect: "error" });
      if (!r.ok) body = unreachable(`http ${r.status}`);
      else {
        let json: unknown;
        try {
          json = await r.json();
          body = JSON.stringify(seatView(json, seatName, url, now()));
        } catch {
          body = unreachable("unreadable");
        }
      }
    } catch (err) {
      body = unreachable(controller.signal.aborted ? "timeout" : codeOf(err));
    } finally {
      clearTimeout(timer);
    }
    cache = { body, at: now() };
    return body;
  };

  const send = (res: ServerResponse, status: number, body: string): void => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(body);
  };

  webServer.register({
    kind: "exact",
    path: "/data/seat.json",
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!isTrustedDataRequest(req)) return send(res, 403, FORBIDDEN);
      const fresh = /[?&]fresh=1(?:&|$)/.test(req.url ?? "");
      if (!fresh && cache !== undefined && now() - cache.at < SEAT_TTL_MS) return send(res, 200, cache.body);
      if (flight === undefined) flight = read().finally(() => { flight = undefined; });
      return send(res, 200, await flight);
    },
  });
}
