// face/tests/analog-symbols.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { AnalogError } from "../plugins/analog/lib/errors.mjs";
import { normalizeSymbol } from "../plugins/analog/lib/symbols.mjs";
import { UNIVERSE, UNIVERSE_AS_OF, UNIVERSE_RULE } from "../plugins/analog/lib/universe.mjs";

const code = (c: string) => (e: unknown) => e instanceof AnalogError && e.code === c && e.message.startsWith(`${c} `);

test("a ticker as people type it is read one way; anything else is BAD_SYMBOL", () => {
  assert.equal(normalizeSymbol(" nvda "), "NVDA");
  assert.equal(normalizeSymbol("brk.b"), "BRK.B");
  for (const bad of ["", "1ABC", "TOO-LONG-TICKER", "A B", 7, null, undefined]) assert.throws(() => normalizeSymbol(bad), code("BAD_SYMBOL"), String(bad));
});

test("the list of large companies: 30 to 100, each once, each as normalizeSymbol writes it, never SPY, dated and ruled", () => {
  assert.ok(UNIVERSE.length >= 30 && UNIVERSE.length <= 100, String(UNIVERSE.length));
  assert.equal(new Set(UNIVERSE).size, UNIVERSE.length);
  assert.equal(UNIVERSE.includes("SPY"), false);
  for (const symbol of UNIVERSE) assert.equal(normalizeSymbol(symbol), symbol);
  assert.match(UNIVERSE_AS_OF, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(UNIVERSE_RULE.length > 0);
  assert.ok(Object.isFrozen(UNIVERSE));
});
