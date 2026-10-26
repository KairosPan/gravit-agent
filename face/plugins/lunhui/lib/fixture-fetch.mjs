// face/plugins/lunhui/lib/fixture-fetch.mjs
/**
 * The one fixture mapping of the Lunhui market fixtures (spec §7 item 3): recorded Tencent replies
 * served as `fetch` from one directory, never the network. The fixture directory is a row's
 * `config.fetch` now (spec 2026-10-25 A15); a row given one and the test helper
 * `tests/fixtures/lunhui/fetch.ts` both serve through it, so the tests and the rows read the same
 * files by the same rule:
 *
 * - a URL whose host is `qt.gtimg.cn` gets `quotes.gb18030.txt` as raw bytes;
 * - a URL whose host is `web.ifzq.gtimg.cn` and whose `param` starts with `<symbol>,` (the
 *   provider grammar, `sh` or `sz` and six digits) gets `kline-<symbol>.json`;
 * - any other URL, an unparsable one, or a file the directory does not hold gets a 404.
 *
 * Any other read error is thrown as Node raised it. `init` (signal, redirect, headers) is accepted
 * and ignored: a file answers at once.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The provider grammar of a symbol, so `param` can never name a path outside the directory. */
const KLINE_PARAM = /^((?:sh|sz)\d{6}),/;

/**
 * A `fetch` over the recorded replies in `dir`.
 * @param {string} dir the fixtures directory
 * @returns {(url: string | URL, init?: RequestInit) => Promise<Response>}
 */
export function createFixtureFetch(dir) {
  /** @param {string} name */
  async function file(name) {
    try {
      return new Response(new Uint8Array(await readFile(join(dir, name))));
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error)?.code === "ENOENT") return notFound();
      throw error;
    }
  }
  return async function fixtureFetch(url, _init) {
    let target;
    try {
      target = new URL(url);
    } catch {
      return notFound();
    }
    if (target.host === "qt.gtimg.cn") return file("quotes.gb18030.txt");
    if (target.host === "web.ifzq.gtimg.cn") {
      const symbol = KLINE_PARAM.exec(target.searchParams.get("param") ?? "")?.[1];
      if (symbol) return file(`kline-${symbol}.json`);
    }
    return notFound();
  };
}

function notFound() {
  return new Response("not found", { status: 404 });
}
