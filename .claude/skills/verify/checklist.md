# What a diff owes

Each item is a `###` heading `<id> — <title>`, then three one-line fields: `- when:` (globs from
the repo root, in backticks, comma-separated), `- check:` (an agent runs it) or `- owed:` (the
operator's), and `- why:`. `match.mjs` reads this file and refuses an item missing a field.

## Suites

### face-suite — the face's suite
- when: `face/src/**`, `face/client/**`, `face/plugins/**`, `face/scripts/**`, `face/tests/**`, `face/package.json`, `face/package-lock.json`, `GRAVIT.md`, `CLAUDE.md`, `AGENTS.md`, `dsh/**`, `roles/**`, `bots/**`, `compose.yml`, `market/src/**`
- check: `npm test && npm run typecheck` in `face/`.
- why: AGENTS.md; the face's tests also read `GRAVIT.md`, `CLAUDE.md`, `AGENTS.md`, `dsh/`, `roles/`, `bots/`, `compose.yml` and `market/src`.

### face-smoke — real boots
- when: `face/src/**`, `face/plugins/**`, `face/package.json`, `face/package-lock.json`, `account/**`, `market/src/**`
- check: `FACE_SMOKE=1 npm test` in `face/`, from a checkout outside `/tmp` and `$TMPDIR`; the smoke files boot real faces, so it takes minutes.
- why: AGENTS.md; the smoke files' stand-in Account (`face/tests/helpers/standin.ts`) runs `account/` and `market/src`'s server.

### account-suite — the Account's suite
- when: `account/**`, `market/src/**`
- check: `npm test && npm run typecheck` in `account/`, never at the same time as the market's suite.
- why: AGENTS.md; `account/`'s tests import `market/src`; both suites bind the same fixed ports.

### market-suite — the Market's suite
- when: `market/**`
- check: `npm test && npm run typecheck` in `market/`, never at the same time as the Account's suite.
- why: AGENTS.md; both suites bind the same fixed ports.

## Focused checks

### client-words — words the client writes
- when: `face/client/js/render/**`, `face/client/js/host/**`, `face/client/js/composer/**`, `face/client/js/i18n/**`, `face/client/index.html`
- check: every new word is a key in both `face/client/js/i18n/en.js` and `zh.js` (`<area>.<part>.<name>` from the English), drawn through the words helpers; `npx --no -- tsx --test tests/client/words-*.test.js` in `face/`.
- why: face/README.md "The page (client/)"; `words-guard.test.js` finds English written inline.

### client-golden — the pinned screens
- when: `face/client/js/render/**`, `face/client/js/host/**`, `face/client/js/i18n/**`, `face/client/css/**`
- check: `npx --no -- tsx tests/client/golden-write.js --dump <dir>` in `face/`, once on a `git archive HEAD` copy (with `face/node_modules` linked in) and once on the tree; `diff -r` the two; only the states meant to change differ. Then `--pin --repin <names>`, and the same with `--lang zh`.
- why: `face/tests/client/words-golden.test.js`; the golden is append-only and re-pinned by name, so a review sees which states moved.

### client-seen — see the screen
- when: `face/client/**`
- check: look at it. In the primary checkout, hard-reload 127.0.0.1:3090, which serves `face/client/` from disk; in a worktree, a second face as AGENTS.md says (it draws no desk). A screen not seen goes under Owed, with the steps for the operator.
- why: CLAUDE.md's gotchas; `face/src/static.ts`.

### caps — byte caps on what agents read
- when: `GRAVIT.md`, `CLAUDE.md`, `AGENTS.md`, `dsh/profile/*.md`, `roles/*/ROLE.md`, `face/src/cycle.ts`, `face/src/protocols.ts`, `face/src/roles.ts`, `face/tests/gravit-md.test.ts`, `face/tests/claude-md.test.ts`, `face/tests/cycle.test.ts`, `face/tests/protocols.test.ts`
- check: measure each touched file after your edit (`wc -c`) against its cap: `ROLE_MD_MAX_BYTES` (`face/src/roles.ts`); `CYCLE_MAX_BYTES`, `DESK_MAX_BYTES`, `ROUTER_MAX_BYTES` (`face/src/cycle.ts`); `PROTOCOL_MAX_BYTES`, `LUNHUI_MODULE_MAX_BYTES`, `MEMORY_MAX_BYTES` (`face/src/protocols.ts`); the budgets in `face/tests/gravit-md.test.ts` and `face/tests/claude-md.test.ts`. A change that raises a cap, or edits the test that pins it, goes under Decisions.
- why: these files go into model requests (every desk turn, every gravit request); a change that loosens the check judging it is not verified by passing it.

### roles-mirror — gravit's composition
- when: `roles/**`, `dsh/profile/cycle.md`, `dsh/profile/lunhui-run.md`, `dsh/profile/lunhui-module.md`, `face/scripts/render-roles.ts`
- check: `npm run render:roles` in `face/`, before the face suite; the regenerated `bots/gravit/agent.cordis.yml` goes in the same commit. A `roles/` edit is the operator's to ask for (AGENTS.md), and the mirror it regenerates goes with it.
- why: `face/scripts/render-roles.ts` is the one writer of that file; `face/tests/roles.test.ts` fails on a stale or hand-edited one.

### keyless-sources — the machine's one address
- when: `market/src/**`, `market/test/**`, `face/src/edgar.ts`, `face/src/filings.ts`
- check: nothing you run fetches a live keyless source in a loop: fetch once, save, and work (and hand subagents) the saved file; tests use the fakes.
- why: the running market shares the address; repeated fetches of a keyless source got it rate-limited (HTTP 429), the market with it.

### live-on-restart — services run this checkout
- when: `face/src/**`, `face/plugins/**`, `face/scripts/**`, `face/client/**`, `dsh/**`, `roles/**`, `bots/**`, `GRAVIT.md`, `account/src/**`, `market/src/**`
- check: the report names the installed service the change reaches at its next restart, committed or not, and whether it can stop that boot; a `face/client/` edit in the primary checkout reaches 3090 at the next page reload, with no restart.
- why: `face/scripts/service.ts`, `account/src/portfolio/account-service.ts` and `market/src/market-service.ts` run this checkout's sources.

## Drills (the operator's)

### drills-face — the five face-wide drills
- when: `face/src/**`, `face/plugins/**`, `face/package.json`, `face/package-lock.json`
- owed: the Gate-2, ask-user, bots, room and role drills.
- why: face/README.md: each is "run after any face or dsh change".

### drill-transport — the transport drill
- when: `face/client/**`, `face/package.json`, `face/package-lock.json`
- owed: the transport drill.
- why: face/README.md: "run after any client or dsh change".

### drill-dsh-ui-port — the dsh UI port drill
- when: `face/client/js/composer/**`, `face/client/js/host/composer.js`, `face/client/js/host/attachments.js`, `face/client/js/mask.js`, `face/client/js/host/turns-view.js`, `face/client/js/host/jobs*.js`, `face/client/js/host/live.js`, `face/client/js/i18n/**`, `face/client/js/prefs.js`, `face/client/js/keys.js`, `roles/pdf-page-reader/**`, `face/client/index.html`, `face/client/js/app.js`
- owed: the dsh UI port drill (keyed); for `index.html` and `app.js`, when the change touches the script, the composer's, the thread's or the keys' part.
- why: its heading in face/README.md.

### drill-event-analog — the event analog drill
- when: `face/plugins/analog/**`, `face/src/source-reader.ts`, `roles/source-reader/**`, `dsh/skills/mechanics/analog-guide/**`, `face/src/task-relay.ts`, `face/client/js/host/{analog,event-table,event-window}.js`, `face/client/js/render/{event-table,event-window}.js`
- owed: the event analog drill.
- why: its heading in face/README.md.

### drill-cycle — the cycle drill
- when: `dsh/profile/cycle.md`, `roles/**`, `face/package.json`, `face/package-lock.json`
- owed: the cycle drill.
- why: face/README.md: after any change to `cycle.md`, `roles/` or the dsh pins.

### drill-account-seat — the account-seat drill
- when: `face/src/account-seat.ts`, `account/src/portfolio/mcp.ts`, `dsh/skills/mechanics/account-seat-guide/**`
- owed: the account-seat drill.
- why: face/README.md: after any change to the seat.

### drill-owner — the owner drill
- when: `account/**`
- owed: the owner drill.
- why: face/README.md: after any change under `account/`.

### drill-three-parts — the three-parts drills
- when: `market/src/**`, `account/src/portfolio/server.ts`, `account/src/portfolio/service.ts`, `account/src/portfolio/live/**`
- owed: the three-parts drills, when the change reaches the market's reads, the Account's connected reads, the sidecar or the rules.
- why: its heading in face/README.md.

### drill-three-box — the three-box drill
- when: `compose.yml`, `**/Dockerfile`
- owed: the three-box drill.
- why: face/README.md: after any change to `compose.yml` or a Dockerfile.

### drill-desk — the desk drill
- when: `face/scripts/service.ts`, `face/scripts/watchdog.ts`, `face/scripts/desk.ts`, `face/src/desk*.ts`, `face/src/annotator.ts`, `face/src/phone-bridge.ts`, `face/src/phone.ts`, `face/src/card-notice.ts`, `face/src/market-quotes.ts`, `face/src/symbols.ts`, `face/src/{schedule,firing,standing,producer,market-clock,xshg-clock,brief,report}.ts`, `face/src/{watch,watch-eval,alert-text,edgar,filings,market-news}.ts`, `face/src/main.ts`
- owed: the desk drill (for `main.ts`, when the change touches its exits).
- why: its heading in face/README.md.

### drill-routines — the routines drill
- when: `face/src/routine*.ts`, `face/client/js/host/desk-routines.js`
- owed: the routines drill.
- why: its section in face/README.md, under the desk drill.

### drill-phone — the phone drill
- when: `account/src/portfolio/identity/**`, `face/src/phone.ts`, `face/src/phone-bridge.ts`, `face/src/card-notice.ts`, `face/scripts/watchdog.ts`, `face/client/js/host/identity.js`, `face/client/js/host/identity-view.js`, `face/client/js/host/sheet-identity.js`, `face/client/js/render/identity.js`, `face/client/js/reducers/identity.js`
- owed: the phone drill.
- why: its heading in face/README.md.

### drill-slack — the Slack phone drill
- when: `account/src/portfolio/identity/slack*.ts`, `face/src/phone.ts`, `face/src/phone-bridge.ts`, `face/scripts/watchdog.ts`
- owed: the Slack phone drill (also for the Slack cases elsewhere in `identity/`).
- why: its heading in face/README.md.

### drill-imessage — the iMessage phone drill
- when: `account/src/portfolio/identity/{photon-link,photon-real,imessage-pending,imessage}.ts`, `face/src/phone.ts`, `face/src/phone-bridge.ts`, `face/src/account-proxy.ts`
- owed: the iMessage phone drill (also for the iMessage cases elsewhere in `identity/`).
- why: its heading in face/README.md.
