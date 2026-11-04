# Identity, plan B1a — Telegram in the account, the desk on the account — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The account holds Gravit's Telegram connection — its token, the operator's bound handle, the long poll, an inbox, an outbox, routing, quiet hours and Not you — and the face's desk talks to the phone only through the account, with Gate 2 card notices and a watchdog that checks the face, the account and the market.

**Architecture:**
- **A new `account/src/portfolio/identity/` module** owns everything about the networks: the state file, the token file, the Bot API client, the pending connection of the four sheets, the connected poller, the inbox ring, the outbox, the routing and quiet hours, the strangers, and the fill and Guard-card notices. `PortfolioService` holds one `Identity` (absent when the account layer is not mounted), and `server.ts` mounts its routes.
- **Four new owner types** — `connectNetwork`, `disconnectNetwork`, `setRouting`, `blockSender` — go through the ordinary prepare → What you sign → `POST /api/exchange` door. The token's one trip is at the first sheet's Next, on its own route with its own body reader (the `brain-key` pattern); `connectNetwork` signs only its fingerprint, and the door's handler checks the pending token against it before writing `<home>/credentials/networks/telegram.json`.
- **The face keeps the desk side, loses the transport.** `face/src/telegram.ts` becomes `face/src/phone-bridge.ts` (commands, posting with dedupe keys, slow lines, the accept bound) over a small `face/src/phone.ts` client of the account's unsigned inbox and send routes. The desk outlet's every send names its kind; message ids carry their network (`telegram:<id>`).
- **The browser reaches the identity routes through five new proxy routes** (two reads, three writes); the inbox and send routes are not proxied — only the face's server side calls them.

**Tech Stack:** Node 22 and TypeScript; express 4 and vitest in `account/`; `node --test` via tsx in `face/`; the Telegram Bot API over `fetch` (`getMe`, `getUpdates`, `sendMessage`); tests use a fake Bot API server on loopback.

**Spec:** `docs/superpowers/specs/2026-11-03-account-split-and-identity-design.md`. In scope: Part B §5.1–§5.6, §5.9, §5.10 and §9 "B1" — the account and the face. The client (the Identity tab and the four sheets) is plan B1b, `docs/superpowers/plans/2026-11-04-identity-plan-b1b-identity-tab.md`, which runs after this one on the same branch. Read §5–§10 first, then `DEVELOPMENT.md` §3.9 (the account), §3.10 (the market), §4.2–§4.7, and `face/README.md` "The desk". Out of scope: Slack (B2), iMessage beyond the client's placeholder, approving cards from the phone, buttons on the phone.

## Global Constraints

