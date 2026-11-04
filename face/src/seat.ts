/** `/data/seat.json`: the Account seat's standing for the screen (spec
 * 2026-10-20 §5.4). The face reads the Account's own `GET /api/account` — a
 * plain loopback fetch, no Origin, which the Account's fence answers to any
 * local process — and reduces it to what the seat box draws: the service
 * reachable or not, the seat absent / knocking / admitted / expired / revoked
 * with its limits, the venues with the paper ones marked, the cards waiting
 * for the owner under the face's Account › Cards. The seat is found by the NAME the owner typed when
 * admitting it (`face/src/account-seat.ts` ACCOUNT_SEAT_NAME): the face never
 * reads the seat's key file, and this route touches no key and no home.
 *
 * The read is the proxy's (spec 2026-10-22 §5.2): the route reads through an
 * {@link AccountReader} — the one `registerAccountProxy` returns, which
 * `main.ts` hands it, so this route and `/data/account` share one upstream
 * read — and keeps no cache and no flight of its own. A 2xx answer is served
 * for {@link SEAT_TTL_MS}, the proxy's `account` route's TTL; `?fresh=1` — the
 * flag `/data/account` takes too — skips it and never joins a plain read
 * already in flight: it asks again once that one settles, so the read after a
 * receipt sees the card the receipt announced; plain reads share one fetch,
 * fresh reads share one fetch.
 *
 * Failure is a state, not an error: an unreachable, refusing, hanging or
 * unreadable service answers `reachable: false` with the failure's CODE
 * (`ECONNREFUSED`, `timeout` — the headers or the body past the abort —,
 * `http 403`, `unreadable`), never its text, and nothing is served stale — the
 * service's absence is the fact to show; a failure is never kept, so the next
 * read asks again. A seat row the operator disabled answers `disabled` and
 * asks nothing. The seat it describes carries 34 real-account tools: the
 * wallet's reads, waits, words and writes, and a connected venue's own bars
 * and book; the market's public reads are the `mcp-market` row's
 * (src/market-row.ts), not the seat's. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { ACCOUNT_TTL_MS, codeOf, createAccountReader, type AccountAnswer, type AccountReader } from "./account-proxy.ts";
import { ACCOUNT_SEAT_NAME, seatUrl } from "./account-seat.ts";
import { FORBIDDEN, isTrustedDataRequest } from "./http.ts";
import type { RouteRegistrar } from "./static.ts";

/** How long one answer is served without asking the Account again: the proxy's `account` route's, whose
 * cache this route reads through. */
export const SEAT_TTL_MS = ACCOUNT_TTL_MS.account;
/** How long the Account may take to answer the reader this route makes when it is handed none: its
 * `/api/account` settles venue polls for up to 3 s. */
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

/** `unknown`: a listed key whose status the face does not know — never read as admitted. */
export type SeatStatus = "absent" | "knocking" | "admitted" | "expired" | "revoked" | "unknown";

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
  /** The seat's name at the Account (the face's Account › Agents); default `Gravit`. */
  seatName?: string;
  /** The Account's `GET /api/account` through the proxy's cache: `main.ts` hands the one
   * `registerAccountProxy` returns. None: the route makes its own from `url`, `fetch`, `now` and `timeoutMs`. */
  reader?: AccountReader;
  /** The fetch of the reader the route makes when it is handed none. */
  fetch?: typeof fetch;
  now?: () => number;
  /** The abort of the reader the route makes when it is handed none; default {@link SEAT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** The composed `mcp-account` row is disabled: the route answers `disabled` and never asks the Account. */
  disabled?: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** A time as the Account sends it — an ISO string (`exchange.ts:1488` at 133b9a7) — or a number, in milliseconds. */
const ms = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
};
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

  /* The Account keeps retired keys in `keys[]` and appends a new one when a
   * seat is re-admitted under the same name (`state.ts:360-366` at 133b9a7),
   * so the standing is the best of the name's keys: an `ok` key, else a
   * request knocking (a new key beside an old one), else an expired one, else
   * a revoked one, else a listed key whose status the face does not know —
   * never read as admitted. The limits and the cards are that key's, by
   * address: a retired key's are not the seat's. */
  const named = keys.filter((k) => sameName(k.name, seatName));
  const knocking = requests.some((r) => sameName(r.name, seatName));
  const key = named.find((k) => k.status === "ok")
    ?? (knocking ? undefined : named.find((k) => k.status === "expired") ?? named.find((k) => k.status === "revoked") ?? named[0]);
  let status: SeatStatus = knocking && key === undefined ? "knocking" : "absent";
  let address: string | undefined;
  let validUntil: number | undefined;
  if (key !== undefined) {
    status = key.status === "ok" ? "admitted" : key.status === "expired" ? "expired" : key.status === "revoked" ? "revoked" : "unknown";
    address = str(key.address);
    validUntil = ms(key.validUntil) ?? undefined;
  }
  const own = (row: Record<string, unknown>): boolean =>
    address !== undefined && typeof row.agent === "string" && row.agent.toLowerCase() === address.toLowerCase();

  const limits: SeatLimit[] = spend.filter(own).map((l) => {
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
      validUntil: ms(l.validUntil),
      expired: l.expired === true,
    };
  });

  const mine = cards.filter(own);
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
    /* The Account's `stale` is its words for why (`exchange.ts:1661` at 133b9a7: `stale?: string`), `true` on a holdings row. */
    if (v.stale === true || (typeof v.stale === "string" && v.stale.trim() !== "")) row.stale = true;
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

/** Mount `GET /data/seat.json` on the host webserver. */
export function registerSeatRoute(webServer: RouteRegistrar, deps: SeatDeps = {}): void {
  const url = (deps.url ?? seatUrl()).replace(/\/+$/, "");
  const seatName = deps.seatName ?? ACCOUNT_SEAT_NAME;
  const now = deps.now ?? Date.now;
  const reader = deps.reader ?? createAccountReader({ url, fetch: deps.fetch, now, abortMs: { account: deps.timeoutMs ?? SEAT_TIMEOUT_MS } });

  const unreachable = (error: string): string => JSON.stringify({ ok: true, url, reachable: false, error } satisfies SeatView);

  /** The reader's answer reduced to the box's view. Never rejects: a reader that does is its failure's code. */
  const read = async (fresh: boolean): Promise<string> => {
    let answer: AccountAnswer;
    try {
      answer = await reader.read(fresh);
    } catch (err) {
      return unreachable(codeOf(err));
    }
    if ("unreachable" in answer) return unreachable(answer.unreachable);
    if (answer.status !== 200) return unreachable(`http ${answer.status}`);
    let account: unknown;
    try {
      account = JSON.parse(answer.body);
    } catch {
      return unreachable("unreadable");
    }
    return JSON.stringify(seatView(account, seatName, url, now()));
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
      if (deps.disabled === true) return send(res, 200, unreachable("disabled"));
      const fresh = /[?&]fresh=1(?:&|$)/.test(req.url ?? "");
      return send(res, 200, await read(fresh));
    },
  });
}
