import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Plan A1 task 2: the keyless modules live in market/src/live now, not in the account */
describe("the market's modules moved out", () => {
  it("the moved modules are no longer in account/src", () => {
    for (const f of ["public-markets","stream-hub","china","akshare","cn-relay","cn-ifind","cn-http","prices","us-quotes","public-stocks","public-rwa","history-stocks","cn-history","cn-quotes","cn-rank","cn-search","cn-session"])
      expect(existsSync(new URL(`../../src/portfolio/live/${f}.ts`, import.meta.url))).toBe(false);
  });
});