- **Where to work.**
  - Work on `feat/identity-b1`, cut from local `main` at the commit that adds this plan and B1b, in the worktree `.claude/worktrees/identity-b1`. B1b continues on the same branch after Task 11. Never push.
  - Never run `npm run service`, `npm run account:service`, `npm run market:service -- install`, `docker compose`, or a server outside a test. Never touch `~/.dsh` or a real Telegram bot: every Bot API call in a test goes to the fake Bot API server (Task 2's `fakeBotApi`).
  - Never open `.env*`, `~/.dsh/.credentials.yaml`, anything under `~/.buyer-agent-demo/`, or a key file.
  - `FACE_SMOKE=1` runs from the worktree, which is outside `/tmp` and `$TMPDIR`.
- **Commits.** Write each message to a file in the session scratchpad and commit with `git commit -F <that file's literal absolute path>`. No backticks, no `$()`, no shell variables, no attribution lines. Each task's last step gives the message.
- **Three suites, green after every task, and `main` working after every task.**
  - `cd market && npm ci` once, then `npm test && npm run typecheck`. Baseline at e7a59588: 325 tests.
  - `cd account && npm ci` once, then `npm test && npm run typecheck`. Baseline: 2,163 tests in 141 files (the `ui-standin` real-clock test may flake; rerun it alone before calling it red).
  - `cd face && npm ci` once, then `npm test && npm run typecheck`. Baseline: 3,032 tests, 2,999 pass, 33 skipped. Tasks 6, 8 and 9 also run `cd face && FACE_SMOKE=1 npm test`.
- **Names fixed by this plan.**
  - Networks: `"telegram"` only in B1; types say `Network = "telegram"` and B2 widens it.
  - Kinds (`PhoneKind`): `"chat" | "alert" | "urgent" | "brief" | "report" | "card" | "fill" | "watchdog"`.
  - Routing rows (`RouteRow`), in this order: `"chat"` (Chat with Gravit), `"alerts"` (Watch alerts), `"brief"` (Pre-close brief), `"cards"` (Cards waiting), `"fills"` (Fills and reports). Kind to row: chat→chat, alert→alerts, urgent→alerts, brief→brief, card→cards, fill→fills, report→fills. `watchdog` is in no row: it goes to every connected network.
  - The signed routing string: rows in that order, `row=net,net` joined by `;`, networks sorted, a row with none written `row=` — e.g. `chat=telegram;alerts=telegram;brief=;cards=telegram;fills=telegram`.
  - Quiet hours: `quietFrom`, `quietTo` as `HH:MM` in America/New_York; default `23:00`–`07:00`; both `""` means off; equal non-empty values are refused.
  - A message id on the wire is `<network>:<the network's own id>` — `telegram:4821`.
  - Account home files: `<home>/identity/state.json`, `inbox.json`, `outbox.json`, `strangers.json`, `telegram.offset` (all 0600 in a 0700 folder, written atomically); the token `<home>/credentials/networks/telegram.json` = `{"token","botId","username","operatorId","operatorHandle"}` (0600 in a 0700 folder, no links, temp file + fsync + rename).
  - The face's inbox cursor: `$DSH_HOME/face/desk/inbox.cursor` (beside the old `telegram.offset`, which is left on disk unused).
- **Size budgets.** `GRAVIT.md` ≤ 4,500 bytes and `dsh/profile/lunhui-run.md` ≤ 3,000 bytes; neither is edited by this plan.
- **Product copy** is English, plain text, no parse mode, and never carries a link to the face (spec §5.6).
- **Rulings already made, not to be reopened** (the brief's): the Telegram connector runs in the account; the face keeps the desk side; inbox and send are unsigned behind the account's fence; the account picks recipients; quiet hours hold back proactive kinds except urgent alerts and watchdog notices, replies always go, a held message is not sent later; card notices carry no button and no link; fills are sent by the account and not covered by the desk's pause; one desk conversation; the watchdog phones through the account and reads the token itself only to say the account is down; installing LaunchAgents and editing `$DSH_HOME/.env` are the operator's steps.
- **This plan's rulings** (each says why where it is used):
  1. The token travels once, at sheet 1's Next, on `POST /api/account/identity/telegram/token` beside the fingerprint the page computed (`keyHash = hex sha256(salt ‖ token)`, the `brain-key` recipe). `connectNetwork` signs that fingerprint and names the pending connection; it goes through the ordinary door, whose handler checks the pending token against the fingerprint. Why: spec §5.2 has the account hold the token in memory from Next, so a second trip beside the envelope would send it through the agent box twice; the page forgets it after Next.
  2. A pending connection lasts 10 minutes (`PENDING_MS = 600_000`), the brain key's ten minutes, so `connectNetwork` uses `BRAIN_KEY_TTL_MS`.
  3. The inbox ring holds 500 messages (`INBOX_MAX`), the account stream's ring size.
  4. A message from the operator that is not text is answered by the account with `text only, please` and not stored. A message from a stranger is never answered.
  5. The Chat with Gravit row decides whether a network's texts reach Gravit: a network unticked there answers `Chat with Gravit is off on Telegram: Account › Identity turns it on.` and stores nothing. A reply goes back to the network its text came from.
  6. Watch alerts are `urgent` only for a `desk/rules.yml` rule that says `urgent: true` (a new optional key, default false); price levels never are. Why: the spec names "the rules marked urgent", and the file marks none today, so nothing breaks quiet hours until the operator says so.
  7. The account answers a held send `{held: "quiet hours" | "not routed" | "nothing connected"}`; the face records it as `{undelivered: <that>}`. The face queues nothing: an account that does not answer is `send failed: …`, and the watchdog reports it.
  8. Old watch records whose `sent` holds numbers read as `telegram:<n>` (spec §8, last item).
  9. A stranger is kept as `{network, sender, masked, count, last}` — `sender` the first 12 hex of `sha256("<network>:<id>")`, `masked` `…` and the id's last three digits — at most 50 strangers, the oldest `last` dropped first; never a name, a handle or a text.
  10. Gate 2 notices are sent only by a face with the desk on (`FACE_DESK` not `0`), so a second face on a scratch home never phones.
  11. The watchdog treats the account (or the market) as down after two checks in a row (ten minutes at launchd's five), as it does a degraded desk.
  12. The account's Bot API base is `https://api.telegram.org`; `ACCOUNT_TELEGRAM_API` overrides it for tests and smokes, and only with an `http://127.0.0.1:<port>` value — anything else is ignored with one line, so no setting can send the token to another host.

## Review Focus

- **The account restarts between storing an inbox message and the face's post.** Nothing is lost and nothing is answered twice: the account stored it before advancing Telegram's offset, the face's cursor did not move, and the conversation's key (`<messageId>#<inbox id>@<at>`, `face/src/phone-bridge.ts` `deliveryKey`, as built — the brief's `telegram:<message id>` became the inbox's own id plus the message id and time, so a reconnected bot and a fresh account home do not collide) answers a second post as a duplicate. Test in Task 8 (`an inbox message posted again after the account restarts is answered once`).
- **A desk on a fresh account home.** The face's cursor is ahead of the account's ring (`last` below the cursor): the bridge says so in one line, starts again from 0, and takes the new messages. Test in Task 8 (`a cursor past the account's last id starts again from 0, with one line`).
- **A text from the operator during quiet hours.** The reply goes; an alert raised in the same minute is held and answered `{held: "quiet hours"}`; an `urgent` alert goes. Test in Task 5 (`quiet hours hold proactive kinds, never a reply, an urgent alert or a watchdog notice`).
- **A stranger who finds the bot while it is connected, or during Say hi.** Never reaches the inbox, is never answered, appears in Not you with a count; during a pending connection a stranger's `/start` shows on sheet 3 and "Not me" puts them in Not you. Tests in Task 4 (`a stranger is counted, never stored, never answered`) and Task 2 (`Not me lists the sender as a stranger and waits again`).
- **A token in a place it must not be.** After a full connect, the token appears in no ledger row, no log line, no answer, no file but `credentials/networks/telegram.json`, and no proxy cache or log in the face. Tests in Task 3 (`the token is in credentials/networks/telegram.json and nowhere else`) and Task 6 (`the token route forwards the body as it came and keeps nothing`).

---

## File Structure

**account/** (new files under `src/portfolio/identity/`)
- `kinds.ts` — `PhoneKind`, `RouteRow`, `Routing`, `parseRouting`, `formatRouting`, `rowOf`, `quietHolds`.
- `store.ts` — `IdentityState`, `loadIdentity`, `saveIdentity`, `Strangers`.
- `secret-file.ts` — `writeNetworkSecret`, `removeNetworkSecret`, `readNetworkSecret`.
- `bot-api.ts` — `BotApi`, `BotApiError`, `splitMessage`, `redactorOf`, `telegramApiBase`.
- `pending.ts` — `PendingConnections` (sheets 1–3).
- `inbox.ts` — `InboxRing`.
- `outbox.ts` — `Outbox`.
- `telegram.ts` — `TelegramConnector` (the connected poller).
- `notices.ts` — `fillNotice`, `cardNotice`.
- `identity.ts` — `Identity`, the service the rest of the account talks to.
- `routes.ts` — `registerIdentityRoutes`, `isIdentityTokenPath`, `IDENTITY_WORDS`.
- Modified: `account/sign.ts`, `account/exchange.ts`, `service.ts`, `server.ts`, `README.md`.
- Tests: `test/unit/identity-*.test.ts`, `test/identity-fakes.ts`.

**face/**
- New: `src/phone.ts` (the account's inbox and send, as the face uses them), `src/phone-bridge.ts` (replaces `src/telegram.ts`), `src/card-notice.ts`.
- Modified: `src/desk.ts`, `src/desk-conversation.ts`, `src/watch.ts`, `src/watch-eval.ts`, `src/annotator.ts`, `src/schedule.ts`, `src/firing.ts`, `src/desk-book.ts`, `src/account-proxy.ts`, `src/boot.ts`, `src/main.ts`, `scripts/watchdog.ts`, `scripts/service.ts`, `client/js/host/desk-view.js`, `client/js/render/desk.js`.
- Deleted: `src/telegram.ts`, `tests/telegram.test.ts`, `tests/telegram-smoke.test.ts` (replaced by `tests/phone-bridge.test.ts`, `tests/phone-smoke.test.ts`).

**Docs:** `Gravit-Design.md`, `DEVELOPMENT.md`, `CLAUDE.md`, `face/README.md`, `account/README.md`, `desk/rules.yml` (a comment line for `urgent`).

---

### Task 1: The identity store, the routing and the token file

**Files:**
- Create: `account/src/portfolio/identity/kinds.ts`, `store.ts`, `secret-file.ts`
- Test: `account/test/unit/identity-store.test.ts`

**Interfaces:**
- Produces:
  - `type Network = "telegram"`; `type PhoneKind`; `type RouteRow`; `const ROUTE_ROWS: readonly RouteRow[]`; `type Routing = Record<RouteRow, Network[]>`.
  - `parseRouting(s: string): Routing | string` (a string is the refusal's words); `formatRouting(r: Routing): string`; `rowOf(kind: PhoneKind): RouteRow | "always"`.
  - `quietHolds(kind: PhoneKind, at: number, quiet: { from: string; to: string } | null): boolean`.
  - `interface Binding { network: Network; speaksAs: string; botId: string; talksOnlyWith: string; operatorId: string; since: string; fingerprint: string }`.
  - `interface IdentityState { bindings: Binding[]; routing: Routing; quiet: { from: string; to: string } | null; blocked: string[] }`; `DEFAULT_STATE` (no bindings, every row empty, quiet `23:00`–`07:00`, none blocked).
  - `loadIdentity(home: string): IdentityState`; `saveIdentity(home: string, s: IdentityState): void`.
  - `class Strangers { constructor(home: string); note(network: Network, id: string, at: number): void; list(): Stranger[]; remove(sender: string): void; refOf(network: Network, id: string): string }` with `Stranger = { network; sender; masked; count; last }`.
  - `writeNetworkSecret(home: string, network: Network, content: NetworkSecret): { ok: true; file: string } | Refusal`; `removeNetworkSecret(home, network): { ok: true; removed: boolean } | Refusal`; `readNetworkSecret(home, network): NetworkSecret | undefined` with `NetworkSecret = { token; botId; username; operatorId; operatorHandle }`.

- [ ] **Step 1: Write the failing tests** in `identity-store.test.ts`:

```ts
it("routing round-trips in row order, networks sorted", () => {
  const s = "chat=telegram;alerts=telegram;brief=;cards=telegram;fills=telegram";
  expect(formatRouting(parseRouting(s) as Routing)).toBe(s);
  expect(parseRouting("alerts=telegram;chat=telegram;brief=;cards=;fills=")).toMatch(/order/);
  expect(parseRouting("chat=slack;alerts=;brief=;cards=;fills=")).toMatch(/slack/);
});
it("every kind has its row; the watchdog is in none", () => {
  expect(rowOf("urgent")).toBe("alerts"); expect(rowOf("report")).toBe("fills"); expect(rowOf("watchdog")).toBe("always");
});
it("quiet hours hold proactive kinds across midnight, never chat, urgent or watchdog", () => {
  const q = { from: "23:00", to: "07:00" };
  const et = (hhmm: string) => Date.parse(`2026-11-04T${hhmm}:00-05:00`);
  for (const k of ["alert", "brief", "report", "card", "fill"] as const) expect(quietHolds(k, et("23:30"), q)).toBe(true);
  for (const k of ["chat", "urgent", "watchdog"] as const) expect(quietHolds(k, et("23:30"), q)).toBe(false);
  expect(quietHolds("alert", et("07:00"), q)).toBe(false);
  expect(quietHolds("alert", et("06:59"), q)).toBe(true);
  expect(quietHolds("alert", et("03:00"), null)).toBe(false);
});
it("a fresh home reads the default state; a saved one reads back; the file is 0600 in 0700", () => { /* loadIdentity → DEFAULT_STATE; save; reload deep-equal; mode(file)==="600", mode(dir)==="700" */ });
it("a stranger keeps a count, the last time and a masked id, never more", () => {
  const st = new Strangers(home); st.note("telegram", "123456789", 1); st.note("telegram", "123456789", 2);
  expect(st.list()).toEqual([{ network: "telegram", sender: st.refOf("telegram", "123456789"), masked: "…789", count: 2, last: new Date(2).toISOString() }]);
  expect(readFileSync(join(home, "identity", "strangers.json"), "utf8")).not.toContain("123456789");
});
it("at most 50 strangers: the oldest last time leaves first", () => { /* 51 notes with rising at → list().length 50, the first gone */ });
it("the token file is 0600 in 0700, written whole, never through a link", () => {
  /* writeNetworkSecret → mode 600, dir 700, JSON round-trips via readNetworkSecret;
     a symlink at credentials/networks → refusal code E_ACCOUNT_CREDENTIAL and nothing written;
     removeNetworkSecret → removed true, then false */
});
```

- [ ] **Step 2: Run** `cd account && npx vitest run test/unit/identity-store.test.ts` — Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Implement** the three files. `quietHolds` reads the New York wall clock with `Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })`; a window with `from > to` crosses midnight; `to` is exclusive. `Strangers` persists `strangers.json` at every `note`. `secret-file.ts` follows `brain-keys.ts` `brainsDir`/`writeBrainKey` (folder 0700 and chmod'ed, links refused, `"wx"` temp file 0600, `fsyncSync`, `renameSync`) with its own words naming "a network's token"; `brain-keys.ts` is not changed (its fixed sentences are pinned by its tests). `readNetworkSecret` goes through `live/credentials.ts` `readSecretFile` (inside the home, 0600) and answers `undefined` on any refusal.

- [ ] **Step 4: Run** the same command — Expected: PASS. Then the whole account suite and typecheck — green.

- [ ] **Step 5: Commit** — message: `feat(account): the identity store - routing, quiet hours, strangers and the network token file`.

---

### Task 2: The Bot API client, the pending connection and the token route

**Files:**
- Create: `account/src/portfolio/identity/bot-api.ts`, `pending.ts`, `routes.ts` (the pending half), `account/test/identity-fakes.ts`
- Modify: `account/src/portfolio/server.ts` (the JSON parser skips the token route; mount the routes), `account/src/portfolio/service.ts` (`identity` field, made only when the account layer is mounted)
- Test: `account/test/unit/identity-pending.test.ts`

**Interfaces:**
- Consumes: Task 1's `Strangers`.
- Produces:
  - `class BotApi { constructor(o: { token: string; apiBase: string; fetch?: typeof fetch; signal?: AbortSignal }); getMe(): Promise<{ id: number; username: string; first_name: string }>; getUpdates(offset: number | undefined, timeoutS: number): Promise<unknown[]>; sendMessage(chatId: number, text: string, replyTo?: number): Promise<number> }`; `class BotApiError extends Error { status: number; description: string }` — deadlines as `face/src/telegram.ts` had them (poll + 15 s, send 15 s).
  - `splitMessage(text: string, max = 4000): string[]` and `redactorOf(secrets: readonly string[]): (text: string) => string` — moved from `face/src/telegram.ts` with their tests' cases.
  - `telegramApiBase(env: NodeJS.ProcessEnv, log: (l: string) => void): string` (ruling 12).
  - `interface PendingView { id: string; network: "telegram"; bot: { id: string; username: string; name: string }; link: string; qr: string; expiresAt: string; state: "waiting" | "heard" | "conflict" | "expired"; sender?: { name: string; handle: string; masked: string; text: string } }` — `qr` stays `""` in B1a; B1b Task 2 fills it.
  - `class PendingConnections { begin(token: string, keyHash: string, salt: string): Promise<PendingView | Refusal>; view(id: string): PendingView | undefined; notMe(id: string): PendingView | undefined; drop(id: string): void; take(id: string): PendingTaken | undefined; dispose(): void }` with `PendingTaken = { token; keyHash; salt; bot; sender: { id: string; handle: string }; offset: number }`.
  - Routes: `POST /api/account/identity/telegram/token` `{token, keyHash, salt}` (≤ 1,024 bytes, `application/json`, read by its own reader); `GET /api/account/identity/pending?id=`; `POST /api/account/identity/pending/not-me` `{id}`; `POST /api/account/identity/pending/drop` `{id}`. `isIdentityTokenPath(path: string): boolean` (case and trailing slash as `isBrainKeyPath`).
  - Test helper: `fakeBotApi(): Promise<{ url: string; me: { id: number; username: string; first_name: string }; push(update: object): void; sent: Array<{ chat_id: number; text: string; reply_parameters?: object }>; answer(method: string, status: number, body: object): void; close(): Promise<void> }>` — a `node:http` server on 127.0.0.1:0 that answers `/bot<token>/getMe`, `getUpdates` (holding the long poll until a push or its timeout) and `sendMessage`, and 401 for any other token.

- [ ] **Step 1: Write the failing tests** in `identity-pending.test.ts` (boot as `account-brain-keys.test.ts` `boot` does, with `identity: { apiBase: bot.url, pollTimeoutS: 1 }` in `PortfolioService.create`):

```ts
it("a token Telegram knows becomes a pending connection; the answer names the bot, never the token", async () => {
  const { salt, keyHash } = fp(TOKEN);
  const r = await send(srv.url, "/api/account/identity/telegram/token", { body: JSON.stringify({ token: TOKEN, keyHash, salt }) });
  expect(r.status).toBe(200);
  const p = JSON.parse(r.text).pending;
  expect(p).toMatchObject({ network: "telegram", bot: { username: "gravit_desk_bot" }, link: "https://t.me/gravit_desk_bot", state: "waiting" });
  expect(r.text).not.toContain(TOKEN);
});
it("a token Telegram refuses, a token of the wrong shape and a fingerprint that does not match are refused in fixed words, nothing kept", async () => {
  /* 401 from getMe → 409 IDENTITY_WORDS.refusedByTelegram; "abc" → 400 IDENTITY_WORDS.tokenShape;
     keyHash of another token → 409 IDENTITY_WORDS.mismatch; none of the answers contains what was sent */
});
it("the token route skips the JSON parser: a broken body is one fixed sentence, never logged", async () => { /* body '{"token":"123:' → 400 IDENTITY_WORDS.malformed; console spies saw nothing of it */ });
it("the first private message to the bot is heard: name, handle, masked id and text", async () => {
  bot.push({ update_id: 10, message: { message_id: 1, from: { id: 555000123, first_name: "Pan", username: "pan" }, chat: { id: 555000123, type: "private" }, date: 1, text: "/start" } });
  await until(() => view().state === "heard");
  expect(view().sender).toEqual({ name: "Pan", handle: "@pan", masked: "…123", text: "/start" });
});
it("a group message is not heard while pending", async () => { /* chat.type "group" → state stays "waiting" */ });
it("Not me lists the sender as a stranger and waits again", async () => {
  /* heard → POST not-me {id} → state "waiting", sender undefined; svc.identity.strangers().length === 1 */
});
it("a pending connection expires after 10 minutes and its token is dropped", async () => { /* injected clock + PENDING_MS → state "expired"; take(id) undefined */ });
it("drop forgets the token at once; a second token replaces the first pending", async () => { /* drop → view undefined; two begins → only the second id views */ });
it("a 409 from getUpdates is state conflict", async () => { /* bot.answer("getUpdates", 409, {...}) → state "conflict" */ });
it("the Bot API base takes only a loopback http override", () => {
  expect(telegramApiBase({ ACCOUNT_TELEGRAM_API: "http://127.0.0.1:9999" }, log)).toBe("http://127.0.0.1:9999");
  expect(telegramApiBase({ ACCOUNT_TELEGRAM_API: "https://evil.example" }, log)).toBe("https://api.telegram.org");
  expect(lines).toHaveLength(1);
});
it("splitMessage and redactorOf keep the face's cases", () => { /* surrogate pair never split; 4,000 parts; a secret's JSON and URL spellings → <secret> */ });
it("account/src names api.telegram.org in identity/bot-api.ts alone", () => { /* walk account/src as no-market-code.test.ts does */ });
```

- [ ] **Step 2: Run** `cd account && npx vitest run test/unit/identity-pending.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement.** Token shape `^\d{5,16}:[A-Za-z0-9_-]{30,64}$`. The token route mirrors `server.ts`'s `brain-key` route: content-type check, `readSmall(req, 1024)`, a parser that zeroes the buffer and answers only `IDENTITY_WORDS` sentences, `keyMatches` from `brain-keys.ts` before `getMe`. A begun connection long-polls `getUpdates` with `allowed_updates: ["message"]` and `pollTimeoutS` (25 by default) until it hears, is dropped, is taken or expires; it keeps the offset after the update it heard. A connection is refused (409, `IDENTITY_WORDS.connected`) while a Telegram binding exists. `GET pending` answers `{ok: true, pending}` or 404 `{ok: false, error: IDENTITY_WORDS.noPending}`. Every route answers 404 `the account layer is not mounted` when `svc.identity` is absent. `IDENTITY_WORDS` (fixed, never echoing input):
  - `malformed`: `This route takes one JSON object, {token, keyHash, salt}: what was sent is not that, and it was not kept.`
  - `tokenShape`: `That is not a bot token: BotFather's token is digits, a colon, then letters. Nothing was kept.`
  - `mismatch`: `The token does not match its fingerprint: nothing was kept. Paste the token again.`
  - `refusedByTelegram`: `Telegram does not know this token: nothing was kept. Copy it from BotFather again.`
  - `connected`: `Telegram is connected already: Disconnect… it in Account › Identity first.`
  - `noPending`: `This connection is gone: it expired or was closed. Start again.`

