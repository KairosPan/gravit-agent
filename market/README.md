# market/ — the market service

gravit-market: the Market part's keyless public data as its own service on 127.0.0.1:4821 — the public sources and their stream hub, China (Tencent), the AKShare sidecar, Lunhui's relay and iFinD — with no wallet, no home and no key; it writes nothing to disk. It moved out of `account/` on 2026-11-03; origin and licence in `NOTICE` (which lists the files moved and copied) and `LICENSE` (Apache-2.0).
Install once: `npm ci` here (its own package and lockfile). The account's tests and typecheck import this package, so they need it too.

- Run: `npm run market` (127.0.0.1:4821, `--port <n>` elsewhere). It reads the repo's `../.env.ifind` when that file exists (`tsx --env-file-if-exists`), and its start lines say whether iFinD is configured (never the token) and which AKShare command it runs.
- As a LaunchAgent: `npm run market:service -- install` (`status`, `restart`, `logs`, `uninstall`), label `com.gravit.market`, logs in `~/Library/Logs/gravit-market/`. The operator installs it, never an agent. The plist passes `--env-file-if-exists=<repo>/.env.ifind`, so the token is read from that file at each start; the plist carries only the file's path. It keeps `PATH`, `HOME` and `MARKET_AKSHARE_BIN` from the installing shell.
- It serves no page: every path outside `/api/` is 404 with `MARKET_NO_PAGE`, and every answer is `cache-control: no-store`. The fence is the account's: a non-local `Host`, a foreign `Origin` or a `Sec-Fetch-Site` of `cross-site` or `same-site` is 403. `GET /api/health` is `{ok: true, service: "market", sources, china, akshare, ifind}`.
- What it answers (`src/server.ts` lists them): the source protocol the account reads it by (`src/protocol.ts`: `/api/sources`, `/api/source/:id/…`, `/api/hub…`, `/api/china/…`, `/api/price`); Lunhui's reach and AKShare (`src/routes-cn.ts`: `/api/cn/relay`, `/api/cn/ifind`, `/api/akshare/tools`, `/api/akshare/call`); the public reads (`src/reads.ts`: `/api/explore`, `/api/quotes`, `/api/candles`, `/api/book`, `/api/trades`) and the stream (`src/follows.ts`: `GET /api/stream`, `POST /api/stream/markets`), for the face in plan A2.
- iFinD: `IFIND_REFRESH_TOKEN` or `IFIND_ACCESS_TOKEN` in this process's environment (from `../.env.ifind`), held in memory and never in a reply, log line or refusal.
- Test: `npm test` (vitest) and `npm run typecheck`.

Design: `docs/superpowers/specs/2026-11-03-account-split-and-identity-design.md`; the as-built reference is `DEVELOPMENT.md` §3.10.

## AKShare, the sidecar

The market runs `akshare-mcp` (a Python MCP server over AKShare, public A-share and other Chinese market data) as its own MCP child over stdio (`src/live/akshare.ts`). Gravit reaches it through the Account seat's one read tool, `portfolio_akshare` (`{tool, arguments}`), which the account relays here; the face runs no AKShare.

- Host install, once (needs `uv`; the Git source is intentional, because PyPI's normalized `akshare-mcp` is another project, and `mcp<2` stays because this revision uses the SDK 1.x FastMCP API):

  ```bash
  uv tool install --python 3.12 --with 'mcp<2' \
    'git+https://github.com/xiaozhozho/akshare-mcp.git@9b6a22b6d83cce2a996a5072743bb06686040ce0'
  ```

- The command is `MARKET_AKSHARE_BIN`, default `~/.local/bin/akshare-mcp` (argv only, no shell). The market image installs the same pin and sets it to `/usr/local/bin/akshare-mcp`.
- The child starts on the first ask, not at boot, and starts again on the next ask after it exits. One 120 s deadline covers a cold start, the tool listing and the call; a call that times out recycles the child. A reply past 4 MiB is refused `too-large`, arguments past 16 KiB `bad-arguments`; the child returns at most 500 rows (`AKSHARE_MCP_MAX_ROWS`), and a result says `truncated` when it cut.
- The child's environment is an allowlist of the market's own (`PATH`, `HOME`, `USER`, `LANG`/`LC_*`, the temp dirs, the TLS roots, proxies without their userinfo, `FASTMCP_LOG_LEVEL`): no iFinD secret reaches Python. Its stderr is this process's.
- Two routes, both reads: `GET /api/akshare/tools` lists the child's tools, `POST /api/akshare/call` takes `{tool, arguments}`. A refusal is `{ok: false, akshare: <word>, message}` with `off`, `unknown-tool`, `bad-arguments` (400), `unavailable` (503), `timeout` (504) or `too-large` (502).
- Live check: `curl -s 127.0.0.1:4821/api/akshare/tools` lists 14 tools.

## In the box

`docker compose up` at the repo root runs this service as the `market` box (`compose.yml`, `Dockerfile` here: AKShare's install layer, then `npm ci`; `.dockerignore` keeps the host's `node_modules` out). It runs `npm run market` with `MARKET_BIND=0.0.0.0` and `MARKET_HOSTS=market:4821`, publishes no port (`expose: ["4821"]`), has no volume, and reads `.env.ifind` through compose's optional `env_file`. The account box reads it at `http://market:4821` and starts once the market's health check (`GET /api/health`) passes. **`MARKET_BIND` and `MARKET_HOSTS` are for the box only**: never set `MARKET_BIND=0.0.0.0` on the host Mac, and the `Host` fence is the DNS-rebinding defence, not authentication.
