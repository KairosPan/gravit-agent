/** The Account seat row (spec 2026-10-20 §5.1) as the box reads it: the COMPOSED
 * row - a patched URL or seat name, or a disabled row - not the environment. */
import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCOUNT_SEAT_NAME, ACCOUNT_SEAT_ROW_ID, DEFAULT_SEAT_DIR, DEFAULT_SEAT_URL, accountSeatPatches, composedSeatRow, type SeatEntryLike } from "../src/account-seat.ts";

const entry = (id: string, config: unknown, disabled: boolean | (() => boolean) = false): SeatEntryLike => ({
  options: { id, config },
  get disabled() { return typeof disabled === "function" ? disabled() : disabled; },
});

const own = (): { id: string; config: unknown } =>
  (accountSeatPatches("/x/buyer-agent-demo", "http://127.0.0.1:4820")[0] as unknown as { insert: { id: string; config: unknown }[] }).insert[0];

test("composedSeatRow: the box follows the composed row - the face's own, a patched URL and name, a disabled row, a throwing disabled, no row", () => {
  const row = own();
  assert.deepEqual(composedSeatRow([entry("webserver", {}), entry(row.id, row.config)]), { disabled: false, url: DEFAULT_SEAT_URL, seatName: ACCOUNT_SEAT_NAME });
  const patched = { ...(row.config as Record<string, unknown>), env: { PORTFOLIO_URL: "http://127.0.0.1:4999/", PORTFOLIO_AGENT: "Seat Two", BUYER_HOME: "/x/home" } };
  assert.deepEqual(composedSeatRow([entry(ACCOUNT_SEAT_ROW_ID, patched)]), { disabled: false, url: "http://127.0.0.1:4999/", seatName: "Seat Two" });
  assert.deepEqual(composedSeatRow([entry(ACCOUNT_SEAT_ROW_ID, row.config, true)]), { disabled: true });
  assert.deepEqual(composedSeatRow([entry(ACCOUNT_SEAT_ROW_ID, row.config, () => { throw new Error("!!js"); })]), { disabled: true });
  assert.equal(composedSeatRow([entry("webserver", {})]), undefined);
  assert.deepEqual(composedSeatRow([entry(ACCOUNT_SEAT_ROW_ID, { transport: "stdio", env: {} })]), { disabled: false, url: DEFAULT_SEAT_URL, seatName: ACCOUNT_SEAT_NAME }, "an env without the keys falls back to the defaults");
});

test("the seat's default directory is the repo's account/, not a home directory", () => {
  assert.equal(DEFAULT_SEAT_DIR, resolve(fileURLToPath(new URL("../../account", import.meta.url))));
  assert.ok(!DEFAULT_SEAT_DIR.startsWith(homedir() + "/buyer-agent-demo"));
});