- [ ] **Step 4: Run** the test file, then the whole account suite and typecheck — green.

- [ ] **Step 5: Commit** — `feat(account): connect Telegram, sheets 1 to 3 - the token checked with getMe and held in memory, the first message heard, Not me`.

---

### Task 3: The four owner types and the door

**Files:**
- Modify: `account/src/portfolio/account/sign.ts`, `account/src/portfolio/account/exchange.ts`, `account/src/portfolio/service.ts`
- Create: `account/src/portfolio/identity/identity.ts`
- Modify: `account/src/portfolio/identity/routes.ts` (`GET /api/account/identity`)
- Test: `account/test/unit/identity-sign.test.ts`

**Interfaces:**
- Consumes: Task 1's store and secret file; Task 2's `PendingConnections.take`.
- Produces:
  - `OwnerAction` gains, each with `nonce: number`:
    - `{ type: "connectNetwork"; network: string; pending: string; botId: string; speaksAs: string; operatorId: string; talksOnlyWith: string; routing: string; keyHash: string; salt: string }` — primary `AccountIdentity:Connect`.
    - `{ type: "disconnectNetwork"; network: string }` — `AccountIdentity:Disconnect`.
    - `{ type: "setRouting"; routing: string; quietFrom: string; quietTo: string }` — `AccountIdentity:Routing`.
    - `{ type: "blockSender"; network: string; sender: string; masked: string }` — `AccountIdentity:Block`.
    - All four in `OWNER_TYPES`; none in `MONEY_TYPES` or `STEER_TYPES`; not replayed by `restore.ts` (the state file is the record, as with `setBrainKey`).
  - `ExchangeHost.identity?(action: IdentityAction): Promise<Outcome>`, called by the door's `run` for the four types after the signature, owner and nonce checks; `connectNetwork` also within `BRAIN_KEY_TTL_MS` of its nonce.
  - `keyless` reduces `connectNetwork`'s `keyHash` to its fingerprint and blanks `salt`, as for `setBrainKey`.
  - `class Identity { constructor(deps: IdentityDeps); view(): IdentityView; apply(a: IdentityAction): Promise<Outcome>; pending: PendingConnections; strangers(): Stranger[]; dispose(): Promise<void> }` with `IdentityDeps = { home: string; apiBase: string; fetch?: typeof fetch; pollTimeoutS?: number; now?: () => number; log?: (l: string) => void }`.
  - `IdentityView = { ok: true; networks: Array<Omit<Binding, "botId" | "operatorId"> & { state: "connected"; polling: boolean; lastPollAt?: string; conflictAt?: string; blocked?: true; pollFailing?: { since: string; reason: string } }>; routing: Routing; quiet: { from: string; to: string; zone: "America/New_York" } | null; strangers: Stranger[] }` at `GET /api/account/identity`.

