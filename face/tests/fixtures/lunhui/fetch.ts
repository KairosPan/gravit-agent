/**
 * The Lunhui market fixtures served as `fetch`, never the network, through the one fixture
 * mapping a freeze row's `config.fetch` uses too (spec 2026-10-25 A15),
 * `createFixtureFetch` in `plugins/lunhui/lib/fixture-fetch.mjs`, over this directory: a URL whose host
 * is `qt.gtimg.cn` gets `quotes.gb18030.txt` as bytes; a URL whose host is `web.ifzq.gtimg.cn` and
 * whose `param` starts with `<symbol>,` gets `kline-<symbol>.json`, and one whose path is
 * `/appstock/app/day/query` gets `minutes-<code>.json`; any other URL, a symbol with
 * no file among them, gets a 404. `init` (signal, redirect, headers) is accepted and ignored: a
 * file answers at once.
 */
import { fileURLToPath } from "node:url";
import { createFixtureFetch } from "../../../plugins/lunhui/lib/fixture-fetch.mjs";

const serve = createFixtureFetch(fileURLToPath(new URL(".", import.meta.url)));

export async function fixtureFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return serve(url, init);
}
