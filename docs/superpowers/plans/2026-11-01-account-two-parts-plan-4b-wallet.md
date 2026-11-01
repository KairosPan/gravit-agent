# The Account's two parts, plan 4b — the wallet half on the face: Money, Venues, Agents, Cards, Devices, the words — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The face's Account screen does everything the Account's own page alone does for the wallet half (spec §5.1, the rows not covered by plan 4a): a Money tab (receive, move between the owner's accounts, a browser wallet sending what the Account built, Earn in and out), Sell many on the Portfolio, every connector kind on Venues with Close to agents and Reopen, agent wallets and every limit scope on Agents with Gravit's own row's Revoke and limit, every kind of ask granted on Cards, Settings › Devices' Guard-first sign-out — and no face sentence sends the operator to the Account's page any more (§5.8).

**Architecture:** Every signed action is one more kind on the sheet engine of `client/js/host/sheet.js` (prepare → What you sign → sign), its fields and draft in a per-area module that `host/sheet-view.js` delegates to, as plan 4a's `sheet-market.js` and `sheet-rules.js` do; the engine gains three small hooks — fields that follow a field (`refieldsOf`), a hook on each preparation, a hook before the signature — and nothing else. The browser wallet is one wire module (`client/js/wire/wallet.js`, EIP-6963) the page's own wallet code is ported into; the face never holds a wallet's key either: the wallet extension signs and sends in the operator's browser. Sell many, which signs up to ten preparations in turn, has its own small engine over the same owner device. The unsigned writes are plan 4a's two (Guard, Close to agents).

