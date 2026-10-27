# account/ — the Account service

The Account (Linqi's buyer-agent-demo, its portfolio part) as this tree's own package; origin and licence in `NOTICE` and `LICENSE`.
Install once: `npm ci` here.

- Run: `npm run account` (127.0.0.1:4820; flags `--read-only`, `--live-cap <usd>`, `--port <n>`, `--fresh`); the home is the code's default `~/.buyer-agent-demo`.
- The seat: `npm run portfolio:mcp` — the MCP seat the face's `mcp-account` row spawns.
- Tests: `npm test` (vitest, one file at a time); `npm run typecheck`.

Design: `docs/superpowers/specs/2026-10-27-account-in-repo-design.md`. The face's side: `face/README.md` "The Account seat".
