# Lunhui empty fixtures

This directory intentionally holds no recorded replies: no `quotes.gb18030.txt` and no
`kline-<symbol>.json`. A Lunhui server started with `LUNHUI_FETCH_FIXTURES` naming it answers
every provider fetch with a 404, which the server reports as an upstream code
(`UPSTREAM_INVALID`). `tests/lunhui-server.test.ts` runs its symbol refusals against it: an
`INVALID_SYMBOL` there proves the list was refused before any fetch, since a fetch would have
ended in that upstream code instead.
