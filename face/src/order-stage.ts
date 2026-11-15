/** A live order's signable card, raised on the Account before Gate 2 asks, and signed again when that card lapses.
 *
 * The seat's tool still runs only after `allowed-once`. Staging does not place. Beast, which would place with no
 * card, comes back as `wouldBe: "at once"` and the gate asks as it always has. A refusal or a timeout asks with
 * no card attached, which is the old flow.
 *
 * `POST /data/orders/drop` and `POST /data/orders/restage` are the page's: decline closes the staged card, and
 * Sign again raises a fresh one from the same instruction. A card the tool raised on its own is not dropped here.
 * @module
 */
import { HttpError, fencedPost, isTrustedDataRequest } from "./http.ts";
import type { RouteRegistrar } from "./static.ts";

const STAGE_MS = 2_500;

/** The one seat write that is staged into a signable card before Gate 2 asks. */
export function isLiveOrderTool(name: string): boolean {
  return name === "portfolio_live_order" || name.endsWith("__portfolio_live_order");
}

export interface StagedPayload {
  wouldBe: "card" | "at once";
  createdAt?: string;
  order?: Record<string, unknown>;
  id?: string;
  hash?: string;
  expiresAt?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Ask the Account to stage one live order. `undefined` when it cannot, in which case Gate 2 asks with no card. */
export async function stageLiveOrder(accountUrl: string, args: unknown, signal?: AbortSignal): Promise<StagedPayload | undefined> {
  if (!isRecord(args)) return undefined;
  let response: Response;
  try {
    response = await fetch(new URL("/api/account/stage-order", accountUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seat: "Gravit", order: args }),
      signal,
    });
  } catch {
    return undefined;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }
  if (!isRecord(body) || body.ok !== true || (body.wouldBe !== "card" && body.wouldBe !== "at once")) return undefined;
  const order = isRecord(body.order) ? body.order : undefined;
  if (body.wouldBe === "card" && (typeof body.id !== "string" || typeof body.hash !== "string")) return undefined;
  return {
    wouldBe: body.wouldBe,
    ...(typeof body.createdAt === "string" ? { createdAt: body.createdAt } : {}),
    ...(order ? { order } : {}),
    ...(typeof body.id === "string" ? { id: body.id } : {}),
    ...(typeof body.hash === "string" ? { hash: body.hash } : {}),
    ...(typeof body.expiresAt === "string" ? { expiresAt: body.expiresAt } : {}),
  };
}

/** The reason line Gate 2 keeps, with the staged payload in a fence the client strips before it titles the card. */
export function reasonWithStaged(reason: string, staged: StagedPayload | undefined): string {
  if (!staged) return reason;
  return `${reason}\n<<<staged ${JSON.stringify(staged)}>>>`;
}

async function postAccount(accountUrl: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(new URL(path, accountUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = isRecord(parsed) && isRecord(parsed.refusal) && typeof parsed.refusal.message === "string"
      ? parsed.refusal.message
      : `HTTP ${response.status}`;
    throw new HttpError(response.status, message);
  }
  return isRecord(parsed) ? parsed : {};
}

/**
 * `POST /data/orders/drop` and `POST /data/orders/restage`, behind the `/data` fence.
 * @param webServer - the host webserver.
 * @param accountUrl - the Account service.
 */
export function registerOrderStageRoutes(webServer: RouteRegistrar, accountUrl: () => string): void {
  const idOf = (body: Record<string, unknown>): string => {
    if (typeof body.id !== "string" || body.id.length < 1 || body.id.length > 80) throw new HttpError(400, "need an id");
    return body.id;
  };
  webServer.register({
    kind: "exact",
    path: "/data/orders/drop",
    handler: fencedPost(isTrustedDataRequest, async (body) => postAccount(accountUrl(), "/api/account/staged/drop", { id: idOf(body) })),
  });
  webServer.register({
    kind: "exact",
    path: "/data/orders/restage",
    handler: fencedPost(isTrustedDataRequest, async (body) => postAccount(accountUrl(), "/api/account/staged/restage", { id: idOf(body) })),
  });
}

/** How long Gate 2 waits for a stage before it asks with no card. */
export const STAGE_DEADLINE_MS = STAGE_MS;
