# The Account's two parts, plan 5 — the page retired, compose, the docs and the drills — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Account serves no page and, under compose, no port to anyone but the agent box; every word the operator or Gravit reads points at the face; the carried minors of plans 4a and 4b are closed; the charter and the live documents say what the tree now is; and the live drills are written down as owed.

**Architecture:** A precondition check comes first and gates everything destructive: the page goes only once the operator has confirmed that the face signs for the home they run (an Account with an owner admits a new device only when an owner device signs `convertToMultiSigUser`; the pairing code works only while it has no owner). Then `account/src/portfolio/public/` and every route that served it leave `server.ts`, the `Host` fence loses its navigation exception, and a sign-in can start only from the face. The rest is words, one small client fix wave, a one-line compose change with its test, and the documents.

**Tech Stack:** `account/` (Node 22, vitest, its own package); `face/` (`node --test` via tsx, the client's fake-DOM tests in `face/tests/client/*`, `FACE_SMOKE=1` boots); `compose.yml`; Markdown and one Chinese HTML page.

**Spec:** `docs/superpowers/specs/2026-11-01-account-two-parts-design.md` — §5.6, §5.7, §8 (and §3 goals 5–7, §5.9's done-when, §6). Plans 1, 2, 3, 4a and 4b are built and merged (local main @ 9614314c); their plans are `docs/superpowers/plans/2026-11-01-account-two-parts-plan-{1-china,2-lunhui,3-akshare,4a-proxy-market-rules,4b-wallet}.md`. The carried minors come from the final reviews of 4a and 4b (`…/scratchpad/plan4a-final-review.md`, `plan4b-final-review.md` in the session that wrote this plan; each minor is restated in Task 4 with its file and line, so the executor does not need them).

## Global Constraints

- **Task 1 is a gate.** No task after it starts until the operator has said in chat that the face signs for the Account they run (or that it has no owner). The plan cannot verify the operator's live home; Task 1's check reads it and the operator confirms. `--fresh` is never the remedy (it throws away the owner, the venues, the agents and their limits — spec §5.6).
- **The face holds no key and signs nothing itself (D18)**; the door protocol, the envelope, the Guard and every surviving route's shape are unchanged (spec §3 non-goals). The only route behaviours that change: everything outside `/api/` answers 404; a cross-site navigation is refused like any cross-site request; `POST /api/account/signin/start` without the face's origin header is refused.
- The pairing-code print stays (`npm run account` start line, `npm run account:service -- code`); its line keeps the token `pairing code:` that `account-service.ts codeLine` finds.
- Paper venues only; nothing in this plan connects, moves or signs on a real venue, on 4820 or on `~/.buyer-agent-demo`. Task 1's check is a read of `GET /api/account` and nothing else.
- Tests offline. `account/` suite green with **no known red** (the red `ui-superagent.test.ts` leaves with the page); `face/` suite, typecheck and `FACE_SMOKE=1` green.
- Product copy and documents in English, but `Gravit-Docs-and-Prompt-Loops.html`, which stays Chinese.
- Never touch `strategies/*`, `~/.dsh`, `~/.buyer-agent-demo`, `.env*`, or `.claude/launch.json` (untracked operator config: Task 8 documents what in it is stale; nobody edits it).
- Work on `feat/two-parts-5` from local `main` in a worktree (`.claude/worktrees/two-parts-5`); never push; commit messages written to a file in the session scratchpad and committed with `git commit -F <file>`, no backticks, no attribution lines.
- `feat/desk-p1-p4` (another session's, still moving) overlaps this plan in `CLAUDE.md`, `DEVELOPMENT.md`, `GRAVIT.md`, `Gravit-Design.md`, `ROADMAP.md` and `face/README.md`; whichever lands second resolves them (spec §7). No code file of this plan is in its diff.
- Out of scope: the Superagent, Intents and Memory on the face (§5.4 — their server code and seat tools stay); the seat into the Account box (DEVELOPMENT §10 item 25); a peer check behind the widened fences (item 26).

## Review Focus

- **An operator's old bookmark to `http://127.0.0.1:4820/`** (or a tab left open): it gets a 404 whose JSON sentence names Gravit's face, never express's `Cannot GET /` or a stale cached page — every answer is `no-store`, and an old `?v=` script URL 404s. Test in Task 2.
- **A venue's sign-in after the page is gone**: started through the face it still finishes through the face (the callback forwarded without browser headers passes the narrowed fence); started at the Account directly (no face origin header) it is refused in words that name Account › Venues, so no callback is ever built on an address the venue can no longer navigate back to. Tests in Task 2 (`face-origin.test.ts`, `server-guard.test.ts`, and `account-market-smoke` re-run).
- **An Account with an owner and no face device**: the check says stop and why, in the operator's terms (let the face in from the page's Settings › Devices, or sign the page's device out for a new code), and exits non-zero; an ownerless Account and one whose owners include a device labelled `Gravit face` are told apart — and a label is said to be a hint, not a proof. Tests in Task 1.
- **The two-box run followed from memory**: the operator opens `127.0.0.1:4820` under compose and nothing answers; the README's two-box drill says to read the code with `docker compose logs account` and pair on the face. Test in Task 5 (`compose.test.ts` reads `ports` and `expose`).
- **The widened words test on words that are not about our page**: Kalshi's own "account page" (`adapters/kalshi.ts`), "account pages" in a plural citation, and a sentence inside a template literal that starts with `*` — the first two are not flagged (not scanned / `\b`), the last is. Test in Task 3 (the test's self-test).

---

## File structure

| File | Responsibility |
|---|---|
| `account/src/portfolio/owners-check.ts` (new) | Task 1: the owner standing of a running Account, read from `GET /api/account`, as a verdict and lines; its CLI |
| `account/src/portfolio/server.ts` (modify) | no page, no static serving, the narrowed fence, the sign-in start's refusal, the callback page with no script, the start lines' words |
| `account/src/portfolio/public/` (delete) | the page |
| `account/test/unit/*` page tests (delete or trim) | listed in Task 2 |
| `account/test/unit/server-no-page.test.ts` (new) | what the Account answers outside `/api/` |
| `account/src/portfolio/account/state.ts`, `mcp.ts`, `service.ts`, `account-check.ts`, `test/standin/ui-standin.ts` (modify) | the words |
| `dsh/skills/mechanics/account-seat-guide/SKILL.md` (modify) | the seat guide's one line |
| `face/tests/no-account-page-words.test.ts` (modify) and the 23 client/server files it then flags | the widened words test |
| `face/client/js/host/sell-many.js`, `sheet-view.js`, `wallet-send.js`, `render/owner.js`, `render/account.js`, `app.js`, `face/src/account-proxy.ts` (modify) | the carried minors |
| `compose.yml`, `face/tests/compose.test.ts` (modify) | 4820 published to nobody |
| `Gravit-Design.md`, `DEVELOPMENT.md`, `ROADMAP.md`, `CLAUDE.md`, `GRAVIT.md` (if needed), `face/README.md`, `account/README.md`, `Gravit-Docs-and-Prompt-Loops.html` (modify) | the documents and the owed drills |

---

### Task 1: The precondition — does the face sign for the home the operator runs?

**Files:**
- Create: `account/src/portfolio/owners-check.ts`, `account/test/unit/owners-check.test.ts`
- Modify: `account/package.json` (script `"account:owners": "tsx src/portfolio/owners-check.ts"`)

**Interfaces:**
- Produces:
  - `type OwnerVerdict = "ownerless" | "face-signs" | "stop"`
  - `ownerStanding(signers: unknown): { verdict: OwnerVerdict; lines: string[] }` — reads the `signers` of `GET /api/account` (`{ owners: Array<{ id, kind, label }>, threshold, pendingDevices: Array<{ kid, at }> }`, `account/exchange.ts:1504`): no owner → `ownerless`; an owner of `kind: "device"` whose label is `Gravit face` (the face's pairing label, `face/client/js/host/owner.js:39`) → `face-signs`; otherwise, or a shape it cannot read → `stop`. `lines` always lists each owner as `<kind> · <label>` and the count of devices waiting, then the verdict's sentence (exact copy below).
  - `checkOwners({ url, fetch }): Promise<{ verdict, lines }>` — `GET <url>/api/account` (default `http://127.0.0.1:4820`, `--url` overrides); unreachable or non-2xx → `stop` with `The Account at <url> did not answer: start it (npm run account) and run this again`.
  - CLI: prints the lines; exit 0 for `ownerless` and `face-signs`, 3 for `stop`. Reads nothing but that one route; prints no key or id beyond the labels.
- The verdicts' sentences (exact):
  - ownerless: `No owner yet: retiring the page locks nobody out. The face pairs as the first owner with the code the Account prints.`
  - face-signs: `A device labelled Gravit face is an owner. A label is a hint, not a proof: open the face's Account screen and check that its device line reads "This page signs for the account" before the page goes.`
  - stop: `STOP: no owner device is the face's. Before the page goes, let the face in from the page's Settings › Devices (the face asks under Settings › Devices first), or sign the page's device out there so that the Account prints a new code the face pairs with. Never --fresh: it throws away the owner, the venues, the agents and their limits.`

- [ ] **Step 1: Write the failing tests** in `owners-check.test.ts`: `no owner is ownerless and exits 0`; `an owner device labelled Gravit face is face-signs, and says a label is a hint`; `owners without the face's device stop, naming Settings › Devices and never --fresh`; `an unreadable signers shape stops`; `an Account that does not answer stops, naming npm run account` (an injected `fetch` that rejects, and one that answers 500); `the lines list each owner as kind · label and the devices waiting, and no id`.
- [ ] **Step 2: Run them and see them fail.** `cd account && npx vitest run test/unit/owners-check.test.ts` — FAIL (no module).
- [ ] **Step 3: Implement `owners-check.ts`** and the package script.
- [ ] **Step 4: Run them and see them pass**, then `npm run typecheck` — green.
- [ ] **Step 5: Commit.** Message: `feat(account): account:owners says whether the face signs for the running Account before its page goes`.
- [ ] **Step 6: Run the check against the operator's running Account and STOP.** `cd account && npm run account:owners` (a read of `GET /api/account` on loopback — nothing else). Report its lines to the controller, with this question for the operator: "Is the Account on 4820 the one on `~/.buyer-agent-demo` (its start line names the ledger path), and does the face sign for it?" **Do not start Task 2 until the operator answers yes in chat.** On `stop`, the operator acts on the page first (the stop sentence) and the check is run again. (A read on 2026-11-01 found the running Account ownerless; it is not this plan's evidence, because the operator may have restarted it since, and 4820 was once a `~/.openpaper` process.)

---

### Task 2: The page retired — the Account answers its API and nothing else

**Files:**
- Delete: `account/src/portfolio/public/` (all of it)
- Modify: `account/src/portfolio/server.ts` — the header comment (:1-149: no `GET /`, `/ui/…`, fonts; the sign-in lines), `PUBLIC`, `PageFile`, `pages`, `pageFile`, `ASSET_REF`, `versioned`, `pageVersioned`, `encodingFor`, `sendPage`, `KEEP_A_YEAR` (:186-275) removed with their imports (`createHash`, `readFileSync`, `zlib`, `join` where unused); the cache middleware (:430-433: every answer `no-store`); the routes :435-469 (`file`, `/`, `/portfolio.js`, `/portfolio.css`, `/account`, `/account.css`, `/owner.js`, `/ui/…`, `/fonts/…`) removed; the fence (:497-512: `navigable` and `topLevel` gone, `foreignSite` is any `cross-site` or `same-site`); `signin/start` (:675-685); `signedInPage` (:364-368); the start lines (:1219-1221, :1244-1245, :1251-1253)
- Modify: `account/src/portfolio/service.ts:2486` (the sign-out's pairing line), `account/src/portfolio/account-check.ts:94`, `account/test/standin/ui-standin.ts` (header :1-3 and every "the page" that means ours — it is now the face smokes' stand-in, driven through `FACE_ACCOUNT_URL`)
- Modify: `face/src/account-proxy.ts:163-165` (`CALLBACK_QUERY` gains `["error_uri", 500]`)
- Create: `account/test/unit/server-no-page.test.ts`
- Delete (whole files — each runs the page's scripts or reads its files, and starts no server of its own but for the three marked): `account/test/unit/ui-agents.test.ts`, `ui-book.test.ts`, `ui-brains.test.ts`, `ui-chart.test.ts`, `ui-earn.test.ts`, `ui-fixes.test.ts`, `ui-floor.test.ts`, `ui-markets.test.ts`, `ui-memory.test.ts`, `ui-mode.test.ts`, `ui-ocean.test.ts`, `ui-portfolio.test.ts`, `ui-receive.test.ts`, `ui-statement.test.ts`, `ui-stream.test.ts`, `ui-superagent.test.ts` (the known red), `ui-trade.test.ts`, `review2-frontend.test.ts`, `page-scripts.test.ts` (server), `server-fonts.test.ts` (server)
- Trim (keep the server cases): `review2-public.test.ts` (F2, F3 and `page()` go; F1 stays), `review2-placeholder.test.ts` (F9 :268-287 goes), `review2-service.test.ts` ("the page's own files and the account's answers" :412-426 becomes the `/api/` no-store case alone), `account-sign-out.test.ts` (the `owner.js` describe :191-244 and `OWNER_JS` go; the door's sign-out cases stay), `attack/rekey-second-account.test.ts` (the "Connect a new key…" describe :118-161, its `page()` helper and `PUBLIC` go; the first describe stays)
- Keep: `ui-standin.test.ts` (it asserts the stand-in's API, not the page)
- Modify tests: `server-guard.test.ts:37` and `:44` (a cross-site navigation to `/` and to the callback: 403), `face-origin.test.ts:71-90` (the "else its own" half becomes the refusal), `face/tests/account-proxy.test.ts` (the callback forwards `error_uri`)

**Interfaces:**
- Produces, in `server.ts`:
  - `export const NO_PAGE = "The Account serves no page: its owner's screens are Gravit's face (Markets, Trade, Account). This address answers its API under /api/."` — every request outside `/api/` that passes the fence is `404 { ok: false, error: NO_PAGE }`, with or without the account layer (`--classic` keeps its API, loses its page).
  - The fence: `!local || foreignOrigin || site === "cross-site" || site === "same-site"` → 403 as today. The stream's own navigation refusal (:719) stays.
  - `POST /api/account/signin/start` with no valid `x-gravit-face-origin` (`faceOriginOf(req)` undefined) → `400 { ok: false, refusal: no("E_ACCOUNT_BAD_ACTION", { message: "a venue's sign-in starts from Gravit's face, under Account › Venues: open it there" }) }`, before `svc.signIn(kind)` is asked anything; with it, as today.
  - `signedInPage` with no `<script>`; its words unchanged ("This tab can be closed." already says it).
  - The start lines: `pairing code: <code> — the first browser becomes the owner only with this code, typed on Gravit's face (Account)`; the EADDRINUSE line names `npm run account -- --port <n+1> --home <another directory>` and no URL; the `--mm` line says `connect MetaMask from Gravit's face (Account › Venues)`; `your account at <url> · real accounts only: connect them on Gravit's face · ledger …`. `service.ts:2486` the same `typed on Gravit's face (Account)`; `account-check.ts:94` `connect it from Gravit's face (Account › Venues), which names its exchange`.
- Face: `CALLBACK_QUERY` has six names; `error_uri` is forwarded and the Account's `finish` ignores it.

- [ ] **Step 1: Write the failing tests.**
  - `server-no-page.test.ts` (a real `startPortfolioServer` on port 0 over a scratch-home `PortfolioService`, as `review2-service.test.ts` builds one): `GET / answers 404 with NO_PAGE as JSON`; `/account, /account.css, /owner.js, /portfolio.js, /portfolio.css, /ui/core.js, /ui/core.js?v=0123456789abcdef and /fonts/manrope-v20-latin.woff2 are 404 and say NO_PAGE`; `a service without the account layer answers / with 404 too`; `every answer, /api/now and / alike, is no-store`; `src/portfolio/public is not on disk` (`existsSync` false).
  - `server-guard.test.ts`: the navigation case renamed `… a navigation from another site is refused like any cross-site request`, with `/` → 403 and `/api/account/signin/callback` → 403.
  - `face-origin.test.ts`: `signin/start sends the face's callback when the face names its origin, and refuses without it` — without the header: 400, the refusal's message names `Account › Venues`, and the sign-in registered nothing (`registered` stays `[]`).
  - `face-origin.test.ts`: `the success page carries no script` (`/<script/i` absent from a finished callback's HTML).
  - `face/tests/account-proxy.test.ts`: `the callback forwards error_uri` (a query with `error=access_denied&error_uri=https%3A%2F%2Fexample%2Fe` reaches the stub Account with both), and `an error_uri past 500 characters is 400` beside the existing bound cases (:1127).
- [ ] **Step 2: Run them and see them fail.** `cd account && npx vitest run test/unit/server-no-page.test.ts test/unit/server-guard.test.ts test/unit/face-origin.test.ts`; `cd face && node --import tsx --test tests/account-proxy.test.ts` — FAIL.
- [ ] **Step 3: Delete `public/` and the page tests; trim the five mixed files.** Then `grep -rnE "portfolio/public|/ui/[a-z-]+\.(js|css)|account\.html|owner\.js" account/src account/test` — expected: no line (the stand-in's header may name `public/` only as gone; reword it).
- [ ] **Step 4: Change `server.ts`, `service.ts`, `account-check.ts`, `ui-standin.ts` and `CALLBACK_QUERY`** as the Interfaces say.
- [ ] **Step 5: Run the suites.** `cd account && npm test && npm run typecheck` — green, no known red left; `cd face && npm test && npm run typecheck`; `cd face && FACE_SMOKE=1 node --import tsx --test tests/account-market-smoke.test.ts tests/account-wallet-smoke.test.ts tests/account-graft-smoke.test.ts` — PASS (the market smoke drives the callback through the face).
- [ ] **Step 6: Commit.** Message: `feat(account): the Account serves no page - its API alone, a cross-site navigation refused like any cross-site request, a sign-in started only from the face`.

---

### Task 3: The words — the seat, the refusals, the guide, and a words test that reads every line

**Files:**
- Modify: `account/src/portfolio/account/state.ts:536`; `account/test/unit/account-trade.test.ts:216`, `account-earn.test.ts:208`
- Modify: `account/src/portfolio/mcp.ts:1055` (`portfolio_memory`), `:1097` (`portfolio_desk`)
- Modify: `dsh/skills/mechanics/account-seat-guide/SKILL.md:10` (and :19-20, "the Account's own card on its page")
- Modify: `face/tests/no-account-page-words.test.ts`, then every file it flags: today 65 lines, all comments, in `face/client/js/{app.js, icons.js}`, `host/{account,account-view,market-view,markets,money-view,owner,rules-view,sell-many,sheet-market,sheet-rules,sheet-view,trade-view,wallet-send}.js`, `render/{account,markets,rail}.js`, `reducers/{account,markets}.js`, `wire/{owner-key,wallet}.js`, `face/src/account-proxy.ts`; and the five client tests' header comments that cite `account/src/portfolio/public/…` (`sheet-money`, `sheet-rules`, `sell-many`, `money-view`, `sheet-market`)

**Interfaces:**
- `E_MANDATE_NONE` (exact): trade — `the owner has not approved this agent to trade: it gets a trading limit on the owner's Gravit face (Account › Agents)`; earn — `the owner has not approved this agent to put money to earn: it gets an earn limit on the owner's Gravit face (Account › Agents)`. (The phrase is 4b's, `mcp.ts` uses it already.)
- `portfolio_memory`: `the owner reads every word of it on the account page (Account › Memory), changes it, forgets it, and sets its switches` becomes `the owner's Gravit face does not show it (the face draws no Memory): the owner reads, changes or forgets it, and sets its switches, only by signed actions at the Account's door — never tell the owner to look for it on a screen`. `portfolio_desk`: `(Agents on the account page)` becomes `(hired by the owner's signed actions at the Account's door; the owner's Gravit face does not draw the desk)`. Nothing else in either description changes.
- The guide, :10: `the seat trades inside limits the operator signs on the face (Account › Agents)`; the Account's card is `answered in the face's Cards (Account › Cards)`.
- `no-account-page-words.test.ts`:
  - `FACE_WORDS = [/\baccount(?:'s)?(?: own)? page\b/i, /answer it there/i]` — catches "Account page", "Account's page", "Account's own page", "account page"; not "account pages", not "the retired page".
  - No line is skipped as a comment any more (a `*` line may sit inside a template literal); scanned: `client/js/**/*.js`, `client/index.html`, `src/**/*.ts`.
  - The seat: every line of `account/src/portfolio/mcp.ts` and of `account/src/portfolio/account/state.ts`, the `portfolio_memory`/`portfolio_desk` exception gone (`seatPointersIn` removed, `pointersIn` used for both).
  - A comment that cites where a rule was ported from says `the retired page (account/src/portfolio/public/ui/<file>:<lines> at 9614314c)`; one that means the JSON the face reads at `/data/account` (the `AccountPage` view) says `the Account's read`; one that means the HTML the Account answers a sign-in's callback with says `the callback's page`.

- [ ] **Step 1: Write the failing tests.** The words test's self-test: `pointersIn` flags `Open the Account page`, `the Account's page says`, `on the Account's own page` and ` * on the Account page` (a `*` line), and does not flag `account pages`, `the retired page (account/src/portfolio/public/ui/trade.js:2948 at 9614314c)` or `the Account's read`; the two scans as above. The two pinned refusals in `account-trade.test.ts:216` and `account-earn.test.ts:208` changed to the new words.
- [ ] **Step 2: Run them and see them fail.** `cd face && node --import tsx --test tests/no-account-page-words.test.ts` (lists the 65 lines and the two seat descriptions); `cd account && npx vitest run test/unit/account-trade.test.ts test/unit/account-earn.test.ts` — FAIL.
- [ ] **Step 3: Change the words** in the files above; reword every flagged comment by the two rules (port citation, `the Account's read`).
- [ ] **Step 4: Run the suites.** `cd face && npm test && npm run typecheck`; `cd account && npm test && npm run typecheck` — green.
- [ ] **Step 5: Commit.** Message: `fix: every sentence and comment points at the face - the seat's Memory and Desk, the missing-limit refusal, the seat guide, and a words test that reads every line`.

---

### Task 4: The carried minors of the 4a and 4b reviews

**Files:**
- Modify: `face/client/js/host/sell-many.js` (`startSellMany` :63, the DEX leg :154-157, the closing line :164), `face/client/js/app.js:363`
- Modify: `face/client/js/host/sheet-view.js` (`connectRefieldsOf` :300-308, `grantOf` :581)
- Modify: `face/client/js/render/owner.js:121` (`connectKeys`, `Sign in at <who>`), `face/client/js/host/account.js` (the sign-in start, where it sets `si.status`)
- Modify: `face/client/js/host/wallet-send.js:34-36` (`once`)
- Modify: `face/client/js/render/account.js` (`earnBox` :532-546)
- Test: `face/tests/client/sell-many.test.js`, `sheet-view.test.js`, `host-account.test.js`, `account.test.js` (the Account screen's render tests, where `earnBox` is drawn), `wallet-send.test.js`, `app-dom.test.js`

**Interfaces:**
- `startSellMany({ store, getJson, owner, sendOrder, afterAction, now })` — `sendOrder(order)` replaces `walletSend`; `app.js` passes `o => sendFromWallet(walletSend.order(o))`, so a DEX leg's flight is the one `sendFromWallet` chains to `account.load({ fresh: true })` (4b minor 1).
- The run's closing line: `Sell many: <n> of <m sales> went through` and, when legs wait for the wallet, `… went through, <k> waiting for your wallet` (4b minor 4).
- `connectRefieldsOf`: whenever `connector` changes, the fields are rebuilt keeping `label` only — a typed or proven address (`ref`, `connectWallet`) never carries to another option, whatever its shape (4b minor 2).
- `Sign in at <who>` is disabled while this option's sign-in is `starting`, `waiting` or `ready`; a new start clears the hidden `credentialRef` before it asks (4b minor 3).
- `once(key, …)` with an empty or `@…` key sends nothing and answers `{ key: '', status: 'refused', said: 'Nothing was sent: this one carries no id the Account can send for. Refresh and try again.' }` instead of `null`, dispatching no `walletSaid` (there is no row to hang it on); `app.js sendFromWallet` already shows a returned `said` through `tradeSaid` (4b minor 5).
- `grantOf` `topup`: `moveSourcesOf(page).find(x => !x.agent)?.id ?? ''` (4b minor 6).
- `earnBox`: a failed read draws the refusal alone, not `Nothing is earning to take out.` under it (4b minor 7).
- 4a's two (the callback page's script, `error_uri`) are Task 2's.

- [ ] **Step 1: Write the failing tests**: `sell-many.test.js` — `a DEX leg is handed to sendOrder, not sent from inside the run` and `the closing line counts the legs waiting for the wallet`; `sheet-view.test.js` — `changing the connector keeps the label and drops a typed or proven address, even for another address option`, `a topup with no own source seeds an empty from`; `host-account.test.js` — `a new sign-in start clears the kept credentialRef`, and the test file that draws `connectKeys` today (grep `Sign in at` under `face/tests/client`) — `Sign in at is off while the sign-in starts, waits or is ready`; `wallet-send.test.js` — `a payment with no id answers why and sends nothing` (the fake provider saw no request); `account.test.js` — `a failed earn read shows its refusal and no "Nothing is earning" line`; `app-dom.test.js` — `Sell many's DEX leg reads the Account again after the wallet answers`.
- [ ] **Step 2: Run them and see them fail.** `cd face && node --test tests/client/sell-many.test.js tests/client/sheet-view.test.js tests/client/host-account.test.js tests/client/account.test.js tests/client/wallet-send.test.js tests/client/app-dom.test.js` — FAIL.
- [ ] **Step 3: Implement** as the Interfaces say.
- [ ] **Step 4: Run the suites.** `cd face && npm test && npm run typecheck` — green.
- [ ] **Step 5: Commit.** Message: `fix(face): the 4b review's minors - Sell many's wallet leg through sendFromWallet, a connector change drops the address, Sign in at off while it waits, a silent no-op said, earn's refusal alone`.

---

### Task 5: Compose — 4820 published to nobody but the agent box

**Files:**
- Modify: `compose.yml` (the header comment :1-13; `account`: `ports` removed, `expose: ["4820"]`)
- Modify: `face/tests/compose.test.ts:22-33`
- Modify: `face/README.md` "The two-box drill" (:3687-3757), `account/README.md` "In the box"

**Interfaces:**
- `compose.yml`: the account box has no `ports` key and `expose: ["4820"]`; `PORTFOLIO_BIND`, `PORTFOLIO_HOSTS: "account:4820"`, the health check, `env_file: .env.ifind` and the network stay; the agent box still publishes `127.0.0.1:3090:3090` and reaches `http://account:4820`. The header says: the agent box publishes 3090 on the host's loopback; the account box publishes nothing — only the agent box reaches it, at `account:4820` on the `gravit` network; stop the host face first (3090); stopping the host Account too is advised (one Account in sight), not required.
- `compose.test.ts`: `compose.yml runs the face and the Account as two boxes …` asserts `c.services.account.ports === undefined`, `deepEqual(c.services.account.expose, ["4820"])`, the agent's ports unchanged, and that no service's `ports` names 4820.
- The two-box drill, rewritten: Up (unchanged, but "both boxes publish" → the agent box alone); **Pair** — `docker compose logs account` prints the code; open the face's tokenized URL, Account, type the code at `Pair with the code the Account printed in its terminal`; open a paper account from Account › Venues on the face; **The fence** — `curl -s -m 3 http://127.0.0.1:4820/api/now` fails (nothing listens on the host), and `docker compose exec agent node -e "fetch('http://account:4820/api/now').then(r=>console.log(r.status))"` prints 200; **The standing**, **The read** (as today), **AKShare in the box** (Gravit asks one AKShare question; `portfolio_akshare` answers with no card), **The negative**, **Down**. Step 3's "admit it as Gravit on the Account page" becomes "let it in under Account › Agents on the face". Ends **Not yet run** — owed (DEVELOPMENT §10 item 24).
- `account/README.md` "In the box": "the box publishes 4820 on the host's loopback" → publishes nothing; the code via `docker compose logs account`, paired on the face; the last bullet's "the owner's browser, which reaches the page at 127.0.0.1:4820" → the owner's browser reaches the Account only through the face (`/data/account…`), so it never sends `account:4820`.

- [ ] **Step 1: Write the failing test** (the `compose.test.ts` assertions above).
- [ ] **Step 2: Run it and see it fail.** `cd face && node --import tsx --test tests/compose.test.ts` — FAIL on `account.ports`.
- [ ] **Step 3: Change `compose.yml`, the drill and `account/README.md`.**
- [ ] **Step 4: Run it and see it pass**; `cd face && npm test` — green.
- [ ] **Step 5: Commit.** Message: `build: under compose the Account publishes no port - the agent box alone reaches account:4820, the code read from the box's log and paired on the face`.

---

### Task 6: The charter

**Files:**
- Modify: `Gravit-Design.md` — the status line (:3-12), §1 (:38-60), §3's diagram (:115-145), §4 (the seat row :168, the owner's row :169, the Lunhui row's audit cell :158, the notes :171-180), §5 (D17 :205, D18 :206), §7.3 (:320-327), §8 (the D18 trigger :347), §9 (the Account seat bullet :366-387)

**Interfaces** (what each passage must say; wording the executor's, the charter's voice and one-sitting scale kept):
- Status: `revised 2026-11-0x for the Account's two parts — A shares, Lunhui's reach and AKShare in the Account box, the wallet and Market halves on the face, the Account's page retired (§1, §3, §4, §5 — D17, D18 — §7.3, §8, §9)`.
- §1 MARKET: the Account provides every market — crypto, US stocks, RWAs, perpetuals, predictions and A shares (China, view-only, in CNY) — read keyless and server-side by the Account; AKShare is the Account's sidecar, reached through the seat's `portfolio_akshare`; the Lunhui rows freeze Tencent and Eastmoney samples fetched through the Account's relay (and the boards stand-in through its iFinD route), the evidence saying `via: "account"`; the agent box reaches no market host and holds the DeepSeek key only. ACCOUNT: the face's Markets and Trade are the Account's Market part's only face, its Account screen the wallet part's (Portfolio · Money · Venues · Agents · Cards · Rules); the Account serves no page.
- §3: the MCP ROWS box names the Account seat alone (AKShare through it); MARKET says A shares by the Account and AKShare in its box.
- §4: the seat row — admitted and limited on the face (Account › Agents), the Account's card answered in the face's Cards; the owner's row — every owner action of both halves (orders, close, change, leverage, Money's moves and Earn, venues, agent wallets and limits, cards, Rules) is signed with the browser's key at the door through the proxy; Guard and Close to agents are the two unsigned writes, both the Account's safer direction; still no gate of this tree's.
- D17: grants signed from the face; the iFinD token and `akshare-mcp` live in the Account box; under compose 4820 is published to nobody but the agent box.
- D18: the face's page is the Account's only page (since 2026-11-0x); the proxy is an allow-list of thirty-eight exact routes; the OAuth callback is the one navigation, forwarded through the face; a browser wallet signs in its own extension; **new, in the debt's words**: with one owner device, a lost browser profile leaves the Account with no device that can sign and no code (a code is printed only while it has no owner) — only `--fresh`, which loses the owner, venues, agents and limits; held by keeping a second face browser paired (Settings › Devices). Its trigger adds money moved by hand from the face (Move, Earn, a browser wallet's send) on a real venue.
- §7.3: the owner's key is the browser's, on the face's page alone.
- §9: "Guard · Beast and the cap on the face", "the venues that connect only on the Account's page" and "perpetuals and leverage from the ticket" closed (built 2026-11-01, plans 4a/4b); "A shares into the Account box, then the Account's own page retired" built (spec `2026-11-01-account-two-parts-design.md`); the live drills owed (`face/README.md` "The two-parts drills").

- [ ] **Step 1: Check what the charter says now.** `grep -nE "AKShare|Account('s)? (own )?page|Guard · Beast|4820|publish" Gravit-Design.md` — the list of passages to change (each named above).
- [ ] **Step 2: Rewrite the passages.**
- [ ] **Step 3: Verify.** `grep -nE "\bAccount('s)?( own)? page\b" Gravit-Design.md` — only past-tense lines (the status's history, a "retired" sentence); `grep -n "mcp__akshare" Gravit-Design.md` — none; `cd face && npm test` (the docs tests) — green.
- [ ] **Step 4: Commit.** Message: `docs(charter): the Account's two parts - every market by the Account, both halves on the face, its page retired, the lost-device debt said`.

---

### Task 7: DEVELOPMENT.md, ROADMAP.md, CLAUDE.md, GRAVIT.md

**Files:**
- Modify: `DEVELOPMENT.md` — §1 (:118), §3.9 the Account service (:652-774), §4.4 the route table (:1681-1734, the `/data/account…` rows), §4.6 (:1768-1803), §5.1–§5.4 the client's Account screen, Markets and Trade (from :1958; :2976's "No Guard · Beast switch, no cap, no Move" and its kin), §6 paths, §7.3 counts, §7.4 the drills table (:4220-4278), §9 a residual for the lost single device, §10 items 22, 23, 24 (:4997-5020)
- Modify: `ROADMAP.md` (the built log), `CLAUDE.md` (only rows whose facts moved), `GRAVIT.md` (only if a fact Gravit reads moved; ≤ 4,500 bytes, `face/tests/gravit-md.test.ts`)

**Interfaces:**
- §3.9: no page (`NO_PAGE`, every path outside `/api/` 404, no static files, `--classic` API only); the fence's one rule (cross-site and same-site refused, navigations included; the stream's own navigation refusal); `signin/start` refused without the face's origin header; the callback page carries no script; `npm run account:owners` (Task 1); the pairing line; the test count after the page's tests left.
- §4.4: the proxy's thirty-eight exact routes as `face/src/account-proxy.ts:607` counts them (23 reads, 2 streams, 12 writes, the callback), `CALLBACK_QUERY`'s six names.
- §5: the Account screen's six tabs and what each draws and signs, Markets' and Trade's Close…/Change…/Leverage and a market's depth, from the code (`render/account.js`, `render/markets.js`, `render/trade.js`, the `sheet-*.js` kinds) — written the way §5 already writes the four tabs.
- §9: a new residual (next free R-number): one owner device and a lost browser profile — `--fresh` the only way back; the second paired face browser is the mitigation; the charter's D18.
- §10: item 22 *Built 2026-11-01 (plans 1–3)*, its owed live drill pointing at `face/README.md` "The two-parts drills"; item 23 *Built 2026-11-0x (plans 4a, 4b, 5)*: the fifteen §5.1 items on the face, the page gone, 4820 unpublished under compose — owed: the drills; item 24 updated: 4820 unpublished, the pairing through the face, the fence step, AKShare in the box — still not run. ROADMAP's built log gains one entry for the two parts (spec, plans 1–5, the date).
- `CLAUDE.md`: the `account/` row (no page under `public/`; `account:owners`; under compose 4820 unpublished), the `face/src/account-seat.ts · account-proxy.ts` row (grants by the face's owner keys alone; "twenty exact routes … three writes" → thirty-eight, twelve writes, the callback), the `face/client/` row (the Account screen's six tabs, the Market half's sheets), the gotchas' last bullet ("admit the seat as **Gravit** on the Account page" → on the face, Account › Agents; the boxes publish 3090 only). Stays one root file, about its current length.
- `GRAVIT.md`: read it against the tree; change nothing unless a sentence Gravit reads is now false (none is known: it names no page).

- [ ] **Step 1: Check what each says now.** `grep -nE "\bAccount('s)?( own)? page\b|public/|4820|twenty exact|Guard · Beast" DEVELOPMENT.md CLAUDE.md ROADMAP.md GRAVIT.md`.
- [ ] **Step 2: Rewrite the sections** as the Interfaces say, each fact read from the code it names.
- [ ] **Step 3: Verify.** The grep of Step 1 — only past-tense lines; `wc -c GRAVIT.md` ≤ 4,500; `cd face && npm test` — green (`gravit-md.test.ts` among them).
- [ ] **Step 4: Commit.** Message: `docs: DEVELOPMENT, ROADMAP and CLAUDE say the Account serves no page, both halves are on the face, and 4820 is the agent box's alone`.

---

### Task 8: face/README.md, account/README.md, the loops page, and the owed drills

**Files:**
- Modify: `face/README.md` — "The Account seat" (:311-398, incl. :341, :351, :364), "Markets and Account" (:1043-1282, incl. the Account section :1214-1282 and :1254-1272), "The Account in the face" (:1283-1507, incl. :1358, :1437, :1448, :1462, :1477, :1506), "The account-seat drill" (:3555-3635, incl. :3571, :3575, :3584, :3608, :3613), "The owner drill" (:3636-3686), the Gate-2 drill's :3051; a new section **"The two-parts drills"** after "The owner drill"
- Modify: `account/README.md` (Run, the seat, Tests)
- Modify: `Gravit-Docs-and-Prompt-Loops.html` (:181, :271, :294, :319 and every passage that has the Account's card answered on its page)

**Interfaces:**
- Every "the Account page"/"the Account's (own) page" that sends the operator somewhere becomes the face's place for it (Account › Agents, Cards, Venues, Rules, Money; Settings › Devices); one that means the `/data/account` JSON becomes "the Account's read"; the Account section lists the six tabs and drops "Not here, by the design: …" for §5.4's three (the desk and its brains, Intents, Memory); the seat box's `Open the Account page` is `Answer under Cards`; the device-line table's waiting row is plan 4b's `Waiting to be let in — a browser that signs lets it in, under Settings › Devices`.
- The owner drill: its precondition is a face that signs (`npm run account:owners`, Task 1), not "your browser already its owner on the Account's own page"; step 2 is let in from another face browser that signs (Settings › Devices); it recommends keeping a second face browser paired (the lost-device debt); its steps 3 and 9 check the face, not the page.
- `launch.json` (documented, never edited): its `account` entry's `url` opens `/`, which now answers `NO_PAGE`, and the iFinD file belongs to the `account` entry's start, not the face's (spec §4.2) — the operator's to change.
- **"The two-parts drills"** — the operator's (or the executor's on the operator's go-ahead) checklist, each with Needs, numbered steps and PASS criteria as observations, ending **Not yet run — owed after plan 5**:
  1. *China on the Account* — restart the host Account and the face from this tree, hard-reload; Markets › China lists rows in CNY with the session phase; search `600519` finds it; its page draws the facts (`CN_FACTS`) and 1D/5D minute lines and the longer bars; a star on it lands in the Account's watch list; with the Account stopped, China says the Account is not answering and shows no stale price unmarked.
  2. *A Lunhui market run through the Account* — a `cn-market` run seals; its evidence files say `via: "account"`; boards from Eastmoney or from the iFinD stand-in (`.env.ifind` sourced for the Account, not the face); with the Account stopped, a freeze refuses and its modules read `NOT_EVALUABLE`.
  3. *Gravit asks AKShare through the seat* — `curl -s 127.0.0.1:4820/api/akshare/tools` lists 14 tools; in a channel Gravit answers an A-share question with `portfolio_akshare`, no card; the face's tool list has no `mcp__akshare__*`.
  4. *Rules on a `--read-only` Account* — the cap, session and leverage rows say why there is nothing to set (spec §5.3); the mode row is as the Account answers it, Guard one unsigned click.
  5. *Rules on a writes-on Account with a paper venue* (`--live-cap 1`) — Guard ⇄ Beast (Beast signed, Guard unsigned), the cap, the session renewed, their leverage, each read back; Gravit's paper order still raises Gate 2 in Beast; then the fifteen §5.1 items on the face (spec §5.9), the real-money ones (a browser wallet, the Robinhood sign-in, Move, Earn) on the stand-in only (`account/test/standin/ui-standin.ts`, never 4820).
  6. *The page gone* — `curl -s 127.0.0.1:4820/` answers `NO_PAGE`; a sign-in started from the face finishes through the face.
  7. *The two boxes with 4820 unpublished* — "The two-box drill".
  Each records its run in `DEVELOPMENT.md` §7.4 with the date and `git rev-parse --short HEAD`.
- `account/README.md`: Run — the Account serves no page; its owner's screens are Gravit's face; `npm run account:owners`; the pairing code typed on the face; Tests — no known red.
- The loops page (Chinese): only where a loop moved — the AKShare row (`mcp-akshare` gone; the seat's `portfolio_akshare` through the Account's sidecar), the MCP children (the seat alone), the Account's card answered in the face's Cards, the Account serving no page; a dated note under its head (`2026-11-0x 按 main @ <sha> 更新：…`). The 2026-10-19 measurements (schema sizes) stay as recorded, marked as of their date.

- [ ] **Step 1: Check what each says now.** `grep -nE "\bAccount('s)?( own)? page\b|account page|Open the Account page|4820" face/README.md account/README.md`; `grep -nE "akshare|AKShare|4820" Gravit-Docs-and-Prompt-Loops.html`.
- [ ] **Step 2: Rewrite** the sections and write "The two-parts drills".
- [ ] **Step 3: Verify.** The Step 1 greps — only past-tense lines and the drills' `curl … 4820` lines; `cd face && npm test` — green.
- [ ] **Step 4: Commit.** Message: `docs: face and account READMEs and the loops page say the face is the Account's only page, and the two-parts drills are written as owed`.

---

### Task 9: The whole tree, green and true

**Files:** none new; fixes only, each with its test first, in the task that owns the code.

- [ ] **Step 1: Run every suite.** `cd account && npm test && npm run typecheck` — green, no known red; `cd face && npm test && npm run typecheck && FACE_SMOKE=1 npm test` — green.
- [ ] **Step 2: The done-when checks (spec §5.9, §3).** `test ! -e account/src/portfolio/public`; `grep -rnE "portfolio/public" account/src account/test face/src face/client/js` — only "the retired page (… at 9614314c)" citations; `grep -n "4820" compose.yml` — only `expose`, `PORTFOLIO_HOSTS`, the health check and the agent's `FACE_ACCOUNT_URL`; `node --import tsx --test face/tests/no-account-page-words.test.ts face/tests/no-market-hosts.test.ts face/tests/compose.test.ts` — PASS.
- [ ] **Step 3: Leave the branch for the final review on fable** (spec §7) and the merge decision to the operator; record in the ledger that the drills of "The two-parts drills" and the two-box drill are owed.

---

## Owed after the build (the operator's, or the executor's on the operator's go-ahead)

Restart the host Account from this tree (on `~/.buyer-agent-demo`, the iFinD file sourced there) and the face (without it), hard-reload, and run `face/README.md` "The two-parts drills" 1–6, then "The two-box drill" with Docker Desktop's daemon up (DEVELOPMENT §10 item 24). This plan runs none of them.

## Self-review notes (run 2026-11-01)

- **Spec coverage.** §5.6: the page and its serving (Task 2), the fence's exceptions (Task 2 — none left), the page's tests incl. `ui-superagent` (Task 2, with the server cases kept), the pairing print kept (Task 2's Interfaces, Global Constraints), the precondition (Task 1, a gate). §5.7: no port, `account:4820`, `docker compose logs account`, host loop unchanged, the drill rewritten (Task 5; run owed). §5.8's last words (Task 3; 4b did the rest). §8: the charter (Task 6), DEVELOPMENT/CLAUDE/GRAVIT (Task 7), the READMEs and the loops page (Task 8), the drills written as owed (Task 8). §5.9's done-when (Task 9). §3 goal 7 (Task 9). The carried minors: 4a's two (Task 2), 4b's seven (Task 4), the carry-in words (Task 3).
- **Calls made where the spec left them:** everything outside `/api/` answers 404 with one JSON sentence naming the face (not a redirect, not an empty body), `--classic` included; the fence keeps no navigation exception at all — the callback reaches the Account from the face's server, which sends no `Sec-Fetch-Site`; a sign-in started without the face's origin is refused rather than built on the Account's own address, which no venue could now navigate back to; the callback page drops its auto-close script (the face's CSP blocked it anyway); `error_uri` is forwarded (and ignored by the Account) rather than refused; the precondition is a read-only `account:owners` script plus the operator's confirmation, since a label is not proof and the face's key lives in the browser; compose uses `expose: ["4820"]` with no `ports`, and stopping the host Account is advised, not required; the Memory and Desk descriptions say the face does not draw them and the owner acts on them only by signed actions; comments are scanned by the words test like any line, ported-from citations say "the retired page (… at 9614314c)", and the `/data/account` JSON is "the Account's read"; Sell many gets a `sendOrder` callback instead of the wallet engine; the stand-in stays, as the face smokes' Account; the lost-single-device debt is written into D18 and §9's residuals.
- **Types and names:** `ownerStanding`, `checkOwners`, `OwnerVerdict`, `NO_PAGE`, `CALLBACK_QUERY`, `startSellMany({ … sendOrder … })`, `connectRefieldsOf`, `grantOf`, `once`, `earnBox` are spelled the same in every task; 4b's phrase "the owner's Gravit face (Account › …)" is reused verbatim.
- **Proportion:** nine tasks, three of them documents; code blocks none — the steps carry signatures, exact copy and test names.