- [ ] **Step 1: Write the failing tests** in `identity-sign.test.ts` (signing with `signOwner(simKey(...), …)` as `account-brain-keys.test.ts` does):

```ts
it("the four types are owner types an agent key can never sign", () => { /* OWNER_TYPES includes all four; an agent signature → refused at the door */ });
it("connect: the door checks the pending token against the signed fingerprint, then stores token and binding", async () => {
  const p = await heardPending(); // Task 2 flow through the routes
  const r = await own({ type: "connectNetwork", network: "telegram", pending: p.id, botId: "777", speaksAs: "@gravit_desk_bot", operatorId: "555000123", talksOnlyWith: "@pan", routing: ALL_TELEGRAM, keyHash, salt });
  expect(isRefusal(r)).toBe(false);
  expect(readNetworkSecret(home, "telegram")).toEqual({ token: TOKEN, botId: "777", username: "gravit_desk_bot", operatorId: "555000123", operatorHandle: "@pan" });
  expect(svc.identity!.view().networks[0]).toMatchObject({ network: "telegram", speaksAs: "@gravit_desk_bot", talksOnlyWith: "@pan", fingerprint: keyHash.slice(0, 8) });
});
it("connect refuses a pending gone, a fingerprint of another token, a bot or a sender other than the one heard, and one past 10 minutes", async () => { /* each → refusal, nothing written, credentials/networks absent */ });
it("the token is in credentials/networks/telegram.json and nowhere else", async () => {
  /* after connect: walk the home; only that file contains TOKEN; ledgerText(home) has the fingerprint and not keyHash, salt or TOKEN; console spies saw no TOKEN */
});
it("disconnect removes the token, the binding and the network's routing ticks", async () => { /* readNetworkSecret undefined; view().networks []; routing every row [] */ });
it("setRouting saves rows and quiet hours; refuses a network not connected, a bad time, equal times", async () => {});
it("blockSender takes the stranger out of Not you and keeps the ref blocked", async () => {});
it("prepare shows each type's fields and refuses what the door would", async () => { /* svc.account.prepare({type:"setRouting", routing:"chat=slack;…"}) → refusal before signing */ });
```