**Tech Stack:** as plan 4a — `face/` (`node --test`, the client's fake DOM tests in `face/tests/client/*`, `FACE_SMOKE=1` boots) and `account/` (vitest).

**Spec:** `docs/superpowers/specs/2026-11-01-account-two-parts-design.md` (§5.1 wallet rows, §5.3, §5.8; §3 anti-goals "the face holding a key" and "real money reachable … without the real-money trigger"; §6; §9 calls 6, 7, 10). **Needs plan 4a built first** (`docs/superpowers/plans/2026-11-01-account-two-parts-plan-4a-proxy-market-rules.md`): its proxy routes (`receive`, `earn`, `sellable`, `signin/status`, `wallet/challenge`, `wallet/prove`, `signin/start`, `bridge-routes`, `live/order-sent`, `live/order-requote`, `live/sent`, `revoke`, `guard`, the callback), its `writesOn`, `tradeCan`, `RULES_KINDS` (`session`, `leverageCap`, `beast`) and `account.guard()`.

## Global Constraints

- **The face holds no key and signs nothing itself (D18).** Every signed action is `sheet.open(kind, seed)` → `/data/account/prepare` → What you sign → `owner.submit` (`client/js/host/sheet.js:37-153`, `host/owner.js:132-161`), or, for Sell many, `owner.prepare` then `owner.submit` per leg. A browser wallet signs its own sentence and sends its own transactions in its own extension; the face only relays what the Account built and reports the hash the wallet returned. The unsigned writes are Guard and Close to agents alone (plan 4a's `/data/account/guard`, `/data/account/revoke`).
- The door protocol, the envelope, the Guard, and every Account route's shape are unchanged; no `account/` code changes but the seat's sentences (Task 7).
- Every draft is the Account page's own for its action, field for field (cited per task from `account/src/portfolio/public/ui/*.js`); the Account judges everything else in its own words (`refusal.message`, `quote.words`, `shown`).
- **Paper venues only.** The real-money keys (a browser wallet, a venue's OAuth sign-in, Move, Earn) are drawn for whatever the Account offers and exercised only on the Account's stand-in (`account/test/standin/ui-standin.ts`) and in fake-DOM tests with a fake wallet provider — never on a real venue, never on 4820, never on `~/.buyer-agent-demo`. The real-money trigger (charter §8) is unchanged.
- Tests are offline. `face/tests/no-market-hosts.test.ts` stays green: the wallet module talks to the extension's provider and to `/data/account/*`, nothing else.
- Product copy is English; the sentences this plan pins are written in its tasks.
- `face/` suite and typecheck green; `FACE_SMOKE=1` green; `account/` suite green but the known red `test/unit/ui-superagent.test.ts`.
- Work on `feat/two-parts-4b` from local `main` once plan 4a is merged into it, in a worktree (`.claude/worktrees/two-parts-4b`); never push; never touch `strategies/*`, `~/.dsh`, `~/.buyer-agent-demo` or `.claude/launch.json`; commit messages written to a file in the session scratchpad and committed with `git commit -F <file>`, no backticks, no attribution lines.
- `feat/desk-p1-p4` overlaps none of this plan's files (it is client, `account/src/portfolio/mcp.ts` and two face server comments: `face/src/account-seat.ts`, `face/src/seat.ts`).
- Out of scope: the Account's page and its tests (plan 5 deletes them); the Superagent, Intents and Memory (§5.4) and the seat's two descriptions of them (`portfolio_memory`, `portfolio_desk`), whose "account page" words plan 5 settles with the page; the charter and the live documents (plan 5).

## Review Focus

- **The wallet sends, then the report fails** — the extension returned a hash and `/data/account/live/sent` (or `order-sent`) did not answer: the face keeps that hash, says `Your wallet sent <short hash>: Report again reports that same transaction, it does not send another`, and Report again never asks the wallet to send twice — across a re-render, and while the same payment is pressed twice. Test in Task 1.
- **No browser wallet on the page, or the operator declines in it** — no EIP-6963 announcement and no `window.ethereum`: the connect sheet says `No browser wallet answered on this page. Type the address to watch it.`; a declined `personal_sign` or `eth_sendTransaction` (code 4001) is said in the wallet's words and nothing is reported. Test in Task 1 and Task 4.
- **A move whose kind changes the fields under it** — switching `withdraw` → `transfer` while a preparation is shown: the fields follow, the old preparation is dimmed and its go key is off until the new draft is prepared, and no field of the old kind leaks into the new draft. Test in Task 2.
- **Sell many interrupted** — one leg refused at prepare, one refused at the door, one a DEX sale that waits for the wallet, the sheet closed mid-run: each leg's answer stays where it landed, the rest go on, a closed sheet signs nothing further, and the page is read again once at the end. Test in Task 3.
- **The last device signs out in Beast** — Guard first is ticked; Guard refused stops the sign-out (`Not signed out: Guard was refused — <words>`), and the device still signs; Guard taken then the sign-out refused says so and Guard stays on. Test in Task 6.

---

## File structure

| File | Responsibility |
|---|---|
| `face/client/js/wire/wallet.js` (new) | the browser wallet: discover, prove, switch chain, send, wait for the receipt |
| `face/client/js/host/wallet-send.js` (new) | a payment's or a DEX order's transactions sent and reported, once each, Report again |
| `face/client/js/host/money-view.js` (new) | the Money tab's pure views: receive rows, move sources and kinds, earn lists, payments and orders waiting for the wallet |
| `face/client/js/host/sheet-money.js` (new) | the `move`, `earn`, `subWallet` kinds |
| `face/client/js/host/sell-many.js` (new) | Sell many's engine: read, pick up to ten, prepare each, sign each in turn |
| `face/client/js/host/sheet-view.js` (modify) | delegation; `refieldsOf`; the connect kinds; the limit's scopes; `grantOf` for every ask; the `reopen` kind; the sign-out's Guard box |
| `face/client/js/host/sheet.js` (modify) | the `onPrepared` and `beforeSign` hooks |
| `face/client/js/host/account.js`, `account-view.js`, `owner-view.js`, `kinds.js` (modify) | the reads beside the page; revoke; the words |
| `face/client/js/reducers/owner.js`, `reducers/account.js`, `data/empty.js` (modify) | `sheetField` follows `refieldsOf`; the new slices |
| `face/client/js/render/account.js`, `render/owner.js`, `render/trade.js`, `router.js`, `app.js` (modify) | the Money tab, the keys, the hints, Sell many's drawer |
| `account/src/portfolio/mcp.ts` (modify) | the seat's sentences say where the owner answers |
| `face/tests/client/*` (new and modified, per task); `face/tests/account-wallet-smoke.test.ts` (new) | the tests |

---

### Task 1: The browser wallet and the sends it makes

**Files:**
- Create: `face/client/js/wire/wallet.js`, `face/client/js/host/wallet-send.js`
- Modify: `face/client/js/render/trade.js` (`underWay` :97-107), `face/client/js/host/trade-view.js` (`underWayOf` :297-299), `face/client/js/app.js` (start it; actions `sendFromWallet`, `reportAgain`)
- Test: `face/tests/client/wallet.test.js`, `wallet-send.test.js` (new), `trade-view.test.js`, `app-dom.test.js`

**Interfaces:**
- Produces:
  - `wire/wallet.js` (a port of the page's `findWallets`, `hexOf`, `proveWallet` — `connect.js:9-35` — `walletFor` and `mined` — `core.js:1345-1369` — and `tkSwitchChain` with its Robinhood Chain constant — `trade.js:64-83`):
    - `discoverWallets(win, { waitMs = 120 } = {}): Promise<Array<{ id, name, icon, provider }>>` — EIP-6963 `announceProvider` answers to one `requestProvider`, each once by `uuid` (else `rdns`, else name); none and a `win.ethereum`: that one, named as `connect.js:16` names it; none at all: `[]`.
    - `proveWallet(wallet, post): Promise<{ address, wallet }>` — `eth_requestAccounts`, `eth_chainId` (1 when it fails), `post('/data/account/wallet/challenge', { address, wallet: name, chainId })`, `personal_sign` over `hexOf(message)`, `post('/data/account/wallet/prove', { address, signature })`; throws an `Error` whose message is the Account's words (`whyOf`) or the wallet's (`err.message`).
    - `walletFor(wallets, address): Promise<wallet>` — the one whose `eth_accounts` holds the address (case-insensitive), else throws `No wallet on this page holds <short address>`.
    - `sendTxs(wallet, txs, { requote, schedule }): Promise<string>` — each tx but the last sent and waited for (`mined`: `eth_getTransactionReceipt` every 2 s, up to 120 s; `status: "0x0"` throws), `requote()` once after them when given (its fresh last tx replaces the last), the last sent; every send after `switchChain(wallet, tx.chainIdHex)`; returns the last hash.
  - `host/wallet-send.js` `startWalletSend({ store, post, getWallets, schedule })` → `{ payment(p, tx, txs), order(o), reportAgain(key), close() }`:
    - `payment` for a payment the Account built (`/data/account/exchange`'s `result.wallet`/`walletTxs`, or a page payment's `legs[0].native.walletTx`/`walletTxs`): asks `/data/account` fresh first (`money.js:27-33`'s rule: only `authorized`, or `failed` with `live.expired`, is sent; a `live.reported` hash is reported, not sent again), sends, reports `post('/data/account/live/sent', { payment: id, hash })`.
    - `order` for a DEX order (`orders[]` with `walletTxs` and no `ref`, status `pending`): the same, `requote` = `post('/data/account/live/order-requote', { order: id })` (a refusal matching `/cannot build the swap again/` keeps the built swap, `trade.js:112-115`), report `post('/data/account/live/order-sent', { order: id, hash })`.
    - One send per key (`<payment id>@<at>`, an order's `clientId`) in the air; a hash sent is kept per key until its report is taken; `reportAgain(key)` reports the kept hash and never sends.
    - Store `account.wallet[key] = { status: 'sending' | 'sent' | 'refused', said }`; said lines: `Waiting for your wallet…`, `<wallet name> sent it: <short hash>`, `<words>. Your wallet sent <short hash>: Report again reports that same transaction, it does not send another`, `<id> is no longer waiting for your wallet (<status>): nothing was sent`.
  - `underWayOf` rows gain `walletSend: { order: id } | null` (an order with `walletTxs` and no `ref`; such a row has no `cancel` and no Change…, `trade.js:2874`, `:2948`) and the Under way list gains the page's payments waiting for the wallet (`legs[0].native.walletTx`, status `authorized`) as rows `{ payment: id, words }`; `render/trade.js` draws `Waiting for your wallet` with `Send from wallet…`, and `Report again` where a hash is kept.

- [ ] **Step 1: Write the failing tests** with a fake EIP-1193 provider (records every `request`, answers or rejects as told, announces through a fake `win`):
  - `wallet.test.js`: `discoverWallets lists each announced wallet once, else window.ethereum, else none`; `proveWallet posts the challenge and the proof and returns the Account's address` (the message signed is `hexOf` of the challenge's); `a declined signature throws the wallet's words and posts no proof` (code 4001); `the Account's refusal of the proof is its words`; `sendTxs waits for the approval on chain, requotes once, sends the fresh swap`; `a receipt with status 0x0 throws and sends nothing more`; `switchChain adds Robinhood Chain on 4902 and switches again`.
  - `wallet-send.test.js`: `a payment is asked again before it is sent, then reported`; `a payment already reported is reported again, never sent`; `pressed twice, one send`; **Review Focus** `the wallet sent and the report failed: Report again reports the kept hash and the wallet is never asked to send again` (two Report again presses; the provider saw one `eth_sendTransaction`); `an order taken back since the page was read sends nothing and says so`.
  - `trade-view.test.js`: `underWayOf marks a DEX order waiting for the wallet and gives it no cancel`.
  - `app-dom.test.js`: `Under way's Send from wallet… sends the waiting order through the fake wallet and reports it`.
- [ ] **Step 2: Run them and see them fail.** `cd face && node --test tests/client/wallet.test.js tests/client/wallet-send.test.js tests/client/trade-view.test.js tests/client/app-dom.test.js` — FAIL.
- [ ] **Step 3: Implement** both modules, the Under way rows and the two actions; `app.js` hands `afterAction` the exchange answer, and an answer with `result.wallet` (a move, an Earn, a DEX order) goes to `walletSend.payment` or `walletSend.order` at once (`money.js:124-134`).
- [ ] **Step 4: Run them and see them pass**, then `npm test && npm run typecheck`.
- [ ] **Step 5: Commit.** Message: `feat(face): the browser wallet - what the Account built is sent from the operator's own wallet and reported once, Report again never sends twice`.

---

### Task 2: The Money tab — Receive and Move

**Files:**
- Create: `face/client/js/host/money-view.js`, `face/client/js/host/sheet-money.js`
- Modify: `face/client/js/host/sheet-view.js` (delegation; `export function refieldsOf(kind, fields, seed)`), `face/client/js/reducers/owner.js` (`sheetField` applies `refieldsOf`), `face/client/js/host/sheet.js` (`startSheet`'s `onPrepared(kind, prepared, draft)` dep, called after `sheetPrepared`), `face/client/js/host/account.js` (`receive(row)`, `bridgeRoutes(draft)`), `face/client/js/reducers/account.js` and `data/empty.js` (`account.receive`, `account.routes`), `face/client/js/render/account.js` (`TABS`: Money after Portfolio; `moneyTab`), `face/client/js/render/owner.js` (the move sheet's routes line under the quote), `face/client/js/router.js`, `face/client/js/app.js`
- Test: `face/tests/client/money-view.test.js`, `sheet-money.test.js` (new), `host-sheet.test.js`, `host-account.test.js`, `account.test.js`

**Interfaces:**
- Consumes: Task 1's `walletSend.payment` (a move out of a wallet); plan 4a's `receive` and `bridge-routes` routes and `writesOn`.
- Produces:
  - Tabs: `Portfolio · Money · Venues · Agents · Cards · Rules` (`#/account/money`).
  - `money-view.js` (the page's rules ported, each cited): `servedHere(v)`, `canMove(v, page)` and `canReceive(v)` (`core.js:1281-1300`, `money.js:200`); `networksOf(page)`, `bridgeChainsOf(page)`, `dollarsOf(page)` with `core.js:266-271`'s fallbacks; `receiveRowsOf(page)` → rows `{ id, venue, venueName, network, networks, asset, assets, chip, kind }` (`money.js:197-235`: a wallet one row over every EVM network in `Base, Arbitrum, Optimism, Polygon, Ethereum` order then the rest, a Polymarket wallet `Polygon · PUSD`, an exchange a row per network with its asset chip); `moveSourcesOf(page)` (the venues `canMove`, the agent wallets `agent-*` among them for Take back); `moveKindsOf(v)` (`money.js:64`, the five kinds with their labels `Withdraw to another account of yours`, `Send from this wallet`, `Across chains`, `Between its own ledgers`, `Swap stablecoins`); `moveDestinationsOf(page, v)` (`money.js:69-70`, with the not-served ones named apart).
  - `sheet-money.js` kind `move` — seed `{ from?, to?, kind?, amount? }` (a Top up's `to` an agent wallet's venue, its `amount` the ask's); fields: `from` (select over `moveSourcesOf`), `kind` (select over `moveKindsOf(from)`), then per kind exactly `money.js:76-82`'s fields (`fromLedger`/`toLedger`, `asset`/`toAsset`, `to`, `network`, `amount`); `refieldsOf('move', fields, seed)` rebuilds the set when `from` or `kind` changes, keeping every value whose field survives; draft exactly `money.js:86-90`'s `liveMove` and its two words (`Fill it in to see where it goes and what it costs.`, `Connect where it should go first.`); title `Move money · <from name>`; go `Sign and move`.
  - `account.js`: `receive({ venue, asset, network })` — one read per row key, `/data/account/receive?venue=&asset=&network=`, landing `account.receive[<venue>|<asset>|<network>]`; `bridgeRoutes(draft)` — `post('/data/account/bridge-routes', { draft })` for a prepared bridge, only the latest landing in `account.routes = { asked, status, data, message }`.
  - The Money tab: **Receive** — a row per `receiveRowsOf` row (`<venue> · <network words>`, `All EVM networks: …` for a wallet, its asset chip for an exchange) with `Show address`, which reads it and draws the address (mono), its memo (`Memo <tag>`) where there is one, whose it is (`whose`) and the Account's note, and `Copy`; **Move** — a row per source with `Move…` (the `move` sheet from it), drawn on a page that signs and `writesOn`; **Waiting for your wallet** — Task 1's payments; **Earn** — Task 3. A read-only Account's Move says `Read-only: the Account was started without trading, so it moves no money.`
  - The move sheet's routes line (bridge only, from `account.routes` for the shown preparation): `Via <tool> · at least <$> <toAsset> arrives · <eta> · network fee about <$> in your wallet`, then `Other routes: <tool> fee <$>, <eta>; …`, else the Account's words, else `No route answered.`; `Finding the routes…` while asked (`money.js:106-118`).

- [ ] **Step 1: Write the failing tests.**
  - `money-view.test.js` (fixtures shaped as the stand-in's page): `receiveRowsOf gives a wallet one row over every EVM network and an exchange a row a network`; `a watched address and a venue not served here give no row`; `moveKindsOf follows liveCan` (a wallet that sends: `send`, and `bridge` once proven; an exchange with two ledgers: `withdraw`, `transfer`, `swap`); `moveDestinationsOf leaves out the source and names the not-served apart`.
  - `sheet-money.test.js`: `the transfer draft names the same venue twice and no network`; `a swap names toAsset, a withdraw the destination and network`; `no amount: the fill-it-in words; no destination: connect first`; **Review Focus** `refieldsOf on a kind change keeps amount and asset and drops to and network, and the old kind's fields never reach the draft`.
  - `host-sheet.test.js`: `onPrepared is called with the preparation the sheet shows, never with one dropped as stale`.
  - `host-account.test.js`: `receive reads one row once while it is in the air`; `bridgeRoutes lands only for the latest preparation`.
  - `account.test.js` (render): the Money tab on a writes-on page that signs; on a read-only page; Show address drawn after its read with Copy; the bridge's routes line.
- [ ] **Step 2: Run them and see them fail.** `cd face && node --test tests/client/money-view.test.js tests/client/sheet-money.test.js tests/client/host-sheet.test.js tests/client/host-account.test.js tests/client/account.test.js` — FAIL.
- [ ] **Step 3: Implement** the views, the kind, the hooks, the reads, the tab. A move signed whose answer is `result.wallet` goes to Task 1's `walletSend.payment` (wired there).
- [ ] **Step 4: Run them and see them pass**, then `npm test && npm run typecheck`.
- [ ] **Step 5: Commit.** Message: `feat(face): a Money tab - receive at an address per account and network, move between the owner's accounts, the bridge's routes said`.

---

### Task 3: Earn in and out, and Sell many

**Files:**
- Create: `face/client/js/host/sell-many.js`
- Modify: `face/client/js/host/sheet-money.js` (kind `earn`), `face/client/js/host/money-view.js` (`earnListOf`), `face/client/js/host/account.js` (`loadEarn`), `face/client/js/reducers/account.js` and `data/empty.js` (`account.earn`, `sellMany`), `face/client/js/render/account.js` (Money's Earn; the Portfolio's `Sell many…`; Sell many's drawer), `face/client/js/app.js`
- Test: `face/tests/client/sell-many.test.js` (new), `sheet-money.test.js`, `money-view.test.js`, `account.test.js`

**Interfaces:**
- Consumes: plan 4a's `earn` and `sellable` routes; Task 1's `walletSend.order` (a DEX sale).
- Produces:
  - `money-view.js` `earnListOf(earnBody, page, side)` — `earn.js:11-25`'s order (to put in: the products that take money now and have their asset ready at their venue first, then the rest that take money, then the closed ones with their reason; to take out: the products something is in), a venue not served here named once apart (`enMissing`, `earn.js:28-36`).
  - `sheet-money.js` kind `earn` — seed `{ venue?, side, product? }` plus the earn read; fields `side` (seg `Put in` / `Take out`), `product` (select over `earnListOf`, labelled `<name> · <venue> · <asset> · <yield>`, the yield as `earn.js:42` words it), `amount`, and on Take out `all` (check `All of it`); draft `earn.js:40`'s `liveEarn` (`kind` `supply` or `withdraw`; `amount` `all` when the box is ticked); title `Earn`; go `Sign and put in` / `Sign and take out`.
  - `account.js` `loadEarn({ fresh })` — `/data/account/earn` into `account.earn`, read on entering Money and after every taken `earn`.
  - The Money tab's **Earn**: what is in each product (venue, asset, amount, yield) with `Take out…`, and `Put in…`; an Earning row under the Portfolio's Assets gains `Take out…` (`portfolio.js:1278-1296`).
  - `sell-many.js` `startSellMany({ store, getJson, owner, walletSend, afterAction, now })` → `{ open(venue?), toggle(index), review(), run(), back(), close() }`, `SELL_MANY_MAX = 10`:
    - `open` reads `/data/account/sellable?fresh=1`; the `ready` items in it (`smSellable`, `earn.js:240-245`), a count of the others and the venues not read.
    - `review` prepares each picked leg in turn — `earn.js:222-227`'s `smDraft` (`liveOrder` market sell of `qty` or the item's `sellQty`; `liveClose` for a position) — each `{ item, prepared | why }`.
    - `run` signs each prepared leg in turn (one `owner.submit` each; a leg with under 15 s left on its deadline prepared again first, `earn.js:310`); each leg's answer kept where it landed (`Sold`, the Account's refusal, or for a DEX sale `Your wallet has to send it: it waits under Trade › Under way, Send from wallet…` and `walletSend.order` started); `close()` mid-run signs nothing further; `afterAction('sellMany')` once at the end.
    - Store `sellMany = { status: 'reading' | 'picking' | 'reviewing' | 'running' | 'done', items, hidden, missing, picked, legs }`; the drawer's words: `Everything you hold that isn't a dollar. Pick up to 10: each is its own order at market and its own signature.`, `Review <n> sales`, `At most 10 at once`, `Sign <n>`.
  - The Portfolio's Assets tools gain `Sell many…` on a page that signs and `writesOn`.

- [ ] **Step 1: Write the failing tests.**
  - `money-view.test.js`: `earnListOf puts the products whose asset is ready first and the closed last`; `take out lists only what something is in`.
  - `sheet-money.test.js`: `earn drafts supply and withdraw, all of it as all`; `no product picked: Pick a product`.
  - `sell-many.test.js` (a fake owner whose `prepare`/`submit` answer per draft): `open lists the ready items and counts the rest`; `the eleventh pick is refused`; `review prepares each leg in turn and keeps a refusal as its why`; `run signs each in turn and re-prepares a leg near its deadline`; **Review Focus** `a run with a refused prepare, a refused signature, a DEX sale and the drawer closed after the second leg` — the first two keep their words, the DEX sale's wallet send is started, no `submit` after the close, `afterAction` once.
  - `account.test.js`: Money's Earn section and its keys; the Portfolio's Sell many… only on a page that signs and writes.
- [ ] **Step 2: Run them and see them fail.** `cd face && node --test tests/client/sell-many.test.js tests/client/sheet-money.test.js tests/client/money-view.test.js tests/client/account.test.js` — FAIL.
- [ ] **Step 3: Implement** the kind, the list, the engine, the drawer and the keys.
- [ ] **Step 4: Run them and see them pass**, then `npm test && npm run typecheck`.
- [ ] **Step 5: Commit.** Message: `feat(face): Earn in and out on Money, and Sell many on the Portfolio - up to ten holdings, one signature each`.

---

### Task 4: Venues — every connector kind, and Close to agents

**Files:**
- Modify: `face/client/js/host/account-view.js` (`connectOptionsOf` :324-336 loses `elsewhere`; `ELSEWHERE` :316 goes; `venuesOf` rows gain `closedToAgents`), `face/client/js/host/sheet-view.js` (the connect kind's fields and draft for `address`, `sign-in`, `cli`; `connectCheckOf` :345-367; kind `reopen`), `face/client/js/host/account.js` (`revoke(venue)`, `signIn(option)` and its poll), `face/client/js/reducers/account.js` and `data/empty.js` (`account.connectWallet`, `account.signIn`, `account.closing`), `face/client/js/render/account.js` (the Venues rows, `disconnectKey` :143-157), `face/client/js/render/owner.js` (the connect sheet's wallet tiles and sign-in key), `face/client/js/app.js`
- Test: `face/tests/client/sheet-view.test.js`, `host-account.test.js`, `account-view.test.js`, `app-dom.test.js`

**Interfaces:**
- Consumes: Task 1's `discoverWallets`, `proveWallet`; plan 4a's `revoke`, `wallet/challenge`, `wallet/prove`, `signin/start`, `signin/status` routes and the callback.
- Produces:
  - The connect sheet, by the option's `needs` (`connect.js:300-577`; the venue id rule `connect.js:317-330`):
    - `address` — fields `ref` (`Address`, `0x…`) and `label` (`Shown as`); above them, for a `wallet` option, a tile per `discoverWallets` wallet (`Use <name>`): `proveWallet` fills `ref` and, when blank, `label`; draft `{ type: 'connectVenue', venue: <kind, or kind-<6 hex of the address> when the kind is on the page already>, connector: option.connector, label, credentialRef: ref }`; a ref not `/^0x[0-9a-fA-F]{40}$/` → `An address is 0x and 40 hex digits`. An address no wallet proved connects as the Account decides (watched).
    - `sign-in` — no typed field; the key `Sign in at <who>` (`who` the option label's first part): opens a tab inside the click (`win.open('about:blank', '_blank')`, its `opener` cleared), `post('/data/account/signin/start', { connector: option.kind })`, sends the tab to the answer's `url` (no tab: the link `Open <who>'s sign-in page`), then polls `/data/account/signin/status?state=` every 1.5 s for at most 15 min while the sheet is this one; `ready` sets the hidden `credentialRef` to the state; draft `{ type: 'connectVenue', venue: option.kind, connector: option.connector, label: '', credentialRef: state }`; before ready → `Sign in at <who> first`.
    - `cli` — no field; draft `{ type: 'connectVenue', venue: option.kind, connector: option.connector, label: '', credentialRef: '' }`; the check line shows the option's `example` (what to run on this machine) beside its reach.
    - `connectCheckOf` words: `Waiting for <wallet>…`, `<wallet> signed: <short address> is yours.`, the wallet's or the Account's refusal, `No browser wallet answered on this page. Type the address to watch it.`, `Asking <who> where to sign in…`, `Sign in on <who>'s page, then come back.`, `Signed in. Connect it.`, `The sign-in ran out: start again.`, the status's `error`.
  - Venues rows: a connected venue (not paper) whose id is in the page's `dial.revoked` is tagged `Closed to agents` and has `Reopen…` (on a page that signs: kind `reopen`, seed `{ venue, name }`, title `Reopen <name> to agents`, go `Sign and reopen`, draft `{ type: 'setPolicy', change: 'restore', value: venue }`); any other has `Close to agents` on any page that reads the Account — `account.revoke(venue)`: one `post('/data/account/revoke', { account: venue })` per venue in the air, said `<name> is closed to agents: they keep reading it, and place or move nothing there. Reopening it is signed.` or the Account's words, then the page fresh.

- [ ] **Step 1: Write the failing tests.**
  - `sheet-view.test.js`: `an address connects under the kind, or kind-<6 hex> when the kind is on the page`; `a bad address is said`; `a sign-in drafts only once signed in, with the state`; `a cli option drafts with blank label and ref`; `no option is Connect on the Account page any more` (no draft or check returns those words); `reopen drafts setPolicy restore`.
  - `host-account.test.js`: `revoke posts once per venue while in the air and reads the page fresh`; `signIn starts, sends the tab to the venue, polls the status and stops when the sheet closes` (fake timers, a fake `win.open`); `the sign-in runs out after 15 minutes`.
  - `account-view.test.js`: `venuesOf marks a venue in dial.revoked`; `connectOptionsOf keeps every kind and carries no elsewhere`.
  - `app-dom.test.js`: `the connect sheet's wallet tile proves the fake wallet and fills the address`; **Review Focus** `no wallet on the page: the sheet says to type the address; a declined signature says the wallet's words and posts no proof`; `Close to agents on a page that does not sign posts the revoke; Reopen… needs a page that signs`.
- [ ] **Step 2: Run them and see them fail.** `cd face && node --test tests/client/sheet-view.test.js tests/client/host-account.test.js tests/client/account-view.test.js tests/client/app-dom.test.js` — FAIL.
- [ ] **Step 3: Implement** the three connector kinds, the sign-in poll, the wallet tiles, the rows' two keys and the `reopen` kind.
- [ ] **Step 4: Run them and see them pass**, then `npm test && npm run typecheck`.
- [ ] **Step 5: Commit.** Message: `feat(face): Venues connects every kind the Account offers - a browser wallet, a sign-in, an address, the command line - and closes or reopens a venue to agents`.

---

### Task 5: Agents — agent wallets, every limit scope, Gravit's own row

**Files:**
- Modify: `face/client/js/host/sheet-money.js` (kind `subWallet`), `face/client/js/host/sheet-view.js` (`limitSeedOf` :89-98, the `limit` and `endLimit` kinds :120-134, :199-215; `refieldsOf` for `scope`), `face/client/js/host/account-view.js` (`agentsOf` :258-273 — Gravit's row's knocking address; `seatWords` :51; `walletsOf(page)`), `face/client/js/render/account.js` (`agentsTab`, :220-260), `face/client/js/app.js` (`openSheetFrom` cases)
- Test: `face/tests/client/sheet-view.test.js`, `sheet-money.test.js`, `account-view.test.js`, `account.test.js`

**Interfaces:**
- Consumes: Task 2's `move` kind (Top up, Take back).
- Produces:
  - `walletsOf(page)` → the page's `subAccounts` rows `{ id, name, agent, agentName, address, capUsd, balanceUsd, venue: 'agent-' + slug(name) }` (`slug` as `core.js:621`).
  - Kind `subWallet` — seed `{ agent?, name?, float? }` and the page's let-in keys; fields `name` (`Name`, ≤ 16), `agent` (select over the keys `status === 'ok'`), `float` (`Keeps up to ($)`); draft `{ type: 'createSubAccount', name, agent: <lowercase>, float }` (`portfolio.js:1263-1275`); a name not `/^[A-Za-z0-9][A-Za-z0-9 _-]{0,15}$/` → `A name of letters and digits, up to 16`; no float → `How much it keeps at most`; title `An agent wallet`; go `Make it`.
  - The limit kind gains `scope` (seg over the scopes the page can serve: `trade` `Trading`, `venues` `Moving money between your accounts`, `earn` `Putting money into earn`, `payees` `Paying for things`), with `refieldsOf('limit', …)` swapping the venue pick per scope (`portfolio.js:1196-1200`'s three venue rules; `earn`'s never `*`) and, for `payees`, `payees` (text, hosts comma-separated) and `anyPayee` (check `Any payee`, → `*`), as `agents-mount.js:193-196`; `limitSeedOf(page, address, name, scope = 'trade')` reads the standing limit of that scope; draft `{ type: 'approveSpend', agent, scope, allow, perPayment, budget, windowHours: 0, validUntil }`; title `Give <name> a limit`. `endLimit` takes its scope from the seed (`agents-mount.js:123`).
  - The Agents tab: each agent's limits each with `End limit…` by its scope; `Give a limit…`; **Agent wallets** — a row per wallet (`<name> · pays for <agent> · <address> · <balance> of up to <cap>`) with `Top up…` (the `move` sheet, `to` the wallet's venue, `from` the only source or a pick, `money.js:186-191`) and `Take back…` (the `move` sheet from the wallet's venue), and `Open an agent wallet…`; **Gravit's own row** gains `Revoke…` (the existing confirm and `revoke` kind, by the seat's name), `Give a limit…` and each limit's `End limit…` by the seat view's address, and — while the seat is knocking — `Let in…` seeded from the page's `requests` entry under the seat's name. The comment at `render/account.js:224` says what is now true.

- [ ] **Step 1: Write the failing tests.**
  - `sheet-money.test.js`: `subWallet drafts createSubAccount with the agent lowercased`; the name and float words.
  - `sheet-view.test.js`: `a venues limit picks among the venues that move money and the agent wallets`; `an earn limit never drafts *`; `a payees limit drafts the hosts lowercased, or * for any payee`; `refieldsOf on a scope change swaps the pick and keeps the amounts`; `limitSeedOf reads the standing limit of the scope asked`; `endLimit ends the scope it names`.
  - `account-view.test.js`: `walletsOf names each wallet's venue as the Account does`; `Gravit's row carries the knocking request's address`.
  - `account.test.js`: the Agents tab's wallet rows and keys; Gravit's row with Revoke…, Give a limit… and End limit… on a page that signs, none on one that does not.
- [ ] **Step 2: Run them and see them fail.** `cd face && node --test tests/client/sheet-money.test.js tests/client/sheet-view.test.js tests/client/account-view.test.js tests/client/account.test.js` — FAIL.
- [ ] **Step 3: Implement** the kind, the scopes, the rows and the keys.
- [ ] **Step 4: Run them and see them pass**, then `npm test && npm run typecheck`.
- [ ] **Step 5: Commit.** Message: `feat(face): Agents - agent wallets opened and topped up, every limit scope, and Gravit's own row with Revoke and its limit`.

---

### Task 6: Cards grants every ask, and Settings › Devices offers Guard first

**Files:**
- Modify: `face/client/js/host/sheet-view.js` (`grantOf` :276-292; the `signOut` kind's fields and title), `face/client/js/host/sheet.js` (`startSheet`'s `beforeSign(sheet)` dep, awaited in `submit` before `owner.submit`), `face/client/js/render/account.js` (the Cards tab's Grant, :278-290), `face/client/js/render/owner.js` (the sign-out sheet's line), `face/client/js/app.js` (`grant` :870-875; `beforeSign` wiring with `account.guard()`)
- Test: `face/tests/client/sheet-view.test.js`, `host-sheet.test.js`, `app-dom.test.js`

**Interfaces:**
- Consumes: plan 4a's `session`, `leverageCap`, `beast` kinds and `account.guard()`; Task 2's `move`; Task 4's connect kinds; Task 5's `subWallet`.
- Produces:
  - `grantOf(ask, page, venuesHere)` for every kind an agent asks (`agentAsk` kinds, `account/src/portfolio/account/sign.ts:202-204`; the page's grants, `portfolio.js:1148-1170`): `limit` → `limit` (as today); `venue` → `limit` with it ticked when the venue is on the page, else `connect` seeded with the option for it (`connector` preset, `venuesHere` as Venues reads it; `null` until that read has landed, and the Grant key reads it); `letIn` → `letIn`; `topup` → `move` into the agent's wallet with the ask's dollars when it has one (`walletsOf`), else `subWallet` seeded `{ agent, name: <agentName, letters and digits, ≤ 16>, float: <ask usd, else 50> }`; `session` → `session`; `leverage` → `leverageCap` seeded from `dial.maxLeverage`; `mode` → `beast`. Each sheet's title line under it says the ask: `<agentName> asked: “<text>”` (text as the Account sends it). An unknown kind: null (no Grant key).
  - The `signOut` sheet: field `guard` (check `Switch to Guard first: whatever an agent asks for waits for a signature`) only while the page's mode is `open`, ticked when this page is the only device owner on the page's `signers.owners`, unticked otherwise (`agents-mount.js:232-262`); the line under it `Your <n> other device(s) keep(s) signing.` or `No browser will sign for the account until one pairs again, with a new pairing code: the terminal the Account runs in shows it, or npm run account:service -- code when it runs in the background.`; the draft unchanged (`{ type: 'signOut', device }`).
  - `beforeSign(sheet): Promise<string | null>` — for a `signOut` sheet whose `guard` is ticked, `account.guard()`'s answer: refused → the sheet shows `Not signed out: Guard was refused — <words>` and signs nothing; taken → the signature goes on, and its done line ends `Guard is on.`; a sign-out refused after a taken Guard says `Not signed out: <words>` and Guard stays.

- [ ] **Step 1: Write the failing tests.**
  - `sheet-view.test.js`: `grantOf answers a sheet for every kind of ask` (one case each: the seven kinds and an unknown one); `a venue ask on a venue not connected opens the connect sheet with its connector`; `a top-up with no wallet opens an agent wallet seeded with the ask`; `the sign-out's Guard box is there only in Beast, ticked for the last device`.
  - `host-sheet.test.js`: `beforeSign's refusal stops the signature and says it`; `beforeSign is not asked for a sheet that does not need it`.
  - `app-dom.test.js`: `Grant on a session ask signs setPolicy session`; **Review Focus** `the last device signs out in Beast: Guard refused, nothing signed and the device still signs; Guard taken and the sign-out refused, Guard stays and the words say so`.
- [ ] **Step 2: Run them and see them fail.** `cd face && node --test tests/client/sheet-view.test.js tests/client/host-sheet.test.js tests/client/app-dom.test.js` — FAIL.
- [ ] **Step 3: Implement** the grants, the box, the line and the hook.
- [ ] **Step 4: Run them and see them pass**, then `npm test && npm run typecheck`.
- [ ] **Step 5: Commit.** Message: `feat(face): Cards grants every kind of ask, and the last device's sign-out offers Guard first`.

---

### Task 7: The words, and one real boot over the stand-in

**Files:**
- Modify: `face/client/js/host/account-view.js:51`, `face/client/js/host/owner-view.js:13`, `face/client/js/host/kinds.js:95`, `:108`, `face/client/js/render/account.js` (the seat box's keys :206-207; comments :186-187, :224, :280), `face/src/account-seat.ts:19`, `:50`, `face/src/seat.ts:7`, `:99` (comments), `account/src/portfolio/mcp.ts` (:172, :180, :426, :446, :474, :843, :973, :1042, :1163, :1221)
- Create: `face/tests/no-account-page-words.test.ts`, `face/tests/account-wallet-smoke.test.ts`
- Test: `face/tests/client/account-view.test.js`, `owner-view.test.js`, `kinds.test.js`; `account/test/*` (the seat's)

**Interfaces:**
- Produces the words (§5.8):
  - The seat box: `Open the Account page` goes; its keys are `Refresh` and, when cards wait, `Answer under Cards` (`#/account/cards`).
  - `<name> · knocking — let it in under Account › Agents`.
  - `Waiting to be let in — a browser that signs lets it in, under Settings › Devices`.
  - `Card raised · <id> · answer it under Account › Cards`; its batch form `<n> card(s) raised · answer under Account › Cards`.
  - The seat (`mcp.ts`): every "the account page" / "the Account page" that says where the owner acts becomes the owner's face — `the owner lets it in on the owner's Gravit face (Account › Agents)`, `the owner answers this card on the owner's Gravit face (Account › Cards)`, `the owner connects that venue first, on the owner's Gravit face (Account › Venues)`, `The owner sees it on the owner's Gravit face (Account › Cards) for a day`, and the stderr line `the owner authorises it on the owner's Gravit face`; `portfolio_memory`'s and `portfolio_desk`'s descriptions (:1055, :1097) are left for plan 5.
  - `no-account-page-words.test.ts`: every non-comment line of `face/client/js/**/*.js` and `face/src/**/*.ts` (a line whose trimmed start is `//`, `*` or `/*` is a comment) matches none of `/Account page/i`, `/answer it there/i`; every line of `account/src/portfolio/mcp.ts` outside the `portfolio_memory` and `portfolio_desk` registrations matches no `/account page/i`.
  - `account-wallet-smoke.test.ts` (`account-market-smoke`'s boot, its own file): pair; `receive?venue=<stand-in exchange>&asset=USDC&network=Base` answers an address; sign a `liveMove` `transfer` between the stand-in exchange's ledgers; sign `liveEarn` `supply` of 10 USDT into its flexible product, then `withdraw` `all`; `sellable?fresh=1` lists items, and two of them prepared and signed as Sell many does; `POST /data/account/revoke { account: <stand-in predictions> }` puts it in `dial.revoked`, a signed `setPolicy restore` takes it out; `createSubAccount` for Claude Code with a float of 20; `approveSpend` scope `venues` for Claude Code; the stand-in's seeded asks granted (the bigger budget as a `limit`) and declined (`answerAsk`); `wallet/challenge` through the face answers a message whose domain is the face's host; Settings' sign-out with Guard first: `guard`, then `signOut`, the device no longer signs and `mode` is `guard`; nothing of a signature or the code in the face's output.
- [ ] **Step 1: Write the failing tests** — the words test, and the client tests' expected sentences changed to the new ones (`account-view.test.js`, `owner-view.test.js`, `kinds.test.js`); the seat's own test where it pins a sentence (`account/test/` — grep `account page`).
- [ ] **Step 2: Run them and see them fail.** `cd face && node --import tsx --test tests/no-account-page-words.test.ts && node --test tests/client/account-view.test.js tests/client/owner-view.test.js tests/client/kinds.test.js` — FAIL.
- [ ] **Step 3: Change the words** in the files above.
- [ ] **Step 4: Write and run the smoke.** `cd face && FACE_SMOKE=1 node --import tsx --test tests/account-wallet-smoke.test.ts` — PASS (a failing step is a bug in Tasks 1–6, fixed there with its own test first).
- [ ] **Step 5: Run the suites.** `cd face && npm test && npm run typecheck && FACE_SMOKE=1 npm test`; `cd account && npm test && npm run typecheck` — green (the account suite but its known red).
- [ ] **Step 6: Commit.** Message: `feat: no face sentence sends the operator to the Account's page, the seat says where the owner answers, and a smoke drives the wallet half through the face`.

---

## Owed after the build (the operator's, or mine on the operator's go-ahead)

Restart the face (and the Account, for the seat's words) from this tree and hard-reload; walk each of §5.1's fifteen items on the face against the operator's writes-on Account with a paper venue, the real-money ones (a browser wallet, the Robinhood sign-in, Move, Earn) on the stand-in only (spec §5.9, §8). Plan 5 then checks that the face signs for `~/.buyer-agent-demo` before the page goes (§5.6).

## Self-review notes (run 2026-11-01)

- Spec coverage, this plan's share of §5.1: venue close/reopen (Task 4); receive (Task 2); move between accounts and a browser wallet's send, with the bridge routes and the order-sent reports (Tasks 1, 2); Earn in and out and Sell many (Task 3); agent wallets (Task 5); every limit scope and Gravit's row's Revoke and limit (Task 5); a browser wallet's challenge and proof and a venue's OAuth sign-in (Task 4); an address and the command-line connector (Task 4); every kind of ask granted (Task 6); Sign out's Guard first (Task 6). §5.3's tab order (Task 2 completes it). §5.8 (Task 7, with plan 4a's Task 2 for the Account's own callback words). Plan 4a covers the Market half, Rules and every proxy route; together the fifteen items are all on the face.
- Calls made where the spec left them: a `venue` ask is granted by connecting the venue when it is not on the account (the page's grant) and by a limit naming it when it is (the face's today); a `topup` with no agent wallet opens one; the sign-out's Guard box is offered whenever the mode is Beast and ticked for the last device (the page offers it in Beast whatever the count; the spec's "last device" decides the default); Close to agents, like Guard, works on a page that does not sign; Show address reads an address on a press rather than as the row scrolls into view; the move's fields follow its kind through `refieldsOf` in the reducer rather than re-opening the sheet; a bridge's routes are read after its preparation lands, beside the quote, as the page does; the seat's Memory and Desk descriptions wait for plan 5, since §5.4 keeps those features off the face and the place they will name is plan 5's to decide.
- Types: `discoverWallets`, `proveWallet`, `walletFor`, `sendTxs`, `startWalletSend`, `receiveRowsOf`, `moveKindsOf`, `moveSourcesOf`, `moveDestinationsOf`, `earnListOf`, `walletsOf`, `refieldsOf`, `onPrepared`, `beforeSign`, `startSellMany`, `SELL_MANY_MAX` and the kinds `move`, `earn`, `subWallet`, `reopen` are spelled the same in every task; plan 4a's `writesOn`, `tradeCan`, `RULES_KINDS`, `guard` are used as it defines them.
