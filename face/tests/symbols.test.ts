// face/tests/symbols.test.ts
/** The desk's market grammar (src/symbols.ts): six digits are an A share, a capital-led ticker a US share, and
 * anything else neither; an id is `<market>:<symbol>`. The module imports nothing, so desk-tools.ts can route a
 * symbol without loading the book. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CN_SYMBOL_RE, SYMBOL_RE, idOf, marketOf } from "../src/symbols.ts";

test("marketOf reads six digits as an A share and refuses five", () => {
  assert.equal(marketOf("600519"), "cn");
  assert.equal(marketOf("NVDA"), "us");
  assert.equal(marketOf("BRK.B"), "us");
  assert.equal(marketOf("60051"), undefined);
  assert.equal(marketOf(600519), undefined);
  assert.equal(marketOf("sh600519"), undefined);
  assert.equal(marketOf("6005190"), undefined);
  assert.equal(marketOf(""), undefined);
  assert.equal(idOf("cn", "600519"), "cn:600519");
  assert.equal(idOf("us", "NVDA"), "us:NVDA");
  assert.equal(SYMBOL_RE.source, "^[A-Z][A-Z0-9.-]{0,9}$");
  assert.equal(CN_SYMBOL_RE.source, "^\\d{6}$");
});

test("symbols.ts imports nothing", async () => {
  const source = await readFile(new URL("../src/symbols.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import /m);
});