- [ ] **Step 2: Run** `cd account && npx vitest run test/unit/identity-sign.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement.** Add the four entries to `OWNER_FIELDS` (all fields `string` but `nonce`), the `run` case delegating to `this.host.identity`, the TTL check beside `setBrainKey`'s, `keyless` for `connectNetwork`, and `prepare` checks (shape via `malformed`, routing via `parseRouting`, a connect while bound refused with `IDENTITY_WORDS.connected`). `Identity.apply`: connect takes the pending (`take` — gone is a refusal), compares `keyMatches(salt, token, keyHash)`, `botId`, `operatorId`; writes the secret file, then the state (binding, routing from the signed string), then starts the connector (Task 4; until then a no-op hook) at the pending offset. The ledger row's `reason` (the door's summary) is `Telegram connected: Gravit speaks as @x and talks only with @y · token ab12cd34` — never the token. `service.ts` builds `Identity` with `home`, `telegramApiBase(process.env, …)` unless `opts.identity.apiBase` is given, and wires `host.identity`.

- [ ] **Step 4: Run** the test file, the whole account suite and typecheck — green.

- [ ] **Step 5: Commit** — `feat(account): connectNetwork, disconnectNetwork, setRouting and blockSender - signed at the door, the token stored only after the signature`.

---

### Task 4: The connected poller, the inbox and Not you

**Files:**
- Create: `account/src/portfolio/identity/inbox.ts`, `telegram.ts`
- Modify: `identity.ts`, `routes.ts` (`GET /api/account/identity/inbox`)
- Test: `account/test/unit/identity-inbox.test.ts`

**Interfaces:**
- Consumes: Task 3's `Identity`, bindings and state.
- Produces:
  - `interface InboxMessage { id: number; network: Network; messageId: string; replyTo?: string; text: string; at: string }`.
  - `class InboxRing { constructor(home: string, max = 500); append(m: Omit<InboxMessage, "id">): InboxMessage; after(id: number): InboxMessage[]; last(): number; wait(after: number, ms: number, signal?: AbortSignal): Promise<void> }` — ids grow across restarts (`inbox.json` holds `{next, messages}`); reading never changes it.
  - `class TelegramConnector { constructor(deps: { home; api: BotApi; binding: Binding; inbox: InboxRing; strangers: Strangers; blocked: () => string[]; chatOn: () => boolean; reply: (text: string) => Promise<void>; offset: number | undefined; clock; log }); start(): void; status(): NetworkStatus; dispose(): Promise<void> }`.
  - `GET /api/account/identity/inbox?after=<n>&wait=<s>` → `{ ok: true, messages: InboxMessage[], last: number, status: PhoneStatusWire }`, `wait` 0–25 s, `PhoneStatusWire = { networks: NetworkStatus[]; queued: number; strangers: number }`, `NetworkStatus = { network; polling: boolean; lastPollAt?; conflictAt?; blocked?: true; pollFailing?: { since; reason } }`.
  - `Identity.inbox(after: number, waitMs: number, signal?: AbortSignal): Promise<InboxAnswer>`.

- [ ] **Step 1: Write the failing tests** in `identity-inbox.test.ts` (connected through Task 3's flow, fake Bot API):

```ts
it("the operator's text is stored before the offset moves, with its network id and reply id", async () => {
  bot.push(update(20, { message_id: 41, text: "how is NVDA", reply_to_message: { message_id: 40 } }));
  const a = await get(`/api/account/identity/inbox?after=0&wait=5`);
  expect(a.messages).toEqual([{ id: 1, network: "telegram", messageId: "telegram:41", replyTo: "telegram:40", text: "how is NVDA", at: expect.any(String) }]);
  expect(readFileSync(join(home, "identity", "telegram.offset"), "utf8").trim()).toBe("21");
});
it("reading the inbox changes nothing: the same after answers the same messages", async () => {});
it("ids keep growing across a restart of the account", async () => { /* restart service on the same home → next message id 2 */ });
it("the ring keeps the last 500", async () => {});
it("a stranger is counted, never stored, never answered", async () => {
  /* from.id 999 → inbox empty; bot.sent has nothing to 999; view().strangers[0].count 1; inbox.json has no text of it */
});
it("a blocked sender is dropped and not counted", async () => {});
it("a group, an edited message and a channel post are dropped; the operator's photo gets 'text only, please'", async () => {});
it("Chat with Gravit off for Telegram: the text is answered with the line and not stored", async () => {
  /* setRouting chat= → bot.sent last text "Chat with Gravit is off on Telegram: Account › Identity turns it on." */
});
it("a 409 is recorded as conflict and backed off; any other failure backs off 5 s doubling to 60 s", async () => {});
it("the inbox long poll answers as soon as a message lands, and at its wait with none", async () => {});
```

- [ ] **Step 2: Run** `cd account && npx vitest run test/unit/identity-inbox.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement.** Port the loop of `face/src/telegram.ts` `installTelegramBridge` (`run`, `poll`, `take`, backoff, `RECORD_EVERY_MS` lines, renumbered updates taken with one line) minus everything the desk does: an update from the bound `operatorId` in a private chat with text is appended to the inbox, then the offset is written; anything else goes to `Strangers` (unless blocked) or is dropped. The connector starts at service creation when a binding and a secret file exist, and on connect; disconnect disposes it.

- [ ] **Step 4: Run** the test file, the whole account suite and typecheck — green.

- [ ] **Step 5: Commit** — `feat(account): the Telegram connector - the operator's texts into an append-only inbox, strangers counted, the inbox long-polled`.

---

### Task 5: Sending — routing, quiet hours, the outbox and the account's own notices

**Files:**
- Create: `account/src/portfolio/identity/outbox.ts`, `notices.ts`
- Modify: `identity.ts`, `routes.ts` (`POST /api/account/identity/send`), `service.ts` (call `identity.onFill` beside both `stream.emit("fill", …)` sites and `identity.onLedgerRow(row)` at the top of `toldRow`)
- Test: `account/test/unit/identity-send.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `POST /api/account/identity/send` `{kind: PhoneKind, text: string, replyTo?: string, network?: Network}` (≤ 65,536 bytes) → `{ok: true, sent: string[], queued?: true} | {ok: true, queued: true} | {ok: true, held: "quiet hours" | "not routed" | "nothing connected"}`; 400 for a kind not in `PhoneKind`.
  - `Identity.send(m: { kind: PhoneKind; text: string; replyTo?: string; network?: Network }): Promise<SendAnswer>`.
  - `class Outbox { constructor(home: string, max = 100); … }` — port of the face's outbox: `{t, network, text, replyTo?}`, the late line `(written <time>, sent late)` after 2 minutes, flushed in order before each poll and each send, a 400/403 dropped with one line, 403 sets `blocked`.
  - `fillNotice(f: { side: string; qty: number | string; symbol: string; price?: number | string; venueName: string; paper?: boolean }): string`; `cardNotice(row: LedgerRow): string | undefined`.
  - `Identity.onFill(f): void` and `Identity.onLedgerRow(row: LedgerRow): void` — never throw; each sends `fill` / `card` through `send`.

- [ ] **Step 1: Write the failing tests** in `identity-send.test.ts`:

```ts
it("a reply goes to the network its text came from, as a reply, ids prefixed", async () => {
  const r = await post("/api/account/identity/send", { kind: "chat", text: "NVDA is 183", network: "telegram", replyTo: "telegram:41" });
  expect(r).toEqual({ ok: true, sent: ["telegram:" + bot.sent.at(-1)!.message_id] });
  expect(bot.sent.at(-1)).toMatchObject({ chat_id: 555000123, text: "NVDA is 183", reply_parameters: { message_id: 41, allow_sending_without_reply: true } });
});
it("the account picks the recipient: only the bound operator, only ticked networks", async () => {
  /* routing alerts= → send alert → {held: "not routed"}; nothing sent; no binding → {held: "nothing connected"} */
});
it("quiet hours hold proactive kinds, never a reply, an urgent alert or a watchdog notice", async () => {
  /* clock at 23:30 ET: alert → {held: "quiet hours"}; chat → sent; urgent → sent; watchdog → sent; held is never sent later (advance to 07:30, flush → nothing more) */
});
it("the watchdog goes to every connected network whatever the routing says", async () => {});
it("the account's tokens are taken out of every text it sends, beside its parts", async () => { /* text containing TOKEN → bot saw "<token>" */ });
it("a send Telegram cannot take waits in the outbox and goes first, late after 2 minutes", async () => {});
it("a 403 drops the message with one line and the status reads blocked", async () => {});
it("a fill notice says what filled, where, and that it is paper", () => {
  expect(fillNotice({ side: "buy", qty: 10, symbol: "NVDA", price: "183.00", venueName: "Alpaca", paper: true })).toBe("Filled · Buy 10 NVDA at 183.00 · Paper · Alpaca");
});
it("a Guard card raised is a notice with no button and no link", () => {
  expect(cardNotice({ kind: "card", outcome: "pending", reason: "Buy 10 NVDA · limit 183.00 · Paper · Alpaca" } as LedgerRow)).toBe("Your call · Buy 10 NVDA · limit 183.00 · Paper · Alpaca — waiting in Gravit");
  expect(cardNotice({ kind: "card", outcome: "approved", reason: "x" } as LedgerRow)).toBeUndefined();
});
it("a paper fill reaches the phone with no desk turn", async () => { /* a paper order filled in the service → bot.sent has the fill notice */ });
it("no text the account sends carries a link to the face", async () => { /* every bot.sent text across this file has no "127.0.0.1" and no "localhost" */ });
```

- [ ] **Step 2: Run** `cd account && npx vitest run test/unit/identity-send.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement.** `send` order: validate; `nothing connected` with no binding; the networks are `[m.network]` for a `chat` with a network (only when bound), every bound network for `watchdog`, else the routing row of `rowOf(kind)`; none → `not routed`; `quietHolds` → `quiet hours`; then redact with every stored token (`redactorOf`) and send through the outbox. Fill notices name the order's own side, qty and symbol from the fill event's fields.

