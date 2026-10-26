// face/plugins/lunhui/lib/fixture-fetch.mjs
/**
 * The one fixture mapping of the Lunhui market fixtures (spec §7 item 3): recorded Tencent and
 * Eastmoney replies served as `fetch` from one directory, never the network. The fixture directory is a row's
 * `config.fetch` now (spec 2026-10-25 A15); a row given one and the test helper
 * `tests/fixtures/lunhui/fetch.ts` both serve through it, so the tests and the rows read the same
 * files by the same rule:
 *
 * - a URL whose host is `qt.gtimg.cn` gets `quotes.gb18030.txt` as raw bytes;
 * - a URL whose host is `web.ifzq.gtimg.cn` and whose `param` starts with `<symbol>,` (the
 *   provider grammar, `sh` or `sz` and six digits) gets `kline-<symbol>.json`;
 * - a URL whose host is `push2ex.eastmoney.com` gets the pool its path names: `/getTopicZTPool`
 *   `zt-pool.json`, `/getTopicZBPool` `zb-pool.json`, `/getYesterdayZTPool` `yesterday-pool.json`;
 * - a URL whose host is `push2.eastmoney.com` and whose path is `/api/qt/clist/get` gets the file
 *   its `fs` names (a `+` in the query reads as a space): `m:90 t:3` with a `fid0` parameter
 *   `board-flow.json`, `m:90 t:3 f:!50` `boards.json`, `b:<board code>…` `members-<code>.json`,
 *   the all-shares `fs` AKShare's `stock_zh_a_spot_em` sends `counts-page-<pn>.json`;
 * - any other URL, an unparsable one, or a file the directory does not hold gets a 404.
 *
 * Any other read error is thrown as Node raised it. `init` (signal, redirect, headers) is accepted
 * and ignored: a file answers at once.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The provider grammar of a symbol, so `param` can never name a path outside the directory. */
const KLINE_PARAM = /^((?:sh|sz)\d{6}),/;

/** The pool endpoints' files, by path. */
const POOL_FILES = new Map([
  ["/getTopicZTPool", "zt-pool.json"],
  ["/getTopicZBPool", "zb-pool.json"],
  ["/getYesterdayZTPool", "yesterday-pool.json"],
]);
const BOARDS_FS = "m:90 t:3 f:!50";
const FLOW_FS = "m:90 t:3";
/** A board's member list; the code's grammar keeps `fs` from naming a path outside the directory. */
const MEMBERS_FS = /^b:(BK\d{4})(?:$|[ +])/;
const ALL_SHARES_FS = "m:0 t:6,m:0 t:80,m:1 t:2,m:1 t:23,m:0 t:81 s:2048";
const PAGE = /^[1-9]\d{0,3}$/;

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
    if (target.host === "push2ex.eastmoney.com" && POOL_FILES.has(target.pathname))
      return file(/** @type {string} */ (POOL_FILES.get(target.pathname)));
    if (target.host === "push2.eastmoney.com" && target.pathname === "/api/qt/clist/get") {
      const fs = target.searchParams.get("fs") ?? "";
      if (fs === BOARDS_FS) return file("boards.json");
      if (fs === FLOW_FS && target.searchParams.has("fid0")) return file("board-flow.json");
      const board = MEMBERS_FS.exec(fs)?.[1];
      if (board) return file(`members-${board}.json`);
      const page = target.searchParams.get("pn") ?? "";
      if (fs === ALL_SHARES_FS && PAGE.test(page)) return file(`counts-page-${page}.json`);
    }
    return notFound();
  };
}

function notFound() {
  return new Response("not found", { status: 404 });
}
