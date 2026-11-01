# Lunhui empty fixtures

This directory intentionally holds no recorded replies: no `quotes.gb18030.txt`, no
`kline-<symbol>.json` and no Eastmoney file. `createFixtureFetch`
(`face/plugins/lunhui/lib/fixture-fetch.mjs`) over it, as a freeze row's `config.fetch` naming it
would serve (spec 2026-10-25 A15), answers every provider fetch with a 404, which the freezes
report as an upstream code (`UPSTREAM_INVALID`). A refusal other than that code from a row pointed
here proves the row refused before any fetch.