- [ ] **Step 4: Run** the test file, the whole account suite and typecheck — green.

- [ ] **Step 5: Commit** — `feat(account): the identity send route - the account picks the recipients, routing and quiet hours, the outbox, and its own fill and card notices`.

---

### Task 6: The face's proxy routes for Identity

**Files:**
- Modify: `face/src/account-proxy.ts`
- Test: `face/tests/account-proxy.test.ts` (extend)

**Interfaces:**
- Produces:
  - `ReadRoute` gains `"identity"` (`/data/account/identity` → `/api/account/identity`, query `[]`, TTL 2,000, abort 7,000) and `"identityPending"` (`/data/account/identity/pending` → `/api/account/identity/pending`, query `["id"]`, TTL 1,000, abort 7,000).
  - `WriteRoute` gains `"identityToken"` (`identity/telegram/token` → `/api/account/identity/telegram/token`, limit 1,024, abort 30,000), `"identityNotMe"` (`identity/pending/not-me`, 256, 7,000), `"identityDrop"` (`identity/pending/drop`, 256, 7,000).
  - Not proxied: `/api/account/identity/inbox` and `/api/account/identity/send`.

- [ ] **Step 1: Write the failing tests:**

```ts
test("the identity reads and writes reach the account at their paths", async () => { /* each of the five → the stub saw the mapped path; status and body as the stub answered */ });
test("the token route forwards the body as it came and keeps nothing", async () => {
  /* POST a body holding TOKEN: the stub received the identical bytes; no log line captured contains TOKEN; a GET of /data/account/identity afterwards is served from the account, not a cache of the POST */
});
test("the inbox and send routes are not on the face", async () => { /* /data/account/identity/inbox and /send → the face's 404, the stub asked nothing */ });
test("a disabled mcp-account row answers the identity routes 503 disabled", async () => {});
```

- [ ] **Step 2: Run** `cd face && npx tsx --test tests/account-proxy.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** the five entries in `ACCOUNT_TTL_MS`, `ACCOUNT_ABORT_MS`, `ACCOUNT_QUERY`, `READ_PATHS`, `WRITE_BODY_LIMIT`, `WRITE_ABORT_MS`, `WRITE_PATHS`; update the module header's route counts (25 reads, 15 writes).

- [ ] **Step 4: Run** the file, then `cd face && npm test && npm run typecheck` and `FACE_SMOKE=1 npm test` — green.

- [ ] **Step 5: Commit** — `feat(face): proxy the account's identity reads and its three pending writes - the token unparsed and unlogged; inbox and send stay off the face`.

---

### Task 7: The desk's outlet names its kind; ids carry their network

**Files:**
- Modify: `face/src/desk-conversation.ts`, `watch.ts`, `watch-eval.ts`, `annotator.ts`, `schedule.ts`, `firing.ts`, `desk-book.ts`, `telegram.ts` (adapted, still the transport), `desk/rules.yml` (a comment)
- Test: `face/tests/desk-conversation.test.ts`, `watch.test.ts`, `annotator.test.ts`, `firing.test.ts`, `desk-book.test.ts`, `telegram.test.ts` (extend each)

**Interfaces:**
- Produces:
  - `type PhoneKind` (exported from `face/src/phone.ts`, created here with the type alone; Task 8 adds the client).
  - `DeskOutlet.send(text: string, opts: { kind: PhoneKind; replyTo?: string; network?: string }): Promise<{ sent: string[]; queued?: true } | { queued: true } | { held: string }>`.
  - `DeskConversation.deliver(text: string, opts: { kind: PhoneKind; replyTo?: string; network?: string }): Promise<DeliverResult>`; `{ held }` becomes `{ undelivered: held }`; no outlet is `{ undelivered: "no phone" }` (was `telegram not configured`).
  - A turn's answer is sent `{ kind: "chat", network: "telegram" }` for source `telegram`, `{ kind: "alert" }` for `alert`, `{ kind: "report" }` for `wake`.
  - Firings send `brief` for the order whose producer is `builtin:brief`, `report` for every other.
  - Watch: an alert hit carries `urgent: boolean` from its rule (`Rule.urgent`, `rules.yml` key `urgent`, default false; levels false); it is sent `urgent` when true, else `alert`; batches, late and lost lines, annotations and status lines are `alert`. `WatchHandle.contextFor(messageId: string)`; `AlertDelivered.delivery.sent` and `annotated.sent` are `string[]`, and a number read from an older record is `telegram:<n>`.
  - The old bridge (until Task 8) ignores `kind` and `network`, answers ids as `telegram:<n>` and reads `replyTo` back to its number.

- [ ] **Step 1: Write the failing tests** (one or two per file):

```ts
// desk-conversation.test.ts
test("a phone turn's answer goes as chat to the network it came from; an alert turn's as alert; a wake's as report", async () => { /* outlet spy saw opts { kind: "chat", network: "telegram" }, { kind: "alert" }, { kind: "report" } */ });
test("a held send is recorded undelivered with the account's reason", async () => { /* outlet answers { held: "quiet hours" } → deliver answers { undelivered: "quiet hours" } */ });
// watch.test.ts
test("a rule marked urgent sends urgent; a level and an unmarked rule send alert", async () => {});
test("contextFor reads a string id, and an older record's number as telegram:<n>", () => { /* record sent [41] → contextFor("telegram:41") finds it */ });
// desk-book.test.ts
test("a rule takes urgent: true or false, and refuses any other value", () => {});
// firing.test.ts
test("the pre-close brief is sent as brief, a strategy's report as report", async () => {});
// telegram.test.ts
test("the bridge answers ids with their network and reads a string replyTo", async () => {});
```

- [ ] **Step 2: Run** each file with `cd face && npx tsx --test tests/<file>` — Expected: FAIL.

