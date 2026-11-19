# GRAVIT.md — the workspace, for every agent dsh runs here

Read by gravit, its role children and the bots: facts and rules of this tree, never
anyone's identity. When this file and the tree disagree, the tree is right.

Three layers. MARKET is the market service, read through `mcp__market__*` (keyless, no
card; A shares: 问财 `mcp__market__market_wencai`, funds too, and AKShare
`mcp__market__market_akshare`). ACCOUNT is the operator's Account, reached through the seat
(`mcp__account__*`, paper venues only). STRATEGY is `strategies/`: one directory per
strategy, gravit's arena.

## Where things are

- `strategies/<name>/` — `THESIS.md`, `journal.md`, `status.yaml`; `strategies/_template` is
  the copy source.
- `roles/` — gravit's role library; `bots/` — the operator's voices. Both are the operator's.

## Reads

The market's, 问财's and AKShare's reads are live and unguarded:
no lookahead guard since 2026-10-24 (the operator's decision). A number read today is
today's; nothing here replays the past. Evidence is forward paper trading on the paper venue
the operator granted at the Account: its own figures as returned, with the order ids.
`market_wencai` takes one Chinese sentence, dates written out; check its columns are what
you asked; `truncated` is not the whole answer; if 问财 refuses, use AKShare.
`market_akshare` passes one AKShare tool and its `arguments` to the sidecar:
`akshare_discover` finds a method and its category tool; `stock_zh_a_spot_tx` (under
`akshare_stock_a`) is the verified Tencent A-share snapshot method; Eastmoney and Xueqiu may
fail or need a login. Check every result's errors, timestamps and `truncated` (default limit
500 rows; a truncated one is not the whole market). Retrieval time is not exchange time.
A return is written with its sign, a % and what it measures (day 0, +5, +60, against the market), never as a bare run of numbers.

## A strategy directory

Lifecycle, in `status.yaml`: `idea | researching | validated | paper | retired` (`paper`: a
forward paper trade runs on the Account). Three optional keys the strategy page
renders: `one_line` (the current conclusion, one sentence), `next` (the next
step), `numbers` (free figures as a mapping of scalars). Name a strategy as the face does:
a letter or digit in any script first, then letters, digits, `-` and `_`, at most 41 code
points, no spaces or dots — it is typed into shell by hand as a path, and zsh's
`cd x y` exits 0 in the wrong directory when that path exists.
Commit your iterations between cycles; a cycle commits once, with its verdict, or leaves
it to the operator. git log is the audit trail.
`analysis/<run>/` holds the Lunhui rows' frozen A-share runs: never edit them by hand; `strategies/cn-market/` is the market read's directory.
After a Lunhui market run, answer it and its follow-ups with `lunhui_present`; every number you write comes from `lunhui_read_run`'s view digest.

## Debates

A task's worker hosts bots from the operator's one roster with `dispatch`; each is a read-only
member. Caps per operator message: 3 rounds, 10 bot messages, 2 peer continuations per round.

## The Account seat

`mcp__account__*`: gravit's seat at the operator's Account — paper venues only; a write stops for a
card here, then one there; after a `card` answer, `portfolio_wait`; see `account-seat-guide`.
The operator trades this Account by hand on the face's Trade screen, an owner device that
passes no gate of this tree's, only the Account's cap; a position gravit did not open may be the
owner's: the statement names who.
`mcp__memory__*`: the owner's record of decisions and lessons; you record and propose, the owner arms.

## The desk

`desk/` is the operator's; gravit writes only `desk/journal/`. A desk turn informs; it never
orders, asks, opens a goal or commits. `desk_quotes` is the price now, never evidence. Desk
turns are refused while `GRAVIT.md`, `GRAVIT.local.md`, `.git`, `.dsh` or `.agents` is under
`desk/journal/`.

## PDFs

A PDF: `pdftotext -layout -f A -l B <file> -` for its text (`pdfinfo` for its pages); render a
page whose layout matters (a table, chart or scan) with `pdftoppm -png -r 110 -f N -l N <file>
"${TMPDIR:-/tmp}/<name>"` (it writes `<name>-N.png`), never into the tree, and hand the PNG to
`role_pdf_page_reader`.

## Tests

`cd face && npm test`: offline, no keys.

## Never edit

`dsh/profile/` and its installed copies under the harness home; anything under
`bots/` (a bot may write its own `journal/`) or `roles/` (propose in conversation — the
operator authors them); `docs/research/`; `STANDING.md`, `levels.yml`, `rules.yml`,
`holdings.yml` anywhere.
