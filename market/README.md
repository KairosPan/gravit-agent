# gravit-market: the Market part's keyless public data as its own service on 127.0.0.1:4821, with no wallet, no home and no key.
Install: `npm ci` here (its own package and lockfile).
Run: `npm run market` (`--port <n>`; it reads the repo's `../.env.ifind` when that file exists).
Test: `npm test && npm run typecheck`.
Design: `docs/superpowers/specs/2026-11-03-account-split-and-identity-design.md`.