- [ ] **Step 3: Implement.** Thread `opts.kind` from each caller of `deliver` (watch, annotator, schedule, firing, deliverTurn, the bridge's replies — `chat` with the reply's network). Add `urgent` to `RULE_KEYS` and the `Rule` type, and to `AlertHit` as `urgent?: true`. Add to the comment block at the top of `desk/rules.yml`: `# urgent: true lets a rule's alerts through quiet hours (Account › Identity); no rule is urgent unless it says so.`

- [ ] **Step 4: Run** the face suite, typecheck and `FACE_SMOKE=1 npm test` — green.

- [ ] **Step 5: Commit** — `feat(face): every desk send names its kind and every message id its network; a rule may be marked urgent`.

---

### Task 8: The bridge on the account

**Files:**
- Create: `face/src/phone-bridge.ts`, `face/tests/phone-bridge.test.ts`, `face/tests/fake-phone-account.ts`, `face/tests/phone-smoke.test.ts`
- Modify: `face/src/phone.ts` (the client), `face/src/desk.ts` (`installDesk` deps, `PhoneStatus`, the status line), `face/src/main.ts`, `face/client/js/host/desk-view.js`, `face/client/js/render/desk.js`
- Delete: `face/src/telegram.ts`, `face/tests/telegram.test.ts`, `face/tests/telegram-smoke.test.ts`
- Test: also `face/tests/desk.test.ts`, `face/tests/client/desk-view.test.js`, `face/tests/desk-carry-smoke.test.ts` (moved onto the fake account)

**Interfaces:**
- Consumes: Task 4's inbox route and Task 5's send route (by HTTP); Task 7's outlet.
- Produces:
  - `face/src/phone.ts`: `interface InboxMessage { id: number; network: string; messageId: string; replyTo?: string; text: string; at: string }`; `interface PhoneClient { send(kind: PhoneKind, text: string, opts?: { replyTo?: string; network?: string }): Promise<{ sent: string[]; queued?: true } | { queued: true } | { held: string }>; inbox(after: number, waitS: number, signal?: AbortSignal): Promise<{ messages: InboxMessage[]; last: number; status: AccountPhoneStatus }> }`; `createPhoneClient(o: { url: string; fetch?: typeof fetch; secrets?: readonly string[] }): PhoneClient` — redacts `deskSecrets` before each send; send's deadline 30 s, the inbox's `waitS` + 10 s.
  - `face/src/phone-bridge.ts`: `installPhoneBridge(deps: { phone: PhoneClient; home: string; conversation: Pick<DeskConversation, "post" | "renew" | "stop" | "setOutlet">; status: () => Promise<DeskStatus>; log?: (l: string) => void; clock?: DeskClock; contextFor?: (messageId: string) => string | undefined }): { status(): PhoneStatus; dispose(): Promise<void> }`; `parseCommand` and `Command` move here unchanged.
  - `desk.ts`: `interface PhoneStatus { configured: boolean; polling: boolean; lastPollAt?: string; accountFailing?: { since: string; reason: string }; networks: AccountPhoneStatus["networks"]; queued: number; strangers: number }` replaces `TelegramStatus`; `DeskStatus.phone` replaces `.telegram`; `installDesk` deps `phone?: PhoneClient` replaces `telegram?: TelegramConfig`.

- [ ] **Step 1: Write the failing tests.** `phone-bridge.test.ts` keeps every `telegram.test.ts` case that is the desk's (commands, slow line, accept bound, dispose, outlet) over `fakePhoneAccount()` — a loopback server answering `GET /api/account/identity/inbox` from a pushed queue and recording `POST /api/account/identity/send` — and adds:

```ts
test("an inbox text is posted with key telegram:<message id> and its reply's context", async () => {
  account.push({ network: "telegram", messageId: "telegram:41", replyTo: "telegram:40", text: "why?", at: AT });
  const p = await posted();
  assert.equal(p.key, "telegram:41");
  assert.deepEqual(p.message, { kind: "telegram", network: "telegram", messageId: "telegram:41" });
  assert.equal(contextAsked, "telegram:40");
});
test("the cursor moves only after the post settles, and is kept in inbox.cursor", async () => {});
test("an inbox message posted again after the account restarts is answered once", async () => { /* same messageId with a new inbox id → conversation answers duplicate, nothing sent */ });
test("a cursor past the account's last id starts again from 0, with one line", async () => {});
test("commands answer as chat to the network they came from; /pause and /mute write OFF and MUTE by telegram", async () => {});
test("an account that does not answer is backed off from 5 s to 60 s and shows in the status", async () => {});
test("the face reads no TELEGRAM_* name and sends nothing to api.telegram.org", () => {
  /* walk face/src: no "TELEGRAM_BOT_TOKEN", "TELEGRAM_OPERATOR_ID" or "api.telegram.org", but src/agents.ts's scrub list */
});
```

  `desk.test.ts`: `deskStatusLines` phone line —

```ts
assert.equal(phoneLine({ configured: true, polling: true, lastPollAt: AT, networks: [{ network: "telegram", polling: true }], queued: 0, strangers: 2 }, NOW), "phone: telegram polling, last poll 14:03 ET, 0 queued, 2 strangers");
assert.equal(phoneLine({ configured: true, polling: true, networks: [], queued: 0, strangers: 0 }, NOW), "phone: nothing connected (Account › Identity)");
assert.equal(phoneLine({ configured: false, polling: false, networks: [], queued: 0, strangers: 0 }, NOW), "phone: none (the account's half is off)");
// accountFailing appends: ", the account has not answered since 14:03 ET: ECONNREFUSED"
```

  `client/desk-view.test.js`: the same three lines from the client's mirror (`phoneLine` in `host/desk-view.js`, field `view.phone`). `phone-smoke.test.ts` (`FACE_SMOKE=1`): a real face boot with `FACE_ACCOUNT_URL` at `fakePhoneAccount()` — a pushed text opens a desk turn and its answer reaches `/send` as `chat` with `network: "telegram"`.

