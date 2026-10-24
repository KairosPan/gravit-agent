# The Account seat — Design (route B)

**Status:** the operator's decision of 2026-10-20 ("继续做B吧 … 原来的demo仓库可以消失了 / 其他按推荐做吧"): Gravit becomes a seat at Linqi's Account, on its paper venues only, and the `demo/` submodule leaves the tree. The design calls below are mine, made because the operator chose to skip the questions — each is marked *call*, and each is reversible by a word.
**Inputs:** the fit analysis `docs/research/2026-10-19-gravit-ui-vs-face-backend-fit.md` §9 (route B); the conflict record `docs/superpowers/plans/2026-10-05-venue-plugins-unification-handoff.md` §12 (C1–C5, the three postures); the superseded venue-plugins spec `2026-10-02-venue-plugins-design.md`; the route A spec `2026-10-19-gravit-ui-on-face-design.md`; the front-end spec `2026-10-09-demo-v2-gravit-frontend-design.md` §8–§9 and §15; `DEVELOPMENT.md` §3–§5 and §7; `Gravit-Design.md` (the charter; it outranks everything here on intent); Linqi's `README.md`, `COOKBOOK.md` (§3, §11, §11b, §21) and `docs/account.md` at the pin below, and its code (`src/portfolio/mcp.ts`, `server.ts`, `service.ts`, `account/*.ts`, `live/paper.ts`, `test/standin/ui-standin.ts`), read on 2026-10-20.
**Pins:** `feat/gravit-face` @ b21da25 (main @ 6fdca54 + route A, unmerged); `linqizhe07/buyer-agent-demo` @ 133b9a7 (its `main`, 2026-10-20, after PR #33); dsh 0.2.0-rc.2.

---

## 1. Intent

Give Gravit a seat at the operator's Account — Linqi's buyer-agent-demo, the program that puts exchange, broker, wallet and prediction-market accounts on one page at `127.0.0.1:4820` and lets agents trade inside owner-signed limits — so that Gravit can read what the account holds and sees, rehearse orders on its paper venues and, under a charter the operator has not yet written, touch real venues later. The face mounts the seat the way it mounts AKShare: one MCP row, composed below the operator's layers, over a checkout the operator installs where they like. The Account stays Linqi's product and runs on its own; nothing of it is vendored, pinned or called in-process any more — the `demo/` submodule leaves the tree.

Why now: route A put the settled front end on the face, and the operator's next step was always the account and the exchange connectors ("接好账户和交易所connector…之后再做B"). In the twelve days since the submodule's pin the Account grew its own paper venues, a Guard mode that cards every agent write, and a documented dsh row (COOKBOOK §11) — the three things that make the tenant posture (handoff §12.3, A) cheap and honest for paper money. The earlier reading of route B, "a back end with a wallet and no brain", no longer holds: the Account now has a brain of its own (Desk, Brains, Superagent); Gravit joins it as one more seat, with its own research behind it.

## 2. Goals · non-goals · anti-goals

**Goals**
1. With the Account service running on this machine and a paper venue open, every Gravit session carries the seat's tools (`mcp__account__portfolio_*`); the operator admits the seat and signs it a trade limit on the paper venue on the Account page, and Gravit trades there.
2. Every write the seat offers stops for the face's Gate 2 card in the conversation — the tool, its arguments, the venue — before it leaves dsh; the Account's own Guard card follows on its page. Two cards per write, both the operator's.
3. The Account screen says where the seat stands: the service reachable or not, the seat absent / knocking / admitted until when / expired / revoked, its limits, the venues at the Account with the paper ones marked, the cards waiting on the Account page — and the way there.
4. A seat tool's result is drawn honestly: the raw answer in the tool row, and one line that says *card raised there*, *order placed*, or the Account's refusal in its own words.
5. An absent checkout, an unreachable service or a knocking seat never takes the face down or hides the chat: the row fails soft, the screen says what it knows.
6. Roles never carry a seat tool; a bot carries one only when the operator writes it into the bot's preset.
7. The documents say what is built: the charter (the ACCOUNT line, the write map, a debt, §7.3, §8), `DEVELOPMENT.md`, `GRAVIT.md`, the mechanics guide, `face/README.md` (the install and the drill), `CLAUDE.md`, the loops page, the ledger.

**Non-goals (this round, by the operator's order)**
- Real venues. Connecting one to the Account the seat sits at, or signing the seat a limit on one, is the charter's real-money trigger (§8) and the next charter's agenda (handoff §12.1, C1–C5 for real money). Nothing here prevents the operator from doing it on the Account page; nothing here prepares it.
- Beast mode, the Desk, Superagent, Brains, spend tokens (the Account's open PR #27), agent wallets and payments. `portfolio_pay`, `portfolio_live_move` and `portfolio_live_earn` reach nothing without the `payees`, `venues` and `earn` limits the operator does not sign; they are gated here all the same.
- The Account's page inside the face, or a Gravit page inside the Account (front-end spec §9.1 died with route A).
- Markets fed from the Account's quotes; Memory through `portfolio_memory` (charter §7.3; `DEVELOPMENT.md` §10 item 16).
- One card per write. Collapsing the two needs a per-seat paper autonomy on the Account's side (its Desk has one, an outside seat does not: `src/portfolio/account/desk.ts:1129-1137`) — a request to Linqi, not a change here.
- Posture B of the handoff (the Account's pieces moved into the face).

**Anti-goals (a failure even if it works)**
- A door around Gate 2: every seat tool that places, changes or cancels an order, moves money, pays, or sets leverage is in the gate's name list, and a seat write that reaches dsh's dispatch without a logged grant is refused as a `place_order` would be.
- A key or a signer in the face: the seat's key is the Account's (`$BUYER_HOME/seats/gravit.json`, written by the seat process), the owner's device key is the browser's on the Account's page; the face holds neither and signs nothing.
- A screen that shows the Account's numbers as the face's own: the seat's block names its source and its time; the rail's net worth stays the Alpaca paper account's.
- Vendoring the Account again — a pinned commit, a submodule, an import of its modules.

## 3. Constraints

- The charter: one operator, loopback only, no authentication machinery of the face's own, no cryptographic machinery of the face's own; the two gates hold the MCP tool surface; nothing starts unattended.
- The Account's own contract at the pin: `/api/*` answers any local process whose request carries no Origin header (`src/portfolio/server.ts:447-464`; a plain `fetch` to `127.0.0.1:<port>` passes); writes are EIP-712 envelopes signed by the seat's key; Guard cards every agent order, thirty minutes each; `--live-cap` does not bound a paper venue (`account/live-orders.ts:431`); `--read-only` refuses paper orders too (`live-orders.ts:327`), so the service runs with writes on; the seat knocks (`agentAsk letIn`) once per process when `portfolio_account` finds its key unknown; `portfolio_wait` polls at most 55 s.
- dsh 0.2.0-rc.2's stdio client: a server is spawned twice per connect — the probe calls no tool, so the seat's lazily made key is made by the serving process alone; a server's `instructions` would enter the prompt as a section (the seat sets none); the seat's 35 tool schemas enter the tool block of every request (measured, §10); environment names holding `KEY`, `SECRET`, `TOKEN` or `PASSWORD` are scrubbed from the child's inherited environment, and the row's own `env` is what reaches it.
- The product speaks English; screens carry no explanatory small print — the Account's own refusal text is drawn as its words, as a quote provider's is.
- Vanilla ES modules, the fake-DOM suite, `tsx --test`; nothing new is fetched at boot.

## 4. Where it lives (*calls*)

- **Branch** `feat/account-seat`, cut from `feat/gravit-face` @ b21da25; worktree `.claude/worktrees/account-seat`. It lands after `feat/gravit-face`, as one more fast-forward; the two are not folded (*call*: gravit-face keeps its own landing, after the operator's keyed drills).
- **The checkout.** The operator clones `linqizhe07/buyer-agent-demo` where they like — the README says `~/buyer-agent-demo` — and runs `npm ci` there (`tsx` is a devDependency the seat needs). The face reads `FACE_ACCOUNT_SEAT_DIR` (default `~/buyer-agent-demo`) and `FACE_ACCOUNT_URL` (default `http://127.0.0.1:4820`). The service is the operator's to start — `npm run account` in that checkout, or its LaunchAgent (`npm run account:service -- install`) — and the face never starts it (*call*: the Account is a program the operator runs, like the harness home is a home the operator owns).
- **The row** `mcp-account` (`face/src/account-seat.ts`, the sibling of `akshare.ts`): `@deepseek-ai/dsh-mcp-client`, `transport: stdio`, `serverName: account` (Linqi's own name for the dsh row, COOKBOOK §11, so the tools are `mcp__account__portfolio_*`), `command: node`, `args: [<dir>/node_modules/tsx/dist/cli.mjs, src/portfolio/mcp.ts]` (the shape of the Account's own LaunchAgent; no `npx`, which would fetch `tsx` from the network when the install is missing), `cwd: <dir>`, `env: { PORTFOLIO_URL: <url>, PORTFOLIO_AGENT: "Gravit" }`, `toolCallTimeoutMs: 90_000` (`portfolio_wait` runs 55 s at most, a venue read can be slow), `failOnStartupError: false`. Composed beside the AKShare row — after dsh-base and the policy layer, before the profile and home patches — so `- { id: mcp-account, disabled: true }` in the operator's patch turns it off and a `config` there replaces it whole. (*call*: the seat's name is **Gravit**, so the Account page shows the seat under the name the operator knows; its slug `gravit` names the key file.)
- **The seat's key** lives where the Account keeps its seats: `$BUYER_HOME/seats/gravit.json` (default `~/.buyer-agent-demo/`), made by the seat on its first tool call, exclusive-create, mode 0600. The face never reads it; the Account page shows the seat's address.
- **A missing install** is a spawn failure dsh logs; the row stays active with no tools, the face boots, and the Account screen's seat block says the service is not reachable. The check is `/data/plugins.json` (`account` with 35 tools), as it is for AKShare.

## 5. The face server

### 5.1 The row and the boot
`accountSeatPatches(dir = process.env.FACE_ACCOUNT_SEAT_DIR || ~/buyer-agent-demo, url = process.env.FACE_ACCOUNT_URL || http://127.0.0.1:4820): FacePatchList` and `ACCOUNT_SEAT_ROW_ID = "mcp-account"`, `ACCOUNT_SEAT_SERVER = "account"`, `ACCOUNT_SEAT_NAME = "Gravit"`. `composeFace` spreads it right after the AKShare row. `boot.test.ts`'s layer count and the "every face row lands exactly once" pin grow by one; the sixteen real-boot smokes disable `mcp-account` as they disable `mcp-akshare`; `check-home.ts` already disables every MCP row it finds in the composed tree. `schema-sizes.ts` gains the `mcp__account__` group.

### 5.2 Gate 2
`ORDER_RAW_NAMES` grows by the seat's write tools: `portfolio_live_order`, `portfolio_live_batch`, `portfolio_live_amend`, `portfolio_live_cancel`, `portfolio_live_close`, `portfolio_live_leverage`, `portfolio_live_move`, `portfolio_live_earn`, `portfolio_pay`, and the three the seat registers only against a simulated service — `portfolio_order`, `portfolio_execute`, `portfolio_transfer`. Matching stays by raw suffix, so a renamed server cannot slip one past, and `auditOrderTools` lists them as gated at boot. The listener's reason for a seat tool is `Account seat - <tool>: <arguments>` — never `PAPER order`: the face does not know a venue's kind, and the Account's own card says PAPER in its own words (*call*). `describeOrder` reads the seat's keys in a readable order (`venue`, `symbol`, `side`, `orderType`, `qty`, `usd`, `limitPrice`, `stopPrice`, `order`, `kind`, `from`, `asset`, `amount`, `leverage`, `url`, `maxAmount`) before the unknown ones, cut at forty characters each as today. The guard, the grant check and the `never` policy are unchanged.

Not gated: every read (`portfolio_account`, `portfolio_holdings`, `portfolio_venues`, `portfolio_explore`, `portfolio_candles`, `portfolio_book`, `portfolio_live_preview`, `portfolio_wait`, `portfolio_approval`, `portfolio_statement`, …) and the signed words — `portfolio_ask`, `portfolio_report`, `portfolio_remember`, `portfolio_forget`, `portfolio_desk_say` — which grant nothing and move nothing (*call*; the mechanics guide bounds what Gravit asks for).

### 5.3 Roles and bots
`roles.ts`'s never-list gains the prefix `mcp__account__` (a role has no reason to read the account — charter §4) and the twelve write names as raw names, with their reason. A bot's preset is an explicit allow-list the operator writes; a bot given a seat tool is the charter's §8 trigger ("a bot's composition is given the account tools"), the operator's own act, and Gate 2 holds tree-wide either way.

### 5.4 `GET /data/seat.json`
`face/src/seat.ts`: `seatView(account, seatName, url, now)` (pure) and `registerSeatRoute(webServer, deps)`. The route: the `/data` fence; a 30-second cache, `?fresh=1` skipping it, one flight at a time; a plain `fetch` of `<url>/api/account` with a 7-second abort and `redirect: "error"`, no Origin header; then the view:

```
{ ok: true, url, reachable: true, asOf, mode: 'guard' | 'open', writes: { on, capUsd }, cardMinutes,
  seat: { name, status: 'absent' | 'knocking' | 'admitted' | 'expired' | 'revoked', address?, validUntil?,
          limits: [{ scope, allow: [], perOrderUsd, budgetUsd, spentUsd, reservedUsd, leftUsd, validUntil, expired }] },
  venues: [{ id, name, paper, usd, frontLine?, stale?, notServed? }],
  cards: [{ id, usd, reason, expiresAt }],      // this seat's
  others: n }                                   // other agents' cards waiting
```

The seat is found by name — `keys[]`, `requests[]`, `spend[].agentName` and `cards[].agentName` carry the name the owner typed when admitting it; the face never reads the key file — so the README tells the operator to admit it as **Gravit** (*call*). An unreachable or refusing service answers `{ ok: true, url, reachable: false, error }` with the failure's code (`ECONNREFUSED`, `timeout`, `http 403`), never its text, and there is no stale re-serve: the service's absence is the fact to show (*call*). The route touches no key and no `BUYER_HOME`.

## 6. The client

### 6.1 The card
`kinds.js`'s `ORDER_TOOLS` grows by the same twelve names. For a seat tool the card's title is the seat line — `buy $100 of AAPL · market · paper-1`, `sell 10 AAPL · limit 187.4 · paper-1`, `cancel ord-0001 · paper-1`, `close AAPL · paper-1`, `move 50 USDC · withdraw from okx`, `pay up to $2 · api.example.com`, else `<tool> · <venue>` — its venue chip is the argument's venue (`paper-1`), or `Account seat` when the tool names none; the dim line is the gate's reason. Decline and Approve answer `rejected` and `allowed-once` as today.

*Amended 2026-10-21 (the build; ledger "Final review"):* a batch's card lists every leg — `batch · 2 legs: buy $10 of BTC/USD · market · ex; buy $12 of ETH/USD · market · ex` — and its chip is the legs' venues; the gate denies a batch of more than ten legs, a key field it cannot show whole, or a value nested deeper than the one level the card draws, so no card ever reads `legs=?`.

### 6.2 The receipt
A seat tool's result lifts one line under its tool row: `Card raised on the Account page · card-0007 · answer it there` when the answer is `pending` with a card; `Order placed · <line> · ord-0001 · paper` when it carries an order (`paper` from the order's own flag); the Account's refusal — `<code> · <message>` — as a refusal when the result is an error or `ok: false`; a batch lifts `Batch · <n> of <m> legs placed` — *amended 2026-10-21:* `· <k> cards raised on the Account page` and `· <j> refused` when Guard answered legs with cards or the Account refused some, and `Batch · <m> of <m> legs refused · <code> · <message>` as a refusal when every leg was; any other answer lifts nothing. A seat receipt reloads `/data/seat.json?fresh=1`, not the Alpaca account.

### 6.3 Account › Venues
*Superseded 2026-10-24 by `docs/superpowers/specs/2026-10-22-account-graft-design.md` §6.2–§6.4:* the face's page is now one of the Account's owner devices, so a card is also signed in the face (Account › Cards, ✓ Approve / ✗ Reject) and **Open the Account page** is no longer the only place one is signed; the box stays as written otherwise, beside the Account's own Venues (the Alpaca row it sat under is gone). The text below is the 2026-10-20 design, kept as history.

A second box, **Account seat**, under the Alpaca row: the service (`127.0.0.1:4820 · reachable` / `not reachable`), its mode and writes (`Guard · Trading on · $100 a move`); the seat (`Gravit · admitted until Nov 19` / `knocking — admit it on the Account page` / `not on the account` / `expired` / `revoked`); each limit (`trade · paper-1 · $100 an order · $850 of $1,000 left`); the venues, a `Paper` chip on the paper ones; `2 cards waiting` and the key **Open the Account page** — a link to the service's URL in a new tab, the only place a card is signed. A stamp `As of 14:32`, and Refresh. Read on entering Venues, on Refresh, and after a seat receipt; the state slice `seat: { status, data, at }` with the usual loading / ready / error reducers. Discover's MCP shelf lists the `account` server by itself (`/data/plugins.json` lists every `dsh-mcp-client` row).

## 7. The agents' side

- `GRAVIT.md` (budget 4,500 bytes, 4,321 used) names the seat in one paragraph: the tools, paper venues only, the two cards, `portfolio_wait` after a card, and that its market reads are public data without a PIT guard — never backtest evidence, as AKShare's are not.
- A mechanics skill `dsh/skills/mechanics/account-seat-guide/SKILL.md` (about 2 KB; the write map's operator-only tier, so this change is the operator's to review): the loop (`portfolio_account` → `portfolio_venues` / `portfolio_explore` → `portfolio_live_preview` → `portfolio_live_order` → the two cards → `portfolio_wait` / `portfolio_approval` → `portfolio_report`); what the seat may ask for with `portfolio_ask` (`letIn`; a `limit` on a paper venue) and never (`mode`, `leverage`, a real venue, a `topup`); the refusal codes that mean *stop and tell the operator* (`E_ACCOUNT_UNKNOWN_SIGNER`, `E_MANDATE_*`, `E_WALLET_LIVE_WRITES_OFF`, `E_ACCOUNT_CARD_EXPIRED`); the quotes' honesty (public, seconds old, unguarded).

## 8. The tree

- `git rm demo`; `.gitmodules` goes with it; `CLAUDE.md`'s `demo/` row becomes the row for the seat (`face/src/account-seat.ts`, the install, the env), and the loops page's summary of `CLAUDE.md` follows. Nothing else in the tree names the submodule (two client comments credit Linqi's sprite and formatter and stay).
- The primary checkout's initialized `demo/` directory (0ef5131, with its `node_modules`) becomes untracked when main takes this branch: the operator's to delete, and not the install — it predates the paper venues.

## 9. Documents

- `DEVELOPMENT.md`: §3.1 and §3.6 (the row and its tools), §4.2 (`account-seat.ts`, `seat.ts`), §4.3 (the tool-schema group table gains the measured `mcp__account__` row), §4.4 (`/data/seat.json`), §4.6 and Appendix A (`FACE_ACCOUNT_SEAT_DIR`, `FACE_ACCOUNT_URL`), §4.7 (Gate 2's names and the seat's reason), §5.1 and §5.3 (the kind table's card row, the receipt, the seat slice), §7.3 (the two smokes), §7.4 (the account-seat drill, manual and automated rows), §9 (R32–R35), §10 (item 17: real venues at the seat → the next charter).
- `Gravit-Design.md`: §1's ACCOUNT line; §3's ACCOUNT box; §4's write map (a row for orders at the seat); §5 D17 (the seat's reach is the operator's grants on the Account page, not code in this tree; two cards); §7.3 (the seat's keys are the Account's); §8 (a limit on a non-paper venue, or a real venue connected with the seat granted reach); §9 (the seat as a built direction).
- `face/README.md`: "The Account seat" (the install, the env, what the service does on its own — the venue probes every thirty minutes, the location lookups, the public quotes; the paper venue; admitting the seat as Gravit; the limit) and "The account-seat drill".
- `GRAVIT.md`, the mechanics guide (§7), `CLAUDE.md` (the row, the module), `ROADMAP.md`'s built log, the handoff's status line and the v1 spec's status block (posture A taken 2026-10-20, paper only), the loops page (the row in the composition order).
- The ledger `docs/superpowers/plans/2026-10-20-account-seat-ledger.md`: pre-flight, rulings, tasks, the look, the final review, the deferred minors.

## 10. Tests and drills

- **Unit** (fake DOM, offline): the row's shape and env; the composition pins; `isOrderTool`, `describeOrder` and the reason for a seat tool; the roles never-list; `seatView` (admitted, knocking, absent, expired, revoked; the paper flag; this seat's cards and the others' count; an unreachable service); the route (the fence, the cache, `?fresh=1`, the abort); the client's seat line, the card's venue, the receipts, the Venues block, the reducers, the reload after a seat receipt.
- **Real boots** (`FACE_SMOKE=1`): the order-gate smoke gains a stand-in `mcp__drill__portfolio_live_order` the listener asks about with the `Account seat` reason; and **the seat smoke** (`account-seat-smoke.test.ts`, skipped unless `FACE_SMOKE=1` and `FACE_ACCOUNT_SEAT_DIR` names an installed checkout): it starts the Account's stand-in (`test/standin/ui-standin.ts --port <free>`: no network, a fresh temp home, writes on), boots the face on a scratch home with the row pointed at it and the seat as the stand-in's seeded agent (`PORTFOLIO_SEAT_KEYS=sim`, `PORTFOLIO_AGENT=ui-standin-claude-code`, `BUYER_HOME` a scratch directory), and proves: the 35 tools registered and the twelve in `auditOrderTools().gated`; `portfolio_account` answering with the seat authorised; a `portfolio_live_order` at the stand-in's `ex` refused by the guard without a grant; and, with a logged grant, signed by the seat and answered by the stand-in with a **card** (`pending: true`, `card.id`) — the whole chain but the human.
- **Measured**: the seat's tool block, by `schema-sizes.ts` on a scratch home with the row pointed at the checkout (the seat registers its tools with no service to reach), recorded in `DEVELOPMENT.md` §4.3.
- **The manual drill** (`face/README.md`; the operator, with keys): the service up with a paper venue, the seat admitted as Gravit with a trade limit on it, Gravit asked to buy on paper → the face's card → ✓ → the Account's card → signed → `portfolio_wait` → the receipt, the Account's statement.
- **The look** in this round (the browser pane): the stand-in on 4821 and a keyless face with the row pointed at it — the seat block through its states (not reachable → knocking → admitted, after the owner's approval on the stand-in's page), Discover's shelf, a seat card drawn from the frame fixture.

## 11. Residuals and open points

*Superseded 2026-10-24 by `docs/superpowers/specs/2026-10-22-account-graft-design.md` §6.2–§6.4 (and its §11):* the Account's second card is answered in the face's Cards too, the owner's grants (letting the seat in, its limit) are signed from the face as well as from the Account's page, and the face draws the Account's venues as the Account reports them; the residuals below that stand are carried in `DEVELOPMENT.md` §9 (R32–R35, R37). The list is the 2026-10-20 design's, kept as history.

- Two cards per write, for the paper stage.
- The Account moves fast (26 pull requests in twelve days): the face pins nothing of it. A renamed write tool falls out of the gate's list (the boot audit catches only the `(operator-gated)` marker, which the seat does not carry) — the seat smoke is the canary, and the README says to re-run it after pulling the checkout; a changed `/api/account` turns the Venues block into "unreadable", never a wrong number.
- The seat's key file is written by a child of the face process outside the workspace, in the Account's home (D10's clause, now with a second writer).
- The seat is matched by the name the owner typed; a seat admitted under another name shows as knocking.
- The service's own egress — the venue probes every thirty minutes, the location lookups, the public quotes — is Linqi's program's, listed in the README; the face's loopback posture is unchanged, and whether to run the service is the operator's call.
- The tool block grows by 35 schemas (the measured size in §4.3); the next lever after AKShare's.
- A limit signed with `allow: "*"` expands to the venues connected at signing (`account/exchange.ts:671`); the README says to name the paper venue.
