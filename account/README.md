# account/ — the Account service

The Account (Linqi's buyer-agent-demo, its portfolio part) as this tree's own package; origin and licence in `NOTICE` and `LICENSE`.
Install once: `npm ci` here.

- Run: `npm run account` (127.0.0.1:4820; flags `--read-only`, `--live-cap <usd>`, `--port <n>`, `--fresh`); the home is the code's default `~/.buyer-agent-demo`.
- The seat: `npm run portfolio:mcp` — the MCP seat the face's `mcp-account` row spawns.
- Tests: `npm test` (vitest, one file at a time); `npm run typecheck`.

Design: `docs/superpowers/specs/2026-10-27-account-in-repo-design.md`. The face's side: `face/README.md` "The Account seat".

## In the box

`docker compose up` at the repo root runs this service as the `account` box (`compose.yml`, `Dockerfile` here: the image copies `account/` and runs `npm ci` at build) beside the face's `agent` box. Stop the host service first: the box publishes 4820 on the host's loopback. Run `npm ci` here on the host before the first `docker compose up` (the dev loop needs it anyway): the agent box's `account-modules` volume mounts at `account/node_modules` inside a read-only bind of this directory, so the mount point must already exist.

- The home is the volume `account-home`, mounted at `/data` (`npm run account -- --home /data`); it starts empty. The first owner pairs with the code the box prints: `docker compose logs account`.
- A key-file venue reads a path on the service's own filesystem, so the file goes into the volume first — `docker compose cp <file> account:/data/<name>` — and the venue is named by that path, `/data/<name>`.
- Optional, before the first start: carry the host's home (its book, devices and seats) into the box — `docker compose create account` (the container, not started; `cp` needs one), then `docker compose cp ~/.buyer-agent-demo/. account:/data`, then `docker compose up`. Otherwise the paper venue is opened again in the box.
- The box sets `PORTFOLIO_BIND=0.0.0.0` (listen on the container's interface) and `PORTFOLIO_HOSTS=account:4820` (one more `Host` admitted beside loopback, for the agent box on the compose network). **They are for the box only.** The `Host` fence is the DNS-rebinding defence, not authentication: writes are authorised by the owner's signed envelope and the seat's key at the door, but a peer that reaches the port can forge `Host` for every read. Never set `PORTFOLIO_BIND=0.0.0.0` on the host Mac — it would serve the LAN. `PORTFOLIO_HOSTS` entries (comma-separated) are matched exactly and case-sensitively, lowercase as compose sends them. Under an admitted extra host the Account's host-derived URLs (the wallet challenge, a venue's sign-in start) are built on `account:4820`; only a compose peer sends that host, never the owner's browser, which reaches the page at `127.0.0.1:4820`.
