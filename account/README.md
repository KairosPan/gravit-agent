# account/ — the Account service

The Account (Linqi's buyer-agent-demo, its portfolio part) as this tree's own package; origin and licence in `NOTICE` and `LICENSE`.
Install once: `npm ci` here.

- Run: `npm run account` (127.0.0.1:4820; flags `--read-only`, `--live-cap <usd>`, `--port <n>`, `--fresh`); the home is the code's default `~/.buyer-agent-demo`.
- The seat: `npm run portfolio:mcp` — the MCP seat the face's `mcp-account` row spawns.
- Markets: beside the venues' public markets the Account serves China, the A shares as Tencent ranks, quotes, charts and finds them (`src/portfolio/live/china.ts`; `explore?tab=china`, `quotes?pairs=china|<code>`, `candles?venue=china`, the seat's `china` tab). Keyless, GET-only on Tencent's four hosts; view-only (`canTrade: false`) and priced in CNY, in the China tab alone and never in `all`. Only the real server builds it, so tests and other services never reach Tencent.
- Lunhui's reach: `GET /api/cn/relay?url=` forwards the Lunhui freezes' Tencent and Eastmoney GETs (an allow-list of their endpoints, the bytes unchanged) and `POST /api/cn/ifind` runs the boards stand-in's 问财 query with the iFinD token this process holds (`IFIND_REFRESH_TOKEN` or `IFIND_ACCESS_TOKEN` in its environment; start it with `set -a; [ ! -f ../.env.ifind ] || . ../.env.ifind; set +a; npm run account`). Both are reads, behind the `Host` fence, and work with `--read-only`; the start line says whether iFinD is configured, never the token.
- Tests: `npm test` (vitest, one file at a time); `npm run typecheck`.

Design: `docs/superpowers/specs/2026-10-27-account-in-repo-design.md`. The face's side: `face/README.md` "The Account seat".

## AKShare, the sidecar

The Account runs `akshare-mcp` (a Python MCP server over AKShare, public A-share and other Chinese market data) as its own MCP child over stdio (`src/portfolio/live/akshare.ts`). Gravit reaches it through the seat's one read tool, `portfolio_akshare` (`{tool, arguments}`); the face runs no AKShare.

- Host install, once (needs `uv`; the Git source is intentional, because PyPI's normalized `akshare-mcp` is another project, and `mcp<2` stays because this revision uses the SDK 1.x FastMCP API):

  ```bash
  uv tool install --python 3.12 --with 'mcp<2' \
    'git+https://github.com/xiaozhozho/akshare-mcp.git@9b6a22b6d83cce2a996a5072743bb06686040ce0'
  ```

- The command is `PORTFOLIO_AKSHARE_BIN`, default `~/.local/bin/akshare-mcp` (argv only, no shell). The account image installs the same pin and sets it to `/usr/local/bin/akshare-mcp`.
- The child starts on the first ask, not at boot, and starts again on the next ask after it exits. One 120 s deadline covers a cold start, the tool listing and the call; a call that times out recycles the child. A reply past 4 MiB is refused `too-large`, arguments past 16 KiB `bad-arguments`; the child returns at most 500 rows (`AKSHARE_MCP_MAX_ROWS`), and a result says `truncated` when it cut.
- The child's environment is an allowlist of the Account's own (`PATH`, `HOME`, `USER`, `LANG`/`LC_*`, the temp dirs, the TLS roots, proxies without their userinfo, `FASTMCP_LOG_LEVEL`): no wallet or iFinD secret reaches Python. Its stderr is this process's.
- Two routes, both reads (no ledger line, no card; they work with `--read-only`, behind the `Host` fence): `GET /api/akshare/tools` lists the child's tools, `POST /api/akshare/call` takes `{tool, arguments}`. A refusal is `{ok: false, akshare: <word>, message}` with `off`, `unknown-tool`, `bad-arguments` (400), `unavailable` (503), `timeout` (504) or `too-large` (502).
- Live check: `curl -s 127.0.0.1:4820/api/akshare/tools` lists 14 tools. A 4820 started from an older tree answers that the route does not exist: restart it from this tree.

## In the box

`docker compose up` at the repo root runs this service as the `account` box (`compose.yml`, `Dockerfile` here: the image copies `account/` and runs `npm ci` at build) beside the face's `agent` box. Stop the host service first: the box publishes 4820 on the host's loopback. Run `npm ci` here on the host before the first `docker compose up` (the dev loop needs it anyway): the agent box's `account-modules` volume mounts at `account/node_modules` inside a read-only bind of this directory, so the mount point must already exist.

- The box reads `.env.ifind` (`compose.yml`'s `env_file`, optional): the iFinD token reaches this process's environment there, nowhere else.
- The home is the volume `account-home`, mounted at `/data` (`npm run account -- --home /data`); it starts empty. The first owner pairs with the code the box prints: `docker compose logs account`.
- A key-file venue reads a path on the service's own filesystem, so the file goes into the volume first — `docker compose cp <file> account:/data/<name>` — and the venue is named by that path, `/data/<name>`.
- Optional, before the first start: carry the host's home (its book, devices and seats) into the box — `docker compose create account` (the container, not started; `cp` needs one), then `docker compose cp ~/.buyer-agent-demo/. account:/data`, then `docker compose up`. Otherwise the paper venue is opened again in the box.
- The box sets `PORTFOLIO_BIND=0.0.0.0` (listen on the container's interface) and `PORTFOLIO_HOSTS=account:4820` (one more `Host` admitted beside loopback, for the agent box on the compose network). **They are for the box only.** The `Host` fence is the DNS-rebinding defence, not authentication: writes are authorised by the owner's signed envelope and the seat's key at the door, but a peer that reaches the port can forge `Host` for every read. Never set `PORTFOLIO_BIND=0.0.0.0` on the host Mac — it would serve the LAN. `PORTFOLIO_HOSTS` entries (comma-separated) are matched exactly and case-sensitively, lowercase as compose sends them. Under an admitted extra host the Account's host-derived URLs (the wallet challenge, a venue's sign-in start) are built on `account:4820`; only a compose peer sends that host, never the owner's browser, which reaches the page at `127.0.0.1:4820`.
