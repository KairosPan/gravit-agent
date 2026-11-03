# GRAVIT.md — the workspace, for every agent dsh runs here

Read by Gravit, its role children and the bots alike: facts and rules of this tree, never
anyone's identity. When this file and the tree disagree, the tree is right.

Three layers. MARKET and ACCOUNT are the operator's Account, reached through Gravit's seat
(`mcp__account__*`, paper venues only), AKShare for A shares among its reads
(`mcp__account__portfolio_akshare`). STRATEGY is `strategies/`: one directory per strategy,
Gravit's arena.

## Where things are

- `strategies/<name>/` — `THESIS.md`, `journal.md`, `status.yaml`; `strategies/_template` is
  the copy source.
- `roles/` — Gravit's role library; `bots/` — the operator's voices. Both are the operator's.

## Reads

The seat's market reads and AKShare's are live, seconds old, and unguarded: the tree has
no lookahead guard since 2026-10-24, by the operator's decision. A number read today is
today's; nothing here replays the past. Evidence is forward paper trading on the paper venue
the operator granted at the Account: the Account's own figures as returned, with the order ids.
`mcp__account__portfolio_akshare` passes one AKShare tool and its `arguments`, through the
Account, to the market's sidecar: `akshare_discover` finds a method and its category tool; `stock_zh_a_spot_tx` (under
`akshare_stock_a`) is the verified Tencent A-share snapshot method, while Eastmoney and Xueqiu endpoints may fail or require a
login. Check every result's errors, timestamps and `truncated` (the default limit is 500 rows;
a truncated result is not the whole market). Retrieval time is not exchange time.

## A strategy directory

Lifecycle, in `status.yaml`: `idea | researching | validated | paper | retired` (`paper`: a
forward paper trade is running on the Account). Three optional headline keys the channel page
renders, none required: `one_line` (the current conclusion, one sentence), `next` (the next
step), `numbers` (free figures as a mapping of scalar values). Name a strategy as the face
names channels: a letter or digit in any script first, then letters, digits, `-` and `_`, at
most 41 code points, no spaces or dots — the name becomes a path typed into shell by hand, and
zsh's `cd x y` exits 0 in the wrong directory when the substituted path exists.
Commit your own iterations between cycles; a cycle commits once, with its verdict, or leaves
the commit to the operator. git log is the audit trail.
`analysis/<run>/` holds frozen A-share research runs the Lunhui rows write; never edit them by hand, and `strategies/cn-market/` is the market read's channel.
After a Lunhui market run, answer with `lunhui_present`, and answer follow-ups about that run the same way; every number you write comes from `lunhui_read_run`'s view digest.

## Rooms

A channel whose roster has bots is a room; Gravit organizes it with `dispatch`. Caps per
operator message: 3 rounds, 10 bot messages, 2 peer continuations per round. The operator's
`@<bot>` reaches a voice directly; an `@` naming nobody on the roster is an ordinary prompt to Gravit.

## The Account seat

`mcp__account__*`: Gravit's seat at the operator's Account — paper venues only; a write stops for a
card here, then one there; after a `card` answer, `portfolio_wait`; see `account-seat-guide`.
The operator trades the same Account by hand from the face's Trade screen, an owner device that
passes no gate of this tree's, only the Account's cap; a position Gravit did not open may be the
owner's, and the statement names who.

## The desk

`desk/` is the operator's; Gravit writes only `desk/journal/`. A desk turn informs; it never
orders, asks, opens a goal or commits. `desk_quotes` is the price now, never evidence. Desk
turns are refused while `GRAVIT.md`, `GRAVIT.local.md`, `.git`, `.dsh` or `.agents` is under
`desk/journal/`.

## Tests

`cd face && npm test`: offline, no keys.

## Never edit

`dsh/profile/` and the installed dsh profile copies under the harness home; anything under
`bots/` (a bot may write its own `journal/`) or `roles/` (propose in conversation — the
operator authors them); `docs/research/`; `STANDING.md`, `levels.yml`, `rules.yml`,
`holdings.yml` anywhere.