- [ ] **Step 2: Run** `cd face && npx tsx --test tests/phone-bridge.test.ts tests/desk.test.ts tests/client/desk-view.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement.** `installPhoneBridge` is `installTelegramBridge` with `poll()` replaced by `phone.inbox(cursor, 25)`, `take` moving `cursor` (written to `inbox.cursor` with `writeFileAtomic`, 0600/0700) after the post settles or `ACCEPT_BOUND_MS`, replies through `phone.send("chat", line, { network })`, and no token, outbox, split or redaction of its own (the account does those). `installDesk` loads `./phone-bridge.ts` on first use as it loaded `./telegram.ts`. `main.ts` makes `createPhoneClient({ url })` from the same URL the proxy uses, only when the `mcp-account` row is not disabled, and passes it as `phone`; the `TELEGRAM_*` read goes.

- [ ] **Step 4: Run** the face suite, typecheck and `FACE_SMOKE=1 npm test` — green.

- [ ] **Step 5: Commit** — `feat(face): the desk's bridge long-polls the account's inbox and sends through it - no token, no getUpdates, no sendMessage in the face`.

---

### Task 9: Card notices from Gate 2, and the service's env list

**Files:**
- Create: `face/src/card-notice.ts`
- Modify: `face/src/boot.ts` (`FaceBootOptions.onCardAsked`, called in `armOrderGate` when the decision is `ask`), `face/src/main.ts`, `face/scripts/service.ts` (drop `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OPERATOR_ID` and `.env.telegram` from the copied names and key files)
- Test: `face/tests/card-notice.test.ts`, `face/tests/order-gate.test.ts` (extend), `face/tests/service.test.ts` (extend)

**Interfaces:**
- Produces: `cardNoticeText(name: string, args: unknown): string`; `FaceBootOptions.onCardAsked?: (name: string, args: unknown) => void` (never awaited; a throw is one line).

- [ ] **Step 1: Write the failing tests:**

```ts
test("an order card's notice: side, size, symbol, limit, venue, no button, no link", () => {
  assert.equal(cardNoticeText("mcp__account__portfolio_live_order", { venue: "alpaca-paper", symbol: "NVDA", side: "buy", qty: 10, orderType: "limit", limitPrice: 183 }),
    "Your call · Buy 10 NVDA · limit 183 · alpaca-paper — waiting in Gravit");
  const args = { venue: "alpaca-paper", order: "ord-0007" };
  assert.equal(cardNoticeText("mcp__account__portfolio_live_cancel", args), `Your call · ${describeOrder("portfolio_live_cancel", args)} — waiting in Gravit`);
  assert.doesNotMatch(cardNoticeText("mcp__account__portfolio_pay", { url: "https://x.example/pay", maxAmount: 5 }), /127\.0\.0\.1|localhost/);
});
test("a carded seat write calls onCardAsked once; a denied one and a read never", async () => {});
test("the service no longer copies TELEGRAM_* or .env.telegram", () => {});
```

- [ ] **Step 2: Run** the three files — Expected: FAIL.

- [ ] **Step 3: Implement.** A non-order seat write's line is `describeOrder` of the raw tool name (the part after the last `__`). `main.ts` passes `onCardAsked` only when the desk is enabled (ruling 10): `phone.send("card", cardNoticeText(name, args))`, a failure one line.

- [ ] **Step 4: Run** the face suite, typecheck and `FACE_SMOKE=1 npm test` — green.

- [ ] **Step 5: Commit** — `feat(face): a Gate 2 card raised is announced on the phone through the account, in words only; the service stops copying the Telegram names`.

---

### Task 10: The watchdog checks three services and phones through the account

**Files:**
- Modify: `face/scripts/watchdog.ts`
- Test: `face/tests/watchdog.test.ts` (extend)

**Interfaces:**
- Produces:
  - `WatchdogDeps` gains `checkAccount(): Promise<boolean>` (`GET <FACE_ACCOUNT_URL>/api/overview`, 5 s), `checkMarket(): Promise<boolean>` (`GET <FACE_MARKET_URL>/api/health`, 5 s), and `send` becomes `(text: string) => Promise<boolean>` — `POST /api/account/identity/send {kind: "watchdog", text}`, true when the account answered — plus `sendDirect(text: string): Promise<void>`.
  - `WatchdogState` gains `accountDownChecks: number`, `accountSince?: string`, `accountSaid?: true`, `marketDownChecks: number`, `marketSince?: string`, `marketSaid?: true`.
  - `phoneDirectOf(accountHome: string, io: { fetch: typeof fetch; log(l: string): void }): { send(text: string): Promise<void>; redact(text: string): string }` — reads `credentials/networks/telegram.json` only if it is a plain file inside the home with mode 0600; replaces `phoneOf` and `homeEnv`.
  - `accountHomeOf(env: NodeJS.ProcessEnv): string` = `FACE_ACCOUNT_HOME`, else `BUYER_HOME`, else `~/.buyer-agent-demo`.

- [ ] **Step 1: Write the failing tests:**

```ts
test("the account down two checks in a row: one direct notice, nothing more until it is back", async () => {
  /* run 1 → no notice; run 2 → sendDirect("the account has not answered since 14:05 ET; nothing reaches the phone until it does") once; run 3 → none */
});
test("the account back after a notice: 'the account answers again (down since 14:05 ET)' through the account", async () => {});
test("the market down two checks: 'the market has not answered since 14:05 ET: prices, the watch and paper fills wait', once, through the account; back: 'the market answers again (down since 14:05 ET)'", async () => {});
test("the desk's lines go through the account; while the account is down they are logged not sent", async () => {});
test("phoneDirectOf reads no token from a file others can read, and takes the token out of every line", async () => {});
test("OFF in force holds every line, the account's and the market's too", async () => {});
```

- [ ] **Step 2: Run** `cd face && npx tsx --test tests/watchdog.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** the two new episodes beside the desk's, each run checking all three; the direct path is used only for the account-down notice. The header comment says the watchdog never restarts the account or the market (their own LaunchAgents keep them alive).

- [ ] **Step 4: Run** the face suite and typecheck — green.

- [ ] **Step 5: Commit** — `feat(face): the watchdog checks the face, the account and the market, phones through the account, and reads the token itself only to say the account is down`.

---

### Task 11: Charter, docs and the account's README

**Files:**
- Modify: `Gravit-Design.md`, `DEVELOPMENT.md`, `CLAUDE.md`, `face/README.md`, `account/README.md`

- [ ] **Step 1: The charter** (spec §5.9, approved with the spec): D20 rewritten — the token is a key held by the account under its home (`credentials/networks/`), not in `$DSH_HOME/.env`; one bound handle per network; connections outbound only; tokens redacted; the host watchdog may read the token only to report that the account is down; the lost-phone remedy names Disconnect… in Account › Identity. §4 write map: rows for `<account home>/credentials/networks/` and `<account home>/identity/` (the account: inbox, outbox, Not-you counts, routing and quiet hours, by the owner's signature) and the face's `inbox.cursor` in the desk row. §7.3: three sentences — the account polls the networks; the face polls the account; a pasted token passes through the agent box unparsed and unlogged and is never stored there. D19 says it applies on every network. §8: Slack and iMessage are new networks, not a second user; a group or a second person still triggers the next charter (the D20 trigger row reworded so). D18: the face's route allow-list gains the identity routes. Add the revision line at the top.
- [ ] **Step 2: DEVELOPMENT.md**: §3.9 gains "Identity" (the module, the four owner types, the routes, the files, rulings 1–9 and 12); §4.2 module table (`phone.ts`, `phone-bridge.ts`, `card-notice.ts`; `telegram.ts` gone); §4.4 route table (the five proxied routes); §4.5 (`inbox.cursor`); §4.6 and Appendix A (`TELEGRAM_*` gone; `ACCOUNT_TELEGRAM_API`, `FACE_ACCOUNT_HOME` added); §4.7 (the notice); §7.3 (the new test files); §9 residuals: Gate 2 and the Guard card are two notices for one seat write; old `telegram.offset`, `outbox.json` and `telegram.jsonl` stay on disk unused.
- [ ] **Step 3: CLAUDE.md**: the `face/src/desk*.ts · telegram.ts …` row names `phone-bridge.ts` and `phone.ts`; the `account/` row adds `src/portfolio/identity/` (Telegram, its token under `credentials/networks/`); the proxy's route count (forty-three exact routes). `face/README.md` "The desk": the Telegram setup steps become "connect Telegram in Account › Identity (after plan B1b)", the env table loses `TELEGRAM_*`, the commands table stays. `account/README.md`: the identity routes, files and `ACCOUNT_TELEGRAM_API`.
- [ ] **Step 4: Run** `cd face && npm test` (the doc-pinned tests: `gravit-md`, CLAUDE.md line checks if any) and the account suite — green.
- [ ] **Step 5: Commit** — `docs: Identity in the account - D20, D19, D18, the write map, 7.3 and 8 as approved; DEVELOPMENT, CLAUDE.md and the READMEs as built`.

---

## Self-Review

- **Spec coverage.** §5.2 sheets 1–3 → Task 2; sheet 4's signature → Task 3 (client in B1b). §5.3 → Rulings 1–2, Tasks 1–3, 6. §5.4 → Tasks 4, 8. §5.5 inbound → Tasks 4, 8; outbound → Tasks 5, 7, 8; reply context → Task 7; auth → Task 6 (not proxied). §5.6 table → Tasks 5 (fills, Guard cards, quiet hours, routing, no links), 7 (kinds, mute, brief/report), 9 (Gate 2 cards), 10 (watchdog). §5.9 → Task 11. §5.10 → Task 10 and B1b's operator section. §5.1 and the four sheets' screens → B1b.
- **Types.** `PhoneKind`, `Network`, the routing string, `telegram:<id>` ids, `InboxMessage` and the send answer are the same in the account (Tasks 1, 4, 5) and the face (Tasks 7, 8); the face redeclares them in `phone.ts` because the packages share no code.
- **Review Focus** lines each have a named test in their owning task.
